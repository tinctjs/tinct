import { defineFilter, type FilterFactory } from '../core/filter'
import { parseColor } from '../cpu/color'
import { lerp, luma } from './internal'

/** Options for {@link duotone}. */
export type DuotoneOptions = {
  /** Color mapped to the darkest tones, e.g. `'#1e3a5f'`. */
  shadows: string
  /** Color mapped to the brightest tones, e.g. `'#f5d0a9'`. */
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
export const duotone: FilterFactory<DuotoneOptions> = /* @__PURE__ */ defineFilter<DuotoneOptions>({
  name: 'duotone',
  fallback: (pixels, { shadows, highlights }) => {
    const [sr, sg, sb] = parseColor(shadows)
    const [hr, hg, hb] = parseColor(highlights)
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      const t = luma(data[i]!, data[i + 1]!, data[i + 2]!) / 255
      data[i] = lerp(sr, hr, t)
      data[i + 1] = lerp(sg, hg, t)
      data[i + 2] = lerp(sb, hb, t)
    }
    return undefined
  },
})
