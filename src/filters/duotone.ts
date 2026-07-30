import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link duotone}. */
export type DuotoneOptions = {
  /** CSS color mapped to the darkest tones, e.g. `'#1e3a5f'`. */
  shadows: string
  /** CSS color mapped to the brightest tones, e.g. `'#f5d0a9'`. */
  highlights: string
}

/**
 * Map the image's luminance onto a two-color gradient (the classic
 * Spotify-poster look).
 *
 * @example
 * ```ts
 * image.apply(duotone({ shadows: '#1e3a5f', highlights: '#f5d0a9' }))
 * ```
 */
export const duotone: FilterFactory<DuotoneOptions> = /* @__PURE__ */ defineFilter({
  name: 'duotone',
  fallback: cpuTodo('duotone'),
})
