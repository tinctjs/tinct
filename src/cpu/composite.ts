/**
 * Source-over alpha compositing for the overlay op (straight, non-
 * premultiplied alpha throughout, like the rest of the pipeline).
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'

/**
 * @internal
 * Composite `overlay` onto `base` in place with its top-left at (ox, oy).
 * Out-of-bounds regions are clipped; `opacity` multiplies the overlay's own
 * alpha.
 */
export function compositeOver(
  base: PixelData,
  overlay: PixelData,
  ox: number,
  oy: number,
  opacity: number,
): void {
  const x0 = Math.max(0, ox)
  const y0 = Math.max(0, oy)
  const x1 = Math.min(base.width, ox + overlay.width)
  const y1 = Math.min(base.height, oy + overlay.height)
  if (opacity <= 0) return

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = ((y - oy) * overlay.width + (x - ox)) * 4
      const sa = (overlay.data[s + 3]! / 255) * opacity
      if (sa === 0) continue
      const d = (y * base.width + x) * 4
      const da = base.data[d + 3]! / 255
      const outA = sa + da * (1 - sa)
      // outA can only be 0 when both alphas are 0, which `sa === 0` excludes.
      for (let c = 0; c < 3; c++) {
        base.data[d + c] = (overlay.data[s + c]! * sa + base.data[d + c]! * da * (1 - sa)) / outA
      }
      base.data[d + 3] = outA * 255
    }
  }
}
