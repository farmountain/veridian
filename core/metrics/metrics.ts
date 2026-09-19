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
  /**
   * The goal this run judged, and the world that judged it - the two halves of the run's subject.
   *
   * A run does not record what *code* it ran; it records which goal it was a reading of and which
   * adapter produced that reading. M1's question is "did the same code give the same result twice",
   * and those two fields are the only part of "the same code" a bundle can answer from. `null` means
   * the bundle did not carry it, which is a subject nothing can be compared against rather than a
   * subject that matches.
   */
  readonly goalId: string | null;
  readonly adapter: string | null;
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

  const goal = root["goal_id"];
  const adapter = environment?.["adapter"];

  return {
    runId,
    verdict,
    state: asString(root["state"], "UNKNOWN"),
    goalId: typeof goal === "string" && goal.length > 0 ? goal : null,
    adapter: typeof adapter === "string" && adapter.length > 0 ? adapter : null,
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
  /**
   * Whether M1 was answered at all, and it is a separate field from `consistent` on purpose.
   *
   * Three states are not two: "the runs agreed", "the runs disagreed", and "this population is not a
   * question M1 can answer". Folding the third into either boolean is what produced the defect this
   * field exists to close - an empty population must not read as a clean one, and a mixed one must
   * not read as an unclean one.
   */
  readonly measured: boolean;
  readonly consistent: boolean;
  readonly baseline: string | null;
  /**
   * The distinct subjects the population is a reading of, in the order they were first seen. More
   * than one is a history M1 refuses rather than compares.
   */
  readonly subjects: readonly string[];
  readonly differences: readonly ConsistencyDifference[];
}

/**
 * The subject a run is a reading of: the goal it judged, in the world that judged it.
 *
 * This is what "the same code" means from a bundle. A run does not record the source it ran; it
 * records the goal it was a reading of and the adapter that produced the reading, and two runs that
 * disagree about either are two different claims however their criteria are spelled. `?` marks a
 * bundle that did not carry the field: absent is a subject nothing can be compared against, and it is
 * deliberately not equal to a real one, so a population mixing the two is refused rather than
 * quietly split.
 */
const subjectOf = (run: RunSnapshot): string => `${run.goalId ?? "?"}@${run.adapter ?? "?"}`;

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
 *
 * The population is checked for being *one subject* before anything is compared, and a mixed history
 * is refused rather than compared. This was a real false PASS before it was a rule: `AC-001` means
 * something in every contract, the criterion ids restart at one per goal, and two goals repaired in
 * ascending criterion order produce byte-identical signatures - so the canonical cart demo and the
 * inventory demo, judged in a browser and in a database, were certified as "the same code run
 * twice". Only the subject tells them apart, and without it M1 was answering a question about two
 * criteria that merely shared a name.
 */
export function resultConsistency(runs: readonly RunSnapshot[]): ConsistencyReport {
  const first = runs[0];
  if (first === undefined) return { runs: 0, measured: false, consistent: false, baseline: null, subjects: [], differences: [] };

  const subjects = [...new Set(runs.map(subjectOf))];
  const mine = signature(first);
  const differences: ConsistencyDifference[] = [];
  if (subjects.length === 1) {
    for (const run of runs.slice(1)) {
      if (signature(run) === mine) continue;
      differences.push(...compareTo(first, run));
    }
  }
  // One run is trivially self-consistent, so a population of one is *unmeasured* rather than
  // consistent; a mixed population is unmeasured rather than inconsistent. Neither is a violation,
  // and the caller distinguishes them by reading `measured` instead of inferring it from `runs`.
  const measured = subjects.length === 1 && runs.length > 1;
  return {
    runs: runs.length,
    // `false` here is never a disagreement on its own - read `measured` beside it. A single run was
    // never compared and a mixed population was refused before anything was compared, and both say
    // `consistent: false` for that reason rather than because the runs diverged.
    measured,
    consistent: measured && differences.length === 0,
    baseline: first.runId,
    subjects,
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

/**
 * M2's report.
 *
 * An object rather than the bare `{ detected, missed }` pair it used to be, for the reason
 * `FalsePassReport` below is one: **a bare pair cannot say "I did not look"**, and `missed: []` reads
 * as a clean sweep whether the sweep happened or not. M2 and M3 are asked the same question of the
 * same caller-supplied list, so they refuse it for the same reason and say so in the same words.
 */
export interface DetectionReport {
  readonly runs: number;
  /** The criteria the caller named as ground truth, echoed so this report can be read on its own. */
  readonly expected: readonly string[];
  /**
   * Whether the ground truth was compared against anything.
   *
   * When `false`, `detected` and `missed` are both empty and mean nothing: this metric did not decline
   * to find a defect, it declined to ask. Read it rather than inferring the answer from the lengths.
   */
  readonly measured: boolean;
  /** The subject the ground truth was scoped to, or `null` when it could not be scoped. */
  readonly subject: string | null;
  /** Every subject the population spans. More than one is *why* the comparison was refused. */
  readonly subjects: readonly string[];
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
 *
 * It is scoped by subject for the same reason M3 is, and this metric is where the omission was found
 * rather than where it was first made. A criterion id is a name *inside one contract*, so `AC-001`
 * failing under `inventory-db` is not evidence that `shopping-cart`'s `AC-001` was ever detected -
 * and `runs.some(...)` over a history that holds both counted it as one. Over this repository's own
 * 142-run history M2 printed `3/3` while M3, reading the same list, refused to scope it: one ground
 * truth answering two ways, which is the shape that made M3 report 117 false passes for a while.
 *
 * The failure direction is the opposite one, and that is worth saying because it is what nearly let
 * it stay: M3 *accused* healthy runs and was spotted immediately, while M2 *credited* a detection no
 * run established and read as a clean bill. A metric can be wrong by being too kind.
 */
export function defectDetection(
  runs: readonly RunSnapshot[],
  expected: readonly string[] = [],
  expectedSubject: string | null = null,
): DetectionReport {
  const subjects = [...new Set(runs.map(subjectOf))];
  const subject = expectedSubject ?? (subjects.length === 1 ? (subjects[0] ?? null) : null);
  const measured = expected.length > 0 && subject !== null && subjects.includes(subject);
  const named = measured ? runs.filter((run) => subjectOf(run) === subject) : [];
  const detected = measured
    ? expected.filter((criterionId) => named.some((run) => observedFailing(run, criterionId)))
    : [];
  return {
    runs: runs.length,
    expected: [...expected],
    measured,
    subject,
    subjects,
    detected,
    missed: measured ? expected.filter((criterionId) => !detected.includes(criterionId)) : [],
  };
}

export interface FalsePass {
  readonly runId: string;
  /** The subject this run was a reading of, spelled `<goal-id>@<adapter>`. */
  readonly subject: string;
  readonly detail: string;
}

/**
 * M3's report.
 *
 * An object rather than a bare array, for the reason `ConsistencyReport` is one: **a bare array
 * cannot say "I did not look"**. A criterion id is a name *inside one contract* - `AC-001` is the
 * first criterion of every demo in this repository - so ground truth about `AC-001` is ground truth
 * about one **subject**, and applying it to a history spanning several compares a criterion against a
 * claim nobody made about it. This metric did exactly that and reported 117 false passes over a
 * history whose real number is zero.
 */
export interface FalsePassReport {
  readonly runs: number;
  /** The criteria the caller named as ground truth, echoed so this report can be read on its own. */
  readonly expected: readonly string[];
  /**
   * Whether the ground-truth half was compared against anything.
   *
   * `false` does **not** mean M3 found nothing: the bundle-only half was still read and the findings
   * it produced are still in `findings`. What is missing is the other half, and `none` would be a
   * claim about a comparison that never happened.
   */
  readonly measured: boolean;
  /** The subject the ground truth was scoped to, or `null` when it could not be scoped. */
  readonly subject: string | null;
  /** Every subject the population spans. More than one is *why* the comparison was refused. */
  readonly subjects: readonly string[];
  readonly findings: readonly FalsePass[];
}

/**
 * M3: a run reported `PASS` and should not have.
 *
 * Two ways this happens, and they are scoped differently on purpose.
 *
 * A `PASS` criterion whose required evidence is missing is read from the bundle alone and is reported
 * for **any** run: the engine already refuses that combination, so seeing it would mean the engine
 * was bypassed, and no ground truth is needed to say so. Declining to look for it because the ground
 * truth could not be scoped would hide a finding nothing was ambiguous about.
 *
 * A `PASS` for a criterion the caller knows a defect affected is reported only against runs of the
 * subject that ground truth is about - the caller's when they name one, and otherwise the
 * population's own, and only when the population holds exactly one. When it can be neither, nothing
 * is compared, and the report says so through `measured` rather than reporting the unearned
 * conclusion that a history spanning fourteen contracts has no false passes in it.
 */
export function falsePasses(
  runs: readonly RunSnapshot[],
  expected: readonly string[] = [],
  expectedSubject: string | null = null,
): FalsePassReport {
  const subjects = [...new Set(runs.map(subjectOf))];
  const subject = expectedSubject ?? (subjects.length === 1 ? (subjects[0] ?? null) : null);
  const measured = expected.length > 0 && subject !== null && subjects.includes(subject);

  const findings: FalsePass[] = [];
  for (const run of runs) {
    if (run.verdict !== "PASS") continue;
    const unproven = run.criteria.filter((criterion) => criterion.missingEvidence.length > 0);
    if (unproven.length > 0) {
      findings.push({
        runId: run.runId,
        subject: subjectOf(run),
        detail: `PASS with required evidence missing for ${unproven.map((criterion) => criterion.criterionId).join(", ")}`,
      });
    }
    // Ground truth, and only against a run that shares its subject: the same criterion id under
    // another goal or another adapter is a different claim wearing the same spelling.
    if (!measured || subjectOf(run) !== subject) continue;
    const blessed = expected.filter((criterionId) => !observedFailing(run, criterionId));
    if (blessed.length > 0) {
      findings.push({
        runId: run.runId,
        subject: subjectOf(run),
        detail: `PASS while ${blessed.join(", ")} never failed, though a defect was known to affect it`,
      });
    }
  }
  return { runs: runs.length, expected: [...expected], measured, subject, subjects, findings };
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
 *
 * This answers the reset question and nothing else. It used to carry a second branch - a run that
 * ended with an invalid world was pushed into the same `violations` list - and that branch reported a
 * run that correctly **aborted** because its reset failed as a reset that could not be reproduced.
 * The two properties are reported separately now (`worldValidityAtExit`), because they have two
 * different repairs and one flag for both cannot say which one fired.
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
  }
  return {
    runs: runs.length,
    reproducible: violations.length === 0,
    resets: runs.reduce((total, run) => total + run.resets, 0),
    violations,
  };
}

export interface WorldValidityReport {
  readonly runs: number;
  /**
   * Runs that ended with an invalid world **and** stopped because of it.
   *
   * Not a violation, and this is the whole reason the report exists: the environment check refused to
   * stand behind a result it could not vouch for, which is the check doing its job. Measured over the
   * 142-run history this metric was repaired against, the old conflated flag fired **once** and this
   * is what it was.
   */
  readonly stopped: number;
  /**
   * Runs that reached a terminal verdict over an invalid world without stopping for it.
   *
   * The property the old second branch was written to catch, and the only part of it worth accusing
   * anything of. The current loop cannot produce one - both of its invalid-world paths call `rollup`
   * with `environmentValid: false` and leave the state machine at `ABORTED` - and that is not a
   * reason to stop looking, because this function reads *bundles*: a reading can also have been
   * written by an older engine, and a metric that assumed the present code is the only thing that
   * ever wrote one would be reading a promise rather than a record.
   */
  readonly carriedOn: readonly { readonly runId: string; readonly detail: string }[];
}

/**
 * The world was still valid when the run ended.
 *
 * Reported apart from `resetReproducibility` because "the world was rebuilt between observations" and
 * "the world was valid at exit" are two questions with two different repairs, and one `reproducible`
 * flag for both could not say which had been answered.
 *
 * The two causes are told apart by reading the run's own terminal `state`, not by inferring from the
 * boolean: a run handed an invalid world *and* stopped on it is the abort, and a run that reached a
 * verdict over one is the defect.
 */
export function worldValidityAtExit(runs: readonly RunSnapshot[]): WorldValidityReport {
  const carriedOn: { runId: string; detail: string }[] = [];
  let stopped = 0;
  for (const run of runs) {
    if (run.environmentValid) continue;
    if (run.state === "ABORTED" || run.state === "ERROR") {
      stopped += 1;
      continue;
    }
    carriedOn.push({
      runId: run.runId,
      detail: `reached ${run.verdict} in state ${run.state} over a world the bundle records as invalid`,
    });
  }
  return { runs: runs.length, stopped, carriedOn };
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
  readonly falsePasses: FalsePassReport;
  readonly reset: ResetReport;
  readonly worldValidity: WorldValidityReport;
  readonly evidence: EvidenceReport;
}

export interface MetricOptions {
  /** Criteria a known defect was expected to break. M2 and M3 are unmeasurable without it. */
  readonly expectedDefects?: readonly string[];
  /**
   * The subject those criteria belong to, spelled `<goal-id>@<adapter>`.
   *
   * A criterion id is a name inside one contract, so ground truth without a subject is ground truth
   * about nothing in particular - and a metric that applied it to every run anyway reported 117 false
   * passes over a history that holds none. Absent, **both** M2 and M3 fall back to the population's
   * own subject, and only when that is a single one: they are handed the same list, so a subject that
   * scoped one and not the other would leave the pair disagreeing about one question.
   */
  readonly expectedSubject?: string | null;
  /** Bundles that could not be read. Reported, never dropped: an unreadable run is not a passing one. */
  readonly unreadable?: readonly string[];
}

export function successMetrics(runs: readonly RunSnapshot[], options: MetricOptions = {}): SuccessMetrics {
  const expected = options.expectedDefects ?? [];
  return {
    runs: runs.length,
    unreadable: [...(options.unreadable ?? [])],
    consistency: resultConsistency(runs),
    detection: defectDetection(runs, expected, options.expectedSubject ?? null),
    falsePasses: falsePasses(runs, expected, options.expectedSubject ?? null),
    reset: resetReproducibility(runs),
    worldValidity: worldValidityAtExit(runs),
    evidence: evidenceCompleteness(runs),
  };
}

/**
 * The sentence a ground-truth metric prints when its ground truth could not be scoped to a subject.
 *
 * Written once because M2 and M3 are handed the same list and must refuse it for the same reason.
 * They did not, once: over this repository's own history M3 said `INCONCLUSIVE` while M2 said `3/3`,
 * each having derived its own answer to "does this ground truth apply here". Two implementations of
 * one rule disagree the first time a population arrives that only one of them was written for, and a
 * *message* about that rule is an implementation of it too.
 *
 * The two branches are two different refusals and say so: nothing constrained the ground truth (a
 * history spanning several subjects), or something did and the population does not hold it (a subject
 * named on the command line that no bundle is a reading of).
 */
const unscopedRefusal = (
  label: string,
  report: {
    readonly expected: readonly string[];
    readonly subject: string | null;
    readonly subjects: readonly string[];
  },
): string => {
  const held = report.subjects.length === 0 ? "no runs at all" : report.subjects.join(", ");
  return report.subject === null
    ? `${label}: INCONCLUSIVE (${String(report.expected.length)} named defect(s) over ${String(report.subjects.length)} subjects: ${held} - a criterion id is a name inside one contract, so a named defect from one subject is not a claim about another)`
    : `${label}: INCONCLUSIVE (the named defects are scoped to ${report.subject}, which this history does not hold: ${held})`;
};

/**
 * The report as console lines.
 *
 * ASCII only, because this machine's code page renders a typographic dash as noise, and
 * `INCONCLUSIVE` for an unmeasurable metric rather than a comfortable `PASS`: M2 cannot be measured
 * at all without ground truth, and printing `PASS` for a metric that had nothing to compare would be
 * the same lie this module refuses at the level of the runs.
 *
 * M2 has three states rather than two, and the third is the one it spent a while missing. With no
 * ground truth it is `INCONCLUSIVE` - there was nothing to compare. With ground truth it cannot scope
 * it is `INCONCLUSIVE` again, naming the subject it scoped to when the caller named one and the
 * population otherwise, because `3/3` over fourteen subjects is a detection no single run
 * established. Only when the ground truth is about the population does it print a score, and it
 * names the subject there too - so a reader can tell a count earned against one contract from one
 * that stands for a history this never compared.
 *
 * M3 has four states, not two, and each is a different claim. It reports findings when it has any -
 * the bundle-only half is visible without ground truth and is still read. It says `INCONCLUSIVE` when
 * no ground truth was named, because then `none` would be a claim about a comparison that never
 * happened. It says `INCONCLUSIVE` again when ground truth *was* named but could not be scoped: a
 * criterion id is a name inside one contract, so ground truth for one subject applied to a history
 * spanning several compares each of them against a claim nobody made about it - which is exactly what
 * this metric did, reporting 117 false passes over a history that holds none. Only in the fourth
 * state - one subject, ground truth for it - does it say `none`, and it names the subject it scoped
 * to so a reader cannot mistake a scoped `none` for a whole-history one.
 *
 * M1 is the same distinction one state further along. It answers `yes` or `no` only when the
 * population is a reading of exactly one subject; a single run has nothing to compare, and a
 * population spanning two subjects is not a consistency question at all, because a criterion id is a
 * name *inside one contract*. Both print `INCONCLUSIVE` with the reason, and neither is a violation.
 *
 * M4 prints one line for the reset property and a second, only when there is something to say, for
 * the world's validity at exit - because a run that stopped on an invalid world and a run that
 * re-observed one are two different findings, and the flag that used to hold both reported a correct
 * abort as a reproducibility failure.
 */
export function formatMetrics(metrics: SuccessMetrics): readonly string[] {
  const lines: string[] = [];
  const yes = (value: boolean): string => (value ? "yes" : "no");

  lines.push(`runs measured: ${String(metrics.runs)}${metrics.unreadable.length > 0 ? ` (+${String(metrics.unreadable.length)} unreadable)` : ""}`);
  for (const path of metrics.unreadable) lines.push(`  unreadable: ${path}`);

  const m1 = metrics.consistency;
  lines.push(
    m1.subjects.length > 1
      ? `M1 result consistency: INCONCLUSIVE (${String(m1.runs)} runs over ${String(m1.subjects.length)} subjects: ${m1.subjects.join(", ")} - a criterion id is a name inside one contract, so criteria from two subjects are two unrelated claims)`
      : m1.runs > 1
        ? `M1 result consistency: ${yes(m1.consistent)} (${String(m1.runs)} runs, baseline ${m1.baseline ?? "none"})`
        : `M1 result consistency: INCONCLUSIVE (${String(m1.runs)} run, nothing to compare)`,
  );
  for (const difference of m1.differences) lines.push(`  ${difference.runId} vs ${difference.against}: ${difference.detail}`);

  const m2 = metrics.detection;
  lines.push(
    m2.expected.length === 0
      ? "M2 defect detection: INCONCLUSIVE (no known defects were named to detect)"
      : !m2.measured
        ? unscopedRefusal("M2 defect detection", m2)
        : `M2 defect detection: ${String(m2.detected.length)}/${String(m2.expected.length)} (scoped to ${m2.subject ?? "?"})${m2.missed.length > 0 ? ` (missed ${m2.missed.join(", ")})` : ""}`,
  );

  const m3 = metrics.falsePasses;
  if (m3.findings.length > 0) {
    lines.push(
      `M3 false PASS: ${String(m3.findings.length)}${m3.findings
        .map((entry) => `\n  ${entry.runId} (${entry.subject}): ${entry.detail}`)
        .join("")}`,
    );
  } else if (m3.expected.length === 0) {
    lines.push(
      "M3 false PASS: INCONCLUSIVE (no known defects were named, so a pass that blessed one could not be told from an earned pass)",
    );
  } else if (!m3.measured) {
    lines.push(unscopedRefusal("M3 false PASS", m3));
  } else {
    lines.push(`M3 false PASS: none (scoped to ${m3.subject ?? "?"})`);
  }

  const m4 = metrics.reset;
  lines.push(`M4 reset reproducibility: ${yes(m4.reproducible)} (${String(m4.resets)} resets recorded)`);
  for (const violation of m4.violations) lines.push(`  ${violation.runId}: ${violation.detail}`);

  const world = metrics.worldValidity;
  if (world.stopped > 0 || world.carriedOn.length > 0) {
    lines.push(
      `M4 world validity at exit: ${String(world.stopped)} run(s) stopped on an invalid world, ${String(world.carriedOn.length)} carried on`,
    );
    for (const entry of world.carriedOn) lines.push(`  ${entry.runId}: ${entry.detail}`);
  }

  const m5 = metrics.evidence;
  lines.push(
    `M5 evidence completeness: ${String(m5.complete)}/${String(m5.criteria)} criteria (${(m5.ratio * 100).toFixed(0)}%)`,
  );
  for (const violation of m5.violations) {
    lines.push(`  ${violation.runId} ${violation.criterionId}: missing ${violation.missing.join(", ")}`);
  }
  return lines;
}

/**
 * Whether any metric was actually violated, which is the question the `metrics` command's exit code
 * answers.
 *
 * It lives here rather than at the call site because the decision is about these reports, and because
 * it was previously an `||` chain inside `cli/veridian.ts` that no test in the tree could reach:
 * `runMetrics` is module-private, so the predicate deciding the process's exit code - over the whole
 * history, for every user of the command - had no coverage at all.
 *
 * Only an **answered** `no` is a violation, and for M1 that answer is `measured`. M1 reports
 * `consistent: false` both when two runs disagreed and when it had nothing to compare - one run, or a
 * history spanning two subjects - and it says so through `measured`. Reading it as
 * `runs > 1 && !consistent`, which is what it was, worked for the single run by accident and accused
 * a mixed history of a disagreement it had refused to look for.
 *
 * M3 is the same distinction pointing the other way, and its clause is therefore **not** guarded the
 * same way. `FalsePassReport.measured` describes the half of M3 that needed ground truth to be
 * scoped; it does not describe the findings, and a `measured: false` report can still hold answered
 * ones, because the missing-evidence half is decided from the bundle alone. `formatMetrics` prints
 * whatever findings exist, whatever `measured` says - so a predicate reading
 * `falsePasses.measured && findings.length > 0` would print `M3 false PASS: 1` and then report that
 * the history is clean. A finding is the answered thing; `measured` separates `none` from `I did not
 * look`, and neither of those two is a violation.
 *
 * `worldValidity` is deliberately absent. On this history its one finding is a run that *correctly*
 * aborted because the world could not be rebuilt, which is the product working; promoting it would
 * require a case where a run continued in an invalid world, and there is none. M2 is absent for a
 * different reason stated at `runMetrics`: without `--defects` it is unmeasurable, and an
 * unmeasurable metric must not be allowed to fail - or to pass - a command.
 */
export function metricViolations(metrics: SuccessMetrics): boolean {
  return (
    (metrics.consistency.measured && !metrics.consistency.consistent) ||
    metrics.falsePasses.findings.length > 0 ||
    !metrics.reset.reproducible ||
    metrics.evidence.violations.length > 0
  );
}
