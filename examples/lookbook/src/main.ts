/**
 * Lookbook — a imagepipe example.
 *
 * The whole point: a "filter preset" is a serialized pipeline. These are
 * plain JSON objects you could store in a database, ship from an API, or
 * let users trade — and `image.pipe(preset)` replays them identically on
 * any device.
 */
import {
  imagepipe,
  type AdjustOptions,
  type SerializedHistory,
  type SerializedOp,
  type ImagePipe,
} from 'imagepipe'
// The registry rule: a filter's code ships iff it is imported *and used*.
// The presets are built from these factories — that registers the filters
// and keeps them in the bundle (a bare `void curves` reference is a pure
// expression bundlers are free to drop, along with the import).
import { curves, duotone, grayscale, noise, vignette } from 'imagepipe/filters'

/** Serialize a configured filter into its history op. */
const use = (filter: { name: string; options: object }): SerializedOp =>
  ({ op: 'filter', params: { name: filter.name, options: filter.options } }) as SerializedOp
const adjust = (params: AdjustOptions): SerializedOp => ({ op: 'adjust', params })

const PRESETS: Record<string, SerializedHistory> = {
  Original: { version: 1, ops: [] },
  'Golden Hour': {
    version: 1,
    ops: [
      adjust({ temperature: 0.4, saturation: 0.15, gamma: 0.95 }),
      use(
        curves({
          rgb: [
            [0, 18],
            [130, 142],
            [255, 248],
          ],
        }),
      ),
      use(vignette({ amount: 0.3, radius: 0.7, color: '#000000' })),
    ],
  },
  'Faded Film': {
    version: 1,
    ops: [
      adjust({ contrast: -0.12, saturation: -0.2, tint: 0.12 }),
      use(
        curves({
          rgb: [
            [0, 34],
            [128, 132],
            [255, 236],
          ],
        }),
      ),
      use(noise({ amount: 0.05, monochrome: true, seed: 7 })),
    ],
  },
  'Silver Gelatin': {
    version: 1,
    ops: [
      use(grayscale({ amount: 1 })),
      use(
        curves({
          rgb: [
            [0, 8],
            [96, 74],
            [190, 214],
            [255, 252],
          ],
        }),
      ),
      use(noise({ amount: 0.07, monochrome: true, seed: 3 })),
      use(vignette({ amount: 0.4, radius: 0.6, color: '#000000' })),
    ],
  },
  Cyanotype: {
    version: 1,
    ops: [
      use(duotone({ shadows: '#0b2545', highlights: '#e8f1f2' })),
      use(
        curves({
          rgb: [
            [0, 12],
            [128, 120],
            [255, 250],
          ],
        }),
      ),
    ],
  },
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const hero = $('hero')
const looksRow = $('looks')
const jsonBox = $('json') as HTMLTextAreaElement
let original: ImagePipe | null = null
let activeName = 'Golden Hour'

/** A moody sample scene drawn locally, so the demo works offline. */
function samplePhoto(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 600
  const ctx = c.getContext('2d')!
  const sky = ctx.createLinearGradient(0, 0, 0, 600)
  sky.addColorStop(0, '#7793b5')
  sky.addColorStop(0.65, '#d9b18a')
  sky.addColorStop(1, '#8a5f4d')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 900, 600)
  ctx.fillStyle = '#f2e6c9'
  ctx.beginPath()
  ctx.arc(660, 210, 55, 0, Math.PI * 2)
  ctx.fill()
  for (const [x, h, w, shade] of [
    [0, 210, 260, '#3d3c45'],
    [180, 260, 300, '#33323b'],
    [430, 180, 240, '#3d3c45'],
    [620, 300, 280, '#2b2a33'],
  ] as const) {
    ctx.fillStyle = shade
    ctx.beginPath()
    ctx.moveTo(x, 600)
    ctx.lineTo(x + w * 0.5, 600 - h - 60)
    ctx.lineTo(x + w, 600)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = '#1e1d24'
  ctx.fillRect(0, 520, 900, 80)
  return c
}

async function renderHero(): Promise<void> {
  if (!original) return
  const preset = readPreset()
  const canvas = await original.resize({ width: 900 }).pipe(preset).toCanvas()
  hero.replaceChildren(canvas)
}

function readPreset(): SerializedHistory {
  try {
    return JSON.parse(jsonBox.value) as SerializedHistory
  } catch {
    return PRESETS[activeName] ?? PRESETS.Original!
  }
}

function selectPreset(name: string): void {
  activeName = name
  jsonBox.value = JSON.stringify(PRESETS[name], null, 2)
  for (const el of looksRow.children) el.classList.toggle('active', el.id === `look-${name}`)
  void renderHero()
}

async function buildThumbs(): Promise<void> {
  if (!original) return
  looksRow.replaceChildren()
  const thumbBase = original.resize({ width: 264 })
  for (const [name, preset] of Object.entries(PRESETS)) {
    const fig = document.createElement('button')
    fig.className = 'look'
    fig.id = `look-${name}`
    const caption = document.createElement('figcaption')
    caption.textContent = name
    fig.append(await thumbBase.pipe(preset).toCanvas(), caption)
    fig.addEventListener('click', () => selectPreset(name))
    looksRow.append(fig)
  }
  selectPreset(activeName)
}

$('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(jsonBox.value)
})
$('apply').addEventListener('click', () => void renderHero())
$('upload').addEventListener('click', () => ($('file') as HTMLInputElement).click())
;($('file') as HTMLInputElement).addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  void imagepipe.load(file).then((img) => {
    original = img
    return buildThumbs()
  })
})

void imagepipe.load(samplePhoto()).then((img) => {
  original = img
  return buildThumbs()
})
