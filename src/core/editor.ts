/**
 * The immutable, chainable editor at the heart of imagepipe.
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
  OverlayOptions,
  RotateOptions,
  SerializedHistory,
  SerializedOp,
  ImagePipeEventMap,
  Unsubscribe,
} from './types'
import { FILTER_DEFINITION, type Filter, type FilterDefinition, type FilterOptions } from './filter'
import {
  compassFactors,
  inscribedBounds,
  resolveCrop,
  resolveResize,
  rotateBounds,
} from './geometry-math'
import { bytesToBase64 } from './base64'
import { execute, type OpNode } from './executor'
import { RenderCache } from './render-cache'
import { renderInWorker, shouldUseWorker } from './worker-client'
import type { DeferredSource, PipelineSource, PixelData } from './pixel'
import { isDeferred } from './pixel'
import { pixelsToBlob, pixelsToCanvas, pixelsToDataURL, pixelsToImageData } from '../io/export'

/** @internal Listener channel shared by an editor and everything derived from it. */
type Listeners = {
  [K in keyof ImagePipeEventMap]: Set<(data: ImagePipeEventMap[K]) => void>
}

/**
 * @internal
 * Memoized pixels per deferred source. Keyed by the descriptor rather than
 * the editor so every image derived from one deferred source resolves it
 * once, mirroring how a decoded source is shared down a chain. A rejected
 * resolve (an abort, typically) is evicted so a later render can retry.
 */
const deferredPixels = new WeakMap<DeferredSource, Promise<PixelData>>()

/**
 * An immutable image-editing pipeline.
 *
 * Every operation returns a **new** `ImagePipe`; the receiver is never
 * mutated, so keeping references to intermediate instances gives consumers
 * undo/redo for free. Nothing is rendered until an output method
 * ({@link toBlob}, {@link toDataURL}, {@link toImageData}, {@link toCanvas})
 * is awaited.
 *
 * Instances are created with {@link imagepipe.load} — the constructor is not part
 * of the public API.
 */
export class ImagePipe {
  readonly #source: PipelineSource
  readonly #ops: readonly OpNode[]
  readonly #listeners: Listeners
  readonly #cache: RenderCache

  /** @internal Use {@link imagepipe.load}. */
  private constructor(
    source: PipelineSource,
    ops: readonly OpNode[],
    listeners: Listeners,
    cache: RenderCache,
  ) {
    this.#source = source
    this.#ops = ops
    this.#listeners = listeners
    this.#cache = cache
  }

  /**
   * @internal Entry point used by `imagepipe.load` and tests.
   *
   * `source` is either decoded pixels or a {@link DeferredSource} whose
   * dimensions are known up front and whose pixels are produced on first
   * render (see `imagepipe/layers`, whose `flatten()` builds one).
   */
  static _create(source: PipelineSource, cache = new RenderCache()): ImagePipe {
    return new ImagePipe(source, [], { progress: new Set() }, cache)
  }

  /**
   * @internal The source behind this pipeline, for serializers that need the
   * original pixels. Deferred sources are returned unresolved.
   */
  get _source(): PipelineSource {
    return this.#source
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
    let source = await this.#pixels(signal)
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

  /**
   * @internal The pipeline's starting pixels. Decoded sources are returned
   * as-is; deferred sources resolve once and are shared from then on.
   */
  async #pixels(signal?: AbortSignal): Promise<PixelData> {
    const source = this.#source
    if (!isDeferred(source)) return source
    let pending = deferredPixels.get(source)
    if (!pending) {
      pending = source.resolve(signal)
      deferredPixels.set(source, pending)
      // An abort must not poison the descriptor for later renders.
      pending.catch(() => deferredPixels.delete(source))
    }
    return pending
  }

  #derive(op: OpNode): ImagePipe {
    return new ImagePipe(this.#source, [...this.#ops, op], this.#listeners, this.#cache)
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
  crop(options: CropOptions): ImagePipe {
    return this.#derive({ op: 'crop', params: options })
  }

  /**
   * Resize the image. A missing dimension is derived from the aspect ratio.
   * Downscaling uses high-quality multi-step resampling (Lanczos by default),
   * never a naive single-pass canvas scale.
   */
  resize(options: ResizeOptions): ImagePipe {
    return this.#derive({ op: 'resize', params: options })
  }

  /**
   * Rotate clockwise by `angle` degrees. Multiples of 90 are lossless; other
   * angles expand the canvas to the rotated bounding box and fill the
   * uncovered corners with `options.background`.
   */
  rotate(angle: number, options?: RotateOptions): ImagePipe {
    return this.#derive({ op: 'rotate', params: { angle, ...options } })
  }

  /** Mirror the image. `'horizontal'` flips left↔right, `'vertical'` top↔bottom. */
  flip(axis: FlipAxis): ImagePipe {
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
  adjust(options: AdjustOptions): ImagePipe {
    return this.#derive({ op: 'adjust', params: options })
  }

  /**
   * Composite another image on top — watermarks, logo stamps, badges.
   *
   * `source` is `ImageData` or any {@link PixelData} (render another
   * pipeline with `toImageData()` to use it as an overlay). Placement uses
   * compass gravities with an optional margin; `opacity` multiplies the
   * overlay's own alpha. The overlay is used at its natural size — resize it
   * beforehand if needed.
   *
   * The overlay pixels are copied and serialized *into* the history
   * (self-contained replay, at the cost of history size — see
   * {@link SerializedOp}).
   *
   * @example
   * ```ts
   * const logo = await imagepipe.load(logoFile)
   * image.overlay(await logo.resize({ width: 160 }).toImageData(), {
   *   gravity: 'south-east',
   *   margin: 16,
   *   opacity: 0.8,
   * })
   * ```
   */
  overlay(source: PixelData, options?: OverlayOptions): ImagePipe {
    const gravity = options?.gravity ?? 'south-east'
    if (!compassFactors(gravity)) {
      throw new Error(
        `imagepipe: overlay gravity must be a compass position — '${gravity}' is only valid for crops`,
      )
    }
    return this.#derive({
      op: 'overlay',
      params: {
        source: {
          width: source.width,
          height: source.height,
          data64: bytesToBase64(source.data),
        },
        gravity,
        ...(options?.margin !== undefined && { margin: options.margin }),
        ...(options?.opacity !== undefined && { opacity: options.opacity }),
      },
    })
  }

  /**
   * Apply a filter — built-in (from `imagepipe/filters`) or custom (from
   * {@link defineFilter}).
   *
   * @example
   * ```ts
   * import { grayscale, blur } from 'imagepipe/filters'
   * image.apply(grayscale()).apply(blur({ radius: 4 }))
   * ```
   */
  apply<T extends FilterOptions>(filter: Filter<T>): ImagePipe {
    return this.#derive({
      op: 'filter',
      params: { name: filter.name, options: filter.options as JsonObject },
      definition: filter[FILTER_DEFINITION] as unknown as FilterDefinition,
    })
  }

  /**
   * The pipeline as JSON-safe data: a versioned envelope with one op per
   * queued operation, in order. Feed it to {@link pipe} (on this or any
   * other image) to replay the edits. The version field lets stored
   * histories survive future format changes — see `docs/architecture.md`.
   */
  history(): SerializedHistory {
    return {
      version: 1,
      ops: this.#ops.map((node) => {
        const { definition, ...op } = node
        void definition
        return op
      }),
    }
  }

  /**
   * Replay a serialized history (from {@link history}) on top of this
   * image. Accepts the versioned envelope or a bare op array (histories
   * saved before the envelope existed). Unknown versions throw — they came
   * from a newer imagepipe.
   *
   * `filter` ops are resolved by name against the filters present in your
   * bundle: importing a filter registers it. Replaying an op whose filter was
   * never imported throws a descriptive error at render time.
   */
  pipe(history: SerializedHistory | readonly SerializedOp[]): ImagePipe {
    let ops: readonly SerializedOp[]
    if (Array.isArray(history)) {
      ops = history as readonly SerializedOp[]
    } else {
      const envelope = history as SerializedHistory
      // Runtime data may carry any version despite the compile-time literal.
      if ((envelope.version as number) !== 1) {
        throw new Error(
          `imagepipe: cannot replay history version ${String(envelope.version)} — it was saved by a newer version of imagepipe`,
        )
      }
      ops = envelope.ops
    }
    return ops.reduce<ImagePipe>((image, op) => image.#derive(op), this)
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
  on<K extends keyof ImagePipeEventMap>(
    event: K,
    listener: (data: ImagePipeEventMap[K]) => void,
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
