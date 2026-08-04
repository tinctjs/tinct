/**
 * Separable blend functions from W3C Compositing and Blending Level 1.
 *
 * A blend function takes backdrop and source channel values in `0..1` and
 * returns the blended value; {@link compositeOver} folds it into the
 * source-over alpha math. `'source-over'` needs no function at all — it is
 * the identity case the compositor already implements — so it is absent from
 * the table and callers pass `undefined` for it.
 *
 * This module is imported only by `layers/`; core never pulls it in.
 *
 * @packageDocumentation
 * @internal
 */

/** Blend modes supported by layer compositing. */
export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'darken' | 'lighten'

/** @internal Every blend mode, for validation and docs. */
export const BLEND_MODES: readonly BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'darken',
  'lighten',
]

/** @internal `B(Cb, Cs)` — backdrop and source channels in `0..1`. */
export type BlendFn = (backdrop: number, source: number) => number

const SEPARABLE: Partial<Record<BlendMode, BlendFn>> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  darken: (b, s) => (b < s ? b : s),
  lighten: (b, s) => (b > s ? b : s),
}

/**
 * @internal
 * The blend function for `mode`, or `undefined` for `'source-over'` (whose
 * `B(Cb, Cs) = Cs` reduces the general formula to plain source-over).
 * Throws on an unknown mode so bad serialized data fails loudly.
 */
export function blendFn(mode: BlendMode): BlendFn | undefined {
  if (mode === 'source-over') return undefined
  const fn = SEPARABLE[mode]
  if (!fn) {
    throw new Error(
      `imagepipe: unknown blend mode '${mode}' — expected one of ${BLEND_MODES.join(', ')}`,
    )
  }
  return fn
}
