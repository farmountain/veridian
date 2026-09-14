/**
 * The Ambiguity Resolution Protocol — types.
 *
 * See docs/IMPLEMENTATION-PLAN.md §3. The design in one sentence: *ambiguity is a first-class,
 * recorded artifact, resolved by a bounded ladder whose every rung is either derivable,
 * conservative, or reported.*
 */

/** The lifecycle stage an ambiguity was raised from. Every stage may raise. */
export const AMBIGUITY_ORIGINS = [
  "goal",
  "acceptance",
  "environment",
  "validation",
  "execution",
  "evidence",
  "iteration",
] as const;
export type AmbiguityOrigin = (typeof AMBIGUITY_ORIGINS)[number];

export const AMBIGUITY_KINDS = [
  "missing_value",
  "underspecified",
  "ambiguous_reference",
  "conflicting",
  "unresolvable_entity",
] as const;
export type AmbiguityKind = (typeof AMBIGUITY_KINDS)[number];

/** The rungs of the ladder, in the order they are attempted. */
export const RUNGS = ["derived", "inferred", "defaulted", "answered", "deferred"] as const;
export type Rung = (typeof RUNGS)[number];

export const DEFER_REASONS = [
  "not_derivable",
  "no_default",
  "low_confidence",
  "question_budget_exhausted",
  "time_budget_exhausted",
  "no_user_available",
  "non_blocking",
] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];

/**
 * A recorded gap in a contract.
 *
 * `path` is an RFC 6901 JSON pointer into the originating artifact, which is what makes resolution
 * generic: the engine patches the artifact by pointer, so a detector can never produce an
 * ambiguity that nothing is able to apply.
 */
export interface Ambiguity<T = unknown> {
  readonly id: string;
  readonly origin: AmbiguityOrigin;
  readonly path: string;
  readonly kind: AmbiguityKind;
  /** The exact question that would resolve this. Used by DERIVE, by INFER, and by a human. */
  readonly question: string;
  /** Computed by {@link isBlocking}, never asserted by the caller. */
  readonly blocking: boolean;
  /** Discrete choices, when the space is enumerable. Enables multiple-choice asking. */
  readonly candidates?: readonly T[];
  /** Present only together with {@link defaultRationale}, and only when the value is fail-safe. */
  readonly defaultValue?: T;
  /** Why selecting {@link defaultValue} cannot make the run report PASS more readily than the truth. */
  readonly defaultRationale?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export type Resolution =
  | { readonly via: "derived"; readonly value: unknown; readonly evidence: string }
  | {
      readonly via: "inferred";
      readonly value: unknown;
      readonly confidence: number;
      readonly source: string;
    }
  | { readonly via: "defaulted"; readonly value: unknown; readonly assumption: string }
  | { readonly via: "answered"; readonly value: unknown; readonly answer: string }
  | { readonly via: "deferred"; readonly reason: DeferReason };

/** A resolution together with the audit trail of how it was reached. */
export interface ClarificationRecord {
  readonly ambiguity: Ambiguity;
  readonly resolution: Resolution;
  /** Rungs actually attempted, in order. The ladder is a straight line, so this is bounded. */
  readonly rungsAttempted: readonly Rung[];
}

export interface ClarificationPolicy {
  /** Rung 2 accepts an inference only at or above this confidence. */
  readonly inferThreshold: number;
  /** Hard cap on human interruptions for an entire run. */
  readonly maxQuestionsPerRun: number;
  /** Questions are batched into rounds of at most this size. */
  readonly maxQuestionsPerRound: number;
  /** Wall-clock ceiling on the whole clarification phase. */
  readonly budgetMs: number;
}

/**
 * Tolerance, not optimism. A question asked is a licence for the answer to be recorded; the
 * defaults here are deliberately small so that the protocol cannot become the slow path.
 */
export const DEFAULT_CLARIFICATION_POLICY: ClarificationPolicy = {
  inferThreshold: 0.7,
  maxQuestionsPerRun: 5,
  maxQuestionsPerRound: 3,
  budgetMs: 120_000,
};

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface DeriveResult {
  readonly value: unknown;
  /** Pointer to the deterministic grounds — a schema default, a manifest field, a sibling file. */
  readonly evidence: string;
}

/** Rung 1. A promise is allowed because deriving may require reading the repository. */
export interface DerivePort {
  derive(ambiguity: Ambiguity): DeriveResult | null | Promise<DeriveResult | null>;
}

export interface InferResult {
  readonly value: unknown;
  readonly confidence: number;
  readonly source: string;
}

/** Rung 2. Sampling the memory substrate. Absence must degrade to a skip, never a failure. */
export interface InferPort {
  infer(ambiguity: Ambiguity): Promise<InferResult | null>;
}

/**
 * Rung 4. The human boundary.
 *
 * `available: false` is the anti-hang guarantee: a headless run defers rather than blocking
 * forever, so its criteria become INCONCLUSIVE instead of the process never returning.
 */
export interface UserPromptPort {
  readonly available: boolean;
  /** Returns ambiguity id → answer text. Ids with no entry are treated as unanswered. */
  ask(questions: readonly Ambiguity[]): Promise<ReadonlyMap<string, string>>;
}

export interface Clock {
  now(): number;
  /** ISO-8601 UTC, milliseconds precision. */
  iso(): string;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

export interface ClarificationReport {
  readonly records: readonly ClarificationRecord[];
  readonly questionsAsked: number;
  readonly rounds: number;
  readonly elapsedMs: number;
  readonly budgetExhausted: boolean;
  /** Blocking ambiguities that reached DEFER. Non-zero means the run cannot be PASS. */
  readonly unresolvedBlocking: number;
  readonly byVia: Readonly<Record<Rung, number>>;
}

export interface ClarificationOutcome<T> {
  /** The artifact with every resolved value applied. */
  readonly artifact: T;
  readonly report: ClarificationReport;
  /** Ambiguities that reached DEFER. Any blocking entry forces a non-PASS run. */
  readonly deferred: readonly Ambiguity[];
  /** Questions still unanswered because the budget ran out before they could be asked. */
  readonly unasked: readonly Ambiguity[];
}

/** The path a value was written to, so evidence can cite it. */
export interface AppliedResolution {
  readonly ambiguityId: string;
  readonly path: string;
  readonly via: Rung;
  readonly value: unknown;
}

// ---------------------------------------------------------------------------------------------
// Construction helpers — the only supported way to build these shapes
// ---------------------------------------------------------------------------------------------

/**
 * Stable, deterministic id. Two runs over the same artifact produce the same ids, which is what
 * lets a recorded resolution be replayed against a repeat run (metric M1).
 */
export const ambiguityId = (
  origin: AmbiguityOrigin,
  path: string,
  kind: AmbiguityKind,
): string => `${origin}:${path || "/"}:${kind}`;

/**
 * The computed blocking predicate (plan §3.4). Blocking is never supplied by a detector directly —
 * it is assembled from the three semantic consequences that make a gap worth a human's time.
 */
export function isBlocking(input: {
  /** The path lies on a mandatory criterion's PASS/FAIL semantics. */
  readonly onMandatoryPath?: boolean;
  /** The gap makes an action or criterion unexecutable. */
  readonly makesUnexecutable?: boolean;
  /** The gap changes the meaning of the environment definition. */
  readonly changesEnvironmentMeaning?: boolean;
}): boolean {
  return Boolean(
    input.onMandatoryPath || input.makesUnexecutable || input.changesEnvironmentMeaning,
  );
}

/**
 * Declare a fail-safe default. The rationale is mandatory and is the enforcement of plan §A8:
 * a default is only usable when selecting it cannot make the run report PASS more readily than
 * the truth. An empty rationale makes the engine ignore the default entirely.
 */
export function failSafeDefault<T>(
  value: T,
  rationale: string,
): { readonly defaultValue: T; readonly defaultRationale: string } {
  if (!rationale.trim()) {
    throw new Error("failSafeDefault requires a non-empty rationale");
  }
  return { defaultValue: value, defaultRationale: rationale };
}

/** Build an ambiguity with the id and blocking flag derived rather than hand-written. */
export function ambiguity<T>(input: {
  origin: AmbiguityOrigin;
  path: string;
  kind: AmbiguityKind;
  question: string;
  blocking: boolean;
  candidates?: readonly T[];
  defaultValue?: T;
  defaultRationale?: string;
  context?: Record<string, unknown>;
}): Ambiguity<T> {
  return {
    id: ambiguityId(input.origin, input.path, input.kind),
    origin: input.origin,
    path: input.path,
    kind: input.kind,
    question: input.question,
    blocking: input.blocking,
    ...(input.candidates ? { candidates: input.candidates } : {}),
    ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
    ...(input.defaultRationale ? { defaultRationale: input.defaultRationale } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
}
