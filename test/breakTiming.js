import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreaksPlanner from '../app/breaksPlanner.js'
import BreakStartController from '../app/utils/breakStartController.js'
import defaultSettings from '../app/utils/defaultSettings.js'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn() } }))
vi.mock('../app/utils/naturalBreaksManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))
vi.mock('../app/utils/dndManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))
vi.mock('../app/utils/appExclusionsManager.js', async () => ({ default: (await import('node:events')).EventEmitter }))

describe('early preparation and recurring auto-start after Postpone', () => {
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
    const delayKey = type === 'mini' ? 'miniBreakAutoStartDelay' : type === 'extended' ? 'extendedBreakAutoStartDelay' : 'longBreakAutoStartDelay'
    const planner = new BreaksPlanner({ get: key => values[key] })
    planner.breakNumber = type === 'mini' ? 0 : 1
    planner.longBreakNumber = type === 'extended' ? 2 : 0
    const controller = new BreakStartController()
    const windows = [{ isDestroyed: () => false, webContents: { send: vi.fn() } }]
    const start = vi.fn(() => planner.emit(prefix + 'Started', false))
    const show = vi.fn(() => {
      controller.wait(type, windows, start, values[delayKey], planner.postponedReminder ? null : planner.breakDueAt)
      planner.waitForBreakStart(type)
    })
    planner.on('start' + eventBase, show)
    planner.nextBreak()
    planners.push(planner)
    controllers.push(controller)
    return { values, prefix, eventBase, delayKey, planner, controller, show, start, windows }
  }

  it.each(['mini', 'long', 'extended'])('shows %s early and starts at the original scheduled deadline', type => {
    const f = setup(type)
    const due = f.planner.breakDueAt
    const lead = f.values[f.delayKey]
    vi.advanceTimersByTime(1200000 - lead - 1)
    expect(f.show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.show).toHaveBeenCalledOnce()
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    f.controller.arm()
    expect(f.controller.session.deadline).toBe(due)
    vi.advanceTimersByTime(lead - 2001)
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(Date.now()).toBe(due)
    expect(f.start).toHaveBeenCalledOnce()
    expect(f.planner.scheduler.timeLeft).toBe(f.values[f.prefix + 'Duration'])
  })

  it.each(['mini', 'long', 'extended'])('auto-starts %s after every postponement with a fresh wait', type => {
    const f = setup(type)
    const lead = f.values[f.delayKey]
    const due = f.planner.breakDueAt
    vi.advanceTimersByTime(1200000 - lead)
    f.controller.arm()
    vi.advanceTimersByTime(6000)
    for (let count = 1; count <= 3; count++) {
      f.controller.clear()
      f.planner.postponeCurrentBreak()
      expect(f.planner.postponesNumber).toBe(count)
      expect(f.planner.breakDueAt).toBe(due)
      vi.advanceTimersByTime(lead)
      f.controller.arm()
      expect(f.controller.session.deadline).toBe(Date.now() + lead)
      vi.advanceTimersByTime(lead - 1)
      expect(f.controller.session.started).toBeNull()
      vi.advanceTimersByTime(1)
      expect(f.controller.session.started).toBe(Date.now())
      expect(f.planner.scheduler.timeLeft).toBe(f.values[f.prefix + 'Duration'])
    }
    expect(f.start).toHaveBeenCalledTimes(3)
  })

  it('keeps the original notification lead even when the early window appears first', () => {
    const f = setup('long', true)
    const notify = vi.fn()
    f.planner.on('startBreakNotification', notify)
    vi.advanceTimersByTime(1140000)
    expect(f.show).toHaveBeenCalledOnce()
    f.controller.arm()
    vi.advanceTimersByTime(30000)
    expect(notify).toHaveBeenCalledWith(false)
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30000)
    expect(f.start).toHaveBeenCalledOnce()
  })

  it.each(['mini', 'long', 'extended'])('clears a pending notification when %s is started before it', type => {
    const f = setup(type, true)
    const notify = vi.fn()
    f.planner.on('start' + f.eventBase + 'Notification', notify)
    vi.advanceTimersByTime(1200000 - f.values[f.delayKey])
    f.controller.start(type, f.windows[0].webContents)
    vi.advanceTimersByTime(f.values[f.delayKey])
    expect(f.start).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalled()
  })

  it('clears an outstanding original auto-start when Postpone replaces the reminder', () => {
    const f = setup('long')
    vi.advanceTimersByTime(1140000)
    f.controller.arm()
    f.controller.clear()
    f.planner.postponeCurrentBreak()
    vi.advanceTimersByTime(60000)
    f.controller.arm()
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(59999)
    expect(f.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.start).toHaveBeenCalledOnce()
  })
})
