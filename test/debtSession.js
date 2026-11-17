import { describe, it, expect } from 'vitest'
import DebtSession from '../app/utils/debtSession.js'

const minute = 60000
const rate = 1 / 6

describe('debt events', () => {
  it('charges postponed work once and keeps the debt after reset', () => {
    const session = new DebtSession()
    session.recordWork(40 * minute, rate)
    session.postpone()
    session.recordWork(12 * minute, rate)
    session.reset(rate)
    expect(session.debt.amount).toBeCloseTo((2 + 40 / 6) * minute)
  })

  it('adds each postponement without charging the same delay twice', () => {
    const session = new DebtSession()
    session.recordWork(40 * minute, rate)
    for (const delay of [2, 4, 6]) {
      session.postpone()
      session.recordWork(delay * minute, rate)
      session.returned()
    }
    expect(session.debt.amount).toBeCloseTo(2 * minute)
    expect(session.debt.shares([4, 4, 12].map(value => value * minute)))
      .toEqual([24, 24, 72].map(value => value * 1000))
  })

  it('does not look back before a completed break when resetting', () => {
    const session = new DebtSession()
    session.recordWork(10 * minute, rate)
    session.complete('long', 0, 0)
    session.recordWork(10 * minute, rate)
    session.reset(rate)
    expect(session.debt.amount).toBeCloseTo(10 * minute / 6)
  })

  it('carries the unpaid part of assigned debt when a break is skipped', () => {
    const session = new DebtSession({ amount: minute })
    session.recordWork(40 * minute, rate)
    session.skip('long', 40 * minute, 4 * minute, 4 * minute, minute, minute / 2)
    expect(session.debt.amount).toBe(minute / 2)
  })

  it('preserves the Extended portion after short idle without charging it twice', () => {
    const session = new DebtSession()
    session.recordWork(40 * minute, rate)
    session.shortIdle(12 * minute, 120 * minute)
    expect(session.debt.amount).toBe(4 * minute)
    session.recordWork(40 * minute, rate)
    session.skip('extended', 120 * minute, 12 * minute, 0, 0, 0)
    expect(session.debt.amount).toBe(8 * minute)
  })

  it('preserves debt and interval progress through serialization', () => {
    const original = new DebtSession({ amount: 2 * minute })
    original.recordWork(10 * minute, rate)
    const restored = new DebtSession(JSON.parse(JSON.stringify(original.serialize())))
    restored.reset(rate)
    expect(restored.debt.amount).toBeCloseTo((2 + 10 / 6) * minute)
  })

  it('preserves all unpaid debt when a long idle resets the schedule', () => {
    const session = new DebtSession({ amount: 5 * minute })
    session.debt.shares([4, 4, 12].map(value => value * minute))
    session.recordWork(25 * minute, rate)
    session.finishIdleSession()
    session.debt.replan()
    expect(session.debt.amount).toBe(5 * minute)
    expect(session.work).toBe(0)
    expect(session.cycleWork).toBe(0)
  })

  it('preserves the assigned later shares through restart', () => {
    const original = new DebtSession({ amount: 5 * minute })
    original.debt.shares([4, 4, 12].map(value => value * minute))
    original.complete('long', minute, minute)
    const restored = DebtSession.restore(original.serialize())
    expect(restored.debt.shares([4, 12, 4].map(value => value * minute))).toEqual([1, 3, 0].map(value => value * minute))
  })

  it('preserves existing positive debt while migrating the old ledger', () => {
    const restored = DebtSession.restore({ modelVersion: 3, balance: 7 * minute })
    expect(restored.debt.amount).toBe(7 * minute)
    expect(DebtSession.restore({ modelVersion: 3, balance: -7 * minute }).debt.amount).toBe(0)
  })

  it('does not continue an abandoned postponement after restart', () => {
    const original = new DebtSession({ amount: minute })
    original.postpone()
    const restored = DebtSession.restore(original.serialize())
    restored.recordWork(6 * minute, rate)
    expect(restored.debt.amount).toBe(minute)
    expect(restored.work).toBe(6 * minute)
  })

  it('pays only the immediate Long share from idle beyond its base', () => {
    const session = new DebtSession({ amount: 5 * minute })
    session.idle('long', 10 * minute, 4 * minute, minute, 4 * minute, 12 * minute, 120 * minute)
    expect(session.debt.amount).toBe(4 * minute)
  })

  it('does not pay Extended debt until idle exceeds the Extended base', () => {
    const session = new DebtSession({ amount: 5 * minute })
    session.idle('extended', 8 * minute, 12 * minute, 3 * minute, 4 * minute, 12 * minute, 120 * minute)
    expect(session.debt.amount).toBe(5 * minute)
    session.idle('extended', 14 * minute, 12 * minute, 3 * minute, 4 * minute, 12 * minute, 120 * minute)
    expect(session.debt.amount).toBe(3 * minute)
  })

  it('uses the configured Extended duration even when shorter than Long', () => {
    const session = new DebtSession({ amount: 3 * minute })
    session.idle('extended', 5 * minute, 4 * minute, minute, 6 * minute, 4 * minute, 120 * minute)
    expect(session.debt.amount).toBe(2 * minute)
  })
})
