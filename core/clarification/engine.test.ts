import assert from "node:assert/strict";
import test from "node:test";

import { ClarificationEngine, NullPromptPort, scriptedPromptPort } from "./engine.ts";
import { createDeriver, schemaDefaultRule, type IoPort } from "./derive.ts";
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

test("rung 4 ASK is batched per round and answers become values", async () => {
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

test("stop 4 - the ladder is a straight line, so termination needs no budget", async () => {
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
