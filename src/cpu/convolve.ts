/**
 * Separable Gaussian convolution, shared by the blur and sharpen filters.
 * Cost grows linearly with radius; edges clamp; accumulation is
 * alpha-premultiplied to avoid halos at transparent edges.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import { createPixelData } from '../core/pixel'

/** @internal Gaussian blur with standard deviation `sigma` (no-op for sigma <= 0). */
export function gaussianBlur(src: PixelData, sigma: number): PixelData {
  if (sigma <= 0) return src
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float64Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = w
    sum += w
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum

  const horizontal = blurPass(src, kernel, radius, true)
  return blurPass(horizontal, kernel, radius, false)
}

function blurPass(
  src: PixelData,
  kernel: Float64Array,
  radius: number,
  horizontal: boolean,
): PixelData {
  const { width, height, data } = src
  const out = createPixelData(width, height)
  const maxMain = (horizontal ? width : height) - 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const main = horizontal ? x : y
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = -radius; k <= radius; k++) {
        const m = Math.max(0, Math.min(maxMain, main + k))
        const idx = horizontal ? (y * width + m) * 4 : (m * width + x) * 4
        const w = kernel[k + radius]!
        const alpha = data[idx + 3]!
        const wa = w * alpha
        r += data[idx]! * wa
        g += data[idx + 1]! * wa
        b += data[idx + 2]! * wa
        a += wa
      }
      const d = (y * width + x) * 4
      if (a > 1e-6) {
        out.data[d] = r / a
        out.data[d + 1] = g / a
        out.data[d + 2] = b / a
      }
      out.data[d + 3] = a
    }
  }
  return out
}
