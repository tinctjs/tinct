import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link sharpen}. */
export type SharpenOptions = {
  /**
   * Sharpening strength (unsharp-mask amount), `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
}

/**
 * Sharpen edges using an unsharp mask.
 *
 * @example
 * ```ts
 * image.apply(sharpen({ amount: 0.8 }))
 * ```
 */
export const sharpen: FilterFactory<SharpenOptions> = /* @__PURE__ */ defineFilter({
  name: 'sharpen',
  defaults: { amount: 0.5 },
  fallback: cpuTodo('sharpen'),
})
