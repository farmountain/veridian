/**
 * The third world: a cluster. And the first one that is explicitly *simulated*.
 *
 * ## Why a simulated world is the point rather than a compromise
 *
 * The scope boundary forbids Veridian from becoming a Kubernetes management platform, and a laptop
 * cannot run a real control plane, a scheduler, a kubelet and a container runtime inside a 1.3-second
 * test suite. What a laptop *can* run is a real HTTP server that speaks the API's own routes, a real
 * child process that really talks to it, and a real decision about whether an image exists - and that
 * is enough to reproduce a genuine Kubernetes failure offline.
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 sets three conditions, and this adapter is where they
 * are met or not:
 *
 * 1. **The application executes for real.** `start.command` is the application's own deploy program,
 *    run as a child process with the operator's own privileges. It is not a fixture and not a
 *    simulation of one: the demo's program reads the cluster address out of its environment, speaks
 *    HTTP to the substitute API server, submits real objects and prints what came back.
 * 2. **The interfaces are real.** The transport is a real TCP socket, the routes are the API's own
 *    paths, the objects are the API's own objects, and a malformed request gets the API's own `422`.
 *    An application that works against this server works against a cluster for every request it made
 *    here.
 * 3. **The substitution is declared.** {@link K8S_SIMULATED_SURFACES} names every surface that is not
 *    real, and it is written into each reading rather than left for a reader to infer. This is the
 *    condition that makes the difference between a simulated world and a fake one, and it is why
 *    `simulated` is a field of the reading rather than a paragraph in this comment.
 *
 * ## What this world is *not* allowed to do
 *
 * It may not report a verdict the simulation cannot justify. The substitute has no scheduler, so it
 * can never say "this rollout would have succeeded on a real cluster"; it can only say "this object
 * was accepted by this server and the image this world was told about was not among the ones the
 * application built". Every reading carries the namespace it came from, the cluster name the document
 * declared, and the address of the server that answered - because the first question asked of a
 * cluster result is *which* cluster, and a substitute answering on `127.0.0.1` must be visibly a
 * substitute rather than an unnamed one.
 *
 * ## Why the three refusals are refusals
 *
 * A cluster world with no `cluster` declaration has no namespace to read and no registry to resolve,
 * so every criterion built on it would be judged against an empty substitute that answered "nothing
 * is there" - which is indistinguishable from a genuine rollout failure. A world with no
 * `start.command` has no application, and the interesting question ("did the software deploy itself
 * correctly?") would be answered by whatever happened to be in the cluster from a previous run. Both
 * are refused in `create()`, before anything runs, so the failure names the missing field rather than
 * arriving as a timeout in the middle of a run.
 */

import { isAbsolute, relative } from "node:path";

import { parse as parseYaml } from "yaml";

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { K8S_OBSERVATION_KIND, K8S_SIMULATED_SURFACES } from "../../core/environment/k8s-observation.ts";
import type { K8sObservationData } from "../../core/environment/k8s-observation.ts";
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
import { httpCluster } from "./cluster-port.ts";
import type { ClusterPort } from "./cluster-port.ts";

export interface SimK8sEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The control plane. Injected so the adapter's own behaviour can be tested without a socket. */
  readonly cluster?: ClusterPort;
  /** How long the application's deploy program may take. Generous: it is a one-off, not a retry. */
  readonly deployTimeoutMs?: number;
}

/**
 * The environment variables a cluster world hands its application.
 *
 * They exist because the address of the control plane is **not knowable when the document is
 * written**. A port is chosen by the OS the moment it is bound, so the document cannot state it, and
 * a hard-coded port would make two runs on one machine collide. Where `local-db` can let the operator
 * write `DATABASE_PATH` in `environment.yaml`, this adapter has to inject the address at run time -
 * and it injects the namespace and the registry directory alongside it for the same reason, so the
 * application never has to guess which cluster it is talking to.
 *
 * They are named `VERIDIAN_CLUSTER_*` rather than `KUBERNETES_*` on purpose. A real cluster would
 * give the application a `KUBECONFIG`, and this world does not have one; borrowing the real
 * ecosystem's variable names would invite the application to behave as though it had been given a
 * cluster, which is the one thing a simulated world must not do.
 */
export const CLUSTER_ENV = {
  api: "VERIDIAN_CLUSTER_API",
  namespace: "VERIDIAN_CLUSTER_NAMESPACE",
  images: "VERIDIAN_CLUSTER_IMAGES",
} as const;

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_CLUSTER =
  "this world has no `cluster` declaration, and the sim-k8s adapter stands in for a cluster - " +
  "add `cluster: { name, namespace, images }` to the environment document, or use an adapter whose " +
  "world is a process on a port";

const MISSING_DEPLOY_COMMAND =
  "this world declares no `start.command`, and the sim-k8s adapter will not judge a cluster it did " +
  "not let the application deploy into - a cluster holding objects from an earlier run is not the " +
  "world this contract describes";

export class SimK8sEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-k8s";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #cluster: ClusterPort;
  readonly #deployTimeoutMs: number;
  readonly #stateDir: string;

  #id: string | null = null;
  #images: string | null = null;
  /** The address the substitute API server is really bound to, once `start()` has bound it. */
  #api: string | null = null;
  /** Whether this world's deploy program has run in *this* environment's lifetime. */
  #deployed = false;

  /**
   * Every manifest this world refused because it lay outside the application directory.
   *
   * A real, reachable escape, not a hypothetical one: an `apply` step names a path, and a path of
   * `../../../../etc/passwd` would make the criterion read a file that has nothing to do with the
   * world it is being judged in - and, since a manifest is *submitted*, would let an acceptance
   * contract hand arbitrary content to the substitute API server. It is refused, and the refusal is
   * recorded for the same reason the web adapter keeps its network crossings.
   *
   * `reset()` deliberately does not clear it: a reset restores the world; it does not restore the
   * record. An iteration that reached outside the boundary must not be followed by a clean one that
   * reports `PASS`, with the evidence of the violation destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: SimK8sEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#cluster = options.cluster ?? httpCluster(plan.cluster?.imagesPath ?? ".");    this.#deployTimeoutMs = options.deployTimeoutMs ?? 120_000;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    const cluster = this.#plan.cluster;
    if (cluster === null || cluster.name === "" || cluster.namespace === "" || cluster.imagesPath === "") {
      throw new EnvironmentError(MISSING_CLUSTER);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_DEPLOY_COMMAND);

    if (this.#id === null) this.#id = `sim-k8s:${cluster.namespace}`;
    this.#images = cluster.imagesPath;
    this.#logger.debug("environment.create", {
      id: this.#id,
      cluster: cluster.name,
      namespace: cluster.namespace,
      images: this.#images,
    });
    return { id: this.#id };
  }

  /**
   * Bring the world up: bind the control plane, then let the application deploy itself into it.
   *
   * The order is the whole design. The cluster has to be answering *before* the application's deploy
   * program starts, because the application is going to make real HTTP requests to it - and the
   * address is only known once the socket is bound, which is why the address travels to the process
   * through {@link CLUSTER_ENV} rather than through the document.
   *
   * `port: 0` rather than a fixed port: two runs on one machine must not collide, and a test suite
   * that ran in parallel would otherwise fail for a reason that has nothing to do with the code under
   * test.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    const url = await this.#cluster.listen({ host: "127.0.0.1", port: 0 });
    this.#api = url;
    this.#logger.debug("environment.start", { id, apiServer: url });
    await this.#deployApplication();
    this.#deployed = true;
  }

  /**
   * Nothing left to copy: the application deployed *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do"
   * from "not done" - and so the recorded note can say which command did the deploying, which is the
   * fact a reader of `environment.json` actually wants when a rollout went wrong.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note:
        "the application's own deploy program submitted its objects during start(); this world " +
        "deploys nothing on the application's behalf",
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
   * `ok: true` means the control plane really answered a real `GET /version` over a real socket and
   * really declared which surfaces it substitutes. Anything less is `ok: false` carrying the
   * transport's own words, because a probe may only name a cause it observed - and "the server is
   * not answering" is not the same failure as "the application never deployed".
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const api = this.#api;
    if (api === null) {
      return { ok: false, statusCode: null, message: "the substitute API server is not listening", patternSeen: null };
    }
    try {
      const response = await fetch(`${api}/version`);
      const body: unknown = await response.json();
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          message: `the substitute API server answered ${String(response.status)} to GET /version`,
          patternSeen: null,
        };
      }
      const simulated = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["simulated"] : null;
      if (!Array.isArray(simulated)) {
        return {
          ok: false,
          statusCode: response.status,
          message: "the server answered GET /version without declaring which surfaces it substitutes",
          patternSeen: null,
        };
      }
      return { ok: true, statusCode: response.status, message: null, patternSeen: null };
    } catch (error) {
      return { ok: false, statusCode: null, message: describe(error), patternSeen: null };
    }
  }

  /**
   * Photograph the cluster's *stored objects*.
   *
   * Stored rather than derived, and the port says why at length: a pod's phase and an event's count
   * are conclusions the server reaches from the objects plus the registry. Freezing conclusions would
   * restore a cluster that still believed in the image it was built from, which is precisely the
   * state a reset exists to leave behind.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    if (!this.#deployed) throw new EnvironmentError("this environment has not been started; there is nothing to snapshot");
    const name = `sim-k8s-${String(Date.now())}.cluster.json`;
    const dir = this.#snapshotsDir();
    await this.#io.mkdirp(dir);
    await this.#io.writeTextFile(`${dir}/${name}`, this.#cluster.dump());
    this.#logger.debug("environment.snapshot", { id, snapshot: name });
    return name;
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    const path = `${this.#snapshotsDir()}/${snapshotId}`;
    const state = await this.#io.readTextFile(path);
    if (state === null) throw new EnvironmentError(`there is no snapshot \`${snapshotId}\` to restore`);
    this.#cluster.load(state);
    this.#logger.debug("environment.restore", { id, snapshot: snapshotId });
  }

  /**
   * Reset is first-class, and for a cluster world "restarting" means an empty cluster and a fresh
   * deploy.
   *
   * `restart` clears the stored objects, re-binds the control plane and runs the application's deploy
   * program again - which is what a real cluster reset means for the application, because the objects
   * have to be put back by the thing that put them there. Clearing without re-deploying would leave a
   * world that is empty and a run that reports every deployment missing, which reads like an
   * application defect and is an artifact of the reset.
   *
   * The action record is deliberately not cleared. `applies()` accumulates for the whole run and
   * {@link SimK8sEnvironment.#crossings} with it: a reset restores the world, not the record of what
   * the run did to it. Clearing either would destroy the evidence of a violation by repairing it.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        "reset.strategy is `snapshot-restore`, and no snapshot was taken for this reset - take one with " +
          "`snapshot()` before the first criterion, or use `restart`, which empties the cluster and " +
          "lets the application deploy into it again",
      );
    }

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#clusterEnv(),
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
        note: "a custom strategy was requested without a command; falling back to restarting the cluster",
      });
    }

    this.#cluster.clear();
    await this.#cluster.close();
    const url = await this.#cluster.listen({ host: "127.0.0.1", port: 0 });
    this.#api = url;
    await this.#deployApplication();
    this.#logger.debug("environment.reset", { id, strategy: "restart", apiServer: url });
  }

  async stop(id: string): Promise<void> {
    this.#requireId(id);
    await this.#cluster.close();
    this.#api = null;
    this.#logger.debug("environment.stop", { id, note: "the substitute API server has been closed" });
  }

  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.#cluster.close();
    this.#deployed = false;
    this.#id = null;
    this.#images = null;
    this.#api = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    if (!this.#deployed) {
      throw new EnvironmentError("this environment has not been started; call start() before observing it");
    }
    const base = {
      kind: K8S_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a world it never acted on, which is a verdict the observation cannot justify.
      const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
      const unsupported = act ? steps.findIndex((step) => step.kind !== "apply") : -1;
      if (unsupported !== -1) {
        const step = steps[unsupported];
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "VALIDATOR_ERROR",
            `the sim-k8s adapter performs \`apply\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the criterion ` +
              "would be judged in a cluster it never acted on",
          ),
        };
      }

      if (act) {
        for (const step of steps) {
          if (step.kind !== "apply") continue;
          const applied = await this.#apply(step.manifest, request.criterionId);
          if (applied !== null) return { ...base, data: null, artifacts: [], error: applied };
        }
      }

      const namespace = this.#namespace();
      const reading = this.#cluster.snapshot(namespace);
      const data: K8sObservationData = {
        apiServer: this.#api ?? "unbound",
        cluster: this.#clusterName(),
        namespace,
        simulated: K8S_SIMULATED_SURFACES,
        applied: this.#cluster.applies(),
        deployments: reading.deployments,
        pods: reading.pods,
        services: reading.services,
        events: reading.events,
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
   * `unsupported` for both, and not silently.
   *
   * The network policy is the one place a reader might expect better of a cluster world, because a
   * cluster *is* where a network policy belongs. But the substitute enforces nothing: the application
   * runs as an ordinary child process and can open any socket it likes, and a criterion's `apply` step
   * is an in-process call rather than a route the adapter could filter. Reporting `enforced` on the
   * strength of a guard over *manifests* would be an overclaim of exactly the kind the boundary path
   * exists to remove - the guard stops a criterion reading the wrong file, not the application
   * reaching the wrong host.
   *
   * The crossings list is reported even when empty, because its emptiness means one specific thing
   * here - the guard never saw an escape - and a reader has to be able to pair it with the two
   * `unsupported` policies above to see that it is one guard rather than a boundary.
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
   * that came from here and evidence for a judgement has to be in the bundle (M5). A cluster world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: K8sObservationData,
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

    if (data.events.length > 0) {
      // The cluster's own narrative, on its own, because this is the artifact a human reads when a
      // rollout never finished: "0 of 3 pods ready" leaves the reader guessing, and
      // `Warning/Failed` with the image name in it does not.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.events.json`,
        "json",
        `${JSON.stringify(data.events, null, 2)}\n`,
      );
    }

    // Only the kinds this call did *not* write are worth a warning, and the set is read off the
    // artifacts rather than from a literal list beside them. The literal was here first and it was
    // wrong in the one direction that matters: the loop warned for `json` while holding a `json`
    // artifact it had written two lines above, so every criterion reported "produces `json` and cannot
    // produce `json`" - a sentence that contradicts itself, emitted three times per criterion, and a
    // reader who learns to skip these lines has learned to skip the one that is true. A second list
    // would also be free to disagree with the writes; derived from them it cannot.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the sim-k8s adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- applying -------------------------------------------------------------------------------

  /**
   * Put one manifest to the cluster, and refuse one that lies outside the application directory.
   *
   * The refusal is the store of the whole guard, and it is deliberately narrow. It does not claim
   * this world has a filesystem boundary - `boundaries()` reports `unsupported` - it claims only that
   * a manifest read from outside the application is a *different* file from the one the operator is
   * repairing, so a criterion built on it would be judging an artifact the run never touched. That is
   * a real refusal of a real reach, recorded as a crossing so the run cannot pass with it unmentioned.
   *
   * The manifest is parsed as YAML, because Kubernetes manifests are YAML and a world that accepted
   * only JSON would push every operator into a format their own tooling does not produce. One object
   * per file: a multi-document file is refused by the API's own `422` rather than silently taking the
   * first document, because a criterion that judged half a manifest would report a failure nobody
   * could reproduce.
   */
  async #apply(manifest: string, criterionId: string): Promise<Observation["error"]> {
    const root = this.#io.resolve(this.#plan.appPath);
    const absolute = this.#io.resolve(this.#plan.appPath, manifest);
    const within = relative(root, absolute);
    if (within.startsWith("..") || isAbsolute(within)) {
      this.#crossings.push({
        boundary: "filesystemWrite",
        subject: `apply ${manifest}`,
        criterionId,
        at: this.#clock.iso(),
      });
      return failure(
        "SECURITY_VIOLATION",
        `\`${manifest}\` resolves to ${absolute}, which is outside the application directory ` +
          `${root} - a criterion may only submit the manifests the application actually ships`,
      );
    }

    const text = await this.#io.readTextFile(absolute);
    if (text === null) {
      return failure(
        "ENVIRONMENT_FAILURE",
        `there is no manifest at ${absolute}, and step \`apply\` submits a file the application ships`,
      );
    }

    let object: unknown;
    try {
      object = parseYaml(text);
    } catch (error) {
      return failure(
        "APPLICATION_ERROR",
        `the manifest at ${absolute} is not readable as YAML: ${describe(error)}`,
      );
    }

    const record = this.#cluster.submit(this.#namespace(), object, manifest);
    if (record.result === "rejected") {
      // Recorded, not thrown: a refusal is an observation, and a criterion may be built on one. Warned
      // as well, because a contract that applies an object it cannot deploy and never reads the
      // refusal would otherwise pass on an empty cluster with nothing in the log to explain it.
      this.#logger.warn("environment.apply", {
        criterionId,
        manifest,
        reason: record.reason,
        note: "the substitute API server refused this object; the refusal is in the reading",
      });
    }
    return null;
  }

  // ---- the application ------------------------------------------------------------------------

  /**
   * Run the application's own deploy program against the live control plane.
   *
   * The environment variables are injected rather than taken from the document, and
   * {@link CLUSTER_ENV} says why: the address is decided by `listen()`, which happens immediately
   * before this call.
   */
  async #deployApplication(): Promise<void> {
    const { command, args, readyPattern } = this.#plan.start;
    const images = this.#requireImages();
    this.#logger.info("environment.deploy.application", {
      command,
      args,
      cwd: this.#plan.appPath,
      apiServer: this.#api,
      images,
    });

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#clusterEnv(),
        onStdout: (chunk) => this.#logger.debug("deploy.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("deploy.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#deployTimeoutMs,
    );

    if (result.timedOut) {
      throw new EnvironmentError(
        `the application's deploy program (\`${command}\`) did not finish within ${String(this.#deployTimeoutMs)}ms`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `the application's deploy program (\`${command}\`) exited with code ${String(result.code)}: ${tail(result.stderr)}`,
      );
    }
    // A declared readiness pattern is honoured here as it is in the other two adapters: it is the
    // application's own signal that it finished deploying. Checked against the *combined* output,
    // because a deploy program that narrates to stderr is ordinary and a pattern is not a channel.
    if (readyPattern !== null && !new RegExp(readyPattern).test(`${result.stdout}\n${result.stderr}`)) {
      throw new EnvironmentError(
        `the application's deploy program (\`${command}\`) never printed /${readyPattern}/; output: ${tail(result.stdout)}`,
      );
    }
    // The registry the substitution reads is the application's own build output, so a deploy program
    // that built nothing leaves the world unable to answer any question about an image - and would
    // report every deployment as unpullable for a reason that is not the application's fault. That is
    // an environment failure, and it is refused here rather than left to surface as a mysterious
    // `ImagePullBackOff` in a criterion about replicas.
    if (!(await this.#io.exists(images))) {
      throw new EnvironmentError(
        `the application's deploy program (\`${command}\`) exited successfully and left no image ` +
          `directory at ${images} - the substitute registry reads what the application built, and ` +
          "with nothing to read this world would report every manifest as unpullable",
      );
    }
  }

  #clusterEnv(): Readonly<Record<string, string>> {
    return {
      ...this.#plan.env,
      [CLUSTER_ENV.api]: this.#requireApi(),
      [CLUSTER_ENV.namespace]: this.#namespace(),
      [CLUSTER_ENV.images]: this.#requireImages(),
    };
  }

  #snapshotsDir(): string {
    return `${this.#stateDir}/snapshots`;
  }

  /** The namespace this run is scoped to. Resolved once in `create()`, so no two readers can disagree. */
  #namespace(): string {
    const cluster = this.#plan.cluster;
    if (cluster === null) throw new EnvironmentError(MISSING_CLUSTER);
    return cluster.namespace;
  }

  #clusterName(): string {
    const cluster = this.#plan.cluster;
    if (cluster === null) throw new EnvironmentError(MISSING_CLUSTER);
    return cluster.name;
  }

  #requireApi(): string {
    const api = this.#api;
    if (api === null) throw new EnvironmentError("the substitute API server is not listening");
    return api;
  }

  #requireImages(): string {
    const images = this.#images;
    if (images === null) throw new EnvironmentError("this environment has not been created; call create() first");
    return images;
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
