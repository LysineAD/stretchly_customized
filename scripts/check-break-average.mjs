import assert from 'node:assert/strict'
import DebtSession from '../app/utils/debtSession.js'
import { breakDebtRate } from '../app/utils/breakDebt.js'

const minute = 60000
for (let seed = 1; seed <= 200; seed++) {
  let rng = seed
  const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296)
  const normal = (2 + Math.floor(random() * 5)) * minute
  const extended = (8 + Math.floor(random() * 10)) * minute
  const cadence = (25 + Math.floor(random() * 20)) * minute
  const config = { break: true, extendedBreak: true, extendedBreakInterval: 3, microbreakInterval: cadence / 2, breakInterval: 1, breakDuration: normal, extendedBreakDuration: extended }
  const rate = breakDebtRate({ get: key => config[key] })
  let session = new DebtSession()
  let expected = 0
  for (let day = 0; day < 30; day++) {
    for (let i = 0; i < 9; i++) {
      const work = Math.floor(random() * cadence)
      session.recordWork(work, rate)
      const action = Math.floor(random() * 3)
      if (action === 0) {
        const delay = Math.floor(random() * 12 * minute)
        session.postpone()
        session.recordWork(delay, rate)
        session.returned()
        expected += delay * rate
        const assigned = session.debt.shares([normal, normal, extended])[0]
        const extra = random() < 0.2 ? assigned / 2 : assigned
        expected -= Math.min(expected, assigned, extra)
        session.complete('long', assigned, extra)
      } else if (action === 1) {
        expected += normal * work / cadence
        session.skip('long', cadence, normal, 0, 0, 0)
      } else {
        expected += work * rate
        session.reset(rate)
      }
      assert.ok(Math.abs(session.debt.amount - expected) < 0.01, 'debt must equal charges less actual payments')
      assert.ok(session.debt.shares([normal, normal, extended]).every(share => share <= 6 * minute + 0.001))
    }
    session = DebtSession.restore(JSON.parse(JSON.stringify(session.serialize())))
    assert.ok(Math.abs(session.debt.amount - expected) < 0.01, 'restart must preserve debt')
  }
}
console.log('PASS: 200 seeded 30-day schedules preserve debt through postpones, skips, resets, partial payments and restart.')
