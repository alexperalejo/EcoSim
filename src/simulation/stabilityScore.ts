/**
 * src/simulation/stabilityScore.ts
 *
 * ES-74 / ES-89 / ES-32: Heuristic ecosystem stability score
 *
 * ── ES-70 HANDOFF ───────────────────────────────────────────────────
 * When DS finishes the LSTM, replace the body of computeStability()
 * with a call to the LSTM model. Everything in App.tsx stays the same.
 * ────────────────────────────────────────────────────────────────────
 */

export interface StabilityResult {
  score:      number
  label:      string
  alert:      string
  alertLevel: 'none' | 'warn' | 'critical'
}

interface PopSnapshot {
  prey:     number
  predator: number
  alive:    number
}

const TREND_WINDOW = 20

function scoreRatio(prey: number, predator: number): number {
  if (prey === 0 && predator === 0) return 0
  if (predator === 0) return prey > 0 ? 0.2 : 0
  const ratio = prey / predator
  if (ratio <= 0)  return 0
  if (ratio < 1)   return ratio * 0.3
  if (ratio <= 4)  return 0.5 + (ratio - 1) / 3 * 0.5
  if (ratio <= 8)  return 1.0 - (ratio - 4) / 4 * 0.5
  if (ratio <= 15) return 0.5 - (ratio - 8) / 7 * 0.4
  return Math.max(0, 0.1 - (ratio - 15) / 20)
}

function scoreTrend(history: PopSnapshot[]): number {
  if (history.length < 2) return 0.5
  const window  = history.slice(-TREND_WINDOW)
  const first   = window[0].alive
  const last    = window[window.length - 1].alive
  if (first === 0) return last > 0 ? 0.5 : 0
  const change = (last - first) / first
  if (change >  0.2)  return 1.0
  if (change >  0.05) return 0.85
  if (change > -0.05) return 0.7
  if (change > -0.2)  return 0.45
  if (change > -0.5)  return 0.2
  return 0.05
}

function scoreEnergy(avgEnergy: number, maxEnergy = 100): number {
  return Math.min(avgEnergy / maxEnergy, 1.0)
}

function buildAlert(
  score:     number,
  prey:      number,
  predator:  number,
  history:   PopSnapshot[],
  avgEnergy: number,
): { alert: string; alertLevel: StabilityResult['alertLevel'] } {

  if (score >= 0.7) return { alert: '', alertLevel: 'none' }

  const ratio      = predator > 0 ? prey / predator : Infinity
  const window     = history.slice(-TREND_WINDOW)
  const trendAlive = window.length >= 2
    ? window[window.length - 1].alive - window[0].alive
    : 0

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
  if (trendAlive < -30)
    return { alert: `Population declining fast — lost ${Math.abs(trendAlive)} agents recently`, alertLevel: 'warn' }
  if (avgEnergy < 25)
    return { alert: 'Food scarcity — avg energy critically low, starvation risk', alertLevel: 'warn' }

  return { alert: 'Population imbalance — ecosystem under stress', alertLevel: 'warn' }
}

export function computeStability(
  prey:      number,
  predator:  number,
  avgEnergy: number,
  history:   PopSnapshot[],
): StabilityResult {

  const rScore = scoreRatio(prey, predator)
  const tScore = scoreTrend(history)
  const eScore = scoreEnergy(avgEnergy)

  const score = rScore * 0.45 + tScore * 0.35 + eScore * 0.2

  const label =
    score >= 0.80 ? 'Thriving'  :
    score >= 0.60 ? 'Stable'    :
    score >= 0.40 ? 'Fragile'   :
    score >= 0.20 ? 'Unstable'  :
                    'Critical'

  const { alert, alertLevel } = buildAlert(score, prey, predator, history, avgEnergy)

  return { score, label, alert, alertLevel }
}