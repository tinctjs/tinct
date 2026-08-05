---
'imagepipe': minor
---

`imagepipe/track`: landmark tracking for live sessions via a pluggable `LandmarkProvider` — the seam between face-landmark models and imagepipe's render path. The library ships no model: wrap MediaPipe, TensorFlow.js, or your own detector in a provider function, and `trackFace(session, provider, recipe)` runs it at a fixed cadence, smooths the landmarks (EMA), and hot-swaps the rebuilt recipe into the session. Recipes always carry concrete coordinates, so tracked frames snapshot and replay exactly. Includes `faceRoll` for tilt-following stickers, and `LiveSession` now exposes its `source`.
