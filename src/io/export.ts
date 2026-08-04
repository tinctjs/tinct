/**
 * Encoders: raw pixels out to `ImageData`, canvases, Blobs, and data URLs.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { ExportOptions } from '../core/types'
import { createCanvas, createElementCanvas, get2d, type AnyCanvas } from './env'

/** @internal PixelData → real ImageData (copies, so renders stay immutable). */
export function pixelsToImageData(pixels: PixelData): ImageData {
  if (typeof ImageData === 'undefined') {
    throw new Error('imagepipe: ImageData is not available in this environment')
  }
  return new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
}

/** @internal PixelData → a fresh `<canvas>` element. */
export function pixelsToCanvas(pixels: PixelData): HTMLCanvasElement {
  const canvas = createElementCanvas(pixels.width, pixels.height)
  get2d(canvas).putImageData(pixelsToImageData(pixels), 0, 0)
  return canvas
}

/** @internal PixelData → encoded Blob. */
export async function pixelsToBlob(pixels: PixelData, options?: ExportOptions): Promise<Blob> {
  const canvas = prepareCanvas(pixels, options)
  if (options?.maxBytes !== undefined) {
    return encodeToTarget(canvas, options as ExportOptions & { maxBytes: number })
  }
  return canvasToBlob(canvas, mimeType(options), options?.quality)
}

/** @internal PixelData → data URL string. */
export async function pixelsToDataURL(pixels: PixelData, options?: ExportOptions): Promise<string> {
  if (options?.maxBytes !== undefined) {
    // maxBytes budgets the encoded bytes (the base64 URL is ~4/3 longer).
    return blobToDataURL(await pixelsToBlob(pixels, options))
  }
  const canvas = prepareCanvas(pixels, options)
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL(mimeType(options), options?.quality)
  }
  const blob = await canvasToBlob(canvas, mimeType(options), options?.quality)
  return blobToDataURL(blob)
}

/** The lowest quality the target-size search will accept. */
const MIN_QUALITY = 0.05
/** Bisection steps: 6 narrows quality to ~1.5% granularity. */
const SEARCH_STEPS = 6

/**
 * Find the highest quality whose encoded size fits `maxBytes` by bisecting
 * the quality axis (encoded size grows monotonically with quality). The
 * render happens once — only the encode repeats, at most 2 + SEARCH_STEPS
 * times.
 */
async function encodeToTarget(
  canvas: AnyCanvas,
  options: ExportOptions & { maxBytes: number },
): Promise<Blob> {
  const { maxBytes } = options
  const format = options.format ?? 'png'
  if (format === 'png') {
    throw new Error(
      'imagepipe: maxBytes needs a quality axis — png has none; use jpeg or webp, or resize the image down',
    )
  }
  const type = mimeType(options)

  let hi = options.quality ?? 0.92
  const atHi = await canvasToBlob(canvas, type, hi)
  if (atHi.size <= maxBytes) return atHi

  let lo = MIN_QUALITY
  let best = await canvasToBlob(canvas, type, lo)
  if (best.size > maxBytes) {
    throw new Error(
      `imagepipe: cannot encode under ${String(maxBytes)} bytes — the smallest ${format} at quality ${String(
        MIN_QUALITY,
      )} is ${String(best.size)} bytes; resize the image down first`,
    )
  }

  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2
    const candidate = await canvasToBlob(canvas, type, mid)
    if (candidate.size <= maxBytes) {
      best = candidate
      lo = mid
    } else {
      hi = mid
    }
  }
  return best
}

function mimeType(options?: ExportOptions): string {
  return `image/${options?.format ?? 'png'}`
}

/** Draw pixels to a canvas, compositing a background for alpha-less formats. */
function prepareCanvas(pixels: PixelData, options?: ExportOptions): AnyCanvas {
  const canvas = createCanvas(pixels.width, pixels.height)
  const ctx = get2d(canvas)
  ctx.putImageData(pixelsToImageData(pixels), 0, 0)

  const needsBackground = options?.format === 'jpeg' || options?.background !== undefined
  if (!needsBackground) return canvas

  const composited = createCanvas(pixels.width, pixels.height)
  const cctx = get2d(composited)
  cctx.fillStyle = options.background ?? '#ffffff'
  cctx.fillRect(0, 0, pixels.width, pixels.height)
  cctx.drawImage(canvas, 0, 0)
  return composited
}

function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return quality === undefined
      ? canvas.convertToBlob({ type })
      : canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(`imagepipe: encoding to ${type} failed`))
      },
      type,
      quality,
    )
  })
}

function blobToDataURL(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as string)
      }
      reader.onerror = () => {
        reject(new Error('imagepipe: could not read encoded blob'))
      }
      reader.readAsDataURL(blob)
    })
  }
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:${blob.type};base64,${btoa(binary)}`
  })
}
