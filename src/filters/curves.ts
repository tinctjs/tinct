import { defineFilter, type FilterFactory } from '../core/filter'

/** One curve control point: `[input, output]`, both `0..255`. */
export type CurvePoint = [number, number]

/**
 * Options for {@link curves}. Each channel is an array of control points
 * interpolated with a monotone cubic spline (no overshoot), evaluated as a
 * lookup table. Outside the outermost points the curve clamps to their
 * output values. Channels without points are left unchanged; the `rgb`
 * curve applies first, then any per-channel curve.
 */
export type CurvesOptions = {
  /** Master curve applied to red, green and blue. */
  rgb?: CurvePoint[]
  /** Red-only curve. */
  r?: CurvePoint[]
  /** Green-only curve. */
  g?: CurvePoint[]
  /** Blue-only curve. */
  b?: CurvePoint[]
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson): passes through every
 * control point, never overshoots between them — exactly what a tone curve
 * needs.
 */
function buildLut(points: CurvePoint[] | undefined): Uint8ClampedArray | null {
  if (!points || points.length === 0) return null
  const sorted = [...points]
    .map(([x, y]): CurvePoint => [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))])
    .sort((a, b) => a[0] - b[0])
    // Deduplicate identical inputs (the later point wins).
    .filter((p, i, arr) => i === arr.length - 1 || arr[i + 1]![0] !== p[0])

  const lut = new Uint8ClampedArray(256)
  const n = sorted.length
  if (n === 1) {
    lut.fill(sorted[0]![1])
    return lut
  }

  // Fritsch–Carlson tangents.
  const xs = sorted.map((p) => p[0])
  const ys = sorted.map((p) => p[1])
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    slopes.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!))
  }
  const tangents: number[] = [slopes[0]!]
  for (let i = 1; i < n - 1; i++) {
    const a = slopes[i - 1]!
    const b = slopes[i]!
    tangents.push(a * b <= 0 ? 0 : (3 * (a + b)) / ((2 * b + a) / a + (2 * a + b) / b))
  }
  tangents.push(slopes[n - 2]!)

  let segment = 0
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]!) {
      lut[v] = ys[0]!
      continue
    }
    if (v >= xs[n - 1]!) {
      lut[v] = ys[n - 1]!
      continue
    }
    while (v > xs[segment + 1]!) segment++
    const h = xs[segment + 1]! - xs[segment]!
    const t = (v - xs[segment]!) / h
    const t2 = t * t
    const t3 = t2 * t
    lut[v] =
      (2 * t3 - 3 * t2 + 1) * ys[segment]! +
      (t3 - 2 * t2 + t) * h * tangents[segment]! +
      (-2 * t3 + 3 * t2) * ys[segment + 1]! +
      (t3 - t2) * h * tangents[segment + 1]!
  }
  return lut
}

/**
 * Tone curves with serializable control points — the building block for
 * shareable "preset" looks: a preset is just JSON that replays through
 * {@link TinctImage.pipe}.
 *
 * Runs on the CPU path in v0.2 (the shader pipeline does not carry LUT
 * textures yet).
 *
 * @example
 * ```ts
 * // Faded-film look: lifted blacks, soft highlights.
 * image.apply(curves({ rgb: [[0, 24], [64, 72], [192, 200], [255, 240]] }))
 * // Cool the shadows via the blue channel only.
 * image.apply(curves({ b: [[0, 30], [255, 255]] }))
 * ```
 */
export const curves: FilterFactory<CurvesOptions> = /* @__PURE__ */ defineFilter<CurvesOptions>({
  name: 'curves',
  fallback: (pixels, { rgb, r, g, b }) => {
    const master = buildLut(rgb)
    const luts = [buildLut(r), buildLut(g), buildLut(b)]
    if (!master && !luts[0] && !luts[1] && !luts[2]) return undefined
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = data[i + c]!
        if (master) v = master[v]!
        const lut = luts[c]
        if (lut) v = lut[v]!
        data[i + c] = v
      }
    }
    return undefined
  },
})
