/**
 * src/simulation/diseaseSimulation.ts
 *
 * ES-84 — Disease Spread Simulation (SIRSVIDE model)
 *
 * Simulates disease transmission across the agent population.
 * Runs on top of the existing agent system — reads population counts,
 * applies compartmental disease dynamics each tick.
 *
 * SIRSVIDE compartments:
 *   S — Susceptible      (healthy, can catch disease)
 *   I — Infected         (sick, contagious)
 *   R — Recovered        (temporarily immune)
 *   V — Vaccinated       (protected, partial immunity)
 *   D — Dead (disease)   (removed from population)
 *   E — Exposed          (incubating, not yet contagious)
 *
 * Transitions:
 *   S → E  (exposure: βSI/N)
 *   E → I  (incubation ends: σE)
 *   I → R  (recovery: γI)
 *   I → D  (disease death: μI)
 *   R → S  (immunity wanes: ωR)
 *   S → V  (vaccination: νS, if enabled)
 *   V → S  (vaccine wanes: φV)
 */

// ── Compartments ──────────────────────────────────────────────────────

export interface DiseaseState {
  S: number   // Susceptible
  E: number   // Exposed (incubating)
  I: number   // Infected
  R: number   // Recovered
  V: number   // Vaccinated
  D: number   // Dead (disease)
  N: number   // Total alive (S+E+I+R+V)
}

export interface DiseaseParams {
  /** Transmission rate (contacts × prob of infection per contact) */
  beta:             number
  /** Incubation rate (1/incubation_period) */
  sigma:            number
  /** Recovery rate (1/infectious_period) */
  gamma:            number
  /** Disease mortality rate */
  mu:               number
  /** Immunity waning rate (recovered → susceptible) */
  omega:            number
  /** Vaccination rate (fraction of S vaccinated per tick) */
  nu:               number
  /** Vaccine efficacy (0–1, reduces transmission) */
  vaccineEfficacy:  number
  /** Vaccine waning rate */
  phi:              number
  /** Initial infected fraction of population */
  initialInfected:  number
  /** Whether vaccination is enabled */
  vaccinationOn:    boolean
}

export const DEFAULT_DISEASE_PARAMS: DiseaseParams = {
  beta:            0.3,
  sigma:           0.2,
  gamma:           0.1,
  mu:              0.01,
  omega:           0.005,
  nu:              0.02,
  vaccineEfficacy: 0.85,
  phi:             0.002,
  initialInfected: 0.05,
  vaccinationOn:   false,
}

// ── Snapshot for history ──────────────────────────────────────────────

export interface DiseaseSnapshot {
  tick:  number
  S:     number
  E:     number
  I:     number
  R:     number
  V:     number
  D:     number
}

// ── Engine ────────────────────────────────────────────────────────────

export class DiseaseSimulation {
  private state:   DiseaseState
  private params:  DiseaseParams
  private history: DiseaseSnapshot[] = []
  private tick:    number = 0
  private active:  boolean = false

  constructor(params: Partial<DiseaseParams> = {}) {
    this.params = { ...DEFAULT_DISEASE_PARAMS, ...params }
    this.state  = { S: 0, E: 0, I: 0, R: 0, V: 0, D: 0, N: 0 }
  }

  /** Seed the disease into a population of `totalAgents`. */
  seed(totalAgents: number): void {
    const infected = Math.max(1, Math.round(totalAgents * this.params.initialInfected))
    const S = totalAgents - infected
    this.state = { S, E: 0, I: infected, R: 0, V: 0, D: 0, N: totalAgents }
    this.history = []
    this.tick    = 0
    this.active  = true
    console.log(`[Disease] Seeded: ${infected} infected out of ${totalAgents} agents`)
  }

  /** Stop/reset the disease simulation. */
  stop(): void {
    this.active = false
    this.state  = { S: 0, E: 0, I: 0, R: 0, V: 0, D: 0, N: 0 }
    this.history = []
    this.tick    = 0
  }

  get isActive(): boolean { return this.active }

  /**
   * Advance disease dynamics by one tick.
   * Call this once per second from App.tsx poll loop.
   *
   * @param currentAlive  current alive agent count from getAgentStats()
   *                      (used to scale S if agents die/are born from ecology)
   */
  update(currentAlive: number): DiseaseState {
    if (!this.active) return this.state

    const { beta, sigma, gamma, mu, omega, nu, vaccineEfficacy, phi, vaccinationOn } = this.params
    let { S, E, I, R, V, D } = this.state

    const N = S + E + I + R + V   // alive disease compartments

    if (N <= 0) {
      this.active = false
      return this.state
    }

    // ── Transitions (Euler integration, dt = 1 tick) ──────────────
    const forceOfInfection = beta * I / N

    const newExposed    = forceOfInfection * S
    const newInfected   = sigma * E
    const newRecovered  = gamma * I
    const newDeadD      = mu    * I
    const newWaned      = omega * R                               // R → S
    const newVaccinated = vaccinationOn ? nu * S : 0             // S → V
    const vaccineWane   = phi * V                                // V → S
    // Vaccinated are partially protected
    const vaccineBreak  = forceOfInfection * (1 - vaccineEfficacy) * V

    // Update compartments
    S = Math.max(0, S - newExposed - newVaccinated + newWaned + vaccineWane)
    E = Math.max(0, E + newExposed - newInfected + vaccineBreak)
    I = Math.max(0, I + newInfected - newRecovered - newDeadD)
    R = Math.max(0, R + newRecovered - newWaned)
    V = Math.max(0, V + newVaccinated - vaccineWane)
    D = D + newDeadD

    // Reconcile with ecological alive count — births replenish S
    const diseaseAlive = S + E + I + R + V
    if (currentAlive > diseaseAlive) {
      S += currentAlive - diseaseAlive   // new agents born as susceptible
    }

    this.state = { S, E, I, R, V, D, N: S + E + I + R + V }
    this.tick++

    this.history.push({ tick: this.tick, S: Math.round(S), E: Math.round(E), I: Math.round(I), R: Math.round(R), V: Math.round(V), D: Math.round(D) })

    // Cap history at 200 entries
    if (this.history.length > 200) this.history.shift()

    // Auto-stop if disease burns out
    if (I < 0.5 && E < 0.5) {
      console.log(`[Disease] Burned out at tick ${this.tick}. Total deaths: ${Math.round(D)}`)
      this.active = false
    }

    return this.state
  }

  getState():   DiseaseState      { return this.state }
  getHistory(): DiseaseSnapshot[] { return this.history }
  getParams():  DiseaseParams     { return this.params }

  updateParams(patch: Partial<DiseaseParams>): void {
    this.params = { ...this.params, ...patch }
  }

  /** Fraction of population currently infected (0–1) */
  get infectionRate(): number {
    return this.state.N > 0 ? this.state.I / this.state.N : 0
  }

  /** Alert level based on infection rate */
  get alertLevel(): 'none' | 'warn' | 'critical' {
    if (!this.active || this.state.I < 1)  return 'none'
    if (this.infectionRate > 0.3)          return 'critical'
    if (this.infectionRate > 0.1)          return 'warn'
    return 'none'
  }
}

// ── Singleton for App.tsx ─────────────────────────────────────────────
export const diseaseSimulation = new DiseaseSimulation()
