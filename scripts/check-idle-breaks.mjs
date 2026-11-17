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
      const { breakDebtRate } = require(join(app.getAppPath(), 'app/utils/breakDebt.js'))
      const { default: DebtSession } = require(join(app.getAppPath(), 'app/utils/debtSession.js'))
      const minute = 60000
      const values = {
        ...defaults, naturalBreaks: false, monitorDnd: false,
        microbreakInterval: 20 * minute, breakInterval: 1,
        breakDuration: 4 * minute, extendedBreak: true,
        extendedBreakDuration: 12 * minute, extendedBreakInterval: 2,
        naturalBreaksCheckInterval: 10
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
        let closed = false
        let resets = 0
        planner.on('closeForIdle', () => { closed = true })
        planner.on('idleSessionReset', () => { resets++ })
        let simulatedIdle = 0
        planner.naturalBreaksManager.usingNaturalBreaks = true
        Object.defineProperty(planner.naturalBreaksManager, 'idleTime', { get: () => simulatedIdle })
        Object.defineProperty(planner.naturalBreaksManager, 'systemIdleTime', { get: () => simulatedIdle })
        Object.defineProperty(planner.naturalBreaksManager, 'isLocked', { get: () => false })
        planner.on('startBreak', () => planner.emit('breakStarted', false, values.breakDuration))
        planner.nextBreak()
        planner.nextBreak()
        planner.emit('startBreak')
        planner.breakWindowOpenedAt = Date.now() - 5 * minute
        simulatedIdle = 4 * minute
        planner.naturalBreaksManager.emit('idleTimeObserved', simulatedIdle, 0)
        if (closed || planner.scheduler.reference !== 'finishBreak') throw Error('idle closed an ongoing Long break')
        planner.nextBreak()
        if (!planner.waitingForActivity || planner.scheduler.timer !== null) throw Error('next interval did not wait for activity')
        simulatedIdle = 12 * minute
        planner.naturalBreaksManager.emit('idleTimeObserved', simulatedIdle, 4 * minute)
        if (resets !== 1 || !planner.waitingForActivity) throw Error('Extended-length idle did not reset the held session')
        simulatedIdle = 0
        planner.naturalBreaksManager.emit('idleTimeObserved', simulatedIdle, 12 * minute)
        if (planner.waitingForActivity || planner.scheduler.timer === null) throw Error('next interval did not resume on activity')
        reports.afk = { closed, resets, resumed: !planner.waitingForActivity, timeToNextBreak: planner.timeToNextBreak }
        if (Math.abs(planner.timeToNextBreak - 20 * minute) > 1000) {
          throw Error('the next Mini interval did not restart in full on return')
        }
      } finally {
        planner.clear()
        planner.naturalBreaksManager.stop()
        planner.dndManager.stop()
        planner.appExclusionsManager.stop()
      }
      let clock = Date.now()
      const debtSettings = () => ({ longInterval: 40 * minute, cycleInterval: 80 * minute, longDuration: 4 * minute, extendedDuration: 12 * minute })
      const stats = new BreakStatistics({ data: { debt: { modelVersion: 3, balance: 5 * minute } }, now: () => clock, debtRate: () => breakDebtRate(settings), debtSettings })
      clock += 40 * minute
      stats.offer({ type: 'long', baseDuration: 4 * minute })
      stats.episode.debtPayment = stats.debt.shares([4, 4, 12].map(value => value * minute))[0]
      stats.start('long', 5 * minute)
      clock += 4.5 * minute
      const before = stats.debt.amount
      stats.skip()
      reports.skip = { before, after: stats.debt.amount }
      if (stats.debt.amount !== before - 0.5 * minute) throw Error('Partial debt payment was not retained')

      const ledger = new BreakStatistics({ data: { debt: { modelVersion: 3, balance: 5 * minute } }, now: () => clock, debtRate: () => breakDebtRate(settings), debtSettings })
      const plan = ledger.debt.shares([4, 4, 12].map(value => value * minute))
      const payment = plan[0]
      const saved = JSON.parse(ledger.serialize())
      const restored = DebtSession.restore(saved.debt)
      reports.debt = { payment, plan, before: ledger.debt.amount, after: restored.debt.amount }
      if (payment > 6 * minute) throw Error('Repayment exceeds six minutes')
      if (Math.abs(plan[2] - 3 * plan[0]) > 1) throw Error('Allocation is not proportional')
      if (restored.debt.amount !== ledger.debt.amount) throw Error('Debt changed on restart')
      values.extendedBreakInterval = 3
      const postponed = new BreakStatistics({ now: () => clock, debtRate: () => breakDebtRate(settings), debtSettings })
      clock += 40 * minute
      postponed.offer({ type: 'long', baseDuration: 4 * minute })
      for (const delay of [2, 4, 6]) {
        postponed.postpone()
        clock += delay * minute
        postponed.advance()
        postponed.offer({ type: 'long', baseDuration: 4 * minute })
      }
      const shares = postponed.debt.shares([4, 4, 12].map(value => value * minute))
      if (Math.abs(postponed.debt.amount - 2 * minute) > 1 || Math.abs(shares[0] - 24000) > 1) throw Error('Repeated postponement debt or allocation is incorrect')
      reports.postponed = { debt: postponed.debt.amount, shares }
      return reports
    })()`
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  assert.equal(result.result.value.thresholds.short, 240000)
  assert.ok(Math.abs(result.result.value.rate - 0.2) < 1e-9)
  assert.equal(result.result.value.afk.closed, false)
  assert.equal(result.result.value.afk.resets, 1)
  assert.equal(result.result.value.afk.resumed, true)
  assert.equal(result.result.value.skip.after, result.result.value.skip.before - 30000)
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
