#version 300 es
precision highp float;

// Food Resource Update Shader
//
// Updates the food grid each tick:
//   - Food regrows slowly over time
//   - Food is depleted where agents are eating
//
// This runs as a separate pass, writing to the food ping-pong buffer.


in vec2 vUv;

uniform sampler2D uFood;      // current food state
uniform sampler2D uStateA;    // agent positions (to know where eating happens)
uniform sampler2D uStateB;    // agent alive flags
uniform float uDeltaTime;
uniform float uWorldSize;
uniform float uRegrowRate;    // how fast food grows back (per second)
uniform float uTexSize;       // agent texture size (64)

layout(location = 0) out vec4 outFood;

void main() {
  float food = texture(uFood, vUv).r;

  // ── Regrowth ────────────────────────────────────────────────
  food += uRegrowRate * uDeltaTime;

  // ── Depletion from agents ───────────────────────────────────
  // Scan all agents and deplete food at their positions.
  // This is O(n) per food cell — acceptable for 4096 agents
  // on a 128x128 food grid on GPU. For larger counts,
  // spatial hashing (T-2.7.1) optimizes this in Sprint 2.
  float deplete = 0.0;
  for (float y = 0.0; y < uTexSize; y += 1.0) {
    for (float x = 0.0; x < uTexSize; x += 1.0) {
      vec2 agentUV = (vec2(x, y) + 0.5) / uTexSize;
      vec4 agentA = texture(uStateA, agentUV);
      vec4 agentB = texture(uStateB, agentUV);

      // Skip dead agents
      if (agentB.a < 0.5) continue;

      // Check if this agent is in this food cell
      vec2 agentFoodUV = agentA.xy / uWorldSize;
      float dist = distance(agentFoodUV, vUv);

      // If agent is within this cell, deplete food
      if (dist < (1.0 / 128.0)) {
        deplete += 0.3 * uDeltaTime;
      }
    }
  }

  food -= deplete;
  food = clamp(food, 0.0, 1.0);

  outFood = vec4(food, 0.0, 0.0, 1.0);
}
