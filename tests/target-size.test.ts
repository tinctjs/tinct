/**
 * toBlob({ maxBytes }): quality bisection, upper-bound respect, png
 * rejection, unreachable budgets, and the data-URL route.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { pixelsToBlob, pixelsToDataURL } from '../src/io/export'
import { solid } from './helpers'

class ImageDataShim {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

interface FakeBlob {
  size: number
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
}

/** Canvas whose encoder produces `size = round(quality * 100_000)` bytes. */
function stubEncoder(): { calls: number[] } {
  const calls: number[] = []
  class FakeCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(kind: string): unknown {
      if (kind !== '2d') return null
      return {
        putImageData: () => undefined,
        fillRect: () => undefined,
        drawImage: () => undefined,
        fillStyle: '',
      }
    }
    convertToBlob({ type, quality = 0.92 }: { type: string; quality?: number }): Promise<FakeBlob> {
      calls.push(quality)
      const size = Math.round(quality * 100_000)
      return Promise.resolve({
        size,
        type,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(Math.min(size, 64))),
      })
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('ImageData', ImageDataShim)
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toBlob maxBytes', () => {
  test('returns immediately when the requested quality already fits', async () => {
    const { calls } = stubEncoder()
    const blob = await pixelsToBlob(solid(4, 4, [1, 2, 3, 255]), {
      format: 'webp',
      quality: 0.5,
      maxBytes: 60_000,
    })
    expect(blob.size).toBe(50_000)
    expect(calls).toEqual([0.5])
  })

  test('bisects to the largest quality under the budget', async () => {
    const { calls } = stubEncoder()
    const blob = await pixelsToBlob(solid(4, 4, [1, 2, 3, 255]), {
      format: 'webp',
      maxBytes: 50_000,
    })
    expect(blob.size).toBeLessThanOrEqual(50_000)
    expect(blob.size).toBeGreaterThan(46_000) // close to the budget, not far under
    expect(calls.length).toBeLessThanOrEqual(8) // 1 probe + 1 floor + 6 bisections
  })

  test('unreachable budgets reject with the achievable minimum', async () => {
    stubEncoder()
    await expect(
      pixelsToBlob(solid(4, 4, [0, 0, 0, 255]), { format: 'jpeg', maxBytes: 1_000 }),
    ).rejects.toThrow(/cannot encode under 1000 bytes.*5000 bytes.*resize/)
  })

  test('png rejects: no quality axis to search', async () => {
    stubEncoder()
    await expect(
      pixelsToBlob(solid(4, 4, [0, 0, 0, 255]), { format: 'png', maxBytes: 10_000 }),
    ).rejects.toThrow(/png has none/)
  })

  test('toDataURL honors maxBytes via the blob route', async () => {
    stubEncoder()
    const url = await pixelsToDataURL(solid(4, 4, [1, 2, 3, 255]), {
      format: 'webp',
      maxBytes: 50_000,
    })
    expect(url.startsWith('data:image/webp;base64,')).toBe(true)
  })
})
