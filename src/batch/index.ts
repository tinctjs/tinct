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
import { abortError } from '../core/executor'
import type { ImagePipe } from '../core/editor'
import type {
  ExportOptions,
  ImageSource,
  RenderOptions,
  SerializedHistory,
  SerializedOp,
  Unsubscribe,
} from '../core/types'

/** A batch transform step: a serialized recipe, or a programmatic builder. */
type BatchStep =
  SerializedHistory | readonly SerializedOp[] | ((image: ImagePipe, index: number) => ImagePipe)

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
  { ok: true; index: number; value: T } | { ok: false; index: number; error: Error }

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
    const concurrency = Math.max(
      1,
      Math.min(16, Math.floor(options?.concurrency ?? Math.min(4, cores))),
    )
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

  /**
   * Render and encode every image. Per-item failures land in the results;
   * `options.signal` aborts the whole batch (the promise rejects).
   */
  toBlobs(options?: ExportOptions): Promise<BatchResult<Blob>[]> {
    return this.#run((image) => image.toBlob(options), options?.signal)
  }

  /** Render every image to raw pixels. Same failure/abort semantics as {@link toBlobs}. */
  toImageDatas(options?: RenderOptions): Promise<BatchResult<ImageData>[]> {
    return this.#run((image) => image.toImageData(options), options?.signal)
  }

  /**
   * Process every image with a custom output — for flows that need more
   * than one artifact per item (say, a compressed blob *and* a small
   * `ImageData` for a placeholder hash) without loading the file twice.
   * Same failure/abort semantics as {@link toBlobs}.
   *
   * @example
   * ```ts
   * const results = await batch(files).run(async (image) => ({
   *   blob: await image.resize({ width: 1600 }).toBlob({ format: 'webp' }),
   *   thumb: await image.resize({ width: 96 }).toImageData(),
   * }))
   * ```
   */
  run<T>(
    output: (image: ImagePipe, index: number) => T | Promise<T>,
    options?: RenderOptions,
  ): Promise<BatchResult<T>[]> {
    return this.#run(async (image, index) => await output(image, index), options?.signal)
  }

  /**
   * @internal
   * Concurrency-limited runner. Item failures are isolated into `ok: false`
   * results; an abort is a whole-batch stop and rejects the returned
   * promise. `output` renders/encodes one finished pipeline.
   */
  async #run<T>(
    output: (image: ImagePipe, index: number) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<BatchResult<T>[]> {
    const sources = this.#sources
    const total = sources.length
    const results = new Array<BatchResult<T>>(total)
    let cursor = 0
    let completed = 0

    const emit = (): void => {
      const progress = { completed, total, pct: total === 0 ? 1 : completed / total }
      for (const listener of this.#listeners) listener(progress)
    }

    const lane = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) throw abortError(signal)
        const index = cursor++
        if (index >= total) return
        try {
          let image = await imagepipe.load(sources[index]!)
          for (const step of this.#steps) {
            image = typeof step === 'function' ? step(image, index) : image.pipe(step)
          }
          results[index] = { ok: true, index, value: await output(image, index) }
        } catch (error) {
          // A batch-level abort stops everything; item errors are contained.
          if (signal?.aborted) throw abortError(signal)
          results[index] = {
            ok: false,
            index,
            error: error instanceof Error ? error : new Error(String(error)),
          }
        }
        completed++
        emit()
      }
    }

    const lanes = Math.min(this.#concurrency, Math.max(1, total))
    await Promise.all(Array.from({ length: lanes }, lane))
    return results
  }
}
