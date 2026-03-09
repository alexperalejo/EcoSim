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
import { sampleTerrainHeight } from '../rendering/terrain'

// ── Slot Manager ─────────────────────────────────────────────────────
//
// The GPU texture has MAX_AGENTS (4096) fixed slots.
// When an agent dies, its slot must be marked free so reproduction
// (Sprint 2) can reuse it. Without this, the simulation runs out of
// slots and silently empties after enough deaths.
//
// This is a CPU-side free list. It stays in sync with the GPU state
// by scanning the alive channel during each readback.

const MAX_AGENTS = TEX_SIZE * TEX_SIZE // 4096

class SlotManager {
  private freeSlots: Set<number>
  private occupiedSlots: Set<number>

  constructor(initialCount: number) {
    this.freeSlots = new Set()
    this.occupiedSlots = new Set()

    // First `initialCount` slots start occupied
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (i < initialCount) {
        this.occupiedSlots.add(i)
      } else {
        this.freeSlots.add(i)
      }
    }
  }

  /** Mark a slot as free (called when agent dies) */
  free(slot: number): void {
    this.occupiedSlots.delete(slot)
    this.freeSlots.add(slot)
  }

  /** Claim the next free slot for a new agent. Returns -1 if full. */
  allocate(): number {
    const iter = this.freeSlots.values().next()
    if (iter.done) return -1
    const slot = iter.value
    this.freeSlots.delete(slot)
    this.occupiedSlots.add(slot)
    return slot
  }

  get freeCount(): number { return this.freeSlots.size }
  get aliveCount(): number { return this.occupiedSlots.size }

  /**
   * Sync slot state against a full GPU readback of stateB.
   * Called every N frames so the free list stays accurate.
   * Any slot where alive < 0.5 is marked free.
   */
  syncFromGPU(stateBData: Float32Array): void {
    for (let i = 0; i < MAX_AGENTS; i++) {
      const alive = stateBData[i * 4 + 3]
      if (alive < 0.5) {
        if (this.occupiedSlots.has(i)) {
          this.free(i)
        }
      }
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────

export interface SimulationEngine {
  /** Call each frame with delta time to advance simulation */
  update: (dt: number) => void;
  /** Returns a THREE.Object3D to add to the scene */
  getSceneObject: () => THREE.Object3D;
  /** Read population stats back from GPU (call sparingly) */
  getStats: () => { alive: number; free: number;avgEnergy: number; avgAge: number };
  /** Clean up all GPU resources */
  getNextFreeSlot: () => number;
  /** Returns the next free slot index for reproduction. -1 if full. */
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

  // ── 4. VAO + MRT framebuffer ──────────────────────────────────
  const vao = gl.createVertexArray();
  const mrtFramebuffer = gl.createFramebuffer();

  // ── 5. Slot manager ───────────────────────────────────────────
  const slotManager = new SlotManager(INITIAL_AGENT_COUNT)

  const params = { ...DEFAULT_PARAMS }
  let elapsedTime = 0

  // ── 6. Create Three.js InstancedMesh for visualization ────────
  // Each alive agent = one instance of a small sphere
  const agentGeometry = new THREE.SphereGeometry(0.5, 8, 6);
  const agentMaterial = new THREE.MeshLambertMaterial({ color: 0x44dd88 });
  const instancedMesh = new THREE.InstancedMesh(agentGeometry, agentMaterial, MAX_AGENTS)
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
  let syncFrame = 0
  function syncToThreeJS(): void {
    // Read back positions from GPU
    const posData = readBackData(gl, stateBufferA);
    const metaData = readBackData(gl, stateBufferB);

    // Every 10 syncs, do a full slot reconciliation
    // This catches any deaths the frame-by-frame check missed
    syncFrame++
    if (syncFrame % 10 === 0) {
      slotManager.syncFromGPU(metaData);
    }

    let renderCount = 0

    for (let i = 0; i < MAX_AGENTS; i++) {
      const mIdx = i * 4;
      const alive = metaData[mIdx + 3];

      if (alive > 0.5) {
        const px = posData[i * 4 + 0]
        const py = posData[i * 4 + 1]

        // Map 2D simulation coords to 3D world space
        // Center the world around origin, Y is up in Three.js
        

        // then inside syncToThreeJS:
        const worldX = px - params.worldSize / 2
        const worldZ = py - params.worldSize / 2
        const groundY = sampleTerrainHeight(worldX, worldZ)

        dummy.position.set(
          worldX,
          groundY + 1.0,   // 1 unit above the actual terrain surface
          worldZ
        )
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(renderCount, dummy.matrix);
        renderCount++;
      }
      else {
        // Agent just died — free the slot for reuse
        slotManager.free(i)
      }
    }

    instancedMesh.count = renderCount;
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

      for (let i = 0; i < MAX_AGENTS; i++) {
        const idx = i * 4;
        if (metaData[idx + 3] > 0.5) {
          alive++;
          totalEnergy += metaData[idx + 0];
          totalAge += metaData[idx + 1];
        }
      }

      return {
        alive,
        free: slotManager.freeCount,
        avgEnergy: alive > 0 ? totalEnergy / alive : 0,
        avgAge: alive > 0 ? totalAge / alive : 0,
      };
    },

      // Used by Sprint 2 reproduction to claim a slot for a new agent
    getNextFreeSlot() {
      return slotManager.allocate()
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
  return engine?.getStats() ?? { alive: 0, free: 0, avgEnergy: 0, avgAge: 0 };
}

/**
 * Cleans up all GPU resources.
 */
export function disposeAgents(): void {
  engine?.dispose();
  engine = null;
}
