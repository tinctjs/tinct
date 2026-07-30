import { defineFilter, type FilterFactory } from '../core/filter'
import { lerp, luma } from './internal'

/** Options for {@link grayscale}. */
export type GrayscaleOptions = {
  /**
   * Blend between the original (`0`) and fully desaturated (`1`) image.
   * @defaultValue `1`
   */
  amount?: number
}

/**
 * Convert to grayscale using perceptual (Rec. 709 luma) weights.
 *
 * @example
 * ```ts
 * image.apply(grayscale())
 * image.apply(grayscale({ amount: 0.5 }))
 * ```
 */
export const grayscale: FilterFactory<GrayscaleOptions> =
  /* @__PURE__ */ defineFilter<GrayscaleOptions>({
    name: 'grayscale',
    defaults: { amount: 1 },
    fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_amount;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(mix(c.rgb, vec3(g), u_amount), c.a);
}
`,
    uniforms: ({ amount = 1 }) => ({ u_amount: amount }),
    fallback: (pixels, { amount = 1 }) => {
      const { data } = pixels
      for (let i = 0; i < data.length; i += 4) {
        const g = luma(data[i]!, data[i + 1]!, data[i + 2]!)
        data[i] = lerp(data[i]!, g, amount)
        data[i + 1] = lerp(data[i + 1]!, g, amount)
        data[i + 2] = lerp(data[i + 2]!, g, amount)
      }
      return undefined
    },
  })
