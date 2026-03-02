#version 300 es
precision highp float;

// ES-52: Agent Movement & State Update Fragment Shader
//
// This shader runs once per pixel. Each pixel = one agent.
// It reads the current state from ping-pong textures,
// computes new position/velocity/energy/age, and outputs the result.
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
uniform float uDeltaTime;       // time step
uniform float uMoveSpeed;       // base movement speed
uniform float uMoveEnergyCost;  // energy cost per tick
uniform float uFoodEnergyGain;  // energy gained from eating
uniform float uMaxAge;          // maximum lifespan
uniform float uMaxEnergy;       // energy cap
uniform float uWorldSize;       // world bounds
uniform float uFoodDetectRadius;// food sensing range
uniform float uTime;            // global time for noise/variation

// ── Outputs (MRT) ─────────────────────────────────────────────────
layout(location = 0) out vec4 outStateA;
layout(location = 1) out vec4 outStateB;

// ── Pseudo-random hash ────────────────────────────────────────────
// Simple hash for deterministic randomness per agent per tick
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Main ──────────────────────────────────────────────────────────
void main() {
  // Read current state for this agent (this pixel)
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

  // ── Movement ────────────────────────────────────────────────
  // Add slight random steering so agents don't go in straight lines
  float rng = hash(vUv + uTime);
  float steerAngle = (rng - 0.5) * 1.0; // random turn ±0.5 radians
  float cosA = cos(steerAngle);
  float sinA = sin(steerAngle);
  vec2 newVel = vec2(
    vel.x * cosA - vel.y * sinA,
    vel.x * sinA + vel.y * cosA
  );

  // Normalize and apply speed
  float len = length(newVel);
  if (len > 0.001) {
    newVel = (newVel / len) * uMoveSpeed;
  }

  // Update position
  vec2 newPos = pos + newVel * uDeltaTime;

  // ── World boundary wrapping ─────────────────────────────────
  newPos = mod(newPos + uWorldSize, uWorldSize);

  // ── Food consumption ────────────────────────────────────────
  // Sample food texture at agent's position
  vec2 foodUV = newPos / uWorldSize;
  float foodHere = texture(uFood, foodUV).r;

  float energyGain = 0.0;
  if (foodHere > 0.1) {
    // Agent eats — gain energy
    energyGain = uFoodEnergyGain * uDeltaTime;
  }

  // ── Energy update ───────────────────────────────────────────
  energy = energy - (uMoveEnergyCost * uDeltaTime) + energyGain;
  energy = clamp(energy, 0.0, uMaxEnergy);

  // ── Death check ─────────────────────────────────────────────
  // Die if energy depleted OR exceeded max age
  if (energy <= 0.0 || age > uMaxAge) {
    alive = 0.0;
    energy = 0.0;
  }

  // ── Write output ────────────────────────────────────────────
  outStateA = vec4(newPos, newVel);
  outStateB = vec4(energy, age, species, alive);
}
