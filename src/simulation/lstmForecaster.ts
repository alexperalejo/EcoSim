/**
 * src/simulation/lstmForecaster.ts
 * ES-70: LSTM Ecosystem Collapse Forecaster
 */

import * as tf from '@tensorflow/tfjs'
import type { StabilityResult } from './stabilityScore'

const SEQ_LEN   = 30
const POP_MAX   = 200.0
const MODEL_URL = '/lstm-model/model.json'

let model: tf.LayersModel | null = null
let loadError = false

export async function loadLSTMModel(): Promise<void> {
  if (model || loadError) return
  try {
    model = await tf.loadLayersModel(MODEL_URL)
    console.log('[EcoSim] LSTM model loaded:', MODEL_URL)
  } catch (e) {
    loadError = true
    console.warn('[EcoSim] LSTM model failed to load, falling back to heuristic:', e)
  }
}

loadLSTMModel()

// ── Heuristic score (always runs, keeps LSTM honest) ──────────────────

function heuristicScore(prey: number, predator: number, avgEnergy: number): number {
  const ratio = predator > 0 ? prey / predator : 0

  const rScore = ratio <= 0  ? 0
               : ratio < 1   ? ratio * 0.3
               : ratio <= 4  ? 0.5 + (ratio - 1) / 3 * 0.5
               : ratio <= 8  ? 1.0 - (ratio - 4) / 4 * 0.5
               : ratio <= 15 ? 0.5 - (ratio - 8) / 7 * 0.4
               : Math.max(0, 0.1 - (ratio - 15) / 20)

  const eScore = Math.min(avgEnergy / 100, 1.0)

  // Also penalise very low absolute predator counts
  const predatorPenalty = predator < 10 ? predator / 10
                        : predator < 30 ? 0.5 + (predator - 10) / 40
                        : 1.0

  return (rScore * 0.5 + eScore * 0.3 + predatorPenalty * 0.2)
}

// ── Alert builder ─────────────────────────────────────────────────────

function buildAlert(
  score:     number,
  prey:      number,
  predator:  number,
  avgEnergy: number,
): { alert: string; alertLevel: StabilityResult['alertLevel'] } {

  if (score >= 0.7) return { alert: '', alertLevel: 'none' }

  const ratio = predator > 0 ? prey / predator : Infinity

  if (predator === 0 && prey > 20)
    return { alert: 'Predator extinction — prey population unchecked', alertLevel: 'critical' }
  if (prey === 0)
    return { alert: 'Prey extinct — predators will starve within ~30 ticks', alertLevel: 'critical' }
  if (score < 0.2)
    return { alert: 'Ecosystem collapse imminent — intervention needed', alertLevel: 'critical' }
  if (ratio < 1.5)
    return { alert: `Predator surge — prey outnumbered ${predator}:${prey}, crash likely`, alertLevel: 'warn' }
  if (ratio > 8)
    return { alert: `Herbivore boom — predator population critically low (${predator})`, alertLevel: 'warn' }
  if (avgEnergy < 25)
    return { alert: 'Food scarcity — avg energy critically low, starvation risk', alertLevel: 'warn' }

  return { alert: 'Population imbalance — ecosystem under stress', alertLevel: 'warn' }
}

// ── Types ─────────────────────────────────────────────────────────────

interface PopSnapshot {
  prey:     number
  predator: number
  alive:    number
}

// ── Main export ───────────────────────────────────────────────────────

export function computeStability(
  prey:      number,
  predator:  number,
  avgEnergy: number,
  history:   PopSnapshot[],
): StabilityResult {

  const hScore = heuristicScore(prey, predator, avgEnergy)

  let score: number

  if (model && history.length >= SEQ_LEN) {
    const window     = history.slice(-SEQ_LEN)
    const inputData  = new Float32Array(SEQ_LEN * 3)

    for (let t = 0; t < SEQ_LEN; t++) {
      const snap = window[t]
      inputData[t * 3 + 0] = Math.min(snap.prey     / POP_MAX, 1.0)
      inputData[t * 3 + 1] = Math.min(snap.predator / POP_MAX, 1.0)
      inputData[t * 3 + 2] = snap.predator > 0
        ? Math.min((snap.prey / snap.predator) / 10, 1.0)
        : 1.0
    }

    const pCollapse = tf.tidy(() => {
      const input  = tf.tensor3d(inputData, [1, SEQ_LEN, 3])
      const output = model!.predict(input) as tf.Tensor
      return output.dataSync()[0]
    })

    const lstmScore = 1.0 - pCollapse

    // Blend: 50% LSTM + 50% heuristic
    // This prevents the LSTM from reporting 100% when the heuristic sees danger
    score = lstmScore * 0.5 + hScore * 0.5

  } else {
    score = hScore
  }

  score = Math.max(0, Math.min(1, score))

  const label =
    score >= 0.80 ? 'Thriving'  :
    score >= 0.60 ? 'Stable'    :
    score >= 0.40 ? 'Fragile'   :
    score >= 0.20 ? 'Unstable'  :
                    'Critical'

  const { alert, alertLevel } = buildAlert(score, prey, predator, avgEnergy)

  return { score, label, alert, alertLevel }
}