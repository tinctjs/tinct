/** curves(): monotone spline LUTs, per-channel curves, serialization. */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { curves, invert } from '../src/filters/index'
import type { SerializedOp } from '../src/core/types'
import { px, solid, gradientH } from './helpers'

describe('curves', () => {
  test('no points is a no-op', async () => {
    const src = gradientH(8, 2)
    const out = await TinctImage._create(src).apply(curves({}))._render()
    expect(out.data).toEqual(src.data)
  })

  test('identity points are a no-op', async () => {
    const src = gradientH(8, 2)
    const out = await TinctImage._create(src)
      .apply(
        curves({
          rgb: [
            [0, 0],
            [255, 255],
          ],
        }),
      )
      ._render()
    expect(out.data).toEqual(src.data)
  })

  test('the inversion curve matches the invert filter', async () => {
    const src = gradientH(16, 4)
    const viaCurve = await TinctImage._create(src)
      .apply(
        curves({
          rgb: [
            [0, 255],
            [255, 0],
          ],
        }),
      )
      ._render()
    const viaInvert = await TinctImage._create(src).apply(invert())._render()
    expect(viaCurve.data).toEqual(viaInvert.data)
  })

  test('a lifted-blacks curve raises shadows and clamps outside endpoints', async () => {
    const out = await TinctImage._create(solid(2, 1, [10, 10, 10, 255]))
      .apply(
        curves({
          rgb: [
            [20, 50],
            [255, 255],
          ],
        }),
      )
      ._render()
    // 10 is below the first point (20) → clamps to its output (50).
    expect(px(out, 0, 0)[0]).toBe(50)
  })

  test('interpolation is monotone — no overshoot between points', async () => {
    const out = await TinctImage._create(gradientH(256, 1))
      .apply(
        curves({
          rgb: [
            [0, 0],
            [128, 220],
            [255, 255],
          ],
        }),
      )
      ._render()
    for (let x = 1; x < 256; x++) {
      expect(px(out, x, 0)[0]).toBeGreaterThanOrEqual(px(out, x - 1, 0)[0])
    }
    // And it passes through the control point.
    expect(Math.abs(px(out, 128, 0)[0] - 220)).toBeLessThanOrEqual(1)
  })

  test('per-channel curves are independent, applied after the master curve', async () => {
    const out = await TinctImage._create(solid(2, 2, [100, 100, 100, 255]))
      .apply(
        curves({
          rgb: [
            [0, 0],
            [100, 150],
            [255, 255],
          ],
          b: [
            [0, 0],
            [150, 40],
            [255, 255],
          ],
        }),
      )
      ._render()
    const [r, g, b] = px(out, 0, 0)
    expect(r).toBe(150)
    expect(g).toBe(150)
    expect(b).toBe(40) // master lifted 100 → 150, then blue curve pulled it down
  })

  test('presets are just JSON: history round-trips through pipe', async () => {
    const preset: SerializedOp[] = [
      {
        op: 'filter',
        params: {
          name: 'curves',
          options: {
            rgb: [
              [0, 24],
              [128, 140],
              [255, 240],
            ],
          },
        },
      },
    ]
    const direct = await TinctImage._create(gradientH(32, 8))
      .pipe(JSON.parse(JSON.stringify(preset)) as SerializedOp[])
      ._render()
    const expected = await TinctImage._create(gradientH(32, 8))
      .apply(
        curves({
          rgb: [
            [0, 24],
            [128, 140],
            [255, 240],
          ],
        }),
      )
      ._render()
    expect(direct.data).toEqual(expected.data)
  })
})
