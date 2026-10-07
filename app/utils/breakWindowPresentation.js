import { BrowserWindow, ipcMain, screen } from 'electron'
import { getCompactBreakBounds } from './breakDisplaySettings.js'

const windows = new WeakMap()

export function configureBreakWindowPresentation (window, settings, display) {
  windows.set(window, { settings })
  if (settings.get('compactBreaks')) {
    const bounds = getCompactBreakBounds(display)
    window.setResizable(true)
    window.setSize(bounds.width, bounds.height)
    window.setResizable(false)
  }
  window.setIgnoreMouseEvents(settings.get('breakClickThrough'), { forward: true })
}

export function updateBreakClickThrough (breakWindows, enabled) {
  breakWindows.filter(Boolean).flat().forEach(window => {
    if (window.isDestroyed() || !windows.has(window)) return
    window.setIgnoreMouseEvents(enabled, { forward: true })
    window.webContents.send('break-click-through-changed', enabled)
  })
}

export function registerBreakWindowPresentationHandlers () {
  ipcMain.handle('get-break-pointer-position', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!windows.has(window)) return null
    const pointer = screen.getCursorScreenPoint()
    const bounds = window.getBounds()
    return { x: pointer.x - bounds.x, y: pointer.y - bounds.y }
  })
  ipcMain.on('set-break-click-through', (event, ignore) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const presentation = windows.get(window)
    if (!presentation || typeof ignore !== 'boolean') return
    window.setIgnoreMouseEvents(presentation.settings.get('breakClickThrough') && ignore, { forward: true })
  })
}
