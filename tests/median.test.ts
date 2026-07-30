/** median(): speckle removal, edge preservation, edge-window behavior. */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { median } from '../src/filters/index'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'
import { px, solid } from './helpers'

/** Solid grey with isolated white and black speckles. */
function speckled(): PixelData {
  const p = solid(15, 15, [128, 128, 128, 255])
  for (const [x, y, v] of [
    [3, 3, 255],
    [7, 8, 0],
    [11, 4, 255],
    [5, 12, 0],
  ] as const) {
    const i = (y * 15 + x) * 4
    p.data[i] = v
    p.data[i + 1] = v
    p.data[i + 2] = v
  }
  return p
}

describe('median', () => {
  test('removes salt-and-pepper speckles completely', async () => {
    const out = await TinctImage._create(speckled()).apply(median())._render()
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        expect(px(out, x, y)).toEqual([128, 128, 128, 255])
      }
    }
  })

  test('preserves hard edges that blur would soften', async () => {
    // Left half black, right half white.
    const p = createPixelData(16, 8)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4
        const v = x < 8 ? 0 : 255
        p.data[i] = v
        p.data[i + 1] = v
        p.data[i + 2] = v
        p.data[i + 3] = 255
      }
    }
    const out = await TinctImage._create(p)
      .apply(median({ radius: 1 }))
      ._render()
    expect(px(out, 7, 4)).toEqual([0, 0, 0, 255])
    expect(px(out, 8, 4)).toEqual([255, 255, 255, 255])
  })

  test('solid images and radius 0 are no-ops', async () => {
    const src = solid(6, 6, [90, 120, 150, 137])
    const filtered = await TinctImage._create(src)
      .apply(median({ radius: 2 }))
      ._render()
    expect(filtered.data).toEqual(src.data)
    const zero = await TinctImage._create(speckled())
      .apply(median({ radius: 0 }))
      ._render()
    expect(zero.data).toEqual(speckled().data)
  })

  test('alpha is untouched', async () => {
    const p = speckled()
    p.data[3] = 42 // odd alpha on one pixel
    const out = await TinctImage._create(p).apply(median())._render()
    expect(out.data[3]).toBe(42)
  })

  test('corner windows are true shrunken medians (no clamp bias)', async () => {
    // 2×2 image: corner window of r=1 covers all four pixels; upper median
    // of [10, 20, 30, 40] is 30.
    const p = createPixelData(2, 2)
    const values = [10, 20, 30, 40]
    for (let i = 0; i < 4; i++) {
      p.data[i * 4] = values[i]!
      p.data[i * 4 + 1] = values[i]!
      p.data[i * 4 + 2] = values[i]!
      p.data[i * 4 + 3] = 255
    }
    const out = await TinctImage._create(p).apply(median())._render()
    expect(px(out, 0, 0)[0]).toBe(30)
  })
})
