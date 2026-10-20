import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBreakStatisticsView } from '../app/utils/breakStatisticsView.js'

const setup = () => {
  const dom = new JSDOM('<div class="breaks"><div class="break-advice"></div><div class="break-controls"><a id="postpone">Postpone</a></div><div class="break-clock"></div></div>')
  const container = dom.window.document.querySelector('.breaks')
  const view = createBreakStatisticsView(container)
  const stat = key => container.querySelector(`[data-stat="${key}"]`).textContent
  return { container, stat, view }
}

describe('minimal break statistics', () => {
  it('shows only four rows, daily time averages and a badge beside Postpone', () => {
    const { container, stat, view } = setup()
    view.update({
      current: { kind: 'Long break', postpones: 2 },
      today: { breakMs: 3600000, breaks: 3, withoutDelay: 2, workMs: 28800000, stretchTotalMs: 14400000, stretchCount: 10 },
      week: { breakMs: 25200000, breaks: 10, withoutDelay: 8, workMs: 201600000, stretchTotalMs: 36000000, stretchCount: 20 }
    })
    expect(container.lastElementChild.className).toBe('break-clock')
    expect(container.children[1].className).toBe('break-controls')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(stat('break-kind')).toBe('Long break')
    expect(stat('today-break-total')).toBe('1 h 0 m')
    expect(stat('week-break-total')).toBe('1 h 0 m')
    expect(stat('today-without-delay')).toBe('67%')
    expect(stat('week-without-delay')).toBe('80%')
    expect(stat('today-average-stretch')).toBe('24 m')
    expect(stat('week-average-stretch')).toBe('30 m')
    expect(stat('week-computer-use')).toBe('8 h 0 m')
    expect(container.querySelector('#postpone .postpone-count').textContent).toBe('+2')
    expect(container.querySelector('#postpone .postpone-count').classList.contains('hidden')).toBe(false)
    expect(container.textContent).not.toMatch(/All time|Longest|Planned|Extra postpones|Working|Skipped|Waiting|Auto-start/)
    view.destroy()
    expect(container.querySelector('.break-statistics')).toBeNull()
    expect(container.querySelector('.postpone-count')).toBeNull()
  })

  it('hides a zero badge and handles empty periods without invalid values', () => {
    const { container, stat, view } = setup()
    view.update({ current: { postpones: 0 }, today: { breaks: 0, workMs: Number.NaN }, week: {} })
    expect(container.querySelector('.postpone-count').classList.contains('hidden')).toBe(true)
    expect(stat('today-without-delay')).toBe('—')
    expect(stat('today-average-stretch')).toBe('—')
    expect(stat('today-computer-use')).toBe('0 s')
    expect(stat('week-break-total')).toBe('0 s')
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
  })
})
