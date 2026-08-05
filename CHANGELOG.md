# imagepipe

## 0.4.0

### Minor Changes

- 4eb1407: New `imagepipe/batch` entry: process many images with one recipe. `batch(sources).pipe(history)` or `.map(fn)`, bounded concurrency, per-item failure isolation, aggregate progress events, and whole-batch AbortSignal cancellation via `toBlobs`/`toImageDatas`.

## 0.3.0

### Minor Changes

- 0e0772b: Rename: the package formerly published as `tinctjs` is now `imagepipe`. The entry object is `imagepipe` (was `tinct`), the pipeline class is `ImagePipe` (was `TinctImage`), layer types are `PipeDocument`/`PipeLayer`, and subpath entries keep their names (`imagepipe/filters`, `/face`, `/hash`, `/palette`, `/layers`). No behavioral changes; serialized histories and documents from tinctjs replay unchanged.

> Versions up to 0.2.0 were published as `tinctjs`; the package was renamed
> to `imagepipe` in 0.3.0. History below is continuous.

## 0.2.0

### Minor Changes

- ec3e7d0: Add `tinctjs/layers`: multi-image documents.

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

## 0.1.0

### Minor Changes

- e3b86f8: Initial release. Chainable immutable pipelines with versioned history serialization and replay; loaders (EXIF auto-orientation, metadata stripped) and exporters (PNG/JPEG/WebP, target-byte-size encoding, cancellable via AbortSignal); geometry incl. Lanczos resampling and straighten (rotate trim); eight adjustments incl. temperature/tint; twelve built-in filters incl. serializable curves and median denoise; watermark overlay; custom filters via defineFilter (CPU + multi-pass WebGL2); incremental re-render caching; worker offloading; content-aware face cropping (tinctjs/face); ThumbHash placeholders (tinctjs/hash); palette extraction (tinctjs/palette). GPU output is parity-tested against the CPU reference in headless Chromium.
