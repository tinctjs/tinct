/**
 * Source decoding: every supported {@link ImageSource} becomes a
 * {@link PixelData} eagerly at `imagepipe.load` time.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { ImageSource, LoadOptions } from '../core/types'
import { createCanvas, get2d } from './env'

/** @internal Decode any supported source into raw pixels. */
export async function decodeSource(source: ImageSource, options?: LoadOptions): Promise<PixelData> {
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    // Copy so later mutation of the caller's ImageData can't leak in.
    return { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) }
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if (!source.complete) await source.decode()
    return drawToPixels(source, source.naturalWidth, source.naturalHeight)
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return canvasToPixels(source, source.width, source.height)
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return canvasToPixels(source, source.width, source.height)
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return decodeBlob(source)
  }
  if (typeof source === 'string' || source instanceof URL) {
    return decodeUrl(source instanceof URL ? source.href : source, options)
  }
  throw new Error('imagepipe: unsupported image source')
}

/** Canvases may hold non-2d contexts; try direct read, fall back to drawing. */
function canvasToPixels(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
): PixelData {
  if (width === 0 || height === 0) {
    throw new Error('imagepipe: cannot load from a zero-sized canvas')
  }
  try {
    const image = get2d(canvas).getImageData(0, 0, width, height)
    return { width, height, data: image.data }
  } catch {
    return drawToPixels(canvas, width, height)
  }
}

async function decodeBlob(blob: Blob): Promise<PixelData> {
  if (typeof createImageBitmap !== 'undefined') {
    const bitmap = await createOrientedBitmap(blob)
    try {
      return drawToPixels(bitmap, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await decodeUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Decode a Blob with EXIF orientation applied, so phone photos load upright.
 *
 * `'from-image'` is the spec default in current browsers, but it is passed
 * explicitly to cover engines whose historical default was `'none'`
 * (pre-2022 Firefox). Engines that reject the option dictionary entirely
 * fall back to a plain decode. The `<img>`-based URL path needs no
 * equivalent: browsers orient image elements by default.
 */
function createOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    // Unsupported dictionary values surface as sync throws in some engines
    // and as rejections in others (WebIDL promise conversion) — cover both.
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() =>
      createImageBitmap(blob),
    )
  } catch {
    return createImageBitmap(blob)
  }
}

function decodeUrl(url: string, options?: LoadOptions): Promise<PixelData> {
  if (typeof Image === 'undefined') {
    throw new Error('imagepipe: URL sources need a DOM Image — pass a Blob or ImageData instead')
  }
  return new Promise<PixelData>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = options?.crossOrigin ?? 'anonymous'

    const onAbort = (): void => {
      img.src = ''
      reject(
        options?.signal?.reason instanceof Error
          ? options.signal.reason
          : new Error('imagepipe: load aborted'),
      )
    }
    if (options?.signal?.aborted) {
      onAbort()
      return
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })

    img.onload = () => {
      options?.signal?.removeEventListener('abort', onAbort)
      try {
        resolve(drawToPixels(img, img.naturalWidth, img.naturalHeight))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    img.onerror = () => {
      options?.signal?.removeEventListener('abort', onAbort)
      reject(new Error(`imagepipe: failed to load image from '${url}'`))
    }
    img.src = url
  })
}

function drawToPixels(source: CanvasImageSource, width: number, height: number): PixelData {
  if (width === 0 || height === 0) {
    throw new Error('imagepipe: cannot load a zero-sized image')
  }
  const canvas = createCanvas(width, height)
  const ctx = get2d(canvas)
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, width, height)
  return { width, height, data: image.data }
}
