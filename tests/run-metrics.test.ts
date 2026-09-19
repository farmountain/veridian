import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryIo } from "../core/io.ts";
import type { RunSnapshot } from "../core/metrics/index.ts";
import {
  defectDetection,
  evidenceCompleteness,
  falsePasses,
  formatMetrics,
  listRuns,
  measureRunHistory,
  metricViolations,
  parseRunSnapshot,
  resetReproducibility,
  resultConsistency,
  successMetrics,
  worldValidityAtExit,
} from "../core/metrics/index.ts";

/**
 * The success metrics, proven without a browser.
 *
 * M1..M5 are measurements over runs, so the thing under test is a *reading*: a bundle goes in, a
 * number comes out. The properties worth asserting are the ones a plausible-but-wrong implementation
 * would get quietly wrong:
 *
 *  - **M1 must compare criteria, not counts.** Two runs where AC-001 broke and AC-002 broke have the
 *    same counts and are not the same result. A test that only checked `consistent: false` for
 *    obviously different runs would not catch that.
 *  - **A reading that cannot be trusted must be refused.** A bundle written before per-iteration
 *    criteria existed is not a bundle with nothing to report - it is one this cannot measure, and
 *    measuring it as consistent is a false PASS at the level of the metrics.
 *  - **M2 is not a restatement of the runs.** It is a comparison against ground truth, so an
 *    expectation that was never met has to come back as missed even when every run passed.
 *  - **M2 and M3 are handed the same ground truth, so they must refuse it for the same reason.**
 *    A criterion id is a name *inside one contract*, so a defect named for one subject is not a
 *    claim about another - and a metric that credits a detection from whichever run of fourteen
 *    happened to spell the criterion the same way is wrong in the direction that reads as a clean
 *    bill. An unscopable ground truth has to come back as a refusal for both, and neither may
 *    return a number.
 */

interface IterationScript {
  readonly iteration: number;
  readonly verdict?: string;
  readonly statuses: Readonly<Record<string, string>>;
}

interface CriterionScript {
  readonly criterionId: string;
  readonly status: string;
  readonly mandatory?: boolean;
  readonly missing?: readonly string[];
}

/** A `result.json` reading, shaped the way `serializeResult` writes it. */
const result = (options: {
  readonly runId: string;
  readonly verdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly iterations: readonly IterationScript[];
  readonly criteria?: readonly CriterionScript[];
  readonly resets?: number;
  readonly environmentValid?: boolean;
  readonly goalId?: string;
  readonly adapter?: string;
  /**
   * The state machine's terminal state, when the case under test is *about* it.
   *
   * `worldValidityAtExit` decides whether an invalid world was stopped on or carried past by reading
   * this field rather than by inferring from `environmentValid`, so a fixture that could only ever
   * write `COMPLETED` or `ABORTED` could not express the case the function exists to tell apart.
   */
  readonly state?: string;
}): Record<string, unknown> => {
  const criteria: readonly CriterionScript[] =
    options.criteria ??
    Object.entries(options.iterations.at(-1)?.statuses ?? {}).map(([criterionId, status]) => ({ criterionId, status }));
  return {
    run_id: options.runId,
    goal_id: options.goalId ?? "goal-under-test",
    state: options.state ?? (options.verdict === "PASS" ? "COMPLETED" : "ABORTED"),
    verdict: options.verdict ?? "FAIL",
    environmentValid: options.environmentValid ?? true,
    criteria: criteria.map((criterion) => ({
      criterion_id: criterion.criterionId,
      status: criterion.status,
      mandatory: criterion.mandatory ?? true,
      missing_evidence: [...(criterion.missing ?? [])],
    })),
    iterations: options.iterations.map((iteration) => ({
      iteration: iteration.iteration,
      verdict: iteration.verdict ?? "FAIL",
      criteria: Object.entries(iteration.statuses).map(([criterionId, status]) => ({
        criterion_id: criterionId,
        status,
      })),
    })),
    environment: {
      adapter: options.adapter ?? "adapter-under-test",
      transitions: Array.from({ length: options.resets ?? 0 }, () => ({ from: "resetting", to: "ready" })),
    },
  };
};

/** The same value, read back the way the metrics read it - through the parser, never by hand. */
const snapshot = (options: Parameters<typeof result>[0]): RunSnapshot => {
  const parsed = parseRunSnapshot(result(options));
  assert.ok(parsed !== null, `the fixture for ${options.runId} must parse`);
  return parsed;
};

describe("a run is measured from its own bundle, or refused", () => {
  it("refuses a bundle that carries counts without the criteria behind them", () => {
    // The shape `result.json` had before `IterationSummary.criteria`: three numbers per iteration and
    // no names. M1 cannot compare those counts without calling two unequal runs equal, so the honest
    // answer is "unmeasurable", not a verdict derived from a total.
    const legacy = {
      run_id: "run-legacy",
      verdict: "PASS",
      iterations: [{ iteration: 1, verdict: "PASS", passed: 3, failed: 1, undecided: 0 }],
      criteria: [{ criterion_id: "AC-001", status: "PASS", mandatory: true, missing_evidence: [] }],
    };
    assert.equal(parseRunSnapshot(legacy), null);
  });

  it("refuses a value that is not a result at all", () => {
    assert.equal(parseRunSnapshot(null), null);
    assert.equal(parseRunSnapshot("PASS"), null);
    assert.equal(parseRunSnapshot({ run_id: "run-1", iterations: [] }), null);
  });

  it("counts resets from the environment's own recorded transitions", () => {
    const run = snapshot({
      runId: "run-1",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
      resets: 3,
    });
    assert.equal(run.resets, 3, "three resets happened, so three are reported");
  });
});

describe("M1 compares criteria, not the counts they add up to", () => {
  const failing = (criterionId: string): RunSnapshot =>
    snapshot({
      runId: `run-${criterionId}`,
      verdict: "FAIL",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "FAIL", "AC-002": "PASS" } },
      ],
    });

  it("holds two runs of the same code to be consistent when they observed the same criteria", () => {
    const run = failing("AC-001");
    const second = snapshot({
      runId: "run-again",
      verdict: "FAIL",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "FAIL", "AC-002": "PASS" } },
      ],
    });
    const report = resultConsistency([run, second]);
    assert.equal(report.consistent, true);
    assert.deepEqual(report.differences, []);
    assert.equal(report.runs, 2);
  });

  it("separates two runs that share every count and fail different criteria", () => {
    // Both runs report one pass and one failure on each iteration: identical counts, different
    // results. A consistency check built on `passed`/`failed` would call these the same run twice,
    // and the whole meaning of the metric is that they are not.
    const first = failing("AC-001");
    const second = snapshot({
      runId: "run-other",
      verdict: "FAIL",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "PASS" } },
        { iteration: 2, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
      ],
    });

    const report = resultConsistency([first, second]);
    assert.equal(report.consistent, false);
    assert.equal(report.baseline, first.runId);
    const details = report.differences.map((difference) => difference.detail).join(" | ");
    assert.match(details, /iteration 1 AC-001: FAIL vs PASS/, "the reader is told which criterion moved");
    assert.match(details, /iteration 1 AC-002: PASS vs FAIL/);
    assert.equal(report.differences[0]?.runId, second.runId, "and which run disagreed");
  });

  it("writes every delta from the point of view of the run named first", () => {
    // The prefix is `${runId} vs ${against}`, so a reader pairs the two ids with the two values left
    // to right. This assertion is what holds the two orders together: the values are looked up *by
    // the ids in the prefix*, so a detail written baseline-first fails here rather than reading as a
    // claim about the wrong run. It is the same failure shape as a metric that compares counts - a
    // line that is only ever read by whoever wrote it agrees with itself.
    const first = failing("AC-001");
    const second = snapshot({
      runId: "run-other",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "PASS" } }],
    });

    const report = resultConsistency([first, second]);
    const own = (runId: string, criterionId: string): string =>
      (runId === first.runId ? first : second).iterations
        .flatMap((iteration) => iteration.criteria)
        .find((criterion) => criterion.criterionId === criterionId)?.status ?? "absent";

    for (const difference of report.differences) {
      const [left, right] = difference.detail.split(": ").at(-1)?.split(" vs ") ?? [];
      const criterionId = difference.detail.match(/AC-\d+/)?.[0];
      if (criterionId === undefined || left === undefined || right === undefined) continue;
      assert.equal(left, own(difference.runId, criterionId), `"${difference.detail}" starts with the wrong run`);
      assert.equal(right, own(difference.against, criterionId), `"${difference.detail}" ends with the wrong run`);
    }
    assert.match(
      report.differences.map((difference) => difference.detail).join(" | "),
      new RegExp(`verdict: PASS vs FAIL`),
      "the run's own verdict comes first, the baseline's second",
    );
  });

  it("calls one run unmeasured rather than consistent, because nothing was compared", () => {
    const alone = resultConsistency([failing("AC-001")]);
    assert.equal(alone.consistent, false);
    assert.equal(alone.measured, false, "one run is not a measurement, and `consistent: false` alone says the opposite");
    assert.match(formatMetrics(successMetrics([failing("AC-001")])).join("\n"), /M1 result consistency: INCONCLUSIVE/);
  });

  it("refuses a population that spans two subjects instead of certifying it", () => {
    // Measured, not imagined. Every contract names its criteria `AC-001` upward, and the repair gate
    // walks a defect table in criterion order, so a cart demo judged in a browser and an inventory
    // demo judged in a database - two different goals, two different adapters, two unrelated sets of
    // criteria - produce byte-identical signatures. M1 called that pair `yes (3 runs)`: a false PASS
    // by construction, and exactly the class this module exists to refuse.
    const cart = [
      snapshot({
        runId: "run-cart-1",
        goalId: "shopping-cart",
        adapter: "local-web",
        verdict: "PASS",
        iterations: [
          { iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "FAIL" } },
          { iteration: 2, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
          { iteration: 3, statuses: { "AC-001": "PASS", "AC-002": "PASS" } },
        ],
      }),
      snapshot({
        runId: "run-cart-2",
        goalId: "shopping-cart",
        adapter: "local-web",
        verdict: "PASS",
        iterations: [
          { iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "FAIL" } },
          { iteration: 2, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
          { iteration: 3, statuses: { "AC-001": "PASS", "AC-002": "PASS" } },
        ],
      }),
    ];
    const inventory = snapshot({
      runId: "run-inventory",
      goalId: "inventory-db",
      adapter: "local-db",
      verdict: "PASS",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
        { iteration: 3, statuses: { "AC-001": "PASS", "AC-002": "PASS" } },
      ],
    });

    const mixed = resultConsistency([...cart, inventory]);
    assert.equal(mixed.measured, false, "two subjects is not a consistency question");
    assert.equal(mixed.consistent, false);
    assert.deepEqual(mixed.differences, [], "and nothing was compared, so there is nothing to report as a divergence");
    assert.deepEqual(mixed.subjects, ["shopping-cart@local-web", "inventory-db@local-db"]);

    // The positive control beside it: the *same* signatures, one subject fewer, are a measurement -
    // so the refusal above is caused by the subject and not by the fixtures being uncomparable.
    const alone = resultConsistency(cart);
    assert.equal(alone.measured, true);
    assert.equal(alone.consistent, true);

    assert.match(
      formatMetrics(successMetrics([...cart, inventory])).join("\n"),
      /M1 result consistency: INCONCLUSIVE \(3 runs over 2 subjects: shopping-cart@local-web, inventory-db@local-db/,
    );
  });

  it("treats a bundle with no recorded subject as uncomparable, not as a match", () => {
    // `?` is what an absent `goal_id` or `environment.adapter` becomes. A bundle that does not say
    // which goal it judged cannot be held to a bundle that does, and treating the absence as equal
    // would let one unlabelled run certify a history it knows nothing about.
    const labelled = snapshot({
      runId: "run-labelled",
      goalId: "shopping-cart",
      adapter: "local-web",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const bare = parseRunSnapshot({
      run_id: "run-bare",
      verdict: "PASS",
      iterations: [{ iteration: 1, verdict: "PASS", criteria: [{ criterion_id: "AC-001", status: "PASS" }] }],
      criteria: [{ criterion_id: "AC-001", status: "PASS", mandatory: true, missing_evidence: [] }],
      environment: { transitions: [] },
    });
    assert.ok(bare !== null, "the fixture must be one the parser accepts");
    assert.equal(bare.goalId, null, "the field is absent, and absent is what it reports");
    assert.equal(bare.adapter, null);

    const report = resultConsistency([labelled, bare]);
    assert.equal(report.measured, false);
    assert.deepEqual(report.subjects, ["shopping-cart@local-web", "?@?"]);
  });

  it("reports no divergence for a mixed population even where the signatures differ", () => {
    // The reproduction above is caught by `measured` alone, because the two subjects happen to share
    // a signature - which is the whole reason the defect went unnoticed. This is the other half, and
    // it is what holds the gate around the comparison: a delta between two criteria that share only a
    // spelling would be a claim about a comparison that has no subject, so there must be none.
    const cart = snapshot({
      runId: "run-cart",
      goalId: "shopping-cart",
      adapter: "local-web",
      verdict: "FAIL",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "PASS" } }],
    });
    const inventory = snapshot({
      runId: "run-inventory",
      goalId: "inventory-db",
      adapter: "local-db",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } }],
    });

    // The positive control: the comparison machinery *would* have something to say about these two
    // status sets - asked of one subject, it says it - so the empty `differences` below is the gate
    // refusing, and not two fixtures that happened to agree.
    const sameSubject = resultConsistency([
      cart,
      snapshot({
        runId: "run-cart-again",
        goalId: "shopping-cart",
        adapter: "local-web",
        verdict: "PASS",
        iterations: [{ iteration: 1, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } }],
      }),
    ]);
    assert.equal(sameSubject.measured, true);
    assert.ok(sameSubject.differences.length > 0, "one subject over the same two readings is a divergence");

    const report = resultConsistency([cart, inventory]);
    assert.deepEqual(report.differences, [], "a mixed population was refused, so nothing was compared");
    assert.equal(report.measured, false);
  });
});

describe("M2 measures detection against ground truth, not against itself", () => {
  it("counts a defect as detected only where a run observed the criterion failing", () => {
    const run = snapshot({
      runId: "run-1",
      verdict: "FAIL",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "FAIL", "AC-002": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "PASS", "AC-002": "FAIL" } },
      ],
    });
    const report = defectDetection([run], ["AC-001", "AC-002", "AC-003"]);
    assert.deepEqual(report.detected, ["AC-001", "AC-002"]);
    assert.deepEqual(report.missed, ["AC-003"], "an expectation no run met is missed, not assumed met");
  });

  it("does not report detection from a passing run", () => {
    const clean = snapshot({
      runId: "run-clean",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    assert.deepEqual(defectDetection([clean], ["AC-001"]).missed, ["AC-001"]);
  });

  it("refuses ground truth for a criterion id the population spells under two subjects", () => {
    // The same reproduction M3's suite holds, one metric over, and the one this repository's own
    // history printed as `3/3`. `AC-001` is the first criterion of every demo here, so a defect
    // named for one contract is a claim about a criterion that merely shares a name with another's.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "FAIL",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });
    const inventory = snapshot({
      runId: "run-inventory",
      verdict: "FAIL",
      goalId: "inventory-db",
      adapter: "local-db",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });

    // The control, and the reason this cannot pass vacuously: both runs really do spell `AC-001`,
    // so an unscoped filter would have counted both. A fixture where one of them did not could not
    // tell a refusal from an absence.
    assert.deepEqual(
      [cart, inventory].map((run) => run.criteria.map((criterion) => criterion.criterionId)),
      [["AC-001"], ["AC-001"]],
    );

    const report = defectDetection([cart, inventory], ["AC-001"]);
    assert.equal(report.measured, false, "a mixed population is not a comparison this can make");
    assert.equal(report.subject, null, "two subjects means no single one to scope to");
    assert.deepEqual(report.subjects, ["shopping-cart@local-web", "inventory-db@local-db"]);
    assert.deepEqual(report.detected, [], "`1/1` here would be a detection under one contract");
    assert.deepEqual(report.missed, [], "and an unmeasured report may not answer `no` either, which `missed` would");
    assert.match(
      formatMetrics(successMetrics([cart, inventory], { expectedDefects: ["AC-001"] })).join("\n"),
      /M2 defect detection: INCONCLUSIVE \(1 named defect\(s\) over 2 subjects: shopping-cart@local-web, inventory-db@local-db - a criterion id is a name inside one contract/,
    );
  });

  it("scopes ground truth to one subject, so another subject's failure does not credit it", () => {
    // The direction this metric was wrong in, and the reason it went unnoticed: unscoped, the
    // inventory run's `AC-001` failure was counted as the cart's defect having been detected. The
    // cart never observed it failing, so the honest reading of the cart's ground truth is `missed`.
    // A metric can be wrong by being too kind, and this is what that looks like.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "PASS",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const inventory = snapshot({
      runId: "run-inventory",
      verdict: "FAIL",
      goalId: "inventory-db",
      adapter: "local-db",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });

    // The control: the inventory run really does observe `AC-001` failing, so the empty answer above
    // is this metric declining to credit the cart with it - not an absence of evidence anywhere. A
    // fixture where nothing failed could not tell a scope from a shortage.
    assert.deepEqual(defectDetection([cart, inventory], ["AC-001"]).detected, []);
    assert.deepEqual(defectDetection([inventory], ["AC-001"]).detected, ["AC-001"]);

    const report = defectDetection([cart, inventory], ["AC-001"], "shopping-cart@local-web");
    assert.equal(report.measured, true);
    assert.equal(report.subject, "shopping-cart@local-web");
    assert.deepEqual(report.detected, [], "the inventory run spelled AC-001 the same way and did not detect the cart's");
    assert.deepEqual(report.missed, ["AC-001"]);
    assert.match(
      formatMetrics(
        successMetrics([cart, inventory], { expectedDefects: ["AC-001"], expectedSubject: "shopping-cart@local-web" }),
      ).join("\n"),
      /M2 defect detection: 0\/1 \(scoped to shopping-cart@local-web\) \(missed AC-001\)/,
    );
  });

  it("names the subject it could not find, rather than reporting a clean sweep", () => {
    // A third way to be unmeasured: ground truth *was* scoped, to a subject this history does not
    // hold. "nothing was missed" and "no runs of the subject you asked about" are two different
    // answers and only one of them is about the history, so the line says which it is.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "PASS",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const report = defectDetection([cart], ["AC-001"], "inventory-db@local-db");
    assert.equal(report.measured, false);
    assert.equal(report.subject, "inventory-db@local-db", "the scope is echoed even when it matched nothing");
    assert.deepEqual(report.detected, []);
    assert.deepEqual(report.missed, []);
    assert.match(
      formatMetrics(
        successMetrics([cart], { expectedDefects: ["AC-001"], expectedSubject: "inventory-db@local-db" }),
      ).join("\n"),
      /M2 defect detection: INCONCLUSIVE \(the named defects are scoped to inventory-db@local-db, which this history does not hold: shopping-cart@local-web\)/,
    );
  });

  it("marks M2 inconclusive when no ground truth was supplied", () => {
    const clean = snapshot({
      runId: "run-clean",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    assert.match(formatMetrics(successMetrics([clean])).join("\n"), /M2 defect detection: INCONCLUSIVE/);
  });
});

describe("M3 is zero false PASS, and it is read from the bundle", () => {
  it("names a run that reported PASS over a defect known to affect a criterion", () => {
    const false_ = snapshot({
      runId: "run-lying",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const report = falsePasses([false_], ["AC-001"]);
    assert.equal(report.measured, true, "one subject and ground truth for it is a comparison this can make");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.runId, "run-lying");
    assert.equal(report.findings[0]?.subject, "goal-under-test@adapter-under-test");
    assert.match(report.findings[0]?.detail ?? "", /never failed, though a defect was known to affect it/);
  });

  it("catches a PASS whose required evidence is missing, even if the engine let it through", () => {
    const unproven = snapshot({
      runId: "run-unproven",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
      criteria: [{ criterionId: "AC-001", status: "PASS", missing: ["trace"] }],
    });
    // Deliberately no ground truth: the bundle-only half is decidable without it, so the finding has
    // to survive a report whose `measured` is `false`. If the two halves were gated together, an
    // engine bypass would be hidden by the absence of a defect list.
    const report = falsePasses([unproven]);
    assert.equal(report.measured, false, "no ground truth was named, so the other half was not compared");
    assert.equal(report.findings.length, 1, "and the half that is readable from the bundle is still read");
    assert.match(report.findings[0]?.detail ?? "", /required evidence missing for AC-001/);
  });

  it("does not accuse a run that failed", () => {
    const honest = snapshot({
      runId: "run-honest",
      verdict: "FAIL",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });
    const report = falsePasses([honest], ["AC-001"]);
    assert.equal(report.measured, true, "the control matters: this population *was* compared");
    assert.deepEqual(report.findings, []);
  });

  it("marks M3 inconclusive when no ground truth was supplied, rather than reporting none", () => {
    // `none` is a claim about a comparison. Without a named defect, one half of M3 - the pass that
    // blessed code known to be broken - was never compared, so reporting the half that *was* checked
    // as the whole answer is the comfortable pass this metric exists to refuse. M2 already said
    // INCONCLUSIVE in the same situation; M3 alone printed `none`.
    const clean = snapshot({
      runId: "run-clean",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    assert.match(
      formatMetrics(successMetrics([clean])).join("\n"),
      /M3 false PASS: INCONCLUSIVE \(no known defects were named/,
    );
  });

  it("still reports a false pass it found without ground truth", () => {
    // The missing-evidence half is decidable from the bundle alone, so a violation there must not be
    // hidden behind the INCONCLUSIVE line that covers the half which could not be compared.
    const unproven = snapshot({
      runId: "run-unproven",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
      criteria: [{ criterionId: "AC-001", status: "PASS", missing: ["trace"] }],
    });
    const lines = formatMetrics(successMetrics([unproven])).join("\n");
    assert.match(lines, /M3 false PASS: 1/);
    assert.doesNotMatch(lines, /M3 false PASS: INCONCLUSIVE/);
  });

  it("refuses ground truth for a criterion id the population spells under two subjects", () => {
    // The reproduction, as a test. `AC-001` is the first criterion of every demo in this repository,
    // and criterion ids restart at one per contract - so a named defect applied to a history spanning
    // two subjects is a claim about criteria that merely share a name. Applying it anyway is what
    // reported 117 false passes over a history whose real number is zero.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "PASS",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const inventory = snapshot({
      runId: "run-inventory",
      verdict: "PASS",
      goalId: "inventory-db",
      adapter: "local-db",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });

    // The control, and the reason this test cannot pass vacuously: the criterion id really is spelled
    // the same in both runs, so both would have matched the unscoped filter. A fixture where one run
    // did not spell it could not tell a refusal from an absence.
    assert.deepEqual(
      [cart, inventory].map((run) => run.criteria.map((criterion) => criterion.criterionId)),
      [["AC-001"], ["AC-001"]],
    );

    const report = falsePasses([cart, inventory], ["AC-001"]);
    assert.equal(report.measured, false, "a mixed population is not a comparison this can make");
    assert.equal(report.subject, null, "two subjects means no single one to scope to");
    assert.deepEqual(report.subjects, ["shopping-cart@local-web", "inventory-db@local-db"]);
    assert.deepEqual(report.findings, []);
    assert.match(
      formatMetrics(successMetrics([cart, inventory], { expectedDefects: ["AC-001"] })).join("\n"),
      /M3 false PASS: INCONCLUSIVE \(1 named defect\(s\) over 2 subjects: shopping-cart@local-web, inventory-db@local-db - a criterion id is a name inside one contract/,
    );
  });

  it("scopes ground truth to one subject rather than refusing to compare at all", () => {
    // The other half of the same rule, and the half that keeps the refusal above from being a
    // paralysis: the answer is not "never compare", it is "compare the runs the claim is about".
    // Both runs pass `AC-001`; only the cart's is accused, because the defect was named for the
    // cart's contract. Scoping the filter rather than dropping it is what moves the finding count
    // from two (`2`) to one - the exact falsification probe this suite's plan records.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "PASS",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const inventory = snapshot({
      runId: "run-inventory",
      verdict: "PASS",
      goalId: "inventory-db",
      adapter: "local-db",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });

    const report = falsePasses([cart, inventory], ["AC-001"], "shopping-cart@local-web");
    assert.equal(report.measured, true);
    assert.equal(report.subject, "shopping-cart@local-web");
    assert.equal(report.findings.length, 1, "one subject's defect does not accuse another subject's run");
    assert.equal(report.findings[0]?.runId, "run-cart");
    assert.equal(report.findings[0]?.subject, "shopping-cart@local-web");
    assert.equal(
      report.findings.filter((finding) => finding.runId === "run-inventory").length,
      0,
      "the inventory run spelled AC-001 the same way and was still not accused",
    );
  });

  it("names the subject it could not find, rather than reporting none", () => {
    // A third way to be unmeasured: ground truth *was* scoped, to a subject this history does not
    // hold. The line has to say which, because "no false passes" and "no runs of the subject you
    // asked about" are two different answers and only one of them is about the history.
    const cart = snapshot({
      runId: "run-cart",
      verdict: "PASS",
      goalId: "shopping-cart",
      adapter: "local-web",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const report = falsePasses([cart], ["AC-001"], "inventory-db@local-db");
    assert.equal(report.measured, false);
    assert.equal(report.subject, "inventory-db@local-db", "the scope is echoed even when it matched nothing");
    assert.deepEqual(report.findings, []);
    assert.match(
      formatMetrics(
        successMetrics([cart], { expectedDefects: ["AC-001"], expectedSubject: "inventory-db@local-db" }),
      ).join("\n"),
      /M3 false PASS: INCONCLUSIVE \(the named defects are scoped to inventory-db@local-db, which this history does not hold: shopping-cart@local-web\)/,
    );
  });
});

describe("M4 counts the resets that happened, not the ones that were asked for", () => {
  it("accepts four iterations with three recorded resets", () => {
    const run = snapshot({
      runId: "run-1",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "FAIL" } },
        { iteration: 3, statuses: { "AC-001": "FAIL" } },
        { iteration: 4, statuses: { "AC-001": "PASS" } },
      ],
      resets: 3,
    });
    const report = resetReproducibility([run]);
    assert.equal(report.reproducible, true);
    assert.deepEqual(report.violations, []);
  });

  it("reports the iteration that re-observed a world nobody reset", () => {
    const run = snapshot({
      runId: "run-unreset",
      iterations: [
        { iteration: 1, statuses: { "AC-001": "FAIL" } },
        { iteration: 2, statuses: { "AC-001": "PASS" } },
      ],
      resets: 0,
    });
    const report = resetReproducibility([run]);
    assert.equal(report.reproducible, false);
    assert.match(report.violations[0]?.detail ?? "", /2 iterations need 1 resets, the environment recorded 0/);
  });
});

describe("M4's second question is asked apart from its first", () => {
  it("answers the reset question for a run that aborted on an invalid world", () => {
    // The direct reading of the W-B split, and the assertion the conflation actually violated. The
    // run below never re-observed anything, so its reset property holds - and it ended on a world the
    // bundle records as invalid, which is a different question that used to be folded into this one.
    // The other two holds on this split are indirect (a formatted line and an exit predicate), and an
    // indirect hold reports *something* fired without saying which report was wrong.
    const halted = snapshot({
      runId: "run-halted",
      verdict: "INCONCLUSIVE",
      environmentValid: false,
      iterations: [{ iteration: 1, statuses: { "AC-001": "INCONCLUSIVE" } }],
    });
    const report = resetReproducibility([halted]);
    assert.equal(report.resets, 0);
    assert.deepEqual(report.violations, [], "the invalid world is not this report's question");
    assert.equal(report.reproducible, true, "one iteration needs no reset, and nothing here says otherwise");
    // The same run, read by the report that owns the other question: one run, two answers, and both
    // of them honest. That is what the split bought.
    assert.equal(worldValidityAtExit([halted]).stopped, 1);
  });

  it("tells a run that stopped on an invalid world from one that carried on over it", () => {
    // One `reproducible` flag used to answer both questions and said `no` for either, so a history
    // whose reset property held 142 times out of 142 reported `M4 reset reproducibility: no` because
    // of the single run below on the left - an abort, which is the loop behaving correctly. The two
    // readings differ only in the terminal `state`, and that difference is the whole question: the
    // dead half of the old predicate would have accused both, and the live half accuses one.
    const halted = snapshot({
      runId: "run-halted",
      verdict: "INCONCLUSIVE",
      environmentValid: false,
      iterations: [{ iteration: 1, statuses: { "AC-001": "INCONCLUSIVE" } }],
    });
    // Deliberately not overriding `state`: a non-PASS verdict defaults to `ABORTED`, which is the
    // spelling the real abort path leaves behind, so the fixture exercises the reading it will meet.
    assert.equal(halted.state, "ABORTED");
    const carried = snapshot({
      runId: "run-carried",
      verdict: "FAIL",
      state: "FAILED",
      environmentValid: false,
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });
    const healthy = snapshot({
      runId: "run-healthy",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });

    const report = worldValidityAtExit([halted, carried, healthy]);
    assert.equal(report.runs, 3);
    assert.equal(report.stopped, 1, "an abort is the measurement working, so it is counted as one");
    assert.equal(report.carriedOn.length, 1, "and a verdict reached over an invalid world is the defect");
    assert.equal(report.carriedOn[0]?.runId, "run-carried");
    assert.match(
      report.carriedOn[0]?.detail ?? "",
      /reached FAIL in state FAILED over a world the bundle records as invalid/,
    );
    assert.notEqual(
      report.stopped + report.carriedOn.length,
      report.runs,
      "a valid world is not a reading of either property - the control that stops this passing vacuously",
    );
  });

  it("says nothing about world validity when no world was invalid", () => {
    // The line is conditional. A history with nothing wrong in it must not carry a count of zero
    // stops, because a reader who sees that line learn to read it as decoration.
    const healthy = snapshot({
      runId: "run-healthy",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
    });
    const lines = formatMetrics(successMetrics([healthy])).join("\n");
    assert.doesNotMatch(lines, /M4 world validity at exit/);
    assert.match(lines, /M4 reset reproducibility: yes \(0 resets recorded\)/);
  });

  it("prints both counts, so a history holding one of each says so", () => {
    const halted = snapshot({
      runId: "run-halted",
      verdict: "INCONCLUSIVE",
      environmentValid: false,
      iterations: [{ iteration: 1, statuses: { "AC-001": "INCONCLUSIVE" } }],
    });
    const carried = snapshot({
      runId: "run-carried",
      verdict: "FAIL",
      state: "FAILED",
      environmentValid: false,
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });
    const lines = formatMetrics(successMetrics([halted, carried])).join("\n");
    assert.match(lines, /M4 reset reproducibility: yes/);
    assert.match(lines, /M4 world validity at exit: 1 run\(s\) stopped on an invalid world, 1 carried on/);
  });
});

describe("M5 counts the evidence that arrived", () => {
  it("reports the ratio and names what was missing per criterion", () => {
    const run = snapshot({
      runId: "run-1",
      criteria: [
        { criterionId: "AC-001", status: "PASS" },
        { criterionId: "AC-002", status: "INCONCLUSIVE", missing: ["screenshot", "trace"] },
      ],
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS", "AC-002": "INCONCLUSIVE" } }],
    });
    const report = evidenceCompleteness([run]);
    assert.equal(report.criteria, 2);
    assert.equal(report.complete, 1);
    assert.equal(report.ratio, 0.5);
    assert.deepEqual(report.violations, [{ runId: "run-1", criterionId: "AC-002", missing: ["screenshot", "trace"] }]);
  });
});

describe("a history is read from the bundles on disk", () => {
  const runsDir = ".veridian/runs";

  it("lists only run directories, oldest name first", async () => {
    const io = memoryIo({
      [`${runsDir}/run-20260101-000000-aaaaaa/result.json`]: "{}",
      [`${runsDir}/run-20260102-000000-bbbbbb/result.json`]: "{}",
      [`${runsDir}/notes.txt`]: "not a run",
    });
    assert.deepEqual(await listRuns(io, ".veridian"), ["run-20260101-000000-aaaaaa", "run-20260102-000000-bbbbbb"]);
  });

  it("treats a missing runs directory as an empty history rather than an error", async () => {
    assert.deepEqual(await listRuns(memoryIo(), ".veridian"), []);
  });

  it("reports the bundles it could not measure instead of leaving them out", async () => {
    const good = JSON.stringify(
      result({ runId: "run-1", iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }], resets: 0 }),
    );
    const io = memoryIo({
      [`${runsDir}/run-20260101-000000-aaaaaa/result.json`]: good,
      [`${runsDir}/run-20260102-000000-bbbbbb/result.json`]: "{ this is not json",
      [`${runsDir}/run-20260103-000000-cccccc/result.json`]: JSON.stringify({ run_id: "run-3", verdict: "PASS" }),
    });

    const { history, metrics } = await measureRunHistory(io, ".veridian", { expectedDefects: ["AC-001"] });
    assert.equal(history.snapshots.length, 1, "the one readable bundle is measured");
    assert.equal(history.unreadable.length, 2, "and the two that are not are reported");
    assert.match(history.unreadable[0] ?? "", /is not JSON/);
    assert.match(history.unreadable[1] ?? "", /per-iteration criteria/);
    assert.equal(metrics.runs, 1);
    assert.equal(metrics.unreadable.length, 2);

    // The trap this guards: an unreadable bundle dropped silently would raise the apparent consistency
    // of the history, because the runs missing from the comparison are the ones that disagreed.
    assert.match(formatMetrics(metrics).join("\n"), /runs measured: 1 \(\+2 unreadable\)/);
  });

  it("measures the canonical progression: one defect repaired per iteration, four iterations, three resets", async () => {
    const io = memoryIo({
      [`${runsDir}/run-20260101-000000-aaaaaa/result.json`]: JSON.stringify(
        result({
          runId: "run-1",
          verdict: "PASS",
          resets: 3,
          iterations: [
            { iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL", "AC-002": "FAIL", "AC-003": "FAIL", "AC-004": "PASS" } },
            { iteration: 2, verdict: "FAIL", statuses: { "AC-001": "PASS", "AC-002": "FAIL", "AC-003": "FAIL", "AC-004": "PASS" } },
            { iteration: 3, verdict: "FAIL", statuses: { "AC-001": "PASS", "AC-002": "PASS", "AC-003": "FAIL", "AC-004": "PASS" } },
            { iteration: 4, verdict: "PASS", statuses: { "AC-001": "PASS", "AC-002": "PASS", "AC-003": "PASS", "AC-004": "PASS" } },
          ],
        }),
      ),
    });

    const { metrics } = await measureRunHistory(io, ".veridian", { expectedDefects: ["AC-001", "AC-002", "AC-003"] });
    assert.deepEqual(metrics.detection.missed, [], "every defect the demo injects was observed failing");
    assert.equal(metrics.falsePasses.measured, true, "one subject, and the defects named belong to it");
    assert.deepEqual(metrics.falsePasses.findings, [], "and the PASS it ends on was earned");
    assert.equal(metrics.reset.reproducible, true);
    assert.equal(metrics.evidence.ratio, 1);

    const lines = formatMetrics(metrics).join("\n");
    assert.match(lines, /M1 result consistency: INCONCLUSIVE \(1 run, nothing to compare\)/);
    // The scoped spelling, not a bare `3/3`: same reason as the `M3` line below, and the count was
    // the half that was wrong before - a score with no subject attached is a score a reader has to
    // guess the subject of.
    assert.match(lines, /M2 defect detection: 3\/3 \(scoped to goal-under-test@adapter-under-test\)$/m);
    // The scoped spelling, not a bare `none`: a reader must be able to tell a `none` that was earned
    // by comparing one subject's criteria from one that stands for a history this never compared.
    assert.match(lines, /M3 false PASS: none \(scoped to goal-under-test@adapter-under-test\)/);
    assert.match(lines, /M4 reset reproducibility: yes \(3 resets recorded\)/);
  });
});

describe("the exit code is asked of the reports once, and only an answered no is a violation", () => {
  /**
   * The predicate behind `veridian metrics`' exit code.
   *
   * It used to be an `||` chain inside `cli/veridian.ts`'s module-private `runMetrics`, which no test
   * in this tree could reach - so the number a user actually reads off the command had no coverage at
   * all while each of the reports it consults had a suite of its own. These cases are that missing
   * coverage.
   *
   * Each one arms exactly one clause, except where its comment says otherwise, because an assertion
   * that a second arm would also satisfy proves nothing about the arm the test names. Two of the
   * clauses cannot be isolated at all, and saying so is part of the test rather than a gap in it.
   */
  const cart = (options: Partial<Parameters<typeof result>[0]> = {}): RunSnapshot =>
    snapshot({
      runId: "run-cart",
      goalId: "shopping-cart",
      adapter: "local-web",
      verdict: "PASS",
      iterations: [{ iteration: 1, verdict: "PASS", statuses: { "AC-001": "PASS" } }],
      ...options,
    });

  const rows = (options: Partial<Parameters<typeof result>[0]> = {}): RunSnapshot =>
    snapshot({
      runId: "run-rows",
      goalId: "inventory-db",
      adapter: "local-db",
      verdict: "PASS",
      iterations: [{ iteration: 1, verdict: "PASS", statuses: { "AC-001": "PASS" } }],
      ...options,
    });

  it("is not a violation when every report answered yes", () => {
    // A PASS whose named defect really was observed failing first, with the reset the second
    // observation needed. Every clause is answered, and the answer to all of them is yes.
    const run = cart({
      resets: 1,
      iterations: [
        { iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } },
        { iteration: 2, verdict: "PASS", statuses: { "AC-001": "PASS" } },
      ],
    });
    const metrics = successMetrics([run], {
      expectedDefects: ["AC-001"],
      expectedSubject: "shopping-cart@local-web",
    });
    assert.equal(metrics.falsePasses.measured, true, "the scoped comparison ran");
    assert.deepEqual(metrics.falsePasses.findings, [], "and earned its `none`");
    assert.equal(metrics.reset.reproducible, true);
    assert.deepEqual(metrics.evidence.violations, []);
    assert.equal(metricViolations(metrics), false);
  });

  it("is not a violation for a population of one, which is unmeasured rather than consistent", () => {
    const metrics = successMetrics([
      snapshot({ runId: "run-1", iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }] }),
    ]);
    // `consistent: false` is what a predicate reading the flag alone would see. It is `false` because
    // nothing was compared, and `measured` is the only field that says which of the two it was.
    assert.equal(metrics.consistency.consistent, false);
    assert.equal(metrics.consistency.measured, false);
    assert.equal(metricViolations(metrics), false);
  });

  it("is not a violation for a mixed population, which is unmeasured rather than inconsistent", () => {
    const metrics = successMetrics([
      cart({ iterations: [{ iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } }] }),
      rows(),
    ]);
    assert.equal(metrics.consistency.runs, 2);
    assert.equal(metrics.consistency.consistent, false);
    assert.deepEqual(metrics.consistency.differences, [], "two subjects were refused before anything was compared");
    assert.equal(metricViolations(metrics), false, "a disagreement it refused to look for is not a disagreement");
  });

  it("is not a violation for named defects over a mixed population, which is the shape that reported 117", () => {
    const metrics = successMetrics([cart(), rows()], { expectedDefects: ["AC-001"] });
    assert.equal(metrics.falsePasses.measured, false);
    assert.deepEqual(metrics.falsePasses.findings, []);
    const lines = formatMetrics(metrics).join("\n");
    // The sentence has to name the subjects it could not choose between. A bare `none` here would be
    // the unearned conclusion that a history spanning two contracts holds no false passes.
    assert.match(
      lines,
      /M3 false PASS: INCONCLUSIVE \(1 named defect\(s\) over 2 subjects: shopping-cart@local-web, inventory-db@local-db/,
    );
    assert.equal(metricViolations(metrics), false);
  });

  it("is not a violation for defects scoped to a subject the history does not hold", () => {
    const metrics = successMetrics([rows()], {
      expectedDefects: ["AC-001"],
      expectedSubject: "shopping-cart@local-web",
    });
    assert.equal(metrics.falsePasses.subject, "shopping-cart@local-web", "the caller's scope is reported, not guessed at");
    assert.equal(metrics.falsePasses.measured, false);
    assert.deepEqual(metrics.falsePasses.findings, []);
    assert.match(
      formatMetrics(metrics).join("\n"),
      /M3 false PASS: INCONCLUSIVE \(the named defects are scoped to shopping-cart@local-web, which this history does not hold: inventory-db@local-db\)/,
    );
    assert.equal(metricViolations(metrics), false);
  });

  it("accuses only the subject its ground truth belongs to, in a population that holds more than one", () => {
    const report = falsePasses([cart(), rows()], ["AC-001"], "shopping-cart@local-web");
    assert.equal(report.measured, true);
    // One finding, not two: `AC-001` is the first criterion of both contracts, and the same spelling
    // under another goal is a different claim. Two findings here is the 117-shaped defect read the
    // other way round, against a run whose ground truth nobody stated.
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.subject, "shopping-cart@local-web");
    assert.equal(report.findings[0]?.runId, "run-cart");
  });

  it("is a violation when the scoped comparison finds a pass that blessed a defect", () => {
    const metrics = successMetrics([cart()], {
      expectedDefects: ["AC-001"],
      expectedSubject: "shopping-cart@local-web",
    });
    // The controls matter here, because M3 has to be the arm that fired: the population is
    // unmeasured for consistency, the world was reset correctly, and no evidence is missing.
    assert.equal(metrics.consistency.measured, false);
    assert.equal(metrics.reset.reproducible, true);
    assert.deepEqual(metrics.evidence.violations, []);
    assert.equal(metrics.falsePasses.findings.length, 1);
    assert.equal(metricViolations(metrics), true);
  });

  it("is a violation when a run passed with required evidence missing, even with no ground truth", () => {
    const metrics = successMetrics([
      cart({
        criteria: [{ criterionId: "AC-001", status: "PASS", missing: ["screenshot"] }],
      }),
    ]);
    // An unmeasured M3 report is not an exonerated one: this finding came from the bundle alone, and
    // `measured` speaks only for the half that needed ground truth scoping.
    assert.equal(metrics.falsePasses.measured, false);
    assert.equal(metrics.falsePasses.findings.length, 1);
    // The same fact also trips M5, which counts missing evidence on any run rather than only on a
    // `PASS`, so this clause is not independently falsifiable - removing it leaves the verdict
    // unchanged here. It is stated this way because `findings` is what M3 answers.
    assert.equal(metrics.evidence.violations.length, 1);
    assert.equal(metricViolations(metrics), true);
  });

  it("is a violation when an iteration inherited a world that was never reset", () => {
    const run = cart({
      iterations: [
        { iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } },
        { iteration: 2, verdict: "PASS", statuses: { "AC-001": "PASS" } },
      ],
    });
    const metrics = successMetrics([run]);
    assert.equal(metrics.reset.reproducible, false);
    assert.deepEqual(metrics.falsePasses.findings, []);
    assert.deepEqual(metrics.evidence.violations, []);
    assert.equal(metricViolations(metrics), true);
  });

  it("is a violation when a criterion's required evidence never arrived, on a run that failed", () => {
    const metrics = successMetrics([
      snapshot({
        runId: "run-1",
        criteria: [{ criterionId: "AC-001", status: "FAIL", missing: ["stderr"] }],
        iterations: [{ iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } }],
      }),
    ]);
    // M3 is silent on purpose here - the run never claimed a `PASS` - so M5 is the arm that fired.
    assert.deepEqual(metrics.falsePasses.findings, []);
    assert.equal(metrics.evidence.violations.length, 1);
    assert.equal(metricViolations(metrics), true);
  });

  it("is not a violation for a world that was invalid at exit, which is reported rather than accused", () => {
    const metrics = successMetrics([
      snapshot({
        runId: "run-1",
        state: "COMPLETED",
        environmentValid: false,
        criteria: [{ criterionId: "AC-001", status: "FAIL" }],
        iterations: [{ iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } }],
      }),
    ]);
    assert.equal(metrics.worldValidity.carriedOn.length, 1, "the finding exists and is reported");
    assert.equal(metricViolations(metrics), false, "and it is still not what fails the command");
  });

  it("is not a violation for a defect M2 never saw detected", () => {
    // One subject, and a FAIL verdict on it, and both halves of the fixture are load-bearing. The
    // single subject is what lets the ground truth be scoped at all - over a mixed population this
    // call returns a refusal rather than a miss, which is the case below. The FAIL verdict is what
    // keeps this a question about M2: a `PASS` run over a defect it never observed failing is M3's
    // sentence, and that one *is* a finding. The first version of this fixture was two passing cart
    // runs, and it failed for exactly that reason - which is the pair of metrics working.
    const failed = (runId: string): RunSnapshot =>
      cart({
        runId,
        verdict: "FAIL",
        iterations: [{ iteration: 1, verdict: "FAIL", statuses: { "AC-001": "FAIL" } }],
      });
    const metrics = successMetrics([failed("run-cart-1"), failed("run-cart-2")], { expectedDefects: ["AC-009"] });
    assert.equal(metrics.detection.measured, true, "the fixture has to be able to measure what this asserts");
    assert.deepEqual(metrics.detection.missed, ["AC-009"], "M2 reported a miss");
    assert.deepEqual(metrics.falsePasses.findings, [], "and M3 has nothing to say about a run that failed");
    assert.equal(metricViolations(metrics), false);
    // M2 is absent from the decision on purpose: a miss is measured against ground truth that may not
    // be about this population at all, and an unmeasurable metric may neither fail nor pass a command.
  });

  it("is not a violation for a ground truth M2 refused to scope", () => {
    // The refusal is not a quiet pass. `measured` is false and both halves of the answer are empty,
    // so a reader is told the metric declined to ask rather than that nothing was missed - and the
    // command still exits 0, because a metric that could not compare has no answer to fail on.
    const metrics = successMetrics([cart(), rows()], { expectedDefects: ["AC-009"] });
    assert.equal(metrics.detection.measured, false);
    assert.deepEqual(metrics.detection.detected, []);
    assert.deepEqual(metrics.detection.missed, [], "an unmeasured miss is not a miss");
    assert.equal(metricViolations(metrics), false);
    assert.match(
      formatMetrics(metrics).join("\n"),
      /M2 defect detection: INCONCLUSIVE \(1 named defect\(s\) over 2 subjects: shopping-cart@local-web, inventory-db@local-db/,
    );
  });

  it("is not a violation for an empty history, which the command refuses before it asks", () => {
    assert.equal(metricViolations(successMetrics([])), false);
  });
});
