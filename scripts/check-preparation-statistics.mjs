import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'

const folder = resolve(process.argv[2] || 'dist/win-unpacked')
const output = resolve('.scratch/preparation-statistics-check')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const reports = []

for (const type of ['mini', 'long', 'extended']) {
  const profile = join(output, type)
  const data = join(profile, 'Data')
  mkdirSync(data, { recursive: true })
  const statisticsPath = join(data, 'stretchly-statistics.json')
  const emptyHistory = { version: 2, days: {} }
  writeFileSync(statisticsPath, JSON.stringify(emptyHistory))
  writeFileSync(statisticsPath + '.bak', JSON.stringify(emptyHistory))
  writeFileSync(join(data, 'config.json'), JSON.stringify({
    isFirstRun: false,
    checkNewVersion: false,
    notifyNewVersion: false,
    naturalBreaks: false,
    monitorDnd: false,
    manualBreakStart: true,
    compactBreaks: true,
    allScreens: true,
    breakClickThrough: true,
    endBreakShortcut: '',
    microbreak: type === 'mini',
    break: type !== 'mini',
    extendedBreak: type === 'extended',
    extendedBreakInterval: 1,
    breakInterval: 0,
    microbreakInterval: 8000,
    microbreakDuration: 3000,
    breakDuration: 3000,
    extendedBreakDuration: 3000,
    miniBreakAutoStartDelay: 4000,
    longBreakAutoStartDelay: 4000,
    extendedBreakAutoStartDelay: 4000,
    microbreakNotification: false,
    breakNotification: false,
    extendedBreakNotification: false
  }))
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const child = spawn(join(folder, 'Stretchly Customized.exe'), ['--remote-debugging-port=' + port], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  })
  const sockets = []
  const targets = async () => (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).filter(target => /\/(microbreak|break)\.html$/.test(target.url))
  const connect = async target => {
    const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
    sockets.push(socket)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
    let nextId = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      pending.get(message.id)?.(message)
    })
    return expression => new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Renderer query timed out')) }, 5000)
      pending.set(id, message => {
        clearTimeout(timeout)
        pending.delete(id)
        if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message)))
        else resolve(message.result.result.value)
      })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  }
  const state = '(async () => ({ data: await window.breaks.sendBreakData(), statistics: await window.breaks.statistics() }))()'
  try {
    let evaluate, first
    for (let attempt = 0; attempt < 100; attempt++) {
      await sleep(100)
      try {
        const windows = await targets()
        if (!windows.length) continue
        evaluate ??= await connect(windows[0])
        first = await evaluate(state)
        if (first.data[9] > Date.now() && await evaluate('document.querySelector("#start")?.getBoundingClientRect().height > 0')) break
      } catch {}
    }
    assert.ok(first?.data[9] > Date.now(), type + ': first preparation must appear before its deadline')
    assert.equal(first.data[1], null)
    await evaluate('window.breaks.postponeBreak()')
    await sleep(800)
    assert.equal((await targets()).length, 0, 'Postpone hides the reminder')
    let returned
    for (let attempt = 0; attempt < 70; attempt++) {
      await sleep(100)
      const windows = await targets()
      if (windows.length) {
        returned = await connect(windows[0])
        if ((await returned(state)).data[9] > Date.now()) break
      }
    }
    assert.ok(returned, type + ': postponed reminder returns')
    const waiting = await returned(state)
    assert.equal(waiting.data[1], null)
    assert.ok(waiting.data[9] > Date.now(), 'Returned reminders re-arm auto-start')
    assert.equal(waiting.statistics.current.postpones, 1)
    assert.equal(await returned('document.querySelector(".postpone-count").textContent'), '+1')
    assert.equal(await returned('document.querySelectorAll(".break-statistics-table tbody tr").length'), 4)
    assert.equal(await returned('document.querySelectorAll("#start-hint,.break-lifetime,.break-statistics-caption,.break-statistics-heading").length'), 0)
    let running
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(100)
      running = await returned(state)
      if (running.data[1] !== null) break
    }
    assert.ok(running.data[1] >= waiting.data[9], 'A returned reminder auto-starts without clicking Start')
    let saved, period
    for (let attempt = 0; attempt < 70; attempt++) {
      await sleep(100)
      saved = JSON.parse(readFileSync(statisticsPath, 'utf8'))
      period = Object.values(saved.days).find(day => day.breaks === 1)
      if (period) break
    }
    assert.equal(period.breaks, 1)
    assert.equal(period.withoutDelay, 1)
    assert.ok(period.breakMs >= 2900)
    assert.equal(saved.lifetime, undefined)
    reports.push({ type, normalFirstPostpone: true, returnedAutoStart: true, saved: period })
    console.log(type + ': recurring auto-start, +1 badge, minimal statistics and seven-day storage passed')
  } finally {
    sockets.forEach(socket => socket.close())
    child.kill()
  }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
