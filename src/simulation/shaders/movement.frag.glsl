#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uStateA;
uniform sampler2D uStateB;
uniform sampler2D uFood;
uniform sampler2D uWeights;

uniform float uDeltaTime;
uniform float uMoveSpeed;
uniform float uMoveEnergyCost;
uniform float uFoodEnergyGain;
uniform float uMaxAge;
uniform float uMaxEnergy;
uniform float uWorldSize;
uniform float uFoodDetectRadius;
uniform float uTime;
uniform float uReproThreshold;
uniform float uReproEnergyCost;
uniform float uKillRadius;
uniform float uPredatorEnergyGain;
uniform int   uNNPixelsPerAgent;
uniform float uNNTexHeight;

layout(location = 0) out vec4 outStateA;
layout(location = 1) out vec4 outStateB;

#define NN_INPUTS  5
#define NN_HIDDEN  8
#define NN_OUTPUTS 3
#define TEX_SIZE   64.0

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float readWeight(int agentSlot, int pixelOffset, int channel) {
  float col     = float(agentSlot % 64);
  float baseRow = float(agentSlot / 64) * float(uNNPixelsPerAgent);
  float row     = baseRow + float(pixelOffset);
  vec2  uv      = (vec2(col, row) + 0.5) / vec2(TEX_SIZE, uNNTexHeight);
  vec4  pixel   = texture(uWeights, uv);
  if (channel == 0) return pixel.r;
  if (channel == 1) return pixel.g;
  if (channel == 2) return pixel.b;
  return pixel.a;
}

vec3 neuralForward(float inputs[NN_INPUTS], int agentSlot) {
  float hidden[NN_HIDDEN];
  for (int h = 0; h < NN_HIDDEN; h++) {
    float sum = 0.0;
    for (int i = 0; i < NN_INPUTS; i++) {
      int weightIdx  = h * NN_INPUTS + i;
      int pixelIdx   = weightIdx / 4;
      int channelIdx = weightIdx - pixelIdx * 4;
      sum += inputs[i] * readWeight(agentSlot, pixelIdx, channelIdx);
    }
    int biasPixel   = 10 + h / 4;
    int biasChannel = h - (h / 4) * 4;
    sum += readWeight(agentSlot, biasPixel, biasChannel);
    hidden[h] = tanh(sum);
  }
  vec3 nnResult = vec3(0.0);
  for (int o = 0; o < NN_OUTPUTS; o++) {
    float sum = 0.0;
    for (int h = 0; h < NN_HIDDEN; h++) {
      int weightIdx  = o * NN_HIDDEN + h;
      int pixelIdx   = 12 + weightIdx / 4;
      int channelIdx = weightIdx - (weightIdx / 4) * 4;
      sum += hidden[h] * readWeight(agentSlot, pixelIdx, channelIdx);
    }
    sum += readWeight(agentSlot, 18, o);
    if (o == 0) nnResult.x = tanh(sum);
    if (o == 1) nnResult.y = tanh(sum) * 0.5 + 0.5;
    if (o == 2) nnResult.z = tanh(sum) * 0.5 + 0.5;
  }
  return nnResult;
}

vec2 senseFoodNearest(vec2 pos) {
  vec2 dirs[8];
  dirs[0] = vec2( 0.0,    1.0);
  dirs[1] = vec2( 0.707,  0.707);
  dirs[2] = vec2( 1.0,    0.0);
  dirs[3] = vec2( 0.707, -0.707);
  dirs[4] = vec2( 0.0,   -1.0);
  dirs[5] = vec2(-0.707, -0.707);
  dirs[6] = vec2(-1.0,    0.0);
  dirs[7] = vec2(-0.707,  0.707);
  float bestFood = 0.0;
  vec2  bestDir  = vec2(0.0, 1.0);
  for (int i = 0; i < 8; i++) {
    vec2  samplePos = mod(pos + dirs[i] * uFoodDetectRadius + uWorldSize, uWorldSize);
    float foodAmt   = texture(uFood, samplePos / uWorldSize).r;
    if (foodAmt > bestFood) { bestFood = foodAmt; bestDir = dirs[i]; }
  }
  float distNorm  = 1.0 - bestFood;
  float angleNorm = (atan(bestDir.y, bestDir.x) + 3.14159) / 6.28318;
  return vec2(distNorm, angleNorm);
}

vec2 sensePredator(vec2 pos, float mySpecies) {
  float closestDist  = 1.0;
  float closestAngle = 0.5;
  if (mySpecies > 0.5) return vec2(1.0, 0.5);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 uv = vUv + vec2(float(dx), float(dy)) / TEX_SIZE;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
      vec4 nA = texture(uStateA, uv);
      vec4 nB = texture(uStateB, uv);
      if (nB.a < 0.5 || nB.b < 0.5) continue;
      vec2 delta = nA.xy - pos;
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

vec2 sensePrey(vec2 pos, float mySpecies) {
  float closestDist  = 1.0;
  float closestAngle = 0.5;
  if (mySpecies < 0.5) return vec2(1.0, 0.5);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 uv = vUv + vec2(float(dx), float(dy)) / TEX_SIZE;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
      vec4 nA = texture(uStateA, uv);
      vec4 nB = texture(uStateB, uv);
      if (nB.a < 0.5 || nB.b > 0.5) continue;
      vec2 delta = nA.xy - pos;
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

  if (alive < 0.5) { outStateA = stateA; outStateB = stateB; return; }

  age += uDeltaTime;

  int col       = int(vUv.x * TEX_SIZE);
  int row       = int(vUv.y * TEX_SIZE);
  int agentSlot = row * 64 + col;

  vec2 foodSensor     = senseFoodNearest(pos);
  vec2 predatorSensor = sensePredator(pos, species);
  vec2 preySensor     = sensePrey(pos, species);
  vec2 threatOrHunt   = (species < 0.5) ? predatorSensor : preySensor;

  float inputs[NN_INPUTS];
  inputs[0] = foodSensor.x;
  inputs[1] = foodSensor.y;
  inputs[2] = threatOrHunt.x;
  inputs[3] = threatOrHunt.y;
  inputs[4] = clamp(energy / uMaxEnergy, 0.0, 1.0);

  vec3  nnOut     = neuralForward(inputs, agentSlot);
  float turnAngle = nnOut.x * 1.5;
  float speed     = 0.3 + nnOut.y * 0.7;

  float cosT  = cos(turnAngle);
  float sinT  = sin(turnAngle);
  vec2  newVel = vec2(vel.x * cosT - vel.y * sinT, vel.x * sinT + vel.y * cosT);

  float len = length(newVel);
  if (len > 0.001) {
    newVel = (newVel / len) * uMoveSpeed * speed;
  } else {
    float rng   = hash(vUv + uTime);
    float angle = rng * 6.28318;
    newVel = vec2(cos(angle), sin(angle)) * uMoveSpeed * 0.5;
  }

  vec2  newPos    = mod(pos + newVel * uDeltaTime + uWorldSize, uWorldSize);
  float foodHere  = texture(uFood, newPos / uWorldSize).r;
  float energyGain = foodHere > 0.1 ? uFoodEnergyGain * uDeltaTime : 0.0;

  energy = energy - (uMoveEnergyCost * uDeltaTime) + energyGain;

  if (energy > uReproThreshold) energy -= uReproEnergyCost * uDeltaTime;

  float killDistNorm = uKillRadius / uWorldSize;
  if (species < 0.5) {
    if (predatorSensor.x < killDistNorm) { alive = 0.0; energy = 0.0; }
  } else {
    if (preySensor.x < killDistNorm) energy += uPredatorEnergyGain;
  }

  energy = clamp(energy, 0.0, uMaxEnergy);

  if (energy <= 0.0 || age > uMaxAge) { alive = 0.0; energy = 0.0; }

  outStateA = vec4(newPos, newVel);
  outStateB = vec4(energy, age, species, alive);
}
