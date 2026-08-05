/**
 * Live pipelines: run an imagepipe recipe on video, per frame, in real time.
 *
 * ```ts
 * import { live } from 'imagepipe/live'
 * import { duotone } from 'imagepipe/filters'
 *
 * const session = live(video)
 *   .pipe(preset)                      // any serialized history of color ops
 *   .into(canvas)                      // starts rendering
 *
 * session.update(otherPreset)          // hot-swap the recipe mid-stream
 * session.stats.fps                    // → 60 on the GPU path
 * session.stop()
 * ```
 *
 * The same serialized recipe that edits a photo or batches an upload runs
 * here unchanged — one recipe, still or live. Rendering is GPU-first and
 * texture-resident (frame upload → fragment passes → straight to the
 * canvas, no readback); machines without WebGL2 fall back to the CPU
 * kernels at a lower frame rate with identical output.
 *
 * Live recipes are color-only: `adjust` plus any filter that ships a
 * fragment shader. Geometry ops (crop, resize, rotate, flip, overlay) and
 * shaderless filters throw a descriptive error up front.
 *
 * @packageDocumentation
 */

import type { SerializedHistory, SerializedOp } from '../core/types'
import { compileRecipe, type LivePlan } from './plan'
import { createLiveRenderer, type LiveRenderer } from './renderers'

/** What a live session can draw from: a playing video or an animated canvas. */
export type LiveSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas

/** A snapshot of a session's health. See {@link LiveSession.stats}. */
export interface LiveStats {
  /** Rendering path in use: `'gpu'` (texture-resident) or `'cpu'` (fallback). */
  mode: 'gpu' | 'cpu'
  /** Frames rendered in the trailing second. */
  fps: number
  /** Total frames rendered since the session started. */
  frames: number
}

/** @internal Cancels a frame subscription. */
type CancelFrames = () => void

/** @internal Schedules `callback` once per new frame of `source`. */
type FrameScheduler = (source: LiveSource, callback: () => void) => CancelFrames

let schedulerOverride: FrameScheduler | undefined

/** @internal Test hook: drive frames manually instead of rVFC/rAF. */
export function _setFrameScheduler(scheduler: FrameScheduler | undefined): void {
  schedulerOverride = scheduler
}

/**
 * Chain per-frame callbacks: `requestVideoFrameCallback` when the source is
 * a video that supports it (fires exactly once per presented frame),
 * `requestAnimationFrame` otherwise.
 */
function scheduleFrames(source: LiveSource, callback: () => void): CancelFrames {
  if (schedulerOverride) return schedulerOverride(source, callback)
  const video = source as HTMLVideoElement
  if (typeof video.requestVideoFrameCallback === 'function') {
    let handle = 0
    const tick = (): void => {
      callback()
      handle = video.requestVideoFrameCallback(tick)
    }
    handle = video.requestVideoFrameCallback(tick)
    return () => { video.cancelVideoFrameCallback(handle); }
  }
  if (typeof requestAnimationFrame === 'function') {
    let handle = 0
    const tick = (): void => {
      callback()
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(handle); }
  }
  throw new Error('imagepipe: no frame scheduler available in this environment')
}

/** @internal Current frame dimensions of a source (0×0 until video metadata). */
function sourceSize(source: LiveSource): { width: number; height: number } {
  const video = source as HTMLVideoElement
  if (typeof video.videoWidth === 'number') {
    return { width: video.videoWidth, height: video.videoHeight }
  }
  const canvas = source as HTMLCanvasElement
  return { width: canvas.width, height: canvas.height }
}

/**
 * Start a live pipeline over `source`. Returns an immutable builder;
 * nothing renders until {@link LivePipeline.into}.
 */
export function live(source: LiveSource): LivePipeline {
  return LivePipeline._create(source)
}

/** A live recipe builder. Created by {@link live}; start it with {@link into}. */
export class LivePipeline {
  readonly #source: LiveSource
  readonly #plan: LivePlan

  private constructor(source: LiveSource, plan: LivePlan) {
    this.#source = source
    this.#plan = plan
  }

  /** @internal Use {@link live}. */
  static _create(source: LiveSource): LivePipeline {
    return new LivePipeline(source, { passes: [], cpu: [] })
  }

  /**
   * Apply a serialized recipe — the live twin of `ImagePipe.pipe`. Validates
   * immediately: ops a live session cannot run throw here, not per frame.
   */
  pipe(history: SerializedHistory | readonly SerializedOp[]): LivePipeline {
    const next = compileRecipe(history)
    return new LivePipeline(this.#source, {
      passes: [...this.#plan.passes, ...next.passes],
      cpu: [...this.#plan.cpu, ...next.cpu],
    })
  }

  /**
   * Start rendering into `canvas` and return the running session. The canvas
   * is resized to match the source's pixel dimensions (style it with CSS).
   */
  into(canvas: HTMLCanvasElement): LiveSession {
    return LiveSession._start(this.#source, canvas, this.#plan)
  }
}

/**
 * A running live render. Deliberately stateful — this is the one object in
 * imagepipe that behaves like a player, not a value.
 */
export class LiveSession {
  readonly #source: LiveSource
  readonly #canvas: HTMLCanvasElement
  #plan: LivePlan
  #renderer: LiveRenderer
  #cancel: CancelFrames | null = null
  #stopped = false
  #frames = 0
  #recent: number[] = []

  private constructor(
    source: LiveSource,
    canvas: HTMLCanvasElement,
    plan: LivePlan,
    renderer: LiveRenderer,
  ) {
    this.#source = source
    this.#canvas = canvas
    this.#plan = plan
    this.#renderer = renderer
  }

  /** @internal Use {@link LivePipeline.into}. */
  static _start(source: LiveSource, canvas: HTMLCanvasElement, plan: LivePlan): LiveSession {
    const renderer = createLiveRenderer(canvas)
    if (!renderer) {
      throw new Error(
        'imagepipe: cannot start a live session — the canvas has no usable rendering context (WebGL2 or 2d)',
      )
    }
    const session = new LiveSession(source, canvas, plan, renderer)
    session.resume()
    return session
  }

  /** Session health: rendering path, trailing-second fps, total frames. */
  get stats(): LiveStats {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.#recent = this.#recent.filter((t) => now - t < 1000)
    return { mode: this.#renderer.mode, fps: this.#recent.length, frames: this.#frames }
  }

  /**
   * Hot-swap the recipe; takes effect on the next frame (immediately, if
   * running). Invalid recipes throw and leave the current one in place.
   */
  update(history: SerializedHistory | readonly SerializedOp[]): void {
    if (this.#stopped) throw new Error('imagepipe: live session is stopped')
    this.#plan = compileRecipe(history)
    if (this.#cancel) this.#frame()
  }

  /** Pause rendering; the canvas keeps its last frame. */
  pause(): void {
    this.#cancel?.()
    this.#cancel = null
  }

  /** Resume (or start) rendering. */
  resume(): void {
    if (this.#stopped) throw new Error('imagepipe: live session is stopped')
    if (this.#cancel) return
    this.#cancel = scheduleFrames(this.#source, () => { this.#frame(); })
    this.#frame()
  }

  /** Stop for good and release GPU resources. The session cannot restart. */
  stop(): void {
    if (this.#stopped) return
    this.pause()
    this.#stopped = true
    this.#renderer.dispose()
  }

  #frame(): void {
    const { width, height } = sourceSize(this.#source)
    if (width === 0 || height === 0) return // video metadata not loaded yet
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width
      this.#canvas.height = height
    }
    const drawn = this.#renderer.render(
      this.#source,
      width,
      height,
      this.#plan,
    )
    // A failed frame is dropped, not fatal: the renderer handles its own
    // degradation (CPU twins for broken shaders, rebuild on context restore).
    if (!drawn) return
    this.#frames++
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.#recent.push(now)
    if (this.#recent.length > 240) this.#recent = this.#recent.filter((t) => now - t < 1000)
  }
}
