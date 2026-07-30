/**
 * High-quality separable resampling: Lanczos-3, triangle (bilinear) and
 * nearest-neighbour kernels. Downscaling widens the kernel by the inverse
 * scale (proper area coverage), which is what makes large downscales clean
 * without multi-step tricks. Accumulation is alpha-premultiplied to avoid
 * halos around transparent edges.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import { createPixelData } from '../core/pixel'
import type { ResizeKernel } from '../core/types'

interface KernelSpec {
  support: number
  weight: (x: number) => number
}

const sinc = (x: number): number => {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

const KERNELS: Record<'lanczos' | 'triangle', KernelSpec> = {
  lanczos: { support: 3, weight: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
  triangle: { support: 1, weight: (x) => Math.max(0, 1 - Math.abs(x)) },
}

/** @internal Pick the concrete kernel for a resize. */
function pickKernel(kernel: ResizeKernel, downscaling: boolean): 'lanczos' | 'triangle' | 'nearest' {
  if (kernel === 'auto') return downscaling ? 'lanczos' : 'triangle'
  return kernel
}

/** @internal Resample `src` to `dstWidth` × `dstHeight`. */
export function resample(
  src: PixelData,
  dstWidth: number,
  dstHeight: number,
  kernel: ResizeKernel = 'auto',
): PixelData {
  if (dstWidth === src.width && dstHeight === src.height) return src
  const downscaling = dstWidth < src.width || dstHeight < src.height
  const chosen = pickKernel(kernel, downscaling)
  if (chosen === 'nearest') return resampleNearest(src, dstWidth, dstHeight)
  const spec = KERNELS[chosen]
  // Two separable passes: horizontal, then vertical.
  const horizontal = resamplePass(src, dstWidth, src.height, spec, true)
  return resamplePass(horizontal, dstWidth, dstHeight, spec, false)
}

function resampleNearest(src: PixelData, dstWidth: number, dstHeight: number): PixelData {
  const out = createPixelData(dstWidth, dstHeight)
  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / dstHeight))
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / dstWidth))
      const s = (sy * src.width + sx) * 4
      const d = (y * dstWidth + x) * 4
      out.data[d] = src.data[s]!
      out.data[d + 1] = src.data[s + 1]!
      out.data[d + 2] = src.data[s + 2]!
      out.data[d + 3] = src.data[s + 3]!
    }
  }
  return out
}

/** One separable pass along the horizontal or vertical axis. */
function resamplePass(
  src: PixelData,
  dstWidth: number,
  dstHeight: number,
  spec: KernelSpec,
  horizontal: boolean,
): PixelData {
  const srcLen = horizontal ? src.width : src.height
  const dstLen = horizontal ? dstWidth : dstHeight
  if (srcLen === dstLen) return src

  const scale = dstLen / srcLen
  const filterScale = Math.min(1, scale) // widen the kernel when downscaling
  const radius = spec.support / filterScale
  const out = createPixelData(dstWidth, dstHeight)

  // Precompute weights per destination index — identical for every row/column.
  const starts = new Int32Array(dstLen)
  const counts = new Int32Array(dstLen)
  const weights: number[][] = []
  for (let d = 0; d < dstLen; d++) {
    const center = (d + 0.5) / scale
    const start = Math.max(0, Math.ceil(center - radius - 0.5))
    const end = Math.min(srcLen - 1, Math.floor(center + radius - 0.5))
    const w: number[] = []
    let sum = 0
    for (let s = start; s <= end; s++) {
      const weight = spec.weight((s + 0.5 - center) * filterScale)
      w.push(weight)
      sum += weight
    }
    if (sum !== 0) for (let i = 0; i < w.length; i++) w[i]! /= sum
    starts[d] = start
    counts[d] = w.length
    weights.push(w)
  }

  const lines = horizontal ? dstHeight : dstWidth
  for (let line = 0; line < lines; line++) {
    for (let d = 0; d < dstLen; d++) {
      const w = weights[d]!
      const start = starts[d]!
      const count = counts[d]!
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let i = 0; i < count; i++) {
        const s = start + i
        const idx = horizontal ? (line * src.width + s) * 4 : (s * src.width + line) * 4
        const alpha = src.data[idx + 3]!
        const weight = w[i]!
        const wa = weight * alpha
        r += src.data[idx]! * wa
        g += src.data[idx + 1]! * wa
        b += src.data[idx + 2]! * wa
        a += wa
      }
      const outIdx = horizontal ? (line * dstWidth + d) * 4 : (d * dstWidth + line) * 4
      if (a > 1e-6) {
        out.data[outIdx] = r / a
        out.data[outIdx + 1] = g / a
        out.data[outIdx + 2] = b / a
      }
      out.data[outIdx + 3] = a
    }
  }
  return out
}
