import { describe, it, expect } from 'vitest'
import BreakDebt, { breakDebtRate } from '../app/utils/breakDebt.js'
import BreakStatistics from '../app/utils/breakStatistics.js'

const minute = 60000
const at = new Date(2026, 10, 13, 9).getTime()
const rate = 1 / 6
const upcoming = [4, 4, 12].map((duration, i) => ({ after: i * 40 * minute, duration: duration * minute }))

describe('schedule-aligned break debt', () => {
  it('derives the target rate from the configured schedule', () => {
    const values = { break: true, extendedBreak: true, extendedBreakInterval: 3, microbreakInterval: 20 * minute, breakInterval: 1, breakDuration: 4 * minute, extendedBreakDuration: 12 * minute }
    expect(breakDebtRate({ get: k => values[k] })).toBeCloseTo(rate)
  })
  it('allocates a forecast in a 1:1:3 ratio', () => {
    const debt = new BreakDebt({ modelVersion: 3, balance: 15 * minute })
    debt.forecast(rate, upcoming)
    expect(debt.plan[1]).toBeCloseTo(debt.plan[0])
    expect(debt.plan[2]).toBeCloseTo(3 * debt.plan[0])
  })
  it('limits each addition to six minutes while preserving the balance', () => {
    const debt = new BreakDebt({ modelVersion: 3, balance: 120 * minute })
    expect(debt.forecast(rate, upcoming)).toBe(6 * minute)
    debt.record('rest', at, at + 10 * minute, rate)
    debt.resolve(6 * minute)
    expect(debt.balance).toBe(110 * minute)
    expect(new BreakDebt(debt.serialize()).balance).toBe(110 * minute)
  })
  it('carries surplus as well as debt over midnight and restart', () => {
    const debt = new BreakDebt({ modelVersion: 3, balance: -10 * minute })
    debt.record('work', at, at + minute, rate)
    debt.record('work', at + 86400000, at + 86400000 + minute, rate)
    expect(new BreakDebt(debt.serialize()).balance).toBeCloseTo((-10 + 2 * rate) * minute)
  })
  it('starts legacy model balances fresh', () => {
    expect(new BreakDebt({ balance: 500000, postponement: { earned: 900000 } }).balance).toBe(0)
  })
  it('does not create a postponement penalty', () => {
    const debt = new BreakDebt({ modelVersion: 3, balance: 5 * minute })
    debt.postpone(at)
    expect(debt.balance).toBe(5 * minute)
    debt.record('work', at, at + 6 * minute, rate)
    expect(debt.balance).toBe(6 * minute)
  })
  it('recalculates proportional shares after repeated postponements', () => {
    const debt = new BreakDebt({ modelVersion: 3, balance: 15 * minute })
    for (let i = 0; i < 3; i++) {
      debt.postpone(at + i * 2 * minute)
      debt.record('work', at + i * 2 * minute, at + (i + 1) * 2 * minute, rate)
      debt.forecast(rate, upcoming)
      expect(debt.plan[1]).toBeCloseTo(debt.plan[0])
      expect(debt.plan[2]).toBeCloseTo(3 * debt.plan[0])
    }
  })
  it('credits actual partial rest even if a break is skipped', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    stats.debt.balance = 10 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.start('long', 4 * minute)
    now += 2 * minute
    stats.skip()
    expect(stats.debt.balance).toBe(8 * minute)
  })
  it('credits idle once when idle overlaps a timed break', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    now += 40 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.start('long', 4 * minute)
    now += 2 * minute
    stats.observeIdle(3 * minute, 3 * minute)
    now += minute
    stats.finish(true)
    expect(stats.debt.work).toBe(39 * minute)
    expect(stats.debt.balance).toBeCloseTo((39 * rate - 4) * minute)
  })
})
