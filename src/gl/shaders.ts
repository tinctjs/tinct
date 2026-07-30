/**
 * The internal adjust shader — the GPU twin of `cpu/adjust.ts`, using the
 * same coefficients and operation order (exposure → brightness → contrast →
 * saturation/hue matrix → gamma). CPU quantizes to bytes between stages while
 * the GPU stays in floats, so outputs can differ by a couple of LSB; the
 * tolerance-based tests account for that.
 *
 * @packageDocumentation
 * @internal
 */

import type { AdjustOptions } from '../core/types'
import { buildColorMatrix } from '../cpu/adjust'

/** @internal Fragment shader implementing the full adjust pipeline. */
export const ADJUST_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_gain;
uniform float u_offset;
uniform float u_slope;
uniform mat3 u_colorMatrix;
uniform float u_gamma;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 rgb = c.rgb;
  rgb = (rgb * u_gain + u_offset - 0.5) * u_slope + 0.5;
  rgb = clamp(rgb, 0.0, 1.0);
  rgb = clamp(u_colorMatrix * rgb, 0.0, 1.0);
  rgb = pow(rgb, vec3(u_gamma));
  outColor = vec4(rgb, c.a);
}
`

const IDENTITY_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const

/** @internal Uniforms for {@link ADJUST_FRAGMENT}, mirroring the CPU LUT math. */
export function adjustUniforms(options: AdjustOptions): Record<string, number | readonly number[]> {
  const {
    brightness = 0,
    contrast = 0,
    saturation = 0,
    exposure = 0,
    hue = 0,
    gamma = 1,
    temperature = 0,
    tint = 0,
  } = options
  return {
    u_gain: Math.pow(2, 2 * exposure),
    u_offset: brightness,
    u_slope: Math.min(1e4, Math.tan(((Math.min(contrast, 0.9999) + 1) * Math.PI) / 4)),
    u_colorMatrix: buildColorMatrix(saturation, hue, temperature, tint) ?? IDENTITY_MATRIX,
    u_gamma: Math.max(0.1, Math.min(4, gamma)),
  }
}
