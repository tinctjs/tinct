import { defineFilter, type FilterFactory } from '../core/filter'
import { parseColor } from '../cpu/color'
import { lerp } from './internal'

/** Options for {@link vignette}. */
export type VignetteOptions = {
  /**
   * Darkening strength at the corners, `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
  /**
   * Radius where the falloff starts, as a fraction of the distance from the
   * center to a corner, `0..1`. Smaller values darken more of the frame.
   * @defaultValue `0.75`
   */
  radius?: number
  /**
   * Vignette color (`#rgb[a]`, `#rrggbb[aa]`, `rgb()`/`rgba()`, or a basic
   * named color).
   * @defaultValue `'#000000'`
   */
  color?: string
}

/**
 * Darken the corners with a smooth radial falloff.
 *
 * @example
 * ```ts
 * image.apply(vignette({ amount: 0.6 }))
 * ```
 */
export const vignette: FilterFactory<VignetteOptions> =
  /* @__PURE__ */ defineFilter<VignetteOptions>({
    name: 'vignette',
    defaults: { amount: 0.5, radius: 0.75, color: '#000000' },
    fallback: (pixels, { amount = 0.5, radius = 0.75, color = '#000000' }) => {
      if (amount <= 0) return undefined
      const [vr, vg, vb] = parseColor(color)
      const { width, height, data } = pixels
      const cx = width / 2
      const cy = height / 2
      const maxDist = Math.sqrt(cx * cx + cy * cy)
      const start = Math.max(0, Math.min(1, radius))

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const n = Math.sqrt(dx * dx + dy * dy) / maxDist
          if (n <= start) continue
          // smoothstep from the start radius to the corner
          const t = start >= 1 ? 0 : Math.min(1, (n - start) / (1 - start))
          const blend = t * t * (3 - 2 * t) * amount
          const i = (y * width + x) * 4
          data[i] = lerp(data[i]!, vr, blend)
          data[i + 1] = lerp(data[i + 1]!, vg, blend)
          data[i + 2] = lerp(data[i + 2]!, vb, blend)
        }
      }
      return undefined
    },
  })
