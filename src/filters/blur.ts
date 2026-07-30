import { defineFilter, type FilterFactory } from '../core/filter'
import { gaussianBlur } from '../cpu/convolve'

/** Options for {@link blur}. */
export type BlurOptions = {
  /**
   * Gaussian blur radius (standard deviation) in pixels, `0..100`.
   * @defaultValue `4`
   */
  radius?: number
}

/**
 * One separable 1D gaussian pass; `u_direction` selects the axis. Mirrors
 * the CPU kernel: same ±3σ support, edge-clamped sampling, and
 * alpha-premultiplied accumulation to avoid halos at transparent edges.
 */
const BLUR_PASS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_direction;
uniform float u_sigma;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  float sigma = max(u_sigma, 1e-4);
  int radius = int(ceil(3.0 * sigma));
  float twoS2 = 2.0 * sigma * sigma;
  vec3 rgb = vec3(0.0);
  float asum = 0.0;
  float wsum = 0.0;
  for (int i = -radius; i <= radius; i++) {
    float w = exp(-float(i * i) / twoS2);
    vec4 c = texture(u_image, v_texCoord + u_direction * float(i) / u_resolution);
    float wa = w * c.a;
    rgb += c.rgb * wa;
    asum += wa;
    wsum += w;
  }
  outColor = vec4(asum > 1e-6 ? rgb / asum : vec3(0.0), asum / wsum);
}
`

/**
 * Gaussian blur (separable, so cost grows linearly with radius).
 *
 * @example
 * ```ts
 * image.apply(blur({ radius: 4 }))
 * ```
 */
export const blur: FilterFactory<BlurOptions> = /* @__PURE__ */ defineFilter<BlurOptions>({
  name: 'blur',
  defaults: { radius: 4 },
  fallback: (pixels, { radius = 4 }) => gaussianBlur(pixels, Math.min(100, Math.max(0, radius))),
  passes: ({ radius = 4 }) => {
    const sigma = Math.min(100, Math.max(0, radius))
    if (sigma <= 0) return [] // no-op, matching the CPU kernel
    return [
      { fragment: BLUR_PASS, uniforms: { u_sigma: sigma, u_direction: [1, 0] } },
      { fragment: BLUR_PASS, uniforms: { u_sigma: sigma, u_direction: [0, 1] } },
    ]
  },
})
