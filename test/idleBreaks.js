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
    // A return is confirmed on the poll after the idle counter drops, so allow
    // two polling intervals (2 x 2s) before asserting the recovery.
    vi.advanceTimersByTime(4000)
  }

  it('keeps an idle Long break open until its full duration including debt finishes', () => {
    values.breakDuration = 4 * minute
    const close = vi.fn()
    planner.on('closeForIdle', close)
    planner.on('startBreak', () => planner.emit('breakStarted', false, 10 * minute))
    planner.nextBreak()
    vi.advanceTimersByTime(41 * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(4 * minute + 4000)
    expect(close).not.toHaveBeenCalled()
    expect(planner.scheduler.reference).toBe('finishBreak')
    expect(planner.scheduler.timeLeft).toBeGreaterThan(4 * minute)
  })

  it('keeps an Extended break running when idle begins after it opens', () => {
    values.breakDuration = 4 * minute
    values.extendedBreak = true
    values.extendedBreakDuration = 12 * minute
    values.extendedBreakInterval = 1
    const close = vi.fn()
    planner.on('closeForIdle', close)
    planner.on('startExtendedBreak', () => planner.emit('extendedBreakStarted', false, 12 * minute))
    planner.nextBreak()
    vi.advanceTimersByTime(41 * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(4 * minute)
    expect(close).not.toHaveBeenCalled()
    expect(planner.scheduler.reference).toBe('finishExtendedBreak')
    expect(planner.scheduler.timeLeft).toBeGreaterThan(6 * minute)
  })

  it('resets the full schedule when idle during a Long break reaches the Extended threshold', () => {
    values.breakDuration = 4 * minute
    values.extendedBreak = true
    values.extendedBreakDuration = 12 * minute
    values.extendedBreakInterval = 3
    const reset = vi.fn()
    planner.on('idleSessionReset', reset)
    planner.on('startBreak', () => planner.emit('breakStarted', false, 4 * minute))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(4 * minute)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner.longBreakNumber).toBe(2)
    vi.advanceTimersByTime(8 * minute + 4000)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner.longBreakNumber).toBe(1)
    vi.advanceTimersByTime(2 * minute)
    expect(reset).toHaveBeenCalledOnce()
    comeBack()
    expect(planner.timeToNextBreak).toBeGreaterThan(39 * minute)
  })

  it('defers a full idle reset until an Extended break including debt finishes', () => {
    values.breakDuration = 4 * minute
    values.extendedBreak = true
    values.extendedBreakDuration = 12 * minute
    values.extendedBreakInterval = 3
    const close = vi.fn()
    planner.on('closeForIdle', close)
    planner.on('startExtendedBreak', () => planner.emit('extendedBreakStarted', false, 15 * minute))
    planner.on('finishExtendedBreak', () => planner.nextBreak())
    planner.longBreakNumber = 2
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(12 * minute + 4000)
    expect(close).not.toHaveBeenCalled()
    expect(planner.scheduler.reference).toBe('finishExtendedBreak')
    expect(planner.longBreakNumber).toBe(3)
    vi.advanceTimersByTime(3 * minute)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner.longBreakNumber).toBe(1)
  })

  it('keeps a full idle reset pending if the user returns before the break ends', () => {
    values.breakDuration = 4 * minute
    values.extendedBreak = true
    values.extendedBreakDuration = 12 * minute
    values.extendedBreakInterval = 3
    const reset = vi.fn()
    planner.on('idleSessionReset', reset)
    planner.on('startExtendedBreak', () => planner.emit('extendedBreakStarted', false, 15 * minute))
    planner.on('finishExtendedBreak', () => planner.nextBreak())
    planner.longBreakNumber = 2
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(12 * minute + 4000)
    comeBack()
    expect(reset).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3 * minute)
    expect(reset).toHaveBeenCalledOnce()
    expect(planner.waitingForActivity).toBe(false)
    expect(planner.longBreakNumber).toBe(1)
  })

  it('does not pause the auto-start wait when idle begins after the window opens', () => {
    values.breakDuration = 10000
    planner.nextBreak()
    planner.waitForBreakStart('long')
    const pause = vi.fn()
    planner.on('idleRecoveryStarted', pause)
    idle.started = Date.now() + 1000
    vi.advanceTimersByTime(14000)
    expect(pause).not.toHaveBeenCalled()
    expect(planner.scheduler.waitingForStart).toBe(true)
  })

  it('holds the next countdown after a break even for idle shorter than the normal threshold', () => {
    planner.on('startBreak', () => planner.emit('breakStarted', false, 10000))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(9000)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner.scheduler.timer).toBeNull()
    vi.advanceTimersByTime(30000)
    expect(planner.timeToNextBreak).toBe(40 * minute)
    comeBack()
    expect(planner.waitingForActivity).toBe(false)
    expect(planner.scheduler.timer).not.toBeNull()
    expect(planner.timeToNextBreak).toBeGreaterThan(39 * minute)
  })

  it('holds the next countdown after an idle Mini break', () => {
    values.microbreak = true
    values.manualBreakStart = false
    values.microbreakNotification = false
    planner.on('startMicrobreak', () => planner.emit('microbreakStarted', false))
    planner.on('finishMicrobreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(20 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(values.microbreakDuration - 1000)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner.scheduler.timer).toBeNull()
    comeBack()
    expect(planner.waitingForActivity).toBe(false)
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it('continues automatically after a break when natural breaks are disabled', () => {
    planner.naturalBreaks(false)
    planner.on('startBreak', () => planner.emit('breakStarted', false, 10000))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(9000)
    expect(planner.waitingForActivity).toBe(false)
    vi.advanceTimersByTime(30000)
    expect(planner.timeToNextBreak).toBeLessThan(40 * minute)
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it('immediately resumes if natural-break monitoring is disabled during the wait', () => {
    planner.on('startBreak', () => planner.emit('breakStarted', false, 10000))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(9000)
    expect(planner.waitingForActivity).toBe(true)
    planner.naturalBreaks(false)
    expect(planner.waitingForActivity).toBe(false)
    expect(planner.scheduler.timer).not.toBeNull()
  })

  it.each(['skipToMicrobreak', 'skipToBreak', 'skipToExtendedBreak'])('%s clears a pending activity wait', action => {
    planner.on('startBreak', () => planner.emit('breakStarted', false, 10000))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    vi.advanceTimersByTime(40 * minute + 1000)
    idle.started = Date.now()
    vi.advanceTimersByTime(9000)
    expect(planner.waitingForActivity).toBe(true)
    planner[action](10000)
    expect(planner.waitingForActivity).toBe(false)
    expect(() => planner.resumeOnActivity()).not.toThrow()
  })

  it('does not restart a cancelled scheduler on a late activity event', () => {
    planner.nextBreak()
    planner.waitingForActivity = true
    planner.scheduler.cancel()
    expect(() => planner.resumeOnActivity()).not.toThrow()
    expect(planner.waitingForActivity).toBe(false)
  })

  it('still fulfills a break using idle that began before its window opened', () => {
    values.breakDuration = 4 * minute
    const close = vi.fn()
    planner.on('closeForIdle', close)
    planner.nextBreak()
    idle.started = Date.now()
    vi.advanceTimersByTime(30000)
    planner.waitForBreakStart('long')
    planner.emit('breakStarted', false, 10 * minute)
    vi.advanceTimersByTime(3.5 * minute + 4000)
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ completed: true }))
  })

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

  it('finishes a running Long and starts the next interval only after return', () => {
    planner.on('startBreak', () => planner.emit('breakStarted', false))
    planner.on('finishBreak', () => planner.nextBreak())
    planner.nextBreak()
    leave(41, 8)
    expect(planner.scheduler.timer).toBeNull()
    comeBack()
    expect(planner.waitingForActivity).toBe(false)
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
    planner.skipToBreak(10 * minute)
    planner.postponesNumber = 1
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
