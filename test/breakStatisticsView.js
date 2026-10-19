import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBreakStatisticsView } from '../app/utils/breakStatisticsView.js'

const period = overrides => ({
  breakMs: { mini: 180000, long: 1200000, extended: 1800000, idle: 2400000 },
  completed: 10,
  withoutDelay: 8,
  extraPostpones: 3,
  skipped: 2,
  unfinished: 1,
  workMs: 16320000,
  stretchTotalMs: 14400000,
  stretchCount: 10,
  longestStretchMs: 2520000,
  ...overrides
})

const setup = () => {
  const dom = new JSDOM('<div class="breaks"><div class="break-advice"></div><div class="break-controls"></div><div class="break-clock"></div></div>')
  const container = dom.window.document.querySelector('.breaks')
  const view = createBreakStatisticsView(container)
  const stat = key => container.querySelector(`[data-stat="${key}"]`).textContent
  return { container, dom, stat, view }
}

describe('break statistics view', () => {
  it('renders all daily, weekly, current and lifetime statistics while preserving renderer selectors', () => {
    const { container, stat, view } = setup()
    view.update({
      current: { kind: 'Long break · 5 minutes', status: 'Waiting for Start', extraPostpones: 3, workMs: 1620000 },
      today: period(),
      week: period({ breakMs: { mini: 1200000, long: 7200000, extended: 10800000, idle: 12600000 } }),
      lifetime: period({ breakMs: { mini: 7200000, long: 144000000, extended: 216000000, idle: 216000000 }, longestStretchMs: 4320000 }),
      plannedIntervalMs: 1200000
    })

    expect(container.lastElementChild.className).toBe('break-clock')
    expect(container.children[1].className).toBe('break-controls')
    expect(stat('current-summary')).toBe('Extra postpones 3 · Working 27 m')
    expect(stat('today-break-total')).toBe('1 h 33 m')
    expect(stat('today-break-mini')).toBe('3 m')
    expect(stat('today-break-long')).toBe('20 m')
    expect(stat('today-break-extended')).toBe('30 m')
    expect(stat('today-break-idle')).toBe('40 m')
    expect(stat('today-without-delay')).toBe('80%')
    expect(stat('today-extra-postpones')).toBe('3')
    expect(stat('today-skipped-unfinished')).toBe('2 / 1')
    expect(stat('today-average-stretch')).toBe('24 m')
    expect(stat('today-longest-stretch')).toBe('42 m')
    expect(stat('today-computer-use')).toBe('4 h 32 m')
    expect(stat('planned-interval')).toBe('20 m')
    expect(stat('lifetime-break-total')).toBe('6 d 18 h 0 m')
    expect(stat('lifetime-longest-stretch')).toBe('1 h 12 m')

    view.destroy()
    expect(container.querySelector('.break-statistics')).toBeNull()
  })

  it('shows a dash for an empty completion rate and stretch average without producing invalid numbers', () => {
    const { container, stat, view } = setup()
    view.update({
      current: { extraPostpones: Number.MAX_SAFE_INTEGER, workMs: Number.MAX_VALUE },
      today: period({ completed: 0, withoutDelay: 0, stretchCount: 0, workMs: Number.NaN, extraPostpones: Number.POSITIVE_INFINITY }),
      week: {},
      lifetime: {},
      plannedIntervalMs: Number.NaN
    })

    expect(stat('current-summary')).toMatch(/^Extra postpones \d+ · Working /)
    expect(stat('today-without-delay')).toBe('—')
    expect(stat('today-average-stretch')).toBe('—')
    expect(stat('today-computer-use')).toBe('0 s')
    expect(stat('week-break-total')).toBe('0 s')
    expect(stat('planned-interval')).toBe('0 s')
    expect(Array.from(container.querySelectorAll('[data-stat]')).every(element => !/NaN|Infinity/.test(element.textContent))).toBe(true)
  })
})
