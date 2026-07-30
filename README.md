# Tinct

> Zero-dependency, TypeScript-first image editing for the browser. Small, composable, tree-shakeable.

[![CI](https://github.com/azeemhassni/tinct/actions/workflows/ci.yml/badge.svg)](https://github.com/azeemhassni/tinct/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tinctjs)](https://www.npmjs.com/package/tinctjs)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](./src/index.ts)

Tinct is the Lodash of image editing: a library, not an app. Chainable, lazy,
immutable pipelines over Canvas 2D — with transparent WebGL2 acceleration where
available — that UI tools can be built on top of.

> **Status:** pre-release. The public API below is under review (Phase 1);
> implementations land in Phase 2 (CPU) and Phase 3 (WebGL2 + workers).

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

| API                            | Description                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `tinct.load(source, options?)` | Load a `File`, `Blob`, URL, `ImageData`, `<img>`, `<canvas>`, or `OffscreenCanvas` |
| `tinct.capabilities()`         | Feature detection: `{ webgl2, offscreenCanvas, workers }`                          |
| `.crop(options)`               | Pixel/percent region, or aspect ratio + gravity                                    |
| `.resize(options)`             | High-quality resampling (Lanczos multi-step downscale)                             |
| `.rotate(angle, options?)`     | 90° increments lossless; arbitrary angles expand the canvas                        |
| `.flip(axis)`                  | `'horizontal'` or `'vertical'`                                                     |
| `.adjust(options)`             | brightness, contrast, saturation, exposure (`-1..1`), hue (deg), gamma             |
| `.apply(filter)`               | Apply a built-in or custom filter                                                  |
| `.history()`                   | Serialize the pipeline to JSON-safe ops                                            |
| `.pipe(ops)`                   | Replay serialized ops                                                              |
| `.on(event, listener)`         | `progress` events during rendering                                                 |
| `.toBlob(options?)`            | Encode to PNG / JPEG / WebP                                                        |
| `.toDataURL(options?)`         | Encode to a data URL                                                               |
| `.toImageData()`               | Raw pixels                                                                         |
| `.toCanvas()`                  | Render into a canvas                                                               |

Built-in filters (`tinctjs/filters`): `grayscale`, `sepia`, `invert`, `blur`,
`sharpen`, `pixelate`, `vignette`, `duotone`, `noise`, `posterize`.

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
uses Canvas 2D; WebGL2, `OffscreenCanvas`, and Web Workers are detected at
runtime and used automatically, falling back gracefully. No polyfills are
required or bundled.

## Bundle size

Enforced budgets in CI via [size-limit](https://github.com/ai/size-limit):

| Import                          | Budget      |
| ------------------------------- | ----------- |
| Core (`tinct` + `defineFilter`) | ≤ 8 kB gzip |
| Each individual filter          | ≤ 2 kB gzip |

Measured sizes are reported by `npm run size` (current pre-implementation
figures are far below budget and will be updated as kernels land).

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

## License

[MIT](./LICENSE)
