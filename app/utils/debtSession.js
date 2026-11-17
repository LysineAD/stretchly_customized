import DebtAllocation from './debtAllocation.js'

const nonnegative = value => Number.isFinite(value) && value > 0 ? value : 0

export default class DebtSession {
  static restore (data = {}) {
    if (data.modelVersion === 4) return new DebtSession({ ...data, postponing: false })
    return new DebtSession({ amount: data.modelVersion === 3 ? data.balance : 0 })
  }

  constructor ({ amount = 0, allocation, work = 0, cycleWork = 0, extendedCharged = 0, postponing = false } = {}) {
    this.debt = allocation ? DebtAllocation.restore(allocation) : new DebtAllocation(amount)
    this.work = nonnegative(work)
    this.cycleWork = nonnegative(cycleWork)
    this.extendedCharged = nonnegative(extendedCharged)
    this.postponing = Boolean(postponing)
    this.recentWork = []
  }

  recordWork (elapsed, rate, to) {
    if (!(elapsed > 0)) return
    if (this.postponing) this.debt.addPostponedWork(elapsed, rate)
    else {
      this.work += elapsed
      this.cycleWork += elapsed
    }
    if (Number.isFinite(to)) {
      this.recentWork.push({ from: to - elapsed, to, rate, postponing: this.postponing })
      this.recentWork = this.recentWork.filter(span => span.to > to - 3600000)
    }
  }

  correctIdle (from, to) {
    for (const span of this.recentWork) {
      const overlap = Math.max(0, Math.min(to, span.to) - Math.max(from, span.from))
      if (!overlap) continue
      if (span.postponing) this.debt.correctCharge(overlap * span.rate)
      else {
        this.work = Math.max(0, this.work - overlap)
        this.cycleWork = Math.max(0, this.cycleWork - overlap)
      }
    }
    this.recentWork = this.recentWork.filter(span => span.to <= from || span.from >= to)
  }

  postpone () {
    this.postponing = true
  }

  returned () {
    this.postponing = false
  }

  complete (type, assigned, elapsedExtra) {
    this.debt.pay(assigned, elapsedExtra)
    this.debt.advance()
    this.work = 0
    if (type === 'extended') {
      this.cycleWork = 0
      this.extendedCharged = 0
    }
    this.postponing = false
  }

  skip (type, interval, duration, baseRestTaken, assigned, elapsedExtra) {
    this.debt.pay(assigned, elapsedExtra)
    this.debt.advance()
    if (type === 'extended') {
      const earned = duration * Math.min(1, this.cycleWork / interval)
      this.debt.add(earned - this.extendedCharged - baseRestTaken)
    } else this.debt.addSkippedBreak(this.work, interval, duration, baseRestTaken)
    this.work = 0
    if (type === 'extended') {
      this.cycleWork = 0
      this.extendedCharged = 0
    }
    this.postponing = false
  }

  reset (rate, baseRestTaken = 0) {
    this.debt.add(Math.max(0, this.work * rate - baseRestTaken))
    this.debt.replan()
    this.work = 0
    this.cycleWork = 0
    this.extendedCharged = 0
    this.postponing = false
  }

  shortIdle (extendedDuration, cycleInterval) {
    if (cycleInterval > 0 && extendedDuration > 0) {
      const earned = this.work * extendedDuration / cycleInterval
      this.debt.add(earned)
      this.extendedCharged += earned
    }
    this.work = 0
  }

  finishIdleSession () {
    this.work = 0
    this.cycleWork = 0
    this.extendedCharged = 0
    this.postponing = false
  }

  idle (type, elapsed, baseDuration, assigned, longDuration, extendedDuration, cycleInterval, fulfilled = true) {
    if (elapsed < Math.min(longDuration, baseDuration)) return
    this.postponing = false
    if (elapsed >= baseDuration) {
      this.debt.pay(assigned, elapsed - baseDuration)
      if (fulfilled) this.debt.advance()
      if (type === 'extended' && fulfilled) {
        this.finishIdleSession()
        return
      }
    }
    if (elapsed >= longDuration) this.shortIdle(extendedDuration, cycleInterval)
  }

  serialize () {
    return {
      modelVersion: 4,
      amount: this.debt.amount,
      allocation: this.debt.serialize(),
      work: this.work,
      cycleWork: this.cycleWork,
      extendedCharged: this.extendedCharged,
      postponing: this.postponing
    }
  }
}
