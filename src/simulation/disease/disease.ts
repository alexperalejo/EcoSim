import { Cell, CellType, CellState } from './cell'

// Gaussian random — realistic mutation distribution 
// Small mutations are common, large mutations are rare
function gaussianRandom(mean: number, stdDev: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return mean + z * stdDev
}

export const VIRUS_PROFILES = {
  influenzaA: {
    name: 'Influenza A',
    transmissionRate: 0.3, //
    incubationPeriod: 120, // ticks beforing becoming infectious
    infectiousDuration: 348,
    mortalityRate: 0.01,
    mutationRate: 0.02,
    antibodyResistance: 0.3,
    immuneEvasionRate: 0.15,
  }

  : {
    name: 'Covid-19', 
    transmissionRate: 0.3,
    incubationPeriod: 120,
    infectiousDuration: 348,
    mortalityRate: 0.01,
    mutationRate: 0.02,
    antibodyResistance: 0.3,
    immuneEvasionRate: 0.15,
  }
}

export interface VirusProfile {
  name: string
  transmissionRate: number
  incubationPeriod: number
  infectiousDuration: number
  mortalityRate: number
  mutationRate: number
  antibodyResistance: number
  immuneEvasionRate: number
}

export interface DiseaseProfile {
  name: string
  transmissionRate: number
  incubationPeriod: number
  infectiousDuration: number
  mortalityRate: number
  mutationRate: number
  antibodyResistance: number
  immuneEvasionRate: number
}

export interface DiseaseStrain extends DiseaseProfile {
  strainId: number
}

export function createStrainFactory() {
  let nextStrainId = 0
  return function createStrain(profile: DiseaseProfile): DiseaseStrain {
    return {
      ...profile,
      strainId: nextStrainId++,
    }
  }
}

export const createStrain = createStrainFactory()

export function mutateStrain(strain: DiseaseStrain): DiseaseStrain {
  if (Math.random() > strain.mutationRate) return strain

  return {
    ...strain,
    strainId: createStrain(strain).strainId,
    transmissionRate:   Math.max(0, gaussianRandom(strain.transmissionRate,   0.02)),
    antibodyResistance: Math.max(0, gaussianRandom(strain.antibodyResistance, 0.02)),
    immuneEvasionRate:  Math.max(0, gaussianRandom(strain.immuneEvasionRate,  0.02)),
    mortalityRate:      Math.max(0, gaussianRandom(strain.mortalityRate,      0.002)),
    mutationRate:       Math.max(0, gaussianRandom(strain.mutationRate,       0.002)),
  }
}