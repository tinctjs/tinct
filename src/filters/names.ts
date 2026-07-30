/**
 * Names of the built-in filters, importable without pulling in any kernels.
 * Used by the worker client to decide whether a pipeline is worker-safe
 * (the render worker bundles all built-ins; custom filters live only on the
 * main thread).
 *
 * @packageDocumentation
 * @internal
 */

/** @internal */
export const BUILTIN_FILTER_NAMES: readonly string[] = [
  'grayscale',
  'sepia',
  'invert',
  'blur',
  'sharpen',
  'pixelate',
  'vignette',
  'duotone',
  'noise',
  'posterize',
  'curves',
]
