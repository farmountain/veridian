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
  FalsePassReport,
  IterationSnapshot,
  MetricOptions,
  MetricVerdict,
  ResetReport,
  RunSnapshot,
  SuccessMetrics,
  WorldValidityReport,
} from "./metrics.ts";
export {
  defectDetection,
  evidenceCompleteness,
  falsePasses,
  formatMetrics,
  metricViolations,
  parseRunSnapshot,
  resetReproducibility,
  resultConsistency,
  subjectOf,
  successMetrics,
  worldValidityAtExit,
} from "./metrics.ts";
export type { HistoryMetrics, RunHistory } from "./history.ts";
export { listRuns, measureRunHistory, readRunHistory } from "./history.ts";
export type { EliGroup, EliReport, EliRow } from "./eli.ts";
export { groupEliRows, listEliRows } from "./eli.ts";
