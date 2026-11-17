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
  // A larger break waits a fixed 20 seconds before auto-starting. Its schedule
  // interval must be longer than that wait plus the 3-second break, otherwise
  // the next scheduled break tears the preparation window down before it can
  // start. Mini breaks use a 4-second delay and can keep the short interval.
  const interval = type === 'mini' ? 8000 : 26000
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
    microbreakInterval: interval,
    microbreakDuration: 3000,
    breakDuration: 3000,
    extendedBreakDuration: 3000,
    miniBreakAutoStartDelay: 4000,
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
  const sessions = new Map()
  const targets = async () => (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).filter(target => /\/(microbreak|break)\.html$/.test(target.url))

  // Break windows are destroyed and recreated on Postpone and auto-start. A
  // debugger socket bound to a dead renderer never answers Runtime.evaluate,
  // so every query must resolve a live target and re-open the session when the
  // previous one closes. Without this the check reports a spurious timeout.
  const open = async url => {
    if (sessions.has(url)) return sessions.get(url)
    const socket = new globalThis.WebSocket(url)
    sockets.push(socket)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let nextId = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error || message.result.exceptionDetails) entry.reject(new Error(JSON.stringify(message)))
      else entry.resolve(message.result.result.value)
    })
    socket.addEventListener('close', () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('break renderer closed'))
      }
      pending.clear()
      sessions.delete(url)
    })
    const evaluate = expression => new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Renderer query timed out'))
      }, 8000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    const session = { url, socket, evaluate }
    sessions.set(url, session)
    return session
  }
  const invalidate = url => {
    const session = sessions.get(url)
    if (!session) return
    try { session.socket.close() } catch {}
    sessions.delete(url)
  }
  let lastUrl = null
  const query = async (expression, { attempts = 12 } = {}) => {
    let lastError = new Error('Renderer query timed out')
    for (let attempt = 0; attempt < attempts; attempt++) {
      let pages = []
      try { pages = await targets() } catch {}
      if (!pages.length) {
        await sleep(150)
        continue
      }
      const preferred = pages.find(page => page.webSocketDebuggerUrl === lastUrl) ??
        pages[attempt % pages.length]
      const url = preferred.webSocketDebuggerUrl
      try {
        const session = await open(url)
        const value = await session.evaluate(expression)
        lastUrl = url
        return value
      } catch (error) {
        lastError = error
        invalidate(url)
        if (lastUrl === url) lastUrl = null
        await sleep(150)
      }
    }
    throw lastError
  }
  const state = '(async () => ({ data: await window.breaks.sendBreakData(), statistics: await window.breaks.statistics() }))()'
  try {
    let first
    for (let attempt = 0; attempt < 350; attempt++) {
      await sleep(100)
      try {
        const windows = await targets()
        if (!windows.length) continue
        first = await query(state)
        if (first.data[9] > Date.now() && await query('document.querySelector("#start")?.getBoundingClientRect().height > 0')) break
      } catch {}
    }
    assert.ok(first?.data[9] > Date.now(), type + ': first preparation must appear before its auto-start deadline')
    assert.equal(first.data[1], null)
    let waiting = first
    if (type === 'mini') {
      await query('window.breaks.postponeBreak()')
      await sleep(800)
      assert.equal((await targets()).length, 0, 'Postpone hides the reminder')
      for (let attempt = 0; attempt < 70; attempt++) {
        await sleep(100)
        const windows = await targets()
        if (!windows.length) continue
        try {
          waiting = await query(state)
          if (waiting.data[9] > Date.now()) break
        } catch {}
      }
      assert.equal(waiting.statistics.current.postpones, 1)
      assert.equal(await query('document.querySelector(".postpone-count").textContent'), '+1')
    } else {
      assert.ok(first.data[9] - Date.now() > 18000, 'The larger-break wait is about 20 seconds')
      assert.equal(waiting.statistics.current.postpones, 0)
    }
    assert.equal(waiting.data[1], null)
    assert.ok(waiting.data[9] > Date.now())
    assert.equal(await query('document.querySelectorAll(".break-statistics-table tbody tr").length'), 4)
    assert.equal(await query('document.querySelectorAll("#start-hint,.break-lifetime,.break-statistics-caption,.break-statistics-heading").length'), 0)
    let running
    for (let attempt = 0; attempt < 260; attempt++) {
      await sleep(100)
      try {
        running = await query(state)
        if (running.data[1] !== null) break
      } catch {}
    }
    assert.ok(running?.data[1] >= waiting.data[9], 'A reminder auto-starts without clicking Start')
    assert.ok(running?.data[1] >= waiting.data[9], 'A reminder auto-starts without clicking Start')
    let saved, period
    for (let attempt = 0; attempt < 100; attempt++) {
      await sleep(100)
      saved = JSON.parse(readFileSync(statisticsPath, 'utf8'))
      period = Object.values(saved.days).find(day => day.breaks === 1)
      if (period) break
    }
    assert.equal(period.breaks, 1)
    assert.equal(period.withoutDelay, 1)
    assert.ok(period.breakMs >= 2900)
    assert.equal(saved.lifetime, undefined)
    assert.ok(Number.isFinite(saved.debt.amount))
    reports.push({ type, postponed: type === 'mini', automaticStart: true, saved: period })
    console.log(type + ': auto-start, minimal statistics and persisted debt passed')
  } finally {
    sockets.forEach(socket => { try { socket.close() } catch {} })
    child.kill()
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('exit', resolve)
    })
  }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
