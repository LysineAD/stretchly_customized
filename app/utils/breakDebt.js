export function breakDebtRate (settings) {
  if (!settings.get('break')) return 0
  const normal = settings.get('breakDuration')
  const extendedEnabled = settings.get('extendedBreak')
  const extended = settings.get('extendedBreakDuration')
  const count = extendedEnabled ? settings.get('extendedBreakInterval') : 1
  const interval = settings.get('microbreakInterval') * (settings.get('breakInterval') + 1)
  if (!(normal > 0) || !(count > 0) || !(interval > 0) || (extendedEnabled && !(extended > 0))) return 0
  return (extendedEnabled ? (count - 1) * normal + extended : normal) / (count * interval)
}
