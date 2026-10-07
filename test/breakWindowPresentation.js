import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { configureBreakWindowPresentation, registerBreakWindowPresentationHandlers, updateBreakClickThrough, whenBreakWindowReady } from '../app/utils/breakWindowPresentation.js'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(sender => sender.window) },
  screen: { getCursorScreenPoint: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

describe('break window presentation IPC', () => {
  let window
  let values
  let input

  beforeEach(() => {
    vi.clearAllMocks()
    values = { compactBreaks: true, breakClickThrough: true }
    window = {
      getBounds: () => ({ x: 1920, y: 0, width: 640, height: 480 }),
      setBounds: vi.fn(),
      setSize: vi.fn(),
      setResizable: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    }
    configureBreakWindowPresentation(window, { get: key => values[key] }, {
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 }
    })
    registerBreakWindowPresentationHandlers()
    input = ipcMain.on.mock.calls.find(([name]) => name === 'set-break-click-through')[1]
  })

  it('uses native pointer coordinates at transparency boundaries', () => {
    screen.getCursorScreenPoint.mockReturnValue({ x: 2500, y: 320 })
    const pointer = ipcMain.handle.mock.calls.find(([name]) => name === 'get-break-pointer-position')[1]
    expect(pointer({ sender: { window } })).toEqual({ x: 580, y: 320 })
    expect(pointer({ sender: { window: {} } })).toBeNull()
  })
  it('applies fixed dimensions before locking the native window size', () => {
    expect(window.setResizable.mock.calls).toEqual([[true], [false]])
    expect(window.setSize).toHaveBeenCalledWith(860, 720)
    expect(window.setResizable.mock.invocationCallOrder[0]).toBeLessThan(window.setSize.mock.invocationCallOrder[0])
    expect(window.setSize.mock.invocationCallOrder[0]).toBeLessThan(window.setResizable.mock.invocationCallOrder[1])
  })

  it('enables click-through before a window is shown', () => {
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('does not expose content-driven resizing and rejects unrelated input senders', () => {
    expect(ipcMain.handle.mock.calls.some(([name]) => name === 'resize-break-window')).toBe(false)
    const otherWindow = { setIgnoreMouseEvents: vi.fn() }
    input({ sender: { window: otherWindow } }, false)
    expect(otherWindow.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(BrowserWindow.fromWebContents).toHaveBeenCalled()
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

describe('break window display readiness', () => {
  const setup = () => {
    const window = new EventEmitter()
    window.webContents = {}
    window.isDestroyed = () => false
    const show = vi.fn()
    return { window, show, loaded: whenBreakWindowReady(window, show) }
  }

  it('keeps a renderer-loaded window hidden until its first frame is ready', () => {
    const { window, show, loaded } = setup()
    loaded({ sender: window.webContents })
    expect(show).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(show).toHaveBeenCalledOnce()
  })

  it('keeps a painted window hidden until presentation setup finishes', () => {
    const { window, show, loaded } = setup()
    window.emit('ready-to-show')
    expect(show).not.toHaveBeenCalled()
    loaded({ sender: window.webContents })
    expect(show).toHaveBeenCalledOnce()
  })

  it('ignores another monitor and duplicate readiness messages', () => {
    const { window, show, loaded } = setup()
    window.emit('ready-to-show')
    loaded({ sender: {} })
    expect(show).not.toHaveBeenCalled()
    loaded({ sender: window.webContents })
    loaded({ sender: window.webContents })
    window.emit('ready-to-show')
    expect(show).toHaveBeenCalledOnce()
  })

  it('does not show a window closed before readiness', () => {
    const { window, show, loaded } = setup()
    loaded({ sender: window.webContents })
    window.emit('closed')
    window.emit('ready-to-show')
    expect(show).not.toHaveBeenCalled()
  })
})
