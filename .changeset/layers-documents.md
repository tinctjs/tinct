---
'tinctjs': minor
---

Add `tinctjs/layers`: multi-image documents.

`document()` and `layer()` build an immutable, structurally shared stack on a
fixed canvas. Every layer's content is a full Tinct pipeline, so filters,
adjustments, and geometry work per layer. `flatten()` composites to an
ordinary `TinctImage`, `boundsOf()` and `layerAt()` are the primitives a
selection UI needs, and `toJSON()`/`fromJSON()` round-trip a document through
a versioned envelope with a shared sources table. Blend modes: `source-over`,
`multiply`, `screen`, `darken`, `lighten`.

Layer pixels are cached per pipeline, so moving, reordering, or re-blending a
layer re-runs only the composite pass.

Internally, `TinctImage` now also accepts a deferred source — dimensions up
front, pixels on first render — which is what lets `flatten()` return a
pipeline synchronously. Existing behaviour is unchanged.
