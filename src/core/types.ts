/**
 * Public types shared across the Tinct API.
 *
 * @packageDocumentation
 */

/** A JSON-serializable value. All serialized pipeline data is made of these. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject

/** A JSON-serializable object. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** A CSS-style percentage string, e.g. `'50%'`. */
export type Percent = `${number}%`

/** A length in pixels (`number`) or as a percentage of the source dimension (`'50%'`). */
export type PixelValue = number | Percent

/**
 * Anchor position used when a crop region is derived from an aspect ratio.
 * Compass names: `'north'` is the top edge, `'south-east'` the bottom-right corner.
 */
export type Gravity =
  | 'center'
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'north-east'
  | 'north-west'
  | 'south-east'
  | 'south-west'

/** An aspect ratio, as a `'16:9'` style string or a width/height quotient (e.g. `16 / 9`). */
export type AspectRatio = `${number}:${number}` | number

/**
 * Crop to an explicit region. Each value is either pixels or a percentage of
 * the current image size.
 *
 * @example
 * ```ts
 * image.crop({ x: 0, y: 0, width: 320, height: 240 })
 * image.crop({ x: '10%', y: '10%', width: '80%', height: '80%' })
 * ```
 */
export interface CropRegionOptions {
  /** Left edge of the crop region. */
  x: PixelValue
  /** Top edge of the crop region. */
  y: PixelValue
  /** Width of the crop region. */
  width: PixelValue
  /** Height of the crop region. */
  height: PixelValue
}

/**
 * Crop to the largest region with the given aspect ratio, anchored by `gravity`.
 *
 * @example
 * ```ts
 * image.crop({ aspect: '16:9', gravity: 'center' })
 * ```
 */
export interface CropAspectOptions {
  /** Target aspect ratio, e.g. `'16:9'` or `16 / 9`. */
  aspect: AspectRatio
  /**
   * Where to anchor the crop region within the image.
   * @defaultValue `'center'`
   */
  gravity?: Gravity
}

/** Options accepted by {@link TinctImage.crop}. */
export type CropOptions = CropRegionOptions | CropAspectOptions

/** How the image is fitted when both `width` and `height` are given to `resize`. */
export type ResizeFit =
  /** Preserve aspect ratio; the result fits inside the box (may be smaller in one dimension). */
  | 'contain'
  /** Preserve aspect ratio; the result covers the box and is center-cropped to it. */
  | 'cover'
  /** Ignore aspect ratio; stretch to exactly `width` × `height`. */
  | 'fill'

/** Resampling kernel used by `resize`. */
export type ResizeKernel =
  /** Best available for the direction of scaling (default). Lanczos for downscale. */
  | 'auto'
  /** Lanczos-3 windowed sinc. Highest quality, slowest. */
  | 'lanczos'
  /** Triangle (bilinear) filtering. */
  | 'triangle'
  /** Nearest neighbour. Fast and blocky; useful for pixel art. */
  | 'nearest'

/** Options shared by every `resize` call. */
export interface ResizeBaseOptions {
  /**
   * Fit strategy when both dimensions are given.
   * @defaultValue `'contain'`
   */
  fit?: ResizeFit
  /**
   * Resampling kernel.
   * @defaultValue `'auto'`
   */
  kernel?: ResizeKernel
}

/**
 * Options accepted by {@link TinctImage.resize}. At least one of `width` or
 * `height` is required; a missing dimension is derived from the aspect ratio.
 */
export type ResizeOptions = ResizeBaseOptions &
  ({ width: number; height?: number } | { width?: number; height: number })

/** Options accepted by {@link TinctImage.rotate}. */
export interface RotateOptions {
  /**
   * CSS color used for the regions uncovered by a non-90°-multiple rotation
   * (the canvas expands to the rotated bounding box).
   * @defaultValue `'transparent'`
   */
  background?: string
}

/** Axis for {@link TinctImage.flip}. */
export type FlipAxis = 'horizontal' | 'vertical'

/**
 * Color adjustments. All fields are optional; omitted fields are unchanged.
 *
 * Ranges — every adjustment except `hue` and `gamma` is a normalized
 * `-1..1` where `0` is a no-op:
 *
 * - `brightness`: `-1` black … `1` white.
 * - `contrast`: `-1` flat grey … `1` maximum contrast.
 * - `saturation`: `-1` grayscale … `1` double saturation.
 * - `exposure`: photographic stops mapped to `-1..1` (±2 EV).
 * - `hue`: rotation in degrees, `-180..180`. `0` is a no-op.
 * - `gamma`: exponent in `0.1..4`. `1` is a no-op; `< 1` brightens midtones.
 */
export interface AdjustOptions {
  /** `-1..1`, default `0`. */
  brightness?: number
  /** `-1..1`, default `0`. */
  contrast?: number
  /** `-1..1`, default `0`. */
  saturation?: number
  /** `-1..1`, default `0`. ±1 corresponds to ±2 EV. */
  exposure?: number
  /** Hue rotation in degrees, `-180..180`, default `0`. */
  hue?: number
  /** Gamma exponent, `0.1..4`, default `1`. */
  gamma?: number
}

/** Encodable output formats. */
export type ExportFormat = 'png' | 'jpeg' | 'webp'

/** Options accepted by {@link TinctImage.toBlob} and {@link TinctImage.toDataURL}. */
export interface ExportOptions {
  /**
   * Output format.
   * @defaultValue `'png'`
   */
  format?: ExportFormat
  /**
   * Encoder quality for lossy formats (`jpeg`, `webp`), `0..1`.
   * Ignored for `png`.
   * @defaultValue encoder default (typically `0.92`)
   */
  quality?: number
  /**
   * CSS color composited under transparent pixels for formats without an
   * alpha channel (`jpeg`).
   * @defaultValue `'#ffffff'`
   */
  background?: string
}

/** Sources accepted by {@link tinct.load}. */
export type ImageSource =
  File | Blob | string | URL | ImageData | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** Options accepted by {@link tinct.load}. */
export interface LoadOptions {
  /**
   * CORS mode used when `source` is a URL.
   * @defaultValue `'anonymous'`
   */
  crossOrigin?: 'anonymous' | 'use-credentials'
  /** Abort an in-flight URL load. */
  signal?: AbortSignal
}

/** Payload of a `'progress'` event. */
export interface ProgressEventData {
  /** Overall pipeline progress, `0..1`. */
  pct: number
  /** Name of the operation currently executing, e.g. `'resize'`. */
  op?: string
}

/** Map of event names to their payloads. See {@link TinctImage.on}. */
export interface TinctEventMap {
  /** Emitted while a render is executing an expensive pipeline. */
  progress: ProgressEventData
}

/** Removes a listener registered with {@link TinctImage.on}. */
export type Unsubscribe = () => void

/**
 * One serialized pipeline operation. The discriminated `op` field plus
 * JSON-safe `params` make histories stable, diffable, and storable.
 */
export type SerializedOp =
  | { readonly op: 'crop'; readonly params: CropOptions }
  | { readonly op: 'resize'; readonly params: ResizeOptions }
  | { readonly op: 'rotate'; readonly params: { angle: number } & RotateOptions }
  | { readonly op: 'flip'; readonly params: { axis: FlipAxis } }
  | { readonly op: 'adjust'; readonly params: AdjustOptions }
  | { readonly op: 'filter'; readonly params: { name: string; options: JsonObject } }

/**
 * Runtime capabilities detected in the current environment.
 * See {@link tinct.capabilities}.
 */
export interface Capabilities {
  /** WebGL2 is available; filters and adjustments can run on the GPU. */
  webgl2: boolean
  /** `OffscreenCanvas` is available; rendering can happen off the main thread. */
  offscreenCanvas: boolean
  /** Dedicated `Worker`s are available for background execution. */
  workers: boolean
}
