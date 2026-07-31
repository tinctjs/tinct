/**
 * Render cancellation: pre-aborted signals, mid-render aborts at op
 * boundaries, reason propagation, and the no-fallback rule for aborted
 * worker renders.
 */
import { describe, expect, test, vi } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { defineFilter } from '../src/core/filter'
import { invert } from '../src/filters/index'
import { gradientH, solid } from './helpers'

describe('cancellation', () => {
  test('a pre-aborted signal rejects before any work happens', async () => {
    const image = TinctImage._create(gradientH(8, 8)).apply(invert())
    let progressed = 0
    image.on('progress', () => progressed++)

    const controller = new AbortController()
    controller.abort()

    await expect(image._render(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(progressed).toBe(0)
  })

  test('aborting mid-render stops at the next op boundary', async () => {
    const ran: string[] = []
    const track = (name: string) =>
      defineFilter({
        name: `test-cancel-${name}`,
        fallback: (pixels) => {
          ran.push(name)
          return pixels
        },
      })

    const controller = new AbortController()
    const image = TinctImage._create(solid(4, 4, [9, 9, 9, 255]))
      .apply(track('first')())
      .apply(track('second')())
      .apply(track('third')())

    // Abort as soon as the first op has run.
    image.on('progress', () => {
      if (ran.length === 1) controller.abort()
    })

    await expect(image._render(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(ran).toEqual(['first'])
  })

  test('a pre-aborted signal rejects even when the whole chain is cache-warm', async () => {
    // Regression: a full render-cache hit produces an empty op list, which
    // used to skip the abort check entirely and resolve with stale pixels.
    const image = TinctImage._create(gradientH(8, 8)).apply(invert())
    await image._render() // warm the full-chain cache
    const controller = new AbortController()
    controller.abort()
    await expect(image._render(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a custom abort reason propagates', async () => {
    const image = TinctImage._create(solid(4, 4, [1, 2, 3, 255])).apply(invert())
    const controller = new AbortController()
    controller.abort(new Error('user moved the slider'))

    await expect(image._render(controller.signal)).rejects.toThrow('user moved the slider')
  })

  test('outputs accept the signal option (type + plumbing)', async () => {
    const image = TinctImage._create(solid(2, 2, [0, 0, 0, 255]))
    const controller = new AbortController()
    controller.abort()
    // toImageData reaches the render before needing any DOM globals.
    await expect(
      image.apply(invert()).toImageData({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('an aborted worker render does not fall back to the main thread', async () => {
    // A fake Worker that never responds: the only way the render can settle
    // is the abort path, and it must reject rather than silently re-render.
    class SilentWorker {
      onmessage: unknown = null
      onerror: unknown = null
      postMessage(): void {
        /* swallow */
      }
      terminate(): void {
        /* noop */
      }
    }
    vi.stubGlobal('Worker', SilentWorker)
    try {
      const image = TinctImage._create(gradientH(1024, 512)).flip('horizontal')
      const controller = new AbortController()
      const render = image._render(controller.signal)
      controller.abort()
      await expect(render).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('renders without a signal are unaffected', async () => {
    const out = await TinctImage._create(solid(2, 2, [10, 20, 30, 255]))
      .apply(invert())
      ._render()
    expect(out.data[0]).toBe(245)
  })
})
