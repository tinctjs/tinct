/**
 * Booth's FX pack — six custom filters defined *in the app* with
 * `defineFilter`, each a single GLSL fragment pass plus a CPU fallback.
 *
 * This is the extensibility story in practice: a filter defined here is a
 * first-class citizen — it serializes into recipes by name, replays through
 * the still pipeline for snapshots, and (because it ships a fragment
 * shader) runs live at full frame rate. None of these exist in the
 * library; they're ~40 lines each.
 */
import { defineFilter, type PixelData } from 'imagepipe'

/** '#rrggbb' → [r, g, b] in 0..1 for uniforms, 0..255 for CPU kernels. */
function hex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Nearest-neighbour sample at texcoord (u,v) — mirrors GL NEAREST+clamp. */
function sample(p: PixelData, u: number, v: number): [number, number, number] {
  const x = Math.min(p.width - 1, Math.max(0, Math.floor(u * p.width)))
  const y = Math.min(p.height - 1, Math.max(0, Math.floor(v * p.height)))
  const i = (y * p.width + x) * 4
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!]
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/* ------------------------------------------------------------------ */
/* Halftone — rotated-grid comic print                                 */
/* ------------------------------------------------------------------ */

export const halftone = defineFilter<{ size?: number }>({
  name: 'booth-halftone',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_size;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  float a = 0.5236;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  mat2 Ri = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 p = v_texCoord * u_resolution;
  vec2 cell = Ri * ((floor(R * p / u_size) + 0.5) * u_size);
  vec4 c = texture(u_image, clamp(cell / u_resolution, 0.0, 1.0));
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float radius = (1.0 - l) * 0.7071 * u_size;
  float ink = 1.0 - smoothstep(radius - 0.7, radius + 0.7, distance(p, cell));
  outColor = vec4(mix(vec3(0.96, 0.94, 0.90), vec3(0.13, 0.11, 0.10), ink), c.a);
}
`,
  uniforms: ({ size }) => ({ u_size: size ?? 8 }),
  fallback: (pixels, { size = 8 }) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    const a = 0.5236
    const [ca, sa] = [Math.cos(a), Math.sin(a)]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const gx = Math.floor((ca * px + sa * py) / size) + 0.5
        const gy = Math.floor((-sa * px + ca * py) / size) + 0.5
        const cx = (ca * gx - sa * gy) * size
        const cy = (sa * gx + ca * gy) * size
        const [r, g, b] = sample(pixels, cx / width, cy / height)
        const l = luma(r, g, b) / 255
        const radius = (1 - l) * 0.7071 * size
        const d = Math.hypot(px - cx, py - cy)
        const ink = 1 - smoothstep(radius - 0.7, radius + 0.7, d)
        const i = (y * width + x) * 4
        out[i] = 245 - ink * (245 - 33)
        out[i + 1] = 240 - ink * (240 - 28)
        out[i + 2] = 230 - ink * (230 - 26)
        out[i + 3] = data[i + 3]!
      }
    }
    return { width, height, data: out }
  },
})

/* ------------------------------------------------------------------ */
/* Neon — Sobel edges as glowing wireframe                             */
/* ------------------------------------------------------------------ */

export const neon = defineFilter<{ color?: string; boost?: number }>({
  name: 'booth-neon',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec3 u_color;
uniform float u_boost;
in vec2 v_texCoord;
out vec4 outColor;
float lum(vec2 offset) {
  vec3 c = texture(u_image, clamp(v_texCoord + offset / u_resolution, 0.0, 1.0)).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  float tl = lum(vec2(-1.0, -1.0)), t = lum(vec2(0.0, -1.0)), tr = lum(vec2(1.0, -1.0));
  float l  = lum(vec2(-1.0,  0.0)),                            r  = lum(vec2(1.0,  0.0));
  float bl = lum(vec2(-1.0,  1.0)), b = lum(vec2(0.0,  1.0)), br = lum(vec2(1.0,  1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  float e = clamp(length(vec2(gx, gy)) * u_boost, 0.0, 1.0);
  vec4 base = texture(u_image, v_texCoord);
  outColor = vec4(base.rgb * 0.07 + u_color * e, base.a);
}
`,
  uniforms: ({ color, boost }) => {
    const [r, g, b] = hex(color ?? '#39ff14')
    return { u_color: [r / 255, g / 255, b / 255], u_boost: boost ?? 2.2 }
  },
  fallback: (pixels, { color = '#39ff14', boost = 2.2 }) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    const [nr, ng, nb] = hex(color)
    const lumAt = (x: number, y: number): number => {
      const cx = Math.min(width - 1, Math.max(0, x))
      const cy = Math.min(height - 1, Math.max(0, y))
      const i = (cy * width + cx) * 4
      return luma(data[i]!, data[i + 1]!, data[i + 2]!) / 255
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx =
          lumAt(x + 1, y - 1) +
          2 * lumAt(x + 1, y) +
          lumAt(x + 1, y + 1) -
          (lumAt(x - 1, y - 1) + 2 * lumAt(x - 1, y) + lumAt(x - 1, y + 1))
        const gy =
          lumAt(x - 1, y + 1) +
          2 * lumAt(x, y + 1) +
          lumAt(x + 1, y + 1) -
          (lumAt(x - 1, y - 1) + 2 * lumAt(x, y - 1) + lumAt(x + 1, y - 1))
        const e = clamp01(Math.hypot(gx, gy) * boost)
        const i = (y * width + x) * 4
        out[i] = data[i]! * 0.07 + nr * e
        out[i + 1] = data[i + 1]! * 0.07 + ng * e
        out[i + 2] = data[i + 2]! * 0.07 + nb * e
        out[i + 3] = data[i + 3]!
      }
    }
    return { width, height, data: out }
  },
})

/* ------------------------------------------------------------------ */
/* CRT — barrel warp, chroma fringe, scanlines, phosphor stripes       */
/* ------------------------------------------------------------------ */

export const crt = defineFilter<{ curvature?: number }>({
  name: 'booth-crt',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_curve;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  vec2 n = v_texCoord * 2.0 - 1.0;
  float r2 = dot(n, n);
  vec2 uv = (n * (1.0 + u_curve * r2)) * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float f = 0.0016 * (1.0 + r2);
  float cr = texture(u_image, clamp(uv + vec2(f, 0.0), 0.0, 1.0)).r;
  float cg = texture(u_image, uv).g;
  float cb = texture(u_image, clamp(uv - vec2(f, 0.0), 0.0, 1.0)).b;
  vec3 c = vec3(cr, cg, cb);
  float scan = 0.86 + 0.14 * sin(uv.y * u_resolution.y * 3.14159);
  float stripe = mod(floor(v_texCoord.x * u_resolution.x), 3.0);
  vec3 mask = vec3(stripe == 0.0 ? 1.06 : 0.94, stripe == 1.0 ? 1.06 : 0.94, stripe == 2.0 ? 1.06 : 0.94);
  float shade = 1.0 - 0.18 * r2;
  outColor = vec4(c * scan * mask * shade, 1.0);
}
`,
  uniforms: ({ curvature }) => ({ u_curve: curvature ?? 0.07 }),
  fallback: (pixels, { curvature = 0.07 }) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const nx = ((x + 0.5) / width) * 2 - 1
        const ny = ((y + 0.5) / height) * 2 - 1
        const r2 = nx * nx + ny * ny
        const u = nx * (1 + curvature * r2) * 0.5 + 0.5
        const v = ny * (1 + curvature * r2) * 0.5 + 0.5
        if (u < 0 || u > 1 || v < 0 || v > 1) {
          out[i] = out[i + 1] = out[i + 2] = 0
          out[i + 3] = 255
          continue
        }
        const f = 0.0016 * (1 + r2)
        const [cr] = sample(pixels, clamp01(u + f), v)
        const [, cg] = sample(pixels, u, v)
        const [, , cb] = sample(pixels, clamp01(u - f), v)
        const scan = 0.86 + 0.14 * Math.sin(v * height * Math.PI)
        const stripe = Math.floor((x + 0.5) % 3)
        const mask = [
          stripe === 0 ? 1.06 : 0.94,
          stripe === 1 ? 1.06 : 0.94,
          stripe === 2 ? 1.06 : 0.94,
        ]
        const shade = 1 - 0.18 * r2
        out[i] = cr * scan * mask[0]! * shade
        out[i + 1] = cg * scan * mask[1]! * shade
        out[i + 2] = cb * scan * mask[2]! * shade
        out[i + 3] = 255
      }
    }
    return { width, height, data: out }
  },
})

/* ------------------------------------------------------------------ */
/* Kaleido — angular mirror around the center                          */
/* ------------------------------------------------------------------ */

export const kaleido = defineFilter<{ segments?: number }>({
  name: 'booth-kaleido',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_segments;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 c = v_texCoord - 0.5;
  c.x *= aspect;
  float seg = 6.2831853 / u_segments;
  float ang = mod(atan(c.y, c.x), seg);
  ang = abs(ang - seg * 0.5);
  vec2 p = vec2(cos(ang), sin(ang)) * length(c);
  p.x /= aspect;
  outColor = texture(u_image, clamp(p + 0.5, 0.0, 1.0));
}
`,
  uniforms: ({ segments }) => ({ u_segments: segments ?? 6 }),
  fallback: (pixels, { segments = 6 }) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    const aspect = width / height
    const seg = (Math.PI * 2) / segments
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cx = ((x + 0.5) / width - 0.5) * aspect
        const cy = (y + 0.5) / height - 0.5
        let ang = Math.atan2(cy, cx) % seg
        if (ang < 0) ang += seg
        ang = Math.abs(ang - seg * 0.5)
        const rad = Math.hypot(cx, cy)
        const u = clamp01((Math.cos(ang) * rad) / aspect + 0.5)
        const v = clamp01(Math.sin(ang) * rad + 0.5)
        const [r, g, b] = sample(pixels, u, v)
        const i = (y * width + x) * 4
        out[i] = r
        out[i + 1] = g
        out[i + 2] = b
        out[i + 3] = data[i + 3]!
      }
    }
    return { width, height, data: out }
  },
})

/* ------------------------------------------------------------------ */
/* Thermal — luminance mapped onto an infrared palette                 */
/* ------------------------------------------------------------------ */

export const thermal = defineFilter<Record<string, never>>({
  name: 'booth-thermal',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_texCoord;
out vec4 outColor;
vec3 pal(float t) {
  vec3 a = vec3(0.05, 0.03, 0.30);
  vec3 b = vec3(0.45, 0.02, 0.55);
  vec3 c = vec3(0.90, 0.15, 0.15);
  vec3 d = vec3(1.00, 0.65, 0.05);
  vec3 e = vec3(1.00, 0.98, 0.75);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.50) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.50) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
void main() {
  vec4 s = texture(u_image, v_texCoord);
  float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(pal(l), s.a);
}
`,
  fallback: (pixels) => {
    const stops = [
      [13, 8, 77],
      [115, 5, 140],
      [230, 38, 38],
      [255, 166, 13],
      [255, 250, 191],
    ]
    const { data } = pixels
    for (let i = 0; i < data.length; i += 4) {
      const t = clamp01(luma(data[i]!, data[i + 1]!, data[i + 2]!) / 255)
      const seg = Math.min(3, Math.floor(t * 4))
      const f = t * 4 - seg
      const lo = stops[seg]!
      const hi = stops[seg + 1]!
      data[i] = lo[0]! + (hi[0]! - lo[0]!) * f
      data[i + 1] = lo[1]! + (hi[1]! - lo[1]!) * f
      data[i + 2] = lo[2]! + (hi[2]! - lo[2]!) * f
    }
    return pixels
  },
})

/* ------------------------------------------------------------------ */
/* Beautify — skin-masked bilateral smoothing                          */
/*                                                                     */
/* The classic camera-app beauty filter, honestly: a 9×9 bilateral     */
/* blur (spatial × color-range gaussian) that melts skin texture but   */
/* not edges, gated by the same YCbCr skin box the face module uses    */
/* for `gravity: 'face'` — so eyes, hair, and the background keep      */
/* their detail while skin gets the smoothing.                         */
/* ------------------------------------------------------------------ */

export const beautify = defineFilter<{ amount?: number; smoothing?: number }>({
  name: 'booth-beautify',
  fragment: `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_amount;
uniform float u_range;
in vec2 v_texCoord;
out vec4 outColor;
float skinMask(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float cb = 0.5 + 0.564 * (c.b - y);
  float cr = 0.5 + 0.713 * (c.r - y);
  return smoothstep(0.29, 0.32, cb) * (1.0 - smoothstep(0.49, 0.52, cb)) *
    smoothstep(0.51, 0.53, cr) * (1.0 - smoothstep(0.67, 0.69, cr)) *
    smoothstep(0.12, 0.2, y);
}
void main() {
  vec4 center = texture(u_image, v_texCoord);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int dy = -4; dy <= 4; dy++) {
    for (int dx = -4; dx <= 4; dx++) {
      vec2 uv = clamp(v_texCoord + vec2(float(dx), float(dy)) / u_resolution, 0.0, 1.0);
      vec3 s = texture(u_image, uv).rgb;
      float ws = exp(-float(dx * dx + dy * dy) / 18.0);
      vec3 d = s - center.rgb;
      float wr = exp(-dot(d, d) / (2.0 * u_range * u_range));
      float w = ws * wr;
      sum += s * w;
      wsum += w;
    }
  }
  vec3 smoothed = sum / wsum;
  float mask = skinMask(center.rgb) * u_amount;
  vec3 result = mix(center.rgb, smoothed, mask);
  result += mask * 0.06 * (1.0 - result);
  outColor = vec4(result, center.a);
}
`,
  uniforms: ({ amount, smoothing }) => ({
    u_amount: amount ?? 0.85,
    u_range: smoothing ?? 0.1,
  }),
  fallback: (pixels, { amount = 0.85, smoothing = 0.1 }) => {
    const { width, height, data } = pixels
    const out = new Uint8ClampedArray(data.length)
    const mask = (r: number, g: number, b: number): number => {
      const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      const cb = 0.5 + 0.564 * (b / 255 - y)
      const cr = 0.5 + 0.713 * (r / 255 - y)
      return (
        smoothstep(0.29, 0.32, cb) *
        (1 - smoothstep(0.49, 0.52, cb)) *
        smoothstep(0.51, 0.53, cr) *
        (1 - smoothstep(0.67, 0.69, cr)) *
        smoothstep(0.12, 0.2, y)
      )
    }
    const range = 2 * smoothing * smoothing
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const cr0 = data[i]! / 255
        const cg0 = data[i + 1]! / 255
        const cb0 = data[i + 2]! / 255
        let sr = 0
        let sg = 0
        let sb = 0
        let wsum = 0
        for (let dy = -4; dy <= 4; dy++) {
          const sy = Math.min(height - 1, Math.max(0, y + dy))
          for (let dx = -4; dx <= 4; dx++) {
            const sx = Math.min(width - 1, Math.max(0, x + dx))
            const j = (sy * width + sx) * 4
            const r = data[j]! / 255
            const g = data[j + 1]! / 255
            const b = data[j + 2]! / 255
            const dr = r - cr0
            const dg = g - cg0
            const db = b - cb0
            const w =
              Math.exp(-(dx * dx + dy * dy) / 18) * Math.exp(-(dr * dr + dg * dg + db * db) / range)
            sr += r * w
            sg += g * w
            sb += b * w
            wsum += w
          }
        }
        const m = mask(data[i]!, data[i + 1]!, data[i + 2]!) * amount
        let r = cr0 + (sr / wsum - cr0) * m
        let g = cg0 + (sg / wsum - cg0) * m
        let b = cb0 + (sb / wsum - cb0) * m
        r += m * 0.06 * (1 - r)
        g += m * 0.06 * (1 - g)
        b += m * 0.06 * (1 - b)
        out[i] = r * 255
        out[i + 1] = g * 255
        out[i + 2] = b * 255
        out[i + 3] = data[i + 3]!
      }
    }
    return { width, height, data: out }
  },
})
