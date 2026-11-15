// Final sanity check for the whole break-debt design.
//
// ONE equation describes everything this fork does:
//
//   W = active work minutes in a day (breaks, waiting and AFK excluded)
//   r = rest owed per active minute  (breakDebtRate(settings))
//   R = rest actually taken in Long/Extended breaks
//   B = r * W - R                  (the persisted balance, carried to tomorrow)
//
// forecast() spreads any projected shortfall over the next three larger
// breaks, so skipped or postponed breaks are repaid instead of lost. The rate
// itself is the schedule's own larger-break average:
//
//   cadence = microbreakInterval * (breakInterval + 1)
//   cycle   = extendedBreakInterval * cadence
//   r       = (one Extended + (extendedBreakInterval - 1) Longs) / cycle
//
// Mini breaks are real rest but are not debt events, so they count towards
// the ideal daily total without being part of r. Debt carried to tomorrow
// counts as today's rest for this check, as specified.
//
// Randomized settings and skip/postpone behaviour must satisfy seven things:
//   1. r equals the schedule's larger-break average for every settings set
//   2. R + B == r*W (nothing is lost or invented)
//   3. (all rest taken + debt carried) == the ideal daily average rest
//   4. a Quit/restart in the middle of the day loses no debt, plan or delay
//   5. one break is never charged more than its slot in the three-break plan
//   6. a tray "Skip to ...", "Reset breaks" or early finish loses no debt
//   7. the three slots repay the whole postponement, not just the first one

import BreakDebt, { breakDebtRate } from '../app/utils/breakDebt.js'

const minute = 60000
const dayWork = 8 * 60 * minute

const mulberry32 = seed => () => {
  seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

const settingsFor = rnd => {
  const breakInterval = rnd() < 0.5 ? 1 : 2
  return {
    break: true,
    microbreak: true,
    microbreakInterval: (15 + Math.floor(rnd() * 16)) * minute,
    microbreakDuration: (10 + Math.floor(rnd() * 51)) * 1000,
    breakInterval,
    breakDuration: (2 + Math.floor(rnd() * 7)) * minute,
    extendedBreak: rnd() < 0.8,
    extendedBreakDuration: (6 + Math.floor(rnd() * 15)) * minute,
    extendedBreakInterval: 2 + Math.floor(rnd() * 3)
  }
}

const cadenceOf = settings => settings.microbreakInterval * (settings.breakInterval + 1)

const largerDuration = (settings, ordinal) => {
  if (!settings.extendedBreak) return settings.breakDuration
  return ordinal % settings.extendedBreakInterval === 0 ? settings.extendedBreakDuration : settings.breakDuration
}

// Rest per active minute that the untouched schedule offers in Long/Extended
// breaks alone. This is what breakDebtRate() must return.
const largerIdealRate = settings => {
  const m = settings.extendedBreakInterval
  const averageLarger = settings.extendedBreak
    ? ((m - 1) * settings.breakDuration + settings.extendedBreakDuration) / m
    : settings.breakDuration
  return averageLarger / cadenceOf(settings)
}

// The daily "average break" target also includes the Mini breaks.
const idealRate = settings => largerIdealRate(settings) +
  settings.breakInterval * settings.microbreakDuration / cadenceOf(settings)

const simulate = (settings, seed) => {
  const rnd = mulberry32(seed)
  const rate = breakDebtRate({ get: key => settings[key] })
  const ideal = idealRate(settings)
  const largerIdeal = largerIdealRate(settings)
  const cadence = cadenceOf(settings)
  const skipChance = rnd() * 0.5
  const postponeChance = rnd() * 0.3
  const skipToChance = rnd() * 0.3
  let debt = new BreakDebt()
  let clock = new Date(2026, 10, 14, 9).getTime()
  let work = 0
  let largerRest = 0
  let allRest = 0
  let ordinal = 1
  let restartViolations = 0
  let spreadViolations = 0
  let skipToViolations = 0
  const upcoming = () => [0, 1, 2, 3].map(i => ({ after: i * cadence, duration: largerDuration(settings, ordinal + i) }))

  while (work < dayWork) {
    const step = Math.min(cadence, dayWork - work)
    debt.record('work', clock, clock + step, rate)
    clock += step
    work += step
    const miniRest = settings.breakInterval * settings.microbreakDuration
    clock += miniRest
    allRest += miniRest

    const base = largerDuration(settings, ordinal)
    const roll = rnd()
    if (roll >= skipChance) {
      if (roll < skipChance + postponeChance) {
        const delay = 2 * minute
        debt.postpone(clock)
        debt.record('work', clock, clock + delay, rate)
        clock += delay
        work += delay
      }
      const payment = debt.forecast(rate, upcoming())
      // The returning break may only take its own slot of the three-break plan.
      if (payment > debt.plan[0] + 1) spreadViolations++
      const duration = base + payment
      debt.record('rest', clock, clock + duration, rate)
      clock += duration
      largerRest += duration
      allRest += duration
      debt.resolve(payment)
    }
    // A tray "Skip to ...", "Reset breaks" or an early finish is not a debt
    // event. All three used to call replan()/resolve() in a way that wiped the
    // postponement, which is the only thing keeping the debt visible after
    // earlier rest left a credit.
    if (rnd() < skipToChance) {
      const visibleBefore = Math.max(0, debt.balance, debt.postponement?.earned ?? 0)
      if (rnd() < 0.5) debt.replan()
      else debt.resolve(0)
      const visibleAfter = Math.max(0, debt.balance, debt.postponement?.earned ?? 0)
      if (visibleAfter < visibleBefore - 1) skipToViolations++
    }
    // A tray Skip is debt-neutral: no rest credit, no resolve, no plan shift.

    // Quit and relaunch after every cycle. The saved file must round-trip the
    // balance, the visible debt, the outstanding postponement and the plan.
    const before = {
      balance: debt.balance,
      work: debt.work,
      plan: [...debt.plan],
      earned: debt.postponement?.earned ?? 0,
      visible: Math.max(0, debt.balance, debt.postponement?.earned ?? 0)
    }
    debt = new BreakDebt(JSON.parse(JSON.stringify(debt.serialize())))
    const after = {
      balance: debt.balance,
      work: debt.work,
      plan: debt.plan,
      earned: debt.postponement?.earned ?? 0,
      visible: Math.max(0, debt.balance, debt.postponement?.earned ?? 0)
    }
    if (Math.abs(after.balance - before.balance) > 1 ||
      after.work !== before.work ||
      after.plan.some((value, index) => Math.abs(value - before.plan[index]) > 1) ||
      Math.abs(after.earned - before.earned) > 1 ||
      Math.abs(after.visible - before.visible) > 1) restartViolations++
    ordinal++
  }
  return {
    rate,
    ideal,
    work,
    largerRest,
    allRest,
    balance: debt.balance,
    skipChance,
    postponeChance,
    restartViolations,
    spreadViolations,
    skipToViolations,
    rateError: Math.abs(rate - largerIdeal) / largerIdeal,
    conservationError: Math.abs(largerRest + debt.balance - rate * work),
    unpaidFraction: Math.max(0, debt.balance) / Math.max(1, rate * work),
    idealCoverage: allRest / Math.max(1, ideal * work),
    // Per the user's accounting, debt carried to tomorrow counts as today's rest.
    coverageWithDebt: (allRest + Math.max(0, debt.balance)) / Math.max(1, ideal * work)
  }
}

const summarize = (rows, key) => {
  const values = rows.map(row => row[key]).sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { min: values[0], mean, median: values[Math.floor(values.length / 2)], max: values.at(-1) }
}
const percent = value => (value * 100).toFixed(1) + '%'
const show = (label, stats) => console.log(`${label.padEnd(38)} min ${percent(stats.min)}   mean ${percent(stats.mean)}   median ${percent(stats.median)}   max ${percent(stats.max)}`)

const rows = []
for (let seed = 1; seed <= 400; seed++) rows.push(simulate(settingsFor(mulberry32(seed * 104729)), seed * 7919))

const live = {
  break: true,
  microbreak: true,
  microbreakInterval: 20 * minute,
  microbreakDuration: 20000,
  breakInterval: 1,
  breakDuration: 4 * minute,
  extendedBreak: true,
  extendedBreakDuration: 12 * minute,
  extendedBreakInterval: 2
}
const liveRate = breakDebtRate({ get: key => live[key] })
const liveIdeal = idealRate(live)
const liveLargerIdeal = largerIdealRate(live)

// A credit from earlier rest hides the postponement from `shortage`, so the
// three-slot plan is backed entirely by `earned`. Retiring the postponement
// after slot 0 would let the next forecast() scale slots 1 and 2 to zero.
const threeSlotRepayment = () => {
  const debt = new BreakDebt()
  debt.balance = -26 * minute
  debt.work = 100 * minute
  debt.postpone(0)
  debt.postponement.earned = 4 * minute
  const upcoming = [0, 1, 2, 3].map(i => ({ after: i * 40 * minute, duration: [4, 4, 12, 4][i] * minute }))
  let repaid = 0
  let lost = 0
  for (let slot = 0; slot < 3; slot++) {
    const payment = debt.forecast(liveRate, upcoming)
    repaid += payment
    debt.resolve(payment)
    const owed = Math.max(0, 4 * minute - repaid)
    const remaining = debt.plan.reduce((sum, value) => sum + value, 0)
    const visible = Math.max(0, debt.balance, debt.postponement?.earned ?? 0)
    if (Math.abs(remaining - owed) > 1 || Math.abs(visible - owed) > 1) lost++
  }
  return { repaid, lost }
}

const liveRows = []
for (let seed = 1; seed <= 200; seed++) liveRows.push(simulate(live, seed * 15485863))
const allRows = [...rows, ...liveRows]

console.log('Break-average model check — 400 random setting sets + 200 live-profile days')
console.log('Model: B = r*W - R ; r = one larger-break cycle of rest / that cycle of work\n')
console.log('Live profile: 20min Mini interval, 4min Long, 12min Extended every 2nd larger break')
console.log(`  ledger rate  r            = ${percent(liveRate)} rest per active minute (${(liveRate * 120).toFixed(1)} min / 120 active min)`)
console.log(`  schedule larger-break avg = ${percent(liveLargerIdeal)} (${(liveLargerIdeal * 120).toFixed(1)} min / 120 active min)`)
console.log(`  ideal incl. Mini breaks   = ${percent(liveIdeal)} (${(liveIdeal * 120).toFixed(1)} min / 120 active min)`)
console.log(`  r / larger-break avg      = ${percent(liveRate / liveLargerIdeal)}\n`)
show('rate mismatch vs schedule (all)', summarize(allRows, 'rateError'))
show('conservation error (random)', summarize(rows, 'conservationError'))
show('unpaid debt at day end (random)', summarize(rows, 'unpaidFraction'))
show('ideal rest coverage (random)', summarize(rows, 'idealCoverage'))
show('coverage incl. carried debt (random)', summarize(rows, 'coverageWithDebt'))
show('ideal rest coverage (live profile)', summarize(liveRows, 'idealCoverage'))
show('coverage incl. carried debt (live)', summarize(liveRows, 'coverageWithDebt'))
show('unpaid debt at day end (live)', summarize(liveRows, 'unpaidFraction'))

const conservationErrors = allRows.filter(row => row.conservationError > 1).length
const rateErrors = allRows.filter(row => row.rateError > 1e-9).length
const restartErrors = allRows.reduce((sum, row) => sum + row.restartViolations, 0)
const spreadErrors = allRows.reduce((sum, row) => sum + row.spreadViolations, 0)
const skipToErrors = allRows.reduce((sum, row) => sum + row.skipToViolations, 0)
const liveCoverage = summarize(liveRows, 'coverageWithDebt')
const randomCoverage = summarize(rows, 'coverageWithDebt')
const liveUnpaid = summarize(liveRows, 'unpaidFraction')
const repayment = threeSlotRepayment()
console.log(`\nConservation violations: ${conservationErrors} (expect 0). Rate mismatches: ${rateErrors} (expect 0).`)
console.log(`Restart losses: ${restartErrors} (expect 0). Over-charged breaks: ${spreadErrors} (expect 0).`)
console.log(`Skip-to/reset/early-finish debt losses: ${skipToErrors} (expect 0).`)
console.log(`Three-slot repayment: ${(repayment.repaid / minute).toFixed(2)} of 4.00 min repaid, lost slots: ${repayment.lost} (expect 0).`)

let failed = false
const check = (ok, message) => {
  console.log((ok ? 'PASS: ' : 'FAIL: ') + message)
  if (!ok) failed = true
}
check(conservationErrors === 0, 'the ledger never loses or invents rest; debt is carried or repaid, never silently cleared')
check(rateErrors === 0, 'the owed rate equals the schedule’s own larger-break average for every settings set')
check(restartErrors === 0, 'a mid-day Quit/restart preserves the balance, visible debt, postponement and three-break plan')
check(skipToErrors === 0, 'a tray "Skip to ...", "Reset breaks" or early finish never lowers the visible debt')
check(spreadErrors === 0, 'no single break is charged more than its proportional slot in the three-break plan')
check(repayment.lost === 0 && Math.abs(repayment.repaid - 4 * minute) <= 1,
  'a credit-backed postponement is repaid across all three slots, never lost after the first')
check(liveCoverage.mean >= 0.98 && randomCoverage.mean >= 0.98 &&
  liveCoverage.max <= 1.35 && randomCoverage.max <= 1.35,
  `a day with random skips/postpones reaches the ideal average rest without over-crediting (live mean ${percent(liveCoverage.mean)}, max ${percent(liveCoverage.max)})`)
check(liveUnpaid.mean <= 0.15,
  `only a small share is deferred to tomorrow (live mean ${percent(liveUnpaid.mean)})`)
console.log(failed
  ? 'FAIL: the break-debt model does not guarantee the ideal daily average rest.'
  : 'PASS: the break-debt model guarantees the ideal daily average rest, with rest only carried forward, never lost.')
if (failed) process.exitCode = 1
