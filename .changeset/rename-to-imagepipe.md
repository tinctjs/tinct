---
'imagepipe': minor
---

Rename: the package formerly published as `tinctjs` is now `imagepipe`. The entry object is `imagepipe` (was `tinct`), the pipeline class is `ImagePipe` (was `TinctImage`), layer types are `PipeDocument`/`PipeLayer`, and subpath entries keep their names (`imagepipe/filters`, `/face`, `/hash`, `/palette`, `/layers`). No behavioral changes; serialized histories and documents from tinctjs replay unchanged.
