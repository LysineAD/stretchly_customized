import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BreaksPlanner from '../app/breaksPlanner.js'
import defaultSettings from '../app/utils/defaultSettings.js'

const idle = vi.hoisted(() => ({ started: null, locked: false }))
vi.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: () => idle.started === null ? 0 : Math.floor((Date.now() - idle.started) / 1000), getSystemIdleState: () => idle.locked ? 'locked' : 'active' }
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

const minute = 60000

describe('AFK that outlasts a running Long break (Mini breaks enabled)', () => {
  let planner, values, finished, managerReturns

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
    idle.started = null
    idle.locked = false
    values = {
      ...defaultSettings,
      naturalBreaksCheckInterval: 2000,
      microbreakInterval: 20 * minute,
      microbreakDuration: 20000,
      breakInterval: 1,
      breakDuration: 4 * minute,
      extendedBreak: true,
      extendedBreakDuration: 12 * minute,
      extendedBreakInterval: 2,
      microbreak: true,
      manualBreakStart: true,
      miniBreakAutoStartDelay: 10000,
      microbreakNotification: false,
      breakNotification: false,
      extendedBreakNotification: false
    }
    planner = new BreaksPlanner({ get: key => values[key] })
    finished = vi.fn()
    managerReturns = vi.fn()
    planner.on('idleRecoveryFinished', finished)
    planner.naturalBreaksManager.on('idlePeriodFinished', managerReturns)
    planner.on('startMicrobreak', () => {
      planner.waitForBreakStart('mini')
      planner.emit('microbreakStarted', false)
    })
    planner.on('finishMicrobreak', () => planner.nextBreak())
    planner.on('startBreak', () => {
      planner.waitForBreakStart('long')
      planner.emit('breakStarted', false, values.breakDuration)
    })
    planner.on('finishBreak', () => planner.nextBreak())
    planner.on('startExtendedBreak', () => {
      planner.waitForBreakStart('extended')
      planner.emit('extendedBreakStarted', false, values.extendedBreakDuration)
    })
    planner.on('finishExtendedBreak', () => planner.nextBreak())
    planner.nextBreak()
  })

  afterEach(() => {
    planner.clear()
    planner.naturalBreaksManager.stop()
    vi.useRealTimers()
  })

  // The Long break is due 40m10s after startup (20s Mini break + 10s preparation lead).
  // Start the absence 10 seconds after the break begins.
  const leaveDuringLongBreak = () => {
    vi.advanceTimersByTime(40 * minute + 20000)
    idle.started = Date.now()
  }

  const comeBack = () => {
    idle.started = null
    vi.advanceTimersByTime(4000)
  }

  it('finishes the full break and waits for activity before starting the next Mini interval', () => {
    leaveDuringLongBreak()
    vi.advanceTimersByTime(6 * minute)
    expect(planner.waitingForActivity).toBe(true)
    expect(planner._scheduledBreakType).toBe('microbreak')
    comeBack()
    expect(planner.waitingForActivity).toBe(false)
    expect(planner._scheduledBreakType).toBe('microbreak')
    expect(planner.timeToNextBreak).toBe(20 * minute)
    expect(planner.longBreakNumber).toBe(1)
  })

  it('still restarts the full interval when the OS idle counter resets mid-absence', () => {
    leaveDuringLongBreak()
    // The Long break ends while away and the successor Mini is suspended.
    vi.advanceTimersByTime(4 * minute)
    expect(planner.waitingForActivity).toBe(true)
    // A screen-lock / session glitch restarts the OS idle counter from zero.
    idle.started = Date.now()
    idle.locked = true
    vi.advanceTimersByTime(2 * minute + 2000)
    expect(planner.waitingForActivity).toBe(true)
    idle.locked = false
    comeBack()
    expect(managerReturns).toHaveBeenCalledOnce()
    expect(planner.waitingForActivity).toBe(false)
    expect(planner.timeToNextBreak).toBe(20 * minute)
  })

  it('keeps an early AFK from consuming the upcoming larger break', () => {
    vi.advanceTimersByTime(18 * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(3 * minute)
    const longBreakNumberBefore = planner.longBreakNumber
    comeBack()
    expect(finished).toHaveBeenCalledOnce()
    expect(finished.mock.calls[0][0].fulfilled).toBeFalsy()
    expect(planner.longBreakNumber).toBe(longBreakNumberBefore)
  })

  it('recognizes a return even when the idle counter grows after one input', () => {
    vi.advanceTimersByTime(18 * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(5 * minute)
    idle.started = Date.now()
    vi.advanceTimersByTime(4000)
    expect(managerReturns).toHaveBeenCalledOnce()
  })
})
