/**
 * scripts/lstm/generate.cjs
 * Run: node scripts/lstm/generate.cjs  (from EcoSim root)
 */

const fs   = require('fs')
const path = require('path')

// Use process.cwd() instead of __dirname — always resolves to where you ran the command from
const OUT_DIR  = path.join(process.cwd(), 'scripts', 'lstm', 'data')
const OUT_FILE = path.join(OUT_DIR, 'training_data.json')

const BASE_PARAMS = { alpha: 0.1, beta: 0.02, gamma: 0.3, delta: 0.01 }
const SEQ_LEN  = 30
const HORIZON  = 40
const N_TRAJ   = 800
const TRAJ_LEN = 300
const DT       = 0.5
const COLLAPSE_THRESH = 5.0
const POP_MAX  = 200.0

function rk4Step(prey, pred, p, dt) {
  const dX = (x, y) => p.alpha * x - p.beta  * x * y
  const dY = (x, y) => p.delta * x * y - p.gamma * y
  const k1x = dX(prey, pred),          k1y = dY(prey, pred)
  const k2x = dX(prey+dt/2*k1x, pred+dt/2*k1y), k2y = dY(prey+dt/2*k1x, pred+dt/2*k1y)
  const k3x = dX(prey+dt/2*k2x, pred+dt/2*k2y), k3y = dY(prey+dt/2*k2x, pred+dt/2*k2y)
  const k4x = dX(prey+dt*k3x,   pred+dt*k3y),   k4y = dY(prey+dt*k3x,   pred+dt*k3y)
  return [
    Math.max(0, prey + dt/6*(k1x+2*k2x+2*k3x+k4x)),
    Math.max(0, pred + dt/6*(k1y+2*k2y+2*k3y+k4y)),
  ]
}

function simulate(initPrey, initPred, params) {
  const traj = [{ prey: initPrey, pred: initPred }]
  let prey = initPrey, pred = initPred
  for (let t = 1; t < TRAJ_LEN; t++) {
    ;[prey, pred] = rk4Step(prey, pred, params, DT)
    traj.push({ prey, pred })
  }
  return traj
}

function collapsed(traj, from, horizon) {
  for (let i = from; i < Math.min(from + horizon, traj.length); i++)
    if (traj[i].prey < COLLAPSE_THRESH || traj[i].pred < COLLAPSE_THRESH) return true
  return false
}

function shuffle(arr) { return arr.sort(() => Math.random() - 0.5) }

const sequences = [], labels = []

for (let i = 0; i < N_TRAJ; i++) {
  const params = {
    alpha: BASE_PARAMS.alpha * (0.7 + Math.random() * 0.6),
    beta:  BASE_PARAMS.beta  * (0.7 + Math.random() * 0.6),
    gamma: BASE_PARAMS.gamma * (0.7 + Math.random() * 0.6),
    delta: BASE_PARAMS.delta * (0.7 + Math.random() * 0.6),
  }
  const traj = simulate(20 + Math.random()*80, 5 + Math.random()*20, params)
  for (let t = SEQ_LEN; t < TRAJ_LEN - HORIZON; t += 3) {
    const seq = []
    for (let s = t - SEQ_LEN; s < t; s++) {
      seq.push([
        Math.min(traj[s].prey  / POP_MAX, 1.0),
        Math.min(traj[s].pred  / POP_MAX, 1.0),
        traj[s].pred > 0 ? Math.min(traj[s].prey / traj[s].pred / 10, 1.0) : 1.0,
      ])
    }
    sequences.push(seq)
    labels.push(collapsed(traj, t, HORIZON) ? 1 : 0)
  }
}

const posIdx = labels.map((l,i) => l===1 ? i : -1).filter(i => i>=0)
const negIdx = labels.map((l,i) => l===0 ? i : -1).filter(i => i>=0)
const min    = Math.min(posIdx.length, negIdx.length)
const idx    = shuffle([...shuffle(posIdx).slice(0,min), ...shuffle(negIdx).slice(0,min)])

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify({
  sequences: idx.map(i => sequences[i]),
  labels:    idx.map(i => labels[i]),
  seqLen: SEQ_LEN,
  features: 3,
}))

console.log(`Generated ${idx.length} balanced samples (${min} collapse, ${min} stable)`)
console.log(`Wrote ${OUT_FILE}`)
