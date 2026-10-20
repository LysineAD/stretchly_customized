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

const setText = (element, value) => {
  const text = String(value)
  if (element.textContent !== text) element.textContent = text
}

const percentWithoutDelay = period => {
  const completed = numeric(period?.breaks)
  return completed ? `${Math.round(numeric(period?.withoutDelay) * 100 / completed)}%` : '—'
}

export function createBreakStatisticsView (container = document.querySelector('.breaks')) {
  if (!container) throw new Error('Break statistics need a .breaks container')
  const document = container.ownerDocument
  const root = document.createElement('aside')
  root.className = 'break-statistics'
  root.setAttribute('aria-label', 'Break statistics')
  root.innerHTML = `
    <div class="break-type" data-stat="break-kind"></div>
    <table class="break-statistics-table">
      <thead><tr><th scope="col"></th><th scope="col">Today</th><th scope="col">7-day avg/day</th></tr></thead>
      <tbody>
        <tr><th scope="row">Break time</th><td data-stat="today-break-total"></td><td data-stat="week-break-total"></td></tr>
        <tr><th scope="row">Without delay</th><td data-stat="today-without-delay"></td><td data-stat="week-without-delay"></td></tr>
        <tr><th scope="row">Average stretch</th><td data-stat="today-average-stretch"></td><td data-stat="week-average-stretch"></td></tr>
        <tr><th scope="row">Computer use</th><td data-stat="today-computer-use"></td><td data-stat="week-computer-use"></td></tr>
      </tbody>
    </table>`
  const controls = container.querySelector('.break-controls')
  if (controls && !controls.querySelector('.break-buttons')) {
    const buttons = document.createElement('div')
    buttons.className = 'break-buttons'
    while (controls.firstChild) buttons.appendChild(controls.firstChild)
    for (const selector of ['#progress', '#progress-time']) {
      const element = container.querySelector(selector)
      if (element) controls.appendChild(element)
    }
    controls.appendChild(buttons)
  }
  const postpone = container.querySelector('#postpone')
  const badge = document.createElement('span')
  badge.className = 'postpone-count hidden'
  badge.setAttribute('aria-label', 'Postponements')
  postpone?.appendChild(badge)
  const clock = container.lastElementChild
  container.insertBefore(root, clock)

  const values = new Map(Array.from(root.querySelectorAll('[data-stat]'), element => [element.dataset.stat, element]))
  const set = (key, value) => setText(values.get(key), value)
  const updatePeriod = (prefix, period = {}, days = 1) => {
    set(`${prefix}-break-total`, formatDuration(numeric(period.breakMs) / days))
    set(`${prefix}-without-delay`, percentWithoutDelay(period))
    const stretchCount = numeric(period.stretchCount)
    set(`${prefix}-average-stretch`, stretchCount ? formatDuration(numeric(period.stretchTotalMs) / stretchCount) : '—')
    set(`${prefix}-computer-use`, formatDuration(numeric(period.workMs) / days))
  }

  return {
    update (snapshot = {}) {
      const current = snapshot.current ?? {}
      set('break-kind', current.kind ?? '')
      const count = Math.floor(numeric(current.postpones))
      setText(badge, `+${count}`)
      badge.classList.toggle('hidden', count === 0)
      updatePeriod('today', snapshot.today)
      updatePeriod('week', snapshot.week, 7)
    },
    destroy () {
      badge.remove()
      root.remove()
    }
  }
}
