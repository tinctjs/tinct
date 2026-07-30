import { defineFilter, type FilterFactory } from '../core/filter'
import { gaussianBlur } from '../cpu/convolve'

/** Options for {@link sharpen}. */
export type SharpenOptions = {
  /**
   * Sharpening strength (unsharp-mask amount), `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
}

/**
 * Single-pass unsharp mask: the σ=1 gaussian is small enough (7×7) to
 * compute inline while the original pixel is still at hand. Premultiplied
 * accumulation mirrors the CPU blur it subtracts.
 */
const SHARPEN_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_strength;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 src = texture(u_image, v_texCoord);
  vec3 rgb = vec3(0.0);
  float asum = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      float w = exp(-float(i * i + j * j) / 2.0);
      vec4 c = texture(u_image, v_texCoord + vec2(float(i), float(j)) / u_resolution);
      float wa = w * c.a;
      rgb += c.rgb * wa;
      asum += wa;
    }
  }
  vec3 blurred = asum > 1e-6 ? rgb / asum : vec3(0.0);
  outColor = vec4(clamp(src.rgb + (src.rgb - blurred) * u_strength, 0.0, 1.0), src.a);
}
`

/**
 * Sharpen edges using an unsharp mask (original + amount × high-pass).
 *
 * @example
 * ```ts
 * image.apply(sharpen({ amount: 0.8 }))
 * ```
 */
export const sharpen: FilterFactory<SharpenOptions> = /* @__PURE__ */ defineFilter<SharpenOptions>({
  name: 'sharpen',
  defaults: { amount: 0.5 },
  fragment: SHARPEN_FRAGMENT,
  uniforms: ({ amount = 0.5 }) => ({ u_strength: Math.max(0, amount) * 2 }),
  fallback: (pixels, { amount = 0.5 }) => {
    if (amount <= 0) return undefined
    const blurred = gaussianBlur(pixels, 1)
    const { data } = pixels
    const strength = amount * 2
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i]! + (data[i]! - blurred.data[i]!) * strength
      data[i + 1] = data[i + 1]! + (data[i + 1]! - blurred.data[i + 1]!) * strength
      data[i + 2] = data[i + 2]! + (data[i + 2]! - blurred.data[i + 2]!) * strength
    }
    return undefined
  },
})
