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
import type { OpNode, ProgressFn } from './executor'
import type { RenderRequest, RenderResponse } from './render-worker'
import { BUILTIN_FILTER_NAMES } from '../filters/names'

/** Offload only when there is enough work to beat the copy + startup cost. */
const MIN_PIXELS = 1 << 18 // 512×512

/** @internal Can (and should) this pipeline render off the main thread? */
export function shouldUseWorker(ops: readonly OpNode[], source: PixelData): boolean {
  if (typeof Worker === 'undefined') return false
  if (ops.length === 0) return false
  if (source.width * source.height < MIN_PIXELS) return false
  // Custom filters carry live functions that cannot cross threads; the
  // worker bundles the built-ins only.
  return ops.every((op) => op.op !== 'filter' || BUILTIN_FILTER_NAMES.includes(op.params.name))
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
): Promise<PixelData> {
  const target = getWorker()
  if (!target) return Promise.reject(new Error('tinct: no worker available'))

  return new Promise<PixelData>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, onProgress })
    // Copy the source so the transfer cannot detach the editor's own buffer.
    const copy = new Uint8ClampedArray(source.data)
    const request: RenderRequest = {
      id,
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
