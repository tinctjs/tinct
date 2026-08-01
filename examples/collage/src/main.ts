/**
 * Collage — a Tinct example.
 *
 * A layered document editor built on `tinctjs/layers`. It exists to exercise
 * the two primitives a selection UI needs and that the library deliberately
 * does not wrap in one: `layerAt()` to pick the layer under the pointer, and
 * `boundsOf()` to draw the selection.
 *
 * The interesting constraint is that `layerAt()` is alpha-aware and therefore
 * async, while a drag loop must not await anything. The resolution is to hit
 * once on pointerdown and then move synchronously — `move()` is placement
 * only, so no pipeline re-renders, and `boundsOf()` is pure arithmetic, so the
 * outline tracks the pointer at frame rate while the composite catches up.
 *
 * Everything else falls out of immutability: undo is an array of document
 * references, save is `JSON.stringify`.
 */
import { tinct, type Filter, type ImageSource, type TinctImage } from 'tinctjs'
import { blur, grayscale, posterize, sepia } from 'tinctjs/filters'
// `document` is also a DOM global, so the layers factory is imported under a
// local alias. `layer`, `fromJSON`, and the types come through unrenamed.
import {
  document as tinctDocument,
  fromJSON,
  layer,
  type BlendMode,
  type SerializedDocument,
  type TinctDocument,
  type TinctLayer,
} from 'tinctjs/layers'

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const stage = $('stage')
const view = $('view') as HTMLCanvasElement
const outline = $('outline') as HTMLCanvasElement
const layerList = $('layers')
const inspector = $('inspector') as HTMLFieldSetElement
const blendSelect = $('blend') as HTMLSelectElement
const filterSelect = $('filter') as HTMLSelectElement
const opacityInput = $('opacity') as HTMLInputElement
const fileInput = $('file') as HTMLInputElement
const out = $('out')
const status = $('status')

const CANVAS = { width: 640, height: 440, background: '#ffffff' }
/** Uploads are scaled into the canvas rather than dropped in at 4000px. */
const MAX_LAYER_WIDTH = 460

type FilterName = 'none' | 'grayscale' | 'sepia' | 'blur' | 'posterize'

/** Each option type is distinct, so the map is widened to the base `Filter`. */
const FILTERS: Record<FilterName, (() => Filter) | null> = {
  none: null,
  grayscale: () => grayscale(),
  sepia: () => sepia(),
  blur: () => blur({ radius: 6 }),
  posterize: () => posterize({ levels: 5 }),
}

/**
 * A layer's unfiltered pipeline, so the filter select can switch rather than
 * only stack. Layers are addressed by name everywhere — every document edit
 * returns new layer objects, so object identity is not a stable key, but a
 * name survives moves, restacks, and a JSON round trip.
 */
const bases = new Map<string, { source: TinctImage; filter: FilterName }>()
let sequence = 0

let doc = tinctDocument(CANVAS)
let selected: string | null = null

// Undo/redo, in full. Documents share structure, so a history entry costs a
// pointer — the layers nobody touched are the same objects in every entry.
let history: TinctDocument[] = [doc]
let cursor = 0

function commit(next: TinctDocument): void {
  history = [...history.slice(0, cursor + 1), next]
  cursor = history.length - 1
  apply(next)
}

function undo(): void {
  if (cursor > 0) apply(history[--cursor]!)
}

function redo(): void {
  if (cursor < history.length - 1) apply(history[++cursor]!)
}

/** Adopt a document without touching history — used by undo/redo and drags. */
function apply(next: TinctDocument): void {
  doc = next
  if (selected !== null && !names(doc).includes(selected)) selected = null
  renderPanel()
  drawOutline()
  schedule()
}

function names(target: TinctDocument): string[] {
  return target.layers.map((l) => l.name() ?? '')
}

/* ---------------------------------------------------------------- rendering */

const ctx = view.getContext('2d')!
const outlineCtx = outline.getContext('2d')!
view.width = outline.width = CANVAS.width
view.height = outline.height = CANVAS.height

let inFlight: AbortController | null = null
let queued = false

/** Coalesce composites to one per frame, and abandon the one still running. */
function schedule(): void {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    void composite()
  })
}

async function composite(): Promise<void> {
  inFlight?.abort()
  inFlight = new AbortController()
  const { signal } = inFlight
  const started = performance.now()
  try {
    // Layer pixels are cached per pipeline, so a move re-runs only the blend
    // loop — the layer pipelines themselves are hits.
    const pixels = await doc.flatten().toImageData({ signal })
    if (signal.aborted) return
    ctx.putImageData(pixels, 0, 0)
    drawOutline()
    say(
      `${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} · composited in ${(performance.now() - started).toFixed(0)} ms`,
    )
  } catch {
    // Superseded by a newer frame, or an empty document — nothing to report.
  }
}

/**
 * The selection rectangle, straight from `boundsOf()`. Drawn on its own canvas
 * so a drag can update it every pointermove without waiting on the composite.
 */
function drawOutline(): void {
  outlineCtx.clearRect(0, 0, CANVAS.width, CANVAS.height)
  if (selected === null) return
  const { x, y, width, height } = doc.boundsOf(selected)
  outlineCtx.setLineDash([7, 5])
  outlineCtx.lineWidth = 2
  outlineCtx.strokeStyle = '#5b4bd6'
  outlineCtx.strokeRect(x + 1, y + 1, width - 2, height - 2)
}

function say(message: string): void {
  status.textContent = message
}

/* ------------------------------------------------------------------ dragging */

let drag: { name: string; x: number; y: number } | null = null

/** Pointer to canvas coordinates — the canvas is scaled to fit by CSS. */
function point(e: PointerEvent): { x: number; y: number } {
  const rect = view.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * CANVAS.width,
    y: ((e.clientY - rect.top) / rect.height) * CANVAS.height,
  }
}

stage.addEventListener('pointerdown', (e) => {
  const { x, y } = point(e)
  // The one await in the drag: alpha-aware picking needs pixels. Rendered
  // layers come from the cache the last composite filled, so after the first
  // frame this is a lookup. Clicking the hole in a ring selects what is behind
  // it, which a bounding-box test would get wrong.
  void doc.layerAt(x, y).then((hit: TinctLayer | null) => {
    const name = hit?.name() ?? null
    selected = name
    renderPanel()
    drawOutline()
    if (name === null) return
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('dragging')
    drag = { name, x, y }
  })
})

stage.addEventListener('pointermove', (e) => {
  if (!drag) return
  const { x, y } = point(e)
  // Synchronous from here: placement only, so nothing re-renders but the blend.
  doc = doc.move(drag.name, { dx: x - drag.x, dy: y - drag.y })
  drag = { ...drag, x, y }
  drawOutline()
  schedule()
})

function endDrag(): void {
  if (!drag) return
  drag = null
  stage.classList.remove('dragging')
  commit(doc) // one history entry per drag, not per frame
}

stage.addEventListener('pointerup', endDrag)
stage.addEventListener('pointercancel', endDrag)

/* -------------------------------------------------------------- layer panel */

function renderPanel(): void {
  const stack = doc.layers
  layerList.replaceChildren()

  if (stack.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'no layers — drop an image'
    layerList.append(li)
  }

  // Rendered bottom-to-top in DOM order, flipped by CSS so the top layer of
  // the stack is the top row of the panel.
  stack.forEach((entry, index) => {
    const name = entry.name() ?? `layer ${String(index)}`
    const li = document.createElement('li')
    li.className = [name === selected ? 'on' : '', entry.visible() ? '' : 'off']
      .filter(Boolean)
      .join(' ')
    // Built as nodes rather than innerHTML: layer names come from filenames.
    const label = document.createElement('span')
    label.className = 'nm'
    label.textContent = name
    li.append(
      button('toggle', entry.visible() ? '👁' : '⚊', 'show/hide'),
      label,
      button('down', '↓', 'move down'),
      button('up', '↑', 'move up'),
      button('remove', '×', 'remove'),
    )
    li.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act
      if (!act) {
        selected = name
        renderPanel()
        drawOutline()
        return
      }
      if (act === 'toggle') commit(doc.update(name, (l) => l.visible(!l.visible())))
      if (act === 'up') commit(doc.reorder(name, index + 1))
      if (act === 'down') commit(doc.reorder(name, index - 1))
      if (act === 'remove') {
        bases.delete(name)
        commit(doc.remove(name))
      }
    })
    layerList.append(li)
  })

  inspector.disabled = selected === null
  if (selected !== null) {
    const entry = doc.layers[names(doc).indexOf(selected)]!
    blendSelect.value = entry.blend()
    opacityInput.value = String(entry.opacity())
    filterSelect.value = bases.get(selected)?.filter ?? 'none'
  }
  ;($('undo') as HTMLButtonElement).disabled = cursor === 0
  ;($('redo') as HTMLButtonElement).disabled = cursor === history.length - 1
}

function button(act: string, glyph: string, title: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.dataset.act = act
  el.title = title
  el.textContent = glyph
  return el
}

blendSelect.addEventListener('change', () => {
  if (selected !== null)
    commit(doc.update(selected, (l) => l.blend(blendSelect.value as BlendMode)))
})

// Dragging a slider fires a stream of events; each one edits the document but
// only the last lands in history.
opacityInput.addEventListener('input', () => {
  if (selected !== null) apply(doc.update(selected, (l) => l.opacity(Number(opacityInput.value))))
})
opacityInput.addEventListener('change', () => commit(doc))

/**
 * Swap the filter on one layer's pipeline. This is the "every layer is a full
 * pipeline" claim made concrete: the filter runs on this layer alone, and
 * because it produces a new pipeline object, only this layer re-renders on the
 * next composite.
 */
filterSelect.addEventListener('change', () => {
  if (selected === null) return
  const base = bases.get(selected)
  if (!base) return
  const name = filterSelect.value as FilterName
  const factory = FILTERS[name]
  const source = factory ? base.source.apply(factory()) : base.source
  bases.set(selected, { ...base, filter: name })
  commit(doc.update(selected, (l) => withSource(l, source)))
})

/**
 * A layer's content is fixed at construction, so changing it means rebuilding
 * the layer and carrying its state across. (Worth noting as API feedback: this
 * is the one edit that does not have a one-liner.)
 */
function withSource(l: TinctLayer, source: TinctImage): TinctLayer {
  return layer(source)
    .at(l.x, l.y)
    .opacity(l.opacity())
    .blend(l.blend())
    .visible(l.visible())
    .name(l.name()!)
}

/* ------------------------------------------------------------ adding layers */

async function addImage(source: ImageSource, label: string, x: number, y: number): Promise<void> {
  const image = await tinct.load(source)
  const scaled = image.width > MAX_LAYER_WIDTH ? image.resize({ width: MAX_LAYER_WIDTH }) : image
  const name = `${label} ${String(++sequence)}`
  bases.set(name, { source: scaled, filter: 'none' })
  selected = name
  commit(doc.add(layer(scaled).at(x, y).name(name)))
}

async function addFiles(files: File[]): Promise<void> {
  for (const [i, file] of files.entries()) {
    const label = file.name.replace(/\.\w+$/, '').slice(0, 18) || 'image'
    try {
      await addImage(file, label, 60 + i * 40, 50 + i * 40)
    } catch (error) {
      say(error instanceof Error ? error.message : 'could not load that file')
    }
  }
}

stage.addEventListener('click', () => {
  if (selected === null && !drag) fileInput.click()
})
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void addFiles([...fileInput.files])
  fileInput.value = ''
})
stage.addEventListener('dragover', (e) => {
  e.preventDefault()
  stage.classList.add('armed')
})
stage.addEventListener('dragleave', () => stage.classList.remove('armed'))
stage.addEventListener('drop', (e) => {
  e.preventDefault()
  stage.classList.remove('armed')
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (files.length) void addFiles(files)
})

/* -------------------------------------------------------- save, load, export */

$('undo').addEventListener('click', undo)
$('redo').addEventListener('click', redo)
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
  e.preventDefault()
  if (e.shiftKey) redo()
  else undo()
})

$('copy').addEventListener('click', () => {
  // `toJSON` means `JSON.stringify(doc)` just works. Layer pixels are inlined
  // as base64, so the result is large but self-contained — it replays with no
  // network access at all.
  const json = JSON.stringify(doc)
  navigator.clipboard.writeText(json).then(
    () => say(`copied ${(json.length / 1024 / 1024).toFixed(1)} MB of document JSON`),
    () => say('clipboard write was blocked by the browser'),
  )
})

$('load').addEventListener('click', () => {
  navigator.clipboard.readText().then(
    (text) => {
      try {
        const restored = fromJSON(JSON.parse(text) as SerializedDocument)
        // Restored layers arrive with their filter ops already replayed into
        // the pipeline, so the pipeline itself becomes the new base and the
        // filter select starts over at "none".
        bases.clear()
        for (const l of restored.layers) {
          if (l.name()) bases.set(l.name()!, { source: l.source, filter: 'none' })
        }
        selected = null
        commit(restored)
        say(`restored ${String(restored.layers.length)} layers from JSON`)
      } catch (error) {
        say(error instanceof Error ? error.message : 'that is not a Tinct document')
      }
    },
    () => say('clipboard read was blocked — allow it, or paste over the page'),
  )
})

$('export').addEventListener('click', () => {
  void (async () => {
    say('encoding…')
    // A flattened document is an ordinary TinctImage: chain onto it like any
    // other pipeline. Both outputs share the layer cache, so the second
    // flatten only re-runs the blend loop.
    const flat = doc.flatten()
    const [full, thumb] = await Promise.all([
      flat.toBlob({ format: 'webp', quality: 0.9 }),
      flat.resize({ width: 240 }).toDataURL({ format: 'webp' }),
    ])
    const url = URL.createObjectURL(full)
    out.replaceChildren()
    const preview = new Image()
    preview.src = thumb
    const link = document.createElement('a')
    link.href = url
    link.download = 'collage.webp'
    link.textContent = `download · ${(full.size / 1024).toFixed(0)} kB`
    out.append(preview, link)
    say('exported webp, plus a 240px thumbnail off the same flatten')
  })()
})

/* ------------------------------------------------------------- demo content */

/** A soft gradient wash, so the page is not empty on first load. */
function backdrop(width: number, height: number): ImageData {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')!
  const wash = g.createLinearGradient(0, 0, width, height)
  wash.addColorStop(0, '#ffd7a8')
  wash.addColorStop(0.5, '#f7a1c4')
  wash.addColorStop(1, '#8f7ff0')
  g.fillStyle = wash
  g.fillRect(0, 0, width, height)
  g.globalAlpha = 0.35
  g.fillStyle = '#fffdf7'
  for (let i = 0; i < 5; i++) {
    g.beginPath()
    g.arc(width * (0.15 + i * 0.18), height * (i % 2 ? 0.7 : 0.3), 46 + i * 9, 0, Math.PI * 2)
    g.fill()
  }
  return g.getImageData(0, 0, width, height)
}

/**
 * A ring: opaque band, fully transparent middle. It is the demo layer for
 * alpha-aware picking — clicking its hole selects the backdrop behind it, not
 * the ring.
 */
function ring(size: number): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const dye = g.createLinearGradient(0, size, size, 0)
  dye.addColorStop(0, '#4f46e5')
  dye.addColorStop(0.55, '#c026d3')
  dye.addColorStop(1, '#ec4899')
  g.strokeStyle = dye
  g.lineWidth = size * 0.16
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - g.lineWidth / 2, 0, Math.PI * 2)
  g.stroke()
  return g.getImageData(0, 0, size, size)
}

async function seed(): Promise<void> {
  // The ring is placed so its hole sits over the backdrop: clicking through it
  // selects the backdrop, which is the whole point of an alpha-aware hit test.
  await addImage(backdrop(460, 300), 'backdrop', 45, 45)
  await addImage(ring(190), 'ring', 390, 215)
  selected = null
  // The seed is the starting point, not something to undo back past.
  history = [doc]
  cursor = 0
  renderPanel()
  drawOutline()
}

void seed()
