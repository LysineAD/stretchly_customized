import { formatTimeIn } from './utils.js'

class StatusMessages {
  constructor ({ breakPlanner, settings, i18next, humanizeDuration }) {
    this.reference = breakPlanner.scheduler.reference
    this.idleTime = breakPlanner.naturalBreaksManager?.isSchedulerCleared
    this.doNotDisturb = breakPlanner.dndManager.isOnDnd
    this.appExclusionPause = breakPlanner.appExclusionsManager.isSchedulerCleared
    this.timeLeft = breakPlanner.scheduler.timeLeft
    this.timeToNextBreak = breakPlanner.timeToNextBreak
    this.isPaused = breakPlanner.isPaused
    this.breakNumber = breakPlanner.breakNumber
    this.longBreakNumber = breakPlanner.longBreakNumber
    this.settings = settings
    this.i18next = i18next
    this.humanizeDuration = humanizeDuration
  }

  get trayMessage () {
    let message = ''
    if (this.reference === 'finishMicrobreak' || this.reference === 'finishBreak' || this.reference === 'finishExtendedBreak') {
      return message
    }

    if (this.isPaused) {
      if (this.timeLeft) {
        message += this.i18next.t('statusMessages.paused') + ' - ' +
          this.i18next.t('statusMessages.resuming') + ' ' +
          formatTimeIn(this.timeLeft, this.settings.get('language'), this.i18next, this.humanizeDuration)
        return message
      } else {
        message += this.i18next.t('statusMessages.paused') + ' ' +
          this.i18next.t('statusMessages.indefinitely')
        return message
      }
    }

    if (this.doNotDisturb) {
      message += this.i18next.t('statusMessages.paused') + ' - ' + this.i18next.t('statusMessages.dndMode')
      return message
    }

    if (this.appExclusionPause) {
      message += this.i18next.t('statusMessages.paused') + ' - ' + this.i18next.t('statusMessages.appExclusion')
      return message
    }

    if (this.idleTime) {
      return this.i18next.t('statusMessages.paused') + ' - ' + this.i18next.t('statusMessages.idleTime')
    }

    const breakInterval = this.settings.get('breakInterval') + 1
    const breakNumber = this.breakNumber % breakInterval
    const extendedBreakInterval = this.settings.get('extendedBreakInterval')
    const longBreakNumber = this.longBreakNumber % extendedBreakInterval

    if (this.reference === 'startExtendedBreak' || this.reference === 'startExtendedBreakNotification') {
      message += this.i18next.t('statusMessages.nextExtendedBreak') + ' ' +
        formatTimeIn(this.timeToNextBreak, this.settings.get('language'), this.i18next, this.humanizeDuration)
      return message
    }

    if (this.reference === 'startBreak' || this.reference === 'startBreakNotification') {
      message += this.i18next.t('statusMessages.nextLongBreak') + ' ' +
        formatTimeIn(this.timeToNextBreak, this.settings.get('language'), this.i18next, this.humanizeDuration)
      if (this.settings.get('extendedBreak')) {
        message += '\n' + this.i18next.t('statusMessages.nextExtendedBreak') + ' ' +
          this.i18next.t('statusMessages.afterLongBreak', { count: extendedBreakInterval - longBreakNumber })
      }
      return message
    }

    if (this.reference === 'startMicrobreak' || this.reference === 'startMicrobreakNotification') {
      message += this.i18next.t('statusMessages.nextMiniBreak') + ' ' +
        formatTimeIn(this.timeToNextBreak, this.settings.get('language'), this.i18next, this.humanizeDuration)
      if (this.settings.get('break')) {
        message += '\n' + this.i18next.t('statusMessages.nextLongBreak') + ' ' +
          this.i18next.t('statusMessages.afterMiniBreak', { count: breakInterval - breakNumber })
      }
      return message
    }

    return message
  }
}

export default StatusMessages
