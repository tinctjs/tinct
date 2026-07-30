/**
 * overlay(): compositing math, gravity placement with margins, clipping,
 * self-contained serialization, immutability, and gravity validation.
 */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import type { SerializedOp } from '../src/core/types'
import { px, solid, expectRgbaClose } from './helpers'

const logo = (w = 4, h = 4, rgba: [number, number, number, number] = [255, 0, 0, 255]) =>
  solid(w, h, rgba)

describe('compositing', () => {
  test('an opaque overlay replaces the covered region and nothing else', async () => {
    const out = await TinctImage._create(solid(10, 10, [0, 0, 255, 255]))
      .overlay(logo(4, 4), { gravity: 'north-west' })
      ._render()
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(out, 3, 3)).toEqual([255, 0, 0, 255])
    expect(px(out, 4, 4)).toEqual([0, 0, 255, 255])
  })

  test('opacity blends source over destination', async () => {
    const out = await TinctImage._create(solid(6, 6, [0, 0, 200, 255]))
      .overlay(logo(6, 6, [200, 0, 0, 255]), { gravity: 'center', opacity: 0.5 })
      ._render()
    expectRgbaClose(px(out, 3, 3), [100, 0, 100, 255], 2)
  })

  test("the overlay's own alpha participates (semi-transparent watermark)", async () => {
    const out = await TinctImage._create(solid(6, 6, [0, 0, 200, 255]))
      .overlay(logo(6, 6, [200, 0, 0, 128]), { gravity: 'center' })
      ._render()
    const [r, , b, a] = px(out, 3, 3)
    expect(a).toBe(255) // opaque base stays opaque
    expect(r).toBeGreaterThan(90)
    expect(b).toBeGreaterThan(90)
  })

  test('overlays larger than the base clip instead of throwing', async () => {
    const out = await TinctImage._create(solid(4, 4, [0, 0, 255, 255]))
      .overlay(logo(10, 10), { gravity: 'center' })
      ._render()
    expect([out.width, out.height]).toEqual([4, 4])
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255])
  })
})

describe('placement', () => {
  test('south-east with margin is the watermark corner', async () => {
    const out = await TinctImage._create(solid(20, 20, [0, 0, 0, 255]))
      .overlay(logo(4, 4), { gravity: 'south-east', margin: 2 })
      ._render()
    expect(px(out, 17, 17)).toEqual([255, 0, 0, 255]) // inside the logo
    expect(px(out, 19, 19)).toEqual([0, 0, 0, 255]) // inside the margin
    expect(px(out, 13, 13)).toEqual([0, 0, 0, 255]) // outside the logo
  })

  test('center ignores margin', async () => {
    const out = await TinctImage._create(solid(10, 10, [0, 0, 0, 255]))
      .overlay(logo(2, 2), { gravity: 'center', margin: 3 })
      ._render()
    expect(px(out, 4, 4)).toEqual([255, 0, 0, 255])
    expect(px(out, 5, 5)).toEqual([255, 0, 0, 255])
  })

  test("content-aware gravities are rejected up front — 'face' is for crops", () => {
    expect(() =>
      TinctImage._create(solid(8, 8, [0, 0, 0, 255])).overlay(logo(), { gravity: 'face' }),
    ).toThrow(/compass position/)
  })
})

describe('serialization', () => {
  test('histories are self-contained: JSON round trip replays identically', async () => {
    const edited = TinctImage._create(solid(12, 12, [0, 80, 160, 255])).overlay(
      logo(3, 3, [250, 250, 0, 200]),
      { gravity: 'south-west', margin: 1, opacity: 0.7 },
    )
    const ops = JSON.parse(JSON.stringify(edited.history())) as SerializedOp[]
    const replayed = TinctImage._create(solid(12, 12, [0, 80, 160, 255])).pipe(ops)
    expect((await replayed._render()).data).toEqual((await edited._render()).data)
  })

  test('the overlay source is copied, not referenced', async () => {
    const source = logo(2, 2)
    const image = TinctImage._create(solid(6, 6, [0, 0, 0, 255])).overlay(source, {
      gravity: 'north-west',
    })
    source.data.fill(0) // mutate after the fact
    const out = await image._render()
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255])
  })
})
