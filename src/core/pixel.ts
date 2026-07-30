/**
 * The pixel buffer type shared by every execution path.
 *
 * @packageDocumentation
 */

/**
 * A raw RGBA pixel buffer: 4 bytes per pixel, rows top-to-bottom.
 *
 * Structurally compatible with the DOM's `ImageData` — every `ImageData` *is*
 * a `PixelData` — but free of DOM coupling so CPU kernels stay pure and
 * portable. Custom filter `fallback` implementations receive one of these
 * (in the browser it is backed by real `ImageData` bytes).
 */
export interface PixelData {
  /** Width in pixels. */
  readonly width: number
  /** Height in pixels. */
  readonly height: number
  /** RGBA bytes, length `width * height * 4`. */
  readonly data: Uint8ClampedArray
}

/** @internal Allocate a zeroed (transparent black) buffer. */
export function createPixelData(width: number, height: number): PixelData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/** @internal Deep-copy a buffer so downstream mutation cannot leak upstream. */
export function clonePixelData(source: PixelData): PixelData {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
  }
}
