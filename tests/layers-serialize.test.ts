/**
 * Document serialization: the version 2 envelope, the shared sources table,
 * round-trip fidelity, and version boundaries in both directions.
 */
import { describe, expect, test } from 'vitest'
import { TinctImage } from '../src/core/editor'
import type { SerializedHistory } from '../src/core/types'
import { document, fromJSON, layer } from '../src/layers'
import type { SerializedDocument } from '../src/layers'
import { gradientH, solid } from './helpers'

const RED: [number, number, number, number] = [255, 0, 0, 255]

const image = (w = 4, h = 4, rgba = RED) => TinctImage._create(solid(w, h, rgba))

/** Force the data through real JSON, the way a consumer would store it. */
const roundTrip = (doc: ReturnType<typeof document>): SerializedDocument =>
  JSON.parse(JSON.stringify(doc)) as SerializedDocument

describe('the envelope', () => {
  test('carries version 2, the canvas, sources and layers', () => {
    const json = document({ width: 20, height: 10, background: '#ffffff' })
      .add(layer(image()).at(2, 3).opacity(0.5).blend('multiply').name('a'))
      .toJSON()

    expect(json.version).toBe(2)
    expect(json.canvas).toEqual({ width: 20, height: 10, background: '#ffffff' })
    expect(json.layers).toHaveLength(1)
    expect(json.layers[0]).toMatchObject({
      x: 2,
      y: 3,
      opacity: 0.5,
      blend: 'multiply',
      visible: true,
      name: 'a',
      ops: [],
    })
  })

  test('JSON.stringify works directly on a document', () => {
    const doc = document({ width: 4, height: 4 }).add(layer(image()))
    expect((JSON.parse(JSON.stringify(doc)) as SerializedDocument).version).toBe(2)
  })

  test('a layer pipeline serializes as ops, not as rendered pixels', () => {
    const json = document({ width: 8, height: 8 })
      .add(layer(image(8, 8).resize({ width: 4 }).adjust({ brightness: 0.2 })))
      .toJSON()
    expect(json.layers[0]!.ops.map((op) => op.op)).toEqual(['resize', 'adjust'])
    expect(Object.values(json.sources)[0]).toMatchObject({ width: 8, height: 8 })
  })

  test('an unnamed layer omits the name key rather than storing null', () => {
    const json = document({ width: 4, height: 4 }).add(layer(image())).toJSON()
    expect('name' in json.layers[0]!).toBe(false)
  })
})

describe('the shared sources table', () => {
  test('one source used by many layers is stored once', () => {
    const shared = image(4, 4)
    const json = document({ width: 20, height: 20 })
      .add(layer(shared).at(0, 0))
      .add(layer(shared.resize({ width: 2 })).at(6, 0))
      .add(layer(shared.adjust({ brightness: 0.5 })).at(12, 0))
      .toJSON()

    expect(Object.keys(json.sources)).toHaveLength(1)
    expect(new Set(json.layers.map((l) => l.source)).size).toBe(1)
  })

  test('distinct sources get distinct ids', () => {
    const json = document({ width: 20, height: 20 })
      .add(layer(image(4, 4)))
      .add(layer(image(6, 6)))
      .toJSON()
    expect(Object.keys(json.sources)).toHaveLength(2)
    expect(json.layers[0]!.source).not.toBe(json.layers[1]!.source)
  })

  test('sharing survives a round trip', () => {
    const shared = image(4, 4)
    const doc = document({ width: 20, height: 20 })
      .add(layer(shared))
      .add(layer(shared.flip('horizontal')).at(6, 0))
    expect(Object.keys(fromJSON(roundTrip(doc)).toJSON().sources)).toHaveLength(1)
  })
})

describe('round trips', () => {
  test('a restored document renders byte-identically', async () => {
    const doc = document({ width: 16, height: 12, background: '#102030' })
      .add(
        layer(TinctImage._create(gradientH(8, 8)))
          .at(1, 1)
          .name('bg'),
      )
      .add(
        layer(TinctImage._create(gradientH(6, 6)).flip('horizontal'))
          .at(7, 4)
          .opacity(0.6)
          .blend('screen')
          .name('fg'),
      )
      .add(layer(image(3, 3)).at(0, 9).visible(false).name('hidden'))

    const restored = fromJSON(roundTrip(doc))
    expect((await restored.flatten()._render()).data).toEqual((await doc.flatten()._render()).data)
  })

  test('every layer property survives', () => {
    const doc = document({ width: 10, height: 10, background: 'red' }).add(
      layer(image(4, 4).resize({ width: 2 }))
        .at(3, 4)
        .opacity(0.25)
        .blend('darken')
        .visible(false)
        .name('sticker'),
    )
    const restored = fromJSON(roundTrip(doc))
    const l = restored.layers[0]!

    expect(restored.background).toBe('red')
    expect([restored.width, restored.height]).toEqual([10, 10])
    expect(l.at()).toEqual({ x: 3, y: 4 })
    expect(l.opacity()).toBe(0.25)
    expect(l.blend()).toBe('darken')
    expect(l.visible()).toBe(false)
    expect(l.name()).toBe('sticker')
    expect([l.width, l.height]).toEqual([2, 2])
  })

  test('a restored document is still editable and still immutable', () => {
    const doc = document({ width: 10, height: 10 }).add(layer(image()).name('a'))
    const restored = fromJSON(roundTrip(doc))
    expect(restored.move('a', { dx: 5 }).boundsOf('a')).toMatchObject({ x: 5 })
    expect(restored.boundsOf('a')).toMatchObject({ x: 0 })
  })

  test('an empty document round trips', () => {
    const restored = fromJSON(roundTrip(document({ width: 5, height: 6, background: 'black' })))
    expect([restored.width, restored.height, restored.layers.length]).toEqual([5, 6, 0])
  })

  test('serializing twice is stable', () => {
    const doc = document({ width: 8, height: 8 }).add(layer(image()).at(1, 2).name('a'))
    expect(fromJSON(roundTrip(doc)).toJSON()).toEqual(doc.toJSON())
  })
})

describe('version boundaries', () => {
  test('a newer document version is rejected, not replayed', () => {
    const json = { ...document({ width: 4, height: 4 }).toJSON(), version: 3 }
    expect(() => fromJSON(json as unknown as SerializedDocument)).toThrow(/version 3/)
  })

  test('a v1 pipeline reader rejects a document envelope cleanly', () => {
    const json = document({ width: 4, height: 4 }).toJSON()
    expect(() => image().pipe(json as unknown as SerializedHistory)).toThrow(/version 2/)
  })

  test('a truncated source rejects descriptively instead of mis-rendering', () => {
    // Regression (Copilot review on #9): a data64 shorter than
    // width×height×4 used to flow into rendering as silent garbage pixels.
    const json = document({ width: 4, height: 4 }).add(layer(image())).toJSON()
    const [id, source] = Object.entries(json.sources)[0]!
    const broken = {
      ...json,
      sources: { [id]: { ...source, data64: btoa('\x01\x02\x03\x04') } },
    }
    expect(() => fromJSON(broken)).toThrow(
      new RegExp(`source '${id}' has 4 byte\\(s\\).*corrupt or truncated`),
    )
  })

  test('a layer pointing at a missing source is rejected', () => {
    const json = document({ width: 4, height: 4 }).add(layer(image())).toJSON()
    const broken = { ...json, sources: {} }
    expect(() => fromJSON(broken)).toThrow(/missing from the document's sources table/)
  })
})

describe('boundaries', () => {
  test('a flattened document cannot be serialized as a layer source', () => {
    const inner = document({ width: 4, height: 4 }).add(layer(image()))
    const outer = document({ width: 8, height: 8 }).add(layer(inner.flatten()))
    expect(() => outer.toJSON()).toThrow(/render it to pixels first/)
  })

  test('but it still flattens — the restriction is serialization only', async () => {
    const inner = document({ width: 4, height: 4, background: 'red' })
    const outer = document({ width: 8, height: 8 }).add(layer(inner.flatten()).at(2, 2))
    const out = await outer.flatten()._render()
    expect([out.data[(2 * 8 + 2) * 4], out.data[(2 * 8 + 2) * 4 + 3]]).toEqual([255, 255])
  })
})
