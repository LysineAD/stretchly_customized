// Final sanity check for the whole break-debt design.
//
// ONE equation describes everything this fork does:
//
//   W = active work minutes in a day (breaks, waiting and AFK excluded)
//   r = rest owed per active minute  (breakDebtRate(settings))
//   R = rest actually taken in Long/Extended breaks
//   B = r * W - R                  (the persisted balance, carried to tomorrow)
//
// forecast() adds make-up time to the next three larger breaks whenever the
// projected B at the end of the current 120-active-minute block is positive.
// So a day is "paid up" iff R + B == r*W and B is small. The separate question
// is whether r matches the IDEAL average implied by the schedule itself:
//
//   r_ideal = (average larger break + (k-1) mini breaks) / (k * mini interval)
//
// This script randomizes settings and skip/postpone behaviour and reports both.

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

const largerDuration = (settings, ordinal) => {
  if (!settings.extendedBreak) return settings.breakDuration
  return ordinal % settings.extendedBreakInterval === 0 ? settings.extendedBreakDuration : settings.breakDuration
}

const idealRate = settings => {
  const cadence = settings.microbreakInterval * (settings.breakInterval + 1)
  const m = settings.extendedBreakInterval
  const averageLarger = settings.extendedBreak
    ? ((m - 1) * settings.breakDuration + settings.extendedBreakDuration) / m
    : settings.breakDuration
  return (averageLarger + settings.breakInterval * settings.microbreakDuration) / cadence
}

const simulate = (settings, seed) => {
  const rnd = mulberry32(seed)
  const rate = breakDebtRate({ get: key => settings[key] })
  const ideal = idealRate(settings)
  const cadence = settings.microbreakInterval * (settings.breakInterval + 1)
  const skipChance = rnd() * 0.5
  const postponeChance = rnd() * 0.3
  const debt = new BreakDebt()
  let clock = new Date(2026, 10, 14, 9).getTime()
  let work = 0
  let largerRest = 0
  let allRest = 0
  let ordinal = 1
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
      const duration = base + payment
      debt.record('rest', clock, clock + duration, rate)
      clock += duration
      largerRest += duration
      allRest += duration
      debt.resolve(payment)
    }
    // A tray Skip is debt-neutral: no rest credit, no resolve, no plan shift.
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
const show = (label, stats) => console.log(`${label.padEnd(34)} min ${percent(stats.min)}   mean ${percent(stats.mean)}   median ${percent(stats.median)}   max ${percent(stats.max)}`)

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
const liveRows = []
for (let seed = 1; seed <= 200; seed++) liveRows.push(simulate(live, seed * 15485863))

console.log('Break-average model check — 400 random setting sets + 200 live-profile days')
console.log('Model: B = r*W - R ; forecast repays B into the next three larger breaks\n')
console.log('Live profile: 20min Mini interval, 4min Long, 12min Extended every 2nd larger break')
console.log(`  ledger rate  r       = ${percent(liveRate)} rest per active minute (${(liveRate * 120).toFixed(1)} min / 120 active min)`)
console.log(`  ideal schedule rate  = ${percent(liveIdeal)} rest per active minute (${(liveIdeal * 120).toFixed(1)} min / 120 active min)`)
console.log(`  r / ideal            = ${percent(liveRate / liveIdeal)}\n`)
show('conservation error (random)', summarize(rows, 'conservationError'))
show('unpaid debt at day end (random)', summarize(rows, 'unpaidFraction'))
show('ideal rest coverage (random)', summarize(rows, 'idealCoverage'))
show('ledger rate / ideal rate (random)', summarize(rows.map(row => ({ ...row, gap: row.rate / row.ideal })), 'gap'))
show('ideal rest coverage (live profile)', summarize(liveRows, 'idealCoverage'))
show('coverage incl. carried debt (live)', summarize(liveRows, 'coverageWithDebt'))
show('unpaid debt at day end (live)', summarize(liveRows, 'unpaidFraction'))

const conservationErrors = rows.filter(row => row.conservationError > 1).length + liveRows.filter(row => row.conservationError > 1).length
const worstUnpaid = Math.max(...rows.map(row => row.unpaidFraction), ...liveRows.map(row => row.unpaidFraction))
console.log(`\nConservation violations: ${conservationErrors} (expect 0). Worst unpaid fraction: ${percent(worstUnpaid)}.`)
console.log(conservationErrors === 0
  ? 'PASS: the ledger never loses or invents rest; debt is carried or repaid, never silently cleared.'
  : 'FAIL: the ledger lost or invented rest.')

const meanCoverage = summarize(liveRows, 'idealCoverage').mean
console.log(meanCoverage >= 0.95
  ? 'PASS: a day with random skips/postpones still reaches the ideal average rest.'
  : `GAP: with random skips/postpones the live profile delivers ${percent(meanCoverage)} of the ideal average rest.`)
console.log('Cause: breakDebtRate() divides one Extended cycle of rest by the fixed 120-minute workBlock')
console.log('instead of that cycle\'s real length (extendedBreakInterval x cadence). It is a conservative')
console.log('floor, and for other settings an over-credit. See the audit note in STATISTICS.md.')

if (conservationErrors > 0) process.exitCode = 1
