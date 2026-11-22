import Scheduler from './utils/scheduler.js'
import EventEmitter from 'events'
import NaturalBreaksManager from './utils/naturalBreaksManager.js'
import DndManager from './utils/dndManager.js'
import AppExclusionsManager from './utils/appExclusionsManager.js'
import log from 'electron-log/main.js'

const minute = 60000
const noticeLead = minute
const larger = type => type === 'break' || type === 'extendedBreak'

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
    this.idlePeriod = null
    this.breakWindowOpenedAt = null
    this.waitingForActivity = false
    this.fullIdleResetPending = false
    this.fullIdleResetDone = false
    this.lastObservedIdle = 0
    this.naturalBreaksManager = new NaturalBreaksManager(settings)
    this.dndManager = new DndManager(settings)
    this.appExclusionsManager = new AppExclusionsManager(settings)

    this.on('microbreakStarted', (shouldPlaySound) => {
      this.breakWindowOpenedAt ??= Date.now()
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      const interval = this.settings.get('microbreakDuration')
      this.scheduler = new Scheduler(() => this.emit('finishMicrobreak', shouldPlaySound, true), interval, 'finishMicrobreak')
      this.scheduler.plan()
    })

    this.on('breakStarted', (shouldPlaySound, duration = this.settings.get('breakDuration')) => {
      this.breakWindowOpenedAt ??= Date.now()
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      this.scheduler = new Scheduler(() => this.emit('finishBreak', shouldPlaySound, true), duration, 'finishBreak')
      this.scheduler.plan()
    })

    this.on('extendedBreakStarted', (shouldPlaySound, duration = this.settings.get('extendedBreakDuration')) => {
      this.breakWindowOpenedAt ??= Date.now()
      this.notificationScheduler?.cancel()
      this.notificationScheduler = null
      this.scheduler = new Scheduler(() => this.emit('finishExtendedBreak', shouldPlaySound, true), duration, 'finishExtendedBreak')
      this.scheduler.plan()
    })

    this.naturalBreaksManager.on('idleTimeObserved', idleTime => {
      const previousIdle = this.lastObservedIdle
      this.lastObservedIdle = idleTime
      if (this.waitingForActivity) {
        const absenceStart = this.naturalBreaksManager.absenceStart
        const elapsed = idleTime < previousIdle && absenceStart !== null
          ? Math.max(previousIdle, Date.now() - idleTime - absenceStart)
          : idleTime
        if (this.isFullIdle(elapsed) && !this.fullIdleResetDone) this.resetIdleScheduleWhileWaiting()
        if (idleTime < previousIdle && !this.naturalBreaksManager.isLocked) this.resumeOnActivity()
        return
      }
      if (idleTime < this.naturalBreaksManager.minimumIdle) return
      const period = this.captureIdle(idleTime)
      if (period?.startedDuringBreak) {
        if (this.isFullIdle(idleTime)) this.fullIdleResetPending = true
        return
      }
      if (period?.duringBreak && !period.fulfilledWhileIdle && larger(period.type) &&
        idleTime >= this.settings.get(period.type + 'Duration')) {
        period.fulfilledWhileIdle = true
        this.scheduler.suspend()
        this.emit('closeForIdle', { completed: true, idleTime })
      }
    })
    this.naturalBreaksManager.on('idleShortThresholdReached', idleTime => {
      if (this.waitingForActivity) return
      const period = this.captureIdle(idleTime)
      if (period && !period.startedDuringBreak) this.holdForIdle(period)
    })
    this.naturalBreaksManager.on('idlePeriodFinished', (idleTime, returnedAt) => {
      this.finishIdleRecovery(idleTime, returnedAt)
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

  captureIdle (idleTime) {
    if (this.isPaused || !this.scheduler?.reference) return null
    if (!this.idlePeriod) {
      const next = this.largerBreaks(1)[0]
      const duringBreak = this._isFinishingBreak && larger(this._scheduledBreakType)
      this.idlePeriod = {
        from: Date.now() - idleTime,
        due: duringBreak ? this.breakDueAt : next ? Date.now() + next.after : null,
        ordinal: next?.ordinal,
        type: next?.type,
        duringBreak,
        startedDuringBreak: this.breakWindowOpenedAt !== null && Date.now() - idleTime >= this.breakWindowOpenedAt - 1000,
        breakEndsAt: duringBreak ? Date.now() + Math.max(0, this.scheduler.timeLeft || 0) : null,
        completed: false,
        pausedScheduler: null,
        held: false
      }
      if (!this.idlePeriod.startedDuringBreak) this.emit('idleCaptured', this.idlePeriod)
    }
    return this.idlePeriod
  }

  holdForIdle (period) {
    if (period.held) return
    period.held = true
    this.notificationScheduler?.suspend()
    if (this._isFinishingBreak && !this.scheduler.waitingForStart) return
    this.scheduler.suspend()
    period.pausedScheduler = this.scheduler
    this.emit('idleRecoveryStarted')
  }

  resumeAfterIdle (period, idleTime) {
    if (period.pausedScheduler !== this.scheduler) return
    if (this.scheduler.waitingForStart) {
      this.emit('resumeWaitingBreak')
    } else {
      const type = this._scheduledBreakType
      const remaining = period.completed ? this.timeToNextBreak : Math.max(0, this.breakDueAt - Date.now())
      this.scheduler.cancel()
      this._scheduleBreak(type, remaining, false)
      this.scheduler.plan()
    }
    this.emit('idleRecoveryFinished', { idleTime })
    this.emit('scheduleChanged')
    this.emit('updateToolTip')
  }

  finishIdleRecovery (idleTime, returnedAt = Date.now()) {
    const period = this.idlePeriod
    this.idlePeriod = null
    if (!period || this.isPaused || !this.scheduler?.reference) return
    if (period.startedDuringBreak) return
    const { short, long } = this.naturalBreaksManager.thresholds
    const full = this.settings.get('break') && this.settings.get('extendedBreak') && idleTime >= long
    const qualifies = idleTime >= short || full
    const overlaps = period.due !== null && period.from <= period.due && returnedAt >= period.due
    const withinNotice = period.due !== null && Math.abs(returnedAt - period.due) <= noticeLead
    const fulfills = !period.completed && larger(period.type) && (overlaps || withinNotice) &&
      idleTime >= this.settings.get(period.type + 'Duration')
    // An absence that starts during a running larger break and lasts at least as
    // long as that break fulfills it, even if the break ended while away. Anchor
    // the absence to its wall-clock start so an OS idle-counter reset cannot
    // shorten it.
    const absence = Math.max(idleTime, returnedAt - period.from)
    const coversBreak = Boolean(period.duringBreak && larger(period.type) && period.breakEndsAt !== null &&
      returnedAt >= period.breakEndsAt && absence >= this.settings.get(period.type + 'Duration'))
    const fulfilled = period.fulfilledWhileIdle || fulfills || coversBreak
    if (!qualifies && !fulfilled) {
      if (period.held) this.resumeAfterIdle(period, idleTime)
      return
    }
    if (coversBreak) period.completed = false

    const running = this._isFinishingBreak
    if (running && !period.fulfilledWhileIdle) this.emit('closeForIdle', { completed: fulfilled })
    const next = this.largerBreaks(1)[0]
    const ordinal = next?.ordinal ?? this.longBreakNumber + 1
    const postpones = this.postponesNumber
    this.scheduler?.cancel()
    this.breakNumber = 0
    this.longBreakNumber = full ? 0 : fulfilled ? period.ordinal : Math.max(0, ordinal - 1)
    this.emit('idleDebtRecovery', { period, idleTime, fulfilled, reset: full })
    this.emit('idleRecoveryFinished', { idleTime, fulfilled, reset: full })
    this.nextBreak()
    if (!full && !fulfilled && !period.completed) this.postponesNumber = postpones
    this.emit('scheduleChanged')
    this.emit('updateToolTip')
  }

  largerBreaks (count = 3) {
    if (!this.settings.get('break')) return []
    const interval = this.settings.get('microbreakInterval')
    const every = this.settings.get('breakInterval') + 1
    const type = this._scheduledBreakType
    if (!type) return []
    const upcomingMini = type === 'microbreak'
    const miniSteps = upcomingMini ? (every - this.breakNumber % every) % every : 0
    const first = Math.max(0, this.timeToNextBreak ?? 0) + miniSteps * interval
    const ordinal = this.longBreakNumber + Number(upcomingMini)
    return Array.from({ length: count }, (_, i) => {
      const number = ordinal + i
      const breakType = i === 0 && !upcomingMini
        ? type
        : this.settings.get('extendedBreak') && number % this.settings.get('extendedBreakInterval') === 0 ? 'extendedBreak' : 'break'
      return {
        type: breakType,
        ordinal: number,
        after: first + i * every * interval,
        duration: this.settings.get(breakType + 'Duration')
      }
    })
  }

  get activeBreakCadence () {
    return this.settings.get('microbreakInterval') * (this.settings.get('breakInterval') + 1)
  }

  get canPostponeLargerBreak () {
    return this.postponesNumber < this.settings.get('largerBreakPostponeLimit')
  }

  startLargerBreak () {
    if (this.isPaused || this._isFinishingBreak || !this.scheduler?.reference || this.idlePeriod?.held) return
    const next = this.largerBreaks(1)[0]
    if (!next) return
    this.waitingForActivity = false
    this.idlePeriod = null
    this.scheduler.cancel()
    this.breakNumber = this.settings.get('breakInterval') + 1
    this.longBreakNumber = next.ordinal
    this._scheduleBreak(next.type, 0)
    this.scheduler.plan()
    this.emit('scheduleChanged')
  }

  waitForBreakStart (type) {
    this.breakWindowOpenedAt = Date.now()
    if (this.idlePeriod && !this.idlePeriod.startedDuringBreak) this.idlePeriod.duringBreak = true
    this.scheduler.cancel()
    const prefix = type === 'mini' ? 'microbreak' : type === 'extended' ? 'extendedBreak' : 'break'
    const reference = type === 'mini' ? 'finishMicrobreak' : type === 'extended' ? 'finishExtendedBreak' : 'finishBreak'
    this.scheduler = new Scheduler(null, this.settings.get(prefix + 'Duration'), reference)
    this.scheduler.waitingForStart = true
  }

  markBreakWindowOpened () {
    this.breakWindowOpenedAt = Date.now()
  }

  isFullIdle (idleTime) {
    return this.naturalBreaksManager.usingNaturalBreaks && this.settings.get('break') &&
      this.settings.get('extendedBreak') && idleTime >= this.naturalBreaksManager.thresholds.long
  }

  resetIdleScheduleWhileWaiting () {
    this.scheduler?.cancel()
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.idlePeriod = null
    this.breakNumber = 0
    this.longBreakNumber = 0
    this.fullIdleResetPending = false
    this.fullIdleResetDone = true
    this.waitingForActivity = false
    this.emit('idleSessionReset')
    this.nextBreak()
    this.waitingForActivity = true
    this.scheduler?.suspend()
    this.notificationScheduler?.suspend()
  }

  resumeOnActivity () {
    if (!this.waitingForActivity) return
    this.waitingForActivity = false
    this.fullIdleResetDone = false
    if (this.scheduler?.suspendedTimeLeft !== null && typeof this.scheduler?.func === 'function') this.scheduler.plan()
    if (this.notificationScheduler?.suspendedTimeLeft !== null && typeof this.notificationScheduler?.func === 'function') this.notificationScheduler.plan()
    this.emit('scheduleChanged')
    this.emit('updateToolTip')
  }

  nextBreak () {
    const idle = this.naturalBreaksManager.idleTime
    const afterBreak = this._isFinishingBreak && this.breakWindowOpenedAt !== null
    const idleStartedDuringBreak = afterBreak && idle > 0 && Date.now() - idle >= this.breakWindowOpenedAt - 1000
    const period = this.idlePeriod || (this.naturalBreaksManager.usingNaturalBreaks && afterBreak && idle >= this.naturalBreaksManager.minimumIdle && !idleStartedDuringBreak ? this.captureIdle(idle) : null)
    const holdForActivity = afterBreak && idle > 0 && (period?.startedDuringBreak || !period)
    if (afterBreak && (this.fullIdleResetPending || (idleStartedDuringBreak && this.isFullIdle(idle)))) {
      this.breakNumber = 0
      this.longBreakNumber = 0
      this.fullIdleResetPending = false
      this.fullIdleResetDone = holdForActivity
      this.emit('idleSessionReset')
    }
    if (period?.startedDuringBreak) this.idlePeriod = null
    if (period && this._isFinishingBreak && larger(this._scheduledBreakType)) period.completed = true
    this.breakWindowOpenedAt = null
    this.postponedReminder = false
    this.postponesNumber = 0
    if (this.scheduler) this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    const shouldExtendedBreak = this.settings.get('extendedBreak')
    const interval = this.settings.get('microbreakInterval')

    if (!shouldBreak && !shouldMicrobreak) {
      this.scheduler = new Scheduler(null, 0)
      return
    }
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
    if (holdForActivity) {
      this.waitingForActivity = true
      this.lastObservedIdle = idle
      this.scheduler.suspend()
      this.notificationScheduler?.suspend()
    } else if (period && (period.held || period.completed || idle >= this.naturalBreaksManager.minimumIdle)) {
      period.held = false
      this.holdForIdle(period)
    }
    this.emit('scheduleChanged')
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
    if (larger(scheduledBreakType) && !this.canPostponeLargerBreak) return false
    this.breakWindowOpenedAt = null
    this.scheduler.cancel()
    this.postponesNumber += 1
    this.postponedReminder = true
    const miniDelay = this.settings.get('miniBreakAutoStartDelay') || this.settings.get('microbreakPostponeTime')
    const postponeTime = larger(scheduledBreakType)
      ? 2 * minute * (this.postponesNumber + Number(scheduledBreakType === 'extendedBreak'))
      : miniDelay
    this._scheduleBreak(scheduledBreakType, postponeTime)
    this.scheduler.plan()
    this.emit('scheduleChanged')
    this.emit('updateToolTip')
  }

  skipToMicrobreak (delay = 0) {
    this.waitingForActivity = false
    this.postponesNumber = 0
    this.idlePeriod = null
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

  skipToBreak (delay = 0) {
    this.waitingForActivity = false
    this.postponesNumber = 0
    const next = this.largerBreaks(1)[0]
    const pastCurrent = this._isFinishingBreak && larger(this._scheduledBreakType)
    this.idlePeriod = null
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    this.postponedReminder = false
    this.reminderLead = this.preparationLead('break', Infinity)
    this.breakDueAt = Date.now() + delay + this.reminderLead
    this.scheduler.cancel()
    const shouldBreak = this.settings.get('break')
    const shouldMicrobreak = this.settings.get('microbreak')
    if (next) this.longBreakNumber = next.ordinal + Number(pastCurrent)
    if (shouldBreak && shouldMicrobreak) {
      const breakInterval = this.settings.get('breakInterval') + 1
      this.breakNumber = breakInterval
    }
    this.scheduler = new Scheduler(() => this.emit('startBreak'), delay, 'startBreak')
    this.scheduler.plan()
    this.emit('updateToolTip')
  }

  skipToExtendedBreak (delay = 0) {
    this.waitingForActivity = false
    this.postponesNumber = 0
    this.idlePeriod = null
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
    this.idlePeriod = null
    this.breakWindowOpenedAt = null
    this.waitingForActivity = false
    this.fullIdleResetPending = false
    this.fullIdleResetDone = false
    this.scheduler?.cancel()
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
      this.resumeOnActivity()
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
    return ['finishMicrobreak', 'finishBreak', 'finishExtendedBreak'].includes(this.scheduler?.reference)
  }

  preparationLead (type, interval) {
    if (larger(type) || !this.settings.get('manualBreakStart') || this.postponedReminder) return 0
    const lead = this.settings.get('miniBreakAutoStartDelay')
    return Number.isFinite(lead) ? Math.max(0, Math.min(lead, interval)) : 0
  }

  _scheduleBreak (type, interval, notify = true) {
    this.notificationScheduler?.cancel()
    this.notificationScheduler = null
    const eventBase = type.charAt(0).toUpperCase() + type.slice(1)
    const notification = this.settings.get(`${type}Notification`)
    const notificationInterval = larger(type) ? noticeLead : this.settings.get(`${type}NotificationInterval`)
    this.reminderLead = this.preparationLead(type, interval)
    if (larger(type) || !this.postponedReminder) this.breakDueAt = Date.now() + interval
    if (larger(type) || this.settings.get('manualBreakStart') || this.postponedReminder) {
      this.scheduler = new Scheduler(() => {
        const idle = this.naturalBreaksManager.idleTime
        if (larger(type) && idle > 0 && idle >= Math.min(noticeLead, this.naturalBreaksManager.thresholds.short)) {
          const period = this.captureIdle(idle)
          if (period) {
            this.holdForIdle(period)
            return
          }
        }
        this.emit(`start${eventBase}`)
      }, interval - this.reminderLead, `start${eventBase}`)
      if (notify && notification && (!larger(type) || !this.postponedReminder) && interval >= notificationInterval && notificationInterval > 0) {
        this.notificationScheduler = new Scheduler(() => this.emit(`start${eventBase}Notification`, false), interval - notificationInterval, `notify${eventBase}`)
        this.notificationScheduler.plan()
      }
    } else if (notify && notification && interval > notificationInterval) {
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
