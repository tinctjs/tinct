/**
 * Registry for content-aware gravity resolvers. Mirrors the filter registry:
 * a resolver is registered when its module is imported and enabled, so its
 * code ships iff the consumer uses it. The compass gravities live in
 * `geometry-math.ts` and never touch this.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from './pixel'

/**
 * @internal
 * Computes the top-left corner for a crop window of the given size, from the
 * pixels the crop applies to. The result is clamped to the image by the
 * caller, and must be a pure function of its inputs so serialized histories
 * replay identically everywhere.
 */
export type GravityResolver = (
  pixels: PixelData,
  cropWidth: number,
  cropHeight: number,
) => { x: number; y: number }

/** @internal */
export const gravityRegistry = new Map<string, GravityResolver>()
