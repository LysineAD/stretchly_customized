import { app, BrowserWindow, ipcMain, screen } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const root = resolve(process.argv[2] || '.')
const appDirectory = join(root, 'app')
const output = resolve('.scratch/display-check')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
const moduleAt = file => import(pathToFileURL(join(appDirectory, file)).href)
const { getCompactBreakBounds } = await moduleAt('utils/breakDisplaySettings.js')
const { configureBreakWindowPresentation, registerBreakWindowPresentationHandlers, updateBreakClickThrough } = await moduleAt('utils/breakWindowPresentation.js')
const { default: longIdeas } = await moduleAt('utils/defaultBreakIdeas.js')
const { default: miniIdeas } = await moduleAt('utils/defaultMicrobreakIdeas.js')
const translations = JSON.parse(readFileSync(join(appDirectory, 'locales/en.json'), 'utf8'))
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const run = promisify(execFile)
const nativeInput = process.argv.includes('--native-input')
const reports = []
const rendererErrors = []
const waiters = new Map()
let values
let idea
let actions = 0
let started
const inputStates = new Map()

app.on('window-all-closed', event => event.preventDefault())
app.whenReady().then(async () => {
  registerBreakWindowPresentationHandlers()
  ipcMain.on('set-break-click-through', (event, ignore) => { const history = inputStates.get(event.sender.id) || []; history.push(ignore); inputStates.set(event.sender.id, history) })
  ipcMain.handle('settings-get', (_event, key) => values[key])
  ipcMain.handle('i18next-translate', (_event, key) => key.split('.').reduce((value, part) => value?.[part], translations) || key)
  ipcMain.handle('i18next-dir', () => 'ltr')
  ipcMain.handle('resolve-local-image', () => null)
  for (const type of ['mini', 'long', 'extended']) {
    ipcMain.handle('send-' + type + '-break-data', () => [idea, started, 300000, true, true, 30, '#478484', 0, false])
    ipcMain.on(type + '-break-loaded', event => waiters.get(event.sender.id)?.())
    ipcMain.on('postpone-' + type + '-break', () => { actions += 1 })
  }

  const click = async (window, x, y) => {
    const bounds = window.getBounds()
    const point = screen.dipToScreenPoint({ x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) })
    const command = '& {\n' + readFileSync(resolve('scripts/check-native-click.ps1'), 'utf8') + '\n} -X ' + point.x + ' -Y ' + point.y
    await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true })
    await sleep(200)
  }

  const ignoresNativeMouse = async window => {
    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString()
    const command = 'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class WindowInputProbe { [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr Style(IntPtr handle, int index); }\'; [WindowInputProbe]::Style([IntPtr]::new(' + handle + '), -20).ToInt64()'
    const result = await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true })
    return (Number(result.stdout.trim()) & 0x20) !== 0
  }
  try {
    for (const mode of (process.argv.includes('--compact-only') ? ['compact'] : ['window', 'fullscreen', 'compact'])) {
      for (const type of ['mini', 'long', 'extended']) {
        values = {
          compactBreaks: mode === 'compact',
          breakClickThrough: true,
          mainColor: '#478484',
          language: 'en',
          endBreakShortcut: '',
          currentTimeInBreaks: false
        }
        idea = type === 'mini'
          ? [...miniIdeas].sort((a, b) => b.data.length - a.data.length)[0].data
          : [...longIdeas].sort((a, b) => b.data.join('').length - a.data.join('').length)[0].data
        started = Date.now()
        const windows = []
        for (const display of screen.getAllDisplays()) {
          const bounds = mode === 'compact'
            ? getCompactBreakBounds(display)
            : mode === 'fullscreen'
              ? display.bounds
              : {
                  x: Math.round(display.bounds.x + display.bounds.width * 0.075),
                  y: Math.round(display.bounds.y + display.bounds.height * 0.075),
                  width: Math.floor(display.bounds.width * 0.85),
                  height: Math.floor(display.bounds.height * 0.85)
                }
          const window = new BrowserWindow({
            ...bounds,
            frame: false,
            show: false,
            transparent: true,
            focusable: false,
            resizable: false,
            skipTaskbar: true,
            webPreferences: { preload: join(appDirectory, type === 'mini' ? 'microbreak-preload.mjs' : type === 'extended' ? 'extended-break-preload.mjs' : 'break-preload.mjs'), sandbox: false }
          })
          configureBreakWindowPresentation(window, { get: key => values[key] }, display)
          window.webContents.on('console-message', (_event, details) => {
            if (details.level === 'error') rendererErrors.push(details.message)
          })
          const loaded = new Promise(resolve => waiters.set(window.webContents.id, resolve))
          await window.loadFile(join(appDirectory, type === 'mini' ? 'microbreak.html' : 'break.html'))
          await Promise.race([loaded, sleep(10000).then(() => { throw new Error('Renderer did not initialize: ' + mode + '/' + type) })])
          await sleep(300)
          const layout = await window.webContents.executeJavaScript(`(() => {
          const idea = document.querySelector('.microbreak-idea, .break-idea')
          const text = document.querySelector('.break-text')
          const content = document.querySelector('.breaks')
          const style = getComputedStyle(idea)
          return {
            ideaFont: style.fontSize,
            ideaLineHeight: style.lineHeight,
            textFont: text ? getComputedStyle(text).fontSize : null,
            textLineHeight: text ? getComputedStyle(text).lineHeight : null,
            textMargin: text ? getComputedStyle(text).marginTop : null,
            scrollHeight: content.scrollHeight,
            clientHeight: content.clientHeight,
            visiblePostpone: getComputedStyle(document.querySelector('#postpone')).display !== 'none',
            advice: idea.textContent + (text ? text.textContent : '')
          }
        })()`)
          assert.equal(layout.ideaFont, type === 'mini' ? '30px' : '36px')
          assert.equal(layout.ideaLineHeight, type === 'mini' ? '46px' : '49px')
          if (type !== 'mini') {
            assert.equal(layout.textFont, '24px')
            assert.equal(layout.textLineHeight, '33px')
            assert.equal(layout.textMargin, '60px')
          }
          assert.ok(layout.visiblePostpone)
          assert.ok(layout.advice.length > 0)
          if (mode === 'compact') {
            assert.ok(layout.scrollHeight <= layout.clientHeight + 1, 'Bundled advice should fit: ' + JSON.stringify(layout))
            const expected = getCompactBreakBounds(display, layout.scrollHeight, window.getBounds().width)
            for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(window.getBounds()[key] - expected[key]) <= 1, 'Placement should match within native DPI rounding: ' + key)
            const image = await window.webContents.capturePage()
            writeFileSync(join(output, 'compact-' + type + '-' + display.id + '.png'), image.toPNG())
          }
          reports.push({ mode, type, display: display.id, bounds: window.getBounds(), layout })
          windows.push(window)
        }
        const overlay = windows[0]
        if (nativeInput) {
          const underlying = new BrowserWindow({ ...overlay.getBounds(), frame: false, show: false, focusable: false, skipTaskbar: true, webPreferences: { contextIsolation: true } })
          await underlying.loadURL('data:text/html,<body style="margin:0;background:%23222;color:white">Input test</body>')
          await underlying.webContents.executeJavaScript('window.clicks = 0; document.addEventListener("click", () => { window.clicks += 1 })')
          underlying.setAlwaysOnTop(true, 'pop-up-menu')
          underlying.showInactive()
          underlying.moveTop()
          overlay.setAlwaysOnTop(true, 'pop-up-menu')
          overlay.showInactive()
          overlay.moveTop()
          await sleep(200)
          await click(overlay, 8, 8)
          assert.equal(await underlying.webContents.executeJavaScript('window.clicks'), 1, 'Click should pass through: ' + mode + '/' + type)
          const button = await overlay.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#postpone').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
          await overlay.webContents.executeJavaScript('window.pointerMoves = []; document.addEventListener("mousemove", event => { window.pointerMoves.push({ x: event.clientX, y: event.clientY }) })')
          const before = actions
          await click(overlay, button.x, button.y)
          if (actions !== before + 1) {
            writeFileSync(join(output, 'input-failure.json'), JSON.stringify({ bounds: overlay.getBounds(), display: screen.getAllDisplays()[0], button, ignore: inputStates.get(overlay.webContents.id), underneath: await underlying.webContents.executeJavaScript('window.clicks'), pointer: await overlay.webContents.executeJavaScript('window.pointerMoves'), rect: await overlay.webContents.executeJavaScript('JSON.stringify(document.querySelector("#postpone").getBoundingClientRect())') }, null, 2))
            writeFileSync(join(output, 'input-failure.png'), (await overlay.webContents.capturePage()).toPNG())
          }
          assert.equal(actions, before + 1, 'Visible control should receive the click: ' + mode + '/' + type)
          assert.equal(await underlying.webContents.executeJavaScript('window.clicks'), 1, 'Control clicks should not pass through')
          values.breakClickThrough = false
          updateBreakClickThrough(windows, false)
          await sleep(100)
          await click(overlay, 8, 8)
          assert.equal(await underlying.webContents.executeJavaScript('window.clicks'), 1, 'Unchecked mode should receive background input')
          reports.at(-1).nativeInput = 'background passes, control receives, unchecked blocks'
          windows.forEach(window => window.destroy())
          underlying.destroy()
        } else {
          await overlay.webContents.executeJavaScript('document.dispatchEvent(new MouseEvent("mousemove", { clientX: 8, clientY: 8 }))')
          await sleep(100)
          assert.ok(await ignoresNativeMouse(overlay), 'Background should have native mouse pass-through')
          await overlay.webContents.executeJavaScript(`(() => {
            const button = document.querySelector('#postpone')
            const bounds = button.getBoundingClientRect()
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }))
          })()`)
          await sleep(100)
          assert.equal(await ignoresNativeMouse(overlay), false, 'Visible controls should receive native input')
          const before = actions
          await overlay.webContents.executeJavaScript('document.querySelector("#postpone").click()')
          await sleep(50)
          assert.equal(actions, before + 1)
          values.breakClickThrough = false
          updateBreakClickThrough(windows, false)
          await overlay.webContents.executeJavaScript('document.dispatchEvent(new MouseEvent("mousemove", { clientX: 8, clientY: 8 }))')
          await sleep(100)
          assert.equal(await ignoresNativeMouse(overlay), false, 'Unchecking should disable native pass-through')
          reports.at(-1).nativeInput = 'Native transparency styles and hovered control actions verified'
          windows.forEach(window => window.destroy())
        }
      }
    }
    assert.deepEqual(rendererErrors, [])
    writeFileSync(join(output, 'results.json'), JSON.stringify({ electron: process.versions.electron, reports }, null, 2))
    console.log('Display check passed: ' + reports.length + ' rendered windows; native mouse styles and controls checked for every rendered display mode and break kind.')
    app.exit(0)
  } catch (error) {
    writeFileSync(join(output, 'failure.txt'), error.stack)
    console.error(error)
    app.exit(1)
  }
})
