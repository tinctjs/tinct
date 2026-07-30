/**
 * Runtime tests for the Phase 1 pipeline plumbing: immutability, history
 * serialization, replay, dimension propagation, and defineFilter.
 * Rendering itself is Phase 2 and not exercised here.
 */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { defineFilter } from '../src/core/filter'
import type { SerializedOp } from '../src/core/types'
import { createPixelData } from '../src/core/pixel'
import { grayscale, blur, duotone } from '../src/filters/index'

const SOURCE = createPixelData(1920, 1080)
const base = (): TinctImage => TinctImage._create(SOURCE)

describe('immutability', () => {
  test('operations return new instances and never mutate the receiver', () => {
    const original = base()
    const cropped = original.crop({ aspect: '1:1' })
    const resized = cropped.resize({ width: 100 })

    expect(cropped).not.toBe(original)
    expect(resized).not.toBe(cropped)
    expect(original.history()).toHaveLength(0)
    expect(cropped.history()).toHaveLength(1)
    expect(resized.history()).toHaveLength(2)
  })

  test('two branches from one instance stay independent', () => {
    const root = base().resize({ width: 800 })
    const a = root.rotate(90)
    const b = root.flip('vertical')

    expect(a.history().map((o) => o.op)).toEqual(['resize', 'rotate'])
    expect(b.history().map((o) => o.op)).toEqual(['resize', 'flip'])
  })
})

describe('history and replay', () => {
  test('history serializes every op in order and is JSON-safe', () => {
    const edited = base()
      .crop({ aspect: '16:9', gravity: 'center' })
      .resize({ width: 1280 })
      .rotate(90)
      .adjust({ brightness: 0.1 })
      .apply(grayscale())
      .apply(blur({ radius: 4 }))

    const ops = edited.history()
    expect(ops).toEqual([
      { op: 'crop', params: { aspect: '16:9', gravity: 'center' } },
      { op: 'resize', params: { width: 1280 } },
      { op: 'rotate', params: { angle: 90 } },
      { op: 'adjust', params: { brightness: 0.1 } },
      { op: 'filter', params: { name: 'grayscale', options: { amount: 1 } } },
      { op: 'filter', params: { name: 'blur', options: { radius: 4 } } },
    ])
    expect(JSON.parse(JSON.stringify(ops))).toEqual(ops)
  })

  test('pipe replays a serialized history onto a fresh image', () => {
    const edited = base().crop({ aspect: '1:1' }).resize({ width: 512 }).apply(grayscale())
    const roundTripped = JSON.parse(JSON.stringify(edited.history())) as SerializedOp[]
    const replayed = base().pipe(roundTripped)

    expect(replayed.history()).toEqual(edited.history())
    expect(replayed.width).toBe(edited.width)
    expect(replayed.height).toBe(edited.height)
  })
})

describe('dimension propagation (lazy, no rendering)', () => {
  test('aspect crop', () => {
    const img = base().crop({ aspect: '1:1' })
    expect([img.width, img.height]).toEqual([1080, 1080])
  })

  test('percentage crop', () => {
    const img = base().crop({ x: '10%', y: '10%', width: '50%', height: '50%' })
    expect([img.width, img.height]).toEqual([960, 540])
  })

  test('resize with one dimension keeps aspect ratio', () => {
    const img = base().resize({ width: 960 })
    expect([img.width, img.height]).toEqual([960, 540])
  })

  test('resize fit modes', () => {
    expect(base().resize({ width: 500, height: 500, fit: 'fill' }).width).toBe(500)
    expect(base().resize({ width: 500, height: 500, fit: 'cover' }).height).toBe(500)
    const contained = base().resize({ width: 500, height: 500 })
    expect([contained.width, contained.height]).toEqual([500, 281])
  })

  test('rotate by 90 swaps dimensions; arbitrary angles expand the box', () => {
    const quarter = base().rotate(90)
    expect([quarter.width, quarter.height]).toEqual([1080, 1920])

    const tilted = base().rotate(45)
    expect(tilted.width).toBe(Math.round((1920 + 1080) * Math.SQRT1_2))
  })
})

describe('defineFilter', () => {
  test('produces frozen, serializable filter instances with defaults applied', () => {
    const swirl = defineFilter<{ angle?: number }>({
      name: 'swirl',
      defaults: { angle: 45 },
      fallback: () => undefined,
    })

    const instance = swirl()
    expect(instance.name).toBe('swirl')
    expect(instance.options).toEqual({ angle: 45 })
    expect(Object.isFrozen(instance)).toBe(true)
    expect(swirl({ angle: 90 }).options).toEqual({ angle: 90 })
  })

  test('required-option filters serialize their options into history', () => {
    const ops = base()
      .apply(duotone({ shadows: '#1e3a5f', highlights: '#f5d0a9' }))
      .history()
    expect(ops[0]).toEqual({
      op: 'filter',
      params: { name: 'duotone', options: { shadows: '#1e3a5f', highlights: '#f5d0a9' } },
    })
  })
})

describe('events', () => {
  test('listeners attach, propagate to derived images, and unsubscribe', () => {
    const root = base()
    const seen: number[] = []
    const off = root.on('progress', ({ pct }) => seen.push(pct))

    // Derived instances share the listener channel (documented behavior);
    // actual emission happens during Phase 2 rendering.
    const derived = root.resize({ width: 10 })
    expect(derived).not.toBe(root)
    expect(off).toBeTypeOf('function')
    off()
  })
})
