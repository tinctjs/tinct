# tinctjs

## 0.1.0

### Minor Changes

- e3b86f8: Initial release. Chainable immutable pipelines with versioned history serialization and replay; loaders (EXIF auto-orientation, metadata stripped) and exporters (PNG/JPEG/WebP, target-byte-size encoding, cancellable via AbortSignal); geometry incl. Lanczos resampling and straighten (rotate trim); eight adjustments incl. temperature/tint; twelve built-in filters incl. serializable curves and median denoise; watermark overlay; custom filters via defineFilter (CPU + multi-pass WebGL2); incremental re-render caching; worker offloading; content-aware face cropping (tinctjs/face); ThumbHash placeholders (tinctjs/hash); palette extraction (tinctjs/palette). GPU output is parity-tested against the CPU reference in headless Chromium.
