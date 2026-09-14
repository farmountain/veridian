/**
 * The fourth world: a POSIX-like system. And the second one that is explicitly *simulated*.
 *
 * ## What is real here, and what is substituted
 *
 * Three things are real and stay real, which is what makes a verdict from this world mean anything:
 *
 * - **The sandbox is a real tree.** A world rooted at `<app>/.sandbox` is a directory with real
 *   files, real contents, real lengths and real SHA-256 hashes. `read()` walks it with `readdir` and
 *   `lstat`; nothing in the reading is invented.
 * - **The listeners are real sockets.** A service started in this world binds a real TCP port on
 *   `127.0.0.1`, and `verified` is the answer a real `connect(2)` gave, not a replay of the fact that
 *   `systemctl start` ran. Stopping the service really closes the socket.
 * - **The application process is real.** `start.command` is an ordinary child process with the
 *   operator's own privileges, run through the same `ProcessRunner` the rest of Veridian uses.
 *
 * What is substituted is named in {@link POSIX_SIMULATED_SURFACES} and written into every reading: the
 * kernel, the distribution identity, the package manager and its catalog, the permission decision and
 * egress. The permission decision is the one worth dwelling on, because it is the substitute doing the
 * most work: `0600` on a Windows file is not a fact the host filesystem holds, so this world keeps its
 * own inode record and decides `readable?` from the mode, the owner and the group exactly as
 * `open(2)` would. The reading reports the decision *and* says that the decider was the world.
 *
 * ## The provisioning channel, and why the application is not handed a shell
 *
 * An application cannot make syscalls in a world that has no kernel, so it needs a way to have its
 * work performed. The way here is an argument vector on stdout: `start.command` is a real program
 * that runs, decides, prints one command per line as a JSON array, and the world executes each one
 * through the same register a criterion's `run` step uses. That is the `provisioning` surface, and it
 * is on the substituted list precisely because it is not the real interface between a program and a
 * kernel.
 *
 * The alternative - handing the application a shell over a socket - was rejected for the reason the
 * cluster adapter refuses to answer anything but its own route list: a shell is a *second*
 * substitution, and every criterion about "was this command run" would then be a question about the
 * shell rather than about the world. The reflective part of the rejection is that a shell would also
 * take away the property this design keeps: the commands are argument vectors, so what the world
 * executes is what the program said, with no word-splitting layer in between to disagree about it.
 *
 * ## What this world may not do
 *
 * It may not report a verdict it cannot justify. There is no syscall interposition, so it can never
 * say "the application could not have touched that file"; it can only say "this file, as this account,
 * with this mode, was readable" - and it says which account and which mode, because those are the two
 * facts that turn the answer into a claim about a system rather than about this laptop. Every reading
 * carries the distribution the document declared and the account the criteria acted as.
 *
 * ## Why the four refusals are refusals
 *
 * A `posix` world with no declaration has no distribution to report, no account to decide permissions
 * *as*, and no root to build - so every criterion over it would be judged against a system nobody
 * described. The loader already refuses a half-stated declaration; this adapter refuses its absence in
 * `create()`, before anything runs. A world with no `start.command` has no application, and the
 * interesting question ("did the software harden this system?") would be answered by whatever the
 * sandbox happened to hold. A world whose criteria attempted a `run` step the register does not answer
 * gets a `refused` record rather than a thrown error, because a refusal is an observation a criterion
 * may be built on. And `restore()` without a snapshot is refused in `reset()`, naming the alternative,
 * exactly as `local-db` and `sim-k8s` refuse it.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { POSIX_OBSERVATION_KIND } from "../../core/environment/posix-observation.ts";
import type { PosixObservationData } from "../../core/environment/posix-observation.ts";
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
import { posixPort } from "./posix-port.ts";
import type { PosixPort } from "./posix-port.ts";

export interface SimPosixEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The substitute host. Injected so the adapter's own behaviour can be tested without a real tree. */
  readonly port?: PosixPort;
  /** How long the application's provisioning program may take. Generous: it is a one-off, not a retry. */
  readonly provisionTimeoutMs?: number;
}

/**
 * The environment variables a POSIX world hands its application.
 *
 * `HOST` is a host path this machine can be opened from, and `ROOT` is the same place as the *world*
 * spells it - because those are genuinely two different names for one directory and the application
 * has to be told both. A program that wrote to `VERIDIAN_POSIX_ROOT` believing it was a sandbox path
 * would create `/etc/veridian` on the C: drive; a program that passed the host path to `chmod` in a
 * `run` step would be refused, because the world's spelling is the only one a criterion may use.
 *
 * They are named `VERIDIAN_POSIX_*` rather than `HOME`, `SHELL` or `PATH` on purpose. This world does
 * not have a login environment, and borrowing the real ecosystem's variable names would invite the
 * application to behave as though it had been logged in - which is the one thing a simulated world
 * must not do.
 */
export const POSIX_ENV = {
  host: "VERIDIAN_POSIX_HOST",
  root: "VERIDIAN_POSIX_ROOT",
  distribution: "VERIDIAN_POSIX_DISTRIBUTION",
  user: "VERIDIAN_POSIX_USER",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_POSIX =
  "this world has no `posix` declaration, and the sim-posix adapter stands in for a POSIX-like " +
  "system - add `posix: { distribution, user, root }` to the environment document, or use an " +
  "adapter whose world is a process on a port";

const MISSING_START_COMMAND =
  "this world declares no `start.command`, and the sim-posix adapter will not judge a system it did " +
  "not let the application provision - a sandbox holding whatever an earlier run left in it is not " +
  "the world this contract describes";

export class SimPosixEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-posix";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #injected: PosixPort | undefined;
  readonly #provisionTimeoutMs: number;
  readonly #stateDir: string;

  #port: PosixPort | null = null;
  #id: string | null = null;
  /** Whether this world's application has provisioned it in *this* environment's lifetime. */
  #provisioned = false;

  /**
   * Every argument vector this world refused because it climbed out of the sandbox.
   *
   * Reported, never cleared by `reset()`. A reset restores the world; it does not restore the record,
   * and an iteration that read the host's filesystem must not be followed by a clean one that reports
   * `PASS` with the evidence destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: SimPosixEnvironmentOptions) {
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
    const posix = this.#plan.posix;
    if (posix === null || posix.distribution === "" || posix.user === "" || posix.root === "") {
      throw new EnvironmentError(MISSING_POSIX);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    if (this.#id === null) this.#id = `sim-posix:${posix.user}`;
    this.#port =
      this.#injected ??
      posixPort({ root: posix.root, distribution: posix.distribution, user: posix.user });
    this.#logger.debug("environment.create", {
      id: this.#id,
      distribution: posix.distribution,
      user: posix.user,
      root: posix.root,
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
    this.#logger.debug("environment.start", { id, root: this.#plan.posix?.root ?? "" });
    await this.#provisionApplication();
    this.#provisioned = true;
  }

  /**
   * Nothing left to copy: the application provisioned *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do" from
   * "not done" - and so the note can name which command did the provisioning, which is what a reader of
   * `environment.json` wants when a criterion about a missing user fails.
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
   * Three facts, all of them observed: the sandbox root exists, the world's own `/etc/os-release`
   * names the distribution the document declared, and - when the document declared one - the
   * application's own output matched its readiness pattern. `statusCode` is `null` throughout, because
   * a system has no status to return and inventing `200` here would be the substitution claiming an
   * HTTP surface it does not have.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const posix = this.#plan.posix;
    if (posix === null) return { ok: false, statusCode: null, message: MISSING_POSIX, patternSeen: null };

    const release = await this.#io.readTextFile(`${posix.root}/etc/os-release`);
    if (release === null) {
      return {
        ok: false,
        statusCode: null,
        message: `the sandbox at ${posix.root} holds no /etc/os-release, so the world was never built`,
        patternSeen: null,
      };
    }
    if (!release.includes(`ID=${posix.distribution}`)) {
      return {
        ok: false,
        statusCode: null,
        message:
          `${posix.root}/etc/os-release does not name ${posix.distribution}, so the sandbox holds a ` +
          "different system's identity than the one this document declares",
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
   * Photograph the system: the tree copied, the world's bookkeeping beside it, the modes and accounts
   * included.
   *
   * A snapshot of the files alone would not be a snapshot of this world, and the port says why at
   * length. `0600`, an owner, an installed package and a running service are facts the reading reports
   * and the world holds; a copy that restored contents while losing the modes would hand back a system
   * in which every hardening criterion fails for a reason the application never caused.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    if (!this.#provisioned) {
      throw new EnvironmentError("this environment has not been started; there is nothing to snapshot");
    }
    const name = `${id.replace(/[^A-Za-z0-9._-]/g, "-")}-${String(Date.now())}.posix`;
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
   * user missing and every service stopped - which reads like an application defect and is an artifact
   * of the reset. The world's own exec record is deliberately *not* cleared: `posix.ran` is a criterion
   * about what the run did, and a reset that erased it would destroy the evidence of a violation by
   * repairing it.
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
          env: this.#posixEnv(),
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
   * The root is deliberately not removed. Every artifact a bundle names lives under it - a
   * `posix.file` reading quotes a path inside it - so deleting it on stop would leave a bundle
   * describing files that cannot be inspected afterwards. Removal is `destroy()`'s job, and even there
   * it is the *next* `reset()` that clears it.
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
      kind: POSIX_OBSERVATION_KIND,
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
            `the sim-posix adapter performs \`run\` steps, and step ${String(unsupported + 1)} of ` +
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
            // world does not answer and never reads the refusal would otherwise pass on a system
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

      const data: PosixObservationData = await this.#requirePort().read();
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
   * `unsupported` for both, and not silently - the same report `sim-k8s` gives, for the same reason.
   * This world substitutes the kernel and the package manager, but it does not enforce the *operator's*
   * network or filesystem policy over the application, because the application is an ordinary child
   * process with the operator's own privileges: it can open whatever socket and write wherever the
   * operator can, and a report of `enforced` on the strength of a guard over argument vectors would be
   * exactly the overclaim the boundary path exists to remove.
   *
   * The crossings list is reported even when empty, because here its emptiness means one specific
   * thing - the sandbox root was never climbed out of - and a reader has to be able to pair it with the
   * two `unsupported` policies above to see that it is one containment guard rather than a boundary.
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
   * that came from here and evidence for a judgement has to be in the bundle (M5). A system world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: PosixObservationData,
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
      // missing user fails: the reading says the account is absent, and the transcript says which
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
          `the sim-posix adapter writes ${produces} artifacts for a criterion and cannot produce ` +
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
      root: this.#plan.posix?.root ?? "",
    });

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#posixEnv(),
        onStdout: (chunk) => this.#logger.debug("provision.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("provision.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#provisionTimeoutMs,
    );

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
    // A declared readiness pattern is honoured here as it is in the other three adapters: it is the
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
      if (record.result === "refused" && argv.some((token) => token.split("/").includes(".."))) {
        // The one boundary this world holds, and one the application can cross.
        //
        // `filesystemWrite` is the choice of two members the boundary vocabulary offers: it is the
        // operator's (`network`, `filesystemWrite`), and a path that climbs out of the sandbox root is
        // the filesystem one. The verdict does not depend on that name being a perfect fit, because the
        // `subject` carries the whole argument vector, so a reader sees `cat` from `chmod` and knows
        // which it was.
        //
        // Only the *application's* escapes are crossings. A criterion is the operator's own document
        // and the operator already has these privileges, so a criterion's escape is a reading - it is
        // filed as a `refused` exec and a contract is free to assert that this world held - whereas the
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

  #posixEnv(): Readonly<Record<string, string>> {
    const posix = this.#plan.posix;
    if (posix === null) throw new EnvironmentError(MISSING_POSIX);
    return {
      ...this.#plan.env,
      [POSIX_ENV.host]: posix.root,
      [POSIX_ENV.root]: "/",
      [POSIX_ENV.distribution]: posix.distribution,
      [POSIX_ENV.user]: posix.user,
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
   * happened and `probe()` needs the text a readiness pattern is matched against. It is assigned at
   * the end of `#provisionApplication()` and nowhere else, so it can never describe a run that did not
   * happen.
   */
  #lastProvisioning: readonly string[] = [];

  #snapshotsDir(): string {
    return `${this.#stateDir}/snapshots`;
  }

  #requirePort(): PosixPort {
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
 * `null` rather than a throw, and an empty vector rather than a `[""]`: a command with no program in
 * it is not a command, and executing it would file a record nobody could read. The caller turns both
 * into a warning naming the line, because "the program printed something else" is a fact about the
 * program that a human should see rather than an exception the run should die on.
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
