/**
 * imagepipe — zero-dependency, TypeScript-first, in-browser image editing.
 *
 * ```ts
 * import { imagepipe } from 'imagepipe'
 * import { grayscale, blur } from 'imagepipe/filters'
 *
 * const image = await imagepipe.load(file)
 * const blob = await image
 *   .crop({ aspect: '16:9', gravity: 'center' })
 *   .resize({ width: 1280 })
 *   .apply(grayscale())
 *   .toBlob({ format: 'webp', quality: 0.85 })
 * ```
 *
 * @packageDocumentation
 */

export { imagepipe } from './core/imagepipe'
export { ImagePipe } from './core/editor'
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
  OverlayOptions,
  Percent,
  PixelValue,
  ProgressEventData,
  RenderOptions,
  ResizeBaseOptions,
  ResizeFit,
  ResizeKernel,
  ResizeOptions,
  RotateOptions,
  SerializedHistory,
  SerializedOp,
  ImagePipeEventMap,
  Unsubscribe,
} from './core/types'
