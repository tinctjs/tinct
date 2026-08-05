/**
 * Recipe compilation for live sessions: turns a serialized history into GPU
 * passes plus their byte-identical CPU twins, rejecting anything that cannot
 * run per-frame.
 *
 * Live pipelines are color-only by design: geometry ops (crop, resize,
 * rotate, flip, overlay) change dimensions or need CPU resampling, and
 * shaderless filters would make a recipe behave differently on GPU and CPU
 * paths. Rejection is uniform so a recipe that works on one machine works on
 * all of them.
 *
 * @packageDocumentation
 * @internal
 */

import { toGpuPass } from '../core/executor'
import type { PixelData } from '../core/pixel'
import type { SerializedHistory, SerializedOp } from '../core/types'
import type { GpuPass } from '../gl/backend'

/** @internal A compiled live recipe: shader passes and their CPU twins. */
export interface LivePlan {
  readonly passes: readonly GpuPass[]
  readonly cpu: readonly ((pixels: PixelData) => PixelData)[]
}

/** @internal Normalize the envelope / bare-array forms, mirroring `ImagePipe.pipe`. */
export function normalizeHistory(
  history: SerializedHistory | readonly SerializedOp[],
): readonly SerializedOp[] {
  if (Array.isArray(history)) return history as readonly SerializedOp[]
  const envelope = history as SerializedHistory
  // Runtime data may carry any version despite the compile-time literal.
  if ((envelope.version as number) !== 1) {
    throw new Error(
      `imagepipe: cannot replay history version ${String(envelope.version)} — it was saved by a newer version of imagepipe`,
    )
  }
  return envelope.ops
}

/**
 * @internal
 * Compile a recipe into a {@link LivePlan}, throwing a descriptive error for
 * any op a live session cannot run.
 */
export function compileRecipe(history: SerializedHistory | readonly SerializedOp[]): LivePlan {
  const passes: GpuPass[] = []
  const cpu: ((pixels: PixelData) => PixelData)[] = []
  for (const op of normalizeHistory(history)) {
    const queued = toGpuPass(op)
    if (!queued) {
      const detail =
        op.op === 'filter'
          ? `filter '${op.params.name}' has no GPU shader`
          : `'${op.op}' changes geometry`
      throw new Error(
        `imagepipe: live pipelines run color ops only — ${detail}. Supported live: adjust, and filters that ship a fragment shader.`,
      )
    }
    passes.push(...queued.passes)
    cpu.push(queued.cpu)
  }
  return { passes, cpu }
}
