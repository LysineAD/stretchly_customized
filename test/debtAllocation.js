import { describe, it, expect } from 'vitest'
import DebtAllocation from '../app/utils/debtAllocation.js'

const minute = 60000

describe('larger-break debt allocation', () => {
  it('charges active postponement time at the configured combined rate', () => {
    const debt = new DebtAllocation()
    debt.addPostponedWork(12 * minute, 1 / 6)
    expect(debt.amount).toBe(2 * minute)
  })

  it('charges the earned skipped break less base time actually taken', () => {
    const debt = new DebtAllocation()
    debt.addSkippedBreak(25 * minute, 40 * minute, 4 * minute)
    expect(debt.amount).toBe(2.5 * minute)
    debt.addSkippedBreak(105 * minute, 120 * minute, 12 * minute, 2 * minute)
    expect(debt.amount).toBe(11 * minute)
  })

  it('charges a reset only for active time since the last completed break', () => {
    const debt = new DebtAllocation()
    debt.addReset(10 * minute, 1 / 6)
    expect(debt.amount).toBe(10 * minute / 6)
  })

  it('weights the next three shares by their configured base durations', () => {
    const debt = new DebtAllocation(5 * minute)
    expect(debt.shares([4, 4, 12].map(value => value * minute))).toEqual([1, 1, 3].map(value => value * minute))
    debt.replan()
    expect(debt.shares([3, 3, 6].map(value => value * minute))).toEqual([1.25, 1.25, 2.5].map(value => value * minute))
  })

  it('retains unpaid debt and limits payment to the current assigned share', () => {
    const debt = new DebtAllocation(5 * minute)
    expect(debt.pay(minute, 30 * 1000)).toBe(30 * 1000)
    expect(debt.amount).toBe(4.5 * minute)
    expect(debt.pay(minute, 20 * minute)).toBe(minute)
    expect(debt.amount).toBe(3.5 * minute)
  })

  it('keeps later shares assigned after the first break is paid', () => {
    const debt = new DebtAllocation(5 * minute)
    debt.shares([4, 4, 12].map(value => value * minute))
    debt.pay(minute, minute)
    debt.advance()
    expect(debt.shares([4, 12, 4].map(value => value * minute))).toEqual([1, 3, 0].map(value => value * minute))
  })

  it('caps each added break duration and carries the rest', () => {
    const debt = new DebtAllocation(60 * minute)
    expect(debt.shares([4, 4, 12].map(value => value * minute))).toEqual([6, 6, 6].map(value => value * minute))
    debt.pay(6 * minute, 6 * minute)
    expect(debt.amount).toBe(54 * minute)
  })

  it('keeps unpaid debt across repeated additions and partial payments', () => {
    const debt = new DebtAllocation()
    let expected = 0
    let seed = 31
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const added = seed % 120000
      debt.add(added)
      expected += added
      const assigned = debt.shares([4, 4, 12].map(value => value * minute))[0]
      const elapsed = seed % 45000
      const paid = Math.min(expected, assigned, elapsed)
      debt.pay(assigned, elapsed)
      expected -= paid
      expect(debt.amount).toBeCloseTo(expected, 5)
    }
  })
})
