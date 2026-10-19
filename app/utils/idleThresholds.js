export const IDLE_SHORT_MIN = 60000
export const IDLE_SHORT_MAX = 3600000
export const IDLE_LONG_MIN = 120000
export const IDLE_LONG_MAX = 10800000
export const DEFAULT_IDLE_SHORT = 300000
export const DEFAULT_IDLE_LONG = 1800000

export function getIdleThresholds (settings) {
  const configuredShort = settings.naturalBreaksInactivityResetTime
  const short = clamp(configuredShort, IDLE_SHORT_MIN, IDLE_SHORT_MAX, DEFAULT_IDLE_SHORT)
  const configuredLong = settings.naturalBreaksLongIdleResetTime
  const long = clamp(configuredLong, IDLE_LONG_MIN, IDLE_LONG_MAX, DEFAULT_IDLE_LONG)
  return {
    short,
    long: Math.max(long, Math.min(IDLE_LONG_MAX, short + 60000))
  }
}

function clamp (value, minimum, maximum, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}
