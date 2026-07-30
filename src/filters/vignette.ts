import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link vignette}. */
export type VignetteOptions = {
  /**
   * Darkening strength at the corners, `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
  /**
   * Radius where the falloff starts, as a fraction of the image diagonal,
   * `0..1`. Smaller values darken more of the frame.
   * @defaultValue `0.75`
   */
  radius?: number
  /**
   * Vignette color (CSS color).
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
    fallback: cpuTodo('vignette'),
  })
