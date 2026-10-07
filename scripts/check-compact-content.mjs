import { app, BrowserWindow, ipcMain, screen } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] || '.')
const directory = join(root, 'app')
const output = resolve('.scratch/compact-content-check')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
const { getCompactBreakBounds } = await import(pathToFileURL(join(directory, 'utils/breakDisplaySettings.js')).href)
const { configureBreakWindowPresentation } = await import(pathToFileURL(join(directory, 'utils/breakWindowPresentation.js')).href)
const translations = JSON.parse(readFileSync(join(directory, 'locales/en.json'), 'utf8'))
let type
const reports = []
app.on('window-all-closed', event => event.preventDefault())
app.whenReady().then(async () => {
  ipcMain.handle('settings-get', (_event, key) => ({
    compactBreaks: true,
    breakClickThrough: false,
    mainColor: '#478484',
    language: 'en',
    endBreakShortcut: 'Ctrl+X',
    currentTimeInBreaks: true
  })[key])
  ipcMain.handle('i18next-translate', (_event, key) => key.split('.').reduce((value, part) => value?.[part], translations) || key)
  ipcMain.handle('i18next-dir', () => 'ltr')
  ipcMain.handle('resolve-local-image', () => null)
  ipcMain.on('set-break-click-through', () => {})
  for (const bridge of ['mini', 'long']) {
    ipcMain.handle('send-' + bridge + '-break-data', () => [
      type === 'mini' ? 'Advice' : ['Title', 'Advice'], null, 20000, true, true, 30, '#478484', 0, false, null
    ])
  }
  try {
    for (type of ['mini', 'long']) {
      const samples = []
      for (const file of readdirSync(join(directory, 'locales')).filter(file => file.endsWith('.json'))) {
        const locale = JSON.parse(readFileSync(join(directory, 'locales', file), 'utf8'))
        const ideas = locale[type === 'mini' ? 'miniBreakIdeas' : 'longBreakIdeas'] || {}
        for (const [key, idea] of Object.entries(ideas)) {
          samples.push({
            locale: file, key, title: type === 'mini' ? idea.text : idea.title, text: type === 'mini' ? '' : idea.text
          })
        }
      }
      const window = new BrowserWindow({
        ...getCompactBreakBounds(screen.getPrimaryDisplay()),
        frame: false,
        show: false,
        transparent: true,
        webPreferences: { preload: join(directory, type === 'mini' ? 'microbreak-preload.mjs' : 'break-preload.mjs'), sandbox: false, backgroundThrottling: false }
      })
      configureBreakWindowPresentation(window, { get: key => key === 'compactBreaks' }, screen.getPrimaryDisplay())
      await window.loadFile(join(directory, type === 'mini' ? 'microbreak.html' : 'break.html'))
      await new Promise(resolve => setTimeout(resolve, 700))
      const result = await window.webContents.executeJavaScript(`(async () => {
        const samples = ${JSON.stringify(samples)}
        const content = document.querySelector('.breaks')
        const heading = document.querySelector('.microbreak-idea, .break-idea')
        const text = document.querySelector('.break-text')
        let worst = null
        const failures = []
        for (const sample of samples) {
          heading.innerHTML = sample.title || ''
          if (text) text.innerHTML = sample.text || ''
          await document.fonts.ready
          const height = content.scrollHeight
          if (!worst || height > worst.height) worst = { ...sample, height }
          if (height > content.clientHeight + 1) failures.push({ locale: sample.locale, key: sample.key, height, available: content.clientHeight })
        }
        return { samples: samples.length, worst, failures, viewport: { width: innerWidth, height: innerHeight } }
      })()`)
      reports.push({ type, ...result })
      console.log(type + ': checked ' + result.samples + ' translated bundled ideas; overflow count=' + result.failures.length)
      window.destroy()
    }
    writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
    assert.equal(reports.flatMap(report => report.failures).length, 0, 'All bundled advice should fit the fixed Compact window')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
