/** CPU geometry kernels: crop, flip, rotation. */
import { describe, expect, test } from 'vitest'
import { cropPixels, flipPixels, rotate90, rotateArbitrary } from '../src/cpu/geometry'
import { resolveCrop, rotateBounds } from '../src/core/geometry-math'
import { parseColor } from '../src/cpu/color'
import { createPixelData } from '../src/core/pixel'
import { gradientH, px, expectRgbaClose, solid } from './helpers'

/** 2×3 image with six distinct pixels, labelled by red channel 1..6. */
function distinct(): ReturnType<typeof createPixelData> {
  const p = createPixelData(2, 3)
  for (let i = 0; i < 6; i++) {
    p.data[i * 4] = i + 1
    p.data[i * 4 + 3] = 255
  }
  return p
}

describe('crop', () => {
  test('pixel-rect crop copies the exact region', () => {
    const src = gradientH(8, 8)
    const out = cropPixels(src, resolveCrop({ x: 2, y: 3, width: 4, height: 2 }, 8, 8))
    expect([out.width, out.height]).toEqual([4, 2])
    expect(px(out, 0, 0)).toEqual(px(src, 2, 3))
    expect(px(out, 3, 1)).toEqual(px(src, 5, 4))
  })

  test('percent crop resolves against the source size', () => {
    const rect = resolveCrop({ x: '25%', y: '25%', width: '50%', height: '50%' }, 8, 8)
    expect(rect).toEqual({ x: 2, y: 2, width: 4, height: 4 })
  })

  test('aspect crop honors gravity', () => {
    expect(resolveCrop({ aspect: '1:1' }, 8, 4)).toEqual({ x: 2, y: 0, width: 4, height: 4 })
    expect(resolveCrop({ aspect: '1:1', gravity: 'west' }, 8, 4)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    })
    expect(resolveCrop({ aspect: '1:1', gravity: 'east' }, 8, 4)).toEqual({
      x: 4,
      y: 0,
      width: 4,
      height: 4,
    })
    expect(resolveCrop({ aspect: 1, gravity: 'south' }, 4, 8)).toEqual({
      x: 0,
      y: 4,
      width: 4,
      height: 4,
    })
  })

  test('crop rects are clamped to the image', () => {
    const rect = resolveCrop({ x: 6, y: 6, width: 100, height: 100 }, 8, 8)
    expect(rect).toEqual({ x: 6, y: 6, width: 2, height: 2 })
  })
})

describe('flip', () => {
  test('horizontal mirrors left-right', () => {
    const src = distinct()
    const out = flipPixels(src, 'horizontal')
    expect(px(out, 0, 0)).toEqual(px(src, 1, 0))
    expect(px(out, 1, 2)).toEqual(px(src, 0, 2))
  })

  test('vertical mirrors top-bottom', () => {
    const src = distinct()
    const out = flipPixels(src, 'vertical')
    expect(px(out, 0, 0)).toEqual(px(src, 0, 2))
    expect(px(out, 1, 1)).toEqual(px(src, 1, 1))
  })

  test('double flip is identity', () => {
    const src = distinct()
    const out = flipPixels(flipPixels(src, 'horizontal'), 'horizontal')
    expect(out.data).toEqual(src.data)
  })
})

describe('rotate (90° multiples)', () => {
  test('90° clockwise maps (x,y) → (h-1-y, x)', () => {
    const src = distinct() // 2×3
    const out = rotate90(src, 1) // → 3×2
    expect([out.width, out.height]).toEqual([3, 2])
    expect(px(out, 2, 0)).toEqual(px(src, 0, 0))
    expect(px(out, 0, 1)).toEqual(px(src, 1, 2))
  })

  test('180° equals double flip', () => {
    const src = distinct()
    const out = rotate90(src, 2)
    const doubleFlip = flipPixels(flipPixels(src, 'horizontal'), 'vertical')
    expect(out.data).toEqual(doubleFlip.data)
  })

  test('four quarter turns are identity', () => {
    const src = distinct()
    const out = rotate90(rotate90(rotate90(rotate90(src, 1), 1), 1), 1)
    expect(out.data).toEqual(src.data)
  })
})

describe('rotate (arbitrary)', () => {
  test('45° expands to the rotated bounding box', () => {
    const bounds = rotateBounds(45, 4, 4)
    expect(bounds).toEqual({ width: 6, height: 6 })
  })

  test('corners are filled with the background color', () => {
    const src = solid(8, 8, [0, 255, 0, 255])
    const bounds = rotateBounds(45, 8, 8)
    const out = rotateArbitrary(src, 45, bounds.width, bounds.height, parseColor('#ff0000'))
    expectRgbaClose(px(out, 0, 0), [255, 0, 0, 255])
    expectRgbaClose(px(out, out.width - 1, out.height - 1), [255, 0, 0, 255])
  })

  test('the center of the image survives rotation', () => {
    const src = solid(9, 9, [10, 20, 30, 255])
    const bounds = rotateBounds(30, 9, 9)
    const out = rotateArbitrary(src, 30, bounds.width, bounds.height, parseColor('transparent'))
    expectRgbaClose(
      px(out, Math.floor(out.width / 2), Math.floor(out.height / 2)),
      [10, 20, 30, 255],
    )
  })
})
