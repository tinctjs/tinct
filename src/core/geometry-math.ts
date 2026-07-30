/**
 * Pure geometry resolution shared by the editor's dimension queries and the
 * CPU executor. Keeping one implementation guarantees `image.width` always
 * matches what a render produces.
 *
 * @packageDocumentation
 * @internal
 */

import type { CropOptions, Gravity, PixelValue, ResizeOptions } from './types'
import type { PixelData } from './pixel'
import { gravityRegistry } from './gravity'

/** @internal An integer pixel rectangle. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** @internal Resolve a pixel-or-percent value against a reference dimension. */
export function resolvePixelValue(value: PixelValue, reference: number): number {
  return typeof value === 'number' ? value : (parseFloat(value) / 100) * reference
}

/** @internal Parse `'16:9'` or a numeric quotient into a number. */
export function resolveAspect(aspect: `${number}:${number}` | number): number {
  if (typeof aspect === 'number') return aspect
  const [w, h] = aspect.split(':')
  return Number(w) / Number(h)
}

const GRAVITY_X: Partial<Record<Gravity, number>> = {
  center: 0.5,
  north: 0.5,
  south: 0.5,
  east: 1,
  west: 0,
  'north-east': 1,
  'north-west': 0,
  'south-east': 1,
  'south-west': 0,
}

const GRAVITY_Y: Partial<Record<Gravity, number>> = {
  center: 0.5,
  north: 0,
  south: 1,
  east: 0.5,
  west: 0.5,
  'north-east': 0,
  'north-west': 0,
  'south-east': 1,
  'south-west': 1,
}

/**
 * @internal
 * Resolve any `CropOptions` form into an integer rect clamped to the image.
 *
 * `pixels` is provided at render time so content-aware gravities can look at
 * the image; dimension-only queries omit it (gravity never changes the
 * output size, so `image.width`/`.height` stay exact regardless).
 */
export function resolveCrop(
  options: CropOptions,
  width: number,
  height: number,
  pixels?: PixelData,
): Rect {
  let x: number
  let y: number
  let w: number
  let h: number

  if ('aspect' in options) {
    const aspect = resolveAspect(options.aspect)
    if (!Number.isFinite(aspect) || aspect <= 0) {
      throw new Error(`tinct: invalid crop aspect ${JSON.stringify(options.aspect)}`)
    }
    if (width / height > aspect) {
      h = height
      w = height * aspect
    } else {
      w = width
      h = width / aspect
    }
    const gravity = options.gravity ?? 'center'
    const gx = GRAVITY_X[gravity]
    const gy = GRAVITY_Y[gravity]
    if (gx !== undefined && gy !== undefined) {
      x = (width - w) * gx
      y = (height - h) * gy
    } else if (pixels === undefined) {
      // Dimension-only query: placement is irrelevant, size is exact.
      x = (width - w) / 2
      y = (height - h) / 2
    } else {
      const resolver = gravityRegistry.get(gravity)
      if (!resolver) {
        throw new Error(
          `tinct: gravity '${gravity}' is not registered — for 'face', import and call enableFaceGravity() from 'tinctjs/face' so the detector is included in your bundle`,
        )
      }
      const origin = resolver(pixels, Math.round(w), Math.round(h))
      x = origin.x
      y = origin.y
    }
    // The window size is fixed by the aspect ratio: shift out-of-bounds
    // placements back inside rather than letting the shared clamp shrink them.
    x = Math.max(0, Math.min(width - w, x))
    y = Math.max(0, Math.min(height - h, y))
  } else {
    x = resolvePixelValue(options.x, width)
    y = resolvePixelValue(options.y, height)
    w = resolvePixelValue(options.width, width)
    h = resolvePixelValue(options.height, height)
  }

  const rx = Math.max(0, Math.min(width - 1, Math.round(x)))
  const ry = Math.max(0, Math.min(height - 1, Math.round(y)))
  const rw = Math.max(1, Math.min(width - rx, Math.round(w)))
  const rh = Math.max(1, Math.min(height - ry, Math.round(h)))
  return { x: rx, y: ry, width: rw, height: rh }
}

/**
 * @internal
 * Resolved resize plan: scale to `scaled`, then (for `cover`) center-crop to
 * `out`. For `contain`/`fill`/single-dimension resizes, `scaled` equals `out`.
 */
export interface ResizePlan {
  scaled: { width: number; height: number }
  out: { width: number; height: number }
}

/** @internal Resolve `ResizeOptions` into a concrete scale-then-crop plan. */
export function resolveResize(options: ResizeOptions, width: number, height: number): ResizePlan {
  const { width: tw, height: th, fit = 'contain' } = options

  if (tw !== undefined && th !== undefined) {
    if (fit === 'fill') {
      return { scaled: { width: tw, height: th }, out: { width: tw, height: th } }
    }
    if (fit === 'cover') {
      const scale = Math.max(tw / width, th / height)
      return {
        scaled: {
          width: Math.max(tw, Math.round(width * scale)),
          height: Math.max(th, Math.round(height * scale)),
        },
        out: { width: tw, height: th },
      }
    }
    const scale = Math.min(tw / width, th / height)
    const out = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
    return { scaled: out, out }
  }

  if (tw !== undefined) {
    const out = { width: tw, height: Math.max(1, Math.round((height / width) * tw)) }
    return { scaled: out, out }
  }
  if (th !== undefined) {
    const out = { width: Math.max(1, Math.round((width / height) * th)), height: th }
    return { scaled: out, out }
  }
  throw new Error('tinct: resize requires at least one of width or height')
}

/** @internal Bounding box of a rectangle rotated by `angle` degrees. */
export function rotateBounds(
  angle: number,
  width: number,
  height: number,
): { width: number; height: number } {
  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: Math.round(width * cos + height * sin),
    height: Math.round(width * sin + height * cos),
  }
}
