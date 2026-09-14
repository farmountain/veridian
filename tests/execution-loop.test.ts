import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildValidationPlan } from "../core/acceptance/plan.ts";
import type { AcceptanceContract } from "../core/acceptance/types.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import type { DetectorContext } from "../core/clarification/detect.ts";
import { EnvironmentError, failure } from "../core/failure.ts";
import type { EnvironmentPlan, Observation, ObservationRequest } from "../core/environment/types.ts";
import type {
  EnvironmentReady,
  EnvironmentFailure,
  EnvironmentState,
  EnvironmentTransition,
} from "../core/environment/manager.ts";
import { bundleLayout } from "../core/evidence/index.ts";
import { RunBundle } from "../core/evidence/index.ts";
import type { ReproducibilityRecord } from "../core/evidence/types.ts";
import type { GoalLimits } from "../core/goal/types.ts";
import { memoryIo, type MemoryIo } from "../core/io.ts";
import { createRunHandle } from "../core/run/state-machine.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import type { AssertionResult, Validator } from "../core/validation/types.ts";
import { NoRepairGate, ScriptedRepairGate } from "../core/execution/repair.ts";
import type { LoopResult, RepairGate, RepairOutcome, WorldPort } from "../core/execution/index.ts";
import { runValidationLoop } from "../core/execution/index.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The loop, proven offline.
 *
 * Every assertion here is about a property that would otherwise be claimed in a comment:
 *
 *  - **No repair gate means exactly one iteration.** This is the anti-infinite-loop guarantee, and it
 *    is the property that would break silently — a loop that keeps re-observing unchanged code
 *    produces a plausible-looking bundle with an ever-growing iteration count.
 *  - **`INCONCLUSIVE` never becomes `PASS`.** The whole product rests on it, and the tempting
 *    simplification ("treat an unmeasurable criterion as passed with a note") is a one-line change.
 *  - **Two independent exits.** A frozen clock makes the time bound unreachable, so the attempt
 *    bound has to hold on its own. Tested with a clock that does not move.
 *  - **The runtime protocol never asks a human.** A prompt mid-run would let a verdict depend on who
 *    was watching, and `questionsAsked` is the only place that would show up.
 *  - **A world that throws is not a passing world.** Classification, not swallowing.
 */

// ---------------------------------------------------------------------------------------------
// A world made of script, so the loop can be exercised without a browser (plan assumption A9)
// ---------------------------------------------------------------------------------------------

const HEALTH = { ok: true, message: "ready", attempts: 1, elapsedMs: 5, url: "http://127.0.0.1:4173", statusCode: 200, readyPatternSatisfied: null };

const environmentPlan: EnvironmentPlan = {
  adapter: "scripted",
  app: "shopping-cart",
  appPath: "examples/shopping-cart",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["serve.mjs"], readyPattern: null },
  url: "http://127.0.0.1:4173",
  databasePath: null,
  cluster: null,
  health: { path: "/health", expectStatus: 200, timeoutMs: 20_000, intervalMs: 100, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: null, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
};

const limits: GoalLimits = {
  maxIterations: 10,
  maxRuntimeMs: 300_000,
  maxCriterionMs: 30_000,
  networkPolicy: "deny",
  networkAllowList: [],
  filesystemWrite: "sandbox",
};

interface ScriptedWorld extends WorldPort {
  readonly resets: number;
  readonly observations: number;
  readonly tornDown: () => boolean;
}

interface WorldScript {
  /** One entry per iteration: the value `#total` reports, or an error to throw instead. */
  readonly totals: readonly (string | Error)[];
  readonly failPrepare?: string;
  readonly failReset?: string;
  /** Evidence kinds the world genuinely produces. Anything else the criterion requires is missing. */
  readonly produces?: readonly string[];
  /**
   * Requests the world's boundary refused, in order.
   *
   * A script rather than a live guard because the loop's side of this is what is under test: whether
   * a crossing the *world reports* becomes a `SECURITY_VIOLATION` and a written violation. Whether
   * Playwright's guard refuses the right requests is `tests/local-web-environment.test.ts`'s question.
   */
  readonly crossings?: readonly { readonly subject: string; readonly criterionId: string | null; readonly at: string }[];
}

function scriptedWorld(script: WorldScript): ScriptedWorld {
  let resets = 0;
  let observations = 0;
  let down = false;
  const transitions: EnvironmentTransition[] = [];
  const step = (from: EnvironmentState, to: EnvironmentState, reason: string): void => {
    transitions.push({ from, to, at: "2026-01-01T00:00:00.000Z", reason });
  };

  const health = (): EnvironmentReady => ({ ok: true, id: "env-1", state: "ready", health: HEALTH, transitions: [] });

  return {
    id: "env-1",
    plan: environmentPlan,
    // Copied on read, the way the real manager copies: a world hands out a reading of its history,
    // not the array it is still appending to. A double that returned the live array would let a
    // caller who captured it before the run see every later transition, and would hide the frozen
    // record the `resets` test below exists to catch.
    get transitions() {
      return [...transitions];
    },
    get resets() {
      return resets;
    },
    get observations() {
      return observations;
    },
    tornDown: () => down,
    boundaries: () => ({
      network: "enforced" as const,
      filesystemWrite: "unsupported" as const,
      crossings: (script.crossings ?? []).map((entry) => ({ boundary: "network" as const, ...entry })),
    }),
    prepare: async (): Promise<EnvironmentReady | EnvironmentFailure> => {
      if (script.failPrepare) {
        step("defined", "error", script.failPrepare);
        return {
          ok: false,
          id: null,
          state: "error",
          health: null,
          failure: failure("ENVIRONMENT_FAILURE", script.failPrepare),
          transitions: [],
        };
      }
      step("defined", "ready", "health check passed after 1 attempt(s)");
      return health();
    },
    reset: async (): Promise<EnvironmentReady | EnvironmentFailure> => {
      resets += 1;
      step("ready", "resetting", "reset");
      if (script.failReset) {
        step("resetting", "error", script.failReset);
        return {
          ok: false,
          id: "env-1",
          state: "error",
          health: null,
          failure: failure("RESET_FAILURE", script.failReset),
          transitions: [],
        };
      }
      step("resetting", "ready", "reset complete after 1 health attempt(s)");
      return health();
    },
    execute: async (request: ObservationRequest): Promise<Observation> => {
      const index = Math.min(observations, script.totals.length - 1);
      observations += 1;
      const step = script.totals[index];

      if (step instanceof Error) throw step;

      const produces = script.produces ?? ["screenshot"];
      return {
        kind: "web",
        capturedAt: "2026-01-01T00:00:00.000Z",
        environmentId: "env-1",
        runId: request.runId,
        data: { values: { "#total": step } },
        artifacts: produces.map((kind) => ({ path: `screenshots/${request.criterionId}.png`, kind: kind as "screenshot", criterionId: request.criterionId })),
        error: null,
      };
    },
    teardown: async () => {
      down = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// A validator, so the loop has something to judge with
// ---------------------------------------------------------------------------------------------

const textEquals: Validator = {
  name: "text.equals",
  needsTarget: true,
  comparisons: ["equals"],
  observationKind: "web",
  validate: (expectation, observation): AssertionResult => {
    const target = typeof expectation["target"] === "string" ? expectation["target"] : null;
    const expected = expectation["equals"];
    const values = (observation.data as { values?: Record<string, unknown> }).values ?? {};
    const actual = target === null ? undefined : values[target];
    return {
      validator: "text.equals",
      target,
      status: actual === expected ? "PASS" : "FAIL",
      actual: actual ?? null,
      expected,
      message: actual === expected ? null : `expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual ?? null)}`,
    };
  },
};

const registry = (): ValidatorRegistry => new ValidatorRegistry([textEquals]);

const contract = (evidence: readonly string[] = ["screenshot"]): AcceptanceContract => ({
  version: 1,
  goalId: "shopping-cart",
  criteria: [
    {
      id: "AC-001",
      description: "the cart total reflects the items added",
      mandatory: true,
      steps: [{ goto: "http://127.0.0.1:4173" }],
      expect: [{ validator: "text.equals", target: "#total", equals: "$30.00" }],
      evidence: evidence as readonly "screenshot"[],
    },
  ],
});

const reproducibility: ReproducibilityRecord = {
  capturedAt: "2026-01-01T00:00:00.000Z",
  platform: "win32",
  arch: "x64",
  node: "v22.18.0",
  veridian: "0.1.0",
  gitCommit: null,
  gitDirty: null,
  playwright: null,
  browser: null,
  timezone: "UTC",
  networkPolicy: "deny",
  env: {},
};

const detectorContext: DetectorContext = {
  registeredValidators: ["text.equals"],
  validatorDescriptors: [{ name: "text.equals", needsTarget: true, comparisons: ["equals"] }],
  registeredAdapters: ["scripted"],
  sourceLabel: "test",
};

interface Harness {
  readonly engine: ClarificationEngine;
  run(world: WorldPort, gate: RepairGate, overrides?: { readonly maxRuntimeMs?: number }): Promise<LoopResult>;
}

/**
 * The harness builds a fresh run per call, because two runs sharing one `RunBundle` would write into
 * one directory and every assertion about the bundle would be about the wrong run.
 */
function harness(): Harness {
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), logger: silentLogger });
  let counter = 0;
  return {
    engine,
    run: (world, gate, overrides = {}) => {
      counter += 1;
      return runIntoBundle({
        io: memoryIo(),
        runId: `run-${String(counter)}`,
        world,
        gate,
        clarifier: engine,
        overrides,
      });
    },
  };
}

/**
 * Run the loop into a bundle the caller keeps a handle on.
 *
 * `harness()` hides the io because most assertions here are about the returned result. The tests that
 * read an artifact need the io and the run id, and two copies of this configuration block would
 * drift - one of them would quietly stop matching the loop's real inputs.
 */
async function runIntoBundle(input: {
  readonly io: MemoryIo;
  readonly runId: string;
  readonly world: WorldPort;
  readonly gate: RepairGate;
  readonly clarifier: ClarificationEngine;
  readonly overrides?: {
    readonly maxRuntimeMs?: number;
    /** A violation the caller states itself, as a supervising harness may: the loop's injection point. */
    readonly injectedViolation?: string;
  };
}): Promise<LoopResult> {
  const bundle = new RunBundle({
    io: input.io,
    layout: bundleLayout(".veridian", input.runId),
    clock: fixedClock(),
  });
  return await runValidationLoop({
    io: input.io,
    clock: fixedClock(),
    logger: silentLogger,
    world: input.world,
    registry: registry(),
    plan: buildValidationPlan(contract(), { registry: registry(), maxCriterionMs: limits.maxCriterionMs }),
    environment: environmentPlan,
    // Explicit rather than a spread: `overrides` now carries a non-limit key, and a spread would
    // silently add it to the limits object the loop reads its budgets from.
    limits: { ...limits, maxRuntimeMs: input.overrides?.maxRuntimeMs ?? limits.maxRuntimeMs },
    safetyViolation: input.overrides?.injectedViolation ?? null,
    clarifier: input.clarifier,
    detectorContext,
    repairGate: input.gate,
    bundle,
    run: createRunHandle({
      clock: fixedClock(),
      runId: input.runId,
      goalId: "shopping-cart",
      maxIterations: limits.maxIterations,
    }),
    reproducibility,
    definitionReports: [],
  });
}

const repaired = (): RepairOutcome => ({ decision: "repaired", note: "the agent changed the total" });

describe("the loop never iterates without a reason to believe something changed", () => {
  it("runs exactly one iteration under a no-repair gate and ends FAIL in ABORTED", async () => {
    const world = scriptedWorld({ totals: ["$25.00"] });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.verdict, "FAIL");
    // ABORTED, not MAX_ITERATIONS: the budget was never touched. The run stopped because there was
    // no repair path, and the two are different facts an operator needs told apart.
    assert.equal(result.state, "ABORTED");
    assert.equal(world.observations, 1, "unchanged code must not be observed a second time");
    assert.equal(world.resets, 0, "there is nothing to reset when there is nothing to repair");
    assert.equal(result.iterations.length, 1);
    assert.equal(result.iterations[0]?.repaired, false);
  });

  it("records the reason it stopped in the bundle rather than leaving it as an absence", async () => {
    const world = scriptedWorld({ totals: ["$25.00"] });
    const result = await harness().run(world, new NoRepairGate());

    // The reasons array *is* the exit explanation; an empty one would mean the loop stopped for a
    // reason nobody wrote down, which is indistinguishable from a crash.
    assert.ok(result.reasons.length > 0);
    assert.match(result.reasons.join(" "), /repair gate|unchanged/i);
  });

  it("turns a FAIL into a PASS only after a repair, and re-observes from a reset world", async () => {
    const world = scriptedWorld({ totals: ["$25.00", "$30.00"] });
    const gate = new ScriptedRepairGate([repaired()]);
    const result = await harness().run(world, gate);

    assert.equal(result.verdict, "PASS");
    assert.equal(result.state, "COMPLETED");
    assert.equal(world.observations, 2, "the repaired application must actually be observed again");
    assert.equal(world.resets, 1, "a second observation of a mutated world proves nothing");
    assert.equal(result.iterations.length, 2);
    assert.equal(result.iterations[0]?.verdict, "FAIL");
    assert.equal(result.iterations[1]?.verdict, "PASS");
  });

  it("records the resets it performed, because an environment record is a reading and not a snapshot", async () => {
    // The world is prepared once and reset between iterations, so a record built *before* the loop
    // describes the world the run started in and stops at `ready` no matter how many times the loop
    // resets afterwards. The canonical four-iteration demo resets three times and its bundle recorded
    // a world whose last event was `ready` before the first observation, so M4 - which counts
    // `from: "resetting"` transitions - reported the reset it had been told never happened. The frozen
    // record and the run are two accounts of one fact; only one of them was observed.
    const io = memoryIo();
    const world = scriptedWorld({ totals: ["$25.00", "$30.00"] });
    await runIntoBundle({
      io,
      runId: "run-reset",
      world,
      gate: new ScriptedRepairGate([repaired()]),
      clarifier: new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), logger: silentLogger }),
    });

    const parsed = JSON.parse(io.files.get("virtual/.veridian/runs/run-reset/result.json") ?? "null") as {
      environment?: { transitions?: readonly { from: string; to: string }[] };
    } | null;
    const transitions = parsed?.environment?.transitions ?? [];

    assert.equal(world.resets, 1, "the fixture must actually have reset the world");
    assert.equal(
      transitions.filter((entry) => entry.from === "resetting").length,
      world.resets,
      "every reset the world performed is in the record",
    );
    assert.equal(
      transitions[transitions.length - 1]?.to,
      "ready",
      "the record ends where the world is, not where it started",
    );
  });

  it("rewrites environment.json, so one directory does not hold two readings of one fact", async () => {
    // `environment.json` is written at prepare, which is what makes it readable by someone watching a
    // run in progress - but it then stands still while the run goes on. Left alone, the bundle ends up
    // with this file claiming the world never reset and `result.json` listing three resets, and a
    // reader has no way to know which to believe. Both are now the same reading.
    const io = memoryIo();
    const world = scriptedWorld({ totals: ["$25.00", "$30.00"] });
    await runIntoBundle({
      io,
      runId: "run-agree",
      world,
      gate: new ScriptedRepairGate([repaired()]),
      clarifier: new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), logger: silentLogger }),
    });

    const environmentJson = JSON.parse(
      io.files.get("virtual/.veridian/runs/run-agree/environment.json") ?? "null",
    ) as { transitions?: readonly unknown[] } | null;
    const resultJson = JSON.parse(
      io.files.get("virtual/.veridian/runs/run-agree/result.json") ?? "null",
    ) as { environment?: { transitions?: readonly unknown[] } } | null;

    assert.ok(environmentJson !== null, "the environment record is part of the bundle");
    assert.deepEqual(
      environmentJson.transitions,
      resultJson?.environment?.transitions,
      "the two records of the environment must agree",
    );
  });

  it("stops at MAX_ITERATIONS when the gate claims a repair it never made", async () => {
    // The pathological case: a gate that always says "repaired" while the application never changes.
    // The attempt bound is the only thing standing between this and an unbounded run.
    const always = Array.from({ length: 20 }, repaired);
    const world = scriptedWorld({ totals: ["$25.00"] });
    const result = await harness().run(world, new ScriptedRepairGate(always));

    assert.equal(result.verdict, "FAIL");
    assert.equal(result.state, "MAX_ITERATIONS");
    assert.equal(result.iterations.length, limits.maxIterations);
    assert.equal(world.observations, limits.maxIterations);
  });
});

describe("the loop is bounded by two independent exits", () => {
  it("still stops on the attempt count when the clock never advances", async () => {
    // A frozen clock is the case that breaks a purely time-based bound: `elapsedMs` is always 0, so
    // the runtime exit is unreachable. If the loop relied on it, this test would never return.
    const always = Array.from({ length: 20 }, repaired);
    const world = scriptedWorld({ totals: ["$25.00"] });
    const result = await harness().run(world, new ScriptedRepairGate(always), { maxRuntimeMs: 0 });

    assert.equal(result.state, "MAX_ITERATIONS");
    assert.equal(result.iterations.length, limits.maxIterations);
  });

  it("reports the elapsed budget in the bundle so a bounded run is auditable, not merely claimed", async () => {
    const world = scriptedWorld({ totals: ["$30.00"] });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(typeof result.elapsedMs, "number");
    assert.ok(result.elapsedMs >= 0);
  });
});

describe("indeterminacy is recorded, never rounded up to success", () => {
  it("keeps a criterion with missing evidence INCONCLUSIVE even though every assertion passed", async () => {
    // The application is correct and the assertion agrees. The proof is absent, so the criterion is
    // not proven — and an unproven pass is not a pass.
    const world = scriptedWorld({ totals: ["$30.00"], produces: [] });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.criteria[0]?.status, "INCONCLUSIVE");
    assert.notEqual(result.verdict, "PASS");
    assert.deepEqual(result.criteria[0]?.missingEvidence, ["screenshot"]);
  });

  it("reads a bare throw from the world as a failed observation, not as success", async () => {
    const world = scriptedWorld({ totals: [new Error("the element never appeared")] });
    const result = await harness().run(world, new NoRepairGate());

    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.criteria[0]?.status, "FAIL");
    // The caller declares the layer, because it is the only layer that knows. A bare throw from
    // `execute` is the application-or-harness layer, so it stays `TEST_FAILURE` — not "unknown".
    assert.equal(result.criteria[0]?.assertions[0]?.failureKind, "TEST_FAILURE");
  });

  it("reads a typed environment failure as INCONCLUSIVE rather than as a test failure", async () => {
    // The distinction this asserts is the whole point of the taxonomy: "the browser could not
    // launch" must not send an external agent to repair an application that was never observed.
    const world = scriptedWorld({ totals: [new EnvironmentError("the browser could not launch")] });
    const result = await harness().run(world, new NoRepairGate());

    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.criteria[0]?.status, "INCONCLUSIVE");
    assert.equal(result.criteria[0]?.assertions[0]?.failureKind, "ENVIRONMENT_FAILURE");
    assert.equal(world.observations, 1);
  });

  it("refuses to pass a run whose world could not be prepared", async () => {
    const world = scriptedWorld({ totals: ["$30.00"], failPrepare: "port 4173 is occupied" });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.equal(result.state, "ABORTED");
    assert.equal(result.environmentValid, false);
    assert.equal(result.criteria.length, 0, "a criterion measured in a broken world is not a measurement");
  });

  it("refuses to pass a run whose world could not be reset", async () => {
    const world = scriptedWorld({ totals: ["$25.00", "$30.00"], failReset: "the snapshot is gone" });
    const result = await harness().run(world, new ScriptedRepairGate([repaired()]));

    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.environmentValid, false);
    assert.match(result.reasons.join(" "), /reset/i);
  });

  it("treats a repair gate that throws as no repair at all", async () => {
    const broken: RepairGate = {
      kind: "command",
      repair: () => Promise.reject(new Error("the repair command vanished")),
    };
    const world = scriptedWorld({ totals: ["$25.00"] });
    const result = await harness().run(world, broken);

    // The dangerous alternative: reading the throw as "work was done" would hand an external actor a
    // way to convert a failure into another iteration, and iterations can become PASS.
    assert.equal(result.verdict, "FAIL");
    assert.equal(world.observations, 1);
    assert.match(result.reasons.join(" "), /repair gate failed/);
  });
});

describe("the runtime protocol resolves without interrupting anyone", () => {
  it("never asks a question, even though it asks itself one every iteration", async () => {
    const h = harness();
    const world = scriptedWorld({ totals: ["$30.00"], produces: [] });
    await h.run(world, new NoRepairGate());

    // Both runtime questions fire in this run — the iteration decision and the missing-evidence note
    // — and neither may reach a human. A run's indeterminacy belongs in the bundle, not in a prompt.
    assert.equal(h.engine.questionsAsked, 0);
  });

  it("writes the self-resolved clarifications into the run directory", async () => {
    const io = memoryIo();
    const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), logger: silentLogger });
    const world = scriptedWorld({ totals: ["$30.00"], produces: [] });
    const bundle = new RunBundle({ io, layout: bundleLayout(".veridian", "run-1"), clock: fixedClock() });

    await runValidationLoop({
      io,
      clock: fixedClock(),
      logger: silentLogger,
      world,
      registry: registry(),
      plan: buildValidationPlan(contract(), { registry: registry(), maxCriterionMs: limits.maxCriterionMs }),
      environment: environmentPlan,
      limits,
      clarifier: engine,
      detectorContext,
      repairGate: new NoRepairGate(),
      bundle,
      run: createRunHandle({ clock: fixedClock(), runId: "run-1", goalId: "shopping-cart", maxIterations: limits.maxIterations }),
      reproducibility,
      definitionReports: [],
    });

    const raw = io.files.get("virtual/.veridian/runs/run-1/clarifications.json");
    assert.ok(raw !== undefined, "the protocol's audit trail must be in the bundle");
    const parsed = JSON.parse(raw) as { records?: readonly unknown[] };
    assert.ok((parsed.records ?? []).length > 0, "a run that resolved questions must record them");
  });

  it("records the decision in a summary the bundle can be read from", async () => {
    const world = scriptedWorld({ totals: ["$30.00"] });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.iterations[0]?.verdict, "PASS");
    assert.equal(result.iterations[0]?.passed, 1);
    assert.equal(result.iterations[0]?.failed, 0);
  });

  it("names the criteria behind the counts, because a total cannot say which one moved", async () => {
    // The three counts are the loop's own summary of a verdict, and they are lossy by construction:
    // three passes are three passes whether AC-001 or AC-004 is the one that passed. Every consumer
    // that has to tell two runs apart - repeat-run consistency (M1) above all - needs the names, and
    // the bundle keeps only the final iteration's per-criterion detail, so a count that is not backed
    // by a list leaves the earlier iterations unrecoverable.
    const world = scriptedWorld({ totals: ["$30.00"] });
    const result = await harness().run(world, new NoRepairGate());

    const summary = result.iterations[0];
    assert.ok(summary !== undefined, "the run recorded an iteration");
    assert.deepEqual(
      summary.criteria.map((entry) => entry.criterionId),
      ["AC-001"],
      "every criterion the contract declares is named, not only the ones that failed",
    );

    // The list is the counts, spelled out. Asserting the agreement here is what stops the two
    // representations from drifting into disagreeing about the same iteration.
    const count = (status: string): number => summary.criteria.filter((entry) => entry.status === status).length;
    assert.equal(count("PASS"), summary.passed);
    assert.equal(count("FAIL"), summary.failed);
    assert.equal(summary.criteria.length - count("PASS") - count("FAIL"), summary.undecided);
  });
});

describe("the loop judges the run's own boundary history", () => {
  /**
   * The crossing the demo's world never produces, spelled out so it is a fixture and not an anecdote.
   *
   * `criterionId` is set because that is what the adapter observes: it collects a refusal while
   * observing a named criterion, and the sentence the operator reads says so.
   */
  const crossed = (): NonNullable<WorldScript["crossings"]> => [
    { subject: "GET https://cdn.example.com/analytics.js", criterionId: "AC-001", at: "2026-01-01T00:00:01.000Z" },
  ];

  it("fails a run whose world reports a crossing, even though every criterion passed", async () => {
    // The criteria all pass. That is the case worth testing: before this, `safetyViolation` was a loop
    // *input* that the CLI never set, so the third clause of the PASS rule - "there was no safety
    // violation" - was satisfied by construction. A guard nobody can trip is not a guard.
    const world = scriptedWorld({ totals: ["$30.00"], crossings: crossed() });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.guards.noSafetyViolation, false);
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.failure?.kind, "SECURITY_VIOLATION");
  });

  it("names the request that crossed, in the words the bundle uses", async () => {
    const world = scriptedWorld({ totals: ["$30.00"], crossings: crossed() });
    const result = await harness().run(world, new NoRepairGate());

    const reason = result.reasons.join(" ");
    assert.match(reason, /GET https:\/\/cdn\.example\.com\/analytics\.js/);
    assert.match(reason, /AC-001/, "a violation is only actionable if it says which criterion it happened in");
  });

  it("still fails when the caller injected a violation and the world reports none", async () => {
    // The injection point is kept, not replaced. A supervising harness may know of a violation
    // Veridian's own adapters cannot see, and the two readings union rather than one winning.
    const world = scriptedWorld({ totals: ["$30.00"] });
    const result = await runIntoBundle({
      io: memoryIo(),
      runId: "run-injected",
      world,
      gate: new NoRepairGate(),
      clarifier: new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), logger: silentLogger }),
      overrides: { injectedViolation: "a policy refused the write" },
    });

    assert.equal(result.guards.noSafetyViolation, false);
    assert.match(result.reasons.join(" "), /a policy refused the write/);
  });

  it("keeps reporting the crossing after a reset, because a reset restores the world and not the record", async () => {
    // Iteration 1 crosses; iteration 2 does not, because the repair removed the outbound request. The
    // crossing is still the run's: an observed violation that a later edit erased from the report
    // would make the report depend on when it was read, which is the one thing evidence cannot do.
    const world = scriptedWorld({ totals: ["$25.00", "$30.00"], crossings: crossed() });
    const result = await harness().run(world, new ScriptedRepairGate([repaired()]));

    assert.equal(world.resets, 1, "the run really did reset and re-observe");
    assert.equal(result.iterations[1]?.verdict, "FAIL");
    assert.equal(result.guards.noSafetyViolation, false);
  });

  it("does not import a violation from a world that reports none", async () => {
    // The negative control. Without it, a `safetyState` that returned a truthy constant would satisfy
    // every test above and fail this one.
    const world = scriptedWorld({ totals: ["$30.00"] });
    const result = await harness().run(world, new NoRepairGate());

    assert.equal(result.guards.noSafetyViolation, true);
    assert.equal(result.verdict, "PASS");
  });
});
