/**
 * CPU-vs-GPU parity on a real WebGL2 context (headless Chromium).
 *
 * The CPU path is the reference implementation; every GPU-capable op must
 * match it within a small tolerance. CPU LUTs quantize to bytes between
 * stages while shaders stay in floats, so a few LSB of drift is expected —
 * anything larger is a shader bug.
 */
import { describe, expect, test } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import { _setGpuBackend } from '../src/gl/backend'
import { getWebgl2Backend } from '../src/gl/renderer'
import type { PixelData } from '../src/core/pixel'
import { createPixelData } from '../src/core/pixel'
import {
  grayscale,
  sepia,
  invert,
  duotone,
  posterize,
  vignette,
  blur,
  sharpen,
  pixelate,
} from '../src/filters/index'

/** Deterministic photo-ish fixture: gradients, a disc, some transparency. */
function fixture(width = 64, height = 48): PixelData {
  const p = createPixelData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inDisc = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (height / 3) ** 2
      p.data[i] = inDisc ? 210 : Math.round((x / (width - 1)) * 255)
      p.data[i + 1] = inDisc ? 120 : Math.round((y / (height - 1)) * 255)
      p.data[i + 2] = inDisc ? 60 : 160
      p.data[i + 3] = x < 4 ? 128 : 255 // a translucent strip
    }
  }
  return p
}

interface Parity {
  /** Hard ceiling for any single channel delta. */
  maxDelta: number
  /** Fraction of channel deltas that must stay within 3 LSB. */
  tightShare?: number
}

async function compare(build: (image: ImagePipe) => ImagePipe, parity: Parity): Promise<void> {
  const gpu = await build(ImagePipe._create(fixture()))._render()

  _setGpuBackend(null)
  try {
    const cpu = await build(ImagePipe._create(fixture()))._render()
    expect(gpu.width).toBe(cpu.width)
    expect(gpu.height).toBe(cpu.height)

    let worst = 0
    let tight = 0
    for (let i = 0; i < cpu.data.length; i++) {
      const delta = Math.abs(gpu.data[i]! - cpu.data[i]!)
      if (delta > worst) worst = delta
      if (delta <= 3) tight++
    }
    expect(worst, 'worst channel delta').toBeLessThanOrEqual(parity.maxDelta)
    expect(tight / cpu.data.length, 'share of channels within 3 LSB').toBeGreaterThanOrEqual(
      parity.tightShare ?? 0.99,
    )
  } finally {
    _setGpuBackend(undefined)
  }
}

test('a real WebGL2 backend is available in this browser', () => {
  expect(getWebgl2Backend()).not.toBeNull()
})

describe('gpu output matches the cpu reference', () => {
  test('adjust (all eight controls)', () =>
    compare(
      (i) =>
        i.adjust({
          brightness: 0.1,
          contrast: 0.15,
          saturation: 0.2,
          exposure: 0.1,
          hue: 30,
          gamma: 1.3,
          temperature: 0.4,
          tint: -0.2,
        }),
      { maxDelta: 4 },
    ))

  test('grayscale', () => compare((i) => i.apply(grayscale()), { maxDelta: 3 }))
  test('sepia', () => compare((i) => i.apply(sepia({ amount: 0.8 })), { maxDelta: 3 }))
  test('invert', () => compare((i) => i.apply(invert()), { maxDelta: 2 }))
  test('duotone', () =>
    compare((i) => i.apply(duotone({ shadows: '#1e3a5f', highlights: '#f5d0a9' })), {
      maxDelta: 3,
    }))
  test('vignette', () => compare((i) => i.apply(vignette({ amount: 0.7 })), { maxDelta: 3 }))
  test('posterize', () =>
    // Quantization boundaries can flip a whole level on float drift; require
    // near-total agreement instead of a tight ceiling.
    compare((i) => i.apply(posterize({ levels: 4 })), { maxDelta: 90, tightShare: 0.995 }))

  test('blur (separable two-pass)', () =>
    compare((i) => i.apply(blur({ radius: 3 })), { maxDelta: 5, tightShare: 0.98 }))
  test('sharpen (unsharp mask)', () =>
    compare((i) => i.apply(sharpen({ amount: 0.8 })), { maxDelta: 6, tightShare: 0.98 }))
  test('pixelate (block averaging)', () =>
    compare((i) => i.apply(pixelate({ size: 7 })), { maxDelta: 3 }))

  test('a full mixed chain', () =>
    compare(
      (i) =>
        i
          .adjust({ brightness: 0.05, saturation: 0.1 })
          .apply(grayscale({ amount: 0.4 }))
          .apply(blur({ radius: 2 }))
          .apply(vignette()),
      { maxDelta: 6, tightShare: 0.98 },
    ))
})
