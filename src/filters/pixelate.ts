import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link pixelate}. */
export type PixelateOptions = {
  /**
   * Size of each mosaic block in pixels, `1..`.
   * @defaultValue `8`
   */
  size?: number
}

/**
 * Mosaic effect: average the image into square blocks.
 *
 * @example
 * ```ts
 * image.apply(pixelate({ size: 12 }))
 * ```
 */
export const pixelate: FilterFactory<PixelateOptions> = /* @__PURE__ */ defineFilter({
  name: 'pixelate',
  defaults: { size: 8 },
  fallback: cpuTodo('pixelate'),
})
