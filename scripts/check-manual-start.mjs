import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

const folder = resolve(process.argv[2] || 'dist/win-unpacked')
const strictQuitCheck = process.argv.includes('--strict-quit')
const autoStartCheck = process.argv.includes('--auto-start')
const output = resolve(strictQuitCheck ? '.scratch/strict-quit-check' : autoStartCheck ? '.scratch/auto-start-check' : '.scratch/manual-start-check')
const executable = join(folder, 'Stretchly Customized.exe')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const run = promisify(execFile)
const reports = []
const reservePort = async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

const pressShortcut = async () => {
  const command = 'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class BreakShortcutProbe { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }\'; try { [BreakShortcutProbe]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [BreakShortcutProbe]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [BreakShortcutProbe]::keybd_event(0x87,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80 } finally { [BreakShortcutProbe]::keybd_event(0x87,0,2,[UIntPtr]::Zero); [BreakShortcutProbe]::keybd_event(0x12,0,2,[UIntPtr]::Zero); [BreakShortcutProbe]::keybd_event(0x11,0,2,[UIntPtr]::Zero) }'
  await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true })
}
const connect = async target => {
  const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  let next = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return {
    socket,
    send,
    evaluate: async expression => {
      const result = await send('Runtime.evaluate', { expression: '(async () => (' + expression + '))()', returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
  }
}
for (const type of ['mini', 'long', 'extended']) {
  const profile = join(output, type)
  const data = join(profile, 'Data')
  mkdirSync(data, { recursive: true })
  const config = {
    isFirstRun: false,
    checkNewVersion: false,
    notifyNewVersion: false,
    language: 'en',
    manualBreakStart: true,
    endBreakShortcut: 'Ctrl+Alt+F24',
    miniBreakAutoStartDelay: autoStartCheck ? 8000 : 0,
    longBreakAutoStartDelay: autoStartCheck ? 8000 : 0,
    extendedBreakAutoStartDelay: autoStartCheck ? 8000 : 0,
    compactBreaks: true,
    breakClickThrough: true,
    allScreens: true,
    naturalBreaks: false,
    monitorDnd: false,
    silentNotifications: true,
    microbreakNotification: false,
    breakNotification: false,
    extendedBreakNotification: false,
    microbreak: type === 'mini',
    break: type !== 'mini',
    extendedBreak: type === 'extended',
    extendedBreakInterval: 1,
    breakInterval: 0,
    microbreakInterval: type === 'extended' ? 1500 : 300000,
    microbreakDuration: strictQuitCheck ? 30000 : 3000,
    breakDuration: strictQuitCheck ? 30000 : 3000,
    extendedBreakDuration: strictQuitCheck ? 30000 : 3000,
    microbreakPostponableDurationPercent: 100,
    breakPostponableDurationPercent: 100,
    extendedBreakPostponableDurationPercent: 100,
    microbreakStrictMode: true,
    breakStrictMode: true,
    extendedBreakStrictMode: true
  }
  writeFileSync(join(data, 'config.json'), JSON.stringify(config))
  const port = await reservePort()
  const mainPort = strictQuitCheck ? await reservePort() : null
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  const child = spawn(executable, ['--remote-debugging-port=' + port, ...(mainPort ? ['--inspect=127.0.0.1:' + mainPort] : [])], { windowsHide: true, env, stdio: 'ignore' })
  const connections = []
  try {
    const targets = async () => (await fetch('http://127.0.0.1:' + port + '/json')).json()
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(100)
      try { if ((await targets()).length) break } catch {}
    }
    if (type !== 'extended') {
      const forwarded = spawn(executable, [type], { windowsHide: true, env, stdio: 'ignore' })
      await new Promise(resolve => forwarded.on('exit', resolve))
    }
    let breaks
    for (let attempt = 0; attempt < 100; attempt++) {
      await sleep(100)
      breaks = (await targets()).filter(target => target.url.endsWith(type === 'mini' ? '/microbreak.html' : '/break.html'))
      if (breaks.length >= 2) break
    }
    assert.ok(breaks.length >= 2, type + ': reminders should open on both monitors')
    for (const target of breaks) connections.push(await connect(target))
    const stateExpression = `JSON.stringify({
      started: (await window.breaks.sendBreakData())[1],
      deadline: (await window.breaks.sendBreakData())[9],
      startVisible: getComputedStyle(document.querySelector('#start')).display !== 'none',
      startText: document.querySelector('#start').textContent,
      hint: document.querySelector('#start-hint').textContent,
      progress: document.querySelector('#progress').value,
      closeVisible: getComputedStyle(document.querySelector('#close')).display !== 'none',
      postponeVisible: getComputedStyle(document.querySelector('#postpone')).display !== 'none',
      advice: document.querySelector('.microbreak-idea, .break-idea').textContent + (document.querySelector('.break-text')?.textContent || ''),
      compact: document.body.classList.contains('compact-break'),
      viewport: { width: innerWidth, height: innerHeight }
    })`
    if (autoStartCheck) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const states = await Promise.all(connections.map(connection => connection.evaluate(stateExpression).then(JSON.parse)))
        if (states.every(state => state.deadline !== null && /^Auto-starts/.test(state.hint))) break
        await sleep(100)
      }
    } else await sleep(3500)
    const waiting = await Promise.all(connections.map(connection => connection.evaluate(stateExpression).then(JSON.parse)))
    for (const state of waiting) {
      assert.equal(state.started, null)
      assert.equal(state.startVisible, true)
      assert.equal(state.startText, 'Start break')
      if (autoStartCheck) assert.match(state.hint, /^Auto-starts in \d+ s$/)
      else assert.equal(state.hint, 'Ready when you are')
      assert.equal(state.progress, 10000)
      assert.equal(state.closeVisible, false)
      assert.equal(state.postponeVisible, true)
      assert.equal(state.compact, true)
      assert.ok(Math.abs(state.viewport.width - 860) <= 4, JSON.stringify(state.viewport))
      assert.equal(state.viewport.height, 720)
      assert.equal(state.advice, waiting[0].advice)
    }
    if (reports.length) assert.deepEqual(waiting.map(state => state.viewport), reports[0].waiting.map(state => state.viewport), 'All break types must use the same fixed size')
    const image = await connections[0].send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(profile, 'waiting.png'), Buffer.from(image.data, 'base64'))
    if (autoStartCheck) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (JSON.parse(await connections[0].evaluate(stateExpression)).started !== null) break
        await sleep(100)
      }
    } else if (type === 'mini') await connections[connections.length - 1].evaluate("document.querySelector('#start').click()")
    else await pressShortcut()
    await sleep(200)
    const running = await Promise.all(connections.map(connection => connection.evaluate(stateExpression).then(JSON.parse)))
    for (const state of running) {
      assert.ok(state.started > 0)
      assert.equal(state.started, running[0].started)
      assert.equal(state.startVisible, false)
      assert.deepEqual(state.viewport, waiting[running.indexOf(state)].viewport)
      assert.ok(state.progress < 10000 && state.progress > 0)
    }
    await connections[0].evaluate('window.breaks.startBreak()')
    await sleep(100)
    const repeat = JSON.parse(await connections[0].evaluate(stateExpression))
    assert.equal(repeat.started, running[0].started)
    assert.ok(repeat.progress <= running[0].progress)
    if (strictQuitCheck) {
      const mainTarget = (await (await fetch('http://127.0.0.1:' + mainPort + '/json')).json())[0]
      const inspector = await connect(mainTarget)
      connections.push(inspector)
      await inspector.evaluate("(() => { setTimeout(() => process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.quit(), 50); return true })()")
      inspector.socket.close()
      await Promise.race([
        new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)),
        sleep(4000).then(() => { throw new Error('Strict mode prevented intentional app Quit') })
      ])
      assert.equal(child.exitCode, 0)
    } else if (autoStartCheck) {
      await sleep(2100)
      assert.ok((await targets()).filter(target => target.url.endsWith('/microbreak.html') || target.url.endsWith('/break.html')).length >= 2, 'Waiting must not consume the full break duration')
      await sleep(1000)
    } else await pressShortcut()
    await sleep(200)
    if (!strictQuitCheck) assert.equal((await targets()).filter(target => target.url.endsWith('/microbreak.html') || target.url.endsWith('/break.html')).length, 0)
    const saved = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
    for (const key of Object.keys(config)) assert.deepEqual(saved[key], config[key], key)
    reports.push({ type, monitors: waiting.length, waiting, running, trigger: autoStartCheck ? 'auto-start deadline' : type === 'mini' ? 'button' : 'native global shortcut', repeatedStartIgnored: true, sameShortcutPostponesAfterStart: !autoStartCheck && !strictQuitCheck, intentionalStrictQuit: strictQuitCheck, fullDurationAfterAutoStart: autoStartCheck })
    console.log(type + ': ' + (strictQuitCheck ? 'intentional strict-mode Quit' : autoStartCheck ? 'auto-start and full duration' : 'wait, mirrored start, repeated Start, and same-key Postpone') + ' passed')
  } finally {
    for (const connection of connections) connection.socket.close()
    child.kill()
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve))
    await sleep(200)
  }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
console.log('Packaged manual-start checks passed for all break types.')
