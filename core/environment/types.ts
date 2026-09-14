import type { FailureKind } from "../failure.ts";
import type { FilesystemWritePolicy, NetworkPolicy } from "../goal/types.ts";

/**
 * Shared environment contracts.
 *
 * `Observation` lives here rather than in `core/validation` because it is the adapter's output: an
 * environment produces observations, and validation merely reads them. The dependency therefore
 * runs validation → environment, never the reverse.
 *
 * The boundary vocabulary below lives here for the same reason `web-observation.ts` does: an
 * adapter both obeys a boundary and reports on it, and a validator may read the report without
 * either layer importing the other.
 */

/**
 * Everything a world is able to put in a bundle as evidence.
 *
 * A list rather than a bare union so it can be *checked* against the other list that names artifact
 * kinds - the acceptance contract's `evidence`, which is deliberately narrower - and so that a
 * spelling mistake in one member is impossible rather than merely unlikely. A union has no runtime
 * value, and a second hand-kept copy of these seven words in a test would be exactly the drift this
 * repository already pays for somewhere else.
 */
export const ARTIFACT_KINDS = [
  "screenshot",
  "trace",
  "dom",
  "console",
  "network",
  "log",
  "json",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

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

/**
 * What became of one declared boundary.
 *
 * The three values are kept apart because two of them would otherwise be reported as the same
 * string. `unsupported` and `not-requested` both mean "nothing was refused", but only one of them
 * means the boundary was ever asked for - and a reader cannot tell them apart from a bare `ok`.
 */
export const BOUNDARY_ENFORCEMENTS = ["enforced", "unsupported", "not-requested"] as const;
export type BoundaryEnforcement = (typeof BOUNDARY_ENFORCEMENTS)[number];

/** Which boundary a crossing belongs to. The adapter emits only what its world can hold. */
export type BoundaryKind = "network" | "filesystemWrite";

/**
 * One action that a declared boundary refused.
 *
 * Facts only. The prose a reader sees is composed in `core/execution/loop.ts`, because an adapter
 * knows what it refused and the core knows which criterion was being observed - and a sentence
 * assembled by the layer that holds half the evidence is how a message ends up naming one thing.
 */
export interface BoundaryCrossing {
  readonly boundary: BoundaryKind;
  /** In the adapter's own vocabulary: `GET https://example.test/v1/ping`. */
  readonly subject: string;
  /** The criterion being observed when it happened, or null if it happened outside one. */
  readonly criterionId: string | null;
  readonly at: string;
}

/**
 * What the world did about the plan's boundaries, and what crossed one.
 *
 * This is the pair that a `PASS` needs. `policy` alone is a declaration; `enforcement` alone does
 * not say what was declared. Recorded together, a reader can tell an enforced-clean run from a
 * boundary that was never applied - which is the distinction the guard `noSafetyViolation`
 * silently assumed and the artifact did not state.
 */
export interface BoundaryReport {
  readonly network: BoundaryEnforcement;
  readonly filesystemWrite: BoundaryEnforcement;
  readonly crossings: readonly BoundaryCrossing[];
}

/** The resolved boundary. `EnvironmentPlan.boundary`, so the adapter can see the budget it holds to. */
export interface BoundaryPolicy {
  readonly network: NetworkPolicy;
  readonly allow: readonly string[];
  readonly filesystemWrite: FilesystemWritePolicy;
}

/** The lifecycle every environment exposes, no matter how exotic (PLAN.md §5). */
export interface EnvironmentAdapter {
  readonly kind: string;
  create(): Promise<{ readonly id: string }>;
  /**
   * What this world did about the plan's boundaries, and everything that crossed one.
   *
   * Deliberately required rather than optional. An optional method is one an adapter may omit
   * without anything noticing, and "the boundary was declared and never applied" is exactly the
   * defect this reports - silence must not be the way an adapter expresses it.
   */
  boundaries(): BoundaryReport;
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
  /**
   * The adapter's own verdict on whether its world is ready.
   *
   * `null` means *this adapter does not answer that way* - it reports a status code and the manager
   * compares it. The distinction exists because a world with no status code has no honest number to
   * report: a database is ready when the file opens and `SELECT 1` answers, and calling that `200`
   * would record a fact the world never produced, in a field whose name says it is an HTTP status.
   */
  readonly ok: boolean | null;
  /** The HTTP status, or null when nothing accepted the connection or the world has no status. */
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
  /**
   * The database file this world is, when the world is a database, as written.
   *
   * A path string rather than a flag, so the same field can name a fixture a criterion is judged
   * against - which is what makes "the seed did not run" a thing a criterion can say.
   */
  readonly databasePath?: unknown;
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
  /**
   * Path appended to the plan's URL to form the probe address.
   *
   * `null` when the world has no address to append to. A database file is the case this exists for:
   * it has state worth checking and no route to request.
   */
  readonly path: string | null;
  /**
   * The status a healthy probe returns, or `null` when the world has no status to return.
   *
   * `null` is what makes a non-HTTP world expressible, and it is neither a default nor "any
   * status": it hands the verdict to the adapter's `HealthProbe.ok`. A null read strictly would
   * make every such world permanently unhealthy, and read loosely permanently healthy - and
   * "permanently healthy" is a false PASS arriving through the readiness check.
   */
  readonly expectStatus: number | null;
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
  /**
   * The address of the running application, or `null` when the world has no address.
   *
   * Required for a world reached over a socket; `null` for one reached by opening a file. An
   * adapter that needs a URL says so itself, because `core/` cannot know which worlds need one and
   * a rule written here would apply one adapter's requirement to every adapter.
   */
  readonly url: string | null;
  /**
   * The database file the world is, or `null` when the world is not a database.
   *
   * Relative paths resolve against `appPath`, on the same rule `core/io.ts` already enforces for a
   * caller's paths: a caller's file is relative to the application they are working in, and an
   * absolute one is used as written.
   *
   * Here rather than only in an adapter's own options because the plan is the adapter's whole world,
   * and the defect `--browser none` produced was exactly this - a run-time fact that reached the
   * object built from the plan and never reached the plan itself. An adapter that had to re-read
   * `environment.yaml` to learn which file it was asked to be would have a second opinion about its
   * own configuration, and when the two disagree the winner is whichever parsed last.
   */
  readonly databasePath: string | null;
  readonly health: HealthPolicy;
  readonly reset: { readonly strategy: ResetStrategy; readonly command: string | null };
  readonly browser: BrowserPolicy;
  /**
   * The goal's declared safety boundary, resolved into the plan.
   *
   * It has to live here, not only on `GoalLimits`, because the *adapter* is what holds a boundary
   * and the plan is the adapter's whole world. A boundary that stopped at the loop would be
   * documentable and unenforceable at once - the same shape as `--browser none` reaching a plan
   * that still promised a browser.
   */
  readonly boundary: BoundaryPolicy;
}
