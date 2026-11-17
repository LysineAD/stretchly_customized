const maximumExtra = 6 * 60000

export default class DebtAllocation {
  constructor (amount = 0) {
    this.amount = Number.isFinite(amount) && amount > 0 ? amount : 0
    this.unallocated = this.amount
    this.plan = [0, 0, 0]
    this.needsAllocation = true
  }

  add (amount) {
    if (Number.isFinite(amount) && amount > 0) {
      this.amount += amount
      this.unallocated += amount
      this.needsAllocation = true
    }
  }

  addPostponedWork (activeTime, rate) {
    this.add(activeTime * rate)
  }

  addSkippedBreak (activeTime, interval, duration, baseRestTaken = 0) {
    if (!(interval > 0) || !(duration > 0)) return
    const earned = duration * Math.min(1, Math.max(0, activeTime / interval))
    this.add(earned - Math.max(0, baseRestTaken))
  }

  addReset (activeTime, rate) {
    this.add(activeTime * rate)
  }

  shares (durations) {
    const next = durations.slice(0, 3)
    const total = next.reduce((sum, duration) => sum + duration, 0)
    if (total <= 0) return next.map(() => 0)
    if (this.needsAllocation) {
      const available = this.unallocated
      next.forEach((duration, index) => {
        const share = Math.min(maximumExtra - this.plan[index], available * duration / total)
        this.plan[index] += share
        this.unallocated = Math.max(0, this.unallocated - share)
      })
      this.needsAllocation = false
    }
    return next.map((_, index) => this.plan[index])
  }

  pay (assigned, elapsed) {
    const paid = Math.min(this.amount, this.plan[0] + this.unallocated, Math.max(0, assigned), Math.max(0, elapsed))
    this.amount -= paid
    const fromPlan = Math.min(this.plan[0], paid)
    this.plan[0] -= fromPlan
    this.unallocated = Math.max(0, this.unallocated - (paid - fromPlan))
    return paid
  }

  advance () {
    this.unallocated += this.plan.shift()
    this.plan.push(0)
    this.needsAllocation = true
  }

  replan () {
    this.plan = [0, 0, 0]
    this.unallocated = this.amount
    this.needsAllocation = true
  }

  correctCharge (amount) {
    this.amount = Math.max(0, this.amount - Math.max(0, amount))
    this.replan()
  }

  serialize () {
    return { amount: this.amount, unallocated: this.unallocated, plan: [...this.plan], needsAllocation: this.needsAllocation }
  }

  static restore (data = {}) {
    const debt = new DebtAllocation(data.amount)
    if (Array.isArray(data.plan) && data.plan.length === 3 && data.plan.every(value => Number.isFinite(value) && value >= 0) &&
      Number.isFinite(data.unallocated) && data.unallocated >= 0 &&
      Math.abs(data.plan.reduce((sum, value) => sum + value, 0) + data.unallocated - debt.amount) < 0.01) {
      debt.plan = [...data.plan]
      debt.unallocated = data.unallocated
      debt.needsAllocation = Boolean(data.needsAllocation)
    }
    return debt
  }
}
