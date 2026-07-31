/**
 * The layer and document model: immutability, structural sharing, stack
 * ordering, reference resolution, and synchronous bounds.
 */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import { document, layer } from '../src/layers'
import { solid } from './helpers'

const image = (w = 4, h = 4) => TinctImage._create(solid(w, h, [255, 0, 0, 255]))
const doc = () => document({ width: 20, height: 10 })

describe('document()', () => {
  test('canvas size and background are fixed at construction', () => {
    const d = document({ width: 100, height: 50, background: '#ff8800' })
    expect([d.width, d.height, d.background]).toEqual([100, 50, '#ff8800'])
    expect(d.layers).toEqual([])
  })

  test('background defaults to transparent', () => {
    expect(doc().background).toBe('transparent')
  })

  test('an unparseable background fails at construction, not at flatten time', () => {
    expect(() => document({ width: 4, height: 4, background: 'octarine' })).toThrow(
      /cannot parse color/,
    )
  })

  test('a non-positive canvas is rejected', () => {
    expect(() => document({ width: 0, height: 10 })).toThrow(/size must be positive/)
    expect(() => document({ width: 10, height: -1 })).toThrow(/size must be positive/)
  })
})

describe('layer()', () => {
  test('defaults are origin, opaque, source-over, visible, unnamed', () => {
    const l = layer(image())
    expect(l.at()).toEqual({ x: 0, y: 0 })
    expect(l.opacity()).toBe(1)
    expect(l.blend()).toBe('source-over')
    expect(l.visible()).toBe(true)
    expect(l.name()).toBeUndefined()
  })

  test('accessors read with no argument and derive with one', () => {
    const base = layer(image())
    const moved = base.at(5, 6)
    expect(moved).not.toBe(base)
    expect(base.at()).toEqual({ x: 0, y: 0 })
    expect([moved.x, moved.y]).toEqual([5, 6])
  })

  test('placement is whole pixels', () => {
    expect(layer(image()).at(5.4, -2.5).at()).toEqual({ x: 5, y: -2 })
  })

  test('opacity is clamped to 0..1', () => {
    expect(layer(image()).opacity(4).opacity()).toBe(1)
    expect(layer(image()).opacity(-1).opacity()).toBe(0)
  })

  test('an unknown blend mode throws where it is set, not where it is drawn', () => {
    // @ts-expect-error — 'overlay' is not a supported blend mode
    expect(() => layer(image()).blend('overlay')).toThrow(/unknown blend mode/)
  })

  test('size comes from the pipeline without rendering', () => {
    const l = layer(image(40, 20).resize({ width: 10 }))
    expect([l.width, l.height]).toEqual([10, 5])
  })

  test('the source pipeline is carried through', () => {
    const source = image()
    expect(layer(source).opacity(0.5).blend('screen').source).toBe(source)
  })
})

describe('stack mutations', () => {
  test('add appends on top and never mutates the receiver', () => {
    const empty = doc()
    const one = empty.add(layer(image()).name('a'))
    const two = one.add(layer(image()).name('b'))
    expect(empty.layers).toHaveLength(0)
    expect(one.layers).toHaveLength(1)
    expect(two.layers.map((l) => l.name())).toEqual(['a', 'b'])
  })

  test('untouched layers keep their identity across a mutation', () => {
    const bottom = layer(image()).name('bottom')
    const top = layer(image()).name('top')
    const before = doc().add(bottom).add(top)
    const after = before.move('top', { dx: 3 })
    expect(after.layers[0]).toBe(before.layers[0])
    expect(after.layers[1]).not.toBe(before.layers[1])
  })

  test('insert places at a stack position and clamps out-of-range indices', () => {
    const base = doc().add(layer(image()).name('a')).add(layer(image()).name('b'))
    expect(base.insert(0, layer(image()).name('z')).layers.map((l) => l.name())).toEqual([
      'z',
      'a',
      'b',
    ])
    expect(base.insert(99, layer(image()).name('z')).layers.map((l) => l.name())).toEqual([
      'a',
      'b',
      'z',
    ])
  })

  test('remove works by name and by index', () => {
    const base = doc()
      .add(layer(image()).name('a'))
      .add(layer(image()).name('b'))
      .add(layer(image()).name('c'))
    expect(base.remove('b').layers.map((l) => l.name())).toEqual(['a', 'c'])
    expect(base.remove(0).layers.map((l) => l.name())).toEqual(['b', 'c'])
  })

  test('reorder moves a layer through the stack and clamps', () => {
    const base = doc()
      .add(layer(image()).name('a'))
      .add(layer(image()).name('b'))
      .add(layer(image()).name('c'))
    expect(base.reorder('a', 2).layers.map((l) => l.name())).toEqual(['b', 'c', 'a'])
    expect(base.reorder('c', 0).layers.map((l) => l.name())).toEqual(['c', 'a', 'b'])
    expect(base.reorder('a', 99).layers.map((l) => l.name())).toEqual(['b', 'c', 'a'])
    expect(base.reorder('a', 0)).toBe(base) // already there
  })

  test('update replaces one layer; returning it unchanged returns the same document', () => {
    const base = doc().add(layer(image()).name('a'))
    expect(base.update('a', (l) => l.opacity(0.25)).layers[0]!.opacity()).toBe(0.25)
    expect(base.update('a', (l) => l)).toBe(base)
  })

  test('move translates relatively, defaulting each axis to zero', () => {
    const base = doc().add(layer(image()).at(10, 10).name('a'))
    expect(base.move('a', { dx: 5, dy: -4 }).boundsOf('a')).toMatchObject({ x: 15, y: 6 })
    expect(base.move('a', { dy: 1 }).boundsOf('a')).toMatchObject({ x: 10, y: 11 })
  })

  test('the layers array cannot be mutated through the getter', () => {
    const base = doc().add(layer(image()).name('a'))
    ;(base.layers as ReturnType<typeof layer>[]).push(layer(image()))
    expect(base.layers).toHaveLength(1)
  })
})

describe('layer references', () => {
  test('an unknown name throws a descriptive error', () => {
    expect(() => doc().add(layer(image())).remove('nope')).toThrow(/no layer named 'nope'/)
  })

  test('an out-of-range index throws a descriptive error', () => {
    expect(() => doc().add(layer(image())).remove(3)).toThrow(/out of range/)
    expect(() => doc().remove(0)).toThrow(/0 layer\(s\)/)
  })

  test('a duplicated name resolves to the bottom-most match', () => {
    const base = doc()
      .add(layer(image()).at(1, 1).name('dup'))
      .add(layer(image()).at(2, 2).name('dup'))
    expect(base.boundsOf('dup')).toMatchObject({ x: 1, y: 1 })
  })
})

describe('boundsOf', () => {
  test('combines placement with the pipeline size, synchronously', () => {
    const base = doc().add(
      layer(image(40, 20).resize({ width: 8 }))
        .at(3, 4)
        .name('a'),
    )
    expect(base.boundsOf('a')).toEqual({ x: 3, y: 4, width: 8, height: 4 })
  })

  test('reports bounds that extend past the canvas rather than clipping them', () => {
    const base = doc().add(layer(image(30, 30)).at(15, 5).name('a'))
    expect(base.boundsOf('a')).toEqual({ x: 15, y: 5, width: 30, height: 30 })
  })
})
