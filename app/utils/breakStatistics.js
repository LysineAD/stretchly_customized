const types = ['mini', 'long', 'extended', 'idle']
const fields = ['completed', 'withoutDelay', 'extraPostpones', 'skipped', 'unfinished', 'workMs', 'stretchTotalMs', 'stretchCount', 'longestStretchMs']
const safe = value => Number.isFinite(value) ? Math.max(0, value) : 0
const emptyPeriod = () => ({ breakMs: Object.fromEntries(types.map(type => [type, 0])), ...Object.fromEntries(fields.map(field => [field, 0])) })
const cleanPeriod = period => ({ breakMs: Object.fromEntries(types.map(type => [type, safe(period?.breakMs?.[type])])), ...Object.fromEntries(fields.map(field => [field, safe(period?.[field])])) })

export const dateKey = time => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default class BreakStatistics {
  constructor ({ data = {}, now = Date.now, onChange = () => {} } = {}) {
    this.now = now
    this.onChange = onChange
    this.data = { version: 1, lifetime: cleanPeriod(data.lifetime), days: {} }
    for (const [key, period] of Object.entries(data.days ?? {}).slice(-366)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) this.data.days[key] = cleanPeriod(period)
    }
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
    return [this.data.days[key], this.data.lifetime]
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
        else period.breakMs[kind] = Math.max(0, period.breakMs[kind] + value)
      }
      from = end
    }
  }

  advance (at = this.now()) {
    if (at <= this.lastAt) return
    const from = this.lastAt
    this.lastAt = at
    if (this.mode === 'paused') return
    const kind = this.mode === 'break' ? this.breakType : this.mode === 'idle' ? 'idle' : 'work'
    this.span(kind, from, at)
    if (kind === 'work') {
      this.stretchMs += at - from
      const previous = this.workSpans.at(-1)
      if (previous?.to === from) previous.to = at
      else this.workSpans.push({ from, to: at })
      this.workSpans = this.workSpans.filter(span => span.to >= at - 3600000).slice(-4096)
    }
  }

  offer ({ type, dueAt, early = false, plannedIntervalMs }) {
    this.advance()
    if (this.episode?.type === type) return
    this.episode = { type, dueAt, early, plannedIntervalMs, postpones: 0, extraPostpones: 0, firstStart: null, hasStarted: false, normalFirstPostpone: false }
    this.onChange()
  }

  postpone () {
    this.advance()
    const episode = this.episode
    if (!episode) return false
    const normal = episode.postpones === 0 && episode.early && this.now() <= episode.dueAt
    episode.postpones++
    if (normal) episode.normalFirstPostpone = true
    else {
      episode.extraPostpones++
      this.add('extraPostpones', 1)
    }
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.breakType = null
    this.onChange()
    return normal
  }

  start (type, duration = Infinity) {
    this.advance()
    if (!this.episode || this.mode === 'break') return
    this.episode.firstStart ??= this.now()
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
      for (const period of this.periods(at)) period.longestStretchMs = Math.max(period.longestStretchMs, this.stretchMs)
    }
    this.stretchMs = 0
    this.workSpans = []
  }

  finish (completed) {
    this.advance()
    const episode = this.episode
    if (!episode) return
    if (completed && episode.hasStarted) {
      this.add('completed', 1)
      if (episode.extraPostpones === 0 && episode.firstStart <= episode.dueAt + 60000) this.add('withoutDelay', 1)
      this.finishStretch()
    } else this.add(episode.hasStarted ? 'unfinished' : 'skipped', 1)
    this.episode = null
    this.breakType = null
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.onChange()
  }

  cancel () {
    this.advance()
    this.episode = null
    this.breakType = null
    if (this.mode !== 'paused') this.mode = this.idleQualified ? 'idle' : 'work'
    this.onChange()
  }

  pause () {
    this.advance()
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

  observeIdle (idleMs, threshold) {
    this.advance()
    if (this.mode === 'paused') return
    if (idleMs >= threshold && !this.idleQualified) {
      const idleStart = Math.max(this.startedAt, this.now() - idleMs)
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
    } else if (idleMs < 20000 && this.idleQualified) {
      this.idleQualified = false
      if (this.mode === 'idle') this.mode = 'work'
      this.onChange()
    }
  }

  snapshot (plannedIntervalMs) {
    this.advance()
    const today = cleanPeriod(this.data.days[dateKey(this.now())])
    const week = emptyPeriod()
    const firstDay = new Date(this.now())
    firstDay.setDate(firstDay.getDate() - 6)
    const firstKey = dateKey(firstDay)
    const todayKey = dateKey(this.now())
    for (const [key, period] of Object.entries(this.data.days)) {
      if (key < firstKey || key > todayKey) continue
      for (const type of types) week.breakMs[type] += period.breakMs[type]
      for (const field of fields) {
        if (field === 'longestStretchMs') week[field] = Math.max(week[field], period[field])
        else week[field] += period[field]
      }
    }
    const episode = this.episode
    const kind = episode ? `${episode.type === 'mini' ? 'Mini' : episode.type === 'extended' ? 'Extended' : 'Long'} break` : ''
    return {
      current: { kind, status: this.mode === 'break' ? 'Break in progress' : 'Waiting for Start', extraPostpones: episode?.extraPostpones ?? 0, workMs: this.stretchMs },
      plannedIntervalMs: episode?.plannedIntervalMs ?? plannedIntervalMs,
      today,
      week,
      lifetime: cleanPeriod(this.data.lifetime)
    }
  }

  serialize () {
    this.advance()
    const keys = Object.keys(this.data.days).sort()
    for (const key of keys.slice(0, -366)) delete this.data.days[key]
    return JSON.stringify(this.data)
  }
}
