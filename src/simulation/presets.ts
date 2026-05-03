/**
 * src/simulation/presets.ts
 *
 * ES-75 — Preset Environments: Savanna, Rainforest, Island, Tundra
 * ES-39 — Sim Behavior Presets: Balanced, Attack Mode, Evolutionary Pressure,
 *          Low Food, Peaceful, Speedrun
 */

import type { SimParams } from './agentState'
import type { TerrainOptions } from '../rendering/terrain'

// ── Environment presets (terrain + sky + sim params) ─────────────────

export interface EnvironmentPreset {
  id:          string
  label:       string
  description: string
  terrain:     TerrainOptions
  params:      Partial<SimParams>
  skyColor:    number
  fogColor:    number
  fogNear:     number
  fogFar:      number
}

export const PRESETS: EnvironmentPreset[] = [
  {
    id:          'savanna',
    label:       'Savanna',
    description: 'Flat, sun-scorched plains — food is sparse, energy costly, herds move fast.',
    terrain: {
      size:        256,
      segments:    128,
      maxHeight:   8,
      noiseScale:  0.004,
      colorScheme: 'savanna',
    },
    params: {
      foodEnergyGain:   12.0,
      moveEnergyCost:   0.15,
      moveSpeed:        2.0,
      foodDetectRadius: 18.0,
      mutationRate:     0.06,
      mutationStrength: 0.25,
    },
    skyColor: 0xe8c97a,
    fogColor: 0xe8c97a,
    fogNear:  180,
    fogFar:   380,
  },
  {
    id:          'rainforest',
    label:       'Rainforest',
    description: 'Dense canopy, rich food, high hills — slow movers thrive, predators lurk close.',
    terrain: {
      size:        256,
      segments:    128,
      maxHeight:   45,
      noiseScale:  0.012,
      colorScheme: 'rainforest',
    },
    params: {
      foodEnergyGain:   32.0,
      moveEnergyCost:   0.08,
      moveSpeed:        1.0,
      foodDetectRadius: 7.0,
      mutationRate:     0.04,
      mutationStrength: 0.15,
    },
    skyColor: 0x2d5a27,
    fogColor: 0x2d5a27,
    fogNear:  80,
    fogFar:   250,
  },
  {
    id:          'island',
    label:       'Island',
    description: 'Isolated landmass surrounded by sea — limited space, boom-bust cycles.',
    terrain: {
      size:        256,
      segments:    128,
      maxHeight:   35,
      noiseScale:  0.014,
      colorScheme: 'island',
    },
    params: {
      foodEnergyGain:   22.0,
      moveEnergyCost:   0.1,
      moveSpeed:        1.5,
      foodDetectRadius: 12.0,
      mutationRate:     0.08,
      mutationStrength: 0.3,
    },
    skyColor: 0x87ceeb,
    fogColor: 0x87ceeb,
    fogNear:  200,
    fogFar:   400,
  },
  {
    id:          'tundra',
    label:       'Tundra',
    description: 'Frozen flatlands — very sparse food, high energy cost, only the fit survive.',
    terrain: {
      size:        256,
      segments:    128,
      maxHeight:   2,
      noiseScale:  0.003,
      colorScheme: 'tundra',
    },
    params: {
      foodEnergyGain:   8.0,
      moveEnergyCost:   0.22,
      moveSpeed:        1.2,
      foodDetectRadius: 22.0,
      mutationRate:     0.05,
      mutationStrength: 0.2,
    },
    skyColor: 0xc8dff0,
    fogColor: 0xc8dff0,
    fogNear:  150,
    fogFar:   320,
  },
]

export const DEFAULT_PRESET_ID = 'island'

export function getPreset(id: string): EnvironmentPreset {
  return PRESETS.find(p => p.id === id) ?? PRESETS[2]
}

// ── ES-39: Sim behavior presets ───────────────────────────────────────
// These control agent behavior + sim speed only — no terrain or sky swap.
// Applied on top of whatever environment preset is active.

export interface SimPreset {
  id:          string
  label:       string
  description: string
  simSpeed:    number
  params:      Partial<SimParams>
}

export const SIM_PRESETS: SimPreset[] = [
  {
    id:          'balanced',
    label:       'Balanced',
    description: 'Default parameters. Stable prey/predator coexistence.',
    simSpeed: 1.0,
    params: {
      mutationRate:     0.05,
      mutationStrength: 0.2,
      moveSpeed:        1.5,
      foodEnergyGain:   20.0,
      moveEnergyCost:   0.1,
      foodDetectRadius: 10.0,
    },
  },
  {
    id:          'attack',
    label:       'Attack Mode',
    description: 'Predators hit harder and move fast — prey must evolve quickly or die.',
    simSpeed: 2.0,
    params: {
      mutationRate:     0.05,
      mutationStrength: 0.2,
      moveSpeed:        2.5,
      foodEnergyGain:   8.0,
      moveEnergyCost:   0.1,
      foodDetectRadius: 14.0,
    },
  },
  {
    id:          'evolution',
    label:       'Evo Pressure',
    description: 'High mutation — rapid neural network drift and adaptation.',
    simSpeed: 1.5,
    params: {
      mutationRate:     0.45,
      mutationStrength: 0.9,
      moveSpeed:        1.5,
      foodEnergyGain:   20.0,
      moveEnergyCost:   0.1,
      foodDetectRadius: 10.0,
    },
  },
  {
    id:          'lowfood',
    label:       'Low Food',
    description: 'Food is scarce and energy-poor. Efficiency wins.',
    simSpeed: 1.0,
    params: {
      mutationRate:     0.05,
      mutationStrength: 0.2,
      moveSpeed:        1.5,
      foodEnergyGain:   6.0,
      moveEnergyCost:   0.15,
      foodDetectRadius: 4.0,
    },
  },
  {
    id:          'peaceful',
    label:       'Peaceful',
    description: 'No predators at start. Pure prey evolution with abundant food.',
    simSpeed: 1.0,
    params: {
      mutationRate:     0.05,
      mutationStrength: 0.2,
      moveSpeed:        1.5,
      foodEnergyGain:   35.0,
      moveEnergyCost:   0.05,
      foodDetectRadius: 10.0,
    },
  },
  {
    id:          'speedrun',
    label:       'Speedrun',
    description: 'Maximum simulation speed. Watch thousands of generations fly by.',
    simSpeed: 4.0,
    params: {
      mutationRate:     0.3,
      mutationStrength: 0.5,
      moveSpeed:        1.5,
      foodEnergyGain:   20.0,
      moveEnergyCost:   0.1,
      foodDetectRadius: 10.0,
    },
  },
]

export function getSimPreset(id: string): SimPreset {
  return SIM_PRESETS.find(p => p.id === id) ?? SIM_PRESETS[0]
}