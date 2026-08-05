/**
 * imagepipe/effects: warp zones and sticker compositing on the CPU
 * reference path — geometry, identity cases, validation, serialization.
 */
import { describe, expect, test } from 'vitest'
import { warp, sticker, stickerSource, type StickerOptions } from '../src/effects/index'
import { FILTER_DEFINITION } from '../src/core/filter'
import { execute, type OpNode } from '../src/core/executor'
import { _setGpuBackend } from '../src/gl/backend'
import { createPixelData, type PixelData } from '../src/core/pixel'

_setGpuBackend(null) // CPU reference path throughout

const W = 40
const H = 40

/** Horizontal red gradient. */
function gradient(): PixelData {
  const p = createPixelData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      p.data[i] = Math.round((x / (W - 1)) * 255)
      p.data[i + 1] = 60
      p.data[i + 2] = 120
      p.data[i + 3] = 255
    }
  }
  return p
}

function solid(width: number, height: number, rgba: [number, number, number, number]): PixelData {
  const p = createPixelData(width, height)
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = rgba[0]
    p.data[i + 1] = rgba[1]
    p.data[i + 2] = rgba[2]
    p.data[i + 3] = rgba[3]
  }
  return p
}

const warpOp = (zones: Parameters<typeof warp>[0]['zones']): OpNode => ({
  op: 'filter',
  params: { name: 'warp', options: { zones } },
})

describe('warp', () => {
  test('zero zones and zero strength are identity', async () => {
    const out1 = await execute(gradient(), [warpOp([])])
    expect(out1.data).toEqual(gradient().data)
    const out2 = await execute(gradient(), [
      warpOp([{ center: [0.5, 0.5], radius: 0.3, strength: 0 }]),
    ])
    expect(out2.data).toEqual(gradient().data)
  })

  test('a bulge magnifies: pixels inside the zone sample toward the center', async () => {
    const out = await execute(gradient(), [
      warpOp([{ center: [0.5, 0.5], radius: 0.4, strength: 0.6 }]),
    ])
    // Right of center, halfway into the zone: the sample point moves left
    // (toward the center), so the red value drops below the input gradient.
    const x = 26
    const y = 20
    const before = gradient().data[(y * W + x) * 4]!
    const after = out.data[(y * W + x) * 4]!
    expect(after).toBeLessThan(before - 4)
    // The zone center is (approximately) a fixed point — it falls between
    // pixel centers, so allow bilinear rounding.
    const center = (20 * W + 20) * 4
    expect(Math.abs(out.data[center]! - gradient().data[center]!)).toBeLessThanOrEqual(3)
  })

  test('a pinch pushes samples outward', async () => {
    const out = await execute(gradient(), [
      warpOp([{ center: [0.5, 0.5], radius: 0.4, strength: -0.6 }]),
    ])
    const x = 26
    const y = 20
    expect(out.data[(y * W + x) * 4]!).toBeGreaterThan(gradient().data[(y * W + x) * 4]! + 4)
  })

  test('pixels outside every zone are untouched', async () => {
    const out = await execute(gradient(), [
      warpOp([{ center: [0.5, 0.5], radius: 0.2, strength: 0.8 }]),
    ])
    expect(out.data[3]).toBe(255)
    expect(out.data[0]).toBe(gradient().data[0])
    const corner = ((H - 1) * W + (W - 1)) * 4
    expect(out.data[corner]).toBe(gradient().data[corner])
  })

  test('more than four zones throws', async () => {
    const zones = Array.from({ length: 5 }, () => ({
      center: [0.5, 0.5] as [number, number],
      radius: 0.1,
      strength: 0.1,
    }))
    await expect(execute(gradient(), [warpOp(zones)])).rejects.toThrow(/at most 4 zones/)
  })
})

describe('sticker', () => {
  const redSticker = stickerSource(solid(4, 4, [255, 0, 0, 255]))

  const stickerOp = (options: StickerOptions): OpNode => ({
    op: 'filter',
    params: { name: 'sticker', options },
  })

  test('composites at the anchor and leaves the rest untouched', async () => {
    const out = await execute(solid(W, H, [0, 0, 255, 255]), [
      stickerOp({ source: redSticker, at: [0.5, 0.5], width: 0.25 }),
    ])
    const center = (20 * W + 20) * 4
    expect(out.data[center]).toBe(255)
    expect(out.data[center + 2]).toBe(0)
    expect(out.data[0]).toBe(0) // far corner: still blue
    expect(out.data[2]).toBe(255)
  })

  test('opacity blends with the base image', async () => {
    const out = await execute(solid(W, H, [0, 0, 255, 255]), [
      stickerOp({ source: redSticker, at: [0.5, 0.5], width: 0.25, opacity: 0.5 }),
    ])
    const center = (20 * W + 20) * 4
    expect(out.data[center]).toBeGreaterThan(100)
    expect(out.data[center]).toBeLessThan(155)
    expect(out.data[center + 2]).toBeGreaterThan(100)
  })

  test('transparent sticker pixels show the image through', async () => {
    const out = await execute(solid(W, H, [0, 0, 255, 255]), [
      stickerOp({ source: stickerSource(solid(4, 4, [255, 0, 0, 0])), at: [0.5, 0.5], width: 0.5 }),
    ])
    expect(out.data).toEqual(solid(W, H, [0, 0, 255, 255]).data)
  })

  test('rotation by 180 degrees still lands on the anchor', async () => {
    const out = await execute(solid(W, H, [0, 0, 255, 255]), [
      stickerOp({ source: redSticker, at: [0.5, 0.5], width: 0.25, rotate: 180 }),
    ])
    expect(out.data[(20 * W + 20) * 4]).toBe(255)
  })

  test('corrupt sticker data throws a descriptive error', async () => {
    const bad: StickerOptions = {
      source: { width: 4, height: 4, data64: 'AAAA' },
      at: [0.5, 0.5],
      width: 0.25,
    }
    await expect(execute(solid(W, H, [0, 0, 255, 255]), [stickerOp(bad)])).rejects.toThrow(
      /sticker source/,
    )
  })

  test('decoded sticker identity is stable across recompiles (texture cache key)', () => {
    const a = sticker({ source: redSticker, at: [0.5, 0.5], width: 0.25 })
    const b = sticker({ source: redSticker, at: [0.6, 0.5], width: 0.3 })
    void a
    void b
    // Same data64 → same PixelData object via the decode memo; the live
    // renderer's WeakMap keys on it, so per-frame recipe rebuilds reuse
    // the uploaded texture. We assert through the public seam: two
    // texture declarations for the same source share pixels.
    const defA = warpless(a)
    const defB = warpless(b)
    expect(defA).toBe(defB)
  })
})

/** Extract the (memoized) decoded pixels behind a sticker filter value. */
function warpless(filter: ReturnType<typeof sticker>): PixelData {
  return filter[FILTER_DEFINITION].textures!(filter.options)[0]!.pixels
}
