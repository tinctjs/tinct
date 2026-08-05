/**
 * Shared WebGL2 plumbing used by both the offscreen backend (renderer.ts)
 * and live sessions (live/): shader compilation, program linking, uniform
 * upload, and the fullscreen-triangle vertex stage.
 *
 * @packageDocumentation
 * @internal
 */

/** @internal Fullscreen triangle; v_texCoord origin is the data's top-left. */
export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * @internal
 * Flipped variant for passes that draw to the *screen* (default
 * framebuffer): its origin is bottom-left, so the texcoord y inverts to
 * keep the image upright.
 */
export const VERTEX_SHADER_FLIP = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/** @internal Pass-through fragment (used when a live recipe has no ops). */
export const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  outColor = texture(u_image, v_texCoord);
}
`

/** @internal Compile one shader or return null (callers fall back to CPU). */
export function compileShader(
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

/** @internal Link a program from an already-compiled vertex shader. */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentSource: string,
): WebGLProgram | null {
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!fragmentShader) return null
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(fragmentShader)
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

/** @internal Upload the fullscreen-triangle vertex buffer. */
export function createFullscreenTriangle(gl: WebGL2RenderingContext): void {
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
}

/** @internal Bind the triangle to a program's a_position and draw one pass. */
export function drawFullscreen(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

/**
 * @internal Upload uniform values: number → 1f, arrays by length → 2/3/4fv,
 * 9 numbers → matrix3 (row-major input, transposed for GL).
 */
export function setUniforms(
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
