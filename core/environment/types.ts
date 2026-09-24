import type { FailureKind } from "../failure.ts";
import type { FilesystemWritePolicy, NetworkPolicy } from "../goal/types.ts";
import type { ContainerPlatform } from "./container-observation.ts";
import type { MobilePlatform } from "./mobile-observation.ts";
import type { OsFamily } from "./os-observation.ts";

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
 * The four values are kept apart because any two of them would otherwise be reported as the same
 * string. `unsupported` and `not-requested` both mean "nothing was refused", but only one of them
 * means the boundary was ever asked for - and a reader cannot tell them apart from a bare `ok`.
 * `unenforceable` is the fourth and the newest: `unsupported` says *this world does not hold this
 * boundary*, which a reader cannot distinguish from *nobody has written the code yet*. A boundary
 * that was measured and found to have no mechanism on this runtime is a different fact from one
 * whose mechanism exists and was not applied, and a report that merged them would let a future
 * reader believe either. It is how `network` is reported by a world whose subject is a program rather
 * than a front door - `local-process` - because for a long time no mechanism existed to hold it there:
 * `node --allow-net` does not exist, measured rather than assumed (`bad option: --allow-net=127.0.0.1`,
 * exit 9), while `--permission` on the same runtime is accepted (exit 0). It is deliberately not how
 * `local-web` and `local-api` report theirs, and those two answers are not a disagreement. A world
 * whose every request passes a guarded front door - Playwright's route guard, the contract's own
 * request guard - really can refuse one, so `enforced` is what it measured; a world with no such door
 * has only the child's own socket to reason about, and that is the case this word names. **Three of
 * the twelve worlds answer this question with a measurement, and the separation is a front door rather
 * than a child** - now that every world in this tree hands the runner a file allowance, `confines a
 * child` no longer distinguishes anything, while the two that hold a route guard every request of
 * theirs passes answer `enforced` and `local-process` answers `unenforceable`. The other nine answer
 * `unsupported`. It was measured rather than reasoned: `tests/boundary-roster.test.ts` derives the
 * split from the adapters themselves, so a thirteenth world cannot join either side in silence.
 *
 * **`local-process`'s answer is now conditional, and the condition is a reading.** When a document
 * declares `process.isolation` and this machine can supply a substrate, a container severs the network
 * by a flag the interpreter has no equivalent for, so the same world answers `enforced` - and it does
 * so only after the runner reported that a substrate applied, never on the strength of the document.
 * The word still means what it meant: the child cannot open a socket. What changed is that the reason
 * it cannot is a runtime that really passed `--network=none` rather than an absence of any mechanism
 * at all. `unenforceable` remains the answer for every run where no substrate held, which is why the
 * world names both words and why the guard above permits that only alongside the read that decides
 * between them.
 */
export const BOUNDARY_ENFORCEMENTS = [
  "enforced",
  "unsupported",
  "not-requested",
  "unenforceable",
] as const;
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
  /**
   * Which isolation substrate held this world, or `null` when none did.
   *
   * **A reading, not a declaration.** It is the runtime's own name (`podman`, `docker`) only when the
   * runner actually started the application inside it - so `null` means the child ran as an ordinary
   * process on this machine, which is the same answer whether the world asked for a substrate and this
   * machine could not supply one or the world never asked. A reader who needs those two told apart has
   * the world's own log, which records the reason the port gave; a reader who needs to know *whether
   * the run was isolated at all* has this field alone, and that is the question it exists to answer.
   *
   * Optional because a substrate is a capability a world may not have and not a method it may forget:
   * absence is written to the bundle as `null` rather than omitted, so the record holds one shape.
   */
  readonly substrate?: string | null;
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
   * The HTTP service this world is, when the world is one, as written.
   *
   * One field, and the reason it is declared rather than derived is the reason every other block
   * here exists: `url` says *where* the service is and nothing about *which* service a reading
   * describes. A bundle holds readings from every iteration of a run, and a failure report is read
   * beside a result from a different run, so a reading has to name its own subject - and a name the
   * adapter inferred from the directory it happened to be handed is a name the document never agreed
   * to. Declaring it is also what makes the name *askable*: a document that omits it is a document
   * with a gap, which the ladder raises as a question rather than a value guessed on the operator's
   * behalf.
   */
  readonly api?: {
    readonly service?: unknown;
  };
  /**
   * The database file this world is, when the world is a database, as written.
   *
   * A path string rather than a flag, so the same field can name a fixture a criterion is judged
   * against - which is what makes "the seed did not run" a thing a criterion can say.
   */
  readonly databasePath?: unknown;
  /**
   * The cluster this world stands in for, when the world is a cluster.
   *
   * One field holding the three facts that make a cluster a cluster - its name, the namespace a run
   * is scoped to, and where its substitute image registry reads from - for the same reason
   * `databasePath` is one field: a world's own vocabulary belongs in one place a reader can find it,
   * and a fourth sibling field added per adapter would make the shared document shape the union of
   * every adapter's private options.
   */
  readonly cluster?: {
    readonly name?: unknown;
    readonly namespace?: unknown;
    readonly images?: unknown;
  };
  /**
   * The POSIX-like system this world stands in for, when the world is one.
   *
   * The pattern `cluster` follows, one kind of world further out - and it is written out here rather
   * than elided as "the same as cluster" because the three names it holds are read by a detector that
   * may not import an adapter, and a shape a reader has to go and find is a shape that gets guessed.
   */
  readonly posix?: {
    readonly distribution?: unknown;
    readonly user?: unknown;
    readonly root?: unknown;
  };
  /**
   * The operating system this world stands in for, when the world is one.
   *
   * Four facts, because a system has four that decide what its readings *mean*: which family it is
   * (the path rules and the store's addressing follow from it, and nothing else can supply them),
   * which release the readings name, which account the criteria act as, and which directory is the
   * sandbox root. `family` is the field that makes this a declaration rather than a diary entry: a
   * reading can report a family, but only a plan can *promise* one, and a world that promised Windows
   * and reported macOS paths would otherwise be a world nobody could catch.
   */
  readonly os?: {
    readonly family?: unknown;
    readonly system?: unknown;
    readonly user?: unknown;
    readonly root?: unknown;
  };
  /**
   * The cloud account this world stands in for, when the world is one.
   *
   * Four facts, and not one of them is a path - which is what makes this block different in kind
   * from the three before it. A provider, a region, an account and a principal: the first three say
   * *where* a reading was taken and the fourth says *as whom*, and a contract whose criteria act as
   * one identity while the application wrote as another would be judging permissions nobody asked
   * about. `principal` is the field that has to be declared rather than inferred, because a reading
   * could report the identity it saw and could never promise the one a criterion is entitled to act
   * as.
   */
  readonly cloud?: {
    readonly provider?: unknown;
    readonly region?: unknown;
    readonly account?: unknown;
    readonly principal?: unknown;
  };
  /**
   * The container runtime this world stands in for, when the world is one.
   *
   * Three facts, and the shape of them is the point. `runtime` is a free string, because a runtime's
   * name decides nothing a criterion can observe - the same argument that made a provider name free
   * one family over. `platform` is a *declared* fact, because the platform decides how a path is
   * spelled inside every container the world holds. And `root` is a host path, which is the field
   * that makes this block different in kind from `cloud`: a container world has a bind mount, and a
   * bind mount's source is a path **on this machine** while its destination is a path **inside the
   * container**, so the world has to be able to tell the two apart - and it cannot tell them apart
   * unless the document says where its own sandbox is.
   *
   * There is deliberately no principal. Every other simulated world declares the identity its
   * criteria act as, because every other one has an access decision; a local runtime interface has
   * none, so a `principal` field here would be a field that exists to make the seventh block look
   * like the sixth. The honest consequence is recorded rather than hidden: this world cannot judge a
   * contract about who may talk to the runtime.
   */
  readonly container?: {
    readonly runtime?: unknown;
    readonly platform?: unknown;
    readonly root?: unknown;
  };
  /**
   * The VS Code extension host this world stands in for, when the world is one.
   *
   * Five facts, and the third of them is what makes this block different in kind from the six before
   * it. `host` and `root` are the runtime-and-sandbox pair every simulated world declares, and they
   * would be enough to name a world and destroy it. `apiVersion` is not: it is the only field in any
   * of these blocks that a *rule* is computed from, because a real extension host refuses to load an
   * extension whose manifest declares an `engines.vscode` range that does not admit the host's own
   * version - and the computed answer is the whole difference between an extension that was loaded
   * and an extension that should have been.
   *
   * `activationEvent` is nullable on purpose. A real host decides which event to fire from the
   * manifest; declaring one here overrides that, and `null` means "the manifest decides" rather than
   * "nobody filled the field in" - two states a single empty string could not tell apart.
   *
   * `settings` is here for the reason every other block carries its own overrides: a setting an
   * extension reads arrives from either the manifest's declared default or from the operator, and a
   * reading that could not say which would be a reading of a value nobody can trace.
   */
  readonly vscode?: {
    readonly host?: unknown;
    readonly apiVersion?: unknown;
    readonly activationEvent?: unknown;
    readonly root?: unknown;
    readonly settings?: unknown;
  };
  /**
   * The message broker this world stands in for, when the world is one.
   *
   * Four facts, and the last two are what make this block different in kind from the eight before it.
   * `cluster` and `nodeId` are the pair every reading names - a stream store is judged by *which log*
   * a record landed in *on which node* - and they are declared for the reason a cluster's name and a
   * host's name are: a reading could report them and could never promise them.
   *
   * `host` and `port` are an *address*, and this is the first world block to carry one. It carries it
   * because the address is the one fact that makes the substitution observable: the application opens
   * a real socket to whatever this world bound, and a plan that did not say where would leave every
   * reading describing a listener the document never mentioned. `port: 0` is a declaration rather
   * than a hole - it means "the operating system chooses" - and the reading records the port that was
   * really bound, so a criterion reads the address the world took rather than the one it was told.
   *
   * There is deliberately no path and no principal. A broker holds a log rather than a tree, so there
   * is no directory for a reset to rebuild; and a broker answers every client that connects, so a
   * contract judged "as" somebody would be a contract about an authorisation model this world does
   * not implement. Both absences are recorded where the world is registered rather than left to be
   * inferred from this block's silence.
   */
  readonly data?: {
    readonly cluster?: unknown;
    readonly nodeId?: unknown;
    readonly host?: unknown;
    readonly port?: unknown;
  };
  /**
   * The device declaration, when the world is one.
   *
   * Three fields and no more. `device` is the identity every reading names, so a result says which
   * device produced it; `platform` is a *rule* rather than a label - it decides how a path inside the
   * device's own storage is spelled - which is why the loader refuses a platform this substitution
   * does not implement rather than accepting it as written; and `root` is the sandbox on this machine
   * the world's bundles, keychain entries and device state live in.
   *
   * `apiLevel` is deliberately absent. A real device's API level is a property of the platform rather
   * than a choice the operator makes, so this world carries it as a constant of the substitution, and
   * a document able to state a level the substitute does not answer as would be a document asserting
   * something no reading could corroborate.
   */
  readonly mobile?: {
    readonly device?: unknown;
    readonly platform?: unknown;
    readonly root?: unknown;
  };
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
 * What an environment document declared about the document it is a twin of.
 *
 * The declaration, not the verification: it says *where to look*, and it is read by `load.ts` in the
 * same pass as every other block. Verification needs to read that file, which needs an `IoPort`, so
 * it happens one layer out, where the interchange document and the export predicate are both in
 * scope. The plan carries the **record** that came back rather than the declaration.
 */
export interface ImportDeclaration {
  /** The interchange document's path, resolved against the environment file. */
  readonly from: string;
}

/**
 * What verifying an import established: the world was adopted, and the bytes it was adopted as.
 *
 * `identity` is the identity block as **canonical JSON**, stored rather than re-derived, because the
 * one thing a reader of this record will want to do is compare it with the block the document
 * carried - and a value that had to be recomputed would be recomputed by a second implementation of
 * the rendering rule, which is the disagreement this tree refuses everywhere else.
 */
export interface ImportRecord {
  readonly from: string;
  /** The subject the document grouped its runs under. */
  readonly subject: string;
  /** `kind/name`, as `worldLabel` spells a world. */
  readonly world: string;
  /** The identity block as canonical JSON - the bytes export -> import -> export must preserve. */
  readonly identity: string;
  /** How many runs the document carried, so a reader can tell an adopted history from a stub. */
  readonly runs: number;
}

/**
 * A resolved environment definition: every field decided.
 *
 * Nothing is optional here, and that is the point. `EnvironmentDefinitionShape` is allowed to have
 * holes because the protocol fills them; by the time a plan exists there is no hole left to fall
 * into at three in the morning inside a retry loop.
 */
export interface EnvironmentPlan {
  /**
   * The interchange document this world's own document declared, or `null` when it declared none.
   *
   * The **declaration**: parsed, validated and resolved against the environment file in the same
   * pass as every other block, and nothing more. Whether that document names *this* world is a
   * different question with a different answer, and it is {@link adopted} that carries it.
   */
  readonly imported: ImportDeclaration | null;
  /**
   * What verifying the declared document established, or `null` when nothing was verified.
   *
   * `null` beside a non-null `imported` is a world that declared an adoption and was not staged:
   * the two facts are genuinely different, and collapsing them into one field is what would make
   * that state unspellable - and therefore unreportable, and therefore free to reach a `prepare()`.
   * {@link EnvironmentManager.prepare} refuses exactly that pair, which is what makes *an import is
   * staged at `prepare()`* a property of the code rather than a convention a caller keeps.
   *
   * It records a **verification, not a materialisation**. The import does not build anything - the
   * adapter does, from this same plan - and what it establishes is that the world about to be
   * created *is* the world the document names, by comparing the two identities through the same
   * predicate the export uses. Refusing here rather than at the first criterion is the whole point:
   * a marker applied to a world that turned out to be a different one would be a false `PASS`
   * wearing an audit trail.
   */
  readonly adopted: ImportRecord | null;
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
   * The HTTP service this world is, or `null` when the world is not one.
   *
   * Deliberately *not* folded into `url`, even though the two are always present together. `url` is
   * an address and this is an identity, and they answer different questions: `url` is what a request
   * is sent to, while this is what the reading that came back says it was about. Folding them would
   * make "which service is this" unanswerable in the one place it is asked - a bundle read a week
   * later, beside a result from another run, against a service that has since been restarted on a
   * different port.
   */
  readonly api: ApiPlan | null;
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
  /**
   * The cluster this world stands in for, or `null` when the world is not a cluster.
   *
   * The third of the same field, one per kind of world, and read for the same reason as the other
   * two: the first question asked of a result is *which world produced it*. For a simulated cluster
   * the answer has three parts - a name, a namespace and the registry the substitution reads - and
   * leaving them in an adapter's private options would mean a bundle that cannot say which cluster a
   * verdict came from, which is precisely the claim a simulated world must never make loosely.
   */
  readonly cluster: ClusterPlan | null;
  /**
   * The POSIX-like system this world stands in for, or `null` when the world is not one.
   *
   * The fourth of the same field, one per kind of world, and read for the same reason as the other
   * three: the first question asked of a result is *which world produced it*. A simulated Linux has
   * three answers that have to travel with the verdict - which distribution the readings name,
   * which account the criteria act as, and which directory is the sandbox root - because each one
   * changes what a `posix.*` expectation means and none of them can be recovered from the reading
   * afterwards.
   */
  readonly posix: PosixPlan | null;
  /**
   * The operating system this world stands in for, or `null` when the world is not one.
   *
   * The fifth of the same field, one per kind of world, and read for the same reason as the other
   * four: the first question asked of a result is *which world produced it*. A simulated Windows has
   * four answers that have to travel with the verdict - which family the readings were taken against,
   * which release they name, which account the criteria act as, and which directory is the sandbox
   * root - because each one changes what an `os.*` expectation means and none of them can be
   * recovered from the reading afterwards.
   */
  readonly os: OsPlan | null;
  /**
   * The cloud account this world stands in for, or `null` when the world is not one.
   *
   * The sixth of the same field, one per kind of world, and read for the same reason as the other
   * five: the first question asked of a result is *which world produced it*. A simulated account has
   * four answers that have to travel with the verdict - which provider the readings name, which
   * region they were taken in, which account paid for them, and which identity the criteria act as -
   * because each one changes what a `cloud.*` expectation means and none of them can be recovered
   * from the reading afterwards. It is also the field a bundle is read against when a verdict reached
   * against a substitute has to be traceable to the thing it substituted for.
   */
  readonly cloud: CloudPlan | null;
  /**
   * The container runtime this world stands in for, or `null` when the world is not one.
   *
   * The seventh of the same field, one per kind of world, and read for the same reason as the other
   * six: the first question asked of a result is *which world produced it*. A runtime reading answers
   * that with three facts - which runtime the readings name, which platform its paths are spelled in,
   * and which directory on this machine its sandbox lives in - and the last of the three is not
   * recoverable from a reading at all, which is why it is a plan field rather than a reported one.
   *
   * It is also the field a bundle is read against when a verdict reached against a substitute has to
   * be traceable to the thing it substituted for - and in this world that traceability carries a
   * second job, because a container's process is real while its isolation is not, so a reader has to
   * be able to see which half of a verdict came from where.
   */
  readonly container: ContainerPlan | null;
  /**
   * The extension host this world stands in for, or `null` when the world is not one.
   *
   * The eighth of the same field, one per kind of world, and read for the same reason as the other
   * seven: the first question asked of a result is *which world produced it*. An extension-host
   * reading answers that with four facts - which host the readings name, which API version it
   * answered as, which event activated the extension, and which directory on this machine its
   * sandbox lives in - and the answer matters more here than anywhere else, because this is the only
   * world whose subject is itself a host. A verdict about an extension host reached against a real
   * one and a verdict reached against a substitute for one are different claims, and a bundle that
   * did not name which of the two it used would be unable to tell them apart.
   */
  readonly vscode: VSCodePlan | null;
  /**
   * The process boundary this world is, or `null` when the world is not one.
   *
   * The ninth of the same field, one per kind of world, and read for the same reason as the other
   * eight: the first question asked of a result is *which world produced it*. A process reading
   * answers that with three facts - which host the readings name, which program the world started,
   * and which directory on this machine its files live in - and the answer is needed here for a
   * reason the eight before it did not have, because this is the world whose *observable* facts are
   * the machine's own. A command's exit code and a file's contents mean the same thing in any world
   * that can produce them, so the identity is the only thing that says which machine they were
   * measured on; and the program the world ran is a fact about the run rather than about the reading,
   * since a criterion that performed its own `run` steps never starts the program at all.
   */
  readonly process: ProcessPlan | null;
  /**
   * The message broker this world stands in for, or `null` when the world is not one.
   *
   * The tenth of the same field, one per kind of world, and read for the same reason as the other
   * nine: the first question asked of a result is *which world produced it*. A broker reading answers
   * that with four facts - which cluster the log belongs to, which node answered, and the address the
   * socket really reached - and the address is the one of the four that could not be recovered from
   * the document afterwards, because `port: 0` means the port is decided at bind time.
   */
  readonly data: DataPlan | null;
  /**
   * The device this world stands in for, or `null` when the world is not one.
   *
   * The eleventh of the same field, one per kind of world, and read for the same reason as the other
   * ten: the first question asked of a result is *which world produced it*. A device reading answers
   * that with the device identity and the platform, and the platform is the one of the two that is a
   * rule rather than a label - it decides how a path inside the device's own storage is spelled, so a
   * result that named the device but not the platform would not say which grammar its paths were
   * resolved by.
   */
  readonly mobile: MobilePlan | null;
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

/**
 * An HTTP service world's resolved declaration.
 *
 * One field, and the size of the block is the interesting part. Every other block in this file
 * carries the facts that decide what its readings *mean* - a namespace, an account, a platform, an
 * API version - because in those worlds a reading cannot supply them. An HTTP service is the one
 * world where the reading can supply almost everything: the address comes from `url`, the readiness
 * signal from `start.readyPattern`, the liveness answer from `health`. What a reading cannot supply
 * is its own subject. Every request carries the address it was sent to and no statement of what was
 * listening there, so a reading of a healthy service and a reading of a proxy in front of a dead one
 * are the same document - and the name is the only field that tells them apart.
 *
 * It is a free string rather than an enumeration, on the same reasoning a provider name and a
 * runtime name are: a service name decides nothing a criterion can observe, and enumerating it would
 * let a label act as a rule.
 */
export interface ApiPlan {
  readonly service: string;
}

/**
 * A cluster world's resolved declaration.
 *
 * `images` is a directory rather than a list on purpose. A list of image names would be a second
 * source of truth about what was built, and the interesting failure - a manifest naming a tag that
 * nothing ever built - would then be a knob someone set rather than a disagreement between two
 * artifacts the run really produced. Read from the application's own build output, the substitution
 * keeps the faithful failure mode: a real cluster fails this way for exactly this reason.
 */
export interface ClusterPlan {
  readonly name: string;
  readonly namespace: string;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly imagesPath: string;
}

/**
 * A POSIX-like world's resolved declaration.
 *
 * `root` is a *sandbox* directory, not the application directory, and the distinction is the whole
 * reason the field exists. The world's filesystem is rebuilt on every reset, so pointing it at the
 * application would delete the code under test on the first iteration; pointing it at a directory of
 * the world's own keeps the application outside the world that is being destroyed and rebuilt.
 *
 * It is resolved rather than passed through for the reason every other path in the plan is: the
 * reading a validator sees must name the same directory the adapter really wrote to, and `""` must
 * stay the one spelling of "this world is not a system".
 */
export interface PosixPlan {
  /** The distribution the readings name, e.g. `veridian-simulated-linux`. */
  readonly distribution: string;
  /** The account the criteria act as. Readings are decided *as* this account, never as root. */
  readonly user: string;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly root: string;
}

/**
 * An operating-system world's resolved declaration.
 *
 * `family` is the field that makes this declaration worth having. The other three could each be
 * recorded in a reading; the family could not, because a reading that reported its own family could
 * not be contradicted by anything - and the family is what decides how a path is spelled in every
 * criterion, how the configuration store is addressed, and whether two spellings of a path are one
 * file. A world that promised Windows and reported macOS paths is a world that should not have run,
 * and this is the field that makes the disagreement expressible.
 *
 * `root` is a *sandbox* directory, not the application directory, on the same reasoning as
 * {@link PosixPlan.root}: the world's filesystem is destroyed and rebuilt on every reset, so pointing
 * it at the application would delete the code under test on the first iteration.
 */
export interface OsPlan {
  readonly family: OsFamily;
  /** The release the readings name, e.g. `Windows 11 23H2`. A record, not an installed image. */
  readonly system: string;
  /** The account the criteria act as. Access is decided *as* this account, never as SYSTEM or root. */
  readonly user: string;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly root: string;
}

/**
 * A cloud account's resolved declaration.
 *
 * There is no path here, and that is the honest shape rather than an omission: a provider holds
 * objects, queues, secrets and policies, and the application that provisions it never touches a file
 * in the world it is provisioning. Every other simulated plan carries a directory because every other
 * one has a filesystem; this world has none, so a `root` field would be a field that exists to make
 * the sixth block look like the first five.
 *
 * `provider` is a free string rather than a closed vocabulary, unlike `OsPlan.family`. A family earns
 * its enumeration by deciding how a path is spelled - a difference a criterion can observe - while a
 * provider name decides nothing except what the reading calls itself. Enumerating it would make this
 * field look like a rule and let it act as a label, and the two would then disagree the first time
 * somebody wanted a second substitute.
 *
 * `principal` is the account the criteria act *as*, and it is deliberately not the same question as
 * "which account is this" - which is `account`. One account may hold many principals, and an access
 * decision is scoped to the account while being asked about the principal. Keeping both is what lets
 * a judgment be duplicated across a workload by attaching the wrong identity, which is the failure
 * this world exists to catch.
 */
export interface CloudPlan {
  /** The provider identity the readings name, e.g. `veridian-cloud`. Declared, never inferred. */
  readonly provider: string;
  /** The region the readings were taken in, e.g. `veridian-1`. A record, not a placement. */
  readonly region: string;
  /** The account that holds every resource a reading reports. */
  readonly account: string;
  /** The identity the criteria act as. Access is decided *as* this principal, never as an account root. */
  readonly principal: string;
}

/**
 * A container runtime's resolved declaration.
 *
 * `root` is a *sandbox* directory on this machine, and it is here for a reason none of the other
 * simulated plans had: this world has two filesystems at once. A container's paths are its own -
 * `/app`, `/data`, `/var/lib/cart` - and they are spelled by a grammar that has nothing to do with the
 * machine the world is running on. A bind mount names both spellings in one command, so the adapter
 * resolves the host side against this directory and refuses a command that hands it a host path where
 * a container path belongs. Without this field it could not tell the two apart, and it would either
 * accept a path it cannot honour or refuse a path it should have mapped - the shape of the defect the
 * machine family paid for when one world ended up with two answers for one question.
 *
 * `platform` is the one fact here that is a rule rather than a label, which is why it is validated
 * against {@link CONTAINER_PLATFORMS} at load rather than accepted as written.
 */
export interface ContainerPlan {
  /** The runtime identity the readings name, e.g. `veridian-container-sim`. Declared, never inferred. */
  readonly runtime: string;
  /** The platform the containers stand in for. Decides how a path inside a container is spelled. */
  readonly platform: ContainerPlatform;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly root: string;
}

/**
 * A VS Code extension host's resolved declaration.
 *
 * `apiVersion` is the reason this block exists rather than the world keeping the number to itself.
 * A real host refuses to load an extension whose `engines.vscode` range does not admit the host's own
 * version - and that refusal is the exact defect this repository has already paid for once, when the
 * Cockpit declared a floor six minor releases below the first host that could load its entry point.
 * The failure mode is quiet: the extension installs, nothing errors, and it never starts. Computing
 * the answer needs the host's version to be a *declared* fact of the world, because a reading that
 * reported its own version could not be contradicted by anything.
 *
 * `activationEvent` is `null` when the manifest decides. That is not a default in the sense the other
 * plans use the word - it is a third answer, and the reading records which event was really fired, so
 * a criterion asserting an activation event asserts something the world observed rather than
 * something the plan assumed.
 *
 * `root` is a *sandbox* directory, on the same reasoning as {@link PosixPlan.root}: the world is
 * destroyed and rebuilt on every reset, so pointing it at the application would delete the code under
 * test on the first iteration. It is also where the extension's own persisted state lives, which is
 * what lets an activation be a fresh process without being an amnesiac one.
 */
export interface VSCodePlan {
  /** The host identity the readings name, e.g. `veridian-vscode-host`. Declared, never inferred. */
  readonly host: string;
  /** The API version the world answers as, e.g. `1.100.0`. A record, not an installation. */
  readonly apiVersion: string;
  /** The activation event to fire, or `null` to let the extension's own manifest decide. */
  readonly activationEvent: string | null;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly root: string;
  /** Configuration values supplied in place of the manifest's declared defaults. */
  readonly settings: Readonly<Record<string, string>>;
}

/**
 * A process boundary world's resolved declaration.
 *
 * Three fields, and each one answers a question the reading cannot.
 *
 * `host` is the same identity `ApiPlan.service` and `VSCodePlan.host` are: free text, because a name
 * decides nothing a criterion can observe and enumerating it would let a label act as a rule. It
 * matters here because this world is the one that runs the machine's own programs, so "which machine"
 * is the question a bundle read later has to be able to answer.
 *
 * `process.application` is *why this is a block and not a boolean*. The tenth world's subject is the
 * process boundary, and a criterion reaches across that boundary two ways: it runs a command of its
 * own with a `run` step, or it reads what a long-lived program the world started has been doing.
 * Only the second needs a program, and it is optional - a contract that provisions by running
 * commands needs no daemon at all. `{ command, args }` rather than one string, so nothing has to
 * quote a path containing a space, which is the defect a shell-shaped field invites on Windows.
 *
 * `root` is the *sandbox* directory, resolved against `appPath` on the same rule `databasePath` and
 * every other path field follow. It is deliberately not the application's own directory: this world
 * creates and deletes files to observe what the application writes, and a root pointing at the
 * application would delete the code under test. {@link ProcessPlan.application} names the program
 * that runs *in* it.
 */
export interface ProcessPlan {
  /** The host identity the readings name, e.g. `veridian-local-process`. Declared, never inferred. */
  readonly host: string;
  /**
   * The program the world starts and keeps running, or `null` when it starts none.
   *
   * Optional on purpose, and the optionality is the interesting part: every other world block names
   * something the world *is*, while this one names something the world *may do*. A contract that
   * provisions a tree with `run` steps and reads the files back has no use for a daemon, and
   * requiring one would make the simplest shape of this world unwritable.
   */
  readonly application: { readonly command: string; readonly args: readonly string[] } | null;
  /** Absolute, resolved against `appPath` on the same rule `databasePath` follows. */
  readonly root: string;
  /**
   * Directories the application may read and may never write.
   *
   * Empty is the ordinary case, and the field exists for the one shape of question the fixed read
   * allowance could not reach: a contract whose subject is the operator's **own** tree rather than a
   * program the world deploys. The application's read allowance used to be a fixed pair - this
   * world's application directory and its sandbox - so a real workspace was unreachable, and pointing
   * `root` at it instead is no answer because `root` is emptied on every reset.
   *
   * Read-only **by construction rather than by convention**: each member is added to the run's read
   * allowance and never to its write allowance, so the runtime refuses a write into an observed tree.
   * A promise in a comment would be a claim beside the code; this one is held by the same mechanism
   * that holds every other filesystem boundary here.
   *
   * Declared rather than inferred, which is the whole reason it is safe. The rule this world already
   * held - a path outside the root is refused rather than resolved - is preserved exactly: what is
   * widened is the set of paths the *operator named*, and everything unnamed is still refused.
   */
  readonly observe: readonly string[];
  /**
   * Whether this world's application runs in a container substrate instead of on this machine.
   *
   * **Opt-in, and the default is off on purpose.** `PLAN.md` §42's rule is *"do not prematurely force
   * every environment into containers"*, and a world that ran in a substrate by default would make
   * every existing contract's readings about a different machine than the one the operator is sitting
   * at - which is not a boundary improvement but a change of subject. Declared, it buys the one
   * boundary the host's permission model cannot hold: `network` stops being `unenforceable`.
   *
   * `null` means the world asked for no substrate, which is a different statement from a substrate it
   * asked for and did not get - the first is the document's choice and the second is a `reason` the
   * adapter reports.
   */
  readonly isolation: { readonly denyNetwork: boolean } | null;
}

/**
 * A message broker's resolved declaration.
 *
 * The first world block in this file to carry an address, and that is the whole reason it has four
 * fields where the two before it have three.
 *
 * `cluster` and `nodeId` are identity, on the same footing as `CloudPlan.account` and
 * `VSCodePlan.host`: a stream store is judged by which log a record landed in and which node
 * answered, and neither fact can be supplied by the reading that reports it.
 *
 * `host` and `port` are different in kind. They are where the substitute really listens, and they
 * are the reason this world is one a criterion can *act* in: the application is told this address and
 * opens a socket to it, while a criterion's own command is performed in process by the port and
 * filed `source: "criterion"`. It acts through a `run` step rather than a `call` step - a `call` is
 * the sixth world's and puts an HTTP request to a service, and the command words this world understands
 * (`create-topic`, `produce`, `fetch`, `metadata`, `commit`) are a register of its own rather than a
 * provider's routes. `port: 0` is not a missing value - it is
 * the declaration that the operating system picks the port, which is the only spelling that lets two
 * runs of the same contract coexist on one machine - and the adapter reports the port it really
 * bound, so the plan and the reading never disagree about the address even when the number was not
 * decided in advance.
 *
 * Because the substitute binds a socket, the loader holds it to loopback and refuses anything else
 * by name. A substitute broker reachable from off this machine would be a *real* listener wearing the
 * word simulated, which is the one claim this project does not make.
 */
export interface DataPlan {
  /** The cluster the readings name, e.g. `veridian-data`. Declared, never inferred. */
  readonly cluster: string;
  /** The broker id the world answers as, reported beside the cluster in every reading. */
  readonly nodeId: number;
  /** The host the substitute binds. Loopback only; the loader refuses anything else by name. */
  readonly host: string;
  /** The port the substitute binds, or `0` for "the operating system chooses one". */
  readonly port: number;
}

/**
 * The device declaration, resolved.
 *
 * The eleventh of the same interface, one per kind of world, and the first whose subject is a *device*
 * rather than a system, a cluster, an account, a runtime, a host or a service. Two of the three fields
 * are read for the same reason the neighbours' are - `device` is what a reading names, `root` is where
 * the world's own files live - and the third is the one that makes this block unlike most of them.
 *
 * `platform` is a *rule* rather than a label, which is why `readMobile` refuses a platform this
 * substitution does not implement instead of accepting it as written. It decides how a path inside the
 * device's own storage is spelled, so a document naming a platform the substitute does not answer as
 * would be a document whose every criterion resolved paths by the wrong grammar - and the refusal
 * happens before a world exists, which is the only place it can name the reason with the operator's
 * own document in hand.
 *
 * There is deliberately no `apiLevel`. A real device's level is a property of the platform rather than
 * a choice the operator makes, so the substitution carries it as a constant; and because nothing in
 * this world is booted, drawn, prompted for or delivered, a document able to state a level would be
 * able to assert something no reading could corroborate. The absence is recorded rather than left to
 * be inferred from this interface's silence.
 */
export interface MobilePlan {
  /** The device identity the readings name, e.g. `sim-cart-device`. Declared, never inferred. */
  readonly device: string;
  /** The platform this substitution implements, which decides the device's own path grammar. */
  readonly platform: MobilePlatform;
  /** The sandbox on this machine the world's bundles, keychain entries and device state live in. */
  readonly root: string;
}
