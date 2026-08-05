/**
 * Tracked face effects for Booth: recipe builders that turn the current
 * landmarks into imagepipe ops. The tracker calls these ~24×/s; every
 * output is plain JSON, so a snapshot of a tracked frame replays exactly
 * through the still pipeline.
 *
 * Three kinds of effect, all landmark-driven:
 * - stickers (`imagepipe/effects`): drawn art anchored to face geometry
 * - warps (`imagepipe/effects`): dramatic bulge/pinch zone sets
 * - custom shaders (`defineFilter`): Spotlight takes the face center as a
 *   plain-JSON uniform — tracked effects aren't limited to the built-ins
 */
import { defineFilter, type PixelData, type SerializedOp } from 'imagepipe'
import { warp, sticker, stickerSource, type StickerSource } from 'imagepipe/effects'
import { faceRoll, type FaceLandmarks, type LandmarkPoint } from 'imagepipe/track'

const use = (filter: { name: string; options: object }): SerializedOp =>
  ({ op: 'filter', params: { name: filter.name, options: filter.options } }) as SerializedOp

const deg = (radians: number): number => (radians * 180) / Math.PI

/* ------------------------------------------------------------------ */
/* Sticker art — drawn once, cached as serialized sources              */
/* ------------------------------------------------------------------ */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

const sources = new Map<string, StickerSource>()

function art(name: string, w: number, h: number, draw: Draw): StickerSource {
  const cached = sources.get(name)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  draw(ctx, w, h)
  const source = stickerSource(ctx.getImageData(0, 0, w, h) as PixelData)
  sources.set(name, source)
  return source
}

/** Deal-with-it shades: black lenses, shine streak, thick bridge. */
const sunglasses = (): StickerSource =>
  art('sunglasses', 340, 110, (ctx) => {
    ctx.fillStyle = '#0e0d0c'
    // Arms out to the temples
    ctx.fillRect(0, 30, 26, 12)
    ctx.fillRect(314, 30, 26, 12)
    // Bridge
    ctx.fillRect(150, 32, 40, 14)
    for (const x of [22, 186] as const) {
      // Lens body
      ctx.beginPath()
      ctx.roundRect(x, 12, 132, 86, [18, 18, 44, 44])
      ctx.fill()
    }
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    for (const x of [22, 186] as const) {
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x, 12, 132, 86, [18, 18, 44, 44])
      ctx.clip()
      ctx.rotate(-0.5)
      ctx.fillRect(x - 70, 40, 46, 160)
      ctx.fillRect(x - 30, 40, 18, 160)
      ctx.restore()
    }
  })

/** Handlebar mustache. */
const mustache = (): StickerSource =>
  art('mustache', 320, 120, (ctx) => {
    ctx.fillStyle = '#241610'
    for (const flip of [1, -1] as const) {
      ctx.save()
      ctx.translate(160, 34)
      ctx.scale(flip, 1)
      ctx.beginPath()
      ctx.moveTo(0, 18)
      ctx.bezierCurveTo(14, -8, 76, -10, 108, 26)
      ctx.bezierCurveTo(132, 52, 152, 44, 158, 26)
      ctx.bezierCurveTo(156, 70, 112, 78, 84, 58)
      ctx.bezierCurveTo(52, 36, 18, 44, 0, 62)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  })

/** One floppy dog ear (mirrored at use time via two stickers). */
const dogEars = (): StickerSource =>
  art('dog-ears', 360, 170, (ctx) => {
    for (const flip of [1, -1] as const) {
      ctx.save()
      ctx.translate(180, 0)
      ctx.scale(flip, 1)
      // Outer ear
      ctx.fillStyle = '#7a4c28'
      ctx.beginPath()
      ctx.moveTo(96, 26)
      ctx.bezierCurveTo(150, 2, 180, 30, 176, 86)
      ctx.bezierCurveTo(172, 132, 148, 162, 118, 166)
      ctx.bezierCurveTo(96, 168, 84, 148, 88, 112)
      ctx.bezierCurveTo(90, 78, 88, 48, 96, 26)
      ctx.closePath()
      ctx.fill()
      // Inner ear
      ctx.fillStyle = '#c78d58'
      ctx.beginPath()
      ctx.moveTo(112, 52)
      ctx.bezierCurveTo(146, 38, 160, 58, 156, 96)
      ctx.bezierCurveTo(152, 128, 136, 148, 118, 150)
      ctx.bezierCurveTo(106, 150, 102, 134, 106, 108)
      ctx.bezierCurveTo(108, 86, 108, 66, 112, 52)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  })

/** Dog snout: tan muzzle, dark nose, whisker dots. */
const dogSnout = (): StickerSource =>
  art('dog-snout', 220, 150, (ctx) => {
    ctx.fillStyle = '#d9b48f'
    ctx.beginPath()
    ctx.ellipse(110, 84, 96, 62, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#2a1b12'
    ctx.beginPath()
    ctx.ellipse(110, 44, 34, 24, 0, 0, Math.PI * 2)
    ctx.fill()
    // Philtrum + mouth
    ctx.strokeStyle = '#2a1b12'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(110, 66)
    ctx.lineTo(110, 96)
    ctx.moveTo(110, 96)
    ctx.quadraticCurveTo(80, 126, 52, 104)
    ctx.moveTo(110, 96)
    ctx.quadraticCurveTo(140, 126, 168, 104)
    ctx.stroke()
    // Whisker dots
    ctx.fillStyle = '#8a6a4d'
    for (const [x, y] of [
      [58, 74],
      [72, 88],
      [58, 100],
      [162, 74],
      [148, 88],
      [162, 100],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  })

/** Glossy heart for heart-eyes. */
const heart = (): StickerSource =>
  art('heart', 140, 130, (ctx) => {
    ctx.fillStyle = '#e8334a'
    ctx.beginPath()
    ctx.moveTo(70, 122)
    ctx.bezierCurveTo(18, 84, 2, 50, 16, 26)
    ctx.bezierCurveTo(32, 0, 66, 8, 70, 34)
    ctx.bezierCurveTo(74, 8, 108, 0, 124, 26)
    ctx.bezierCurveTo(138, 50, 122, 84, 70, 122)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.beginPath()
    ctx.ellipse(40, 34, 16, 10, -0.6, 0, Math.PI * 2)
    ctx.fill()
  })

/** Crown v2: gold gradient, ball tips, jewels — and the Bore in the band. */
const crown = (): StickerSource =>
  art('crown', 260, 170, (ctx) => {
    const gold = ctx.createLinearGradient(0, 0, 0, 170)
    gold.addColorStop(0, '#f6c453')
    gold.addColorStop(0.6, '#f07818')
    gold.addColorStop(1, '#c2620f')
    ctx.fillStyle = gold
    // Points
    ctx.beginPath()
    ctx.moveTo(18, 120)
    ctx.lineTo(30, 42)
    ctx.lineTo(76, 96)
    ctx.lineTo(130, 22)
    ctx.lineTo(184, 96)
    ctx.lineTo(230, 42)
    ctx.lineTo(242, 120)
    ctx.closePath()
    ctx.fill()
    // Band
    ctx.beginPath()
    ctx.roundRect(14, 116, 232, 44, 10)
    ctx.fill()
    // Ball tips
    for (const [x, y] of [
      [30, 38],
      [130, 18],
      [230, 38],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fill()
    }
    // Jewels on the band
    for (const [x, color] of [
      [62, '#2ec4b6'],
      [198, '#e8334a'],
    ] as const) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, 138, 9, 0, Math.PI * 2)
      ctx.fill()
    }
    // The Bore, bored through the band as a real hole.
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(130, 138, 11, 0, Math.PI * 2)
    ctx.fill()
  })

/* ------------------------------------------------------------------ */
/* Spotlight — a face-anchored custom shader                           */
/* ------------------------------------------------------------------ */

const spotlight = defineFilter<{ center: [number, number]; radius: number }>({
  name: 'booth-spotlight',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec2 p = v_texCoord * u_resolution;
  vec2 center = u_center * u_resolution;
  float r = u_radius * min(u_resolution.x, u_resolution.y);
  float d = distance(p, center) / r;
  float dark = smoothstep(0.7, 1.25, d);
  vec3 lit = c.rgb * vec3(1.07, 1.03, 0.96);
  vec3 shadow = c.rgb * vec3(0.1, 0.09, 0.14);
  outColor = vec4(mix(lit, shadow, dark), c.a);
}
`,
  uniforms: ({ center, radius }) => ({ u_center: center, u_radius: radius }),
  fallback: (pixels, { center, radius }) => {
    const { width, height, data } = pixels
    const cx = center[0] * width
    const cy = center[1] * height
    const r = radius * Math.min(width, height)
    const smooth = (t: number): number => {
      const x = Math.min(1, Math.max(0, (t - 0.7) / 0.55))
      return x * x * (3 - 2 * x)
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const dark = smooth(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r)
        const lit = [1.07, 1.03, 0.96]
        const shadow = [0.1, 0.09, 0.14]
        for (let c = 0; c < 3; c++) {
          const v = data[i + c]!
          data[i + c] = v * lit[c]! + (v * shadow[c]! - v * lit[c]!) * dark
        }
      }
    }
    return pixels
  },
})

/* ------------------------------------------------------------------ */
/* Recipe builders                                                     */
/* ------------------------------------------------------------------ */

const mid = (a: LandmarkPoint, b: LandmarkPoint, t = 0.5): LandmarkPoint => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

function doggo(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw, bh] = face.box
  const roll = deg(faceRoll(face))
  const snoutAt = face.nose
    ? mid(face.nose, face.mouth ?? face.nose, 0.45)
    : mid(face.leftEye, face.rightEye)
  return [
    use(
      sticker({
        source: dogEars(),
        at: [bx + bw / 2, Math.max(0.05, by + bh * 0.02)],
        width: bw * 1.5,
        rotate: roll,
      }),
    ),
    use(sticker({ source: dogSnout(), at: snoutAt, width: bw * 0.52, rotate: roll })),
  ]
}

function shades(face: FaceLandmarks): SerializedOp[] {
  return [
    use(
      sticker({
        source: sunglasses(),
        at: mid(face.leftEye, face.rightEye),
        width: face.box[2] * 0.92,
        rotate: deg(faceRoll(face)),
      }),
    ),
  ]
}

function stache(face: FaceLandmarks): SerializedOp[] {
  const at = face.nose && face.mouth ? mid(face.nose, face.mouth, 0.55) : face.mouth
  if (!at) return []
  return [
    use(
      sticker({ source: mustache(), at, width: face.box[2] * 0.55, rotate: deg(faceRoll(face)) }),
    ),
  ]
}

function heartEyes(face: FaceLandmarks): SerializedOp[] {
  const roll = deg(faceRoll(face))
  const width = face.box[2] * 0.3
  return [
    use(sticker({ source: heart(), at: face.leftEye, width, rotate: roll })),
    use(sticker({ source: heart(), at: face.rightEye, width, rotate: roll })),
  ]
}

function crowned(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw] = face.box
  return [
    use(
      sticker({
        source: crown(),
        at: [bx + bw / 2, Math.max(0.05, by - bw * 0.16)],
        width: bw * 0.95,
        rotate: deg(faceRoll(face)),
      }),
    ),
  ]
}

/**
 * Bulging forehead + saucer eyes + pinched chin. Dramatic on purpose.
 * Radii are sized from the box *height*: the warp radius unit is a
 * fraction of the frame's smaller dimension, which for landscape video
 * is its height — so height-based radii map onto it exactly.
 */
function alien(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, , bh] = face.box
  const cx = bx + face.box[2] / 2
  return [
    use(
      warp({
        zones: [
          { center: [cx, by + bh * 0.2], radius: bh * 0.42, strength: 0.85 },
          { center: face.leftEye, radius: bh * 0.19, strength: 0.95 },
          { center: face.rightEye, radius: bh * 0.19, strength: 0.95 },
          { center: [cx, by + bh * 0.98], radius: bh * 0.26, strength: -0.65 },
        ],
      }),
    ),
  ]
}

/** The whole face, shrunk. */
function tinyFace(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw, bh] = face.box
  return [
    use(
      warp({
        zones: [{ center: [bx + bw / 2, by + bh / 2], radius: bh * 0.55, strength: -0.65 }],
      }),
    ),
  ]
}

function spotlit(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw, bh] = face.box
  return [use(spotlight({ center: [bx + bw / 2, by + bh / 2], radius: bh * 0.62 }))]
}

/** Named tracked looks, shown as chips next to the color presets. */
export const FACE_FX: Record<string, (face: FaceLandmarks) => SerializedOp[]> = {
  Doggo: doggo,
  Shades: shades,
  "'Stache": stache,
  'Heart Eyes': heartEyes,
  Crown: crowned,
  Alien: alien,
  'Tiny Face': tinyFace,
  Spotlight: spotlit,
}

/**
 * Mirror landmarks across the vertical axis — the preview (and snapshots)
 * are mirrored like a real booth, so snapshot recipes need coordinates in
 * the mirrored frame. Left/right eyes swap; roll negates via the swap.
 */
export function mirrorFace(face: FaceLandmarks): FaceLandmarks {
  const mx = (p: LandmarkPoint): LandmarkPoint => [1 - p[0], p[1]]
  const mirrored: FaceLandmarks = {
    leftEye: mx(face.rightEye),
    rightEye: mx(face.leftEye),
    box: [1 - face.box[0] - face.box[2], face.box[1], face.box[2], face.box[3]],
  }
  if (face.nose) mirrored.nose = mx(face.nose)
  if (face.mouth) mirrored.mouth = mx(face.mouth)
  return mirrored
}
