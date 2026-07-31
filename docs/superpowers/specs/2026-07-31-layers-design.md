# Layers: multi-image documents (`tinctjs/layers`)

Design for [issue #8](https://github.com/tinctjs/tinct/issues/8). Approved 2026-07-31.

## Goal

Ship the model and the math for multi-image documents — collage makers, meme
tools, thumbnail builders, template renderers — without shipping any
interaction. UIs own the mouse; Tinct owns the pixels, the ordering, and the
two primitives a selection UI needs (`layerAt`, `boundsOf`).

Every layer's content is a full Tinct pipeline, so all existing filters,
adjustments, and geometry work per layer for free.

## Non-goals (P1)

- No selection, drag handles, or tools.
- No text or vector layers — raster only.
- No groups or nesting; a flat ordered stack. The serialization format leaves
  the door open.
- No affine placement. Translate only — scale and rotate already exist as
  pipeline ops on the layer's source.
- No GPU compositing. The composite pass is a per-pixel CPU loop.
- No `{ external: url }` source references. The sources table shape reserves
  the slot.

## Module layout

```
src/layers/index.ts       public entry: document, layer, fromJSON, types
src/layers/layer.ts       TinctLayer + layer()
src/layers/document.ts    TinctDocument + document()
src/layers/composite.ts   flatten pass + per-layer render cache
src/layers/serialize.ts   toJSON / fromJSON, shared sources table
src/cpu/blend.ts          separable blend kernels (imported only by layers)
```

`layers/` may depend on `core/` and `cpu/`. Nothing in `core/` knows layers
exist. Importing nothing from `/layers` costs zero bytes.

## Core changes

Three changes, all layers-agnostic:

1. **Deferred sources.** `TinctImage._create` accepts either `PixelData` or a
   `DeferredSource` — `{ width, height, resolve(signal): Promise<PixelData> }`.
   `_render` resolves it once and memoizes; `width`/`height` stay synchronous
   arithmetic because the deferred descriptor carries its dimensions. This is
   what lets `doc.flatten()` return a `TinctImage` synchronously and reuse the
   entire output surface (`toBlob`, `toDataURL`, `toImageData`, `toCanvas`,
   progress, abort) plus further chaining.
2. **`_source` internal getter** on `TinctImage`, so serialization can reach
   the pixels behind a layer.
3. **`compositeOver` gains an optional blend function**, defaulting to normal.
   With `B(Cb, Cs) = Cs` the general formula reduces to the current one, so
   `overlay()` output stays byte-identical and core gains no bytes.

## Public API

```ts
import { document, layer, fromJSON } from 'tinctjs/layers'

const doc = document({ width: 1080, height: 1350, background: '#ffffff' })
  .add(layer(photo).at(0, 0))
  .add(
    layer(sticker.resize({ width: 300 }))
      .at(650, 80)
      .opacity(0.9)
      .blend('multiply')
      .name('sticker'),
  )

const moved = doc.move('sticker', { dx: 20, dy: -10 })
const blob = await doc.flatten().toBlob({ format: 'webp' })
```

### `TinctLayer` (immutable)

Accessors are overloaded: no argument reads, one argument returns a new layer.

| Member                     | Meaning                                         |
| -------------------------- | ----------------------------------------------- |
| `at(x, y)` / `at()`        | Placement of the layer's top-left on the canvas |
| `opacity(v)` / `opacity()` | `0..1` multiplier over the layer's own alpha    |
| `blend(mode)` / `blend()`  | Blend mode                                      |
| `visible(v)` / `visible()` | Skipped entirely when false                     |
| `name(s)` / `name()`       | Optional label used by document references      |
| `source`, `x`, `y`         | Read-only                                       |
| `width`, `height`          | Read-only, from the pipeline — sync arithmetic  |

Blend modes in P1: `source-over`, `multiply`, `screen`, `darken`, `lighten`.

### `TinctDocument` (immutable)

Fixed canvas size, background color, ordered layer list. Every mutation
returns a new document with structural sharing — untouched layers keep object
identity, so undo/redo is keeping references.

| Member                                    | Meaning                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `add(layer)`                              | Append on top                                        |
| `insert(index, layer)`                    | Insert at a stack position                           |
| `remove(ref)`                             | Remove by name or index                              |
| `update(ref, fn)`                         | Replace a layer with `fn(layer)`                     |
| `move(ref, { dx, dy })`                   | Translate                                            |
| `reorder(ref, index)`                     | Change stack position                                |
| `boundsOf(ref)`                           | `{ x, y, width, height }` — synchronous              |
| `layerAt(x, y)`                           | `Promise<TinctLayer \| null>`, top-most, alpha-aware |
| `flatten()`                               | `TinctImage`                                         |
| `toJSON()`                                | `SerializedDocument`                                 |
| `on('progress', fn)`                      | Same event surface as `TinctImage`                   |
| `width`, `height`, `background`, `layers` | Read-only                                            |

A reference (`ref`) is `string | number` — a layer name or a stack index.
An unknown name throws a descriptive error.

`layerAt` is asynchronous because alpha-aware hit testing needs rendered
pixels; after a flatten it is served from the layer cache. `boundsOf` is
synchronous because a layer's size is pure arithmetic over its op graph.

`background` defaults to `'transparent'`.

## Compositing

The canvas is filled with the parsed background, then each visible layer is
composited in stack order. Blend math follows W3C Compositing and Blending
Level 1 in straight (non-premultiplied) alpha, matching the rest of the
pipeline:

```
Cr = (1 - ab) * Cs + ab * B(Cb, Cs)
ao = as + ab * (1 - as)
Co = (as * Cr + (1 - as) * ab * Cb) / ao
```

`B` is the separable blend function: `multiply` = `Cb * Cs`, `screen` =
`Cb + Cs - Cb * Cs`, `darken` = `min`, `lighten` = `max`. `source-over` uses
`B(Cb, Cs) = Cs`, which reduces the formula to plain source-over.

Layers extending past the canvas are clipped, never an error.

Abort is checked between layers. Progress emits `(i + 1) / n` on the
document's listener channel.

## Dirty-layer rendering

A `WeakMap<TinctImage, PixelData>` is created by `document()` and passed by
reference into every derived document, exactly as `RenderCache` and the
listener channel are shared across a `TinctImage` chain.

Because layers are immutable and mutations preserve object identity, this
gives precise dirty-layer semantics for free:

- Moving, re-blending, reordering, or hiding a layer keeps the same
  `TinctImage` → cache hit → lower layers' pipelines never re-run, only the
  composite loop repeats.
- Editing a layer's pipeline yields a new `TinctImage` → miss → only that
  layer re-renders, and its own `RenderCache` makes even that incremental.

This is verified by a test that counts filter-kernel invocations, not by
asserting intent.

## Serialization

`version: 2`, JSON-safe, per the issue:

```json
{
  "version": 2,
  "canvas": { "width": 1080, "height": 1350, "background": "#ffffff" },
  "sources": { "s0": { "width": 800, "height": 600, "data64": "…" } },
  "layers": [
    {
      "source": "s0",
      "ops": [],
      "x": 0,
      "y": 0,
      "opacity": 1,
      "blend": "source-over",
      "visible": true
    }
  ]
}
```

- Sources dedupe by **`PixelData` identity**, not a content hash. The same
  loaded image used across layers serializes once, at zero hashing cost.
- Layer ops are the layer pipeline's `history().ops`.
- `fromJSON` rebuilds one `TinctImage` per source (with a shared
  `RenderCache`) and pipes the ops back. It rejects versions it does not
  understand; the existing `pipe()` already rejects a v2 envelope cleanly.
- `toJSON()` also makes `JSON.stringify(doc)` work.
- A layer whose source is itself a flattened document throws a descriptive
  error on `toJSON` rather than silently dropping pixels. Nesting is out of
  P1 scope.

## Budgets

- `tinctjs/layers` ≤ 4 kB brotli for its own code. `size-limit` bundles
  transitively, so the new entry's limit is the measured core baseline plus
  4 kB, with the derivation named in the entry.
- The existing core entry proves the core bundle is unchanged.

## Testing

`tests/layers.test.ts` and `tests/layers-serialize.test.ts`, following the
existing fixture and tolerance conventions:

- Immutability and structural sharing across every mutator.
- Placement, clipping, and background fill.
- Each blend mode against hand-computed values.
- `opacity` multiplication and `visible: false`.
- Ordering by name and by index; unknown-name errors.
- `boundsOf` after a resize inside the layer pipeline.
- `layerAt` falling through a transparent pixel to the layer below.
- Dirty-layer render-count proof.
- JSON round-trip rendering byte-identical; a shared source appearing once;
  version rejection in both directions.
- `flatten().resize().toBlob()` chaining.
- Abort mid-composite; progress monotonicity.
- Type-level assertions alongside `tests/api.test-d.ts`.
