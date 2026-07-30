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

/**
 * Most face-like skin window via integral images, or null when coverage is
 * too low. Tuned against a labeled photo set (see tests and the eval notes
 * in git history); the score combines:
 *
 * - **skin density** — the fraction of skin-classified pixels;
 * - **feature energy** — average luminance-gradient magnitude *on skin*.
 *   Faces carry eyes/brows/mouth edges; bare arms, chests and skin-toned
 *   flat surfaces (wood, sand) are smooth and score low;
 * - a small **upper-position prior** — in people photos the face usually
 *   tops the skin cluster.
 */
function skinFocal(p: PixelData): { x: number; y: number } | null {
  const { width: w, height: h, data } = p
  const mask = new Float64Array(w * h)
  let skinCount = 0

  const luma = (i: number): number =>
    0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    // BT.601 RGB → YCbCr; classic skin chroma box (Chai & Ngan), with the
    // Cb floor raised slightly: it costs little real skin but rejects a lot
    // of gold/tan fabric and warm wood.
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    // The channel-span cap rejects vividly saturated warm colors (gold
    // fabric, traffic orange) whose chroma sneaks into the skin box, and
    // g > b rejects crimson/magenta fabric. Both hold for real skin across
    // tones — the span cap is deliberately loose so darker skin stays in.
    const span = Math.max(r, g, b) - Math.min(r, g, b)
    if (y > 40 && g > b && span <= 110 && cb >= 82 && cb <= 127 && cr >= 133 && cr <= 173) {
      mask[i] = 1
      skinCount++
    }
  }
  if (skinCount / (w * h) < MIN_SKIN_COVERAGE) return null

  // Gradient magnitude on skin pixels only (facial-feature energy).
  const feat = new Float64Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (mask[i] === 0) continue
      const gx = luma(i + 1) - luma(i - 1)
      const gy = luma(i + w) - luma(i - w)
      feat[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }

  // Integral images for O(1) window sums.
  const skinI = integralImage(mask, w, h)
  const featI = integralImage(feat, w, h)

  let best = -1
  let bestX = 0
  let bestY = 0
  let bestSize = 0
  const base = Math.min(w, h)
  for (const fraction of [0.25, 0.4, 0.6]) {
    const size = Math.max(4, Math.round(base * fraction))
    if (size > w || size > h) continue
    for (let y0 = 0; y0 <= h - size; y0 += 2) {
      for (let x0 = 0; x0 <= w - size; x0 += 2) {
        const skin = windowSum(skinI, w, x0, y0, x0 + size, y0 + size)
        let density = skin / (size * size)
        if (density < 0.12) continue
        // Real face windows always mix skin with hair, eyes, and background.
        // Near-solid "skin" is fabric or a flat surface — penalize it.
        if (density > 0.8) density = 0.8 - (density - 0.8) * 1.5
        // Average feature energy per skin pixel, saturated so extreme
        // texture (sequins, glare) cannot dominate density.
        const feature = Math.min(windowSum(featI, w, x0, y0, x0 + size, y0 + size) / skin / 24, 1.5)
        const centerY = (y0 + size / 2) / h
        const score = density * (0.5 + feature) * (1 + fraction * 0.15) * (1 - 0.1 * centerY)
        if (score > best) {
          best = score
          bestX = x0
          bestY = y0
          bestSize = size
        }
      }
    }
  }
  if (best <= 0) return null

  // The window is coarse; the face is where the *featured skin* inside it
  // is. Weight by feature energy (falling back to plain skin) so the focal
  // pulls onto eyes/mouths rather than the window's geometric center — and
  // only over the window's upper portion, because a face tops its skin
  // cluster while textured clothing below it drags the centroid down.
  let wSum = 0
  let fx = 0
  let fy = 0
  const refineBottom = bestY + Math.round(bestSize * 0.65)
  for (let y = bestY; y < refineBottom; y++) {
    for (let x = bestX; x < bestX + bestSize; x++) {
      const i = y * w + x
      const weight = feat[i]! + mask[i]! * 0.5
      wSum += weight
      fx += weight * x
      fy += weight * y
    }
  }
  if (wSum === 0) return { x: bestX + bestSize / 2, y: bestY + bestSize / 2 }
  return { x: fx / wSum, y: fy / wSum }
}

function integralImage(values: Float64Array, w: number, h: number): Float64Array {
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += values[y * w + x]!
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)]! + rowSum
    }
  }
  return integral
}

function windowSum(
  integral: Float64Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return (
    integral[y1 * (w + 1) + x1]! -
    integral[y0 * (w + 1) + x1]! -
    integral[y1 * (w + 1) + x0]! +
    integral[y0 * (w + 1) + x0]!
  )
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
