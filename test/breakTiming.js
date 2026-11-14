import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreaksPlanner from '../app/breaksPlanner.js'
import BreakStartController from '../app/utils/breakStartController.js'
import defaultSettings from '../app/utils/defaultSettings.js'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn() } }))
vi.mock('../app/utils/naturalBreaksManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))
vi.mock('../app/utils/dndManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))
vi.mock('../app/utils/appExclusionsManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))

describe('break reminders and auto-start', () => {
  const planners = []
  const controllers = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))
  })
  afterEach(() => {
    for (const planner of planners) planner.clear()
    for (const controller of controllers) controller.clear()
    planners.length = 0
    controllers.length = 0
    vi.useRealTimers()
  })

  const setup = (type, notifications = false) => {
    const values = {
      ...defaultSettings,
      manualBreakStart: true,
      naturalBreaks: false,
      microbreakInterval: 1200000,
      breakInterval: 1,
      microbreakNotification: notifications,
      breakNotification: notifications,
      extendedBreakNotification: notifications
    }
    const prefix = type === 'mini' ? 'microbreak' : type === 'extended' ? 'extendedBreak' : 'break'
    const eventBase = prefix[0].toUpperCase() + prefix.slice(1)
    const delay = type === 'mini' ? values.miniBreakAutoStartDelay : 20000
    const planner = new BreaksPlanner({ get: key => values[key] })
    planner.breakNumber = type === 'mini' ? 0 : 1
    planner.longBreakNumber = type === 'extended' ? 2 : 0
    const controller = new BreakStartController()
    const windows = [{ isDestroyed: () => false, webContents: { send: vi.fn() } }]
    const start = vi.fn(() => planner.emit(prefix + 'Started', false))
    const show = vi.fn(() => {
      controller.wait(type, windows, start, delay, type === 'mini' && !planner.postponedReminder ? planner.breakDueAt : null)
      planner.waitForBreakStart(type)
    })
    planner.on('start' + eventBase, show)
    planner.nextBreak()
    planners.push(planner)
    controllers.push(controller)
    return { values, prefix, delay, planner, controller, show, start, windows }
  }

  it('keeps early preparation for Mini breaks', () => {
    const f = setup('mini')
    const due = f.planner.breakDueAt
    vi.advanceTimersByTime(1200000 - f.delay)
    expect(f.show).toHaveBeenCalledOnce()
    f.controller.arm()
    expect(f.controller.session.deadline).toBe(due)
    vi.advanceTimersByTime(f.delay)
    expect(f.start).toHaveBeenCalledOnce()
  })

  it.each(['long', 'extended'])('warns 60 seconds before a %s break and starts 20 seconds after its window opens', type => {
    const f = setup(type, true)
    const notify = vi.fn()
    f.planner.on(type === 'long' ? 'startBreakNotification' : 'startExtendedBreakNotification', notify)
    vi.advanceTimersByTime(1140000)
    expect(notify).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(59999)
    expect(f.show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.show).toHaveBeenCalledOnce()
    f.controller.arm()
    vi.advanceTimersByTime(19999)
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.start).toHaveBeenCalledOnce()
  })

  it.each([['long', [2, 4, 6]], ['extended', [4, 6, 8]]])('increments %s postponements and stops at the configured cap', (type, delays) => {
    const f = setup(type)
    vi.advanceTimersByTime(1200000)
    for (const minutes of delays) {
      f.controller.arm()
      f.controller.clear()
      f.planner.postponeCurrentBreak()
      expect(f.planner.timeToNextBreak).toBe(minutes * 60000)
      vi.advanceTimersByTime(minutes * 60000)
    }
    expect(f.planner.canPostponeLargerBreak).toBe(false)
    expect(f.planner.postponeCurrentBreak()).toBe(false)
    f.controller.arm()
    vi.advanceTimersByTime(20000)
    expect(f.start).toHaveBeenCalledOnce()
  })

  it('starts the upcoming Extended break early, even if a Mini reminder is next', () => {
    const f = setup('mini')
    f.planner.longBreakNumber = 2
    const show = vi.fn()
    f.planner.on('startExtendedBreak', show)
    f.planner.startLargerBreak()
    vi.advanceTimersByTime(0)
    expect(show).toHaveBeenCalledOnce()
    expect(f.planner.longBreakNumber).toBe(3)
  })

  it.each([[2, 1], [3, 2]])('keeps the larger-break cycle when the tray starts %i-cycle breaks early', (interval, normalCount) => {
    const f = setup('mini')
    f.values.extendedBreakInterval = interval
    for (let i = 0; i < normalCount; i++) {
      f.planner.skipToBreak()
      vi.advanceTimersByTime(100)
      f.planner.nextBreak()
      f.planner.skipToMicrobreak()
      vi.advanceTimersByTime(100)
      f.planner.nextBreak()
    }
    expect(f.planner._scheduledBreakType).toBe('extendedBreak')
  })

  it('does not advance the larger-break ordinal twice when the next break is already scheduled', () => {
    const f = setup('long')
    const ordinal = f.planner.longBreakNumber
    f.planner.skipToBreak()
    vi.advanceTimersByTime(100)
    expect(f.planner.longBreakNumber).toBe(ordinal)
    f.planner.nextBreak()
    f.planner.nextBreak()
    expect(f.planner.longBreakNumber).toBe(ordinal + 1)
  })

  it('advances past a larger break already on screen when the tray starts another Long break', () => {
    const f = setup('long')
    const ordinal = f.planner.longBreakNumber
    f.planner.waitForBreakStart('long')
    f.planner.skipToBreak()
    expect(f.planner.longBreakNumber).toBe(ordinal + 1)
  })

  it.each(['skipToMicrobreak', 'skipToBreak', 'skipToExtendedBreak'])('%s starts without an extra scheduling delay', method => {
    const f = setup('mini')
    f.planner[method]()
    expect(f.planner.scheduler.delay).toBe(0)
  })

  it('holds an already visible countdown while checking AFK', () => {
    const f = setup('long')
    vi.advanceTimersByTime(1200000)
    f.controller.arm()
    vi.advanceTimersByTime(5000)
    f.controller.pause()
    vi.advanceTimersByTime(30000)
    expect(f.start).not.toHaveBeenCalled()
    f.controller.resume()
    vi.advanceTimersByTime(15000)
    expect(f.start).toHaveBeenCalledOnce()
  })
})
