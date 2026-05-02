/**
 * src/simulation/neuroevolution.ts
 *
 * ES-69 — TensorFlow.js Neuroevolution Integration
 *
 * Wraps the existing GPU-texture neural network in a TF.js layer so that:
 *   1. The NN architecture is defined as a proper tf.LayersModel
 *   2. Mutation uses TF.js tensor ops (additive Gaussian noise)
 *   3. Weight diversity stats are computable across the population
 *   4. window.__ecoNeuro is exposed for console inspection
 *
 * The GPU ping-pong texture remains the source of truth for rendering —
 * this module provides the TF.js representation on top of it.
 */

import * as tf from '@tensorflow/tfjs'
import {
  NN_INPUTS,
  NN_HIDDEN,
  NN_OUTPUTS,
  NN_WEIGHT_FLOATS,
} from './agentState'

// ── Model factory ─────────────────────────────────────────────────────
// Builds a tf.Sequential matching the architecture in movement.frag.glsl:
//   Dense(NN_HIDDEN, tanh)  ← input→hidden
//   Dense(NN_OUTPUTS, tanh) ← hidden→output

let _protoModel: tf.Sequential | null = null

/**
 * Returns (and lazily builds) the prototype TF.js model.
 * All agents share this architecture — weights differ per agent.
 */
export function getProtoModel(): tf.Sequential {
  if (_protoModel) return _protoModel

  _protoModel = tf.sequential({ name: 'agent-nn' })

  _protoModel.add(tf.layers.dense({
    units:           NN_HIDDEN,
    activation:      'tanh',
    inputShape:      [NN_INPUTS],
    name:            'hidden',
    kernelInitializer: 'glorotUniform',
    biasInitializer:   'zeros',
  }))

  _protoModel.add(tf.layers.dense({
    units:      NN_OUTPUTS,
    activation: 'tanh',
    name:       'output',
    kernelInitializer: 'glorotUniform',
    biasInitializer:   'zeros',
  }))

  console.log('[EcoSim] Neuroevolution proto-model built')
  _protoModel.summary()

  return _protoModel
}

// ── TF.js-backed mutation ─────────────────────────────────────────────
/**
 * Mutates a weight buffer using TF.js Gaussian noise ops.
 * Equivalent to the CPU mutateWeights() in agentState.ts but uses
 * tf.add and tf.randomNormal so it's differentiable and inspectable.
 *
 * Returns a new Float32Array (does not modify the input).
 */
export function mutateWeightsTF(
  parentWeights:    Float32Array,
  mutationRate:     number,
  mutationStrength: number,
): Float32Array {
  return tf.tidy(() => {
    const parent = tf.tensor1d(parentWeights)

    // Bernoulli mask: 1 where mutation fires, 0 otherwise
    const mask  = tf.less(tf.randomUniform([NN_WEIGHT_FLOATS]), mutationRate)
                    .cast('float32')

    // Gaussian noise scaled by mutationStrength
    const noise = tf.randomNormal([NN_WEIGHT_FLOATS], 0, mutationStrength)

    // child = parent + mask * noise
    const child = tf.add(parent, tf.mul(mask, noise))

    // Clamp to [-3, 3] to keep weights stable
    return tf.clipByValue(child, -3, 3).dataSync() as Float32Array
  })
}

// ── Population weight stats ───────────────────────────────────────────
export interface NeuroStats {
  meanWeight:   number   // average weight value across all agents
  weightStdDev: number   // std deviation — proxy for population diversity
  maxWeight:    number
  minWeight:    number
  agentCount:   number
}

/**
 * Compute weight diversity stats across the agent population.
 * Pass the flat weight texture data (readback from the GPU buffer).
 *
 * @param weightData  Float32Array from readBackData(gl, weightBuffer)
 * @param agentCount  number of alive agents
 */
export function computeNeuroStats(
  weightData: Float32Array,
  agentCount: number,
): NeuroStats {
  if (agentCount === 0 || weightData.length === 0) {
    return { meanWeight: 0, weightStdDev: 0, maxWeight: 0, minWeight: 0, agentCount: 0 }
  }

  return tf.tidy(() => {
    // Each agent occupies NN_WEIGHT_FLOATS floats in the texture
    // (packed as RGBA pixels, so stride = 4; we only use the relevant floats)
    const relevant = weightData.slice(0, agentCount * NN_WEIGHT_FLOATS)
    const t = tf.tensor1d(relevant)

    const mean   = t.mean().dataSync()[0]
    const stdDev = t.sub(mean).square().mean().sqrt().dataSync()[0]
    const max    = t.max().dataSync()[0]
    const min    = t.min().dataSync()[0]

    return { meanWeight: mean, weightStdDev: stdDev, maxWeight: max, minWeight: min, agentCount }
  })
}

// ── Re-export agentState mutation for callers that want either ─────────
export { mutateWeights } from './agentState'

// ── SimParams-aware forward pass (for testing outside the GPU) ────────
/**
 * Run a single agent's neural network forward pass in TF.js.
 * Useful for unit tests and the console inspector.
 *
 * @param inputs     Float32Array of length NN_INPUTS (already normalised 0–1)
 * @param weights    Float32Array of length NN_WEIGHT_FLOATS for this agent
 * @returns          Float32Array [turnAngle, speed, reproduceSignal] (tanh output)
 */
export function forwardPass(
  inputs:  Float32Array,
  weights: Float32Array,
): Float32Array {
  return tf.tidy(() => {
    const model = getProtoModel()

    // Manually set weights into the model layers
    const hiddenKernel = weights.slice(0, NN_INPUTS * NN_HIDDEN)
    const hiddenBias   = weights.slice(NN_INPUTS * NN_HIDDEN, NN_INPUTS * NN_HIDDEN + NN_HIDDEN)
    const outputKernel = weights.slice(NN_INPUTS * NN_HIDDEN + NN_HIDDEN,
                                       NN_INPUTS * NN_HIDDEN + NN_HIDDEN + NN_HIDDEN * NN_OUTPUTS)
    const outputBias   = weights.slice(NN_INPUTS * NN_HIDDEN + NN_HIDDEN + NN_HIDDEN * NN_OUTPUTS)

    model.layers[0].setWeights([
      tf.tensor2d(hiddenKernel, [NN_INPUTS, NN_HIDDEN]),
      tf.tensor1d(hiddenBias),
    ])
    model.layers[1].setWeights([
      tf.tensor2d(outputKernel, [NN_HIDDEN, NN_OUTPUTS]),
      tf.tensor1d(outputBias),
    ])

    const input  = tf.tensor2d(inputs, [1, NN_INPUTS])
    const output = model.predict(input) as tf.Tensor

    return output.dataSync() as Float32Array
  })
}

// ── Browser console API ───────────────────────────────────────────────
export interface EcoNeuro {
  /** The prototype TF.js model (shared architecture) */
  model:           () => tf.Sequential
  /** Mutate a weight array using TF.js ops */
  mutate:          (weights: Float32Array, rate?: number, strength?: number) => Float32Array
  /** Run a forward pass for given inputs + weights */
  forward:         (inputs: Float32Array, weights: Float32Array) => Float32Array
  /** Print population diversity stats to console */
  stats:           (weightData: Float32Array, agentCount: number) => NeuroStats
  /** TF.js memory info */
  tfMemory:        () => tf.MemoryInfo
}

export const ecoNeuro: EcoNeuro = {
  model:    () => getProtoModel(),
  mutate:   (w, rate = 0.05, strength = 0.2) => mutateWeightsTF(w, rate, strength),
  forward:  (inputs, weights) => forwardPass(inputs, weights),
  stats:    (weightData, agentCount) => computeNeuroStats(weightData, agentCount),
  tfMemory: () => tf.memory(),
}
