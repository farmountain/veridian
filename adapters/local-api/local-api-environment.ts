/**
 * The API world: a local HTTP service, driven through requests the criterion makes itself.
 *
 * ## What makes this a different world from `local-web`
 *
 * Both start a local process and both health-check a URL, and that is where the resemblance ends.
 * The web adapter *observes through a browser*: it drives a page and reads a rendered document, so
 * the criterion's steps describe a user's actions and the reading describes what a user would see.
 * This adapter *observes through the service's own interface*: the criterion's steps are requests,
 * and the reading is what the service answered. The two worlds disagree about what a step means, and
 * that is the whole reason a contract has to name a world - a `call` step put to a page and a `call`
 * step put to a router are not the same act, and a criterion written for one is not portable to the
 * other in either direction.
 *
 * ## What it is not
 *
 * It is not a service framework, not a router, not a client library and not an OpenAPI validator. It
 * starts whatever the document's `start` command names, sends whatever requests the contract states,
 * and writes down whatever came back. It never decides whether an answer is *correct* - that is the
 * validator's job, and this adapter does not import one.
 *
 * ## Why a request is the reading rather than a side effect of one
 *
 * Every other local world watches the application do something. Here the criterion does the
 * something: it names a method and a path, and the answer to *that request* is the observable. This
 * is why `call` is the only step kind this adapter performs - a `goto` or a `click` describes a page
 * interaction that has no meaning against a router, and `apply`/`run`/`sql` belong to worlds whose
 * application is provisioned *by* the criterion rather than brought up by the environment.
 *
 * ## The boundary it can actually hold
 *
 * Unlike the browser world, this adapter builds every request URL itself, so it can refuse one that
 * leaves the service's origin - and it does, naming the boundary the goal declared. That makes the
 * network policy `enforced` here rather than `unsupported`, and the claim is only made once a guard
 * exists that a request has really passed through.
 *
 * `filesystemWrite` used to be `unsupported` here, on the true sentence that the application runs as
 * an ordinary child process with the operator's own privileges. That sentence stopped being true when
 * `core/environment/confinement.ts` landed: the service is now started through `confineChild`, so the
 * boundary is real when the mechanism is available and honestly `unsupported` when it is not - and
 * the report is read off the confinement `#spawn` actually got rather than declared beside it.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { CallMethod, StepKind } from "../../core/acceptance/steps.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import type {
  ApiExchange,
  ApiObservationData,
  ApiProcessReading,
} from "../../core/environment/api-observation.ts";
import { API_OBSERVATION_KIND } from "../../core/environment/api-observation.ts";
import { confineChild, type ConfinementResult } from "../../core/environment/confinement.ts";
import { probeUrl } from "../../core/environment/load.ts";
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
import type { ProcessHandle, ProcessRunner } from "../../core/process.ts";
import { runToCompletion } from "../../core/process.ts";
import type { ApiClient } from "./api-port.ts";
import { nodeApiClient } from "./api-port.ts";

/**
 * Which of the eleven step kinds this world performs.
 *
 * Written as a total map over the union rather than as a list to search, for the reason the web
 * adapter's copy records: a kind added to the register fails to typecheck here until somebody
 * decides, in this file, whether this world performs it. A list would silently skip it, and the
 * verdict would be reached in a world the criterion never acted on.
 */
const STEP_KINDS_PERFORMED: Record<StepKind, boolean> = {
  // A router has no page, no element and no navigation.
  goto: false,
  click: false,
  reload: false,
  fill: false,
  select: false,
  press: false,
  waitFor: false,
  // No database of its own, no manifest to apply, and no command vector: the criterion's subject
  // here is a request, not a provisioned artifact.
  sql: false,
  apply: false,
  run: false,
  // The one this world is for. Kept apart from `run` on purpose: `run` provisions, `call` asks.
  call: true,
};

/** A world with no address is not this world. Named so the refusal says which field is missing. */
export const MISSING_URL =
  "this world has no `url`, and the local-api adapter has nothing to send a request to - " +
  "set `url` to the address the service listens on";

/** A world with no start command is not this world either. Named for the same reason. */
export const MISSING_START_COMMAND =
  "this world has no `start.command`, and the local-api adapter starts the service it judges - " +
  "set `start.command` to how this environment is brought up";

/**
 * A world with no declared service identity is not this world either.
 *
 * Named separately from {@link MISSING_URL} because the two are different questions: the first says
 * where to send a request, this one says what the request was about. It used to be derived from the
 * application's directory name, and that was the wrong source - the directory is where the code is,
 * not which service the readings describe, and a derived name is one the document never agreed to.
 */
export const MISSING_SERVICE =
  "this world declares no service identity, and the local-api adapter judges a named service - " +
  "set `api.service` to the name every reading should carry";

export interface LocalApiEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  readonly stateDir: string;
  /** Injectable so a test can drive the adapter with no server and no socket. */
  readonly client?: ApiClient;
  /** How long a single request may take. */
  readonly stepTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly installTimeoutMs?: number;
}

export class LocalApiEnvironment implements EnvironmentAdapter {
  readonly kind = "local-api";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #client: ApiClient;
  readonly #stepTimeoutMs: number;
  readonly #startTimeoutMs: number;
  readonly #installTimeoutMs: number;
  readonly #stateDir: string;

  #id: string | null = null;
  #child: ProcessHandle | null = null;
  /** The child's exit result once it settles. Used only to say *why* readiness never arrived. */
  #exit: Awaited<ProcessHandle["exited"]> | null = null;
  /**
   * What was done to the service child, or `null` if no child was started.
   *
   * Held from `#spawn` rather than recomputed at `boundaries()` time, because the capability is a
   * property of this machine *now* and the report is a statement about what *this run* did. Asking
   * again would let a world describe a child it never confined.
   */
  #confinement: ConfinementResult | null = null;

  /**
   * Everything the origin guard refused, across every criterion.
   *
   * Run-scoped, and never cleared by `reset()`: a reset restores the world; it does not restore the
   * record. Emptying this would let an iteration that reached outside the boundary be followed by a
   * clean one, and the run would report `PASS` with an empty `crossings` list - the evidence of the
   * violation destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  /**
   * Whether an origin guard is in force.
   *
   * Set from the plan at construction rather than from a successful install, because this adapter's
   * guard is a pure function it applies to every request it builds - there is no third party whose
   * installation could fail. The web adapter's equivalent starts `false` because a browser route
   * layer can genuinely fail to install; here `false` would be an untrue pessimism about code that
   * always runs.
   */
  readonly #guarded: boolean;

  constructor(plan: EnvironmentPlan, options: LocalApiEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#client = options.client ?? nodeApiClient();
    this.#stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    this.#startTimeoutMs = options.startTimeoutMs ?? 120_000;
    this.#installTimeoutMs = options.installTimeoutMs ?? 600_000;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
    this.#guarded = plan.boundary.network !== "allow";
  }

  /** The plan's address, or a refusal. The one place this adapter reads `url` as a non-null string. */
  #url(): string {
    const url = this.#plan.url;
    if (url === null || url === "") throw new EnvironmentError(MISSING_URL);
    return url;
  }

  /** The service identity the document named - never a name derived from the directory it runs in. */
  #service(): string {
    const service = this.#plan.api?.service ?? "";
    if (service === "") throw new EnvironmentError(MISSING_SERVICE);
    return service;
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    // All three checked before anything runs, so a document that cannot describe this world fails as
    // a definition problem naming the missing field rather than as a connection error mid-run.
    this.#url();
    this.#service();
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    if (this.#id === null) {
      // Derived from the plan rather than counted, so the same contract yields the same environment
      // id on every run - M1 measures repeat consistency, and an id that changed per run would make
      // two runs of one contract incomparable in the bundle.
      this.#id = `local-api:${this.#plan.app.replace(/\\/g, "/")}`;
    }
    this.#logger.debug("environment.create", { id: this.#id, url: this.#url() });
    return { id: this.#id };
  }

  async start(id: string): Promise<void> {
    this.#requireId(id);
    await this.#installDependencies();
    this.#spawn();
    await this.#awaitReady();
  }

  /**
   * Nothing to copy into the world.
   *
   * The application under test is the user's own working tree, run in place. A `deploy` that copied
   * files would give the run a *different* tree from the one the agent edits, and then a `PASS` would
   * be evidence about a copy nobody repairs. Recorded as an explicit no-op rather than an empty body,
   * so a reader can tell "nothing to do" from "not done".
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note: "the application runs in place from its own directory; there is nothing to deploy",
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
   * Readiness is a status the service answers with.
   *
   * `ok: null` is this world saying "I report a status code; compare it" - the manager's other
   * readiness shape belongs to a world that has no code to report. Deliberately not converted into a
   * `true`/`false` here: the plan declared which status means ready, and a second opinion in the
   * adapter would be a rule nothing could contradict.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const url = probeUrl(this.#plan);
    if (url === null) {
      return { ok: null, statusCode: null, message: MISSING_URL, patternSeen: this.#patternSeen() };
    }
    const answer = await this.#client.send({
      method: "GET",
      url,
      body: null,
      headers: {},
      // One probe must fail fast: the *manager* owns the retry policy, and a probe that spent the
      // whole health budget would make `attempts` a count of one.
      timeoutMs: Math.max(1_000, this.#plan.health.intervalMs),
    });
    return { ok: null, statusCode: answer.status, message: answer.error, patternSeen: this.#patternSeen() };
  }

  /**
   * No snapshotting.
   *
   * A live process cannot be photographed and put back, and the only alternative - returning a token
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
   * Reset is first-class: kill the service and bring a *new* one up, then wait for readiness again.
   *
   * Restarting the process is what makes the reset real. An in-memory order book, a module-level
   * cache, a mutated routing table - the whole class of contamination a previous criterion can leave
   * behind lives in the process image, and there is no way to unload it short of a new process. An
   * API world is *more* exposed to this than a browser world, because a criterion here mutates the
   * service directly instead of through a page: a POST that created an order leaves it in memory, and
   * the next criterion's `GET /orders` would otherwise count it.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") throw new EnvironmentError(noSnapshot(strategy));

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#plan.env,
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
        note: "a custom strategy was requested without a command; falling back to restarting the service",
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
   * It must not remove the application directory: that directory is the user's source tree, and an
   * adapter that deletes it on the failure path is a bug that takes a working copy with it.
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
      kind: API_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
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
            `the local-api adapter performs \`call\` steps and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${kind}\` - this world judges a service through its own ` +
              "routes, so a criterion about a page, a database or a provisioned artifact belongs to " +
              "the world whose adapter performs it",
          ),
        };
      }

      const exchanges: ApiExchange[] = [];
      // `observe()` does not act, so it reports the requests it was given without sending them -
      // and that is a real distinction rather than a technicality: a service that records what it
      // received would otherwise be read as though a criterion had hit it twice.
      if (act) {
        for (const step of steps) {
          if (step.kind !== "call") continue;
          const sent = await this.#send(step.method, step.path, step.body, request.criterionId);
          if ("error" in sent) return { ...base, data: null, artifacts: [], error: sent.error };
          exchanges.push(sent.exchange);
        }
      }

      const data: ApiObservationData = {
        service: this.#service(),
        baseUrl: this.#url(),
        exchanges,
        application: this.#readProcess(),
      };

      const relativeRunDir = bundleLayout(this.#stateDir, request.runId).runDir;
      const artifacts = await this.#captureEvidence(request, data, relativeRunDir);
      return { ...base, data, artifacts, error: null };
    } catch (error) {
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", describe(error)) };
    }
  }

  /**
   * Resolve a path, refuse it if it leaves the service, and put the request.
   *
   * Returns either the exchange or a refusal, and the distinction is load-bearing: a crossing is not
   * reported as an exchange with a status, because a request that was never sent has no answer and
   * reporting one would give a criterion a value it could compare.
   */
  async #send(
    method: CallMethod,
    path: string,
    body: string | null,
    criterionId: string,
  ): Promise<{ readonly exchange: ApiExchange } | { readonly error: NonNullable<Observation["error"]> }> {
    const origin = originOf(this.#url());
    let url: string;
    try {
      url = new URL(path, this.#url()).toString();
    } catch {
      return {
        error: failure(
          "APPLICATION_ERROR",
          `\`${path}\` is not a path this world can resolve against ${this.#url()}`,
        ),
      };
    }

    if (this.#guarded && originOf(url) !== origin) {
      const subject = `${method} ${path} -> ${url}`;
      this.#crossings.push({
        boundary: "network",
        subject,
        criterionId,
        at: this.#clock.iso(),
      });
      return {
        error: failure(
          "SECURITY_VIOLATION",
          `\`${subject}\` leaves this service's origin (${origin}), and the goal declares ` +
            `networkPolicy: ${this.#plan.boundary.network}. A criterion in this world asks the ` +
            "service it names, not an address of its own choosing.",
        ),
      };
    }

    this.#logger.debug("api.request", { method, url, hasBody: body !== null });
    const answer = await this.#client.send({
      method,
      url,
      body,
      headers: {},
      timeoutMs: this.#stepTimeoutMs,
    });
    this.#logger.debug("api.response", {
      method,
      url,
      status: answer.status,
      bytes: answer.body.length,
      error: answer.error,
    });

    return {
      exchange: {
        method,
        path,
        url,
        requestBody: body,
        status: answer.status,
        headers: answer.headers,
        body: answer.body,
        bodyBytes: answer.body.length,
        error: answer.error,
      },
    };
  }

  /**
   * The application's process, as far as a reading can see it.
   *
   * Bounded, because a criterion's reading has to stay readable and a service that logs a line per
   * request would otherwise put a megabyte into every bundle. The tail is kept rather than the head:
   * a failure states its cause last, which is the same reason the repair note keeps its tail.
   */
  #readProcess(): ApiProcessReading {
    const child = this.#child;
    return {
      exited: this.#exit !== null,
      code: this.#exit?.code ?? null,
      stdout: tail(child?.output() ?? "", 4_000),
      stderr: tail(child?.error() ?? "", 4_000),
    };
  }

  /**
   * What this world did about the plan's boundaries.
   *
   * `network` is `enforced` when the goal asked for anything other than `allow`, because every
   * request this adapter sends is built by `#send` and passes the origin guard - which is a claim
   * about code that always runs, not about a third party's installation.
   *
   * `filesystemWrite` is derived from what `#spawn` returned rather than declared, so it cannot
   * disagree with the child that was actually started. It read `unsupported` unconditionally until
   * `core/environment/confinement.ts` existed, and the sentence carrying that claim - "the
   * application runs as an ordinary child process with the operator's own privileges" - stopped
   * being true the moment this machine could be asked to hold the boundary and answered yes. It
   * reads `enforced` only when a confined child really was started, because `unsupported` means this
   * world holds no boundary here, and a world that holds one while saying it does not is the same
   * defect as one that claims a boundary it never installed.
   */
  boundaries(): BoundaryReport {
    return {
      network: this.#plan.boundary.network === "allow" ? "not-requested" : this.#guarded ? "enforced" : "unsupported",
      filesystemWrite: this.#confinement?.applied === true ? "enforced" : "unsupported",
      crossings: [...this.#crossings],
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). This world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: ApiObservationData,
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

    // The exchanges on their own, because this is the artifact a human reads when an API criterion
    // fails: every request and every answer, in order, without the process reading around them.
    await write(
      `${BUNDLE_FILES.artifacts}/${id}.exchanges.json`,
      "json",
      `${JSON.stringify(data.exchanges, null, 2)}\n`,
    );

    // The kinds this call did *not* write are the only ones worth a warning, and the set is read off
    // the artifacts rather than from a literal list beside them. The literal was here first in the
    // sibling adapters and it was wrong in the one direction that matters: it warned for `json` while
    // holding a `json` artifact written two lines above, so every criterion reported "produces `json`
    // and cannot produce `json`" - a sentence that contradicts itself, and a reader who learns to
    // skip these lines has learned to skip the one that is true.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the local-api adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- process ---------------------------------------------------------------------------------

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

  #spawn(): ProcessHandle {
    const { command, args } = this.#plan.start;
    // The child is confined here, before it exists, and the vector handed to the runner is the one
    // this call returns rather than the one the document declared. `readRoots` names the application
    // directory: the program is opened from there, and so is anything it serves.
    //
    // The write allowance follows the policy the document actually declared, because the two
    // policies mean two different things: `deny` gives none, and `sandbox` gives exactly the
    // application directory. They are not interchangeable - passing an empty list for `sandbox` would
    // enforce `deny` on a plan that asked to write inside the world, and then report it `enforced`,
    // which is a stricter world than the operator asked for described as the one they asked for.
    // (An empty allowance is what `deny` means to a confined child: it cannot open a file for
    // writing at all.)
    //
    // The order matters too - the confinement runs *after* the dependency install, in `start()`,
    // because `npm install` is not a Node interpreter and `confineChild` refuses it by name rather
    // than confining something it does not reach.
    const confinement = confineChild({
      command,
      args,
      readRoots: [this.#plan.appPath],
      writeRoots: this.#plan.boundary.filesystemWrite === "sandbox" ? [this.#plan.appPath] : [],
    });
    this.#confinement = confinement;
    this.#logger.info("environment.start", {
      command,
      args,
      cwd: this.#plan.appPath,
      url: this.#url(),
      // What was done to the child, on the same line as the child being started, because two events
      // could otherwise disagree about whether this world confined the service it started.
      confined: confinement.applied,
      confinement: confinement.reason,
    });
    const handle = this.#processes.run({
      command: confinement.command,
      args: confinement.args,
      cwd: this.#plan.appPath,
      env: this.#plan.env,
      // Output is read back through `handle.output()`, which is the single source for the text; these
      // callbacks exist so a long boot is visible while it is happening rather than only in the bundle.
      onStdout: (chunk) => this.#logger.debug("app.stdout", { chunk: chunk.trimEnd() }),
      onStderr: (chunk) => this.#logger.warn("app.stderr", { chunk: chunk.trimEnd() }),
    });
    this.#child = handle;
    this.#exit = null;
    // Guarded, because a previous child's exit can be delivered *after* this one is published, and
    // unguarded `#exit` would hold a dead child's result while `#child` held the live one. `probe()`
    // reads both, so it would report a running service as stopped and the manager's poll would never
    // see it ready.
    //
    // The window this closes was real and was measured, not imagined: `core/process.ts`'s `stop()`
    // awaited `exited` on POSIX but returned as soon as `taskkill` closed on Windows, so the old
    // handle could settle during the restart that follows. **That asymmetry is fixed** - both
    // branches now wait for the child to be gone - and `tests/process.test.ts` holds that reading
    // directly. The guard stays anyway: it costs one comparison, it makes the invariant local to the
    // two fields it protects instead of resting on a distant file, and this world's reset path stops
    // and re-spawns on every iteration.
    void handle.exited.then((result) => {
      if (this.#child !== handle) return;
      this.#exit = result;
    });
    return handle;
  }

  /**
   * Wait for the service to say it is ready.
   *
   * Spawning a process is not starting a service: the parent returns immediately and the port is not
   * bound yet. The readiness pattern is the application's own signal that it got there, and without
   * it every criterion would race the boot and the run would be flaky for reasons the report could
   * not explain. When no pattern was declared there is nothing to wait for here - the manager's
   * health check is the only gate, and it is a real one.
   */
  async #awaitReady(): Promise<void> {
    const pattern = this.#plan.start.readyPattern;
    const child = this.#child;
    if (pattern === null || child === null) return;

    const seen = await child.waitForPattern(pattern, this.#startTimeoutMs);
    if (seen) return;

    const exit = this.#exit;
    throw new EnvironmentError(
      exit === null
        ? `the service did not print /${pattern}/ within ${String(this.#startTimeoutMs)}ms. Output so far: ${tail(child.output())}`
        : `the service exited with code ${String(exit.code)}${exit.signal === null ? "" : ` (signal ${exit.signal})`} before printing /${pattern}/. stderr: ${tail(child.error())}`,
    );
  }

  async #restart(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    if (child !== null) await child.stop();
    const spawned = this.#spawn();
    await this.#awaitReady();
    this.#logger.debug("environment.reset", { id: this.#id, strategy: "restart", pid: spawned.pid });
  }

  /** `null` when the adapter has no stdout signal to offer - never `false`, which would read as "not ready". */
  #patternSeen(): boolean | null {
    const pattern = this.#plan.start.readyPattern;
    const child = this.#child;
    if (pattern === null || child === null) return null;
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
      // watching one service's answers appear in another's evidence.
      throw new EnvironmentError(`this environment is \`${this.#id}\`, but it was addressed as \`${id}\``);
    }
  }
}

/**
 * The origin of an address, or a refusal phrased as one.
 *
 * Compared as origin rather than as full URL on purpose: a criterion naming `http://127.0.0.1:4327`
 * and a criterion naming a relative path resolve to two different strings for one service, and a
 * boundary that compared whole URLs would refuse both spellings of the world it was told to judge.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * How long one request may take.
 *
 * The default, and the one place the number is written. Exported so a test can assert the bound is
 * a real one rather than re-typing the literal - a cap nobody can read is a cap nobody can check.
 */
export const STEP_TIMEOUT_MS = 15_000;

function noSnapshot(strategy: string, snapshotId?: string): string {
  const subject = snapshotId === undefined ? "a snapshot" : `snapshot \`${snapshotId}\``;
  return (
    `the local-api adapter cannot restore ${subject}: it brings up a process and sends requests to it, ` +
    `and a live service cannot be photographed and put back. reset.strategy is \`${strategy}\`, which asks for exactly that. ` +
    "Use `restart`, which is a real reset - a new process with none of the previous run's memory in it - " +
    "rather than a reset in name only."
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
