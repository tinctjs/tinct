/**
 * Auxiliary textures and linear sampling on GPU passes: the executor hands
 * a filter's declared textures through to the backend, and the CPU twin
 * still owns output semantics when no backend exists.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { defineFilter } from '../src/core/filter'
import { execute, type OpNode } from '../src/core/executor'
import { _setGpuBackend, type GpuPass } from '../src/gl/backend'
import { createPixelData, type PixelData } from '../src/core/pixel'

const STICKER: PixelData = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
}

const stamp = defineFilter<{ opacity?: number }>({
  name: 'test-stamp',
  fragment: '#version 300 es\nvoid main() {}',
  uniforms: ({ opacity }) => ({ u_opacity: opacity ?? 1 }),
  textures: () => [{ name: 'u_sticker', pixels: STICKER, linear: true }],
  linearSource: true,
  fallback: (pixels) => {
    pixels.data[0] = 42
    return pixels
  },
})

const op = (): OpNode => ({
  op: 'filter',
  params: { name: 'test-stamp', options: { opacity: 0.5 } },
})

afterEach(() => {
  _setGpuBackend(undefined)
})

describe('textured gpu passes', () => {
  test('the executor forwards textures and sampling mode to the backend', async () => {
    const seen: GpuPass[][] = []
    _setGpuBackend({
      run(pixels, passes) {
        seen.push([...passes])
        return pixels
      },
    })
    await execute(createPixelData(4, 4), [op()])

    expect(seen).toHaveLength(1)
    const pass = seen[0]![0]!
    expect(pass.uniforms).toEqual({ u_opacity: 0.5 })
    expect(pass.linearSource).toBe(true)
    expect(pass.textures).toHaveLength(1)
    expect(pass.textures![0]!.name).toBe('u_sticker')
    expect(pass.textures![0]!.linear).toBe(true)
    expect(pass.textures![0]!.pixels).toBe(STICKER)
  })

  test('without a backend the CPU twin runs unchanged', async () => {
    _setGpuBackend(null)
    const out = await execute(createPixelData(4, 4), [op()])
    expect(out.data[0]).toBe(42)
  })

  test('a backend failure falls back to the CPU twin', async () => {
    _setGpuBackend({ run: () => null })
    const out = await execute(createPixelData(4, 4), [op()])
    expect(out.data[0]).toBe(42)
  })
})

void stamp
