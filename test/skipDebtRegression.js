import { describe, it, expect } from 'vitest'
import BreakStatistics from '../app/utils/breakStatistics.js'
const minute = 60000

describe('interrupting break episodes', () => {
  it.each(['skip', 'abandon'])('%s retains actual rest and does not invent a penalty', action => {
    let now = new Date(2026, 10, 13, 9).getTime()
    const stats = new BreakStatistics({ now: () => now, debtRate: () => 0.2 })
    stats.debt.balance = 10 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.start('long', 4 * minute)
    now += 2 * minute
    stats[action]()
    expect(stats.debt.balance).toBe(8 * minute)
  })
})
