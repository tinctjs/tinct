/**
 * Color extraction: dominant color and palettes via median-cut
 * quantization. Deterministic — the same pixels give the same palette
 * everywhere — and tiny, in keeping with the per-module budgets.
 *
 * ```ts
 * import { palette, dominantColor } from 'tinctjs/palette'
 *
 * const pixels = await image.toImageData()
 * dominantColor(pixels).hex          // '#98572b'
 * palette(pixels, { colors: 4 })     // ranked by population
 * ```
 *
 * @packageDocumentation
 */

import type { PixelData } from '../core/pixel'
import { resample } from '../cpu/resample'

/** One extracted color. */
export interface PaletteColor {
  /** Channel values `0..255`. */
  rgb: [number, number, number]
  /** Lowercase `#rrggbb`. */
  hex: string
  /** Fraction of sampled pixels in this color's cluster, `0..1`. */
  population: number
}

/** Options for {@link palette}. */
export interface PaletteOptions {
  /**
   * Number of colors to extract, `1..32`.
   * @defaultValue `6`
   */
  colors?: number
}

/** Analysis resolution: quantization runs on a copy at most this wide/tall. */
const SAMPLE_SIZE = 64
/** Pixels more transparent than this are not part of the subject. */
const MIN_ALPHA = 128

interface Box {
  start: number
  end: number // exclusive
}

/**
 * Extract a palette of up to `colors` colors, ranked by population
 * (median-cut over a downsampled copy; fully transparent regions are
 * excluded). May return fewer colors than requested for images with little
 * color variety.
 */
export function palette(pixels: PixelData, options?: PaletteOptions): PaletteColor[] {
  const count = Math.max(1, Math.min(32, Math.floor(options?.colors ?? 6)))
  const samples = samplePixels(pixels)
  if (samples.length === 0) return []

  // Median cut: repeatedly split the most populous box along its widest
  // channel at the median until we have `count` boxes.
  const boxes: Box[] = [{ start: 0, end: samples.length }]
  while (boxes.length < count) {
    // Split the most populous box that still has color variation; uniform
    // boxes (range 0) are final — splitting them would just duplicate colors.
    let victim = -1
    let victimSize = 1
    for (let i = 0; i < boxes.length; i++) {
      const size = boxes[i]!.end - boxes[i]!.start
      if (size > victimSize && widestChannel(samples, boxes[i]!).range > 0) {
        victim = i
        victimSize = size
      }
    }
    if (victim < 0) break
    const box = boxes[victim]!
    const { channel } = widestChannel(samples, box)
    const segment = samples.slice(box.start, box.end)
    segment.sort((a, b) => a[channel] - b[channel])
    for (let i = 0; i < segment.length; i++) samples[box.start + i] = segment[i]!

    // Cut at the largest value gap so distinct clusters separate cleanly
    // (a plain count-median slices through the bigger cluster); for
    // continuous data all gaps tie and the middle wins.
    const middle = segment.length >> 1
    let cut = middle
    let bestGap = -1
    for (let i = 1; i < segment.length; i++) {
      const gap = segment[i]![channel] - segment[i - 1]![channel]
      if (gap > bestGap || (gap === bestGap && Math.abs(i - middle) < Math.abs(cut - middle))) {
        bestGap = gap
        cut = i
      }
    }
    const mid = box.start + cut
    boxes.splice(victim, 1, { start: box.start, end: mid }, { start: mid, end: box.end })
  }

  const raw = boxes.map((box) => {
    let r = 0
    let g = 0
    let b = 0
    for (let i = box.start; i < box.end; i++) {
      r += samples[i]![0]
      g += samples[i]![1]
      b += samples[i]![2]
    }
    const n = box.end - box.start
    return {
      rgb: [r / n, g / n, b / n] as [number, number, number],
      population: n / samples.length,
    }
  })

  // Count-median splits can slice through one big cluster and produce
  // near-identical swatches; merge them (population-weighted) so each
  // returned color is distinct.
  const merged: typeof raw = []
  for (const color of raw) {
    const near = merged.find((m) => m.rgb.every((v, c) => Math.abs(v - color.rgb[c]!) <= 8))
    if (near) {
      const total = near.population + color.population
      near.rgb = near.rgb.map(
        (v, c) => (v * near.population + color.rgb[c]! * color.population) / total,
      ) as [number, number, number]
      near.population = total
    } else {
      merged.push({ ...color })
    }
  }

  return merged
    .map(({ rgb, population }) => {
      const rounded: [number, number, number] = [
        Math.round(rgb[0]),
        Math.round(rgb[1]),
        Math.round(rgb[2]),
      ]
      return { rgb: rounded, hex: toHex(rounded), population }
    })
    .sort((a, b) => b.population - a.population || a.hex.localeCompare(b.hex))
}

/** The single most representative color (the top of {@link palette}). */
export function dominantColor(pixels: PixelData): PaletteColor {
  const [top] = palette(pixels, { colors: 4 })
  if (!top) {
    // Fully transparent image: nothing to sample.
    return { rgb: [0, 0, 0], hex: '#000000', population: 0 }
  }
  return top
}

function samplePixels(pixels: PixelData): [number, number, number][] {
  const scale = SAMPLE_SIZE / Math.max(pixels.width, pixels.height)
  const small =
    scale >= 1
      ? pixels
      : resample(
          pixels,
          Math.max(1, Math.round(pixels.width * scale)),
          Math.max(1, Math.round(pixels.height * scale)),
          'triangle',
        )
  const out: [number, number, number][] = []
  const { data } = small
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < MIN_ALPHA) continue
    out.push([data[i]!, data[i + 1]!, data[i + 2]!])
  }
  return out
}

function widestChannel(
  samples: [number, number, number][],
  box: Box,
): { channel: 0 | 1 | 2; range: number } {
  const min = [255, 255, 255]
  const max = [0, 0, 0]
  for (let i = box.start; i < box.end; i++) {
    for (let c = 0; c < 3; c++) {
      const v = samples[i]![c]!
      if (v < min[c]!) min[c] = v
      if (v > max[c]!) max[c] = v
    }
  }
  const ranges = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!]
  let channel: 0 | 1 | 2 = 0
  if (ranges[1]! > ranges[channel]!) channel = 1
  if (ranges[2]! > ranges[channel]!) channel = 2
  return { channel, range: ranges[channel]! }
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
