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
    if (wasOnIdle) this.emit('idlePeriodFinished', idleTime)
    log.info('Stretchly: stopping Idle time monitoring')
  }

  get idleTime () {
    if (this.usingNaturalBreaks) {
      return (powerMonitor.getSystemIdleTime() || desktopIdle.getIdleTime()) * 1000
    }
    return 0
  }

  _checkIdleTime () {
    let lastIdleTime = 0
    this.timer = setInterval(() => {
      const idleTime = this.idleTime
      const previousIdleTime = this.lastObservedIdleTime
      this.lastObservedIdleTime = idleTime
      this.emit('idleTimeObserved', idleTime, lastIdleTime)
      const wasOnIdle = this.isOnNaturalBreak
      if (!wasOnIdle && idleTime > 20000) {
        this.isOnNaturalBreak = true
      }
      if (this.isOnNaturalBreak && idleTime < 20000) {
        this.isOnNaturalBreak = false
        const finishedIdleTime = previousIdleTime
        this.isSchedulerCleared = false
        this.emit('idlePeriodFinished', finishedIdleTime)
      } else if (this.isOnNaturalBreak) {
        const { short, long } = getIdleThresholds(this._settingsSnapshot())
        if (idleTime >= short) {
          this.isSchedulerCleared = true
          this.emit('idleShortThresholdReached', idleTime)
        }
        if (idleTime >= long) {
          this.emit('idleLongThresholdReached', idleTime)
        }
      }
      lastIdleTime = idleTime
    }, this.naturalBreaksCheckInterval)
  }

  _settingsSnapshot () {
    return {
      naturalBreaksInactivityResetTime: this.settings.get('naturalBreaksInactivityResetTime'),
      naturalBreaksLongIdleResetTime: this.settings.get('naturalBreaksLongIdleResetTime')
    }
  }
}

export default NaturalBreaksManager
