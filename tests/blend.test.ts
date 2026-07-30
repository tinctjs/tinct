/**
 * Separable blend kernels and the generalized compositor: per-mode math
 * against hand-computed values, the transparent-backdrop rule, and proof
 * that the unblended path is unchanged.
 */
import { describe, expect, test } from 'vitest'
import { blendFn, type BlendMode } from '../src/cpu/blend'
import { compositeOver } from '../src/cpu/composite'
import { px, solid, type RgbaTuple } from './helpers'

/** Composite a full-canvas overlay of one color over one backdrop color. */
function blended(backdrop: RgbaTuple, source: RgbaTuple, mode: BlendMode, opacity = 1): RgbaTuple {
  const base = solid(2, 2, backdrop)
  compositeOver(base, solid(2, 2, source), 0, 0, opacity, blendFn(mode))
  return px(base, 1, 1)
}

const GREY: RgbaTuple = [128, 128, 128, 255]

describe('blend math over an opaque backdrop', () => {
  test('multiply darkens: 0.502 * 0.502 = 0.252', () => {
    expect(blended(GREY, GREY, 'multiply')).toEqual([64, 64, 64, 255])
  })

  test('screen lightens: 1 - (1 - 0.502)^2 = 0.752', () => {
    expect(blended(GREY, GREY, 'screen')).toEqual([192, 192, 192, 255])
  })

  test('darken keeps the smaller channel', () => {
    expect(blended([200, 50, 90, 255], [100, 150, 90, 255], 'darken')).toEqual([100, 50, 90, 255])
  })

  test('lighten keeps the larger channel', () => {
    expect(blended([200, 50, 90, 255], [100, 150, 90, 255], 'lighten')).toEqual([200, 150, 90, 255])
  })

  test('multiply with white is a no-op; with black it is black', () => {
    const color: RgbaTuple = [30, 90, 210, 255]
    expect(blended(color, [255, 255, 255, 255], 'multiply')).toEqual(color)
    expect(blended(color, [0, 0, 0, 255], 'multiply')).toEqual([0, 0, 0, 255])
  })
})

describe('alpha interaction', () => {
  test('there is nothing to blend with a transparent backdrop — the source wins', () => {
    const source: RgbaTuple = [200, 50, 25, 255]
    for (const mode of ['multiply', 'screen', 'darken', 'lighten'] as const) {
      expect(blended([0, 0, 0, 0], source, mode)).toEqual(source)
    }
  })

  test('opacity interpolates toward the backdrop', () => {
    // multiply(0.502, 0.502) = 0.252 -> 64.25; halfway back to 128 is ~96
    const [r, , , a] = blended(GREY, GREY, 'multiply', 0.5)
    expect(a).toBe(255)
    expect(r).toBeGreaterThanOrEqual(95)
    expect(r).toBeLessThanOrEqual(97)
  })

  test('a half-transparent backdrop blends proportionally', () => {
    // da = 0.502, so Cr = (1 - da) * Cs + da * B(Cb, Cs): half source, half blended.
    const [r] = blended([255, 255, 255, 128], [0, 0, 0, 255], 'multiply')
    expect(r).toBe(0) // multiply with black is black either way
    const [g] = blended([128, 128, 128, 128], GREY, 'multiply')
    expect(g).toBeGreaterThanOrEqual(95)
    expect(g).toBeLessThanOrEqual(97)
  })
})

describe('the unblended path is unchanged', () => {
  test("'source-over' ships no blend function", () => {
    expect(blendFn('source-over')).toBeUndefined()
  })

  test('an identity blend function matches passing none', () => {
    const withNone = solid(4, 4, [10, 120, 240, 200])
    const withIdentity = solid(4, 4, [10, 120, 240, 200])
    const over = solid(3, 3, [250, 20, 60, 140])
    compositeOver(withNone, over, 1, 1, 0.7)
    compositeOver(withIdentity, over, 1, 1, 0.7, (_b, s) => s)
    expect(withNone.data).toEqual(withIdentity.data)
  })

  test('an unknown mode throws instead of silently drawing normally', () => {
    expect(() => blendFn('overlay' as BlendMode)).toThrow(/unknown blend mode/)
  })
})
