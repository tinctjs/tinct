// Rasterize the Tinct mark ("The Dip", assets/logo.svg) to assets/logo-512.png
// for the GitHub org avatar — zero dependencies, in the spirit of the library:
// the mark is redrawn with pixel math (4× supersampled) and encoded with a
// minimal PNG writer over node:zlib.
//
// Usage: node scripts/render-avatar.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT = 512
const SS = 4 // supersampling factor
const S = OUT * SS
const scale = S / 96 // the SVG viewBox is 96×96

// --- the mark, as pixel math ------------------------------------------------

const FRAME = { x: 12 * scale, y: 12 * scale, w: 72 * scale, h: 72 * scale, r: 18 * scale }
const INK = [0x1c, 0x1a, 0x33]
const STOPS = [
  [0, [0x4f, 0x46, 0xe5]],
  [0.55, [0xc0, 0x26, 0xd3]],
  [1, [0xec, 0x48, 0x99]],
]

function insideFrame(x, y) {
  const { x: fx, y: fy, w, h, r } = FRAME
  if (x < fx || y < fy || x > fx + w || y > fy + h) return false
  const cx = Math.max(fx + r, Math.min(fx + w - r, x))
  const cy = Math.max(fy + r, Math.min(fy + h - r, y))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// The meniscus: M8 56 Q20 48 32 56 T56 56 … — a smooth wave around y=56 with
// half-period 12 and amplitude 4 (quadratic chain ≈ sine).
function waveY(x) {
  const u = x / scale
  // Crest at u=20, trough at u=44 — one full period every 48 units, matching
  // the Q/T chain in assets/logo.svg.
  return (56 - 4 * Math.sin(((u - 8) / 48) * 2 * Math.PI)) * scale
}

function dyeColor(y) {
  // Gradient over the dye path's bounding box: y from 48 (top) to 96 (bottom),
  // with stop 0 at the bottom.
  const t = Math.max(0, Math.min(1, (96 * scale - y) / (48 * scale)))
  for (let i = 1; i < STOPS.length; i++) {
    const [t0, c0] = STOPS[i - 1]
    const [t1, c1] = STOPS[i]
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0)
      return [0, 1, 2].map((c) => c0[c] + (c1[c] - c0[c]) * k)
    }
  }
  return STOPS[STOPS.length - 1][1]
}

function samplePixel(x, y) {
  if (!insideFrame(x, y)) return [0, 0, 0, 0]
  if (y >= waveY(x)) return [...dyeColor(y), 255]
  return [...INK, 255]
}

// --- render supersampled, box-filter down ----------------------------------

const big = new Float64Array(S * S * 4)
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const [r, g, b, a] = samplePixel(x + 0.5, y + 0.5)
    const i = (y * S + x) * 4
    big[i] = r
    big[i + 1] = g
    big[i + 2] = b
    big[i + 3] = a
  }
}
const out = Buffer.alloc(OUT * OUT * 4)
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * S + (x * SS + sx)) * 4
        const a = big[i + 3]
        acc[0] += big[i] * a
        acc[1] += big[i + 1] * a
        acc[2] += big[i + 2] * a
        acc[3] += a
      }
    }
    const o = (y * OUT + x) * 4
    const a = acc[3] / (SS * SS)
    out[o] = a > 0 ? Math.round(acc[0] / acc[3]) : 0
    out[o + 1] = a > 0 ? Math.round(acc[1] / acc[3]) : 0
    out[o + 2] = a > 0 ? Math.round(acc[2] / acc[3]) : 0
    out[o + 3] = Math.round(a)
  }
}

// --- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
const crc32 = (buf) => {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(OUT, 0)
ihdr.writeUInt32BE(OUT, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const scanlines = Buffer.alloc(OUT * (OUT * 4 + 1))
for (let y = 0; y < OUT; y++) {
  out.copy(scanlines, y * (OUT * 4 + 1) + 1, y * OUT * 4, (y + 1) * OUT * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(new URL('../assets/logo-512.png', import.meta.url), png)
console.log(`assets/logo-512.png — ${png.length} bytes`)
