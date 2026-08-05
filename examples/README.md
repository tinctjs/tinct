# imagepipe examples

Small, complete apps built on the **published** `imagepipe` package — each one
is real consumer code you can copy from, and each showcases a different
capability. All are deployed from `main`:

| Example                              | Live                                                                                                | What it shows                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Avatar Studio** (`avatar-studio/`) | [imagepipe.github.io/imagepipe/avatar-studio](https://imagepipe.github.io/imagepipe/avatar-studio/) | Face-aware square cropping, look presets (adjust + curves), cancellable re-renders, WebP export under a byte budget                                        |
| **Lookbook** (`lookbook/`)           | [imagepipe.github.io/imagepipe/lookbook](https://imagepipe.github.io/imagepipe/lookbook/)           | Film presets as **pure JSON** — serialized pipelines you can copy, paste, store, and replay with `pipe()`                                                  |
| **Shrinkwrap** (`optimizer/`)        | [imagepipe.github.io/imagepipe/optimizer](https://imagepipe.github.io/imagepipe/optimizer/)         | Batch upload optimization: EXIF orientation, resize, `maxBytes` compression, watermark overlay, ThumbHash placeholders, dominant colors                    |
| **Collage** (`collage/`)             | [imagepipe.github.io/imagepipe/collage](https://imagepipe.github.io/imagepipe/collage/)             | Multi-layer documents: `layerAt()` hit testing and `boundsOf()` selection in a drag loop, per-layer pipelines, blend modes, undo/redo, JSON round trip     |
| **Booth** (`booth/`)                 | [imagepipe.github.io/imagepipe/booth](https://imagepipe.github.io/imagepipe/booth/)                 | Live pipelines: webcam filters at 60 fps via `imagepipe/live`, hot-swappable presets, and snapshots that replay the same recipe through the still pipeline |

Run any of them locally:

```sh
cd examples/avatar-studio   # or lookbook / optimizer / collage / booth
npm install
npm run dev
```

Or open one instantly in StackBlitz:

- https://stackblitz.com/github/imagepipe/imagepipe/tree/main/examples/avatar-studio
- https://stackblitz.com/github/imagepipe/imagepipe/tree/main/examples/lookbook
- https://stackblitz.com/github/imagepipe/imagepipe/tree/main/examples/optimizer
- https://stackblitz.com/github/imagepipe/imagepipe/tree/main/examples/collage
- https://stackblitz.com/github/imagepipe/imagepipe/tree/main/examples/booth

Built something with imagepipe? Add it to the
[showcase discussion](https://github.com/imagepipe/imagepipe/discussions) — we
feature real apps here.
