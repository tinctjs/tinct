/**
 * Auxiliary textures and linear sampling on a real WebGL2 context: the GPU
 * path with a bound second texture (and bilinear source sampling) must
 * match the CPU twins within the established parity tolerance.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { defineFilter } from '../src/core/filter'
import { execute, type OpNode } from '../src/core/executor'
import { _setGpuBackend } from '../src/gl/backend'
import { getWebgl2Backend } from '../src/gl/renderer'
import { createPixelData, type PixelData } from '../src/core/pixel'

const W = 48
const H = 32

function gradient(): PixelData {
  const p = createPixelData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      p.data[i] = Math.round((x / (W - 1)) * 255)
      p.data[i + 1] = Math.round((y / (H - 1)) * 255)
      p.data[i + 2] = 160
      p.data[i + 3] = 255
    }
  }
  return p
}

/** Deterministic pattern texture, same size as the image. */
function pattern(): PixelData {
  const p = createPixelData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      p.data[i] = (x * 53 + y * 31) % 256
      p.data[i + 1] = (x * 17 + y * 71) % 256
      p.data[i + 2] = (x * 97 + y * 13) % 256
      p.data[i + 3] = 255
    }
  }
  return p
}

const PATTERN = pattern()

/** 50/50 blend of the image with an aux texture (nearest, texel-aligned). */
const blend = defineFilter({
  name: 'test-tex-blend',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_pattern;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 a = texture(u_image, v_texCoord);
  vec4 b = texture(u_pattern, v_texCoord);
  outColor = vec4(mix(a.rgb, b.rgb, 0.5), a.a);
}
`,
  textures: () => [{ name: 'u_pattern', pixels: PATTERN }],
  fallback: (pixels) => {
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (data[i]! + PATTERN.data[i]!) / 2
      data[i + 1] = (data[i + 1]! + PATTERN.data[i + 1]!) / 2
      data[i + 2] = (data[i + 2]! + PATTERN.data[i + 2]!) / 2
    }
    return pixels
  },
})

/** Samples the source half a pixel to the right with bilinear filtering. */
const halfShift = defineFilter({
  name: 'test-linear-shift',
  linearSource: true,
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  outColor = texture(u_image, v_texCoord + vec2(0.5 / u_resolution.x, 0.0));
}
`,
  fallback: (pixels) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const j = (y * width + Math.min(width - 1, x + 1)) * 4
        for (let c = 0; c < 3; c++) out[i + c] = (data[i + c]! + data[j + c]!) / 2
        out[i + 3] = data[i + 3]!
      }
    }
    return { width, height, data: out }
  },
})

void blend
void halfShift

afterEach(() => {
  _setGpuBackend(undefined)
})

async function parity(name: string, maxDelta: number): Promise<void> {
  const ops: OpNode[] = [{ op: 'filter', params: { name, options: {} } }]
  const backend = getWebgl2Backend()
  expect(backend).not.toBeNull()

  _setGpuBackend(backend)
  const gpu = await execute(gradient(), ops)
  _setGpuBackend(null)
  const cpu = await execute(gradient(), ops)

  let worst = 0
  for (let i = 0; i < cpu.data.length; i++) {
    worst = Math.max(worst, Math.abs(gpu.data[i]! - cpu.data[i]!))
  }
  expect(worst).toBeLessThanOrEqual(maxDelta)
}

describe('textured passes on a real GPU', () => {
  test('aux-texture blend matches the CPU twin', async () => {
    await parity('test-tex-blend', 1)
  })

  test('bilinear source sampling matches the CPU twin', async () => {
    await parity('test-linear-shift', 1)
  })
})
