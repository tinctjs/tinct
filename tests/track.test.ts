/**
 * imagepipe/track: the landmark-tracking loop against a fake session and
 * a manually-driven timer — cadence, smoothing, error tolerance, overlap
 * guarding, and self-stopping when the session ends.
 */
import { afterEach, describe, expect, test } from 'vitest'
import {
  _setTrackTimer,
  faceRoll,
  trackFace,
  type FaceLandmarks,
  type LandmarkProvider,
} from '../src/track/index'
import type { LiveSession, LiveSource } from '../src/live/index'
import type { SerializedOp } from '../src/core/types'

interface FakeSession {
  session: LiveSession
  updates: unknown[]
  stopped: boolean
}

function fakeSession(): FakeSession {
  const state: FakeSession = {
    session: null as unknown as LiveSession,
    updates: [],
    stopped: false,
  }
  state.session = {
    source: { videoWidth: 8, videoHeight: 8 } as unknown as LiveSource,
    update(history: unknown) {
      if (state.stopped) throw new Error('imagepipe: live session is stopped')
      state.updates.push(history)
    },
  } as unknown as LiveSession
  return state
}

function manualTimer(): { tick: () => void; cancelled: number } {
  const noTick = (): void => {
    /* cancelled */
  }
  const control = { tick: noTick, cancelled: 0 }
  _setTrackTimer((tick) => {
    control.tick = tick
    return () => {
      control.cancelled++
      control.tick = noTick
    }
  })
  return control
}

const face = (x: number): FaceLandmarks => ({
  leftEye: [x, 0.4],
  rightEye: [x + 0.2, 0.4],
  box: [x - 0.1, 0.3, 0.4, 0.4],
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  _setTrackTimer(undefined)
})

describe('trackFace', () => {
  test('runs the provider and updates the session with the built recipe', async () => {
    const fake = fakeSession()
    manualTimer()
    const seen: (FaceLandmarks | null)[] = []
    const handle = trackFace(
      fake.session,
      () => face(0.4),
      (f) => {
        seen.push(f)
        return [] as readonly SerializedOp[]
      },
    )
    await flush()
    expect(fake.updates).toHaveLength(1)
    expect(seen[0]?.leftEye).toEqual([0.4, 0.4])
    expect(handle.latest?.leftEye).toEqual([0.4, 0.4])
    handle.stop()
  })

  test('smooths landmark motion between detections', async () => {
    const fake = fakeSession()
    const timer = manualTimer()
    let x = 0.2
    const handle = trackFace(
      fake.session,
      () => face(x),
      () => [],
      { smoothing: 0.5 },
    )
    await flush()
    x = 0.6
    timer.tick()
    await flush()
    // EMA with alpha 0.5: 0.2 → halfway to 0.6.
    expect(handle.latest?.leftEye[0]).toBeCloseTo(0.4, 5)
    handle.stop()
  })

  test('smoothing resets when the face is lost and reacquired', async () => {
    const fake = fakeSession()
    const timer = manualTimer()
    const detections: (FaceLandmarks | null)[] = [face(0.2), null, face(0.8)]
    let call = 0
    const handle = trackFace(
      fake.session,
      () => detections[call++] ?? null,
      () => [],
      {
        smoothing: 0.5,
      },
    )
    await flush()
    timer.tick()
    await flush()
    expect(handle.latest).toBeNull()
    timer.tick()
    await flush()
    // Fresh acquisition: raw coordinates, no blend with the pre-loss face.
    expect(handle.latest?.leftEye[0]).toBe(0.8)
    handle.stop()
  })

  test('provider errors go to onError and tracking continues', async () => {
    const fake = fakeSession()
    const timer = manualTimer()
    const errors: unknown[] = []
    let fail = true
    const provider: LandmarkProvider = () => {
      if (fail) throw new Error('model not warmed up')
      return face(0.5)
    }
    const handle = trackFace(fake.session, provider, () => [], {
      onError: (e) => errors.push(e),
    })
    await flush()
    expect(errors).toHaveLength(1)
    fail = false
    timer.tick()
    await flush()
    expect(fake.updates).toHaveLength(1)
    handle.stop()
  })

  test('a pending async detection is not overlapped', async () => {
    const fake = fakeSession()
    const timer = manualTimer()
    let resolveDetection: ((f: FaceLandmarks | null) => void) | null = null
    let calls = 0
    const provider: LandmarkProvider = () => {
      calls++
      return new Promise((resolve) => {
        resolveDetection = resolve
      })
    }
    const handle = trackFace(fake.session, provider, () => [])
    timer.tick()
    timer.tick()
    expect(calls).toBe(1) // ticks while busy are skipped
    resolveDetection!(face(0.5))
    await flush()
    timer.tick()
    expect(calls).toBe(2)
    handle.stop()
  })

  test('stops itself when the session is stopped', async () => {
    const fake = fakeSession()
    const timer = manualTimer()
    const handle = trackFace(
      fake.session,
      () => face(0.5),
      () => [],
    )
    await flush()
    fake.stopped = true
    timer.tick()
    await flush()
    expect(timer.cancelled).toBe(1)
    // Further ticks are inert.
    timer.tick()
    await flush()
    expect(fake.updates).toHaveLength(1)
    void handle
  })

  test('stop() cancels the timer', () => {
    const fake = fakeSession()
    const timer = manualTimer()
    const handle = trackFace(
      fake.session,
      () => null,
      () => [],
    )
    handle.stop()
    expect(timer.cancelled).toBe(1)
    handle.stop() // idempotent
    expect(timer.cancelled).toBe(1)
  })
})

describe('faceRoll', () => {
  test('level eyes give zero roll; tilted eyes give the tilt angle', () => {
    expect(faceRoll(face(0.4))).toBeCloseTo(0, 5)
    const tilted: FaceLandmarks = {
      leftEye: [0.4, 0.4],
      rightEye: [0.6, 0.6],
      box: [0.3, 0.3, 0.4, 0.4],
    }
    expect(faceRoll(tilted)).toBeCloseTo(Math.PI / 4, 5)
  })
})
