/**
 * CPU geometry kernels: crop, flip, 90°-multiple and arbitrary rotation.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import { createPixelData } from '../core/pixel'
import type { Rect } from '../core/geometry-math'
import type { FlipAxis } from '../core/types'
import type { Rgba } from './color'

/** @internal Copy a sub-rectangle (assumed pre-clamped) into a new buffer. */
export function cropPixels(src: PixelData, rect: Rect): PixelData {
  const out = createPixelData(rect.width, rect.height)
  const rowBytes = rect.width * 4
  for (let y = 0; y < rect.height; y++) {
    const srcStart = ((rect.y + y) * src.width + rect.x) * 4
    out.data.set(src.data.subarray(srcStart, srcStart + rowBytes), y * rowBytes)
  }
  return out
}

/** @internal Mirror horizontally or vertically. */
export function flipPixels(src: PixelData, axis: FlipAxis): PixelData {
  const { width, height, data } = src
  const out = createPixelData(width, height)
  if (axis === 'vertical') {
    const rowBytes = width * 4
    for (let y = 0; y < height; y++) {
      out.data.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes)
    }
    return out
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = (y * width + (width - 1 - x)) * 4
      out.data[d] = data[s]!
      out.data[d + 1] = data[s + 1]!
      out.data[d + 2] = data[s + 2]!
      out.data[d + 3] = data[s + 3]!
    }
  }
  return out
}

/** @internal Lossless rotation by 90° clockwise `turns` times (1, 2 or 3). */
export function rotate90(src: PixelData, turns: 1 | 2 | 3): PixelData {
  const { width, height, data } = src
  const swap = turns !== 2
  const out = createPixelData(swap ? height : width, swap ? width : height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      let dx: number
      let dy: number
      if (turns === 1) {
        dx = height - 1 - y
        dy = x
      } else if (turns === 2) {
        dx = width - 1 - x
        dy = height - 1 - y
      } else {
        dx = y
        dy = width - 1 - x
      }
      const d = (dy * out.width + dx) * 4
      out.data[d] = data[s]!
      out.data[d + 1] = data[s + 1]!
      out.data[d + 2] = data[s + 2]!
      out.data[d + 3] = data[s + 3]!
    }
  }
  return out
}

/**
 * @internal
 * Arbitrary-angle clockwise rotation. The output canvas is the rotated
 * bounding box; uncovered corners are filled with `background`. Uses inverse
 * mapping with bilinear sampling; out-of-bounds neighbours blend toward the
 * background color, which anti-aliases the edges.
 */
export function rotateArbitrary(
  src: PixelData,
  angleDeg: number,
  outWidth: number,
  outHeight: number,
  background: Rgba,
): PixelData {
  const { width, height, data } = src
  const out = createPixelData(outWidth, outHeight)
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = width / 2
  const cy = height / 2
  const ox = outWidth / 2
  const oy = outHeight / 2
  const [br, bg, bb, ba] = background

  const sample = (x: number, y: number, c: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return c === 3 ? ba : background[c]!
    return data[(y * width + x) * 4 + c]!
  }

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Inverse rotation: where does this output pixel come from?
      const rx = x + 0.5 - ox
      const ry = y + 0.5 - oy
      const sx = rx * cos + ry * sin + cx - 0.5
      const sy = -rx * sin + ry * cos + cy - 0.5
      const d = (y * outWidth + x) * 4

      if (sx < -1 || sy < -1 || sx > width || sy > height) {
        out.data[d] = br
        out.data[d + 1] = bg
        out.data[d + 2] = bb
        out.data[d + 3] = ba
        continue
      }

      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      for (let c = 0; c < 4; c++) {
        const top = sample(x0, y0, c) * (1 - fx) + sample(x0 + 1, y0, c) * fx
        const bottom = sample(x0, y0 + 1, c) * (1 - fx) + sample(x0 + 1, y0 + 1, c) * fx
        out.data[d + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}
