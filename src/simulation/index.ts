/**
 * Simulation Module - Public API
 */

export {
  createAgents,
  updateAgents,
  getAgentStats,
  getAgentData,
  getWorldPositions,
  updateScreenPositions,
  pickAgent,
  disposeAgents,
} from './simulationEngine';

export { DEFAULT_PARAMS, TEX_SIZE, WORLD_SIZE } from './agentState';
export type { SimParams } from './agentState';
export { ecoBenchmark } from './benchmark';
export type { BenchmarkResult } from './benchmark';
export { checkImbalance } from './imbalanceDetector';
export type { ImbalanceEvent } from './imbalanceDetector';
export { STABILITY_THRESHOLD_CRITICAL, STABILITY_THRESHOLD_WARNING } from './lstmForecaster';
export { ecoNeuro, getProtoModel, mutateWeightsTF, computeNeuroStats, forwardPass } from './neuroevolution';
export type { NeuroStats, EcoNeuro } from './neuroevolution';
export { PRESETS, getPreset, DEFAULT_PRESET_ID, SIM_PRESETS, getSimPreset } from './presets';
export type { EnvironmentPreset, SimPreset } from './presets';
export { diseaseSimulation, DiseaseSimulation, DEFAULT_DISEASE_PARAMS } from './diseaseSimulation';
export type { DiseaseState, DiseaseParams, DiseaseSnapshot } from './diseaseSimulation';