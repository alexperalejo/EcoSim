/**
 * scripts/lstm/generate.js
 *
 * Generates synthetic prey/predator time series using the
 * Lotka-Volterra (predator-prey) ODE system.
 *
 * dPrey/dt     =  α*prey     - β*prey*predator
 * dPredator/dt = -γ*predator + δ*prey*predator
 *
 * Produces sequences labelled with a "collapse" flag:
 *   0 = ecosystem stable
 *   1 = collapse within the next HORIZON steps
 *
 * Output: data/training_data.json
 */

const fs = require('fs')
const path = require('path')

// ── ODE parameters (varied per trajectory for diversity) ──────────────
const BASE_PARAMS = {
  alpha: 0.1,   // prey birth rate
  beta:  0.02,  // predation rate
  gamma: 0.3,   // predator death rate
  delta: 0.01,  // predator birth rate from eating
}

const SEQ_LEN   = 30    // lookback window fed to LSTM
const HORIZON   = 40    // ticks ahead to predict collapse
const N_TRAJ    = 800   // number of trajectories to simulate
const TRAJ_LEN  = 300   // length of each trajectory (ticks)
const DT        = 0.5   // ODE integration step

// Collapse = either species drops below this threshold
const COLLAPSE_THRESH = 5.0
// Max population for normalisation
const POP_MAX = 200.0

function rk4Step(prey, pred, params, dt) {
  const { alpha, beta, gamma, delta } = params

  function dPrey(x, y)  { return alpha * x - beta  * x * y }
  function dPred(x, y)  { return delta * x * y - gamma * y }

  const k1x = dPrey(prey, pred)
  const k1y = dPred(prey, pred)

  const k2x = dPrey(prey + dt/2 * k1x, pred + dt/2 * k1y)
  const k2y = dPred(prey + dt/2 * k1x, pred + dt/2 * k1y)

  const k3x = dPrey(prey + dt/2 * k2x, pred + dt/2 * k2y)
  const k3y = dPred(prey + dt/2 * k2x, pred + dt/2 * k2y)

  const k4x = dPrey(prey + dt * k3x, pred + dt * k3y)
  const k4y = dPred(prey + dt * k3x, pred + dt * k3y)

  return [
    Math.max(0, prey + dt/6 * (k1x + 2*k2x + 2*k3x + k4x)),
    Math.max(0, pred + dt/6 * (k1y + 2*k2y + 2*k3y + k4y)),
  ]
}

function simulateTrajectory(initPrey, initPred, params) {
  const trajectory = [{ prey: initPrey, pred: initPred }]
  let prey = initPrey, pred = initPred

  for (let t = 1; t < TRAJ_LEN; t++) {
    ;[prey, pred] = rk4Step(prey, pred, params, DT)
    trajectory.push({ prey, pred })
  }
  return trajectory
}

function isCollapsed(traj, fromIdx, horizon) {
  const end = Math.min(fromIdx + horizon, traj.length)
  for (let i = fromIdx; i < end; i++) {
    if (traj[i].prey < COLLAPSE_THRESH || traj[i].pred < COLLAPSE_THRESH) return true
  }
  return false
}

function normalise(v, max) { return Math.min(v / max, 1.0) }

// ── Generate dataset ──────────────────────────────────────────────────

const sequences = []
const labels    = []

for (let i = 0; i < N_TRAJ; i++) {
  // Randomise initial conditions and params slightly per trajectory
  const initPrey = 20 + Math.random() * 80
  const initPred = 5  + Math.random() * 20
  const params   = {
    alpha: BASE_PARAMS.alpha * (0.7 + Math.random() * 0.6),
    beta:  BASE_PARAMS.beta  * (0.7 + Math.random() * 0.6),
    gamma: BASE_PARAMS.gamma * (0.7 + Math.random() * 0.6),
    delta: BASE_PARAMS.delta * (0.7 + Math.random() * 0.6),
  }

  const traj = simulateTrajectory(initPrey, initPred, params)

  // Slide a window of SEQ_LEN across the trajectory
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 3) {
    const seq = []
    for (let s = t - SEQ_LEN; s < t; s++) {
      seq.push([
        normalise(traj[s].prey, POP_MAX),
        normalise(traj[s].pred, POP_MAX),
        traj[s].pred > 0 ? Math.min(traj[s].prey / traj[s].pred / 10, 1.0) : 1.0,
      ])
    }
    const label = isCollapsed(traj, t, HORIZON) ? 1 : 0
    sequences.push(seq)
    labels.push(label)
  }
}

// Balance classes (collapse is rarer)
const posIdx = labels.map((l,i) => l === 1 ? i : -1).filter(i => i >= 0)
const negIdx = labels.map((l,i) => l === 0 ? i : -1).filter(i => i >= 0)
const minCount = Math.min(posIdx.length, negIdx.length)

// Shuffle and truncate to balanced set
function shuffle(arr) { return arr.sort(() => Math.random() - 0.5) }
const balancedIdx = [...shuffle(posIdx).slice(0, minCount), ...shuffle(negIdx).slice(0, minCount)]
shuffle(balancedIdx)

const balancedSeqs   = balancedIdx.map(i => sequences[i])
const balancedLabels = balancedIdx.map(i => labels[i])

console.log(`Generated ${balancedSeqs.length} balanced samples (${minCount} collapse, ${minCount} stable)`)
console.log(`Sequence shape: [${SEQ_LEN}, 3]`)

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })
fs.writeFileSync(
  path.join(__dirname, 'data/training_data.json'),
  JSON.stringify({ sequences: balancedSeqs, labels: balancedLabels, seqLen: SEQ_LEN, features: 3 })
)
console.log('Wrote data/training_data.json')