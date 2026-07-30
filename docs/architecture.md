# Tinct architecture

This document explains how Tinct is put together and why. The CPU path
described here is implemented and tested; the WebGL2/worker sections describe
the Phase 3 design it was built to accommodate.

## Immutable op graph

A `TinctImage` is a pair of:

- a **source**: decoded pixels (or a handle to them), fixed at `tinct.load`;
- an ordered list of **op nodes**: plain, serializable descriptions of
  operations (`crop`, `resize`, `rotate`, `flip`, `adjust`, `filter`).

Every operation method returns a _new_ `TinctImage` sharing the same source
and listener channel, with one node appended. Nothing is copied but the op
list, so deriving instances is O(ops) and cheap. Consumers get undo/redo by
keeping references to intermediate instances — there is no mutable state to
snapshot.

## Lazy evaluation

No pixels move until an output method (`toBlob`, `toDataURL`, `toImageData`,
`toCanvas`) is awaited. At that point the executor walks the op list once,
choosing an execution path per op (see below). Dimension queries
(`image.width` / `image.height`) are answered by pure arithmetic over the op
list — no rendering.

Because evaluation is deferred, adjacent ops can be fused: consecutive
`adjust` calls and color filters collapse into a single per-pixel pass (CPU)
or a single shader chain (GPU) rather than N full-image passes.

## Serialization model

`history()` returns the op list as JSON-safe data:

```json
[
  { "op": "crop", "params": { "aspect": "16:9", "gravity": "center" } },
  { "op": "filter", "params": { "name": "blur", "options": { "radius": 4 } } }
]
```

Rules that keep this stable and versionable:

- `op` names and param shapes are part of the public contract; they only ever
  gain optional fields.
- Filters serialize as `name` + fully-defaulted `options`, never code.
- A future format revision will wrap the array in a versioned envelope; v0.1
  readers treat a bare array as version 1.

`pipe(ops)` replays a serialized history onto any image. Built-in geometry and
adjustment ops always replay. `filter` ops are resolved by name against the
**filter registry** (below).

## Filter registry and tree-shaking

`defineFilter(definition)` registers the definition in a module-level map and
returns a factory. Built-in filters are created with
`/* @__PURE__ */ defineFilter(...)` in one module per filter:

- If a consumer imports `grayscale`, that module executes, the filter
  registers, and its kernel ships.
- If they don't, the bundler drops the whole module — no kernel, no registry
  entry, no bytes.

Replaying a serialized `filter` op whose name is not registered throws a
descriptive error ("import the filter so it is present in your bundle").
This makes tree-shaking and replay two views of the same rule: _code ships iff
it is imported._

Boundaries that keep the package splittable later:

- `core/` knows nothing about specific filters or codecs.
- `filters/*` depend only on `core/filter` and small `cpu/` kernels
  (convolution, color parsing) — never on `io/` or each other.
- `io/`, `cpu/`, `gl/` are internal and reachable only through the executor
  and the editor's output methods.

## Execution paths

Both paths sit behind one internal `Executor` interface; choosing one never
changes public behavior, only speed.

### CPU path (`cpu/`, baseline and reference)

Pure typed-array transforms over structural `PixelData` (ImageData-compatible,
DOM-free — which is why the whole suite runs in plain Node). Downscaling is a
true Lanczos-3 convolution with kernel widening, never a naive single-pass
`drawImage`. The CPU path is the reference implementation: correctness bugs
here are release blockers, and GPU output is validated against it with
tolerance-based comparisons.

### WebGL2 path (`gl/`)

The executor batches consecutive GPU-able ops — `adjust`, plus any filter
whose definition ships a `fragment` shader — into one texture session:
upload once, run N ping-pong passes, read back once. Programs are cached per
fragment source. Each queued pass carries its CPU twin, so a `null` from the
backend (no context, compile failure, oversized texture, context loss)
replays the batch through the CPU kernels with byte-identical semantics.

GPU coverage in v0.1: the adjust pipeline and the per-pixel filters
(`grayscale`, `sepia`, `invert`, `duotone`, `posterize`, `vignette`).
Convolution and neighbourhood filters (`blur`, `sharpen`, `pixelate`) and
seeded `noise` intentionally stay CPU-only — their GPU ports need care to
match the reference output exactly, and correctness beats acceleration.
Geometry also stays on the CPU path in v0.1.

The adjust shader shares its coefficient math (`buildColorMatrix`) with the
CPU kernel; the CPU quantizes to bytes between stages while the GPU stays in
floats, so outputs may differ by a couple of LSB — within test tolerance.

## Feature detection and graceful fallback

`tinct.capabilities()` reports `webgl2`, `offscreenCanvas`, and `workers`.
Internally the GPU backend is created lazily and memoized per realm; any
creation failure memoizes `null` and the executor never asks again. The
fallback ladder never throws:

- WebGL2 missing/failing → CPU kernels (same output, tested byte-identical).
- Worker missing/failing → main-thread render.
- OffscreenCanvas missing → DOM canvas for I/O, hidden canvas for GL.

## OffscreenCanvas and worker strategy

Rendering needs no DOM at all (kernels are `PixelData` in, `PixelData` out),
so the render worker is just the executor plus the built-in filter registry.
`_render` offloads when **all** of these hold:

- `Worker` exists, and a previous attempt has not failed;
- the source is ≥ 512×512 (below that, copy + startup costs beat the win);
- every op is worker-safe: geometry, adjustments, and _built-in_ filters.
  Custom filters hold live function references that cannot cross threads,
  so those pipelines render on the main thread.

Buffers are transferred, not copied (the source is cloned first so the
editor's own pixels are never detached). Progress messages are forwarded to
the main-thread listeners. Any worker failure — constructor throw, CSP,
missing module-worker support — marks the worker broken and falls back to a
main-thread render of the same ops. Inside the worker, `execute()` will use
WebGL2 via OffscreenCanvas when the browser exposes it there.

The worker ships as a sibling build artifact (`dist/render-worker.js`)
referenced via `new Worker(new URL('./render-worker.js', import.meta.url),
{ type: 'module' })` — the pattern Vite, webpack 5, and Rollup understand and
bundle automatically.

## Events

Listener sets are shared across an editor and everything derived from it, so
`image.on('progress', …)` observes renders of any downstream chain. Progress
is reported per-op with sub-op granularity for chunked CPU work.

## Content-aware gravity

`gravity: 'face'` reuses the registry pattern: `tinctjs/face` registers a
_gravity resolver_ — `(pixels, cropWidth, cropHeight) → top-left origin` —
via an explicit `enableFaceGravity()` call (a bare side-effect import would
be tree-shaken away). Rules that keep it coherent with the rest of the
design:

- **Size is never content-dependent.** Gravity only places the window, so
  `image.width`/`.height` stay exact, synchronous arithmetic.
- **Deterministic by contract.** Resolvers must be pure functions of their
  inputs. The face detector is skin-region analysis (YCbCr chroma box over
  an integral image) with an energy-centroid saliency fallback — no platform
  APIs, no models — so histories containing `'face'` replay identically on
  every device, and the detector is unit-tested in Node.
- **Same failure mode as filters:** rendering `'face'` without enabling it
  throws the "import it so it ships" error. The worker enables it
  internally, but offloading requires it registered on the main thread too,
  so big and small images agree on whether a pipeline is valid.

## Extension model

`defineFilter` is the single extension point:

```ts
const myFilter = defineFilter({
  name: 'my-filter', // serialization key
  fallback: cpuKernel, // required; reference implementation
  fragment: glslShader, // optional acceleration
  uniforms: (options) => ({ u_amount: options.amount }),
  defaults: { amount: 1 },
})
```

Custom filters are first-class: they serialize into histories, replay via the
registry, and run on either path. The CPU kernel is required so every filter
works everywhere; the shader is an optional fast path.
