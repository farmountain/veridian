/**
 * The sixth world: a provider account. And the third one that is explicitly *simulated*.
 *
 * ## What the subject is
 *
 * Every world before this one had a subject that a process could be pointed at. `local-web`'s is a
 * page, `local-db`'s is a file, `sim-k8s`'s is a cluster, `sim-posix`'s is an operating system and
 * `sim-os`'s is a machine. This world's subject is an **account**: a set of buckets, objects, queues,
 * secrets, principals, policies and meters that some other company holds on the application's behalf.
 * Nothing about it is a process, a socket or a file on this machine - which is exactly why the
 * substitution here is not a convenience but the only way to judge it offline at all.
 *
 * ## Why a simulated account is the point rather than a compromise
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 sets three conditions, and this adapter is where they
 * are met or not:
 *
 * 1. **The application executes for real.** `start.command` is the application's own provisioning
 *    program, run as a child process with the operator's own privileges. It is not a fixture: the
 *    demo's program reads the account's address out of its environment and speaks HTTP to it.
 * 2. **The interfaces are real.** The transport is a real TCP socket, the routes are the provider
 *    API's own paths, and the objects are the provider API's own objects. A criterion's `call` step
 *    goes through the *same* request path the application reaches over the wire - see
 *    `cloud-port.ts`, whose one `#invoke` serves both entry points.
 * 3. **The substitution is declared.** {@link CLOUD_SIMULATED_SURFACES} names every surface that is
 *    not real, and it is written into each reading rather than left for a reader to infer.
 *
 * ## The one thing this world holds that no other does
 *
 * An account is not provisioned by declaring a desired state; it is provisioned **by calls**. A
 * bucket exists because a `PUT` arrived; a policy decides because a request was made and an entry
 * covered it. So the subject of a criterion in this world is often not "what is there" but "**what
 * was asked, and what was answered**" - which is why the `call` step kind exists, why this is the
 * only adapter that performs it and why the four simulated worlds that came before refuse it by
 * name. The refusal is not a limitation to be fixed: a cluster, an operating system, a machine and a
 * filesystem each hold state a manifest, a command or a file write can reach, and none of them holds
 * an account whose contents depend on which requests arrived.
 *
 * ## What this world is *not* allowed to do
 *
 * It may not report a verdict the simulation cannot justify. It has no credential exchange, no
 * signing, no eventual consistency, no quota and no bill; it can never say "this would have been
 * denied by IAM" or "this would have cost eleven dollars on a real account". It can say only what
 * *this* substitute did, and every reading names the account, the region and the declared principal
 * it did it as, because the first question asked of a cloud result is *whose account*, and a
 * substitute answering on `127.0.0.1` must be visibly a substitute rather than an unnamed real one.
 *
 * ## Why there is no path in the plan, and why that matters
 *
 * Every other world's plan carries one: `appPath` is deployed, `databasePath` is rebuilt,
 * `imagesPath` is resolved, `root` is substituted. This one carries **four declaration facts and no
 * path at all** - `provider`, `region`, `account`, `principal` - because an account has no
 * directory. That is not a missing field; it is the difference between a world that lives on this
 * machine and a world that lives somewhere else, and it is why nothing in this file resolves a path
 * except the snapshot directory Veridian keeps for its own bookkeeping.
 *
 * ## Why the refusals are refusals
 *
 * A world with no `cloud` declaration has no account, region or principal to judge as, so every
 * criterion built on it would be judged against an empty substitute that answered "nothing is there"
 * - indistinguishable from a genuine provisioning failure. A world with no `start.command` has no
 * provisioner, and the interesting question ("did the software provision its own account
 * correctly?") would be answered by whatever happened to be in the substitute from a previous run.
 * Both are refused in `create()`, before anything runs, so the failure names the missing field
 * rather than arriving as a criterion reporting an absent bucket in the middle of a run.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import {
  CLOUD_OBSERVATION_KIND,
  CLOUD_SIMULATED_SURFACES,
} from "../../core/environment/cloud-observation.ts";
import type { CloudObservationData } from "../../core/environment/cloud-observation.ts";
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
import { COST_MODEL, httpCloud, targetProblem } from "./cloud-port.ts";
import type { CloudIdentity, CloudPort } from "./cloud-port.ts";

export interface SimCloudEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The substitute account. Injected so the adapter's own behaviour can be tested without a socket. */
  readonly cloud?: CloudPort;
  /** How long the application's provisioning program may take. Generous: it is a one-off, not a retry. */
  readonly deployTimeoutMs?: number;
}

/**
 * The environment variables a cloud world hands its application.
 *
 * They exist because none of the four is knowable from the application directory. The address is
 * chosen by the OS the moment the socket is bound, so the document cannot state it, and a hard-coded
 * port would make two runs on one machine collide; the region, the account and the principal are
 * facts about *which account* the provisioner is talking to, and a program that guessed them would
 * be provisioning somebody else's.
 *
 * They are named `VERIDIAN_CLOUD_*` rather than `AWS_*`, `AZURE_*` or `GCP_*` on purpose. A real
 * provider would give the application credentials and an endpoint, and this world has neither;
 * borrowing the real ecosystem's variable names would invite the application to reach for an SDK,
 * which would then try to authenticate against a service that does not exist - and the resulting
 * failure would be blamed on the application. The demo's provisioner uses plain `fetch` against
 * `VERIDIAN_CLOUD_API` and nothing else, because that is the only thing this world offers.
 *
 * Note what is *absent*: there is no `VERIDIAN_CLOUD_ROOT`, no directory and no file. Contrast
 * {@link CLUSTER_ENV} in `sim-k8s`, which carries an `IMAGES` directory, and `sim-os`'s pair of
 * spellings for one path. An account has no path, and inventing one would be the first step toward
 * a criterion that reads this machine while claiming to read the account.
 */
export const CLOUD_ENV = {
  api: "VERIDIAN_CLOUD_API",
  provider: "VERIDIAN_CLOUD_PROVIDER",
  region: "VERIDIAN_CLOUD_REGION",
  account: "VERIDIAN_CLOUD_ACCOUNT",
  principal: "VERIDIAN_CLOUD_PRINCIPAL",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_CLOUD =
  "this world has no `cloud` declaration, and the sim-cloud adapter stands in for a provider " +
  "account - add `cloud: { provider, region, account, principal }` to the environment document, or " +
  "use an adapter whose world is a process, a file or a system";

const MISSING_PROVISION_COMMAND =
  "this world declares no `start.command`, and the sim-cloud adapter will not judge an account it " +
  "did not let the application provision - an account holding objects from an earlier run is not the " +
  "world this contract describes";

/**
 * The identity the injected port is built with when the document declares none.
 *
 * Unreachable, and it is a named constant rather than an inline literal so that a reader can see it
 * is unreachable: `create()` refuses a plan with no `cloud` before anything calls `listen()` or
 * `call()`, and the manager abandons the run at that refusal. It exists only because the port is
 * constructed in the constructor, which runs before `create()` has had its chance to refuse.
 *
 * `"unset"` rather than an empty string because `httpCloud` refuses blank fields, and a refusal
 * raised by the port would be a sentence about a constructor argument - a far worse place to be told
 * what is missing than the `MISSING_CLOUD` message `create()` raises, which names the field the
 * operator has to add.
 */
const PLACEHOLDER_IDENTITY: CloudIdentity = {
  provider: "unset",
  region: "unset",
  account: "unset",
  principal: "unset",
};

export class SimCloudEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-cloud";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #cloud: CloudPort;
  readonly #deployTimeoutMs: number;
  readonly #stateDir: string;

  #id: string | null = null;
  /** The address the substitute account is really bound to, once `start()` has bound it. */
  #api: string | null = null;
  /** Whether this world's provisioning program has run in *this* environment's lifetime. */
  #deployed = false;
  /** The provisioning program's combined output, kept so `probe()` can answer truthfully. */
  #deployOutput: string | null = null;

  /**
   * Every criterion request this world refused because it named a host this world does not serve.
   *
   * A real, reachable reach, not a hypothetical one. A `call` step names a path, and a path of
   * `http://elsewhere.example/v1/metering` would make the criterion put a request to somebody else's
   * account while reporting a verdict about this one - and the *application* could never have made
   * that request, because it holds this world's address and nothing else. It is refused by the port
   * and recorded here for the same reason `sim-k8s` records a manifest outside the application
   * directory.
   *
   * `reset()` deliberately does not clear it: a reset restores the world; it does not restore the
   * record. An iteration that reached outside the boundary must not be followed by a clean one that
   * reports `PASS`, with the evidence of the violation destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: SimCloudEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#cloud = options.cloud ?? httpCloud(plan.cloud ?? PLACEHOLDER_IDENTITY);
    this.#deployTimeoutMs = options.deployTimeoutMs ?? 120_000;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    const cloud = this.#plan.cloud;
    if (
      cloud === null ||
      cloud.provider === "" ||
      cloud.region === "" ||
      cloud.account === "" ||
      cloud.principal === ""
    ) {
      throw new EnvironmentError(MISSING_CLOUD);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_PROVISION_COMMAND);

    // Keyed on the account, not on the principal: the account is what the criteria are about, and two
    // runs against one account under two principals are two looks at one world.
    if (this.#id === null) this.#id = `sim-cloud:${cloud.account}`;
    this.#logger.debug("environment.create", {
      id: this.#id,
      provider: cloud.provider,
      region: cloud.region,
      account: cloud.account,
      principal: cloud.principal,
    });
    return { id: this.#id };
  }

  /**
   * Bring the world up: bind the account, then let the application provision itself into it.
   *
   * The order is the whole design. The account has to be answering *before* the provisioning program
   * starts, because that program is going to make real HTTP requests to it - and the address is only
   * known once the socket is bound, which is why it travels to the process through {@link CLOUD_ENV}
   * rather than through the document.
   *
   * `port: 0` rather than a fixed port: two runs on one machine must not collide, and a test suite
   * that ran in parallel would otherwise fail for a reason that has nothing to do with the code under
   * test.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    const url = await this.#cloud.listen({ host: "127.0.0.1", port: 0 });
    this.#api = url;
    this.#logger.debug("environment.start", { id, apiServer: url });
    await this.#deployApplication();
    this.#deployed = true;
  }

  /**
   * Nothing left to copy: the application provisioned *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do"
   * from "not done" - and so the recorded note can say which command did the provisioning, which is
   * the fact a reader of `environment.json` actually wants when a bucket is missing.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note:
        "the application's own provisioning program made its calls during start(); this world " +
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
   * Readiness is a verdict this world reached by asking, not a status code it invented.
   *
   * `ok: true` means the account really answered a real `GET /v1/version` over a real socket and
   * really declared which surfaces it substitutes. Anything less is `ok: false` carrying the
   * transport's own words, because a probe may only name a cause it observed - and "the account is
   * not answering" is not the same failure as "the application never provisioned it".
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const api = this.#api;
    if (api === null) {
      return {
        ok: false,
        statusCode: null,
        message: "the substitute provider account is not listening",
        patternSeen: null,
      };
    }
    const patternSeen = this.#patternSeen();
    try {
      const response = await fetch(`${api}/v1/version`);
      const body: unknown = await response.json();
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          message: `the substitute provider account answered ${String(response.status)} to GET /v1/version`,
          patternSeen,
        };
      }
      const simulated =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)["simulated"]
          : null;
      if (!Array.isArray(simulated)) {
        return {
          ok: false,
          statusCode: response.status,
          message: "the account answered GET /v1/version without declaring which surfaces it substitutes",
          patternSeen,
        };
      }
      return { ok: true, statusCode: response.status, message: null, patternSeen };
    } catch (error) {
      return { ok: false, statusCode: null, message: describe(error), patternSeen };
    }
  }

  /**
   * Photograph the account's *stored* facts - not the meters.
   *
   * A meter is a conclusion this world reaches from the record, and freezing it would restore an
   * account that still believed in calls it no longer holds - which is precisely the state a reset
   * exists to leave behind. The port's `dump()` says the same thing at length, and carries the stored
   * secret values because a restored account that could not serve them would be a different account.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    if (!this.#deployed) {
      throw new EnvironmentError("this environment has not been started; there is nothing to snapshot");
    }
    const name = `sim-cloud-${String(Date.now())}.account.json`;
    const dir = this.#snapshotsDir();
    await this.#io.mkdirp(dir);
    await this.#io.writeTextFile(`${dir}/${name}`, this.#cloud.dump());
    this.#logger.debug("environment.snapshot", { id, snapshot: name });
    return name;
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    const path = `${this.#snapshotsDir()}/${snapshotId}`;
    const state = await this.#io.readTextFile(path);
    if (state === null) throw new EnvironmentError(`there is no snapshot \`${snapshotId}\` to restore`);
    this.#cloud.load(state);
    this.#logger.debug("environment.restore", { id, snapshot: snapshotId });
  }

  /**
   * Reset is first-class, and for an account world "restarting" means an empty account and a fresh
   * provisioning run.
   *
   * `restart` clears the account, re-binds the substitute and runs the application's provisioning
   * program again - which is what an account reset means for the application, because a bucket has to
   * be put back by the thing that put it there. Clearing without re-provisioning would leave an empty
   * account and a run that reports every bucket missing, which reads like an application defect and
   * is an artifact of the reset.
   *
   * `snapshot-restore` is refused **by name**, and the refusal is worth reading because this world is
   * one of the two that *can* restore a snapshot. It is not that a restore is impossible: a
   * `snapshot-restore` plan never reaches this method at all - `EnvironmentManager.reset()` calls
   * `restore()` with the baseline it took after the provisioner ran, and only `restart` and `custom`
   * arrive here. So a caller that asked this method for a restore is asking for something the
   * baseline protocol carries elsewhere, and quietly restarting the provisioner instead would hand
   * back an account that had *moved* since the baseline - a different world from the one asked for.
   *
   * The call record and the decisions are deliberately not cleared, and neither is
   * {@link SimCloudEnvironment.#crossings}. They accumulate for the whole run: a reset restores the
   * world, not the record of what the run did to it. Clearing any of them would destroy the evidence
   * of a violation - a criterion reading a foreign host, or an access the account refused - by the
   * very act of repairing it.
   *
   * The account's **meter** is the one thing that does start over, and the port owns that decision
   * rather than this method: `meters()` is a reading of the account's current life, so a criterion
   * asking what this application provisioned is answered by this attempt's writes instead of by the
   * totals of every attempt before it. The record the reading is derived from is untouched, so
   * nothing an auditor needs is dropped. A `custom` reset is the exception, and honestly so: the
   * command names what resetting means for that world, and this method has nothing to read from it.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        "reset.strategy is `snapshot-restore`, and this world restores a baseline through `restore()` " +
          "on the snapshot the manager takes after the provisioner has run - `reset()` is not that " +
          "path. Restarting the provisioner instead would hand back an account that has moved since " +
          "the baseline was taken, which is not the world that was asked for",
      );
    }

    // The address is injected into the reset command too, and it is the *same* address the running
    // account answers on, so a command that provisions through the environment can do so here. It has
    // to be re-read rather than cached: nothing about a failing reset command changes the binding.
    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#cloudEnv(),
          onStdout: (chunk) => this.#logger.debug("reset.stdout", { chunk: chunk.trimEnd() }),
          onStderr: (chunk) => this.#logger.warn("reset.stderr", { chunk: chunk.trimEnd() }),
        },
        this.#deployTimeoutMs,
      );
      if (result.timedOut || result.code !== 0) {
        throw new EnvironmentError(
          result.timedOut
            ? `the reset command \`${command}\` did not finish within ${String(this.#deployTimeoutMs)}ms`
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
        note: "a custom strategy was requested without a command; falling back to restarting the account",
      });
    }

    this.#cloud.clear();
    await this.#cloud.close();
    const url = await this.#cloud.listen({ host: "127.0.0.1", port: 0 });
    this.#api = url;
    await this.#deployApplication();
    this.#logger.debug("environment.reset", { id, strategy: "restart", apiServer: url });
  }

  async stop(id: string): Promise<void> {
    this.#requireId(id);
    await this.#cloud.close();
    this.#api = null;
    this.#logger.debug("environment.stop", {
      id,
      note: "the substitute provider account has been closed",
    });
  }

  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.#cloud.close();
    this.#deployed = false;
    this.#id = null;
    this.#api = null;
    this.#deployOutput = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    if (!this.#deployed) {
      throw new EnvironmentError("this environment has not been started; call start() before observing it");
    }
    const base = {
      kind: CLOUD_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a world it never acted on, which is a verdict the observation cannot justify.
      const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
      const unsupported = act ? steps.findIndex((step) => step.kind !== "call") : -1;
      if (unsupported !== -1) {
        const step = steps[unsupported];
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "VALIDATOR_ERROR",
            `the sim-cloud adapter performs \`call\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the ` +
              "criterion would be judged against an account it never put a request to",
          ),
        };
      }

      if (act) {
        for (const step of steps) {
          if (step.kind !== "call") continue;
          const refused = this.#call(step, request.criterionId);
          if (refused !== null) return { ...base, data: null, artifacts: [], error: refused };
        }
      }

      const reading = this.#cloud.snapshot();
      const data: CloudObservationData = {
        api: this.#api ?? "unbound",
        provider: this.#provider(),
        region: this.#region(),
        account: this.#account(),
        principal: this.#principal(),
        simulated: CLOUD_SIMULATED_SURFACES,
        costModel: COST_MODEL,
        calls: this.#cloud.calls(),
        buckets: reading.buckets,
        objects: reading.objects,
        queues: reading.queues,
        secrets: reading.secrets,
        principals: reading.principals,
        decisions: this.#cloud.decisions(),
        meters: this.#cloud.meters(),
      };

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
   * `unsupported` for both, and not silently - including for the filesystem, where it is not an
   * adapter limitation but a fact about the world. An account holds **no files**: there is no
   * directory to write to, no path in the plan to resolve and no `write` step kind this adapter
   * performs. Reporting `enforced` there would name a guard that does not exist, and reporting it as
   * `not-requested` would suggest the policy was honoured when there is nothing for it to be true of.
   *
   * The network policy is the one a reader might expect better of, because a cloud account *is* where
   * a network boundary belongs. But nothing here enforces which hosts the application reaches: the
   * provisioner runs as an ordinary child process and can open any socket it likes, and the guard
   * this world really does hold is over a *criterion's* `call` target - it stops a criterion putting
   * a request somewhere else, not the application reaching somewhere else. Reporting `enforced` on
   * the strength of that would be the exact overclaim the boundary path exists to remove, which is
   * why the crossings list is reported beside the two policies rather than instead of them.
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
   * that came from here and evidence for a judgement has to be in the bundle (M5). An account world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: CloudObservationData,
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

    if (data.decisions.length > 0) {
      // The account's own reasoning, on its own, because this is the artifact a human reads when an
      // access criterion failed: "the principal was refused" leaves the reader guessing, and the
      // deciding entry - the statement that covered the action and the resource, or the fact that
      // none did - does not. Written only when there is one: an account that made no decision has no
      // narrative, and an empty file would be an artifact that says nothing while counting as one.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.decisions.json`,
        "json",
        `${JSON.stringify(data.decisions, null, 2)}\n`,
      );
    }

    // Only the kinds this call did *not* write are worth a warning, and the set is read off the
    // artifacts rather than from a literal list beside them. The literal was here first, in two other
    // adapters, and it was wrong in the one direction that matters: the loop warned for `json` while
    // holding a `json` artifact it had written two lines above, so every criterion reported "produces
    // `json` and cannot produce `json`". A second list would be free to disagree with the writes;
    // derived from them it cannot.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the sim-cloud adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- calling --------------------------------------------------------------------------------

  /**
   * Put one criterion request to the account, and refuse one addressed to a host this world is not.
   *
   * The refusal is the whole point of the guard, and it is deliberately narrow. It does not claim
   * this world has a network boundary - `boundaries()` reports `unsupported` - it claims only that a
   * request addressed elsewhere is a request **the application could never have made**, because the
   * application holds this world's address and nothing else. A verdict reached from an answer given
   * by somebody else's account is not a verdict about this one.
   *
   * The predicate is `targetProblem`, imported from the port rather than re-expressed here. That is
   * not tidiness: the port refuses the same targets on its own request path, and two copies of the
   * rule would disagree the first time one was extended - with the copy in this file then recording a
   * crossing the port did not refuse, or the port refusing a target this file never saw. One
   * function, two callers, and a test in the port's own suite that holds the agreement.
   *
   * Note that the request is *also* recorded by the port, in the ordinary way, before this returns:
   * the refusal is an observation a criterion may be built on, and the reading keeps it. The crossing
   * is the separate fact that the run reached outside its boundary, which is what the loop reads.
   */
  #call(
    step: { readonly method: string; readonly path: string; readonly body: string | null },
    criterionId: string,
  ): Observation["error"] {
    const problem = targetProblem(step.path);
    if (problem !== null) {
      this.#crossings.push({
        boundary: "network",
        subject: `call ${step.method} ${step.path}`,
        criterionId,
        at: this.#clock.iso(),
      });
      return failure(
        "SECURITY_VIOLATION",
        `${problem} - a criterion may only put requests to the account it is being judged in, and the ` +
          "application could never have made this one",
      );
    }

    const outcome = this.#cloud.call(
      { method: step.method, path: step.path, body: step.body },
      "criterion",
    );
    if (outcome.result === "error") {
      // Recorded, not thrown: the world itself failed rather than answering, and a criterion built on
      // the answer would silently judge a request that got no reply. Warned as well, because a
      // contract whose `call` step never read the outcome would otherwise pass on an account that
      // answered nothing, with an empty log to explain it.
      this.#logger.warn("environment.call", {
        criterionId,
        method: step.method,
        path: step.path,
        status: outcome.status,
        reason: outcome.reason,
        note: "this world failed to answer; the failure is in the reading's call record",
      });
    }
    return null;
  }

  // ---- the application ------------------------------------------------------------------------

  /**
   * Run the application's own provisioning program against the live substitute account.
   *
   * The environment variables are injected rather than taken from the document, and {@link CLOUD_ENV}
   * says why: the address is decided by `listen()`, which happens immediately before this call.
   *
   * Four checks, and each one exists because its absence would be blamed on the application:
   *
   *  - the program finished inside the budget, because a provisioning run that hangs would otherwise
   *    be reported as every criterion timing out one at a time;
   *  - it exited zero, because a program that failed and left a partly-provisioned account is not a
   *    world a contract about a complete account can be judged in;
   *  - the declared `readyPattern` really appeared, because that is the only signal the application
   *    itself gives that it finished rather than merely stopped;
   *  - and the account holds at least one request from the application. That last one is this world's
   *    version of `sim-k8s`'s "the registry the substitution reads is the application's own build
   *    output": the substitute holds exactly what the provisioner put in it, so a program that exited
   *    zero without making a single call has provisioned nothing, and every criterion would then
   *    report an absent bucket for a reason that is not the application's fault - an environment
   *    failure, refused here rather than left to surface as a mysterious empty account.
   */
  async #deployApplication(): Promise<void> {
    const { command, args, readyPattern } = this.#plan.start;
    const env = this.#cloudEnv();
    this.#logger.info("environment.deploy.application", {
      command,
      args,
      cwd: this.#plan.appPath,
      apiServer: this.#api,
      region: this.#region(),
      account: this.#account(),
    });

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env,
        onStdout: (chunk) => this.#logger.debug("deploy.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("deploy.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#deployTimeoutMs,
    );

    // Kept whatever happened next, including on a timeout: the partial output of a program that never
    // finished is the evidence that explains why, and `probe()` reports the readiness signal from
    // here rather than declining to look at the one thing it was given.
    this.#deployOutput = `${result.stdout}\n${result.stderr}`;

    if (result.timedOut) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) did not finish within ` +
          `${String(this.#deployTimeoutMs)}ms`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) exited with code ` +
          `${String(result.code)}: ${tail(result.stderr)}`,
      );
    }
    if (readyPattern !== null && !new RegExp(readyPattern).test(this.#deployOutput)) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) never printed /${readyPattern}/; ` +
          `output: ${tail(result.stdout)}`,
      );
    }

    const made = this.#cloud.calls().filter((record) => record.source === "application").length;
    if (made === 0) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) exited successfully and put no ` +
          "request to the account at all - the substitute holds exactly what the application asked " +
          "it to hold, and with nothing asked every criterion about this account would report an " +
          "absent resource that the application never tried to create",
      );
    }
  }

  #cloudEnv(): Readonly<Record<string, string>> {
    return {
      ...this.#plan.env,
      [CLOUD_ENV.api]: this.#requireApi(),
      [CLOUD_ENV.provider]: this.#provider(),
      [CLOUD_ENV.region]: this.#region(),
      [CLOUD_ENV.account]: this.#account(),
      [CLOUD_ENV.principal]: this.#principal(),
    };
  }

  #snapshotsDir(): string {
    return `${this.#stateDir}/snapshots`;
  }

  /**
   * Whether the definition's stdout readiness signal was really seen, or `null` when nothing has run.
   *
   * `null` means *this adapter does not observe stdout at all*, and this one does: it runs the
   * application's provisioning program as a child process and compares the program's own output to
   * the declared pattern two methods above. Reporting `null` for a signal it either saw or did not
   * would be the readiness check declining to look at the one thing it was given - and it is the same
   * value the manager's readiness gate reads, because the loader takes both `plan.start.readyPattern`
   * and `plan.health.readyPattern` from the single declaration the operator wrote.
   */
  #patternSeen(): boolean | null {
    if (this.#deployOutput === null) return null;
    const pattern = this.#plan.start.readyPattern;
    if (pattern === null) return true;
    return new RegExp(pattern).test(this.#deployOutput);
  }

  /** The declaration, or a refusal naming what is missing. Resolved through one door so no two readers disagree. */
  #declared(): NonNullable<EnvironmentPlan["cloud"]> {
    const cloud = this.#plan.cloud;
    if (cloud === null) throw new EnvironmentError(MISSING_CLOUD);
    return cloud;
  }

  #provider(): string {
    return this.#declared().provider;
  }

  #region(): string {
    return this.#declared().region;
  }

  #account(): string {
    return this.#declared().account;
  }

  #principal(): string {
    return this.#declared().principal;
  }

  #requireApi(): string {
    const api = this.#api;
    if (api === null) throw new EnvironmentError("the substitute provider account is not listening");
    return api;
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
