/**
 * End-to-end pipeline execution through the public chain: progress events,
 * immutability of sources, serialization/replay round trips, custom filters,
 * and the registry error for tree-shaken filters.
 */
import { describe, expect, test } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import { defineFilter } from '../src/core/filter'
import type { SerializedHistory, SerializedOp } from '../src/core/types'
import { grayscale, invert } from '../src/filters/index'
import { gradientH, solid, px, expectPixelsClose } from './helpers'

describe('progress events', () => {
  test('emits ascending progress with op names, ending at 1', async () => {
    const image = ImagePipe._create(gradientH(16, 16))
    const seen: { pct: number; op?: string }[] = []
    image.on('progress', (e) => seen.push(e))

    await image.flip('horizontal').adjust({ brightness: 0.1 }).apply(invert())._render()

    expect(seen.map((e) => e.op)).toEqual(['flip', 'adjust', 'filter', 'done'])
    expect(seen[0]!.pct).toBe(0)
    expect(seen.at(-1)!.pct).toBe(1)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.pct).toBeGreaterThan(seen[i - 1]!.pct)
    }
  })

  test('unsubscribing stops delivery', async () => {
    const image = ImagePipe._create(solid(4, 4, [1, 2, 3, 255]))
    let calls = 0
    const off = image.on('progress', () => calls++)
    off()
    await image.flip('vertical')._render()
    expect(calls).toBe(0)
  })
})

describe('immutability under rendering', () => {
  test('rendering never mutates the loaded source, even with in-place kernels', async () => {
    const source = gradientH(8, 8)
    const before = [...source.data]
    const image = ImagePipe._create(source)

    await image.apply(invert()).adjust({ brightness: 0.5 })._render()

    expect([...source.data]).toEqual(before)
  })

  test('rendering twice gives identical results', async () => {
    const image = ImagePipe._create(gradientH(8, 8)).apply(grayscale()).rotate(90)
    const a = await image._render()
    const b = await image._render()
    expect(a.data).toEqual(b.data)
    expect(a).not.toBe(b)
  })
})

describe('serialization and replay', () => {
  test('a JSON round-tripped history renders identically', async () => {
    const original = ImagePipe._create(gradientH(16, 8))
      .crop({ aspect: '1:1', gravity: 'west' })
      .resize({ width: 4 })
      .adjust({ contrast: 0.2 })
      .apply(grayscale({ amount: 0.7 }))

    const ops = JSON.parse(JSON.stringify(original.history())) as SerializedHistory
    const replayed = ImagePipe._create(gradientH(16, 8)).pipe(ops)

    expectPixelsClose(await replayed._render(), await original._render(), 0)
  })

  test('replayed filter ops fall back to defaults for missing options', async () => {
    const image = ImagePipe._create(solid(1, 1, [255, 0, 0, 255]))
    // grayscale with no options: defaults (amount 1) must apply on replay.
    const ops: SerializedOp[] = [{ op: 'filter', params: { name: 'grayscale', options: {} } }]
    const out = await image.pipe(ops)._render()
    const [r, g, b] = px(out, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  test('replaying an unregistered filter throws a descriptive error', async () => {
    const image = ImagePipe._create(solid(2, 2, [0, 0, 0, 255]))
    const ops: SerializedOp[] = [{ op: 'filter', params: { name: 'not-imported', options: {} } }]
    await expect(image.pipe(ops)._render()).rejects.toThrow(/not-imported.*not registered/)
  })
})

describe('custom filters', () => {
  test('defineFilter kernels run end-to-end and serialize', async () => {
    const threshold = defineFilter<{ cutoff?: number }>({
      name: 'test-threshold',
      defaults: { cutoff: 128 },
      fallback: (pixels, { cutoff = 128 }) => {
        for (let i = 0; i < pixels.data.length; i += 4) {
          const v = pixels.data[i]! >= cutoff ? 255 : 0
          pixels.data[i] = v
          pixels.data[i + 1] = v
          pixels.data[i + 2] = v
        }
        return undefined
      },
    })

    const image = ImagePipe._create(gradientH(8, 1)).apply(threshold({ cutoff: 100 }))
    expect(image.history().ops).toEqual([
      { op: 'filter', params: { name: 'test-threshold', options: { cutoff: 100 } } },
    ])

    const out = await image._render()
    expect(px(out, 0, 0)[0]).toBe(0)
    expect(px(out, 7, 0)[0]).toBe(255)

    // And replays from serialized form via the registry.
    const replayed = ImagePipe._create(gradientH(8, 1)).pipe(
      JSON.parse(JSON.stringify(image.history())) as SerializedHistory,
    )
    expectPixelsClose(await replayed._render(), out, 0)
  })

  test('a kernel returning a new buffer replaces the pipeline image', async () => {
    const shrinkToOne = defineFilter({
      name: 'test-shrink',
      fallback: (pixels) => ({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(pixels.data.buffer, 0, 4),
      }),
    })
    const out = await ImagePipe._create(solid(4, 4, [9, 9, 9, 255]))
      .apply(shrinkToOne())
      ._render()
    expect([out.width, out.height]).toEqual([1, 1])
  })
})

describe('full chains', () => {
  test('the README chain executes with matching dimensions', async () => {
    const image = ImagePipe._create(gradientH(64, 36))
      .crop({ aspect: '16:9', gravity: 'center' })
      .resize({ width: 32 })
      .rotate(90)
      .adjust({ brightness: 0.1, contrast: 0.05, saturation: -0.2 })
      .apply(grayscale())

    const out = await image._render()
    expect([out.width, out.height]).toEqual([image.width, image.height])
    expect([out.width, out.height]).toEqual([18, 32])
  })
})
