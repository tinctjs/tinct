/**
 * imagepipe/live: recipe validation, session lifecycle, hot-swapping, and
 * stats — driven through injected fake renderers and a manual frame
 * scheduler (no DOM, no WebGL).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { _setFrameScheduler, live, type LiveSource } from '../src/live/index'
import { _setLiveRendererFactory, type LiveRenderer } from '../src/live/renderers'
import { compileRecipe } from '../src/live/plan'
import { grayscale } from '../src/filters/index'
import { blur } from '../src/filters/index'
import { median } from '../src/filters/index'
import type { SerializedHistory, SerializedOp } from '../src/core/types'

void grayscale
void blur
void median

const ADJUST: SerializedOp = { op: 'adjust', params: { brightness: 0.2 } }
const GRAYSCALE: SerializedOp = {
  op: 'filter',
  params: { name: 'grayscale', options: { amount: 1 } },
}

/** A video-shaped source whose dimensions tests can change. */
function fakeVideo(width = 8, height = 6): LiveSource & { videoWidth: number } {
  return { videoWidth: width, videoHeight: height } as unknown as LiveSource & {
    videoWidth: number
  }
}

function fakeCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0 } as HTMLCanvasElement
}

interface FakeRenderer extends LiveRenderer {
  calls: { width: number; height: number; passCount: number }[]
  disposed: boolean
  result: boolean
}

function fakeRenderer(mode: 'gpu' | 'cpu' = 'gpu'): FakeRenderer {
  const renderer: FakeRenderer = {
    mode,
    calls: [],
    disposed: false,
    result: true,
    render(_source, width, height, plan) {
      renderer.calls.push({ width, height, passCount: plan.passes.length })
      return renderer.result
    },
    dispose() {
      renderer.disposed = true
    },
  }
  return renderer
}

/** Manual scheduler: tests call `tick()` to deliver a frame. */
function manualScheduler(): { tick: () => void; cancelled: number } {
  const unsubscribed = (): void => {
    /* ticks after cancel are dropped */
  }
  const control = { tick: unsubscribed, cancelled: 0 }
  _setFrameScheduler((_source, callback) => {
    control.tick = callback
    return () => {
      control.cancelled++
      control.tick = unsubscribed
    }
  })
  return control
}

afterEach(() => {
  _setFrameScheduler(undefined)
  _setLiveRendererFactory(undefined)
})

describe('recipe compilation', () => {
  test('adjust and shader filters compile to passes with cpu twins', () => {
    const plan = compileRecipe([ADJUST, GRAYSCALE])
    expect(plan.passes).toHaveLength(2)
    expect(plan.cpu).toHaveLength(2)
  })

  test('multi-pass filters contribute all their passes', () => {
    const plan = compileRecipe([{ op: 'filter', params: { name: 'blur', options: { radius: 2 } } }])
    expect(plan.passes.length).toBeGreaterThan(1) // separable blur: two 1D passes
  })

  test('geometry ops are rejected with a descriptive error', () => {
    const crop: SerializedOp = { op: 'crop', params: { x: 0, y: 0, width: 4, height: 4 } }
    expect(() => compileRecipe([crop])).toThrow(/color ops only.*'crop' changes geometry/)
  })

  test('shaderless filters are rejected by name', () => {
    const op: SerializedOp = { op: 'filter', params: { name: 'median', options: {} } }
    expect(() => compileRecipe([op])).toThrow(/filter 'median' has no GPU shader/)
  })

  test('unregistered filters throw the registry error', () => {
    const op: SerializedOp = { op: 'filter', params: { name: 'vaporwave', options: {} } }
    expect(() => compileRecipe([op])).toThrow(/vaporwave/)
  })

  test('future history versions are rejected', () => {
    const history = { version: 9, ops: [] } as unknown as SerializedHistory
    expect(() => compileRecipe(history)).toThrow(/version 9/)
  })

  test('accepts the envelope form', () => {
    const history: SerializedHistory = { version: 1, ops: [ADJUST] }
    expect(compileRecipe(history).passes).toHaveLength(1)
  })
})

describe('builder', () => {
  test('pipe validates immediately and returns a new builder', () => {
    const base = live(fakeVideo())
    const derived = base.pipe([ADJUST])
    expect(derived).not.toBe(base)
    expect(() => base.pipe([{ op: 'flip', params: { axis: 'horizontal' } }])).toThrow(
      /color ops only/,
    )
  })

  test('into throws when no renderer is available', () => {
    _setLiveRendererFactory(null)
    manualScheduler()
    expect(() => live(fakeVideo()).into(fakeCanvas())).toThrow(/no usable rendering context/)
  })
})

describe('session lifecycle', () => {
  test('into renders an initial frame and sizes the canvas to the source', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    manualScheduler()
    const canvas = fakeCanvas()

    live(fakeVideo(8, 6)).pipe([ADJUST]).into(canvas)
    expect(renderer.calls).toEqual([{ width: 8, height: 6, passCount: 1 }])
    expect(canvas.width).toBe(8)
    expect(canvas.height).toBe(6)
  })

  test('each scheduler tick renders one frame', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    const frames = manualScheduler()

    const session = live(fakeVideo()).into(fakeCanvas())
    frames.tick()
    frames.tick()
    expect(session.stats.frames).toBe(3) // initial + 2 ticks
  })

  test('frames are skipped while the source has no dimensions yet', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    const frames = manualScheduler()
    const video = fakeVideo(0, 0)

    const session = live(video).into(fakeCanvas())
    frames.tick()
    expect(session.stats.frames).toBe(0)

    video.videoWidth = 4
    ;(video as unknown as { videoHeight: number }).videoHeight = 4
    frames.tick()
    expect(session.stats.frames).toBe(1)
  })

  test('a failed render drops the frame without counting it', () => {
    const renderer = fakeRenderer()
    renderer.result = false
    _setLiveRendererFactory(() => renderer)
    manualScheduler()

    const session = live(fakeVideo()).into(fakeCanvas())
    expect(renderer.calls).toHaveLength(1)
    expect(session.stats.frames).toBe(0)
  })

  test('pause cancels frame scheduling; resume restarts it', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    const frames = manualScheduler()

    const session = live(fakeVideo()).into(fakeCanvas())
    session.pause()
    expect(frames.cancelled).toBe(1)
    frames.tick() // no-op: subscription is gone
    expect(session.stats.frames).toBe(1)

    session.resume()
    frames.tick()
    expect(session.stats.frames).toBe(3) // + resume's immediate frame + tick
  })

  test('update hot-swaps the recipe and re-renders immediately', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    manualScheduler()

    const session = live(fakeVideo()).pipe([ADJUST]).into(fakeCanvas())
    session.update([ADJUST, GRAYSCALE])
    expect(renderer.calls.map((c) => c.passCount)).toEqual([1, 2])
  })

  test('an invalid update throws and keeps the current recipe', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    const frames = manualScheduler()

    const session = live(fakeVideo()).pipe([ADJUST]).into(fakeCanvas())
    expect(() => {
      session.update([{ op: 'crop', params: { x: 0, y: 0, width: 2, height: 2 } }])
    }).toThrow(/color ops only/)
    frames.tick()
    expect(renderer.calls.at(-1)!.passCount).toBe(1)
  })

  test('stop disposes the renderer and refuses further control', () => {
    const renderer = fakeRenderer()
    _setLiveRendererFactory(() => renderer)
    const frames = manualScheduler()

    const session = live(fakeVideo()).into(fakeCanvas())
    session.stop()
    expect(renderer.disposed).toBe(true)
    expect(frames.cancelled).toBe(1)
    expect(() => {
      session.resume()
    }).toThrow(/stopped/)
    expect(() => {
      session.update([ADJUST])
    }).toThrow(/stopped/)
    session.stop() // idempotent
  })

  test('stats reports the renderer mode', () => {
    const renderer = fakeRenderer('cpu')
    _setLiveRendererFactory(() => renderer)
    manualScheduler()
    expect(live(fakeVideo()).into(fakeCanvas()).stats.mode).toBe('cpu')
  })
})
