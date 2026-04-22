/**
 * Simulation Module - Public API
 *
 * This is the entry point for the GPU simulation engine.
 * Other modules should import from here, not from individual files.
 */

export {
  createAgents,
  updateAgents,
  getAgentStats,
  getAgentData,
  updateScreenPositions,
  pickAgent,
  disposeAgents,
} from './simulationEngine';

export { DEFAULT_PARAMS, TEX_SIZE, WORLD_SIZE } from './agentState';
export type { SimParams } from './agentState';
export { ecoBenchmark } from './benchmark';
export type { BenchmarkResult } from './benchmark';export { checkImbalance } from './imbalanceDetector';
export type { ImbalanceEvent } from './imbalanceDetector';
export { STABILITY_THRESHOLD_CRITICAL, STABILITY_THRESHOLD_WARNING } from './lstmForecaster';export { ecoNeuro, getProtoModel, mutateWeightsTF, computeNeuroStats, forwardPass } from './neuroevolution';
export type { NeuroStats, EcoNeuro } from './neuroevolution';
export { PRESETS, getPreset, DEFAULT_PRESET_ID } from './presets';
export type { EnvironmentPreset } from './presets';
export { diseaseSimulation, DiseaseSimulation, DEFAULT_DISEASE_PARAMS } from './diseaseSimulation';
export type { DiseaseState, DiseaseParams, DiseaseSnapshot } from './diseaseSimulation';
