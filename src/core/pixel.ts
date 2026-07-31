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

/**
 * @internal
 * A source whose pixels are produced on demand rather than decoded up front.
 *
 * Dimensions are known without rendering — that is the contract — so
 * `image.width` / `.height` stay synchronous arithmetic over the op graph
 * exactly as they are for decoded sources. `resolve` runs at most once per
 * descriptor; the result is memoized and shared by every image derived from
 * it. Core does not care what produces the pixels.
 */
export interface DeferredSource {
  /** Width in pixels, known before resolving. */
  readonly width: number
  /** Height in pixels, known before resolving. */
  readonly height: number
  /** Produce the pixels. Called at most once per descriptor. */
  resolve(signal?: AbortSignal): Promise<PixelData>
}

/** @internal Either shape accepted as a pipeline's source. */
export type PipelineSource = PixelData | DeferredSource

/** @internal Narrow a pipeline source to the deferred shape. */
export function isDeferred(source: PipelineSource): source is DeferredSource {
  return typeof (source as DeferredSource).resolve === 'function'
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
