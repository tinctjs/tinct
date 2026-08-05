/**
 * imagepipe/effects on a real WebGL2 context: the warp displacement field
 * (bilinear source sampling) and sticker compositing (aux texture, rotated,
 * alpha-blended) must match their CPU twins within tolerance. Warps sample
 * between pixels, so a little bilinear rounding drift is expected; large
 * deltas mean the shader and kernel disagree about geometry.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { warp, sticker, stickerSource } from '../src/effects/index'
import { execute, type OpNode } from '../src/core/executor'
import { _setGpuBackend } from '../src/gl/backend'
import { getWebgl2Backend } from '../src/gl/renderer'
import { createPixelData, type PixelData } from '../src/core/pixel'

void warp
void sticker

const W = 64
const H = 48

/** Smooth two-axis gradient with a soft disc — warp-friendly, no hard edges. */
function fixture(): PixelData {
  const p = createPixelData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.hypot(x - W / 2, y - H / 2) / (H / 2)
      p.data[i] = Math.round((x / (W - 1)) * 255)
      p.data[i + 1] = Math.round((y / (H - 1)) * 255)
      p.data[i + 2] = Math.round(Math.max(0, 1 - d) * 200)
      p.data[i + 3] = 255
    }
  }
  return p
}

/** A soft round badge with real transparency and interior detail. */
function badge(): PixelData {
  const s = createPixelData(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4
      const d = Math.hypot(x - 7.5, y - 7.5)
      const inside = d < 7
      s.data[i] = 240
      s.data[i + 1] = 120 + ((x * 9) % 60)
      s.data[i + 2] = 24
      s.data[i + 3] = inside ? 255 : 0
    }
  }
  return s
}

afterEach(() => {
  _setGpuBackend(undefined)
})

async function parity(ops: OpNode[], maxDelta: number): Promise<void> {
  const backend = getWebgl2Backend()
  expect(backend).not.toBeNull()
  _setGpuBackend(backend)
  const gpu = await execute(fixture(), ops)
  _setGpuBackend(null)
  const cpu = await execute(fixture(), ops)
  let worst = 0
  for (let i = 0; i < cpu.data.length; i++) {
    worst = Math.max(worst, Math.abs(gpu.data[i]! - cpu.data[i]!))
  }
  expect(worst).toBeLessThanOrEqual(maxDelta)
}

describe('effects on a real GPU', () => {
  test('warp bulge + pinch zones match the CPU twin', async () => {
    await parity(
      [
        {
          op: 'filter',
          params: {
            name: 'warp',
            options: {
              zones: [
                { center: [0.35, 0.4], radius: 0.25, strength: 0.5 },
                { center: [0.7, 0.6], radius: 0.2, strength: -0.4 },
              ],
            },
          },
        },
      ],
      4,
    )
  })

  test('rotated translucent sticker matches the CPU twin', async () => {
    await parity(
      [
        {
          op: 'filter',
          params: {
            name: 'sticker',
            options: {
              source: stickerSource(badge()),
              at: [0.5, 0.45],
              width: 0.35,
              rotate: 30,
              opacity: 0.9,
            },
          },
        },
      ],
      4,
    )
  })
})
