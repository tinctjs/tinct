/**
 * 'face' gravity: deterministic subject detection, crop placement, registry
 * errors, worker-safety, and history replay.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { gravityRegistry } from '../src/core/gravity'
import { resolveCrop } from '../src/core/geometry-math'
import { shouldUseWorker } from '../src/core/worker-client'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'
import { enableFaceGravity, locateSubject } from '../src/face/index'
import type { SerializedOp } from '../src/core/types'
import { expectPixelsClose } from './helpers'

afterEach(() => {
  gravityRegistry.delete('face')
})

/**
 * A dark scene with a skin-toned disc (a "face") at the given center.
 * Skin tone ~ (224, 172, 138) sits inside the classic YCbCr skin box.
 */
function scene(
  width: number,
  height: number,
  faceX: number,
  faceY: number,
  radius = 24,
): PixelData {
  const p = createPixelData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inFace = (x - faceX) ** 2 + (y - faceY) ** 2 <= radius ** 2
      p.data[i] = inFace ? 224 : 24
      p.data[i + 1] = inFace ? 172 : 28
      p.data[i + 2] = inFace ? 138 : 34
      p.data[i + 3] = 255
    }
  }
  return p
}

describe('subject detection', () => {
  test('finds a skin-toned subject wherever it is', () => {
    for (const [fx, fy] of [
      [80, 70],
      [240, 90],
      [160, 180],
    ] as const) {
      const focal = locateSubject(scene(320, 240, fx, fy))
      expect(Math.abs(focal.x - fx)).toBeLessThan(30)
      expect(Math.abs(focal.y - fy)).toBeLessThan(30)
    }
  })

  test('is deterministic', () => {
    const a = locateSubject(scene(320, 240, 100, 120))
    const b = locateSubject(scene(320, 240, 100, 120))
    expect(a).toEqual(b)
  })

  test('falls back to saliency when there is no skin', () => {
    // Flat dark image with one bright, saturated block off-center.
    const p = createPixelData(200, 200)
    for (let i = 0; i < p.data.length; i += 4) {
      p.data[i] = 10
      p.data[i + 1] = 10
      p.data[i + 2] = 10
      p.data[i + 3] = 255
    }
    for (let y = 130; y < 170; y++) {
      for (let x = 30; x < 70; x++) {
        const i = (y * 200 + x) * 4
        p.data[i] = 30
        p.data[i + 1] = 90
        p.data[i + 2] = 220
      }
    }
    const focal = locateSubject(p)
    expect(focal.x).toBeLessThan(100) // pulled toward the block…
    expect(focal.y).toBeGreaterThan(100) // …not the geometric center
  })
})

describe("crop with gravity: 'face'", () => {
  test('the crop window covers the detected face', () => {
    enableFaceGravity()
    const pixels = scene(320, 240, 250, 80)
    const rect = resolveCrop({ aspect: '1:1', gravity: 'face' }, 320, 240, pixels)
    expect(rect.width).toBe(240)
    expect(rect.height).toBe(240)
    // Face at x=250 → a centered-on-face 240px window clamps to the right edge.
    expect(rect.x).toBeGreaterThan(40)
    expect(250 - rect.x).toBeGreaterThan(0)
    expect(250 - rect.x).toBeLessThan(240)
  })

  test('dimension queries never need the detector', () => {
    // No enableFaceGravity() here: width/height must still be exact.
    const image = TinctImage._create(scene(320, 240, 100, 100)).crop({
      aspect: '1:1',
      gravity: 'face',
    })
    expect([image.width, image.height]).toEqual([240, 240])
  })

  test('rendering without enableFaceGravity throws a descriptive error', async () => {
    const image = TinctImage._create(scene(320, 240, 100, 100)).crop({
      aspect: '1:1',
      gravity: 'face',
    })
    await expect(image._render()).rejects.toThrow(/enableFaceGravity.*tinctjs\/face/)
  })

  test('histories replay identically (detection is deterministic)', async () => {
    enableFaceGravity()
    const source = scene(320, 240, 220, 100)
    const edited = TinctImage._create(source).crop({ aspect: '1:1', gravity: 'face' })
    const ops = JSON.parse(JSON.stringify(edited.history())) as SerializedOp[]
    const replayed = TinctImage._create(source).pipe(ops)
    expectPixelsClose(await replayed._render(), await edited._render(), 0)
  })
})

describe('worker safety', () => {
  const cropOp = { op: 'crop', params: { aspect: '1:1', gravity: 'face' } } as const
  const big = (): PixelData => createPixelData(1024, 1024)

  test('face crops stay on the main thread until the gravity is registered', () => {
    const originalWorker = globalThis.Worker
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    ;(globalThis as { Worker: unknown }).Worker = class {}
    try {
      expect(shouldUseWorker([cropOp], big())).toBe(false)
      enableFaceGravity()
      expect(shouldUseWorker([cropOp], big())).toBe(true)
    } finally {
      ;(globalThis as { Worker: unknown }).Worker = originalWorker
    }
  })
})
