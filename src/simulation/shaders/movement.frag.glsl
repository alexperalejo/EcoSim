#version 300 es
precision highp float;

// ES-52 / ES-19: Agent Movement, Spatial Awareness & State Update
//
// ES-19 adds food-seeking behaviour on top of the random walk from ES-52.
// Each agent samples the food grid in 8 directions within uFoodDetectRadius
// and steers toward the richest food source. When energy is low the agent
// weights food-seeking more heavily (desperation bias).
//
// TWO OUTPUTS (MRT - Multiple Render Targets):
//   layout(location = 0) → State A (position.xy, velocity.xy)
//   layout(location = 1) → State B (energy, age, species, alive)


// ── Inputs ────────────────────────────────────────────────────────
in vec2 vUv;

// Current state textures (READ)
uniform sampler2D uStateA;    // position.xy, velocity.xy
uniform sampler2D uStateB;    // energy, age, species, alive
uniform sampler2D uFood;      // food resource grid

// Simulation parameters
uniform float uDeltaTime;
uniform float uMoveSpeed;
uniform float uMoveEnergyCost;
uniform float uFoodEnergyGain;
uniform float uMaxAge;
uniform float uMaxEnergy;
uniform float uWorldSize;
uniform float uFoodDetectRadius; // food sensing range (world units)
uniform float uTime;

// ── Reproduction parameters (ES-16 / ES-91) ───────────────────────
// The shader drains reproduction energy cost so the GPU handles the
// parent's energy deduction. The CPU handles offspring spawning via
// texSubImage2D after detecting agents above the threshold.
uniform float uReproThreshold;  // energy required to reproduce (e.g. 80.0)
uniform float uReproEnergyCost; // energy drained per tick while above threshold

// ── Outputs (MRT) ─────────────────────────────────────────────────
layout(location = 0) out vec4 outStateA;
layout(location = 1) out vec4 outStateB;

// ── Pseudo-random hash ────────────────────────────────────────────
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Food gradient sensing ─────────────────────────────────────────
// Samples food in 8 compass directions around `pos` within the detect
// radius. Returns a world-space pull vector (unnormalised) pointing
// toward the richest food source. Returns vec2(0) when nothing found.
//
// We wrap sample positions so agents near world edges still sense food
// on the other side (matches the position wrapping done during movement).
vec2 senseFoodGradient(vec2 pos) {
  vec2 pull = vec2(0.0);

  // 8-directional compass offsets (normalised)
  // N, NE, E, SE, S, SW, W, NW
  vec2 dirs[8];
  dirs[0] = vec2( 0.0,  1.0);
  dirs[1] = vec2( 0.707,  0.707);
  dirs[2] = vec2( 1.0,  0.0);
  dirs[3] = vec2( 0.707, -0.707);
  dirs[4] = vec2( 0.0, -1.0);
  dirs[5] = vec2(-0.707, -0.707);
  dirs[6] = vec2(-1.0,  0.0);
  dirs[7] = vec2(-0.707,  0.707);

  for (int i = 0; i < 8; i++) {
    vec2 samplePos = pos + dirs[i] * uFoodDetectRadius;

    // Wrap sample position to world bounds (mirrors movement wrapping)
    samplePos = mod(samplePos + uWorldSize, uWorldSize);

    vec2 foodUV = samplePos / uWorldSize;
    float foodAmt = texture(uFood, foodUV).r;

    // Accumulate weighted pull toward this direction
    pull += dirs[i] * foodAmt;
  }

  return pull; // magnitude encodes total food richness in that direction
}

// ── Main ──────────────────────────────────────────────────────────
void main() {
  vec4 stateA = texture(uStateA, vUv);
  vec4 stateB = texture(uStateB, vUv);

  vec2 pos      = stateA.xy;
  vec2 vel      = stateA.zw;
  float energy  = stateB.r;
  float age     = stateB.g;
  float species = stateB.b;
  float alive   = stateB.a;

  // ── Dead agent: pass through unchanged ──────────────────────
  if (alive < 0.5) {
    outStateA = stateA;
    outStateB = stateB;
    return;
  }

  // ── Age increment ───────────────────────────────────────────
  age += uDeltaTime;

  // ── Random steering (same as ES-52) ─────────────────────────
  float rng = hash(vUv + uTime);
  float steerAngle = (rng - 0.5) * 1.0; // ±0.5 rad random turn
  float cosA = cos(steerAngle);
  float sinA = sin(steerAngle);
  vec2 randomVel = vec2(
    vel.x * cosA - vel.y * sinA,
    vel.x * sinA + vel.y * cosA
  );

  // ── ES-19: Food-seeking steering ────────────────────────────
  vec2 foodPull = senseFoodGradient(pos);
  float pullMag = length(foodPull);

  // foodWeight: how strongly to steer toward food vs random walk.
  //   - Base weight: 0.4 (always somewhat food-aware)
  //   - Desperation boost: rises to 0.85 when energy < 40% of max
  //     so starving agents actively hunt food rather than wandering
  float hungerRatio = 1.0 - clamp(energy / (uMaxEnergy * 0.4), 0.0, 1.0);
  float foodWeight  = 0.4 + 0.45 * hungerRatio; // 0.4 → 0.85

  vec2 seekVel = vec2(0.0);
  if (pullMag > 0.001) {
    // Steer toward food gradient, full speed
    seekVel = (foodPull / pullMag) * uMoveSpeed;
  }

  // Blend: lerp between random walk and food-seek based on foodWeight
  vec2 newVel = mix(randomVel, seekVel, foodWeight);

  // Normalise and apply speed
  float len = length(newVel);
  if (len > 0.001) {
    newVel = (newVel / len) * uMoveSpeed;
  } else {
    // Fallback: keep old velocity direction if blend collapses
    newVel = normalize(vel + vec2(0.001)) * uMoveSpeed;
  }

  // ── Update position ─────────────────────────────────────────
  vec2 newPos = pos + newVel * uDeltaTime;

  // ── World boundary wrapping ──────────────────────────────────
  newPos = mod(newPos + uWorldSize, uWorldSize);

  // ── Food consumption ─────────────────────────────────────────
  vec2 foodUV = newPos / uWorldSize;
  float foodHere = texture(uFood, foodUV).r;

  float energyGain = 0.0;
  if (foodHere > 0.1) {
    energyGain = uFoodEnergyGain * uDeltaTime;
  }

  // ── Energy update ────────────────────────────────────────────
  energy = energy - (uMoveEnergyCost * uDeltaTime) + energyGain;

  // ── Reproduction energy drain (ES-16 / ES-91: T-2.4.1) ─────
  // When above the reproduction threshold the agent pays a per-tick
  // metabolic cost. This models the expense of being ready to reproduce
  // and prevents agents sitting at max energy forever.
  // Actual offspring spawning happens CPU-side via texSubImage2D.
  if (energy > uReproThreshold) {
    energy -= uReproEnergyCost * uDeltaTime;
  }

  energy = clamp(energy, 0.0, uMaxEnergy);

  // ── Death check ──────────────────────────────────────────────
  if (energy <= 0.0 || age > uMaxAge) {
    alive = 0.0;
    energy = 0.0;
  }

  // ── Write output ─────────────────────────────────────────────
  outStateA = vec4(newPos, newVel);
  outStateB = vec4(energy, age, species, alive);
}