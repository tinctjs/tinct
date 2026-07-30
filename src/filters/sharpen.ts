import { defineFilter, type FilterFactory } from '../core/filter'
import { gaussianBlur } from '../cpu/convolve'

/** Options for {@link sharpen}. */
export type SharpenOptions = {
  /**
   * Sharpening strength (unsharp-mask amount), `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
}

/**
 * Sharpen edges using an unsharp mask (original + amount × high-pass).
 *
 * @example
 * ```ts
 * image.apply(sharpen({ amount: 0.8 }))
 * ```
 */
export const sharpen: FilterFactory<SharpenOptions> = /* @__PURE__ */ defineFilter<SharpenOptions>({
  name: 'sharpen',
  defaults: { amount: 0.5 },
  fallback: (pixels, { amount = 0.5 }) => {
    if (amount <= 0) return undefined
    const blurred = gaussianBlur(pixels, 1)
    const { data } = pixels
    const strength = amount * 2
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i]! + (data[i]! - blurred.data[i]!) * strength
      data[i + 1] = data[i + 1]! + (data[i + 1]! - blurred.data[i + 1]!) * strength
      data[i + 2] = data[i + 2]! + (data[i + 2]! - blurred.data[i + 2]!) * strength
    }
    return undefined
  },
})
