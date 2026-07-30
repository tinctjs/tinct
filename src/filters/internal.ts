/** @internal Tiny helpers shared by filter kernels. */

import { LUMA_R, LUMA_G, LUMA_B } from '../cpu/adjust'

/** @internal Rec. 709 luma of an RGB triple. */
export function luma(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b
}

/** @internal Linear interpolation. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}
