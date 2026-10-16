import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import BreaksPlanner from '../app/breaksPlanner.js'
import defaultSettings from '../app/utils/defaultSettings.js'
import { getIdleMode } from '../app/utils/idleMode.js'
import StatusMessages from '../app/utils/statusMessages.js'

const idle = vi.hoisted(() => ({ started: null }))
vi.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: () => idle.started === null ? 0 : Math.floor((Date.now() - idle.started) / 1000) }
}))
vi.mock('node-desktop-idle-v2', () => ({
  desktopIdle: { startMonitoring: vi.fn(), stopMonitoring: vi.fn(), getIdleTime: () => 0 }
}))
vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn() } }))
vi.mock('../app/utils/dndManager.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: class extends EventEmitter { start () {} stop () {} } }
})
vi.mock('../app/utils/appExclusionsManager.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: class extends EventEmitter { reset () {} stop () {} reinitialize () {} } }
})

describe('configurable idle breaks', () => {
  let planner, settings, values

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
    idle.started = null
    values = {
      ...defaultSettings,
      naturalBreaksResetOnIdle: false,
      naturalBreaksInactivityResetTime: 60000,
      microbreakInterval: 600000,
      breakInterval: 1,
      extendedBreakInterval: 3
    }
    settings = { get: key => values[key] }
    planner = new BreaksPlanner(settings)
  })

  afterEach(() => {
    planner.naturalBreaksManager.stop()
    planner.scheduler?.cancel()
    vi.useRealTimers()
  })

  const returnToWork = () => {
    idle.started = null
    vi.advanceTimersByTime(2000)
  }

  it.each([
    ['Mini', 0, 0, 'startMicrobreakNotification'],
    ['Long', 1, 0, 'startBreakNotification'],
    ['Extended', 1, 2, 'startExtendedBreakNotification']
  ])('preserves the full %s session position and idle-onset countdown', (_type, breakNumber, longBreakNumber, reference) => {
    planner.breakNumber = breakNumber
    planner.longBreakNumber = longBreakNumber
    planner.nextBreak()
    vi.advanceTimersByTime(120000)
    const atIdleStart = planner.timeToNextBreak
    const counts = [planner.breakNumber, planner.longBreakNumber, planner.postponesNumber]
    const scheduler = planner.scheduler
    const callback = vi.fn()
    planner.on(reference, callback)
    idle.started = Date.now()
    vi.advanceTimersByTime(59999)
    expect(planner.idlePausedScheduler).toBeNull()
    vi.advanceTimersByTime(1)
    expect(planner.idlePausedScheduler).toBe(scheduler)
    expect(planner.scheduler.reference).toBe(reference)
    expect(planner.timeToNextBreak).toBe(atIdleStart)
    vi.advanceTimersByTime(3600000)
    expect(planner.timeToNextBreak).toBe(atIdleStart)
    expect(callback).not.toHaveBeenCalled()
    expect([planner.breakNumber, planner.longBreakNumber, planner.postponesNumber]).toEqual(counts)
    returnToWork()
    expect(planner.scheduler).toBe(scheduler)
    expect(planner.timeToNextBreak).toBe(atIdleStart)
    expect(planner.idlePausedScheduler).toBeNull()
    const remainingToNotification = planner.scheduler.timeLeft
    vi.advanceTimersByTime(remainingToNotification - 1)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledOnce()
  })

  it.each([
    ['Mini', 0, 0, 'startMicrobreakNotification'],
    ['Long', 1, 0, 'startBreakNotification'],
    ['Extended', 1, 2, 'startExtendedBreakNotification']
  ])('partially resets the %s interval without advancing cycle progress', (_type, breakNumber, longBreakNumber, reference) => {
    values.naturalBreaksIdleMode = 'partial'
    planner.breakNumber = breakNumber
    planner.longBreakNumber = longBreakNumber
    planner.nextBreak()
    planner.postponesNumber = 4
    const counts = [planner.breakNumber, planner.longBreakNumber, planner.postponesNumber]
    vi.advanceTimersByTime(120000)
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.scheduler.reference).toBe(reference)
    expect(planner.timeToNextBreak).toBe(600000)
    vi.advanceTimersByTime(3600000)
    expect(planner.timeToNextBreak).toBe(600000)
    returnToWork()
    expect(planner.timeToNextBreak).toBe(600000)
    expect([planner.breakNumber, planner.longBreakNumber, planner.postponesNumber]).toEqual(counts)
    vi.advanceTimersByTime(10000)
    expect(planner.timeToNextBreak).toBe(590000)
  })

  it('partially resets a long-only interval to its full configured length', () => {
    values.naturalBreaksIdleMode = 'partial'
    values.microbreak = false
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    returnToWork()
    expect(planner.timeToNextBreak).toBe(1200000)
    expect(planner.longBreakNumber).toBe(1)
  })

  it.each(['microbreak', 'break', 'extendedBreak'])('repeatedly postpones the displayed %s without changing cycle progress', type => {
    planner.nextBreak()
    const event = type.charAt(0).toUpperCase() + type.slice(1)
    const counts = [planner.breakNumber, planner.longBreakNumber]
    values[type + 'PostponeTime'] = 60000
    for (let index = 1; index <= 5; index++) {
      planner.scheduler.cancel()
      planner.emit(type + 'Started', false)
      vi.advanceTimersByTime(values[type + 'Duration'] * 0.8)
      planner.postponeCurrentBreak()
      expect(planner.scheduler.reference).toBe('start' + event + 'Notification')
      expect(planner.timeToNextBreak).toBe(60000)
      expect(planner.postponesNumber).toBe(index)
      expect([planner.breakNumber, planner.longBreakNumber]).toEqual(counts)
    }
  })

  it('preserves old idle preferences until a new mode is explicitly selected', () => {
    expect(getIdleMode({})).toBe('reset')
    expect(getIdleMode({ naturalBreaksResetOnIdle: false })).toBe('preserve')
    expect(getIdleMode({ naturalBreaksResetOnIdle: true })).toBe('reset')
    expect(getIdleMode({ naturalBreaksResetOnIdle: false, naturalBreaksIdleMode: 'partial' })).toBe('partial')
    expect(getIdleMode({ naturalBreaksResetOnIdle: false, naturalBreaksIdleMode: 'reset' })).toBe('reset')
  })

  it('partially resets after a notification without losing the next break type', () => {
    values.naturalBreaksIdleMode = 'partial'
    values.breakNotificationInterval = 120000
    planner.breakNumber = 1
    planner.on('startBreakNotification', () => planner.nextBreakAfterNotification())
    planner.nextBreak()
    vi.advanceTimersByTime(480000)
    expect(planner.scheduler.reference).toBe('startBreak')
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    returnToWork()
    expect(planner.scheduler.reference).toBe('startBreakNotification')
    expect(planner.timeToNextBreak).toBe(600000)
    expect(planner.longBreakNumber).toBe(1)
  })

  it('does not freeze or rewind the schedule for idle periods below the selected threshold', () => {
    planner.nextBreak()
    const remaining = planner.timeToNextBreak
    idle.started = Date.now()
    vi.advanceTimersByTime(30000)
    returnToWork()
    expect(planner.idlePausedScheduler).toBeNull()
    expect(planner.timeToNextBreak).toBe(remaining - 32000)
    expect(planner.breakNumber).toBe(1)
  })

  it('uses the configured threshold and does not resume when it changes during a paused idle period', () => {
    values.naturalBreaksInactivityResetTime = 120000
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.idlePausedScheduler).toBeNull()
    vi.advanceTimersByTime(60000)
    expect(planner.idlePausedScheduler).toBe(planner.scheduler)
    const remaining = planner.timeToNextBreak
    values.naturalBreaksInactivityResetTime = 300000
    vi.advanceTimersByTime(60000)
    expect(planner.timeToNextBreak).toBe(remaining)
    returnToWork()
    expect(planner.idlePausedScheduler).toBeNull()
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it('retains reset behavior by default, resetting Mini/Long/Extended progress when activity returns', () => {
    values.naturalBreaksResetOnIdle = defaultSettings.naturalBreaksResetOnIdle
    expect(values.naturalBreaksResetOnIdle).toBe(true)
    planner.breakNumber = 4
    planner.longBreakNumber = 2
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.scheduler.reference).toBeNull()
    expect(planner.longBreakNumber).toBe(0)
    returnToWork()
    expect(planner.scheduler.timer).not.toBeNull()
    expect(planner.breakNumber).toBe(1)
    expect(planner.longBreakNumber).toBe(0)
  })

  it('reaches Extended after the remaining Long break instead of restarting the cycle', () => {
    planner.longBreakNumber = 1
    planner.breakNumber = 2
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    returnToWork()
    expect(planner.longBreakNumber).toBe(1)
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe('break')
    expect(planner.longBreakNumber).toBe(2)
    planner.nextBreak()
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe('extendedBreak')
    expect(planner.longBreakNumber).toBe(3)
  })

  it('preserves notification-stage and postponement countdowns and counts', () => {
    values.microbreakNotificationInterval = 120000
    planner.nextBreak()
    planner.nextBreakAfterNotification()
    planner.postponesNumber = 2
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.scheduler.reference).toBe('startMicrobreak')
    expect(planner.postponesNumber).toBe(2)
    returnToWork()
    expect(planner.scheduler.reference).toBe('startMicrobreak')
    expect(planner.postponesNumber).toBe(2)
  })

  it('preserves the idle-onset countdown even if the notification fires before the threshold', () => {
    values.microbreakNotificationInterval = 120000
    planner.nextBreak()
    planner.on('startMicrobreakNotification', () => planner.nextBreakAfterNotification())
    const started = vi.fn()
    planner.on('startMicrobreak', started)
    vi.advanceTimersByTime(450000)
    const remaining = planner.timeToNextBreak
    expect(remaining).toBe(150000)
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.scheduler.reference).toBe('startMicrobreak')
    expect(planner.timeToNextBreak).toBe(remaining)
    returnToWork()
    vi.advanceTimersByTime(remaining - 1)
    expect(started).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(started).toHaveBeenCalledOnce()
  })

  it('keeps the postponed countdown and postpone count across idle', () => {
    planner.nextBreak()
    planner.postponeCurrentBreak()
    vi.advanceTimersByTime(30000)
    const remaining = planner.timeToNextBreak
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    returnToWork()
    expect(planner.timeToNextBreak).toBe(remaining)
    expect(planner.postponesNumber).toBe(1)
  })

  it.each(['microbreakStarted', 'breakStarted', 'extendedBreakStarted'])('lets an ongoing %s finish normally without resetting session progress', event => {
    planner.nextBreak()
    planner.scheduler.cancel()
    planner.emit(event, false)
    const callback = vi.fn()
    const reference = planner.scheduler.reference
    const counts = [planner.breakNumber, planner.longBreakNumber]
    planner.on(reference, callback)
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner.idlePausedScheduler).toBeNull()
    expect([planner.breakNumber, planner.longBreakNumber]).toEqual(counts)
    returnToWork()
    expect(planner.scheduler.reference).toBe(reference)
    expect([planner.breakNumber, planner.longBreakNumber]).toEqual(counts)
  })

  it('resumes the preserved countdown when idle monitoring is disabled while idle', () => {
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    const remaining = planner.timeToNextBreak
    planner.naturalBreaks(false)
    expect(planner.naturalBreaksManager.usingNaturalBreaks).toBe(false)
    expect(planner.naturalBreaksManager.isSchedulerCleared).toBe(false)
    expect(planner.idlePausedScheduler).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(planner.timeToNextBreak).toBe(remaining - 5000)
  })

  it('takes a fresh idle-onset snapshot for a second idle period', () => {
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    returnToWork()
    vi.advanceTimersByTime(1000)
    const remaining = planner.timeToNextBreak
    idle.started = Date.now()
    vi.advanceTimersByTime(62000)
    expect(planner.timeToNextBreak).toBe(remaining)
  })

  it('does not automatically resume an intentional tray pause', () => {
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    planner.pause(1)
    returnToWork()
    expect(planner.isPaused).toBe(true)
    expect(planner.idlePausedScheduler).toBeNull()
    expect(planner.scheduler.reference).toBeNull()
  })

  it('does not restart a preserved timer while DND is active', () => {
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    planner.dndManager.isOnDnd = true
    returnToWork()
    expect(planner.scheduler.timer).toBeNull()
    planner.dndManager.isOnDnd = false
    planner.dndManager.emit('dndFinished')
    expect(planner.scheduler.timer).not.toBeNull()
    expect(planner.idlePausedScheduler).toBeNull()
  })

  it('does not monitor idle time when the existing toggle is off', () => {
    planner.naturalBreaks(false)
    planner.nextBreak()
    const remaining = planner.timeToNextBreak
    idle.started = Date.now()
    vi.advanceTimersByTime(120000)
    expect(planner.idlePausedScheduler).toBeNull()
    expect(planner.timeToNextBreak).toBe(remaining - 120000)
  })

  it('reports an idle pause in the tray instead of a frozen upcoming-break time', () => {
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    const status = new StatusMessages({
      breakPlanner: planner, settings, i18next: { t: key => key }, humanizeDuration: () => ''
    })
    expect(status.trayMessage).toBe('statusMessages.paused - statusMessages.idleTime')
    expect(planner.naturalBreaksManager).toBeInstanceOf(EventEmitter)
  })
})
