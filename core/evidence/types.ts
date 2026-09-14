import type { ClarificationReport } from "../clarification/types.ts";
import type { EnvironmentPlan, HealthReport, EvidenceArtifact } from "../environment/types.ts";
import type { Failure } from "../failure.ts";
import type { RunState } from "../run/types.ts";
import type { CriterionResult, CriterionStatus } from "../validation/types.ts";
import type { RollupGuard, Verdict } from "../validation/rollup.ts";

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

/** `environment.json`: what world this run measured, so a reader can rebuild it. */
export interface EnvironmentRecord {
  readonly adapter: string;
  readonly app: string;
  readonly appPath: string;
  readonly url: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly health: EnvironmentPlan["health"];
  readonly reset: EnvironmentPlan["reset"];
  readonly browser: EnvironmentPlan["browser"];
  readonly env: Readonly<Record<string, string>>;
  readonly valid: boolean;
  readonly healthReport: HealthReport | null;
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
