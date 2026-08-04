/**
 * Layers — multi-image documents built out of imagepipe pipelines.
 *
 * ```ts
 * import { imagepipe } from 'imagepipe'
 * import { document, layer } from 'imagepipe/layers'
 *
 * const doc = document({ width: 1080, height: 1350, background: '#ffffff' })
 *   .add(layer(photo))
 *   .add(layer(sticker.resize({ width: 300 })).at(650, 80).opacity(0.9).name('sticker'))
 *
 * const dragged = doc.move('sticker', { dx: 20, dy: -10 })
 * const blob = await dragged.flatten().toBlob({ format: 'webp' })
 * ```
 *
 * Every layer's content is a full {@link ImagePipe}, so filters,
 * adjustments, and geometry work per layer. Documents are immutable and
 * share structure, so undo/redo is keeping references. Nothing in the core
 * bundle knows layers exist — importing nothing from here costs no bytes.
 *
 * @packageDocumentation
 */

export { document, fromJSON, PipeDocument } from './document'
export { layer, PipeLayer } from './layer'
export type {
  BlendMode,
  DocumentOptions,
  LayerBounds,
  LayerPlacement,
  LayerRef,
  MoveDelta,
  SerializedDocument,
  SerializedLayer,
  SerializedSource,
} from './types'
