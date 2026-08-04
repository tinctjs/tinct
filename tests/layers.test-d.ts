/**
 * API contract type tests for `imagepipe/layers`: the overloaded accessors
 * read one type and derive another, references are name-or-index, and the
 * serialized envelope is pinned to version 2.
 */
import { describe, expectTypeOf, test } from 'vitest'
import type { ImagePipe } from '../src/index'
import { document, fromJSON, layer, PipeDocument, PipeLayer } from '../src/layers'
import type { BlendMode, LayerBounds, LayerPlacement, SerializedDocument } from '../src/layers'

declare const image: ImagePipe
declare const doc: PipeDocument
declare const one: PipeLayer

describe('construction', () => {
  test('document() requires a size and accepts an optional background', () => {
    expectTypeOf(document).toBeCallableWith({ width: 10, height: 10 })
    expectTypeOf(document).toBeCallableWith({ width: 10, height: 10, background: '#fff' })
    expectTypeOf(document({ width: 1, height: 1 })).toEqualTypeOf<PipeDocument>()
    expectTypeOf(layer(image)).toEqualTypeOf<PipeLayer>()
  })

  test('a layer source is a pipeline, not raw pixels', () => {
    expectTypeOf(layer).parameter(0).toEqualTypeOf<ImagePipe>()
    expectTypeOf(one.source).toEqualTypeOf<ImagePipe>()
  })
})

describe('layer accessors', () => {
  test('reading returns the value; setting returns a new layer', () => {
    expectTypeOf(one.at()).toEqualTypeOf<LayerPlacement>()
    expectTypeOf(one.at(1, 2)).toEqualTypeOf<PipeLayer>()
    expectTypeOf(one.opacity()).toEqualTypeOf<number>()
    expectTypeOf(one.opacity(0.5)).toEqualTypeOf<PipeLayer>()
    expectTypeOf(one.blend()).toEqualTypeOf<BlendMode>()
    expectTypeOf(one.blend('multiply')).toEqualTypeOf<PipeLayer>()
    expectTypeOf(one.visible()).toEqualTypeOf<boolean>()
    expectTypeOf(one.visible(false)).toEqualTypeOf<PipeLayer>()
    expectTypeOf(one.name()).toEqualTypeOf<string | undefined>()
    expectTypeOf(one.name('a')).toEqualTypeOf<PipeLayer>()
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
    expectTypeOf(doc.add(one)).toEqualTypeOf<PipeDocument>()
    expectTypeOf(doc.insert(0, one)).toEqualTypeOf<PipeDocument>()
    expectTypeOf(doc.remove('a')).toEqualTypeOf<PipeDocument>()
    expectTypeOf(doc.update(0, (l) => l.opacity(1))).toEqualTypeOf<PipeDocument>()
    expectTypeOf(doc.move('a', { dx: 1 })).toEqualTypeOf<PipeDocument>()
    expectTypeOf(doc.reorder(1, 0)).toEqualTypeOf<PipeDocument>()
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
    expectTypeOf(doc.flatten()).toEqualTypeOf<ImagePipe>()
    expectTypeOf(doc.layerAt(0, 0)).resolves.toEqualTypeOf<PipeLayer | null>()
    expectTypeOf(doc.layerAt).toBeCallableWith(0, 0, { signal: AbortSignal.abort() })
  })

  test('the stack is exposed read-only', () => {
    expectTypeOf(doc.layers).toEqualTypeOf<readonly PipeLayer[]>()
  })
})

describe('serialization', () => {
  test('the envelope is pinned to version 2 and round-trips', () => {
    expectTypeOf(doc.toJSON()).toEqualTypeOf<SerializedDocument>()
    expectTypeOf(doc.toJSON().version).toEqualTypeOf<2>()
    expectTypeOf(fromJSON).parameter(0).toEqualTypeOf<SerializedDocument>()
    expectTypeOf(fromJSON(doc.toJSON())).toEqualTypeOf<PipeDocument>()
  })

  test('nothing in the public surface is any', () => {
    expectTypeOf(doc.toJSON()).not.toBeAny()
    expectTypeOf(doc.layers).not.toBeAny()
  })
})
