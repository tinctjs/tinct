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

Plain `ImageData` transforms on typed arrays. Geometry uses Canvas 2D where
it is lossless (90° rotates, flips) and hand-written resampling where quality
demands it — downscaling is multi-step / Lanczos, never a naive single-pass
`drawImage`. The CPU path is the reference implementation: correctness bugs
here are release blockers, and GPU output is validated against it.

### WebGL2 path (`gl/`)

Color adjustments and filters compile to fragment shaders over a shared fullscreen-quad
pipeline; chains of color ops render in one pass where possible.
Filters opt in by providing a `fragment` shader in their definition; anything
without one runs its CPU kernel, mid-pipeline, via readback. Geometry stays on
the canvas/CPU path in v0.1.

## Feature detection and graceful fallback

`tinct.capabilities()` probes once per realm:

- `webgl2` — can we get a `WebGL2RenderingContext`?
- `offscreenCanvas` — is `OffscreenCanvas` constructible?
- `workers` — is `Worker` available?

The executor consults the same probes: WebGL2 unavailable (or context
creation fails mid-run) → CPU path; `OffscreenCanvas` unavailable → hidden
on-main-thread canvas. Failures degrade, never throw, and CPU/GPU output is
kept aligned by tolerance-based tests.

## OffscreenCanvas and worker strategy

When both `workers` and `offscreenCanvas` are available, expensive renders
move to a worker: the op list (already serializable — same format as
`history()`) and source pixels are posted over, executed there, and the encoded
result transferred back. Progress events are forwarded to the main thread.
When unavailable, the same executor runs on the main thread in chunked slices
so progress events still fire. Workers are created lazily and are inlined
(no separate worker file to serve).

## Events

Listener sets are shared across an editor and everything derived from it, so
`image.on('progress', …)` observes renders of any downstream chain. Progress
is reported per-op with sub-op granularity for chunked CPU work.

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
