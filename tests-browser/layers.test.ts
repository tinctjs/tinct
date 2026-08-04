/**
 * Documents through a real browser (headless Chromium).
 *
 * The layers suites in `tests/` all run on the DOM-free CPU path in Node, so
 * nothing there exercises the half of `flatten()` that needs a canvas: the
 * encode. These tests cover the seam — that a composited document reaches
 * `toBlob`, `toDataURL`, and `toCanvas` as a real image, and that the pixels
 * that come back out of a browser canvas are the ones the compositor put in.
 */
import { describe, expect, test } from 'vitest'
import { ImagePipe } from '../src/core/editor'
import { createPixelData, type PixelData } from '../src/core/pixel'
import { grayscale } from '../src/filters/index'
import { document, layer } from '../src/layers'

type Rgba = [number, number, number, number]

function solid(width: number, height: number, [r, g, b, a]: Rgba): PixelData {
  const p = createPixelData(width, height)
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = r
    p.data[i + 1] = g
    p.data[i + 2] = b
    p.data[i + 3] = a
  }
  return p
}

const image = (w: number, h: number, rgba: Rgba) => ImagePipe._create(solid(w, h, rgba))

const RED: Rgba = [255, 0, 0, 255]
const BLUE: Rgba = [0, 0, 255, 255]

/** Read one pixel back through a real 2D context. */
function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): Rgba {
  const data = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!]
}

/** The first bytes of a decoded blob, so format claims are checked, not assumed. */
async function magic(blob: Blob, length: number): Promise<number[]> {
  return [...new Uint8Array(await blob.slice(0, length).arrayBuffer())]
}

describe('documents in a real browser', () => {
  test('flatten().toBlob() encodes a composited document as PNG', async () => {
    const doc = document({ width: 40, height: 30, background: '#ffffff' })
      .add(
        layer(image(20, 20, RED))
          .at(0, 0)
          .name('base'),
      )
      .add(
        layer(image(10, 10, BLUE))
          .at(25, 5)
          .name('chip'),
      )

    const blob = await doc.flatten().toBlob()

    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
    // PNG signature.
    expect(await magic(blob, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  test('flatten().toBlob() honours an explicit format', async () => {
    const doc = document({ width: 24, height: 24, background: '#000000' }).add(
      layer(image(24, 24, RED)),
    )

    const blob = await doc.flatten().toBlob({ format: 'webp', quality: 0.8 })

    expect(blob.type).toBe('image/webp')
    // 'RIFF' .... 'WEBP'
    const bytes = await magic(blob, 12)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WEBP')
  })

  test('the canvas the browser hands back holds the composited pixels', async () => {
    const doc = document({ width: 30, height: 20, background: '#00ff00' })
      .add(layer(image(10, 10, RED)).at(0, 0))
      .add(layer(image(10, 10, BLUE)).at(20, 10))

    const canvas = await doc.flatten().toCanvas()

    expect(canvas.width).toBe(30)
    expect(canvas.height).toBe(20)
    expect(pixelAt(canvas, 5, 5)).toEqual(RED) // bottom layer
    expect(pixelAt(canvas, 25, 15)).toEqual(BLUE) // top layer
    expect(pixelAt(canvas, 15, 5)).toEqual([0, 255, 0, 255]) // background
  })

  test('placement, opacity and blend survive the trip through a canvas', async () => {
    const doc = document({ width: 20, height: 20, background: '#ffffff' })
      .add(layer(image(20, 20, RED)))
      .add(
        layer(image(20, 20, BLUE))
          .opacity(0.5)
          .name('top'),
      )

    const canvas = await doc.flatten().toCanvas()

    // Red under blue at half opacity: even mix, alpha stays opaque.
    const [r, g, b, a] = pixelAt(canvas, 10, 10)
    expect(r).toBeCloseTo(128, -1)
    expect(g).toBe(0)
    expect(b).toBeCloseTo(128, -1)
    expect(a).toBe(255)
  })

  test('a flattened document is an ordinary pipeline', async () => {
    const doc = document({ width: 40, height: 40, background: '#ffffff' }).add(
      layer(image(40, 40, RED)),
    )

    // Chaining onto flatten() is the claim the collage example's export makes.
    const canvas = await doc.flatten().resize({ width: 20 }).apply(grayscale()).toCanvas()

    expect(canvas.width).toBe(20)
    expect(canvas.height).toBe(20)
    const [r, g, b] = pixelAt(canvas, 10, 10)
    expect(r).toBe(g)
    expect(g).toBe(b) // grayscale ran after the composite
  })

  test('a per-layer filter only touches its own layer', async () => {
    const doc = document({ width: 40, height: 20, background: '#ffffff' })
      .add(layer(image(20, 20, RED).apply(grayscale())).at(0, 0))
      .add(layer(image(20, 20, RED)).at(20, 0))

    const canvas = await doc.flatten().toCanvas()

    const [lr, lg, lb] = pixelAt(canvas, 10, 10)
    expect(lr).toBe(lg)
    expect(lg).toBe(lb) // filtered layer is gray
    expect(pixelAt(canvas, 30, 10)).toEqual(RED) // its neighbour is untouched
  })

  test('toDataURL round-trips through an <img> the browser will decode', async () => {
    const doc = document({ width: 16, height: 16, background: '#ffffff' }).add(
      layer(image(16, 16, BLUE)),
    )

    const url = await doc.flatten().toDataURL({ format: 'webp' })
    expect(url.startsWith('data:image/webp;base64,')).toBe(true)

    const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve(img)
      }
      img.onerror = () => {
        reject(new Error('the browser refused to decode the data URL'))
      }
      img.src = url
    })
    expect(decoded.naturalWidth).toBe(16)
    expect(decoded.naturalHeight).toBe(16)
  })

  test('layerAt picks through transparency on the browser path', async () => {
    // A hole punched in the top layer: the pixel is transparent, so the hit
    // test must fall through to the layer underneath.
    const holed = solid(20, 20, BLUE)
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) holed.data[(y * 20 + x) * 4 + 3] = 0
    }

    const doc = document({ width: 20, height: 20, background: '#ffffff' })
      .add(layer(image(20, 20, RED)).name('under'))
      .add(layer(ImagePipe._create(holed)).name('over'))

    await doc.flatten().toCanvas() // warm the layer cache, as a UI would

    expect((await doc.layerAt(10, 10))?.name()).toBe('under')
    expect((await doc.layerAt(2, 2))?.name()).toBe('over')
    expect(await doc.layerAt(-1, 0)).toBeNull()
  })
})
