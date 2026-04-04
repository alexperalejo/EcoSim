export type CellType = 'epithelial' | 'macrophage' | 'tcell'
export type CellState = 'S' | 'E' | 'I' | 'R' | 'D' | 'V' | 'ID' | 'IE' | 'VV'

export const CELL_STATS = {
  epithelial: { maxHealth: 60, immuneStrength: 0.2, immuneDecayRate: 0.0 },
  macrophage: { maxHealth: 85, immuneStrength: 0.7, immuneDecayRate: 0.02 },
  tcell:      { maxHealth: 100, immuneStrength: 0.9, immuneDecayRate: 0.005 },
}

export interface Cell {
  cellType: CellType
  x: number
  z: number
  health: number
  immuneStrength: number
  immuneDecay: number
  strainId: number
  age: number
  state: CellState
  infectionLevel: number
  antibodyCount: number
  exposureTime: number
}

export function createCell(x: number, z: number, cellType: CellType): Cell {
  const maxHealth = CELL_STATS[cellType].maxHealth
  const immuneStrength = CELL_STATS[cellType].immuneStrength

  return {
    cellType,
    x,
    z,
    health: maxHealth,
    immuneStrength,
    immuneDecay: 0,
    strainId: 0,
    age: 0,
    state: 'S',
    infectionLevel: 0,
    antibodyCount: 0,
    exposureTime: 0,
  }
}