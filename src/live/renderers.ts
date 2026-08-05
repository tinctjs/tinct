/**
 * Frame renderers for live sessions.
 *
 * The GPU renderer is texture-resident: it uploads the current frame, runs
 * the recipe's fragment passes through ping-pong framebuffers, and draws the
 * final pass straight to the visible canvas — no `readPixels`, which is what
 * makes per-frame rendering cheap. Machines without WebGL2 get the 2d
 * renderer instead: same CPU kernels the executor uses, identical output,
 * lower frame rate.
 *
 * A canvas can only ever hold one context kind, so the choice is made once
 * per session. The GPU renderer therefore degrades *internally*: a fragment
 * pass that fails to compile (a custom filter with broken GLSL) runs its CPU
 * twin and blits the result through the copy shader, and a lost WebGL
 * context rebuilds its resources on restore.
 *
 * @packageDocumentation
 * @internal
 */

import type { PixelData } from '../core/pixel'
import type { GpuPass } from '../gl/backend'
import {
  COPY_FRAGMENT,
  VERTEX_SHADER,
  VERTEX_SHADER_FLIP,
  compileShader,
  createFullscreenTriangle,
  drawFullscreen,
  linkProgram,
  setUniforms,
} from '../gl/glsl'
import type { LivePlan } from './plan'

/** @internal What a live session draws from each frame. */
export type LiveFrameSource = TexImageSource & CanvasImageSource

/** @internal One frame renderer bound to a target canvas. */
export interface LiveRenderer {
  /** Path used for the most recent frame. */
  readonly mode: 'gpu' | 'cpu'
  /** Draw one frame. Returns `false` if the frame could not be drawn. */
  render(source: LiveFrameSource, width: number, height: number, plan: LivePlan): boolean
  dispose(): void
}

/** @internal Creates a renderer for a canvas, or `null` if unsupported here. */
export type LiveRendererFactory = (canvas: HTMLCanvasElement) => LiveRenderer | null

let factoryOverride: LiveRendererFactory | null | undefined

/** @internal Test hook: force live sessions onto a fake renderer. */
export function _setLiveRendererFactory(factory: LiveRendererFactory | null | undefined): void {
  factoryOverride = factory
}

/** @internal Pick the renderer for `canvas`: injected fake → GPU → CPU. */
export function createLiveRenderer(canvas: HTMLCanvasElement): LiveRenderer | null {
  if (factoryOverride !== undefined) return factoryOverride ? factoryOverride(canvas) : null
  return createGlRenderer(canvas) ?? createCpu2dRenderer(canvas)
}

/** @internal Grab-and-process scratch surface shared by both CPU paths. */
function createScratch(): {
  grab: (source: LiveFrameSource, width: number, height: number, plan: LivePlan) => PixelData
  dispose: () => void
} | null {
  if (typeof document === 'undefined') return null
  const scratch = document.createElement('canvas')
  const context = scratch.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  return {
    grab(source, width, height, plan) {
      if (scratch.width !== width || scratch.height !== height) {
        scratch.width = width
        scratch.height = height
      }
      context.drawImage(source, 0, 0, width, height)
      let pixels: PixelData = context.getImageData(0, 0, width, height)
      for (const step of plan.cpu) pixels = step(pixels)
      return pixels
    },
    dispose() {
      scratch.width = scratch.height = 0
    },
  }
}

function createGlRenderer(canvas: HTMLCanvasElement): LiveRenderer | null {
  if (typeof WebGL2RenderingContext === 'undefined') return null
  let gl: WebGL2RenderingContext | null
  try {
    gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      // Keeps the frame readable afterwards (screenshots, toDataURL, tests).
      preserveDrawingBuffer: true,
      antialias: false,
    })
  } catch {
    return null
  }
  if (!gl) return null

  interface Resources {
    vertex: WebGLShader
    vertexFlip: WebGLShader
    programs: Map<string, WebGLProgram>
    fbo: WebGLFramebuffer
    sourceTexture: WebGLTexture
    ping: WebGLTexture
    pong: WebGLTexture
    allocated: { width: number; height: number }
    /** Auxiliary textures uploaded once per pixel buffer (stickers, LUTs). */
    aux: WeakMap<PixelData, WebGLTexture>
    auxList: WebGLTexture[]
  }

  const createTexture = (): WebGLTexture => {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return texture
  }

  const createResources = (): Resources | null => {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const vertexFlip = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_FLIP)
    if (!vertex || !vertexFlip) return null
    createFullscreenTriangle(gl)
    return {
      vertex,
      vertexFlip,
      programs: new Map(),
      fbo: gl.createFramebuffer(),
      sourceTexture: createTexture(),
      ping: createTexture(),
      pong: createTexture(),
      allocated: { width: 0, height: 0 },
      aux: new WeakMap(),
      auxList: [],
    }
  }

  let resources = createResources()
  if (!resources) return null
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  let scratch: ReturnType<typeof createScratch> = null
  let lastMode: 'gpu' | 'cpu' = 'gpu'

  // Allow restoration after a context loss, and rebuild everything when it
  // arrives — programs and textures do not survive the round trip.
  const onLost = (event: Event): void => {
    event.preventDefault()
  }
  const onRestored = (): void => {
    resources = createResources()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  const getProgram = (fragment: string, flip: boolean): WebGLProgram | null => {
    const r = resources!
    const key = (flip ? 'F:' : 'N:') + fragment
    const existing = r.programs.get(key)
    if (existing) return existing
    const program = linkProgram(gl, flip ? r.vertexFlip : r.vertex, fragment)
    if (program) r.programs.set(key, program)
    return program
  }

  const allocate = (width: number, height: number): void => {
    const r = resources!
    if (r.allocated.width === width && r.allocated.height === height) return
    for (const texture of [r.ping, r.pong]) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    r.allocated = { width, height }
  }

  /** Upload-once cache for auxiliary textures, keyed by the pixel buffer. */
  const getAuxTexture = (pixels: PixelData, linear: boolean): WebGLTexture => {
    const r = resources!
    const cached = r.aux.get(pixels)
    if (cached) return cached
    const texture = createTexture()
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      pixels.width,
      pixels.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
    )
    if (linear) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    }
    r.aux.set(pixels, texture)
    r.auxList.push(texture)
    return texture
  }

  const draw = (
    program: WebGLProgram,
    input: WebGLTexture,
    pass: Pick<GpuPass, 'uniforms' | 'textures' | 'linearSource'>,
    width: number,
    height: number,
  ): void => {
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    const filter = pass.linearSource ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)
    for (let unit = 0; unit < (pass.textures?.length ?? 0); unit++) {
      const aux = pass.textures![unit]!
      gl.activeTexture(gl.TEXTURE1 + unit)
      gl.bindTexture(gl.TEXTURE_2D, getAuxTexture(aux.pixels, aux.linear ?? false))
      gl.uniform1i(gl.getUniformLocation(program, aux.name), 1 + unit)
    }
    gl.activeTexture(gl.TEXTURE0)
    const resolution = gl.getUniformLocation(program, 'u_resolution')
    if (resolution) gl.uniform2f(resolution, width, height)
    setUniforms(gl, program, pass.uniforms)
    drawFullscreen(gl, program)
  }

  /** Blit already-processed pixels straight to the screen (CPU-twin path). */
  const blit = (pixels: PixelData, width: number, height: number): boolean => {
    const program = getProgram(COPY_FRAGMENT, true)
    if (!program) return false
    gl.bindTexture(gl.TEXTURE_2D, resources!.sourceTexture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    draw(program, resources!.sourceTexture, { uniforms: {} }, width, height)
    return gl.getError() === gl.NO_ERROR
  }

  /** A fragment pass would not compile: run the CPU twins, blit the result. */
  const renderViaCpu = (
    source: LiveFrameSource,
    width: number,
    height: number,
    plan: LivePlan,
  ): boolean => {
    scratch ??= createScratch()
    if (!scratch) return false
    lastMode = 'cpu'
    return blit(scratch.grab(source, width, height, plan), width, height)
  }

  return {
    get mode() {
      return lastMode
    },
    render(source, width, height, plan) {
      if (gl.isContextLost() || !resources) return false
      if (width > maxTextureSize || height > maxTextureSize) return false
      try {
        allocate(width, height)
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)

        const passes: readonly GpuPass[] = plan.passes.length
          ? plan.passes
          : [{ fragment: COPY_FRAGMENT, uniforms: {} }]
        for (const pass of passes) {
          for (const aux of pass.textures ?? []) {
            if (aux.pixels.width > maxTextureSize || aux.pixels.height > maxTextureSize) {
              return false
            }
          }
        }

        // Compile everything first so a broken pass falls back before any
        // half-rendered state reaches the screen.
        const programs: WebGLProgram[] = []
        for (let i = 0; i < passes.length; i++) {
          const program = getProgram(passes[i]!.fragment, i === passes.length - 1)
          if (!program) return renderViaCpu(source, width, height, plan)
          programs.push(program)
        }

        gl.bindTexture(gl.TEXTURE_2D, resources.sourceTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)

        // Intermediate passes render into ping-pong textures; the final
        // pass draws to the screen with the y-flipped vertex stage.
        let input = resources.sourceTexture
        for (let i = 0; i < passes.length; i++) {
          const last = i === passes.length - 1
          if (last) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          } else {
            const target = input === resources.ping ? resources.pong : resources.ping
            gl.bindFramebuffer(gl.FRAMEBUFFER, resources.fbo)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
          }
          draw(programs[i]!, input, passes[i]!, width, height)
          if (!last) input = input === resources.ping ? resources.pong : resources.ping
        }
        lastMode = 'gpu'
        return gl.getError() === gl.NO_ERROR
      } catch {
        return false
      }
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      scratch?.dispose()
      const r = resources
      if (!r) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(r.fbo)
      for (const texture of [r.sourceTexture, r.ping, r.pong, ...r.auxList]) {
        gl.deleteTexture(texture)
      }
      for (const program of r.programs.values()) gl.deleteProgram(program)
      r.programs.clear()
      resources = null
    },
  }
}

function createCpu2dRenderer(canvas: HTMLCanvasElement): LiveRenderer | null {
  const target = canvas.getContext('2d')
  const scratch = createScratch()
  if (!target || !scratch) return null

  return {
    mode: 'cpu',
    render(source, width, height, plan) {
      const pixels = scratch.grab(source, width, height, plan)
      target.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), width, height), 0, 0)
      return true
    },
    dispose() {
      scratch.dispose()
    },
  }
}
