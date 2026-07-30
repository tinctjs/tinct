/**
 * Deterministic, platform-agnostic subject detection for `gravity: 'face'`.
 *
 * No platform APIs (`FaceDetector`), no bundled models — pure arithmetic
 * over pixels, so the same input produces the same crop in every browser,
 * in workers, and in Node tests, and serialized histories replay
 * identically everywhere.
 *
 * Two stages:
 * 1. **Skin-region scan** — classify pixels in YCbCr space using the classic
 *    skin chroma ranges, then slide multi-scale windows over an integral
 *    image of the mask; the densest window wins. Works well for portraits
 *    and group shots with visible faces.
 * 2. **Saliency fallback** — when skin coverage is negligible (no faces),
 *    fall back to the energy centroid (gradient magnitude + saturation), so
 *    the crop still lands on the most interesting region.
 *
 * This is an honest heuristic, not ML: profile faces in unusual lighting or
 * heavily stylized images can miss, in which case the saliency stage keeps
 * results reasonable.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import { resample } from '../cpu/resample'

/** Detection resolution: analysis runs on a copy at most this wide/tall. */
const ANALYSIS_SIZE = 96
/** Minimum fraction of skin pixels before we trust the skin stage. */
const MIN_SKIN_COVERAGE = 0.015

/** @internal The most likely subject location, in full-resolution pixels. */
export function findFocalPoint(pixels: PixelData): { x: number; y: number } {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(pixels.width, pixels.height))
  const w = Math.max(1, Math.round(pixels.width * scale))
  const h = Math.max(1, Math.round(pixels.height * scale))
  const small = scale < 1 ? resample(pixels, w, h, 'triangle') : pixels

  const focal = skinFocal(small) ?? saliencyFocal(small)
  return {
    x: ((focal.x + 0.5) / w) * pixels.width,
    y: ((focal.y + 0.5) / h) * pixels.height,
  }
}

/** Densest skin window via integral image, or null when coverage is too low. */
function skinFocal(p: PixelData): { x: number; y: number } | null {
  const { width: w, height: h, data } = p
  const mask = new Float64Array(w * h)
  let skinCount = 0

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    // BT.601 RGB → YCbCr; classic skin chroma box (Chai & Ngan).
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    if (y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
      mask[i] = 1
      skinCount++
    }
  }
  if (skinCount / (w * h) < MIN_SKIN_COVERAGE) return null

  // Integral image for O(1) window sums.
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += mask[y * w + x]!
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)]! + rowSum
    }
  }
  const windowSum = (x0: number, y0: number, x1: number, y1: number): number =>
    integral[y1 * (w + 1) + x1]! -
    integral[y0 * (w + 1) + x1]! -
    integral[y1 * (w + 1) + x0]! +
    integral[y0 * (w + 1) + x0]!

  let best = -1
  let bestX = 0
  let bestY = 0
  const base = Math.min(w, h)
  for (const fraction of [0.25, 0.4, 0.6]) {
    const size = Math.max(4, Math.round(base * fraction))
    if (size > w || size > h) continue
    for (let y0 = 0; y0 <= h - size; y0 += 2) {
      for (let x0 = 0; x0 <= w - size; x0 += 2) {
        const density = windowSum(x0, y0, x0 + size, y0 + size) / (size * size)
        // Slight preference for larger windows at equal density.
        const score = density * (1 + fraction * 0.25)
        if (score > best) {
          best = score
          bestX = x0 + size / 2
          bestY = y0 + size / 2
        }
      }
    }
  }
  return { x: bestX, y: bestY }
}

/** Energy centroid: gradient magnitude plus a saturation bonus. */
function saliencyFocal(p: PixelData): { x: number; y: number } {
  const { width: w, height: h, data } = p
  const luma = (i: number): number =>
    0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!

  let total = 0
  let sumX = 0
  let sumY = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = luma(i + 1) - luma(i - 1)
      const gy = luma(i + w) - luma(i - w)
      const r = data[i * 4]!
      const g = data[i * 4 + 1]!
      const b = data[i * 4 + 2]!
      const saturation = Math.max(r, g, b) - Math.min(r, g, b)
      const energy = Math.sqrt(gx * gx + gy * gy) + saturation * 0.25
      const weight = energy * energy // sharpen the distribution
      total += weight
      sumX += weight * x
      sumY += weight * y
    }
  }
  if (total === 0) return { x: w / 2, y: h / 2 }
  return { x: sumX / total, y: sumY / total }
}
