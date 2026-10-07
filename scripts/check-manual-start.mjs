import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

const folder = resolve(process.argv[2] || 'dist/win-unpacked')
const output = resolve('.scratch/manual-start-check')
const executable = join(folder, 'Stretchly Customized.exe')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const run = promisify(execFile)
const reports = []

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
    startBreakShortcut: 'Ctrl+Alt+F24',
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
    microbreakDuration: 3000,
    breakDuration: 3000,
    extendedBreakDuration: 3000,
    microbreakStrictMode: true,
    breakStrictMode: true,
    extendedBreakStrictMode: true
  }
  writeFileSync(join(data, 'config.json'), JSON.stringify(config))
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profile }
  const child = spawn(executable, ['--remote-debugging-port=' + port], { windowsHide: true, env, stdio: 'ignore' })
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
      startVisible: getComputedStyle(document.querySelector('#start')).display !== 'none',
      startText: document.querySelector('#start').textContent,
      hint: document.querySelector('#start-hint').textContent,
      progress: document.querySelector('#progress').value,
      closeVisible: getComputedStyle(document.querySelector('#close')).display !== 'none',
      postponeVisible: getComputedStyle(document.querySelector('#postpone')).display !== 'none',
      advice: document.querySelector('.microbreak-idea, .break-idea').textContent + (document.querySelector('.break-text')?.textContent || ''),
      compact: document.body.classList.contains('compact-break')
    })`
    await sleep(3500)
    const waiting = await Promise.all(connections.map(connection => connection.evaluate(stateExpression).then(JSON.parse)))
    for (const state of waiting) {
      assert.equal(state.started, null)
      assert.equal(state.startVisible, true)
      assert.equal(state.startText, 'Start break')
      assert.equal(state.hint, 'Ready when you are')
      assert.equal(state.progress, 10000)
      assert.equal(state.closeVisible, false)
      assert.equal(state.postponeVisible, true)
      assert.equal(state.compact, true)
      assert.equal(state.advice, waiting[0].advice)
    }
    const image = await connections[0].send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(profile, 'waiting.png'), Buffer.from(image.data, 'base64'))
    if (type === 'mini') await connections[connections.length - 1].evaluate("document.querySelector('#start').click()")
    else await pressShortcut()
    await sleep(200)
    const running = await Promise.all(connections.map(connection => connection.evaluate(stateExpression).then(JSON.parse)))
    for (const state of running) {
      assert.ok(state.started > 0)
      assert.equal(state.started, running[0].started)
      assert.equal(state.startVisible, false)
      assert.ok(state.progress < 10000 && state.progress > 0)
    }
    await connections[0].evaluate('window.breaks.startBreak()')
    await sleep(100)
    const repeat = JSON.parse(await connections[0].evaluate(stateExpression))
    assert.equal(repeat.started, running[0].started)
    assert.ok(repeat.progress <= running[0].progress)
    await sleep(3100)
    assert.equal((await targets()).filter(target => target.url.endsWith('/microbreak.html') || target.url.endsWith('/break.html')).length, 0)
    const saved = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
    for (const key of Object.keys(config)) assert.deepEqual(saved[key], config[key], key)
    reports.push({ type, monitors: connections.length, waiting, running, trigger: type === 'mini' ? 'button' : 'native global shortcut', repeatedStartIgnored: true, completedNormally: true })
    console.log(type + ': wait, mirrored start, repeated Start, and completion passed')
  } finally {
    for (const connection of connections) connection.socket.close()
    child.kill()
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve))
    await sleep(200)
  }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
console.log('Packaged manual-start checks passed for all break types.')
