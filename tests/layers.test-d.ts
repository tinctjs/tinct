/**
 * API contract type tests for `tinctjs/layers`: the overloaded accessors
 * read one type and derive another, references are name-or-index, and the
 * serialized envelope is pinned to version 2.
 */
import { describe, expectTypeOf, test } from 'vitest'
import type { TinctImage } from '../src/index'
import { document, fromJSON, layer, TinctDocument, TinctLayer } from '../src/layers'
import type { BlendMode, LayerBounds, LayerPlacement, SerializedDocument } from '../src/layers'

declare const image: TinctImage
declare const doc: TinctDocument
declare const one: TinctLayer

describe('construction', () => {
  test('document() requires a size and accepts an optional background', () => {
    expectTypeOf(document).toBeCallableWith({ width: 10, height: 10 })
    expectTypeOf(document).toBeCallableWith({ width: 10, height: 10, background: '#fff' })
    expectTypeOf(document({ width: 1, height: 1 })).toEqualTypeOf<TinctDocument>()
    expectTypeOf(layer(image)).toEqualTypeOf<TinctLayer>()
  })

  test('a layer source is a pipeline, not raw pixels', () => {
    expectTypeOf(layer).parameter(0).toEqualTypeOf<TinctImage>()
    expectTypeOf(one.source).toEqualTypeOf<TinctImage>()
  })
})

describe('layer accessors', () => {
  test('reading returns the value; setting returns a new layer', () => {
    expectTypeOf(one.at()).toEqualTypeOf<LayerPlacement>()
    expectTypeOf(one.at(1, 2)).toEqualTypeOf<TinctLayer>()
    expectTypeOf(one.opacity()).toEqualTypeOf<number>()
    expectTypeOf(one.opacity(0.5)).toEqualTypeOf<TinctLayer>()
    expectTypeOf(one.blend()).toEqualTypeOf<BlendMode>()
    expectTypeOf(one.blend('multiply')).toEqualTypeOf<TinctLayer>()
    expectTypeOf(one.visible()).toEqualTypeOf<boolean>()
    expectTypeOf(one.visible(false)).toEqualTypeOf<TinctLayer>()
    expectTypeOf(one.name()).toEqualTypeOf<string | undefined>()
    expectTypeOf(one.name('a')).toEqualTypeOf<TinctLayer>()
  })

  test('geometry readers are plain numbers', () => {
    expectTypeOf(one.x).toEqualTypeOf<number>()
    expectTypeOf(one.width).toEqualTypeOf<number>()
    expectTypeOf(one.height).toEqualTypeOf<number>()
  })

  test('only the five supported blend modes are accepted', () => {
    expectTypeOf(one.blend).toBeCallableWith('source-over')
    expectTypeOf(one.blend).toBeCallableWith('screen')
    expectTypeOf(one.blend).toBeCallableWith('darken')
    expectTypeOf(one.blend).toBeCallableWith('lighten')
    expectTypeOf<BlendMode>().not.toBeAny()
    // @ts-expect-error — 'overlay' is not a P1 blend mode
    expectTypeOf(one.blend).toBeCallableWith('overlay')
  })
})

describe('document operations', () => {
  test('every mutation returns a new document', () => {
    expectTypeOf(doc.add(one)).toEqualTypeOf<TinctDocument>()
    expectTypeOf(doc.insert(0, one)).toEqualTypeOf<TinctDocument>()
    expectTypeOf(doc.remove('a')).toEqualTypeOf<TinctDocument>()
    expectTypeOf(doc.update(0, (l) => l.opacity(1))).toEqualTypeOf<TinctDocument>()
    expectTypeOf(doc.move('a', { dx: 1 })).toEqualTypeOf<TinctDocument>()
    expectTypeOf(doc.reorder(1, 0)).toEqualTypeOf<TinctDocument>()
  })

  test('layers are addressed by name or index', () => {
    expectTypeOf(doc.remove).toBeCallableWith('sticker')
    expectTypeOf(doc.remove).toBeCallableWith(2)
    expectTypeOf(doc.boundsOf('a')).toEqualTypeOf<LayerBounds>()
  })

  test('move takes an optional delta on each axis', () => {
    expectTypeOf(doc.move).toBeCallableWith('a', {})
    expectTypeOf(doc.move).toBeCallableWith('a', { dx: 1 })
    expectTypeOf(doc.move).toBeCallableWith('a', { dy: 1 })
  })

  test('flatten is synchronous and hit testing is not', () => {
    expectTypeOf(doc.flatten()).toEqualTypeOf<TinctImage>()
    expectTypeOf(doc.layerAt(0, 0)).resolves.toEqualTypeOf<TinctLayer | null>()
    expectTypeOf(doc.layerAt).toBeCallableWith(0, 0, { signal: AbortSignal.abort() })
  })

  test('the stack is exposed read-only', () => {
    expectTypeOf(doc.layers).toEqualTypeOf<readonly TinctLayer[]>()
  })
})

describe('serialization', () => {
  test('the envelope is pinned to version 2 and round-trips', () => {
    expectTypeOf(doc.toJSON()).toEqualTypeOf<SerializedDocument>()
    expectTypeOf(doc.toJSON().version).toEqualTypeOf<2>()
    expectTypeOf(fromJSON).parameter(0).toEqualTypeOf<SerializedDocument>()
    expectTypeOf(fromJSON(doc.toJSON())).toEqualTypeOf<TinctDocument>()
  })

  test('nothing in the public surface is any', () => {
    expectTypeOf(doc.toJSON()).not.toBeAny()
    expectTypeOf(doc.layers).not.toBeAny()
  })
})
