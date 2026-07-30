/**
 * ThumbHash encoding, verified byte-for-byte against the vendored MIT
 * reference implementation (tests/vendor/thumbhash-reference.js).
 */
import { describe, expect, test } from 'vitest'
// @ts-expect-error -- vendored untyped reference oracle
import { rgbaToThumbHash } from './vendor/thumbhash-reference.js'
import { thumbHash, thumbHashBase64 } from '../src/hash/index'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'
import { resample } from '../src/cpu/resample'
import { solid, gradientH, checkerboard } from './helpers'

const reference = (p: PixelData): Uint8Array =>
  new Uint8Array(rgbaToThumbHash(p.width, p.height, p.data) as Uint8Array)

/** A deterministic photo-ish fixture: gradients, a disc, translucency. */
function scene(width: number, height: number, alpha = 255): PixelData {
  const p = createPixelData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inDisc = (x - width / 2) ** 2 + (y - height / 3) ** 2 < (width / 4) ** 2
      p.data[i] = inDisc ? 220 : Math.round((x / width) * 255)
      p.data[i + 1] = inDisc ? 120 : Math.round((y / height) * 255)
      p.data[i + 2] = inDisc ? 40 : 180
      p.data[i + 3] = alpha
    }
  }
  return p
}

describe('thumbHash matches the reference implementation byte-for-byte', () => {
  const fixtures: [string, PixelData][] = [
    ['solid color', solid(32, 32, [180, 90, 40, 255])],
    ['horizontal gradient', gradientH(64, 48)],
    ['checkerboard', checkerboard(50, 50, 5)],
    ['photo-ish landscape', scene(100, 75)],
    ['photo-ish portrait', scene(60, 100)],
    ['translucent image', scene(80, 80, 128)],
    ['tiny image', gradientH(3, 3)],
  ]

  for (const [name, pixels] of fixtures) {
    test(name, () => {
      expect(thumbHash(pixels)).toEqual(reference(pixels))
    })
  }
})

describe('thumbHash behavior', () => {
  test('is deterministic', () => {
    expect(thumbHash(scene(90, 60))).toEqual(thumbHash(scene(90, 60)))
  })

  test('hashes are tiny (about 25 bytes)', () => {
    expect(thumbHash(scene(100, 100)).length).toBeLessThanOrEqual(25)
    expect(thumbHash(solid(10, 10, [0, 0, 0, 255])).length).toBeGreaterThanOrEqual(5)
  })

  test('large inputs are downscaled internally, not rejected', () => {
    const big = gradientH(800, 600)
    const hash = thumbHash(big)
    // Equivalent to hashing the library's own 100-px downscale.
    const expected = reference(resample(big, 100, 75, 'triangle'))
    expect(hash).toEqual(expected)
  })

  test('base64 helper round-trips the bytes', () => {
    const pixels = scene(40, 40)
    const decoded = Uint8Array.from(atob(thumbHashBase64(pixels)), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(thumbHash(pixels))
  })
})
