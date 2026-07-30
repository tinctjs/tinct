/** Deterministic fixtures and tolerance assertions for pixel tests. */
import { expect } from 'vitest'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'

export type RgbaTuple = [number, number, number, number]

/** Solid color image. */
export function solid(width: number, height: number, [r, g, b, a]: RgbaTuple): PixelData {
  const p = createPixelData(width, height)
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = r
    p.data[i + 1] = g
    p.data[i + 2] = b
    p.data[i + 3] = a
  }
  return p
}

/** Opaque horizontal red gradient: r goes 0..255 left to right. */
export function gradientH(width: number, height: number): PixelData {
  const p = createPixelData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      p.data[i] = Math.round((x / Math.max(1, width - 1)) * 255)
      p.data[i + 3] = 255
    }
  }
  return p
}

/** Opaque black/white checkerboard with the given cell size. */
export function checkerboard(width: number, height: number, cell: number): PixelData {
  const p = createPixelData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const v = on ? 255 : 0
      p.data[i] = v
      p.data[i + 1] = v
      p.data[i + 2] = v
      p.data[i + 3] = 255
    }
  }
  return p
}

/** Read one pixel as an RGBA tuple. */
export function px(p: PixelData, x: number, y: number): RgbaTuple {
  const i = (y * p.width + x) * 4
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!, p.data[i + 3]!]
}

/** Assert two RGBA tuples match within a per-channel tolerance. */
export function expectRgbaClose(actual: RgbaTuple, expected: RgbaTuple, tolerance = 2): void {
  for (let c = 0; c < 4; c++) {
    expect(
      Math.abs(actual[c]! - expected[c]!),
      `channel ${String(c)}: ${actual.join()} vs ${expected.join()}`,
    ).toBeLessThanOrEqual(tolerance)
  }
}

/** Assert two buffers match within a per-channel tolerance. */
export function expectPixelsClose(actual: PixelData, expected: PixelData, tolerance = 2): void {
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  let worst = 0
  let worstAt = -1
  for (let i = 0; i < actual.data.length; i++) {
    const delta = Math.abs(actual.data[i]! - expected.data[i]!)
    if (delta > worst) {
      worst = delta
      worstAt = i
    }
  }
  expect(worst, `worst channel delta at byte ${String(worstAt)}`).toBeLessThanOrEqual(tolerance)
}
