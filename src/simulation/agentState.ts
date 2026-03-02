/**
 * ES-51: Agent State Setup
 *
 * Defines the GPU texture layout for agent state.
 * Each agent occupies one pixel across multiple textures.
 *
 * STATE TEXTURE A (RGBA float32):
 *   R = position.x    (0.0 to WORLD_SIZE)
 *   G = position.y    (0.0 to WORLD_SIZE)
 *   B = velocity.x    (-1.0 to 1.0)
 *   A = velocity.y    (-1.0 to 1.0)
 *
 * STATE TEXTURE B (RGBA float32):
 *   R = energy         (0.0 to MAX_ENERGY)
 *   G = age            (0.0+, increments per tick)
 *   B = species        (0.0 = prey, 1.0 = predator)
 *   A = alive          (1.0 = alive, 0.0 = dead)
 */

// ── World Constants ──────────────────────────────────────────────────
export const WORLD_SIZE = 256.0;

// ── Agent Constants ──────────────────────────────────────────────────
export const MAX_AGENTS = 4096; // 64x64 texture = 4096 agent slots
export const TEX_SIZE = 64;     // sqrt(MAX_AGENTS), texture is 64x64
export const INITIAL_AGENT_COUNT = 512;

// ── Simulation Defaults ──────────────────────────────────────────────
export const DEFAULT_PARAMS = {
  maxEnergy: 100.0,
  maxAge: 500.0,
  moveEnergyCost: 0.1,     // energy drained per tick of movement
  foodEnergyGain: 20.0,    // energy gained when eating food
  moveSpeed: 1.5,          // base movement speed
  foodDetectRadius: 10.0,  // how far agents can sense food
  worldSize: WORLD_SIZE,
} as const;

export type SimParams = typeof DEFAULT_PARAMS;

/**
 * Creates initial agent state data for Texture A (positions + velocities).
 * Agents are randomly scattered across the world with random velocities.
 */
export function createInitialStateA(count: number = INITIAL_AGENT_COUNT): Float32Array {
  const data = new Float32Array(TEX_SIZE * TEX_SIZE * 4); // RGBA per pixel

  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    const idx = i * 4;

    if (i < count) {
      // Position: random within world bounds
      data[idx + 0] = Math.random() * WORLD_SIZE;   // pos.x
      data[idx + 1] = Math.random() * WORLD_SIZE;   // pos.y
      // Velocity: random direction, normalized
      const angle = Math.random() * Math.PI * 2;
      data[idx + 2] = Math.cos(angle) * 0.5;        // vel.x
      data[idx + 3] = Math.sin(angle) * 0.5;        // vel.y
    } else {
      // Empty slot
      data[idx + 0] = 0.0;
      data[idx + 1] = 0.0;
      data[idx + 2] = 0.0;
      data[idx + 3] = 0.0;
    }
  }

  return data;
}

/**
 * Creates initial agent state data for Texture B (energy, age, species, alive).
 */
export function createInitialStateB(count: number = INITIAL_AGENT_COUNT): Float32Array {
  const data = new Float32Array(TEX_SIZE * TEX_SIZE * 4);

  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    const idx = i * 4;

    if (i < count) {
      data[idx + 0] = 50.0 + Math.random() * 50.0;  // energy (50-100)
      data[idx + 1] = 0.0;                            // age (start at 0)
      data[idx + 2] = 0.0;                            // species (0 = prey for now)
      data[idx + 3] = 1.0;                            // alive = true
    } else {
      data[idx + 0] = 0.0;
      data[idx + 1] = 0.0;
      data[idx + 2] = 0.0;
      data[idx + 3] = 0.0; // dead / empty slot
    }
  }

  return data;
}

/**
 * Creates initial food resource texture.
 * Each pixel = one cell in the food grid.
 * R channel = food amount (0.0 to 1.0).
 */
export function createInitialFoodTexture(size: number = 128): Float32Array {
  const data = new Float32Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    data[idx + 0] = 0.5 + Math.random() * 0.5; // food amount (0.5-1.0)
    data[idx + 1] = 0.0; // unused
    data[idx + 2] = 0.0; // unused
    data[idx + 3] = 1.0; // unused
  }

  return data;
}
