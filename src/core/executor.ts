/**
 * The executor: walks an op list once, applying kernels in order.
 *
 * Color work (adjustments and filters that ship a fragment shader) runs on
 * the WebGL2 backend when one is available: consecutive GPU-able ops are
 * batched into a single upload → N passes → readback session. Geometry and
 * shaderless filters run their CPU kernels. If the GPU fails at any point
 * (context loss, compile error, oversized texture) the batch is re-run
 * through the same CPU kernels — output semantics never depend on the path.
 *
 * @packageDocumentation
 * @internal
 */

import type { FilterDefinition } from './filter'
import { filterRegistry } from './filter'
import type { PixelData } from './pixel'
import { clonePixelData } from './pixel'
import type { SerializedOp } from './types'
import {
  compassFactors,
  inscribedBounds,
  resolveCrop,
  resolveResize,
  rotateBounds,
} from './geometry-math'
import { decodePixels } from './base64'
import { cropPixels, flipPixels, rotate90, rotateArbitrary } from '../cpu/geometry'
import { compositeOver } from '../cpu/composite'
import { resample } from '../cpu/resample'
import { adjustPixels } from '../cpu/adjust'
import { parseColor } from '../cpu/color'
import { getGpuBackend, type GpuPass } from '../gl/backend'
import { ADJUST_FRAGMENT, adjustUniforms } from '../gl/shaders'

/** @internal Internal op node: a serialized op, with live filter definitions attached. */
export type OpNode = SerializedOp & {
  readonly definition?: FilterDefinition
}

/** @internal Progress callback: overall pct `0..1` plus the running op's name. */
export type ProgressFn = (pct: number, op: string) => void

/** @internal One op's GPU passes paired with its CPU equivalent for fallback. */
export interface QueuedPass {
  passes: GpuPass[]
  cpu: (pixels: PixelData) => PixelData
}

/** @internal Rejection raised when a render is aborted. */
export function abortError(signal: AbortSignal): unknown {
  return (
    (signal.reason as unknown) ??
    (typeof DOMException !== 'undefined'
      ? new DOMException('imagepipe: render aborted', 'AbortError')
      : new Error('imagepipe: render aborted'))
  )
}

/**
 * @internal Notified whenever the pixels for `ops[0..index]` are fully
 * materialized (GPU batches materialize at flush, so some indices skip).
 * Used by the render cache; receivers must copy, not keep, the buffer.
 */
export type MaterializeFn = (index: number, pixels: PixelData) => void

/**
 * @internal Execute `ops` over a copy of `source`; the source is never
 * mutated. Aborts take effect at operation boundaries (a running kernel is
 * never interrupted mid-buffer).
 */
export async function execute(
  source: PixelData,
  ops: readonly OpNode[],
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  onMaterialize?: MaterializeFn,
): Promise<PixelData> {
  // Checked before any work so a pre-aborted signal rejects even when the
  // op list is empty (no edits, or a full render-cache hit) — cancellation
  // must not depend on cache warmth.
  if (signal?.aborted) throw abortError(signal)
  const backend = getGpuBackend()
  let current = clonePixelData(source)
  let queued: QueuedPass[] = []
  let lastQueuedIndex = -1

  const flush = (): void => {
    if (queued.length === 0) return
    const batch = queued
    queued = []
    const gpuResult = backend
      ? backend.run(
          current,
          batch.flatMap((q) => q.passes),
        )
      : null
    if (gpuResult) {
      current = gpuResult
    } else {
      // Graceful fallback: identical output via the CPU kernels.
      for (const q of batch) current = q.cpu(current)
    }
    onMaterialize?.(lastQueuedIndex, current)
  }

  for (let i = 0; i < ops.length; i++) {
    if (signal?.aborted) throw abortError(signal)
    const node = ops[i]!
    onProgress?.(i / ops.length, node.op)
    // Yield so consumers' progress UI can update between heavy ops.
    await yieldToEventLoop()
    if (signal?.aborted) throw abortError(signal)

    const gpuPass = backend ? toGpuPass(node) : null
    if (gpuPass) {
      queued.push(gpuPass)
      lastQueuedIndex = i
      continue
    }
    flush()
    current = runCpuOp(current, node)
    onMaterialize?.(i, current)
  }
  flush()
  onProgress?.(1, 'done')
  return current
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * @internal
 * Ops the GPU can take: adjustments, and filters that ship shaders. Also the
 * seam live sessions use to compile a recipe into passes + CPU twins.
 */
export function toGpuPass(node: OpNode): QueuedPass | null {
  if (node.op === 'adjust') {
    const params = node.params
    return {
      passes: [{ fragment: ADJUST_FRAGMENT, uniforms: adjustUniforms(params) }],
      cpu: (pixels) => {
        adjustPixels(pixels, params)
        return pixels
      },
    }
  }
  if (node.op === 'filter') {
    const definition = resolveDefinition(node)
    const options = { ...definition.defaults, ...node.params.options }
    const cpu = (pixels: PixelData): PixelData => definition.fallback(pixels, options) ?? pixels
    if (definition.passes) {
      return { passes: definition.passes(options), cpu }
    }
    if (definition.fragment) {
      return {
        passes: [
          {
            fragment: definition.fragment,
            uniforms: definition.uniforms ? definition.uniforms(options) : {},
          },
        ],
        cpu,
      }
    }
    return null
  }
  return null
}

function runCpuOp(pixels: PixelData, node: OpNode): PixelData {
  switch (node.op) {
    case 'crop':
      return cropPixels(pixels, resolveCrop(node.params, pixels.width, pixels.height, pixels))
    case 'resize': {
      const plan = resolveResize(node.params, pixels.width, pixels.height)
      const scaled = resample(pixels, plan.scaled.width, plan.scaled.height, node.params.kernel)
      if (plan.out.width === plan.scaled.width && plan.out.height === plan.scaled.height) {
        return scaled
      }
      // cover: center-crop the scaled image down to the requested box
      return cropPixels(scaled, {
        x: Math.floor((plan.scaled.width - plan.out.width) / 2),
        y: Math.floor((plan.scaled.height - plan.out.height) / 2),
        width: plan.out.width,
        height: plan.out.height,
      })
    }
    case 'rotate': {
      const angle = ((node.params.angle % 360) + 360) % 360
      if (angle === 0) return pixels
      if (angle % 90 === 0) return rotate90(pixels, (angle / 90) as 1 | 2 | 3)
      const bounds = rotateBounds(angle, pixels.width, pixels.height)
      const background = parseColor(node.params.background ?? 'transparent')
      const rotated = rotateArbitrary(pixels, angle, bounds.width, bounds.height, background)
      if (!node.params.trim) return rotated
      // Straighten: center-crop to the largest fully-covered rectangle.
      const inner = inscribedBounds(angle, pixels.width, pixels.height)
      return cropPixels(rotated, {
        x: Math.floor((rotated.width - inner.width) / 2),
        y: Math.floor((rotated.height - inner.height) / 2),
        width: inner.width,
        height: inner.height,
      })
    }
    case 'flip':
      return flipPixels(pixels, node.params.axis)
    case 'overlay': {
      const { source, gravity = 'south-east', margin = 0, opacity = 1 } = node.params
      const anchor = compassFactors(gravity)
      if (!anchor) {
        throw new Error(`imagepipe: overlay gravity must be a compass position (got '${gravity}')`)
      }
      const over = decodePixels(source.width, source.height, source.data64, 'overlay source')
      // Margin pushes inward from anchored edges; centered axes ignore it.
      const x =
        Math.round((pixels.width - over.width) * anchor.x) +
        (anchor.x === 0 ? margin : anchor.x === 1 ? -margin : 0)
      const y =
        Math.round((pixels.height - over.height) * anchor.y) +
        (anchor.y === 0 ? margin : anchor.y === 1 ? -margin : 0)
      compositeOver(pixels, over, x, y, Math.max(0, Math.min(1, opacity)))
      return pixels
    }
    case 'adjust':
      adjustPixels(pixels, node.params)
      return pixels
    case 'filter': {
      const definition = resolveDefinition(node)
      const options = { ...definition.defaults, ...node.params.options }
      return definition.fallback(pixels, options) ?? pixels
    }
  }
}

function resolveDefinition(node: OpNode & { op: 'filter' }): FilterDefinition {
  const definition = node.definition ?? filterRegistry.get(node.params.name)
  if (!definition) {
    throw new Error(
      `imagepipe: filter '${node.params.name}' is not registered — import it from 'imagepipe/filters' (or define it with defineFilter) so its code is included in your bundle`,
    )
  }
  return definition
}
