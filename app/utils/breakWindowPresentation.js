import { BrowserWindow, ipcMain, screen } from 'electron'
import { getCompactBreakBounds } from './breakDisplaySettings.js'

const windows = new WeakMap()

export function configureBreakWindowPresentation (window, settings, display) {
  windows.set(window, { settings, display, compact: settings.get('compactBreaks') })
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
  ipcMain.handle('resize-break-window', (event, height) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const presentation = windows.get(window)
    if (!presentation?.compact || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return
    const workArea = presentation.display.workArea || presentation.display.bounds
    const currentWidth = window.getBounds().width
    const width = height > workArea.height - 32 ? Math.min(currentWidth + 80, workArea.width - 32) : currentWidth
    window.setBounds(getCompactBreakBounds(presentation.display, height, width))
  })
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
