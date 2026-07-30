import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link grayscale}. */
export type GrayscaleOptions = {
  /**
   * Blend between the original (`0`) and fully desaturated (`1`) image.
   * @defaultValue `1`
   */
  amount?: number
}

/**
 * Convert to grayscale using perceptual (Rec. 709 luma) weights.
 *
 * @example
 * ```ts
 * image.apply(grayscale())
 * image.apply(grayscale({ amount: 0.5 }))
 * ```
 */
export const grayscale: FilterFactory<GrayscaleOptions> = /* @__PURE__ */ defineFilter({
  name: 'grayscale',
  defaults: { amount: 1 },
  fallback: cpuTodo('grayscale'),
})
