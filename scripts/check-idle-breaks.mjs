import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'

const folder = resolve(process.argv[2] || 'dist/win-unpacked')
const profile = resolve('.scratch/idle-check')
mkdirSync(join(profile, 'Data'), { recursive: true })
writeFileSync(join(profile, 'Data/config.json'), JSON.stringify({
  isFirstRun: false,
  checkNewVersion: false,
  notifyNewVersion: false,
  naturalBreaks: false,
  monitorDnd: false,
  microbreakInterval: 3600000
}))
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const child = spawn(join(folder, 'Stretchly Customized.exe'), ['--inspect=127.0.0.1:' + port], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
})
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let socket
try {
  let target
  for (let attempt = 0; attempt < 80; attempt++) {
    await sleep(100)
    try {
      target = (await (await fetch('http://127.0.0.1:' + port + '/json')).json())[0]
      if (target) break
    } catch {}
  }
  assert.ok(target, 'Packaged main process must start with its isolated inspector')
  socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  const pending = new Map()
  let next = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++next
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')) }, 10000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const result = await send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const { app } = process.getBuiltinModule('module').createRequire(process.execPath)('electron')
      await app.whenReady()
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const { join } = process.getBuiltinModule('path')
      const { default: BreaksPlanner } = require(join(app.getAppPath(), 'app/breaksPlanner.js'))
      const { default: defaults } = require(join(app.getAppPath(), 'app/utils/defaultSettings.js'))
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const reports = []
      for (const mode of ['preserve', 'partial', 'reset']) {
        for (const type of ['mini', 'long', 'extended']) {
          const values = {
            ...defaults, naturalBreaks: true, monitorDnd: false,
            naturalBreaksCheckInterval: 20, naturalBreaksInactivityResetTime: 60000,
            naturalBreaksIdleMode: mode,
            microbreakInterval: 600000, breakInterval: 1, extendedBreakInterval: 3
          }
          const planner = new BreaksPlanner({ get: key => values[key] })
          let idleTime = 0
          Object.defineProperty(planner.naturalBreaksManager, 'idleTime', { get: () => idleTime })
          try {
            planner.breakNumber = type === 'mini' ? 0 : 1
            planner.longBreakNumber = type === 'extended' ? 2 : 1
            planner.nextBreak()
            planner.scheduler.now -= 180000
            const counts = [planner.breakNumber, planner.longBreakNumber, planner.postponesNumber]
            const reference = planner.scheduler.reference
            idleTime = 60000
            await wait(90)
            const pausedRemaining = planner.timeToNextBreak
            if (mode === 'reset') {
              if (planner.scheduler.reference !== null || planner.longBreakNumber !== 0) throw Error('Reset mode must reset progress')
            } else {
              if (planner.idlePausedScheduler !== planner.scheduler || planner.scheduler.timer !== null) throw Error(type + ': scheduler not paused')
              if (Math.abs(pausedRemaining - (mode === 'partial' ? 600000 : 480000)) > 250) throw Error(type + ': idle-onset countdown not restored: ' + pausedRemaining)
              if (JSON.stringify(counts) !== JSON.stringify([planner.breakNumber, planner.longBreakNumber, planner.postponesNumber])) throw Error(type + ': cycle progress lost')
              await wait(80)
              if (planner.timeToNextBreak !== pausedRemaining) throw Error(type + ': paused timer continued counting')
            }
            idleTime = 0
            await wait(90)
            if (planner.scheduler.timer === null) throw Error(type + ': timer failed to resume')
            if (mode !== 'reset' && (planner.scheduler.reference !== reference || Math.abs(planner.timeToNextBreak - pausedRemaining) > 250)) throw Error(type + ': resumed wrong countdown')
            reports.push({ type, mode, reference, counts, pausedRemaining, resumedRemaining: planner.timeToNextBreak, cyclePreserved: mode !== 'reset' })
          } finally {
            planner.naturalBreaksManager.stop()
            planner.dndManager.stop()
            planner.appExclusionsManager.stop()
            planner.scheduler.cancel()
          }
        }
      }
      return reports
    })()`
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  assert.equal(result.result.value.length, 9)
  writeFileSync(join(profile, 'results.json'), JSON.stringify({
    app: folder, idleInput: 'simulated in isolated packaged planners', reports: result.result.value
  }, null, 2))
  console.log('Packaged idle-onset countdown, Mini/Long/Extended preserve, partial-reset and complete-reset checks passed.')
} finally {
  socket?.close()
  child.kill()
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once('exit', resolve)
  })
}
