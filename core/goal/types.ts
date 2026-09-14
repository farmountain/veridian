/**
 * The goal: what the user wants the software to do, expressed as an observable end state.
 *
 * Veridian never chooses the goal. It only decides whether the goal was met, which is why the goal
 * is data and not code — a goal that could execute would be a member of the execution, and the
 * judge would be inside the thing it is judging.
 */

export type NetworkPolicy = "deny" | "allow-list" | "allow";
export type FilesystemWritePolicy = "deny" | "sandbox";

/** PLAN.md §52. Every execution is bounded; an unbounded agent loop is the failure mode. */
export interface GoalLimits {
  /** Hard cap on FAIL → repair → retry cycles. The schema caps this at 10. */
  readonly maxIterations: number;
  /** Hard cap on the whole run. */
  readonly maxRuntimeMs: number;
  /** Hard cap on a single criterion, so one hang cannot consume the run's whole budget. */
  readonly maxCriterionMs: number;
  readonly networkPolicy: NetworkPolicy;
  /**
   * The origins `networkPolicy: "allow-list"` permits.
   *
   * A policy without its parameter is not a policy. Until this existed, a goal could declare
   * `allow-list` and nothing in the document could say what the list was, which made the value
   * indistinguishable from `deny` at every point that could have acted on it.
   */
  readonly networkAllowList: readonly string[];
  readonly filesystemWrite: FilesystemWritePolicy;
}

export interface Goal {
  /** Schema version of the goal document itself. */
  readonly version: number;
  readonly id: string;
  /** One sentence describing what is true when the work is done. */
  readonly statement: string;
  /** Optional prose. Never load-bearing: a criterion that depends on this is underspecified. */
  readonly context: string | null;
  /** Path to the acceptance contract, relative to the goal file. */
  readonly acceptance: string;
  /** Path to the environment definition, relative to the goal file. */
  readonly environment: string;
  readonly limits: GoalLimits;
  readonly tags: readonly string[];
}

/** Where a definition came from. Kept so the run bundle can copy it verbatim and cite it. */
export interface SourceRef {
  /** Path as given by the caller. */
  readonly path: string;
  /** Directory of the file, POSIX-normalised, relative to the io port's root. */
  readonly dir: string;
  /** The exact bytes read. Copied into the run bundle so a run can be re-read years later. */
  readonly text: string;
}

export interface GoalDocument {
  /** The parsed document, possibly incomplete. The ambiguity protocol completes it. */
  readonly raw: Record<string, unknown>;
  readonly source: SourceRef;
}
