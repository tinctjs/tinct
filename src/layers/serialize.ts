/**
 * Document serialization: a versioned envelope with a shared sources table.
 *
 * Layers reference content by id instead of inlining it, so a sticker used
 * on five layers is stored once. Sources are deduplicated by identity of the
 * decoded pixels behind each pipeline — no hashing, and exact for the case
 * that matters (one loaded image, many layers).
 *
 * The reading half lives next to `document()` in `./document`, so this
 * module never imports it back.
 *
 * @packageDocumentation
 * @internal
 */

import { bytesToBase64 } from '../core/base64'
import { isDeferred, type PixelData } from '../core/pixel'
import type { CanvasState } from './document'
import type { TinctLayer } from './layer'
import type { SerializedDocument, SerializedLayer, SerializedSource } from './types'

/** @internal The document serialization format version. */
export const DOCUMENT_VERSION = 2

/**
 * @internal
 * Serialize a canvas and its stack. Called by {@link TinctDocument.toJSON}.
 */
export function serializeDocument(
  canvas: CanvasState,
  layers: readonly TinctLayer[],
): SerializedDocument {
  const ids = new Map<PixelData, string>()
  const sources: Record<string, SerializedSource> = {}

  const serialized = layers.map<SerializedLayer>((layer) => {
    const source = layer.source._source
    if (isDeferred(source)) {
      throw new Error(
        'tinct: cannot serialize a layer whose source is a flattened document — render it to pixels first, e.g. tinct.load(await inner.flatten().toBlob())',
      )
    }
    let id = ids.get(source)
    if (id === undefined) {
      id = `s${String(ids.size)}`
      ids.set(source, id)
      sources[id] = {
        width: source.width,
        height: source.height,
        data64: bytesToBase64(source.data),
      }
    }
    const { x, y, opacity, blend, visible, name } = layer._state
    return {
      source: id,
      ops: layer.source.history().ops,
      x,
      y,
      opacity,
      blend,
      visible,
      ...(name !== undefined && { name }),
    }
  })

  return {
    version: DOCUMENT_VERSION,
    canvas: { width: canvas.width, height: canvas.height, background: canvas.background },
    sources,
    layers: serialized,
  }
}
