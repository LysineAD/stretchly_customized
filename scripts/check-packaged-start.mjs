import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'

const folder = resolve(process.argv[2] || 'dist/win-unpacked')
const output = resolve('.scratch/start-check')
const data = join(output, 'Data')
mkdirSync(data, { recursive: true })
writeFileSync(join(data, 'config.json'), JSON.stringify({ isFirstRun: false, checkNewVersion: false, notifyNewVersion: false }))
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const child = spawn(join(folder, 'Stretchly Customized.exe'), ['preferences', '--remote-debugging-port=' + port], {
  windowsHide: true,
  env: { ...process.env, PORTABLE_EXECUTABLE_DIR: output },
  stdio: 'ignore'
})
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let socket
try {
  let target
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(250)
    if (attempt === 5) spawn(join(folder, 'Stretchly Customized.exe'), ['preferences'], { windowsHide: true, env: { ...process.env, PORTABLE_EXECUTABLE_DIR: output }, stdio: 'ignore' })
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json()
      target = targets.find(target => target.url.endsWith('/preferences.html'))
      if (target) break
    } catch {}
  }
  assert.ok(target, 'Packaged preferences window should start in the isolated profile')
  socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  let nextId = 0
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
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate('document.querySelector("label[for=compact]")?.textContent === "Compact"')) break
    await sleep(250)
  }
  writeFileSync(join(output, 'startup-state.json'), await evaluate('JSON.stringify({ ready: document.readyState, settings: typeof window.settings, runtime: typeof window.runtime, onload: typeof window.onload, labels: [...document.querySelectorAll("label[data-i18next]")].slice(0, 8).map(label => label.textContent) })'))
  const controls = await evaluate(`JSON.stringify({
    sizes: [...document.querySelectorAll('input[name="breakDisplayMode"]')].map(input => ({ value: input.value, label: document.querySelector('label[for="' + input.id + '"]').textContent })),
    clickThrough: document.querySelector('label[for="breakClickThrough"]').textContent
  })`)
  const parsed = JSON.parse(controls)
  assert.deepEqual(parsed.sizes.map(input => input.value), ['window', 'fullscreen', 'compact'])
  assert.equal(parsed.sizes[2].label, 'Compact')
  assert.equal(parsed.clickThrough, 'Allow clicks through break windows')
  const before = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
  await evaluate('document.querySelector("#compact").click(); document.querySelector("#breakClickThrough").click()')
  await sleep(500)
  const after = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
  assert.equal(after.compactBreaks, true)
  assert.equal(after.fullscreen, false)
  assert.equal(after.breakClickThrough, true)
  for (const key of Object.keys(before)) {
    if (!['compactBreaks', 'fullscreen', 'breakClickThrough'].includes(key)) assert.deepEqual(after[key], before[key], key)
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(output, 'preferences.png'), Buffer.from(screenshot.data, 'base64'))
  writeFileSync(join(output, 'results.json'), JSON.stringify({ app: folder, controls: parsed, displaySettingsSaved: true, otherSettingsUnchanged: true }, null, 2))
  console.log('Packaged executable startup and both Preferences controls passed.')
} finally {
  socket?.close()
  child.kill()
}
