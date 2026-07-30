/**
 * The `tinct` entry point: loading images and probing capabilities.
 *
 * @packageDocumentation
 */

import type { Capabilities, ImageSource, LoadOptions } from './types'
import { TinctImage } from './editor'

/**
 * Load an image from any supported source and get back an immutable
 * {@link TinctImage} pipeline.
 *
 * @example
 * ```ts
 * const image = await tinct.load(file)
 * const image = await tinct.load('https://example.com/photo.jpg')
 * const image = await tinct.load(imageData)
 * ```
 */
async function load(source: ImageSource, options?: LoadOptions): Promise<TinctImage> {
  void source
  void options
  void TinctImage
  return Promise.reject(new Error('tinct: load is not implemented yet (Phase 2)'))
}

/**
 * Detect what the current environment supports. Tinct consults the same
 * detection internally to pick execution paths; this is exposed so consumers
 * can surface it (e.g. show a "GPU accelerated" badge).
 */
function capabilities(): Capabilities {
  return {
    webgl2: typeof WebGL2RenderingContext !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    workers: typeof Worker !== 'undefined',
  }
}

/**
 * The Tinct entry point.
 *
 * @example
 * ```ts
 * import { tinct } from 'tinctjs'
 *
 * const image = await tinct.load(file)
 * const blob = await image.resize({ width: 1280 }).toBlob({ format: 'webp' })
 * ```
 */
export const tinct = { load, capabilities } as const
