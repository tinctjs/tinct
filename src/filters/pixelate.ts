import { defineFilter, type FilterFactory } from '../core/filter'

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
export const pixelate: FilterFactory<PixelateOptions> =
  /* @__PURE__ */ defineFilter<PixelateOptions>({
    name: 'pixelate',
    defaults: { size: 8 },
    fallback: (pixels, { size = 8 }) => {
      const block = Math.max(1, Math.floor(size))
      if (block === 1) return undefined
      const { width, height, data } = pixels
      for (let by = 0; by < height; by += block) {
        for (let bx = 0; bx < width; bx += block) {
          const bw = Math.min(block, width - bx)
          const bh = Math.min(block, height - by)
          let r = 0
          let g = 0
          let b = 0
          let a = 0
          for (let y = by; y < by + bh; y++) {
            for (let x = bx; x < bx + bw; x++) {
              const i = (y * width + x) * 4
              r += data[i]!
              g += data[i + 1]!
              b += data[i + 2]!
              a += data[i + 3]!
            }
          }
          const n = bw * bh
          r /= n
          g /= n
          b /= n
          a /= n
          for (let y = by; y < by + bh; y++) {
            for (let x = bx; x < bx + bw; x++) {
              const i = (y * width + x) * 4
              data[i] = r
              data[i + 1] = g
              data[i + 2] = b
              data[i + 3] = a
            }
          }
        }
      }
      return undefined
    },
  })
