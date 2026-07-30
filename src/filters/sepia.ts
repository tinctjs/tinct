import { defineFilter, type FilterFactory } from '../core/filter'
import { lerp } from './internal'

/** Options for {@link sepia}. */
export type SepiaOptions = {
  /**
   * Blend between the original (`0`) and fully sepia-toned (`1`) image.
   * @defaultValue `1`
   */
  amount?: number
}

/**
 * Warm, brownish vintage tone (standard sepia matrix).
 *
 * @example
 * ```ts
 * image.apply(sepia())
 * ```
 */
export const sepia: FilterFactory<SepiaOptions> = /* @__PURE__ */ defineFilter<SepiaOptions>({
  name: 'sepia',
  defaults: { amount: 1 },
  fallback: (pixels, { amount = 1 }) => {
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      data[i] = lerp(r, 0.393 * r + 0.769 * g + 0.189 * b, amount)
      data[i + 1] = lerp(g, 0.349 * r + 0.686 * g + 0.168 * b, amount)
      data[i + 2] = lerp(b, 0.272 * r + 0.534 * g + 0.131 * b, amount)
    }
    return undefined
  },
})
