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
  microbreakInterval: 60000,
  breakInterval: 1,
  extendedBreakInterval: 3,
  naturalBreaksInactivityResetTime: 60000,
  naturalBreaksLongIdleResetTime: 120000
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
      const reports = []
      const makePlanner = () => {
        const values = {
          ...defaults, naturalBreaks: false, monitorDnd: false,
          microbreakInterval: 60000, breakInterval: 1, extendedBreakInterval: 3,
          naturalBreaksInactivityResetTime: 60000, naturalBreaksLongIdleResetTime: 120000
        }
        return { planner: new BreaksPlanner({ get: key => values[key] }), values }
      }
      const dispose = planner => {
        planner.naturalBreaksManager.stop()
        planner.dndManager.stop()
        planner.appExclusionsManager.stop()
        planner.scheduler?.cancel()
      }
      try {
        for (const stage of ['first-mini', 'next-long', 'next-extended']) {
          const { planner } = makePlanner()
          if (stage === 'next-long') planner.breakNumber = 1
          if (stage === 'next-extended') { planner.breakNumber = 1; planner.longBreakNumber = 2 }
          planner.nextBreak()
          const ordinal = planner.longBreakNumber + (planner._scheduledBreakType === 'microbreak' ? 1 : 0)
          planner.naturalBreaksManager.emit('idleShortThresholdReached', 60000)
          if (planner.scheduler.timer !== null) throw Error(stage + ': short recovery countdown must be paused')
          if (planner._scheduledBreakType !== 'microbreak' && planner.settings.get('microbreak')) throw Error(stage + ': short recovery did not return to first Mini')
          const afterShort = [planner.breakNumber, planner.longBreakNumber]
          planner.naturalBreaksManager.emit('idleShortThresholdReached', 62000)
          if (JSON.stringify(afterShort) !== JSON.stringify([planner.breakNumber, planner.longBreakNumber])) throw Error(stage + ': repeated short threshold changed cycle ordinal')
          if (stage !== 'first-mini') {
            planner.naturalBreaksManager.emit('idleLongThresholdReached', 120000)
            if (planner.breakNumber !== 1 || planner.longBreakNumber !== 0) throw Error(stage + ': long threshold did not reset the full cycle')
          }
          planner.naturalBreaksManager.emit('idlePeriodFinished', 120000)
          if (planner.scheduler.timer === null) throw Error(stage + ': schedule failed to resume on activity')
          reports.push({ stage, ordinal, afterShort, resumed: planner.scheduler.reference })
          dispose(planner)
        }
      } finally {}
      return reports
    })()`
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  assert.equal(result.result.value.length, 3)
  writeFileSync(join(profile, 'results.json'), JSON.stringify({ app: folder, reports: result.result.value }, null, 2))
  console.log('Packaged two-tier idle cycle recovery and full-reset checks passed.')
} finally {
  socket?.close()
  child.kill()
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once('exit', resolve)
  })
}
