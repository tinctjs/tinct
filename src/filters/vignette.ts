import { defineFilter, type FilterFactory } from '../core/filter'
import { parseColor } from '../cpu/color'
import { lerp } from './internal'

/** Options for {@link vignette}. */
export type VignetteOptions = {
  /**
   * Darkening strength at the corners, `0..1`.
   * @defaultValue `0.5`
   */
  amount?: number
  /**
   * Radius where the falloff starts, as a fraction of the distance from the
   * center to a corner, `0..1`. Smaller values darken more of the frame.
   * @defaultValue `0.75`
   */
  radius?: number
  /**
   * Vignette color (`#rgb[a]`, `#rrggbb[aa]`, `rgb()`/`rgba()`, or a basic
   * named color).
   * @defaultValue `'#000000'`
   */
  color?: string
}

/**
 * Darken the corners with a smooth radial falloff.
 *
 * @example
 * ```ts
 * image.apply(vignette({ amount: 0.6 }))
 * ```
 */
export const vignette: FilterFactory<VignetteOptions> =
  /* @__PURE__ */ defineFilter<VignetteOptions>({
    name: 'vignette',
    defaults: { amount: 0.5, radius: 0.75, color: '#000000' },
    fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_amount;
uniform float u_radius;
uniform vec3 u_color;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec2 pos = (v_texCoord - 0.5) * u_resolution;
  float n = length(pos) / (0.5 * length(u_resolution));
  float t = u_radius >= 1.0 ? 0.0 : smoothstep(u_radius, 1.0, n) * u_amount;
  outColor = vec4(mix(c.rgb, u_color, t), c.a);
}
`,
    uniforms: ({ amount = 0.5, radius = 0.75, color = '#000000' }) => {
      const [r, g, b] = parseColor(color)
      return {
        u_amount: amount,
        u_radius: Math.max(0, Math.min(1, radius)),
        u_color: [r / 255, g / 255, b / 255],
      }
    },
    fallback: (pixels, { amount = 0.5, radius = 0.75, color = '#000000' }) => {
      if (amount <= 0) return undefined
      const [vr, vg, vb] = parseColor(color)
      const { width, height, data } = pixels
      const cx = width / 2
      const cy = height / 2
      const maxDist = Math.sqrt(cx * cx + cy * cy)
      const start = Math.max(0, Math.min(1, radius))

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const n = Math.sqrt(dx * dx + dy * dy) / maxDist
          if (n <= start) continue
          // smoothstep from the start radius to the corner
          const t = start >= 1 ? 0 : Math.min(1, (n - start) / (1 - start))
          const blend = t * t * (3 - 2 * t) * amount
          const i = (y * width + x) * 4
          data[i] = lerp(data[i]!, vr, blend)
          data[i + 1] = lerp(data[i + 1]!, vg, blend)
          data[i + 2] = lerp(data[i + 2]!, vb, blend)
        }
      }
      return undefined
    },
  })
