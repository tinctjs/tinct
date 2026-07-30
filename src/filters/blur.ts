import { defineFilter, type FilterFactory } from '../core/filter'
import { gaussianBlur } from '../cpu/convolve'

/** Options for {@link blur}. */
export type BlurOptions = {
  /**
   * Gaussian blur radius (standard deviation) in pixels, `0..100`.
   * @defaultValue `4`
   */
  radius?: number
}

/**
 * Gaussian blur (separable, so cost grows linearly with radius).
 *
 * @example
 * ```ts
 * image.apply(blur({ radius: 4 }))
 * ```
 */
export const blur: FilterFactory<BlurOptions> = /* @__PURE__ */ defineFilter<BlurOptions>({
  name: 'blur',
  defaults: { radius: 4 },
  fallback: (pixels, { radius = 4 }) => gaussianBlur(pixels, Math.min(100, Math.max(0, radius))),
})
