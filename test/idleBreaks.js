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

describe('AFK recovery for scheduled breaks', () => {
  let planner, values, finished
  const minute = 60000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
    idle.started = null
    values = {
      ...defaultSettings,
      naturalBreaksCheckInterval: 2000,
      microbreakInterval: 20 * minute,
      breakInterval: 1,
      breakDuration: 3 * minute,
      extendedBreakDuration: 15 * minute,
      microbreak: false
    }
    planner = new BreaksPlanner({ get: key => values[key] })
    finished = vi.fn()
    planner.on('idleRecoveryFinished', finished)
  })

  afterEach(() => {
    planner.clear()
    planner.naturalBreaksManager.stop()
    vi.useRealTimers()
  })

  const leave = (workMinutes, awayMinutes) => {
    vi.advanceTimersByTime(workMinutes * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(awayMinutes * minute)
  }

  const comeBack = () => {
    idle.started = null
    vi.advanceTimersByTime(2000)
  }

  it('uses the saved durations for AFK qualification', () => {
    expect(planner.naturalBreaksManager.thresholds).toEqual({ short: 180000, long: 900000 })
    values.breakDuration = 240000
    expect(planner.naturalBreaksManager.thresholds.short).toBe(240000)
    expect(getIdleThresholds({})).toEqual({ short: 300000, long: 1800000 })
  })

  it('restarts an early AFK interval without changing the upcoming Extended ordinal', () => {
    planner.longBreakNumber = 2
    planner.nextBreak()
    leave(18, 3)
    expect(planner.scheduler.timer).toBeNull()
    comeBack()
    expect(finished).toHaveBeenCalledWith({ idleTime: 182000, fulfilled: false, reset: false })
    expect(planner._scheduledBreakType).toBe('extendedBreak')
    expect(planner.longBreakNumber).toBe(3)
    expect(planner.timeToNextBreak).toBe(40 * minute)
  })

  it.each([[36.5, 3], [39, 3]])('fulfills one Long break when AFK ends near or crosses its due time', (work, rest) => {
    const show = vi.fn()
    planner.on('startBreak', show)
    planner.nextBreak()
    leave(work, rest)
    comeBack()
    expect(show).not.toHaveBeenCalled()
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ fulfilled: true, reset: false }))
    expect(planner.longBreakNumber).toBe(2)
    expect(planner.timeToNextBreak).toBe(40 * minute)
  })

  it('shows the owed break on return after a nonqualifying AFK crosses its due time', () => {
    const show = vi.fn()
    planner.on('startBreak', show)
    planner.nextBreak()
    leave(39, 2)
    expect(show).not.toHaveBeenCalled()
    comeBack()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
    expect(planner.longBreakNumber).toBe(1)
  })

  it('holds a running Long¡¯s successor until return without fulfilling a second break', () => {
    planner.on('startBreak', () => planner.emit('breakStarted', false))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    leave(41, 8)
    expect(planner.scheduler.timer).toBeNull()
    comeBack()
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ fulfilled: false, reset: false }))
    expect(planner.longBreakNumber).toBe(2)
    expect(planner.timeToNextBreak).toBe(40 * minute)
  })

  it('starts a fresh session after Extended-length AFK, even across multiple nominal deadlines', () => {
    planner.longBreakNumber = 2
    planner.nextBreak()
    leave(39, 85)
    expect(planner.longBreakNumber).toBe(3)
    comeBack()
    expect(finished).toHaveBeenCalledOnce()
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ reset: true }))
    expect(planner.longBreakNumber).toBe(1)
    expect(planner.timeToNextBreak).toBe(40 * minute)
  })

  it('keeps an Extended break due after a shorter overlapping absence', () => {
    planner.longBreakNumber = 2
    planner.nextBreak()
    leave(39, 5)
    comeBack()
    expect(planner._scheduledBreakType).toBe('extendedBreak')
    expect(planner.longBreakNumber).toBe(3)
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ fulfilled: false, reset: false }))
  })

  it('keeps a postponement count when an early AFK reschedules the same larger break', () => {
    planner.nextBreak()
    planner.postponeCurrentBreak()
    planner.skipToBreak(10 * minute)
    leave(0, 3)
    comeBack()
    expect(planner.postponesNumber).toBe(1)
  })

  it('keeps counting down when idle monitoring is disabled', () => {
    planner.nextBreak()
    planner.naturalBreaks(false)
    leave(0, 5)
    expect(planner.idlePeriod).toBeNull()
    expect(planner.timeToNextBreak).toBe(35 * minute)
  })

  it('keeps intentional pause active when idle ends', () => {
    planner.nextBreak()
    leave(18, 3)
    planner.pause(1)
    comeBack()
    expect(planner.isPaused).toBe(true)
    expect(planner.scheduler.reference).toBeNull()
  })
})
