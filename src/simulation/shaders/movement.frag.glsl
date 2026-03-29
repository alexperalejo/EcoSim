#version 300 es
precision highp float;

// ES-52 / ES-19 / T-3.7.2: Agent Movement with Neural Network Brain
//
// Sprint 2: replaces hardcoded food-seeking with a neural network forward
// pass (T-3.7.2). Each agent reads its weights from uWeights texture and
// runs a 2-layer feedforward network to decide movement and behaviour.
//
// Network architecture:
//   Inputs  (5): food distance, food angle, threat/prey distance,
//                threat/prey angle, own energy (all normalised 0–1)
//   inputs[2/3] serve dual purpose — for prey: nearest predator;
//                                    for predators: nearest prey
//   Hidden  (8): tanh activation (T-3.1.4)
//   Outputs (3): turn angle (-1→1), speed (0→1), reproduce signal (0→1)
//
// Weight texture layout per agent (19 pixels = 76 floats):
//   Pixels 0–9  : input→hidden weights  (5×8 = 40 floats, row-major)
//   Pixels 10–11: hidden biases          (8 floats)
//   Pixels 12–17: hidden→output weights  (8×3 = 24 floats, row-major)
//   Pixel  18   : output biases          (3 floats + 1 unused)
//
// TWO OUTPUTS (MRT):
//   layout(location = 0) → State A (position.xy, velocity.xy)
//   layout(location = 1) → State B (energy, age, species, alive)

// ── Inputs ────────────────────────────────────────────────────────
in vec2 vUv;

uniform sampler2D uStateA;   // position.xy, velocity.xy
uniform sampler2D uStateB;   // energy, age, species, alive
uniform sampler2D uFood;     // food resource grid
uniform sampler2D uWeights;  // T-3.7.2: neural network weights

// Simulation parameters
uniform float uDeltaTime;
uniform float uMoveSpeed;
uniform float uMoveEnergyCost;
uniform float uFoodEnergyGain;
uniform float uMaxAge;
uniform float uMaxEnergy;
uniform float uWorldSize;
uniform float uFoodDetectRadius;
uniform float uTime;

// Reproduction
uniform float uReproThreshold;
uniform float uReproEnergyCost;

// ES-67: Predator-prey interaction
uniform float uKillRadius;          // world-space distance for a kill (e.g. 0.8)
uniform float uPredatorEnergyGain;  // energy predator absorbs from eating one prey

// NN layout (passed from simulationEngine.ts)
uniform int   uNNPixelsPerAgent;  // 19
uniform float uNNTexHeight;       // 1216.0

// ── Outputs (MRT) ─────────────────────────────────────────────────
layout(location = 0) out vec4 outStateA;
layout(location = 1) out vec4 outStateB;

// ── Constants ─────────────────────────────────────────────────────
#define NN_INPUTS  5
#define NN_HIDDEN  8
#define NN_OUTPUTS 3
#define TEX_SIZE   64.0

// ── Pseudo-random hash ────────────────────────────────────────────
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Weight texture sampler ────────────────────────────────────────
// Reads one float from the weight texture at a specific (col, row, channel).
// agentSlot: the agent's index in the 64x64 texture (0–4095)
// pixelOffset: which of the 19 weight pixels to read (0–18)
// channel: which RGBA channel (0=R, 1=G, 2=B, 3=A)
float readWeight(int agentSlot, int pixelOffset, int channel) {
  // Agent column in the 64-wide texture
  float col = float(agentSlot % 64);

  // Base row for this agent: which "row group" the agent is in (0–63)
  // multiplied by NN_PIXELS_PER_AGENT (19)
  float baseRow = float(agentSlot / 64) * float(uNNPixelsPerAgent);

  float row = baseRow + float(pixelOffset);

  // UV into the weight texture (width=64, height=1216)
  vec2 uv = (vec2(col, row) + 0.5) / vec2(TEX_SIZE, uNNTexHeight);

  vec4 pixel = texture(uWeights, uv);

  // Select channel
  if (channel == 0) return pixel.r;
  if (channel == 1) return pixel.g;
  if (channel == 2) return pixel.b;
  return pixel.a;
}

// ── Neural network forward pass (T-3.7.2) ─────────────────────────
//
// Runs a 2-layer feedforward network for one agent.
//
// inputs[5]:  normalised sensor readings
// agentSlot:  index into weight texture
// returns:    vec3(turnAngle, speed, reproduceSignal) — all tanh-activated
//             turn:      -1 (hard left) → +1 (hard right)
//             speed:      0 (stop)      → +1 (full speed)
//             reproduce:  0 (no)        → +1 (yes, threshold applied CPU-side)
//
vec3 neuralForward(float inputs[NN_INPUTS], int agentSlot) {

  // ── Layer 1: input → hidden ──────────────────────────────────
  // Weight layout in texture:
  //   Pixels 0–9 store the 5×8=40 input→hidden weights, row-major:
  //   hidden neuron h reads weights from inputs i:
  //     w[h*5 + i] stored at pixel (h*5+i)/4, channel (h*5+i)%4
  //
  float hidden[NN_HIDDEN];

  for (int h = 0; h < NN_HIDDEN; h++) {
    float sum = 0.0;

    // Accumulate weighted inputs
    for (int i = 0; i < NN_INPUTS; i++) {
      int weightIdx  = h * NN_INPUTS + i;  // flat index 0–39
      int pixelIdx   = weightIdx / 4;       // which pixel (0–9)
      int channelIdx = weightIdx - pixelIdx * 4; // which channel (0–3)
      sum += inputs[i] * readWeight(agentSlot, pixelIdx, channelIdx);
    }

    // Add hidden bias (pixels 10–11, 8 floats)
    int biasPixel   = 10 + h / 4;
    int biasChannel = h - (h / 4) * 4;
    sum += readWeight(agentSlot, biasPixel, biasChannel);

    // tanh activation (T-3.1.4)
    hidden[h] = tanh(sum);
  }

  // ── Layer 2: hidden → output ─────────────────────────────────
  // Weight layout:
  //   Pixels 12–17 store the 8×3=24 hidden→output weights, row-major:
  //   output o reads weights from hidden h:
  //     w[o*8 + h] stored at pixel 12 + (o*8+h)/4, channel (o*8+h)%4
  //
  vec3 nnResult  = vec3(0.0);

  for (int o = 0; o < NN_OUTPUTS; o++) {
    float sum = 0.0;

    for (int h = 0; h < NN_HIDDEN; h++) {
      int weightIdx  = o * NN_HIDDEN + h;  // flat index 0–23
      int pixelIdx   = 12 + weightIdx / 4; // pixels 12–17
      int channelIdx = weightIdx - (weightIdx / 4) * 4;
      sum += hidden[h] * readWeight(agentSlot, pixelIdx, channelIdx);
    }

    // Add output bias (pixel 18, channels 0–2)
    sum += readWeight(agentSlot, 18, o);

    // tanh activation
    if (o == 0) nnResult .x = tanh(sum);        // turn angle
    if (o == 1) nnResult .y = tanh(sum) * 0.5 + 0.5; // speed: remap to 0–1
    if (o == 2) nnResult .z = tanh(sum) * 0.5 + 0.5; // reproduce: remap to 0–1
  }

  return nnResult;
}

// ── Sensor: nearest food ──────────────────────────────────────────
// Returns vec2(distance_norm, angle_norm) to richest food direction.
// distance_norm: 0 = food right here, 1 = nothing in range
// angle_norm:    0–1 mapped from -π to +π
vec2 senseFoodNearest(vec2 pos) {
  vec2 dirs[8];
  dirs[0] = vec2( 0.0,  1.0);
  dirs[1] = vec2( 0.707,  0.707);
  dirs[2] = vec2( 1.0,  0.0);
  dirs[3] = vec2( 0.707, -0.707);
  dirs[4] = vec2( 0.0, -1.0);
  dirs[5] = vec2(-0.707, -0.707);
  dirs[6] = vec2(-1.0,  0.0);
  dirs[7] = vec2(-0.707,  0.707);

  float bestFood  = 0.0;
  vec2  bestDir   = vec2(0.0, 1.0);

  for (int i = 0; i < 8; i++) {
    vec2 samplePos = mod(pos + dirs[i] * uFoodDetectRadius + uWorldSize, uWorldSize);
    float foodAmt  = texture(uFood, samplePos / uWorldSize).r;
    if (foodAmt > bestFood) {
      bestFood = foodAmt;
      bestDir  = dirs[i];
    }
  }

  float distNorm  = 1.0 - bestFood; // high food = low distance
  float angleNorm = (atan(bestDir.y, bestDir.x) + 3.14159) / 6.28318; // 0–1
  return vec2(distNorm, angleNorm);
}

// ── Sensor: nearest predator ──────────────────────────────────────
// Scans nearby agent texture pixels for predators (species = 1.0).
// Returns vec2(distance_norm, angle_norm).
// Only scans a 5x5 neighbourhood — enough for local awareness.
vec2 sensePredator(vec2 pos, float mySpecies) {
  float closestDist = 1.0; // normalised, 1.0 = nothing found
  float closestAngle = 0.5;

  // Only prey need to sense predators
  if (mySpecies > 0.5) return vec2(1.0, 0.5);

  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 neighbourUV = vUv + vec2(float(dx), float(dy)) / TEX_SIZE;
      if (neighbourUV.x < 0.0 || neighbourUV.x > 1.0 ||
          neighbourUV.y < 0.0 || neighbourUV.y > 1.0) continue;

      vec4 nStateA = texture(uStateA, neighbourUV);
      vec4 nStateB = texture(uStateB, neighbourUV);

      float nAlive   = nStateB.a;
      float nSpecies = nStateB.b;

      // Skip self, dead, and non-predators
      if (nAlive < 0.5 || nSpecies < 0.5) continue;

      vec2 nPos  = nStateA.xy;
      vec2 delta = nPos - pos;

      // Handle world wrapping
      if (delta.x >  uWorldSize * 0.5) delta.x -= uWorldSize;
      if (delta.x < -uWorldSize * 0.5) delta.x += uWorldSize;
      if (delta.y >  uWorldSize * 0.5) delta.y -= uWorldSize;
      if (delta.y < -uWorldSize * 0.5) delta.y += uWorldSize;

      float dist = length(delta) / uWorldSize; // normalise to 0–1

      if (dist < closestDist) {
        closestDist  = dist;
        closestAngle = (atan(delta.y, delta.x) + 3.14159) / 6.28318;
      }
    }
  }

  return vec2(closestDist, closestAngle);
}

// ── Sensor: nearest prey ──────────────────────────────────────────
// Mirror of sensePredator — only predators (species = 1.0) run this.
// Returns vec2(distance_norm, angle_norm) toward the closest living prey.
vec2 sensePrey(vec2 pos, float mySpecies) {
  float closestDist  = 1.0;
  float closestAngle = 0.5;

  // Only predators need to sense prey
  if (mySpecies < 0.5) return vec2(1.0, 0.5);

  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 neighbourUV = vUv + vec2(float(dx), float(dy)) / TEX_SIZE;
      if (neighbourUV.x < 0.0 || neighbourUV.x > 1.0 ||
          neighbourUV.y < 0.0 || neighbourUV.y > 1.0) continue;

      vec4 nStateA = texture(uStateA, neighbourUV);
      vec4 nStateB = texture(uStateB, neighbourUV);

      float nAlive   = nStateB.a;
      float nSpecies = nStateB.b;

      // Skip self, dead, and non-prey
      if (nAlive < 0.5 || nSpecies > 0.5) continue;

      vec2 nPos  = nStateA.xy;
      vec2 delta = nPos - pos;

      // Handle world wrapping
      if (delta.x >  uWorldSize * 0.5) delta.x -= uWorldSize;
      if (delta.x < -uWorldSize * 0.5) delta.x += uWorldSize;
      if (delta.y >  uWorldSize * 0.5) delta.y -= uWorldSize;
      if (delta.y < -uWorldSize * 0.5) delta.y += uWorldSize;

      float dist = length(delta) / uWorldSize;

      if (dist < closestDist) {
        closestDist  = dist;
        closestAngle = (atan(delta.y, delta.x) + 3.14159) / 6.28318;
      }
    }
  }

  return vec2(closestDist, closestAngle);
}
void main() {
  vec4 stateA = texture(uStateA, vUv);
  vec4 stateB = texture(uStateB, vUv);

  vec2  pos     = stateA.xy;
  vec2  vel     = stateA.zw;
  float energy  = stateB.r;
  float age     = stateB.g;
  float species = stateB.b;
  float alive   = stateB.a;

  // Dead agents pass through unchanged
  if (alive < 0.5) {
    outStateA = stateA;
    outStateB = stateB;
    return;
  }

  // ── Age increment ────────────────────────────────────────────
  age += uDeltaTime;

  // ── Agent slot index (which pixel am I?) ─────────────────────
  // vUv maps to the 64x64 texture. Convert to integer slot index.
  int col       = int(vUv.x * TEX_SIZE);
  int row       = int(vUv.y * TEX_SIZE);
  int agentSlot = row * 64 + col;

  // ── Build sensor inputs (T-3.1.2) ────────────────────────────
  vec2 foodSensor     = senseFoodNearest(pos);
  vec2 predatorSensor = sensePredator(pos, species);
  vec2 preySensor     = sensePrey(pos, species);

  // inputs[2/3] serve dual purpose:
  //   prey    → nearest predator distance/angle (flee stimulus)
  //   predator → nearest prey distance/angle    (hunt stimulus)
  vec2 threatOrHunt = (species < 0.5) ? predatorSensor : preySensor;

  float inputs[NN_INPUTS];
  inputs[0] = foodSensor.x;       // food distance (0=near, 1=far)
  inputs[1] = foodSensor.y;       // food angle (0–1)
  inputs[2] = threatOrHunt.x;     // threat/prey distance (0=near, 1=far)
  inputs[3] = threatOrHunt.y;     // threat/prey angle (0–1)
  inputs[4] = clamp(energy / uMaxEnergy, 0.0, 1.0); // own energy (0–1)

  // ── Neural network forward pass (T-3.7.2) ────────────────────
  vec3 nnOut = neuralForward(inputs, agentSlot);

  float turnAngle = nnOut.x * 1.5;  // scale to ±1.5 radians max turn
  float speed     = 0.3 + nnOut.y * 0.7; // min 30% speed, max 100%

  // ── Apply turn to current velocity ───────────────────────────
  float cosT = cos(turnAngle);
  float sinT = sin(turnAngle);
  vec2 newVel = vec2(
    vel.x * cosT - vel.y * sinT,
    vel.x * sinT + vel.y * cosT
  );

  // Normalise and apply speed
  float len = length(newVel);
  if (len > 0.001) {
    newVel = (newVel / len) * uMoveSpeed * speed;
  } else {
    // Fallback if velocity collapses
    float rng   = hash(vUv + uTime);
    float angle = rng * 6.28318;
    newVel = vec2(cos(angle), sin(angle)) * uMoveSpeed * 0.5;
  }

  // ── Update position + wrap ────────────────────────────────────
  vec2 newPos = mod(pos + newVel * uDeltaTime + uWorldSize, uWorldSize);

  // ── Food consumption ──────────────────────────────────────────
  float foodHere  = texture(uFood, newPos / uWorldSize).r;
  float energyGain = foodHere > 0.1 ? uFoodEnergyGain * uDeltaTime : 0.0;

  // ── Energy update ─────────────────────────────────────────────
  energy = energy - (uMoveEnergyCost * uDeltaTime) + energyGain;

  // Reproduction metabolic cost
  if (energy > uReproThreshold) {
    energy -= uReproEnergyCost * uDeltaTime;
  }

  // ── ES-67: Predator-prey kill zone ───────────────────────────
  // Prey: if a predator is within uKillRadius → die this tick.
  // Predator: if prey is within uKillRadius → absorb energy.
  // Both checks use the already-computed sensor distances (world-normalised).
  float killDistNorm = uKillRadius / uWorldSize;
  if (species < 0.5) {
    // I am prey — am I being caught?
    if (predatorSensor.x < killDistNorm) {
      alive  = 0.0;
      energy = 0.0;
    }
  } else {
    // I am a predator — did I catch prey?
    if (preySensor.x < killDistNorm) {
      energy += uPredatorEnergyGain;
    }
  }

  energy = clamp(energy, 0.0, uMaxEnergy);

  // ── Death check ───────────────────────────────────────────────
  if (energy <= 0.0 || age > uMaxAge) {
    alive  = 0.0;
    energy = 0.0;
  }

  // ── Write output ──────────────────────────────────────────────
  outStateA = vec4(newPos, newVel);
  outStateB = vec4(energy, age, species, alive);
}
