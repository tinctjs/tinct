---
'imagepipe': minor
---

Live pipelines (`imagepipe/live`): run any serialized color recipe on video or canvas sources per frame, in real time. GPU-first texture-resident rendering (frame upload → fragment passes → straight to the visible canvas, no readback) with CPU-kernel fallback, hot-swappable recipes via `session.update()`, `pause`/`resume`/`stop` controls, and `stats` (mode, fps, frames). Recipes are validated up front: geometry ops and shaderless filters throw a descriptive error at `pipe()`, not per frame.
