/**
 * Public types for `imagepipe/layers`.
 *
 * @packageDocumentation
 */

import type { BlendMode } from '../cpu/blend'
import type { SerializedOp } from '../core/types'

export type { BlendMode }

/** Options accepted by {@link document}. */
export interface DocumentOptions {
  /** Canvas width in pixels. Fixed for the life of the document. */
  width: number
  /** Canvas height in pixels. Fixed for the life of the document. */
  height: number
  /**
   * CSS color painted under every layer.
   * @defaultValue `'transparent'`
   */
  background?: string
}

/**
 * How a layer is addressed in document methods: its {@link PipeLayer.name},
 * or its index in the stack (`0` is the bottom layer).
 */
export type LayerRef = string | number

/** A layer's placement on the canvas, in whole pixels. */
export interface LayerPlacement {
  /** Distance from the canvas's left edge to the layer's left edge. */
  x: number
  /** Distance from the canvas's top edge to the layer's top edge. */
  y: number
}

/** The rectangle a layer occupies on the canvas. See {@link PipeDocument.boundsOf}. */
export interface LayerBounds extends LayerPlacement {
  /** Rendered width of the layer's pipeline. */
  width: number
  /** Rendered height of the layer's pipeline. */
  height: number
}

/** A relative translation. See {@link PipeDocument.move}. */
export interface MoveDelta {
  /** Horizontal offset in pixels. @defaultValue `0` */
  dx?: number
  /** Vertical offset in pixels. @defaultValue `0` */
  dy?: number
}

/**
 * One entry of a serialized document's shared `sources` table: the decoded
 * pixels a layer pipeline starts from, inlined so documents replay anywhere
 * without a fetch. Sources used by more than one layer are stored once.
 */
export interface SerializedSource {
  readonly width: number
  readonly height: number
  /** Base64 RGBA bytes, row-major, `width * height * 4` long once decoded. */
  readonly data64: string
}

/** One layer of a serialized document. */
export interface SerializedLayer {
  /** Key into the document's `sources` table. */
  readonly source: string
  /** The layer pipeline's ops, exactly as {@link ImagePipe.history} emits them. */
  readonly ops: readonly SerializedOp[]
  readonly x: number
  readonly y: number
  readonly opacity: number
  readonly blend: BlendMode
  readonly visible: boolean
  readonly name?: string
}

/**
 * A serialized document: a versioned envelope of JSON-safe data, produced by
 * {@link PipeDocument.toJSON} and accepted by {@link fromJSON}.
 *
 * `version: 2` slots into the same envelope scheme as
 * {@link SerializedHistory}, so a v1 reader (`pipe()`) rejects a document
 * cleanly instead of replaying garbage.
 */
export interface SerializedDocument {
  /** Serialization format version. Currently always `2`. */
  readonly version: 2
  readonly canvas: {
    readonly width: number
    readonly height: number
    readonly background: string
  }
  /** Content sources keyed by id, shared across layers. */
  readonly sources: Readonly<Record<string, SerializedSource>>
  /** Layers bottom to top. */
  readonly layers: readonly SerializedLayer[]
}
