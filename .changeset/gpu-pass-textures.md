---
'imagepipe': minor
---

Filter shaders can now declare auxiliary input textures and bilinear source sampling. `defineFilter` gains `textures` (bound as `uniform sampler2D <name>` on units 1..N — sticker pixels, lookup tables) and `linearSource` (sample `u_image` bilinearly, for coordinate-warping filters). Supported on both the offscreen GPU backend and live sessions, where auxiliary textures are uploaded once and cached across frames.
