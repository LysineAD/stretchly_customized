import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BreakStatistics from '../app/utils/breakStatistics.js'
import StatisticsFile from '../app/utils/statisticsFile.js'

const fixture = () => {
  let time = new Date(2026, 9, 19, 10).getTime()
  const stats = new BreakStatistics({ now: () => time })
  return { stats, advance: milliseconds => { time += milliseconds }, get time () { return time } }
}

for (const [type, lead, duration] of [['mini', 20000, 20000], ['long', 60000, 300000], ['extended', 120000, 600000]]) {
  test(type + ': the intended first preparation Postpone is neither extra, skipped nor delayed', () => {
    const f = fixture()
    const due = f.time + 1200000
    f.advance(1200000 - lead)
    f.stats.offer({ type, dueAt: due, early: true, plannedIntervalMs: 1200000 })
    f.advance(6000)
    assert.equal(f.stats.postpone(), true)
    f.advance(lead)
    f.stats.start(type)
    f.advance(duration)
    f.stats.finish(true)
    const result = f.stats.snapshot()
    assert.equal(result.today.extraPostpones, 0)
    assert.equal(result.today.skipped, 0)
    assert.equal(result.today.unfinished, 0)
    assert.equal(result.today.completed, 1)
    assert.equal(result.today.withoutDelay, 1)
    assert.equal(result.today.breakMs[type], duration)
    assert.equal(result.today.workMs, 1206000)
  })
}

test('further postponements belong to the same break and do not become skipped breaks', () => {
  const f = fixture()
  f.stats.offer({ type: 'long', dueAt: f.time + 60000, early: true, plannedIntervalMs: 1200000 })
  assert.equal(f.stats.postpone(), true)
  for (let index = 0; index < 5; index++) {
    f.advance(60000)
    assert.equal(f.stats.postpone(), false)
  }
  const result = f.stats.snapshot()
  assert.equal(result.current.extraPostpones, 5)
  assert.equal(result.today.extraPostpones, 5)
  assert.equal(result.week.extraPostpones, 5)
  assert.equal(result.today.skipped + result.today.unfinished, 0)
})

test('starting very late is different from taking the intended first postponement', () => {
  const f = fixture()
  f.stats.offer({ type: 'long', dueAt: f.time + 60000, early: true })
  f.stats.postpone()
  f.advance(600000)
  f.stats.start('long')
  f.advance(300000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.extraPostpones, 0)
  assert.equal(f.stats.snapshot().today.withoutDelay, 0)
})

test('partial timer time is retained when postponing and later completing', () => {
  const f = fixture()
  f.stats.offer({ type: 'mini', dueAt: f.time, early: false })
  f.stats.start('mini')
  f.advance(5000)
  f.stats.postpone()
  f.advance(60000)
  f.stats.start('mini')
  f.advance(20000)
  f.stats.finish(true)
  assert.equal(f.stats.snapshot().today.breakMs.mini, 25000)
  assert.equal(f.stats.snapshot().today.completed, 1)
  assert.equal(f.stats.snapshot().today.unfinished, 0)
})

test('skip and unfinished are different outcomes; cancellation does not invent either', () => {
  const f = fixture()
  f.stats.offer({ type: 'mini', dueAt: f.time })
  f.stats.finish(false)
  f.stats.offer({ type: 'long', dueAt: f.time })
  f.stats.start('long')
  f.advance(5000)
  f.stats.finish(false)
  f.stats.offer({ type: 'extended', dueAt: f.time })
  f.stats.cancel()
  assert.equal(f.stats.snapshot().today.skipped, 1)
  assert.equal(f.stats.snapshot().today.unfinished, 1)
})

test('qualifying idle removes its lead-in from computer use without double-crediting timer time', () => {
  const f = fixture()
  f.advance(600000)
  f.stats.observeIdle(180000, 180000)
  let result = f.stats.snapshot()
  assert.equal(result.today.workMs, 420000)
  assert.equal(result.today.breakMs.idle, 180000)
  f.stats.offer({ type: 'mini', dueAt: f.time })
  f.stats.start('mini')
  f.advance(20000)
  f.stats.finish(true)
  result = f.stats.snapshot()
  assert.equal(result.today.breakMs.mini + result.today.breakMs.idle + result.today.workMs, 620000)
})

test('intentional pause excludes time and does not count the app being closed as computer use', () => {
  const f = fixture()
  f.advance(60000)
  f.stats.pause()
  f.advance(3600000)
  f.stats.resume()
  f.advance(60000)
  assert.equal(f.stats.snapshot().today.workMs, 120000)
  const restored = new BreakStatistics({ data: JSON.parse(f.stats.serialize()), now: () => f.time + 86400000 })
  assert.equal(restored.snapshot().lifetime.workMs, 120000)
  assert.equal(restored.snapshot().today.workMs, 0)
})

test('system suspension excludes sleeping time while retaining an active break record', () => {
  const f = fixture()
  f.stats.offer({ type: 'long', dueAt: f.time })
  f.stats.start('long', 300000)
  f.advance(10000)
  f.stats.suspend()
  f.advance(3600000)
  f.stats.resume()
  f.advance(5000)
  f.stats.finish(true)
  const result = f.stats.snapshot()
  assert.equal(result.today.breakMs.long, 15000)
  assert.equal(result.today.workMs, 0)
  assert.equal(result.today.completed, 1)
})

test('durations are split at local midnight and weekly figures exclude older dates', () => {
  let time = new Date(2026, 9, 19, 23, 59).getTime()
  const stats = new BreakStatistics({ now: () => time })
  time += 120000
  assert.equal(stats.snapshot().today.workMs, 60000)
  assert.equal(stats.snapshot().week.workMs, 120000)
  stats.pause()
  time += 7 * 86400000
  stats.resume()
  assert.equal(stats.snapshot().week.workMs, 0)
  assert.equal(stats.snapshot().lifetime.workMs, 120000)
})

test('one year of summaries is bounded and invalid loaded values are sanitized', () => {
  const days = {}
  for (let index = 0; index < 800; index++) {
    const date = new Date(2024, 0, index + 1)
    days[`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`] = { workMs: 100 }
  }
  const stats = new BreakStatistics({ data: { days, lifetime: { workMs: -5, extraPostpones: 'bad' } } })
  const text = stats.serialize()
  assert.ok(Object.keys(JSON.parse(text).days).length <= 366)
  assert.ok(Buffer.byteLength(text) < 250000)
  assert.equal(stats.snapshot().lifetime.extraPostpones, 0)
})

test('statistics are written serially and recover from a damaged main file using the backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stretchly-stats-'))
  try {
    const path = join(directory, 'statistics.json')
    const errors = []
    const file = new StatisticsFile(path, error => errors.push(error))
    const f = fixture()
    f.advance(60000)
    file.schedule(() => f.stats.serialize())
    await file.flush()
    f.advance(60000)
    file.schedule(() => f.stats.serialize())
    await file.flush()
    assert.equal(JSON.parse(await readFile(path, 'utf8')).lifetime.workMs, 120000)
    assert.equal(errors.length, 0)
    await writeFile(path, 'damaged')
    const recovered = await file.load()
    assert.equal(recovered.lifetime.workMs, 60000)
    file.schedule(() => f.stats.serialize())
    await file.flush()
    assert.equal(JSON.parse(await readFile(path + '.bak', 'utf8')).lifetime.workMs, 60000)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
