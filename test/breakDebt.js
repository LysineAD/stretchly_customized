import { describe, expect, it } from 'vitest'
import BreakDebt, { breakDebtRate, workBlock } from '../app/utils/breakDebt.js'
import BreakStatistics from '../app/utils/breakStatistics.js'

const minute = 60000
const at = new Date(2026, 10, 13, 9).getTime()
// A fixed synthetic rate for the ledger mechanics below. breakDebtRate()
// itself is schedule-derived and is tested separately.
const rate = 21 / 120
const projected = (times, minutes = [3, 3, 15]) => times.map((after, i) => ({
  after: after * minute,
  duration: minutes[i] * minute
}))

describe('break debt', () => {
  it.each([
    // Mini interval, larger-break spacing, Extended interval, Long, Extended, cycle rest, cycle work
    [20, 1, 2, 4, 12, 16, 80],
    [20, 1, 3, 2, 5, 9, 120],
    [15, 1, 3, 3, 15, 21, 90],
    [10, 2, 3, 3, 15, 21, 90]
  ])('derives r from one whole larger-break cycle %j', (miniInterval, breakInterval, extendedInterval, normal, extended, rest, cycle) => {
    const settings = {
      break: true,
      microbreakInterval: miniInterval * minute,
      breakInterval,
      extendedBreak: true,
      extendedBreakInterval: extendedInterval,
      breakDuration: normal * minute,
      extendedBreakDuration: extended * minute
    }
    expect(breakDebtRate({ get: key => settings[key] })).toBeCloseTo(rest / cycle, 12)
  })

  it('matches the live profile’s ideal larger-break average', () => {
    const settings = {
      break: true,
      microbreakInterval: 20 * minute,
      breakInterval: 1,
      extendedBreak: true,
      extendedBreakInterval: 2,
      breakDuration: 4 * minute,
      extendedBreakDuration: 12 * minute
    }
    expect(breakDebtRate({ get: key => settings[key] })).toBeCloseTo((4 + 12) / (2 * 40), 12)
  })

  it('tracks the schedule when the Mini interval or larger-break spacing changes', () => {
    const base = {
      break: true,
      microbreakInterval: 20 * minute,
      breakInterval: 1,
      extendedBreak: false,
      extendedBreakInterval: 3,
      breakDuration: 4 * minute,
      extendedBreakDuration: 12 * minute
    }
    const r = overrides => breakDebtRate({ get: key => ({ ...base, ...overrides })[key] })
    expect(r({ microbreakInterval: 40 * minute })).toBeCloseTo(r({}) / 2, 12)
    expect(r({ breakInterval: 2 })).toBeCloseTo(r({}) * 2 / 3, 12)
  })

  it('has no debt when larger breaks are disabled', () => {
    const settings = { break: false, microbreakInterval: 20 * minute, breakDuration: 4 * minute }
    expect(breakDebtRate({ get: key => settings[key] })).toBe(0)
  })

  it('keeps a finite legacy rate when schedule intervals are missing', () => {
    const settings = {
      break: true,
      extendedBreak: true,
      extendedBreakInterval: 3,
      breakDuration: 3 * minute,
      extendedBreakDuration: 15 * minute
    }
    expect(breakDebtRate({ get: key => settings[key] })).toBe(21 * minute / workBlock)
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

  it('spreads postponement work proportionally instead of charging it all to the returning break', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 120 * minute, rate)
    debt.record('rest', at + 120 * minute, at + 126 * minute, rate)
    debt.postpone(at + 126 * minute)
    debt.record('work', at + 126 * minute, at + 136 * minute, rate)
    expect(debt.balance).toBe(16.75 * minute)
    // 1.75 min earned, split 15:3:3 over the next three larger breaks.
    const payment = debt.forecast(rate, [
      ...projected([0, 30, 60], [15, 3, 3]),
      { after: 90 * minute, duration: 15 * minute }
    ])
    expect(payment).toBe(75000)
    expect(debt.plan).toEqual([75000, 15000, 15000])
    expect(payment).toBeLessThan(debt.postponement.earned)
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

describe('break debt audit (schedule-aligned cumulative ledger)', () => {
  it.each([
    [{ break: false }, 0],
    [{ extendedBreak: false, breakDuration: 5 * minute }, (5 * minute) / (40 * minute)],
    [{ extendedBreakInterval: 3, breakDuration: 2 * minute, extendedBreakDuration: 5 * minute }, (9 * minute) / (3 * 40 * minute)],
    [{ extendedBreakInterval: 2, breakDuration: 4 * minute, extendedBreakDuration: 12 * minute }, (16 * minute) / (2 * 40 * minute)]
  ])('derives the live rate %j as %d rest per active minute', (overrides, expected) => {
    const settings = {
      break: true,
      microbreakInterval: 20 * minute,
      breakInterval: 1,
      extendedBreak: true,
      extendedBreakInterval: 3,
      breakDuration: 3 * minute,
      extendedBreakDuration: 15 * minute,
      ...overrides
    }
    expect(breakDebtRate({ get: key => settings[key] })).toBeCloseTo(expected, 12)
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

  it('keeps the visible debt, postponement and plan across a restart', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    now += 10000
    stats.postpone()
    stats.debt.postpone(now)
    now += 12 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const visible = stats.snapshot().current.debtTotal
    const saved = JSON.parse(stats.serialize())
    expect(saved.debt.postponement.earned).toBeGreaterThan(0)

    const restarted = new BreakStatistics({ data: saved, now: () => now, debtRate: () => rate })
    expect(restarted.debt.postponement?.earned).toBe(saved.debt.postponement.earned)
    expect(restarted.debt.plan).toEqual(saved.debt.plan)
    expect(restarted.debt.balance).toBe(saved.debt.balance)
    expect(restarted.snapshot().current.debtTotal).toBe(visible)
  })

  it('keeps a postponement debt across a restart even when earlier rest left a credit', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    stats.debt.balance = -10 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    now += 10000
    stats.postpone()
    stats.debt.postpone(now)
    now += 12 * minute
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    const visible = stats.snapshot().current.debtTotal
    const restarted = new BreakStatistics({
      data: JSON.parse(stats.serialize()), now: () => now, debtRate: () => rate
    })
    expect(restarted.debt.balance).toBeLessThan(0)
    expect(restarted.snapshot().current.debtTotal).toBe(visible)
    expect(restarted.snapshot().current.debtTotal).toBeGreaterThan(0)
  })

  it('ignores a malformed persisted postponement', () => {
    expect(new BreakDebt({ postponement: { earned: 'nope' } }).postponement).toBeNull()
    expect(new BreakDebt({ postponement: null }).postponement).toBeNull()
    const clamped = new BreakDebt({ postponement: { from: 1, earned: -5 } })
    expect(clamped.postponement.earned).toBe(0)
    expect(clamped.postponement.from).toBe(1)
  })

  it('replanning after an AFK reset keeps the outstanding postponement', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 40 * minute, rate)
    debt.postpone(at + 40 * minute)
    debt.record('work', at + 40 * minute, at + 45 * minute, rate)
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    debt.replan({ preserveDelay: true })
    expect(debt.plan).toEqual([0, 0, 0])
    expect(debt.postponement?.earned).toBeCloseTo(5 * minute * rate)
    expect(debt.balance).toBeGreaterThan(0)
  })

  it('replanning by default keeps the postponement that the UI displays', () => {
    const debt = new BreakDebt()
    debt.balance = -26 * minute
    debt.record('work', at, at + 40 * minute, rate)
    debt.postpone(at + 40 * minute)
    debt.postponement.earned = 4 * minute
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const visible = Math.max(0, debt.balance, debt.postponement.earned)
    debt.replan()
    expect(debt.plan).toEqual([0, 0, 0])
    expect(debt.postponement?.earned).toBe(4 * minute)
    expect(Math.max(0, debt.balance, debt.postponement?.earned ?? 0)).toBe(visible)
  })

  it('an early break finish does not consume the three-break plan or the postponement', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 100 * minute, rate)
    debt.postpone(at + 100 * minute)
    debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const plan = [...debt.plan]
    const earned = debt.postponement.earned
    debt.resolve(0)
    expect(debt.plan).toEqual(plan)
    expect(debt.postponement?.earned).toBe(earned)
    // The next forecast still spreads the unpaid rest by Long/Extended length.
    expect(debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))).toBeGreaterThan(0)
  })

  it('a full repayment consumes exactly one slot and retires the postponement', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 100 * minute, rate)
    debt.postpone(at + 100 * minute)
    const payment = debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const remaining = [...debt.plan.slice(1), 0]
    debt.resolve(payment)
    expect(debt.plan).toEqual(remaining)
    expect(debt.postponement).toBeNull()
  })

  it('a credit-backed postponement is repaid over all three slots, not lost after the first', () => {
    const debt = new BreakDebt()
    debt.balance = -26 * minute
    debt.work = 100 * minute
    debt.postpone(at)
    debt.postponement.earned = 4 * minute
    const upcoming = projected([0, 40, 80], [4, 4, 12])
    let repaid = 0
    for (let slot = 0; slot < 3; slot++) {
      const payment = debt.forecast(rate, upcoming)
      if (slot === 0) expect(debt.plan[2] / debt.plan[0]).toBeCloseTo(3, 6)
      repaid += payment
      debt.resolve(payment)
      const owed = 4 * minute - repaid
      expect(debt.plan.reduce((sum, value) => sum + value, 0)).toBeCloseTo(owed, 0)
      expect(Math.max(0, debt.balance, debt.postponement?.earned ?? 0)).toBeCloseTo(owed, 0)
    }
    expect(repaid).toBeCloseTo(4 * minute, 0)
    expect(debt.postponement).toBeNull()
  })

  it('freezes the postponement accrual once its three-slot plan starts repaying, even across a restart', () => {
    const debt = new BreakDebt()
    debt.balance = -26 * minute
    debt.work = 100 * minute
    debt.postpone(at)
    debt.postponement.earned = 4 * minute
    const upcoming = projected([0, 40, 80], [4, 4, 12])
    debt.resolve(debt.forecast(rate, upcoming))
    const earnedAfter = debt.postponement.earned
    expect(debt.postponement.committed).toBe(true)
    debt.record('work', at + minute, at + 41 * minute, rate)
    expect(debt.postponement.earned).toBe(earnedAfter)
    const restarted = new BreakDebt(JSON.parse(JSON.stringify(debt.serialize())))
    expect(restarted.postponement.committed).toBe(true)
    restarted.record('work', at + 41 * minute, at + 81 * minute, rate)
    expect(restarted.postponement.earned).toBe(earnedAfter)
  })

  it('abandoning a running break keeps the ledger exactly as it was at break start', () => {
    let now = at
    const stats = new BreakStatistics({ now: () => now, debtRate: () => rate })
    stats.debt.balance = 8 * minute
    stats.debt.work = 100 * minute
    stats.debt.postpone(at)
    stats.debt.postponement.earned = 3 * minute
    stats.debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    now += 10000
    stats.start('long', 4 * minute)
    const atBreakStart = JSON.stringify(stats.debt.serialize())
    now += 3 * minute
    stats.advance()
    expect(JSON.stringify(stats.debt.serialize())).not.toBe(atBreakStart)
    stats.abandon()
    expect(JSON.stringify(stats.debt.serialize())).toBe(atBreakStart)
    expect(stats.episode).toBeNull()
  })

  it('never charges one break the whole three-break plan', () => {
    const debt = new BreakDebt()
    debt.record('work', at, at + 60 * minute, rate)
    debt.postpone(at + 60 * minute)
    debt.record('work', at + 60 * minute, at + 72 * minute, rate)
    const payment = debt.forecast(rate, projected([0, 40, 80], [4, 4, 12]))
    const total = debt.plan.reduce((sum, value) => sum + value, 0)
    expect(payment).toBe(debt.plan[0])
    expect(payment / total).toBeCloseTo(4 / 20)
    expect(debt.plan[2] / debt.plan[0]).toBeCloseTo(3)
  })
})
