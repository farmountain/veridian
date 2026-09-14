import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_TRANSITIONS,
  canTransition,
  createRunHandle,
  isTerminal,
  recordTransition,
} from "./state-machine.ts";
import {
  IllegalTransitionError,
  RUN_STATES,
  TERMINAL_STATES,
  type RunRecord,
  type RunState,
} from "./types.ts";
import { RUN_ID_PATTERN, createRunId } from "./id.ts";
import { steppingClock } from "../../tests/helpers/clock.ts";

const clock = () => steppingClock();
const HAPPY_PATH: readonly RunState[] = [
  "PREPARING",
  "READY",
  "EXECUTING",
  "OBSERVING",
  "VALIDATING",
  "COMPLETED",
];

const freshRecord = (): RunRecord =>
  createRunHandle({ clock: clock(), runId: "run-20260101-000000-abcdef", goalId: "g-1", maxIterations: 10 }).current();

describe("run transition table", () => {
  it("enumerates every state, so a state without transitions cannot be forgotten", () => {
    for (const state of RUN_STATES) {
      assert.ok(ALLOWED_TRANSITIONS[state], `${state} has no entry in the transition table`);
    }
    assert.equal(Object.keys(ALLOWED_TRANSITIONS).length, RUN_STATES.length);
  });

  it("leaves every terminal state with zero outgoing transitions", () => {
    for (const state of TERMINAL_STATES) {
      assert.deepEqual(ALLOWED_TRANSITIONS[state], [], `${state} must be absorbing`);
      assert.equal(isTerminal(state), true);
    }
  });

  it("reaches COMPLETED from VALIDATING and from nowhere else", () => {
    const sources = RUN_STATES.filter((s) => ALLOWED_TRANSITIONS[s].includes("COMPLETED"));
    assert.deepEqual(sources, ["VALIDATING"]);
  });

  it("never lets EXECUTING or OBSERVING jump straight to COMPLETED", () => {
    assert.equal(canTransition("EXECUTING", "COMPLETED"), false);
    assert.equal(canTransition("OBSERVING", "COMPLETED"), false);
    assert.equal(canTransition("READY", "COMPLETED"), false);
  });

  it("forces a real reset between FAILED and READY", () => {
    assert.equal(canTransition("FAILED", "READY"), false);
    assert.equal(canTransition("FAILED", "RESETTING"), true);
    assert.equal(canTransition("RESETTING", "READY"), true);
  });

  it("makes MAX_ITERATIONS reachable only from FAILED", () => {
    const sources = RUN_STATES.filter((s) => ALLOWED_TRANSITIONS[s].includes("MAX_ITERATIONS"));
    assert.deepEqual(sources, ["FAILED"]);
  });

  it("can reach every non-terminal state from CREATED", () => {
    const seen = new Set<RunState>(["CREATED"]);
    const queue: RunState[] = ["CREATED"];
    while (queue.length > 0) {
      const state = queue.pop();
      if (state === undefined) break;
      for (const next of ALLOWED_TRANSITIONS[state]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const state of RUN_STATES) {
      assert.ok(seen.has(state), `${state} is unreachable from CREATED, so the table has a hole`);
    }
  });

  it("throws a typed error with both states on an impossible hop", () => {
    const record = freshRecord();
    assert.throws(
      () => recordTransition(record, "EXECUTING", "skip ahead", clock()),
      (error: unknown) => {
        assert.ok(error instanceof IllegalTransitionError);
        assert.equal(error.from, "CREATED");
        assert.equal(error.to, "EXECUTING");
        return true;
      },
    );
  });
});

describe("run handle", () => {
  it("starts CREATED at iteration 1 with no end time", () => {
    const record = freshRecord();
    assert.equal(record.state, "CREATED");
    assert.equal(record.iteration, 1);
    assert.equal(record.endedAt, null);
    assert.deepEqual(record.transitions, []);
  });

  it("walks the happy path and stamps endedAt on the terminal state", () => {
    const handle = createRunHandle({
      clock: clock(),
      runId: "run-20260101-000000-abcdef",
      goalId: "g-1",
      maxIterations: 10,
    });
    for (const state of HAPPY_PATH) handle.to(state, `to ${state}`);
    const record = handle.current();
    assert.equal(record.state, "COMPLETED");
    assert.ok(record.endedAt, "a terminal run must carry an end timestamp");
    assert.equal(record.transitions.length, HAPPY_PATH.length);
    assert.deepEqual(
      record.transitions.map((t) => t.from),
      ["CREATED", ...HAPPY_PATH.slice(0, -1)],
    );
  });

  it("records transitions with strictly increasing timestamps and the active iteration", () => {
    const handle = createRunHandle({
      clock: clock(),
      runId: "run-20260101-000000-abcdef",
      goalId: "g-1",
      maxIterations: 10,
    });
    handle.to("PREPARING", "preparing");
    handle.to("READY", "ready");
    handle.to("EXECUTING", "executing");
    const record = handle.current();
    const times = record.transitions.map((t) => Date.parse(t.at));
    for (let i = 1; i < times.length; i += 1) {
      const previous = times[i - 1];
      const current = times[i];
      assert.ok(previous !== undefined && current !== undefined && current > previous);
    }
    assert.ok(record.transitions.every((t) => t.iteration === 1));
  });

  it("completes the failure cycle FAILED -> RESETTING -> READY with the iteration advanced", () => {
    const handle = createRunHandle({
      clock: clock(),
      runId: "run-20260101-000000-abcdef",
      goalId: "g-1",
      maxIterations: 10,
    });
    handle.to("PREPARING", "preparing");
    handle.to("READY", "ready");
    handle.to("EXECUTING", "executing");
    handle.to("FAILED", "assertion failed");
    handle.to("RESETTING", "resetting");
    assert.equal(handle.nextIteration("retry with a clean world"), true);
    const record = handle.current();
    assert.equal(record.state, "READY");
    assert.equal(record.iteration, 2);
    assert.equal(record.endedAt, null, "leaving FAILED must clear the end timestamp");
  });

  it("refuses to start an iteration past the cap", () => {
    const handle = createRunHandle({
      clock: clock(),
      runId: "run-20260101-000000-abcdef",
      goalId: "g-1",
      maxIterations: 1,
    });
    assert.equal(handle.nextIteration("no budget left"), false);
    assert.equal(handle.current().iteration, 1);
    assert.equal(handle.current().state, "CREATED");
  });

  it("does not advance the iteration when the cap is reached mid-cycle", () => {
    const handle = createRunHandle({
      clock: clock(),
      runId: "run-20260101-000000-abcdef",
      goalId: "g-1",
      maxIterations: 2,
    });
    handle.to("PREPARING", "preparing");
    handle.to("READY", "ready");
    handle.to("EXECUTING", "executing");
    handle.to("FAILED", "failed");
    handle.to("RESETTING", "resetting");
    assert.equal(handle.nextIteration("iteration 2"), true);
    handle.to("EXECUTING", "executing again");
    handle.to("FAILED", "failed again");
    assert.equal(handle.nextIteration("iteration 3"), false);
    assert.equal(handle.current().iteration, 2);
    // The cap is reached from FAILED, without a reset: resetting a world that will never be
    // executed again would be work whose only observable effect is time.
    handle.to("MAX_ITERATIONS", "cap reached");
    assert.equal(isTerminal(handle.current().state), true);
  });
});

describe("run ids", () => {
  it("matches the schema pattern and is lexicographically sortable by time", () => {
    const early = createRunId({ now: () => Date.UTC(2026, 0, 1, 0, 0, 0), iso: () => "" }, () => "aaaaaa");
    const late = createRunId({ now: () => Date.UTC(2026, 0, 1, 0, 0, 1), iso: () => "" }, () => "bbbbbb");
    assert.match(early, RUN_ID_PATTERN);
    assert.match(late, RUN_ID_PATTERN);
    assert.ok(early < late, "ids must sort in chronological order");
  });

  it("does not collide when two runs start in the same second", () => {
    const fixed = { now: () => Date.UTC(2026, 0, 1), iso: () => "" };
    const ids = new Set([
      createRunId(fixed, () => "aaaaaa"),
      createRunId(fixed, () => "bbbbbb"),
      createRunId(fixed, () => "cccccc"),
    ]);
    assert.equal(ids.size, 3);
  });

  it("sanitises entropy that contains characters illegal in a directory name", () => {
    const id = createRunId({ now: () => Date.UTC(2026, 0, 1), iso: () => "" }, () => "a1/b:c d");
    assert.match(id, RUN_ID_PATTERN);
  });
});
