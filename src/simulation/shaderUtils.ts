/**
 * src/simulation/shaderUtils.ts
 *
 * Helper functions for compiling GLSL shaders and setting uniforms.
 * Sprint 2 addition: setUniform1i for integer uniforms (uNNPixelsPerAgent).
 */

export function compileShader(
  gl: WebGL2RenderingContext,
  source: string,
  type: number
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compilation failed:\n${info}`)
  }
  return shader
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vs = compileShader(gl, vertexSource, gl.VERTEX_SHADER)
  const fs = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER)

  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create program')

  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link failed:\n${info}`)
  }

  gl.detachShader(program, vs)
  gl.detachShader(program, fs)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  return program
}

/** Set a float uniform */
export function setUniform1f(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number
): void {
  const loc = gl.getUniformLocation(program, name)
  if (loc !== null) gl.uniform1f(loc, value)
}

/** Set an integer uniform (e.g. uNNPixelsPerAgent, sampler units) */
export function setUniform1i(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number
): void {
  const loc = gl.getUniformLocation(program, name)
  if (loc !== null) gl.uniform1i(loc, value)
}

/** Bind a texture to a unit and set its sampler uniform */
export function setTextureUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  texture: WebGLTexture,
  unit: number
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  const loc = gl.getUniformLocation(program, name)
  if (loc !== null) gl.uniform1i(loc, unit)
}
