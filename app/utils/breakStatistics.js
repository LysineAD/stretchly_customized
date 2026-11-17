import DebtSession from './debtSession.js'
import { dateKey } from './localDate.js'

const fields = ['breakMs', 'breaks', 'withoutDelay', 'workMs', 'stretchTotalMs', 'stretchCount']
const safe = value => Number.isFinite(value) ? Math.max(0, value) : 0
const emptyPeriod = () => Object.fromEntries(fields.map(field => [field, 0]))
const cleanPeriod = period => ({
  ...Object.fromEntries(fields.map(field => [field, safe(period?.[field])])),
  breakMs: typeof period?.breakMs === 'object' ? Object.values(period.breakMs ?? {}).reduce((total, value) => total + safe(value), 0) : safe(period?.breakMs),
  breaks: safe(period?.breaks ?? (safe(period?.completed) + safe(period?.skipped) + safe(period?.unfinished)))
})

export { dateKey }

export default class BreakStatistics {
  constructor ({ data = {}, now = Date.now, onChange = () => {}, debtRate = () => 0, debtSettings = () => ({}) } = {}) {
    this.now = now
    this.onChange = onChange
    this.debtRate = debtRate
    this.debtSettings = debtSettings
    this.session = DebtSession.restore(data.debt)
    this.debt = this.session.debt
    this.data = { version: 2, days: {} }
    for (const [key, period] of Object.entries(data.days ?? {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) this.data.days[key] = cleanPeriod(period)
    }
    this.prune()
    this.lastAt = now()
    this.startedAt = this.lastAt
    this.mode = 'work'
    this.breakType = null
    this.episode = null
    this.stretchMs = 0
    this.workSpans = []
    this.idleQualified = false
    this.suspendedMode = null
  }

  periods (at) {
    const key = dateKey(at)
    this.data.days[key] ??= emptyPeriod()
    return [this.data.days[key]]
  }

  add (field, value, at = this.now()) {
    for (const period of this.periods(at)) period[field] = Math.max(0, period[field] + value)
  }

  span (kind, from, to, sign = 1) {
    while (from < to) {
      const midnight = new Date(from)
      midnight.setHours(24, 0, 0, 0)
      const end = Math.min(to, midnight.getTime())
      const value = (end - from) * sign
      for (const period of this.periods(from)) {
        if (kind === 'work') period.workMs = Math.max(0, period.workMs + value)
        else period.breakMs = Math.max(0, period.breakMs + value)
      }
      from = end
    }
  }

  advance (at = this.now()) {
    if (at <= this.lastAt) return
    const from = this.lastAt
    const breakEnd = this.episode?.hasStarted ? this.episode.activeStartedAt + this.episode.duration : Infinity
    if (this.mode === 'break' && from < breakEnd && breakEnd < at) this.advance(breakEnd)
    if (this.mode === 'break' && at > breakEnd && !this.idleQualified) this.mode = 'work'
    if (this.mode === 'break' && at > breakEnd && this.idleQualified) this.mode = 'idle'
    if (this.lastAt !== from) return this.advance(at)
    this.lastAt = at
    const kind = this.mode === 'paused' ? 'paused' : this.mode === 'break' ? this.breakType : this.mode === 'idle' ? 'idle' : 'work'
    const debtKind = kind === 'work'
      ? this.episode?.waiting ? 'waiting' : 'work'
      : kind === 'paused' ? kind : kind === 'mini' && !this.idleQualified ? 'mini' : 'rest'
    const rate = this.debtRate()
    if (debtKind === 'work') this.session.recordWork(at - from, rate, at)
    if (kind !== 'paused') this.span(kind, from, at)
    if (this.mode === 'break' && this.episode) this.episode.timerMs += at - from
    if (kind === 'work') {
      this.stretchMs += at - from
      const previous = this.workSpans.at(-1)
      if (previous?.to === from) previous.to = at
      else this.workSpans.push({ from, to: at })
      this.workSpans = this.workSpans.filter(span => span.to >= at - 3600000).slice(-4096)
    }
  }

  offer ({ type, baseDuration }) {
    this.advance()
    if (type !== 'mini') this.session.returned()
    if (this.episode?.type !== type) {
      this.episode = { type, baseDuration, postpones: 0, hasStarted: false, timerMs: 0 }
    }
    this.episode.waiting = baseDuration > 0
    this.onChange()
  }

  postpone () {
    this.advance()
    const episode = this.episode
    if (!episode) return false
    if (episode.type !== 'mini') this.session.postpone()
    episode.waiting = false
    episode.postpones++
    const normal = episode.postpones === 1
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.breakType = null
    this.onChange()
    return normal
  }

  start (type, duration = Infinity) {
    this.advance()
    if (!this.episode || this.mode === 'break') return
    this.episode.waiting = false
    this.episode.hasStarted = true
    this.episode.activeStartedAt = this.now()
    this.episode.duration = duration
    this.mode = 'break'
    this.breakType = type
    this.onChange()
  }

  finishStretch (at = this.now()) {
    if (this.stretchMs > 0) {
      this.add('stretchCount', 1, at)
      this.add('stretchTotalMs', this.stretchMs, at)
    }
    this.stretchMs = 0
    this.workSpans = []
  }

  finish (completed, { idle = false, skipped = false } = {}) {
    this.advance()
    const episode = this.episode
    if (!episode) return
    if (idle && episode.type !== 'mini') {
      this.debt.pay(episode.debtPayment || 0, Math.max(0, episode.timerMs - episode.baseDuration))
    }
    if (!idle && !skipped && episode.type !== 'mini') {
      this.session.complete(episode.type, episode.debtPayment || 0, Math.max(0, episode.timerMs - episode.baseDuration))
    }
    this.add('breaks', 1)
    if (completed && episode.hasStarted) {
      if (episode.postpones <= 1) this.add('withoutDelay', 1)
      this.finishStretch()
    }
    this.episode = null
    this.breakType = null
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.onChange()
  }

  skip () {
    this.advance()
    const episode = this.episode
    if (episode && episode.type !== 'mini') this.skipLarger(episode.type, episode.baseDuration, episode.timerMs, episode.debtPayment || 0)
    this.finish(false, { skipped: true })
  }

  skipLarger (type, duration, elapsed = 0, assigned = 0) {
    const config = this.debtSettings()
    const interval = type === 'extended' ? config.cycleInterval : config.longInterval
    this.session.skip(type, interval, duration, Math.min(duration, elapsed), assigned, Math.max(0, elapsed - duration))
    this.onChange()
  }

  resetDebt () {
    this.advance()
    const episode = this.episode
    const baseRest = episode && episode.type !== 'mini' ? Math.min(episode.baseDuration, episode.timerMs) : 0
    if (episode && episode.type !== 'mini') this.debt.pay(episode.debtPayment || 0, Math.max(0, episode.timerMs - episode.baseDuration))
    this.session.reset(this.debtRate(), baseRest)
    this.onChange()
  }

  idleRecovery (type, elapsed, duration, assigned, fulfilled) {
    const config = this.debtSettings()
    this.session.idle(type, elapsed, duration, assigned, config.longDuration, config.extendedDuration, config.cycleInterval, fulfilled)
    this.onChange()
  }

  abandon () {
    this.advance()
    this.cancel()
  }

  cancel () {
    this.advance()
    this.session.returned()
    this.episode = null
    this.breakType = null
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.onChange()
  }

  pause () {
    this.advance()
    this.session.returned()
    this.mode = 'paused'
    this.episode = null
    this.suspendedMode = null
    this.onChange()
  }

  suspend () {
    this.advance()
    if (this.mode === 'paused') return
    this.suspendedMode = this.mode
    this.mode = 'paused'
    this.onChange()
  }

  resume () {
    if (this.mode !== 'paused') return
    this.lastAt = this.now()
    this.mode = this.episode?.hasStarted && this.suspendedMode === 'break' ? 'break' : 'work'
    this.suspendedMode = null
    if (this.mode === 'work') this.idleQualified = false
    this.onChange()
  }

  observeIdle (idleMs, threshold, at = this.now()) {
    this.advance(at)
    if (this.mode === 'paused') return
    if (idleMs >= threshold && !this.idleQualified) {
      const idleStart = Math.max(this.startedAt, at - idleMs)
      this.session.correctIdle(idleStart, at)
      for (const span of this.workSpans) {
        const from = Math.max(span.from, idleStart)
        if (from < span.to) {
          this.span('work', from, span.to, -1)
          this.span('idle', from, span.to)
          this.stretchMs -= span.to - from
        }
      }
      this.finishStretch(idleStart)
      this.idleQualified = true
      if (this.mode === 'work') this.mode = 'idle'
      this.onChange()
    } else if (idleMs < Math.min(20000, threshold) && this.idleQualified) {
      this.idleQualified = false
      if (this.mode === 'idle') this.mode = 'work'
      this.onChange()
    }
  }

  prune () {
    const today = dateKey(this.now())
    const firstDay = new Date(this.now())
    firstDay.setDate(firstDay.getDate() - 6)
    const first = dateKey(firstDay)
    for (const key of Object.keys(this.data.days)) {
      if (key < first || key > today) delete this.data.days[key]
    }
  }

  snapshot () {
    this.advance()
    this.prune()
    const today = cleanPeriod(this.data.days[dateKey(this.now())])
    const week = emptyPeriod()
    for (const period of Object.values(this.data.days)) {
      for (const field of fields) week[field] += period[field]
    }
    const episode = this.episode
    const kind = episode ? `${episode.type === 'mini' ? 'Mini' : episode.type === 'extended' ? 'Extended' : 'Long'} break` : ''
    return { current: { kind, postpones: episode?.postpones ?? 0, debtTotal: this.debt.amount, debtPayment: episode?.debtPayment ?? 0 }, today, week }
  }

  serialize () {
    this.advance()
    this.prune()
    return JSON.stringify({ ...this.data, debt: this.session.serialize() })
  }
}
