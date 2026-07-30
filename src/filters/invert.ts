import { defineFilter, type FilterFactory } from '../core/filter'

/** Options for {@link invert}. */
export type InvertOptions = Record<string, never>

/**
 * Invert every color channel (negative). Alpha is preserved.
 *
 * @example
 * ```ts
 * image.apply(invert())
 * ```
 */
export const invert: FilterFactory<InvertOptions> = /* @__PURE__ */ defineFilter<InvertOptions>({
  name: 'invert',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  outColor = vec4(1.0 - c.rgb, c.a);
}
`,
  fallback: (pixels) => {
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]!
      data[i + 1] = 255 - data[i + 1]!
      data[i + 2] = 255 - data[i + 2]!
    }
    return undefined
  },
})
