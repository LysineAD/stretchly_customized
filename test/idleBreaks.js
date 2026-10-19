import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreaksPlanner from '../app/breaksPlanner.js'
import defaultSettings from '../app/utils/defaultSettings.js'
import { getIdleThresholds } from '../app/utils/idleThresholds.js'

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

describe('two-tier idle recovery', () => {
  let planner, values

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
    idle.started = null
    values = {
      ...defaultSettings,
      naturalBreaksCheckInterval: 2000,
      naturalBreaksInactivityResetTime: 60000,
      naturalBreaksLongIdleResetTime: 120000,
      microbreakInterval: 60000,
      breakInterval: 1,
      extendedBreakInterval: 3,
      microbreakNotificationInterval: 10000,
      breakNotificationInterval: 10000,
      extendedBreakNotificationInterval: 10000
    }
    planner = new BreaksPlanner({ get: key => values[key] })
  })

  afterEach(() => {
    planner.naturalBreaksManager.stop()
    planner.dndManager.stop()
    planner.appExclusionsManager.stop()
    planner.scheduler?.cancel()
    vi.useRealTimers()
  })

  const beginIdle = () => {
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
  }

  const stayIdleToLongThreshold = () => vi.advanceTimersByTime(60000)

  const returnToWork = () => {
    idle.started = null
    vi.advanceTimersByTime(2000)
  }

  it('uses bounded thresholds and keeps the long threshold above the short threshold', () => {
    expect(getIdleThresholds({})).toEqual({ short: 300000, long: 1800000 })
    expect(getIdleThresholds({ naturalBreaksInactivityResetTime: 3600000, naturalBreaksLongIdleResetTime: 120000 })).toEqual({ short: 3600000, long: 3660000 })
    expect(getIdleThresholds({ naturalBreaksInactivityResetTime: 0, naturalBreaksLongIdleResetTime: 999999999 })).toEqual({ short: 60000, long: 10800000 })
    expect(defaultSettings.naturalBreaksLongIdleResetTime).toBe(1800000)
  })

  it('restarts the whole current Long cycle from its first Mini after first-half idle', () => {
    const started = vi.fn()
    planner.on('idleRecoveryStarted', started)
    planner.breakNumber = 0
    planner.longBreakNumber = 2
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe('microbreak')
    beginIdle()
    expect(started).toHaveBeenCalledWith({ idleTime: 60000, fullReset: false })
    expect(planner.breakNumber).toBe(1)
    expect(planner.longBreakNumber).toBe(2)
    expect(planner.scheduler.reference).toBe('startMicrobreakNotification')
    expect(planner.scheduler.timer).toBeNull()
    const counts = [planner.breakNumber, planner.longBreakNumber]
    vi.advanceTimersByTime(10000)
    expect([planner.breakNumber, planner.longBreakNumber]).toEqual(counts)
    returnToWork()
    expect(planner.scheduler.timer).not.toBeNull()
    expect(planner.timeToNextBreak).toBe(60000)
  })

  it.each([
    ['Long', 0, 'break'],
    ['Extended', 2, 'extendedBreak']
  ])('returns from the latter half before the next %s while preserving its ordinal', (_name, priorLongs, expectedType) => {
    planner.breakNumber = 1
    planner.longBreakNumber = priorLongs
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe(expectedType)
    const scheduledOrdinal = planner.longBreakNumber
    beginIdle()
    expect(planner._scheduledBreakType).toBe('microbreak')
    expect(planner.longBreakNumber).toBe(scheduledOrdinal - 1)
    returnToWork()
    planner.scheduler.cancel()
    planner.nextBreak()
    expect(planner.longBreakNumber).toBe(scheduledOrdinal)
    expect(planner._scheduledBreakType).toBe(expectedType)
  })

  it('does not move the same upcoming Extended ordinal after repeated idle periods', () => {
    planner.breakNumber = 1
    planner.longBreakNumber = 2
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe('extendedBreak')
    beginIdle()
    expect(planner._scheduledBreakType).toBe('microbreak')
    returnToWork()
    planner.scheduler.cancel()
    planner.nextBreak()
    expect(planner._scheduledBreakType).toBe('extendedBreak')
    const ordinal = planner.longBreakNumber
    idle.started = Date.now()
    vi.advanceTimersByTime(60000)
    expect(planner._scheduledBreakType).toBe('microbreak')
    expect(planner.longBreakNumber).toBe(ordinal - 1)
    returnToWork()
    planner.scheduler.cancel()
    planner.nextBreak()
    expect(planner.longBreakNumber).toBe(ordinal)
    expect(planner._scheduledBreakType).toBe('extendedBreak')
  })

  it('escalates within the same idle period to a full schedule reset and stays paused', () => {
    const started = vi.fn()
    const escalated = vi.fn()
    const finished = vi.fn()
    planner.on('idleRecoveryStarted', started)
    planner.on('idleRecoveryEscalated', escalated)
    planner.on('idleRecoveryFinished', finished)
    planner.breakNumber = 2
    planner.longBreakNumber = 2
    planner.nextBreak()
    beginIdle()
    expect(planner.scheduler.timer).toBeNull()
    stayIdleToLongThreshold()
    expect(started).toHaveBeenCalledOnce()
    expect(escalated).toHaveBeenCalledOnce()
    expect(planner.breakNumber).toBe(1)
    expect(planner.longBreakNumber).toBe(0)
    expect(planner.scheduler.timer).toBeNull()
    expect(finished).not.toHaveBeenCalled()
    returnToWork()
    expect(finished).toHaveBeenCalledWith({ idleTime: 120000 })
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it('applies short recovery after an active break ends without changing its duration timer', () => {
    planner.nextBreak()
    planner.scheduler.cancel()
    values.microbreakDuration = 300000
    planner.emit('microbreakStarted', false)
    const displayedBreakScheduler = planner.scheduler
    const duration = displayedBreakScheduler.delay
    beginIdle()
    expect(planner.scheduler).toBe(displayedBreakScheduler)
    expect(planner.scheduler.reference).toBe('finishMicrobreak')
    expect(planner.scheduler.delay).toBe(duration)
    expect(planner.idleRecoveryPendingShort).toBe(true)
    planner.scheduler.cancel()
    planner.nextBreak()
    vi.advanceTimersByTime(2000)
    expect(planner._scheduledBreakType).toBe('microbreak')
    expect(planner.idlePausedScheduler).toBe(planner.scheduler)
    expect(planner.scheduler.timer).toBeNull()
  })

  it('resets to the first Long interval when Mini breaks are disabled', () => {
    values.microbreak = false
    planner.longBreakNumber = 1
    planner.nextBreak()
    const scheduledType = planner._scheduledBreakType
    const scheduledOrdinal = planner.longBreakNumber
    beginIdle()
    expect(planner.longBreakNumber).toBe(scheduledOrdinal)
    expect(planner._scheduledBreakType).toBe(scheduledType)
    expect(planner.scheduler.timer).toBeNull()
  })

  it('finishes deferred recovery after a running break when monitoring was disabled meanwhile', () => {
    planner.nextBreak()
    planner.scheduler.cancel()
    values.microbreakDuration = 300000
    planner.emit('microbreakStarted', false)
    beginIdle()
    planner.naturalBreaks(false)
    expect(planner.idleRecoveryPendingFinishIdleTime).toBe(60000)
    planner.scheduler.cancel()
    planner.nextBreak()
    expect(planner.idleRecoveryActive).toBe(false)
    expect(planner.idlePausedScheduler).toBeNull()
    expect(planner.timeToNextBreak).toBe(60000)
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it('restarts Mini-only schedules without requiring a Long break', () => {
    values.break = false
    planner.nextBreak()
    beginIdle()
    expect(planner.breakNumber).toBe(0)
    expect(planner.longBreakNumber).toBe(0)
    expect(planner.scheduler.reference).toBe('startMicrobreakNotification')
    expect(planner.scheduler.timer).toBeNull()
  })

  it('leaves the countdown alone when idle monitoring is disabled', () => {
    planner.nextBreak()
    const remaining = planner.timeToNextBreak
    planner.naturalBreaks(false)
    idle.started = Date.now()
    vi.advanceTimersByTime(120000)
    expect(planner.idleRecoveryActive).toBe(false)
    expect(planner.timeToNextBreak).toBe(remaining - 120000)
  })

  it('does not resume an intentional manual pause when idle ends', () => {
    planner.nextBreak()
    beginIdle()
    planner.pause(1)
    returnToWork()
    expect(planner.isPaused).toBe(true)
    expect(planner.scheduler.reference).toBeNull()
  })

  it('preserves the next notification stage when short recovery replans', () => {
    planner.nextBreak()
    expect(planner.scheduler.reference).toBe('startMicrobreakNotification')
    beginIdle()
    expect(planner.scheduler.reference).toBe('startMicrobreakNotification')
    expect(planner.timeToNextBreak).toBe(60000)
    returnToWork()
    expect(planner.scheduler.reference).toBe('startMicrobreakNotification')
  })
})
