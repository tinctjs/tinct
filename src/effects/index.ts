/**
 * Anchored effects: geometry-aware filters built for tracked, per-frame use.
 *
 * ```ts
 * import { warp, sticker, stickerSource } from 'imagepipe/effects'
 *
 * image.apply(warp({ zones: [{ center: [0.4, 0.42], radius: 0.1, strength: 0.35 }] }))
 * image.apply(sticker({ source: stickerSource(hat), at: [0.5, 0.18], width: 0.4 }))
 * ```
 *
 * Both effects take **plain-JSON geometry** (normalized 0..1 coordinates),
 * so they serialize into histories like any filter and replay exactly. They
 * are the render half of face effects: a landmark provider (see
 * `imagepipe/track`) computes the geometry per frame, rebuilds the recipe,
 * and hot-swaps it into a live session — the effects neither know nor care
 * where the coordinates came from.
 *
 * Dimensions are never changed: both are color-class ops, so they run in
 * live pipelines.
 *
 * @packageDocumentation
 */

import { defineFilter, type FilterTexture } from '../core/filter'
import type { PixelData } from '../core/pixel'
import { bytesToBase64, decodePixels } from '../core/base64'

/* ------------------------------------------------------------------ */
/* Shared CPU sampling — mirrors GL LINEAR + CLAMP_TO_EDGE             */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Bilinear sample at continuous pixel coordinates, matching GL `LINEAR`
 * with `CLAMP_TO_EDGE`: texel centers sit at integer + 0.5.
 */
function bilinear(pixels: PixelData, fx: number, fy: number, out: number[]): void {
  const { width, height, data } = pixels
  const x = fx - 0.5
  const y = fy - 0.5
  // Clamp each tap independently from the *unclamped* floor: below the
  // first texel GL blends texels -1 and 0 (both edge-clamped to 0), not
  // texels 0 and 1.
  const xf = Math.floor(x)
  const yf = Math.floor(y)
  const x0 = clamp(xf, 0, width - 1)
  const y0 = clamp(yf, 0, height - 1)
  const x1 = clamp(xf + 1, 0, width - 1)
  const y1 = clamp(yf + 1, 0, height - 1)
  const tx = clamp(x - xf, 0, 1)
  const ty = clamp(y - yf, 0, 1)
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * width + x0) * 4 + c]! * (1 - tx) + data[(y0 * width + x1) * 4 + c]! * tx
    const b = data[(y1 * width + x0) * 4 + c]! * (1 - tx) + data[(y1 * width + x1) * 4 + c]! * tx
    out[c] = a * (1 - ty) + b * ty
  }
}

/* ------------------------------------------------------------------ */
/* warp — up to four radial displacement zones                         */
/* ------------------------------------------------------------------ */

/** One radial displacement zone for {@link warp}. */
export type WarpZone = {
  /** Zone center in normalized image coordinates, `[x, y]` in 0..1. */
  center: [number, number]
  /** Zone radius as a fraction of the image's smaller dimension. */
  radius: number
  /**
   * Displacement strength, `-1..1`. Positive magnifies what's under the
   * zone (bulge — bigger eyes); negative pinches it (slimmer contours).
   */
  strength: number
}

export type WarpOptions = {
  /** Up to four zones; extra zones throw. */
  zones: WarpZone[]
}

/** Pack a zone into the vec4 uniform layout `[cx, cy, radius, strength]`. */
const packZone = (zone: WarpZone | undefined): readonly number[] =>
  zone ? [zone.center[0], zone.center[1], zone.radius, zone.strength] : [0, 0, 0, 0]

const WARP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec4 u_zone0;
uniform vec4 u_zone1;
uniform vec4 u_zone2;
uniform vec4 u_zone3;
in vec2 v_texCoord;
out vec4 outColor;
vec2 displace(vec2 p, vec4 zone) {
  if (zone.z <= 0.0 || zone.w == 0.0) return vec2(0.0);
  vec2 c = zone.xy * u_resolution;
  float r = zone.z * min(u_resolution.x, u_resolution.y);
  vec2 d = p - c;
  float t = length(d) / r;
  if (t >= 1.0) return vec2(0.0);
  float f = (1.0 - t) * (1.0 - t);
  return d * (-zone.w) * f;
}
void main() {
  vec2 p = v_texCoord * u_resolution;
  vec2 shifted = p + displace(p, u_zone0) + displace(p, u_zone1)
    + displace(p, u_zone2) + displace(p, u_zone3);
  outColor = texture(u_image, shifted / u_resolution);
}
`

/**
 * Radial displacement warp: up to four zones, each a smooth bulge
 * (`strength > 0`, magnifies) or pinch (`strength < 0`). Displacement
 * fades quadratically to zero at the zone edge, so zones blend into the
 * untouched image with no seam.
 */
export const warp = defineFilter<WarpOptions>({
  name: 'warp',
  linearSource: true,
  fragment: WARP_FRAGMENT,
  uniforms: ({ zones }) => {
    if (zones.length > 4) {
      throw new Error(`imagepipe: warp supports at most 4 zones, got ${String(zones.length)}`)
    }
    return {
      u_zone0: packZone(zones[0]),
      u_zone1: packZone(zones[1]),
      u_zone2: packZone(zones[2]),
      u_zone3: packZone(zones[3]),
    }
  },
  fallback: (pixels, { zones }) => {
    if (zones.length > 4) {
      throw new Error(`imagepipe: warp supports at most 4 zones, got ${String(zones.length)}`)
    }
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    const minDim = Math.min(width, height)
    const sample: number[] = [0, 0, 0, 0]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5
        const py = y + 0.5
        let sx = px
        let sy = py
        for (const zone of zones) {
          if (zone.radius <= 0 || zone.strength === 0) continue
          const cx = zone.center[0] * width
          const cy = zone.center[1] * height
          const dx = px - cx
          const dy = py - cy
          const r = zone.radius * minDim
          const t = Math.hypot(dx, dy) / r
          if (t >= 1) continue
          const f = (1 - t) * (1 - t) * -zone.strength
          sx += dx * f
          sy += dy * f
        }
        bilinear(pixels, sx, sy, sample)
        const i = (y * width + x) * 4
        out[i] = sample[0]!
        out[i + 1] = sample[1]!
        out[i + 2] = sample[2]!
        out[i + 3] = sample[3]!
      }
    }
    return { width, height, data: out }
  },
})

/* ------------------------------------------------------------------ */
/* sticker — composite pixels at a point, scaled and rotated           */
/* ------------------------------------------------------------------ */

/** Serialized sticker pixels: dimensions plus base64 RGBA, like overlay. */
export type StickerSource = {
  width: number
  height: number
  data64: string
}

export type StickerOptions = {
  /** The sticker pixels. Build with {@link stickerSource}. */
  source: StickerSource
  /** Sticker center in normalized image coordinates, `[x, y]` in 0..1. */
  at: [number, number]
  /** Rendered sticker width as a fraction of the image width. */
  width: number
  /** Rotation in degrees, clockwise. @defaultValue 0 */
  rotate?: number
  /** Overall opacity, 0..1. @defaultValue 1 */
  opacity?: number
}

/**
 * Encode sticker pixels for {@link sticker} options. The inline base64
 * keeps recipes self-contained — the same trade-off as `overlay`: a
 * 128×128 sticker adds ~85 kB to a serialized history.
 */
export function stickerSource(image: PixelData): StickerSource {
  return {
    width: image.width,
    height: image.height,
    data64: bytesToBase64(image.data),
  }
}

/**
 * Decode memo: live tracking rebuilds recipes per frame, and a stable
 * `PixelData` identity per `data64` string is what lets the live renderer's
 * texture cache hit instead of re-uploading the sticker on every update.
 */
const decodedStickers = new Map<string, PixelData>()

function decodeSticker(source: StickerSource): PixelData {
  const cached = decodedStickers.get(source.data64)
  if (cached) return cached
  const pixels = decodePixels(source.width, source.height, source.data64, 'sticker source')
  if (decodedStickers.size >= 16) {
    const oldest = decodedStickers.keys().next().value
    if (oldest !== undefined) decodedStickers.delete(oldest)
  }
  decodedStickers.set(source.data64, pixels)
  return pixels
}

const STICKER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_sticker;
uniform vec2 u_resolution;
uniform vec2 u_at;
uniform vec2 u_size;
uniform float u_rotate;
uniform float u_opacity;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 base = texture(u_image, v_texCoord);
  vec2 p = v_texCoord * u_resolution;
  vec2 rel = p - u_at * u_resolution;
  float cs = cos(u_rotate);
  float sn = sin(u_rotate);
  vec2 local = vec2(cs * rel.x + sn * rel.y, -sn * rel.x + cs * rel.y);
  vec2 sizePx = u_size * u_resolution.x;
  vec2 uv = local / sizePx + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = base;
    return;
  }
  vec4 s = texture(u_sticker, uv);
  float a = s.a * u_opacity;
  outColor = vec4(mix(base.rgb, s.rgb, a), max(base.a, a));
}
`

/**
 * Composite sticker pixels over the image at a point, scaled to a fraction
 * of the image width and optionally rotated — without changing dimensions,
 * so it runs live. Transparency in the sticker shows the image through.
 */
export const sticker = defineFilter<StickerOptions>({
  name: 'sticker',
  fragment: STICKER_FRAGMENT,
  linearSource: false,
  uniforms: ({ source, at, width, rotate = 0, opacity = 1 }) => {
    void decodeSticker(source) // validate early: bad data64 throws here, not per frame
    return {
      u_at: at,
      // Both components are fractions of the image *width* (height keeps
      // the sticker's aspect); the shader scales by u_resolution.x.
      u_size: [width, (source.height / source.width) * width],
      u_rotate: (rotate * Math.PI) / 180,
      u_opacity: opacity,
    }
  },
  textures: ({ source }) => [
    { name: 'u_sticker', pixels: decodeSticker(source), linear: true } satisfies FilterTexture,
  ],
  fallback: (pixels, { source, at, width, rotate = 0, opacity = 1 }) => {
    const stickerPixels = decodeSticker(source)
    const { width: w, height: h, data } = pixels
    const renderW = width * w
    const renderH = (source.height / source.width) * renderW
    const rad = (rotate * Math.PI) / 180
    const cs = Math.cos(rad)
    const sn = Math.sin(rad)
    const cx = at[0] * w
    const cy = at[1] * h
    const sample: number[] = [0, 0, 0, 0]
    // Bounding box of the rotated sticker, clamped to the image.
    const half = Math.hypot(renderW, renderH) / 2
    const x0 = Math.max(0, Math.floor(cx - half))
    const x1 = Math.min(w - 1, Math.ceil(cx + half))
    const y0 = Math.max(0, Math.floor(cy - half))
    const y1 = Math.min(h - 1, Math.ceil(cy + half))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const relX = x + 0.5 - cx
        const relY = y + 0.5 - cy
        const localX = cs * relX + sn * relY
        const localY = -sn * relX + cs * relY
        const u = localX / renderW + 0.5
        const v = localY / renderH + 0.5
        if (u < 0 || u > 1 || v < 0 || v > 1) continue
        bilinear(stickerPixels, u * stickerPixels.width, v * stickerPixels.height, sample)
        const a = (sample[3]! / 255) * opacity
        if (a === 0) continue
        const i = (y * w + x) * 4
        data[i] = data[i]! + (sample[0]! - data[i]!) * a
        data[i + 1] = data[i + 1]! + (sample[1]! - data[i + 1]!) * a
        data[i + 2] = data[i + 2]! + (sample[2]! - data[i + 2]!) * a
        data[i + 3] = Math.max(data[i + 3]!, a * 255)
      }
    }
    return pixels
  },
})
