/**
 * GPU Simulation Engine
 *
 * Ties together ES-50 (ping-pong buffers), ES-51 (agent state),
 * and ES-52 (movement shader) into a runnable simulation.
 *
 * This is the main class that the scene integration will call.
 * Per the BRANCH_INTEGRATION_GUIDE.md:
 *   - createAgents() → returns THREE.Object3D
 *   - updateAgents(dt) → runs one simulation tick on the GPU
 *
 * Architecture:
 *   1. WebGL2 context (separate from Three.js) handles GPU compute
 *   2. Two ping-pong buffers: stateA (pos/vel), stateB (energy/age/species/alive)
 *   3. One food ping-pong buffer
 *   4. Each tick: bind read textures → run movement shader → swap buffers
 *   5. Positions are read back to CPU and synced to Three.js InstancedMesh
 */

import * as THREE from 'three';
import {
  TEX_SIZE,
  INITIAL_AGENT_COUNT,
  DEFAULT_PARAMS,
  createInitialStateA,
  createInitialStateB,
  createInitialFoodTexture,
  type SimParams,
} from './agentState';
import {
  createPingPongBuffer,
  getReadTexture,
  getWriteFramebuffer,
  getWriteTexture,
  swapBuffers,
  readBackData,
  destroyPingPongBuffer,
} from './pingPongBuffer';
import {
  createProgram,
  setUniform1f,
  setTextureUniform,
} from './shaderUtils';

// Import GLSL shaders as strings (Vite handles this with ?raw)
// .trim() is critical — Vite can add leading whitespace that breaks #version
import _quadVert from './shaders/quad.vert.glsl?raw';
import _movementFrag from './shaders/movement.frag.glsl?raw';
import _foodFrag from './shaders/food.frag.glsl?raw';
const quadVert = _quadVert.trim();
const movementFrag = _movementFrag.trim();
const foodFrag = _foodFrag.trim();
// ── Types ────────────────────────────────────────────────────────────

export interface SimulationEngine {
  /** Call each frame with delta time to advance simulation */
  update: (dt: number) => void;
  /** Returns a THREE.Object3D to add to the scene */
  getSceneObject: () => THREE.Object3D;
  /** Read population stats back from GPU (call sparingly) */
  getStats: () => { alive: number; avgEnergy: number; avgAge: number };
  /** Clean up all GPU resources */
  dispose: () => void;
  /** Exposed for UI controls in Sprint 3 */
  params: SimParams;
}

// ── Engine Creation ──────────────────────────────────────────────────

export function createSimulationEngine(): SimulationEngine {
  // ── 1. Create offscreen WebGL2 context for compute ────────────
  const computeCanvas = document.createElement('canvas');
  computeCanvas.width = TEX_SIZE;
  computeCanvas.height = TEX_SIZE;
  const gl = computeCanvas.getContext('webgl2')!;
  if (!gl) {
    throw new Error('WebGL2 not supported. Cannot run GPU simulation.');
  }

  // ── 2. Initialize ping-pong buffers with agent data ───────────
  const initialA = createInitialStateA(INITIAL_AGENT_COUNT);
  const initialB = createInitialStateB(INITIAL_AGENT_COUNT);
  const initialFood = createInitialFoodTexture(128);

  const stateBufferA = createPingPongBuffer(gl, TEX_SIZE, TEX_SIZE, initialA);
  const stateBufferB = createPingPongBuffer(gl, TEX_SIZE, TEX_SIZE, initialB);
  const foodBuffer = createPingPongBuffer(gl, 128, 128, initialFood);

  // ── 3. Compile shader programs ────────────────────────────────
  const movementProgram = createProgram(gl, quadVert, movementFrag);
  const foodProgram = createProgram(gl, quadVert, foodFrag);

  // ── 4. Create a VAO for fullscreen triangle (no attributes) ───
  const vao = gl.createVertexArray();

  // ── 5. Set up MRT (Multiple Render Targets) framebuffer ───────
  // For the movement pass, we write to BOTH stateA and stateB
  // simultaneously using gl.drawBuffers.
  const mrtFramebuffer = gl.createFramebuffer();

  // Mutable params (UI can modify in Sprint 3)
  const params = { ...DEFAULT_PARAMS };

  // Track time for shader randomness
  let elapsedTime = 0;

  // ── 6. Create Three.js InstancedMesh for visualization ────────
  // Each alive agent = one instance of a small sphere
  const agentGeometry = new THREE.SphereGeometry(0.5, 8, 6);
  const agentMaterial = new THREE.MeshLambertMaterial({ color: 0x44dd88 });
  const maxAgents = TEX_SIZE * TEX_SIZE;
  const instancedMesh = new THREE.InstancedMesh(agentGeometry, agentMaterial, maxAgents);
  instancedMesh.count = INITIAL_AGENT_COUNT;
  instancedMesh.frustumCulled = false; // Important: agents are GPU-managed

  // Dummy matrix for positioning
  const dummy = new THREE.Object3D();

  // Container group (this is what gets added to the scene)
  const sceneGroup = new THREE.Group();
  sceneGroup.name = 'GPUAgents';
  sceneGroup.add(instancedMesh);

  // ── Simulation Tick ───────────────────────────────────────────

  function runSimulationTick(dt: number): void {
    elapsedTime += dt;

    // --- Movement Pass (writes stateA + stateB) ---
    gl.bindVertexArray(vao);
    gl.useProgram(movementProgram);

    // Set up MRT: attach WRITE textures for both state buffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
      getWriteTexture(stateBufferA), 0
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D,
      getWriteTexture(stateBufferB), 0
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    gl.viewport(0, 0, TEX_SIZE, TEX_SIZE);

    // Bind READ textures
    setTextureUniform(gl, movementProgram, 'uStateA', getReadTexture(stateBufferA), 0);
    setTextureUniform(gl, movementProgram, 'uStateB', getReadTexture(stateBufferB), 1);
    setTextureUniform(gl, movementProgram, 'uFood', getReadTexture(foodBuffer), 2);

    // Set uniforms
    setUniform1f(gl, movementProgram, 'uDeltaTime', dt);
    setUniform1f(gl, movementProgram, 'uMoveSpeed', params.moveSpeed);
    setUniform1f(gl, movementProgram, 'uMoveEnergyCost', params.moveEnergyCost);
    setUniform1f(gl, movementProgram, 'uFoodEnergyGain', params.foodEnergyGain);
    setUniform1f(gl, movementProgram, 'uMaxAge', params.maxAge);
    setUniform1f(gl, movementProgram, 'uMaxEnergy', params.maxEnergy);
    setUniform1f(gl, movementProgram, 'uWorldSize', params.worldSize);
    setUniform1f(gl, movementProgram, 'uFoodDetectRadius', params.foodDetectRadius);
    setUniform1f(gl, movementProgram, 'uTime', elapsedTime);

    // Draw fullscreen triangle → runs fragment shader for every pixel (agent)
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Swap state buffers
    swapBuffers(stateBufferA);
    swapBuffers(stateBufferB);

    // --- Food Update Pass ---
    gl.useProgram(foodProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, getWriteFramebuffer(foodBuffer));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, 128, 128);

    setTextureUniform(gl, foodProgram, 'uFood', getReadTexture(foodBuffer), 0);
    setTextureUniform(gl, foodProgram, 'uStateA', getReadTexture(stateBufferA), 1);
    setTextureUniform(gl, foodProgram, 'uStateB', getReadTexture(stateBufferB), 2);
    setUniform1f(gl, foodProgram, 'uDeltaTime', dt);
    setUniform1f(gl, foodProgram, 'uWorldSize', params.worldSize);
    setUniform1f(gl, foodProgram, 'uRegrowRate', 0.05);
    setUniform1f(gl, foodProgram, 'uTexSize', TEX_SIZE);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    swapBuffers(foodBuffer);

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  // ── Sync GPU → Three.js ───────────────────────────────────────

  function syncToThreeJS(): void {
    // Read back positions from GPU
    const posData = readBackData(gl, stateBufferA);
    const metaData = readBackData(gl, stateBufferB);

    let aliveCount = 0;

    for (let i = 0; i < maxAgents; i++) {
      const aIdx = i * 4;
      const alive = metaData[aIdx + 3];

      if (alive > 0.5) {
        const px = posData[aIdx + 0];
        const py = posData[aIdx + 1];

        // Map 2D simulation coords to 3D world space
        // Center the world around origin, Y is up in Three.js
        dummy.position.set(
          px - params.worldSize / 2,  // X
          1.0,                         // Y (slightly above terrain)
          py - params.worldSize / 2   // Z
        );
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(aliveCount, dummy.matrix);
        aliveCount++;
      }
    }

    instancedMesh.count = aliveCount;
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Public API ─────────────────────────────────────────────────

  let frameCounter = 0;

  return {
    update(dt: number) {
      // Clamp dt to avoid spiral of death
      const clampedDt = Math.min(dt, 0.05);

      runSimulationTick(clampedDt);

      // Sync to Three.js every 3 frames to reduce GPU readback cost
      frameCounter++;
      if (frameCounter % 3 === 0) {
        syncToThreeJS();
      }
    },

    getSceneObject() {
      return sceneGroup;
    },

    getStats() {
      const metaData = readBackData(gl, stateBufferB);
      let alive = 0;
      let totalEnergy = 0;
      let totalAge = 0;

      for (let i = 0; i < maxAgents; i++) {
        const idx = i * 4;
        if (metaData[idx + 3] > 0.5) {
          alive++;
          totalEnergy += metaData[idx + 0];
          totalAge += metaData[idx + 1];
        }
      }

      return {
        alive,
        avgEnergy: alive > 0 ? totalEnergy / alive : 0,
        avgAge: alive > 0 ? totalAge / alive : 0,
      };
    },

    dispose() {
      destroyPingPongBuffer(gl, stateBufferA);
      destroyPingPongBuffer(gl, stateBufferB);
      destroyPingPongBuffer(gl, foodBuffer);
      gl.deleteProgram(movementProgram);
      gl.deleteProgram(foodProgram);
      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(mrtFramebuffer);
      agentGeometry.dispose();
      agentMaterial.dispose();
      instancedMesh.dispose();
    },

    params,
  };
}

// ── Integration functions per BRANCH_INTEGRATION_GUIDE.md ───────────

let engine: SimulationEngine | null = null;

/**
 * Creates and returns the agents scene object.
 * Call once during scene setup.
 */
export function createAgents(): THREE.Object3D {
  engine = createSimulationEngine();
  return engine.getSceneObject();
}

/**
 * Updates the simulation by one tick.
 * Call every frame from the animation loop.
 */
export function updateAgents(dt: number): void {
  engine?.update(dt);
}

/**
 * Returns current simulation stats for UI/analytics.
 */
export function getAgentStats() {
  return engine?.getStats() ?? { alive: 0, avgEnergy: 0, avgAge: 0 };
}

/**
 * Cleans up all GPU resources.
 */
export function disposeAgents(): void {
  engine?.dispose();
  engine = null;
}
