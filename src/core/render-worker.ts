/**
 * The render worker: receives a pixel buffer plus serialized ops, executes
 * them off the main thread (using the GPU via OffscreenCanvas when the
 * worker context supports it), and transfers the result back.
 *
 * Only worker-safe pipelines are sent here — geometry, adjustments, and
 * built-in filters. Custom filters hold live function references that cannot
 * cross the thread boundary, so those pipelines render on the main thread.
 *
 * @packageDocumentation
 * @internal
 */

import { execute } from './executor'
import type { SerializedOp } from './types'
import {
  grayscale,
  sepia,
  invert,
  blur,
  sharpen,
  pixelate,
  vignette,
  duotone,
  noise,
  posterize,
} from '../filters/index'
import { enableFaceGravity } from '../face/index'

// The worker supports every built-in capability, so 'face' crops offload too.
enableFaceGravity()

// Referencing the factories keeps their modules (and registry entries) in
// this chunk even under aggressive tree-shaking.
const BUILTINS = {
  grayscale,
  sepia,
  invert,
  blur,
  sharpen,
  pixelate,
  vignette,
  duotone,
  noise,
  posterize,
}
if (Object.keys(BUILTINS).length === 0) throw new Error('unreachable')

/** @internal Message from the client. */
export interface RenderRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  ops: readonly SerializedOp[]
}

/** @internal Messages back to the client. */
export type RenderResponse =
  | { id: number; type: 'progress'; pct: number; op: string }
  | { id: number; type: 'done'; width: number; height: number; buffer: ArrayBuffer }
  | { id: number; type: 'error'; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null
  postMessage(message: RenderResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = (event) => {
  const { id, width, height, buffer, ops } = event.data
  const source = { width, height, data: new Uint8ClampedArray(buffer) }
  execute(source, ops, (pct, op) => {
    scope.postMessage({ id, type: 'progress', pct, op })
  })
    .then((result) => {
      const out = {
        id,
        type: 'done',
        width: result.width,
        height: result.height,
        buffer: result.data.buffer,
      } as const
      scope.postMessage(out as RenderResponse, [result.data.buffer as ArrayBuffer])
    })
    .catch((error: unknown) => {
      scope.postMessage({
        id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
}
