import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BreakStatistics, { dateKey } from '../app/utils/breakStatistics.js'
import StatisticsFile from '../app/utils/statisticsFile.js'

const fixture = () => {
  let time = new Date(2026, 9, 20, 10).getTime()
  const stats = new BreakStatistics({ now: () => time })
  return { stats, advance: milliseconds => { time += milliseconds }, get time () { return time } }
}

for (const type of ['mini', 'long', 'extended']) {
  test(type + ': one Postpone remains without delay and records actual break time', () => {
    const f = fixture()
    f.advance(1200000)
    f.stats.offer({ type })
    assert.equal(f.stats.postpone(), true)
    f.advance(120000)
    f.stats.start(type)
    f.advance(20000)
    f.stats.finish(true)
    const result = f.stats.snapshot()
    assert.equal(result.today.breaks, 1)
    assert.equal(result.today.withoutDelay, 1)
    assert.equal(result.today.breakMs, 20000)
    assert.equal(result.today.workMs, 1320000)
  })
}

test('two or more postponements lower the single outcome rate', () => {
  const f = fixture()
  f.stats.offer({ type: 'long' })
  assert.equal(f.stats.postpone(), true)
  assert.equal(f.stats.postpone(), false)
  assert.equal(f.stats.snapshot().current.postpones, 2)
  f.stats.start('long')
  f.advance(300000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.breaks, 1)
  assert.equal(f.stats.snapshot().today.withoutDelay, 0)
})

test('skip and early end both count against the rate; reset and Pause do not', () => {
  const f = fixture()
  f.stats.offer({ type: 'mini' })
  f.stats.finish(false)
  f.stats.offer({ type: 'long' })
  f.stats.start('long')
  f.advance(5000)
  f.stats.finish(false)
  f.stats.offer({ type: 'mini' })
  f.stats.cancel()
  f.stats.offer({ type: 'mini' })
  f.stats.pause()
  f.stats.resume()
  f.stats.offer({ type: 'extended' })
  f.stats.start('extended')
  f.advance(10000)
  f.stats.finish(true)
  const period = f.stats.snapshot().today
  assert.equal(period.breaks, 3)
  assert.equal(period.withoutDelay, 1)
  assert.equal(period.breakMs, 15000)
})

test('partial timer time is retained after Postpone and later completion', () => {
  const f = fixture()
  f.stats.offer({ type: 'mini' })
  f.stats.start('mini')
  f.advance(5000)
  f.stats.postpone()
  f.advance(60000)
  f.stats.start('mini')
  f.advance(20000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.breakMs, 25000)
  assert.equal(f.stats.snapshot().today.breaks, 1)
})

test('qualifying idle and timer time never overlap', () => {
  const f = fixture()
  f.advance(600000)
  f.stats.observeIdle(180000, 180000)
  f.stats.offer({ type: 'mini' })
  f.stats.start('mini')
  f.advance(20000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.workMs, 420000)
  assert.equal(f.stats.snapshot().today.breakMs, 200000)
})

test('Pause and time while closed are excluded from computer use', () => {
  const f = fixture()
  f.advance(60000)
  f.stats.pause()
  f.advance(3600000)
  f.stats.resume()
  f.advance(60000)
  const restored = new BreakStatistics({ data: JSON.parse(f.stats.serialize()), now: () => f.time + 86400000 })
  assert.equal(restored.snapshot().week.workMs, 120000)
  assert.equal(restored.snapshot().today.workMs, 0)
})

test('system suspension retains the break but excludes sleeping time', () => {
  const f = fixture()
  f.stats.offer({ type: 'long' })
  f.stats.start('long')
  f.advance(10000)
  f.stats.suspend()
  f.advance(3600000)
  f.stats.resume()
  f.advance(5000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.breakMs, 15000)
  assert.equal(f.stats.snapshot().today.workMs, 0)
})

test('local midnight splits time and crossing seven days deletes expired records', () => {
  let time = new Date(2026, 9, 19, 23, 59).getTime()
  const stats = new BreakStatistics({ now: () => time })
  time += 120000
  assert.equal(stats.snapshot().today.workMs, 60000)
  assert.equal(stats.snapshot().week.workMs, 120000)
  stats.pause()
  time += 7 * 86400000
  stats.resume()
  const saved = JSON.parse(stats.serialize())
  assert.equal(stats.snapshot().week.workMs, 0)
  assert.equal(Object.keys(saved.days).length, 0)
  assert.equal(saved.lifetime, undefined)
})

test('legacy history migrates to seven days with no lifetime or removed metrics', () => {
  const now = new Date(2026, 9, 20, 10).getTime()
  const days = {}
  for (let index = 0; index < 400; index++) {
    days[dateKey(now - index * 86400000)] = { breakMs: { mini: 100, long: 200, idle: 300 }, completed: 3, skipped: 1, unfinished: 1, withoutDelay: 2, workMs: 1000, extraPostpones: 9, longestStretchMs: 999 }
  }
  const stats = new BreakStatistics({ data: { version: 1, days, lifetime: { workMs: 999999 } }, now: () => now })
  const saved = JSON.parse(stats.serialize())
  assert.equal(saved.version, 2)
  assert.equal(Object.keys(saved.days).length, 7)
  assert.equal(saved.lifetime, undefined)
  assert.equal(saved.days[dateKey(now)].breakMs, 600)
  assert.equal(saved.days[dateKey(now)].breaks, 5)
  assert.equal(saved.days[dateKey(now)].extraPostpones, undefined)
  assert.equal(saved.days[dateKey(now)].longestStretchMs, undefined)
  assert.equal(stats.snapshot().week.workMs / 7, 1000)
})

test('main file and recoverable backup both contain only the current seven days', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stretchly-stats-'))
  try {
    const path = join(directory, 'statistics.json')
    const file = new StatisticsFile(path)
    const f = fixture()
    f.advance(60000)
    file.schedule(() => f.stats.serialize())
    await file.flush()
    f.advance(8 * 86400000)
    f.stats.pause()
    file.schedule(() => f.stats.serialize())
    await file.flush()
    const current = JSON.parse(await readFile(path, 'utf8'))
    const backup = JSON.parse(await readFile(path + '.bak', 'utf8'))
    assert.deepEqual(current, backup)
    assert.ok(Object.keys(current.days).length <= 7)
    assert.equal(current.lifetime, undefined)
    await writeFile(path, 'damaged')
    assert.deepEqual(await file.load(), backup)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
