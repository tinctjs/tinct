/**
 * Tracked face effects for Booth: recipe builders that turn the current
 * landmarks into imagepipe/effects ops. The tracker calls these ~15×/s;
 * every output is plain JSON, so a snapshot of a tracked frame replays
 * exactly through the still pipeline.
 */
import { warp, sticker, stickerSource, type StickerSource } from 'imagepipe/effects'
import { faceRoll, type FaceLandmarks } from 'imagepipe/track'
import type { SerializedOp } from 'imagepipe'

const use = (filter: { name: string; options: object }): SerializedOp =>
  ({ op: 'filter', params: { name: filter.name, options: filter.options } }) as SerializedOp

/** The amber crown, drawn locally — with the Bore as its center jewel. */
function crownPixels(): ImageData {
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 96
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f07818'
  // Band
  ctx.fillRect(12, 68, 136, 20)
  // Three points
  for (const [x0, tip] of [
    [12, 36],
    [58, 12],
    [104, 36],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x0, 70)
    ctx.lineTo(x0 + 22, tip)
    ctx.lineTo(x0 + 44, 70)
    ctx.closePath()
    ctx.fill()
  }
  // The Bore, bored through the band as a real hole.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(80, 78, 7, 0, Math.PI * 2)
  ctx.fill()
  return ctx.getImageData(0, 0, 160, 96)
}

let crown: StickerSource | null = null
const crownSource = (): StickerSource => (crown ??= stickerSource(crownPixels()))

const deg = (radians: number): number => (radians * 180) / Math.PI

/** Eye bulge zones sized from the face box. */
function bigEyes(face: FaceLandmarks): SerializedOp[] {
  const radius = Math.max(0.02, face.box[2] * 0.16)
  return [
    use(
      warp({
        zones: [face.leftEye, face.rightEye].map((eye) => ({
          center: eye,
          radius,
          strength: 0.4,
        })),
      }),
    ),
  ]
}

/** Cheek pinch zones — slimmer lower face. */
function slim(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw, bh] = face.box
  const cheekY = by + bh * 0.72
  const radius = Math.max(0.02, bw * 0.22)
  return [
    use(
      warp({
        zones: [
          { center: [bx + bw * 0.08, cheekY], radius, strength: -0.25 },
          { center: [bx + bw * 0.92, cheekY], radius, strength: -0.25 },
        ],
      }),
    ),
  ]
}

/** The crown, riding above the head and tilting with it. */
function crowned(face: FaceLandmarks): SerializedOp[] {
  const [bx, by, bw] = face.box
  return [
    use(
      sticker({
        source: crownSource(),
        at: [bx + bw / 2, Math.max(0.04, by - bw * 0.14)],
        width: bw * 1.05,
        rotate: deg(faceRoll(face)),
      }),
    ),
  ]
}

/** Named tracked looks, shown as chips next to the color presets. */
export const FACE_FX: Record<string, (face: FaceLandmarks) => SerializedOp[]> = {
  'Big Eyes': bigEyes,
  Slim: slim,
  Crown: crowned,
  Royal: (face) => [...bigEyes(face), ...crowned(face)],
}

/**
 * Mirror landmarks across the vertical axis — the preview (and snapshots)
 * are mirrored like a real booth, so snapshot recipes need coordinates in
 * the mirrored frame. Left/right eyes swap; roll negates via the swap.
 */
export function mirrorFace(face: FaceLandmarks): FaceLandmarks {
  const mx = (p: [number, number]): [number, number] => [1 - p[0], p[1]]
  const mirrored: FaceLandmarks = {
    leftEye: mx(face.rightEye),
    rightEye: mx(face.leftEye),
    box: [1 - face.box[0] - face.box[2], face.box[1], face.box[2], face.box[3]],
  }
  if (face.nose) mirrored.nose = mx(face.nose)
  if (face.mouth) mirrored.mouth = mx(face.mouth)
  return mirrored
}
