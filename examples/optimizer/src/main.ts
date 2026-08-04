/**
 * Shrinkwrap — a imagepipe example.
 *
 * Batch upload optimization, fully on-device: EXIF auto-orientation,
 * high-quality downscale, WebP under a byte budget, optional watermark
 * overlay, plus a ThumbHash placeholder and dominant color per image
 * (exactly what an instant-loading gallery stores next to each URL).
 * A new drop aborts any batch still running.
 */
import { imagepipe } from 'imagepipe'
import { thumbHash, thumbHashBase64 } from 'imagepipe/hash'
import { dominantColor } from 'imagepipe/palette'
// The reference decoder renders the placeholder <img> from the hash bytes —
// in a real app this line lives in your *frontend*, not your upload path.
import { thumbHashToDataURL } from 'thumbhash'

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const rows = $('rows')
const table = $('table') as HTMLTableElement
const drop = $('drop')
const fileInput = $('file') as HTMLInputElement

let batch: AbortController | null = null

/** The imagepipe dip mark, drawn locally, used as the demo watermark. */
function watermark(): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = 72
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(28, 26, 51, 0.9)'
  ctx.beginPath()
  ctx.roundRect(4, 4, 64, 64, 16)
  ctx.fill()
  const dye = ctx.createLinearGradient(0, 68, 0, 30)
  dye.addColorStop(0, '#4f46e5')
  dye.addColorStop(0.55, '#c026d3')
  dye.addColorStop(1, '#ec4899')
  ctx.fillStyle = dye
  ctx.beginPath()
  ctx.moveTo(4, 42)
  for (let x = 4; x <= 68; x++) {
    ctx.lineTo(x, 42 - 3 * Math.sin(((x - 4) / 32) * Math.PI * 2))
  }
  ctx.lineTo(68, 68)
  ctx.lineTo(4, 68)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  ctx.beginPath()
  ctx.roundRect(4, 4, 64, 64, 16)
  ctx.fill()
  ctx.restore()
  return ctx.getImageData(0, 0, 72, 72)
}

async function processBatch(files: File[]): Promise<void> {
  batch?.abort()
  batch = new AbortController()
  const { signal } = batch
  const maxWidth = Number(($('maxw') as HTMLSelectElement).value)
  const maxBytes = Number(($('budget') as HTMLSelectElement).value)
  const mark = ($('mark') as HTMLInputElement).checked ? watermark() : null

  table.hidden = false
  rows.replaceChildren()

  for (const file of files) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>…</td><td>${file.name}</td><td>${kb(file.size)}</td><td>—</td><td>—</td><td>—</td><td></td>`
    rows.append(tr)

    try {
      const image = await imagepipe.load(file)
      let pipeline = image.width > maxWidth ? image.resize({ width: maxWidth }) : image
      if (mark)
        pipeline = pipeline.overlay(mark, { gravity: 'south-east', margin: 14, opacity: 0.85 })

      const [blob, pixels] = await Promise.all([
        pipeline.toBlob({ format: 'webp', maxBytes, signal }),
        pipeline.resize({ width: 96 }).toImageData({ signal }),
      ])
      if (signal.aborted) return

      const hashBytes = thumbHash(pixels)
      const placeholder = new Image()
      placeholder.src = thumbHashToDataURL(hashBytes)
      placeholder.className = 'ph'
      placeholder.title = `thumbhash: ${thumbHashBase64(pixels)}`

      const color = dominantColor(pixels)
      const url = URL.createObjectURL(blob)
      const saved = Math.max(0, Math.round((1 - blob.size / file.size) * 100))

      tr.children[0]!.replaceChildren(placeholder)
      tr.children[3]!.textContent = kb(blob.size)
      tr.children[4]!.innerHTML = `<span class="saving">−${String(saved)}%</span>`
      tr.children[5]!.innerHTML = `<span class="chip" style="background:${color.hex}"></span> ${color.hex}`
      tr.children[6]!.innerHTML = `<a class="dl" download="${file.name.replace(/\.\w+$/, '')}.webp" href="${url}">download</a>`
    } catch (error) {
      if (signal.aborted) return
      tr.children[3]!.textContent = error instanceof Error ? error.message : 'failed'
    }
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} kB`
}

drop.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void processBatch([...fileInput.files])
})
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('armed')
})
drop.addEventListener('dragleave', () => drop.classList.remove('armed'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('armed')
  if (e.dataTransfer?.files.length) void processBatch([...e.dataTransfer.files])
})
