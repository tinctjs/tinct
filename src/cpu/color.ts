/**
 * Minimal CSS color parsing — enough for backgrounds and filter colors
 * without a DOM dependency. Supports `#rgb[a]`, `#rrggbb[aa]`,
 * `rgb()`/`rgba()`, `transparent`, and a few common names.
 *
 * @packageDocumentation
 * @internal
 */

/** @internal RGBA tuple, each channel 0..255. */
export type Rgba = readonly [number, number, number, number]

const NAMED: Record<string, Rgba> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
  gray: [128, 128, 128, 255],
  grey: [128, 128, 128, 255],
}

/**
 * @internal
 * Parse a CSS color string to RGBA. Throws a descriptive error on input we
 * do not understand (full CSS color parsing needs a DOM; we stay dependency-
 * and DOM-free).
 */
export function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase()
  const named = NAMED[value]
  if (named) return named

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (/^[0-9a-f]{3,4}$/.test(hex)) {
      const [r, g, b, a = 'f'] = hex
      return [
        parseInt(r! + r!, 16),
        parseInt(g! + g!, 16),
        parseInt(b! + b!, 16),
        parseInt(a + a, 16),
      ]
    }
    if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
      ]
    }
  }

  const fn =
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    )
  if (fn) {
    const alpha = fn[4] === undefined ? 255 : parseAlpha(fn[4])
    return [clampByte(Number(fn[1])), clampByte(Number(fn[2])), clampByte(Number(fn[3])), alpha]
  }

  throw new Error(
    `tinct: cannot parse color '${input}' — use #rgb[a], #rrggbb[aa], rgb()/rgba(), 'transparent', or a basic named color`,
  )
}

function parseAlpha(raw: string): number {
  const n = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
  return clampByte(n * 255)
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
