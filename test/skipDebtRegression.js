import { describe, it, expect } from 'vitest'
import BreakStatistics from '../app/utils/breakStatistics.js'
const minute = 60000

describe('skipping a running break', () => {
  it('preserves the unpaid part of the assigned share', () => {
    let now = new Date(2026, 10, 13, 9).getTime()
    const stats = new BreakStatistics({ data: { debt: { modelVersion: 3, balance: minute } }, now: () => now, debtRate: () => 1 / 6, debtSettings: () => ({ longInterval: 40 * minute, cycleInterval: 120 * minute }) })
    now += 40 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.episode.debtPayment = minute
    stats.start('long', 5 * minute)
    now += 4.5 * minute
    stats.skip()
    expect(stats.debt.amount).toBe(0.5 * minute)
  })
})
