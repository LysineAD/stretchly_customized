import { describe, expect, it } from 'vitest'
import BreakDebt, { breakDebtRate } from '../app/utils/breakDebt.js'
import BreakStatistics from '../app/utils/breakStatistics.js'

const minute = 60000
const at = new Date(2026, 10, 13, 9).getTime()
const rate = 21 / 120
const projected = (times, minutes = [3, 3, 15]) => times.map((after, i) => ({
  after: after * minute,
  duration: minutes[i] * minute
}))

describe('break debt', () => {
  it.each([[2, 5, 9], [4, 16, 24], [3, 21, 27]])('derives the rate from Long %i and Extended %i', (normal, extended, total) => {
    const settings = { break: true, extendedBreak: true, extendedBreakInterval: 3, breakDuration: normal * minute, extendedBreakDuration: extended * minute }
    expect(breakDebtRate({ get: key => settings[key] })).toBe(total / 120)
  })

  it('sees an early reset in the current work block and assigns 1:1:5 shares', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 18 * minute, rate)
    debt.record('rest', at + 18 * minute, at + 21 * minute, rate)
    expect(debt.forecast(rate, projected([40, 80, 120]))).toBe(102857)
    expect(debt.plan[0]).toBeCloseTo(12 * minute / 7)
    expect(debt.plan[1]).toBeCloseTo(debt.plan[0])
    expect(debt.plan[2]).toBeCloseTo(5 * debt.plan[0])
  })

  it('adds extra work at the first returned break without duplicating it in the balance', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 120 * minute, rate)
    debt.record('rest', at + 120 * minute, at + 126 * minute, rate)
    debt.postpone(at + 126 * minute)
    debt.record('work', at + 126 * minute, at + 136 * minute, rate)
    expect(debt.balance).toBe(16.75 * minute)
    expect(debt.forecast(rate, [
      ...projected([0, 30, 60], [15, 3, 3]),
      { after: 90 * minute, duration: 15 * minute }
    ])).toBe(105000)
    debt.record('rest', at + 136 * minute, at + 151 * minute, rate)
    expect(debt.balance).toBe(1.75 * minute)
  })

  it('reclassifies overlapping idle without crediting the timed portion twice', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    now += 40 * minute
    stats.offer({ type: 'long', baseDuration: 3 * minute })
    stats.start('long', 3 * minute)
    now += 2 * minute
    stats.observeIdle(3 * minute, 3 * minute)
    now += minute
    stats.finish(true)
    expect(stats.debt.work).toBe(39 * minute)
    expect(stats.debt.balance).toBeCloseTo((39 * rate - 4) * minute)
  })

  it('counts postponement work but excludes the fixed countdown before starting', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    now += 40 * minute
    stats.offer({ type: 'long', baseDuration: 3 * minute })
    now += 10000
    stats.postpone()
    now += 2 * minute
    stats.offer({ type: 'long', baseDuration: 3 * minute })
    now += 20000
    stats.start('long', 3 * minute)
    expect(stats.debt.work).toBe(42 * minute)
    expect(stats.debt.balance).toBeCloseTo(42 * minute * rate)
  })

  it('assigns postponement work even when earlier rest left a credit', () => {
    const debt = new BreakDebt()
    debt.record('rest', at, at + 10 * minute, rate)
    debt.postpone(at + 10 * minute)
    debt.record('work', at + 10 * minute, at + 12 * minute, rate)
    expect(debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))).toBeGreaterThan(0)
  })

  it('shows postponement debt even if previous rest left a credit', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    stats.debt.balance = -10 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.postpone()
    stats.debt.postpone(now)
    now += 2 * minute
    expect(stats.snapshot().current.debtTotal).toBe(2 * minute * rate)
  })

  it('does not forecast a new shortage when a scheduled break arrives just after the timer boundary', () => {
    const debt = new BreakDebt({ work: 120 * minute + 1000, balance: 15 * minute })
    expect(debt.forecast(rate, projected([0, 40, 80], [15, 3, 3]))).toBe(0)
  })

  it('persists outstanding time and preserves its value when the rate changes', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 40 * minute, rate)
    const restored = new BreakDebt(JSON.parse(JSON.stringify(debt.serialize())))
    const next = at + 86400000
    restored.record('work', next, next + 10 * minute, 24 / 120)
    expect(restored.work).toBe(50 * minute)
    expect(restored.balance).toBe(9 * minute)
  })

  it('credits a cross-midnight AFK to each day without carrying yesterday’s surplus', () => {
    const midnight = new Date(2026, 10, 14).getTime()
    const debt = new BreakDebt()
    debt.record('work', midnight - 2 * minute, midnight, rate)
    debt.record('work', midnight, midnight + 2 * minute, rate)
    debt.recognizeIdle(midnight - 2 * minute, midnight + 2 * minute)
    expect(debt.work).toBe(0)
    expect(debt.balance).toBe(-2 * minute)
  })
})

describe('break debt audit (current cumulative-ledger model)', () => {
  it.each([
    [{ break: false }, 0],
    [{ break: true, extendedBreak: false, breakDuration: 5 * minute }, 15 * minute / (120 * minute)],
    [{ break: true, extendedBreak: true, extendedBreakInterval: 3, breakDuration: 2 * minute, extendedBreakDuration: 5 * minute }, 9 * minute / (120 * minute)],
    [{ break: true, extendedBreak: true, extendedBreakInterval: 2, breakDuration: 4 * minute, extendedBreakDuration: 12 * minute }, 16 * minute / (120 * minute)]
  ])('derives the live rate %j as %d rest per active minute', (overrides, expected) => {
    const settings = { break: true, extendedBreak: true, extendedBreakInterval: 3, breakDuration: 3 * minute, extendedBreakDuration: 15 * minute, ...overrides }
    expect(breakDebtRate({ get: key => settings[key] })).toBeCloseTo(expected)
  })

  it('a checkpoint restores every ledger field, including postponement and recent spans', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 40 * minute, rate)
    debt.postpone(at + 40 * minute)
    debt.record('work', at + 40 * minute, at + 45 * minute, rate)
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const checkpoint = debt.checkpoint()
    const before = JSON.stringify(debt.serialize())
    debt.record('rest', at + 45 * minute, at + 49 * minute, rate)
    debt.resolve(2 * minute)
    expect(JSON.stringify(debt.serialize())).not.toBe(before)
    debt.rollback(checkpoint)
    expect(debt.serialize()).toEqual(JSON.parse(before))
    expect(debt.postponement.earned).toBeCloseTo(5 * minute * rate)
    expect(debt.recent).toHaveLength(1)
    expect(debt.plan.every(value => value > 0)).toBe(true)
  })

  it('rolling back a skipped break does not let idle reclassify its rest twice', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    now += 40 * minute
    stats.offer({ type: 'long', baseDuration: 3 * minute })
    stats.start('long', 3 * minute)
    const balanceAtStart = stats.debt.balance
    now += 2 * minute
    stats.skip()
    expect(stats.debt.balance).toBe(balanceAtStart)
    now += 3 * minute
    stats.observeIdle(3 * minute, 3 * minute)
    expect(stats.debt.balance).toBeLessThan(balanceAtStart)
    expect(stats.debt.work).toBe(40 * minute)
  })

  it('a credited extra repayment keeps the remaining plan instead of wiping it', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 100 * minute, rate)
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const planned = [...debt.plan]
    debt.resolve(planned[0])
    expect(debt.plan[0]).toBeGreaterThan(0)
    expect(debt.postponement).toBeNull()
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    expect(debt.plan[0]).toBeGreaterThan(0)
  })
})
