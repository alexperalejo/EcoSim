/**
 * src/simulation/presets.ts
 *
 * ES-75 — Preset Environments: Savanna, Rainforest, Island, Tundra
 *
 * Each preset bundles:
 *   - TerrainOptions  (noiseScale, maxHeight) → passed to createTerrain()
 *   - SimParams patch  (food, energy, speed, mutation) → merged into engine.params
 *   - Visual hint     (sky/fog color) → applied to Three.js scene
 */

import type { SimParams } from './agentState'
import type { TerrainOptions } from '../rendering/terrain'

export interface EnvironmentPreset {
  id:          string
  label:       string
  description: string
  terrain:     TerrainOptions
  params:      Partial<SimParams>
  skyColor:    number   // hex
  fogColor:    number   // hex
  fogNear:     number
  fogFar:      number
}

export const PRESETS: EnvironmentPreset[] = [
  {
    id:          'savanna',
    label:       'Savanna',
    description: 'Flat, sun-scorched plains — food is sparse, energy costly, herds move fast.',
    terrain: {
      size:       256,
      segments:   128,
      maxHeight:  8,      // nearly flat
      noiseScale: 0.004,  // broad, gentle features
    },
    params: {
      foodEnergyGain:   12.0,   // scarce food
      moveEnergyCost:   0.15,   // hot = costly
      moveSpeed:        2.0,    // fast movers survive
      foodDetectRadius: 18.0,   // must range wide
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
      size:       256,
      segments:   128,
      maxHeight:  45,     // steep ridges
      noiseScale: 0.012,  // tight, varied
    },
    params: {
      foodEnergyGain:   32.0,   // abundant
      moveEnergyCost:   0.08,   // cool and humid
      moveSpeed:        1.0,    // dense undergrowth
      foodDetectRadius: 7.0,    // short visibility
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
      size:       256,
      segments:   128,
      maxHeight:  35,
      noiseScale: 0.014,  // sharp central peak, water edges
    },
    params: {
      foodEnergyGain:   22.0,
      moveEnergyCost:   0.1,
      moveSpeed:        1.5,
      foodDetectRadius: 12.0,
      mutationRate:     0.08,   // isolated = faster drift
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
      size:       256,
      segments:   128,
      maxHeight:  12,
      noiseScale: 0.003,  // very flat, windswept
    },
    params: {
      foodEnergyGain:   8.0,    // near-barren
      moveEnergyCost:   0.22,   // freezing
      moveSpeed:        1.2,
      foodDetectRadius: 22.0,   // must range far
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
  return PRESETS.find(p => p.id === id) ?? PRESETS[2] // fallback: island
}
