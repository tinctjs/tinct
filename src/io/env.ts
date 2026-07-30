/**
 * Environment helpers for the browser I/O layer: canvas creation with
 * OffscreenCanvas preference and graceful, descriptive failures elsewhere.
 *
 * @packageDocumentation
 * @internal
 */

/** @internal Any 2D-capable canvas. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

/** @internal Any 2D context. */
export type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** @internal Create a canvas, preferring OffscreenCanvas where available. */
export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  throw new Error(
    'tinct: no canvas available — tinct renders in browsers (or worker contexts with OffscreenCanvas)',
  )
}

/** @internal Create an on-DOM canvas element (for `toCanvas()`'s public type). */
export function createElementCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('tinct: toCanvas() needs a DOM — use toImageData() or toBlob() in workers')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** @internal Get a 2D context or throw a descriptive error. */
export function get2d(canvas: AnyCanvas): Any2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d')
  if (!ctx) {
    throw new Error('tinct: could not acquire a 2d canvas context')
  }
  return ctx
}
