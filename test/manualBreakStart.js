import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreakStartController from '../app/utils/breakStartController.js'
import BreaksPlanner from '../app/breaksPlanner.js'
import defaultSettings from '../app/utils/defaultSettings.js'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn() } }))
vi.mock('../app/utils/naturalBreaksManager.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: EventEmitter }
})
vi.mock('../app/utils/dndManager.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: EventEmitter }
})
vi.mock('../app/utils/appExclusionsManager.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: EventEmitter }
})

describe('manual break start', () => {
  let controller, shortcuts, windows
  beforeEach(() => {
    vi.useFakeTimers()
    const registered = new Map()
    shortcuts = {
      register: vi.fn((key, callback) => {
        if (key === 'invalid') throw new Error('Invalid accelerator')
        if (registered.has(key)) return false
        registered.set(key, callback)
        return true
      }),
      unregister: vi.fn(key => registered.delete(key)),
      isRegistered: key => registered.has(key),
      trigger: key => registered.get(key)?.()
    }
    controller = new BreakStartController(shortcuts)
    windows = [0, 1].map(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }))
  })
  afterEach(() => vi.useRealTimers())

  it.each(['mini', 'long', 'extended'])('starts %s once through the button or the same global action', type => {
    const onStart = vi.fn()
    const session = controller.wait(type, windows, onStart)
    expect(controller.configure('Ctrl+Alt+S', true)).toBe(true)
    vi.advanceTimersByTime(3600000)
    expect(session.started).toBeNull()
    expect(onStart).not.toHaveBeenCalled()
    const first = controller.start(type, windows[1].webContents)
    expect(first).toBe(Date.now())
    shortcuts.trigger('Ctrl+Alt+S')
    controller.start(type, windows[0].webContents)
    expect(session.started).toBe(first)
    expect(onStart).toHaveBeenCalledTimes(1)
    for (const window of windows) expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith('break-countdown-started', first)
  })

  it('starts from the global shortcut without a focused renderer', () => {
    const onStart = vi.fn()
    controller.wait('mini', windows, onStart)
    controller.configure('Ctrl+Alt+S', true)
    shortcuts.trigger('Ctrl+Alt+S')
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('rejects stale types and unrelated senders, and clears a closed reminder', () => {
    const onStart = vi.fn()
    controller.wait('extended', windows, onStart)
    expect(controller.start('mini', windows[0].webContents)).toBeNull()
    expect(controller.start('extended', {})).toBeNull()
    controller.close([])
    expect(controller.session).not.toBeNull()
    controller.close(windows)
    expect(controller.start()).toBeNull()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('retains the previous shortcut if registration fails and releases only its own shortcut', () => {
    controller.configure('Ctrl+Alt+S', true)
    shortcuts.register('taken', () => {})
    expect(controller.configure('taken', true)).toBe(false)
    expect(controller.configure('invalid', true)).toBe(false)
    expect(controller.configure({}, true)).toBe(false)
    expect(controller.shortcut).toBe('Ctrl+Alt+S')
    expect(shortcuts.isRegistered('Ctrl+Alt+S')).toBe(true)
    controller.configure('', true)
    expect(shortcuts.isRegistered('Ctrl+Alt+S')).toBe(false)
    expect(shortcuts.isRegistered('taken')).toBe(true)
  })

  it('does not reserve a global shortcut while the mode is disabled', () => {
    controller.configure('Ctrl+Alt+S', false)
    expect(shortcuts.register).not.toHaveBeenCalled()
  })

  it('rejects collisions with existing actions including equivalent accelerator aliases', () => {
    expect(controller.conflicts('Ctrl+X', { endBreakShortcut: 'CmdOrCtrl+X' }, 'win32')).toBe(true)
    expect(controller.conflicts('X+Control', { endBreakShortcut: 'CmdOrCtrl+X' }, 'win32')).toBe(true)
    expect(controller.conflicts('Ctrl+Alt+S', { startBreakShortcut: 'Ctrl+Alt+S', endBreakShortcut: 'Ctrl+X' })).toBe(false)
  })

  it.each([
    ['mini', 'microbreakStarted', 'finishMicrobreak', 'microbreakDuration'],
    ['long', 'breakStarted', 'finishBreak', 'breakDuration'],
    ['extended', 'extendedBreakStarted', 'finishExtendedBreak', 'extendedBreakDuration']
  ])('does not schedule completion of %s until Start is pressed', (type, started, finished, durationKey) => {
    const values = { ...defaultSettings, [durationKey]: 2000 }
    const planner = new BreaksPlanner({ get: key => values[key] })
    planner.nextBreak()
    planner.postponesNumber = 1
    planner.waitForBreakStart(type)
    const finish = vi.fn()
    planner.on(finished, finish)
    planner.naturalBreaksManager.emit('clearBreakScheduler')
    planner.naturalBreaksManager.emit('naturalBreakFinished')
    planner.dndManager.emit('dndStarted')
    planner.dndManager.emit('dndFinished')
    vi.advanceTimersByTime(3600000)
    planner.correctScheduler()
    expect(planner.scheduler.timeLeft).toBe(2000)
    expect(planner.scheduler.reference).toBe(finished)
    expect(planner.scheduler.timer).toBeNull()
    expect(finish).not.toHaveBeenCalled()
    controller.wait(type, windows, () => planner.emit(started, true))
    controller.start(type, windows[0].webContents)
    expect(planner.postponesNumber).toBe(1)
    vi.advanceTimersByTime(1999)
    expect(finish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(finish).toHaveBeenCalledExactlyOnceWith(true, true)
    planner.waitForBreakStart(type)
    for (const manager of [planner.naturalBreaksManager, planner.dndManager, planner.appExclusionsManager]) manager.stop = vi.fn()
    planner.pause(1)
    expect(planner.scheduler.waitingForStart).toBe(false)
    expect(planner.scheduler.reference).toBeNull()
    planner.clear()
  })

  it.each([false, true])('keeps pre-break notifications independent when enabled=%s', notification => {
    const values = { ...defaultSettings, manualBreakStart: true, microbreakNotification: notification }
    const planner = new BreaksPlanner({ get: key => values[key] })
    const notify = vi.fn()
    const due = vi.fn()
    planner.on('startMicrobreakNotification', notify)
    planner.on('startMicrobreak', due)
    planner.nextBreak()
    if (notification) {
      vi.advanceTimersByTime(values.microbreakInterval - values.microbreakNotificationInterval)
      expect(notify).toHaveBeenCalledOnce()
      expect(due).not.toHaveBeenCalled()
      planner.nextBreakAfterNotification()
      vi.advanceTimersByTime(values.microbreakNotificationInterval)
    } else {
      vi.advanceTimersByTime(values.microbreakInterval)
      expect(notify).not.toHaveBeenCalled()
    }
    expect(due).toHaveBeenCalledOnce()
    planner.clear()
  })
})
