/**
 * The GPU backend seam. The executor talks to this interface only, so the
 * WebGL2 implementation can be swapped (or faked in tests) without touching
 * pipeline semantics.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import { getWebgl2Backend } from './renderer'

/** @internal One fullscreen fragment pass with its uniform values. */
export interface GpuPass {
  /** GLSL ES 3.00 fragment source (see FilterDefinition.fragment contract). */
  fragment: string
  /**
   * Uniform values: number → `uniform1f`, arrays by length → `uniform{2,3,4}fv`,
   * 9 numbers → `uniformMatrix3fv` (row-major input, transposed on upload).
   */
  uniforms: Record<string, number | readonly number[]>
}

/**
 * @internal
 * A GPU executor: run `passes` over `pixels`, returning the result or `null`
 * on any failure (no context, compile error, texture too large, context
 * loss). `null` tells the executor to fall back to the CPU kernels.
 */
export interface GpuBackend {
  run(pixels: PixelData, passes: readonly GpuPass[]): PixelData | null
}

let override: GpuBackend | null | undefined

/** @internal Test hook: force a backend (or `null` for "no GPU"); `undefined` restores auto. */
export function _setGpuBackend(backend: GpuBackend | null | undefined): void {
  override = backend
}

/** @internal The backend for this environment, or `null` when unavailable. */
export function getGpuBackend(): GpuBackend | null {
  if (override !== undefined) return override
  return getWebgl2Backend()
}
