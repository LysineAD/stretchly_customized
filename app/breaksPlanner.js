import Scheduler from './utils/scheduler.js'
import EventEmitter from 'events'
import NaturalBreaksManager from './utils/naturalBreaksManager.js'
import DndManager from './utils/dndManager.js'
import AppExclusionsManager from './utils/appExclusionsManager.js'
import log from 'electron-log/main.js'

class BreaksPlanner extends EventEmitter {
  constructor (settings) {
    super()
    this.settings = settings
    this.breakNumber = 0
    this.longBreakNumber = 0
    this.postponesNumber = 0
    this.scheduler = null
    this.notificationScheduler = null
    this.breakDueAt = null
    this.reminderLead = 0
    this.postponedReminder = false
    this.isPaused = false
    this.pollersSuspended = false
    this.idlePausedScheduler = null
    this.applyingIdleRecovery = false
    this.idleRecoveryActive = false
    this.idleRecoveryEscalated = false
    this.idleRecoveryPendingShort = false
    this.idleRecoveryPendingFull = false
    this.idleRecoveryIdleTime = 0
    this.idleRecoveryShortApplied = false
    this.idleRecoveryFullApplied = false
    this.idleRecoveryPendingFinishIdleTime = null
    this.naturalBreaksManager = new NaturalBreaksManager(settings)
    this.dndManager = new DndManager(settings)
    this.appExclusionsManager = new AppExclusionsManager(settings)

    this.on('microbreakStarted', (shouldPlaySound) => {
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      const interval = this.settings.get('microbreakDuration')
      this.scheduler = new Scheduler(() => this.emit('finishMicrobreak', shouldPlaySound, true), interval, 'finishMicrobreak')
      this.scheduler.plan()
    })

    this.on('breakStarted', (shouldPlaySound) => {
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      const interval = this.settings.get('breakDuration')
      this.scheduler = new Scheduler(() => this.emit('finishBreak', shouldPlaySound, true), interval, 'finishBreak')
      this.scheduler.plan()
    })

    this.on('extendedBreakStarted', (shouldPlaySound) => {
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      const interval = this.settings.get('extendedBreakDuration')
      this.scheduler = new Scheduler(() => this.emit('finishExtendedBreak', shouldPlaySound, true), interval, 'finishExtendedBreak')
      this.scheduler.plan()
    })

    this.naturalBreaksManager.on('idleTimeObserved', () => {
      this.applyPendingIdleRecovery()
    })

    this.naturalBreaksManager.on('idleShortThresholdReached', idleTime => {
      if (this.isPaused || !this.scheduler?.reference) return
      if (!this.idleRecoveryActive) {
        this.idleRecoveryActive = true
        this.idleRecoveryEscalated = false
        this.idleRecoveryShortApplied = false
        this.idleRecoveryFullApplied = false
        this.idleRecoveryIdleTime = idleTime
        this.emit('idleRecoveryStarted', { idleTime, fullReset: false })
      }
      if (this._isFinishingBreak) {
        this.idleRecoveryPendingShort = true
      } else {
        this.applyShortIdleRecovery()
      }
    })

    this.naturalBreaksManager.on('idleLongThresholdReached', idleTime => {
      if (!this.idleRecoveryActive || this.isPaused) return
      this.idleRecoveryIdleTime = idleTime
      if (!this.idleRecoveryEscalated) {
        this.idleRecoveryEscalated = true
        this.emit('idleRecoveryEscalated')
      }
      if (this._isFinishingBreak) {
        this.idleRecoveryPendingFull = true
      } else {
        this.applyFullIdleRecovery()
      }
    })

    this.naturalBreaksManager.on('idlePeriodFinished', idleTime => {
      this.finishIdleRecovery(idleTime)
    })

    this.dndManager.on('dndStarted', () => {
      if (!this.isPaused && !this._isFinishingBreak && this.scheduler.reference !== null) {
        this.clear()
        log.info('Stretchly: pausing breaks for Do Not Distrub')
        this.emit('updateToolTip')
      } else {
        this.dndManager.isOnDnd = false
      }
    })

    this.dndManager.on('dndFinished', () => {
      if (!this.isPaused && !this._isFinishingBreak) {
        this.reset()
        log.info('Stretchly: resuming breaks for Do Not Distrub')
        this.emit('updateToolTip')
      }
    })

    this.appExclusionsManager.on('appExclusionStarted', (rule, exclusion) => {
      if (rule === 'pause') {
        if (!this.isPaused && !this._isFinishingBreak && this.scheduler.reference !== null) {
          this.clear()
          log.info(`Stretchly: pausing breaks as 'pause' exclusion found running: '${exclusion}'`)
          this.emit('updateToolTip')
        } else if (!this.isPaused && this.scheduler.reference === 'finishBreak') {
          this.emit('finishBreak', false, false)
          this.clear()
          log.info(`Stretchly: closing current and pausing breaks as 'pause' exclusion found running: '${exclusion}'`)
          this.emit('updateToolTip')
        } else if (!this.isPaused && this.scheduler.reference === 'finishMicrobreak') {
          this.emit('finishMicrobreak', false, false)
          this.clear()
          log.info(`Stretchly: closing current and pausing breaks as 'pause' exclusion found running: '${exclusion}'`)
          this.emit('updateToolTip')
        } else if (!this.isPaused && this.scheduler.reference === 'finishExtendedBreak') {
          this.emit('finishExtendedBreak', false, false)
          this.clear()
          log.info(`Stretchly: closing current and pausing breaks as 'pause' exclusion found running: '${exclusion}'`)
          this.emit('updateToolTip')
        } else {
          this.appExclusionsManager.isOnAppExclusion = false
        }
      } else if (rule === 'resume') {
        if (!this.isPaused && !this._isFinishingBreak) {
          this.reset()
          log.info(`Stretchly: resuming breaks as 'resume' exclusion found running: '${exclusion}'`)
          this.emit('updateToolTip')
        }
      }
    })

    this.appExclusionsManager.on('appExclusionFinished', (rule) => {
      if (rule === 'pause') {
        if (!this.isPaused && !this._isFinishingBreak) {
          this.reset()
          log.info("Stretchly: resuming breaks as no 'pause' exclusion found running")
          this.emit('updateToolTip')
        }
      } else if (rule === 'resume') {
        if (!this.isPaused && !this._isFinishingBreak && this.scheduler.reference !== null) {
          this.clear()
          log.info("Stretchly: pausing breaks as no 'resume' exclusion found running")
          this.emit('updateToolTip')
        } else {
          this.appExclusionsManager.isOnAppExclusion = true
        }
      }
    })
  }

  applyPendingIdleRecovery () {
    if (!this.idleRecoveryActive || this.isPaused || this._isFinishingBreak || !this.scheduler?.reference) return
    if (this.idleRecoveryPendingFull) {
      this.idleRecoveryPendingFull = false
      this.idleRecoveryPendingShort = false
      this.applyFullIdleRecovery()
    } else if (this.idleRecoveryPendingShort) {
      this.idleRecoveryPendingShort = false
      this.applyShortIdleRecovery()
    }
    if (this.idleRecoveryPendingFinishIdleTime !== null && !this._isFinishingBreak) {
      const idleTime = this.idleRecoveryPendingFinishIdleTime
      this.idleRecoveryPendingFinishIdleTime = null
      this.finishIdleRecovery(idleTime)
    }
  }

  applyShortIdleRecovery () {
    if (!this.idleRecoveryActive || this.idleRecoveryShortApplied || this._isFinishingBreak || !this.scheduler?.reference) return
    this.idleRecoveryShortApplied = true
    const scheduledType = this._scheduledBreakType
    const breakEnabled = this.settings.get('break')
    const miniEnabled = this.settings.get('microbreak')
    const isScheduledLong = breakEnabled && (!miniEnabled || scheduledType === 'break' || scheduledType === 'extendedBreak')

    this.scheduler.cancel()
    this.postponesNumber = 0
    this.breakNumber = 0
    if (isScheduledLong) this.longBreakNumber = Math.max(0, this.longBreakNumber - 1)
    this.planIdleRecovery()
    log.info('Stretchly: restarting the current Long cycle after idle time')
    this.emit('updateToolTip')
  }

  applyFullIdleRecovery () {
    if (!this.idleRecoveryActive || this.idleRecoveryFullApplied || this._isFinishingBreak || !this.scheduler?.reference) return
    this.idleRecoveryFullApplied = true
    this.scheduler.cancel()
    this.idlePausedScheduler = null
    this.breakNumber = 0
    this.longBreakNumber = 0
    this.postponesNumber = 0
    this.planIdleRecovery()
    this.idleRecoveryPendingShort = false
    this.idleRecoveryPendingFull = false
    log.info('Stretchly: resetting the full schedule after extended idle time')
    this.emit('updateToolTip')
  }

  planIdleRecovery () {
    this.applyingIdleRecovery = true
    try { this.nextBreak() } finally { this.applyingIdleRecovery = false }
    this.scheduler.suspend(this.scheduler.delay)
    this.notificationScheduler?.suspend()
    this.idlePausedScheduler = this.scheduler
  }

  finishIdleRecovery (idleTime) {
    if (!this.idleRecoveryActive) return
    if (this._isFinishingBreak && (this.idleRecoveryPendingShort || this.idleRecoveryPendingFull)) {
      this.idleRecoveryPendingFinishIdleTime = idleTime
      return
    }
    const finishedIdleTime = Math.max(this.idleRecoveryIdleTime, idleTime)
    this.idleRecoveryPendingShort = false
    this.idleRecoveryPendingFull = false
    this.idleRecoveryIdleTime = finishedIdleTime
    this.idleRecoveryActive = false
    this.idleRecoveryEscalated = false
    this.emit('idleRecoveryFinished', { idleTime: finishedIdleTime })
    if (!this.isPaused && !this._isFinishingBreak && !this.dndManager.isOnDnd &&
        !this.appExclusionsManager.isSchedulerCleared) {
      if (this.idlePausedScheduler === this.scheduler) {
        this.breakDueAt = Date.now() + this.timeToNextBreak
        this.idlePausedScheduler = null
        this.scheduler.plan()
        this.notificationScheduler?.plan()
      }
      log.info('Stretchly: resuming breaks after idle time')
      this.emit('updateToolTip')
    }
    this.idleRecoveryIdleTime = 0
    this.idleRecoveryShortApplied = false
    this.idleRecoveryFullApplied = false
    this.idleRecoveryPendingFinishIdleTime = null
  }

  waitForBreakStart (type) {
    this.scheduler.cancel()
    const prefix = type === 'mini' ? 'microbreak' : type === 'extended' ? 'extendedBreak' : 'break'
    const reference = type === 'mini' ? 'finishMicrobreak' : type === 'extended' ? 'finishExtendedBreak' : 'finishBreak'
    this.scheduler = new Scheduler(null, this.settings.get(prefix + 'Duration'), reference)
    this.scheduler.waitingForStart = true
  }

  nextBreak () {
    this.postponedReminder = false
    this.postponesNumber = 0
    if (this.scheduler) this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    const shouldExtendedBreak = this.settings.get('extendedBreak')
    const interval = this.settings.get('microbreakInterval')

    if (!shouldBreak && shouldMicrobreak) {
      this._scheduleBreak('microbreak', interval)
    } else if (shouldBreak && !shouldMicrobreak) {
      this.longBreakNumber += 1
      if (shouldExtendedBreak && this.longBreakNumber % this.settings.get('extendedBreakInterval') === 0) {
        this._scheduleBreak('extendedBreak', interval * (this.settings.get('breakInterval') + 1))
      } else {
        this._scheduleBreak('break', interval * (this.settings.get('breakInterval') + 1))
      }
    } else if (shouldBreak && shouldMicrobreak) {
      this.breakNumber = this.breakNumber + 1
      const breakInterval = this.settings.get('breakInterval') + 1
      if (this.breakNumber % breakInterval === 0) {
        this.longBreakNumber += 1
        if (shouldExtendedBreak && this.longBreakNumber % this.settings.get('extendedBreakInterval') === 0) {
          this._scheduleBreak('extendedBreak', interval)
        } else {
          this._scheduleBreak('break', interval)
        }
      } else {
        this._scheduleBreak('microbreak', interval)
      }
    }
    this.scheduler.plan()
    if (!this.applyingIdleRecovery) this.applyPendingIdleRecovery()
  }

  nextBreakAfterNotification () {
    const scheduledBreakType = this._scheduledBreakType
    this.scheduler.cancel()
    const breakNotificationInterval = this.settings.get(`${scheduledBreakType}NotificationInterval`)
    const eventName = `start${scheduledBreakType.charAt(0).toUpperCase() + scheduledBreakType.slice(1)}`
    this.scheduler = new Scheduler(() => this.emit(eventName), breakNotificationInterval, eventName)
    this.scheduler.plan()
  }

  postponeCurrentBreak () {
    const scheduledBreakType = this._scheduledBreakType
    this.scheduler.cancel()
    this.postponesNumber += 1
    this.postponedReminder = true
    const delayKey = scheduledBreakType === 'microbreak' ? 'miniBreakAutoStartDelay' : scheduledBreakType === 'extendedBreak' ? 'extendedBreakAutoStartDelay' : 'longBreakAutoStartDelay'
    const preparation = this.settings.get(delayKey)
    const postponeTime = preparation > 0 ? preparation : this.settings.get(`${scheduledBreakType}PostponeTime`)
    this._scheduleBreak(scheduledBreakType, postponeTime)
    this.scheduler.plan()
    this.emit('updateToolTip')
  }

  skipToMicrobreak (delay = 100) {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.postponedReminder = false
    this.reminderLead = this.preparationLead('microbreak', Infinity)
    this.breakDueAt = Date.now() + delay + this.reminderLead
    this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    if (shouldBreak && shouldMicrobreak) {
      const breakInterval = this.settings.get('breakInterval') + 1
      if (this.breakNumber % breakInterval === 0) {
        this.breakNumber = 1
      }
    }
    this.scheduler = new Scheduler(() => this.emit('startMicrobreak'), delay, 'startMicrobreak')
    this.scheduler.plan()
    this.emit('updateToolTip')
  }

  skipToBreak (delay = 100) {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.postponedReminder = false
    this.reminderLead = this.preparationLead('break', Infinity)
    this.breakDueAt = Date.now() + delay + this.reminderLead
    this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    if (shouldBreak && shouldMicrobreak) {
      const breakInterval = this.settings.get('breakInterval') + 1
      this.breakNumber = breakInterval
    }
    this.scheduler = new Scheduler(() => this.emit('startBreak'), delay, 'startBreak')
    this.scheduler.plan()
    this.emit('updateToolTip')
  }

  skipToExtendedBreak (delay = 100) {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.postponedReminder = false
    this.reminderLead = this.preparationLead('extendedBreak', Infinity)
    this.breakDueAt = Date.now() + delay + this.reminderLead
    this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    if (shouldBreak && shouldMicrobreak) {
      this.breakNumber = this.settings.get('breakInterval') + 1
    }
    this.longBreakNumber = this.settings.get('extendedBreakInterval')
    this.scheduler = new Scheduler(() => this.emit('startExtendedBreak'), delay, 'startExtendedBreak')
    this.scheduler.plan()
    this.emit('updateToolTip')
  }

  clear () {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.breakDueAt = null
    this.reminderLead = 0
    this.postponedReminder = false
    this.idlePausedScheduler = null
    this.idleRecoveryActive = false
    this.idleRecoveryEscalated = false
    this.idleRecoveryPendingShort = false
    this.idleRecoveryPendingFull = false
    this.idleRecoveryIdleTime = 0
    this.idleRecoveryShortApplied = false
    this.idleRecoveryFullApplied = false
    this.idleRecoveryPendingFinishIdleTime = null
    this.scheduler.cancel()
    this.breakNumber = 0
    this.longBreakNumber = 0
    this.postponesNumber = 0
  }

  pause (milliseconds) {
    this.clear()
    this.isPaused = true
    this.pollersSuspended = true
    this.naturalBreaksManager.stop()
    this.dndManager.stop()
    this.appExclusionsManager.stop()
    if (milliseconds !== 1) {
      this.scheduler = new Scheduler(() => this.emit('resumeBreaks'), milliseconds, 'resumeBreaks')
      this.scheduler.plan()
    }
  }

  resume () {
    this.scheduler.cancel()
    this.isPaused = false
    this.appExclusionsManager.reset()
    this.nextBreak()
    if (this.pollersSuspended) {
      this.pollersSuspended = false
      if (this.settings.get('naturalBreaks')) this.naturalBreaksManager.start()
      if (this.settings.get('monitorDnd')) this.dndManager.start()
      this.appExclusionsManager.reinitialize(this.settings)
    }
  }

  correctScheduler () {
    if (this.scheduler) this.scheduler.correct()
    this.notificationScheduler?.correct()
  }

  reset () {
    this.clear()
    this.resume()
  }

  get _scheduledBreakType () {
    const reference = this.scheduler?.reference
    if (reference === 'startExtendedBreak' || reference === 'startExtendedBreakNotification' || reference === 'finishExtendedBreak') {
      return 'extendedBreak'
    }
    if (reference === 'startBreak' || reference === 'startBreakNotification' || reference === 'finishBreak') {
      return 'break'
    }
    if (reference === 'startMicrobreak' || reference === 'startMicrobreakNotification' || reference === 'finishMicrobreak') {
      return 'microbreak'
    }
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    const shouldExtendedBreak = this.settings.get('extendedBreak')
    const breakInterval = this.settings.get('breakInterval') + 1
    let scheduledBreakType
    if (shouldBreak && shouldMicrobreak) {
      scheduledBreakType = this.breakNumber % breakInterval !== 0 ? 'microbreak' : this._scheduledLongBreakType(shouldExtendedBreak)
    } else if (!shouldBreak) {
      scheduledBreakType = 'microbreak'
    } else if (!shouldMicrobreak) {
      scheduledBreakType = this._scheduledLongBreakType(shouldExtendedBreak)
    }
    return scheduledBreakType
  }

  naturalBreaks (shouldUse) {
    if (shouldUse) {
      this.naturalBreaksManager.start()
    } else {
      this.naturalBreaksManager.stop()
    }
  }

  doNotDisturb (shouldUse) {
    if (shouldUse) {
      this.dndManager.start()
    } else {
      this.dndManager.stop()
      if (!this.isPaused && this.scheduler.reference === null) {
        this.reset()
      }
    }
  }

  get timeToNextBreak () {
    if (!this.scheduler) return null
    if (this.scheduler.reference === 'startMicrobreak' || this.scheduler.reference === 'startBreak' || this.scheduler.reference === 'startExtendedBreak') {
      return this.scheduler.timeLeft + this.reminderLead
    }
    if (this.scheduler.reference === 'startExtendedBreakNotification') {
      return this.scheduler.timeLeft + (this.settings.get('extendedBreakNotification')
        ? this.settings.get('extendedBreakNotificationInterval')
        : 0)
    }
    if (this.scheduler.reference === 'startBreakNotification') {
      return this.scheduler.timeLeft + (this.settings.get('breakNotification')
        ? this.settings.get('breakNotificationInterval')
        : 0)
    }
    if (this.scheduler.reference === 'startMicrobreakNotification') {
      return this.scheduler.timeLeft + (this.settings.get('microbreakNotification')
        ? this.settings.get('microbreakNotificationInterval')
        : 0)
    }
    return null
  }

  get _progressInterval () {
    if (!this.scheduler) return null
    const { reference, delay } = this.scheduler

    if (reference === 'startMicrobreak' || reference === 'startBreak' || reference === 'startExtendedBreak') {
      return delay + this.reminderLead
    }

    if (reference === 'startExtendedBreakNotification') {
      return delay + this.settings.get('extendedBreakNotificationInterval')
    }

    if (reference === 'startBreakNotification') {
      return delay + this.settings.get('breakNotificationInterval')
    }

    if (reference === 'startMicrobreakNotification') {
      return delay + this.settings.get('microbreakNotificationInterval')
    }

    return null
  }

  get _isFinishingBreak () {
    return this.scheduler.reference === 'finishMicrobreak' ||
      this.scheduler.reference === 'finishBreak' ||
      this.scheduler.reference === 'finishExtendedBreak'
  }

  preparationLead (type, interval) {
    if (!this.settings.get('manualBreakStart') || this.postponedReminder) return 0
    const key = type === 'microbreak' ? 'miniBreakAutoStartDelay' : type === 'extendedBreak' ? 'extendedBreakAutoStartDelay' : 'longBreakAutoStartDelay'
    const lead = this.settings.get(key)
    return Number.isFinite(lead) ? Math.max(0, Math.min(lead, interval)) : 0
  }

  _scheduleBreak (type, interval) {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    const eventBase = type.charAt(0).toUpperCase() + type.slice(1)
    const notification = this.settings.get(`${type}Notification`)
    const notificationInterval = this.settings.get(`${type}NotificationInterval`)
    this.reminderLead = this.preparationLead(type, interval)
    if (!this.postponedReminder) this.breakDueAt = Date.now() + interval
    if (this.settings.get('manualBreakStart') || this.postponedReminder) {
      this.scheduler = new Scheduler(() => this.emit(`start${eventBase}`), interval - this.reminderLead, `start${eventBase}`)
      if (notification && interval > notificationInterval) {
        this.notificationScheduler = new Scheduler(() => this.emit(`start${eventBase}Notification`, false), interval - notificationInterval, `notify${eventBase}`)
        this.notificationScheduler.plan()
      }
    } else if (notification && interval > notificationInterval) {
      this.scheduler = new Scheduler(() => this.emit(`start${eventBase}Notification`), interval - notificationInterval, `start${eventBase}Notification`)
    } else {
      this.scheduler = new Scheduler(() => this.emit(`start${eventBase}`), interval, `start${eventBase}`)
    }
  }

  _scheduledLongBreakType (shouldExtendedBreak) {
    return shouldExtendedBreak && this.longBreakNumber % this.settings.get('extendedBreakInterval') === 0
      ? 'extendedBreak'
      : 'break'
  }

  get progressPercentage () {
    const total = this._progressInterval
    const remaining = this.timeToNextBreak
    if (total === null || total <= 0 || remaining === null) return 0

    const progress = 1 - (remaining / total)
    return Math.max(0, Math.min(100, Math.round(progress * 100)))
  }
}

export default BreaksPlanner
