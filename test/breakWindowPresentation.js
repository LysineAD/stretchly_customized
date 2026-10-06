import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { configureBreakWindowPresentation, registerBreakWindowPresentationHandlers, updateBreakClickThrough } from '../app/utils/breakWindowPresentation.js'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(sender => sender.window) },
  screen: { getCursorScreenPoint: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

describe('break window presentation IPC', () => {
  let window
  let values
  let resize
  let input

  beforeEach(() => {
    vi.clearAllMocks()
    values = { compactBreaks: true, breakClickThrough: true }
    window = {
      getBounds: () => ({ x: 1920, y: 0, width: 640, height: 480 }),
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    }
    configureBreakWindowPresentation(window, { get: key => values[key] }, {
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 }
    })
    registerBreakWindowPresentationHandlers()
    resize = ipcMain.handle.mock.calls.find(([name]) => name === 'resize-break-window')[1]
    input = ipcMain.on.mock.calls.find(([name]) => name === 'set-break-click-through')[1]
  })

  it('uses native pointer coordinates at transparency boundaries', () => {
    screen.getCursorScreenPoint.mockReturnValue({ x: 2500, y: 320 })
    const pointer = ipcMain.handle.mock.calls.find(([name]) => name === 'get-break-pointer-position')[1]
    expect(pointer({ sender: { window } })).toEqual({ x: 580, y: 320 })
    expect(pointer({ sender: { window: {} } })).toBeNull()
  })
  it('enables click-through before a window is shown', () => {
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('does not let unrelated renderer windows change break presentation', () => {
    const otherWindow = { setBounds: vi.fn(), setIgnoreMouseEvents: vi.fn() }
    const event = { sender: { window: otherWindow } }
    resize(event, 280)
    input(event, false)
    expect(otherWindow.setBounds).not.toHaveBeenCalled()
    expect(otherWindow.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(BrowserWindow.fromWebContents).toHaveBeenCalled()
  })

  it('resizes only Compact windows and rejects invalid sizes', () => {
    const event = { sender: { window } }
    for (const height of [NaN, Infinity, -5, 0, '300']) resize(event, height)
    expect(window.setBounds).not.toHaveBeenCalled()
    resize(event, 280)
    expect(window.setBounds).toHaveBeenCalledWith({ x: 2560, y: 400, width: 640, height: 280 })
    const regular = { ...window, setBounds: vi.fn() }
    values.compactBreaks = false
    configureBreakWindowPresentation(regular, { get: key => values[key] }, { bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    resize({ sender: { window: regular } }, 400)
    expect(regular.setBounds).not.toHaveBeenCalled()
  })

  it('cannot reenable click-through after the checkbox is disabled', () => {
    values.breakClickThrough = false
    input({ sender: { window } }, true)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  })

  it('allows the renderer to make visible controls interactive', () => {
    input({ sender: { window } }, false)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    input({ sender: { window } }, true)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('updates active windows across every break kind and skips destroyed windows', () => {
    const second = { ...window, setIgnoreMouseEvents: vi.fn(), webContents: { send: vi.fn() } }
    const third = { ...window, isDestroyed: () => true, setIgnoreMouseEvents: vi.fn() }
    const settings = { get: key => values[key] }
    const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    configureBreakWindowPresentation(second, settings, display)
    configureBreakWindowPresentation(third, settings, display)
    third.setIgnoreMouseEvents.mockClear()
    updateBreakClickThrough([[window], [second], [third], null], false)
    expect(window.webContents.send).toHaveBeenCalledWith('break-click-through-changed', false)
    expect(second.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    expect(third.setIgnoreMouseEvents).not.toHaveBeenCalled()
  })
})
