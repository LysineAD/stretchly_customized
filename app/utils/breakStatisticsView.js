const breakTypes = [
  ['mini', 'Mini'],
  ['long', 'Long'],
  ['extended', 'Extended'],
  ['idle', 'Idle']
]

const numeric = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0

const formatDuration = milliseconds => {
  const seconds = Math.floor(numeric(milliseconds) / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  const parts = []
  if (days) parts.push(`${days} d`)
  if (hours || days) parts.push(`${hours} h`)
  if (minutes || hours || days) parts.push(`${minutes} m`)
  if (!parts.length || (remainder && seconds < 60)) parts.push(`${remainder} s`)
  return parts.join(' ')
}

const totalBreakTime = period => breakTypes.reduce((total, [type]) => total + numeric(period?.breakMs?.[type]), 0)

const setText = (element, value) => {
  const text = String(value)
  if (element.textContent !== text) element.textContent = text
}

const percentWithoutDelay = period => {
  const completed = numeric(period?.completed)
  return completed ? `${Math.round(numeric(period?.withoutDelay) * 100 / completed)}%` : '—'
}

export function createBreakStatisticsView (container = document.querySelector('.breaks')) {
  if (!container) throw new Error('Break statistics need a .breaks container')
  const document = container.ownerDocument
  const root = document.createElement('aside')
  root.className = 'break-statistics'
  root.setAttribute('aria-label', 'Break statistics')
  root.innerHTML = `
    <header class="break-statistics-heading">
      <div class="break-statistics-meta"><span data-stat="break-kind"></span><span data-stat="break-status"></span></div>
      <h1 data-stat="current-summary" aria-live="polite"></h1>
    </header>
    <table class="break-statistics-table">
      <colgroup><col class="break-statistics-label"><col><col></colgroup>
      <thead><tr><th scope="col"></th><th scope="col">Today</th><th scope="col">7 days</th></tr></thead>
      <tbody>
        <tr class="group-top"><th scope="row">Break / away</th><td data-stat="today-break-total"></td><td data-stat="week-break-total"></td></tr>
        ${breakTypes.map(([type, label]) => `<tr class="part"><th scope="row">${label}</th><td data-stat="today-break-${type}"></td><td data-stat="week-break-${type}"></td></tr>`).join('')}
        <tr class="group-top"><th scope="row">Without delay</th><td data-stat="today-without-delay"></td><td data-stat="week-without-delay"></td></tr>
        <tr><th scope="row">Extra postpones</th><td data-stat="today-extra-postpones"></td><td data-stat="week-extra-postpones"></td></tr>
        <tr><th scope="row">Skipped / early end</th><td data-stat="today-skipped-unfinished"></td><td data-stat="week-skipped-unfinished"></td></tr>
        <tr class="group-top"><th scope="row">Average stretch</th><td data-stat="today-average-stretch"></td><td data-stat="week-average-stretch"></td></tr>
        <tr><th scope="row">Longest stretch</th><td data-stat="today-longest-stretch"></td><td data-stat="week-longest-stretch"></td></tr>
        <tr><th scope="row">Computer use</th><td data-stat="today-computer-use"></td><td data-stat="week-computer-use"></td></tr>
      </tbody>
    </table>
    <div class="break-statistics-caption">Planned interval: <span data-stat="planned-interval"></span></div>
    <footer class="break-lifetime"><span>All time</span><span>Break / away <strong data-stat="lifetime-break-total"></strong></span><span>Longest stretch <strong data-stat="lifetime-longest-stretch"></strong></span></footer>`
  const controls = container.querySelector('.break-controls')
  if (controls && !controls.querySelector('.break-buttons')) {
    const buttons = document.createElement('div')
    buttons.className = 'break-buttons'
    while (controls.firstChild) buttons.appendChild(controls.firstChild)
    for (const selector of ['#start-hint', '#progress', '#progress-time']) {
      const element = container.querySelector(selector)
      if (element) controls.appendChild(element)
    }
    controls.appendChild(buttons)
  }
  const clock = container.lastElementChild
  container.insertBefore(root, clock)

  const values = new Map(Array.from(root.querySelectorAll('[data-stat]'), element => [element.dataset.stat, element]))
  const set = (key, value) => setText(values.get(key), value)
  const updatePeriod = (prefix, period = {}) => {
    set(`${prefix}-break-total`, formatDuration(totalBreakTime(period)))
    for (const [type] of breakTypes) set(`${prefix}-break-${type}`, formatDuration(period.breakMs?.[type]))
    set(`${prefix}-without-delay`, percentWithoutDelay(period))
    set(`${prefix}-extra-postpones`, Math.floor(numeric(period.extraPostpones)))
    set(`${prefix}-skipped-unfinished`, `${Math.floor(numeric(period.skipped))} / ${Math.floor(numeric(period.unfinished))}`)
    const stretchCount = numeric(period.stretchCount)
    set(`${prefix}-average-stretch`, stretchCount ? formatDuration(numeric(period.stretchTotalMs) / stretchCount) : '—')
    set(`${prefix}-longest-stretch`, formatDuration(period.longestStretchMs))
    set(`${prefix}-computer-use`, formatDuration(period.workMs))
  }

  return {
    update (snapshot = {}) {
      const current = snapshot.current ?? {}
      set('break-kind', current.kind ?? '')
      set('break-status', current.status ?? '')
      set('current-summary', `Extra postpones ${Math.floor(numeric(current.extraPostpones))} · Working ${formatDuration(current.workMs)}`)
      updatePeriod('today', snapshot.today)
      updatePeriod('week', snapshot.week)
      set('planned-interval', formatDuration(snapshot.plannedIntervalMs))
      set('lifetime-break-total', formatDuration(totalBreakTime(snapshot.lifetime)))
      set('lifetime-longest-stretch', formatDuration(snapshot.lifetime?.longestStretchMs))
    },
    destroy () {
      root.remove()
    }
  }
}
