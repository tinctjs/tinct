/**
 * Tinct — zero-dependency, TypeScript-first, in-browser image editing.
 *
 * ```ts
 * import { tinct } from 'tinctjs'
 * import { grayscale, blur } from 'tinctjs/filters'
 *
 * const image = await tinct.load(file)
 * const blob = await image
 *   .crop({ aspect: '16:9', gravity: 'center' })
 *   .resize({ width: 1280 })
 *   .apply(grayscale())
 *   .toBlob({ format: 'webp', quality: 0.85 })
 * ```
 *
 * @packageDocumentation
 */

export { tinct } from './core/tinct'
export { TinctImage } from './core/editor'
export { defineFilter } from './core/filter'
export type { Filter, FilterDefinition, FilterFactory, FilterOptions } from './core/filter'
export type { PixelData } from './core/pixel'
export type {
  AdjustOptions,
  AspectRatio,
  Capabilities,
  CropAspectOptions,
  CropOptions,
  CropRegionOptions,
  ExportFormat,
  ExportOptions,
  FlipAxis,
  Gravity,
  ImageSource,
  JsonObject,
  JsonValue,
  LoadOptions,
  Percent,
  PixelValue,
  ProgressEventData,
  ResizeBaseOptions,
  ResizeFit,
  ResizeKernel,
  ResizeOptions,
  RotateOptions,
  SerializedOp,
  TinctEventMap,
  Unsubscribe,
} from './core/types'
