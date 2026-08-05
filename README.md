<p align="center">
  <img src="./assets/logo.svg" alt="imagepipe" width="96" height="96">
</p>

# imagepipe

> Zero-dependency, TypeScript-first image editing for the browser. Small, composable, tree-shakeable.

[![CI](https://github.com/imagepipe/imagepipe/actions/workflows/ci.yml/badge.svg)](https://github.com/imagepipe/imagepipe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/imagepipe)](https://www.npmjs.com/package/imagepipe)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](./src/index.ts)

imagepipe is the Lodash of image editing: a library, not an app. Chainable, lazy,
immutable pipelines over Canvas 2D — with transparent WebGL2 acceleration where
available — that UI tools can be built on top of.

> **Status:** pre-release, feature-complete for the initial release. CPU
> path, WebGL2 acceleration (verified against the CPU reference on real
> WebGL2 in CI), and worker offloading are implemented; the same pipeline
> renders identically everywhere — acceleration only changes speed.

> **Renamed:** this package was previously published as `tinctjs` (≤ 0.2.0).
> Same library, same API surface modulo the entry names: `tinct` → `imagepipe`,
> `TinctImage` → `ImagePipe`.

## Installation

```sh
npm install imagepipe
```

## Quick start

```ts
import { imagepipe } from 'imagepipe'
import { grayscale, blur } from 'imagepipe/filters'

const image = await imagepipe.load(fileOrUrlOrImageData)

const result = await image
  .crop({ aspect: '16:9', gravity: 'center' })
  .resize({ width: 1280 })
  .rotate(90)
  .adjust({ brightness: 0.1, contrast: 0.05, saturation: -0.2 })
  .apply(grayscale())
  .apply(blur({ radius: 4 }))
  .toBlob({ format: 'webp', quality: 0.85 })
```

Nothing renders until you ask for output. Every operation returns a **new**
immutable instance, so undo/redo is just keeping references:

```ts
const original = await imagepipe.load(file)
const step1 = original.crop({ aspect: '1:1' })
const step2 = step1.apply(grayscale())
// "undo" = use step1 again; original is untouched
```

## Core examples

```ts
// Custom filters: a CPU kernel, optionally accelerated by a WebGL2 shader
import { defineFilter } from 'imagepipe'

const sepia = defineFilter({
  name: 'sepia',
  fragment: sepiaShader, // optional GLSL ES 3.00
  fallback: sepiaCpu, // required: (pixels: ImageData, options) => ImageData | void
})

// Introspection and serialization of the edit pipeline
const ops = edited.history() // JSON-safe, storable, diffable
const replayed = image.pipe(ops) // replay on any image

// Progress events for large images
image.on('progress', ({ pct }) => {
  progressBar.value = pct
})
```

## API

| API                                | Description                                                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imagepipe.load(source, options?)` | Load a `File`, `Blob`, URL, `ImageData`, `<img>`, `<canvas>`, or `OffscreenCanvas`. EXIF orientation is applied automatically; all other metadata (EXIF/GPS) is stripped on export — a privacy feature when handling user uploads |
| `imagepipe.capabilities()`         | Feature detection: `{ webgl2, offscreenCanvas, workers }`                                                                                                                                                                         |
| `.crop(options)`                   | Pixel/percent region, or aspect ratio + gravity (incl. content-aware `'face'`)                                                                                                                                                    |
| `.resize(options)`                 | High-quality resampling (Lanczos multi-step downscale)                                                                                                                                                                            |
| `.rotate(angle, options?)`         | 90° increments lossless; arbitrary angles expand the canvas                                                                                                                                                                       |
| `.flip(axis)`                      | `'horizontal'` or `'vertical'`                                                                                                                                                                                                    |
| `.adjust(options)`                 | brightness, contrast, saturation, exposure (`-1..1`), hue (deg), gamma                                                                                                                                                            |
| `.overlay(pixels, options?)`       | Watermark/logo compositing with gravity, margin, opacity                                                                                                                                                                          |
| `.apply(filter)`                   | Apply a built-in or custom filter                                                                                                                                                                                                 |
| `.history()`                       | Serialize the pipeline to JSON-safe ops                                                                                                                                                                                           |
| `.pipe(ops)`                       | Replay serialized ops                                                                                                                                                                                                             |
| `.on(event, listener)`             | `progress` events during rendering                                                                                                                                                                                                |
| `.toBlob(options?)`                | Encode to PNG / JPEG / WebP; `maxBytes` targets a file size, `signal` cancels                                                                                                                                                     |
| `.toDataURL(options?)`             | Encode to a data URL                                                                                                                                                                                                              |
| `.toImageData()`                   | Raw pixels                                                                                                                                                                                                                        |
| `.toCanvas()`                      | Render into a canvas                                                                                                                                                                                                              |

Built-in filters (`imagepipe/filters`): `grayscale`, `sepia`, `invert`, `blur`,
`sharpen`, `pixelate`, `vignette`, `duotone`, `noise`, `posterize`, `curves`
(serializable tone curves — presets as JSON), and `median` (denoise).

Companion modules, each ~1.5 kB and tree-shaken when unused: `imagepipe/face`
(content-aware cropping), `imagepipe/hash` (ThumbHash placeholders),
`imagepipe/palette` (dominant colors), `imagepipe/layers` (multi-image
documents).

### Layers

`imagepipe/layers` turns imagepipe from a one-image pipeline into a document model
— collage makers, meme tools, thumbnail builders, template renderers. Every
layer's content is a full pipeline, so filters, adjustments, and geometry
work per layer for free:

```ts
import { document, layer } from 'imagepipe/layers'

const doc = document({ width: 1080, height: 1350, background: '#ffffff' })
  .add(layer(photo))
  .add(
    layer(sticker.resize({ width: 300 }))
      .at(650, 80)
      .opacity(0.9)
      .blend('multiply')
      .name('sticker'),
  )

const dragged = doc.move('sticker', { dx: 20, dy: -10 }) // new document
const blob = await dragged.flatten().toBlob({ format: 'webp' })
```

| API                                                     | Description                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `document({ width, height, background })`               | Fixed canvas, ordered layer stack                                                                                     |
| `layer(image)`                                          | Wrap a pipeline; `.at()`, `.opacity()`, `.blend()`, `.visible()`, `.name()` read with no argument and derive with one |
| `.add` `.insert` `.remove` `.update` `.move` `.reorder` | All return a new document, addressing layers by name or index                                                         |
| `.boundsOf(ref)`                                        | The layer's rectangle — arithmetic only, safe in a drag loop                                                          |
| `.layerAt(x, y)`                                        | Top-most alpha-aware hit test: clicking a transparent hole selects what's behind it                                   |
| `.flatten()`                                            | Composite to a `ImagePipe` — chain, export, or reuse it as a layer                                                    |
| `.toJSON()` / `fromJSON(data)`                          | Versioned envelope with a shared sources table                                                                        |

Blend modes: `source-over`, `multiply`, `screen`, `darken`, `lighten`.

Documents are immutable and share structure, so undo/redo is keeping
references — and layer pixels are cached per pipeline, so dragging,
reordering, or changing a layer's opacity re-runs only the composite pass,
never the layers below. UIs own the mouse; imagepipe owns the model and the math.

### Face-aware cropping

```ts
import { enableFaceGravity } from 'imagepipe/face'

enableFaceGravity() // once at startup; ships ~1 kB, tree-shaken if unused

const avatar = await image
  .crop({ aspect: '1:1', gravity: 'face' })
  .resize({ width: 256 })
  .toBlob({ format: 'webp' })
```

Detection is **deterministic and platform-agnostic** — a skin-region
heuristic with a saliency fallback, no `FaceDetector` API and no model
downloads — so the same input produces the same crop in every browser and
serialized histories replay exactly. It is an honest heuristic, not ML:
great for portraits and avatars; unusual lighting or stylized art falls back
to salient-region framing.

One consequence: the face stage reads skin **color**, so on grayscale images
it degrades to salient-subject framing (measured on our eval set: focal
accuracy 9/10 color → 3/10 grayscale, though every produced crop still
contained a face). If your chain desaturates, crop with `'face'` _before_
applying `grayscale()` — the crop sees the pixels at its position in the
pipeline.

## Examples

Complete little apps built on the published package, live from this repo:

- **[Avatar Studio](https://imagepipe.github.io/imagepipe/avatar-studio/)** — face-aware crops, look presets, size-budgeted WebP export
- **[Lookbook](https://imagepipe.github.io/imagepipe/lookbook/)** — film presets as pure JSON, replayed with `pipe()`
- **[Shrinkwrap](https://imagepipe.github.io/imagepipe/optimizer/)** — batch upload optimizer with ThumbHash placeholders and dominant colors
- **[Collage](https://imagepipe.github.io/imagepipe/collage/)** — a layered document editor: drag to place with `layerAt()`, per-layer filters and blending, undo as an array of references

Source in [`examples/`](./examples), each runnable with `npm install && npm run dev`.
The interactive [playground](https://imagepipe.github.io/imagepipe/) exposes every operation.

## Tree-shaking

Every filter is individually importable. If you only use `crop` and `resize`,
you ship only the core; if you import `grayscale`, you ship only the grayscale
kernel:

```ts
import { imagepipe } from 'imagepipe' // core only
import { grayscale } from 'imagepipe/filters' // + grayscale kernel, nothing else
```

The package is ESM-only with `sideEffects: false` and per-filter modules, so
any modern bundler prunes the rest.

## Browser support

Evergreen browsers (Chrome, Edge, Firefox, Safari 16.4+). Baseline execution
uses Canvas 2D + typed arrays; WebGL2 (color adjustments and per-pixel
filters), Web Workers (heavy pipelines ≥ 512×512 without custom filters),
and `OffscreenCanvas` are detected at runtime and used automatically, falling
back gracefully. No polyfills are required or bundled.

Indicative CPU-path timings on a 2000×1500 image (Node 24, M-series):
Lanczos resize to 800px ≈ 50 ms, full adjust ≈ 60 ms, three color filters
≈ 25 ms, gaussian blur (r=4) ≈ 310 ms. GPU/worker paths reduce main-thread
cost for exactly these heavy cases.

## Bundle size

Enforced budgets in CI via [size-limit](https://github.com/ai/size-limit):

| Import                                | Budget       | Measured (brotli) |
| ------------------------------------- | ------------ | ----------------- |
| Core (`imagepipe` + `defineFilter`)   | ≤ 10 kB gzip | ~8.6 kB           |
| Each individual filter                | ≤ 2 kB gzip  | 0.44–0.52 kB      |
| All filters together                  | ≤ 10 kB      | ~3 kB             |
| `imagepipe/face`, `/hash`, `/palette` | ≤ 2 kB each  | 1.2–1.6 kB        |
| `imagepipe/layers` (own code)         | ≤ 4 kB       | ~1.6 kB           |

`imagepipe/layers` is measured as a delta: the size-limit config carries the
core baseline it builds on and the layers entry at baseline + 4 kB, so the
budget tracks the layers code rather than the engine underneath it.

Core includes the full CPU engine, the WebGL2 renderer, the worker client,
the incremental render cache, cancellation, and the overlay compositor. The
original 8 kB budget was raised to 10 kB in v0.2 when the cache, overlay,
and white-balance landed — measured honestly rather than split into
micro-entry-points nobody would import separately. The worker is a separate
lazily-loaded artifact.

Re-measure any time with `npm run size`; CI fails if a budget is exceeded.

## When to use imagepipe

|                                          | imagepipe | Fabric.js / Konva | Jimp       | sharp     |
| ---------------------------------------- | --------- | ----------------- | ---------- | --------- |
| Runs in browser                          | ✅        | ✅                | ⚠️ (heavy) | ❌ (Node) |
| Zero dependencies                        | ✅        | ❌                | ❌         | ❌        |
| Tree-shakeable ops                       | ✅        | ❌                | ❌         | —         |
| Immutable/serializable pipeline          | ✅        | ❌                | ❌         | ❌        |
| Canvas scene graph / interactive objects | ❌        | ✅                | ❌         | ❌        |
| Server-side batch processing             | ❌        | ❌                | ✅         | ✅        |

Use imagepipe when you need programmatic image _editing_ in the browser — crop,
resize, adjust, filter, export — especially as the engine under your own UI.
Use a scene-graph library for interactive canvas apps, and sharp for servers.

## Roadmap

- **v0.1** — everything above: geometry, adjustments, filters, serialization, CPU + WebGL2, workers.
- **v0.3** — `imagepipe/layers`: multi-image documents, CPU compositing, blend modes, hit testing, versioned document serialization.
- **Later:** GPU compositing and affine layer placement, text, drawing/brushes, AI-assisted features, more codecs (AVIF), plugin ecosystem.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Architecture notes live in
[docs/architecture.md](./docs/architecture.md).

## Credits

imagepipe's design owes a lot of its ideas and learnings to
[Javed Ahmed](mailto:mjavedahmed4@gmail.com) and
[Junaid Qadir](https://junaidqadir.com).

## License

[MIT](./LICENSE)
