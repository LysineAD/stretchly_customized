export default function statisticsFixture (kind = 'Long break') {
  const today = { breakMs: 2240000, breaks: 10, withoutDelay: 8, workMs: 29400000, stretchTotalMs: 22800000, stretchCount: 15 }
  const week = { breakMs: 15680000, breaks: 70, withoutDelay: 56, workMs: 205800000, stretchTotalMs: 159600000, stretchCount: 105 }
  return { current: { kind, postpones: 2 }, today, week }
}
