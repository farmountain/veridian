import type { Clock } from "../clarification/index.ts";
import {
  IllegalTransitionError,
  TERMINAL_STATES,
  type RunHandle,
  type RunRecord,
  type RunState,
  type TerminalState,
} from "./types.ts";

/**
 * The transition table.
 *
 * Written as data rather than as conditionals for one reason: the false-PASS risk lives here.
 * A state machine with ad-hoc transitions is the single place a wrong hop could turn an
 * inconclusive run into a passing one, so the legal hops are enumerable and reviewable in full.
 *
 * Every terminal state maps to an empty list. A terminal state that could be left would make
 * `COMPLETED` meaningless.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  CREATED: ["PREPARING", "ABORTED", "ERROR"],
  PREPARING: ["READY", "ABORTED", "ERROR"],
  READY: ["EXECUTING", "ABORTED", "ERROR"],
  EXECUTING: ["OBSERVING", "FAILED", "ABORTED", "ERROR"],
  OBSERVING: ["VALIDATING", "ABORTED", "ERROR"],
  // VALIDATING is the only state that may reach COMPLETED. Nothing skips the judge.
  VALIDATING: ["COMPLETED", "FAILED", "ABORTED", "ERROR"],
  // The reset cycle. FAILED → READY is deliberately absent: a reset must actually happen.
  FAILED: ["RESETTING", "MAX_ITERATIONS", "ABORTED", "ERROR"],
  RESETTING: ["READY", "ABORTED", "ERROR"],
  COMPLETED: [],
  ABORTED: [],
  ERROR: [],
  MAX_ITERATIONS: [],
};

export function isTerminal(state: RunState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function canTransition(from: RunState, to: RunState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Append a transition, returning a new record. Sets `endedAt` when entering a terminal state. */
export function recordTransition(
  record: RunRecord,
  to: RunState,
  reason: string,
  clock: Clock,
  iteration = record.iteration,
): RunRecord {
  assertTransition(record.state, to);
  const at = clock.iso();
  return {
    ...record,
    state: to,
    iteration,
    endedAt: isTerminal(to) ? at : null,
    transitions: [...record.transitions, { from: record.state, to, at, reason, iteration }],
  };
}

export interface RunHandleOptions {
  readonly clock: Clock;
  readonly runId: string;
  readonly goalId: string;
  readonly maxIterations: number;
}

export function createRunHandle(options: RunHandleOptions): RunHandle {
  const { clock, runId, goalId, maxIterations } = options;
  let record: RunRecord = {
    id: runId,
    goalId,
    environmentId: null,
    state: "CREATED",
    iteration: 1,
    createdAt: clock.iso(),
    endedAt: null,
    transitions: [],
  };

  return {
    clock,
    runId,
    goalId,
    maxIterations,
    current: () => record,
    to(state, reason) {
      record = recordTransition(record, state, reason, clock);
      return record;
    },
    nextIteration(reason) {
      if (record.iteration >= maxIterations) return false;
      record = recordTransition(record, "READY", reason, clock, record.iteration + 1);
      return true;
    },
  };
}
