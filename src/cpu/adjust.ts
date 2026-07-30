/**
 * CPU color adjustments. Applied in a fixed, documented order:
 * exposure → brightness → contrast → saturation → hue → gamma.
 *
 * The scalar stages (exposure, brightness, contrast) collapse into one
 * 256-entry lookup table; saturation and hue collapse into one 3×3 linear
 * matrix; gamma is a second LUT. Skipped entirely when they are no-ops.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { AdjustOptions } from '../core/types'

/** @internal Apply adjustments in place. */
export function adjustPixels(pixels: PixelData, options: AdjustOptions): void {
  const { brightness = 0, contrast = 0, saturation = 0, exposure = 0, hue = 0, gamma = 1 } = options

  const preLut = buildPreLut(exposure, brightness, contrast)
  const matrix = buildColorMatrix(saturation, hue)
  const gammaLut = buildGammaLut(gamma)
  const { data } = pixels

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!
    let g = data[i + 1]!
    let b = data[i + 2]!

    if (preLut) {
      r = preLut[r]!
      g = preLut[g]!
      b = preLut[b]!
    }
    if (matrix) {
      const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix
      const nr = m00! * r + m01! * g + m02! * b
      const ng = m10! * r + m11! * g + m12! * b
      const nb = m20! * r + m21! * g + m22! * b
      r = nr
      g = ng
      b = nb
    }
    if (gammaLut) {
      r = gammaLut[clampIndex(r)]!
      g = gammaLut[clampIndex(g)]!
      b = gammaLut[clampIndex(b)]!
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}

function clampIndex(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/** exposure (±1 → ±2 EV) → brightness (add) → contrast (slope around 128). */
function buildPreLut(
  exposure: number,
  brightness: number,
  contrast: number,
): Uint8ClampedArray | null {
  if (exposure === 0 && brightness === 0 && contrast === 0) return null
  const gain = Math.pow(2, 2 * exposure)
  const offset = brightness * 255
  // tan maps -1..1 onto 0..∞ with 0 → slope 1; clamped to keep numbers sane.
  const slope = Math.min(1e4, Math.tan(((Math.min(contrast, 0.9999) + 1) * Math.PI) / 4))
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    lut[v] = (v * gain + offset - 128) * slope + 128
  }
  return lut
}

/** Rec. 709 luma weights, shared by saturation and the docs' grayscale claim. */
export const LUMA_R = 0.2126
export const LUMA_G = 0.7152
export const LUMA_B = 0.0722

/**
 * @internal
 * Combined saturation × hue-rotation 3×3 matrix (row-major), or null if
 * no-op. Shared with the WebGL2 adjust shader so both paths use identical
 * coefficients.
 */
export function buildColorMatrix(saturation: number, hue: number): number[] | null {
  if (saturation === 0 && hue === 0) return null

  // Saturation: lerp between luma projection (f=0) and identity (f=1).
  const f = 1 + saturation
  const sat = [
    LUMA_R + (1 - LUMA_R) * f,
    LUMA_G * (1 - f),
    LUMA_B * (1 - f),
    LUMA_R * (1 - f),
    LUMA_G + (1 - LUMA_G) * f,
    LUMA_B * (1 - f),
    LUMA_R * (1 - f),
    LUMA_G * (1 - f),
    LUMA_B + (1 - LUMA_B) * f,
  ]

  if (hue === 0) return sat

  // Hue rotation matrix from the SVG/CSS filter-effects specification.
  const rad = (hue * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const rot = [
    0.213 + 0.787 * c - 0.213 * s,
    0.715 - 0.715 * c - 0.715 * s,
    0.072 - 0.072 * c + 0.928 * s,
    0.213 - 0.213 * c + 0.143 * s,
    0.715 + 0.285 * c + 0.14 * s,
    0.072 - 0.072 * c - 0.283 * s,
    0.213 - 0.213 * c - 0.787 * s,
    0.715 - 0.715 * c + 0.715 * s,
    0.072 + 0.928 * c + 0.072 * s,
  ]

  // rot × sat (saturation first, then hue).
  const out = new Array<number>(9)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        rot[row * 3]! * sat[col]! +
        rot[row * 3 + 1]! * sat[3 + col]! +
        rot[row * 3 + 2]! * sat[6 + col]!
    }
  }
  return out
}

/** out = 255 · (v/255)^gamma — gamma < 1 brightens midtones. */
function buildGammaLut(gamma: number): Uint8ClampedArray | null {
  if (gamma === 1) return null
  const clamped = Math.max(0.1, Math.min(4, gamma))
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    lut[v] = 255 * Math.pow(v / 255, clamped)
  }
  return lut
}
