/**
 * Chunked base64 for pixel buffers (btoa/atob choke on long call stacks if
 * fed via String.fromCharCode(...spread)).
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from './pixel'

/** @internal */
export function bytesToBase64(bytes: Uint8ClampedArray | Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** @internal */
export function base64ToBytes(encoded: string): Uint8ClampedArray {
  const binary = atob(encoded)
  const bytes = new Uint8ClampedArray(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * @internal
 * Decode inline serialized pixels, validating that the byte count matches
 * the declared dimensions. Undersized buffers would otherwise mis-render
 * silently (out-of-bounds reads → NaN → clamped to 0) or fail much later
 * with a cryptic DOM error from the ImageData constructor. `label` names
 * the offending entry in the error (e.g. a layer source id).
 */
export function decodePixels(
  width: number,
  height: number,
  data64: string,
  label = 'serialized pixels',
): PixelData {
  const data = base64ToBytes(data64)
  const expected = width * height * 4
  if (data.length !== expected) {
    throw new Error(
      `imagepipe: ${label} has ${String(data.length)} byte(s), expected ${String(expected)} for ` +
        `${String(width)}x${String(height)} RGBA — the history is corrupt or truncated`,
    )
  }
  return { width, height, data }
}
