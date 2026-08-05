/**
 * Batch processing: one recipe over many images.
 *
 * ```ts
 * import { batch } from 'imagepipe/batch'
 *
 * const results = await batch(files)
 *   .map((image) => image.resize({ width: 1600 }))
 *   .toBlobs({ format: 'webp', maxBytes: 300_000 })
 * ```
 *
 * Serialized histories are first-class recipes — `.pipe(history)` applies a
 * stored pipeline to every image, which is what upload flows and preset
 * systems want. Items are processed with bounded concurrency, failures are
 * isolated per item, and progress reports across the whole batch.
 *
 * @packageDocumentation
 */

import { imagepipe } from '../core/imagepipe'
import type { ImagePipe } from '../core/editor'
import type {
  ImageSource,
  SerializedHistory,
  SerializedOp,
  Unsubscribe,
} from '../core/types'

/** A batch transform step: a serialized recipe, or a programmatic builder. */
type BatchStep =
  | SerializedHistory
  | readonly SerializedOp[]
  | ((image: ImagePipe, index: number) => ImagePipe)

/** Options for {@link batch}. */
export interface BatchOptions {
  /**
   * How many images are in flight at once, `1..16`.
   * @defaultValue `min(4, hardwareConcurrency)`
   */
  concurrency?: number
}

/** Progress across the whole batch. */
export interface BatchProgress {
  /** Items finished (successfully or not). */
  completed: number
  /** Total items in the batch. */
  total: number
  /** `completed / total`, `0..1`. */
  pct: number
}

/**
 * One item's outcome. Failures are isolated: a broken file yields an
 * `ok: false` entry while the rest of the batch completes.
 */
export type BatchResult<T> =
  | { ok: true; index: number; value: T }
  | { ok: false; index: number; error: Error }

/**
 * Start a batch over `sources` (anything {@link imagepipe.load} accepts).
 * Returns an immutable builder: each `pipe`/`map` produces a new batch.
 */
export function batch(sources: readonly ImageSource[], options?: BatchOptions): ImageBatch {
  return ImageBatch._create(sources, options)
}

/** An immutable batch pipeline over many images. Created by {@link batch}. */
export class ImageBatch {
  readonly #sources: readonly ImageSource[]
  readonly #steps: readonly BatchStep[]
  readonly #concurrency: number
  readonly #listeners: Set<(progress: BatchProgress) => void>

  private constructor(
    sources: readonly ImageSource[],
    steps: readonly BatchStep[],
    concurrency: number,
    listeners: Set<(progress: BatchProgress) => void>,
  ) {
    this.#sources = sources
    this.#steps = steps
    this.#concurrency = concurrency
    this.#listeners = listeners
  }

  /** @internal Use {@link batch}. */
  static _create(sources: readonly ImageSource[], options?: BatchOptions): ImageBatch {
    const cores =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4
    const concurrency = Math.max(1, Math.min(16, Math.floor(options?.concurrency ?? Math.min(4, cores))))
    return new ImageBatch([...sources], [], concurrency, new Set())
  }

  /**
   * Apply a serialized recipe (a {@link SerializedHistory} or bare op array)
   * to every image — the batch twin of {@link ImagePipe.pipe}.
   */
  pipe(history: SerializedHistory | readonly SerializedOp[]): ImageBatch {
    return this.#derive(history)
  }

  /**
   * Transform every image programmatically. The callback receives the loaded
   * image and its index and returns the edited pipeline.
   */
  map(fn: (image: ImagePipe, index: number) => ImagePipe): ImageBatch {
    return this.#derive(fn)
  }

  /**
   * Listen for batch progress: fires after each item settles (success or
   * failure). Listeners are shared with derived batches.
   *
   * @returns A function that removes the listener.
   */
  on(event: 'progress', listener: (progress: BatchProgress) => void): Unsubscribe {
    void event
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #derive(step: BatchStep): ImageBatch {
    return new ImageBatch(this.#sources, [...this.#steps, step], this.#concurrency, this.#listeners)
  }
}
