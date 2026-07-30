/**
 * EXIF auto-orientation on Blob decode: the oriented createImageBitmap call,
 * its fallbacks for engines that reject the option, and cleanup.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodeSource } from '../src/io/load'

class FakeBitmap {
  closed = false
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close(): void {
    this.closed = true
  }
}

/** Minimal canvas stand-in for drawToPixels: draw + read back zeroed pixels. */
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): unknown {
    if (kind !== '2d') return null
    return {
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
    }
  }
}

const fakeBlob = (): Blob => new Blob([new Uint8Array([1, 2, 3])])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EXIF auto-orientation', () => {
  test('requests imageOrientation: from-image and uses the oriented dimensions', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    const bitmap = new FakeBitmap(40, 60) // portrait after orientation
    const create = vi.fn().mockResolvedValue(bitmap)
    vi.stubGlobal('createImageBitmap', create)

    const pixels = await decodeSource(fakeBlob())

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' })
    expect([pixels.width, pixels.height]).toEqual([40, 60])
    expect(bitmap.closed).toBe(true)
  })

  test('falls back to a plain decode when the option is rejected asynchronously', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    const bitmap = new FakeBitmap(8, 4)
    const create = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new TypeError('unknown member')))
      .mockImplementationOnce(() => Promise.resolve(bitmap))
    vi.stubGlobal('createImageBitmap', create)

    const pixels = await decodeSource(fakeBlob())

    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]).toHaveLength(1) // second call: no options
    expect([pixels.width, pixels.height]).toEqual([8, 4])
  })

  test('falls back when the option throws synchronously (old WebIDL behavior)', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    const bitmap = new FakeBitmap(6, 6)
    const create = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('invalid enumeration value')
      })
      .mockImplementationOnce(() => Promise.resolve(bitmap))
    vi.stubGlobal('createImageBitmap', create)

    const pixels = await decodeSource(fakeBlob())

    expect(create).toHaveBeenCalledTimes(2)
    expect([pixels.width, pixels.height]).toEqual([6, 6])
  })

  test('genuinely undecodable blobs still reject with the real error', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    const create = vi.fn().mockImplementation(() => Promise.reject(new Error('broken image')))
    vi.stubGlobal('createImageBitmap', create)

    await expect(decodeSource(fakeBlob())).rejects.toThrow('broken image')
  })
})
