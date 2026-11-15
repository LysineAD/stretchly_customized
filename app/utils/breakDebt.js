import { dateKey } from './localDate.js'

export const workBlock = 120 * 60000
const maximumExtra = 6 * 60000
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
    this.balance = data.modelVersion === 3 ? finite(data.balance) : 0
    this.work = data.modelVersion === 3 ? Math.max(0, finite(data.work)) : 0
    this.day = data.modelVersion === 3 && typeof data.day === 'string' ? data.day : null
    this.plan = Array.from({ length: 3 }, (_, i) => data.modelVersion === 3 ? Math.max(0, finite(data.plan?.[i])) : 0)
    this.recent = []
    this.retainSince = null
    this.previousDay = null
    this.postponement = null
  }

  rollDay (time) {
    const day = dateKey(time)
    if (this.day && day !== this.day) {
      this.previousDay = { date: this.day, balance: this.balance }
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
    const cutoff = this.retainSince === null ? to - 3600000 : Math.min(to - 3600000, this.retainSince)
    this.recent = this.recent.filter(span => span.to > cutoff)
  }

  apply (kind, elapsed, rate) {
    if (kind === 'work' && rate > 0) {
      this.work += elapsed
      this.balance += elapsed * rate
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
      }
      if (span.day === this.day) this.balance -= correction
      else if (span.day === this.previousDay?.date) {
        this.previousDay.balance -= correction
        this.balance -= correction
      }
    }
  }

  postpone () {}

  forecast (rate, upcoming) {
    if (rate <= 0 || upcoming.length === 0) return 0
    const next = upcoming.slice(0, 3)
    const total = next.reduce((sum, entry) => sum + entry.duration, 0)
    if (total <= 0) return 0
    const shortage = Math.max(0, this.balance + Math.max(0, next.at(-1).after) * rate - total)
    this.plan = next.map(entry => shortage * entry.duration / total)
    return Math.round(Math.min(maximumExtra, this.plan[0]))
  }

  resolve () {
    this.plan.shift()
    this.plan.push(0)
  }

  // Replanning discards only the forecast; the balance remains unchanged.
  replan ({ preserveDelay = true } = {}) {
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
      modelVersion: 3,
      balance: this.balance,
      work: this.work,
      day: this.day,
      plan: this.plan,
      postponement: this.postponement
        ? { from: this.postponement.from, earned: this.postponement.earned, committed: this.postponement.committed }
        : null
    }
  }
}
