/**
 * ES-51: Agent State Setup
 * ES-27: Neural Network Weights in GPU Textures (T-3.7.1)
 *
 * Defines the GPU texture layout for agent state.
 * Each agent occupies one pixel across multiple textures.
 *
 * STATE TEXTURE A (RGBA float32) — 64x64:
 *   R = position.x    (0.0 to WORLD_SIZE)
 *   G = position.y    (0.0 to WORLD_SIZE)
 *   B = velocity.x    (-1.0 to 1.0)
 *   A = velocity.y    (-1.0 to 1.0)
 *
 * STATE TEXTURE B (RGBA float32) — 64x64:
 *   R = energy         (0.0 to MAX_ENERGY)
 *   G = age            (0.0+, increments per tick)
 *   B = species        (0.0 = prey, 1.0 = predator)
 *   A = alive          (1.0 = alive, 0.0 = dead)
 *
 * WEIGHT TEXTURE C (RGBA float32) — 64x(64*NN_PIXELS_PER_AGENT):
 *   Neural network weights for each agent.
 *   Each agent occupies NN_PIXELS_PER_AGENT rows in this texture.
 *
 *   Network architecture:
 *     Inputs  (5): food distance, food angle, predator distance,
 *                  predator angle, own energy (normalised 0–1)
 *     Hidden  (8): fully connected, tanh activation
 *     Outputs (3): turn angle (-1→1), speed (0→1), reproduce (0→1)
 *
 *   Weight layout per agent (19 pixels = 76 floats, 1 unused):
 *     Pixels 0–9  : Input→Hidden weights  (5×8 = 40 floats, 10 pixels)
 *     Pixels 10–11: Hidden biases         (8 floats, 2 pixels)
 *     Pixels 12–17: Hidden→Output weights (8×3 = 24 floats, 6 pixels)
 *     Pixel  18   : Output biases         (3 floats + 1 unused)
 */

// ── World Constants ──────────────────────────────────────────────────
export const WORLD_SIZE = 256.0;

// ── Agent Constants ──────────────────────────────────────────────────
export const MAX_AGENTS = 4096;   // 64x64 texture = 4096 agent slots
export const TEX_SIZE   = 64;     // sqrt(MAX_AGENTS)
export const INITIAL_AGENT_COUNT = 512;

// ── Neural Network Architecture Constants ────────────────────────────
export const NN_INPUTS  = 5;   // food dist, food angle, pred dist, pred angle, energy
export const NN_HIDDEN  = 8;   // hidden layer size (matches DEFAULT_PARAMS.nnHiddenSize)
export const NN_OUTPUTS = 3;   // turn, speed, reproduce

// How many RGBA pixels one agent's weights occupy in Texture C:
//   Input→Hidden : NN_INPUTS * NN_HIDDEN = 5*8 = 40 floats = 10 pixels
//   Hidden biases: NN_HIDDEN             = 8   floats =  2 pixels
//   Hidden→Output: NN_HIDDEN * NN_OUTPUTS= 8*3 = 24 floats =  6 pixels
//   Output biases: NN_OUTPUTS            = 3   floats =  1 pixel (1 unused float)
//   Total: 75 floats → 19 pixels (76 floats, last float unused)
export const NN_WEIGHT_FLOATS     = NN_INPUTS * NN_HIDDEN     // 40
                                  + NN_HIDDEN                  // 8  (hidden biases)
                                  + NN_HIDDEN * NN_OUTPUTS     // 24
                                  + NN_OUTPUTS                 // 3  (output biases)
                                  // = 75 total

export const NN_PIXELS_PER_AGENT  = Math.ceil(NN_WEIGHT_FLOATS / 4) // 19

// Weight texture dimensions:
//   Width  = TEX_SIZE (64) — one column per agent column
//   Height = TEX_SIZE * NN_PIXELS_PER_AGENT (64 * 19 = 1216)
export const NN_TEX_WIDTH  = TEX_SIZE                        // 64
export const NN_TEX_HEIGHT = TEX_SIZE * NN_PIXELS_PER_AGENT  // 1216

// ── Simulation Defaults ──────────────────────────────────────────────
export const DEFAULT_PARAMS = {
  // ── Core survival ──────────────────────────────────────────────
  maxEnergy:        100.0,
  maxAge:           500.0,
  moveEnergyCost:   0.1,
  foodEnergyGain:   20.0,
  moveSpeed:        1.5,
  foodDetectRadius: 10.0,
  worldSize:        WORLD_SIZE,

  // ── ES-26: Neuroevolution config ───────────────────────────────
  mutationRate:     0.05,   // probability a weight is perturbed (0–1)
  mutationStrength: 0.2,    // max perturbation magnitude
  nnHiddenSize:     8,      // must match NN_HIDDEN above

  // ── ES-16: Reproduction ────────────────────────────────────────
  reproductionEnergyThreshold: 70.0,
  reproductionEnergyCost:      30.0,
};

export type SimParams = typeof DEFAULT_PARAMS;

// ── Helper: random weight initialisation ─────────────────────────────
// Weights initialised with Xavier/Glorot uniform: ±sqrt(6 / (fan_in + fan_out))
// This keeps activations from exploding or vanishing at the start.
function xavierWeight(fanIn: number, fanOut: number): number {
  const limit = Math.sqrt(6.0 / (fanIn + fanOut))
  return (Math.random() * 2 - 1) * limit
}

// ── Texture A: positions + velocities ────────────────────────────────
export function createInitialStateA(count: number = INITIAL_AGENT_COUNT): Float32Array {
  const data = new Float32Array(TEX_SIZE * TEX_SIZE * 4)

  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    const idx = i * 4
    if (i < count) {
      data[idx + 0] = Math.random() * WORLD_SIZE   // pos.x
      data[idx + 1] = Math.random() * WORLD_SIZE   // pos.y
      const angle   = Math.random() * Math.PI * 2
      data[idx + 2] = Math.cos(angle) * 0.5        // vel.x
      data[idx + 3] = Math.sin(angle) * 0.5        // vel.y
    }
    // empty slots stay 0
  }
  return data
}

// ── Texture B: energy, age, species, alive ───────────────────────────
export function createInitialStateB(count: number = INITIAL_AGENT_COUNT): Float32Array {
  const data = new Float32Array(TEX_SIZE * TEX_SIZE * 4)

  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    const idx = i * 4
    if (i < count) {
      data[idx + 0] = 50.0 + Math.random() * 50.0  // energy (50–100)
      data[idx + 1] = 0.0                            // age
      // ES-24: first half prey (0.0), second half predator (1.0)
      data[idx + 2] = i < count * 0.8 ? 0.0 : 1.0  // species
      data[idx + 3] = 1.0                            // alive
    }
  }
  return data
}

// ── Texture C: neural network weights ────────────────────────────────
/**
 * T-3.7.1: Creates the weight texture for all agents.
 *
 * Layout in the texture (width=64, height=1216):
 *   For agent at slot i (column = i % 64, base row = floor(i/64) * 19):
 *     rows +0  to +9  : input→hidden weights  [NN_INPUTS × NN_HIDDEN]
 *     rows +10 to +11 : hidden biases          [NN_HIDDEN]
 *     rows +12 to +17 : hidden→output weights  [NN_HIDDEN × NN_OUTPUTS]
 *     row  +18        : output biases           [NN_OUTPUTS, 1 unused]
 *
 * Weights are Xavier-initialised so evolution starts from a reasonable
 * random state rather than all-zeros (which would produce no gradient).
 */
export function createInitialWeightTexture(
  count: number = INITIAL_AGENT_COUNT
): Float32Array {
  const data = new Float32Array(NN_TEX_WIDTH * NN_TEX_HEIGHT * 4)

  for (let agentIdx = 0; agentIdx < count; agentIdx++) {
    const col     = agentIdx % TEX_SIZE
    const baseRow = Math.floor(agentIdx / TEX_SIZE) * NN_PIXELS_PER_AGENT

    // Pack weights as a flat array first, then write into texture
    const weights = new Float32Array(NN_PIXELS_PER_AGENT * 4)
    let w = 0

    // Input→Hidden weights (40 floats)
    for (let h = 0; h < NN_HIDDEN; h++)
      for (let inp = 0; inp < NN_INPUTS; inp++)
        weights[w++] = xavierWeight(NN_INPUTS, NN_HIDDEN)

    // Hidden biases (8 floats) — init to 0
    for (let h = 0; h < NN_HIDDEN; h++)
      weights[w++] = 0.0

    // Hidden→Output weights (24 floats)
    for (let o = 0; o < NN_OUTPUTS; o++)
      for (let h = 0; h < NN_HIDDEN; h++)
        weights[w++] = xavierWeight(NN_HIDDEN, NN_OUTPUTS)

    // Output biases (3 floats) — init to 0
    for (let o = 0; o < NN_OUTPUTS; o++)
      weights[w++] = 0.0

    // Write packed weights into the texture at this agent's location
    for (let p = 0; p < NN_PIXELS_PER_AGENT; p++) {
      const texRow = baseRow + p
      const texIdx = (texRow * NN_TEX_WIDTH + col) * 4
      data[texIdx + 0] = weights[p * 4 + 0]
      data[texIdx + 1] = weights[p * 4 + 1]
      data[texIdx + 2] = weights[p * 4 + 2]
      data[texIdx + 3] = weights[p * 4 + 3]
    }
  }

  return data
}

// ── Food texture ──────────────────────────────────────────────────────
export function createInitialFoodTexture(size: number = 128): Float32Array {
  const data = new Float32Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = 0.5 + Math.random() * 0.5  // food amount (0.5–1.0)
    data[i * 4 + 3] = 1.0
  }
  return data
}

// ── Weight mutation helper (used by simulationEngine reproduction) ────
/**
 * T-3.3.2: Mutates a copy of parent weights for the offspring.
 * Each weight has `mutationRate` probability of being perturbed
 * by a value in ±mutationStrength.
 * A small probability (5%) causes a large jump (exploration).
 */
export function mutateWeights(
  parentWeights: Float32Array,
  mutationRate:     number = DEFAULT_PARAMS.mutationRate,
  mutationStrength: number = DEFAULT_PARAMS.mutationStrength
): Float32Array {
  const child = new Float32Array(parentWeights)

  for (let i = 0; i < child.length; i++) {
    if (Math.random() < mutationRate) {
      if (Math.random() < 0.05) {
        // Large exploration jump (T-3.2.2)
        child[i] += (Math.random() * 2 - 1) * mutationStrength * 5.0
      } else {
        // Normal small perturbation (T-3.2.1)
        child[i] += (Math.random() * 2 - 1) * mutationStrength
      }
    }
  }

  return child
}
