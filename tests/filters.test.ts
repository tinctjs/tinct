/** Built-in filter CPU kernels, exercised through their public factories. */
import { describe, expect, test } from 'vitest'
import { FILTER_DEFINITION } from '../src/core/filter'
import type { PixelData } from '../src/core/pixel'
import { clonePixelData } from '../src/core/pixel'
import {
  grayscale,
  sepia,
  invert,
  blur,
  sharpen,
  pixelate,
  vignette,
  duotone,
  noise,
  posterize,
} from '../src/filters/index'
import type { Filter, FilterOptions } from '../src/core/filter'
import { px, expectRgbaClose, solid, gradientH, checkerboard } from './helpers'

/** Run a filter's CPU kernel the way the executor does. */
function run<T extends FilterOptions>(filter: Filter<T>, pixels: PixelData): PixelData {
  const def = filter[FILTER_DEFINITION]
  const merged = { ...def.defaults, ...filter.options }
  return def.fallback(pixels, merged) ?? pixels
}

describe('grayscale', () => {
  test('produces luma grey and preserves alpha', () => {
    const out = run(grayscale(), solid(1, 1, [255, 0, 0, 200]))
    expectRgbaClose(px(out, 0, 0), [54, 54, 54, 200], 1)
  })

  test('amount 0 leaves the image unchanged', () => {
    const src = solid(1, 1, [50, 100, 150, 255])
    const out = run(grayscale({ amount: 0 }), clonePixelData(src))
    expect(out.data).toEqual(src.data)
  })
})

describe('sepia', () => {
  test('applies the standard sepia matrix', () => {
    const out = run(sepia(), solid(1, 1, [100, 100, 100, 255]))
    // r = .393+.769+.189 = 1.351×100, g = 1.203×100, b = 0.937×100
    expectRgbaClose(px(out, 0, 0), [135, 120, 94, 255], 1)
  })
})

describe('invert', () => {
  test('is its own inverse', () => {
    const src = solid(2, 2, [10, 200, 77, 137])
    const once = run(invert(), clonePixelData(src))
    expectRgbaClose(px(once, 0, 0), [245, 55, 178, 137], 0)
    const twice = run(invert(), once)
    expect(twice.data).toEqual(src.data)
  })
})

describe('blur', () => {
  test('solid images are unchanged', () => {
    const out = run(blur({ radius: 3 }), solid(9, 9, [40, 80, 120, 255]))
    expectRgbaClose(px(out, 4, 4), [40, 80, 120, 255], 1)
    expectRgbaClose(px(out, 0, 0), [40, 80, 120, 255], 1)
  })

  test('spreads an impulse into its neighbours', () => {
    const src = solid(9, 9, [0, 0, 0, 255])
    const c = (4 * 9 + 4) * 4
    src.data[c] = 255
    const out = run(blur({ radius: 1 }), src)
    expect(px(out, 4, 4)[0]).toBeLessThan(255)
    expect(px(out, 3, 4)[0]).toBeGreaterThan(0)
    expect(px(out, 4, 3)[0]).toBeGreaterThan(0)
  })

  test('radius 0 is a no-op', () => {
    const src = gradientH(5, 5)
    const out = run(blur({ radius: 0 }), clonePixelData(src))
    expect(out.data).toEqual(src.data)
  })
})

describe('sharpen', () => {
  test('solid images are unchanged', () => {
    const out = run(sharpen(), solid(9, 9, [90, 90, 90, 255]))
    expectRgbaClose(px(out, 4, 4), [90, 90, 90, 255], 1)
  })

  test('increases edge contrast', () => {
    const src = checkerboard(8, 8, 4)
    const out = run(sharpen({ amount: 1 }), clonePixelData(src))
    // Just inside a white cell next to the edge gets pushed further from mid.
    const before = px(src, 3, 0)[0]
    const after = px(out, 3, 0)[0]
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('pixelate', () => {
  test('each block becomes its average', () => {
    const src = checkerboard(4, 4, 1)
    const out = run(pixelate({ size: 2 }), src)
    // A 2×2 block of a 1px checkerboard averages to mid grey.
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 3],
    ] as const) {
      expectRgbaClose(px(out, x, y), [128, 128, 128, 255], 1)
    }
  })

  test('size 1 is a no-op', () => {
    const src = checkerboard(4, 4, 1)
    const out = run(pixelate({ size: 1 }), clonePixelData(src))
    expect(out.data).toEqual(src.data)
  })
})

describe('vignette', () => {
  test('center is untouched, corners darken', () => {
    const out = run(vignette({ amount: 0.8 }), solid(21, 21, [200, 200, 200, 255]))
    expectRgbaClose(px(out, 10, 10), [200, 200, 200, 255], 1)
    expect(px(out, 0, 0)[0]).toBeLessThan(150)
  })

  test('supports a custom color', () => {
    const out = run(
      vignette({ amount: 1, radius: 0, color: '#ff0000' }),
      solid(9, 9, [0, 0, 0, 255]),
    )
    expect(px(out, 0, 0)[0]).toBeGreaterThan(200)
  })
})

describe('duotone', () => {
  test('maps black to shadows and white to highlights', () => {
    const shadows = '#102030'
    const highlights = '#f0e0d0'
    const dark = run(duotone({ shadows, highlights }), solid(1, 1, [0, 0, 0, 255]))
    expectRgbaClose(px(dark, 0, 0), [0x10, 0x20, 0x30, 255], 1)
    const light = run(duotone({ shadows, highlights }), solid(1, 1, [255, 255, 255, 255]))
    expectRgbaClose(px(light, 0, 0), [0xf0, 0xe0, 0xd0, 255], 1)
  })
})

describe('noise', () => {
  test('same seed → identical output; different seed → different output', () => {
    const a = run(noise({ amount: 0.3, seed: 7 }), solid(8, 8, [128, 128, 128, 255]))
    const b = run(noise({ amount: 0.3, seed: 7 }), solid(8, 8, [128, 128, 128, 255]))
    const c = run(noise({ amount: 0.3, seed: 8 }), solid(8, 8, [128, 128, 128, 255]))
    expect(a.data).toEqual(b.data)
    expect(a.data).not.toEqual(c.data)
  })

  test('monochrome grain shifts channels together', () => {
    const out = run(noise({ amount: 0.5, seed: 1 }), solid(4, 4, [128, 128, 128, 255]))
    const [r, g, b] = px(out, 2, 2)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  test('amount 0 is a no-op', () => {
    const src = solid(4, 4, [77, 77, 77, 255])
    const out = run(noise({ amount: 0 }), clonePixelData(src))
    expect(out.data).toEqual(src.data)
  })
})

describe('posterize', () => {
  test('2 levels leaves only 0 and 255', () => {
    const out = run(posterize({ levels: 2 }), gradientH(16, 1))
    for (let x = 0; x < 16; x++) {
      expect([0, 255]).toContain(px(out, x, 0)[0])
    }
  })

  test('4 levels leaves exactly four values', () => {
    const out = run(posterize({ levels: 4 }), gradientH(64, 1))
    const values = new Set<number>()
    for (let x = 0; x < 64; x++) values.add(px(out, x, 0)[0])
    expect([...values].sort((a, b) => a - b)).toEqual([0, 85, 170, 255])
  })
})
