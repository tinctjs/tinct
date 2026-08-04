/**
 * Placeholder hashes: encode any image to a ~25-byte ThumbHash for instant
 * blurred previews while the real image loads.
 *
 * ```ts
 * import { thumbHash, thumbHashBase64 } from 'imagepipe/hash'
 *
 * const pixels = await image.toImageData()
 * const hash = thumbHashBase64(pixels) // store next to the image URL
 * ```
 *
 * Decode at display time with any ThumbHash decoder (e.g. the reference
 * `thumbhash` package's `thumbHashToDataURL`) — the format is the
 * interoperable one published at https://evanw.github.io/thumbhash/, and
 * imagepipe's encoder is verified byte-for-byte against the reference
 * implementation. Deterministic: identical pixels produce identical hashes
 * everywhere.
 *
 * @packageDocumentation
 */

import type { PixelData } from '../core/pixel'
import { resample } from '../cpu/resample'
import { encodeThumbHash } from './thumbhash'

/**
 * Encode pixels to a ThumbHash. Inputs larger than 100×100 are downscaled
 * internally first (hash detail is capped by the format, so nothing is
 * lost). Accepts `ImageData` or any {@link PixelData}.
 */
export function thumbHash(pixels: PixelData): Uint8Array {
  const scale = 100 / Math.max(pixels.width, pixels.height)
  const source =
    scale >= 1
      ? pixels
      : resample(
          pixels,
          Math.max(1, Math.round(pixels.width * scale)),
          Math.max(1, Math.round(pixels.height * scale)),
          'triangle',
        )
  return encodeThumbHash(source)
}

/** {@link thumbHash}, base64-encoded for easy storage in JSON or databases. */
export function thumbHashBase64(pixels: PixelData): string {
  let binary = ''
  for (const byte of thumbHash(pixels)) binary += String.fromCharCode(byte)
  return btoa(binary)
}
