import type { ClarificationReport, Clock, Logger } from "../clarification/index.ts";
import type { ClarificationEngine } from "../clarification/engine.ts";
import type { DetectorContext } from "../clarification/detect.ts";
import type { ValidationPlan, CriterionPlan } from "../acceptance/plan.ts";
import type {
  BoundaryReport,
  EnvironmentPlan,
  Observation,
  ObservationRequest,
} from "../environment/types.ts";
import type { EnvironmentReady, EnvironmentFailure } from "../environment/manager.ts";
import type { GoalLimits } from "../goal/types.ts";
import type { IoPort } from "../io.ts";
import type { SchemaSet } from "../schema/registry.ts";
import type { ValidatorRegistry } from "../validation/registry.ts";
import type { CriterionResult } from "../validation/types.ts";
import type { RollupGuard, Verdict } from "../validation/rollup.ts";
import type { Failure } from "../failure.ts";
import type { MemoryPort } from "../memory/types.ts";
import type { RunBundle, ReproducibilityRecord, IterationSummary } from "../evidence/index.ts";
import type { RunHandle, RunState } from "../run/index.ts";

/**
 * EXECUTE — drive the world, observe it, judge it, and decide whether to do it again.
 *
 * The whole layer is written against ports rather than against concrete adapters for one reason:
 * the ReAct loop is the part of Veridian that *must* be provable offline. If the loop can only be
 * exercised by pointing a browser at a real server, then the claim "the loop is bounded" is a claim
 * about a Playwright session, not about the loop. Behind a port, the same loop runs against a
 * scripted world in milliseconds — and the browser becomes one implementation among several.
 */

/** The lifecycle the loop needs. Structurally satisfied by `EnvironmentManager`. */
export interface WorldPort {
  readonly id: string | null;
  readonly plan: EnvironmentPlan | null;
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly at: string;
    readonly reason: string;
  }[];
  prepare(plan: EnvironmentPlan): Promise<EnvironmentReady | EnvironmentFailure>;
  reset(): Promise<EnvironmentReady | EnvironmentFailure>;
  execute(request: ObservationRequest): Promise<Observation>;
  /**
   * What the world did about the plan's boundaries, read live.
   *
   * A method rather than a property, and required rather than optional. A property read once would
   * describe the world before it was exercised - the defect `envRecord()` was rewritten to remove -
   * and an optional method is one a world may omit without anything noticing, which is precisely how
   * a declared boundary came to be mistaken for an enforced one.
   */
  boundaries(): BoundaryReport;
  /** Best effort, never throws. The loop must be able to give up on a world without exploding. */
  teardown(): Promise<void>;
}

/**
 * A criterion's execution. Kept together rather than as two parallel arrays: the loop writes,
 * reads and then judges each entry, and a pair of arrays that must stay index-aligned is a bug
 * waiting for a `splice`.
 */
export interface CriterionExecution {
  readonly plan: CriterionPlan;
  readonly observation: Observation;
  readonly result: CriterionResult;
  /** The reason the run declined to call it PASS, as recorded by the protocol. */
  note: string | null;
}

/**
 * One trip around the loop, as it appears in the bundle.
 *
 * Defined in `core/evidence/types.ts`, because the evidence layer owns the shape of what is written
 * and this layer only produces it - the same direction `RunOutcome` already travels. It used to be
 * declared in both places, word for word, which is how a field added here can go missing from the
 * artifact that is supposed to contain it.
 */
export type { IterationSummary };
/**
 * The agent boundary, made executable.
 *
 * Veridian does not repair anything — repairing is the external agent's job, and the moment Veridian
 * starts proposing fixes it has become the thing it was meant to validate. A `RepairGate` is the one
 * and only place where an external actor may touch the world between iterations.
 *
 * That placement is what makes the loop bounded *by construction*. With `NoRepairGate` installed
 * there is nothing to do on iteration two except observe an unchanged application, so the gate
 * declines and the run stops after a single pass — not because a counter said so, but because no
 * repair path exists to grant a second one.
 */
export type RepairDecision = "repaired" | "stop" | "abandon";

export interface RepairRequest {
  readonly runId: string;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly verdict: Verdict;
  readonly failure: Failure | null;
  /** Only the criteria that did not pass. A repair is aimed at a defect, never at a report. */
  readonly failed: readonly CriterionResult[];
  /** Where the agent reads what happened. These paths are the interface. */
  readonly resultPath: string;
  readonly failureReportPath: string;
  readonly reasons: readonly string[];
}

export interface RepairOutcome {
  readonly decision: RepairDecision;
  readonly note: string;
}

export interface RepairGate {
  /** Recorded in every iteration summary, so a bundle always states how repair was reachable. */
  readonly kind: string;
  repair(request: RepairRequest): Promise<RepairOutcome>;
}
/** The verdict-deciding outcome of a set of criterion results. */
export interface IterationVerdict {
  readonly verdict: Verdict;
  readonly failure: Failure | null;
  readonly reasons: readonly string[];
  readonly guards: Readonly<Record<RollupGuard, boolean>>;
}

export interface LoopOptions {
  readonly io: IoPort;
  /** When present, `result.json` is validated against its own contract before being written. */
  readonly schemas?: SchemaSet;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly world: WorldPort;
  readonly registry: ValidatorRegistry;
  readonly plan: ValidationPlan;
  readonly environment: EnvironmentPlan;
  readonly limits: GoalLimits;
  /** Shared with DEFINE, so one question budget covers the whole run. */
  readonly clarifier: ClarificationEngine;
  /** Detector context for the runtime stages. */
  readonly detectorContext: DetectorContext;
  /** The agent boundary, as a value. `NoRepairGate` makes a single-iteration run. */
  readonly repairGate: RepairGate;
  readonly bundle: RunBundle;
  readonly run: RunHandle;
  readonly reproducibility: ReproducibilityRecord;
  /** Reports from DEFINE. Recorded alongside the runtime resolutions, never replaced by them. */
  readonly definitionReports: readonly ClarificationReport[];
  /** Optional substrate. Absent means the run simply does not accumulate cross-run knowledge. */
  readonly memory?: MemoryPort;
  /**
   * Set when DEFINE had to defer a blocking ambiguity (assumption A7). The run can still execute, and
   * its criteria may even pass, but it may not be reported as a PASS: a contract that was never fully
   * pinned down cannot be said to have been met.
   */
  readonly insufficientInformation?: boolean;
  readonly insufficientInformationDetail?: string | null;
  /** Non-null when an action crossed a declared boundary. Never merely reported — it fails the run. */
  readonly safetyViolation?: string | null;
}

export interface LoopResult {
  readonly verdict: Verdict;
  readonly state: RunState;
  readonly iterations: readonly IterationSummary[];
  readonly criteria: readonly CriterionResult[];
  readonly executions: readonly CriterionExecution[];
  readonly failure: Failure | null;
  readonly reasons: readonly string[];
  readonly guards: Readonly<Record<RollupGuard, boolean>>;
  readonly environmentValid: boolean;
  readonly clarifications: readonly ClarificationReport[];
  readonly resultPath: string;
  readonly failureReportPath: string;
  readonly elapsedMs: number;
}
