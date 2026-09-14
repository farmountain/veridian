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

/**
 * The primitives a validator family is built from.
 *
 * Exported through the layer's front door so a new family imports them from `core/validation` rather
 * than reaching into a sibling family's file - which the layering rule forbids anyway, and which is
 * how one vocabulary ends up with two definitions.
 */
export {
  assertion,
  brief,
  compareBooleans,
  compareCounts,
  comparePresence,
  compareText,
  compareTruth,
  compile,
  describe,
  expectedOf,
  judge,
  notDeclared,
  notDeclaredMessage,
  plural,
  quote,
  statedComparisons,
  unanswered,
  unusable,
} from "./assertions.ts";
export type { ComparisonOutcome, Scalar } from "./assertions.ts";
