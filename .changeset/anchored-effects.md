---
'imagepipe': minor
---

`imagepipe/effects`: geometry-aware filters built for tracked, per-frame use. `warp` applies up to four radial displacement zones (bulge to magnify, pinch to slim) with smooth quadratic falloff; `sticker` composites pixels at a normalized anchor with scale, rotation, and opacity, serialized inline like `overlay`. Both take plain-JSON geometry, replay from histories exactly, and run in live pipelines — they are the render half of landmark-tracked face effects.
