# imagepipe

## 0.6.0

### Minor Changes

- 16e8df5: `imagepipe/effects`: geometry-aware filters built for tracked, per-frame use. `warp` applies up to four radial displacement zones (bulge to magnify, pinch to slim) with smooth quadratic falloff; `sticker` composites pixels at a normalized anchor with scale, rotation, and opacity, serialized inline like `overlay`. Both take plain-JSON geometry, replay from histories exactly, and run in live pipelines — they are the render half of landmark-tracked face effects.
- 63b6ff5: Filter shaders can now declare auxiliary input textures and bilinear source sampling. `defineFilter` gains `textures` (bound as `uniform sampler2D <name>` on units 1..N — sticker pixels, lookup tables) and `linearSource` (sample `u_image` bilinearly, for coordinate-warping filters). Supported on both the offscreen GPU backend and live sessions, where auxiliary textures are uploaded once and cached across frames.
- a1cde08: `imagepipe/track`: landmark tracking for live sessions via a pluggable `LandmarkProvider` — the seam between face-landmark models and imagepipe's render path. The library ships no model: wrap MediaPipe, TensorFlow.js, or your own detector in a provider function, and `trackFace(session, provider, recipe)` runs it at a fixed cadence, smooths the landmarks (EMA), and hot-swaps the rebuilt recipe into the session. Recipes always carry concrete coordinates, so tracked frames snapshot and replay exactly. Includes `faceRoll` for tilt-following stickers, and `LiveSession` now exposes its `source`.

## 0.5.0

### Minor Changes

- 58abe78: `ImageBatch.run(fn)`: custom per-item outputs for batches — produce multiple artifacts (e.g. a compressed blob plus a placeholder thumbnail) from a single load per image.
- dd4ce7c: Live pipelines (`imagepipe/live`): run any serialized color recipe on video or canvas sources per frame, in real time. GPU-first texture-resident rendering (frame upload → fragment passes → straight to the visible canvas, no readback) with CPU-kernel fallback, hot-swappable recipes via `session.update()`, `pause`/`resume`/`stop` controls, and `stats` (mode, fps, frames). Recipes are validated up front: geometry ops and shaderless filters throw a descriptive error at `pipe()`, not per frame.

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
