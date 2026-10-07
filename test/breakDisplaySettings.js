import { describe, it, expect, vi } from 'vitest'
import { getBreakDisplayMode, setBreakDisplayMode, getCompactBreakBounds } from '../app/utils/breakDisplaySettings.js'

describe('break display preferences', () => {
  it('retains the legacy window and fullscreen selections', () => {
    expect(getBreakDisplayMode({ fullscreen: false })).toBe('window')
    expect(getBreakDisplayMode({ fullscreen: true })).toBe('fullscreen')
    expect(getBreakDisplayMode({ fullscreen: true, compactBreaks: true })).toBe('compact')
  })

  it.each(['window', 'fullscreen', 'compact'])('saves only the display selection for %s', mode => {
    const values = { breakDuration: 321000, extendedBreakInterval: 7, breakStrictMode: true, breakClickThrough: true }
    const settings = { set: vi.fn(patch => Object.assign(values, patch)) }
    setBreakDisplayMode(settings, mode)
    expect(getBreakDisplayMode(values)).toBe(mode)
    expect(values.breakDuration).toBe(321000)
    expect(values.extendedBreakInterval).toBe(7)
    expect(values.breakStrictMode).toBe(true)
    expect(values.breakClickThrough).toBe(true)
    expect(Object.keys(settings.set.mock.calls[0][0]).sort()).toEqual(['compactBreaks', 'fullscreen'])
  })

  it('rejects unsupported display modes', () => {
    const settings = { set: vi.fn() }
    setBreakDisplayMode(settings, 'tiny')
    expect(settings.set).not.toHaveBeenCalled()
  })
})

describe('compact display placement', () => {
  it('centers on a secondary monitor with a negative origin', () => {
    const display = { bounds: { x: -1920, y: -200, width: 1920, height: 1080 } }
    expect(getCompactBreakBounds(display, 300.2)).toEqual({ x: -1390, y: -20, width: 860, height: 720 })
  })

  it('fits inside the usable area of a small scaled monitor', () => {
    const display = {
      bounds: { x: 1200, y: 0, width: 480, height: 400 },
      workArea: { x: 1200, y: 30, width: 480, height: 330 }
    }
    const bounds = getCompactBreakBounds(display, 900)
    expect(bounds.width).toBe(448)
    expect(bounds.height).toBe(298)
    expect(bounds.x).toBeGreaterThanOrEqual(display.workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(display.workArea.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(display.workArea.y + display.workArea.height)
  })

  it('keeps one fixed size for every advice and phase', () => {
    const display = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
    const short = getCompactBreakBounds(display, 260)
    const long = getCompactBreakBounds(display, 610)
    expect(short.width).toBe(long.width)
    expect(short).toEqual(long)
    expect(long.height).toBe(720)
    expect(long.y + long.height / 2).toBe(720)
  })
})
