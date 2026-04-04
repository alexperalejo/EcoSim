/**
 * ES-65: Implement organism.ts scaling layer
 *
 * Manages a population of Animal instances.
 * Handles disease spread using the SIRSVIDE model,
 * population-level immunity tracking, migration and
 * density effects, and zoonotic transmission between species.
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
        const transmissionChance = strain.transmissionRate * (1 - target.animal.immunityLevel)
        if (Math.random() < transmissionChance) {
          target.state = SIRSVIDEState.Exposed
          target.strain = mutateStrain(strain)
        }
      }
    }
  }

  getStats(): Record<SIRSVIDEState, number> {
    const counts = {} as Record<SIRSVIDEState, number>
    for (const s of Object.values(SIRSVIDEState)) counts[s] = 0
    for (const r of this.population) counts[r.state]++
    return counts
  }
}