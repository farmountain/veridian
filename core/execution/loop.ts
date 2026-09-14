import { encodeStep } from "../acceptance/plan.ts";
import type { CriterionPlan } from "../acceptance/plan.ts";
import type { DetectorContext } from "../clarification/detect.ts";
import { detectIterationAmbiguities, runtimeDetectors } from "../clarification/detect.ts";
import type { Ambiguity, ClarificationReport } from "../clarification/types.ts";
import type { ClarificationEngine } from "../clarification/engine.ts";
import type { BoundaryCrossing, EvidenceArtifact, Observation, ObservationRequest } from "../environment/types.ts";
import type { EnvironmentRecord } from "../evidence/index.ts";
import { environmentRecord } from "../evidence/index.ts";
import type { Failure } from "../failure.ts";
import { classifyError, failure } from "../failure.ts";
import type { RollupGuard, Verdict } from "../validation/rollup.ts";
import { rollup } from "../validation/rollup.ts";
import { evaluateCriterion } from "../validation/registry.ts";
import type { CriterionResult } from "../validation/types.ts";
import type { RepairGate, RepairOutcome } from "./types.ts";
import type { CriterionExecution, IterationSummary, LoopOptions, LoopResult } from "./types.ts";

/**
 * The validation loop — this system's ReAct loop.
 *
 * Reason, act, observe, judge, decide. One turn is: *prepare the world*, *act on it*, *observe what
 * happened*, *judge the observation against the goal's acceptance criteria*, then *decide whether
 * another turn is warranted*. The loop's entire feedback channel is the run bundle: `result.json`,
 * `latest-failure.md` and `clarifications.json` are what an external agent reads. Veridian never
 * tells the agent what to change. It says what it observed, and stops there.
 *
 * Five properties are structural rather than intended, and each is worth stating because it is the
 * kind of thing a refactor quietly removes:
 *
 *  1. **Every gap goes through the protocol, including the runtime gaps.** The loop does not decide
 *     for itself that an unmeasurable criterion is undecidable. It raises that as an ambiguity, and
 *     the same ladder that resolved the goal document resolves it — so the reason ends up in
 *     `clarifications.json` instead of in a comment nobody reads.
 *  2. **The loop never asks a human mid-run.** Runtime ambiguities are non-blocking by construction,
 *     which restricts the ladder to DERIVE → INFER → DEFAULT. A prompt in the middle of a run would
 *     let the verdict depend on who happened to be watching.
 *  3. **The decision to iterate is read, not computed.** There is one source for it — the detector's
 *     facts plus the ladder's fail-safe default — and the rationale it returns *becomes* the exit
 *     reason in the bundle. A loop that computed a decision and then confirmed it would have two
 *     sources, and when they disagree the one that wins is whichever ran last.
 *  4. **The verdict guards come from `rollup` and nowhere else.** Even the environment-failure path
 *     calls `rollup` with `environmentValid: false` rather than hand-assembling a verdict, because a
 *     hand-assembled guard record is a second opinion about whether a run may pass.
 *  5. **Every exit is bounded, and bounded twice.** The attempt cap and the wall-clock cap are
 *     counted separately, because a frozen or injected clock makes a time-based exit unreachable —
 *     and an unbounded loop is the one failure mode this system may not have.
 */
export async function runValidationLoop(options: LoopOptions): Promise<LoopResult> {
  const { clock, logger, bundle, plan, environment, limits, run, world } = options;
  const startedAt = clock.now();
  const logs: ClarificationReport[] = [...options.definitionReports];
  const iterations: IterationSummary[] = [];
  const allCriteria: CriterionResult[] = [];
  const allExecutions: CriterionExecution[] = [];

  // The caller's claim is about the *definition*, and a definition with a blocking gap never reaches a
  // run at all — `resolveDefinition` refuses it. Recomputing the flag from the log every time it is
  // used closes the other half: whatever the ladder could not answer, in whichever phase, is a fact
  // `rollup` sees. A run cannot report PASS over a gap it knows it left open.
  const informationState = (): {
    readonly insufficientInformation: boolean;
    readonly insufficientInformationDetail: string | null;
  } => {
    const blocked = blockingGaps(logs);
    return {
      insufficientInformation: (options.insufficientInformation ?? false) || blocked.length > 0,
      insufficientInformationDetail:
        options.insufficientInformationDetail ?? (blocked.length > 0 ? blocked.join(" | ") : null),
    };
  };

  // Idempotent, and called here rather than left to the caller: an adapter writes its artifacts into
  // the bundle, so a run that forgot to create the directories would lose evidence to an `ENOENT`.
  await bundle.init();

  // The runtime detector table, indexed by phase. Reading it as data rather than calling the
  // detectors directly keeps one enumeration of "which questions may a runtime stage ask".
  const table = new Map(runtimeDetectors().map((entry) => [entry.origin, entry.detect]));
  const raise = (artifact: unknown, origins: readonly string[]): Ambiguity[] =>
    origins.flatMap((origin) => table.get(origin)?.(artifact, options.detectorContext) ?? []);

  // ---- PREPARE ------------------------------------------------------------------------------
  run.to("PREPARING", `preparing environment "${environment.adapter}"`);
  const prepared = await world.prepare(environment);
  // A record is a reading, not a promise. `world.transitions` grows while the run works - the reset
  // between iterations is exactly the event it is supposed to show - so reading it once here froze
  // `environment.json`, and every `result.json` after it, at the prepare step. The canonical
  // four-iteration demo resets the world three times and its bundle recorded a world whose last
  // event was `ready` before the first observation: the record said the run never reset, and M4
  // reported the reset it could not see. Re-read at each write instead. The boundary report is read
  // the same way and for the same reason: it fills up as requests are refused.
  const envRecord = (): EnvironmentRecord =>
    environmentRecord(environment, prepared.health, world.transitions, prepared.ok, world.boundaries());
  await bundle.writeEnvironment(envRecord());

  if (!prepared.ok) {
    // The environment is the product. A criterion measured in a world that failed its own health
    // check is not a measurement of the application, so none are taken and none are reported — and
    // the verdict is produced by `rollup`, not by this branch.
    const message = `The environment could not be prepared: ${prepared.failure.message}`;
    logger.warn("environment preparation failed", { kind: prepared.failure.kind, message });
    run.to("ABORTED", message);
    await bundle.log("environment.failed", { kind: prepared.failure.kind, message });
    const outcome = rollup({
      criteria: [],
      environmentValid: false,
      environmentMessage: message,
      safetyViolation: safetyState(options),
      ...informationState(),
    });
    return finish({
      options,
      logs,
      iterations,
      criteria: [],
      executions: [],
      verdict: outcome.verdict,
      failure: outcome.failure ?? prepared.failure,
      reasons: outcome.reasons,
      guards: outcome.guards,
      environment: envRecord(),
      startedAt,
    });
  }

  run.to("READY", `environment ready (${prepared.state})`);
  await bundle.log("environment.ready", { id: world.id, health: prepared.health.statusCode });

  // ---- ITERATE ------------------------------------------------------------------------------
  let verdict: Verdict = "INCONCLUSIVE";
  let failureOut: Failure | null = null;
  let reasons: readonly string[] = [];
  // Assigned by `rollup` on the first iteration, before any path can read it. Declared with a
  // definite-assignment assertion rather than seeded with a hand-written all-clear: a fabricated
  // guard record is a second opinion about whether a run may pass, and there is only one source.
  let guards!: Readonly<Record<RollupGuard, boolean>>;
  let iteration = 1;

  for (;;) {
    run.to("EXECUTING", `iteration ${String(iteration)}: executing ${String(plan.criteria.length)} criteria`);

    // ACT. The world drives the application one criterion at a time. Each criterion gets its own
    // request so that a hang in one is a hang in one: the per-criterion cap exists precisely so a
    // single unresponsive step cannot consume the whole run's budget.
    const observations: Observation[] = [];
    for (const criterion of plan.criteria) {
      const request: ObservationRequest = {
        criterionId: criterion.spec.id,
        runId: run.runId,
        steps: criterion.steps.map(encodeStep),
        targets: readTargets(criterion),
        evidence: [...criterion.evidence],
      };
      observations.push(await observe(request, criterion.maxCriterionMs));
    }

    // OBSERVE. Artifacts are *recorded*, not copied: the adapter wrote them into the bundle because it
    // is the thing that witnessed the state. Copying bytes here would create a second version of the
    // same evidence that can silently drift from the first — and an evidence layer with two truths
    // has none.
    run.to("OBSERVING", "recording the evidence the world produced");
    for (const observation of observations) {
      for (const artifact of observation.artifacts) bundle.record(artifact);
      if (observation.error) {
        await bundle.log("observation.failed", {
          kind: observation.error.kind,
          message: observation.error.message,
        });
      }
    }

    // VALIDATE. Judgement is a pure function of the observation. Nothing here consults the world, so
    // the same observation always yields the same status — which is what M1 measures.
    run.to("VALIDATING", "judging the observations");
    const judged: CriterionExecution[] = plan.criteria.map((criterion, index) => {
      const observation =
        observations[index] ?? emptyObservation(run.runId, world.id ?? "unknown", clock.iso());
      const result = evaluateCriterion(criterion.spec, observation, {
        registry: options.registry,
        runId: run.runId,
        environmentId: world.id ?? "unknown",
        timestamp: clock.iso(),
      });
      return { plan: criterion, observation, result, note: null };
    });

    // The runtime conversation: two questions for every iteration, neither rhetorical. "What accounts
    // for a criterion the world could not measure?" and "why is this criterion unproven?" Both default
    // to a recorded reason and neither may be put to a human — so a run's own indeterminacy ends up
    // documented rather than hidden behind a status code.
    const runtime = await resolveRuntime(judged);
    logs.push(...runtime.reports);

    const criteria = runtime.executions.map((entry) => entry.result);
    allCriteria.push(...criteria);
    allExecutions.push(...runtime.executions);

    const outcome = rollup({
      criteria,
      environmentValid: true,
      safetyViolation: safetyState(options),
      ...informationState(),
    });
    verdict = outcome.verdict;
    failureOut = outcome.failure;
    reasons = outcome.reasons;
    guards = outcome.guards;

    const failed = criteria.filter((entry) => entry.status === "FAIL");
    const base = {
      iteration,
      verdict,
      passed: criteria.filter((entry) => entry.status === "PASS").length,
      failed: failed.length,
      undecided: criteria.filter((entry) => entry.status !== "PASS" && entry.status !== "FAIL").length,
      // Which criteria those counts are made of. Recorded per iteration because the run bundle keeps
      // only the final iteration's per-criterion detail, and a count of three passes that does not say
      // *which* three is not a repeat-run comparison - see `IterationSummary.criteria`.
      criteria: criteria.map((entry) => ({ criterionId: entry.criterionId, status: entry.status })),
    };

    // DECIDE. Not computed here — asked, and answered by the ladder, with the rationale kept.
    const decision = await resolveIteration({
      iteration,
      verdict,
      elapsedMs: clock.now() - startedAt,
    });
    logs.push(decision.report);
    await bundle.log("iteration.decided", {
      iteration,
      verdict,
      decision: decision.value,
      rationale: decision.assumption,
    });

    if (decision.value === "complete") {
      iterations.push({
        ...base,
        repaired: false,
        note: "every mandatory criterion passed with its required evidence present",
      });
      run.to("COMPLETED", "all mandatory criteria passed with evidence present");
      return finish({
        options,
        logs,
        iterations,
        criteria: allCriteria,
        executions: allExecutions,
        verdict,
        failure: failureOut,
        reasons,
        guards,
        environment: envRecord(),
        startedAt,
      });
    }

    if (decision.value !== "continue") {
      iterations.push({ ...base, repaired: false, note: decision.assumption });
      run.to("FAILED", decision.assumption);
      // The state machine keeps "ran out of iterations" and "never had a decidable question" apart,
      // and the difference is the difference between a spent budget and a contract that could not be
      // executed. The bucket is chosen from *why* the run stopped — the same fact the detector
      // consulted — not from the verdict, which is only correlated with it. A FAIL with a live repair
      // path that the budget forbade is `MAX_ITERATIONS`; a FAIL with nowhere to go is `ABORTED`.
      const budgetSpent = iteration >= limits.maxIterations;
      run.to(verdict === "FAIL" && budgetSpent ? "MAX_ITERATIONS" : "ABORTED", decision.assumption);
      return finish({
        options,
        logs,
        iterations,
        criteria: allCriteria,
        executions: allExecutions,
        verdict,
        failure: failureOut,
        reasons: [...reasons, `Stopped after iteration ${String(iteration)}: ${decision.assumption}`],
        guards,
        environment: envRecord(),
        startedAt,
      });
    }

    // Continue is only reachable on a FAIL with a live repair path. The bundle is written *first*:
    // the whole agent interface is those two files, and an agent handed a path to a report that has
    // not been written yet is an agent reading the previous iteration.
    const index = iterations.push({
      ...base,
      repaired: false,
      note: "the failure was handed to the repair gate; see execution.log for the outcome",
    }) - 1;
    await write(iteration);
    const repair = await attemptRepair(iteration, verdict, failureOut, failed, reasons);
    // One summary per iteration, revised in place once the gate has answered. Appending a second
    // entry would make the bundle's iteration count disagree with the run's.
    iterations[index] = { ...base, repaired: repair.decision === "repaired", note: repair.note };
    await bundle.log("iteration.repair", { iteration, decision: repair.decision, note: repair.note });

    run.to("FAILED", `iteration ${String(iteration)} failed (${String(failed.length)} criterion/criteria)`);

    if (repair.decision !== "repaired") {
      run.to("ABORTED", repair.note);
      return finish({
        options,
        logs,
        iterations,
        criteria: allCriteria,
        executions: allExecutions,
        verdict,
        failure: failureOut,
        reasons: [...reasons, repair.note],
        guards,
        environment: envRecord(),
        startedAt,
      });
    }

    // RESET. `FAILED → READY` is deliberately absent from the transition table: the reset is a hop
    // that must actually happen. A validator that inherits a mutated world is not validating the
    // application the previous iteration reported on, and M4 counts exactly this.
    run.to("RESETTING", "resetting the world before re-observing");
    const reset = await world.reset();
    if (!reset.ok) {
      const message = `The world could not be reset after iteration ${String(iteration)}: ${reset.failure.message}`;
      run.to("ABORTED", message);
      const resetOutcome = rollup({
        criteria: allCriteria,
        environmentValid: false,
        environmentMessage: message,
        safetyViolation: safetyState(options),
        ...informationState(),
      });
      return finish({
        options,
        logs,
        iterations,
        criteria: allCriteria,
        executions: allExecutions,
        verdict: resetOutcome.verdict,
        failure: resetOutcome.failure ?? reset.failure,
        reasons: [
          message,
          ...resetOutcome.reasons,
          "The previous iteration's result is kept in the record but is not offered as a verdict: a " +
            "world that cannot return to a known state cannot be said to have measured anything twice.",
        ],
        guards: resetOutcome.guards,
        environment: environmentRecord(environment, reset.health, world.transitions, false, world.boundaries()),
        startedAt,
      });
    }

    if (!run.nextIteration(`iteration ${String(iteration + 1)}: re-observing after a repair`)) {
      // The structural backstop. Reaching here means the ladder granted a continuation that the
      // attempt budget cannot honour — two sources for one decision disagreeing, which is the class
      // of defect this loop exists to make impossible. If it ever fires it must be visible, not
      // absorbed.
      const message = "the iteration budget is spent even though the protocol granted a continuation";
      run.to("ABORTED", message);
      return finish({
        options,
        logs,
        iterations,
        criteria: allCriteria,
        executions: allExecutions,
        verdict,
        failure: failureOut,
        reasons: [...reasons, message],
        guards,
        environment: envRecord(),
        startedAt,
      });
    }
    iteration += 1;
  }

  // ---- local helpers ------------------------------------------------------------------------

  /**
   * Take one observation, with the per-criterion cap.
   *
   * A timeout is reported as a criterion-level failure, never as an environment failure: the world was
   * healthy enough to accept the request, so blaming the sandbox for the application's hang would be
   * a category error — and one that would move the run's verdict from FAIL to INCONCLUSIVE.
   */
  async function observe(request: ObservationRequest, perCriterionMs: number): Promise<Observation> {
    try {
      return await withTimeout(world.execute(request), perCriterionMs, () =>
        emptyObservation(
          request.runId,
          world.id ?? "unknown",
          clock.iso(),
          failure("TIMEOUT", `criterion ${request.criterionId} exceeded ${String(perCriterionMs)}ms`),
        ),
      );
    } catch (error) {
      const classified = classifyError(error, "TEST_FAILURE");
      return emptyObservation(request.runId, world.id ?? "unknown", clock.iso(), classified);
    }
  }

  async function resolveRuntime(judged: readonly CriterionExecution[]): Promise<ResolvedRuntime> {
    const document = {
      criteria: judged.map((entry) => ({
        criterionId: entry.result.criterionId,
        mandatory: entry.result.mandatory,
        status: entry.result.status,
        observationError: entry.observation.error?.message ?? null,
        observationKind: entry.observation.kind,
        missingEvidence: [...entry.result.missingEvidence],
        note: null as string | null,
        evidenceNote: null as string | null,
      })),
    };

    const ambiguities = raise(document, ["execution", "evidence"]);
    if (ambiguities.length === 0) return { executions: judged, reports: [] };

    const resolved = await options.clarifier.resolve(document, ambiguities);
    const patched = resolved.artifact.criteria;

    // Read the answers back off the artifact rather than reconstructing them by string-matching the
    // records. The artifact is the protocol's own verdict; a lookup table keyed on a path this
    // function invented would be a second, quieter source of truth for the same explanation.
    const executions = judged.map((entry, index) => {
      const note = joinNotes(patched[index]?.note, patched[index]?.evidenceNote);
      return note === null ? entry : { ...entry, note };
    });

    const reports =
      resolved.report.records.length === 0
        ? []
        : RUNTIME_ORIGINS.map((origin) => restrictTo(resolved.report, origin)).filter(
            (report) => report.records.length > 0,
          );

    return { executions, reports };
  }

  /**
   * Ask the protocol whether the run may take another step.
   *
   * There is one source for the decision and it is the ladder: the detector states the facts, the
   * fail-safe default supplies the conservative answer together with its rationale, and any resolution
   * actually chosen is recorded with its rung. That rationale becomes the exit reason in the bundle,
   * which is what makes a bounded loop auditable rather than merely claimed.
   */
  async function resolveIteration(facts: {
    readonly iteration: number;
    readonly verdict: Verdict;
    readonly elapsedMs: number;
  }): Promise<IterationDecision> {
    const document = {
      iteration: facts.iteration,
      maxIterations: limits.maxIterations,
      elapsedMs: facts.elapsedMs,
      maxRuntimeMs: limits.maxRuntimeMs,
      verdict: facts.verdict,
      repairGate: options.repairGate.kind,
      decision: null as string | null,
    };

    const ambiguities = detectIterationAmbiguities(document, options.detectorContext);
    const resolved = await options.clarifier.resolve(document, ambiguities);
    const record = resolved.report.records.find((entry) => entry.ambiguity.origin === "iteration");

    return {
      value: String(resolved.artifact.decision ?? "stop"),
      assumption:
        record === undefined
          ? "the iteration decision was not recorded, so the run stopped"
          : resolutionText(record),
      report: resolved.report,
    };
  }

  async function attemptRepair(
    currentIteration: number,
    currentVerdict: Verdict,
    currentFailure: Failure | null,
    currentFailed: readonly CriterionResult[],
    currentReasons: readonly string[],
  ): Promise<RepairOutcome> {
    const layout = bundle.layout;
    try {
      return await gateRepair(options.repairGate, {
        runId: run.runId,
        iteration: currentIteration,
        maxIterations: limits.maxIterations,
        verdict: currentVerdict,
        failure: currentFailure,
        failed: currentFailed,
        resultPath: `${layout.runDir}/result.json`,
        failureReportPath: `${layout.runDir}/failure.md`,
        reasons: currentReasons,
      });
    } catch (error) {
      // A gate that throws has not repaired anything. Treating the throw as a repair would be the one
      // way an external actor could turn a failure into an iteration — and iterations can become PASS.
      return {
        decision: "stop",
        note: `the repair gate failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async function write(currentIteration: number): Promise<void> {
    await bundle.writeClarifications(logs);
    await bundle.writeResult({
      runId: run.runId,
      goalId: run.goalId,
      state: run.current().state,
      iteration: currentIteration,
      verdict,
      criteria: allCriteria,
      failure: failureOut,
      reasons,
      guards,
      // The mid-run write is the one an agent reads while the loop is still going, so it carries the
      // same live reading `finish` does - a violation observed in iteration one has to be visible in
      // the report written at the end of iteration one, not only in the final bundle.
      safetyViolation: safetyState(options),
      environment: envRecord(),
      iterations,
      clarifications: logs,
      reproducibility: options.reproducibility,
      limits: {
        maxIterations: limits.maxIterations,
        maxRuntimeMs: limits.maxRuntimeMs,
        elapsedMs: clock.now() - startedAt,
      },
    });
  }
}

const RUNTIME_ORIGINS = ["execution", "evidence"] as const;

// ---------------------------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------------------------

interface ResolvedRuntime {
  readonly executions: readonly CriterionExecution[];
  readonly reports: readonly ClarificationReport[];
}

interface IterationDecision {
  readonly value: string;
  readonly assumption: string;
  readonly report: ClarificationReport;
}

/**
 * The questions the ladder could not answer, as prose.
 *
 * Only `deferred` *blocking* records count. A non-blocking gap is a value the run chose conservatively
 * and recorded; a blocking one is a question that changes what the run is measuring, and a run that
 * answered it by guessing is a run whose PASS would mean less than it says. `INCONCLUSIVE` is not
 * `PASS`, and neither is a PASS that was reached over an open question.
 */
function blockingGaps(reports: readonly ClarificationReport[]): readonly string[] {
  const found: string[] = [];
  for (const report of reports) {
    for (const record of report.records) {
      if (record.resolution.via !== "deferred") continue;
      if (!record.ambiguity.blocking) continue;
      found.push(`${record.ambiguity.path}: ${record.ambiguity.question}`);
    }
  }
  return found;
}

/** One criterion, one reason it was not a measurement. Both runtime explanations are kept. */
function joinNotes(...notes: readonly (string | null | undefined)[]): string | null {
  const kept = notes.filter((note): note is string => typeof note === "string" && note.length > 0);
  return kept.length === 0 ? null : kept.join(" ");
}

function restrictTo(report: ClarificationReport, origin: string): ClarificationReport {
  return { ...report, records: report.records.filter((record) => record.ambiguity.origin === origin) };
}

/**
 * The recorded resolution, as prose.
 *
 * Deliberately a switch over the union rather than a lookup on whichever key happens to be present:
 * a new rung must not silently start producing `"resolved via ..."` placeholders in the bundle.
 */
function resolutionText(record: {
  readonly resolution: { readonly via: string; readonly [key: string]: unknown };
}): string {
  const resolution = record.resolution;
  switch (resolution.via) {
    case "derived":
      return typeof resolution["evidence"] === "string" ? resolution["evidence"] : "derived from the artifact";
    case "inferred": {
      const confidence = typeof resolution["confidence"] === "number" ? resolution["confidence"] : null;
      const source = typeof resolution["source"] === "string" ? resolution["source"] : "an inference";
      return confidence === null ? `inferred from ${source}` : `inferred from ${source} (confidence ${String(confidence)})`;
    }
    case "defaulted":
      return typeof resolution["assumption"] === "string"
        ? resolution["assumption"]
        : "defaulted to the fail-safe value";
    case "answered":
      return typeof resolution["answer"] === "string" ? `answered: ${resolution["answer"]}` : "answered";
    case "deferred":
      return typeof resolution["reason"] === "string"
        ? `deferred (${resolution["reason"]}) - the run therefore never had a decidable question`
        : "deferred";
    default:
      return "resolved by an unrecognised rung";
  }
}

function emptyObservation(
  runId: string,
  environmentId: string,
  capturedAt: string,
  error?: Failure,
): Observation {
  return { kind: "web", capturedAt, environmentId, runId, data: {}, artifacts: [], error: error ?? null };
}

/**
 * Which selectors the adapter must read for this criterion.
 *
 * Derived from the *expectations*, not from the steps, and derived here rather than inside the
 * adapter because this is the only layer that holds the accepted contract: an adapter that inferred
 * its own read set from the steps it was handed could not answer a question about an element nothing
 * interacted with, and the difference is exactly the class of defect the sandbox exists to catch.
 *
 * Deduplicated so two expectations on the same element cost one DOM read, and left in first-seen
 * order so the wire record is a function of the contract alone — reproducible across runs, which is
 * what M1 measures.
 */
function readTargets(criterion: CriterionPlan): readonly string[] {
  const targets: string[] = [];
  for (const expectation of criterion.expectations) {
    const target = expectation.target;
    if (target !== null && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

/**
 * A cap on one observation.
 *
 * The timer is unref'd and always cleared: a leaked timer keeps a finished process alive, which is
 * exactly the kind of unbounded exit this loop is not allowed to have.
 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Kept separate so the loop's own call site stays readable. Wrapped by the caller in a try/catch. */
function gateRepair(
  gate: RepairGate,
  request: Parameters<RepairGate["repair"]>[0],
): Promise<RepairOutcome> {
  return gate.repair(request);
}

/**
 * The run's safety reading: a violation the caller injected, or the first thing the world's boundary
 * refused.
 *
 * `null` means "none observed", never "there was none" - no world can prove a universal negative, and
 * a guard reporting one would claim more than any observation supports. So the reading is built from
 * what was actually *watched*. The injection point stays because a caller - a test, or a supervising
 * harness - may know of a violation Veridian's own adapters cannot see; the crossings are new because
 * the adapters can now see their own. Neither suppresses the other, which is what makes this a union
 * rather than a precedence.
 */
function safetyState(options: LoopOptions): string | null {
  const injected = options.safetyViolation ?? null;
  if (injected !== null) return injected;

  const crossings = options.world.boundaries().crossings;
  const first: BoundaryCrossing | undefined = crossings[0];
  if (first === undefined) return null;

  // Composed here rather than in the adapter. A `BoundaryCrossing` is a fact - what was refused, when,
  // during which criterion - and the sentence a reader sees is the core's to write, in the same place
  // every other reason string in the bundle is written.
  const during = first.criterionId === null ? "" : ` while observing ${first.criterionId}`;
  const further = crossings.length > 1 ? ` (and ${String(crossings.length - 1)} more)` : "";
  return `the ${first.boundary} boundary was crossed at ${first.at}: ${first.subject}${during}${further}`;
}

interface FinishInput {
  readonly options: LoopOptions;
  readonly logs: readonly ClarificationReport[];
  readonly iterations: readonly IterationSummary[];
  readonly criteria: readonly CriterionResult[];
  readonly executions: readonly CriterionExecution[];
  readonly verdict: Verdict;
  readonly failure: Failure | null;
  readonly reasons: readonly string[];
  readonly guards: Readonly<Record<RollupGuard, boolean>>;
  readonly environment: EnvironmentRecord | null;
  readonly startedAt: number;
}

/**
 * Assemble the run's outcome and write the bundle — on every terminal path, including PASS.
 *
 * The temptation is to write the bundle only when something went wrong. That inverts the metric: a
 * passing run with no bundle is a run nobody can audit, and M5 counts evidence completeness across
 * runs, not across failures.
 */
async function finish(input: FinishInput): Promise<LoopResult> {
  const { options } = input;
  const elapsedMs = options.clock.now() - input.startedAt;
  const record = options.run.current();
  try {
    await options.bundle.writeClarifications([...input.logs]);
    // The bundle holds two records of one fact: this file and the `environment` block inside
    // `result.json`. `environment.json` is written at prepare, which is what makes it useful to a
    // reader watching a run - but that means it stops at `ready` while the run goes on to reset the
    // world three times, and two files in one directory that disagree leave a reader no way to know
    // which one to believe. The later reading wins; it is the same rule the artifact ledger follows.
    if (input.environment) await options.bundle.writeEnvironment(input.environment);
    await options.bundle.writeResult({
      runId: options.run.runId,
      goalId: options.run.goalId,
      state: record.state,
      iteration: record.iteration,
      verdict: input.verdict,
      criteria: input.criteria,
      failure: input.failure,
      reasons: input.reasons,
      guards: input.guards,
      // Read here, at the moment of writing, rather than threaded in from each call site. Seven
      // `finish` calls would be seven places to forget it, and a `finish` that took it as an argument
      // could be handed a stale one - this is the same rule `envRecord()` follows.
      safetyViolation: safetyState(options),
      environment: input.environment,
      iterations: input.iterations,
      clarifications: input.logs,
      reproducibility: options.reproducibility,
      limits: {
        maxIterations: options.limits.maxIterations,
        maxRuntimeMs: options.limits.maxRuntimeMs,
        elapsedMs,
      },
    });

    // Best effort by contract: `MemoryPort.remember` swallows its own failures, because knowledge
    // loss must not become a run failure.
    await options.memory?.remember({
      content:
        `run ${options.run.runId} on goal ${options.run.goalId} finished ${input.verdict} in state ` +
        `${record.state} after ${String(record.iteration)} iteration(s): ${input.reasons.join("; ")}`,
      source: `run:${options.run.runId}`,
    });
  } finally {
    // The world comes down on every path, including the one where recording the run threw. Tearing
    // down only on success leaked whatever the run had started: the canonical demo's first
    // end-to-end attempt failed its result self-check, left the shopping-cart server running, and
    // the process never exited - the engine decided `stop` and the terminal never came back. A run
    // that cannot finish must still let go of what it started, or the failure is unbounded.
    await options.world.teardown();
  }

  return {
    verdict: input.verdict,
    state: record.state,
    iterations: input.iterations,
    criteria: input.criteria,
    executions: input.executions,
    failure: input.failure,
    reasons: input.reasons,
    guards: input.guards,
    environmentValid: input.environment?.valid ?? false,
    clarifications: input.logs,
    resultPath: `${options.bundle.layout.runDir}/result.json`,
    failureReportPath: `${options.bundle.layout.runDir}/failure.md`,
    elapsedMs,
  };
}
