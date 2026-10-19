export default function statisticsFixture (kind = 'Long break') {
  const today = {
    breakMs: { mini: 140000, long: 600000, extended: 600000, idle: 900000 },
    completed: 10,
    withoutDelay: 8,
    extraPostpones: 5,
    skipped: 1,
    unfinished: 2,
    workMs: 29400000,
    stretchTotalMs: 22800000,
    stretchCount: 15,
    longestStretchMs: 6000000
  }
  const week = { ...today, workMs: 180000000, extraPostpones: 23, breakMs: { mini: 840000, long: 3600000, extended: 3600000, idle: 5400000 } }
  return {
    current: { kind, status: 'Waiting for Start', extraPostpones: 5, workMs: 1920000 },
    plannedIntervalMs: 1200000,
    today,
    week,
    lifetime: { ...week, breakMs: { mini: 8400000, long: 36000000, extended: 36000000, idle: 54000000 } }
  }
}
