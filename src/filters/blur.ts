import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

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
export const blur: FilterFactory<BlurOptions> = /* @__PURE__ */ defineFilter({
  name: 'blur',
  defaults: { radius: 4 },
  fallback: cpuTodo('blur'),
})
