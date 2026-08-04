/* eslint-disable @typescript-eslint/no-extraneous-class -- a bare stub class stands in for Worker */
/**
 * Flattening: background, placement, clipping, stack order, blend modes,
 * opacity and visibility; dirty-layer caching; hit testing; progress and
 * cancellation.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import type { OpNode } from '../src/core/executor'
import { defineFilter } from '../src/core/filter'
import type { PixelData } from '../src/core/pixel'
import { shouldUseWorker } from '../src/core/worker-client'
import { document, layer } from '../src/layers'
import { gradientH, px, solid } from './helpers'

const image = (w: number, h: number, rgba: [number, number, number, number]) =>
  ImagePipe._create(solid(w, h, rgba))

const RED: [number, number, number, number] = [255, 0, 0, 255]
const BLUE: [number, number, number, number] = [0, 0, 255, 255]

/**
 * A no-op filter that records every kernel invocation — the only honest way
 * to assert that a pipeline did *not* re-run.
 */
function counted(name: string) {
  const fallback = vi.fn((pixels: PixelData) => pixels)
  return { filter: defineFilter({ name, fallback }), calls: () => fallback.mock.calls.length }
}

/**
 * A filter that runs a hook mid-pipeline. Set `trip` to abort a render from
 * inside a layer's own kernel, which is the only way to land an abort
 * *between* layers rather than before the first one.
 */
let trip: (() => void) | null = null
const tripwire = defineFilter({
  name: 'layers-tripwire',
  fallback: (pixels: PixelData) => {
    trip?.()
    return pixels
  },
})

describe('background', () => {
  test('an empty document is its background color', async () => {
    const out = await document({ width: 4, height: 3, background: '#00ff00' }).flatten()._render()
    expect([out.width, out.height]).toEqual([4, 3])
    expect(px(out, 3, 2)).toEqual([0, 255, 0, 255])
  })

  test('the default background is transparent', async () => {
    const out = await document({ width: 2, height: 2 }).flatten()._render()
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0])
  })
})

describe('placement and clipping', () => {
  test('a layer lands at its placement', async () => {
    const out = await document({ width: 8, height: 8, background: 'black' })
      .add(layer(image(2, 2, RED)).at(3, 4))
      .flatten()
      ._render()
    expect(px(out, 3, 4)).toEqual(RED)
    expect(px(out, 4, 5)).toEqual(RED)
    expect(px(out, 2, 4)).toEqual([0, 0, 0, 255])
    expect(px(out, 5, 4)).toEqual([0, 0, 0, 255])
  })

  test('layers hanging off the canvas are clipped, not rejected', async () => {
    const out = await document({ width: 4, height: 4, background: 'black' })
      .add(layer(image(4, 4, RED)).at(-2, -2))
      .flatten()
      ._render()
    expect(px(out, 0, 0)).toEqual(RED)
    expect(px(out, 1, 1)).toEqual(RED)
    expect(px(out, 2, 2)).toEqual([0, 0, 0, 255])
  })

  test('a layer entirely off canvas contributes nothing', async () => {
    const out = await document({ width: 4, height: 4, background: 'black' })
      .add(layer(image(2, 2, RED)).at(100, 100))
      .flatten()
      ._render()
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255])
  })

  test('a layer pipeline resizes the layer', async () => {
    const out = await document({ width: 8, height: 8 })
      .add(layer(image(8, 8, RED).resize({ width: 2, height: 2, fit: 'fill' })))
      .flatten()
      ._render()
    expect(px(out, 1, 1)).toEqual(RED)
    expect(px(out, 2, 2)).toEqual([0, 0, 0, 0])
  })
})

describe('stack composition', () => {
  test('later layers draw over earlier ones', async () => {
    const out = await document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED)))
      .add(layer(image(4, 4, BLUE)))
      .flatten()
      ._render()
    expect(px(out, 0, 0)).toEqual(BLUE)
  })

  test('reorder changes what wins without touching the pipelines', async () => {
    const base = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED)).name('red'))
      .add(layer(image(4, 4, BLUE)).name('blue'))
    expect(px(await base.reorder('red', 1).flatten()._render(), 0, 0)).toEqual(RED)
  })

  test('opacity multiplies the layer alpha', async () => {
    const out = await document({ width: 4, height: 4, background: 'black' })
      .add(layer(image(4, 4, [255, 255, 255, 255])).opacity(0.5))
      .flatten()
      ._render()
    const [r] = px(out, 0, 0)
    expect(r).toBeGreaterThanOrEqual(127)
    expect(r).toBeLessThanOrEqual(128)
  })

  test('hidden layers are skipped entirely', async () => {
    const out = await document({ width: 4, height: 4, background: 'black' })
      .add(layer(image(4, 4, RED)).visible(false))
      .flatten()
      ._render()
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255])
  })

  test('blend modes apply per layer', async () => {
    const grey: [number, number, number, number] = [128, 128, 128, 255]
    const flattenWith = async (mode: 'multiply' | 'screen') =>
      px(
        await document({ width: 2, height: 2 })
          .add(layer(image(2, 2, grey)))
          .add(layer(image(2, 2, grey)).blend(mode))
          .flatten()
          ._render(),
        0,
        0,
      )
    expect(await flattenWith('multiply')).toEqual([64, 64, 64, 255])
    expect(await flattenWith('screen')).toEqual([192, 192, 192, 255])
  })
})

describe('flatten() is an ordinary pipeline', () => {
  test('dimensions are the canvas, known without rendering', () => {
    const flat = document({ width: 64, height: 32 }).flatten()
    expect([flat.width, flat.height]).toEqual([64, 32])
  })

  test('operations chain onto the flattened document', async () => {
    const out = await document({ width: 8, height: 8, background: 'red' })
      .flatten()
      .resize({ width: 4 })
      ._render()
    expect([out.width, out.height]).toEqual([4, 4])
    expect(px(out, 0, 0)).toEqual(RED)
  })
})

describe('dirty-layer rendering', () => {
  test('moving the top layer never re-runs the layers below', async () => {
    const bottom = counted('layers-count-bottom')
    const top = counted('layers-count-top')
    const base = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED).apply(bottom.filter())).name('bottom'))
      .add(
        layer(image(4, 4, BLUE).apply(top.filter()))
          .at(1, 1)
          .name('top'),
      )

    await base.flatten()._render()
    expect([bottom.calls(), top.calls()]).toEqual([1, 1])

    await base.move('top', { dx: 1 }).flatten()._render()
    expect(bottom.calls()).toBe(1)
    expect(top.calls()).toBe(1)
  })

  test('opacity, blend, visibility and reorder edits are composite-only', async () => {
    const only = counted('layers-count-cheap')
    const base = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED)).name('under'))
      .add(layer(image(4, 4, BLUE).apply(only.filter())).name('a'))

    await base.flatten()._render()
    await base
      .update('a', (l) => l.opacity(0.5))
      .flatten()
      ._render()
    await base
      .update('a', (l) => l.blend('multiply'))
      .flatten()
      ._render()
    await base.reorder('a', 0).flatten()._render()
    expect(only.calls()).toBe(1)
  })

  test('editing a layer pipeline changes the output without disturbing the others', async () => {
    const bottom = counted('layers-count-stable')
    const top = counted('layers-count-edited')
    const base = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED).apply(bottom.filter())).name('bottom'))
      .add(
        layer(image(4, 4, BLUE).apply(top.filter()))
          .at(2, 0)
          .name('top'),
      )

    const before = await base.flatten()._render()
    const edited = base.update('top', (l) =>
      layer(l.source.adjust({ brightness: 0.5 })).name('top'),
    )
    const after = await edited.flatten()._render()

    expect(after.data).not.toEqual(before.data) // the edit really took effect
    expect(bottom.calls()).toBe(1) // the untouched layer never re-runs
    expect(top.calls()).toBe(1) // and the edited layer resumes from its own prefix cache
  })
})

describe('layerAt', () => {
  const donut = () => {
    const pixels = solid(4, 4, RED)
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]) {
      pixels.data[(y! * 4 + x!) * 4 + 3] = 0 // punch a transparent hole
    }
    return ImagePipe._create(pixels)
  }

  test('returns the top-most layer under the point', async () => {
    const doc = document({ width: 8, height: 8 })
      .add(layer(image(8, 8, RED)).name('bottom'))
      .add(
        layer(image(2, 2, BLUE))
          .at(3, 3)
          .name('top'),
      )
    expect((await doc.layerAt(3, 3))?.name()).toBe('top')
    expect((await doc.layerAt(0, 0))?.name()).toBe('bottom')
  })

  test('transparent pixels fall through to what is behind them', async () => {
    const doc = document({ width: 8, height: 8 })
      .add(layer(image(8, 8, BLUE)).name('bottom'))
      .add(layer(donut()).at(0, 0).name('donut'))
    expect((await doc.layerAt(0, 0))?.name()).toBe('donut')
    expect((await doc.layerAt(1, 1))?.name()).toBe('bottom')
  })

  test('a point over bare canvas hits nothing', async () => {
    const doc = document({ width: 8, height: 8, background: 'red' }).add(
      layer(image(2, 2, BLUE)).at(0, 0),
    )
    expect(await doc.layerAt(6, 6)).toBeNull()
    expect(await doc.layerAt(-1, 0)).toBeNull()
  })

  test('hidden and fully transparent layers are not hit', async () => {
    const doc = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED)).visible(false))
      .add(layer(image(4, 4, BLUE)).opacity(0))
    expect(await doc.layerAt(2, 2)).toBeNull()
  })

  test('fractional coordinates floor to a pixel', async () => {
    const doc = document({ width: 8, height: 8 }).add(
      layer(image(2, 2, RED))
        .at(2, 2)
        .name('a'),
    )
    expect((await doc.layerAt(3.9, 3.9))?.name()).toBe('a')
    expect(await doc.layerAt(4.1, 4.1)).toBeNull()
  })

  test('the hit test fills the same cache flatten uses', async () => {
    const counter = counted('layers-count-hit')
    const doc = document({ width: 4, height: 4 }).add(
      layer(image(4, 4, RED).apply(counter.filter())),
    )
    await doc.layerAt(1, 1)
    await doc.flatten()._render()
    expect(counter.calls()).toBe(1)
  })
})

describe('events and cancellation', () => {
  test('progress reaches 1 and never goes backwards', async () => {
    const seen: number[] = []
    const doc = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED)))
      .add(layer(image(4, 4, BLUE)))
    doc.on('progress', ({ pct }) => seen.push(pct))
    await doc.flatten()._render()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  test('listeners are shared with derived documents', async () => {
    const seen: number[] = []
    const doc = document({ width: 4, height: 4 }).add(layer(image(4, 4, RED)).name('a'))
    doc.on('progress', ({ pct }) => seen.push(pct))
    await doc.move('a', { dx: 1 }).flatten()._render()
    expect(seen.at(-1)).toBe(1)
  })

  test('an aborted flatten rejects', async () => {
    const controller = new AbortController()
    controller.abort()
    const doc = document({ width: 4, height: 4 }).add(layer(image(4, 4, RED)))
    await expect(doc.flatten()._render(controller.signal)).rejects.toThrow()
  })

  test('aborting between layers stops the stack where it is', async () => {
    const controller = new AbortController()
    const upper = counted('layers-abort-upper')
    const doc = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED).apply(tripwire())).name('lower'))
      .add(layer(image(4, 4, BLUE).apply(upper.filter())).name('upper'))

    trip = () => {
      controller.abort() // fires while the lower layer renders
    }
    await expect(doc.flatten()._render(controller.signal)).rejects.toThrow()
    expect(upper.calls()).toBe(0) // the abort landed before the next layer
  })

  test('the same flattened image renders again after an abort', async () => {
    const controller = new AbortController()
    const upper = counted('layers-abort-retry')
    const flat = document({ width: 4, height: 4 })
      .add(layer(image(4, 4, RED).apply(tripwire())).name('lower'))
      .add(layer(image(4, 4, BLUE).apply(upper.filter())).name('upper'))
      .flatten()

    trip = () => {
      controller.abort()
    }
    await expect(flat._render(controller.signal)).rejects.toThrow()

    // The rejected resolve must not be memoized against the descriptor.
    trip = null
    expect(px(await flat._render(), 0, 0)).toEqual(BLUE)
    expect(upper.calls()).toBe(1)
  })
})

describe('worker offloading', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a layer pipeline big enough to offload still composites correctly', async () => {
    // Node has no Worker; a constructor that throws exercises the same
    // decision path a browser takes and then the fallback beneath it.
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('module workers unsupported')
        }
      },
    )
    const ops: OpNode[] = [{ op: 'flip', params: { axis: 'horizontal' } }]
    const source = gradientH(1024, 512)
    expect(shouldUseWorker(ops, source)).toBe(true) // the layer really does qualify

    const out = await document({ width: 1024, height: 512 })
      .add(layer(ImagePipe._create(source).flip('horizontal')))
      .flatten()
      ._render()

    expect([out.width, out.height]).toEqual([1024, 512])
    expect(out.data[0]).toBe(255) // flipped: the gradient's brightest end is now leftmost
  })
})
