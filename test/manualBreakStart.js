import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreakStartController from '../app/utils/breakStartController.js'
import BreakActionShortcut from '../app/utils/breakActionShortcut.js'
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
  let controller, actionShortcut, shortcuts, windows
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
    controller = new BreakStartController()
    actionShortcut = new BreakActionShortcut(shortcuts)
    windows = [0, 1].map(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }))
  })
  afterEach(() => vi.useRealTimers())

  it.each(['mini', 'long', 'extended'])('starts %s once through the button or the same global action', type => {
    const onStart = vi.fn()
    const session = controller.wait(type, windows, onStart)
    expect(actionShortcut.configure('Ctrl+X', () => controller.start())).toBe(true)
    vi.advanceTimersByTime(3600000)
    expect(session.started).toBeNull()
    expect(onStart).not.toHaveBeenCalled()
    const first = controller.start(type, windows[1].webContents)
    expect(first).toBe(Date.now())
    shortcuts.trigger('Ctrl+X')
    controller.start(type, windows[0].webContents)
    expect(session.started).toBe(first)
    expect(onStart).toHaveBeenCalledTimes(1)
    for (const window of windows) expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith('break-countdown-started', first)
  })

  it('starts from the global shortcut without a focused renderer', () => {
    const onStart = vi.fn()
    controller.wait('mini', windows, onStart)
    actionShortcut.configure('Ctrl+X', () => controller.start())
    shortcuts.trigger('Ctrl+X')
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
    actionShortcut.configure('Ctrl+X', () => controller.start())
    shortcuts.register('taken', () => {})
    expect(actionShortcut.configure('taken')).toBe(false)
    expect(actionShortcut.configure('invalid')).toBe(false)
    expect(actionShortcut.configure({})).toBe(false)
    expect(actionShortcut.shortcut).toBe('Ctrl+X')
    expect(shortcuts.isRegistered('Ctrl+X')).toBe(true)
    actionShortcut.configure('')
    expect(shortcuts.isRegistered('Ctrl+X')).toBe(false)
    expect(shortcuts.isRegistered('taken')).toBe(true)
  })

  it('validates a shortcut without reserving it between breaks', () => {
    expect(actionShortcut.configure('Ctrl+X')).toBe(true)
    expect(shortcuts.isRegistered('Ctrl+X')).toBe(false)
  })

  it.each(['mini', 'long', 'extended'])('auto-starts %s only after its visible waiting deadline', type => {
    const onStart = vi.fn()
    const session = controller.wait(type, windows, onStart, 20000)
    vi.advanceTimersByTime(60000)
    expect(onStart).not.toHaveBeenCalled()
    controller.arm()
    controller.arm()
    expect(session.deadline).toBe(Date.now() + 20000)
    vi.advanceTimersByTime(19999)
    expect(onStart).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStart).toHaveBeenCalledOnce()
    expect(session.started).toBe(Date.now())
    controller.start()
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('cancels auto-start on an early Start, closure, or replacement', () => {
    const onStart = vi.fn()
    controller.wait('mini', windows, onStart, 20000)
    controller.arm()
    controller.start()
    vi.advanceTimersByTime(20000)
    expect(onStart).toHaveBeenCalledOnce()
    controller.wait('mini', windows, onStart, 20000)
    controller.arm()
    controller.close(windows)
    vi.advanceTimersByTime(20000)
    expect(onStart).toHaveBeenCalledOnce()
    controller.wait('mini', windows, onStart, 20000)
    controller.arm()
    controller.wait('long', windows, onStart, 0)
    controller.arm()
    vi.advanceTimersByTime(3600000)
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('uses the same key to start first and take the existing action next', () => {
    const duringBreak = vi.fn()
    const session = controller.wait('mini', windows, () => {})
    actionShortcut.configure('Ctrl+X', () => {
      if (session.started === null) controller.start()
      else duringBreak()
    })
    shortcuts.trigger('Ctrl+X')
    expect(session.started).not.toBeNull()
    expect(duringBreak).not.toHaveBeenCalled()
    shortcuts.trigger('Ctrl+X')
    expect(duringBreak).toHaveBeenCalledOnce()
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
