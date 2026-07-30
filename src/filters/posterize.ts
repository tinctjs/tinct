import { defineFilter, type FilterFactory } from '../core/filter'

/** Options for {@link posterize}. */
export type PosterizeOptions = {
  /**
   * Number of tonal levels per channel, `2..255`.
   * @defaultValue `4`
   */
  levels?: number
}

/**
 * Reduce each channel to a fixed number of levels for a screen-print look.
 *
 * @example
 * ```ts
 * image.apply(posterize({ levels: 3 }))
 * ```
 */
export const posterize: FilterFactory<PosterizeOptions> =
  /* @__PURE__ */ defineFilter<PosterizeOptions>({
    name: 'posterize',
    defaults: { levels: 4 },
    fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_steps;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 q = floor(c.rgb * u_steps + 0.5) / u_steps;
  outColor = vec4(q, c.a);
}
`,
    uniforms: ({ levels = 4 }) => ({
      u_steps: Math.max(2, Math.min(255, Math.floor(levels))) - 1,
    }),
    fallback: (pixels, { levels = 4 }) => {
      const n = Math.max(2, Math.min(255, Math.floor(levels)))
      const step = 255 / (n - 1)
      const lut = new Uint8ClampedArray(256)
      for (let v = 0; v < 256; v++) {
        lut[v] = Math.round(Math.round(v / step) * step)
      }
      const { data } = pixels
      for (let i = 0; i < data.length; i += 4) {
        data[i] = lut[data[i]!]!
        data[i + 1] = lut[data[i + 1]!]!
        data[i + 2] = lut[data[i + 2]!]!
      }
      return undefined
    },
  })
