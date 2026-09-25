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
export type { EliEnvGroup, EliEnvPair, EliEnvReport, EliGroup, EliReport, EliRow } from "./eli.ts";
export { groupEliRows, listEliEnvDeltas, listEliRows } from "./eli.ts";
export type { EnvIndexGroup, EnvIndexReport, EnvIndexRun } from "./envindex.ts";
export { crawlFrom, listEnvIndex } from "./envindex.ts";
export type { EnvDifference, EnvExport, ExportDecision, ExportRule, RefusedKey, RenderedKey } from "./denv.ts";
export {
  EXPORT_DECISIONS,
  EXPORT_RULES,
  canonicalJson,
  envDelta,
  exportDocument,
  exportEnvironment,
  ruleFor,
} from "./denv.ts";
export type { EsiDocument, EsiExport, EsiRefusal, EsiRendering, EsiRun, EsiWorld } from "./esi.ts";
export { ESI_VERSION, esiForSubject, listEsi, parseEsi } from "./esi.ts";
export type { ImportRefusal } from "./import.ts";
export { importWorld, isImportRefusal, readImportDocument } from "./import.ts";
