export function getIdleMode (settings) {
  const mode = settings.naturalBreaksIdleMode
  if (['preserve', 'partial', 'reset'].includes(mode)) return mode
  return settings.naturalBreaksResetOnIdle === false ? 'preserve' : 'reset'
}
