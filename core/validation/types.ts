import type { FailureKind } from "../failure.ts";
import type { EvidenceArtifact, Observation } from "../environment/types.ts";

/**
 * PLAN.md §7 — `status ∈ {PASS, FAIL, ERROR, SKIPPED, INCONCLUSIVE}`.
 *
 * `INCONCLUSIVE` is not a polite `FAIL`. It means the question was not answered, and the whole
 * product rests on never letting it be mistaken for an answer.
 */
export const CRITERION_STATUSES = ["PASS", "FAIL", "ERROR", "SKIPPED", "INCONCLUSIVE"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export interface AssertionResult {
  readonly validator: string;
  readonly target: string | null;
  readonly status: CriterionStatus;
  readonly actual: unknown;
  readonly expected: unknown;
  readonly message: string | null;
  /** Set when the assertion could not run. Never `TEST_FAILURE` for a validator's own crash. */
  readonly failureKind?: FailureKind | null;
}

/**
 * The result of judging one criterion. Shape matches PLAN.md §7; casing is camelCase in TS (the
 * persisted artifact uses the same names).
 */
export interface CriterionResult {
  readonly criterionId: string;
  readonly description: string;
  readonly mandatory: boolean;
  readonly status: CriterionStatus;
  readonly actual: unknown;
  readonly expected: unknown;
  readonly timestamp: string;
  readonly message: string | null;
  /** Artifact kinds the criterion required but the observation did not produce. */
  readonly missingEvidence: readonly string[];
  readonly evidence: readonly string[];
  readonly environmentId: string | null;
  readonly runId: string;
  readonly assertions: readonly AssertionResult[];
}

/** The criterion as validation sees it — structural, so `core/validation` need not import `core/acceptance`. */
export interface CriterionSpec {
  readonly id: string;
  readonly description: string;
  readonly mandatory: boolean;
  /** Artifact kinds that must exist for this criterion to be decidable. */
  readonly evidence: readonly string[];
  readonly steps: readonly Readonly<Record<string, unknown>>[];
  readonly expect: readonly Readonly<Record<string, unknown>>[];
}

export interface ValidatorDescriptor {
  readonly name: string;
  readonly needsTarget: boolean;
  readonly comparisons: readonly string[];
  readonly observationKind: string;
}

export interface Validator {
  readonly name: string;
  readonly needsTarget: boolean;
  readonly comparisons: readonly string[];
  /** The only observation kind this validator can read. A mismatch is a `VALIDATOR_ERROR`. */
  readonly observationKind: string;
  /**
   * Pure: no I/O, no clock, no globals. Throwing is permitted but is *always* reported as a
   * `VALIDATOR_ERROR` — a validator defect can never be laundered into an application failure.
   */
  validate(
    expectation: Readonly<Record<string, unknown>>,
    observation: Observation,
  ): AssertionResult;
}

export type { EvidenceArtifact, Observation };
