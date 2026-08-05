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
import {
  VERTEX_SHADER,
  compileShader,
  createFullscreenTriangle,
  drawFullscreen,
  linkProgram,
  setUniforms,
} from './glsl'

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

    createFullscreenTriangle(gl)

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
  const auxTextures: WebGLTexture[] = []
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
      const filter = pass.linearSource ? gl.LINEAR : gl.NEAREST
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)

      // Auxiliary textures (stickers, LUTs) on units 1..N.
      for (let unit = 0; unit < (pass.textures?.length ?? 0); unit++) {
        const aux = pass.textures![unit]!
        if (aux.pixels.width > state.maxTextureSize || aux.pixels.height > state.maxTextureSize) {
          return null
        }
        gl.activeTexture(gl.TEXTURE1 + unit)
        const texture = createTexture(gl, aux.pixels.width, aux.pixels.height, aux.pixels.data)
        if (!texture) return null
        auxTextures.push(texture)
        if (aux.linear) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        }
        gl.uniform1i(gl.getUniformLocation(program, aux.name), 1 + unit)
      }
      gl.activeTexture(gl.TEXTURE0)

      const resolution = gl.getUniformLocation(program, 'u_resolution')
      if (resolution) gl.uniform2f(resolution, width, height)
      setUniforms(gl, program, pass.uniforms)
      drawFullscreen(gl, program)

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
    for (const texture of auxTextures) gl.deleteTexture(texture)
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
  const program = linkProgram(state.gl, state.vertexShader, fragment)
  if (program) state.programs.set(fragment, program)
  return program
}
