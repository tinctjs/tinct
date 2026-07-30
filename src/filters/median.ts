import { defineFilter, type FilterFactory } from '../core/filter'

/** Options for {@link median}. */
export type MedianOptions = {
  /**
   * Window radius in pixels, `1..5` (a radius of 1 is the classic 3×3
   * median). `0` is a no-op.
   * @defaultValue `1`
   */
  radius?: number
}

/**
 * Median filter: removes salt-and-pepper noise and speckle while keeping
 * edges sharp (unlike {@link blur}, which softens them). Channels are
 * filtered independently; alpha is untouched.
 *
 * Windows shrink at the image edges rather than clamping, so corners are a
 * true median of the pixels that exist. CPU-only.
 *
 * @example
 * ```ts
 * image.apply(median()) // 3×3
 * image.apply(median({ radius: 2 })) // 5×5, stronger
 * ```
 */
export const median: FilterFactory<MedianOptions> = /* @__PURE__ */ defineFilter<MedianOptions>({
  name: 'median',
  defaults: { radius: 1 },
  fallback: (pixels, { radius = 1 }) => {
    const r = Math.max(0, Math.min(5, Math.floor(radius)))
    if (r === 0) return undefined
    const { width, height, data } = pixels
    const source = new Uint8ClampedArray(data) // read from a stable copy
    const windowMax = (2 * r + 1) * (2 * r + 1)
    const scratch = [
      new Uint8Array(windowMax),
      new Uint8Array(windowMax),
      new Uint8Array(windowMax),
    ]

    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(height - 1, y + r)
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r)
        const x1 = Math.min(width - 1, x + r)
        let count = 0
        for (let wy = y0; wy <= y1; wy++) {
          for (let wx = x0; wx <= x1; wx++) {
            const s = (wy * width + wx) * 4
            scratch[0]![count] = source[s]!
            scratch[1]![count] = source[s + 1]!
            scratch[2]![count] = source[s + 2]!
            count++
          }
        }
        const mid = count >> 1
        const d = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          data[d + c] = select(scratch[c]!, count, mid)
        }
      }
    }
    return undefined
  },
})

/** In-place insertion sort up to `count`, then return the `mid`-th value —
 * fastest approach for the tiny windows a median filter uses. */
function select(values: Uint8Array, count: number, mid: number): number {
  for (let i = 1; i < count; i++) {
    const v = values[i]!
    let j = i - 1
    while (j >= 0 && values[j]! > v) {
      values[j + 1] = values[j]!
      j--
    }
    values[j + 1] = v
  }
  return values[mid]!
}
