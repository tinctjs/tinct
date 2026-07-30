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

/** @internal Messages from the client. */
export interface RenderRequest {
  id: number
  type: 'render'
  width: number
  height: number
  buffer: ArrayBuffer
  ops: readonly SerializedOp[]
}

/** @internal Cancels an in-flight render by id. */
export interface CancelRequest {
  id: number
  type: 'cancel'
}

/** @internal Messages back to the client. */
export type RenderResponse =
  | { id: number; type: 'progress'; pct: number; op: string }
  | { id: number; type: 'done'; width: number; height: number; buffer: ArrayBuffer }
  | { id: number; type: 'error'; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderRequest | CancelRequest>) => void) | null
  postMessage(message: RenderResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope
const inFlight = new Map<number, AbortController>()

scope.onmessage = (event) => {
  if (event.data.type === 'cancel') {
    inFlight.get(event.data.id)?.abort()
    return
  }
  const { id, width, height, buffer, ops } = event.data
  const controller = new AbortController()
  inFlight.set(id, controller)
  const source = { width, height, data: new Uint8ClampedArray(buffer) }
  execute(
    source,
    ops,
    (pct, op) => {
      scope.postMessage({ id, type: 'progress', pct, op })
    },
    controller.signal,
  )
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
    .finally(() => {
      inFlight.delete(id)
    })
}
