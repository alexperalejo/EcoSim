/**
 * ES-50: WebGL Ping-Pong Framebuffer Pipeline
 *
 * Implements a double-buffered GPU compute pipeline using WebGL2.
 * "Ping-pong" means we alternate between two textures:
 *   - Read from texture A, write to texture B
 *   - Next frame: read from texture B, write to texture A
 * This avoids read-write hazards (you can't read and write the same
 * texture simultaneously in a shader).
 *
 * Architecture:
 *   PingPongBuffer manages a pair of framebuffer+texture combos.
 *   Each tick, the simulation shader reads the "current" texture
 *   and writes results to the "next" texture, then they swap.
 */

import { TEX_SIZE } from './agentState';

// ── Types ────────────────────────────────────────────────────────────

export interface PingPongBuffer {
  textures: [WebGLTexture, WebGLTexture];
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  currentIndex: number; // 0 or 1
  width: number;
  height: number;
}

// ── Texture Creation ─────────────────────────────────────────────────

/**
 * Creates a floating-point RGBA texture suitable for GPU compute.
 * Requires OES_texture_float or WebGL2 with EXT_color_buffer_float.
 */
function createFloat32Texture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data: Float32Array | null
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create WebGL texture');

  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Upload float data — WebGL2 uses gl.RGBA32F internal format
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,                // mip level
    gl.RGBA32F,       // internal format (32-bit float per channel)
    width,
    height,
    0,                // border
    gl.RGBA,          // format
    gl.FLOAT,         // type
    data              // pixel data (null = allocate empty)
  );

  // CRITICAL: Use NEAREST filtering for data textures.
  // Linear filtering would interpolate between agent states = garbage.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * Creates a framebuffer with a texture attached as color attachment.
 * This lets us "render to texture" — the fragment shader output
 * goes into this texture instead of the screen.
 */
function createFramebuffer(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture
): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error('Failed to create WebGL framebuffer');

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0 // mip level
  );

  // Verify framebuffer is complete
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}

// ── Ping-Pong Buffer API ─────────────────────────────────────────────

/**
 * Creates a ping-pong buffer pair for a given data texture.
 * Both textures start with the same initial data.
 *
 * @param gl       - WebGL2 context
 * @param width    - Texture width (default: TEX_SIZE = 64)
 * @param height   - Texture height (default: TEX_SIZE = 64)
 * @param initData - Initial Float32Array data (RGBA per pixel)
 */
export function createPingPongBuffer(
  gl: WebGL2RenderingContext,
  width: number = TEX_SIZE,
  height: number = TEX_SIZE,
  initData: Float32Array | null = null
): PingPongBuffer {
  // Ensure EXT_color_buffer_float is available (required for rendering to float textures)
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    throw new Error(
      'EXT_color_buffer_float not supported. Cannot render to float textures. ' +
      'This extension is required for GPU-based simulation.'
    );
  }

  // Create two textures with the same initial data
  const texA = createFloat32Texture(gl, width, height, initData);
  const texB = createFloat32Texture(gl, width, height, initData);

  // Create framebuffers for each
  const fbA = createFramebuffer(gl, texA);
  const fbB = createFramebuffer(gl, texB);

  return {
    textures: [texA, texB],
    framebuffers: [fbA, fbB],
    currentIndex: 0,
    width,
    height,
  };
}

/**
 * Returns the texture to READ from (current state).
 */
export function getReadTexture(buffer: PingPongBuffer): WebGLTexture {
  return buffer.textures[buffer.currentIndex];
}

/**
 * Returns the framebuffer to WRITE to (next state).
 * The shader output will be written to the texture attached to this FB.
 */
export function getWriteFramebuffer(buffer: PingPongBuffer): WebGLFramebuffer {
  return buffer.framebuffers[1 - buffer.currentIndex];
}

/**
 * Returns the texture that will be written to (for multi-pass reads).
 */
export function getWriteTexture(buffer: PingPongBuffer): WebGLTexture {
  return buffer.textures[1 - buffer.currentIndex];
}

/**
 * Swaps read/write targets. Call this AFTER each simulation tick.
 * The texture we just wrote to becomes the one we read from next.
 */
export function swapBuffers(buffer: PingPongBuffer): void {
  buffer.currentIndex = 1 - buffer.currentIndex;
}

/**
 * Reads back pixel data from the current read texture to CPU.
 * Use sparingly — this is slow (GPU → CPU transfer).
 * Only needed for UI/analytics (population counts, etc.).
 */
export function readBackData(
  gl: WebGL2RenderingContext,
  buffer: PingPongBuffer
): Float32Array {
  const { width, height, currentIndex } = buffer;
  const data = new Float32Array(width * height * 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffers[currentIndex]);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return data;
}

/**
 * Cleans up all GPU resources for this buffer.
 */
export function destroyPingPongBuffer(
  gl: WebGL2RenderingContext,
  buffer: PingPongBuffer
): void {
  gl.deleteTexture(buffer.textures[0]);
  gl.deleteTexture(buffer.textures[1]);
  gl.deleteFramebuffer(buffer.framebuffers[0]);
  gl.deleteFramebuffer(buffer.framebuffers[1]);
}
