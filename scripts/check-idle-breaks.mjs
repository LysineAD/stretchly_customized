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
  microbreakInterval: 1200000,
  breakInterval: 1,
  extendedBreakInterval: 2
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
      const { default: BreakStatistics } = require(join(app.getAppPath(), 'app/utils/breakStatistics.js'))
      const { default: BreakDebt, breakDebtRate } = require(join(app.getAppPath(), 'app/utils/breakDebt.js'))
      const minute = 60000
      const values = {
        ...defaults, naturalBreaks: false, monitorDnd: false,
        microbreakInterval: 20 * minute, breakInterval: 1,
        breakDuration: 4 * minute, extendedBreak: true,
        extendedBreakDuration: 12 * minute, extendedBreakInterval: 2,
        naturalBreaksCheckInterval: 2000
      }
      const settings = { get: key => values[key] }
      const reports = {}
      const planner = new BreaksPlanner(settings)
      try {
        reports.thresholds = planner.naturalBreaksManager.thresholds
        if (reports.thresholds.short !== 4 * minute || reports.thresholds.long !== 12 * minute) {
          throw Error('idle thresholds are not derived from the break durations')
        }
        reports.rate = breakDebtRate(settings)
        const cycleWork = 2 * 20 * minute * 2
        const cycleRest = 4 * minute + 12 * minute
        if (Math.abs(reports.rate - cycleRest / cycleWork) > 1e-9) {
          throw Error('packaged break debt rate is not the schedule’s own larger-break average')
        }
        let finished = null
        planner.on('idleRecoveryFinished', payload => { finished = payload })
        planner.on('startBreak', () => planner.emit('breakStarted', false, values.breakDuration))
        planner.nextBreak()
        planner.nextBreak()
        planner.emit('startBreak')
        planner.naturalBreaksManager.emit('idleTimeObserved', 4 * minute, 0)
        if (!planner.idlePeriod?.duringBreak) throw Error('idle was not captured during the running Long break')
        planner.nextBreak()
        if (!planner.idlePeriod?.completed) throw Error('the break ending while away was not recorded')
        planner.naturalBreaksManager.emit('idlePeriodFinished', 6 * minute, Date.now() + 6 * minute)
        if (!finished?.fulfilled) throw Error('AFK covering the running break was not fulfilled')
        reports.afk = { fulfilled: finished.fulfilled, reset: finished.reset, timeToNextBreak: planner.timeToNextBreak }
        if (Math.abs(planner.timeToNextBreak - 20 * minute) > 1000) {
          throw Error('the next Mini interval did not restart in full on return')
        }
      } finally {
        planner.scheduler?.cancel()
        planner.naturalBreaksManager.stop()
        planner.dndManager.stop()
        planner.appExclusionsManager.stop()
      }
      let clock = Date.now()
      const stats = new BreakStatistics({ now: () => clock, debtRate: () => breakDebtRate(settings) })
      stats.debt.balance = 20 * minute
      stats.debt.work = 100 * minute
      stats.offer({ type: 'long', baseDuration: 4 * minute })
      clock += 10000
      stats.start('long', 4 * minute)
      clock += 3 * minute
      const before = stats.debt.balance
      stats.skip()
      reports.skip = { before, after: stats.debt.balance }
      if (stats.debt.balance !== before - 3 * minute) throw Error('Partial rest was not credited')

      const ledger = new BreakStatistics({ now: () => clock, debtRate: () => breakDebtRate(settings) })
      ledger.debt.balance = 30 * minute
      const upcoming = [0, 40, 80].map((after, i) => ({ after: after * minute, duration: [4, 4, 12][i] * minute }))
      const payment = ledger.debt.forecast(breakDebtRate(settings), upcoming)
      const saved = JSON.parse(ledger.serialize())
      const restored = new BreakDebt(saved.debt)
      reports.debt = { payment, plan: ledger.debt.plan, before: ledger.debt.balance, after: restored.balance }
      if (payment > 6 * minute) throw Error('Repayment exceeds six minutes')
      if (Math.abs(ledger.debt.plan[2] - 3 * ledger.debt.plan[0]) > 1) throw Error('Forecast is not proportional')
      if (restored.balance !== ledger.debt.balance) throw Error('Debt changed on restart')
      return reports
    })()`
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  assert.equal(result.result.value.thresholds.short, 240000)
  assert.ok(Math.abs(result.result.value.rate - 0.2) < 1e-9)
  assert.equal(result.result.value.afk.fulfilled, true)
  assert.equal(result.result.value.skip.after, result.result.value.skip.before - 180000)
  assert.equal(result.result.value.debt.before, result.result.value.debt.after)
  assert.ok(result.result.value.debt.payment <= 360000)
  writeFileSync(join(profile, 'results.json'), JSON.stringify({ app: folder, reports: result.result.value }, null, 2))
  console.log('Packaged idle thresholds, debt rate, AFK recovery, partial rest, proportional forecast, repayment cap and restart checks passed.')
} finally {
  socket?.close()
  child.kill()
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.once('exit', resolve)
  })
}
