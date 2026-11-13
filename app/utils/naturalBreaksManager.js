import EventEmitter from 'events'
import log from 'electron-log/main.js'
import { desktopIdle } from 'node-desktop-idle-v2'
import { powerMonitor } from 'electron'
import { getIdleThresholds } from './idleThresholds.js'

class NaturalBreaksManager extends EventEmitter {
  constructor (settings) {
    super()
    this.settings = settings
    this.usingNaturalBreaks = settings.get('naturalBreaks')
    this.naturalBreaksCheckInterval = settings.get('naturalBreaksCheckInterval')
    this.timer = null
    this.isOnNaturalBreak = false
    this.isSchedulerCleared = false
    this.lastObservedIdleTime = 0
    if (this.usingNaturalBreaks) this.start()
  }

  start () {
    if (this.timer) return
    this.usingNaturalBreaks = true
    desktopIdle.startMonitoring()
    this._checkIdleTime()
    log.info('Stretchly: starting Idle time monitoring')
  }

  stop () {
    if (!this.timer) return
    const wasOnIdle = this.isOnNaturalBreak
    const idleTime = this.lastObservedIdleTime
    this.usingNaturalBreaks = false
    this.isOnNaturalBreak = false
    this.isSchedulerCleared = false
    this.lastObservedIdleTime = 0
    clearInterval(this.timer)
    this.timer = null
    desktopIdle.stopMonitoring()
    if (wasOnIdle) this.emit('idlePeriodFinished', idleTime, Date.now())
    log.info('Stretchly: stopping Idle time monitoring')
  }

  get idleTime () {
    if (this.usingNaturalBreaks) {
      return (powerMonitor.getSystemIdleTime() || desktopIdle.getIdleTime()) * 1000
    }
    return 0
  }

  get thresholds () {
    if (this.settings.get('break')) {
      return {
        short: this.settings.get('breakDuration'),
        long: this.settings.get('extendedBreak') ? this.settings.get('extendedBreakDuration') : Infinity
      }
    }
    return getIdleThresholds({
      naturalBreaksInactivityResetTime: this.settings.get('naturalBreaksInactivityResetTime'),
      naturalBreaksLongIdleResetTime: this.settings.get('naturalBreaksLongIdleResetTime')
    })
  }

  get minimumIdle () {
    return Math.min(20000, this.thresholds.short, this.thresholds.long)
  }

  _checkIdleTime () {
    let previousAt = 0
    this.timer = setInterval(() => {
      const now = Date.now()
      const idleTime = this.idleTime
      const previousIdleTime = this.lastObservedIdleTime
      const minimum = this.minimumIdle
      this.lastObservedIdleTime = idleTime
      if (this.isOnNaturalBreak && (idleTime < minimum || now - idleTime > previousAt - previousIdleTime + 1500)) {
        this.isOnNaturalBreak = false
        this.isSchedulerCleared = false
        const returnedAt = now - idleTime
        const elapsed = Math.max(previousIdleTime, returnedAt - (previousAt - previousIdleTime))
        this.emit('idleTimeObserved', elapsed, previousIdleTime, returnedAt)
        this.emit('idlePeriodFinished', elapsed, returnedAt)
      }
      if (idleTime >= minimum) {
        this.isOnNaturalBreak = true
        this.emit('idleTimeObserved', idleTime, previousIdleTime)
        if (idleTime >= Math.min(this.thresholds.short, this.thresholds.long)) {
          this.isSchedulerCleared = true
          this.emit('idleShortThresholdReached', idleTime)
        }
      } else this.emit('idleTimeObserved', idleTime, previousIdleTime)
      previousAt = now
    }, this.naturalBreaksCheckInterval)
  }
}

export default NaturalBreaksManager
