import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import initializeBreakPresentation from '../app/utils/breakPresentation.js'

describe('break renderer preparation', () => {
  it('waits for fonts and a painted layout before completing presentation', async () => {
    let finishFonts
    const fontReady = new Promise(resolve => { finishFonts = resolve })
    const frames = []
    const window = {
      settings: { get: vi.fn(async key => key === 'compactBreaks') },
      breaks: { onClickThroughChanged: vi.fn(), setClickThrough: vi.fn() },
      MutationObserver: class { observe () {} },
      requestAnimationFrame: callback => frames.push(callback)
    }
    const document = {
      body: { classList: { add: vi.fn() } },
      fonts: { ready: fontReady },
      querySelector: () => ({}),
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
      expect(frames).toHaveLength(0)
      finishFonts()
      await Promise.resolve()
      expect(frames).toHaveLength(1)
      frames.shift()()
      expect(ready).toBe(false)
      expect(frames).toHaveLength(1)
      frames.shift()()
      await preparation
      expect(ready).toBe(true)
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
