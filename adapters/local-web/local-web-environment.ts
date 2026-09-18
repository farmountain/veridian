/**
 * The MVP environment: a local web application, a browser, and a process boundary.
 *
 * This is the first *real* {@link EnvironmentAdapter} — the thing that turns the abstract lifecycle
 * into a specific world. It owns four concerns and nothing else: start a process, prove it is alive,
 * drive a browser through the criterion's steps, and write down what was seen. It reasons about none
 * of them. It does not know what a criterion means, whether an assertion should pass, or how to fix
 * anything: it hands a *fact* to the validation layer and lets that layer decide.
 *
 * ## Why the plan arrives through the constructor
 *
 * `EnvironmentAdapter`'s methods take an environment id and a request, never the plan — the interface
 * was designed so that a manager can run any adapter without knowing what it is. A real adapter still
 * has to know *which* application it was asked to bring up, and there is exactly one honest way to
 * tell it: the plan is resolved before the run starts, so it is handed over at construction. The
 * alternative — re-reading `environment.yaml` here — would give the world a second opinion about its
 * own configuration, and when the two disagree the winner is whichever parsed last.
 *
 * ## Why every failure here is an `EnvironmentError`
 *
 * The run's failure taxonomy exists to keep "the application is broken" apart from "the sandbox could
 * not be brought up". A browser that will not launch, a process that never prints its readiness
 * signal, a dependency install that exits non-zero — none of those is a defect in the application
 * under test, and reporting any of them as a test failure would send an external agent to repair code
 * that was never given a chance to run. `EnvironmentError` is the marker the loop reads to record
 * `ENVIRONMENT_FAILURE`, so it is raised for all of them and for nothing else.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { StepKind } from "../../core/acceptance/steps.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
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
import { type ConfinementResult } from "../../core/environment/confinement.ts";
import { probeUrl } from "../../core/environment/load.ts";
import type { WebObservationData, WebTargetObservation } from "../../core/environment/web-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import { BUNDLE_FILES, bundleLayout } from "../../core/evidence/index.ts";
import { EnvironmentError, failure } from "../../core/failure.ts";
import type { IoPort } from "../../core/io.ts";
import type { ProcessHandle, ProcessRunner } from "../../core/process.ts";
import { runToCompletion } from "../../core/process.ts";
import { PLAYWRIGHT_MISSING } from "./browser-port.ts";
import type { BrowserPage, BrowserPort, BrowserSession } from "./browser-port.ts";

/** The subset of `fetch` this adapter needs, so a test can probe without a server. */
export interface HttpResponseLike {
  readonly status: number;
  /** Release the socket. A fake may make this a no-op. */
  dispose(): void;
}

export type FetchLike = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<HttpResponseLike>;

export interface LocalWebEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root — `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /**
   * The browser. `null` means the environment was planned without one, and every criterion then
   * fails as an environment failure rather than silently judging `about:blank`.
   */
  readonly browser?: BrowserPort | null;
  readonly fetch?: FetchLike;
  /** Per-action cap for a browser step. The run's per-criterion cap is the outer bound. */
  readonly stepTimeoutMs?: number;
  /** How long to wait for the readiness pattern after starting the application. */
  readonly startTimeoutMs?: number;
  /** How long a dependency install may take. Generous: it is a one-off, not a retry. */
  readonly installTimeoutMs?: number;
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, { signal: init.signal, redirect: "follow" });
  return {
    status: response.status,
    dispose: () => {
      void response.body?.cancel().catch(() => undefined);
    },
  };
};

/** The tail of a process's output, for a message a human has to read at three in the morning. */
const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * An origin, from a URL the adapter already trusts.
 *
 * Falls back to the raw string rather than throwing: the plan's URL has been probed by this point,
 * so an unparseable one is already a failed run, and failing here would replace that diagnosis with a
 * crash. The fallback matches nothing, which is the fail-safe direction for a boundary.
 */
const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/**
 * What this adapter says when the document never said where the application answers.
 *
 * `EnvironmentPlan.url` is `string | null` because a world reached by opening a file has no address,
 * and the requirement that a *web* world has one lives here rather than in
 * `core/environment/load.ts`. `core/` cannot know which worlds need an address; a rule written there
 * would apply this adapter's requirement to every adapter, including the ones it is wrong for.
 */
const MISSING_URL =
  "this world has no `url`, and the local-web adapter drives the application over HTTP - " +
  "add `url` to the environment document, or use an adapter whose world is reached another way";

/**
 * Which step kinds this world can perform, and a compile-time proof that the question was asked of
 * every kind.
 *
 * Typed `Record<StepKind, boolean>` rather than written as the list of seven names the `switch` below
 * handles, and that is the whole point of it. The `switch` has no `default`, so a step kind this
 * adapter does not implement falls through it and the criterion is judged in a world it never acted
 * on - the exact shape of the `--browser none` defect, one layer in: a run that reports a verdict
 * about a scenario nobody set up. `local-db` refuses such a step **by name**; this adapter silently
 * skipped it, and nothing failed, because a step that does nothing is invisible in a green run.
 *
 * A hand-written list of the seven performed kinds would have the same defect as the `switch`: nine
 * months from now somebody adds a twelfth kind to `ValidationStep`, the list still says seven, and
 * the new kind is silently skipped again. Typing the map over the **union** means a kind added to the
 * register fails to typecheck here until somebody decides, in this file, whether this world performs
 * it - which is the only moment the answer is cheap to give.
 */
const STEP_KINDS_PERFORMED: Record<StepKind, boolean> = {
  goto: true,
  click: true,
  reload: true,
  fill: true,
  select: true,
  press: true,
  waitFor: true,
  // A browser drives a page. It has no database, no manifest to apply, no command vector to run and
  // no request of its own to put to a world - and `apply`, `run` and `call` are step kinds the plan
  // admits only for the worlds whose adapters declare them, so a *web* contract naming one is a
  // contract written against the wrong world rather than a step this adapter should try to honour.
  sql: false,
  apply: false,
  run: false,
  call: false,
};

export class LocalWebEnvironment implements EnvironmentAdapter {
  readonly kind = "local-web";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #browser: BrowserPort | null;
  readonly #fetch: FetchLike;
  readonly #stepTimeoutMs: number;
  readonly #startTimeoutMs: number;
  readonly #installTimeoutMs: number;
  readonly #stateDir: string;

  #id: string | null = null;
  #child: ProcessHandle | null = null;
  #session: BrowserSession | null = null;
  /** The child's exit result once it settles. Used only to say *why* readiness never arrived. */
  #exit: Awaited<ProcessHandle["exited"]> | null = null;
  /**
   * Everything the network guard refused, across every criterion.
   *
   * Run-scoped rather than criterion-scoped because the loop asks the world what crossed a boundary
   * once, at the point it builds a verdict, and a per-criterion answer would force it to reassemble
   * the run's safety history from observations - which is how a crossing on an early iteration gets
   * forgotten by a later one.
   *
   * `reset()` deliberately does not clear it, and that is the whole point of it being here rather
   * than in a page. A reset restores the world; it does not restore the record. Emptying this on reset
   * would let an iteration that reached outside the boundary be followed by a clean one, and the run
   * would report `PASS` with an empty `crossings` list - the evidence of the violation destroyed by
   * the very act of repairing it, which is the shape of false pass M3 exists to refuse.
   */
  readonly #crossings: BoundaryCrossing[] = [];
  /**
   * What was done to the application child, or `null` if no child was started.
   *
   * Held from `#spawn` rather than recomputed when `boundaries()` is asked, because the two are
   * different questions: the capability is a property of this machine *now*, while the report is a
   * statement about what *this run* did. A world that asked again at report time could describe a
   * child it never confined.
   */
  #confinement: ConfinementResult | null = null;
  /**
   * Whether a request guard was installed on at least one page, and never failed to be installed.
   *
   * Starts `false`, and a failed installation sets it back to `false`, so the fail-safe direction is
   * the one the report takes: an adapter that has not demonstrably held the boundary must not say
   * `enforced`. `false` here is what turns a declared policy into an honest `unsupported`.
   */
  #boundaryHeld = false;

  constructor(plan: EnvironmentPlan, options: LocalWebEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#browser = options.browser ?? null;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#stepTimeoutMs = options.stepTimeoutMs ?? 15_000;
    this.#startTimeoutMs = options.startTimeoutMs ?? 120_000;
    this.#installTimeoutMs = options.installTimeoutMs ?? 600_000;
    // Normalised once, here, so no other method has to remember that Windows writes separators the
    // other way. Every path below is either this (io-relative) or derived from it.
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  /** The plan's address, or a refusal. The one place this adapter reads `url` as a non-null string. */
  #url(): string {
    const url = this.#plan.url;
    if (url === null) throw new EnvironmentError(MISSING_URL);
    return url;
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    // Checked before anything is started, so a document with no address fails as a definition
    // problem naming the missing field rather than as a timeout halfway through a run.
    this.#url();
    if (this.#id === null) {
      // Derived from the plan rather than counted, so the same contract yields the same environment id
      // on every run. M1 measures repeat consistency; an id that changed per run would make two runs of
      // one contract incomparable in the bundle.
      this.#id = `local-web:${this.#plan.app.replace(/\\/g, "/")}`;
    }
    this.#logger.debug("environment.create", { id: this.#id, appPath: this.#plan.appPath });
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
   * The application under test is the user's own working tree, served in place, and whatever the
   * start command needs has already been installed by `start`. A `deploy` that copied files would
   * give the run a *different* tree from the one the agent edited — and then a PASS would be evidence
   * about a copy nobody repairs. Left as an explicit no-op with a recorded reason rather than an
   * empty body, so a reader can tell the difference between "nothing to do" and "not implemented".
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

  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const url = probeUrl(this.#plan);
    if (url === null) {
      // Unreachable after `create()`, and still answered rather than thrown: a probe is how the
      // manager asks "is the world ready?", and the honest answer for a plan with no address is
      // "no, and the missing field is why".
      return { ok: null, statusCode: null, message: MISSING_URL, patternSeen: this.#patternSeen() };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#probeTimeoutMs());
    timer.unref?.();

    try {
      const response = await this.#fetch(url, { signal: controller.signal });
      const statusCode = response.status;
      response.dispose();
      // `ok: null` is the HTTP world saying "I report a status code; compare it" - the manager's
      // other readiness shape belongs to a world that has no code to report.
      return { ok: null, statusCode, message: null, patternSeen: this.#patternSeen() };
    } catch (error) {
      return { ok: null, statusCode: null, message: describe(error), patternSeen: this.#patternSeen() };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * No snapshotting. `snapshot-restore` is refused for the same reason `restore` throws: a snapshot of
   * a live process is not a thing this adapter can produce, and the only alternative — returning a
   * token that `restore` ignores — would make a reset look like it happened when it did not.
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
   * Reset is first-class: kill the application and bring a *new* one up, then wait for readiness
   * again.
   *
   * Restarting the process is what makes the reset real. An in-memory cart, a module-level cache, a
   * mutated module registry — the whole class of contamination a previous criterion can leave behind
   * lives in the process image, and there is no way to unload it short of a new process. Waiting for
   * the readiness pattern afterwards matters just as much: returning while the new process is still
   * booting would hand the next criterion a world that is *nearly* ready, which is how a run becomes
   * flaky for a reason nobody can reproduce (M4).
   *
   * The browser is deliberately *not* restarted. Criterion-level isolation already comes from a fresh
   * context per page, so tearing the browser down here would add seconds per reset and change nothing
   * about what the next criterion can see.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(noSnapshot(strategy));
    }

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
        // Thrown rather than absorbed: the manager turns this into a RESET_FAILURE, and the run is
        // stopped instead of being judged in a world whose reset silently did nothing.
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
        note: "a custom strategy was requested without a command; falling back to restarting the application",
      });
    }

    await this.#restart();
  }

  async stop(id: string): Promise<void> {
    this.#requireId(id);
    const session = this.#session;
    this.#session = null;
    if (session !== null) {
      try {
        await session.close();
      } catch (error) {
        // The browser is an implementation detail of observation; failing to tidy it must not turn a
        // verdict into an error. Recorded so it is not invisible.
        this.#logger.warn("environment.stop", { id, browser: describe(error) });
      }
    }

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
   * adapter that deletes it on the failure path is a bug that takes a working copy with it. Only what
   * the environment created — a process, a browser — is the environment's to destroy.
   */
  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.stop(id);
    this.#id = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    const base = {
      kind: WEB_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    // Refused before the browser is even looked for, and before any path is resolved, because the
    // refusal is a fact about the *contract* rather than about this run: it holds whether or not
    // Playwright is installed. A criterion the steps cannot set up would be judged in a world it
    // never acted on, so a verdict about it would be a claim the observation cannot support - and
    // `VALIDATOR_ERROR` is the honest classification, because the defect is in the criterion, not in
    // the application and not in the sandbox.
    //
    // Decoded through `decodeStep` - the same function that produced the wire records - so this reads
    // the step the *contract layer* emitted rather than a second idea of the format held here. The
    // decode is inside the same refusal as the kind check, because the two are one question: "can this
    // criterion be performed in this world?" A record naming two actions and a record naming `sql`
    // both answer no, and both are defects in the contract rather than in the application or in the
    // sandbox - which is why `VALIDATOR_ERROR` is the classification for each.
    //
    // Before the browser is reached on purpose: a criterion whose steps cannot be read must not have a
    // page opened for it, and "no page" is what distinguishes a refusal from a skip that fails later.
    if (act) {
      try {
        const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
        const unsupported = steps.findIndex((step) => !STEP_KINDS_PERFORMED[step.kind]);
        if (unsupported !== -1) {
          const step = steps[unsupported];
          return {
            ...base,
            data: null,
            artifacts: [],
            error: failure(
              "VALIDATOR_ERROR",
              "the local-web adapter performs browser steps, and step " + `${String(unsupported + 1)} of ` +
                `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the ` +
                "criterion would be judged in a world it never acted on",
            ),
          };
        }
      } catch (error) {
        return { ...base, data: null, artifacts: [], error: failure("VALIDATOR_ERROR", describe(error)) };
      }
    }

    const browser = this.#browser;
    if (browser === null) {
      const reason = this.#plan.browser.enabled
        ? PLAYWRIGHT_MISSING
        : "the environment was planned with `browser.enabled: false`, so there is no page to observe";
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", reason) };
    }

    // The run directory is derived from the same helper the writer uses, so the adapter cannot write
    // evidence to one place while the bundle looks for it in another.
    const relativeRunDir = bundleLayout(this.#stateDir, request.runId).runDir;
    const relativeTrace = `${BUNDLE_FILES.trace}/${request.criterionId}.zip`;
    const wantsTrace = request.evidence.includes("trace");
    // One path, two spellings, both derived from `relativeTrace`: the bundle records where a *reader*
    // finds the file (relative to the run directory, so the bundle can be moved), and Playwright needs
    // where the *OS* finds it. Derived rather than written twice, because two hand-written paths for
    // one file is how evidence goes missing while every check still reports completeness.
    const tracePath = wantsTrace ? this.#io.resolve(`${relativeRunDir}/${relativeTrace}`) : null;

    try {
      const session = await this.#sessionFor(browser);
      if (tracePath !== null) {
        // Playwright writes the archive itself and does not create its parent.
        await this.#io.mkdirp(`${relativeRunDir}/${BUNDLE_FILES.trace}`);
      }
      let page: BrowserPage;
      try {
        page = await session.newPage(tracePath);
      } catch (error) {
        // `newPage` installs the request guard before it resolves, so a throw here means the page
        // exists without one. Recorded as a boundary that is not held rather than thrown past: the
        // caller turns the error into this criterion's ENVIRONMENT_FAILURE, and the run's boundary
        // report has to agree with that.
        this.#boundaryHeld = false;
        throw error;
      }
      if (this.#plan.boundary.network !== "allow") this.#boundaryHeld = true;
      try {
        if (act) await this.#replay(page, request);
        const data = await this.#read(page, request);
        const artifacts = await this.#captureEvidence(page, request, data, relativeRunDir);
        return { ...base, data, artifacts, error: null };
      } finally {
        // Refusals are read here, not on the success path, because a guard that blocked a request
        // is often exactly why the steps that followed threw. Reading them only after a clean
        // observation would discard the evidence for the failures most likely to involve a
        // crossing.
        this.#collect(page.refusals(), request.criterionId);
        try {
          await page.close();
        } catch (error) {
          this.#logger.warn("environment.page", { id, criterionId: request.criterionId, close: describe(error) });
        }
      }
    } catch (error) {
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", describe(error)) };
    }
  }

  #collect(refusals: readonly { readonly subject: string; readonly at: string }[], criterionId: string): void {
    for (const refusal of refusals) {
      this.#crossings.push({ boundary: "network", subject: refusal.subject, criterionId, at: refusal.at });
    }
  }

  /**
   * What this world did about the plan's boundaries.
   *
   * `filesystemWrite` is derived from what `#spawn` returned rather than declared, so it cannot
   * disagree with the child that was actually started. It was `unsupported` unconditionally until
   * `core/environment/confinement.ts` existed, and the sentence that carried that claim - "the
   * application runs as an ordinary child process with the operator's own privileges" - stopped
   * being true the moment this machine could be asked to hold the boundary and answered yes. It now
   * reads `enforced` only when a confined child really was started, because `unsupported` means this
   * world holds no boundary here: a world that holds one while saying it does not is the same defect
   * as one that claims a boundary it never installed, and only the second of those is obvious.
   */
  boundaries(): BoundaryReport {
    const { network } = this.#plan.boundary;
    return {
      network:
        network === "allow" ? "not-requested" : this.#boundaryHeld ? "enforced" : "unsupported",
      filesystemWrite: this.#confinement?.applied === true ? "enforced" : "unsupported",
      crossings: [...this.#crossings],
    };
  }

  /** Launch once and reuse; a fresh *page* per criterion is what provides isolation, not a new browser. */
  async #sessionFor(browser: BrowserPort): Promise<BrowserSession> {
    if (this.#session !== null) return this.#session;
    const session = await browser.launch({
      viewport: this.#plan.browser.viewport,
      locale: this.#plan.browser.locale,
      timezoneId: this.#plan.browser.timezoneId,
      // Handed to the browser rather than re-derived there, so the guard holds the boundary that
      // was resolved in the plan instead of a second reading of the goal document.
      boundary: this.#plan.boundary,
      appOrigin: originOf(this.#url()),
    });
    this.#session = session;
    return session;
  }

  /**
   * Replay the criterion's steps.
   *
   * The wire records are decoded with `decodeStep` — the same function that produced them — rather
   * than by a second decoder written here. An adapter that carried its own idea of the step format
   * would keep working on documents the contract layer had stopped emitting, and the divergence would
   * show up as a step that silently did nothing.
   */
  async #replay(page: BrowserPage, request: ObservationRequest): Promise<void> {
    const timeout = this.#stepTimeoutMs;
    for (const [index, raw] of request.steps.entries()) {
      const step = decodeStep(raw, request.criterionId, index);
      this.#logger.debug("environment.step", { criterionId: request.criterionId, index, kind: step.kind });
      switch (step.kind) {
        case "goto":
          await page.goto(step.url, timeout);
          break;
        case "reload":
          await page.reload(timeout);
          break;
        case "click":
          await page.click(step.target, timeout);
          break;
        case "fill":
          await page.fill(step.target, step.value, timeout);
          break;
        case "select":
          await page.select(step.target, step.value, timeout);
          break;
        case "press":
          await page.press(step.target, step.key, timeout);
          break;
        case "waitFor":
          await page.waitFor(step.target, step.state, timeout);
          break;
        default:
          // The second of the two independent reasons an unsupported step cannot become a silent
          // no-op. `#capture` refuses such a criterion before this function is reached, and this
          // refuses it again if the map above and this switch ever disagree - which is the one
          // direction the `Record<StepKind, boolean>` totality check cannot see: a member flipped to
          // `true` with no case here would pass the pre-check and fall straight through.
          //
          // Thrown rather than returned because `#replay` has no observation to return, and a throw
          // is already how a step that fails in this world is reported: `#capture` turns it into
          // this criterion's failure. Named here so the message says which kind rather than "Error".
          throw new EnvironmentError(
            `the local-web adapter cannot perform a \`${step.kind}\` step, and step ` +
              `${String(index + 1)} of ${request.criterionId} asks for one - the criterion would be ` +
              "judged in a world it never acted on",
          );
      }
    }
  }

  /**
   * One instant, every target the criterion asked about.
   *
   * A selector the port returned nothing for becomes an explicit *error* rather than `found: false`.
   * The two are not the same claim: one says the adapter never looked, the other says the page does
   * not have it. Collapsing them would let a broken reading masquerade as a missing element, and the
   * external agent would go and add an element that was already there.
   */
  async #read(page: BrowserPage, request: ObservationRequest): Promise<WebObservationData> {
    const raw = await page.read(request.targets);
    const targets: Record<string, WebTargetObservation> = {};
    for (const selector of request.targets) {
      const entry = raw[selector];
      targets[selector] =
        entry === undefined
          ? {
              found: false,
              count: 0,
              text: null,
              value: null,
              visible: false,
              error: `the adapter returned no reading for \`${selector}\``,
            }
          : { ...entry };
    }

    return {
      url: page.url(),
      title: await page.title(),
      targets,
      console: page.consoleEntries(),
      network: page.networkEntries().map((entry) => ({
        method: entry.method,
        url: entry.url,
        status: entry.status,
        // Derived here, where the status is authoritative, instead of by every validator that cares.
        // `ok` is deliberately a *code* judgement: a 304 is not a failure and a 404 is not a success.
        ok: entry.status !== null && entry.status >= 200 && entry.status < 400,
        at: entry.at,
      })),
      viewport: this.#plan.browser.viewport,
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading itself is always written, whatever the criterion declared, because a judgement cites
   * `actual` values that came from here — and an assertion about a page state that was never stored
   * is a claim with no evidence behind it (M5). The declared kinds are written on top of that: they
   * are what the criterion asked to be able to *show*, and a bundle missing one of them fails the
   * required-evidence guard rather than being quietly accepted.
   */
  async #captureEvidence(
    page: BrowserPage,
    request: ObservationRequest,
    data: WebObservationData,
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

    for (const kind of request.evidence) {
      switch (kind) {
        case "screenshot": {
          const relative = `${BUNDLE_FILES.screenshots}/${id}.png`;
          const pixels = await page.screenshot();
          await this.#io.writeBinaryFile(`${relativeRunDir}/${relative}`, pixels);
          artifacts.push({ path: relative, kind, criterionId: id, bytes: pixels.length });
          break;
        }
        case "dom":
          await write(`${BUNDLE_FILES.artifacts}/${id}.dom.html`, kind, await page.content());
          break;
        case "console":
          await write(`${BUNDLE_FILES.artifacts}/${id}.console.json`, kind, `${JSON.stringify(data.console, null, 2)}\n`);
          break;
        case "network":
          await write(`${BUNDLE_FILES.artifacts}/${id}.network.json`, kind, `${JSON.stringify(data.network, null, 2)}\n`);
          break;
        case "trace":
          // Declared here, written when the page closes: the trace is a recording of the whole
          // criterion, so its bytes cannot exist until the criterion's last action has happened. The
          // path is the same string the port was handed, so the file that lands on disk is the file
          // this artifact names.
          artifacts.push({
            path: `${BUNDLE_FILES.trace}/${id}.zip`,
            kind,
            criterionId: id,
            bytes: null,
          });
          break;
        case "log":
        case "json":
          // Not criterion-requestable — `acceptance.schema.json` restricts the evidence vocabulary to
          // the five kinds above. Listed so that adding a kind to `ArtifactKind` is a compile error
          // here rather than a silently ignored request.
          this.#logger.warn("environment.evidence", {
            criterionId: id,
            kind,
            note: "this artifact kind is not produced by the local-web adapter",
          });
          break;
      }
    }
    return artifacts;
  }

  // ---- process --------------------------------------------------------------------------------

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
    // The allowance is a value; applying it is `core/process.ts`'s job. `readRoots` names the
    // application directory and nothing else, because that is where the program and everything it
    // serves from live - an allowance naming nothing would refuse to load the program it was asked to
    // confine.
    //
    // The write allowance follows the policy the document actually declared, because the two
    // policies mean two different things: `deny` gives none, and `sandbox` gives exactly the
    // application directory. They are not interchangeable - passing an empty list for `sandbox` would
    // enforce `deny` on a plan that asked to write inside the world, and then report it `enforced`,
    // which is a stricter world than the operator asked for described as the one they asked for.
    // (An empty allowance is what `deny` means to a confined child: it cannot open a file for
    // writing at all.) That the canonical application writes nothing either way was measured rather
    // than assumed, which is why `deny` is safe for it.
    const handle = this.#processes.run({
      command,
      args,
      cwd: this.#plan.appPath,
      env: this.#plan.env,
      confinement: {
        readRoots: [this.#plan.appPath],
        writeRoots: this.#plan.boundary.filesystemWrite === "sandbox" ? [this.#plan.appPath] : [],
      },
      // Output is read back through `handle.output()`, which is the single source for the text; these
      // callbacks exist so a long boot is visible while it is happening rather than only in the bundle.
      onStdout: (chunk) => this.#logger.debug("app.stdout", { chunk: chunk.trimEnd() }),
      onStderr: (chunk) => this.#logger.warn("app.stderr", { chunk: chunk.trimEnd() }),
    });
    // Read back rather than recomputed: the runner decided before the process existed, so this is
    // available synchronously and is a reading of something that happened.
    const confinement = handle.confinement ?? null;
    this.#confinement = confinement;
    this.#logger.info("environment.start", {
      command,
      args,
      cwd: this.#plan.appPath,
      // What was done to the child, on the same line as the child being started, because two events
      // could otherwise disagree about whether this world confined the program it started.
      confined: confinement?.applied === true,
      confinement: confinement === null ? "no allowance was requested" : confinement.reason,
    });
    this.#child = handle;
    this.#exit = null;
    // Guarded, because a previous child's exit can be delivered *after* this one is published, and
    // unguarded `#exit` would hold a dead child's result while `#child` held the live one. `probe()`
    // reads both, so it would report a running application as stopped and the manager's poll would
    // never see it ready.
    //
    // The window this closes was real and was measured, not imagined: `core/process.ts`'s `stop()`
    // awaited `exited` on POSIX but returned as soon as `taskkill` closed on Windows, so the old
    // handle could settle during the rebuild that follows. **That asymmetry is fixed** - both
    // branches now wait for the child to be gone - and `tests/process.test.ts` holds that reading
    // directly. The guard stays anyway: it costs one comparison, it makes the invariant local to the
    // three fields it protects instead of resting on a distant file, and a world that stops and
    // re-spawns is exactly the shape that would find the next such window first.
    void handle.exited.then((result) => {
      if (this.#child !== handle) return;
      this.#exit = result;
    });
    return handle;
  }

  /**
   * Wait for the application to say it is ready.
   *
   * Spawning a process is not starting an application: the parent returns immediately and the port is
   * not bound yet. The readiness pattern is the application's own signal that it got there, and
   * without it every criterion would race the boot and the run would be flaky for reasons the report
   * could not explain. When no pattern was declared there is nothing to wait for here — the manager's
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
        ? `the application did not print /${pattern}/ within ${String(this.#startTimeoutMs)}ms. Output so far: ${tail(child.output())}`
        : `the application exited with code ${String(exit.code)}${exit.signal === null ? "" : ` (signal ${exit.signal})`} before printing /${pattern}/. stderr: ${tail(child.error())}`,
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

  /** `null` when the adapter has no stdout signal to offer — never `false`, which would read as "not ready". */
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

  /**
   * One probe must fail fast.
   *
   * The manager owns the retry policy, and it can only own it if a single probe returns. A probe that
   * waited for the whole health budget would make `attempts` a count of one and the retry interval a
   * fiction — the deadline would be spent inside the first call.
   */
  #probeTimeoutMs(): number {
    return Math.max(1_000, this.#plan.health.intervalMs);
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment has not been created; call create() first");
    }
    if (this.#id !== id) {
      // A manager driving two environments, or a stale handle. Cheap to catch, and catching it beats
      // watching one application's output appear in another's evidence.
      throw new EnvironmentError(`this environment is \`${this.#id}\`, but it was addressed as \`${id}\``);
    }
  }
}

function noSnapshot(strategy: string, snapshotId?: string): string {
  const subject = snapshotId === undefined ? "a snapshot" : `snapshot \`${snapshotId}\``;
  return (
    `the local-web adapter cannot restore ${subject}: it brings up a process and drives a browser, and neither can be ` +
    `photographed and put back. reset.strategy is \`${strategy}\`, which asks for exactly that. Use \`restart\`, which is a ` +
    "real reset - a new process with none of the previous run's memory in it - rather than a reset in name only."
  );
}
