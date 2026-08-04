/**
 * Deferred pipeline sources: dimensions without rendering, resolve-once
 * memoization shared down a derived chain, and abort behaviour.
 */
import { describe, expect, test, vi } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import type { DeferredSource } from '../src/core/pixel'
import { px, solid } from './helpers'

/** A deferred source that counts how often it is resolved. */
function counted(width = 8, height = 6): DeferredSource & { calls: () => number } {
  const resolve = vi.fn(() => Promise.resolve(solid(width, height, [10, 20, 30, 255])))
  return { width, height, resolve, calls: () => resolve.mock.calls.length }
}

describe('deferred sources', () => {
  test('dimensions are known without resolving', () => {
    const source = counted(8, 6)
    const image = ImagePipe._create(source)
    expect([image.width, image.height]).toEqual([8, 6])
    expect(source.calls()).toBe(0)
  })

  test('op-graph arithmetic still applies to a deferred source', () => {
    const image = ImagePipe._create(counted(8, 6)).resize({ width: 4 })
    expect([image.width, image.height]).toEqual([4, 3])
  })

  test('rendering resolves the source and applies the ops', async () => {
    const source = counted(8, 6)
    const out = await ImagePipe._create(source).crop({ x: 0, y: 0, width: 2, height: 2 })._render()
    expect([out.width, out.height]).toEqual([2, 2])
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255])
  })

  test('resolve runs once across every image derived from it', async () => {
    const source = counted()
    const base = ImagePipe._create(source)
    await base._render()
    await base.flip('horizontal')._render()
    await base.adjust({ brightness: 0.1 })._render()
    expect(source.calls()).toBe(1)
  })

  test('concurrent renders share one in-flight resolve', async () => {
    const source = counted()
    const base = ImagePipe._create(source)
    await Promise.all([base._render(), base.flip('vertical')._render()])
    expect(source.calls()).toBe(1)
  })

  test('a failed resolve is not memoized — the next render retries', async () => {
    let attempt = 0
    const source: DeferredSource = {
      width: 4,
      height: 4,
      resolve: () => {
        attempt++
        return attempt === 1
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(solid(4, 4, [1, 2, 3, 255]))
      },
    }
    const image = ImagePipe._create(source)
    await expect(image._render()).rejects.toThrow('boom')
    expect(px(await image._render(), 0, 0)).toEqual([1, 2, 3, 255])
  })

  test('the abort signal reaches the resolver', async () => {
    const controller = new AbortController()
    const source: DeferredSource = {
      width: 4,
      height: 4,
      resolve: (signal) =>
        signal?.aborted
          ? Promise.reject(new Error('aborted'))
          : Promise.resolve(solid(4, 4, [0, 0, 0, 255])),
    }
    controller.abort()
    await expect(ImagePipe._create(source)._render(controller.signal)).rejects.toThrow('aborted')
  })

  test('decoded sources are unaffected', async () => {
    const out = await ImagePipe._create(solid(3, 3, [7, 8, 9, 255]))._render()
    expect(px(out, 1, 1)).toEqual([7, 8, 9, 255])
  })
})
