---
'imagepipe': minor
---

New `imagepipe/batch` entry: process many images with one recipe. `batch(sources).pipe(history)` or `.map(fn)`, bounded concurrency, per-item failure isolation, aggregate progress events, and whole-batch AbortSignal cancellation via `toBlobs`/`toImageDatas`.
