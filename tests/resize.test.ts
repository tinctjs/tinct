/** Resampling kernels and fit-mode plans. */
import { describe, expect, test } from 'vitest'
import { resample } from '../src/cpu/resample'
import { resolveResize } from '../src/core/geometry-math'
import { createPixelData } from '../src/core/pixel'
import { checkerboard, gradientH, px, expectRgbaClose, solid } from './helpers'

describe('resolveResize plans', () => {
  test('single dimension keeps aspect', () => {
    expect(resolveResize({ width: 100 }, 200, 100).out).toEqual({ width: 100, height: 50 })
    expect(resolveResize({ height: 50 }, 200, 100).out).toEqual({ width: 100, height: 50 })
  })

  test('contain fits inside the box', () => {
    expect(resolveResize({ width: 50, height: 50 }, 200, 100).out).toEqual({
      width: 50,
      height: 25,
    })
  })

  test('cover scales up then center-crops', () => {
    const plan = resolveResize({ width: 50, height: 50, fit: 'cover' }, 200, 100)
    expect(plan.out).toEqual({ width: 50, height: 50 })
    expect(plan.scaled).toEqual({ width: 100, height: 50 })
  })

  test('fill stretches exactly', () => {
    expect(resolveResize({ width: 30, height: 60, fit: 'fill' }, 200, 100).out).toEqual({
      width: 30,
      height: 60,
    })
  })
})

describe('resample', () => {
  test('nearest upscale duplicates pixels exactly', () => {
    const src = createPixelData(2, 1)
    src.data.set([10, 0, 0, 255, 200, 0, 0, 255])
    const out = resample(src, 4, 1, 'nearest')
    expect(px(out, 0, 0)).toEqual([10, 0, 0, 255])
    expect(px(out, 1, 0)).toEqual([10, 0, 0, 255])
    expect(px(out, 2, 0)).toEqual([200, 0, 0, 255])
    expect(px(out, 3, 0)).toEqual([200, 0, 0, 255])
  })

  test('lanczos downscale of a solid color stays solid', () => {
    const out = resample(solid(64, 64, [40, 90, 160, 255]), 7, 7, 'lanczos')
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        expectRgbaClose(px(out, x, y), [40, 90, 160, 255], 1)
      }
    }
  })

  test('extreme downscale averages fine detail instead of aliasing', () => {
    // A 1px checkerboard collapsed to a single pixel must land near mid-grey;
    // naive single-pass sampling would pick one phase and return 0 or 255.
    const out = resample(checkerboard(64, 64, 1), 1, 1, 'lanczos')
    expectRgbaClose(px(out, 0, 0), [128, 128, 128, 255], 8)
  })

  test('triangle upscale keeps a gradient monotonic', () => {
    const out = resample(gradientH(8, 1), 32, 1, 'triangle')
    for (let x = 1; x < 32; x++) {
      expect(px(out, x, 0)[0]).toBeGreaterThanOrEqual(px(out, x - 1, 0)[0])
    }
  })

  test('fully transparent input stays fully transparent', () => {
    const out = resample(solid(16, 16, [0, 0, 0, 0]), 4, 4, 'lanczos')
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(0)
    }
  })
})
