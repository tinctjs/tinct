// Face-gravity evaluation harness.
//
// Runs `locateSubject` over the labeled photo set (fetch.sh) and reports:
//  1. focal accuracy — distance from the focal point to the nearest
//     hand-labeled face center, scored against a per-image threshold;
//  2. crop containment — the product metric: does a 1:1 / 9:16 crop
//     anchored the way `gravity: 'face'` anchors it contain >= 1 face?
//
// Usage:  ./fetch.sh && npm run build && node eval.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { locateSubject } from '../../dist/face/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const labels = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8'))

const decode = (file) => {
  const raw = jpeg.decode(readFileSync(join(here, 'images', file)), {
    useTArray: true,
    maxMemoryUsageInMB: 1024,
  })
  return {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength),
  }
}

let hits = 0
let total = 0

for (const [file, label] of Object.entries(labels)) {
  const pixels = decode(file)
  const focal = locateSubject(pixels)
  const fx = (focal.x / pixels.width).toFixed(2)
  const fy = (focal.y / pixels.height).toFixed(2)

  if (label.negative) {
    console.log(`${file} | focal (${fx}, ${fy}) | negative control`)
    continue
  }

  const minDim = Math.min(pixels.width, pixels.height)
  const threshold = label.faceR * 1.4 * minDim
  let bestDist = Infinity
  for (const [gx, gy] of label.faces) {
    bestDist = Math.min(
      bestDist,
      Math.hypot(focal.x - gx * pixels.width, focal.y - gy * pixels.height),
    )
  }
  const hit = bestDist <= threshold
  if (!label.smoke) {
    total++
    if (hit) hits++
  }

  const contained = [1, 9 / 16].map((aspect) => {
    let cw, ch
    if (pixels.width / pixels.height > aspect) {
      ch = pixels.height
      cw = pixels.height * aspect
    } else {
      cw = pixels.width
      ch = pixels.width / aspect
    }
    const x = Math.max(0, Math.min(pixels.width - cw, focal.x - cw / 2))
    const y = Math.max(0, Math.min(pixels.height - ch, focal.y - ch * 0.42))
    return label.faces.some(([gx, gy]) => {
      const px = gx * pixels.width
      const py = gy * pixels.height
      return px >= x && px <= x + cw && py >= y && py <= y + ch
    })
      ? 'OK'
      : 'FAIL'
  })

  console.log(
    `${file} | focal (${fx}, ${fy}) | dist ${Math.round(bestDist)}px thr ${Math.round(threshold)}px | ` +
      `${hit ? 'HIT' : 'MISS'}${label.smoke ? ' (smoke)' : ''} | crop 1:1=${contained[0]} 9:16=${contained[1]}`,
  )
}

console.log(`\nfocal hit rate: ${hits}/${total}`)
