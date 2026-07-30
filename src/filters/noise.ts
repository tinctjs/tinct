import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

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
  fallback: cpuTodo('noise'),
})
