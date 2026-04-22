/**
 * src/simulation/imbalanceDetector.ts
 *
 * ES-34 / T-4.6.1 + T-4.6.2 — Population imbalance detection
 *
 * T-4.6.1: Calculate prey/predator ratio each N ticks
 * T-4.6.2: Flag dominance events:
 *   - "Predator dominance"  if predators > 40% of population
 *   - "Prey boom"           if prey     > 90% of population
 *   - "Near extinction"     if either species < 5% of population
 */

export type ImbalanceKind =
  | 'predator_dominance'
  | 'prey_boom'
  | 'near_extinction_predator'
  | 'near_extinction_prey'
  | 'none'

export interface ImbalanceEvent {
  kind:       ImbalanceKind
  label:      string
  alertLevel: 'warn' | 'critical'
  prey:       number
  predator:   number
  alive:      number
  ratio:      number        // prey / predator (Infinity if predator === 0)
  tick:       number
}

// ── Check interval ────────────────────────────────────────────────────
// Called every animation frame from App.tsx, but only fires detection
// logic once every CHECK_EVERY ticks so we don't spam the alert banner.
const CHECK_EVERY = 10   // ticks between ratio evaluations

let ticksSinceCheck = 0

/**
 * Call this once per simulation tick.
 * Returns an ImbalanceEvent when a threshold is crossed, null otherwise.
 *
 * @param prey      current live prey count
 * @param predator  current live predator count
 * @param tick      monotonically increasing tick counter
 */
export function checkImbalance(
  prey:     number,
  predator: number,
  tick:     number,
): ImbalanceEvent | null {

  ticksSinceCheck++
  if (ticksSinceCheck < CHECK_EVERY) return null
  ticksSinceCheck = 0

  const alive = prey + predator
  if (alive === 0) return null

  const ratio = predator > 0 ? prey / predator : Infinity

  // T-4.6.2 — Predator dominance: predators > 40% of total population
  const predatorPct = predator / alive
  if (predatorPct > 0.40) {
    return {
      kind:       'predator_dominance',
      label:      `Predator dominance — ${predator} predators (${Math.round(predatorPct * 100)}% of population)`,
      alertLevel: 'warn',
      prey, predator, alive, ratio, tick,
    }
  }

  // T-4.6.2 — Prey boom: prey > 90% of total population
  const preyPct = prey / alive
  if (preyPct > 0.90) {
    return {
      kind:       'prey_boom',
      label:      `Prey boom — ${prey} prey (${Math.round(preyPct * 100)}% of population), predators critically low`,
      alertLevel: 'warn',
      prey, predator, alive, ratio, tick,
    }
  }

  // T-4.6.2 — Near extinction: either species < 5% of total population
  if (predator > 0 && predatorPct < 0.05) {
    return {
      kind:       'near_extinction_predator',
      label:      `Near extinction — only ${predator} predator${predator === 1 ? '' : 's'} remaining (<5%)`,
      alertLevel: 'critical',
      prey, predator, alive, ratio, tick,
    }
  }

  if (prey > 0 && preyPct < 0.05) {
    return {
      kind:       'near_extinction_prey',
      label:      `Near extinction — only ${prey} prey remaining (<5%)`,
      alertLevel: 'critical',
      prey, predator, alive, ratio, tick,
    }
  }

  return null
}
