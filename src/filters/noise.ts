import { defineFilter, type FilterFactory } from '../core/filter'

/** Options for {@link noise}. */
export type NoiseOptions = {
  /**
   * Noise strength, `0..1`.
   * @defaultValue `0.1`
   */
  amount?: number
  /**
   * Use the same noise value for all channels (film-grain look) instead of
   * per-channel color noise.
   * @defaultValue `true`
   */
  monochrome?: boolean
  /**
   * Seed for the deterministic noise generator, so renders and replayed
   * histories are reproducible.
   * @defaultValue `0`
   */
  seed?: number
}

/** Deterministic PRNG (mulberry32) so grain is reproducible across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Add deterministic film grain.
 *
 * @example
 * ```ts
 * image.apply(noise({ amount: 0.15 }))
 * ```
 */
export const noise: FilterFactory<NoiseOptions> = /* @__PURE__ */ defineFilter<NoiseOptions>({
  name: 'noise',
  defaults: { amount: 0.1, monochrome: true, seed: 0 },
  fallback: (pixels, { amount = 0.1, monochrome = true, seed = 0 }) => {
    if (amount <= 0) return undefined
    const rand = mulberry32(seed)
    const scale = amount * 255
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      if (monochrome) {
        const n = (rand() * 2 - 1) * scale
        data[i] = data[i]! + n
        data[i + 1] = data[i + 1]! + n
        data[i + 2] = data[i + 2]! + n
      } else {
        data[i] = data[i]! + (rand() * 2 - 1) * scale
        data[i + 1] = data[i + 1]! + (rand() * 2 - 1) * scale
        data[i + 2] = data[i + 2]! + (rand() * 2 - 1) * scale
      }
    }
    return undefined
  },
})
