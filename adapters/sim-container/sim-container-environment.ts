/**
 * The `sim-container` environment: a **simulated** container runtime.
 *
 * ## What is real, and what is substituted
 *
 * The application is a real child process. It really reads its environment, really decides, and really
 * prints the command vectors this world executes; the commands really run, because `container exec` and
 * `container create` start real children with the environment the image declared. A build context is
 * really walked and really hashed, and a bind mount's source is really tested for existence.
 *
 * What is substituted is **the engine**: there is no container runtime anywhere in the loop. The
 * namespaces, cgroups, image layers, registry, published ports, volumes and user switching a real engine
 * would give the application are declared in `simulated` on every reading, and the substitution is named
 * in `environment.json` by the adapter register rather than left for a reader to infer from a plan.
 *
 * ## The one settled by the design rather than by an absence
 *
 * A published port has no `reachable` field, and that is not a gap. Publishing is a fact this world can
 * hold and report - the mapping was asked for, and the container's declared port is in the map - while
 * *reaching* the port would need a network the substitution does not have, so a criterion that judged it
 * would be judging a substitute's arithmetic. `sim-cloud` settles the same class of question the same
 * way: report what the world did, refuse to report what it stood in for.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { CONTAINER_OBSERVATION_KIND } from "../../core/environment/container-observation.ts";
import type { ContainerObservationData } from "../../core/environment/container-observation.ts";
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
import type { ProcessRunner } from "../../core/process.ts";
import { containerPort } from "./container-port.ts";
import type { ContainerPort } from "./container-port.ts";

export interface SimContainerEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The substitute engine. Injected so the adapter's own behaviour can be tested without real children. */
  readonly port?: ContainerPort;
  /** How long the application's provisioning program may take. Generous: it is a one-off, not a retry. */
  readonly provisionTimeoutMs?: number;
}

/**
 * The directory a container path names when the application's own files are mounted into it.
 *
 * This world declares the convention rather than discovering it, so a contract can ask a question with
 * one spelling on both sides: the application mounts host files at `VERIDIAN_CONTAINER_WORKSPACE`, and a
 * criterion asks about `/workspace/index.html` without a second, application-private path in the middle.
 */
export const CONTAINER_WORKSPACE = "/workspace";

/**
 * The environment variables a container world hands its application.
 *
 * Two of these are the pair `POSIX_ENV` was written for, one family over: `SANDBOX` is a host path this
 * machine can open, and `WORKSPACE` is a path *inside a container*, which this machine can never open.
 * A program that passed the sandbox path where a container path belongs would be refused by name rather
 * than silently resolved, because the world's path grammar is not the host's - but a program that had
 * only one of the two names could not tell which one it was holding.
 *
 * The other two are identity, and the world is the only thing that may state them: a real runtime may be
 * `docker`, `podman` or `containerd`, and a container's platform decides whether a binary in an image
 * could ever execute. A provisioning program that guessed either would be writing a fact about this
 * world, and this world is the only authority on it.
 */
export const CONTAINER_ENV = {
  /** The world's store - image root filesystems, volumes, records - as this machine spells it. */
  sandbox: "VERIDIAN_CONTAINER_SANDBOX",
  /** The container path the application's own directory is mounted at, from {@link CONTAINER_WORKSPACE}. */
  workspace: "VERIDIAN_CONTAINER_WORKSPACE",
  runtime: "VERIDIAN_CONTAINER_RUNTIME",
  platform: "VERIDIAN_CONTAINER_PLATFORM",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_CONTAINER =
  "this world has no `container` declaration, and the sim-container adapter stands in for a container " +
  "runtime - add `container: { runtime, platform, root }` to the environment document, or use an " +
  "adapter whose world is a process on a port";

const MISSING_START_COMMAND =
  "this world declares no `start.command`, and the sim-container adapter will not judge a runtime it " +
  "did not let the application provision - a world holding whatever an earlier run left in it is not " +
  "the world this contract describes";

const NO_SNAPSHOT =
  "this world will not photograph itself, and the reason is not an absence: a container world holds " +
  "live child processes. Copying its trees and its records would produce a snapshot that restores a " +
  "world that is not the one that was running - every container would come back as a record with no " +
  "handle behind it, and every criterion about what a running container was doing would be judged " +
  "against a process that had stopped. `restart` rebuilds the sandbox and lets the application " +
  "provision it again, which is what this world can honestly promise";

export class SimContainerEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-container";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #injected: ContainerPort | undefined;
  readonly #provisionTimeoutMs: number;
  readonly #stateDir: string;

  #port: ContainerPort | null = null;
  #id: string | null = null;
  /** Whether this world's application has provisioned it in *this* environment's lifetime. */
  #provisioned = false;
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

  constructor(plan: EnvironmentPlan, options: SimContainerEnvironmentOptions) {
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
    const container = this.#plan.container;
    // `platform` is not checked for emptiness, and that is not an omission: it is typed to the members
    // of `CONTAINER_PLATFORMS`, and `readContainer` refuses a document naming a platform this
    // substitution does not implement - before a world exists, with the operator's own file in hand.
    // A `=== ""` here would be a branch no document could reach.
    if (container === null || container.runtime === "" || container.root === "") {
      throw new EnvironmentError(MISSING_CONTAINER);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    if (this.#id === null) this.#id = `sim-container:${container.runtime}`;
    this.#port =
      this.#injected ??
      containerPort({
        root: this.#hostRoot(),
        contextRoot: this.#contextRoot(),
        runtime: container.runtime,
        platform: container.platform,
        processes: this.#processes,
      });
    // Both spellings, because they are two names for one directory and only one of them can be opened.
    // A log holding only the document's spelling sends a reader to a relative path they cannot resolve;
    // a log holding only the host's cannot be compared with the document they are holding.
    this.#logger.debug("environment.create", {
      id: this.#id,
      runtime: container.runtime,
      platform: container.platform,
      root: container.root,
      host: this.#hostRoot(),
    });
    return { id: this.#id };
  }

  /**
   * Build the store, then let the application provision the runtime.
   *
   * The order is the design and it is the same design `sim-posix` uses: the sandbox has to exist before
   * the application's program runs, because that program is going to name build contexts and bind
   * mounts that live inside it - and a program that had to create its own world would be provisioning
   * something that is not the world under test.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    const port = this.#requirePort();
    await port.prepare();
    this.#logger.debug("environment.start", { id, root: this.#plan.container?.root ?? "" });
    await this.#provisionApplication();
    this.#provisioned = true;
  }

  /**
   * Nothing left to copy: the application provisioned *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do" from
   * "not done" - and so the note can name which command did the provisioning, which is what a reader of
   * `environment.json` wants when a criterion about a missing image fails.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note:
        "the application's own provisioning program issued its commands during start(); this world " +
        "builds no image and starts no container on the application's behalf",
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
   * Three facts, all of them observed: the sandbox holds its store, the world's own identity names the
   * runtime and the platform the document declared, and - when the document declared one - the
   * application's own output matched its readiness pattern. `statusCode` is `null` throughout, because
   * an engine has no status to return over a socket and inventing `200` here would be the substitution
   * claiming an HTTP surface it does not have.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const container = this.#plan.container;
    if (container === null) {
      return { ok: false, statusCode: null, message: MISSING_CONTAINER, patternSeen: null };
    }

    if (!(await this.#io.exists(`${container.root}/store/images`))) {
      return {
        ok: false,
        statusCode: null,
        message: `the sandbox at ${container.root} holds no image store, so the world was never built`,
        patternSeen: null,
      };
    }

    const reading = await this.#requirePort().read();
    if (reading.runtime !== container.runtime || reading.os !== container.platform) {
      return {
        ok: false,
        statusCode: null,
        message:
          `the sandbox reports itself as \`${reading.runtime}\` on \`${reading.os}\`, and this document ` +
          `declares \`${container.runtime}\` on \`${container.platform}\` - the world holds a different ` +
          "runtime's identity than the one this contract is about",
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
   * Reset is first-class, and for a container world "restarting" means rebuilding the store and letting
   * the application provision it again.
   *
   * Rebuilding without re-provisioning would leave a world that is clean and a run that reports every
   * image absent and every container missing - which reads like an application defect and is an artifact
   * of the reset. The world's own call record is deliberately *not* cleared: `container.call` is a
   * criterion about what the run did, and a reset that erased it would destroy the evidence of a
   * violation by repairing it.
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
          env: this.#containerEnv(),
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
        note: "a custom strategy was requested without a command; falling back to rebuilding the store",
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
   * `container.logs` reading quotes the record, and a bind mount's source is a directory the reading
   * reports as existing - so deleting it on stop would leave a bundle describing a world that cannot be
   * inspected afterwards. Removal is `reset()`'s job, and even there it is the *rebuild* that clears it.
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
      kind: CONTAINER_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a runtime it never acted on, which is a verdict the observation cannot justify.
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
            `the sim-container adapter performs \`run\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the criterion ` +
              "would be judged in a runtime it never acted on",
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
            // be built on - and it is warned about as well, because a contract that runs a command this
            // world does not answer and never reads the refusal would otherwise pass on a runtime
            // nothing touched, with nothing in the run to explain it.
            this.#logger.warn("environment.run", {
              criterionId: request.criterionId,
              argv: step.argv,
              reason: record.reason,
              note: "this world refused the command; the refusal is in the reading",
            });
          }
        }
      }

      const data: ContainerObservationData = await this.#requirePort().read();
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
   * `unsupported` for both, and not silently - the same report `sim-posix` and `sim-k8s` give, for the
   * same reason. This world substitutes namespaces, cgroups and an image store, but it does not enforce
   * the *operator's* network or filesystem policy over the application, because the application is an
   * ordinary child process with the operator's own privileges: it can open whatever socket and write
   * wherever the operator can. A report of `enforced` on the strength of a guard over command vectors
   * would be exactly the overclaim the boundary path exists to remove.
   *
   * The crossings list is reported even when empty, because here its emptiness means one specific thing
   * - the application never named a host path outside this world - and a reader has to be able to pair it
   * with the two `unsupported` policies above to see that it is one containment guard rather than a
   * boundary.
   */
  boundaries(): BoundaryReport {
    return {
      network: this.#plan.boundary.network === "allow" ? "not-requested" : "unsupported",
      filesystemWrite: "unsupported",
      crossings: [...this.#crossings],
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). A container world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: ContainerObservationData,
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
      // missing image fails: the reading says the image is absent, and the transcript says which commands
      // the run issued and which of them this world refused to answer.
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
          `the sim-container adapter writes ${produces} artifacts for a criterion and cannot produce ` +
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
      root: this.#plan.container?.root ?? "",
      host: this.#hostRoot(),
    });

    // Where the world's escape record stood before this run, so a second provisioning after a reset
    // reports only its own escapes. The port never clears that list - it is a record of the run, not of
    // the world - so the watermark is what keeps a crossing from being counted twice.
    const escapesBefore = port.escapes().length;

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#containerEnv(),
        onStdout: (chunk) => this.#logger.debug("provision.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("provision.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#provisionTimeoutMs,
    );

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
    return this.#io.resolve(this.#plan.container?.root ?? "");
  }

  /** The application's own directory, as this machine spells it - the `cwd` of its child process. */
  #contextRoot(): string {
    return this.#io.resolve(this.#plan.appPath);
  }

  /**
   * The environment a container world hands its application. Two host facts, one path convention, one
   * identity - and the operator's own variables, which are spread first so a derived name cannot be
   * shadowed by a declaration.
   *
   * That spread is not a convenience. `sim-os` carries the same line for the same reason, and the
   * failure it prevents is quiet: an alternative omitted it and the application ran with four variables
   * and none of the ones the operator's document declared, so a program that needed a port number read
   * `undefined`, defaulted, and provisioned a world every criterion then judged. Nothing failed; the
   * world was simply not the one the document described.
   */
  #containerEnv(): Record<string, string> {
    const container = this.#plan.container;
    return {
      ...this.#plan.env,
      [CONTAINER_ENV.sandbox]: this.#hostRoot(),
      [CONTAINER_ENV.workspace]: CONTAINER_WORKSPACE,
      [CONTAINER_ENV.runtime]: container?.runtime ?? "",
      [CONTAINER_ENV.platform]: container?.platform ?? "",
    };
  }

  #requirePort(): ContainerPort {
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
