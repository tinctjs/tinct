/**
 * Content-aware `'face'` crop gravity.
 *
 * ```ts
 * import { enableFaceGravity } from 'tinctjs/face'
 *
 * enableFaceGravity()
 * image.crop({ aspect: '1:1', gravity: 'face' })
 * ```
 *
 * Detection is deterministic and platform-agnostic (no `FaceDetector` API,
 * no model downloads): identical input pixels give identical crops in every
 * browser and in workers, so serialized histories replay exactly.
 *
 * **Color matters.** The face stage reads skin chroma, so on grayscale
 * images it cannot fire and detection degrades to salient-subject framing
 * (which still centers on the high-detail region — usually the person, but
 * with no face-specific signal). Heavily color-graded images sit in
 * between. Measured on the labeled eval set (`scripts/face-eval`): focal
 * accuracy 9/10 color, 6/10 sepia, 3/10 grayscale — while the produced
 * 1:1 and 9:16 crops contained a face in every case, in all three variants.
 * Apply `'face'` crops before desaturating filters in your chain.
 *
 * @packageDocumentation
 */

import { gravityRegistry } from '../core/gravity'
import type { PixelData } from '../core/pixel'
import { findFocalPoint } from './detect'

/**
 * Register the `'face'` gravity resolver so
 * `crop({ aspect, gravity: 'face' })` works. Call once at startup; calling
 * again is a no-op. The explicit call (rather than a bare side-effect
 * import) keeps the detector tree-shakeable for consumers who never use it.
 */
export function enableFaceGravity(): void {
  gravityRegistry.set('face', (pixels, cropWidth, cropHeight) => {
    const focal = findFocalPoint(pixels)
    return {
      x: Math.round(focal.x - cropWidth / 2),
      // Bias the subject toward the upper third — the natural framing for
      // faces — instead of dead center.
      y: Math.round(focal.y - cropHeight * 0.42),
    }
  })
}

/**
 * The detector behind `'face'` gravity: the most likely subject location in
 * pixels. Exposed for advanced use (e.g. drawing your own crop UI seeded
 * with the detected subject).
 */
export function locateSubject(pixels: PixelData): { x: number; y: number } {
  return findFocalPoint(pixels)
}
