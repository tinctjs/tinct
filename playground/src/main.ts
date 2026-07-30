/**
 * Tinct playground — a manual test bed exercising every v0.1 operation
 * through the public package API (`tinctjs` / `tinctjs/filters`).
 */
import { tinct, type TinctImage, type SerializedOp, type Gravity, type ResizeKernel } from 'tinctjs'
import {
  grayscale,
  sepia,
  invert,
  blur,
  sharpen,
  pixelate,
  vignette,
  duotone,
  noise,
  posterize,
} from 'tinctjs/filters'
import { enableFaceGravity } from 'tinctjs/face'

enableFaceGravity()

/* ---------------------------------- state --------------------------------- */

const state = {
  crop: { enabled: false, aspect: '16:9', gravity: 'center' as Gravity },
  resize: { enabled: false, width: 1280, kernel: 'auto' as ResizeKernel },
  rotate: { angle: 0, background: '#000000' },
  flipH: false,
  flipV: false,
  adjust: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, hue: 0, gamma: 1 },
  filters: {
    grayscale: { enabled: false, amount: 1 },
    sepia: { enabled: false, amount: 1 },
    invert: { enabled: false },
    blur: { enabled: false, radius: 4 },
    sharpen: { enabled: false, amount: 0.5 },
    pixelate: { enabled: false, size: 8 },
    vignette: { enabled: false, amount: 0.5, radius: 0.75 },
    duotone: { enabled: false, shadows: '#1e3a5f', highlights: '#f5d0a9' },
    noise: { enabled: false, amount: 0.1, seed: 0 },
    posterize: { enabled: false, levels: 4 },
  },
}

const defaults = JSON.parse(JSON.stringify(state)) as typeof state

let original: TinctImage | null = null
let detachProgress: (() => void) | null = null

/* ------------------------------- pipeline --------------------------------- */

function buildPipeline(image: TinctImage): TinctImage {
  let p = image
  if (state.crop.enabled)
    p = p.crop({ aspect: state.crop.aspect as `${number}:${number}`, gravity: state.crop.gravity })
  if (state.resize.enabled) p = p.resize({ width: state.resize.width, kernel: state.resize.kernel })
  if (state.rotate.angle !== 0)
    p = p.rotate(state.rotate.angle, { background: state.rotate.background })
  if (state.flipH) p = p.flip('horizontal')
  if (state.flipV) p = p.flip('vertical')
  const a = state.adjust
  if (a.brightness || a.contrast || a.saturation || a.exposure || a.hue || a.gamma !== 1) {
    p = p.adjust({ ...a })
  }
  const f = state.filters
  if (f.grayscale.enabled) p = p.apply(grayscale({ amount: f.grayscale.amount }))
  if (f.sepia.enabled) p = p.apply(sepia({ amount: f.sepia.amount }))
  if (f.invert.enabled) p = p.apply(invert())
  if (f.blur.enabled) p = p.apply(blur({ radius: f.blur.radius }))
  if (f.sharpen.enabled) p = p.apply(sharpen({ amount: f.sharpen.amount }))
  if (f.pixelate.enabled) p = p.apply(pixelate({ size: f.pixelate.size }))
  if (f.vignette.enabled)
    p = p.apply(vignette({ amount: f.vignette.amount, radius: f.vignette.radius }))
  if (f.duotone.enabled)
    p = p.apply(duotone({ shadows: f.duotone.shadows, highlights: f.duotone.highlights }))
  if (f.noise.enabled) p = p.apply(noise({ amount: f.noise.amount, seed: f.noise.seed }))
  if (f.posterize.enabled) p = p.apply(posterize({ levels: f.posterize.levels }))
  return p
}

/* -------------------------------- rendering ------------------------------- */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const preview = $('#preview'.slice(1))
const progressBar = $<HTMLProgressElement>('progress')
const timing = $('timing')
const dims = $('dims')
const historyView = $('history')

let renderTimer: number | undefined
let rendering = false
let renderQueued = false

function scheduleRender(): void {
  window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => void render(), 120)
}

async function render(): Promise<void> {
  if (!original) return
  if (rendering) {
    renderQueued = true
    return
  }
  rendering = true
  try {
    const pipeline = buildPipeline(original)
    historyView.textContent = JSON.stringify(pipeline.history(), null, 2)
    const started = performance.now()
    const canvas = await pipeline.toCanvas()
    const elapsed = performance.now() - started
    timing.textContent = `render: ${elapsed.toFixed(1)} ms`
    dims.textContent = `${String(canvas.width)} × ${String(canvas.height)}`
    preview.replaceChildren(canvas)
  } catch (error) {
    timing.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    rendering = false
    if (renderQueued) {
      renderQueued = false
      scheduleRender()
    }
  }
}

async function loadSource(source: File | HTMLCanvasElement): Promise<void> {
  detachProgress?.()
  original = await tinct.load(source)
  detachProgress = original.on('progress', ({ pct }) => {
    progressBar.value = pct
  })
  scheduleRender()
}

/* --------------------------- control construction ------------------------- */

type Panel = { title: string; controls: HTMLElement[] }

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('label')
  const value = document.createElement('span')
  value.className = 'value'
  value.textContent = String(get())
  wrap.append(`${label} `, value)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(get())
  input.addEventListener('input', () => {
    set(Number(input.value))
    value.textContent = input.value
    scheduleRender()
  })
  wrap.append(input)
  return wrap
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const wrap = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = get()
  input.addEventListener('change', () => {
    set(input.checked)
    scheduleRender()
  })
  wrap.append(input, ` ${label}`)
  return wrap
}

function select(
  label: string,
  options: readonly string[],
  get: () => string,
  set: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.textContent = label
  const el = document.createElement('select')
  for (const option of options) {
    const o = document.createElement('option')
    o.value = option
    o.textContent = option
    el.append(o)
  }
  el.value = get()
  el.addEventListener('change', () => {
    set(el.value)
    scheduleRender()
  })
  wrap.append(el)
  return wrap
}

function color(label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const wrap = document.createElement('label')
  wrap.textContent = label
  const input = document.createElement('input')
  input.type = 'color'
  input.value = get()
  input.addEventListener('input', () => {
    set(input.value)
    scheduleRender()
  })
  wrap.append(input)
  return wrap
}

function buildPanels(): void {
  const panels: Panel[] = [
    {
      title: 'Crop',
      controls: [
        checkbox(
          'Enable crop',
          () => state.crop.enabled,
          (v) => (state.crop.enabled = v),
        ),
        select(
          'Aspect',
          ['16:9', '4:3', '1:1', '3:2', '9:16'],
          () => state.crop.aspect,
          (v) => (state.crop.aspect = v),
        ),
        select(
          'Gravity',
          [
            'center',
            'face',
            'north',
            'south',
            'east',
            'west',
            'north-east',
            'north-west',
            'south-east',
            'south-west',
          ],
          () => state.crop.gravity,
          (v) => (state.crop.gravity = v as Gravity),
        ),
      ],
    },
    {
      title: 'Resize',
      controls: [
        checkbox(
          'Enable resize',
          () => state.resize.enabled,
          (v) => (state.resize.enabled = v),
        ),
        slider(
          'Width',
          64,
          2048,
          16,
          () => state.resize.width,
          (v) => (state.resize.width = v),
        ),
        select(
          'Kernel',
          ['auto', 'lanczos', 'triangle', 'nearest'],
          () => state.resize.kernel,
          (v) => (state.resize.kernel = v as ResizeKernel),
        ),
      ],
    },
    {
      title: 'Rotate & flip',
      controls: [
        slider(
          'Angle',
          -180,
          180,
          1,
          () => state.rotate.angle,
          (v) => (state.rotate.angle = v),
        ),
        color(
          'Background',
          () => state.rotate.background,
          (v) => (state.rotate.background = v),
        ),
        checkbox(
          'Flip horizontal',
          () => state.flipH,
          (v) => (state.flipH = v),
        ),
        checkbox(
          'Flip vertical',
          () => state.flipV,
          (v) => (state.flipV = v),
        ),
      ],
    },
    {
      title: 'Adjust',
      controls: [
        slider(
          'Brightness',
          -1,
          1,
          0.01,
          () => state.adjust.brightness,
          (v) => (state.adjust.brightness = v),
        ),
        slider(
          'Contrast',
          -1,
          1,
          0.01,
          () => state.adjust.contrast,
          (v) => (state.adjust.contrast = v),
        ),
        slider(
          'Saturation',
          -1,
          1,
          0.01,
          () => state.adjust.saturation,
          (v) => (state.adjust.saturation = v),
        ),
        slider(
          'Exposure',
          -1,
          1,
          0.01,
          () => state.adjust.exposure,
          (v) => (state.adjust.exposure = v),
        ),
        slider(
          'Hue',
          -180,
          180,
          1,
          () => state.adjust.hue,
          (v) => (state.adjust.hue = v),
        ),
        slider(
          'Gamma',
          0.1,
          4,
          0.05,
          () => state.adjust.gamma,
          (v) => (state.adjust.gamma = v),
        ),
      ],
    },
    {
      title: 'Filters',
      controls: [
        checkbox(
          'Grayscale',
          () => state.filters.grayscale.enabled,
          (v) => (state.filters.grayscale.enabled = v),
        ),
        slider(
          '· amount',
          0,
          1,
          0.05,
          () => state.filters.grayscale.amount,
          (v) => (state.filters.grayscale.amount = v),
        ),
        checkbox(
          'Sepia',
          () => state.filters.sepia.enabled,
          (v) => (state.filters.sepia.enabled = v),
        ),
        slider(
          '· amount',
          0,
          1,
          0.05,
          () => state.filters.sepia.amount,
          (v) => (state.filters.sepia.amount = v),
        ),
        checkbox(
          'Invert',
          () => state.filters.invert.enabled,
          (v) => (state.filters.invert.enabled = v),
        ),
        checkbox(
          'Blur',
          () => state.filters.blur.enabled,
          (v) => (state.filters.blur.enabled = v),
        ),
        slider(
          '· radius',
          0,
          20,
          0.5,
          () => state.filters.blur.radius,
          (v) => (state.filters.blur.radius = v),
        ),
        checkbox(
          'Sharpen',
          () => state.filters.sharpen.enabled,
          (v) => (state.filters.sharpen.enabled = v),
        ),
        slider(
          '· amount',
          0,
          1,
          0.05,
          () => state.filters.sharpen.amount,
          (v) => (state.filters.sharpen.amount = v),
        ),
        checkbox(
          'Pixelate',
          () => state.filters.pixelate.enabled,
          (v) => (state.filters.pixelate.enabled = v),
        ),
        slider(
          '· size',
          2,
          48,
          1,
          () => state.filters.pixelate.size,
          (v) => (state.filters.pixelate.size = v),
        ),
        checkbox(
          'Vignette',
          () => state.filters.vignette.enabled,
          (v) => (state.filters.vignette.enabled = v),
        ),
        slider(
          '· amount',
          0,
          1,
          0.05,
          () => state.filters.vignette.amount,
          (v) => (state.filters.vignette.amount = v),
        ),
        slider(
          '· radius',
          0,
          1,
          0.05,
          () => state.filters.vignette.radius,
          (v) => (state.filters.vignette.radius = v),
        ),
        checkbox(
          'Duotone',
          () => state.filters.duotone.enabled,
          (v) => (state.filters.duotone.enabled = v),
        ),
        color(
          '· shadows',
          () => state.filters.duotone.shadows,
          (v) => (state.filters.duotone.shadows = v),
        ),
        color(
          '· highlights',
          () => state.filters.duotone.highlights,
          (v) => (state.filters.duotone.highlights = v),
        ),
        checkbox(
          'Noise',
          () => state.filters.noise.enabled,
          (v) => (state.filters.noise.enabled = v),
        ),
        slider(
          '· amount',
          0,
          1,
          0.02,
          () => state.filters.noise.amount,
          (v) => (state.filters.noise.amount = v),
        ),
        slider(
          '· seed',
          0,
          100,
          1,
          () => state.filters.noise.seed,
          (v) => (state.filters.noise.seed = v),
        ),
        checkbox(
          'Posterize',
          () => state.filters.posterize.enabled,
          (v) => (state.filters.posterize.enabled = v),
        ),
        slider(
          '· levels',
          2,
          16,
          1,
          () => state.filters.posterize.levels,
          (v) => (state.filters.posterize.levels = v),
        ),
      ],
    },
  ]

  const host = $('panels')
  host.replaceChildren()
  for (const [index, panel] of panels.entries()) {
    const details = document.createElement('details')
    details.open = index < 2
    const summary = document.createElement('summary')
    summary.textContent = panel.title
    details.append(summary, ...panel.controls)
    host.append(details)
  }
}

/* --------------------------------- wiring --------------------------------- */

function showCapabilities(): void {
  const caps = tinct.capabilities()
  const host = $('capabilities')
  host.replaceChildren(
    ...Object.entries(caps).map(([name, on]) => {
      const badge = document.createElement('span')
      badge.className = on ? 'badge on' : 'badge'
      badge.textContent = name
      return badge
    }),
  )
}

function sampleImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const sky = ctx.createLinearGradient(0, 0, 0, 640)
  sky.addColorStop(0, '#1c3f6e')
  sky.addColorStop(0.6, '#e2725b')
  sky.addColorStop(1, '#f5c26b')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 960, 640)
  ctx.fillStyle = '#f8e9b0'
  ctx.beginPath()
  ctx.arc(700, 220, 70, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#10131a'
  for (const [x, w, h] of [
    [60, 90, 260],
    [180, 70, 340],
    [280, 110, 220],
    [420, 80, 390],
    [530, 120, 300],
    [680, 90, 250],
    [800, 100, 330],
  ] as const) {
    ctx.fillRect(x, 640 - h, w, h)
    ctx.fillStyle = '#ffd97a'
    for (let wy = 640 - h + 18; wy < 620; wy += 34) {
      for (let wx = x + 12; wx < x + w - 12; wx += 26) {
        if ((wx * wy) % 7 < 4) ctx.fillRect(wx, wy, 8, 12)
      }
    }
    ctx.fillStyle = '#10131a'
  }
  return canvas
}

function wire(): void {
  showCapabilities()
  buildPanels()

  $<HTMLInputElement>('file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) void loadSource(file)
  })
  $('sample').addEventListener('click', () => void loadSource(sampleImage()))

  const quality = $<HTMLInputElement>('quality')
  quality.addEventListener('input', () => {
    $('quality-value').textContent = quality.value
  })

  $('download').addEventListener('click', () => {
    void (async () => {
      if (!original) return
      const format = $<HTMLSelectElement>('format').value as 'png' | 'jpeg' | 'webp'
      const blob = await buildPipeline(original).toBlob({ format, quality: Number(quality.value) })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tinct-export.${format === 'jpeg' ? 'jpg' : format}`
      a.click()
      URL.revokeObjectURL(url)
    })()
  })

  $('replay').addEventListener('click', () => {
    void (async () => {
      if (!original) return
      const ops = JSON.parse(historyView.textContent ?? '[]') as SerializedOp[]
      const started = performance.now()
      const canvas = await original.pipe(ops).toCanvas()
      timing.textContent = `replayed via .pipe(): ${(performance.now() - started).toFixed(1)} ms`
      preview.replaceChildren(canvas)
    })()
  })

  $('reset').addEventListener('click', () => {
    Object.assign(state, JSON.parse(JSON.stringify(defaults)))
    buildPanels()
    scheduleRender()
  })

  void loadSource(sampleImage())
}

wire()
