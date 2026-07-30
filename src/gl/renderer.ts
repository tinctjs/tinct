/**
 * WebGL2 renderer: uploads pixels once, runs a chain of fragment passes via
 * ping-pong framebuffers, reads back once. Programs are cached per fragment
 * source. Every failure path returns `null` so the executor can fall back to
 * CPU kernels without the consumer noticing anything but timing.
 *
 * Shader contract (documented on `FilterDefinition.fragment`):
 * - GLSL ES 3.00
 * - `uniform sampler2D u_image` — the source image
 * - `uniform vec2 u_resolution` — output size in pixels (always provided)
 * - `in vec2 v_texCoord` — texture coordinates, origin at the top-left
 * - `out vec4 outColor`
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { GpuBackend, GpuPass } from './backend'

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

interface GlState {
  gl: WebGL2RenderingContext
  programs: Map<string, WebGLProgram>
  vertexShader: WebGLShader
  maxTextureSize: number
}

let cached: GpuBackend | null | undefined

/** @internal Lazily create (and memoize) the WebGL2 backend for this realm. */
export function getWebgl2Backend(): GpuBackend | null {
  cached ??= createBackend()
  return cached
}

function createBackend(): GpuBackend | null {
  if (typeof WebGL2RenderingContext === 'undefined') return null
  try {
    const canvas = createGlCanvas()
    if (!canvas) return null
    // Both canvas kinds share this signature at runtime; the DOM union type
    // does not narrow it, so route through the element overload.
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      antialias: false,
    })
    if (!gl) return null

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    if (!vertexShader) return null

    // Fullscreen triangle (covers the viewport with 3 vertices).
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const state: GlState = {
      gl,
      programs: new Map(),
      vertexShader,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    }
    return { run: (pixels, passes) => run(state, pixels, passes) }
  } catch {
    return null
  }
}

function createGlCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1)
  if (typeof document !== 'undefined') return document.createElement('canvas')
  return null
}

function run(state: GlState, pixels: PixelData, passes: readonly GpuPass[]): PixelData | null {
  const { gl } = state
  const { width, height } = pixels
  if (width > state.maxTextureSize || height > state.maxTextureSize) return null
  if (passes.length === 0) return pixels

  let source: WebGLTexture | null = null
  let target: WebGLTexture | null = null
  const fbo = gl.createFramebuffer()

  try {
    source = createTexture(gl, width, height, pixels.data)
    target = createTexture(gl, width, height, null)
    if (!source || !target) return null

    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)

    for (const pass of passes) {
      const program = getProgram(state, pass.fragment)
      if (!program) return null

      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
      gl.useProgram(program)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, source)
      gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)
      const resolution = gl.getUniformLocation(program, 'u_resolution')
      if (resolution) gl.uniform2f(resolution, width, height)
      setUniforms(gl, program, pass.uniforms)

      const position = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // Ping-pong: this pass's output feeds the next pass.
      ;[source, target] = [target, source]
    }

    // After the swap, `source` holds the last pass's output; read from it.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null
    const out = new Uint8ClampedArray(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(out.buffer))
    if (gl.getError() !== gl.NO_ERROR) return null

    return { width, height, data: out }
  } catch {
    return null
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fbo)
    if (source) gl.deleteTexture(source)
    if (target) gl.deleteTexture(target)
  }
}

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data: Uint8ClampedArray | null,
): WebGLTexture | null {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null,
  )
  return texture
}

function getProgram(state: GlState, fragment: string): WebGLProgram | null {
  const existing = state.programs.get(fragment)
  if (existing) return existing

  const { gl } = state
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
  if (!fragmentShader) return null

  const program = gl.createProgram()
  gl.attachShader(program, state.vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(fragmentShader)
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    gl.deleteProgram(program)
    return null
  }
  state.programs.set(fragment, program)
  return program
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!(gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function setUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniforms: Record<string, number | readonly number[]>,
): void {
  for (const [name, value] of Object.entries(uniforms)) {
    const location = gl.getUniformLocation(program, name)
    if (!location) continue
    if (typeof value === 'number') {
      gl.uniform1f(location, value)
    } else if (value.length === 2) {
      gl.uniform2fv(location, value as number[])
    } else if (value.length === 3) {
      gl.uniform3fv(location, value as number[])
    } else if (value.length === 4) {
      gl.uniform4fv(location, value as number[])
    } else if (value.length === 9) {
      // Row-major input → transpose for GL's column-major layout.
      const m = value
      gl.uniformMatrix3fv(location, false, [
        m[0]!,
        m[3]!,
        m[6]!,
        m[1]!,
        m[4]!,
        m[7]!,
        m[2]!,
        m[5]!,
        m[8]!,
      ])
    }
  }
}
