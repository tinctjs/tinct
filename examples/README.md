# Tinct examples

Small, complete apps built on the **published** `tinctjs` package — each one
is real consumer code you can copy from, and each showcases a different
capability. All are deployed from `main`:

| Example                              | Live                                                                                    | What it shows                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Avatar Studio** (`avatar-studio/`) | [tinctjs.github.io/tinct/avatar-studio](https://tinctjs.github.io/tinct/avatar-studio/) | Face-aware square cropping, look presets (adjust + curves), cancellable re-renders, WebP export under a byte budget                                    |
| **Lookbook** (`lookbook/`)           | [tinctjs.github.io/tinct/lookbook](https://tinctjs.github.io/tinct/lookbook/)           | Film presets as **pure JSON** — serialized pipelines you can copy, paste, store, and replay with `pipe()`                                              |
| **Shrinkwrap** (`optimizer/`)        | [tinctjs.github.io/tinct/optimizer](https://tinctjs.github.io/tinct/optimizer/)         | Batch upload optimization: EXIF orientation, resize, `maxBytes` compression, watermark overlay, ThumbHash placeholders, dominant colors                |
| **Collage** (`collage/`)             | [tinctjs.github.io/tinct/collage](https://tinctjs.github.io/tinct/collage/)             | Multi-layer documents: `layerAt()` hit testing and `boundsOf()` selection in a drag loop, per-layer pipelines, blend modes, undo/redo, JSON round trip |

Run any of them locally:

```sh
cd examples/avatar-studio   # or lookbook / optimizer / collage
npm install
npm run dev
```

Or open one instantly in StackBlitz:

- https://stackblitz.com/github/tinctjs/tinct/tree/main/examples/avatar-studio
- https://stackblitz.com/github/tinctjs/tinct/tree/main/examples/lookbook
- https://stackblitz.com/github/tinctjs/tinct/tree/main/examples/optimizer
- https://stackblitz.com/github/tinctjs/tinct/tree/main/examples/collage

Built something with Tinct? Add it to the
[showcase discussion](https://github.com/tinctjs/tinct/discussions) — we
feature real apps here.
