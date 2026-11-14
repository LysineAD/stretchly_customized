import { dateKey } from './localDate.js'

export const workBlock = 120 * 60000
const timerTolerance = 5000
const finite = value => Number.isFinite(value) ? value : 0

// One full larger-break cycle lasts
//   extendedBreakInterval x microbreakInterval x (breakInterval + 1)
// active minutes and contains one Extended plus (extendedBreakInterval - 1)
// Long breaks. Owed rest per active minute is that cycle's larger-break total
// divided by that cycle's length, so a skipped or postponed break makes the
// ledger demand exactly the rest the untouched schedule would have offered.
// Dividing by a fixed 120 minutes instead would only be correct for one
// particular schedule and under- or over-credits every other one.
export function breakDebtRate (settings) {
  if (!settings.get('break')) return 0
  const normal = Math.max(1, finite(settings.get('breakDuration')))
  const extended = Math.max(1, finite(settings.get('extendedBreakDuration')))
  const count = settings.get('extendedBreak')
    ? Math.max(1, Math.floor(finite(settings.get('extendedBreakInterval'))) || 3)
    : 3
  const total = settings.get('extendedBreak') ? (count - 1) * normal + extended : count * normal
  const interval = finite(settings.get('microbreakInterval'))
  const every = Math.max(1, Math.floor(finite(settings.get('breakInterval'))) + 1)
  const cycle = count * interval * every
  // Incomplete settings objects (tests, inspector probes) keep the legacy
  // 120-minute denominator instead of producing an infinite rate.
  return cycle > 0 ? total / cycle : total / workBlock
}

export default class BreakDebt {
  constructor (data = {}) {
    this.balance = finite(data.balance)
    this.work = Math.max(0, finite(data.work))
    this.day = typeof data.day === 'string' ? data.day : null
    this.plan = Array.from({ length: 3 }, (_, i) => Math.max(0, finite(data.plan?.[i])))
    this.recent = []
    this.previousDay = null
    // An outstanding postponement is unpaid rest, so it must survive a Quit.
    // Older profiles have no such field and start with none.
    const delay = data.postponement
    this.postponement = delay && Number.isFinite(delay.earned)
      ? { from: finite(delay.from), earned: Math.max(0, finite(delay.earned)) }
      : null
  }

  rollDay (time) {
    const day = dateKey(time)
    if (this.day && day !== this.day) {
      this.previousDay = { date: this.day, balance: this.balance }
      this.balance = Math.max(0, this.balance)
    }
    this.day = day
  }

  record (kind, from, to, rate) {
    if (from >= to) return
    this.rollDay(from)
    this.apply(kind, to - from, rate)
    const previous = this.recent.at(-1)
    if (previous?.to === from && previous.kind === kind && previous.rate === rate && previous.day === this.day) previous.to = to
    else this.recent.push({ kind, from, to, rate, day: this.day })
    this.recent = this.recent.filter(span => span.to > to - 3600000)
  }

  apply (kind, elapsed, rate) {
    if (kind === 'work' && rate > 0) {
      this.work += elapsed
      this.balance += elapsed * rate
      if (this.postponement) this.postponement.earned += elapsed * rate
    } else if (kind === 'rest') this.balance -= elapsed
  }

  recognizeIdle (from, to) {
    const spans = this.recent
    this.recent = []
    for (const span of spans) {
      const start = Math.max(from, span.from)
      const end = Math.min(to, span.to)
      if (start >= end || span.kind === 'rest' || span.kind === 'paused') {
        this.recent.push(span)
        continue
      }
      if (span.from < start) this.recent.push({ ...span, to: start })
      this.recent.push({ ...span, kind: 'rest', from: start, to: end })
      if (end < span.to) this.recent.push({ ...span, from: end })
      const elapsed = end - start
      let correction = elapsed
      if (span.kind === 'work' && span.rate > 0) {
        this.work -= elapsed
        correction += elapsed * span.rate
        if (this.postponement) {
          const postponedWork = Math.max(0, end - Math.max(start, this.postponement.from))
          this.postponement.earned = Math.max(0, this.postponement.earned - postponedWork * span.rate)
        }
      }
      if (span.day === this.day) this.balance -= correction
      else if (span.day === this.previousDay?.date) {
        const before = Math.max(0, this.previousDay.balance)
        this.previousDay.balance -= correction
        this.balance -= before - Math.max(0, this.previousDay.balance)
      }
    }
  }

  postpone (at) {
    this.postponement ??= { from: at, earned: 0 }
  }

  forecast (rate, upcoming) {
    if (rate <= 0 || upcoming.length === 0) return 0
    const boundary = Math.round(this.work / workBlock) * workBlock
    const atBoundary = upcoming[0].after === 0 && boundary > 0 && Math.abs(this.work - boundary) <= timerTolerance
    const end = atBoundary ? boundary : Math.max(workBlock, Math.ceil(this.work / workBlock) * workBlock)
    const remaining = Math.max(0, end - this.work)
    const baseRest = upcoming.reduce((sum, { after, duration }) => after <= remaining + timerTolerance ? sum + duration : sum, 0)
    const shortage = Math.max(0, this.balance + remaining * rate - baseRest)
    // Work during a postponement is already in `balance`, but a credit from
    // earlier rest can hide it from `shortage`. Keep that earned amount as a
    // floor for the TOTAL owed, then let the weights below spread it over the
    // next three larger breaks. Charging it all to the returning break would
    // bypass the proportional Long/Extended repayment plan.
    const required = Math.max(shortage, this.postponement?.earned ?? 0)
    const weights = upcoming.slice(0, 3).map(entry => entry.duration)
    const planned = this.plan.reduce((sum, value) => sum + value, 0)
    if (required < planned && planned > 0) {
      this.plan = this.plan.map(value => value * required / planned)
    } else if (required > planned) {
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      this.plan = weights.map((weight, index) => this.plan[index] + (required - planned) * weight / total)
    }
    const payment = this.plan[0]
    return payment > 0 ? Math.max(1, Math.round(payment)) : 0
  }

  resolve (creditedExtra = 0) {
    const planned = this.plan.shift()
    const unpaid = Math.max(0, planned - creditedExtra)
    this.plan.push(0)
    if (unpaid > 1) this.plan = [0, 0, 0]
    this.postponement = null
  }

  replan ({ preserveDelay = false } = {}) {
    this.plan = [0, 0, 0]
    if (!preserveDelay) this.postponement = null
  }

  // A skipped break is not a debt event: the ledger must look exactly as it did
  // before the break window opened (no rest credit, no postponed debt cleared).
  checkpoint () {
    return {
      balance: this.balance,
      work: this.work,
      day: this.day,
      previousDay: this.previousDay ? { ...this.previousDay } : null,
      plan: [...this.plan],
      postponement: this.postponement ? { ...this.postponement } : null,
      recent: this.recent.map(span => ({ ...span }))
    }
  }

  rollback (snapshot) {
    if (!snapshot) return
    this.balance = snapshot.balance
    this.work = snapshot.work
    this.day = snapshot.day
    this.previousDay = snapshot.previousDay ? { ...snapshot.previousDay } : null
    this.plan = [...snapshot.plan]
    this.postponement = snapshot.postponement ? { ...snapshot.postponement } : null
    this.recent = snapshot.recent.map(span => ({ ...span }))
  }

  serialize () {
    return {
      balance: this.balance,
      work: this.work,
      day: this.day,
      plan: this.plan,
      postponement: this.postponement
        ? { from: this.postponement.from, earned: this.postponement.earned }
        : null
    }
  }
}
