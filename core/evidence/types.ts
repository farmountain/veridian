import type { ClarificationReport } from "../clarification/types.ts";
import type { BoundaryCrossing, BoundaryEnforcement, EnvironmentPlan, HealthReport, EvidenceArtifact } from "../environment/types.ts";
import type { Failure } from "../failure.ts";
import type { RunState } from "../run/types.ts";
import type { CriterionResult, CriterionStatus } from "../validation/types.ts";
import type { RollupGuard, Verdict } from "../validation/rollup.ts";
import type { WorldIdentity } from "./world-identity.ts";

/**
 * The run bundle.
 *
 * PLAN.md §19 and AGENTS.md both say the same thing in different words: *evidence is not optional
 * decoration, it is part of the validation result.* That has a structural consequence — the bundle
 * is written from data the run already produced, never reconstructed afterwards from a log stream.
 * Every type here is a plain serialisable shape so that `result.json` is the truth rather than a
 * summary of the truth.
 */

/** Directory names inside `.veridian/runs/<run-id>/`. Constants, because three modules refer to them. */
export const BUNDLE_FILES = {
  goal: "goal.yaml",
  acceptance: "acceptance.yaml",
  environment: "environment.json",
  executionLog: "execution.log",
  result: "result.json",
  clarifications: "clarifications.json",
  screenshots: "screenshots",
  trace: "trace",
  artifacts: "artifacts",
} as const;

export interface RunBundleLayout {
  /** `.veridian`. */
  readonly root: string;
  readonly runsDir: string;
  readonly runDir: string;
  readonly snapshotsDir: string;
  /** `.veridian/latest-result.json` — Level-2 feedback: what an external agent reads first. */
  readonly latestResult: string;
  /** `.veridian/latest-failure.md` — the same, in prose. */
  readonly latestFailure: string;
}

/**
 * One declared boundary, paired with what the world measurably did about it.
 *
 * The two halves are one object on purpose. A record listing only `networkPolicy: deny` invites a
 * reader to take a declaration for an enforcement, which is the defect this shape exists to remove;
 * a record listing only the enforcement leaves the reader unable to know what was asked for. Neither
 * half means anything on its own, so they cannot be read apart.
 */
export interface BoundaryRecord {
  readonly network: {
    readonly policy: EnvironmentPlan["boundary"]["network"];
    /** Copied from the plan, which copied it from the goal only when the policy was `allow-list`. */
    readonly allow: readonly string[];
    readonly enforcement: BoundaryEnforcement;
  };
  readonly filesystemWrite: {
    readonly policy: EnvironmentPlan["boundary"]["filesystemWrite"];
    readonly enforcement: BoundaryEnforcement;
  };
  /**
   * Which isolation substrate held this world, or `null` when none did.
   *
   * Always present, even when it is `null`, because the question *was this run isolated* has to be
   * answerable from the bundle alone and an omitted key invites a reader to answer it from the
   * `enforcement` fields instead - which can say a filesystem boundary was enforced by an interpreter
   * on the host and cannot say that a container held either one.
   */
  readonly substrate: string | null;
  /**
   * Every request the boundary refused, in the order it refused them.
   *
   * Empty means nothing was refused - which is *not* the same as a boundary that held. The reader
   * has to consult the two `enforcement` fields above to tell those apart, and that is why both live
   * here rather than the crossings being reported somewhere else.
   */
  readonly crossings: readonly BoundaryCrossing[];
}

/** `environment.json`: what world this run measured, so a reader can rebuild it. */
export interface EnvironmentRecord {
  readonly adapter: string;
  readonly app: string;
  readonly appPath: string;
  /**
   * The world's address, or `null` when it has none - a database world is reached by opening a file.
   *
   * Recorded as `null` rather than as an empty string so a reader can tell "this world has no
   * address" from "nobody filled the field in", which are different facts about a run.
   */
  readonly url: string | null;
  /**
   * The database file this world was, or `null` when it was not a database.
   *
   * The mirror of `url` and read for the same reason: the first question asked of a result is *which
   * world produced it*, and for a file-backed world the address is a path. `null` rather than an
   * empty string, so "this world is not a database" and "nobody filled the field in" stay apart.
   */
  readonly databasePath: string | null;
  /**
   * Which world this run measured, as the plan declared it - or `null` when the plan declared none.
   *
   * One field holding the world's own kind, name and declared detail, rather than ten top-level
   * fields beside `url` and `databasePath`, for the reason the plan's own blocks are separate
   * objects: a thirteenth world must not widen this record by a key, and a reader asking "which
   * world was this" must have one place to look. `adapter` above names the implementation that
   * constructed the world; this names the world itself, and they are different questions.
   *
   * `null` is a fact about the run and not a gap in the accounting: `evidenceCompleteness` reports a
   * run whose plan declared a world while its bundle carries none, so a bundle cannot lose its
   * subject and still be called complete. That is the property `environment.json` had lost - see
   * `core/evidence/world-identity.ts`.
   */
  readonly world: WorldIdentity | null;
  readonly command: string;
  readonly args: readonly string[];
  readonly health: EnvironmentPlan["health"];
  readonly reset: EnvironmentPlan["reset"];
  readonly browser: EnvironmentPlan["browser"];
  readonly env: Readonly<Record<string, string>>;
  readonly valid: boolean;
  readonly healthReport: HealthReport | null;
  readonly boundary: BoundaryRecord;
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly at: string; readonly reason: string }[];
}

/** One line of the ReAct loop. Recorded in `result.json` so the loop's history is auditable. */
export interface IterationSummary {
  readonly iteration: number;
  readonly verdict: Verdict;
  readonly passed: number;
  readonly failed: number;
  readonly undecided: number;
  readonly repaired: boolean;
  readonly note: string;
  /**
   * Every criterion's status *as this iteration observed it*, not as the run ended.
   *
   * The three counts above collapse a contract into three numbers, and different failures collide
   * inside them: a run where AC-001 broke and a run where AC-003 broke both report
   * `passed: 3, failed: 1`. That collision matters twice over. A repeat-run consistency check (M1)
   * comparing counts would call two runs equivalent that failed different criteria - the one thing
   * "the same code produced the same result twice" is supposed to mean. And an agent reading the
   * history to learn which criterion its last repair moved cannot recover it from a total. The bundle
   * keeps the final iteration's detail under `criteria` at the top level; this is the only place the
   * earlier iterations' detail survives at all.
   */
  readonly criteria: readonly { readonly criterionId: string; readonly status: CriterionStatus }[];
}

/**
 * Everything needed to write a bundle.
 *
 * The controller assembles this; the writer never reaches back into the run for more. That direction
 * matters: a writer that can query the live run will, sooner or later, write a `result.json` that
 * disagrees with the run that produced it.
 */
export interface RunOutcome {
  readonly runId: string;
  readonly goalId: string;
  readonly state: RunState;
  readonly iteration: number;
  readonly verdict: Verdict;
  readonly criteria: readonly CriterionResult[];
  readonly failure: Failure | null;
  readonly reasons: readonly string[];
  readonly guards: Readonly<Record<RollupGuard, boolean>>;
  /**
   * The violation the run acted on, or `null` for "none observed".
   *
   * `null` is not "there was none": it is "nothing this world monitors refused anything", which is
   * the strongest reading the guard can support. No world can prove the absence of *all* violations,
   * so the clause has always meant "none was observed" - which is why the fix for a declared but
   * unenforced boundary was to widen what can be observed, not to cap the verdict.
   * See `docs/BOUNDARY-ENFORCEMENT.md` section 3, Q1.
   */
  readonly safetyViolation: string | null;
  readonly environment: EnvironmentRecord | null;
  readonly iterations: readonly IterationSummary[];
  /** One report per document resolved by the protocol: goal, acceptance, environment. */
  readonly clarifications: readonly ClarificationReport[];
  readonly reproducibility: ReproducibilityRecord;
  /** Recorded so a reviewer can see the loop was bounded, not merely believe it. */
  readonly limits: {
    readonly maxIterations: number;
    readonly maxRuntimeMs: number;
    readonly elapsedMs: number;
  };
}

export interface ReproducibilityRecord {
  readonly capturedAt: string;
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly veridian: string;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean | null;
  readonly playwright: string | null;
  readonly browser: string | null;
  readonly timezone: string | null;
  readonly networkPolicy: string | null;
  readonly env: Readonly<Record<string, string>>;
}

export interface WrittenResult {
  /** Path relative to the bundle root, e.g. `runs/run-.../result.json`. */
  readonly path: string;
  readonly latestPath: string;
  readonly failurePath: string;
  readonly artifacts: readonly EvidenceArtifact[];
  readonly missing: readonly string[];
  readonly complete: boolean;
}
