/**
 * The Ambiguity Resolution Protocol.
 *
 * Public surface of `core/clarification`. The protocol is the lowest layer of the Core: it imports
 * nothing from `core/` itself, so that every other stage may depend on it without a cycle.
 */
export {
  AMBIGUITY_KINDS,
  AMBIGUITY_ORIGINS,
  DEFAULT_CLARIFICATION_POLICY,
  DEFER_REASONS,
  RUNGS,
  ambiguity,
  ambiguityId,
  failSafeDefault,
  isBlocking,
} from "./types.ts";
export type {
  Ambiguity,
  AmbiguityKind,
  AmbiguityOrigin,
  AppliedResolution,
  ClarificationOutcome,
  ClarificationPolicy,
  ClarificationRecord,
  ClarificationReport,
  Clock,
  DeferReason,
  DerivePort,
  DeriveResult,
  InferPort,
  InferResult,
  Logger,
  Resolution,
  Rung,
  SelfPromptPort,
  SelfPromptResult,
  UserPromptPort,
} from "./types.ts";

export { getPointer, hasPointer, joinPointer, parentOf, setPointer } from "./pointer.ts";

export {
  ClarificationEngine,
  NullPromptPort,
  NullSelfPromptPort,
  scriptedPromptPort,
  scriptedSelfPromptPort,
} from "./engine.ts";
export type { ClarificationEngineDeps } from "./engine.ts";

export { createDeriver, defaultDeriveRules, filenameRule, manifestStartRule, schemaDefaultRule } from "./derive.ts";
export type { DeriveRule, IoPort } from "./derive.ts";

export {
  allDetectors,
  detectAcceptanceAmbiguities,
  detectEnvironmentAmbiguities,
  detectExecutionAmbiguities,
  detectEvidenceAmbiguities,
  detectGoalAmbiguities,
  detectIterationAmbiguities,
  detectValidationAmbiguities,
  runtimeDetectors,
} from "./detect.ts";
export type {
  AcceptanceLike,
  CriterionLike,
  CriterionOutcomeLike,
  DetectorContext,
  EnvironmentLike,
  ExecutionLike,
  ExpectationLike,
  GoalLike,
  IterationDecision,
  IterationLike,
  ValidatorDescriptor,
} from "./detect.ts";
export { ITERATION_DECISIONS } from "./detect.ts";
