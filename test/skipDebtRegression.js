import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import BreakStatistics from '../app/utils/breakStatistics.js'
import { breakDebtRate } from '../app/utils/breakDebt.js'

const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8')
const sourceOf = name => {
  const start = main.indexOf(`function ${name} (`)
  return main.slice(start, main.indexOf('\nfunction ', start + 1))
}
const minute = 60000
const settings = {
  microbreak: true,
  break: true,
  extendedBreak: true,
  breakInterval: 1,
  microbreakInterval: 20 * minute,
  breakDuration: 4 * minute,
  extendedBreakDuration: 12 * minute,
  extendedBreakInterval: 2
}
const rate = breakDebtRate({ get: key => settings[key] })
const upcoming = [
  { after: 0, duration: 4 * minute },
  { after: 40 * minute, duration: 12 * minute },
  { after: 80 * minute, duration: 4 * minute }
]

const harness = () => {
  let now = new Date(2026, 10, 13, 9).getTime()
  const statistics = new BreakStatistics({ now: () => now, debtRate: () => rate })
  let paymentAfterSkip = 0
  const context = {
    statistics,
    settings: { get: key => settings[key] },
    breakWins: [{}],
    microbreakWins: null,
    extendedBreakWins: null,
    breakComplete: () => null,
    finishMicrobreak: vi.fn(),
    finishExtendedBreak: vi.fn(),
    increaseDanger: vi.fn(),
    log: { info: vi.fn() },
    updateTray: vi.fn(),
    breakPlanner: {
      nextBreak: () => {
        statistics.advance()
        paymentAfterSkip = statistics.debt.forecast(rate, upcoming)
      },
      clear: vi.fn()
    },
    Date: { now: () => now }
  }
  return {
    context,
    statistics,
    advance: ms => { now += ms },
    paymentAfterSkip: () => paymentAfterSkip
  }
}

describe('tray Skip is not a time-debt event', () => {
  it('preserves the outstanding balance, postponement and repayment plan', () => {
    const { context, statistics, advance, paymentAfterSkip } = harness()
    // A pre-existing debt from work that was not compensated by rest.
    statistics.debt.balance = 20 * minute
    statistics.debt.work = 100 * minute
    const payment = statistics.debt.forecast(rate, upcoming)
    expect(payment).toBeGreaterThan(0)
    statistics.debt.postpone(new Date(2026, 10, 13, 9).getTime())
    statistics.debt.postponement.earned = 3 * minute

    statistics.offer({ type: 'long', baseDuration: 4 * minute })
    statistics.episode.debtPayment = payment
    advance(10000)
    statistics.start('long', 4 * minute)
    advance(10000)
    const balanceBeforeSkip = statistics.debt.balance
    const planBeforeSkip = [...statistics.debt.plan]
    const resolve = vi.spyOn(statistics.debt, 'resolve')

    runInNewContext(sourceOf('skipCurrentBreak') + '\n' + sourceOf('finishBreak') + '\nskipCurrentBreak()', context)

    expect(resolve).not.toHaveBeenCalled()
    expect(statistics.debt.balance).toBe(balanceBeforeSkip)
    expect(statistics.debt.postponement).not.toBeNull()
    expect(statistics.debt.postponement.earned).toBe(3 * minute)
    expect(statistics.debt.plan[0]).toBeGreaterThan(0)
    expect(planBeforeSkip[0]).toBeGreaterThan(0)
    expect(paymentAfterSkip()).toBeGreaterThan(0)
    expect(statistics.snapshot().current.debtTotal).toBe(balanceBeforeSkip)
  })

  it('does not credit the skipped break window as rest', () => {
    const { context, statistics, advance } = harness()
    statistics.debt.balance = 8 * minute
    statistics.debt.work = 100 * minute
    statistics.offer({ type: 'long', baseDuration: 4 * minute })
    advance(10000)
    statistics.start('long', 4 * minute)
    advance(3 * minute)
    const before = statistics.debt.balance

    runInNewContext(sourceOf('skipCurrentBreak') + '\n' + sourceOf('finishBreak') + '\nskipCurrentBreak()', context)

    expect(statistics.debt.balance).toBe(before)
  })
})

const skipToHarness = () => {
  let now = new Date(2026, 10, 13, 9).getTime()
  const statistics = new BreakStatistics({ now: () => now, debtRate: () => rate })
  const context = {
    statistics,
    closeBreakNotice: vi.fn(),
    increaseDanger: vi.fn(),
    breakComplete: () => null,
    log: { info: vi.fn() },
    updateTray: vi.fn(),
    danger: 0,
    microbreakWins: null,
    breakWins: null,
    extendedBreakWins: null,
    breakPlanner: {
      skipToMicrobreak: vi.fn(),
      skipToBreak: vi.fn(),
      skipToExtendedBreak: vi.fn(),
      reset: vi.fn()
    },
    Date: { now: () => now }
  }
  return { context, statistics, tick: ms => { now += ms } }
}

// Every entry under tray "Skip to the next ...", plus "Reset breaks", used to
// call debt.replan(), which wiped the postponement and the three-break plan.
describe('skip-to and reset actions are not time-debt events', () => {
  const entries = ['skipToMicrobreak', 'skipToBreak', 'skipToExtendedBreak', 'resetBreaks']

  it.each(entries)('%s keeps the visible debt and the postponement', name => {
    const { context, statistics } = skipToHarness()
    // Earlier rest left a credit, so the UI debt is carried entirely by the
    // postponement earned during repeated postpones.
    statistics.debt.balance = -26 * minute
    statistics.debt.work = 100 * minute
    statistics.debt.postpone(context.Date.now())
    statistics.debt.postponement.earned = 4 * minute
    statistics.debt.forecast(rate, upcoming)
    const before = statistics.snapshot().current.debtTotal
    expect(before).toBe(4 * minute)

    runInNewContext(sourceOf(name) + '\n' + name + '()', context)

    expect(statistics.snapshot().current.debtTotal).toBe(before)
    expect(statistics.debt.postponement?.earned).toBe(4 * minute)
    expect(statistics.debt.balance).toBe(-26 * minute)
  })

  it.each(entries)('%s does not bank the abandoned break window as rest', name => {
    const { context, statistics, tick } = skipToHarness()
    statistics.debt.balance = 8 * minute
    statistics.debt.work = 100 * minute
    statistics.debt.postpone(context.Date.now())
    statistics.debt.postponement.earned = 3 * minute
    statistics.debt.forecast(rate, upcoming)
    statistics.offer({ type: 'long', baseDuration: 4 * minute })
    tick(10000)
    statistics.start('long', 4 * minute)
    const atBreakStart = statistics.debt.balance
    tick(3 * minute)
    statistics.advance()
    expect(statistics.debt.balance).toBeLessThan(atBreakStart)

    runInNewContext(sourceOf(name) + '\n' + name + '()', context)

    // The skipped window earns no rest credit and the postponement survives.
    expect(statistics.debt.balance).toBe(atBreakStart)
    expect(statistics.debt.postponement?.earned).toBe(3 * minute)
    expect(statistics.snapshot().current.debtTotal).toBeGreaterThanOrEqual(3 * minute)
  })
})
