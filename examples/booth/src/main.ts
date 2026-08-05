/**
 * Booth — an imagepipe example.
 *
 * The pitch in one line: the serialized recipe that edits a photo runs on
 * live video unchanged. `live(video).pipe(recipe).into(canvas)` renders the
 * webcam through WebGL2 fragment passes per frame (no readback), recipes
 * hot-swap mid-stream, and the 📸 button replays the *same JSON* through the
 * still pipeline at full camera resolution — one recipe, still or live.
 *
 * No camera (or permission declined)? An animated canvas scene steps in:
 * live sessions accept canvas sources too.
 */
import { imagepipe, type AdjustOptions, type SerializedHistory, type SerializedOp } from 'imagepipe'
import { live, type LiveSession, type LiveSource } from 'imagepipe/live'
import { trackFace, type LandmarkProvider, type TrackHandle } from 'imagepipe/track'
import { FACE_FX, mirrorFace } from './facefx'
import { createFaceProvider } from './landmarks'
// The registry rule: a filter's code ships iff it is imported *and used* —
// the presets below are built from these factories, which both registers
// the filters and keeps them in the bundle.
import { grayscale, pixelate, posterize, vignette } from 'imagepipe/filters'
// The headliners: custom shader filters defined in this app (see fx.ts).
// `defineFilter` + a fragment shader is all it takes to run live.
import { beautify, crt, halftone, kaleido, neon, thermal } from './fx'

/** Serialize a configured filter into its history op. */
const use = (filter: { name: string; options: object }): SerializedOp =>
  ({ op: 'filter', params: { name: filter.name, options: filter.options } }) as SerializedOp
const adjust = (params: AdjustOptions): SerializedOp => ({ op: 'adjust', params })

/**
 * Live-safe presets: `adjust` plus filters that ship a fragment shader.
 * (A recipe with `curves` or geometry ops would throw at `pipe()` — live
 * pipelines are color-only, validated up front.)
 */
const PRESETS: Record<string, SerializedHistory> = {
  Original: { version: 1, ops: [] },
  Beautify: {
    version: 1,
    ops: [use(beautify({ amount: 0.85 })), adjust({ brightness: 0.03, temperature: 0.05 })],
  },
  Comic: {
    version: 1,
    ops: [adjust({ contrast: 0.15 }), use(halftone({ size: 10 }))],
  },
  Neon: {
    version: 1,
    ops: [use(neon({ color: '#39ff14', boost: 2.2 }))],
  },
  CRT: {
    version: 1,
    ops: [adjust({ saturation: 0.2 }), use(crt({ curvature: 0.07 }))],
  },
  Prism: {
    version: 1,
    ops: [use(kaleido({ segments: 6 })), adjust({ saturation: 0.25 })],
  },
  Thermal: {
    version: 1,
    ops: [use(thermal({}))],
  },
  'Neon Rose': {
    version: 1,
    ops: [use(neon({ color: '#ff2d78', boost: 2.6 }))],
  },
  Noir: {
    version: 1,
    ops: [
      adjust({ contrast: 0.18 }),
      use(grayscale({ amount: 1 })),
      use(vignette({ amount: 0.45, radius: 0.6, color: '#000000' })),
    ],
  },
  'Pop Art': {
    version: 1,
    ops: [adjust({ saturation: 0.5 }), use(posterize({ levels: 5 }))],
  },
  Arcade: {
    version: 1,
    ops: [use(pixelate({ size: 9 })), adjust({ saturation: 0.3, contrast: 0.1 })],
  },
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const view = $('view') as HTMLCanvasElement
const looksRow = $('looks')
const fxRow = $('facefx')
const note = $('note')
const strip = $('strip')

let session: LiveSession | null = null
let source: LiveSource | null = null
let usingCamera = false
let activeName = 'Comic'
let provider: LandmarkProvider | null = null
let tracking: TrackHandle | null = null
let activeFx: string | null = null

/** Animated fallback scene — also demos live canvas sources. */
function demoScene(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 540
  const ctx = canvas.getContext('2d')!
  const balls = Array.from({ length: 7 }, (_, i) => ({
    x: 120 + i * 110,
    y: 140 + (i % 3) * 120,
    vx: 1.6 + (i % 4) * 0.7,
    vy: 1.1 + (i % 3) * 0.9,
    r: 34 + (i % 3) * 22,
    hue: [26, 204, 350, 46, 168, 288, 12][i]!,
  }))
  const draw = (): void => {
    const sky = ctx.createLinearGradient(0, 0, 0, 540)
    sky.addColorStop(0, '#243b55')
    sky.addColorStop(1, '#141e30')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 960, 540)
    for (const b of balls) {
      b.x += b.vx
      b.y += b.vy
      if (b.x < b.r || b.x > 960 - b.r) b.vx *= -1
      if (b.y < b.r || b.y > 540 - b.r) b.vy *= -1
      ctx.fillStyle = `hsl(${b.hue} 70% 60%)`
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
    requestAnimationFrame(draw)
  }
  draw()
  return canvas
}

async function cameraSource(): Promise<HTMLVideoElement> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  })
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return video
}

/** The full current recipe: active color look + active tracked effect. */
function trackedRecipe(face: Parameters<(typeof FACE_FX)[string]>[0] | null): SerializedHistory {
  const base = PRESETS[activeName]!.ops
  if (!face || !activeFx) return { version: 1, ops: [...base] }
  return { version: 1, ops: [...base, ...FACE_FX[activeFx]!(face)] }
}

function selectPreset(name: string): void {
  activeName = name
  // With tracking active the next tick re-applies look + fx together.
  if (!tracking) session?.update(PRESETS[name]!)
  for (const el of looksRow.children) el.classList.toggle('active', el.id === `look-${name}`)
}

function selectFx(name: string | null): void {
  activeFx = name
  for (const el of fxRow.children) {
    el.classList.toggle('active', el.id === `fx-${name ?? ''}`)
  }
  if (!name) {
    tracking?.stop()
    tracking = null
    session?.update(PRESETS[activeName]!)
    return
  }
  if (!tracking && session && provider) {
    tracking = trackFace(session, provider, trackedRecipe, {
      hz: 24,
      smoothing: 0.45,
      onError: () => {
        note.textContent = 'Face detection hiccuped — still trying.'
      },
    })
  }
}

async function enableFaceFx(video: HTMLVideoElement): Promise<void> {
  note.textContent = 'Loading the face model (~3 MB, first visit only)…'
  try {
    provider = await createFaceProvider(video)
  } catch {
    note.textContent = 'Face FX unavailable — the landmark model failed to load.'
    return
  }
  buildFxChips()
  fxRow.hidden = false
  note.textContent =
    'Live from your camera — nothing leaves this page. Combine a look with a face effect.'
}

function buildFxChips(): void {
  const off = document.createElement('button')
  off.className = 'chip'
  off.id = 'fx-'
  off.textContent = 'Off'
  off.classList.add('active')
  off.addEventListener('click', () => {
    selectFx(null)
  })
  fxRow.append(off)
  for (const name of Object.keys(FACE_FX)) {
    const chip = document.createElement('button')
    chip.className = 'chip'
    chip.id = `fx-${name}`
    chip.textContent = name
    chip.addEventListener('click', () => {
      selectFx(name)
    })
    fxRow.append(chip)
  }
}

function buildChips(): void {
  for (const name of Object.keys(PRESETS)) {
    const chip = document.createElement('button')
    chip.className = 'chip'
    chip.id = `look-${name}`
    chip.textContent = name
    chip.addEventListener('click', () => {
      selectPreset(name)
    })
    looksRow.append(chip)
  }
}

/** Full-resolution still of the current frame, through the *same* recipe. */
async function snap(): Promise<void> {
  if (!source) return
  // Freeze the frame: draw the source onto a plain canvas at native size.
  const current = source
  const width = current instanceof HTMLVideoElement ? current.videoWidth : current.width
  const height = current instanceof HTMLVideoElement ? current.videoHeight : current.height
  if (!width || !height) return
  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  const ctx = frame.getContext('2d')!
  if (usingCamera) {
    // Match the mirrored preview so the photo is what you saw.
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source as CanvasImageSource, 0, 0)

  // Same JSON, still pipeline: load → pipe(recipe) → encode. Tracked
  // effects bake the current landmarks in — mirrored to match the
  // mirrored preview — so the photo is exactly what you saw.
  const face = tracking?.latest ?? null
  const recipe = trackedRecipe(face && usingCamera ? mirrorFace(face) : face)
  const image = await imagepipe.load(frame)
  const blob = await image.pipe(recipe).toBlob({ format: 'webp', quality: 0.92 })

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `booth-${activeName.toLowerCase().replace(/\s+/g, '-')}.webp`
  const img = document.createElement('img')
  img.src = link.href
  img.alt = `Snapshot with the ${activeName} preset`
  link.append(img)
  strip.prepend(link)
}

async function start(): Promise<void> {
  buildChips()
  try {
    source = await cameraSource()
    usingCamera = true
    view.classList.add('mirrored')
    note.textContent = 'Live from your camera — nothing leaves this page. Swap looks mid-stream.'
    void enableFaceFx(source)
  } catch {
    source = demoScene()
    note.textContent = 'No camera, so an animated canvas is the live source — same API either way.'
  }

  session = live(source).pipe(PRESETS[activeName]!).into(view)
  selectPreset(activeName)

  const mode = $('mode')
  const fps = $('fps')
  setInterval(() => {
    if (!session) return
    const stats = session.stats
    mode.textContent = stats.mode === 'gpu' ? 'GPU · texture-resident' : 'CPU fallback'
    fps.textContent = String(stats.fps)
  }, 500)
}

$('snap').addEventListener('click', () => {
  void snap()
})

void start()
