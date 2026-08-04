/**
 * Incremental re-render cache: suffix-only re-runs, correctness vs fresh
 * renders, isolation from output mutation, and LRU bounds.
 */
import { describe, expect, test } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import { RenderCache } from '../src/core/render-cache'
import { defineFilter } from '../src/core/filter'
import type { FilterFactory } from '../src/core/filter'
import { solid, gradientH, expectPixelsClose } from './helpers'

/** A filter whose executions are counted, unique per test via `name`. */
function counted(name: string): { factory: FilterFactory<{ delta?: number }>; runs: () => number } {
  let runs = 0
  const factory = defineFilter<{ delta?: number }>({
    name,
    defaults: { delta: 1 },
    fallback: (pixels, { delta = 1 }) => {
      runs++
      for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i]! + delta
      return undefined
    },
  })
  return { factory, runs: () => runs }
}

describe('incremental re-rendering', () => {
  test('editing the tail re-runs only the suffix', async () => {
    const a = counted('cache-a')
    const b = counted('cache-b')
    const c = counted('cache-c')
    const d = counted('cache-d')

    const base = ImagePipe._create(gradientH(16, 16))
    await base.apply(a.factory()).apply(b.factory()).apply(c.factory())._render()
    expect([a.runs(), b.runs(), c.runs()]).toEqual([1, 1, 1])

    // Same prefix, different tail — the slider-drag case.
    await base.apply(a.factory()).apply(b.factory()).apply(d.factory())._render()
    expect([a.runs(), b.runs()]).toEqual([1, 1]) // prefix came from cache
    expect(d.runs()).toBe(1)
  })

  test('branches from one image share the cached prefix', async () => {
    const a = counted('cache-branch-a')
    const base = ImagePipe._create(gradientH(8, 8)).apply(a.factory())
    await base.flip('horizontal')._render()
    await base.flip('vertical')._render()
    expect(a.runs()).toBe(1)
  })

  test('cached renders are byte-identical to fresh renders', async () => {
    const build = (image: ImagePipe): ImagePipe =>
      image
        .crop({ x: 2, y: 2, width: 12, height: 12 })
        .adjust({ brightness: 0.2 })
        .flip('horizontal')

    const warm = ImagePipe._create(gradientH(16, 16))
    await build(warm)._render() // populate cache
    const cached = await build(warm)._render() // full-chain hit

    const fresh = await build(ImagePipe._create(gradientH(16, 16)))._render()
    expectPixelsClose(cached, fresh, 0)
  })

  test('mutating a returned render cannot poison the cache', async () => {
    const image = ImagePipe._create(solid(8, 8, [100, 100, 100, 255])).adjust({ brightness: 0.1 })
    const first = await image._render()
    first.data.fill(0)
    const second = await image._render()
    expect(second.data[0]).not.toBe(0)
  })

  test('a changed prefix invalidates naturally (different key, no stale hit)', async () => {
    const base = ImagePipe._create(gradientH(8, 8))
    const bright = await base.adjust({ brightness: 0.5 }).flip('horizontal')._render()
    const dark = await base.adjust({ brightness: -0.5 }).flip('horizontal')._render()
    expect(bright.data).not.toEqual(dark.data)
  })
})

describe('RenderCache bounds', () => {
  const pixels = (w: number, h: number): ReturnType<typeof solid> => solid(w, h, [1, 2, 3, 255])

  test('evicts least-recently-used entries beyond maxEntries', () => {
    const cache = new RenderCache(Infinity, 2)
    cache.set('a', pixels(2, 2))
    cache.set('b', pixels(2, 2))
    cache.get('a') // refresh recency: b is now oldest
    cache.set('c', pixels(2, 2))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
  })

  test('evicts by byte budget and never evicts the entry just stored', () => {
    // 2×2 entries are 16 bytes, the 4×4 is 64: a 70-byte budget forces both
    // small entries out when the big one lands.
    const cache = new RenderCache(70, 10)
    cache.set('a', pixels(2, 2))
    cache.set('b', pixels(2, 2))
    cache.set('big', pixels(4, 4)) // 64 bytes: evicts both, keeps itself
    expect(cache.get('big')).toBeDefined()
    expect(cache.size).toBe(1)
  })

  test('entries larger than the whole budget are skipped', () => {
    const cache = new RenderCache(8, 10)
    cache.set('huge', pixels(10, 10))
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  test('stores are defensive copies', () => {
    const cache = new RenderCache()
    const original = pixels(2, 2)
    cache.set('k', original)
    original.data.fill(9)
    expect(cache.get('k')!.data[0]).toBe(1)
  })
})
