/**
 * A single layer: a Tinct pipeline plus where and how it lands on the canvas.
 *
 * @packageDocumentation
 */

import type { TinctImage } from '../core/editor'
import { blendFn, type BlendMode } from '../cpu/blend'
import type { LayerPlacement } from './types'

/** @internal Everything about a layer except its content. */
interface LayerState {
  readonly x: number
  readonly y: number
  readonly opacity: number
  readonly blend: BlendMode
  readonly visible: boolean
  readonly name?: string
}

const DEFAULTS: LayerState = { x: 0, y: 0, opacity: 1, blend: 'source-over', visible: true }

/**
 * An immutable layer.
 *
 * Content is a whole {@link TinctImage} pipeline, so every filter,
 * adjustment, and geometry operation works per layer — resize the source to
 * scale a layer, rotate it to rotate a layer. Placement itself is a
 * translation in whole pixels; fractional coordinates are rounded.
 *
 * Accessors are overloaded: calling one with no argument reads, calling it
 * with a value returns a **new** layer. The receiver is never mutated, so a
 * UI gets undo for free by keeping references.
 *
 * Instances are created with {@link layer}.
 *
 * @example
 * ```ts
 * const badge = layer(logo.resize({ width: 240 }))
 *   .at(32, 32)
 *   .opacity(0.8)
 *   .blend('screen')
 *   .name('badge')
 *
 * badge.opacity() // 0.8 — reading, not setting
 * ```
 */
export class TinctLayer {
  readonly #source: TinctImage
  readonly #state: LayerState

  private constructor(source: TinctImage, state: LayerState) {
    this.#source = source
    this.#state = state
  }

  /** @internal Use {@link layer}. */
  static _create(source: TinctImage, state: LayerState = DEFAULTS): TinctLayer {
    return new TinctLayer(source, state)
  }

  /** The pipeline that produces this layer's pixels. */
  get source(): TinctImage {
    return this.#source
  }

  /** Distance from the canvas's left edge to this layer's left edge. */
  get x(): number {
    return this.#state.x
  }

  /** Distance from the canvas's top edge to this layer's top edge. */
  get y(): number {
    return this.#state.y
  }

  /** Rendered width of the layer's pipeline. Arithmetic only — nothing renders. */
  get width(): number {
    return this.#source.width
  }

  /** Rendered height of the layer's pipeline. Arithmetic only — nothing renders. */
  get height(): number {
    return this.#source.height
  }

  /** Read the layer's placement. */
  at(): LayerPlacement
  /** Place the layer's top-left corner at `(x, y)`, rounded to whole pixels. */
  at(x: number, y: number): TinctLayer
  at(x?: number, y?: number): LayerPlacement | TinctLayer {
    if (x === undefined || y === undefined) return { x: this.#state.x, y: this.#state.y }
    return this.#with({ x: Math.round(x), y: Math.round(y) })
  }

  /** Read the layer's opacity. */
  opacity(): number
  /** Set the opacity multiplier applied over the layer's own alpha, clamped to `0..1`. */
  opacity(value: number): TinctLayer
  opacity(value?: number): number | TinctLayer {
    if (value === undefined) return this.#state.opacity
    return this.#with({ opacity: Math.max(0, Math.min(1, value)) })
  }

  /** Read the layer's blend mode. */
  blend(): BlendMode
  /** Set the blend mode. Unknown modes throw immediately. */
  blend(mode: BlendMode): TinctLayer
  blend(mode?: BlendMode): BlendMode | TinctLayer {
    if (mode === undefined) return this.#state.blend
    blendFn(mode) // validate up front rather than at render time
    return this.#with({ blend: mode })
  }

  /** Read whether the layer is drawn. */
  visible(): boolean
  /** Show or hide the layer. Hidden layers are skipped entirely when flattening. */
  visible(value: boolean): TinctLayer
  visible(value?: boolean): boolean | TinctLayer {
    if (value === undefined) return this.#state.visible
    return this.#with({ visible: value })
  }

  /** Read the layer's name, if it has one. */
  name(): string | undefined
  /** Name the layer so document methods can address it by name instead of index. */
  name(value: string): TinctLayer
  name(value?: string): string | undefined | TinctLayer {
    if (value === undefined) return this.#state.name
    return this.#with({ name: value })
  }

  /** @internal Everything about this layer except its content. */
  get _state(): LayerState {
    return this.#state
  }

  #with(changes: Partial<LayerState>): TinctLayer {
    return new TinctLayer(this.#source, { ...this.#state, ...changes })
  }
}

/**
 * Wrap a pipeline as a layer, placed at the canvas origin and fully opaque.
 *
 * @example
 * ```ts
 * import { layer } from 'tinctjs/layers'
 * doc.add(layer(photo).at(0, 0))
 * ```
 */
export function layer(source: TinctImage): TinctLayer {
  return TinctLayer._create(source)
}
