/**
 * The `imagepipe` entry point: loading images and probing capabilities.
 *
 * @packageDocumentation
 */

import type { Capabilities, ImageSource, LoadOptions } from './types'
import { ImagePipe } from './editor'
import { decodeSource } from '../io/load'

/**
 * Load an image from any supported source and get back an immutable
 * {@link ImagePipe} pipeline. Decoding happens eagerly; everything after
 * is lazy until an output method is awaited.
 *
 * EXIF orientation is applied automatically, so phone photos load upright.
 * Note that decoding to pixels drops all other metadata — exports contain
 * no EXIF, GPS position, or camera serial data. That is usually what you
 * want when handling user uploads; there is deliberately no option to
 * carry metadata through.
 *
 * @example
 * ```ts
 * const image = await imagepipe.load(file)
 * const image = await imagepipe.load('https://example.com/photo.jpg')
 * const image = await imagepipe.load(imageData)
 * ```
 */
async function load(source: ImageSource, options?: LoadOptions): Promise<ImagePipe> {
  return ImagePipe._create(await decodeSource(source, options))
}

/**
 * Detect what the current environment supports. imagepipe consults the same
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
 * The imagepipe entry point.
 *
 * @example
 * ```ts
 * import { imagepipe } from 'imagepipe'
 *
 * const image = await imagepipe.load(file)
 * const blob = await image.resize({ width: 1280 }).toBlob({ format: 'webp' })
 * ```
 */
export const imagepipe = { load, capabilities } as const
