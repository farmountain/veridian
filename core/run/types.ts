import type { Clock } from "../clarification/index.ts";

/** PLAN.md §50. Every run is in exactly one of these states. */
export const RUN_STATES = [
  "CREATED",
  "PREPARING",
  "READY",
  "EXECUTING",
  "OBSERVING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "RESETTING",
  "ABORTED",
  "ERROR",
  "MAX_ITERATIONS",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/**
 * Terminal states are absorbing. `MAX_ITERATIONS` is a terminal state rather than an exception
 * because hitting the iteration cap is a *result* — the world did not converge, and that is
 * information the caller is entitled to.
 */
export const TERMINAL_STATES = ["COMPLETED", "ABORTED", "ERROR", "MAX_ITERATIONS"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

export interface Transition {
  readonly from: RunState;
  readonly to: RunState;
  readonly at: string;
  readonly reason: string;
  readonly iteration: number;
}

export interface RunRecord {
  readonly id: string;
  readonly goalId: string;
  readonly environmentId: string | null;
  readonly state: RunState;
  readonly iteration: number;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly transitions: readonly Transition[];
}

export interface RunHandle {
  readonly clock: Clock;
  readonly runId: string;
  readonly goalId: string;
  readonly maxIterations: number;
  current(): RunRecord;
  /** Advance the state machine. Throws {@link IllegalTransitionError} on an impossible hop. */
  to(state: RunState, reason: string): RunRecord;
  /** Begin the next iteration. Returns false when the cap is reached. */
  nextIteration(reason: string): boolean;
}

export class IllegalTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(
      `Illegal run transition ${from} -> ${to}. Veridian has no ambiguous execution paths: if a hop ` +
        "is not in the transition table it is a defect, not a runtime condition.",
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}
