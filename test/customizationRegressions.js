import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { getCompactBreakBounds } from '../app/utils/breakDisplaySettings.js'

const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8')
const menuSource = main.slice(main.indexOf('function getTrayMenuTemplate ()'), main.indexOf('function updateToolTip ()'))
const quitSource = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('async function initialize'))
const contextFor = reference => ({
  settings: { get: key => ['microbreakStrictMode', 'breakStrictMode', 'extendedBreakStrictMode', 'microbreak', 'break', 'extendedBreak'].includes(key) },
  breakPlanner: { scheduler: { reference }, dndManager: {}, appExclusionsManager: {} },
  global: {},
  i18next: { t: key => key },
  StatusMessages: class { get trayMessage () { return '' } },
  humanizeDuration: () => '',
  resetBreaks: vi.fn(),
  skipCurrentBreak: vi.fn(),
  finishMicrobreak: vi.fn(),
  finishBreak: vi.fn(),
  finishExtendedBreak: vi.fn(),
  breakStartController: { clear: vi.fn() }
})

describe('customized usability regressions', () => {
  it('retains every schedule control when arranging cards', () => {
    const document = new JSDOM(readFileSync(new URL('../app/preferences.html', import.meta.url), 'utf8')).window.document
    const identifiers = ['enableMiniBreaks', 'enableLongBreaks', 'enableExtendedBreaks']
    for (const type of ['mini', 'long', 'extended']) {
      identifiers.push(type + 'BreakFor', type + 'BreakEvery', 'showNotificationBefore' + type[0].toUpperCase() + type.slice(1) + 'Break')
    }
    identifiers.push('enablePostponeMini', 'enablePostponeLong', 'enablePostponeExtended', 'enableStrictMini', 'enableStrictLong', 'enableStrictExtended')
    for (const id of identifiers) expect(document.querySelectorAll('#' + id)).toHaveLength(1)
    expect(document.querySelectorAll('.schedule > .preference-card')).toHaveLength(4)
  })

  it('keeps Compact bounds identical regardless of content or phase', () => {
    const display = { bounds: { x: 0, y: 0, width: 2048, height: 1152 }, workArea: { x: 0, y: 0, width: 2048, height: 1112 } }
    expect(getCompactBreakBounds(display, 250)).toEqual(getCompactBreakBounds(display, 900))
  })

  it.each(['finishMicrobreak', 'finishBreak', 'finishExtendedBreak'])('keeps tray controls available during strict %s', reference => {
    const context = contextFor(reference)
    const menu = runInNewContext(menuSource + '\ngetTrayMenuTemplate()', context)
    expect(menu.some(item => item.label === 'main.preferences')).toBe(true)
    expect(menu.some(item => item.label === 'main.quitStretchly')).toBe(true)
    expect(menu.some(item => item.label === 'main.skipCurrentBreak')).toBe(true)
  })

  it.each(['microbreakWinLocal', 'breakWinLocal'])('allows %s to close on intentional Quit while retaining its strict close guard', name => {
    const from = main.indexOf(name + ".on('close'")
    const to = main.indexOf('\n      })', from) + '\n      })'.length
    let close
    const context = {
      isQuitting: false,
      [name]: { on: (_event, callback) => { close = callback } },
      breakPlanner: { scheduler: { timeLeft: 20000 } },
      settings: { get: () => true },
      settingPrefix: 'break',
      log: { info: vi.fn() }
    }
    runInNewContext(main.slice(from, to), context)
    const event = { preventDefault: vi.fn() }
    close(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    event.preventDefault.mockClear()
    context.isQuitting = true
    close(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('allows an intentional Quit during a strict break', () => {
    const context = contextFor('finishMicrobreak')
    let callback
    Object.assign(context, {
      isQuitting: false,
      app: { on: (_event, handler) => { callback = handler } },
      log: { info: vi.fn() },
      globalShortcut: { unregisterAll: vi.fn() },
      autostartManager: null,
      processWin: null
    })
    runInNewContext(quitSource, context)
    const event = { preventDefault: vi.fn() }
    callback(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(context.isQuitting).toBe(true)
    expect(context.globalShortcut.unregisterAll).toHaveBeenCalled()
  })
})
