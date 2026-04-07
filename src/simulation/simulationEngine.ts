/**
 * GPU Simulation Engine
 *
 * Sprint 2 additions (T-3.7.1, T-3.3.1, T-3.3.2):
 *   - weightBuffer: third ping-pong buffer storing NN weights per agent
 *   - handleReproduction now copies + mutates parent weights into child slot
 *   - movement shader receives weight texture as uWeights sampler
 */

import * as THREE from 'three';
import {
  TEX_SIZE,
  INITIAL_AGENT_COUNT,
  DEFAULT_PARAMS,
  NN_TEX_WIDTH,
  NN_TEX_HEIGHT,
  NN_PIXELS_PER_AGENT,
  createInitialStateA,
  createInitialStateB,
  createInitialFoodTexture,
  createInitialWeightTexture,
  mutateWeights,
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
  setUniform1i,
  setTextureUniform,
} from './shaderUtils';
import { sampleTerrainHeight } from '../rendering/terrain';

import _quadVert     from './shaders/quad.vert.glsl?raw';
import _movementFrag from './shaders/movement.frag.glsl?raw';
import _foodFrag     from './shaders/food.frag.glsl?raw';
const quadVert     = _quadVert.trim();
const movementFrag = _movementFrag.trim();
const foodFrag     = _foodFrag.trim();

// ── Constants ────────────────────────────────────────────────────────
const MAX_AGENTS            = TEX_SIZE * TEX_SIZE  // 4096
const REPRO_THRESHOLD       = 80.0
const REPRO_ENERGY_COST     = 5.0
const REPRO_MIN_AGE         = 30.0
const REPRO_COOLDOWN_FRAMES = 90
const MAX_SPAWNS_PER_FRAME  = 8
const KILL_RADIUS           = 0.8
const PREDATOR_ENERGY_GAIN  = 35.0

// ── Slot Manager ─────────────────────────────────────────────────────
class SlotManager {
  private freeSlots: Set<number>
  private occupiedSlots: Set<number>

  constructor(initialCount: number) {
    this.freeSlots = new Set()
    this.occupiedSlots = new Set()
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (i < initialCount) this.occupiedSlots.add(i)
      else this.freeSlots.add(i)
    }
  }

  free(slot: number): void {
    this.occupiedSlots.delete(slot)
    this.freeSlots.add(slot)
  }

  allocate(): number {
    const iter = this.freeSlots.values().next()
    if (iter.done) return -1
    const slot = iter.value
    this.freeSlots.delete(slot)
    this.occupiedSlots.add(slot)
    return slot
  }

  get freeCount(): number  { return this.freeSlots.size }
  get aliveCount(): number { return this.occupiedSlots.size }

  syncFromGPU(stateBData: Float32Array): void {
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (stateBData[i * 4 + 3] < 0.5 && this.occupiedSlots.has(i)) {
        this.free(i)
      }
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────
export interface SimulationEngine {
  update:          (dt: number) => void
  getSceneObject:  () => THREE.Object3D
  getStats:        () => { alive: number; prey: number; predator: number; free: number; avgEnergy: number; avgAge: number }
  getNextFreeSlot: () => number
  dispose:         () => void
  params:          SimParams
}

// ── Engine ───────────────────────────────────────────────────────────
export function createSimulationEngine(): SimulationEngine {

  const computeCanvas = document.createElement('canvas')
  computeCanvas.width  = TEX_SIZE
  computeCanvas.height = TEX_SIZE
  const gl = computeCanvas.getContext('webgl2')!
  if (!gl) throw new Error('WebGL2 not supported.')

  const stateBufferA = createPingPongBuffer(gl, TEX_SIZE,     TEX_SIZE,     createInitialStateA(INITIAL_AGENT_COUNT))
  const stateBufferB = createPingPongBuffer(gl, TEX_SIZE,     TEX_SIZE,     createInitialStateB(INITIAL_AGENT_COUNT))
  const foodBuffer   = createPingPongBuffer(gl, 128,          128,          createInitialFoodTexture(128))
  const weightBuffer = createPingPongBuffer(gl, NN_TEX_WIDTH, NN_TEX_HEIGHT, createInitialWeightTexture(INITIAL_AGENT_COUNT))

  const movementProgram = createProgram(gl, quadVert, movementFrag)
  const foodProgram     = createProgram(gl, quadVert, foodFrag)

  const vao            = gl.createVertexArray()
  const mrtFramebuffer = gl.createFramebuffer()

  const slotManager   = new SlotManager(INITIAL_AGENT_COUNT)
  const reproCooldown = new Int32Array(MAX_AGENTS)

  const params      = { ...DEFAULT_PARAMS }
  let   elapsedTime = 0

  const agentGeometry    = new THREE.SphereGeometry(0.5, 8, 6)
  const preyMaterial     = new THREE.MeshLambertMaterial({ color: 0x44dd88 })
  const predatorMaterial = new THREE.MeshLambertMaterial({ color: 0xff4444 })

  const preyMesh     = new THREE.InstancedMesh(agentGeometry, preyMaterial,     MAX_AGENTS)
  const predatorMesh = new THREE.InstancedMesh(agentGeometry, predatorMaterial, MAX_AGENTS)
  preyMesh.frustumCulled     = false
  predatorMesh.frustumCulled = false
  preyMesh.count     = 0
  predatorMesh.count = 0

  const dummy      = new THREE.Object3D()
  const sceneGroup = new THREE.Group()
  sceneGroup.name  = 'GPUAgents'
  sceneGroup.add(preyMesh)
  sceneGroup.add(predatorMesh)

  // ── Simulation tick ───────────────────────────────────────────
  function runSimulationTick(dt: number): void {
    elapsedTime += dt

    gl.bindVertexArray(vao)
    gl.useProgram(movementProgram)

    gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFramebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, getWriteTexture(stateBufferA), 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, getWriteTexture(stateBufferB), 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.viewport(0, 0, TEX_SIZE, TEX_SIZE)

    setTextureUniform(gl, movementProgram, 'uStateA',  getReadTexture(stateBufferA), 0)
    setTextureUniform(gl, movementProgram, 'uStateB',  getReadTexture(stateBufferB), 1)
    setTextureUniform(gl, movementProgram, 'uFood',    getReadTexture(foodBuffer),   2)
    setTextureUniform(gl, movementProgram, 'uWeights', getReadTexture(weightBuffer), 3)

    setUniform1f(gl, movementProgram, 'uDeltaTime',          dt)
    setUniform1f(gl, movementProgram, 'uMoveSpeed',          params.moveSpeed)
    setUniform1f(gl, movementProgram, 'uMoveEnergyCost',     params.moveEnergyCost)
    setUniform1f(gl, movementProgram, 'uFoodEnergyGain',     params.foodEnergyGain)
    setUniform1f(gl, movementProgram, 'uMaxAge',             params.maxAge)
    setUniform1f(gl, movementProgram, 'uMaxEnergy',          params.maxEnergy)
    setUniform1f(gl, movementProgram, 'uWorldSize',          params.worldSize)
    setUniform1f(gl, movementProgram, 'uFoodDetectRadius',   params.foodDetectRadius)
    setUniform1f(gl, movementProgram, 'uTime',               elapsedTime)
    setUniform1f(gl, movementProgram, 'uReproThreshold',     REPRO_THRESHOLD)
    setUniform1f(gl, movementProgram, 'uReproEnergyCost',    REPRO_ENERGY_COST)
    setUniform1f(gl, movementProgram, 'uKillRadius',         KILL_RADIUS)
    setUniform1f(gl, movementProgram, 'uPredatorEnergyGain', PREDATOR_ENERGY_GAIN)
    setUniform1i(gl, movementProgram, 'uNNPixelsPerAgent',   NN_PIXELS_PER_AGENT)
    setUniform1f(gl, movementProgram, 'uNNTexHeight',        NN_TEX_HEIGHT)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    swapBuffers(stateBufferA)
    swapBuffers(stateBufferB)

    gl.useProgram(foodProgram)
    gl.bindFramebuffer(gl.FRAMEBUFFER, getWriteFramebuffer(foodBuffer))
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.viewport(0, 0, 128, 128)

    setTextureUniform(gl, foodProgram, 'uFood',   getReadTexture(foodBuffer),   0)
    setTextureUniform(gl, foodProgram, 'uStateA', getReadTexture(stateBufferA), 1)
    setTextureUniform(gl, foodProgram, 'uStateB', getReadTexture(stateBufferB), 2)
    setUniform1f(gl, foodProgram, 'uDeltaTime',  dt)
    setUniform1f(gl, foodProgram, 'uWorldSize',  params.worldSize)
    setUniform1f(gl, foodProgram, 'uRegrowRate', 0.05)
    setUniform1f(gl, foodProgram, 'uTexSize',    TEX_SIZE)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    swapBuffers(foodBuffer)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
  }

  // ── Reproduction ──────────────────────────────────────────────
  function handleReproduction(posData: Float32Array, metaData: Float32Array): void {
    let spawned = 0

    for (let i = 0; i < MAX_AGENTS; i++) {
      if (spawned >= MAX_SPAWNS_PER_FRAME) break

      const bIdx    = i * 4
      const alive   = metaData[bIdx + 3]
      const energy  = metaData[bIdx + 0]
      const age     = metaData[bIdx + 1]
      const species = metaData[bIdx + 2]

      if (alive   < 0.5)             continue
      if (age     < REPRO_MIN_AGE)   continue
      if (energy  < REPRO_THRESHOLD) continue
      if (reproCooldown[i] > 0) { reproCooldown[i]--; continue }

      const childSlot = slotManager.allocate()
      if (childSlot === -1) break

      reproCooldown[i] = REPRO_COOLDOWN_FRAMES
      spawned++

      const aIdx     = i * 4
      const parentX  = posData[aIdx + 0]
      const parentY  = posData[aIdx + 1]
      const parentVX = posData[aIdx + 2]
      const parentVY = posData[aIdx + 3]

      const spawnAngle = Math.random() * Math.PI * 2
      const childX = (parentX + Math.cos(spawnAngle) * 2.0 + params.worldSize) % params.worldSize
      const childY = (parentY + Math.sin(spawnAngle) * 2.0 + params.worldSize) % params.worldSize

      const mutAngle = (Math.random() - 0.5) * Math.PI * 0.5
      const cosM = Math.cos(mutAngle), sinM = Math.sin(mutAngle)
      const childVX = parentVX * cosM - parentVY * sinM
      const childVY = parentVX * sinM + parentVY * cosM

      const halfEnergy = energy * 0.5
      const childCol   = childSlot % TEX_SIZE
      const childRow   = Math.floor(childSlot / TEX_SIZE)

      gl.bindTexture(gl.TEXTURE_2D, getReadTexture(stateBufferA))
      gl.texSubImage2D(gl.TEXTURE_2D, 0, childCol, childRow, 1, 1, gl.RGBA, gl.FLOAT,
        new Float32Array([childX, childY, childVX, childVY]))

      gl.bindTexture(gl.TEXTURE_2D, getReadTexture(stateBufferB))
      gl.texSubImage2D(gl.TEXTURE_2D, 0, childCol, childRow, 1, 1, gl.RGBA, gl.FLOAT,
        new Float32Array([halfEnergy, 0.0, species, 1.0]))

      const parentCol = i % TEX_SIZE
      const parentRow = Math.floor(i / TEX_SIZE)
      gl.bindTexture(gl.TEXTURE_2D, getReadTexture(stateBufferB))
      gl.texSubImage2D(gl.TEXTURE_2D, 0, parentCol, parentRow, 1, 1, gl.RGBA, gl.FLOAT,
        new Float32Array([halfEnergy, age, species, alive]))

      const parentBaseRow = Math.floor(i / TEX_SIZE) * NN_PIXELS_PER_AGENT
      const childBaseRow  = Math.floor(childSlot / TEX_SIZE) * NN_PIXELS_PER_AGENT
      const parentWeightData = new Float32Array(NN_PIXELS_PER_AGENT * 4)

      gl.bindFramebuffer(gl.FRAMEBUFFER, weightBuffer.framebuffers[weightBuffer.currentIndex])
      for (let p = 0; p < NN_PIXELS_PER_AGENT; p++) {
        const pixel = new Float32Array(4)
        gl.readPixels(i % TEX_SIZE, parentBaseRow + p, 1, 1, gl.RGBA, gl.FLOAT, pixel)
        parentWeightData.set(pixel, p * 4)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      const childWeights = mutateWeights(parentWeightData, params.mutationRate, params.mutationStrength)

      gl.bindTexture(gl.TEXTURE_2D, getReadTexture(weightBuffer))
      for (let p = 0; p < NN_PIXELS_PER_AGENT; p++) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0,
          childSlot % TEX_SIZE, childBaseRow + p,
          1, 1, gl.RGBA, gl.FLOAT,
          childWeights.slice(p * 4, p * 4 + 4))
      }
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
  }

  // ── Sync GPU → Three.js ───────────────────────────────────────
  let syncFrame = 0

  function syncToThreeJS(): void {
    const posData  = readBackData(gl, stateBufferA)
    const metaData = readBackData(gl, stateBufferB)

    syncFrame++
    if (syncFrame % 10 === 0) slotManager.syncFromGPU(metaData)

    handleReproduction(posData, metaData)

    let preyCount = 0, predatorCount = 0

    for (let i = 0; i < MAX_AGENTS; i++) {
      const mIdx    = i * 4
      const alive   = metaData[mIdx + 3]
      const species = metaData[mIdx + 2]

      if (alive > 0.5) {
        const worldX  = posData[i * 4 + 0] - params.worldSize / 2
        const worldZ  = posData[i * 4 + 1] - params.worldSize / 2
        const groundY = sampleTerrainHeight(worldX, worldZ)

        dummy.position.set(worldX, groundY + 1.0, worldZ)
        dummy.updateMatrix()

        if (species < 0.5) preyMesh.setMatrixAt(preyCount++, dummy.matrix)
        else predatorMesh.setMatrixAt(predatorCount++, dummy.matrix)
      } else {
        slotManager.free(i)
      }
    }

    preyMesh.count     = preyCount
    predatorMesh.count = predatorCount
    preyMesh.instanceMatrix.needsUpdate     = true
    predatorMesh.instanceMatrix.needsUpdate = true
  }

  // ── Public API ────────────────────────────────────────────────
  let frameCounter = 0

  return {
    update(dt: number) {
      const clampedDt = Math.min(dt, 0.05)
      runSimulationTick(clampedDt)
      frameCounter++
      if (frameCounter % 3 === 0) syncToThreeJS()
    },

    getSceneObject() { return sceneGroup },

    getStats() {
      const metaData = readBackData(gl, stateBufferB)
      let alive = 0, prey = 0, predator = 0, totalEnergy = 0, totalAge = 0
      for (let i = 0; i < MAX_AGENTS; i++) {
        const idx = i * 4
        if (metaData[idx + 3] > 0.5) {
          alive++
          totalEnergy += metaData[idx + 0]
          totalAge    += metaData[idx + 1]
          if (metaData[idx + 2] < 0.5) prey++
          else predator++
        }
      }
      return {
        alive,
        prey,
        predator,
        free:      slotManager.freeCount,
        avgEnergy: alive > 0 ? totalEnergy / alive : 0,
        avgAge:    alive > 0 ? totalAge    / alive : 0,
      }
    },

    getNextFreeSlot() { return slotManager.allocate() },

    dispose() {
      destroyPingPongBuffer(gl, stateBufferA)
      destroyPingPongBuffer(gl, stateBufferB)
      destroyPingPongBuffer(gl, foodBuffer)
      destroyPingPongBuffer(gl, weightBuffer)
      gl.deleteProgram(movementProgram)
      gl.deleteProgram(foodProgram)
      gl.deleteVertexArray(vao)
      gl.deleteFramebuffer(mrtFramebuffer)
      agentGeometry.dispose()
      preyMaterial.dispose()
      predatorMaterial.dispose()
      preyMesh.dispose()
      predatorMesh.dispose()
    },

    params,
  }
}

// ── Module-level API ─────────────────────────────────────────────────
let engine: SimulationEngine | null = null

export function createAgents(): THREE.Object3D {
  engine = createSimulationEngine()
  ;(window as any).__ecoEngine = engine
  return engine.getSceneObject()
}

export function updateAgents(dt: number): void { engine?.update(dt) }

export function getAgentStats() {
  return engine?.getStats() ?? { alive: 0, prey: 0, predator: 0, free: 0, avgEnergy: 0, avgAge: 0 }
}

export function disposeAgents(): void {
  engine?.dispose()
  engine = null
}