/**
 * The fifth world: a Windows or macOS system. The third one that is explicitly *simulated*.
 *
 * ## What is real here, and what is substituted
 *
 * Three things are real and stay real, which is what makes a verdict from this world mean anything:
 *
 * - **The sandbox is a real tree.** A world rooted at `<app>/.sandbox` is a directory with real files,
 *   real contents, real lengths and real SHA-256 hashes. The reading walks it with `readdir` and
 *   `lstat`; nothing in it is invented.
 * - **The listeners are real sockets.** A service started in this world binds a real TCP port on
 *   `127.0.0.1`, and `running` is the answer a real `connect(2)` gave, not a replay of the fact that
 *   `sc start` or `launchctl start` ran. Stopping the service really closes the socket.
 * - **The application process is real.** `start.command` is an ordinary child process with the
 *   operator's own privileges, run through the same `ProcessRunner` the rest of Veridian uses.
 *
 * What is substituted is named in {@link OS_SIMULATED_SURFACES} and written into every reading: the
 * kernel, the system identity, path semantics, the access decision, the configuration store, the
 * service manager, egress and the provisioning channel - with `registry` and `preferences` as the
 * per-family pair. The **access decision** is the substitute doing the most work, and it is worth
 * dwelling on: Windows has no mode at all, and a macOS mode is not a fact this host's filesystem holds
 * either, so the world keeps its own security record and reaches a decision from it - one rule written
 * once for both families. The reading reports the decision *and* the entry that fired, so a criterion
 * can say *why* a file was refused rather than only that it was.
 *
 * ## The provisioning channel, and why the application is not handed a shell
 *
 * An application cannot make syscalls in a world that has no kernel, so it needs a way to have its work
 * performed. The way here is an argument vector on stdout: `start.command` is a real program that runs,
 * decides, prints one command per line as a JSON array, and the world executes each one through the
 * same register a criterion's `run` step uses. That is the `provisioning` surface, and it is on the
 * substituted list precisely because it is not the real interface between a program and a kernel.
 *
 * The alternative - handing the application a shell over a socket - was rejected for the reason the
 * cluster adapter refuses to answer anything but its own route list: a shell is a *second*
 * substitution, and every criterion about "was this command run" would then be a question about the
 * shell rather than about the world. The commands are argument vectors, so what the world executes is
 * what the program said, with no word-splitting layer in between to disagree about it.
 *
 * ## What this world may not do
 *
 * It may not report a verdict it cannot justify. There is no syscall interposition, so it can never say
 * "the application could not have touched that file"; it can only say "this file, as this account, with
 * this entry, was readable" - and it says which account and which entry, because those are the two
 * facts that turn the answer into a claim about a system rather than about this laptop. Every reading
 * carries the family and the system the document declared, and the account the criteria acted as.
 *
 * It also may not let a simulated system be mistaken for an installed one. The world's own identity
 * file carries `simulated`, every reading carries `simulated`, and the identity is only ever *reported*
 * as a record - `ver` and `sw_vers` print a line saying so. A criterion may therefore assert on the
 * declared system, and nothing may assert that a Windows image was installed.
 *
 * ## Why the four refusals are refusals
 *
 * An `os` world with no declaration has no family to report, no account to decide access *as*, and no
 * root to build - so every criterion over it would be judged against a system nobody described. The
 * loader already refuses a half-stated declaration; this adapter refuses its absence in `create()`,
 * before anything runs. A world with no `start.command` has no application, and the interesting question
 * ("did the software harden this system?") would be answered by whatever the sandbox happened to hold.
 * A world whose criteria attempted a `run` step the register does not answer gets a `refused` record
 * rather than a thrown error, because a refusal is an observation a criterion may be built on. And
 * `restore()` without a snapshot is refused in `reset()`, naming the alternative, exactly as
 * `local-db`, `sim-k8s` and `sim-posix` refuse it.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { type ConfinementResult } from "../../core/environment/confinement.ts";
import { OS_OBSERVATION_KIND } from "../../core/environment/os-observation.ts";
import type { OsObservationData } from "../../core/environment/os-observation.ts";
import type {
  ArtifactKind,
  BoundaryCrossing,
  BoundaryReport,
  EnvironmentAdapter,
  EnvironmentPlan,
  EvidenceArtifact,
  HealthProbe,
  Observation,
  ObservationRequest,
} from "../../core/environment/types.ts";
import { BUNDLE_FILES, bundleLayout } from "../../core/evidence/index.ts";
import { EnvironmentError, failure } from "../../core/failure.ts";
import type { IoPort } from "../../core/io.ts";
import type { ProcessRunner } from "../../core/process.ts";
import { runToCompletion } from "../../core/process.ts";
import { OS_IDENTITY_PATHS, osEscapes, osPort } from "./os-port.ts";
import type { OsPort } from "./os-port.ts";

export interface SimOsEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The substitute host. Injected so the adapter's own behaviour can be tested without a real tree. */
  readonly port?: OsPort;
  /** How long the application's provisioning program may take. Generous: it is a one-off, not a retry. */
  readonly provisionTimeoutMs?: number;
}

/**
 * The environment variables an operating-system world hands its application.
 *
 * `HOST` is a host path this machine can be opened from, and `ROOT` is the same place as the *world*
 * spells it - because those are genuinely two different names for one directory and the application has
 * to be told both. A program that wrote to `VERIDIAN_OS_ROOT` believing it was a sandbox path would
 * create `C:\` on the drive Veridian happens to be running from; a program that passed the host path to
 * `icacls` in a `run` step would be refused, because the world's spelling is the only one a criterion
 * may use.
 *
 * They are named `VERIDIAN_OS_*` rather than `COMPUTERNAME`, `SystemRoot`, `USER`, `HOME`, `PATH` or
 * `SHELL` on purpose. This world has no login environment, and borrowing the real ecosystem's variable
 * names would invite the application to behave as though it had been logged in - which is the one thing
 * a simulated world must not do. The same rule the POSIX world paid for, one family out: a world's
 * environment is the world's to name.
 */
export const OS_ENV = {
  host: "VERIDIAN_OS_HOST",
  root: "VERIDIAN_OS_ROOT",
  family: "VERIDIAN_OS_FAMILY",
  system: "VERIDIAN_OS_SYSTEM",
  user: "VERIDIAN_OS_USER",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_OS =
  "this world has no `os` declaration, and the sim-os adapter stands in for a Windows or macOS " +
  "system - add `os: { family, system, user, root }` to the environment document, or use an adapter " +
  "whose world is a process on a port, a database file, a cluster or a POSIX system";

const MISSING_START_COMMAND =
  "this world declares no `start.command`, and the sim-os adapter will not judge a system it did not " +
  "let the application provision - a sandbox holding whatever an earlier run left in it is not the " +
  "world this contract describes";

export class SimOsEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-os";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #injected: OsPort | undefined;
  readonly #provisionTimeoutMs: number;
  readonly #stateDir: string;

  #port: OsPort | null = null;
  #id: string | null = null;
  /** Whether this world's application has provisioned it in *this* environment's lifetime. */
  #provisioned = false;

  /**
   * What the **runner** answered when the application's provisioning program was started, or `null`.
   *
   * Read off the result rather than recomputed here, and that distinction is the whole of the seam:
   * this adapter states *what the world allows*, and only the runner knows what it actually applied.
   * A world that answered this question from its own plan field would be reporting a decision nobody
   * had to agree with. It is `null` before the first provisioning run, which is why `boundaries()`
   * reports `unsupported` until then - there is no child and therefore nothing held.
   */
  #confinement: ConfinementResult | null = null;

  /**
   * Every argument vector this world refused because it climbed out of the sandbox.
   *
   * Reported, never cleared by `reset()`. A reset restores the world; it does not restore the record,
   * and an iteration that read the host's filesystem must not be followed by a clean one that reports
   * `PASS` with the evidence destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: SimOsEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#injected = options.port;
    this.#provisionTimeoutMs = options.provisionTimeoutMs ?? 120_000;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    const os = this.#plan.os;
    // Only the absence is checked here, and that is not a weaker check - it is the same one stated
    // once. `OsPlan`'s fields are non-empty by type, and `core/environment/load.ts` refuses a
    // half-stated block before a plan ever exists, so re-testing emptiness here would be a guard no
    // code path can trip: a check that cannot fail, written as though it could.
    if (os === null) throw new EnvironmentError(MISSING_OS);
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    if (this.#id === null) this.#id = `sim-os:${os.family}:${os.user}`;
    this.#port =
      this.#injected ??
      osPort({ root: this.#hostRoot(), family: os.family, system: os.system, user: os.user });
    this.#logger.debug("environment.create", {
      id: this.#id,
      family: os.family,
      system: os.system,
      user: os.user,
      root: this.#hostRoot(),
    });
    return { id: this.#id };
  }

  /**
   * Build the system, then let the application provision it.
   *
   * The order is the design. The sandbox has to exist before the application's program runs, because
   * that program is going to name commands that act on it - and a program that had to create its own
   * world would be provisioning something that is not the world under test.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    const port = this.#requirePort();
    await port.prepare();
    // The *resolved* root, the same value `create()` logged and the same one the port was handed. The
    // unresolved `os.root` used to be logged here while `create()` logged the resolved form, so the
    // bundle's own log held two readings of one fact - and the one a reader would trust when asking
    // "where did this world actually live" was the one that is not a path this machine can open.
    this.#logger.debug("environment.start", { id, root: this.#hostRoot() });
    await this.#provisionApplication();
    this.#provisioned = true;
  }

  /**
   * Nothing left to copy: the application provisioned *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do" from
   * "not done" - and so the note can name which command did the provisioning, which is what a reader of
   * `environment.json` wants when a criterion about a missing account fails.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note:
        "the application's own provisioning program issued its commands during start(); this world " +
        "provisions nothing on the application's behalf",
      command: this.#plan.start.command,
    });
  }

  async execute(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, true);
  }

  async observe(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, false);
  }

  /**
   * Readiness is a verdict this world reached by looking, not a status code it invented.
   *
   * Three facts, all of them observed: the world's own identity file exists, it names the family and
   * the system the document declared, and - when the document declared one - the application's own
   * output matched its readiness pattern. `statusCode` is `null` throughout, because an operating
   * system has no status to return and inventing `200` here would be the substitution claiming an HTTP
   * surface it does not have.
   *
   * The identity file is found in the **reading** rather than re-opened by path, and that is deliberate.
   * The path is a sandbox path - `C:\ProgramData\Veridian\identity.json` - and the io port resolves
   * against the operator's working directory, so reading it directly would look for
   * `<cwd>/C:\ProgramData\...` and report the world unbuilt while it was sitting right there. The port
   * is the thing that knows how to spell a sandbox path to the host, so the port is what is asked.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const os = this.#plan.os;
    if (os === null) return { ok: false, statusCode: null, message: MISSING_OS, patternSeen: null };

    const identityPath = OS_IDENTITY_PATHS[os.family];
    const data = await this.#requirePort().read();
    const identity = data.files.find((file) => file.path === identityPath);
    if (identity === undefined) {
      return {
        ok: false,
        statusCode: null,
        message:
          `the sandbox at ${os.root} holds no ${identityPath}, so the world was never built`,
        patternSeen: null,
      };
    }
    let recorded: unknown = null;
    try {
      recorded = identity.text === null ? null : JSON.parse(identity.text);
    } catch {
      recorded = null;
    }
    const named = (field: string): unknown =>
      typeof recorded === "object" && recorded !== null
        ? (recorded as Record<string, unknown>)[field]
        : undefined;
    if (named("family") !== os.family || named("system") !== os.system) {
      return {
        ok: false,
        statusCode: null,
        message:
          `${identityPath} does not name the ${os.family} system \`${os.system}\`, so the sandbox ` +
          "holds a different system's identity than the one this document declares",
        patternSeen: null,
      };
    }
    const pattern = this.#plan.health.readyPattern;
    if (pattern !== null) {
      const seen = this.#provisioningOutput().some((chunk) => new RegExp(pattern).test(chunk));
      return seen
        ? { ok: true, statusCode: null, message: null, patternSeen: true }
        : {
            ok: false,
            statusCode: null,
            message: `the application's provisioning program never printed /${pattern}/`,
            patternSeen: null,
          };
    }
    return { ok: true, statusCode: null, message: null, patternSeen: null };
  }

  /**
   * Photograph the system: the tree copied, the world's bookkeeping beside it, the security records and
   * the accounts included.
   *
   * A snapshot of the files alone would not be a snapshot of this world, and the port says why at
   * length. An access record, an owner, a setting and a running service are facts the reading reports
   * and the world holds; a copy that restored contents while losing the records would hand back a
   * system in which every hardening criterion fails for a reason the application never caused.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    if (!this.#provisioned) {
      throw new EnvironmentError("this environment has not been started; there is nothing to snapshot");
    }
    const name = `${id.replace(/[^A-Za-z0-9._-]/g, "-")}-${String(Date.now())}.os`;
    const dir = `${this.#snapshotsDir()}/${name}`;
    await this.#io.mkdirp(dir);
    await this.#requirePort().snapshot(dir);
    this.#logger.debug("environment.snapshot", { id, snapshot: name });
    return name;
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    const dir = `${this.#snapshotsDir()}/${snapshotId}`;
    if (!(await this.#io.exists(dir))) {
      throw new EnvironmentError(`there is no snapshot \`${snapshotId}\` to restore`);
    }
    await this.#requirePort().restoreFrom(dir);
    this.#logger.debug("environment.restore", { id, snapshot: snapshotId });
  }

  /**
   * Reset is first-class, and for a system world "restarting" means rebuilding the sandbox and letting
   * the application provision it again.
   *
   * Rebuilding without re-provisioning would leave a world that is clean and a run that reports every
   * account missing and every service stopped - which reads like an application defect and is an
   * artifact of the reset. The world's own exec record is deliberately *not* cleared: `os.ran` is a
   * criterion about what the run did, and a reset that erased it would destroy the evidence of a
   * violation by repairing it. The boundary crossings are not cleared for the same reason.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        "reset.strategy is `snapshot-restore`, and no snapshot was taken for this reset - take one with " +
          "`snapshot()` before the first criterion, or use `restart`, which rebuilds the sandbox and " +
          "lets the application provision it again",
      );
    }

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#osEnv(),
          onStdout: (chunk) => this.#logger.debug("reset.stdout", { chunk: chunk.trimEnd() }),
          onStderr: (chunk) => this.#logger.warn("reset.stderr", { chunk: chunk.trimEnd() }),
        },
        this.#provisionTimeoutMs,
      );
      if (result.timedOut || result.code !== 0) {
        throw new EnvironmentError(
          result.timedOut
            ? `the reset command \`${command}\` did not finish within ${String(this.#provisionTimeoutMs)}ms`
            : `the reset command \`${command}\` exited with code ${String(result.code)}: ${tail(result.stderr)}`,
        );
      }
      this.#logger.debug("environment.reset", { id, strategy, command });
      return;
    }

    if (strategy === "custom") {
      this.#logger.warn("environment.reset", {
        id,
        strategy,
        note: "a custom strategy was requested without a command; falling back to rebuilding the sandbox",
      });
    }

    await this.#requirePort().reset();
    await this.#provisionApplication();
    this.#logger.debug("environment.reset", { id, strategy: "restart" });
  }

  /**
   * Release the listeners and leave the tree in place.
   *
   * The root is deliberately not removed. Every artifact a bundle names lives under it - an `os.file`
   * reading quotes a path inside it - so deleting it on stop would leave a bundle describing files that
   * cannot be inspected afterwards. Removal is `destroy()`'s job, and even there it is the *next*
   * `reset()` that clears it.
   */
  async stop(id: string): Promise<void> {
    this.#requireId(id);
    await this.#requirePort().stop();
    this.#logger.debug("environment.stop", { id, note: "the sandbox's listeners have been closed" });
  }

  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.#requirePort().stop();
    this.#port = null;
    this.#provisioned = false;
    this.#id = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    if (!this.#provisioned) {
      throw new EnvironmentError("this environment has not been started; call start() before observing it");
    }
    const base = {
      kind: OS_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a system it never acted on, which is a verdict the observation cannot justify.
      const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
      const unsupported = act ? steps.findIndex((step) => step.kind !== "run") : -1;
      if (unsupported !== -1) {
        const step = steps[unsupported];
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "VALIDATOR_ERROR",
            `the sim-os adapter performs \`run\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the criterion ` +
              "would be judged in a system it never acted on",
          ),
        };
      }

      if (act) {
        const port = this.#requirePort();
        for (const step of steps) {
          if (step.kind !== "run") continue;
          const record = await port.exec({ argv: step.argv, source: "criterion" });
          if (record.result === "refused") {
            // Recorded, not thrown. A refusal is a fact about this world that a criterion is allowed to
            // be built on - and it is warned about as well, because a contract that runs a command this
            // world does not answer and never reads the refusal would otherwise pass on a system nothing
            // touched, with nothing in the run to explain it.
            this.#logger.warn("environment.run", {
              criterionId: request.criterionId,
              argv: step.argv,
              reason: record.reason,
              note: "this world refused the command; the refusal is in the reading",
            });
          }
        }
      }

      const data: OsObservationData = await this.#requirePort().read();
      const relativeRunDir = bundleLayout(this.#stateDir, request.runId).runDir;
      const artifacts = await this.#captureEvidence(request, data, relativeRunDir);
      return { ...base, data, artifacts, error: null };
    } catch (error) {
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", describe(error)) };
    }
  }

  /**
   * What this world did about the plan's boundaries.
   *
   * `network` is `unsupported`, for the reason the sibling worlds give: this world substitutes the
   * kernel, the configuration store and the access decision, but it does not enforce the *operator's*
   * network policy over the application, because the application is an ordinary child process with the
   * operator's own privileges - it can open whatever socket the operator can, and a report of
   * `enforced` on the strength of a guard over argument vectors would be exactly the overclaim the
   * boundary path exists to remove.
   *
   * `filesystemWrite` is a **reading** and no longer a sentence. It was the literal `unsupported`, and
   * a literal is wrong in both directions: it reports no boundary for a world whose runtime really did
   * refuse a write outside the sandbox, and it would report one for a world that asked for an
   * allowance and was given none. The value now comes from the runner's own answer for the child it
   * started, so the report cannot disagree with the mechanism.
   *
   * **Only the application's provisioning program is confined.** A `run` step carries an argv the
   * contract's *operator* wrote; the application's program is what the agent wrote. That is two actors,
   * and one word - `filesystemWrite` - cannot describe both. The operator already holds these
   * privileges, so confining their own commands would be a boundary drawn against the person holding
   * the document.
   *
   * The crossings list is reported even when empty, because here its emptiness means one specific
   * thing - the sandbox root was never climbed out of - and a reader has to be able to pair it with the
   * two policies above to see that it is one containment guard rather than a boundary.
   */
  boundaries(): BoundaryReport {
    return {
      network: this.#plan.boundary.network === "allow" ? "not-requested" : "unsupported",
      filesystemWrite: this.#confinement?.applied === true ? "enforced" : "unsupported",
      crossings: [...this.#crossings],
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). A system world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: OsObservationData,
    relativeRunDir: string,
  ): Promise<readonly EvidenceArtifact[]> {
    const id = request.criterionId;
    const artifacts: EvidenceArtifact[] = [];
    const write = async (relative: string, kind: ArtifactKind, contents: string): Promise<void> => {
      await this.#io.writeTextFile(`${relativeRunDir}/${relative}`, contents);
      artifacts.push({ path: relative, kind, criterionId: id, bytes: contents.length });
    };

    await write(
      `${BUNDLE_FILES.artifacts}/${id}.observation.json`,
      "json",
      `${JSON.stringify(data, null, 2)}\n`,
    );

    if (data.execs.length > 0) {
      // The transcript, on its own, because this is the artifact a human reads when a criterion about a
      // missing account fails: the reading says the account is absent, and the transcript says which
      // commands the run issued and which of them this world refused to answer.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.execs.json`,
        "json",
        `${JSON.stringify(data.execs, null, 2)}\n`,
      );
    }

    // Only the kinds this call did *not* write are worth a warning, and the set is read off the
    // artifacts rather than from a literal list beside them. A derived set cannot disagree with the
    // writes; a second list is free to, and a reader who learns to skip a self-contradicting warning
    // has learned to skip the one that is true.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the sim-os adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- the application ------------------------------------------------------------------------

  /**
   * Run the application's own provisioning program and perform the work it asks for.
   *
   * The program is a real child process: it reads its environment, decides, and prints one command per
   * line as a JSON argument vector. Every line is then executed through the world's register, which is
   * the same path a criterion's `run` step takes - so a repair that fixes the application's decision
   * changes the world through exactly the interface a criterion would have observed it through.
   *
   * A line this world does not answer is **recorded and warned about, not thrown**. That is not
   * leniency: it is the difference between "the world failed to start" and "the application asked for a
   * program this world does not have", and only the second one is a fact about the application. The
   * criterion that reads it is where that becomes a verdict.
   */
  async #provisionApplication(): Promise<void> {
    const { command, args, readyPattern } = this.#plan.start;
    const port = this.#requirePort();
    this.#logger.info("environment.provision.application", {
      command,
      args,
      cwd: this.#plan.appPath,
      // Two readings of one fact, and they are not the same string. `root` is the plan's own value -
      // what the document said, as `core/environment/load.ts` left it, which may be relative to the io
      // root - and `host` is what this machine can be opened from, which is what the port and the
      // application were both handed. A log that held only the first could not answer "where did this
      // world actually live", and a log that held only the second could not be compared with the
      // document a reader is looking at.
      root: this.#plan.os?.root ?? "",
      host: this.#hostRoot(),
    });

    // The allowance is a value; applying it is `core/process.ts`'s job. `readRoots` names both
    // directories because they are two - the program file is opened from the application directory and
    // everything the world holds is opened from the sandbox - and a read allowance naming only the
    // sandbox would refuse to load the program it was asked to confine. The write allowance is the
    // sandbox alone, which is the tree this world's own path grammar already refuses to leave.
    const hostRoot = this.#hostRoot();
    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#osEnv(),
        confinement: {
          readRoots: [this.#plan.appPath, hostRoot],
          writeRoots: [hostRoot],
        },
        onStdout: (chunk) => this.#logger.debug("provision.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("provision.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#provisionTimeoutMs,
    );

    // Read off the result the runner produced, never recomputed from the plan beside it. Both halves
    // are logged for the reason `local-process` logs both: a reader asking "was this child confined"
    // and a reader asking "why not" are two questions, and one of them is a `reason` only the runner
    // ever held.
    this.#confinement = result.confinement ?? null;
    this.#logger.info("environment.provision.confinement", {
      applied: this.#confinement?.applied ?? false,
      reason: this.#confinement === null ? "no allowance was requested" : this.#confinement.reason,
    });

    // The application's own command is filed in the same record the criteria's are. A reading that held
    // only what the *criteria* ran would be unable to answer the first question worth asking about a
    // failed provisioning - whether the application's program ran at all.
    port.record({
      source: "application",
      argv: [command, ...args],
      program: command,
      result: result.timedOut ? "timed-out" : result.code === 0 ? "completed" : "nonzero",
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      reason: null,
      durationMs: 0,
    });

    if (result.timedOut) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) did not finish within ` +
          `${String(this.#provisionTimeoutMs)}ms`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) exited with code ` +
          `${String(result.code)}: ${tail(result.stderr)}`,
      );
    }
    // A declared readiness pattern is honoured here as it is in the other four adapters: it is the
    // application's own signal that it finished. Checked against the *combined* output, because a
    // provisioning program that narrates to stderr is ordinary and a pattern is not a channel.
    if (readyPattern !== null && !new RegExp(readyPattern).test(`${result.stdout}\n${result.stderr}`)) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) never printed /${readyPattern}/; ` +
          `output: ${tail(result.stdout)}`,
      );
    }

    // Assigned here, after the refusals above, so `probe()` can only ever report a readiness pattern
    // matched against a provisioning run that completed.
    this.#lastProvisioning = [`${result.stdout}\n${result.stderr}`];

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const argv = parseCommandLine(trimmed);
      if (argv === null) {
        // Not thrown, and the reason is the same one the manifest parser gives: a program that printed
        // something the world cannot read has produced an observation about itself, and the run's
        // transcript is where a human should find it.
        this.#logger.warn("environment.provision", {
          line: trimmed,
          note:
            "the provisioning program printed a line that is not a JSON argument vector, so this " +
            "world had nothing to execute for it",
        });
        continue;
      }
      const record = await port.exec({ argv, source: "application" });
      if (record.result === "refused") {
        this.#logger.warn("environment.provision", {
          argv,
          reason: record.reason,
          note: "the provisioning program asked for a command this world does not answer",
        });
      }
      if (record.result === "refused" && argv.slice(1).some((token) => this.#escapes(token))) {
        // The one boundary this world holds, and one the application can cross.
        //
        // `filesystemWrite` is the choice of two members the boundary vocabulary offers: it is the
        // operator's (`network`, `filesystemWrite`), and a path that climbs out of the sandbox root is
        // the filesystem one. The verdict does not depend on that name being a perfect fit, because the
        // `subject` carries the whole argument vector, so a reader sees `type` from `icacls` and knows
        // which it was.
        //
        // Only the *application's* escapes are crossings. A criterion is the operator's own document and
        // the operator already has these privileges, so a criterion's escape is a reading - it is filed
        // as a `refused` exec and a contract is free to assert that this world held - whereas the
        // application is the untrusted party this whole layer exists to contain, and generated code
        // reaching for the host's filesystem is a safety event, not a reading. That asymmetry is the
        // point: `safetyState` fails the run on a crossing, and a run whose criterion probes the guard
        // has to be able to pass.
        this.#crossings.push({
          boundary: "filesystemWrite",
          subject: JSON.stringify(argv),
          criterionId: null,
          at: this.#clock.iso(),
        });
      }
    }
  }

  /**
   * Whether one argument climbs out of the sandbox - asked of the port, never decided here.
   *
   * The port refuses the command and this adapter records the crossing, and both have to agree on what
   * "out" means. Written twice, the two would agree on `..` and disagree the first time a token named
   * another drive, so the rule is imported. A second implementation of one rule is a claim about
   * agreement that nothing checks.
   */
  #escapes(token: string): boolean {
    const os = this.#plan.os;
    return os !== null && osEscapes(os.family, token);
  }

  /**
   * The sandbox as a path *this machine* opens it by, resolved once, for the port and the application.
   *
   * Two readers reach the sandbox by two different routes and only one of them is a directory the
   * process happens to be standing in. The port resolves a relative `root` against **the io root**,
   * because that is what every `node:fs` call behind it does; the application is a *separate* process
   * spawned with `cwd` set to the application's own directory, so the same relative string handed to it
   * resolves against **that**. One document, one string, two directories - so the world rebuilt one tree
   * while the application provisioned another beside it, and the criteria reported a system the
   * application's files were missing from. The application was not at fault and neither was the port: a
   * path handed to a second process is only ever absolute or ambiguous, and `HOST` promises a place this
   * machine can be opened from. `ROOT` is the world's own spelling and stays exactly what it is, because
   * a criterion may only name that one.
   *
   * Resolved through the io port and not against `appPath`: `core/environment/load.ts` has already
   * turned a document's `root` into a path relative to the io root, so resolving it a second time would
   * build `app/examples/sim-os/app/sandbox` - a world in the wrong place that still passes every
   * criterion, because the port and the application agree on where the wrong place is. Nothing in a
   * contract says where its world lives, so only the derivation can be wrong, and this is the one.
   * `IoPort#resolve` rather than `node:path`: it is the port's own spelling of a path in its filesystem,
   * absolute whenever its root is, which is the property `HOST` promises.
   */
  #hostRoot(): string {
    const os = this.#plan.os;
    if (os === null) throw new EnvironmentError(MISSING_OS);
    return this.#io.resolve(os.root);
  }

  #osEnv(): Readonly<Record<string, string>> {
    const os = this.#plan.os;
    if (os === null) throw new EnvironmentError(MISSING_OS);
    return {
      ...this.#plan.env,
      [OS_ENV.host]: this.#hostRoot(),
      // The world's own spelling of its own root, which is not the host path above. This is the value a
      // `run` step may name and the one a criterion's expectation may quote.
      [OS_ENV.root]: os.family === "windows" ? "C:\\" : "/",
      [OS_ENV.family]: os.family,
      [OS_ENV.system]: os.system,
      [OS_ENV.user]: os.user,
    };
  }

  /** The application's own output, as `probe()` needs it and `#provisionApplication` recorded it. */
  #provisioningOutput(): readonly string[] {
    return this.#lastProvisioning;
  }

  /**
   * The output of the most recent provisioning run.
   *
   * Held rather than read back out of the port, because the port's record is a *reading* of what
   * happened and `probe()` needs the text a readiness pattern is matched against. It is assigned at the
   * end of `#provisionApplication()` and nowhere else, so it can never describe a run that did not
   * happen.
   */
  #lastProvisioning: readonly string[] = [];

  #snapshotsDir(): string {
    return `${this.#stateDir}/snapshots`;
  }

  #requirePort(): OsPort {
    const port = this.#port;
    if (port === null) {
      throw new EnvironmentError("this environment has not been created; call create() first");
    }
    return port;
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment has not been created; call create() first");
    }
    if (this.#id !== id) {
      throw new EnvironmentError(`this environment is \`${this.#id}\`, but it was addressed as \`${id}\``);
    }
  }
}

/**
 * One line of the provisioning program's output, as an argument vector - or `null` when it is not one.
 *
 * `null` rather than a throw, and an empty vector rather than a `[""]`: a command with no program in it
 * is not a command, and executing it would file a record nobody could read. The caller turns both into a
 * warning naming the line, because "the program printed something else" is a fact about the program that
 * a human should see rather than an exception the run should die on.
 */
function parseCommandLine(line: string): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((entry): entry is string => typeof entry === "string" && entry.trim() !== "")) {
    return null;
  }
  return parsed;
}
