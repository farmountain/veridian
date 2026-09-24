/**
 * The clarification ladder proved against its own registers.
 *
 * `docs/GAP-CLOSURE-PLAN.md` Task 10 asks for a proof rather than a redesign, because
 * `docs/GAP-CLOSURE-DESIGN.md` section 5 forbids designing what sections 2.1 to 2.4 already
 * measure as implemented. Three vocabularies are written once in `core/clarification/types.ts` and
 * consumed by code that nothing reconciles with them: `AMBIGUITY_ORIGINS`, `RUNGS` and
 * `DEFER_REASONS`. Each is asserted here by *driving* the thing it names - the detector tables, the
 * engine, and a port that declines every gap - rather than by re-listing it beside itself.
 * A list of names in a test is a claim about the code, and the only way to hold one is to make the
 * code answer the question.
 *
 * It is a sibling of `runtime-report-slices.test.ts` rather than an addition to it on purpose. That
 * file reads `RUNGS` for a different property - the arithmetic a bundle's clarification counters
 * have to satisfy - and bolting the vocabulary onto it would give one file two subjects, which is
 * how the assertion that fails stops naming what it was about.
 *
 * Three things are worth recording because they are claims about the code that this pass measured.
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
 *  - **Three bounds are declared, and the clock was the one no test held.** `#selfPromptFor` caps
 *    attempts per gap, rounds per run, and wall clock, and its own doc block gives the third a job
 *    the other two cannot do: an attempt bound cannot stop a frozen or injected clock, and an
 *    unbounded loop is the one failure mode this system may not have. The two attempt caps are held
 *    above. The ceiling is held by the test below, on a ceiling already reached, because that is the
 *    only input that can see where its check sits relative to the spend.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ClarificationEngine, NullPromptPort, scriptedPromptPort } from "../core/clarification/engine.ts";
import type { ClarificationEngineDeps } from "../core/clarification/engine.ts";
import { allDetectors, runtimeDetectors } from "../core/clarification/detect.ts";
import type { DetectorContext, ExecutionLike, IterationLike } from "../core/clarification/detect.ts";
import {
  AMBIGUITY_ORIGINS,
  DEFAULT_CLARIFICATION_POLICY,
  DEFER_REASONS,
  RUNGS,
} from "../core/clarification/types.ts";
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

    // A rung is entered at most once per gap, and in the register's order, which is structural: the
    // walk records the rung before giving it its chance, and `deferred` is always last because a gap
    // that reached it has nowhere else to go. This is deliberately *not* the claim "asked at most
    // once" - rung 4 asks its port again while the port declines, and the attempt caps below are
    // what bound that. So this asserts the record of the walk, and those assert the loop.
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

/**
 * Where rung 4 is reachable, proved by driving the real detector table rather than a fixture.
 *
 * The rung's own doc block states the rule it obeys: it fires "exactly where the ladder previously
 * had to ask a human or give up", because "a detector that declared a fail-safe default has already
 * reasoned about that gap ... so a self-generated answer may not displace it". That rule has a
 * consequence nobody had written down, and this test is where it is written down and measured.
 *
 * `failSafeDefault` always supplies both halves rung 3 requires, and all three runtime detectors
 * spread it into their gaps - so at run time rung 3 closes every gap, rung 4 is one rung below a
 * rung that never falls through, and `selfPromptRounds` is zero for the entire run. The rung is
 * reachable, but only at DEFINE time, on a blocking gap that declares no default: exactly the gaps
 * a human would otherwise have been interrupted for.
 *
 * The second consequence is a piece of dead data. `detectIterationAmbiguities` is the only runtime
 * detector that declares `candidates`, and it also declares a default - so the candidate set is set
 * for a reader the ladder never consults. The assertion below is the call count, not a comment: a
 * port that would have been asked nothing records nothing.
 */
test("closes every run-time gap one rung above the self-prompt, so the rung is a DEFINE-time seam", async () => {
  const ctx: DetectorContext = {
    registeredValidators: [],
    validatorDescriptors: [],
    registeredAdapters: [],
    sourceLabel: "runtime-report",
  };

  // Real detectors, real inputs: one criterion that produced no observation, one that is missing
  // required evidence, and one finished iteration. No fixture stands in for a detector.
  const execution: ExecutionLike = {
    criteria: [
      { criterionId: "AC-001", status: "INCONCLUSIVE", observationError: "the browser port is absent" },
      { criterionId: "AC-002", status: "PASS", missingEvidence: ["json"] },
    ],
  };
  const iteration: IterationLike = {
    iteration: 1,
    maxIterations: 3,
    elapsedMs: 10,
    maxRuntimeMs: 60_000,
    verdict: "FAIL",
    repairGate: "command",
  };

  const raised = [
    ...runtimeDetectors()
      .filter((entry) => entry.origin !== "iteration")
      .flatMap((entry) => entry.detect(execution, ctx)),
    ...runtimeDetectors()
      .filter((entry) => entry.origin === "iteration")
      .flatMap((entry) => entry.detect(iteration, ctx)),
  ];

  assert.deepEqual(
    [...new Set(raised.map((gap) => gap.origin))].sort(),
    runtimeDetectors()
      .map((entry) => entry.origin)
      .sort(),
    "every runtime detector raised a gap, so the claims below are about all three and not one of them",
  );

  // Read off the gaps rather than restated: rung 3 needs both halves, and a run-time gap that
  // lacked either would fall through to rung 4 and make this test's subject disappear.
  for (const gap of raised) {
    assert.notEqual(
      gap.defaultValue,
      undefined,
      `the ${gap.origin} detector declares a fail-safe default, which is what rung 3 acts on`,
    );
    assert.ok(
      gap.defaultRationale,
      `the ${gap.origin} detector supplies the rationale rung 3 requires, so rung 3 accepts it`,
    );
  }

  let prompts = 0;
  const engine = new ClarificationEngine({
    user: NullPromptPort,
    clock: fixedClock(),
    selfPrompt: {
      available: true,
      prompt: () => {
        prompts += 1;
        return Promise.resolve(null);
      },
    },
  });
  const outcome = await engine.resolve({}, raised);

  assert.equal(
    prompts,
    0,
    "no run-time gap reaches the self-prompting rung: the declared default closes each one a rung earlier",
  );
  assert.equal(
    outcome.report.selfPromptRounds,
    0,
    "so the cost the rung's bounds exist to cap is zero for a whole run's run-time phase",
  );
  assert.equal(outcome.report.byVia.self_prompted, 0, "and the report says so in the vocabulary it keeps");
  assert.equal(
    outcome.report.byVia.defaulted,
    raised.length,
    "every run-time gap is closed by the fail-safe default its detector declared",
  );

  // The candidate vocabulary is the dead half. It is declared on the gap and read by no rung the
  // ladder reaches, which is the assertion `prompts === 0` above already makes in code.
  const decided = raised.find((gap) => gap.origin === "iteration");
  assert.ok(decided, "the iteration decision is one of the gaps a runtime detector raised");
  assert.deepEqual(
    [...(decided.candidates ?? [])],
    ["complete", "continue", "stop"],
    "the iteration gap offers an enumerable choice, which is the shape a self-prompt could answer",
  );
  assert.equal(
    prompts,
    0,
    "and it is offered to a rung that is never consulted for it - the candidates are declared for no reader",
  );

  // The other side of the seam: a blocking gap with no declared default, which is what a DEFINE-time
  // detector raises. This is the interruption the rung exists to remove, and the human is not asked.
  const blockingNoDefault = goalGap();
  let definePrompts = 0;
  const defineEngine = new ClarificationEngine({
    user: scriptedPromptPort({ [blockingNoDefault.id]: "cart" }),
    clock: fixedClock(),
    selfPrompt: {
      available: true,
      prompt: () => {
        definePrompts += 1;
        return Promise.resolve({ value: "cart", confidence: 0.95, grounds: "/x" });
      },
    },
  });
  const defineOutcome = await defineEngine.resolve({}, [blockingNoDefault]);

  assert.equal(definePrompts, 1, "a blocking gap with no declared default does reach the rung");
  assert.equal(
    defineOutcome.report.records[0]?.resolution.via,
    "self_prompted",
    "and the run answers from what it already holds rather than from a conservative default",
  );
  assert.equal(
    defineOutcome.report.questionsAsked,
    0,
    "so the human the ladder would have interrupted is not interrupted, which is the only thing the rung buys",
  );
});

/**
 * The third bound, held on a ceiling already reached.
 *
 * `#selfPromptFor` is bounded three ways, and the doc block on it gives the wall clock a job neither
 * attempt cap can do: "the clock survives a frozen or injected one - which is the only exit an
 * attempt bound cannot provide, and an unbounded loop is the one failure mode this system may not
 * have." Two of the three bounds are held by the tests above. This one holds the third, and it uses
 * the degenerate input for the same reason the per-run cap does: with a ceiling that is *not* already
 * reached, moving the check below the spend changes nothing observable, because the per-gap cap would
 * have stopped the loop anyway. The only input that can see the placement is a budget of zero.
 *
 * The positive control beside it is what makes an empty ask list evidence rather than a claim. A
 * fixture that cannot ask and a fixture the ceiling stopped are identical from the outside, so the
 * second engine is the first with exactly one value changed - the budget left at its registered
 * default - and it must ask. Section 8 of the plan this file was written for names both shapes: a
 * test that passes whether or not the rule holds is not a test, and every negative needs a control.
 */
test("checks the wall-clock ceiling before spending a round, on a ceiling already reached", async () => {
  const build = (selfPromptBudgetMs: number) => {
    let asked = 0;
    const engine = new ClarificationEngine({
      user: NullPromptPort,
      clock: fixedClock(),
      selfPrompt: {
        available: true,
        prompt: () => {
          asked += 1;
          return Promise.resolve(null);
        },
      },
      policy: { selfPromptBudgetMs },
    });
    return { engine, asked: () => asked };
  };

  // Read off the register rather than restated. If either attempt cap were zero the clock would not
  // be the bound under test, and this test would pass for a reason that has nothing to do with it.
  assert.ok(
    DEFAULT_CLARIFICATION_POLICY.maxSelfPromptRoundsPerAmbiguity > 0 &&
      DEFAULT_CLARIFICATION_POLICY.maxSelfPromptRoundsPerRun > 0,
    "both attempt caps are above zero, so neither can be the bound that stops the attempt below",
  );

  const exhausted = build(0);
  const stopped = await exhausted.engine.resolve({}, [goalGap()]);
  const record = stopped.report.records[0];

  assert.ok(record, "a gap the clock stopped is still recorded");
  assert.equal(
    exhausted.asked(),
    0,
    "a ceiling already reached spends nothing: every bound is compared before the attempt, so the worst case is a bound reached rather than one that is one over",
  );
  assert.equal(stopped.report.selfPromptRounds, 0, "and no round is charged anywhere");
  assert.equal(stopped.report.byVia.self_prompted, 0, "no answer is recorded for it");
  assert.deepEqual(
    record.rungsAttempted,
    ["self_prompted", "deferred"],
    "the rung is still entered and recorded, so an attempt the clock stopped is not reported as a rung that was skipped",
  );

  // The positive control: one value differs from the fixture above, and it must ask.
  const running = build(DEFAULT_CLARIFICATION_POLICY.selfPromptBudgetMs);
  const spent = await running.engine.resolve({}, [goalGap()]);

  assert.equal(
    running.asked(),
    DEFAULT_CLARIFICATION_POLICY.maxSelfPromptRoundsPerAmbiguity,
    "with the ceiling unreached the same fixture asks, and the per-gap cap is what stops it",
  );
  assert.equal(
    spent.report.selfPromptRounds,
    DEFAULT_CLARIFICATION_POLICY.maxSelfPromptRoundsPerAmbiguity,
    "so the zero above is the clock's doing rather than a fixture that cannot ask",
  );
  assert.equal(
    spent.report.byVia.deferred,
    1,
    "and the gap still defers, which is where a gap no rung could close goes",
  );
});
