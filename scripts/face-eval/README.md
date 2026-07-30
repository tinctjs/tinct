# Face-gravity evaluation

An empirical harness for `gravity: 'face'` (`src/face/detect.ts`). The
detector is a deterministic heuristic, so every change should be measured
here, not eyeballed.

```sh
./fetch.sh        # downloads the labeled test photos (not committed)
npm run build     # eval runs against dist
node eval.mjs
```

The set is [dlib's `examples/faces`](https://github.com/davisking/dlib/tree/master/examples/faces)
(12 photos: groups, portraits, hard backgrounds, a no-face control), with
face centers hand-labeled in `labels.json` as fractions of width/height.

Two metrics:

- **focal hit rate** — focal point within `1.4 × faceR × minDim` of a
  labeled face center. Current: **9/10** scored images.
- **crop containment** — the product metric: does the crop window that
  `gravity: 'face'` would produce (1:1 and 9:16) contain at least one face?
  Current: **22/22**.

Learnings already encoded in the detector (see comments in
`src/face/detect.ts`): feature energy on skin separates faces from bare
arms/chests; `g > b` rejects crimson fabric; a channel-span cap rejects gold
lamé without excluding darker skin tones; near-solid "skin" density is
fabric, not a face; the focal refines to the feature-weighted centroid of the
window's upper portion.

When adding images, prefer failure cases (skin-toned backgrounds, saturated
warm clothing, group shots) and label every face, not just the main one.
