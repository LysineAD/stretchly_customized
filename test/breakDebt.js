import { describe, it, expect } from 'vitest'
import { breakDebtRate } from '../app/utils/breakDebt.js'
import BreakStatistics from '../app/utils/breakStatistics.js'

const minute = 60000
const config = { longInterval: 40 * minute, cycleInterval: 120 * minute, longDuration: 4 * minute, extendedDuration: 12 * minute }
const values = { break: true, extendedBreak: true, extendedBreakInterval: 3, microbreakInterval: 20 * minute, breakInterval: 1, breakDuration: 4 * minute, extendedBreakDuration: 12 * minute }
const rate = breakDebtRate({ get: key => values[key] })
const durations = [4, 4, 12].map(value => value * minute)

function fixture (data = {}) {
  let now = new Date(2026, 10, 13, 9).getTime()
  const stats = new BreakStatistics({ data, now: () => now, debtRate: () => rate, debtSettings: () => config })
  return { stats, advance: ms => { now += ms } }
}

describe('break debt integration', () => {
  it('derives the average rate from configured values', () => {
    expect(rate).toBeCloseTo(1 / 6)
    expect(breakDebtRate({ get: key => ({ ...values, breakDuration: 3 * minute, extendedBreakDuration: 6 * minute })[key] })).toBeCloseTo(1 / 10)
  })

  it('charges three postponements and pays only the assigned share', () => {
    const { stats, advance } = fixture()
    advance(40 * minute)
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    for (const delay of [2, 4, 6]) {
      stats.postpone()
      advance(delay * minute)
      stats.advance()
      stats.offer({ type: 'long', baseDuration: 4 * minute })
    }
    expect(stats.debt.amount).toBeCloseTo(2 * minute)
    const shares = stats.debt.shares(durations)
    expect(shares).toEqual([24, 24, 72].map(value => value * 1000))
    stats.episode.debtPayment = shares[0]
    stats.start('long', 4 * minute + shares[0])
    advance(4 * minute + shares[0])
    stats.finish(true)
    expect(stats.debt.amount).toBeCloseTo(96 * 1000)
    expect(stats.debt.shares([4, 12, 4].map(value => value * minute))).toEqual([24, 72, 0].map(value => value * 1000))
  })

  it('charges a reset since the most recently completed larger break', () => {
    const { stats, advance } = fixture()
    advance(10 * minute)
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.start('long', 4 * minute)
    advance(4 * minute)
    stats.finish(true)
    advance(10 * minute)
    stats.resetDebt()
    expect(stats.debt.amount).toBeCloseTo(10 * minute / 6)
  })

  it('removes misclassified idle from postponed work without removing earlier debt', () => {
    const { stats, advance } = fixture({ debt: { modelVersion: 3, balance: minute } })
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    stats.postpone()
    advance(4 * minute)
    stats.observeIdle(4 * minute, 4 * minute)
    expect(stats.debt.amount).toBeCloseTo(minute)
  })

  it('credits idle only to the immediate share and retains the earned Extended portion', () => {
    const { stats, advance } = fixture({ debt: { modelVersion: 3, balance: 5 * minute } })
    advance(35 * minute)
    stats.advance()
    const assigned = stats.debt.shares(durations)[0]
    advance(5 * minute)
    stats.observeIdle(5 * minute, 4 * minute)
    stats.idleRecovery('long', 5 * minute, 4 * minute, assigned, false)
    expect(stats.debt.amount).toBeCloseTo(7.5 * minute)
  })

  it('leaves earlier debt intact when an Extended-length idle resets a session', () => {
    const { stats, advance } = fixture({ debt: { modelVersion: 3, balance: 5 * minute } })
    advance(30 * minute)
    stats.advance()
    const assigned = stats.debt.shares([12, 4, 4].map(value => value * minute))[0]
    advance(14 * minute)
    stats.observeIdle(14 * minute, 4 * minute)
    stats.idleRecovery('extended', 14 * minute, 12 * minute, assigned, true)
    stats.session.finishIdleSession()
    expect(stats.debt.amount).toBe(3 * minute)
  })

  it('counts timed extra rest before an idle-fulfilled break closes without paying it twice', () => {
    const { stats, advance } = fixture({ debt: { modelVersion: 3, balance: 5 * minute } })
    advance(40 * minute)
    stats.offer({ type: 'long', baseDuration: 4 * minute })
    const assigned = stats.debt.shares(durations)[0]
    stats.episode.debtPayment = assigned
    stats.start('long', 5 * minute)
    advance(5 * minute)
    stats.finish(true, { idle: true })
    expect(stats.debt.amount).toBe(4 * minute)
    const remaining = stats.debt.shares(durations)[0]
    stats.idleRecovery('long', 6 * minute, 4 * minute, remaining, true)
    expect(stats.debt.amount).toBe(8 * minute)
  })
})
