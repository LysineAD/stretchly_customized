import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import initializeBreakPresentation from '../app/utils/breakPresentation.js'

describe('break renderer preparation', () => {
  it('makes a control under the stationary pointer clickable on opening', async () => {
    const calls = []
    const control = { getBoundingClientRect: () => ({ left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40 }) }
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    globalThis.window = {
      settings: { get: async key => key === 'breakClickThrough' },
      breaks: { onClickThroughChanged: () => {}, setClickThrough: value => calls.push(value), getPointerPosition: async () => ({ x: 30, y: 30 }) },
      MutationObserver: class { observe () {} },
      requestAnimationFrame: callback => callback()
    }
    globalThis.document = {
      body: { classList: { add: () => {} } },
      fonts: { ready: Promise.resolve() },
      querySelector: selector => selector === '.breaks' ? { getBoundingClientRect: () => ({}) } : null,
      querySelectorAll: () => [control],
      addEventListener: () => {}
    }
    try {
      await initializeBreakPresentation()
      expect(calls.at(-1)).toBe(false)
    } finally {
      globalThis.window = originalWindow
      globalThis.document = originalDocument
    }
  })

  it('waits for fonts and calculates layout without waiting for hidden animation frames', async () => {
    let finishFonts
    const fontReady = new Promise(resolve => { finishFonts = resolve })
    const layout = vi.fn()
    const window = {
      settings: { get: vi.fn(async key => key === 'compactBreaks') },
      breaks: { onClickThroughChanged: vi.fn(), setClickThrough: vi.fn(), getPointerPosition: vi.fn(async () => null) },
      MutationObserver: class { observe () {} },
      requestAnimationFrame: vi.fn()
    }
    const document = {
      body: { classList: { add: vi.fn() } },
      fonts: { ready: fontReady },
      querySelector: () => ({ getBoundingClientRect: layout }),
      addEventListener: vi.fn()
    }
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    globalThis.window = window
    globalThis.document = document
    try {
      let ready = false
      const preparation = initializeBreakPresentation().then(() => { ready = true })
      await Promise.resolve()
      await Promise.resolve()
      expect(ready).toBe(false)
      expect(layout).not.toHaveBeenCalled()
      finishFonts()
      await preparation
      expect(ready).toBe(true)
      expect(layout).toHaveBeenCalledOnce()
      expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    } finally {
      globalThis.window = originalWindow
      globalThis.document = originalDocument
    }
  })

  it.each(['microbreak', 'break'])('%s renderer waits for presentation before signaling loaded', async type => {
    const source = readFileSync(new URL('../app/' + type + '-renderer.js', import.meta.url), 'utf8')
    const from = source.lastIndexOf('  initializeBreakPresentation()')
    const awaitedFrom = source.lastIndexOf('  await initializeBreakPresentation()')
    const tail = source.slice(Math.max(from, awaitedFrom), source.lastIndexOf('\n}'))
    let finishPresentation
    const presentation = new Promise(resolve => { finishPresentation = resolve })
    const signalLoaded = vi.fn()
    const completion = runInNewContext('(async () => {' + tail + '\n})()', {
      initializeBreakPresentation: () => presentation,
      window: { breaks: { signalLoaded } },
      console
    })
    await Promise.resolve()
    expect(signalLoaded).not.toHaveBeenCalled()
    finishPresentation()
    await completion
    expect(signalLoaded).toHaveBeenCalledOnce()
  })
})
