import type { FailureKind } from "../failure.ts";

/**
 * Shared environment contracts.
 *
 * `Observation` lives here rather than in `core/validation` because it is the adapter's output: an
 * environment produces observations, and validation merely reads them. The dependency therefore
 * runs validation → environment, never the reverse.
 */

export type ArtifactKind = "screenshot" | "trace" | "dom" | "console" | "network" | "log" | "json";

export interface EvidenceArtifact {
  /** Path relative to the run directory, so a bundle can be moved without breaking its links. */
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly criterionId?: string | null;
  readonly bytes?: number | null;
}

/**
 * What the world looked like when Veridian looked at it.
 *
 * An observation carries its own artifacts so that evidence is produced by the thing that
 * witnessed the state, not reconstructed afterwards from memory.
 */
export interface Observation {
  /** Adapter-defined, e.g. `web.page`. Validators declare the kind they understand. */
  readonly kind: string;
  readonly capturedAt: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly data: unknown;
  readonly artifacts: readonly EvidenceArtifact[];
  /** Non-null when the observation could not be taken. Validators never run in that case. */
  readonly error: { readonly message: string; readonly kind: FailureKind } | null;
}

/** The lifecycle every environment exposes, no matter how exotic (PLAN.md §5). */
export interface EnvironmentAdapter {
  readonly kind: string;
  create(): Promise<{ readonly id: string }>;
  start(id: string): Promise<void>;
  deploy(id: string): Promise<void>;
  /** Run the deterministic action sequence for one criterion, then observe. */
  execute(id: string, request: ObservationRequest): Promise<Observation>;
  /** Take an observation of the current state without executing anything. */
  observe(id: string, request: ObservationRequest): Promise<Observation>;
  /** One health probe. The manager owns the retry policy; the adapter owns only how to ask. */
  probe(id: string): Promise<HealthProbe>;
  snapshot(id: string): Promise<string>;
  restore(id: string, snapshotId: string): Promise<void>;
  reset(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
}

export interface ObservationRequest {
  readonly criterionId: string;
  readonly runId: string;
  readonly steps: readonly Readonly<Record<string, unknown>>[];
  /**
   * The selectors this criterion's expectations are about, deduplicated, in first-seen order.
   *
   * The adapter cannot derive this. Steps name the selectors they *act on*, which is a different set
   * from the selectors the criterion *judges* — a criterion may assert on an element nothing ever
   * clicked, and the most common defect of all ("the total is displayed but never recalculated") is
   * invisible from the step list alone. An observation that read only the steps' targets would be an
   * observation of the wrong page region, and every validator over it would be judging a question
   * nobody asked.
   */
  readonly targets: readonly string[];
  /** Artifact kinds the criterion requires. The adapter is expected to capture all of them. */
  readonly evidence: readonly ArtifactKind[];
}

/**
 * The result of *one* health probe.
 *
 * The adapter owns how to ask and the manager owns how long to keep asking, which is why this is a
 * single probe rather than a retry loop: an adapter that retried would each invent its own policy,
 * and "how long may an environment take to become valid" would stop being a property of the run.
 */
export interface HealthProbe {
  /** The HTTP status, or null when nothing accepted the connection. */
  readonly statusCode: number | null;
  readonly message: string | null;
  /**
   * Whether the definition's `readyPattern` has been seen on the adapter's stdout.
   *
   * `null` means *this adapter does not observe stdout at all* (an in-process server has none), not
   * "the pattern was not seen". The distinction is recorded rather than collapsed because a null
   * must not be silently read as a satisfied requirement.
   */
  readonly patternSeen: boolean | null;
}

export interface HealthReport {
  readonly ok: boolean;
  readonly message: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly url: string | null;
  readonly statusCode: number | null;
  readonly readyPatternSatisfied: boolean | null;
}

export interface EnvironmentDefinitionShape {
  readonly adapter?: unknown;
  readonly app?: unknown;
  readonly env?: Readonly<Record<string, string>>;
  readonly dependencyInstall?: unknown;
  readonly start?: { readonly command?: unknown; readonly args?: unknown; readonly readyPattern?: unknown };
  readonly url?: unknown;
  readonly health?: {
    readonly path?: unknown;
    readonly expectStatus?: unknown;
    readonly timeoutMs?: unknown;
    readonly intervalMs?: unknown;
  };
  readonly reset?: { readonly strategy?: unknown; readonly command?: unknown };
  readonly browser?: {
    readonly enabled?: unknown;
    readonly viewport?: { readonly width?: unknown; readonly height?: unknown };
    readonly locale?: unknown;
    readonly timezoneId?: unknown;
  };
}

/** `environment.schema.json` → `reset.strategy`. */
export const RESET_STRATEGIES = ["restart", "snapshot-restore", "custom"] as const;
export type ResetStrategy = (typeof RESET_STRATEGIES)[number];

export interface HealthPolicy {
  readonly path: string;
  readonly expectStatus: number;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  /** Set when the definition asked for a stdout readiness signal. `null` means "not requested". */
  readonly readyPattern: string | null;
}

export interface ApplicationStart {
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Kept in the plan even though the manager never reads it: the *adapter* uses it to decide when
   * its own `start()` has finished, and dropping it here would force the adapter to re-read the raw
   * document that the protocol has already resolved.
   */
  readonly readyPattern: string | null;
}

export interface BrowserPolicy {
  readonly enabled: boolean;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly locale: string | null;
  readonly timezoneId: string | null;
}

/**
 * A resolved environment definition: every field decided.
 *
 * Nothing is optional here, and that is the point. `EnvironmentDefinitionShape` is allowed to have
 * holes because the protocol fills them; by the time a plan exists there is no hole left to fall
 * into at three in the morning inside a retry loop.
 */
export interface EnvironmentPlan {
  readonly adapter: string;
  /** Application directory as written, relative to the environment file. */
  readonly app: string;
  /** The same directory resolved against the io root, for a process runner that needs a real cwd. */
  readonly appPath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly dependencyInstall: string | null;
  readonly start: ApplicationStart;
  readonly url: string;
  readonly health: HealthPolicy;
  readonly reset: { readonly strategy: ResetStrategy; readonly command: string | null };
  readonly browser: BrowserPolicy;
}
