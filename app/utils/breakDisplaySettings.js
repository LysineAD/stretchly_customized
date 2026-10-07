export function getBreakDisplayMode (settings) {
  return settings.compactBreaks ? 'compact' : settings.fullscreen ? 'fullscreen' : 'window'
}

export function setBreakDisplayMode (settings, mode) {
  if (!['window', 'fullscreen', 'compact'].includes(mode)) return
  settings.set({ compactBreaks: mode === 'compact', fullscreen: mode === 'fullscreen' })
}

export function getCompactBreakBounds (display) {
  const bounds = display.bounds
  const workArea = display.workArea || bounds
  const width = Math.max(1, Math.min(860, workArea.width - 32))
  const height = Math.max(1, Math.min(720, workArea.height - 32))
  return {
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x + (bounds.width - width) / 2, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y + (bounds.height - height) / 2, workArea.y + workArea.height - height))),
    width,
    height
  }
}
