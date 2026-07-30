/**
 * Avatar Studio — a Tinct example.
 *
 * The entire image pipeline is these ~15 lines of tinct calls; everything
 * else is plain DOM. Shows: face-aware cropping, adjustments, curves,
 * cancellable renders, and target-byte-size WebP export.
 */
import { tinct, type TinctImage } from 'tinctjs'
import { curves, grayscale, vignette } from 'tinctjs/filters'
import { enableFaceGravity } from 'tinctjs/face'

enableFaceGravity()

const LOOKS: Record<string, (image: TinctImage) => TinctImage> = {
  none: (i) => i,
  warm: (i) =>
    i
      .adjust({ temperature: 0.35, saturation: 0.1, gamma: 0.95 })
      .apply(curves({ rgb: [[0, 16], [128, 138], [255, 250]] }))
      .apply(vignette({ amount: 0.25 })),
  mono: (i) =>
    i
      .apply(grayscale())
      .apply(curves({ rgb: [[0, 10], [110, 96], [200, 216], [255, 252]] }))
      .apply(vignette({ amount: 0.35 })),
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const drop = $('drop')
const fileInput = $('file') as HTMLInputElement
const preview = $('preview')
const meta = $('meta')
const download = $('download') as HTMLButtonElement

let original: TinctImage | null = null
let inFlight: AbortController | null = null

function buildAvatar(image: TinctImage): TinctImage {
  const size = Number(($('size') as HTMLSelectElement).value)
  const look = LOOKS[($('look') as HTMLSelectElement).value] ?? LOOKS.none!
  return look(image.crop({ aspect: '1:1', gravity: 'face' }).resize({ width: size }))
}

async function render(): Promise<void> {
  if (!original) return
  inFlight?.abort() // a new render supersedes the old one
  inFlight = new AbortController()
  try {
    const canvas = await buildAvatar(original).toCanvas({ signal: inFlight.signal })
    preview.replaceChildren(canvas)
    meta.textContent = `${String(canvas.width)}×${String(canvas.height)} preview`
    download.disabled = false
  } catch {
    /* superseded by a newer render */
  }
}

async function loadFile(file: File): Promise<void> {
  original = await tinct.load(file) // EXIF orientation handled automatically
  drop.classList.remove('armed')
  drop.textContent = file.name
  void render()
}

download.addEventListener('click', () => {
  void (async () => {
    if (!original) return
    const maxBytes = Number(($('budget') as HTMLSelectElement).value)
    const blob = await buildAvatar(original).toBlob({ format: 'webp', maxBytes })
    meta.textContent = `exported ${String(Math.round(blob.size / 1024))} kB webp (budget ${String(maxBytes / 1000)} kB)`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'avatar.webp'
    a.click()
    URL.revokeObjectURL(a.href)
  })()
})

for (const id of ['size', 'look', 'budget']) $(id).addEventListener('change', () => void render())
drop.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) void loadFile(fileInput.files[0])
})
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('armed')
})
drop.addEventListener('dragleave', () => drop.classList.remove('armed'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file) void loadFile(file)
})
