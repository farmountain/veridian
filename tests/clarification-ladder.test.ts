/**
 * The clarification ladder proved against its own registers.
 *
 * `docs/GAP-CLOSURE-PLAN.md` Task 10 asks for a proof rather than a redesign, because
 * `docs/GAP-CLOSURE-DESIGN.md` section 5 forbids designing what sections 2.1 to 2.4 already
 * measure as implemented. Three vocabularies are written once in `core/clarification/types.ts` and
 * consumed by code that nothing reconciles with them: `AMBIGUITY_ORIGINS`, `RUNGS` and
 * `DEFER_REASONS`. Each is asserted here by *driving* the thing it names - the detector tables, the
 * engine, and the port the engine refuses to loop on - rather than by re-listing it beside itself.
 * A list of names in a test is a claim about the code, and the only way to hold one is to make the
 * code answer the question.
 *
 * It is a sibling of `runtime-report-slices.test.ts` rather than an addition to it on purpose. That
 * file reads `RUNGS` for a different property - the arithmetic a bundle's clarification counters
 * have to satisfy - and bolting the vocabulary onto it would give one file two subjects, which is
 * how the assertion that fails stops naming what it was about.
 *
 * Two things are worth recording because they are claims about the code that this pass measured.
 *
 *  - **The plan's own Step 3 expects `ABORTED`, and the code reports `INCONCLUSIVE`.** An unbounded
 *    self-prompting loop is the failure mode the step exists to rule out, and that part holds: the
 *    bound is reached and the gap is deferred. But the run-level reading of a deferred *blocking*
 *    gap is `INCONCLUSIVE`, not `ABORTED`: `core/execution/loop.ts` turns leftover blocking gaps
 *    into `insufficientInformation`, and `core/validation/rollup.ts` answers the
 *    `informationSufficient` guard with `INCONCLUSIVE` and the reason *"Insufficient information to
 *    reach a verdict."* `ABORTED` is what a run reports when its *environment* could not be
 *    prepared. The assertion below is the measured one; the plan's sentence is left standing in the
 *    plan because it is a record of what was intended, and this doc block is where the difference
 *    is stated rather than discovered twice.
 *  - **The per-run cap is checked before the increment, and the case that proves it is a cap of
 *    zero.** With a positive cap the two placements differ only in a boundary the per-gap cap
 *    happens to cover, so a test built from a positive cap passes with the check moved below the
 *    increment. A cap already reached - `maxSelfPromptRoundsPerRun: 0` - asks the question the
 *    placement decides: nothing may be spent at all.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ClarificationEngine, NullPromptPort, scriptedPromptPort } from "../core/clarification/engine.ts";
import type { ClarificationEngineDeps } from "../core/clarification/engine.ts";
import { allDetectors, runtimeDetectors } from "../core/clarification/detect.ts";
import { AMBIGUITY_ORIGINS, DEFER_REASONS, RUNGS } from "../core/clarification/types.ts";
import type { Ambiguity, ClarificationRecord, Clock, Rung } from "../core/clarification/types.ts";
import { ambiguity } from "../core/clarification/types.ts";

/** Clock whose `now()` never advances, so no wall-clock budget is reached by accident. */
const fixedClock = (): Clock => ({ now: () => 1000, iso: () => "2025-01-01T00:00:00.000Z" });

const goalGap = (extra: Omit<Partial<Ambiguity>, "id"> = {}): Ambiguity =>
  ambiguity({
    origin: "goal",
    path: "/x",
    kind: "missing_value",
    question: "what does /x hold?",
    blocking: true,
    ...extra,
  });

/** Run one gap down the ladder and return the single record it produced. */
async function resolveOne(
  gap: Ambiguity,
  deps: Partial<ClarificationEngineDeps> = {},
): Promise<ClarificationRecord> {
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock(), ...deps });
  const outcome = await engine.resolve({}, [gap]);
  const record = outcome.report.records[0];
  assert.ok(record, "the ladder records a resolution for every gap it is handed");
  return record;
}

test("asks every origin's questions from exactly one detector table", () => {
  const define = allDetectors().map((entry) => entry.origin);
  const runtime = runtimeDetectors().map((entry) => entry.origin);

  assert.equal(
    new Set([...define, ...runtime]).size,
    define.length + runtime.length,
    "no origin is asked from both tables: a detector fired at the wrong kind of document is a question nobody meant to ask",
  );
  assert.deepEqual(
    [...new Set([...define, ...runtime])].sort(),
    [...AMBIGUITY_ORIGINS].sort(),
    "every origin the register declares is reachable, and the tables invent none",
  );
});

test("reaches every rung the register declares, and walks them in the register's order", async () => {
  const cases: { readonly rung: Rung; readonly resolve: () => Promise<ClarificationRecord> }[] = [
    {
      rung: "derived",
      resolve: () =>
        resolveOne(goalGap(), {
          derive: { derive: () => ({ value: "cart", evidence: "schema default" }) },
        }),
    },
    {
      rung: "inferred",
      resolve: () =>
        resolveOne(goalGap(), {
          infer: { infer: () => Promise.resolve({ value: "cart", confidence: 0.95, source: "memory" }) },
        }),
    },
    {
      rung: "defaulted",
      resolve: () =>
        resolveOne(
          goalGap({ defaultValue: "cart", defaultRationale: "a name cannot make a PASS more likely" }),
        ),
    },
    {
      rung: "self_prompted",
      resolve: async () => {
        const gap = goalGap();
        const engine = new ClarificationEngine({
          user: NullPromptPort,
          clock: fixedClock(),
          selfPrompt: {
            available: true,
            prompt: () => Promise.resolve({ value: "cart", confidence: 0.95, grounds: gap.path }),
          },
        });
        const outcome = await engine.resolve({}, [gap]);
        const record = outcome.report.records[0];
        assert.ok(record, "the self-prompting rung records its answer");
        return record;
      },
    },
    {
      rung: "answered",
      resolve: async () => {
        const gap = goalGap();
        return resolveOne(gap, { user: scriptedPromptPort({ [gap.id]: "cart" }) });
      },
    },
    { rung: "deferred", resolve: () => resolveOne(goalGap()) },
  ];

  const reached = new Set<Rung>();
  for (const entry of cases) {
    const record = await entry.resolve();

    assert.equal(
      record.resolution.via,
      entry.rung,
      `the case for "${entry.rung}" must be resolved by that rung`,
    );
    reached.add(entry.rung);

    // The ladder is a straight line. A rung attempted out of the register's order, or twice, is a
    // ladder that is not the one the register describes - and `deferred` is always last, because a
    // gap that reached it has nowhere else to go.
    const indices = record.rungsAttempted.map((rung) => RUNGS.indexOf(rung));
    assert.deepEqual(
      indices,
      [...indices].sort((a, b) => a - b),
      `"${entry.rung}" attempts its rungs in the register's order`,
    );
    assert.equal(
      indices.length,
      new Set(indices).size,
      `"${entry.rung}" attempts no rung twice`,
    );
  }

  assert.deepEqual(
    [...reached].sort(),
    [...RUNGS].sort(),
    "every rung in the register is reachable, so the register describes the ladder that runs",
  );
});

test("produces every deferral reason the register declares, and invents none", async () => {
  const cases: { readonly reason: string; readonly resolve: () => Promise<ClarificationRecord> }[] = [
    // A non-blocking gap reaches DEFER structurally: rung 5 is unreachable for it.
    { reason: "non_blocking", resolve: () => resolveOne(goalGap({ blocking: false })) },
    { reason: "no_user_available", resolve: () => resolveOne(goalGap()) },
    {
      reason: "low_confidence",
      resolve: () =>
        resolveOne(goalGap(), {
          infer: { infer: () => Promise.resolve({ value: "cart", confidence: 0.1, source: "memory" }) },
          user: scriptedPromptPort({}),
        }),
    },
    {
      reason: "no_default",
      resolve: () => resolveOne(goalGap(), { user: scriptedPromptPort({}) }),
    },
    {
      // A declared default with no rationale is ignored by rung 3 - the fail-safe rule - and the
      // gap is then deferred for the reason that its *author* left it underivable rather than
      // unanswerable.
      reason: "not_derivable",
      resolve: () =>
        resolveOne(goalGap({ defaultValue: "cart", defaultRationale: "" }), {
          user: scriptedPromptPort({}),
        }),
    },
    {
      reason: "time_budget_exhausted",
      resolve: async () => {
        let ticks = 0;
        const spending: Clock = {
          now: () => {
            const value = ticks * 120_000;
            ticks += 1;
            return value;
          },
          iso: () => "2025-01-01T00:00:00.000Z",
        };
        const engine = new ClarificationEngine({ user: NullPromptPort, clock: spending });
        const outcome = await engine.resolve({}, [goalGap()]);
        const record = outcome.report.records[0];
        assert.ok(record, "a gap deferred for time is still recorded");
        return record;
      },
    },
    {
      reason: "question_budget_exhausted",
      resolve: async () => {
        const gap = goalGap();
        const engine = new ClarificationEngine({
          user: scriptedPromptPort({ [gap.id]: "cart" }),
          clock: fixedClock(),
          policy: { maxQuestionsPerRun: 0 },
        });
        const outcome = await engine.resolve({}, [gap]);
        const record = outcome.report.records[0];
        assert.ok(record, "a gap the question budget never reached is recorded rather than dropped");
        return record;
      },
    },
  ];

  assert.deepEqual(
    [...new Set(cases.map((entry) => entry.reason))].sort(),
    [...DEFER_REASONS].sort(),
    "the cases below cover the register: a short table would prove less than it appears to",
  );

  const produced = new Set<string>();
  for (const entry of cases) {
    const record = await entry.resolve();
    assert.equal(record.resolution.via, "deferred", `the case for "${entry.reason}" defers`);
    assert.equal(
      record.resolution.via === "deferred" ? record.resolution.reason : null,
      entry.reason,
      `the case named "${entry.reason}" is deferred for that reason`,
    );
    if (record.resolution.via === "deferred") produced.add(record.resolution.reason);
  }

  assert.deepEqual(
    [...produced].sort(),
    [...DEFER_REASONS].sort(),
    "every reason in the register is producible, which is what makes it a vocabulary rather than a wish",
  );
});

test("reaches the per-gap bound rather than passing it, and defers", async () => {
  let attempts = 0;
  const never: ClarificationEngineDeps = {
    user: NullPromptPort,
    clock: fixedClock(),
    selfPrompt: {
      available: true,
      prompt: () => {
        attempts += 1;
        return Promise.resolve(null);
      },
    },
    policy: { maxSelfPromptRoundsPerAmbiguity: 2 },
  };

  const engine = new ClarificationEngine(never);
  const outcome = await engine.resolve({}, [goalGap()]);
  const record = outcome.report.records[0];

  assert.ok(record, "an exhausted gap is still recorded");
  assert.equal(record.resolution.via, "deferred", "an exhausted self-prompt defers rather than loops");
  assert.equal(
    attempts,
    2,
    "the bound is reached and not passed: the check runs before the attempt, so the worst case is a bound already reached",
  );
  assert.equal(outcome.report.selfPromptRounds, 2, "and the cost the report carries is the same bound");
  assert.deepEqual(
    record.rungsAttempted,
    ["self_prompted", "deferred"],
    "the rung was attempted and the gap then fell through to DEFER",
  );
});

test("spends no round at all when the per-run cap is already reached", async () => {
  let attempts = 0;
  const engine = new ClarificationEngine({
    user: NullPromptPort,
    clock: fixedClock(),
    selfPrompt: {
      available: true,
      prompt: () => {
        attempts += 1;
        return Promise.resolve(null);
      },
    },
    // A cap already reached. Moving the per-run check below the increment spends a round here and
    // nowhere else, which is what makes this the case that holds the placement.
    policy: { maxSelfPromptRoundsPerRun: 0 },
  });

  const outcome = await engine.resolve({}, [goalGap()]);

  assert.equal(attempts, 0, "a spent round budget is a bound that was reached, not one that is one over");
  assert.equal(outcome.report.selfPromptRounds, 0, "so no round is spent anywhere");
  assert.equal(
    outcome.report.records[0]?.resolution.via,
    "deferred",
    "and the gap goes where every unresolved gap goes",
  );
  assert.equal(
    outcome.report.unresolvedBlocking,
    1,
    "a deferred blocking gap leaves the run with insufficient information, which is what stops it reporting PASS",
  );
});
