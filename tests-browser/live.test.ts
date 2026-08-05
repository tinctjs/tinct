/**
 * Live sessions on a real WebGL2 context (headless Chromium).
 *
 * A canvas source stands in for a video: `into()` renders one frame
 * immediately, so a manually-driven scheduler gives deterministic tests.
 * The output canvas is read back and compared against the executor's CPU
 * path running the same serialized recipe — the same parity contract the
 * offscreen GPU backend is held to, now including the final y-flipped
 * pass to the screen (the fixture is asymmetric both ways, so a flipped
 * frame fails loudly).
 *
 * The fixture is fully opaque: translucent pixels would pick up
 * premultiplication drift in the drawImage readback and blur the parity
 * signal.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { imagepipe } from '../src/core/imagepipe'
import { _setGpuBackend } from '../src/gl/backend'
import { _setFrameScheduler, live, type LiveSession } from '../src/live/index'
import type { SerializedOp } from '../src/core/types'
import { blur, duotone, invert, vignette } from '../src/filters/index'

void blur
void duotone
void invert
void vignette

const WIDTH = 64
const HEIGHT = 48

/** Deterministic, opaque, asymmetric in both axes. */
function fixture(): ImageData {
  const image = new ImageData(WIDTH, HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      const inDisc = (x - WIDTH / 3) ** 2 + (y - HEIGHT / 3) ** 2 < (HEIGHT / 4) ** 2
      image.data[i] = inDisc ? 210 : Math.round((x / (WIDTH - 1)) * 255)
      image.data[i + 1] = inDisc ? 120 : Math.round((y / (HEIGHT - 1)) * 255)
      image.data[i + 2] = inDisc ? 60 : 160
      image.data[i + 3] = 255
    }
  }
  return image
}

function sourceCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.getContext('2d')!.putImageData(fixture(), 0, 0)
  return canvas
}

/** Read the live target (a WebGL canvas) back through a 2d canvas. */
function readBack(target: HTMLCanvasElement): ImageData {
  const scratch = document.createElement('canvas')
  scratch.width = target.width
  scratch.height = target.height
  const context = scratch.getContext('2d')!
  context.drawImage(target, 0, 0)
  return context.getImageData(0, 0, target.width, target.height)
}

/** The executor's CPU path on the same recipe — the reference output. */
async function cpuReference(ops: readonly SerializedOp[]): Promise<ImageData> {
  _setGpuBackend(null)
  try {
    const image = await imagepipe.load(fixture())
    return await image.pipe(ops).toImageData()
  } finally {
    _setGpuBackend(undefined)
  }
}

function expectParity(actual: ImageData, reference: ImageData, maxDelta: number): void {
  expect(actual.width).toBe(reference.width)
  expect(actual.height).toBe(reference.height)
  let worst = 0
  for (let i = 0; i < reference.data.length; i++) {
    worst = Math.max(worst, Math.abs(actual.data[i]! - reference.data[i]!))
  }
  expect(worst).toBeLessThanOrEqual(maxDelta)
}

let session: LiveSession | null = null

afterEach(() => {
  session?.stop()
  session = null
  _setFrameScheduler(undefined)
})

/** Start a session with an inert scheduler; `into()` renders frame one. */
function renderOnce(ops: readonly SerializedOp[]): HTMLCanvasElement {
  _setFrameScheduler(() => () => undefined)
  const target = document.createElement('canvas')
  session = live(sourceCanvas()).pipe(ops).into(target)
  return target
}

describe('live rendering on a real GPU', () => {
  test('uses the texture-resident gpu path', () => {
    renderOnce([])
    expect(session!.stats.mode).toBe('gpu')
    expect(session!.stats.frames).toBe(1)
  })

  test('a zero-op recipe blits the source frame verbatim', () => {
    const target = renderOnce([])
    expectParity(readBack(target), fixture(), 0)
  })

  test('color recipe matches the CPU path', async () => {
    const ops: readonly SerializedOp[] = [
      { op: 'adjust', params: { brightness: 0.15, contrast: 0.1 } },
      {
        op: 'filter',
        params: { name: 'duotone', options: { shadows: '#23201c', highlights: '#f07818' } },
      },
      { op: 'filter', params: { name: 'vignette', options: {} } },
    ]
    const target = renderOnce(ops)
    expectParity(readBack(target), await cpuReference(ops), 6)
  })

  test('multi-pass blur matches the CPU path through ping-pong framebuffers', async () => {
    const ops: readonly SerializedOp[] = [
      { op: 'filter', params: { name: 'blur', options: { radius: 3 } } },
    ]
    const target = renderOnce(ops)
    expectParity(readBack(target), await cpuReference(ops), 6)
  })

  test('update() hot-swaps the recipe on the running session', async () => {
    const invertOp: readonly SerializedOp[] = [
      { op: 'filter', params: { name: 'invert', options: {} } },
    ]
    const target = renderOnce([])
    session!.update(invertOp)
    expectParity(readBack(target), await cpuReference(invertOp), 2)
  })
})
