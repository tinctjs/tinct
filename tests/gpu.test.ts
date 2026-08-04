/**
 * GPU integration seams, exercised with injected fake backends (Node has no
 * WebGL2). Covers: batching of consecutive color ops, flushing around CPU
 * ops, use of GPU results, and byte-identical CPU fallback when the backend
 * fails. Real shader output is verified against the CPU path in a browser
 * via the playground (see docs/architecture.md).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { _setGpuBackend, type GpuPass } from '../src/gl/backend'
import { ImagePipe } from '../src/core/editor'
import { grayscale, invert, blur, sepia, median } from '../src/filters/index'
import { gradientH, solid } from './helpers'

afterEach(() => {
  _setGpuBackend(undefined)
})

const chain = (image: ImagePipe): ImagePipe =>
  image
    .adjust({ brightness: 0.2 })
    .apply(grayscale())
    .apply(invert())
    .apply(median()) // no shader → CPU
    .apply(sepia())

describe('gpu batching', () => {
  test('consecutive color ops flush as one batch; CPU ops split batches', async () => {
    const batches: GpuPass[][] = []
    _setGpuBackend({
      run: (pixels, passes) => {
        batches.push([...passes])
        return { ...pixels } // pretend the GPU applied them
      },
    })

    await chain(ImagePipe._create(gradientH(8, 8)))._render()

    // adjust + grayscale + invert batch together; median runs on CPU; sepia
    // flushes alone at the end.
    expect(batches.map((b) => b.length)).toEqual([3, 1])
    expect(batches[0]![0]!.uniforms.u_offset).toBeCloseTo(0.2)
  })

  test('separable blur contributes two directional passes to a batch', async () => {
    const batches: GpuPass[][] = []
    _setGpuBackend({
      run: (pixels, passes) => {
        batches.push([...passes])
        return { ...pixels }
      },
    })

    await ImagePipe._create(gradientH(8, 8))
      .apply(grayscale())
      .apply(blur({ radius: 2 }))
      ._render()

    expect(batches.map((b) => b.length)).toEqual([3]) // grayscale + blur×2
    expect(batches[0]![1]!.uniforms.u_direction).toEqual([1, 0])
    expect(batches[0]![2]!.uniforms.u_direction).toEqual([0, 1])
    expect(batches[0]![1]!.uniforms.u_sigma).toBe(2)
  })

  test('the GPU result is what downstream ops and outputs see', async () => {
    const marker = solid(4, 4, [1, 2, 3, 255])
    _setGpuBackend({ run: () => marker })

    const out = await ImagePipe._create(solid(4, 4, [200, 200, 200, 255]))
      .apply(invert())
      ._render()

    expect(out.data).toEqual(marker.data)
  })

  test('adjust uniforms mirror the documented ranges', async () => {
    let captured: GpuPass | undefined
    _setGpuBackend({
      run: (pixels, passes) => {
        captured = passes[0]
        return { ...pixels }
      },
    })

    await ImagePipe._create(gradientH(4, 4))
      .adjust({ exposure: 0.5, gamma: 2, saturation: -1 })
      ._render()

    expect(captured!.uniforms.u_gain).toBeCloseTo(2) // 2^(2·0.5)
    expect(captured!.uniforms.u_gamma).toBe(2)
    const matrix = captured!.uniforms.u_colorMatrix as readonly number[]
    expect(matrix[0]).toBeCloseTo(0.2126) // saturation -1 → luma rows
  })
})

describe('gpu fallback', () => {
  test('a failing backend produces byte-identical output to the pure CPU path', async () => {
    const make = (): ImagePipe => chain(ImagePipe._create(gradientH(16, 16)))

    _setGpuBackend(null) // no GPU at all
    const cpuOnly = await make()._render()

    _setGpuBackend({ run: () => null }) // GPU present but failing
    const fellBack = await make()._render()

    expect(fellBack.data).toEqual(cpuOnly.data)
    expect(fellBack.width).toBe(cpuOnly.width)
  })

  test('fallback applies batched ops in the original order', async () => {
    _setGpuBackend({ run: () => null })
    const viaFailingGpu = await ImagePipe._create(solid(2, 2, [100, 150, 200, 255]))
      .adjust({ brightness: 0.2 })
      .apply(invert())
      ._render()

    _setGpuBackend(null)
    const viaCpu = await ImagePipe._create(solid(2, 2, [100, 150, 200, 255]))
      .adjust({ brightness: 0.2 })
      .apply(invert())
      ._render()

    expect(viaFailingGpu.data).toEqual(viaCpu.data)
  })

  test('in Node the auto-detected backend is null and rendering still works', async () => {
    // No override: getGpuBackend() probes the real environment.
    const out = await ImagePipe._create(solid(2, 2, [10, 20, 30, 255]))
      .apply(invert())
      ._render()
    expect(out.data[0]).toBe(245)
  })
})
