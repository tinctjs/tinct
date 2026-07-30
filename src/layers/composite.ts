/**
 * The composite pass: render each layer's pipeline, then blend the stack
 * onto the canvas.
 *
 * The pass is deliberately dumb — a per-pixel loop per layer — because the
 * expensive half is the layer pipelines, and those are cached. GPU
 * compositing is a later concern.
 *
 * @packageDocumentation
 * @internal
 */

import { abortError } from '../core/executor'
import { createPixelData, type PixelData } from '../core/pixel'
import { blendFn } from '../cpu/blend'
import { parseColor, type Rgba } from '../cpu/color'
import { compositeOver } from '../cpu/composite'
import type { CanvasState, LayerCache } from './document'
import type { TinctLayer } from './layer'

/**
 * @internal
 * A layer's rendered pixels, from the cache when the layer's pipeline has
 * not changed. Keyed on pipeline identity, so placement and blending edits
 * never re-run a pipeline — that is the whole dirty-layer story.
 *
 * `_render` always returns a freshly allocated buffer, so the cached entry
 * is ours; callers must treat it as read-only.
 */
export async function renderLayer(
  layer: TinctLayer,
  cache: LayerCache,
  signal?: AbortSignal,
): Promise<PixelData> {
  const cached = cache.get(layer.source)
  if (cached) return cached
  const pixels = await layer.source._render(signal)
  cache.set(layer.source, pixels)
  return pixels
}

/** @internal Layers that actually contribute pixels, bottom to top. */
function drawable(layers: readonly TinctLayer[]): readonly TinctLayer[] {
  return layers.filter((layer) => layer.visible() && layer.opacity() > 0)
}

/**
 * @internal
 * Flatten a document to a single buffer: background, then every drawable
 * layer composited in stack order. Aborts take effect at layer boundaries.
 */
export async function compositeDocument(
  canvas: CanvasState,
  layers: readonly TinctLayer[],
  cache: LayerCache,
  emit: (pct: number, op: string) => void,
  signal?: AbortSignal,
): Promise<PixelData> {
  if (signal?.aborted) throw abortError(signal)

  const out = createPixelData(canvas.width, canvas.height)
  fill(out, parseColor(canvas.background))

  const stack = drawable(layers)
  for (let i = 0; i < stack.length; i++) {
    if (signal?.aborted) throw abortError(signal)
    const layer = stack[i]!
    const pixels = await renderLayer(layer, cache, signal)
    compositeOver(out, pixels, layer.x, layer.y, layer.opacity(), blendFn(layer.blend()))
    emit((i + 1) / stack.length, 'flatten')
  }
  emit(1, 'flatten')
  return out
}

/**
 * @internal
 * The top-most drawable layer whose rendered pixel under `(x, y)` is not
 * fully transparent, or `null`. Layers whose bounds exclude the point are
 * rejected by arithmetic, so a miss over empty canvas renders nothing.
 */
export async function hitTest(
  layers: readonly TinctLayer[],
  cache: LayerCache,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<TinctLayer | null> {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!
    if (!layer.visible() || layer.opacity() <= 0) continue
    const lx = px - layer.x
    const ly = py - layer.y
    if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) continue
    const pixels = await renderLayer(layer, cache, signal)
    if (lx >= pixels.width || ly >= pixels.height) continue
    if (pixels.data[(ly * pixels.width + lx) * 4 + 3]! > 0) return layer
  }
  return null
}

/** Paint a solid color over a freshly allocated (transparent) buffer. */
function fill(target: PixelData, [r, g, b, a]: Rgba): void {
  if (a === 0) return // already transparent black
  for (let i = 0; i < target.data.length; i += 4) {
    target.data[i] = r
    target.data[i + 1] = g
    target.data[i + 2] = b
    target.data[i + 3] = a
  }
}
