/**
 * rotate(angle, { trim: true }) — straighten: inscribed-rect dimensions,
 * background-free output, editor/executor agreement, serialization.
 */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { inscribedBounds } from '../src/core/geometry-math'
import type { SerializedOp } from '../src/core/types'
import { px, solid } from './helpers'

describe('inscribedBounds', () => {
  test('45° on a square yields the ~1/√2 inner square', () => {
    const b = inscribedBounds(45, 100, 100)
    // Exact inscribed side is 100/√2 ≈ 70.7, minus the 2px safety inset.
    expect(b.width).toBe(68)
    expect(b.height).toBe(68)
  })

  test('small angles keep most of the frame', () => {
    const b = inscribedBounds(5, 400, 300)
    expect(b.width).toBeGreaterThan(340)
    expect(b.height).toBeGreaterThan(250)
    expect(b.width).toBeLessThan(400)
    expect(b.height).toBeLessThan(300)
  })

  test('is symmetric in angle sign', () => {
    expect(inscribedBounds(-7, 320, 200)).toEqual(inscribedBounds(7, 320, 200))
  })
})

describe('rotate with trim', () => {
  test('the result contains no background pixels at all', async () => {
    const image = TinctImage._create(solid(120, 90, [0, 200, 0, 255])).rotate(12, {
      background: '#ff0000',
      trim: true,
    })
    const out = await image._render()
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const [r, g] = px(out, x, y)
        expect(r, `red bleed at ${String(x)},${String(y)}`).toBeLessThan(g)
      }
    }
  })

  test('rendered dimensions match the eager dimension math', async () => {
    const image = TinctImage._create(solid(200, 100, [10, 20, 30, 255])).rotate(10, { trim: true })
    const out = await image._render()
    expect([out.width, out.height]).toEqual([image.width, image.height])
    expect(out.width).toBeLessThan(200)
  })

  test('trim is a no-op for 90° multiples', async () => {
    const plain = TinctImage._create(solid(40, 20, [5, 5, 5, 255])).rotate(90)
    const trimmed = TinctImage._create(solid(40, 20, [5, 5, 5, 255])).rotate(90, { trim: true })
    expect([trimmed.width, trimmed.height]).toEqual([plain.width, plain.height])
    const out = await trimmed._render()
    expect([out.width, out.height]).toEqual([20, 40])
  })

  test('trim serializes and replays', async () => {
    const image = TinctImage._create(solid(64, 64, [50, 60, 70, 255])).rotate(30, { trim: true })
    const ops = JSON.parse(JSON.stringify(image.history())) as SerializedOp[]
    expect(ops[0]).toEqual({ op: 'rotate', params: { angle: 30, trim: true } })
    const replayed = TinctImage._create(solid(64, 64, [50, 60, 70, 255])).pipe(ops)
    const [a, b] = await Promise.all([image._render(), replayed._render()])
    expect(a.data).toEqual(b.data)
  })
})
