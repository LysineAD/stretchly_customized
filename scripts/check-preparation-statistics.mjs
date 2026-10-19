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
  const emptyHistory = { version: 1, days: {}, lifetime: {} }
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
        if (await returned('document.querySelector("#start")?.getBoundingClientRect().height > 0')) break
      }
    }
    assert.ok(returned, type + ': postponed reminder returns')
    await sleep(5000)
    const waiting = await returned(state)
    assert.equal(waiting.data[1], null, 'Returned reminders must never auto-start')
    assert.equal(waiting.data[9], null, 'Returned reminders have no auto-start deadline')
    assert.equal(waiting.statistics.current.extraPostpones, 0)
    assert.equal(waiting.statistics.today.skipped + waiting.statistics.today.unfinished, 0)
    await returned('document.querySelector("#start").click()')
    let saved
    for (let attempt = 0; attempt < 70; attempt++) {
      await sleep(100)
      saved = JSON.parse(readFileSync(statisticsPath, 'utf8'))
      if (saved.lifetime.completed === 1) break
    }
    assert.equal(saved.lifetime.completed, 1)
    assert.equal(saved.lifetime.withoutDelay, 1)
    assert.equal(saved.lifetime.extraPostpones, 0)
    assert.equal(saved.lifetime.skipped + saved.lifetime.unfinished, 0)
    assert.ok(saved.lifetime.breakMs[type] >= 2900)
    reports.push({ type, originalDeadline: first.data[9], normalFirstPostpone: true, returnedManualOnly: true, saved: saved.lifetime })
    console.log(type + ': early reminder, normal first Postpone, manual-only return and saved statistics passed')
  } finally {
    sockets.forEach(socket => socket.close())
    child.kill()
  }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
