/**
 * scripts/lstm/validate.cjs
 *
 * ES-29 / T-4.1.5 — Validate LSTM on held-out collapse scenarios
 *
 * Generates a fresh test set (never seen during training) using the same
 * Lotka-Volterra ODE system as generate.js, but with:
 *   - different random seeds / initial conditions
 *   - five hand-crafted "stress" scenarios that force collapse
 *
 * Metrics reported:
 *   - Overall accuracy, precision, recall, F1
 *   - Per-scenario breakdown (collapse vs stable)
 *   - Confusion matrix
 *
 * Run from EcoSim root:
 *   node scripts/lstm/validate.js
 *
 * Requires the trained model at scripts/lstm/data/model/model.json
 */

const fs   = require('fs')
const path = require('path')

const tf = require('@tensorflow/tfjs')
try {
  require('@tensorflow/tfjs-node')
  console.log('Using tfjs-node backend\n')
} catch {
  console.log('Using JS backend (slower)\n')
}

// ── Constants (must match generate.js / lstmForecaster.ts) ──────────
const SEQ_LEN        = 30
const HORIZON        = 40
const TRAJ_LEN       = 300
const DT             = 0.5
const POP_MAX        = 200.0
const COLLAPSE_THRESH = 5.0
const MODEL_PATH     = path.join(__dirname, 'data/model/model.json')

// ── ODE ─────────────────────────────────────────────────────────────
function rk4Step(prey, pred, { alpha, beta, gamma, delta }, dt) {
  const dPrey = (x, y) => alpha * x - beta  * x * y
  const dPred = (x, y) => delta * x * y - gamma * y

  const k1x = dPrey(prey, pred),       k1y = dPred(prey, pred)
  const k2x = dPrey(prey + dt/2*k1x, pred + dt/2*k1y)
  const k2y = dPred(prey + dt/2*k1x, pred + dt/2*k1y)
  const k3x = dPrey(prey + dt/2*k2x, pred + dt/2*k2y)
  const k3y = dPred(prey + dt/2*k2x, pred + dt/2*k2y)
  const k4x = dPrey(prey + dt*k3x,   pred + dt*k3y)
  const k4y = dPred(prey + dt*k3x,   pred + dt*k3y)

  return [
    Math.max(0, prey + dt/6 * (k1x + 2*k2x + 2*k3x + k4x)),
    Math.max(0, pred + dt/6 * (k1y + 2*k2y + 2*k3y + k4y)),
  ]
}

function simulate(initPrey, initPred, params) {
  const traj = [{ prey: initPrey, pred: initPred }]
  let [prey, pred] = [initPrey, initPred]
  for (let t = 1; t < TRAJ_LEN; t++) {
    ;[prey, pred] = rk4Step(prey, pred, params, DT)
    traj.push({ prey, pred })
  }
  return traj
}

function isCollapsed(traj, fromIdx, horizon) {
  const end = Math.min(fromIdx + horizon, traj.length)
  for (let i = fromIdx; i < end; i++) {
    if (traj[i].prey < COLLAPSE_THRESH || traj[i].pred < COLLAPSE_THRESH) return true
  }
  return false
}

function makeSequence(traj, from) {
  const seq = []
  for (let s = from - SEQ_LEN; s < from; s++) {
    const { prey, pred } = traj[s]
    seq.push([
      Math.min(prey / POP_MAX, 1.0),
      Math.min(pred / POP_MAX, 1.0),
      pred > 0 ? Math.min((prey / pred) / 10, 1.0) : 1.0,
    ])
  }
  return seq
}

// ── Hand-crafted stress scenarios ────────────────────────────────────
// Each returns { label, sequences[] } where label is the expected collapse value
function stressScenarios() {
  const scenarios = []

  // 1. Predator overshoot — very high predation rate → prey extinction
  const overHunt = simulate(60, 8, { alpha: 0.12, beta: 0.06, gamma: 0.25, delta: 0.015 })
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 5) {
    scenarios.push({ seq: makeSequence(overHunt, t), label: isCollapsed(overHunt, t, HORIZON) ? 1 : 0, scenario: 'Predator overshoot' })
  }

  // 2. Prey boom / predator crash — low predation → predator starvation
  const preyBoom = simulate(80, 3, { alpha: 0.15, beta: 0.005, gamma: 0.35, delta: 0.005 })
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 5) {
    scenarios.push({ seq: makeSequence(preyBoom, t), label: isCollapsed(preyBoom, t, HORIZON) ? 1 : 0, scenario: 'Prey boom' })
  }

  // 3. Near-balanced stable — should NOT collapse
  const stable = simulate(50, 12, { alpha: 0.1, beta: 0.02, gamma: 0.3, delta: 0.01 })
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 5) {
    scenarios.push({ seq: makeSequence(stable, t), label: isCollapsed(stable, t, HORIZON) ? 1 : 0, scenario: 'Balanced stable' })
  }

  // 4. Both populations tiny — fragile, collapse likely
  const fragile = simulate(8, 4, { alpha: 0.1, beta: 0.025, gamma: 0.3, delta: 0.012 })
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 5) {
    scenarios.push({ seq: makeSequence(fragile, t), label: isCollapsed(fragile, t, HORIZON) ? 1 : 0, scenario: 'Both populations tiny' })
  }

  // 5. Rapid oscillation — high energy system, often stable
  const rapid = simulate(40, 15, { alpha: 0.2, beta: 0.03, gamma: 0.4, delta: 0.015 })
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 5) {
    scenarios.push({ seq: makeSequence(rapid, t), label: isCollapsed(rapid, t, HORIZON) ? 1 : 0, scenario: 'Rapid oscillation' })
  }

  return scenarios
}

// ── Random held-out test set ─────────────────────────────────────────
function randomHeldOutSet(n = 300) {
  // Use different random seed range than generate.js (initPrey 100–180)
  const samples = []
  for (let i = 0; i < n; i++) {
    const initPrey = 100 + Math.random() * 80
    const initPred = 2   + Math.random() * 10
    const params = {
      alpha: 0.08 + Math.random() * 0.08,
      beta:  0.01 + Math.random() * 0.03,
      gamma: 0.2  + Math.random() * 0.3,
      delta: 0.005 + Math.random() * 0.015,
    }
    const traj = simulate(initPrey, initPred, params)
    // Pick one window from the second half of the trajectory
    const t = SEQ_LEN + Math.floor(Math.random() * (TRAJ_LEN / 2 - HORIZON - SEQ_LEN))
    samples.push({
      seq:      makeSequence(traj, t),
      label:    isCollapsed(traj, t, HORIZON) ? 1 : 0,
      scenario: 'Random held-out',
    })
  }
  return samples
}

// ── Metrics ──────────────────────────────────────────────────────────
function computeMetrics(preds, labels, threshold = 0.5) {
  let tp = 0, tn = 0, fp = 0, fn = 0
  for (let i = 0; i < preds.length; i++) {
    const pred = preds[i] >= threshold ? 1 : 0
    const actual = labels[i]
    if (pred === 1 && actual === 1) tp++
    else if (pred === 0 && actual === 0) tn++
    else if (pred === 1 && actual === 0) fp++
    else fn++
  }
  const accuracy  = (tp + tn) / preds.length
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
  return { accuracy, precision, recall, f1, tp, tn, fp, fn }
}

// ── Main ─────────────────────────────────────────────────────────────
async function validate() {
  console.log('═══════════════════════════════════════════')
  console.log('  EcoSim LSTM Validation  (T-4.1.5)')
  console.log('═══════════════════════════════════════════\n')

  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`Model not found at ${MODEL_PATH}`)
    console.error('Run: node scripts/lstm/generate.js && node scripts/lstm/train.js first')
    process.exit(1)
  }

  console.log(`Loading model from ${MODEL_PATH}...`)
  const modelJSON   = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'))
  const weightsPath = path.join(path.dirname(MODEL_PATH), 'weights.bin')
  const weightsBuf  = fs.readFileSync(weightsPath)
  const artifacts   = {
    modelTopology: modelJSON.modelTopology,
    weightSpecs:   modelJSON.weightsManifest[0].weights,
    weightData:    weightsBuf.buffer.slice(weightsBuf.byteOffset, weightsBuf.byteOffset + weightsBuf.byteLength),
    format:        modelJSON.format,
  }
  const model = await tf.loadLayersModel(tf.io.fromMemory(artifacts))
  console.log('Model loaded.\n')

  // Build test set: stress scenarios + random held-out
  const stress    = stressScenarios()
  const heldOut   = randomHeldOutSet(300)
  const allSamples = [...stress, ...heldOut]

  console.log(`Test set: ${stress.length} stress samples + ${heldOut.length} random held-out = ${allSamples.length} total\n`)

  // Run inference in one batch
  const inputData = new Float32Array(allSamples.length * SEQ_LEN * 3)
  for (let i = 0; i < allSamples.length; i++) {
    for (let t = 0; t < SEQ_LEN; t++) {
      for (let f = 0; f < 3; f++) {
        inputData[i * SEQ_LEN * 3 + t * 3 + f] = allSamples[i].seq[t][f]
      }
    }
  }

  const predictions = tf.tidy(() => {
    const input = tf.tensor3d(inputData, [allSamples.length, SEQ_LEN, 3])
    return (model.predict(input)).dataSync()
  })

  const trueLabels = allSamples.map(s => s.label)

  // ── Overall metrics ──────────────────────────────────────────
  const overall = computeMetrics(Array.from(predictions), trueLabels)

  console.log('── Overall Metrics ────────────────────────')
  console.log(`  Accuracy:  ${(overall.accuracy  * 100).toFixed(1)}%`)
  console.log(`  Precision: ${(overall.precision * 100).toFixed(1)}%  (of predicted collapses, how many were real)`)
  console.log(`  Recall:    ${(overall.recall    * 100).toFixed(1)}%  (of real collapses, how many were caught)`)
  console.log(`  F1 Score:  ${(overall.f1        * 100).toFixed(1)}%`)
  console.log(`\n  Confusion Matrix:`)
  console.log(`    TP=${overall.tp}  FP=${overall.fp}`)
  console.log(`    FN=${overall.fn}  TN=${overall.tn}\n`)

  // ── Per-scenario breakdown ───────────────────────────────────
  const scenarioNames = [...new Set(allSamples.map(s => s.scenario))]
  console.log('── Per-Scenario Breakdown ─────────────────')

  for (const name of scenarioNames) {
    const indices = allSamples.map((s, i) => s.scenario === name ? i : -1).filter(i => i >= 0)
    const scenPreds  = indices.map(i => predictions[i])
    const scenLabels = indices.map(i => trueLabels[i])
    const collapseCount = scenLabels.filter(l => l === 1).length
    const m = computeMetrics(scenPreds, scenLabels)
    console.log(`  ${name.padEnd(25)}  n=${String(indices.length).padStart(3)}  collapse=${collapseCount}  acc=${(m.accuracy*100).toFixed(0)}%  recall=${(m.recall*100).toFixed(0)}%`)
  }

  // ── Sprint gate ──────────────────────────────────────────────
  console.log('\n── Sprint 3 Gate (T-4.1.5) ────────────────')
  const ACCURACY_TARGET = 0.75
  const RECALL_TARGET   = 0.70  // catching real collapses is more important than precision
  const pass = overall.accuracy >= ACCURACY_TARGET && overall.recall >= RECALL_TARGET

  console.log(`  Accuracy  ≥ ${(ACCURACY_TARGET*100).toFixed(0)}%:  ${overall.accuracy >= ACCURACY_TARGET ? '✅' : '❌'} (${(overall.accuracy*100).toFixed(1)}%)`)
  console.log(`  Recall    ≥ ${(RECALL_TARGET*100).toFixed(0)}%:  ${overall.recall    >= RECALL_TARGET   ? '✅' : '❌'} (${(overall.recall*100).toFixed(1)}%)`)
  console.log(`\n  ${pass ? '✅ PASS — LSTM meets held-out validation targets.' : '❌ FAIL — retrain with more data or tune hyperparameters.'}`)
  console.log('═══════════════════════════════════════════')

  process.exit(pass ? 0 : 1)
}

validate().catch(err => { console.error(err); process.exit(1) })
