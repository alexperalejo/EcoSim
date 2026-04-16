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
export type { BenchmarkResult } from './benchmark';