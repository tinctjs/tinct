/**
 * Built-in filters. Every filter is individually importable and
 * tree-shakeable — importing `grayscale` ships only the grayscale kernel.
 *
 * ```ts
 * import { grayscale, blur } from 'imagepipe/filters'
 *
 * image.apply(grayscale()).apply(blur({ radius: 4 }))
 * ```
 *
 * @packageDocumentation
 */

export { grayscale, type GrayscaleOptions } from './grayscale'
export { sepia, type SepiaOptions } from './sepia'
export { invert, type InvertOptions } from './invert'
export { blur, type BlurOptions } from './blur'
export { sharpen, type SharpenOptions } from './sharpen'
export { pixelate, type PixelateOptions } from './pixelate'
export { vignette, type VignetteOptions } from './vignette'
export { duotone, type DuotoneOptions } from './duotone'
export { noise, type NoiseOptions } from './noise'
export { posterize, type PosterizeOptions } from './posterize'
export { curves, type CurvesOptions, type CurvePoint } from './curves'
export { median, type MedianOptions } from './median'
