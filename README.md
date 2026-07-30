<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logo-dark-mode.svg">
    <img src="./assets/logo.svg" alt="Tinct" width="96" height="96">
  </picture>
</p>

# Tinct

> Zero-dependency, TypeScript-first image editing for the browser. Small, composable, tree-shakeable.

[![CI](https://github.com/azeemhassni/tinct/actions/workflows/ci.yml/badge.svg)](https://github.com/azeemhassni/tinct/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tinctjs)](https://www.npmjs.com/package/tinctjs)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](./src/index.ts)

Tinct is the Lodash of image editing: a library, not an app. Chainable, lazy,
immutable pipelines over Canvas 2D — with transparent WebGL2 acceleration where
available — that UI tools can be built on top of.

> **Status:** pre-release, feature-complete for v0.1.0. CPU path, WebGL2
> acceleration (color ops), and worker offloading are implemented; the same
> pipeline renders identically everywhere — acceleration only changes speed.

## Installation

```sh
npm install tinctjs
```

## Quick start

```ts
import { tinct } from 'tinctjs'
import { grayscale, blur } from 'tinctjs/filters'

const image = await tinct.load(fileOrUrlOrImageData)

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
const original = await tinct.load(file)
const step1 = original.crop({ aspect: '1:1' })
const step2 = step1.apply(grayscale())
// "undo" = use step1 again; original is untouched
```

## Core examples

```ts
// Custom filters: a CPU kernel, optionally accelerated by a WebGL2 shader
import { defineFilter } from 'tinctjs'

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

| API                            | Description                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tinct.load(source, options?)` | Load a `File`, `Blob`, URL, `ImageData`, `<img>`, `<canvas>`, or `OffscreenCanvas`. EXIF orientation is applied automatically; all other metadata (EXIF/GPS) is stripped on export — a privacy feature when handling user uploads |
| `tinct.capabilities()`         | Feature detection: `{ webgl2, offscreenCanvas, workers }`                                                                                                                                                                         |
| `.crop(options)`               | Pixel/percent region, or aspect ratio + gravity (incl. content-aware `'face'`)                                                                                                                                                    |
| `.resize(options)`             | High-quality resampling (Lanczos multi-step downscale)                                                                                                                                                                            |
| `.rotate(angle, options?)`     | 90° increments lossless; arbitrary angles expand the canvas                                                                                                                                                                       |
| `.flip(axis)`                  | `'horizontal'` or `'vertical'`                                                                                                                                                                                                    |
| `.adjust(options)`             | brightness, contrast, saturation, exposure (`-1..1`), hue (deg), gamma                                                                                                                                                            |
| `.apply(filter)`               | Apply a built-in or custom filter                                                                                                                                                                                                 |
| `.history()`                   | Serialize the pipeline to JSON-safe ops                                                                                                                                                                                           |
| `.pipe(ops)`                   | Replay serialized ops                                                                                                                                                                                                             |
| `.on(event, listener)`         | `progress` events during rendering                                                                                                                                                                                                |
| `.toBlob(options?)`            | Encode to PNG / JPEG / WebP                                                                                                                                                                                                       |
| `.toDataURL(options?)`         | Encode to a data URL                                                                                                                                                                                                              |
| `.toImageData()`               | Raw pixels                                                                                                                                                                                                                        |
| `.toCanvas()`                  | Render into a canvas                                                                                                                                                                                                              |

Built-in filters (`tinctjs/filters`): `grayscale`, `sepia`, `invert`, `blur`,
`sharpen`, `pixelate`, `vignette`, `duotone`, `noise`, `posterize`.

### Face-aware cropping

```ts
import { enableFaceGravity } from 'tinctjs/face'

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

## Tree-shaking

Every filter is individually importable. If you only use `crop` and `resize`,
you ship only the core; if you import `grayscale`, you ship only the grayscale
kernel:

```ts
import { tinct } from 'tinctjs' // core only
import { grayscale } from 'tinctjs/filters' // + grayscale kernel, nothing else
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

| Import                          | Budget      | Measured (brotli) |
| ------------------------------- | ----------- | ----------------- |
| Core (`tinct` + `defineFilter`) | ≤ 8 kB gzip | ~7.1 kB           |
| Each individual filter          | ≤ 2 kB gzip | 0.44–0.52 kB      |
| All ten filters together        | ≤ 10 kB     | ~2.5 kB           |

Core includes the full CPU engine, the WebGL2 renderer, and the worker
client. The worker itself is a separate lazily-loaded artifact.

Re-measure any time with `npm run size`; CI fails if a budget is exceeded.

## When to use Tinct

|                                          | Tinct | Fabric.js / Konva | Jimp       | sharp     |
| ---------------------------------------- | ----- | ----------------- | ---------- | --------- |
| Runs in browser                          | ✅    | ✅                | ⚠️ (heavy) | ❌ (Node) |
| Zero dependencies                        | ✅    | ❌                | ❌         | ❌        |
| Tree-shakeable ops                       | ✅    | ❌                | ❌         | —         |
| Immutable/serializable pipeline          | ✅    | ❌                | ❌         | ❌        |
| Canvas scene graph / interactive objects | ❌    | ✅                | ❌         | ❌        |
| Server-side batch processing             | ❌    | ❌                | ✅         | ✅        |

Use Tinct when you need programmatic image _editing_ in the browser — crop,
resize, adjust, filter, export — especially as the engine under your own UI.
Use a scene-graph library for interactive canvas apps, and sharp for servers.

## Roadmap

- **v0.1** — everything above: geometry, adjustments, filters, serialization, CPU + WebGL2, workers.
- **Later (not v0.1):** layers & compositing, text, drawing/brushes, AI-assisted features, more codecs (AVIF), plugin ecosystem.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Architecture notes live in
[docs/architecture.md](./docs/architecture.md).

## Credits

Tinct's design owes a lot of its ideas and learnings to
[Javed Ahmed](mailto:mjavedahmed4@gmail.com) and
[Junaid Qadir](mailto:junaidqadirb@gmail.com).

## License

[MIT](./LICENSE)
