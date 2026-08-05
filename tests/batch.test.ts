/**
 * imagepipe/batch: recipes over many images, per-item error isolation,
 * aggregate progress, concurrency bounds, and whole-batch abort.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { batch } from '../src/batch/index'
import { grayscale } from '../src/filters/index'
import type { ImageSource, SerializedHistory } from '../src/core/types'
import { gradientH } from './helpers'

/** Minimal ImageData stand-in so `imagepipe.load` accepts our fixtures. */
class ImageDataShim {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

const source = (w = 8, h = 8): ImageSource =>
  new ImageDataShim(gradientH(w, h).data, w, h) as unknown as ImageData

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubImageData(): void {
  vi.stubGlobal('ImageData', ImageDataShim)
}

describe('batch pipelines', () => {
  test('applies a map step to every image', async () => {
    stubImageData()
    const results = await batch([source(), source(16, 8), source(4, 4)])
      .map((image) => image.resize({ width: 4 }))
      .toImageDatas()

    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.width).toBe(4)
    }
  })

  test('applies a serialized recipe to every image, like ImagePipe.pipe', async () => {
    stubImageData()
    const recipe: SerializedHistory = {
      version: 1,
      ops: [
        { op: 'flip', params: { axis: 'horizontal' } },
        { op: 'filter', params: { name: 'grayscale', options: { amount: 1 } } },
      ],
    }
    void grayscale // imported so the recipe's filter is registered

    const results = await batch([source(6, 2)])
      .pipe(recipe)
      .toImageDatas()
    expect(results[0]!.ok).toBe(true)
    if (results[0]!.ok) {
      const { data, width } = results[0]!.value
      expect(data[0]).toBe(data[1]) // grayscale: r === g
      // Flipped: the bright edge (red 255 → luma ~54) is now the first
      // pixel, the dark edge (luma 0) the last.
      expect(data[0]).toBeGreaterThan(data[(width - 1) * 4]!)
      expect(Math.abs(data[0]! - 54)).toBeLessThanOrEqual(1)
    }
  })

  test('steps run in order and receive the item index', async () => {
    stubImageData()
    const seen: number[] = []
    const results = await batch([source(), source()])
      .map((image, index) => {
        seen.push(index)
        return image.crop({ x: 0, y: 0, width: 2 + index, height: 2 })
      })
      .toImageDatas()

    expect(seen.sort()).toEqual([0, 1])
    expect(results.map((r) => (r.ok ? r.value.width : -1))).toEqual([2, 3])
  })

  test('the builder is immutable: deriving does not mutate the base batch', async () => {
    stubImageData()
    const base = batch([source()])
    const derived = base.map((image) => image.resize({ width: 2 }))
    expect(derived).not.toBe(base)

    const baseResults = await base.toImageDatas()
    if (baseResults[0]!.ok) expect(baseResults[0]!.value.width).toBe(8)
  })
})

describe('failure isolation', () => {
  test('a broken source fails its item, not the batch', async () => {
    stubImageData()
    const results = await batch([source(), 42 as unknown as ImageSource, source()]).toImageDatas()

    expect(results.map((r) => r.ok)).toEqual([true, false, true])
    const failed = results[1]!
    if (!failed.ok) expect(failed.error.message).toMatch(/unsupported image source/)
  })

  test('a throwing map step fails only its item', async () => {
    stubImageData()
    const results = await batch([source(), source()])
      .map((image, index) => {
        if (index === 1) throw new Error('bad item')
        return image
      })
      .toImageDatas()
    expect(results.map((r) => r.ok)).toEqual([true, false])
  })
})

describe('progress and abort', () => {
  test('progress fires once per settled item and reaches 1', async () => {
    stubImageData()
    const seen: number[] = []
    const jobs = batch([source(), 7 as unknown as ImageSource, source()], { concurrency: 1 })
    jobs.on('progress', ({ pct, completed, total }) => {
      expect(total).toBe(3)
      seen.push(pct)
      void completed
    })
    await jobs.toImageDatas()
    expect(seen).toEqual([1 / 3, 2 / 3, 1])
  })

  test('a pre-aborted signal rejects the whole batch', async () => {
    stubImageData()
    const controller = new AbortController()
    controller.abort()
    await expect(
      batch([source()]).toImageDatas({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('aborting mid-batch stops remaining items', async () => {
    stubImageData()
    const controller = new AbortController()
    let started = 0
    const jobs = batch([source(), source(), source(), source()], { concurrency: 1 }).map(
      (image) => {
        started++
        if (started === 2) controller.abort()
        return image
      },
    )
    await expect(jobs.toImageDatas({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(started).toBeLessThanOrEqual(2)
  })
})

describe('concurrency bounds', () => {
  test('clamps to at least 1 and processes everything', async () => {
    stubImageData()
    const results = await batch([source(), source()], { concurrency: 0 }).toImageDatas()
    expect(results.every((r) => r.ok)).toBe(true)
  })

  test('an empty batch resolves to an empty result set', async () => {
    stubImageData()
    await expect(batch([]).toImageDatas()).resolves.toEqual([])
  })
})
