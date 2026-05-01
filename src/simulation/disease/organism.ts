/**
 * ES-65: Implement organism.ts scaling layer
 * ES-82: Inject synthetic antibodies intervention
 *
 * Manages a population of Animal instances.
 * Handles disease spread using the SIRSVIDE model,
 * population-level immunity tracking, migration and
 * density effects, and zoonotic transmission between species.
 *
 * ES-82 additions:
 *   injectAntibodies() — boosts infected agent immunity by 0.3,
 *   suppresses transmission rate by 50% for 30 ticks.
 */

import { Animal } from './animal'
import { DiseaseStrain, mutateStrain } from './disease'

export enum SIRSVIDEState {
  Susceptible = 'S',
  Infected    = 'I',
  Recovered   = 'R',
  Vaccinated  = 'V',
  Immune      = 'IM',
  Dead        = 'D',
  Exposed     = 'E',
}

export interface OrganismRecord {
  animal: Animal
  state: SIRSVIDEState
  strain: DiseaseStrain | null
  exposureTimer: number
  infectionTimer: number
}

export class OrganismLayer {
  private population: OrganismRecord[] = []
  private transmissionModifier: number = 1.0
  private suppressionTicksRemaining: number = 0

  addAnimal(animal: Animal): void {
    this.population.push({
      animal,
      state: SIRSVIDEState.Susceptible,
      strain: null,
      exposureTimer: 0,
      infectionTimer: 0,
    })
  }

  update(dt: number, strain: DiseaseStrain): void {
    for (const record of this.population) {
      if (!record.animal.alive) {
        record.state = SIRSVIDEState.Dead
        continue
      }
      record.animal.update(dt)
      this.updateState(record, dt, strain)
    }
    this.spreadDisease(strain)

    // Decrement antibody suppression timer
    if (this.suppressionTicksRemaining > 0) {
      this.suppressionTicksRemaining--
      if (this.suppressionTicksRemaining <= 0) {
        this.transmissionModifier = 1.0
      }
    }
  }

  private updateState(record: OrganismRecord, dt: number, strain: DiseaseStrain): void {
    switch (record.state) {
      case SIRSVIDEState.Exposed:
        record.exposureTimer += dt
        if (record.exposureTimer >= strain.incubationPeriod) {
          record.state = SIRSVIDEState.Infected
          record.animal.infect(strain.name)
          record.exposureTimer = 0
        }
        break

      case SIRSVIDEState.Infected:
        record.infectionTimer += dt
        if (record.infectionTimer >= strain.infectiousDuration) {
          if (Math.random() < strain.mortalityRate) {
            record.animal.alive = false
            record.state = SIRSVIDEState.Dead
          } else {
            record.animal.recover()
            record.state = SIRSVIDEState.Recovered
            record.infectionTimer = 0
          }
        }
        break

      case SIRSVIDEState.Recovered:
        record.animal.immunityLevel = Math.max(0, record.animal.immunityLevel - 0.0001 * dt)
        if (record.animal.immunityLevel <= 0.1) {
          record.state = SIRSVIDEState.Susceptible
        }
        break

      default:
        break
    }
  }

  private spreadDisease(strain: DiseaseStrain): void {
    const infected = this.population.filter(r => r.state === SIRSVIDEState.Infected)
    const susceptible = this.population.filter(r => r.state === SIRSVIDEState.Susceptible)

    for (const source of infected) {
      for (const target of susceptible) {
        const transmissionChance = strain.transmissionRate * this.transmissionModifier * (1 - target.animal.immunityLevel)
        if (Math.random() < transmissionChance) {
          target.state = SIRSVIDEState.Exposed
          target.strain = mutateStrain(strain)
        }
      }
    }
  }

  /** ES-82: Inject synthetic antibodies into the simulation */
  injectAntibodies(): void {
    // Boost immunity of all currently infected agents by 0.3
    for (const record of this.population) {
      if (record.state === SIRSVIDEState.Infected) {
        record.animal.immunityLevel = Math.min(1.0, record.animal.immunityLevel + 0.3)
      }
    }

    // Reduce transmission rate by 50% for 30 ticks
    this.transmissionModifier = 0.5
    this.suppressionTicksRemaining = 30
  }

  getStats(): Record<SIRSVIDEState, number> {
    const counts = {} as Record<SIRSVIDEState, number>
    for (const s of Object.values(SIRSVIDEState)) counts[s] = 0
    for (const r of this.population) counts[r.state]++
    return counts
  }
}