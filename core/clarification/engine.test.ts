import assert from "node:assert/strict";
import test from "node:test";

import {
  ClarificationEngine,
  NullPromptPort,
  NullSelfPromptPort,
  scriptedPromptPort,
  scriptedSelfPromptPort,
} from "./engine.ts";
import { createDeriver, schemaDefaultRule, type IoPort } from "./derive.ts";
import {
  detectValidationAmbiguities,
  runtimeDetectors,
  type AcceptanceLike,
  type DetectorContext,
} from "./detect.ts";
import { getPointer, joinPointer, setPointer } from "./pointer.ts";
import { ambiguity, failSafeDefault, type Ambiguity, type Clock } from "./types.ts";

const nullIo: IoPort = {
  cwd: "/",
  readTextFile: () => Promise.resolve(null),
  exists: () => Promise.resolve(false),
};

/** Clock whose `now()` advances a fixed amount per call, so the wall-clock budget is reachable. */
function steppingClock(stepMs = 0): Clock {
  let ticks = 0;
  return {
    now() {
      const value = ticks * stepMs;
      ticks += 1;
      return value;
    },
    iso: () => new Date(0).toISOString(),
  };
}

const fixedClock = (): Clock => ({ now: () => 1000, iso: () => "2025-01-01T00:00:00.000Z" });

const goalAmbiguity = (path: string, extra: Partial<Ambiguity> = {}): Ambiguity =>
  ambiguity({
    origin: "goal",
    path,
    kind: "missing_value",
    question: `question for ${path}`,
    blocking: false,
    ...extra,
  });

test("rung 1 DERIVE wins over every later rung", async () => {
  const engine = new ClarificationEngine({
    derive: createDeriver([schemaDefaultRule()]),
    infer: {
      infer: () => Promise.resolve({ value: 99, confidence: 1, source: "memory" }),
    },
    user: scriptedPromptPort({}),
    clock: fixedClock(),
  });

  const outcome = await engine.resolve(
    { limits: {} },
    [goalAmbiguity("/limits/maxIterations")],
  );

  assert.equal(outcome.report.records[0]?.resolution.via, "derived");
  assert.equal(outcome.report.byVia.derived, 1);
  assert.equal(outcome.report.questionsAsked, 0, "a derivable gap must never cost a question");
  assert.equal(getPointer(outcome.artifact, "/limits/maxIterations"), 10);
  assert.deepEqual(outcome.report.records[0]?.rungsAttempted, ["derived"]);
});

test("derivation cites its evidence rather than asserting a value", async () => {
  const engine = new ClarificationEngine({
    derive: createDeriver([schemaDefaultRule()]),
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({ limits: {} }, [goalAmbiguity("/limits/networkPolicy")]);
  const resolution = outcome.report.records[0]?.resolution;
  assert.equal(resolution?.via, "derived");
  assert.match(
    resolution.via === "derived" ? resolution.evidence : "",
    /goal\.schema\.json/,
    "evidence must point at a checkable location",
  );
});

test("rung 2 INFER is accepted at the threshold and rejected below it", async () => {
  // A *present* prompt port, so that a low-confidence inference is attributed to the inference
  // rather than to there being nobody to ask.
  const run = async (confidence: number) => {
    const engine = new ClarificationEngine({
      infer: { infer: () => Promise.resolve({ value: "npm run dev", confidence, source: "prior run" }) },
      user: scriptedPromptPort({}),
      clock: fixedClock(),
    });
    return engine.resolve({}, [goalAmbiguity("/start", { blocking: true })]);
  };

  const accepted = await run(0.7);
  assert.equal(accepted.report.records[0]?.resolution.via, "inferred");

  const rejected = await run(0.69);
  assert.equal(rejected.report.records[0]?.resolution.via, "deferred");
  assert.equal(
    rejected.report.records[0]?.resolution.via === "deferred"
      ? rejected.report.records[0].resolution.reason
      : null,
    "low_confidence",
  );
});

test("rung 2 is not spent on non-blocking gaps", async () => {
  let inferenceCalls = 0;
  const engine = new ClarificationEngine({
    infer: {
      infer: () => {
        inferenceCalls += 1;
        return Promise.resolve({ value: "x", confidence: 1, source: "memory" });
      },
    },
    user: NullPromptPort,
    clock: fixedClock(),
  });

  await engine.resolve({}, [goalAmbiguity("/description", { blocking: false })]);
  assert.equal(inferenceCalls, 0, "inference costs an external call; cosmetics do not earn it");
});

test("rung 3 DEFAULT applies a fail-safe value and records the assumption", async () => {
  const base = goalAmbiguity("/health/path", {
    blocking: true,
    ...failSafeDefault("/", "a wrong probe yields ENVIRONMENT_FAILURE, which can never PASS"),
  });
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock() });

  const outcome = await engine.resolve({ health: {} }, [base]);
  const resolution = outcome.report.records[0]?.resolution;
  assert.equal(resolution?.via, "defaulted");
  assert.match(resolution.via === "defaulted" ? resolution.assumption : "", /ENVIRONMENT_FAILURE/);
  assert.equal(getPointer(outcome.artifact, "/health/path"), "/");
});

test("a default is ignored when it carries no rationale", async () => {
  // The type allows `defaultValue` without `defaultRationale`; the engine must refuse it, because
  // an unjustified default is exactly the silent guess the protocol exists to prevent.
  const unjustified: Ambiguity = {
    ...goalAmbiguity("/health/path", { blocking: true }),
    defaultValue: "/",
  };
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock() });

  const outcome = await engine.resolve({ health: {} }, [unjustified]);
  assert.equal(outcome.report.records[0]?.resolution.via, "deferred");
  assert.equal(outcome.report.unresolvedBlocking, 1);
});

test("a non-blocking gap never reaches a human", async () => {
  const prompt = scriptedPromptPort({});
  const engine = new ClarificationEngine({ user: prompt, clock: fixedClock() });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/description", { blocking: false }),
    goalAmbiguity("/tags", { blocking: false }),
  ]);

  assert.deepEqual(prompt.asked, [], "structural, not budgeted: non-blocking cannot reach ASK");
  assert.equal(outcome.report.questionsAsked, 0);
  assert.equal(outcome.report.unresolvedBlocking, 0, "non-blocking deferrals must not gate the run");
  assert.ok(
    outcome.deferred.every((entry) => entry.blocking === false),
    "deferred entries must be the non-blocking ones",
  );
});

test("rung 5 ASK is batched per round and answers become values", async () => {
  const answers: Record<string, string> = {
    "goal:/a:missing_value": "alpha",
    "goal:/b:missing_value": "beta",
    "goal:/c:missing_value": "gamma",
    "goal:/d:missing_value": "delta",
  };
  const prompt = scriptedPromptPort(answers);
  const engine = new ClarificationEngine({
    user: prompt,
    clock: fixedClock(),
    policy: { maxQuestionsPerRound: 2, maxQuestionsPerRun: 5 },
  });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/b", { blocking: true }),
    goalAmbiguity("/c", { blocking: true }),
    goalAmbiguity("/d", { blocking: true }),
  ]);

  assert.equal(outcome.report.questionsAsked, 4);
  assert.equal(outcome.report.rounds, 2, "questions must be batched, not asked one at a time");
  assert.equal(outcome.report.byVia.answered, 4);
  assert.equal(getPointer(outcome.artifact, "/a"), "alpha");
  assert.equal(getPointer(outcome.artifact, "/d"), "delta");
});

test("stop 1 - maxQuestionsPerRun caps interruptions and defers the remainder", async () => {
  const prompt = scriptedPromptPort({});
  const engine = new ClarificationEngine({
    user: prompt,
    clock: fixedClock(),
    policy: { maxQuestionsPerRun: 2, maxQuestionsPerRound: 2 },
  });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/b", { blocking: true }),
    goalAmbiguity("/c", { blocking: true }),
    goalAmbiguity("/d", { blocking: true }),
  ]);

  assert.equal(outcome.report.questionsAsked, 2);
  assert.equal(outcome.report.budgetExhausted, true);
  assert.equal(outcome.unasked.length, 2);
  assert.equal(outcome.report.unresolvedBlocking, 4, "unanswered questions must not become values");
  assert.equal(
    outcome.report.records.filter(
      (record) => record.resolution.via === "deferred" && record.resolution.reason === "question_budget_exhausted",
    ).length,
    2,
  );
});

test("stop 2 - the wall-clock budget ends the clarification phase", async () => {
  const engine = new ClarificationEngine({
    user: scriptedPromptPort({}),
    clock: steppingClock(1000),
    policy: { budgetMs: 500, maxQuestionsPerRun: 10 },
  });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/b", { blocking: true }),
    goalAmbiguity("/c", { blocking: true }),
  ]);

  assert.equal(outcome.report.budgetExhausted, true);
  assert.ok(
    outcome.report.records.some(
      (record) => record.resolution.via === "deferred" && record.resolution.reason === "time_budget_exhausted",
    ),
    "a slow external port must not stall the run",
  );
});

test("stop 3 - no user available defers rather than hanging", async () => {
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock() });
  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);

  assert.equal(
    outcome.report.records[0]?.resolution.via === "deferred"
      ? outcome.report.records[0].resolution.reason
      : null,
    "no_user_available",
  );
  assert.equal(outcome.report.questionsAsked, 0);
});

test("stop 4 - with no self-prompt port every rung is attempted once, so the ladder terminates itself", async () => {
  // Rung 4 is the one rung that may attempt the same gap more than once, so it is the one rung that
  // needs a budget - and its three bounds are exercised by the rung 4 suite below. Without a port the
  // ladder is a straight line, which is what this asserts.
  let deriveCalls = 0;
  const engine = new ClarificationEngine({
    derive: {
      derive: () => {
        deriveCalls += 1;
        return null;
      },
    },
    infer: { infer: () => Promise.resolve(null) },
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.equal(outcome.report.records.length, 1);
  assert.deepEqual(outcome.report.records[0]?.rungsAttempted, ["derived", "inferred", "deferred"]);
  assert.equal(deriveCalls, 1, "a rung is attempted at most once");
});

test("a deferred ambiguity leaves the artifact untouched", async () => {
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock() });
  const original = { a: 1 };
  const outcome = await engine.resolve(original, [goalAmbiguity("/a", { blocking: true })]);

  assert.deepEqual(outcome.artifact, { a: 1 });
  assert.equal(outcome.report.byVia.deferred, 1);
});

test("applying a resolution never mutates the artifact handed in", async () => {
  const engine = new ClarificationEngine({
    derive: createDeriver([schemaDefaultRule()]),
    user: NullPromptPort,
    clock: fixedClock(),
  });
  const original = { limits: {} };
  const outcome = await engine.resolve(original, [goalAmbiguity("/limits/maxIterations")]);

  assert.equal(getPointer(outcome.artifact, "/limits/maxIterations"), 10);
  assert.deepEqual(original, { limits: {} }, "the caller's artifact must be untouched");
});

test("a throwing derive port degrades to the next rung instead of failing the run", async () => {
  const engine = new ClarificationEngine({
    derive: {
      derive: () => {
        throw new Error("io exploded");
      },
    },
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.equal(outcome.report.records[0]?.resolution.via, "deferred");
});

test("id ordering makes the question sequence deterministic across runs", async () => {
  const build = () => [
    goalAmbiguity("/z", { blocking: true }),
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/m", { blocking: true }),
  ];
  const engine = new ClarificationEngine({ user: NullPromptPort, clock: fixedClock() });

  const first = await engine.resolve({}, build());
  const second = await engine.resolve({}, build());
  assert.deepEqual(
    first.report.records.map((record) => record.ambiguity.id),
    second.report.records.map((record) => record.ambiguity.id),
  );
});

test("pointer helpers round-trip escaped tokens and nested arrays", () => {
  const artifact = { criteria: [{ expect: [{ equals: "1" }] }], "a/b": { "~c": 7 } };
  assert.equal(getPointer(artifact, "/criteria/0/expect/0/equals"), "1");
  assert.equal(getPointer(artifact, joinPointer("a/b", "~c")), 7);

  const patched = setPointer(artifact, "/criteria/0/expect/0/equals", "2");
  assert.equal(getPointer(patched, "/criteria/0/expect/0/equals"), "2");
  assert.equal(getPointer(artifact, "/criteria/0/expect/0/equals"), "1", "setPointer must not mutate");
});

test("setPointer appends to a missing array position deterministically", () => {
  const patched = setPointer({ criteria: [] }, "/criteria/0/id", "AC-001");
  assert.deepEqual(patched, { criteria: [{ id: "AC-001" }] });
});

test("failSafeDefault refuses an empty rationale", () => {
  assert.throws(() => failSafeDefault("x", "   "), /non-empty rationale/);
});

// ---------------------------------------------------------------------------------------------
// Rung 4: SELF-PROMPT. The run asks itself before it asks a person.
// ---------------------------------------------------------------------------------------------

const selfAnswer = (value: unknown, confidence: number, grounds = "corroborated by the contract") => ({
  "goal:/a:missing_value": { value, confidence, grounds },
});

test("rung 4 fires before ASK, so a self-answerable gap never costs a question", async () => {
  const human = scriptedPromptPort({ "goal:/a:missing_value": "from-the-human" });
  const engine = new ClarificationEngine({
    selfPrompt: scriptedSelfPromptPort(selfAnswer("from-the-run", 0.95)),
    user: human,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  const resolution = outcome.report.records[0]?.resolution;

  assert.equal(resolution?.via, "self_prompted");
  assert.equal(getPointer(outcome.artifact, "/a"), "from-the-run");
  assert.deepEqual(human.asked, [], "ASK sits below SELF-PROMPT: the human is the last resort");
  assert.equal(outcome.report.questionsAsked, 0);
  assert.equal(outcome.report.byVia.self_prompted, 1);
  assert.deepEqual(outcome.report.records[0]?.rungsAttempted, ["self_prompted"]);
  assert.equal(resolution?.via === "self_prompted" ? resolution.rounds : 0, 1);
  assert.match(resolution?.via === "self_prompted" ? resolution.grounds : "", /corroborated/);
});

test("rung 4 is recorded where it sits in the ladder, not where it was installed", async () => {
  const engine = new ClarificationEngine({
    derive: { derive: () => null },
    infer: { infer: () => Promise.resolve(null) },
    selfPrompt: scriptedSelfPromptPort(selfAnswer("x", 0.9)),
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.deepEqual(outcome.report.records[0]?.rungsAttempted, [
    "derived",
    "inferred",
    "self_prompted",
  ]);
});

test("a declared fail-safe default outranks a self-prompt, which outranks a question", async () => {
  // The placement invariant. A self-prompt that could displace a declared fail-safe default would
  // let a run talk itself into a value its own author argued could only make a failure louder -
  // which is the one direction this rung must never move a verdict in.
  const prompt = scriptedSelfPromptPort(selfAnswer("from-the-run", 0.99));
  const human = scriptedPromptPort({ "goal:/a:missing_value": "from-the-human" });
  const engine = new ClarificationEngine({ selfPrompt: prompt, user: human, clock: fixedClock() });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", {
      blocking: true,
      ...failSafeDefault("from-the-default", "selecting it can only make a failure louder"),
    }),
  ]);

  assert.equal(outcome.report.records[0]?.resolution.via, "defaulted");
  assert.deepEqual(prompt.asked, [], "SELF-PROMPT sits below DEFAULT; it must not be reached");
  assert.deepEqual(human.asked, []);
  assert.equal(getPointer(outcome.artifact, "/a"), "from-the-default");
});

test("rung 4 holds the run's own answer to a stricter standard than rung 2 holds the substrate's", async () => {
  // 0.7 is exactly `inferThreshold` and below `selfPromptThreshold`. The same number that would
  // be accepted from what earlier runs learned from a human is refused from the run's own
  // reasoning - which is what keeps a low-confidence self-answer out of the artifact.
  const engine = new ClarificationEngine({
    selfPrompt: scriptedSelfPromptPort(selfAnswer("a guess", 0.7)),
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.equal(outcome.report.records[0]?.resolution.via, "deferred");
  assert.equal(outcome.report.byVia.self_prompted, 0);
  assert.equal(outcome.report.selfPromptRounds, 2, "the rung was spent, and the count says so");
  assert.equal(getPointer(outcome.artifact, "/a"), undefined);
});

test("rung 4 stops retrying one gap at the per-ambiguity cap and defers it", async () => {
  const port = scriptedSelfPromptPort(selfAnswer("low", 0.1));
  const engine = new ClarificationEngine({
    selfPrompt: port,
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.deepEqual(
    port.asked,
    [
      { id: "goal:/a:missing_value", attempt: 1 },
      { id: "goal:/a:missing_value", attempt: 2 },
    ],
    "attempt is 1-based, so a port can refine its answer rather than repeat it",
  );
  assert.equal(outcome.report.selfPromptRounds, 2);
  assert.equal(outcome.report.records[0]?.resolution.via, "deferred");
});

test("the per-run cap bounds the rounds a contract full of gaps can spend", async () => {
  const port = scriptedSelfPromptPort(selfAnswer("low", 0.1));
  const engine = new ClarificationEngine({
    selfPrompt: port,
    user: NullPromptPort,
    clock: fixedClock(),
    policy: { maxSelfPromptRoundsPerRun: 3 },
  });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/b", { blocking: true }),
    goalAmbiguity("/c", { blocking: true }),
    goalAmbiguity("/d", { blocking: true }),
  ]);

  assert.equal(
    outcome.report.selfPromptRounds,
    3,
    "four gaps at two attempts each is eight; the per-run cap is what makes it three",
  );
  assert.equal(port.asked.length, 3, "the counter and the port must agree about the work done");
  assert.equal(engine.selfPromptRounds, 3);
});

test("the wall-clock ceiling is the bound an attempt cap cannot replace", async () => {
  const port = scriptedSelfPromptPort(selfAnswer("x", 0.99));
  const engine = new ClarificationEngine({
    selfPrompt: port,
    user: NullPromptPort,
    clock: fixedClock(),
    policy: { selfPromptBudgetMs: 0 },
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.deepEqual(port.asked, [], "no attempt may be made once the ceiling is reached");
  assert.equal(outcome.report.selfPromptRounds, 0);
  assert.equal(outcome.report.byVia.self_prompted, 0);
});

test("a throwing self-prompt port degrades instead of failing the run", async () => {
  let calls = 0;
  const engine = new ClarificationEngine({
    selfPrompt: {
      available: true,
      prompt: () => {
        calls += 1;
        throw new Error("reasoning exploded");
      },
    },
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.equal(calls, 2);
  assert.equal(outcome.report.records[0]?.resolution.via, "deferred");
  assert.equal(outcome.report.selfPromptRounds, 2, "a thrown attempt is still an attempt spent");
});

test("NullSelfPromptPort reports itself absent rather than present-and-silent", async () => {
  const engine = new ClarificationEngine({
    selfPrompt: NullSelfPromptPort,
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: true })]);
  assert.equal(NullSelfPromptPort.available, false);
  assert.equal(outcome.report.selfPromptRounds, 0);
  assert.equal(outcome.report.byVia.self_prompted, 0);
  assert.deepEqual(
    outcome.report.records[0]?.rungsAttempted,
    ["deferred"],
    "an absent port means the rung is not attempted, so it is not recorded as attempted",
  );
});

test("the report counts self-prompt work rather than self-prompt capability", async () => {
  const port = scriptedSelfPromptPort({
    "goal:/a:missing_value": { value: "alpha", confidence: 0.9, grounds: "scripted" },
  });
  const engine = new ClarificationEngine({ selfPrompt: port, user: NullPromptPort, clock: fixedClock() });

  const outcome = await engine.resolve({}, [
    goalAmbiguity("/a", { blocking: true }),
    goalAmbiguity("/b", { blocking: true }),
  ]);

  assert.equal(outcome.report.byVia.self_prompted, 1, "only /a had an answer to give");
  assert.equal(outcome.report.selfPromptRounds, 3, "one attempt for /a, two declined for /b");
  assert.equal(port.asked.length, 3);
  assert.equal(getPointer(outcome.artifact, "/a"), "alpha");
  assert.equal(getPointer(outcome.artifact, "/b"), undefined);
});

test("rung 4 may close a non-blocking gap, where rung 2 is forbidden from spending a call", async () => {
  // Rung 2 is blocking-gated because it costs an external call. Rung 4 costs in-process work only,
  // and a non-blocking gap it closes is one the run would otherwise have had to defer - so the gate
  // is deliberately absent. This records the measured behaviour rather than leaving a reader to
  // assume the two rungs are gated alike.
  const engine = new ClarificationEngine({
    infer: { infer: () => Promise.resolve({ value: "inferred", confidence: 1, source: "memory" }) },
    selfPrompt: scriptedSelfPromptPort(selfAnswer("self", 0.9)),
    user: NullPromptPort,
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({}, [goalAmbiguity("/a", { blocking: false })]);
  assert.equal(outcome.report.records[0]?.resolution.via, "self_prompted");
  assert.equal(getPointer(outcome.artifact, "/a"), "self");
});

/**
 * The runtime protocol's own document, spelled once.
 *
 * Every field the three runtime detectors read is here on purpose, and each detector ignores most
 * of them: a detector declares its own structural view and reads only its own fields, so one shared
 * fixture is what lets the guard below iterate the register instead of restating it. Three
 * hand-built documents would be a fourth list of which detector wants what - and that list is
 * exactly what falls behind when a detector is added, which is the failure the guard exists to
 * catch.
 */
const runtimeDocument = {
  criteria: [
    {
      criterionId: "AC-001",
      mandatory: true,
      status: "INCONCLUSIVE",
      observationError: "the world produced no observation",
      observationKind: null,
      missingEvidence: ["screenshot"],
      note: null,
      evidenceNote: null,
    },
  ],
  iteration: 1,
  maxIterations: 3,
  elapsedMs: 12,
  maxRuntimeMs: 1000,
  verdict: "FAIL",
  repairGate: "command",
  decision: null,
};

const runtimeContext: DetectorContext = {
  registeredValidators: ["text.equals"],
  validatorDescriptors: [{ name: "text.equals", needsTarget: true, comparisons: ["equals"] }],
  registeredAdapters: ["scripted"],
  sourceLabel: "engine.test",
};

for (const entry of runtimeDetectors()) {
  test(`the ${entry.origin} question a run raises mid-run can be closed without interrupting anyone`, () => {
    const gaps = entry.detect(runtimeDocument, runtimeContext);

    // Without this the guard below would pass over an empty list, which is how a register-driven
    // loop covers a member it was not written for: every assertion after this line would be about
    // nothing, and the test would report a rule held that it never reached.
    assert.ok(
      gaps.length > 0,
      `${entry.origin} raised nothing from the shared fixture, so this test proves nothing about it`,
    );

    for (const gap of gaps) {
      // The loop cannot ask a human mid-run, so a runtime detector that raised a blocking gap would
      // create a question with nowhere to go - the ladder would fall to rung 6 and the run would
      // record an unresolved blocking ambiguity nobody was ever shown.
      assert.equal(
        gap.blocking,
        false,
        `${entry.origin} raised a blocking gap at ${gap.path}, which the loop has no way to put to anyone`,
      );
      assert.notEqual(
        gap.defaultValue,
        undefined,
        `${entry.origin} raised ${gap.path} with no declared default, so rung 3 could not close it and the run would have to reach a rung that answers from something other than a declaration`,
      );
      assert.ok(
        (gap.defaultRationale ?? "").trim().length > 0,
        `${entry.origin} declared a default at ${gap.path} without stating why selecting it is fail-safe`,
      );
    }
  });
}

test("a gap raised mid-run is closed by its declared default, with both later rungs wired and willing", async () => {
  // The loop's own gaps are non-blocking by construction and, per the guard above, every one of them
  // carries a declared fail-safe default - so this is the ladder they actually walk. INFER is
  // blocking-gated and is therefore never spent on one, DEFAULT answers, and the two rungs that could
  // answer from something other than a declaration are never reached. Held here with both of those
  // rungs installed and willing, because "not reached" is a claim about the code rather than about
  // which ports a caller happened to wire.
  let inferred = 0;
  const selfPrompt = scriptedSelfPromptPort(selfAnswer("self", 1));
  const engine = new ClarificationEngine({
    derive: createDeriver([schemaDefaultRule()]),
    infer: {
      infer: () => {
        inferred += 1;
        return Promise.resolve({ value: "inferred", confidence: 1, source: "memory" });
      },
    },
    selfPrompt,
    user: scriptedPromptPort({}),
    clock: fixedClock(),
  });

  const outcome = await engine.resolve({ criteria: [{}] }, [
    ambiguity({
      origin: "execution",
      path: "/criteria/0/note",
      kind: "missing_value",
      question: "AC-001 produced no observation yet is reported as INCONCLUSIVE. What accounts for that status?",
      blocking: false,
      ...failSafeDefault(
        "the world produced no observation, so this is not a measurement of the application",
        "recording the absence cannot make the run report PASS more readily than the truth",
      ),
    }),
  ]);

  const record = outcome.report.records[0];
  assert.equal(record?.resolution.via, "defaulted");
  assert.equal(
    getPointer(outcome.artifact, "/criteria/0/note"),
    "the world produced no observation, so this is not a measurement of the application",
  );
  assert.deepEqual(
    record?.rungsAttempted,
    ["derived", "defaulted"],
    "DERIVE is tried and declines, INFER is skipped because the gap is non-blocking, and DEFAULT answers",
  );
  assert.equal(inferred, 0, "a non-blocking gap may not spend an external call");
  assert.equal(selfPrompt.asked.length, 0, "a declared default outranks a self-answer");
  assert.equal(outcome.report.questionsAsked, 0);
});

// ---------------------------------------------------------------------------------------------
// The comparison guard: which expectations state a comparison
// ---------------------------------------------------------------------------------------------
//
// This guard had no test at all, which is how it came to answer the question differently from the
// three other seams that answer it. `equals: ""` is a sentence a contract writes on purpose - "this
// stream said nothing" - and it is documented as that sentence in six validator families, accepted by
// the acceptance decoder and accepted by the runtime judge. Only the detector read it as "no
// comparison", so only the detector refused a correct contract, with a blocking question the author
// had already answered. The two halves below are the two directions of that finding: the empty
// string is a comparison *for the key where it is an assertion*, and it is not a comparison for the
// two keys where it is vacuously true.

const comparisonContext: DetectorContext = {
  registeredValidators: ["process.stdout"],
  validatorDescriptors: [
    { name: "process.stdout", needsTarget: true, comparisons: ["equals", "contains", "matches"] },
  ],
  registeredAdapters: [],
  sourceLabel: "engine.test",
};

const contractStating = (expectation: Record<string, unknown>): AcceptanceLike => ({
  criteria: [
    { id: "AC-001", expect: [{ validator: "process.stdout", target: "1", ...expectation }] },
  ],
});

/** The gaps that answer "this expectation states no comparison" - one per expectation that does not. */
const comparisonGaps = (expectation: Record<string, unknown>): readonly Ambiguity[] =>
  detectValidationAmbiguities(contractStating(expectation), comparisonContext).filter(
    (gap) => gap.kind === "underspecified",
  );

test("an empty string is a stated value for equals, because it is a sentence the contract writes", () => {
  assert.deepEqual(
    comparisonGaps({ equals: "" }),
    [],
    "equals with an empty expected value is how a contract says this stream said nothing",
  );

  // The other half, so this test cannot pass because the guard was deleted: an expectation with no
  // comparison at all is still refused, still blocking, and still refused for the stated reason.
  const empty = comparisonGaps({});
  assert.equal(empty.length, 1, "an expectation with no comparison at all must still be refused");
  assert.equal(empty[0]?.blocking, true, "an expectation that cannot fail is a false PASS waiting");
  assert.match(empty[0]?.question ?? "", /states no comparison/);
});

test("an empty pattern is not a comparison, because every string contains it", () => {
  for (const key of ["contains", "matches"]) {
    const gaps = comparisonGaps({ [key]: "" });
    assert.equal(gaps.length, 1, `an empty ${key} must be refused as stating nothing`);
    assert.equal(gaps[0]?.blocking, true);
  }

  // So the refusal above is about emptiness and not about the key - a stated value on either one is
  // a comparison, which is why the guard admits the empty string for `equals` and only for `equals`.
  assert.deepEqual(comparisonGaps({ contains: "ready" }), []);
  assert.deepEqual(comparisonGaps({ matches: "^ready" }), []);
});

test("an invalid regular expression is reported as its own defect, not as an unstated comparison", () => {
  // The two checks are different questions and a single edit must not answer both. `matches: "("` is
  // a stated comparison that does not compile, so it is the regex check that must speak - and the
  // reported path has to name the key, because that is where the operator's answer is written.
  const gaps = detectValidationAmbiguities(
    contractStating({ matches: "(" }),
    comparisonContext,
  );
  assert.equal(gaps.length, 1, "a pattern that does not compile is one defect");
  assert.equal(gaps[0]?.kind, "ambiguous_reference");
  assert.equal(gaps[0]?.path, "/criteria/0/expect/0/matches");
});
