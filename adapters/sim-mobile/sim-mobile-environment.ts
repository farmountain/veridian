/**
 * The `sim-mobile` environment: a **simulated** device.
 *
 * ## What is real, and what is substituted
 *
 * The application is a real child process. It really reads its environment, really decides, and really
 * prints the command vectors this world executes; a bundle it asks this world to launch is spawned as a
 * real child too, by the substitute, under the same file allowance the application's own program runs
 * under. What is substituted is **the device**: there is no emulator, no guest kernel, no display, no
 * input device, no keychain service, no app store and no push service anywhere in the loop. Every
 * surface that is stood in for is declared in `simulated` on every reading, and the substitution is
 * named in `environment.json` by the adapter register rather than left for a reader to infer from a
 * plan.
 *
 * ## The one settled by the design rather than by an absence
 *
 * A reading carries a screen with a size, a density and a scale, and **nothing is ever drawn on it** -
 * `renderScreen` prints `rendered and never drawn`, and that is the whole truth about this world's
 * display. `sim-container` settles the same class of question the same way, where a published port is
 * `exposed` and never `reachable`, because a substitute that reports what it stood in for as though it
 * were a capability is reporting a world it does not have.
 *
 * ## Readiness is read, never pinged
 *
 * `probe()` reads the world rather than issuing a `device.ping` at it, and that is a decision rather
 * than a shortcut. `device.ping` is an ordinary action this world answers, so a probe could issue one -
 * and it would append a call to the record `mobile.call` reads, putting a request into every reading
 * that neither the application nor the criterion made. A health check that changes what it measures
 * cannot be repeated, and repeatability is the one property this world's evidence model rests on. What
 * is observed instead is the device's own declared identity, which is the same question asked of a
 * reading that writes nothing.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { type ConfinementResult } from "../../core/environment/confinement.ts";
import { MOBILE_OBSERVATION_KIND } from "../../core/environment/mobile-observation.ts";
import type { MobileObservationData } from "../../core/environment/mobile-observation.ts";
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
import { runToCompletion } from "../../core/process.ts";
import type { ProcessConfinement, ProcessRunner } from "../../core/process.ts";
import { mobilePort } from "./mobile-port.ts";
import type { MobilePort } from "./mobile-port.ts";

export interface SimMobileEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /**
   * Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it.
   */
  readonly stateDir: string;
  /**
   * The substitute device. Injected so the adapter's own behaviour can be tested without real children.
   */
  readonly port?: MobilePort;
  /**
   * How long the application's provisioning program may take. Generous: it is a one-off, not a retry.
   */
  readonly provisionTimeoutMs?: number;
}

/**
 * The directory a device path names when the application's own files are made visible to it.
 *
 * This world declares the convention rather than discovering it, so a contract can ask a question with
 * one spelling on both sides: the application is told its own tree appears at `VERIDIAN_MOBILE_WORKSPACE`,
 * and a criterion asks about a path under it without a second, application-private path in the middle.
 * The value is a device path - a string this machine can never open - which is why it is a constant here
 * and not a directory that gets created.
 */
export const MOBILE_WORKSPACE = "/data/local/tmp/workspace";

/**
 * The names a mobile world hands its application.
 *
 * Two of the four are two different kinds of fact, and the split is the same one `sim-container` draws.
 * `sandbox` is a host path this machine can open and the substitute really writes to; `workspace` is a
 * path *inside the device*, which this machine can never open and which no `run` step may name. A
 * program that passed the sandbox path where a device path belongs would be refused by name rather than
 * silently resolved, because the world's path grammar is not the host's - but a program that had only
 * one of the two names could not tell which one it was holding.
 */
export const MOBILE_ENV = {
  /** The world's store - bundles, data directories, device state - as this machine spells it. */
  sandbox: "VERIDIAN_MOBILE_SANDBOX",
  /** The device path the application's own tree appears at, from {@link MOBILE_WORKSPACE}. */
  workspace: "VERIDIAN_MOBILE_WORKSPACE",
  /** The device identity the readings name, so a program can label what it installs. */
  device: "VERIDIAN_MOBILE_DEVICE",
  /** The platform this substitution implements, so a program can refuse a system it was not written for. */
  platform: "VERIDIAN_MOBILE_PLATFORM",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_MOBILE =
  "this world has no `mobile` declaration, and the sim-mobile adapter stands in " +
  "for a device - add `mobile: { device, platform, root }` to the environment document, or use an " +
  "adapter whose world is a process on a port";

const MISSING_START_COMMAND =
  "this world declares no `start.command`, and the sim-mobile adapter " +
  "will not judge a device it did not let the application provision - a device holding whatever an " +
  "earlier run left on it is not the device this contract describes";

const NO_SNAPSHOT =
  "this world will not photograph itself, and the reason is not an absence: a " +
  "device world holds live child processes and a call record that grows while the run works. " +
  "`restart` rebuilds the sandbox and lets the application provision it again, which is what this " +
  "world can honestly promise";

export class SimMobileEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-mobile";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #injected: MobilePort | undefined;
  readonly #provisionTimeoutMs: number;
  readonly #stateDir: string;

  #port: MobilePort | null = null;
  #id: string | null = null;
  /** Whether this world's application has provisioned it in *this* environment's lifetime. */
  #provisioned = false;

  /**
   * What the **runner** answered when the application's provisioning program was started, or `null`.
   *
   * Read off the result rather than recomputed here, and that distinction is the whole of the seam:
   * this adapter states *what the world allows*, and only the runner knows what it actually applied.
   */
  #confinement: ConfinementResult | null = null;
  /** What the application's provisioning program printed, in order. Read by `probe()`, never by a verdict. */
  #lastProvisioning: readonly string[] = [];

  /**
   * Every host path this world refused because it lies outside it, when the **application** named it.
   *
   * Reported, never cleared by `reset()`. A reset restores the world; it does not restore the record.
   * A criterion's escape is deliberately *not* one of these: the operator owns that document and holds
   * those privileges already, so an escape by a criterion is a reading, and a run whose contract probes
   * this guard has to be able to pass. The client of every refusal is recorded by the port, so the two
   * parties can be told apart without a second copy of the boundary rule living here.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: SimMobileEnvironmentOptions) {
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
    const mobile = this.#plan.mobile;
    // `platform` is not checked for emptiness, and that is not an omission: it is typed to the members
    // of `MOBILE_PLATFORMS`, and `readMobile` refuses a document naming a platform this substitution
    // does not implement - before a world exists, with the operator's own file in hand. A `=== ""` here
    // would be a branch no document could reach.
    if (mobile === null || mobile.device === "" || mobile.root === "") {
      throw new EnvironmentError(MISSING_MOBILE);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    // The device identity rather than the platform, because `platform` is an enum with one member and
    // would make every environment in the tree the same world. The allowance is handed to the substitute
    // as well as to the provisioning program, because a bundle the application launches is a child too:
    // the boundary belongs to the run, and a world that confined its provisioner and not the processes
    // that provisioner started would report a containment it did not have.
    if (this.#id === null) this.#id = `sim-mobile:${mobile.device}`;
    this.#port =
      this.#injected ??
      mobilePort({
        root: this.#hostRoot(),
        contextRoot: this.#contextRoot(),
        device: mobile.device,
        platform: mobile.platform,
        processes: this.#processes,
        confinement: this.#allowance(),
      });
    // Both spellings, because they are two names for one directory and only one of them can be opened.
    // A log holding only the document's spelling sends a reader to a relative path they cannot resolve;
    // a log holding only the host's cannot be compared with the document they are holding.
    this.#logger.debug("environment.create", {
      id: this.#id,
      device: mobile.device,
      platform: mobile.platform,
      root: mobile.root,
      host: this.#hostRoot(),
    });
    return { id: this.#id };
  }

  /**
   * Build the device, and nothing else.
   *
   * The order is the design and it is the same design `sim-posix` uses: the sandbox has to exist before
   * the application's program runs, because that program is going to name bundle directories and data
   * directories that live inside it - and a program that had to create its own world would be
   * provisioning something that is not the world under test.
   *
   * The provisioning itself is `deploy()`'s work rather than this method's, so this world answers its
   * readiness question ("did the device come up") and its deployment question ("did the application
   * install what it meant to") at two different lifecycle steps instead of one.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    const port = this.#requirePort();
    await port.prepare();
    this.#logger.debug("environment.start", { id, root: this.#plan.mobile?.root ?? "" });
  }

  /**
   * Let the application provision the device - the one member where this world inverts its nearest
   * siblings rather than following them.
   *
   * `sim-container` and `sim-vscode` provision during `start()` and record an explicit no-op here,
   * because for them the sandbox and the provisioning are one act. This world separates them, and the
   * separation is what makes `environment.json` answer two questions with two readings: `start()` says
   * a device was built, `deploy()` says the application put something on it.
   *
   * Nothing is copied and no image is pushed on the application's behalf. The program is a real child
   * process that decides for itself, and every command vector it prints is executed through the same
   * register a criterion's `run` step reaches - which is what makes a repair to that program change the
   * world through the interface a criterion would have observed it through.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    await this.#provisionApplication();
    this.#provisioned = true;
    this.#logger.debug("environment.deploy", {
      id,
      note: "the application's own provisioning program issued its commands here; this world built the device",
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
   * Three facts, all of them observed: the sandbox holds its app store, the world's own reading names
   * the device and the platform this document declared, and - when the document declared one - the
   * application's own output matched its readiness pattern. `statusCode` is `null` throughout, because a
   * device has no socket to answer on and inventing `200` here would be the substitution claiming an
   * HTTP surface it does not have.
   *
   * The identity check is a guard a correct run cannot trip, and it is worth its two lines anyway: the
   * substitute is injected (`SimMobileEnvironmentOptions.port`), so this is the one place a test can
   * prove the adapter reads the world's own answer rather than the plan it was handed. An adapter that
   * reported the document back to itself would pass every other check in the tree.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const mobile = this.#plan.mobile;
    if (mobile === null) {
      return { ok: false, statusCode: null, message: MISSING_MOBILE, patternSeen: null };
    }

    if (!(await this.#io.exists(`${mobile.root}/store/bundles`))) {
      return {
        ok: false,
        statusCode: null,
        message: `the sandbox at ${mobile.root} holds no app store, so the world was never built`,
        patternSeen: null,
      };
    }

    const reading = await this.#requirePort().read();
    if (reading.device !== mobile.device || reading.state.platform !== mobile.platform) {
      return {
        ok: false,
        statusCode: null,
        message:
          `the sandbox reports itself as device \`${reading.device}\` on \`${reading.state.platform}\`, ` +
          `and this document declares \`${mobile.device}\` on \`${mobile.platform}\` - the world holds a ` +
          "different device's identity than the one this contract is about",
        patternSeen: null,
      };
    }

    const pattern = this.#plan.health.readyPattern;
    if (pattern !== null) {
      const seen = this.#lastProvisioning.some((chunk) => new RegExp(pattern).test(chunk));
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

  /** Refused **by name**, with the reason. See {@link NO_SNAPSHOT}. */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    throw new EnvironmentError(NO_SNAPSHOT);
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    throw new EnvironmentError(
      `${NO_SNAPSHOT} - so there is no snapshot \`${snapshotId}\` for this adapter to put back`,
    );
  }

  /**
   * Reset is first-class, and for a device world "restarting" means rebuilding the store and letting the
   * application provision it again.
   *
   * Rebuilding without re-provisioning would leave a world that is clean and a run that reports every
   * bundle absent and the device unprovisioned - which reads like an application defect and is an
   * artifact of the reset. The world's own call record is deliberately *not* cleared: `mobile.call` is a
   * criterion about what the run did, and a reset that erased the evidence of a violation would be
   * repairing the violation by destroying its proof.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        `${NO_SNAPSHOT}. This branch is reached only when a caller invokes ` +
          "`reset()` directly with that strategy: a `snapshot-restore` plan never arrives here through " +
          "`EnvironmentManager.reset()`, because it calls `restore()` with the baseline it took after " +
          "the provisioner ran - and this adapter refuses `snapshot()` too, for the same reason",
      );
    }

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#mobileEnv(),
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
        note: "a custom strategy was requested without a command; falling back to rebuilding the device",
      });
    }

    await this.#requirePort().reset();
    await this.#provisionApplication();
    this.#logger.debug("environment.reset", { id, strategy: "restart" });
  }

  /**
   * Stop every child and leave the sandbox in place.
   *
   * The sandbox is deliberately not removed. Every artifact a bundle names lives under it - a
   * `mobile.logs` reading quotes a log file the substitute wrote, and a bundle's own directory is a
   * place a reading reports - so deleting it on stop would leave a bundle describing a world that
   * cannot be inspected afterwards. Removal is `reset()`'s job, and even there it is the *rebuild* that
   * clears it.
   */
  async stop(id: string): Promise<void> {
    this.#requireId(id);
    await this.#requirePort().stop();
    this.#logger.debug("environment.stop", { id, note: "every child this world started has been stopped" });
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
      kind: MOBILE_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a device it never acted on, which is a verdict the observation cannot justify.
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
            `the sim-mobile adapter performs \`run\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the criterion ` +
              "would be judged in a device it never acted on",
          ),
        };
      }

      if (act) {
        const port = this.#requirePort();
        for (const step of steps) {
          if (step.kind !== "run") continue;
          const record = await port.exec({ argv: step.argv, client: "criterion" });
          if (record.result === "refused") {
            // Recorded, not thrown. A refusal is a fact about this world that a criterion is allowed to
            // be built on - and it is warned about as well, because a contract that runs an action this
            // world does not answer and never reads the refusal would otherwise pass on a device nothing
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

      const data: MobileObservationData = await this.#requirePort().read();
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
   * `network` is `unsupported` and not silently: `core/environment/confinement.ts` has no network flag
   * to apply, so there is nothing to derive the value from and no measurement that could make it
   * `enforced`.
   *
   * `filesystemWrite` **is a reading and no longer a sentence**. It says `enforced` when the runner
   * measurably confined the application's child and `unsupported` when it did not, because a literal is
   * wrong in both directions: it reports no boundary for a world whose runtime really did refuse a
   * write outside the sandbox, and it would report one for a world that asked for an allowance and was
   * given none.
   *
   * **Only the application's provisioning program is confined**, and the asymmetry is the point. A `run`
   * step carries an argv the contract's operator wrote; the application's program is what the agent
   * wrote. An operator already holds the privileges its own command needs, and an allowance over its
   * children would be a boundary that binds nobody. That is two actors, and one word - `filesystemWrite`
   * - cannot describe both.
   *
   * The crossings list is reported even when empty, because here its emptiness means one specific thing
   * - the application never named a host path outside this world - and a reader has to be able to pair it
   * with the two policies above to see that it is one containment guard rather than a boundary.
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
   * that came from here and evidence for a judgement has to be in the bundle (M5). A device world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: MobileObservationData,
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

    if (data.calls.length > 0) {
      // The transcript, on its own, because this is the artifact a human reads when a criterion about a
      // missing bundle fails: the reading says the bundle is absent, and the transcript says which
      // commands the run issued and which of them this world refused to answer.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.calls.json`,
        "json",
        `${JSON.stringify(data.calls, null, 2)}\n`,
      );
    }

    // Only the kinds this call did *not* write are worth a warning, and the set is read off the
    // artifacts rather than from a literal list beside them. A derived set cannot disagree with the
    // writes; a second list is free to, and a reader who learns to skip a self-contradicting warning has
    // learned to skip the one that is true.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the sim-mobile adapter writes ${produces} artifacts for a criterion and cannot produce ` +
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
   * leniency: it is the difference between "the world failed to start" and "the application asked for
   * something this world does not have", and only the second one is a fact about the application. The
   * criterion that reads it is where that becomes a verdict.
   *
   * A line that named a host path outside this world is recorded as a **crossing**, because that is the
   * one refusal the run itself fails on - and only the application's are, which is why the port records
   * who did the asking.
   */
  async #provisionApplication(): Promise<void> {
    const { command, args, readyPattern } = this.#plan.start;
    const port = this.#requirePort();
    this.#logger.info("environment.provision.application", {
      command,
      args,
      cwd: this.#plan.appPath,
      root: this.#plan.mobile?.root ?? "",
      host: this.#hostRoot(),
    });

    // Where the world's escape record stood before this run, so a second provisioning after a reset
    // reports only its own escapes. The port never clears that list - it is a record of the run, not of
    // the world - so the watermark is what keeps a crossing from being counted twice.
    const escapesBefore = port.escapes().length;

    // The allowance is a value; applying it is `core/process.ts`'s job, and it is named once for both
    // children - see `#allowance()`.
    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#mobileEnv(),
        confinement: this.#allowance(),
        onStdout: (chunk) => this.#logger.debug("provision.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("provision.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#provisionTimeoutMs,
    );

    this.#confinement = result.confinement ?? null;
    this.#logger.info("environment.provision.confinement", {
      applied: this.#confinement?.applied ?? false,
      reason: this.#confinement === null ? "no allowance was requested" : this.#confinement.reason,
    });

    const stdout = result.stdout;
    const stderr = result.stderr;

    if (result.timedOut) {
      throw new EnvironmentError(
        `the application's provisioning command \`${command}\` did not finish within ` +
          `${String(this.#provisionTimeoutMs)}ms: ${tail(stderr)}`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `the application's provisioning command \`${command}\` exited with code ` +
          `${String(result.code)}: ${tail(stderr)}`,
      );
    }

    // The program's own output is kept whole for `probe()`, which is the only reader that may look at it:
    // a verdict is reached by re-observing the world, never by reading what the application said it did.
    const combined = `${stdout}\n${stderr}`;
    this.#lastProvisioning = [combined];

    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const argv = parseCommandLine(trimmed);
      if (argv === null) {
        // A program that prints narration and commands to the same stream is a real program, and failing
        // the run on a line of narration would make the world refuse to start over a log line. It is said
        // out loud so that a reader of `execution.log` can tell "the application printed something this
        // world does not understand" from "the world lost a command".
        this.#logger.warn("environment.provision.line", {
          line: trimmed,
          note: "this line is not a JSON array of strings, so this world performed nothing for it",
        });
        continue;
      }
      const record = await port.exec({ argv, client: "provisioner" });
      if (record.result === "refused") {
        this.#logger.warn("environment.provision.refused", {
          argv,
          reason: record.reason,
          note: "this world refused the application's command; the refusal is in every reading",
        });
      }
    }

    // Only the escapes this provisioning itself recorded are crossings, and the watermark is the whole of
    // how the two parties are told apart. There is deliberately no `client !== "provisioner"` filter
    // beside it: within this window the provisioning loop above is the only caller of `exec`, so such a
    // condition could never be true - a guard no code path can trip is not a guard, and one written here
    // would read as the thing keeping a criterion's probe out of the record when the watermark is.
    for (const escape of port.escapes().slice(escapesBefore)) {
      this.#crossings.push({
        boundary: "filesystemWrite",
        subject: `the provisioning program named \`${escape.spelled}\`, which lies outside this world`,
        criterionId: null,
        at: this.#clock.iso(),
      });
    }

    if (readyPattern !== null && !new RegExp(readyPattern).test(combined)) {
      this.#logger.debug("environment.provision.ready", {
        pattern: readyPattern,
        note: "the readiness pattern was not seen in the provisioning output; probe() reports that",
      });
    }
  }

  // ---- paths ----------------------------------------------------------------------------------

  /**
   * The sandbox, as this machine spells it.
   *
   * Resolved through `IoPort#resolve` and **not** against `appPath`, because `load.ts` already made the
   * document's `root` relative to the io root; resolving it a second time against the application's
   * directory would build `app/app/.veridian`, a sandbox nothing else in the run could find.
   */
  #hostRoot(): string {
    return this.#io.resolve(this.#plan.mobile?.root ?? "");
  }

  /** The application's own directory, as this machine spells it - the `cwd` of its child process. */
  #contextRoot(): string {
    return this.#io.resolve(this.#plan.appPath);
  }

  /**
   * The file allowance this world asks for, named once because two different children run under it.
   *
   * The application's provisioning program is started with it, and the substitute is constructed with it
   * so that a bundle the application launches is confined by the same rule. Writing the object twice
   * would let the two drift, and the drift would be invisible: a program confined to the sandbox whose
   * own child was not would report `enforced` while a process it started held the operator's privileges.
   *
   * **Both trees are writable, and that is the same rule the path grammar states.** `resolveHostPath` in
   * `mobile-port.ts` admits a path inside the application's own tree or inside this world's sandbox, so an
   * allowance naming only the sandbox refuses a path the world answers for - one rule, written twice, the
   * second copy wrong. Measured rather than reasoned about: the staging program builds `./context/cart`
   * under its own directory, which is what a real client does before it installs anything, and with the
   * sandbox alone it died with `ERR_ACCESS_DENIED / FileSystemWrite`, the world never came up, and the run
   * reported `INCONCLUSIVE (ABORTED, 0 iteration(s))`. The tree this world refuses to leave is the
   * **sandbox**; the application's own tree is the application's.
   *
   * **Both are the *resolved* spellings, and that distinction was measured too.** `this.#plan.appPath` is
   * the document's own spelling - `examples/sim-mobile/app` when the operator names their goal that way -
   * and an allowance is a value handed to a *child process*, which opens absolute paths. The first version
   * of this function passed the plan's field straight through, so the same tree, listed the same way, held
   * under `--goal D:\...\goal.yaml` and was refused under `--goal examples/sim-mobile/goal.yaml` - an
   * allowance that depends on how the operator spelled their command line is an environment fact that is
   * not a fact about the environment. The other half is that this is the third world in this tree to pay
   * for the rule: a path re-resolved at the next seam doubles, and a path handed to a child *unresolved*
   * silently names nothing.
   */
  #allowance(): ProcessConfinement {
    const hostRoot = this.#hostRoot();
    return { readRoots: [this.#contextRoot(), hostRoot], writeRoots: [this.#contextRoot(), hostRoot] };
  }

  /**
   * The environment a mobile world hands its application. Two host facts, one device path convention, one
   * identity - and the operator's own variables, which are spread first so a derived name cannot be
   * shadowed by a declaration.
   *
   * That spread is not a convenience. `sim-os` carries the same line for the same reason, and the
   * failure it prevents is quiet: an alternative omitted it and the application ran with four variables
   * and none of the ones the operator's document declared, so a program that needed a port number read
   * `undefined`, defaulted, and provisioned a world every criterion then judged. Nothing failed; the
   * world was simply not the one the document described.
   */
  #mobileEnv(): Record<string, string> {
    const mobile = this.#plan.mobile;
    return {
      ...this.#plan.env,
      [MOBILE_ENV.sandbox]: this.#hostRoot(),
      [MOBILE_ENV.workspace]: MOBILE_WORKSPACE,
      [MOBILE_ENV.device]: mobile?.device ?? "",
      [MOBILE_ENV.platform]: mobile?.platform ?? "",
    };
  }

  #requirePort(): MobilePort {
    if (this.#port === null) {
      throw new EnvironmentError("this environment was never created; call create() before starting it");
    }
    return this.#port;
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment was never created; call create() before using it");
    }
    if (id !== this.#id) {
      throw new EnvironmentError(`this environment is \`${this.#id}\`, and \`${id}\` is a different world`);
    }
  }
}

/**
 * One line of the provisioning program's stdout, as an argument vector.
 *
 * `null` for anything that is not a non-empty array of non-blank strings. The caller decides what a
 * malformed line means; this function only refuses to invent a command out of narration.
 */
export function parseCommandLine(line: string): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  for (const token of parsed) {
    if (typeof token !== "string" || token.trim() === "") return null;
  }
  return parsed as readonly string[];
}
