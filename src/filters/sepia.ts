import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link sepia}. */
export type SepiaOptions = {
  /**
   * Blend between the original (`0`) and fully sepia-toned (`1`) image.
   * @defaultValue `1`
   */
  amount?: number
}

/**
 * Warm, brownish vintage tone.
 *
 * @example
 * ```ts
 * image.apply(sepia())
 * ```
 */
export const sepia: FilterFactory<SepiaOptions> = /* @__PURE__ */ defineFilter({
  name: 'sepia',
  defaults: { amount: 1 },
  fallback: cpuTodo('sepia'),
})
