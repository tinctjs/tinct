/**
 * The immutable multi-layer document.
 *
 * @packageDocumentation
 */

import type { TinctImage } from '../core/editor'
import type { PixelData } from '../core/pixel'
import type { TinctEventMap, Unsubscribe } from '../core/types'
import { parseColor } from '../cpu/color'
import { TinctLayer } from './layer'
import type { DocumentOptions, LayerBounds, LayerRef, MoveDelta } from './types'

/** @internal Listener channel shared by a document and everything derived from it. */
type Listeners = {
  [K in keyof TinctEventMap]: Set<(data: TinctEventMap[K]) => void>
}

/**
 * @internal
 * Rendered pixels per layer pipeline, shared by reference across every
 * document derived from one `document()` call.
 *
 * Keying on the layer's `TinctImage` identity is what makes dirty-layer
 * rendering exact: moving, re-blending, reordering, or hiding a layer keeps
 * the same pipeline object, so it hits; editing a layer's pipeline produces
 * a new object, so only that layer re-renders. It is weak, so pixels for
 * layers no longer referenced by any document become collectable.
 */
export type LayerCache = WeakMap<TinctImage, PixelData>

/** @internal Fixed canvas properties. */
export interface CanvasState {
  readonly width: number
  readonly height: number
  readonly background: string
}

/**
 * An immutable document: a fixed canvas, a background color, and an ordered
 * stack of {@link TinctLayer}s (index `0` is the bottom).
 *
 * Every mutation returns a **new** document and shares structure with the
 * old one — untouched layers keep their identity — so undo/redo is keeping
 * references, exactly as it is for {@link TinctImage}.
 *
 * Instances are created with {@link document}.
 */
export class TinctDocument {
  readonly #canvas: CanvasState
  readonly #layers: readonly TinctLayer[]
  readonly #listeners: Listeners
  readonly #cache: LayerCache

  private constructor(
    canvas: CanvasState,
    layers: readonly TinctLayer[],
    listeners: Listeners,
    cache: LayerCache,
  ) {
    this.#canvas = canvas
    this.#layers = layers
    this.#listeners = listeners
    this.#cache = cache
  }

  /** @internal Use {@link document}. */
  static _create(canvas: CanvasState, layers: readonly TinctLayer[] = []): TinctDocument {
    return new TinctDocument(canvas, layers, { progress: new Set() }, new WeakMap())
  }

  /** Canvas width in pixels. */
  get width(): number {
    return this.#canvas.width
  }

  /** Canvas height in pixels. */
  get height(): number {
    return this.#canvas.height
  }

  /** The CSS color painted under every layer. */
  get background(): string {
    return this.#canvas.background
  }

  /** The layer stack, bottom to top. */
  get layers(): readonly TinctLayer[] {
    return this.#layers.slice()
  }

  /** Add a layer on top of the stack. */
  add(layer: TinctLayer): TinctDocument {
    return this.#withLayers([...this.#layers, layer])
  }

  /**
   * Insert a layer at a stack position; `0` puts it at the bottom. The index
   * is clamped to the stack, so `insert(Infinity, l)` is the same as `add`.
   */
  insert(index: number, layer: TinctLayer): TinctDocument {
    const next = this.#layers.slice()
    next.splice(clampIndex(index, this.#layers.length), 0, layer)
    return this.#withLayers(next)
  }

  /** Remove a layer, addressed by name or index. */
  remove(ref: LayerRef): TinctDocument {
    const next = this.#layers.slice()
    next.splice(this.#indexOf(ref), 1)
    return this.#withLayers(next)
  }

  /**
   * Replace a layer with the result of `fn`. Returning the layer unchanged
   * returns this same document.
   *
   * @example
   * ```ts
   * doc.update('sticker', (l) => l.opacity(0.5).blend('multiply'))
   * ```
   */
  update(ref: LayerRef, fn: (layer: TinctLayer) => TinctLayer): TinctDocument {
    const index = this.#indexOf(ref)
    const current = this.#layers[index]!
    const updated = fn(current)
    if (updated === current) return this
    const next = this.#layers.slice()
    next[index] = updated
    return this.#withLayers(next)
  }

  /**
   * Translate a layer. Placement only — the layer's pipeline is untouched,
   * so nothing re-renders except the composite pass.
   *
   * @example
   * ```ts
   * const dragged = doc.move('sticker', { dx: 20, dy: -10 })
   * ```
   */
  move(ref: LayerRef, { dx = 0, dy = 0 }: MoveDelta): TinctDocument {
    return this.update(ref, (layer) => layer.at(layer.x + dx, layer.y + dy))
  }

  /**
   * Move a layer to a different stack position. The index is clamped, so
   * `reorder(ref, Infinity)` brings a layer to the front.
   */
  reorder(ref: LayerRef, index: number): TinctDocument {
    const from = this.#indexOf(ref)
    const to = clampIndex(index, this.#layers.length - 1)
    if (from === to) return this
    const next = this.#layers.slice()
    next.splice(to, 0, next.splice(from, 1)[0]!)
    return this.#withLayers(next)
  }

  /**
   * The rectangle a layer occupies on the canvas. Pure arithmetic over the
   * layer's op graph — nothing renders — which is what makes it usable from
   * a drag loop.
   */
  boundsOf(ref: LayerRef): LayerBounds {
    const layer = this.#layers[this.#indexOf(ref)]!
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
  }

  /**
   * Listen for document events. Listeners are shared with every document
   * derived from this one, so attaching once observes all later edits.
   *
   * @returns A function that removes the listener.
   */
  on<K extends keyof TinctEventMap>(
    event: K,
    listener: (data: TinctEventMap[K]) => void,
  ): Unsubscribe {
    this.#listeners[event].add(listener)
    return () => this.#listeners[event].delete(listener)
  }

  #indexOf(ref: LayerRef): number {
    if (typeof ref === 'number') {
      if (!Number.isInteger(ref) || ref < 0 || ref >= this.#layers.length) {
        throw new Error(
          `tinct: layer index ${String(ref)} is out of range — this document has ${String(this.#layers.length)} layer(s)`,
        )
      }
      return ref
    }
    const index = this.#layers.findIndex((layer) => layer.name() === ref)
    if (index === -1) {
      throw new Error(`tinct: no layer named '${ref}' in this document`)
    }
    return index
  }

  #withLayers(layers: readonly TinctLayer[]): TinctDocument {
    return new TinctDocument(this.#canvas, layers, this.#listeners, this.#cache)
  }
}

function clampIndex(index: number, max: number): number {
  if (Number.isNaN(index)) return 0
  return Math.max(0, Math.min(max, Math.trunc(index)))
}

/**
 * Create an empty document.
 *
 * @example
 * ```ts
 * import { document, layer } from 'tinctjs/layers'
 *
 * const doc = document({ width: 1080, height: 1350, background: '#ffffff' })
 *   .add(layer(photo))
 *   .add(layer(sticker).at(650, 80).name('sticker'))
 * ```
 */
export function document(options: DocumentOptions): TinctDocument {
  const width = Math.trunc(options.width)
  const height = Math.trunc(options.height)
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      `tinct: document size must be positive — got ${String(options.width)}×${String(options.height)}`,
    )
  }
  const background = options.background ?? 'transparent'
  parseColor(background) // fail here rather than at flatten time
  return TinctDocument._create({ width, height, background })
}
