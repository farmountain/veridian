/**
 * The MVP's success metrics: M1..M5, computed from the bundles the runs actually wrote.
 *
 * PLAN.md states five of them, and not one is a property of a single criterion. M1 compares runs to
 * each other, M3 is about a PASS that should not exist, M4 is about what happened between
 * iterations, M5 counts artifacts. The tempting shortcut is to express them as acceptance criteria -
 * and it produces a lie with a green tick beside it, because no browser can observe "the same code
 * produced the same result twice", and a `web.*` validator claiming to would be inventing an
 * observation. The input here is therefore a **run history**: the `result.json` of every run, read
 * out of the bundle a person would inspect by hand.
 *
 * Two decisions in this module are load-bearing:
 *
 *  - **M1 compares criteria, not counts.** `passed: 3, failed: 1` is the same summary whether AC-001
 *    or AC-003 broke, so a consistency check written against the counts would call two runs equal
 *    that failed different criteria - the one thing "the same code produced the same result twice"
 *    is supposed to mean. This one compares the per-iteration, per-criterion statuses, and reports
 *    *which* run and *which* criterion diverged instead of answering yes or no.
 *  - **A snapshot is a reading, not a promise.** Every field is validated at the boundary, because a
 *    bundle on disk may be from an older build, hand-edited, or truncated by a crash. A reading that
 *    cannot be trusted yields `null` and is reported as unreadable rather than counted as a clean
 *    run; a metric that treats an unreadable bundle as a pass is the false-PASS failure one level up.
 */

export type MetricVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface CriterionSnapshot {
  readonly criterionId: string;
  readonly status: string;
  readonly mandatory: boolean;
  /** Required artifacts this criterion did not get. Non-empty is what makes `PASS` impossible. */
  readonly missingEvidence: readonly string[];
}

export interface IterationSnapshot {
  readonly iteration: number;
  readonly verdict: string;
  readonly criteria: readonly { readonly criterionId: string; readonly status: string }[];
}

/** One run, as it can be read from `result.json` without reaching into anything else. */
export interface RunSnapshot {
  readonly runId: string;
  readonly verdict: MetricVerdict;
  readonly state: string;
  /** Every criterion's final status, with what the run recorded about its evidence. */
  readonly criteria: readonly CriterionSnapshot[];
  /** Every trip around the loop, each carrying the criteria *as that iteration saw them*. */
  readonly iterations: readonly IterationSnapshot[];
  /** Resets the environment actually performed, counted from its own recorded transitions. */
  readonly resets: number;
  readonly environmentValid: boolean;
}

// ---------------------------------------------------------------------------------------------
// Reading a bundle
// ---------------------------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const asNumber = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const asVerdict = (value: unknown): MetricVerdict | null =>
  value === "PASS" || value === "FAIL" || value === "INCONCLUSIVE" ? value : null;

/** Environment states are lowercase in the records; a reset is the transition out of `resetting`. */
const RESET_STATE = "resetting";

/**
 * Parse a `result.json` reading, or refuse it.
 *
 * `null` means "this is not a result I can measure", never "no problems found". The two fields the
 * metrics rest on are required: a verdict, and the per-iteration criterion detail that M1 compares.
 * A bundle written before `IterationSummary.criteria` existed is one this module cannot measure
 * honestly, and it says so instead of comparing three counts and calling it consistency.
 */
export function parseRunSnapshot(value: unknown): RunSnapshot | null {
  const root = asRecord(value);
  if (root === null) return null;

  const verdict = asVerdict(root["verdict"]);
  const runId = root["run_id"];
  if (verdict === null || typeof runId !== "string") return null;

  const iterations: IterationSnapshot[] = [];
  for (const raw of asArray(root["iterations"])) {
    const entry = asRecord(raw);
    if (entry === null) return null;
    const criteria = asArray(entry["criteria"]).map((item) => {
      const criterion = asRecord(item);
      return {
        criterionId: asString(criterion?.["criterion_id"], ""),
        status: asString(criterion?.["status"], ""),
      };
    });
    // An iteration with no criteria cannot be compared with one that has them, and treating the empty
    // list as agreement is exactly the silent-pass this module exists to refuse.
    if (criteria.length === 0) return null;
    iterations.push({
      iteration: asNumber(entry["iteration"], iterations.length + 1),
      verdict: asString(entry["verdict"], ""),
      criteria,
    });
  }
  if (iterations.length === 0) return null;

  const criteria = asArray(root["criteria"]).map((item) => {
    const criterion = asRecord(item);
    return {
      criterionId: asString(criterion?.["criterion_id"], ""),
      status: asString(criterion?.["status"], ""),
      mandatory: asBoolean(criterion?.["mandatory"], false),
      missingEvidence: asArray(criterion?.["missing_evidence"]).map((kind) => String(kind)),
    };
  });

  const environment = asRecord(root["environment"]);
  const transitions = asArray(environment?.["transitions"]).map((item) => asRecord(item));
  const resets = transitions.filter((entry) => asString(entry?.["from"], "") === RESET_STATE).length;

  return {
    runId,
    verdict,
    state: asString(root["state"], "UNKNOWN"),
    criteria,
    iterations,
    resets,
    environmentValid: asBoolean(root["environmentValid"], false),
  };
}

// ---------------------------------------------------------------------------------------------
// M1 - result consistency
// ---------------------------------------------------------------------------------------------

export interface ConsistencyDifference {
  readonly runId: string;
  readonly against: string;
  readonly detail: string;
}

export interface ConsistencyReport {
  readonly runs: number;
  readonly consistent: boolean;
  readonly baseline: string | null;
  readonly differences: readonly ConsistencyDifference[];
}

/** A run's result, in the only form that can be compared: which criteria, which status, which trip. */
const signature = (run: RunSnapshot): string =>
  [
    ...run.iterations.map(
      (iteration) =>
        `${iteration.iteration}:${iteration.criteria
          .map((criterion) => `${criterion.criterionId}=${criterion.status}`)
          // Sorted inside an iteration: the order criteria are evaluated in is not part of the result,
          // so two runs that observed the same statuses in a different order did agree.
          .sort()
          .join(",")}`,
    ),
    `verdict=${run.verdict}`,
  ].join("|");

/**
 * M1: the same code, run twice, reported the same thing.
 *
 * Consistency is a property of the *criteria*, per iteration, plus the final verdict. Counts are
 * deliberately not compared on their own: three passes that do not say *which* three is not a result
 * anyone can check, and a check written against them would pass two runs that disagreed about which
 * criterion failed.
 */
export function resultConsistency(runs: readonly RunSnapshot[]): ConsistencyReport {
  const first = runs[0];
  if (first === undefined) return { runs: 0, consistent: false, baseline: null, differences: [] };

  const mine = signature(first);
  const differences: ConsistencyDifference[] = [];
  for (const run of runs.slice(1)) {
    if (signature(run) === mine) continue;
    differences.push(...compareTo(first, run));
  }
  return {
    runs: runs.length,
    // One run is trivially self-consistent; saying so as `true` would hide that nothing was compared,
    // so a single run reports consistency with `runs: 1` and no differences and the caller prints it.
    consistent: runs.length > 1 && differences.length === 0,
    baseline: first.runId,
    differences,
  };
}

/**
 * Name the divergences, so a reader learns which criterion moved rather than that something did.
 *
 * Every detail is written from the point of view of `run`, the run named first in the printed prefix
 * `${runId} vs ${against}`. This is the whole contract of the line: a reader pairs the ids with the
 * values left to right, and when the two orders disagreed - the ids said `laterRun vs baseline` while
 * the values said `baseline, then laterRun` - the line read as a claim about the wrong run. Printed
 * over a real history it said `run-...-073547 vs run-...-072554: verdict: PASS vs INCONCLUSIVE` for a
 * run that was `INCONCLUSIVE` and a baseline that was `PASS`, which is an invitation to debug the
 * healthy run. *A delta is a sentence; its subject and its verb must agree.*
 */
function compareTo(baseline: RunSnapshot, run: RunSnapshot): readonly ConsistencyDifference[] {
  const out: ConsistencyDifference[] = [];
  const at = (snapshot: RunSnapshot, index: number): IterationSnapshot | undefined =>
    snapshot.iterations.find((iteration) => iteration.iteration === index);

  const indices = new Set([
    ...baseline.iterations.map((iteration) => iteration.iteration),
    ...run.iterations.map((iteration) => iteration.iteration),
  ]);
  for (const index of [...indices].sort((a, b) => a - b)) {
    const left = at(baseline, index);
    const right = at(run, index);
    if (left === undefined || right === undefined) {
      out.push({
        runId: run.runId,
        against: baseline.runId,
        detail: `iteration ${String(index)} was recorded by ${left === undefined ? run.runId : baseline.runId} and not by the other`,
      });
      continue;
    }
    const statusOf = (iteration: IterationSnapshot): Map<string, string> =>
      new Map(iteration.criteria.map((criterion) => [criterion.criterionId, criterion.status]));
    const baselineStatuses = statusOf(left);
    const runStatuses = statusOf(right);
    for (const criterionId of new Set([...baselineStatuses.keys(), ...runStatuses.keys()])) {
      const here = runStatuses.get(criterionId) ?? "absent";
      const there = baselineStatuses.get(criterionId) ?? "absent";
      if (here === there) continue;
      out.push({
        runId: run.runId,
        against: baseline.runId,
        detail: `iteration ${String(index)} ${criterionId}: ${here} vs ${there}`,
      });
    }
  }
  if (baseline.verdict !== run.verdict) {
    out.push({
      runId: run.runId,
      against: baseline.runId,
      detail: `verdict: ${run.verdict} vs ${baseline.verdict}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// M2 - defect detection, M3 - no false PASS
// ---------------------------------------------------------------------------------------------

export interface DetectionReport {
  readonly expected: readonly string[];
  readonly detected: readonly string[];
  readonly missed: readonly string[];
}

/** Did any run ever observe this criterion failing, at any point in its loop? */
const observedFailing = (run: RunSnapshot, criterionId: string): boolean =>
  run.iterations.some((iteration) =>
    iteration.criteria.some((criterion) => criterion.criterionId === criterionId && criterion.status !== "PASS"),
  ) || run.criteria.some((criterion) => criterion.criterionId === criterionId && criterion.status !== "PASS");

/**
 * M2: the defects that were supposed to be caught, caught.
 *
 * The ground truth has to come from whoever built the demo, because "a defect was present" is not a
 * fact the bundle can contain - the bundle knows what was observed, not what was intended. So the
 * caller passes the criteria that a defect was known to affect, and a criterion counts as detected
 * only when some run *observed* it failing. A criterion that never failed in any run is reported as
 * missed even if the runs all passed, which is what makes this a measurement and not a restatement.
 */
export function defectDetection(runs: readonly RunSnapshot[], expected: readonly string[]): DetectionReport {
  const detected = expected.filter((criterionId) => runs.some((run) => observedFailing(run, criterionId)));
  return {
    expected: [...expected],
    detected,
    missed: expected.filter((criterionId) => !detected.includes(criterionId)),
  };
}

export interface FalsePass {
  readonly runId: string;
  readonly detail: string;
}

/**
 * M3: a run reported `PASS` and should not have.
 *
 * Two ways this happens, and both are read from the bundle alone. A `PASS` criterion whose required
 * evidence is missing is the one the engine already refuses, so seeing it here would mean the engine
 * was bypassed; and a `PASS` for a criterion the caller knows a defect affected, in a run where that
 * criterion was never observed failing, is a false PASS in the only sense that matters - the run
 * blessed code that was known to be broken.
 */
export function falsePasses(runs: readonly RunSnapshot[], expected: readonly string[] = []): readonly FalsePass[] {
  const out: FalsePass[] = [];
  for (const run of runs) {
    if (run.verdict !== "PASS") continue;
    const unproven = run.criteria.filter((criterion) => criterion.missingEvidence.length > 0);
    if (unproven.length > 0) {
      out.push({
        runId: run.runId,
        detail: `PASS with required evidence missing for ${unproven.map((criterion) => criterion.criterionId).join(", ")}`,
      });
    }
    const blessed = expected.filter((criterionId) => !observedFailing(run, criterionId));
    if (blessed.length > 0) {
      out.push({
        runId: run.runId,
        detail: `PASS while ${blessed.join(", ")} never failed, though a defect was known to affect it`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// M4 - reset reproducibility, M5 - evidence completeness
// ---------------------------------------------------------------------------------------------

export interface ResetReport {
  readonly runs: number;
  readonly reproducible: boolean;
  readonly resets: number;
  readonly violations: readonly { readonly runId: string; readonly detail: string }[];
}

/**
 * M4: every iteration after the first re-observed a world that had been reset.
 *
 * `n` iterations need `n - 1` resets: the first observation may use the world as prepared, and no
 * later one may inherit it. The count is taken from the environment's own recorded transitions, not
 * from an assumption that a reset was asked for - a validator that inherits contaminated state is the
 * defect this metric exists to catch, and "we called reset" is not evidence that it happened.
 */
export function resetReproducibility(runs: readonly RunSnapshot[]): ResetReport {
  const violations: { runId: string; detail: string }[] = [];
  for (const run of runs) {
    const last = run.iterations.reduce((high, iteration) => Math.max(high, iteration.iteration), 0);
    const needed = Math.max(0, last - 1);
    if (run.resets < needed) {
      violations.push({
        runId: run.runId,
        detail: `${String(last)} iterations need ${String(needed)} resets, the environment recorded ${String(run.resets)}`,
      });
    }
    if (run.iterations.length > 1 && !run.environmentValid) {
      violations.push({ runId: run.runId, detail: "re-observed after a reset while the environment was not valid" });
    }
  }
  return {
    runs: runs.length,
    reproducible: violations.length === 0,
    resets: runs.reduce((total, run) => total + run.resets, 0),
    violations,
  };
}

export interface EvidenceReport {
  readonly criteria: number;
  readonly complete: number;
  readonly ratio: number;
  readonly violations: readonly { readonly runId: string; readonly criterionId: string; readonly missing: readonly string[] }[];
}

/** M5: every criterion got the evidence its contract required, counted rather than asserted. */
export function evidenceCompleteness(runs: readonly RunSnapshot[]): EvidenceReport {
  const violations: { runId: string; criterionId: string; missing: readonly string[] }[] = [];
  let criteria = 0;
  let complete = 0;
  for (const run of runs) {
    for (const criterion of run.criteria) {
      criteria += 1;
      if (criterion.missingEvidence.length === 0) complete += 1;
      else violations.push({ runId: run.runId, criterionId: criterion.criterionId, missing: criterion.missingEvidence });
    }
  }
  return { criteria, complete, ratio: criteria === 0 ? 0 : complete / criteria, violations };
}

// ---------------------------------------------------------------------------------------------
// The five, as one report
// ---------------------------------------------------------------------------------------------

export interface SuccessMetrics {
  readonly runs: number;
  readonly unreadable: readonly string[];
  readonly consistency: ConsistencyReport;
  readonly detection: DetectionReport;
  readonly falsePasses: readonly FalsePass[];
  readonly reset: ResetReport;
  readonly evidence: EvidenceReport;
}

export interface MetricOptions {
  /** Criteria a known defect was expected to break. M2 and M3 are unmeasurable without it. */
  readonly expectedDefects?: readonly string[];
  /** Bundles that could not be read. Reported, never dropped: an unreadable run is not a passing one. */
  readonly unreadable?: readonly string[];
}

export function successMetrics(runs: readonly RunSnapshot[], options: MetricOptions = {}): SuccessMetrics {
  const expected = options.expectedDefects ?? [];
  return {
    runs: runs.length,
    unreadable: [...(options.unreadable ?? [])],
    consistency: resultConsistency(runs),
    detection: defectDetection(runs, expected),
    falsePasses: falsePasses(runs, expected),
    reset: resetReproducibility(runs),
    evidence: evidenceCompleteness(runs),
  };
}

/**
 * The report as console lines.
 *
 * ASCII only, because this machine's code page renders a typographic dash as noise, and
 * `INCONCLUSIVE` for an unmeasurable metric rather than a comfortable `PASS`: M2 and M3 need ground
 * truth, and printing `PASS` for a metric that had nothing to compare would be the same lie this
 * module refuses at the level of the runs.
 */
export function formatMetrics(metrics: SuccessMetrics): readonly string[] {
  const lines: string[] = [];
  const yes = (value: boolean): string => (value ? "yes" : "no");

  lines.push(`runs measured: ${String(metrics.runs)}${metrics.unreadable.length > 0 ? ` (+${String(metrics.unreadable.length)} unreadable)` : ""}`);
  for (const path of metrics.unreadable) lines.push(`  unreadable: ${path}`);

  const m1 = metrics.consistency;
  lines.push(
    m1.runs > 1
      ? `M1 result consistency: ${yes(m1.consistent)} (${String(m1.runs)} runs, baseline ${m1.baseline ?? "none"})`
      : `M1 result consistency: INCONCLUSIVE (${String(m1.runs)} run, nothing to compare)`,
  );
  for (const difference of m1.differences) lines.push(`  ${difference.runId} vs ${difference.against}: ${difference.detail}`);

  const m2 = metrics.detection;
  lines.push(
    m2.expected.length === 0
      ? "M2 defect detection: INCONCLUSIVE (no known defects were named to detect)"
      : `M2 defect detection: ${String(m2.detected.length)}/${String(m2.expected.length)}${m2.missed.length > 0 ? ` (missed ${m2.missed.join(", ")})` : ""}`,
  );

  lines.push(
    metrics.falsePasses.length === 0
      ? "M3 false PASS: none"
      : `M3 false PASS: ${String(metrics.falsePasses.length)}${metrics.falsePasses.map((entry) => `\n  ${entry.runId}: ${entry.detail}`).join("")}`,
  );

  const m4 = metrics.reset;
  lines.push(`M4 reset reproducibility: ${yes(m4.reproducible)} (${String(m4.resets)} resets recorded)`);
  for (const violation of m4.violations) lines.push(`  ${violation.runId}: ${violation.detail}`);

  const m5 = metrics.evidence;
  lines.push(
    `M5 evidence completeness: ${String(m5.complete)}/${String(m5.criteria)} criteria (${(m5.ratio * 100).toFixed(0)}%)`,
  );
  for (const violation of m5.violations) {
    lines.push(`  ${violation.runId} ${violation.criterionId}: missing ${violation.missing.join(", ")}`);
  }
  return lines;
}
