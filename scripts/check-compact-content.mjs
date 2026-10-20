import { app, BrowserWindow, ipcMain, screen } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import statisticsFixture from './statistics-fixture.mjs'

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
  ipcMain.handle('break-statistics-data', () => statisticsFixture(type === 'mini' ? 'Mini break' : 'Long break'))
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
        const advice = document.querySelector('.break-advice')
        const fixed = [...document.querySelectorAll('.break-type, .break-statistics-table, .break-controls')]
        const clipped = () => fixed.some(element => {
          const rect = element.getBoundingClientRect()
          return rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight + 1 || rect.right > innerWidth + 1
        })
        let worst = null
        const failures = []
        for (const sample of samples) {
          heading.innerHTML = sample.title || ''
          if (text) text.innerHTML = sample.text || ''
          await document.fonts.ready
          const height = content.scrollHeight
          if (!worst || advice.scrollHeight > worst.adviceHeight) worst = { ...sample, adviceHeight: advice.scrollHeight }
          if (height > content.clientHeight + 1 || clipped()) failures.push({ locale: sample.locale, key: sample.key, height, available: content.clientHeight })
        }
        if (getComputedStyle(heading).fontSize !== ${JSON.stringify(type === 'mini' ? '30px' : '36px')}) throw new Error('Advice font changed')
        if (text && getComputedStyle(text).fontSize !== '24px') throw new Error('Advice text font changed')
        document.querySelector('.break-clock').remove()
        if (clipped()) failures.push({ clock: false })
        heading.innerHTML = worst.title || ''
        if (text) text.innerHTML = worst.text || ''
        return { samples: samples.length, worst, failures, statisticsRows: document.querySelectorAll('.break-statistics-table tbody tr').length, viewport: { width: innerWidth, height: innerHeight } }
      })()`)
      reports.push({ type, ...result })
      console.log(type + ': checked ' + result.samples + ' translated bundled ideas; overflow count=' + result.failures.length)
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      writeFileSync(join(output, type + '.png'), (await window.webContents.capturePage()).toPNG())
      window.destroy()
    }
    writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2))
    assert.equal(reports.flatMap(report => report.failures).length, 0, 'Advice may scroll; all statistics and controls must fit the fixed Compact window')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
