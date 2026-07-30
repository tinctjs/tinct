/**
 * Main-thread client for the render worker: decides when offloading pays
 * off, manages a lazy singleton worker, and falls back to the caller on any
 * failure (no module-worker support, CSP, bundler without worker-URL
 * handling — the pipeline then renders on the main thread instead).
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from './pixel'
import { abortError, type OpNode, type ProgressFn } from './executor'
import type { RenderRequest, RenderResponse } from './render-worker'
import { gravityRegistry } from './gravity'
import { BUILTIN_FILTER_NAMES } from '../filters/names'

/** Abort reasons can be any value; promise rejections should be Errors. */
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

const COMPASS_GRAVITIES = new Set([
  'center',
  'north',
  'south',
  'east',
  'west',
  'north-east',
  'north-west',
  'south-east',
  'south-west',
])

/** Offload only when there is enough work to beat the copy + startup cost. */
const MIN_PIXELS = 1 << 18 // 512×512

/** @internal Can (and should) this pipeline render off the main thread? */
export function shouldUseWorker(ops: readonly OpNode[], source: PixelData): boolean {
  if (typeof Worker === 'undefined') return false
  if (ops.length === 0) return false
  if (source.width * source.height < MIN_PIXELS) return false
  // Custom filters carry live functions that cannot cross threads; the
  // worker bundles the built-ins only. Content-aware gravities must also be
  // registered locally, so main-thread and worker renders agree on whether
  // the pipeline is valid.
  return ops.every((op) => {
    if (op.op === 'filter') return BUILTIN_FILTER_NAMES.includes(op.params.name)
    if (op.op === 'crop' && 'aspect' in op.params) {
      const gravity = op.params.gravity ?? 'center'
      return COMPASS_GRAVITIES.has(gravity) || gravityRegistry.has(gravity)
    }
    return true
  })
}

interface PendingRender {
  resolve: (pixels: PixelData) => void
  reject: (error: Error) => void
  onProgress?: ProgressFn | undefined
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 0
const pending = new Map<number, PendingRender>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<RenderResponse>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'progress') {
      entry.onProgress?.(message.pct, message.op)
      return
    }
    pending.delete(message.id)
    if (message.type === 'done') {
      entry.resolve({
        width: message.width,
        height: message.height,
        data: new Uint8ClampedArray(message.buffer),
      })
    } else {
      entry.reject(new Error(message.message))
    }
  }
  worker.onerror = () => {
    // Startup or runtime failure: reject everything in flight and stop
    // trying — callers fall back to main-thread rendering.
    workerBroken = true
    for (const entry of pending.values()) entry.reject(new Error('tinct: render worker failed'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** @internal Render in the worker; rejects if offloading is not possible. */
export function renderInWorker(
  source: PixelData,
  ops: readonly OpNode[],
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<PixelData> {
  const target = getWorker()
  if (!target) return Promise.reject(new Error('tinct: no worker available'))
  if (signal?.aborted) return Promise.reject(toError(abortError(signal)))

  return new Promise<PixelData>((resolve, reject) => {
    const id = nextId++
    const onAbort = (): void => {
      // Reject locally and tell the worker to stop wasting cycles; a late
      // 'done' for this id is ignored because the entry is gone.
      pending.delete(id)
      target.postMessage({ id, type: 'cancel' })
      if (signal) reject(toError(abortError(signal)))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      resolve: (pixels) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(pixels)
      },
      reject: (error) => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
      onProgress,
    })
    // Copy the source so the transfer cannot detach the editor's own buffer.
    const copy = new Uint8ClampedArray(source.data)
    const request: RenderRequest = {
      id,
      type: 'render',
      width: source.width,
      height: source.height,
      buffer: copy.buffer,
      // Strip live definitions: ops must be structured-cloneable.
      ops: ops.map((node) => {
        const { definition, ...op } = node
        void definition
        return op
      }),
    }
    target.postMessage(request, [request.buffer])
  })
}
