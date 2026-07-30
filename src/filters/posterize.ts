import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link posterize}. */
export type PosterizeOptions = {
  /**
   * Number of tonal levels per channel, `2..255`.
   * @defaultValue `4`
   */
  levels?: number
}

/**
 * Reduce each channel to a fixed number of levels for a screen-print look.
 *
 * @example
 * ```ts
 * image.apply(posterize({ levels: 3 }))
 * ```
 */
export const posterize: FilterFactory<PosterizeOptions> =
  /* @__PURE__ */ defineFilter<PosterizeOptions>({
    name: 'posterize',
    defaults: { levels: 4 },
    fallback: cpuTodo('posterize'),
  })
