/**
 * Landmark tracking for live sessions: the seam between face-landmark
 * models and imagepipe's render path.
 *
 * ```ts
 * import { live } from 'imagepipe/live'
 * import { trackFace } from 'imagepipe/track'
 * import { warp, sticker } from 'imagepipe/effects'
 *
 * const session = live(video).into(canvas)
 * const tracking = trackFace(session, myProvider, (face) => ({
 *   version: 1,
 *   ops: face ? recipeFor(face) : [],
 * }))
 * ```
 *
 * imagepipe ships **no landmark model** — deliberately. Detection quality
 * is a model problem; rendering speed is ours. A {@link LandmarkProvider}
 * is any function that reads the current frame and returns named anchor
 * points: wrap MediaPipe Face Landmarker, TensorFlow.js, a platform API,
 * or your own heuristic. The tracker runs the provider at a fixed cadence,
 * smooths the result, asks your callback for a recipe built from it, and
 * hot-swaps that recipe into the session. Recipes therefore always carry
 * concrete coordinates: snapshot them with `history()`, replay them with
 * `pipe()`, and they render the same frame anywhere — the serialization
 * contract survives tracking.
 *
 * @packageDocumentation
 */

import type { LiveSession, LiveSource } from '../live/index'
import type { SerializedHistory, SerializedOp } from '../core/types'

/** A normalized point, `[x, y]` in 0..1 with origin at the frame's top-left. */
export type LandmarkPoint = [number, number]

/**
 * Named face anchors. Providers map their model's output (a 468-point
 * mesh, a 5-point detector, a heuristic) onto these; effects and recipe
 * callbacks consume them without knowing the model.
 */
export interface FaceLandmarks {
  leftEye: LandmarkPoint
  rightEye: LandmarkPoint
  nose?: LandmarkPoint
  mouth?: LandmarkPoint
  /** Face bounding box `[x, y, width, height]`, normalized. */
  box: [number, number, number, number]
}

/**
 * Reads the current frame of `source` and returns face anchors, or `null`
 * when no face is present. May be async (most models are). Errors are
 * reported to `onError` and the tracker keeps going — a provider that
 * fails while a camera warms up should get another chance.
 */
export type LandmarkProvider = (
  source: LiveSource,
) => FaceLandmarks | null | Promise<FaceLandmarks | null>

/** Builds the recipe for the current (smoothed) landmarks — or for none. */
export type TrackedRecipe = (
  face: FaceLandmarks | null,
) => SerializedHistory | readonly SerializedOp[]

export interface TrackOptions {
  /** Detections per second, `1..60`. @defaultValue 15 */
  hz?: number
  /**
   * Exponential smoothing of landmark motion, `0..0.95`. Higher is
   * steadier but laggier; `0` uses raw detections. @defaultValue 0.5
   */
  smoothing?: number
  /** Called when the provider (or recipe) throws; tracking continues. */
  onError?: (error: unknown) => void
}

/** A running tracker. Stop it when the session ends. */
export interface TrackHandle {
  /** The most recent smoothed landmarks, or `null` when no face. */
  readonly latest: FaceLandmarks | null
  stop(): void
}

/** @internal Schedules `tick` every `intervalMs`; returns a canceller. */
type TrackTimer = (tick: () => void, intervalMs: number) => () => void

let timerOverride: TrackTimer | undefined

/** @internal Test hook: drive tracker ticks manually. */
export function _setTrackTimer(timer: TrackTimer | undefined): void {
  timerOverride = timer
}

function startTimer(tick: () => void, intervalMs: number): () => void {
  if (timerOverride) return timerOverride(tick, intervalMs)
  const id = setInterval(tick, intervalMs)
  return () => {
    clearInterval(id)
  }
}

const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

function blendPoint(prev: LandmarkPoint, next: LandmarkPoint, alpha: number): LandmarkPoint {
  return [prev[0] + (next[0] - prev[0]) * alpha, prev[1] + (next[1] - prev[1]) * alpha]
}

/** EMA-blend two landmark sets; optional anchors follow the new detection. */
function blend(prev: FaceLandmarks, next: FaceLandmarks, alpha: number): FaceLandmarks {
  const box: FaceLandmarks['box'] = [
    prev.box[0] + (next.box[0] - prev.box[0]) * alpha,
    prev.box[1] + (next.box[1] - prev.box[1]) * alpha,
    prev.box[2] + (next.box[2] - prev.box[2]) * alpha,
    prev.box[3] + (next.box[3] - prev.box[3]) * alpha,
  ]
  const result: FaceLandmarks = {
    leftEye: blendPoint(prev.leftEye, next.leftEye, alpha),
    rightEye: blendPoint(prev.rightEye, next.rightEye, alpha),
    box,
  }
  if (next.nose) result.nose = prev.nose ? blendPoint(prev.nose, next.nose, alpha) : next.nose
  if (next.mouth) {
    result.mouth = prev.mouth ? blendPoint(prev.mouth, next.mouth, alpha) : next.mouth
  }
  return result
}

/**
 * Face roll in radians, derived from the eye line — feed it to
 * `sticker({ rotate })` (converted to degrees) so stickers tilt with
 * the head.
 */
export function faceRoll(face: FaceLandmarks): number {
  return Math.atan2(face.rightEye[1] - face.leftEye[1], face.rightEye[0] - face.leftEye[0])
}

/**
 * Track a face through `session`: run `provider` at `hz`, smooth the
 * landmarks, rebuild the recipe via `recipe(face)`, and hot-swap it into
 * the session. Detection runs at its own cadence while the GPU renders
 * every frame — a recipe swap is microseconds (shader programs are cached),
 * so tracking cost is the provider's, not the renderer's.
 *
 * Stops itself when the session is stopped.
 */
export function trackFace(
  session: LiveSession,
  provider: LandmarkProvider,
  recipe: TrackedRecipe,
  options: TrackOptions = {},
): TrackHandle {
  const hz = clampNum(options.hz ?? 15, 1, 60)
  const alpha = 1 - clampNum(options.smoothing ?? 0.5, 0, 0.95)
  let smoothed: FaceLandmarks | null = null
  let busy = false
  let stopped = false
  // Behind a function so control-flow analysis doesn't narrow it across
  // the await below — stop() can flip it while a detection is in flight.
  const isStopped = (): boolean => stopped

  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancel()
  }

  const tick = (): void => {
    if (busy || stopped) return
    busy = true
    void (async () => {
      try {
        const raw = await provider(session.source)
        if (isStopped()) return
        smoothed = raw ? (smoothed ? blend(smoothed, raw, alpha) : raw) : null
        session.update(recipe(smoothed))
      } catch (error) {
        // The session ending is a normal way for tracking to end.
        if (error instanceof Error && error.message.includes('live session is stopped')) {
          stop()
          return
        }
        options.onError?.(error)
      } finally {
        busy = false
      }
    })()
  }

  const cancel = startTimer(tick, 1000 / hz)
  tick()

  return {
    get latest() {
      return smoothed
    },
    stop,
  }
}
