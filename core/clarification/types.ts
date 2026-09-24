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

/**
 * The rungs of the ladder, in the order they are attempted.
 *
 * `self_prompted` sits between `defaulted` and `answered` on purpose, and its placement *is* the
 * safety argument. Self-prompting is the run asking **itself** - reasoning over material already in
 * hand - and the governing rule prefers it over interrupting a person, so it has to be tried before
 * `answered`. But a detector that declared a fail-safe default has already reasoned about that gap
 * and argued that its answer cannot make the run report PASS more readily than the truth, so a
 * self-generated answer may not displace it. The rung therefore fires exactly where the ladder
 * previously had to ask a human or give up, which means adding it can only reduce the number of
 * human interruptions - never resolve a gap the run had already decided for itself.
 */
export const RUNGS = [
  "derived",
  "inferred",
  "defaulted",
  "self_prompted",
  "answered",
  "deferred",
] as const;
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
  | {
      readonly via: "self_prompted";
      readonly value: unknown;
      readonly confidence: number;
      /** What the prompt read to reach this answer: a path, an artifact, a value in hand. */
      readonly grounds: string;
      /** How many attempts it took. Recorded because the budget is a cost, not a formality. */
      readonly rounds: number;
    }
  | { readonly via: "answered"; readonly value: unknown; readonly answer: string }
  | { readonly via: "deferred"; readonly reason: DeferReason };

/** A resolution together with the audit trail of how it was reached. */
export interface ClarificationRecord {
  readonly ambiguity: Ambiguity;
  readonly resolution: Resolution;
  /**
   * Rungs attempted, in order, each at most once: the walk records a rung before giving it its
   * chance, so this sequence is non-decreasing and free of repeats by construction.
   *
   * What it does **not** count is rung 4's attempts. One rung may put the same gap to the port more
   * than once, which is why that rung carries an attempt budget and why the run reports
   * `selfPromptRounds` beside this - a rung entered once can still cost more than one reading.
   */
  readonly rungsAttempted: readonly Rung[];
}

export interface ClarificationPolicy {
  /** Rung 2 accepts an inference only at or above this confidence. */
  readonly inferThreshold: number;
  /**
   * Rung 4 accepts a self-prompted answer only at or above this confidence, and the default is
   * deliberately *above* `inferThreshold`: a run grading its own homework is held to a stricter
   * standard than a check against what earlier runs learned from a human.
   */
  readonly selfPromptThreshold: number;
  /**
   * How many times one gap may be put to the self. Two is the default because one refinement is
   * worth affording and a third attempt is a loop wearing a budget's clothes.
   */
  readonly maxSelfPromptRoundsPerAmbiguity: number;
  /** Hard cap on self-prompt rounds for an entire run, so the rung cannot become the slow path. */
  readonly maxSelfPromptRoundsPerRun: number;
  /** Wall-clock ceiling on the self-prompting rung alone. */
  readonly selfPromptBudgetMs: number;
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
  selfPromptThreshold: 0.8,
  maxSelfPromptRoundsPerAmbiguity: 2,
  maxSelfPromptRoundsPerRun: 10,
  selfPromptBudgetMs: 60_000,
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

export interface SelfPromptResult {
  readonly value: unknown;
  /** The port's own estimate, admitted only at or above `selfPromptThreshold`. */
  readonly confidence: number;
  /** Pointer or path to what was read. A prompt with no grounds is a guess in a costume. */
  readonly grounds: string;
}

/**
 * Rung 4 - the self boundary, attempted after DEFAULT and before ASK.
 *
 * This is the rung the governing rule prefers over the human one: *when self-prompting can resolve
 * the gap, self-prompting resolves it.* The engine calls it only for a gap that derivation,
 * inference and any declared fail-safe default all failed to close - i.e. exactly the gaps that
 * would otherwise become a question for a person or a deferral - and it is asked at most
 * `maxSelfPromptRoundsPerAmbiguity` times per gap, within a per-run round cap and a wall-clock
 * ceiling. A port that returns `null`, throws, or answers below the threshold simply lets the ladder
 * continue, so this rung cannot make a run report PASS more readily than the same run without it.
 */
export interface SelfPromptPort {
  readonly available: boolean;
  /**
   * Put the gap to the run's own reasoning rather than to a person. `attempt` is 1-based, so a port
   * may refine its earlier answer instead of repeating it - and so the engine can bound the retries.
   */
  prompt(ambiguity: Ambiguity, attempt: number): Promise<SelfPromptResult | null>;
}

/**
 * Rung 5. The human boundary.
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
  /**
   * Self-prompt rounds actually spent. Zero is the honest reading when no self-prompt port is
   * installed, which is why it is a count of work done and not a capability flag.
   */
  readonly selfPromptRounds: number;
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
