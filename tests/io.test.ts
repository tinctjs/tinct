/**
 * Loader/exporter tests for the parts exercisable outside a real browser:
 * ImageData round trips (via a minimal shim), source validation, and
 * capability detection. Canvas-backed decode/encode paths are exercised in
 * the playground and by browser-based tests in Phase 3.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { imagepipe } from '../src/index'
import { decodeSource } from '../src/io/load'
import { pixelsToImageData } from '../src/io/export'
import { gradientH } from './helpers'

/** Minimal stand-in matching the ImageData constructor shape we rely on. */
class ImageDataShim {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImageData loading', () => {
  test('loads ImageData and copies the pixels defensively', async () => {
    vi.stubGlobal('ImageData', ImageDataShim)
    const source = gradientH(4, 2)
    const imageData = new ImageDataShim(source.data, 4, 2) as unknown as ImageData

    const decoded = await decodeSource(imageData)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(2)
    expect(decoded.data).toEqual(source.data)
    expect(decoded.data).not.toBe(source.data) // defensive copy

    // Mutating the caller's buffer afterwards must not affect the pipeline.
    imageData.data[0] = 99
    expect(decoded.data[0]).not.toBe(99)
  })

  test('imagepipe.load → edit → toImageData round trips', async () => {
    vi.stubGlobal('ImageData', ImageDataShim)
    const source = gradientH(4, 4)
    const image = await imagepipe.load(new ImageDataShim(source.data, 4, 4) as unknown as ImageData)

    const out = await image.flip('horizontal').toImageData()
    expect(out).toBeInstanceOf(ImageDataShim)
    expect(out.width).toBe(4)
    // Leftmost source pixel (r=0) is now rightmost.
    expect(out.data[(0 * 4 + 3) * 4]).toBe(0)
    expect(out.data[0]).toBe(255)
  })
})

describe('source validation', () => {
  test('unsupported sources reject with a clear error', async () => {
    await expect(decodeSource(42 as unknown as ImageData)).rejects.toThrow(
      /unsupported image source/,
    )
  })

  test('URL sources without a DOM reject with guidance', async () => {
    await expect(decodeSource('https://example.com/image.png')).rejects.toThrow(/need a DOM Image/)
  })
})

describe('exporters without a browser', () => {
  test('toImageData without an ImageData global throws descriptively', () => {
    expect(() => pixelsToImageData(gradientH(2, 2))).toThrow(/ImageData is not available/)
  })
})

describe('capabilities', () => {
  test('reports all-false in Node without crashing', () => {
    expect(imagepipe.capabilities()).toEqual({
      webgl2: false,
      offscreenCanvas: false,
      workers: false,
    })
  })
})
