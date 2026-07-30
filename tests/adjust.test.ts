/** CPU adjustment pipeline. */
import { describe, expect, test } from 'vitest'
import { adjustPixels } from '../src/cpu/adjust'
import { px, expectRgbaClose, solid } from './helpers'

const grey = (): ReturnType<typeof solid> => solid(2, 2, [128, 128, 128, 255])

describe('adjust', () => {
  test('all-default options are a no-op', () => {
    const p = solid(2, 2, [12, 34, 56, 200])
    const before = [...p.data]
    adjustPixels(p, {})
    expect([...p.data]).toEqual(before)
  })

  test('brightness ±1 clamps to white/black', () => {
    const white = grey()
    adjustPixels(white, { brightness: 1 })
    expectRgbaClose(px(white, 0, 0), [255, 255, 255, 255], 0)

    const black = grey()
    adjustPixels(black, { brightness: -1 })
    expectRgbaClose(px(black, 0, 0), [0, 0, 0, 255], 0)
  })

  test('contrast -1 collapses to mid grey', () => {
    const p = solid(2, 1, [30, 200, 90, 255])
    adjustPixels(p, { contrast: -1 })
    expectRgbaClose(px(p, 0, 0), [128, 128, 128, 255], 1)
  })

  test('contrast +0.5 pushes values away from 128', () => {
    const p = solid(1, 1, [100, 160, 128, 255])
    adjustPixels(p, { contrast: 0.5 })
    const [r, g, b] = px(p, 0, 0)
    expect(r).toBeLessThan(100)
    expect(g).toBeGreaterThan(160)
    expect(b).toBe(128) // pivot unchanged
  })

  test('saturation -1 produces luma grayscale', () => {
    const p = solid(1, 1, [255, 0, 0, 255])
    adjustPixels(p, { saturation: -1 })
    const [r, g, b] = px(p, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(Math.abs(r - 54)).toBeLessThanOrEqual(1) // 0.2126 × 255
  })

  test('exposure +1 is a 4× gain (2 EV)', () => {
    const p = solid(1, 1, [40, 40, 40, 255])
    adjustPixels(p, { exposure: 1 })
    expectRgbaClose(px(p, 0, 0), [160, 160, 160, 255], 1)
  })

  test('hue 180° turns red cyan-ish', () => {
    const p = solid(1, 1, [255, 0, 0, 255])
    adjustPixels(p, { hue: 180 })
    expectRgbaClose(px(p, 0, 0), [0, 109, 109, 255], 2)
  })

  test('gamma below 1 brightens midtones, above 1 darkens', () => {
    const bright = grey()
    adjustPixels(bright, { gamma: 0.5 })
    expect(px(bright, 0, 0)[0]).toBeGreaterThan(180)

    const dark = grey()
    adjustPixels(dark, { gamma: 2 })
    expect(px(dark, 0, 0)[0]).toBeLessThan(70)
  })

  test('alpha is never touched', () => {
    const p = solid(1, 1, [10, 20, 30, 137])
    adjustPixels(p, { brightness: 0.5, contrast: 0.5, saturation: 0.5, hue: 90, gamma: 2 })
    expect(px(p, 0, 0)[3]).toBe(137)
  })
})
