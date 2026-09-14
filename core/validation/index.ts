export {
  ValidatorRegistry,
  evaluateCriterion,
  rollupCriterionStatus,
} from "./registry.ts";
export type { EvaluateOptions } from "./registry.ts";

export { ROLLUP_GUARDS, rollup } from "./rollup.ts";
export type { RollupGuard, RollupInput, RollupOutcome, Verdict } from "./rollup.ts";

export { CRITERION_STATUSES } from "./types.ts";
export type {
  AssertionResult,
  CriterionResult,
  CriterionSpec,
  CriterionStatus,
  EvidenceArtifact,
  Observation,
  Validator,
  ValidatorDescriptor,
} from "./types.ts";
