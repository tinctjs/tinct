/**
 * ThumbHash encoding — a ~25-byte image placeholder that decodes to a soft
 * preview (algorithm by Evan Wallace, https://evanw.github.io/thumbhash/).
 *
 * This is an independent TypeScript implementation of the published
 * algorithm; the test suite verifies it byte-for-byte against the MIT
 * reference implementation. Output is deterministic: the same pixels hash
 * identically in every environment.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'

/** DCT one channel into a DC term, normalized AC terms, and their scale. */
function encodeChannel(
  channel: Float64Array,
  nx: number,
  ny: number,
  w: number,
  h: number,
): { dc: number; ac: number[]; scale: number } {
  let dc = 0
  const ac: number[] = []
  let scale = 0
  const fx = new Float64Array(w)

  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
      let f = 0
      for (let x = 0; x < w; x++) fx[x] = Math.cos((Math.PI / w) * cx * (x + 0.5))
      for (let y = 0; y < h; y++) {
        const fy = Math.cos((Math.PI / h) * cy * (y + 0.5))
        for (let x = 0; x < w; x++) f += channel[x + y * w]! * fx[x]! * fy
      }
      f /= w * h
      if (cx || cy) {
        ac.push(f)
        scale = Math.max(scale, Math.abs(f))
      } else {
        dc = f
      }
    }
  }
  if (scale) {
    for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * ac[i]!
  }
  return { dc, ac, scale }
}

/**
 * @internal Encode RGBA pixels (≤100×100, straight alpha) to a ThumbHash.
 */
export function encodeThumbHash(pixels: PixelData): Uint8Array {
  const { width: w, height: h, data } = pixels
  if (w > 100 || h > 100) {
    throw new Error(
      `imagepipe: thumbhash input must be at most 100x100 (got ${String(w)}x${String(h)})`,
    )
  }

  // Average color, alpha-weighted.
  let avgR = 0
  let avgG = 0
  let avgB = 0
  let avgA = 0
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = data[j + 3]! / 255
    avgR += (alpha / 255) * data[j]!
    avgG += (alpha / 255) * data[j + 1]!
    avgB += (alpha / 255) * data[j + 2]!
    avgA += alpha
  }
  if (avgA) {
    avgR /= avgA
    avgG /= avgA
    avgB /= avgA
  }

  const hasAlpha = avgA < w * h
  const lLimit = hasAlpha ? 5 : 7 // fewer luminance terms when alpha is present
  const lx = Math.max(1, Math.round((lLimit * w) / Math.max(w, h)))
  const ly = Math.max(1, Math.round((lLimit * h) / Math.max(w, h)))

  // RGBA → LPQA, composited onto the average color.
  const l = new Float64Array(w * h)
  const p = new Float64Array(w * h)
  const q = new Float64Array(w * h)
  const a = new Float64Array(w * h)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = data[j + 3]! / 255
    const r = avgR * (1 - alpha) + (alpha / 255) * data[j]!
    const g = avgG * (1 - alpha) + (alpha / 255) * data[j + 1]!
    const b = avgB * (1 - alpha) + (alpha / 255) * data[j + 2]!
    l[i] = (r + g + b) / 3
    p[i] = (r + g) / 2 - b // yellow − blue
    q[i] = r - g // red − green
    a[i] = alpha
  }

  const lCh = encodeChannel(l, Math.max(3, lx), Math.max(3, ly), w, h)
  const pCh = encodeChannel(p, 3, 3, w, h)
  const qCh = encodeChannel(q, 3, 3, w, h)
  const aCh = hasAlpha ? encodeChannel(a, 5, 5, w, h) : null

  const isLandscape = w > h
  const header24 =
    Math.round(63 * lCh.dc) |
    (Math.round(31.5 + 31.5 * pCh.dc) << 6) |
    (Math.round(31.5 + 31.5 * qCh.dc) << 12) |
    (Math.round(31 * lCh.scale) << 18) |
    ((hasAlpha ? 1 : 0) << 23)
  const header16 =
    (isLandscape ? ly : lx) |
    (Math.round(63 * pCh.scale) << 3) |
    (Math.round(63 * qCh.scale) << 9) |
    ((isLandscape ? 1 : 0) << 15)

  const hash: number[] = [
    header24 & 255,
    (header24 >> 8) & 255,
    header24 >> 16,
    header16 & 255,
    header16 >> 8,
  ]
  const acStart = hasAlpha ? 6 : 5
  let acIndex = 0
  if (aCh) hash.push(Math.round(15 * aCh.dc) | (Math.round(15 * aCh.scale) << 4))

  const channels = aCh ? [lCh.ac, pCh.ac, qCh.ac, aCh.ac] : [lCh.ac, pCh.ac, qCh.ac]
  for (const ac of channels) {
    for (const f of ac) {
      hash[acStart + (acIndex >> 1)] =
        (hash[acStart + (acIndex >> 1)] ?? 0) | (Math.round(15 * f) << ((acIndex++ & 1) << 2))
    }
  }
  return new Uint8Array(hash)
}
