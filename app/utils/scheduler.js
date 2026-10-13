class Scheduler {
  constructor (func, delay, reference = null) {
    this.timer = null
    this.delay = delay
    this.func = func
    this.reference = reference
    this.suspendedTimeLeft = null
  }

  get timeLeft () {
    if (this.suspendedTimeLeft !== null) return this.suspendedTimeLeft
    if (this.waitingForStart) return this.delay
    if (this.timer === null) return false
    return this.now + this.delay - Date.now()
  }

  plan () {
    const remaining = this.suspendedTimeLeft ?? this.delay
    this.suspendedTimeLeft = null
    this.now = Date.now() - (this.delay - remaining)
    this.timer = setTimeout(this.func, remaining)
  }

  suspend (remaining = this.timeLeft) {
    if (this.timer === null || this.suspendedTimeLeft !== null) return
    this.suspendedTimeLeft = Math.max(0, remaining)
    this.delay = Math.max(this.delay, this.suspendedTimeLeft)
    clearTimeout(this.timer)
    this.timer = null
  }

  correct () {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = setTimeout(this.func, this.timeLeft)
  }

  cancel () {
    this.suspendedTimeLeft = null
    this.waitingForStart = false
    clearTimeout(this.timer)
    this.timer = null
    this.reference = null
    this.func = null
  }
}

export default Scheduler
