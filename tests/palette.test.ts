/** tinctjs/palette — median-cut extraction. */
import { describe, expect, test } from 'vitest'
import { palette, dominantColor } from '../src/palette/index'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'
import { solid, gradientH } from './helpers'

/** Two-tone image: left `fraction` is colorA, the rest colorB. */
function twoTone(
  fraction: number,
  a: [number, number, number],
  b: [number, number, number],
): PixelData {
  const p = createPixelData(100, 40)
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 100; x++) {
      const i = (y * 100 + x) * 4
      const [r, g, bl] = x < fraction * 100 ? a : b
      p.data[i] = r
      p.data[i + 1] = g
      p.data[i + 2] = bl
      p.data[i + 3] = 255
    }
  }
  return p
}

describe('dominantColor', () => {
  test('solid images report their exact color at full population', () => {
    const top = dominantColor(solid(20, 20, [180, 90, 40, 255]))
    expect(top.rgb).toEqual([180, 90, 40])
    expect(top.hex).toBe('#b45a28')
    expect(top.population).toBe(1)
  })

  test('picks the majority color of a two-tone image', () => {
    const top = dominantColor(twoTone(0.7, [200, 30, 30], [30, 30, 200]))
    expect(top.rgb[0]).toBeGreaterThan(150) // the red side
    expect(Math.abs(top.population - 0.7)).toBeLessThan(0.1)
  })

  test('fully transparent images return a zero-population black', () => {
    const top = dominantColor(solid(10, 10, [50, 50, 50, 0]))
    expect(top.population).toBe(0)
  })
})

describe('palette', () => {
  test('separates distinct colors with correct populations', () => {
    const colors = palette(twoTone(0.6, [220, 40, 40], [40, 40, 220]), { colors: 2 })
    expect(colors).toHaveLength(2)
    expect(Math.abs(colors[0]!.population - 0.6)).toBeLessThan(0.08)
    expect(Math.abs(colors[1]!.population - 0.4)).toBeLessThan(0.08)
    expect(colors[0]!.rgb[0]).toBeGreaterThan(colors[0]!.rgb[2]) // red first
    expect(colors[1]!.rgb[2]).toBeGreaterThan(colors[1]!.rgb[0]) // blue second
  })

  test('populations always sum to ~1 and come sorted', () => {
    const colors = palette(gradientH(120, 60), { colors: 6 })
    const total = colors.reduce((sum, c) => sum + c.population, 0)
    expect(Math.abs(total - 1)).toBeLessThan(1e-9)
    for (let i = 1; i < colors.length; i++) {
      expect(colors[i]!.population).toBeLessThanOrEqual(colors[i - 1]!.population)
    }
  })

  test('is deterministic', () => {
    const a = palette(gradientH(200, 100), { colors: 5 })
    const b = palette(gradientH(200, 100), { colors: 5 })
    expect(a).toEqual(b)
  })

  test('transparent pixels are excluded from sampling', () => {
    // Half red, half fully transparent green: only red should appear.
    const p = createPixelData(40, 40)
    for (let i = 0; i < p.data.length; i += 4) {
      const left = (i / 4) % 40 < 20
      p.data[i] = left ? 200 : 0
      p.data[i + 1] = left ? 0 : 255
      p.data[i + 2] = 0
      p.data[i + 3] = left ? 255 : 0
    }
    const colors = palette(p, { colors: 3 })
    for (const c of colors) {
      expect(c.rgb[0]).toBeGreaterThan(c.rgb[1])
    }
  })

  test('large images are downsampled, not slow-pathed', () => {
    const started = performance.now()
    palette(gradientH(2000, 1500), { colors: 8 })
    expect(performance.now() - started).toBeLessThan(500)
  })
})
