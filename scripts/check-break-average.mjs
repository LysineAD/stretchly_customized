// Deterministic accounting checks for the schedule-aligned debt model.
import assert from 'node:assert/strict'
import BreakDebt, { breakDebtRate } from '../app/utils/breakDebt.js'
const minute = 60000
const settings = { break: true, extendedBreak: true, extendedBreakInterval: 3, microbreakInterval: 20 * minute, breakInterval: 1, breakDuration: 4 * minute, extendedBreakDuration: 12 * minute }
const rate = breakDebtRate({ get: key => settings[key] })
const upcoming = [4, 4, 12].map((duration, i) => ({ after: i * 40 * minute, duration: duration * minute }))
assert.equal(rate, 1 / 6)
for (let seed = 1; seed <= 200; seed++) {
  let rng = seed
  const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296)
  let debt = new BreakDebt()
  let now = new Date(2026, 0, 1, 8).getTime()
  let expected = 0
  for (let day = 0; day < 30; day++) {
    for (let i = 0; i < 12; i++) {
      const work = (20 + Math.floor(random() * 25)) * minute
      debt.record('work', now, now + work, rate)
      expected += work * rate
      now += work
      if (random() < 0.3) debt.postpone(now)
      const payment = debt.forecast(rate, upcoming)
      assert.ok(payment <= 6 * minute)
      assert.ok(Math.abs(debt.plan[2] - 3 * debt.plan[0]) < 0.001)
      const rest = random() < 0.2 ? 0 : ((i % 3 === 2 ? 12 : 4) * minute + payment) * (random() < 0.1 ? 0.5 : 1)
      debt.record('rest', now, now + rest, rate)
      expected -= rest
      now += rest
      debt.resolve(payment)
      assert.ok(Math.abs(debt.balance - expected) < 0.01)
    }
    debt = new BreakDebt(JSON.parse(JSON.stringify(debt.serialize())))
    assert.ok(Math.abs(debt.balance - expected) < 0.01)
    now = new Date(2026, 0, day + 2, 8).getTime()
  }
}
console.log('PASS: 200 seeded 30-day accounting runs preserve debt and surplus across restarts, enforce the six-minute limit and retain proportional forecasts.')
