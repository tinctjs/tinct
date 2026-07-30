/**
 * The immutable, chainable editor at the heart of Tinct.
 *
 * @packageDocumentation
 */

import type {
  AdjustOptions,
  CropOptions,
  ExportOptions,
  RenderOptions,
  FlipAxis,
  JsonObject,
  ResizeOptions,
  RotateOptions,
  SerializedOp,
  TinctEventMap,
  Unsubscribe,
} from './types'
import { FILTER_DEFINITION, type Filter, type FilterDefinition, type FilterOptions } from './filter'
import { inscribedBounds, resolveCrop, resolveResize, rotateBounds } from './geometry-math'
import { execute, type OpNode } from './executor'
import { RenderCache } from './render-cache'
import { renderInWorker, shouldUseWorker } from './worker-client'
import type { PixelData } from './pixel'
import { pixelsToBlob, pixelsToCanvas, pixelsToDataURL, pixelsToImageData } from '../io/export'

/** @internal Listener channel shared by an editor and everything derived from it. */
type Listeners = {
  [K in keyof TinctEventMap]: Set<(data: TinctEventMap[K]) => void>
}

/**
 * An immutable image-editing pipeline.
 *
 * Every operation returns a **new** `TinctImage`; the receiver is never
 * mutated, so keeping references to intermediate instances gives consumers
 * undo/redo for free. Nothing is rendered until an output method
 * ({@link toBlob}, {@link toDataURL}, {@link toImageData}, {@link toCanvas})
 * is awaited.
 *
 * Instances are created with {@link tinct.load} — the constructor is not part
 * of the public API.
 */
export class TinctImage {
  readonly #source: PixelData
  readonly #ops: readonly OpNode[]
  readonly #listeners: Listeners
  readonly #cache: RenderCache

  /** @internal Use {@link tinct.load}. */
  private constructor(
    source: PixelData,
    ops: readonly OpNode[],
    listeners: Listeners,
    cache: RenderCache,
  ) {
    this.#source = source
    this.#ops = ops
    this.#listeners = listeners
    this.#cache = cache
  }

  /** @internal Entry point used by `tinct.load` and tests. */
  static _create(source: PixelData, cache = new RenderCache()): TinctImage {
    return new TinctImage(source, [], { progress: new Set() }, cache)
  }

  /**
   * @internal
   * Render the pipeline to raw pixels, emitting progress along the way.
   *
   * Renders are incremental: intermediate pixels are cached at op
   * boundaries (bounded LRU shared by everything derived from one load), so
   * re-rendering a chain whose prefix was rendered before only runs the
   * changed suffix — the interactive-slider case costs one op, not the
   * whole pipeline. Heavy, worker-safe suffixes render off the main thread;
   * anything else (or any worker failure) renders locally. Public output
   * methods and tests build on this.
   */
  async _render(signal?: AbortSignal): Promise<PixelData> {
    // Start from the longest already-rendered prefix.
    const keys = RenderCache.prefixKeys(this.#ops)
    let start = 0
    let source = this.#source
    for (let i = this.#ops.length - 1; i >= 0; i--) {
      const hit = this.#cache.get(keys[i]!)
      if (hit) {
        start = i + 1
        source = hit
        break
      }
    }
    const ops = this.#ops.slice(start)

    // Progress reflects the full pipeline: cached ops count as done.
    const total = Math.max(1, this.#ops.length)
    const emit = (pct: number, op: string): void => {
      const overall = (start + pct * ops.length) / total
      for (const listener of this.#listeners.progress) listener({ pct: overall, op })
    }

    if (shouldUseWorker(ops, source)) {
      try {
        const result = await renderInWorker(source, ops, emit, signal)
        if (this.#ops.length > 0) this.#cache.set(keys[this.#ops.length - 1]!, result)
        return result
      } catch (error) {
        // An abort is a deliberate stop — never fall back to a local render.
        if (signal?.aborted) throw error
        // Any other worker failure: render on the main thread instead.
      }
    }
    return execute(source, ops, emit, signal, (index, pixels) => {
      this.#cache.set(keys[start + index]!, pixels)
    })
  }

  #derive(op: OpNode): TinctImage {
    return new TinctImage(this.#source, [...this.#ops, op], this.#listeners, this.#cache)
  }

  /**
   * Output width in pixels after all queued operations are applied.
   * Computed eagerly from the op graph; no rendering happens.
   */
  get width(): number {
    return this.#size().width
  }

  /**
   * Output height in pixels after all queued operations are applied.
   * Computed eagerly from the op graph; no rendering happens.
   */
  get height(): number {
    return this.#size().height
  }

  /**
   * Crop the image. Accepts an explicit region in pixels or percentages, or
   * an aspect ratio with an optional gravity anchor.
   *
   * @example
   * ```ts
   * image.crop({ aspect: '16:9', gravity: 'center' })
   * image.crop({ x: '10%', y: '10%', width: '80%', height: '80%' })
   * ```
   */
  crop(options: CropOptions): TinctImage {
    return this.#derive({ op: 'crop', params: options })
  }

  /**
   * Resize the image. A missing dimension is derived from the aspect ratio.
   * Downscaling uses high-quality multi-step resampling (Lanczos by default),
   * never a naive single-pass canvas scale.
   */
  resize(options: ResizeOptions): TinctImage {
    return this.#derive({ op: 'resize', params: options })
  }

  /**
   * Rotate clockwise by `angle` degrees. Multiples of 90 are lossless; other
   * angles expand the canvas to the rotated bounding box and fill the
   * uncovered corners with `options.background`.
   */
  rotate(angle: number, options?: RotateOptions): TinctImage {
    return this.#derive({ op: 'rotate', params: { angle, ...options } })
  }

  /** Mirror the image. `'horizontal'` flips left↔right, `'vertical'` top↔bottom. */
  flip(axis: FlipAxis): TinctImage {
    return this.#derive({ op: 'flip', params: { axis } })
  }

  /**
   * Apply color adjustments. All values are normalized; see
   * {@link AdjustOptions} for ranges.
   *
   * @example
   * ```ts
   * image.adjust({ brightness: 0.1, contrast: 0.05, saturation: -0.2 })
   * ```
   */
  adjust(options: AdjustOptions): TinctImage {
    return this.#derive({ op: 'adjust', params: options })
  }

  /**
   * Apply a filter — built-in (from `tinctjs/filters`) or custom (from
   * {@link defineFilter}).
   *
   * @example
   * ```ts
   * import { grayscale, blur } from 'tinctjs/filters'
   * image.apply(grayscale()).apply(blur({ radius: 4 }))
   * ```
   */
  apply<T extends FilterOptions>(filter: Filter<T>): TinctImage {
    return this.#derive({
      op: 'filter',
      params: { name: filter.name, options: filter.options as JsonObject },
      definition: filter[FILTER_DEFINITION] as unknown as FilterDefinition,
    })
  }

  /**
   * The pipeline as JSON-safe data: one entry per queued operation, in order.
   * Feed it to {@link pipe} (on this or any other image) to replay the edits.
   * Stable across versions — see `docs/architecture.md` for the format.
   */
  history(): readonly SerializedOp[] {
    return this.#ops.map((node) => {
      const { definition, ...op } = node
      void definition
      return op
    })
  }

  /**
   * Replay serialized operations (from {@link history}) on top of this image.
   *
   * `filter` ops are resolved by name against the filters present in your
   * bundle: importing a filter registers it. Replaying an op whose filter was
   * never imported throws a descriptive error at render time.
   */
  pipe(ops: readonly SerializedOp[]): TinctImage {
    return ops.reduce<TinctImage>((image, op) => image.#derive(op), this)
  }

  /**
   * Listen for pipeline events. Listeners are shared with every image derived
   * from this one, so attaching to the loaded image observes all later chains.
   *
   * @returns A function that removes the listener.
   * @example
   * ```ts
   * image.on('progress', ({ pct }) => console.log(`${Math.round(pct * 100)}%`))
   * ```
   */
  on<K extends keyof TinctEventMap>(
    event: K,
    listener: (data: TinctEventMap[K]) => void,
  ): Unsubscribe {
    this.#listeners[event].add(listener)
    return () => this.#listeners[event].delete(listener)
  }

  /** Render the pipeline and encode the result as a `Blob`. */
  async toBlob(options?: ExportOptions): Promise<Blob> {
    return pixelsToBlob(await this._render(options?.signal), options)
  }

  /** Render the pipeline and encode the result as a data URL string. */
  async toDataURL(options?: ExportOptions): Promise<string> {
    return pixelsToDataURL(await this._render(options?.signal), options)
  }

  /** Render the pipeline and return raw pixels. */
  async toImageData(options?: RenderOptions): Promise<ImageData> {
    return pixelsToImageData(await this._render(options?.signal))
  }

  /** Render the pipeline into a fresh canvas element. */
  async toCanvas(options?: RenderOptions): Promise<HTMLCanvasElement> {
    return pixelsToCanvas(await this._render(options?.signal))
  }

  /** @internal Output size derived from the op graph without rendering. */
  #size(): { width: number; height: number } {
    let w = this.#source.width
    let h = this.#source.height
    for (const node of this.#ops) {
      ;[w, h] = opSize(node, w, h)
    }
    return { width: w, height: h }
  }
}

/** @internal Dimension propagation for a single op. */
function opSize(node: OpNode, w: number, h: number): [number, number] {
  switch (node.op) {
    case 'crop': {
      const rect = resolveCrop(node.params, w, h)
      return [rect.width, rect.height]
    }
    case 'resize': {
      const { out } = resolveResize(node.params, w, h)
      return [out.width, out.height]
    }
    case 'rotate': {
      const angle = ((node.params.angle % 360) + 360) % 360
      const bounds =
        node.params.trim && angle % 90 !== 0
          ? inscribedBounds(angle, w, h)
          : rotateBounds(angle, w, h)
      return [bounds.width, bounds.height]
    }
    default:
      return [w, h]
  }
}
