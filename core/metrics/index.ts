/**
 * The MVP success metrics, as a module.
 *
 * PLAN.md's M1..M5 are measurements over runs, so they live here rather than in an acceptance
 * contract: see `./metrics.ts` for why an `acceptance/*.yaml` of `web.*` validators would have been a
 * lie, and `./history.ts` for how a run history is read from `.veridian/runs/`.
 */

export type {
  ConsistencyDifference,
  ConsistencyReport,
  CriterionSnapshot,
  DetectionReport,
  EvidenceReport,
  FalsePass,
  IterationSnapshot,
  MetricOptions,
  MetricVerdict,
  ResetReport,
  RunSnapshot,
  SuccessMetrics,
} from "./metrics.ts";
export {
  defectDetection,
  evidenceCompleteness,
  falsePasses,
  formatMetrics,
  parseRunSnapshot,
  resetReproducibility,
  resultConsistency,
  successMetrics,
} from "./metrics.ts";
export type { HistoryMetrics, RunHistory } from "./history.ts";
export { listRuns, measureRunHistory, readRunHistory } from "./history.ts";
