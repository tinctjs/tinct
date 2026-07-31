/**
 * Source-over alpha compositing (straight, non-premultiplied alpha
 * throughout, like the rest of the pipeline), optionally through a separable
 * blend function.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { BlendFn } from './blend'

/**
 * @internal
 * Composite `overlay` onto `base` in place with its top-left at (ox, oy).
 * Out-of-bounds regions are clipped; `opacity` multiplies the overlay's own
 * alpha.
 *
 * With no `blend` this is plain source-over. With one, the W3C Compositing
 * Level 1 formula applies — the blended source color replaces `Cs` in
 * proportion to how opaque the backdrop is:
 *
 * ```
 * Cr = (1 - ab) * Cs + ab * B(Cb, Cs)
 * ao = as + ab * (1 - as)
 * Co = (as * Cr + (1 - as) * ab * Cb) / ao
 * ```
 *
 * `B(Cb, Cs) = Cs` collapses `Cr` to `Cs` and the whole thing to the
 * unblended case, which is why `source-over` passes no function.
 */
export function compositeOver(
  base: PixelData,
  overlay: PixelData,
  ox: number,
  oy: number,
  opacity: number,
  blend?: BlendFn,
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
        const cb = base.data[d + c]!
        let cs = overlay.data[s + c]!
        if (blend && da > 0) cs = (1 - da) * cs + da * (blend(cb / 255, cs / 255) * 255)
        base.data[d + c] = (cs * sa + cb * da * (1 - sa)) / outA
      }
      base.data[d + 3] = outA * 255
    }
  }
}
