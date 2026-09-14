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
  parseRunSnapshot,
  resetReproducibility,
  resultConsistency,
  successMetrics,
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
}): Record<string, unknown> => {
  const criteria: readonly CriterionScript[] =
    options.criteria ??
    Object.entries(options.iterations.at(-1)?.statuses ?? {}).map(([criterionId, status]) => ({ criterionId, status }));
  return {
    run_id: options.runId,
    state: options.verdict === "PASS" ? "COMPLETED" : "ABORTED",
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
    assert.match(formatMetrics(successMetrics([failing("AC-001")])).join("\n"), /M1 result consistency: INCONCLUSIVE/);
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
    const violations = falsePasses([false_], ["AC-001"]);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.detail ?? "", /never failed, though a defect was known to affect it/);
  });

  it("catches a PASS whose required evidence is missing, even if the engine let it through", () => {
    const unproven = snapshot({
      runId: "run-unproven",
      verdict: "PASS",
      iterations: [{ iteration: 1, statuses: { "AC-001": "PASS" } }],
      criteria: [{ criterionId: "AC-001", status: "PASS", missing: ["trace"] }],
    });
    const violations = falsePasses([unproven]);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.detail ?? "", /required evidence missing for AC-001/);
  });

  it("does not accuse a run that failed", () => {
    const honest = snapshot({
      runId: "run-honest",
      verdict: "FAIL",
      iterations: [{ iteration: 1, statuses: { "AC-001": "FAIL" } }],
    });
    assert.deepEqual(falsePasses([honest], ["AC-001"]), []);
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
    assert.deepEqual(metrics.falsePasses, [], "and the PASS it ends on was earned");
    assert.equal(metrics.reset.reproducible, true);
    assert.equal(metrics.evidence.ratio, 1);

    const lines = formatMetrics(metrics).join("\n");
    assert.match(lines, /M1 result consistency: INCONCLUSIVE \(1 run, nothing to compare\)/);
    assert.match(lines, /M2 defect detection: 3\/3/);
    assert.match(lines, /M3 false PASS: none/);
    assert.match(lines, /M4 reset reproducibility: yes \(3 resets recorded\)/);
  });
});
