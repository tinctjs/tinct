// Rasterize the imagepipe mark ("The Bore", assets/logo.svg) to
// assets/logo-512.png for the GitHub/npm org avatars — zero dependencies:
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

const BLOCK = { x: 14 * scale, y: 14 * scale, w: 68 * scale, h: 68 * scale, r: 17 * scale }
const BORE = { cx: 58 * scale, cy: 48 * scale, r: 16 * scale }
const AMBER = [0xf0, 0x78, 0x18]

function insideBlock(x, y) {
  const { x: bx, y: by, w, h, r } = BLOCK
  if (x < bx || y < by || x > bx + w || y > by + h) return false
  const cx = Math.max(bx + r, Math.min(bx + w - r, x))
  const cy = Math.max(by + r, Math.min(by + h - r, y))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function insideBore(x, y) {
  return (x - BORE.cx) ** 2 + (y - BORE.cy) ** 2 <= BORE.r * BORE.r
}

function samplePixel(x, y) {
  if (!insideBlock(x, y) || insideBore(x, y)) return [0, 0, 0, 0]
  return [...AMBER, 255]
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
