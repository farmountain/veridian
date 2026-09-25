/**
 * The process boundary world: a real child process, and a real directory it wrote into.
 *
 * ## What makes this a different world from `local-api`
 *
 * `local-api` starts a program and asks it questions over a socket. This world starts a program,
 * lets it run, and reads what it *did* - a non-zero exit code, two output streams, and the files
 * that appeared under a directory. The subject is not an answer, it is a side effect. A criterion
 * here is of the shape "this command writes that report and exits zero", which no world that
 * observes through a protocol can be written about.
 *
 * ## What it is not
 *
 * It is not simulated. There is no substitute and no stand-in: `node` really runs, the bytes really
 * land on disk, and the reading carries **no `simulated` field** - its absence is a claim rather
 * than an oversight, exactly as `local-api`'s absence of one is. There is likewise no
 * `*_SIMULATED_SURFACES` constant, and none is wanted.
 *
 * ## Why a criterion reaches this world two ways
 *
 * A criterion can *act* here (`run` carries an argument vector) or merely *read* (`observe` is handed
 * the same steps and performs none of them). Both are needed and they are not the same thing: the
 * first is how a contract provisions, and the second is how a contract is re-judged without
 * re-provisioning - which is what makes a repair observable. `observe()` therefore reports the
 * commands it was given without running them, and that distinction is why a run can be repeated.
 *
 * ## The boundary it can actually hold
 *
 * **The filesystem boundary is enforced, and the report says so only when it really was.** The child
 * is started through `confineChild`, which turns the argument vector into
 * `node --permission --allow-fs-read=<app> --allow-fs-read=<sandbox> --allow-fs-write=<sandbox> ...`
 * - so a write outside the sandbox is refused by the interpreter, as `ERR_ACCESS_DENIED` on the
 * application's own stream, with the process alive and its exit code still its own. Measured on the
 * real demo application: the permitted build produces **byte-identical output and exit 0**, and a
 * deliberate escape is refused with the file never created. That second half is the whole point -
 * an enforcement that also broke the permitted work would be a broken world rather than a boundary.
 *
 * **The network boundary is `unenforceable`, and that is a measurement rather than a shrug.** There
 * is no `--allow-net`: `node --allow-net=127.0.0.1` answers `bad option`, exit 9, while `--permission`
 * on the very same runtime is accepted, exit 0. So no flag could hold this boundary, and `unsupported`
 * would leave a reader unable to tell "not written yet" from "cannot be written". The child can open
 * any socket the operator can.
 *
 * **The confinement is conditional, and every condition is reported rather than assumed.** It is
 * applied only when the runtime accepts the flag, only when the command really is a Node interpreter
 * (the permission model is enforced *by the interpreter*, not by the operating system, so `cmd` is an
 * ordinary process no matter what is passed to it), and only once `#spawn` has actually done it -
 * `boundaries()` reads back what `#spawn` returned, so a world that never started a child reports
 * `unsupported` rather than claiming a boundary over a process that does not exist.
 *
 * `crossings` is empty *by construction* rather than by omission. A confinement refusal reaches this
 * world as text on the application's stderr, after the runtime has already refused it; reading that
 * as the application escaping would be a claim nothing here observed, since the attempt itself is
 * never visible. Reading a *target* path outside the sandbox is refused by `processPath` and reported
 * by the validator that asked - a **criterion defect**, not a boundary crossing, because only the
 * application's escapes are crossings and a target spelling is not the application.
 *
 * ## One operation per step, and the mutating one is `deploy`
 *
 * `deploy` is an explicit logged no-op rather than an empty body, for the reason the sibling worlds
 * record: the program under test is the user's own working tree, run in place. A `deploy` that copied
 * files would give the run a *different* tree from the one an agent edits, and then a `PASS` would be
 * evidence about a copy nobody repairs.
 */

import { delimiter, relative } from "node:path";

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { StepKind } from "../../core/acceptance/steps.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { type ConfinementResult } from "../../core/environment/confinement.ts";
import type { EnvCrawl, EnvMode } from "../../core/environment/env-crawl.ts";
import type { IsolationResult } from "../../core/environment/isolation.ts";
import type {
  ProcessCommandRecord,
  ProcessCommandState,
  ProcessFileReading,
  ProcessObservationData,
  ProcessStreamReading,
} from "../../core/environment/process-observation.ts";
import {
  PROCESS_OBSERVATION_KIND,
  commandSelectorOf,
  processPath,
} from "../../core/environment/process-observation.ts";
import type {
  ArtifactKind,
  BoundaryReport,
  EnvironmentAdapter,
  EnvironmentPlan,
  EvidenceArtifact,
  HealthProbe,
  Observation,
  ObservationRequest,
  ProcessPlan,
} from "../../core/environment/types.ts";
import { BUNDLE_FILES, bundleLayout } from "../../core/evidence/index.ts";
import { EnvironmentError, failure } from "../../core/failure.ts";
import type { IoPort } from "../../core/io.ts";
import type { ProcessHandle, ProcessResult, ProcessRunner } from "../../core/process.ts";
import { runToCompletion } from "../../core/process.ts";
import type { FileProbe } from "./process-port.ts";
import { nodeFileProbe } from "./process-port.ts";

/**
 * Which of the eleven step kinds this world performs.
 *
 * Written as a total map over the union rather than as a list to search, for the reason the web
 * adapter's copy records: a kind added to the register fails to typecheck here until somebody
 * decides, in this file, whether this world performs it. A list would silently skip it, and the
 * verdict would be reached in a world the criterion never acted on.
 */
const STEP_KINDS_PERFORMED: Record<StepKind, boolean> = {
  // No page, no element and no navigation.
  goto: false,
  click: false,
  reload: false,
  fill: false,
  select: false,
  press: false,
  waitFor: false,
  // No database of its own, no manifest to apply, and no request to put: the criterion's subject here
  // is what a *program* did, and a program is named by an argument vector.
  sql: false,
  apply: false,
  run: true,
  call: false,
};

/**
 * The names this world adds to the environment it hands the programs it runs.
 *
 * Declared here, once, and exported so a test can intersect this list with the names the application
 * actually reads rather than restating either one - a list recalled in a test is a claim about two
 * files that nothing reconciles.
 *
 * `root` and `app` are two different directories and conflating them is the defect this world's
 * design had to settle: the sandbox is where the application *writes*, and the application directory
 * is where its *code* lives. A program that wrote to the second would put its output into the
 * operator's source tree, and a `reset` that emptied the first could never clean it up.
 */
export const PROCESS_ENV = {
  host: "VERIDIAN_PROCESS_HOST",
  root: "VERIDIAN_PROCESS_ROOT",
  app: "VERIDIAN_PROCESS_APP",
  observe: "VERIDIAN_PROCESS_OBSERVE",
} as const;

/** The four names, in the order a reader would meet them. Derived, so it cannot omit a member. */
export const PROCESS_ENV_NAMES: readonly string[] = Object.values(PROCESS_ENV);

/** How long one `run` step may take. Exported so a test can assert the bound rather than re-type it. */
export const STEP_TIMEOUT_MS = 60_000;

/** A world with no `process` block cannot be judged by this adapter at all, and says so by name. */
export const MISSING_PROCESS_BLOCK =
  "this world declares no `process` block, and the local-process adapter judges a process boundary. " +
  "`process.host` is the identity the readings name and `process.root` is the directory this world " +
  "creates, empties and reads.";

/** A block with no root names no place to write, so there is nothing for this world to be. */
export const MISSING_ROOT =
  "this world's `process.root` is empty, so there is no directory for the application to write into " +
  "and nothing for a criterion to read. Set it to the sandbox directory this world owns - it is " +
  "resolved against the application directory.";

/**
 * Reached only by a caller that asked this adapter to start a program and then handed it none.
 *
 * A refusal has to name the cause *it* observed, so this is deliberately not the "no `process` block"
 * message: that one is about the document, and by the time `#spawn` is called the document has already
 * been read and found to have a block. Reporting the document's absence here would send a reader to
 * inspect the one thing that is present.
 */
export const MISSING_APPLICATION =
  "this world was asked to start a program, but no `process.application` was supplied. A world that " +
  "declares no application starts none, and its criteria act in it with `run` steps instead.";

/** The default cap on one stream's text, in characters. `bytes` stays the stream's real length. */
export const MAX_STREAM_CHARS = 8_000;

export interface LocalProcessEnvironmentOptions {
  /** Injectable, all of them, so a test can drive the adapter with no process and no filesystem. */
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  readonly stateDir: string;
  readonly probe?: FileProbe;
  readonly stepTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly installTimeoutMs?: number;
  readonly maxStreamChars?: number;
}

export class LocalProcessEnvironment implements EnvironmentAdapter {
  readonly kind = "local-process";

  #plan: EnvironmentPlan;
  #io: IoPort;
  #clock: Clock;
  #logger: Logger;
  #processes: ProcessRunner;
  #probe: FileProbe;
  #stepTimeoutMs: number;
  #startTimeoutMs: number;
  #installTimeoutMs: number;
  #maxStreamChars: number;
  #stateDir: string;

  #id: string | null = null;
  /** The program the world started, or `null` when it starts none. */
  #child: ProcessHandle | null = null;
  #exit: ProcessResult | null = null;
  /**
   * What this world did to the child it last started, and why.
   *
   * Recorded rather than re-derived, because the report has to describe the child **this world**
   * started. Asking the capability again at `boundaries()` time would answer a question about the
   * runtime and call it a question about the run - and on a runtime that gained the flag between the
   * two reads it would report `enforced` for a child that was started unconfined.
   */
  #confinement: ConfinementResult | null = null;
  #isolation: IsolationResult | null = null;
  /**
   * What the application this world started could see, read back off the spawn that started it.
   *
   * Held rather than recomputed, for the reason `#confinement` is: the runner decided the environment
   * before the process existed, so this is a reading of something that happened rather than a second
   * computation of the same intention. A recomputation here would be free to disagree with what the
   * child was actually handed, and the disagreement would be invisible - which is the shape this whole
   * seam exists to close.
   */
  #environment: EnvCrawl | null = null;

  constructor(plan: EnvironmentPlan, options: LocalProcessEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#probe = options.probe ?? nodeFileProbe();
    this.#stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    this.#startTimeoutMs = options.startTimeoutMs ?? 30_000;
    this.#installTimeoutMs = options.installTimeoutMs ?? 600_000;
    this.#maxStreamChars = options.maxStreamChars ?? MAX_STREAM_CHARS;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  /** The block, or a refusal naming what the document is missing. Read once, here. */
  #processWorld(): ProcessPlan {
    const block = this.#plan.process;
    if (block === null) throw new EnvironmentError(MISSING_PROCESS_BLOCK);
    if (block.root === "") throw new EnvironmentError(MISSING_ROOT);
    return block;
  }

  async create(): Promise<{ readonly id: string }> {
    // Checked before anything runs, so a document that cannot describe this world fails as a
    // definition problem naming the missing field rather than as a failure mid-run.
    const block = this.#processWorld();

    if (this.#id === null) {
      // Derived from the plan rather than counted, so the same contract yields the same environment
      // id on every run - M1 measures repeat consistency, and an id that changed per run would make
      // two runs of one contract incomparable in the bundle.
      this.#id = `local-process:${this.#plan.app.replace(/\\/g, "/")}`;
    }
    this.#warnOnShadowedEnv(block);
    await this.#rebuild(block);
    this.#logger.debug("environment.create", {
      id: this.#id,
      root: block.root,
      host: block.host,
      application: block.application === null ? null : renderArgvForLog(block.application),
    });
    return { id: this.#id };
  }

  async start(id: string): Promise<void> {
    this.#requireId(id);
    const block = this.#processWorld();
    await this.#installDependencies();
    if (block.application === null) {
      // Not an error, and the doc comment on `ProcessPlan.application` says why: a contract that
      // provisions by running commands needs no daemon at all, and requiring one would make the
      // simplest shape of this world unwritable.
      this.#logger.debug("environment.start", {
        id,
        note: "this world declares no `process.application`, so it starts no program; criteria act in it with `run` steps",
      });
      return;
    }
    this.#spawn(block.application, block);
    await this.#awaitReady(block);
  }

  /**
   * Nothing to copy into the world.
   *
   * The program under test is the user's own working tree, run in place. A `deploy` that copied files
   * would give the run a *different* tree from the one the agent edits, and then a `PASS` would be
   * evidence about a copy nobody repairs. Recorded as an explicit no-op rather than an empty body, so
   * a reader can tell "nothing to do" from "not done".
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    const block = this.#processWorld();
    this.#logger.debug("environment.deploy", {
      id,
      note: "the application runs in place from its own directory; there is nothing to deploy",
      root: block.root,
      application: block.application === null ? null : renderArgvForLog(block.application),
    });
  }

  async execute(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, true);
  }

  async observe(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, false);
  }

  /**
   * Readiness is whether the program the world started is still running.
   *
   * `ok` rather than a status code, deliberately: this world produces no HTTP status, and reporting
   * one would record a fact the world never produced in a field whose name says it is an HTTP status.
   * The manager's other readiness shape belongs to a world that has a code to compare.
   *
   * When no program was declared there is nothing to wait for and the world *is* ready - the sandbox
   * directory exists, and that is the whole of this world's start-up.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const block = this.#processWorld();
    if (block.application === null) {
      return { ok: true, statusCode: null, message: null, patternSeen: null };
    }
    const running = this.#child !== null && this.#exit === null;
    return {
      ok: running,
      statusCode: null,
      message: running
        ? null
        : `the program this world started (${renderArgvForLog(block.application)}) is not running`,
      patternSeen: this.#patternSeen(block),
    };
  }

  /**
   * No snapshotting.
   *
   * A directory cannot be photographed and put back, and the only alternative - returning a token
   * that `restore` ignores - would make a reset look like it happened when it did not. Refused by
   * name rather than silently downgraded to a restart.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    throw new EnvironmentError(noSnapshot(this.#plan.reset.strategy));
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    throw new EnvironmentError(noSnapshot(this.#plan.reset.strategy, snapshotId));
  }

  /**
   * Reset is first-class here in a way it is not in any other world: there are **two** things to
   * restore, and restoring only one of them is the defect this method exists to avoid.
   *
   * The directory is emptied and rebuilt, because a file a previous iteration's command wrote is
   * contamination a criterion would otherwise read as its own application's output. And the program
   * is killed and replaced, because everything a long-lived process holds in memory - a counter, a
   * cache, an open handle - is the same class of contamination, and there is no way to unload it
   * short of a new process. The sibling world `sim-posix` paid for the first half of this rule
   * already: a world a run inherits is not a world that run built.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") throw new EnvironmentError(noSnapshot(strategy));

    if (strategy === "custom" && command !== null) {
      const block = this.#processWorld();
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#env(block),
          onStdout: (chunk) => this.#logger.debug("reset.stdout", { chunk: chunk.trimEnd() }),
          onStderr: (chunk) => this.#logger.warn("reset.stderr", { chunk: chunk.trimEnd() }),
        },
        this.#installTimeoutMs,
      );
      if (result.timedOut || result.code !== 0) {
        // Thrown rather than absorbed: the manager turns this into a RESET_FAILURE and stops the run,
        // instead of judging the next criterion in a world whose reset silently did nothing.
        throw new EnvironmentError(
          result.timedOut
            ? `the reset command \`${command}\` did not finish within ${String(this.#installTimeoutMs)}ms`
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
        note: "a custom strategy was requested without a command; falling back to rebuilding the sandbox and restarting the program",
      });
    }

    await this.#restart();
  }

  async stop(id: string): Promise<void> {
    this.#requireId(id);
    const child = this.#child;
    this.#child = null;
    if (child !== null) {
      this.#logger.debug("environment.stop", { id, pid: child.pid });
      await child.stop();
    }
  }

  /**
   * Tear down, and nothing more.
   *
   * It deliberately leaves the sandbox directory where it is. A bundle quotes absolute paths inside
   * it, and an adapter that removed the tree on the way out would make every one of those quotes
   * unopenable - a reader following the evidence would find nothing at the address the evidence
   * names. It must equally not touch the *application* directory: that is the user's source tree.
   */
  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.stop(id);
    this.#id = null;
  }

  // ---- observation -----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    const base = {
      kind: PROCESS_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      const block = this.#processWorld();

      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a world it never acted on, which is a verdict the observation cannot justify.
      const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
      const unsupported = steps.findIndex((step) => !STEP_KINDS_PERFORMED[step.kind]);
      if (unsupported !== -1) {
        const step = steps[unsupported];
        const kind = step === undefined ? "unknown" : step.kind;
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "VALIDATOR_ERROR",
            `the local-process adapter performs \`run\` steps and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${kind}\` - this world judges what a program did, so a ` +
              "criterion about a page, a database, a manifest or a request belongs to the world whose " +
              "adapter performs it",
          ),
        };
      }

      const commands: ProcessCommandRecord[] = [];
      // `observe()` does not act, so it reports the commands it was given without running them - and
      // that is a real distinction rather than a technicality: a command that appends to a file would
      // otherwise be run a second time by the re-observation that decides whether a repair worked.
      if (act) {
        for (const step of steps) {
          if (step.kind !== "run") continue;
          const outcome = await this.#run(step.argv, block, request.criterionId);
          if ("error" in outcome) return { ...base, data: null, artifacts: [], error: outcome.error };
          commands.push(outcome.record);
        }
      }

      const files = await this.#readTargets(request.targets, block);

      const data: ProcessObservationData = {
        host: block.host,
        // The world's own spelling of its root, and not the host path the plan holds: the plan's
        // `root` is resolved against `appPath`, so it is absolute or cwd-relative **depending on how
        // the operator spelled `--goal`** - a criterion comparing it would be judging the command
        // line rather than the world. See `#declaredRoot` for the measurement that settled it.
        root: this.#declaredRoot(block),
        application: this.#readApplication(block),
        commands,
        files,
        // The fourth dimension, read back off the spawn rather than recomputed from the document. A
        // world that started no child reports `null`, which is a reading rather than a hole.
        environment: this.#environment,
      };

      const relativeRunDir = bundleLayout(this.#stateDir, request.runId).runDir;
      const artifacts = await this.#captureEvidence(request, data, relativeRunDir);
      return { ...base, data, artifacts, error: null };
    } catch (error) {
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", describe(error)) };
    }
  }

  /**
   * Run one argument vector as the criterion's own action.
   *
   * `cwd` is the **application directory**, not the sandbox, and the sandbox is reached through
   * `PROCESS_ENV.root`. That is not an accident of convenience: an argument vector is resolved by the
   * operating system, so a program named relatively in `argv` is looked up against the working
   * directory - and a sandbox that started empty would have nothing to look up. The application's own
   * directory is where its code is; the sandbox is where its output goes, and the environment this
   * world adds is how a program is told the difference.
   */
  async #run(
    argv: readonly string[],
    block: ProcessPlan,
    criterionId: string,
  ): Promise<{ readonly record: ProcessCommandRecord } | { readonly error: NonNullable<Observation["error"]> }> {
    const command = argv[0] ?? "";
    if (command === "") {
      return {
        error: failure(
          "APPLICATION_ERROR",
          `a \`run\` step in ${criterionId} carried an empty argv, so there is no program to run. ` +
            "A `run` step is an argument vector whose first element names the program.",
        ),
      };
    }

    const args = argv.slice(1);
    // A `run` step is confined by the same allowance as the application, and this line is the fix to a
    // gap that had no example to expose it until one asked a `run` step to stop at a boundary. See
    // `#allowance` for the measurement that made extending it safe and for what it cost to discover.
    //
    // `allowChildProcess` is set here and not for the application, on the measurement recorded there: a
    // confined child cannot start children of its own, and a provisioning step that legitimately does
    // is a program this world has always run. Refusing it would be a *new* boundary rather than this
    // one, and no document here claims it.
    const confinement = { ...this.#allowance(block), allowChildProcess: true };
    this.#logger.debug("process.run", {
      criterionId,
      command,
      args,
      cwd: this.#plan.appPath,
      // The allowance is logged beside the command it applies to, on the same reasoning `#spawn`
      // records it beside the child it starts: two events could otherwise disagree about whether this
      // world confined the program it ran.
      readRoots: confinement.readRoots,
      writeRoots: confinement.writeRoots,
      allowChildProcess: confinement.allowChildProcess,
    });
    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#env(block),
        confinement: { ...this.#allowance(block), allowChildProcess: true },
        onStdout: (chunk) => this.#logger.debug("run.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("run.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#stepTimeoutMs,
    );

    // The one shape `ProcessResult` uses for "this never became a process": no code, no signal, and
    // not a deadline. Named here because the adapter is the only layer that observed the run, and a
    // reader of the `exitcode` criterion's failure would otherwise see a missing exit code with no
    // hint that the program was never found.
    if (result.code === null && result.signal === null && !result.timedOut) {
      this.#logger.warn("process.run", {
        criterionId,
        command,
        note: "the command produced no exit code and no signal, which is how a spawn failure is reported; the runner's own message is in the command's stderr",
      });
    }

    return { record: this.#record(argv, result) };
  }

  /**
   * The files a criterion judges.
   *
   * Derived from `request.targets` rather than from the steps, because the steps name what a criterion
   * *acts on* and the targets name what it *judges* - the same distinction the plan's own doc comment
   * records for the browser world, and the reason a criterion may judge a file nothing ever touched.
   *
   * A target that is a command selector (`app`, or a position counted from one) is skipped: it is a
   * question about a command, and commands are already in the reading. A target that is a path is
   * normalised by `processPath`, which refuses anything that leaves the root; a refused target is
   * simply not read, and the validator that asked about it says why. It is deliberately **not**
   * recorded as a boundary crossing - only the application's escapes are crossings, and a criterion's
   * spelling of a path is not the application.
   */
  async #readTargets(
    targets: readonly string[],
    block: ProcessPlan,
  ): Promise<readonly ProcessFileReading[]> {
    const files: ProcessFileReading[] = [];
    const seen = new Set<string>();
    for (const target of targets) {
      if (commandSelectorOf(target).ok) continue;
      const path = processPath(target);
      if (path === null || seen.has(path)) continue;
      seen.add(path);
      // The same resolved root the application was handed, so the file a criterion reads is read
      // through one path and not two: a reading taken through a second resolution of one place could
      // describe a directory the program never wrote into, and it would describe it in the same words.
      files.push(await this.#probe.read({ root: this.#hostRoot(block), path }));
    }
    return files;
  }

  /**
   * The program the world started, as far as a reading can see it.
   *
   * Bounded, because a criterion's reading has to stay readable and a program that logs a line a
   * second would otherwise put a megabyte into every bundle. The tail is kept rather than the head:
   * a failure states its cause last, which is the same reason the repair note keeps its tail.
   */
  #readApplication(block: ProcessPlan): ProcessCommandRecord | null {
    const application = block.application;
    if (application === null) return null;

    const child = this.#child;
    const exit = this.#exit;
    const state: ProcessCommandState =
      child === null
        ? "exited"
        : exit === null
          ? "running"
          : exit.signal === null
            ? "exited"
            : "signalled";

    return {
      argv: [application.command, ...application.args],
      cwd: this.#plan.appPath,
      state,
      exitCode: exit === null ? null : exit.code,
      signal: exit === null ? null : exit.signal,
      timedOutAfterMs: null,
      stdout: this.#stream(child !== null ? child.output() : (exit?.stdout ?? "")),
      stderr: this.#stream(child !== null ? child.error() : (exit?.stderr ?? "")),
    };
  }

  /** One command's outcome, as the vocabulary records it. */
  #record(argv: readonly string[], result: ProcessResult): ProcessCommandRecord {
    // A deadline is its own state, and it outranks a signal: a process killed *because* its clock ran
    // out is a fact about the clock, and a reader whose report said "ended by SIGTERM" would go
    // looking for whatever sent the signal instead of at the command that hung.
    const state: ProcessCommandState = result.timedOut
      ? "timed-out"
      : result.signal === null
        ? "exited"
        : "signalled";
    return {
      argv: [...argv],
      cwd: this.#plan.appPath,
      state,
      // Null when the deadline hit, and that is the point rather than a gap: an exit code exists only
      // for a process that exited, and a code observed after a kill is the kill's artefact. The
      // `process.exitcode` validator reports a `FAIL` on the null, which is what a criterion written
      // as "this command exits zero" deserves from a command that never exited.
      exitCode: result.timedOut ? null : result.code,
      signal: result.signal,
      timedOutAfterMs: result.timedOut ? this.#stepTimeoutMs : null,
      stdout: this.#stream(result.stdout),
      stderr: this.#stream(result.stderr),
    };
  }

  /** Bound one stream, keeping the tail. `bytes` is what the stream produced, never `text.length`. */
  #stream(text: string): ProcessStreamReading {
    const bytes = Buffer.byteLength(text, "utf8");
    if (text.length <= this.#maxStreamChars) return { text, bytes, truncated: false };
    return { text: text.slice(-this.#maxStreamChars), bytes, truncated: true };
  }

  /**
   * What this world did about the plan's boundaries - read back off the child it actually started.
   *
   * Both halves are derived from `#confinement`, which is what the **runner** answered when `#spawn`
   * handed it an allowance - not from a literal written here, and no longer from a decision this file
   * made itself. The distinction matters in both directions. A literal `"unsupported"` was correct
   * until the permission model could be applied and is now an under-claim: the runtime really refuses
   * a write outside the allowance, and a report saying it does not is as wrong as one saying it does
   * when it does not. A literal `"enforced"` would be the opposite over-claim, and it is the one this
   * design exists to avoid - this world confines the child only when the interpreter enforces the
   * flag, only when the command is a Node interpreter, and only after the runner has actually done it.
   * Before the first spawn there is no child and therefore nothing held, which is `"unsupported"` and
   * not a claim about a run.
   *
   * `network` is `"unenforceable"` rather than `"unsupported"`, and the difference is a measurement
   * rather than a preference: `node --allow-net` does not exist (`bad option`, exit 9), while
   * `--permission` on the same runtime is accepted (exit 0). So there is no flag that could hold this
   * boundary, and saying `unsupported` would leave a reader unable to tell "nobody wrote the code yet"
   * from "no code could". The child can still open any socket the operator can.
   *
   * `crossings` stays empty by construction. Nothing here observes one: a confinement refusal is
   * reported to the *application* as `ERR_ACCESS_DENIED` on its own stream, and reading it as the
   * application escaping would be a claim this world cannot support - it never sees the attempt, only
   * the refusal the runtime handed back. A target spelling that leaves the root is refused by
   * `processPath` and reported by the validator that asked, which is a criterion defect and not the
   * application's escape.
   *
   * **Only the application child is confined, and that is a decision rather than an omission.** A
   * criterion's own `run` step carries an argv the contract's *operator* wrote; the application's code
   * is what the agent wrote. Those are two actors, and one word - `filesystemWrite` - cannot describe
   * both, so the allowance goes on the child whose author Veridian does not control. A `run` step
   * therefore starts as declared, exactly as it did before this seam existed.
   */
  boundaries(): BoundaryReport {
    // The substrate, when one held the child. Read back off the same spawn `#confinement` came from,
    // so the two mechanisms cannot disagree about which one ran: a world that reported an enforced
    // network boundary *and* no substrate would be claiming a flag that does not exist.
    const held = this.#isolation;
    const substrate = held?.applied === true ? held.substrate : null;
    // Severed is a separate question from held, and it is the one this field is about. A substrate
    // that applied with the runtime's default network holds a filesystem boundary and no network one,
    // so reporting `enforced` here would be the declaration-as-enforcement defect this file's own
    // header warns about - in the one place the language made it easy to commit.
    const severed = held?.applied === true && held.denyNetwork;
    return {
      network: severed
        ? "enforced"
        : this.#plan.boundary.network === "allow"
          ? "not-requested"
          : "unenforceable",
      filesystemWrite:
        substrate !== null || this.#confinement?.applied === true ? "enforced" : "unsupported",
      substrate,
      crossings: [],
      // The fourth dimension, reported on the same record as the other three so a bundle answers
      // *what could this application see* from one place. `null` when no child was started: the
      // question has no answer then, and an empty crawl would be an answer nobody measured.
      environment: this.#environment,
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). This world produces
   * no screenshot and no trace, so a criterion that declares one of those gets the missing-evidence
   * guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a `PASS` on evidence
   * that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: ProcessObservationData,
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

    // The commands on their own, because this is the artifact a human reads when a process criterion
    // fails: every argument vector and every outcome, in order, without the file readings around them.
    if (data.commands.length > 0) {
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.commands.json`,
        "json",
        `${JSON.stringify(data.commands, null, 2)}\n`,
      );
    }

    // The program's own two streams as text, because they are the one part of what a process did that
    // no structured reading carries faithfully - a stack trace survives JSON, but it survives as a
    // JSON string with its newlines escaped, and a human reading a failure wants the lines.
    if (data.application !== null) {
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.application.log`,
        "log",
        `${data.application.stdout.text}\n--- stderr ---\n${data.application.stderr.text}\n`,
      );
    }

    // The kinds this call did *not* write are the only ones worth a warning, and the set is read off
    // the artifacts rather than from a literal list beside them. The literal was here first in the
    // sibling adapters and it was wrong in the one direction that matters: it warned for `json` while
    // holding a `json` artifact written two lines above, so every criterion reported "produces `json`
    // and cannot produce `json`" - a sentence that contradicts itself, and a reader who learns to skip
    // those lines has learned to skip the one that is true.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the local-process adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- process ---------------------------------------------------------------------------------

  /**
   * The sandbox as a path **this machine** opens it by - which is the value a program is handed.
   *
   * Resolved through the io port rather than used as the document spells it, and the difference was
   * measured rather than reasoned. A `run` step's `cwd` is the *application* directory, so a relative
   * root handed to the program is resolved a **second** time against that directory by whatever the
   * program does with it. This world's own demo found it: `cart-build.mjs` joins
   * `VERIDIAN_PROCESS_ROOT` onto `dist`, and the sandbox was read as
   * `app/examples/local-process/app/sandbox` - a path that cannot exist - so a criterion about the
   * build's own output reported a missing directory for a build that had written one, and the run
   * failed for a reason no criterion could name.
   *
   * `core/environment/load.ts` has already resolved the document's `root` against the application
   * directory, which leaves it relative to the **io root**. Resolving it a second time against
   * `appPath` would produce exactly the doubling above; the io port's own `resolve` is the one that
   * knows where its root is, and this is the same move every sibling world makes.
   *
   * This is the accession, and it is the **only** reader of `block.root` that produces a path this
   * machine opens. {@link #declaredRoot} reads the same field for the opposite purpose.
   */
  #hostRoot(block: ProcessPlan): string {
    return this.#io.resolve(block.root);
  }

  /**
   * The observed directories as paths **this machine** opens them by.
   *
   * The same accession {@link #hostRoot} performs, applied member by member, and for exactly the same
   * reason: the loader resolved each entry against the application directory, which leaves it relative
   * to the io root, and handing that spelling to a program that then resolves it against its own
   * working directory produces a path that cannot exist. The sandbox paid for that defect once
   * (`app/examples/local-process/app/sandbox`), and a second field read the other way would be the
   * same defect in a new place.
   *
   * One reader, used by both the allowance and the environment - so the directories the runtime permits
   * and the directories the program is told it may read cannot disagree. A second resolution at the
   * other call site is how two lists of the same thing start to differ.
   */
  #observeRoots(block: ProcessPlan): readonly string[] {
    return block.observe.map((entry) => this.#io.resolve(entry));
  }

  /**
   * The allowance **every** child of this world is started under, from one definition.
   *
   * ## Why this became a method, and the gap that made it one
   *
   * Until this existed, `#spawn` built the allowance inline and `#run` built none at all - so the
   * long-lived application was confined and **every `run` step was not**. That is worth stating plainly
   * because of what it meant: `run` is the step kind by which six worlds provision, and a provisioning
   * step that could write wherever the operator can is a world whose `PASS` means less than the
   * sentence beside it claimed. Nothing had noticed, because no example had ever asked a `run` step to
   * do something the boundary would have refused.
   *
   * The first thing to ask a `run` step to *stop* at found it. `workspace-audit`'s whole premise is
   * that an audit of a real tree cannot write into it, and its audit runs as a `run` step - so the
   * reading came back `breached`, which is the correct answer to a question the world was not asking.
   * That is the discipline this repository keeps paying for: **a claim in a document is not a
   * measurement of the code, and the way to find out is to ask the code a question only the claim
   * makes interesting.**
   *
   * Two things were measured before the allowance was extended, because both could have made it
   * unsafe rather than merely unbuilt:
   *
   *   - `--allow-fs-read=<dir>` does **not** imply permission to write in it. A child given a
   *     directory as a read root and not as a write root was answered `ERR_ACCESS_DENIED` on write,
   *     which is the whole premise `process.observe` rests on.
   *   - A confined child **cannot** start children of its own unless `--allow-child-process` is given -
   *     `node:internal/child_process` and exit 1, with `--permission` alone. So `allowChildProcess` is
   *     set on `run` steps deliberately: turning it off would have been a *new* boundary, one no
   *     document here claims, and it would have broken the one program in the tree that legitimately
   *     starts children. With the flag, the outside write is still `ERR_ACCESS_DENIED`.
   *
   * The application is left without `allowChildProcess`, unchanged: it has never needed to start
   * children, and widening what it may do is not what fixing this gap is for.
   *
   * One definition rather than two call sites composing the same list, so the directories the runtime
   * permits and the directories a reader is told about cannot drift - which is the failure a second
   * copy of an allowance always eventually is.
   */
  #allowance(block: ProcessPlan): {
    readonly readRoots: readonly string[];
    readonly writeRoots: readonly string[];
    readonly environment: EnvMode;
  } {
    const hostRoot = this.#hostRoot(block);
    // `readRoots` names three kinds of directory because they are three - the program file is opened
    // from the application directory, everything a criterion reads is opened from the sandbox, and the
    // observation surface is whatever the operator declared. A read allowance naming only the sandbox
    // would refuse to load the program it was asked to confine. The observation surface is added to
    // the read allowance and to nothing else, which is the whole mechanism of read-only: the same
    // runner that refuses a write outside the sandbox refuses a write into an observed tree, so the
    // guarantee is held by the runtime rather than by a comment. The order is the plan's, so a bundle's
    // own record of `observe` and the allowance applied here cannot disagree about which were named.
    //
    // `environment` rides here rather than at the two call sites, and that is the same argument one
    // dimension over: the application and every `run` step must be judged in the same environment, and
    // a policy applied at two call sites is a policy that can be applied at one of them. It is carried
    // through the allowance so the two cannot disagree - the failure mode being a world that declares
    // its application's environment and silently hands every provisioner the operator's shell.
    return {
      readRoots: this.#withoutNested([
        this.#plan.appPath,
        hostRoot,
        ...this.#observeRoots(block),
      ]),
      writeRoots: [hostRoot],
      environment: block.environment,
    };
  }

  /**
   * The read allowance with every member that is already inside another member removed.
   *
   * ## Why the longest list is not the widest allowance
   *
   * `--allow-fs-read=A --allow-fs-read=A/B` is **not** the union of the two, on Node 22.18 on Windows.
   * Under that pair, every operation on `A` itself - `stat`, `lstat`, `readdir`, `access` - answers
   * `ERR_ACCESS_DENIED`, while `realpath` on `A` and any read of a *descendant* of `A` still succeed.
   * Measured four ways, because the first reading looked like a mistake:
   *
   *   `A` alone                          stat/readdir/access on `A`  **OK**
   *   `A` plus a disjoint `B`            stat/readdir/access on `A`  **OK**
   *   `A` plus `A/B` (the pair here)     stat/readdir/access on `A`  **ERR_ACCESS_DENIED**
   *   `A/B` alone                        stat/readdir/access on `A/B` **OK**
   *
   * So it is *nesting* that breaks the ancestor rather than multiplicity, and the failure is confined
   * to the ancestor's own directory operations - which is precisely the shape a program cannot work
   * around, because there is no other way to list a directory than to ask the directory.
   *
   * ## What this had been costing, and why nothing noticed
   *
   * This world has always passed a nested pair: the sandbox lives inside the application directory, so
   * `stat(appPath)` and `readdir(appPath)` have been denied in **every** run of every world since the
   * allowance was introduced. It was invisible because no program had ever listed the directory it was
   * started from, and a program that only opens files inside it never touches the broken half.
   *
   * `workspace-audit` is the first subject whose *whole purpose* is to describe a directory tree, and it
   * is pointed at a tree that contains the application directory - so the ancestor it must list is
   * exactly the one the nesting breaks. Asking a new question of an old allowance is how a latent
   * defect stops being latent, which is the same shape as the `run`-step gap fixed above.
   *
   * ## Why removing a member is safe rather than a widening
   *
   * A member that is inside another member adds no path the other does not already cover, so the union
   * of the list is unchanged - and the union is the only thing the allowance means. What changes is the
   * *bookkeeping* the runtime does with overlapping grants, and it changes in the direction of granting
   * exactly what was declared: before, the declared tree could be read but not listed; after, it can be
   * both. Nothing outside any declared root becomes reachable, in either direction.
   *
   * Comparison is on the normalised form - separators unified, trailing separator dropped, case folded -
   * because two spellings of one directory are one directory, and a Windows path is compared
   * case-insensitively by the filesystem itself. Order is preserved so the list a reader sees is the
   * order the document declared, minus the members that were redundant.
   */
  #withoutNested(roots: readonly string[]): readonly string[] {
    const normal = (value: string): string =>
      value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      if (root === "") continue;
      const key = normal(root);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(root);
    }

    // A member survives only when no *other* member is a proper ancestor of it.
    return unique.filter((root) => {
      const key = normal(root);
      return !unique.some((other) => {
        const outer = normal(other);
        return outer !== key && key.startsWith(`${outer}/`);
      });
    });
  }

  /**
   * The root as the world's own document declared it, spelled relative to the application directory.
   *
   * ## Why the reading does not carry a host path
   *
   * `block.root` is *already resolved* - `core/environment/load.ts` resolves every path a document
   * declares against that document's own base, and for this world the base is `appPath`. So the
   * field holds an absolute path when the operator wrote an absolute `--goal` and a cwd-relative one
   * when they wrote a relative one, which makes it a fact about the **command line** rather than
   * about the sandbox. A criterion that compared it would pass or fail on how the goal was spelled,
   * and that is not a hypothesis here - it was measured:
   *
   * ```
   * --goal examples/local-process/goal.yaml        -> exit 0, PASS, AC-001..AC-009 all PASS
   * --goal D:\all_projects\...\local-process\...   -> exit 1, FAIL, AC-001 alone, quoting
   *   "cart-builder (root D:/all_projects/Veridian/examples/local-process/app/sandbox)"
   * ```
   *
   * Same contract, same program, same machine; one variable changed. `renderHost` interpolates this
   * field into the string `process.host` compares, and a rendering helper is part of a validator
   * family's contract surface, so the fix belongs in what the reading records rather than in what
   * the validator reads.
   *
   * The stable spelling is the declaration's own, relative to the application directory - the same
   * move the `sim-os` reading makes when it records the world's own spelling of a root beside the
   * host path that world also declares. Nothing is lost: `#hostRoot` remains the single resolver for
   * every consumer that has to open the path, and the daemon prints the host path itself.
   *
   * `relative` returns an absolute path only when the two roots do not share a base (a different
   * Windows drive), which can only happen when the document declared an absolute root - and an
   * absolute declaration is the same string on every machine anyway.
   */
  #declaredRoot(block: ProcessPlan): string {
    const spelled = relative(this.#plan.appPath, this.#hostRoot(block)).replaceAll("\\", "/");
    return spelled === "" ? "." : spelled;
  }

  /**
   * The environment a program this world runs is given.
   *
   * The plan's own `env` first and this world's three names after it, so the world's own facts win.
   * The reverse order would let a document declare `VERIDIAN_PROCESS_ROOT` to some other directory
   * and have the application write there while the criteria read here - a run that reports a missing
   * output for a program that wrote it.
   */
  #env(block: ProcessPlan): Readonly<Record<string, string>> {
    return {
      ...this.#plan.env,
      [PROCESS_ENV.host]: block.host,
      [PROCESS_ENV.root]: this.#hostRoot(block),
      [PROCESS_ENV.app]: this.#plan.appPath,
      // Joined with the platform's own list separator rather than a comma, because these are paths and
      // a comma is a legal character in one. The program therefore splits on `delimiter` and needs no
      // quoting rule of its own. Empty when the document observed nothing, which is the ordinary case
      // and the one a program can test for with a single truthiness check.
      [PROCESS_ENV.observe]: this.#observeRoots(block).join(delimiter),
    };
  }

  /** A document that declares one of this world's own names is told which value the world will use. */
  #warnOnShadowedEnv(block: ProcessPlan): void {
    const mine = this.#env(block);
    for (const name of PROCESS_ENV_NAMES) {
      const declared = this.#plan.env[name];
      if (declared === undefined || declared === mine[name]) continue;
      this.#logger.warn("environment.env", {
        name,
        declared,
        used: mine[name],
        note: "this name is how the world tells a program where its sandbox is, so the world's own value is the one used",
      });
    }
  }

  async #installDependencies(): Promise<void> {
    const command = this.#plan.dependencyInstall;
    if (command === null) return;

    this.#logger.info("environment.install", { command, cwd: this.#plan.appPath });
    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args: [],
        cwd: this.#plan.appPath,
        env: this.#plan.env,
        onStderr: (chunk) => this.#logger.debug("install.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#installTimeoutMs,
    );

    if (result.timedOut) {
      throw new EnvironmentError(
        `dependency installation (\`${command}\`) did not finish within ${String(this.#installTimeoutMs)}ms`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `dependency installation (\`${command}\`) exited with code ${String(result.code)}: ${tail(result.stderr)}`,
      );
    }
  }

  /**
   * Empty the sandbox and put it back.
   *
   * One implementation, called by `create()` and by `#restart()`, because those two are the same
   * question asked twice - "make this world a world nothing has happened in yet" - and two copies of
   * that answer disagree the first time a run arrives that only one of them was written for. That is
   * not a hypothetical: the `sim-posix` world shipped a `prepare()` that made directories without
   * clearing them, and its criteria reported `PASS` on files a *previous* run had written.
   *
   * Removal is recursive rather than a walk of known names, because the world does not know what the
   * application writes - discovering that is the point of the world.
   */
  async #rebuild(block: ProcessPlan): Promise<void> {
    await this.#io.remove(block.root);
    await this.#io.mkdirp(block.root);
    // Both spellings of one place, on purpose. `root` is the document's own value - what a reader
    // comparing this log with their `environment.yaml` is holding - and `hostRoot` is the path this
    // machine opens and the program is handed. A log with only the first cannot answer "where did
    // this world actually live"; a log with only the second cannot be compared with the document.
    this.#logger.debug("process.rebuild", {
      root: block.root,
      hostRoot: this.#hostRoot(block),
      host: block.host,
    });
  }

  #spawn(
    application: { readonly command: string; readonly args: readonly string[] } | null,
    block: ProcessPlan,
  ): ProcessHandle {
    if (application === null) throw new EnvironmentError(MISSING_APPLICATION);
    // The allowance is a value; applying it is `core/process.ts`'s job. It comes from `#allowance` so
    // that this child and every `run` step are started under the same one.
    const hostRoot = this.#hostRoot(block);
    const handle = this.#processes.run({
      command: application.command,
      args: application.args,
      cwd: this.#plan.appPath,
      env: this.#env(block),
      // Stated as `this.#allowance(block)` rather than through a local, so the field carries a value
      // the same way `sim-mobile`'s does. That is not a style preference: `tests/boundary-roster.test.ts`
      // decides which worlds hand the runner an allowance by the *spelling* at this field, and a local
      // const named anything at all is a third spelling the guard does not know - which it refused, by
      // name, the first time this was written any other way.
      confinement: this.#allowance(block),
      // The substrate is requested only when the document asked for one, and the same allowances are
      // offered to it as to the interpreter: the two mechanisms hold the same boundary by different
      // means, and a substrate given a different allowance would be a second, quieter policy.
      ...(block.isolation === null
        ? {}
        : {
            isolation: {
              readRoots: this.#allowance(block).readRoots,
              writeRoots: this.#allowance(block).writeRoots,
              denyNetwork: block.isolation.denyNetwork,
            },
          }),
      // Output is read back through `handle.output()`, which is the single source for the text; these
      // callbacks exist so a long run is visible while it is happening rather than only in the bundle.
      onStdout: (chunk) => this.#logger.debug("app.stdout", { chunk: chunk.trimEnd() }),
      onStderr: (chunk) => this.#logger.warn("app.stderr", { chunk: chunk.trimEnd() }),
    });
    // Read back rather than recomputed: the runner decided before the process existed, so this is
    // available synchronously and is a reading of something that happened.
    const confinement = handle.confinement ?? null;
    this.#confinement = confinement;
    const isolation = handle.isolation ?? null;
    this.#isolation = isolation;
    // Read back off the same handle, for the same reason: the runner computed the environment it
    // handed the child, and this is that map rather than a reconstruction of it.
    this.#environment = handle.environment ?? null;
    this.#logger.info("environment.start", {
      command: application.command,
      args: application.args,
      cwd: this.#plan.appPath,
      root: block.root,
      // The path the program is actually handed. Logged beside the document's spelling rather than
      // instead of it, for the reason `process.rebuild` records below: they are two readings of one
      // fact and only one of them is a path this machine can open.
      hostRoot,
      // What was done to the child, on the same line as the child being started, because two events
      // could otherwise disagree about whether this world confined the program it started.
      confined: confinement?.applied === true,
      confinement: confinement === null ? "no allowance was requested" : confinement.reason,
      // Which mechanism held it, or why the one that was asked for did not. Both are recorded even
      // when the other is `null`, because "the document asked for no substrate" and "a substrate was
      // asked for and this machine could not supply one" are different runs and the reading is where
      // they are told apart - `environment.json` records only whether one held.
      isolated: isolation?.applied === true,
      isolation: isolation === null ? "the document asked for no substrate" : isolation.reason,
    });
    this.#child = handle;
    this.#exit = null;
    // Guarded, because a previous child's exit can be delivered *after* this one is published, and
    // unguarded `#exit` would hold a dead child's result while `#child` held the live one. `probe()`
    // reads both, so it would report a running world as stopped and the manager's poll would never
    // see it ready: the run aborting with `never became ready` is a cause this world had not
    // observed. That failure was seen here four times in one afternoon before the cause was found.
    //
    // The window this closes was real and was measured, not imagined: `core/process.ts`'s `stop()`
    // awaited `exited` on POSIX but returned as soon as `taskkill` closed on Windows, so the old
    // handle could settle during the rebuild that follows. **That asymmetry is fixed** - both
    // branches now wait for the child to be gone - and `tests/process.test.ts` holds that reading
    // directly. The guard stays anyway: it costs one comparison, it makes the invariant local to the
    // two fields it protects instead of resting on a distant file, and this world is the one whose
    // child is a *program* rather than a server, so it exits on its own as often as it is stopped.
    void handle.exited.then((result) => {
      if (this.#child !== handle) return;
      this.#exit = result;
    });
    return handle;
  }

  /**
   * Wait for the program to say it is ready.
   *
   * Spawning a process is not starting a service: the parent returns immediately and a program that
   * provisions before it reports anything has not provisioned yet. The readiness pattern is the
   * application's own signal that it got there, and without it every criterion would race the boot and
   * the run would be flaky for reasons the report could not explain. When no pattern was declared
   * there is nothing to wait for here - the manager's health check is the only gate, and it is a real
   * one.
   */
  async #awaitReady(block: ProcessPlan): Promise<void> {
    const pattern = this.#plan.start.readyPattern;
    const child = this.#child;
    if (pattern === null || child === null) return;

    const seen = await child.waitForPattern(pattern, this.#startTimeoutMs);
    if (seen) return;

    const exit = this.#exit;
    throw new EnvironmentError(
      exit === null
        ? `the program did not print /${pattern}/ within ${String(this.#startTimeoutMs)}ms. Output so far: ${tail(child.output())}`
        : `the program exited with code ${String(exit.code)}${exit.signal === null ? "" : ` (signal ${exit.signal})`} before printing /${pattern}/. stderr: ${tail(child.error())}`,
    );
  }

  /**
   * Kill the program, rebuild the sandbox, and put a new one in its place.
   *
   * The order matters and is the reason this is one method rather than three statements in `reset()`:
   * the program is stopped *before* the directory is emptied, because a running application can write
   * into a directory while it is being removed and would then be judged against a tree it is still
   * mutating. A world that emptied first and killed afterwards would have a race whose symptom is a
   * file that sometimes exists.
   */
  async #restart(): Promise<void> {
    const block = this.#processWorld();
    const child = this.#child;
    this.#child = null;
    this.#exit = null;
    if (child !== null) await child.stop();

    await this.#rebuild(block);

    if (block.application === null) {
      this.#logger.debug("environment.reset", {
        id: this.#id,
        strategy: "restart",
        note: "the sandbox was rebuilt; this world starts no program, so there was none to restart",
      });
      return;
    }

    const spawned = this.#spawn(block.application, block);
    await this.#awaitReady(block);
    this.#logger.debug("environment.reset", { id: this.#id, strategy: "restart", pid: spawned.pid });
  }

  /** `null` when the adapter has no stdout signal to offer - never `false`, which would read as "not ready". */
  #patternSeen(block: ProcessPlan): boolean | null {
    const pattern = this.#plan.start.readyPattern;
    const child = this.#child;
    if (pattern === null || child === null || block.application === null) return null;
    try {
      return new RegExp(pattern).test(child.output());
    } catch (error) {
      this.#logger.warn("environment.probe", { pattern, error: describe(error) });
      return null;
    }
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment has not been created; call create() first");
    }
    if (this.#id !== id) {
      // A manager driving two environments, or a stale handle. Cheap to catch, and catching it beats
      // watching one process's output appear in another's evidence.
      throw new EnvironmentError(`this environment is \`${this.#id}\`, but it was addressed as \`${id}\``);
    }
  }
}

/** An argument vector as one log field, with a word containing a space quoted so it stays readable. */
function renderArgvForLog(application: { readonly command: string; readonly args: readonly string[] }): string {
  return [application.command, ...application.args]
    .map((word) => (word.includes(" ") ? `"${word}"` : word))
    .join(" ");
}

function noSnapshot(strategy: string, snapshotId?: string): string {
  const subject = snapshotId === undefined ? "a snapshot" : `snapshot \`${snapshotId}\``;
  return (
    `the local-process adapter cannot restore ${subject}: it runs a program and reads the files that ` +
    `program wrote, and a directory cannot be photographed and put back. reset.strategy is \`${strategy}\`, which asks for exactly that. ` +
    "Use `restart`, which is a real reset - the sandbox is emptied, rebuilt, and the program is replaced " +
    "by a new one with none of the previous run's memory in it - rather than a reset in name only."
  );
}

/** The last `limit` characters, with a marker so a reader knows something was dropped. */
function tail(text: string, limit = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `...${flat.slice(-limit)}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
