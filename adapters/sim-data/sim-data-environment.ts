/**
 * The `sim-data` adapter: a real application process against a real socket protocol, and no broker.
 *
 * ## What is real, and what is substituted
 *
 * The application is a real child process. This adapter starts it, hands it an address through the
 * environment, and lets it speak a real wire protocol over a real TCP socket on loopback. What is
 * substituted is **the broker**: the socket it reaches, the frames it exchanges and the log it
 * believes it is appending to are held by `data-port.ts`, in this process. There is no Kafka, no
 * ZooKeeper, no commit log on disk and no second machine anywhere in the loop.
 *
 * The substitution is declared rather than implied. Every reading carries
 * `simulated: DATA_SIMULATED_SURFACES`, which names each surface that is stood in for - `broker`,
 * `replication`, `group-coordination`, `log-storage`, `retention`, `transactions` and `partitioning` -
 * so a `PASS` is traceable to a named substitute rather than to unexamined reality. Three things are
 * deliberately *not* on that list, because they are not substituted at all: the socket, the bytes,
 * and the record the client sent.
 *
 * ## The one settled by the design rather than by an absence
 *
 * A topic's reading prints its replication factor beside its in-sync replica list, as in
 * `replication 3 recorded, isr [1]`, and neither half is decoration. A substitute with one node cannot
 * hold three copies of anything, so the factor is what the application *asked for* and is reported as
 * recorded, while the isr is what this world actually has. A reading that printed only the factor
 * would say the topic is three-way replicated when it is not; one that printed only the isr would hide
 * a disagreement between the request and the world. That is the same class of question `sim-container`
 * settles with `(exposed)` and `(declared, not enforced)`: the world's real limits belong in the value
 * the criterion compares, so a comparison cannot assert something the world does not do.
 *
 * ## Why the application speaks the protocol instead of printing command vectors
 *
 * Four of the simulated worlds have the application *print* what it wants done - one JSON array per
 * line on stdout - and the adapter performs it. This world does not, and the reason is its subject: a
 * broker's interface is a socket, so a provisioning program that printed vectors would be *describing*
 * requests rather than making them, and every criterion about what the application asked the log
 * would be judged against a transcript rather than against traffic. The application connects to the
 * address this adapter supplies, speaks `wire.ts`'s framing through `protocol.ts`'s codecs, and the
 * reading carries what really arrived, filed `source: "application"`. `sim-cloud` settled the same
 * question the same way, for the same reason.
 *
 * ## Snapshot and restore
 *
 * This world performs both, and it is the second adapter in the tree that does. The reason is a fact
 * about the subject rather than a convenience: an account's state is *pure* - topics, records, groups
 * and committed offsets, all in this process's memory, with no live child behind any of them. Copying
 * it and putting it back really is a restore. `sim-container` refuses the strategy by name for the
 * opposite reason: a container world holds live children, and a restored container would be a record
 * with no handle behind it.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import { type ConfinementResult } from "../../core/environment/confinement.ts";
import {
  DATA_OBSERVATION_KIND,
  DATA_SIMULATED_SURFACES,
} from "../../core/environment/data-observation.ts";
import type { DataObservationData } from "../../core/environment/data-observation.ts";
import type {
  ArtifactKind,
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
import { tcpData } from "./data-port.ts";
import type { DataPort } from "./data-port.ts";

export interface SimDataEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The substitute broker. Injected so the adapter's own behaviour can be tested without real children. */
  readonly port?: DataPort;
  /** How long the application's provisioning program may take. Generous: it is a one-off, not a retry. */
  readonly provisionTimeoutMs?: number;
}

/**
 * The five names this world declares and publishes to the application it starts.
 *
 * The first two are identity, and the world is the only thing that may state them: a binding that
 * guessed its own cluster name or node id would be answering questions about a broker nobody named.
 *
 * The other three are **one address in two spellings**, and they are all read off the same port call
 * rather than composed here. `HOST` and `PORT` are the halves, because that is what a socket client
 * wants and joining them and splitting them again would be a second grammar for one fact. `BROKER` is
 * the whole in one string, for a log line, a criterion's message, or a program that would rather not
 * join two names. The port is the one of the three the document may not be able to supply: `port: 0`
 * asks the operating system to choose, so the number only exists after `listen()` returns.
 *
 * Unlike `CONTAINER_ENV`, none of these is a path - so there is no split here between a spelling this
 * machine can open and one it cannot. Every one of these five is a fact about a socket that is really
 * bound while the program runs.
 *
 * The application this world ships reads `HOST` and `PORT` and nothing else: a client speaks a protocol
 * over a socket, so the two halves are what it needs and the other three exist so that a log line, a
 * criterion's message or a program that would rather not join two strings does not have to. Both halves
 * of that claim - the five names and the two that are read - are read out of both files by
 * `tests/sim-data-demo.test.ts`, because a sentence claiming what a file does is a claim that drifts.
 */
export const DATA_ENV = Object.freeze({
  cluster: "VERIDIAN_DATA_CLUSTER",
  nodeId: "VERIDIAN_DATA_NODE_ID",
  host: "VERIDIAN_DATA_HOST",
  port: "VERIDIAN_DATA_PORT",
  broker: "VERIDIAN_DATA_BROKER",
} as const);

const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_DATA =
  "this world has no `data` declaration, and the sim-data adapter stands in for a message broker - " +
  "add `data: { cluster, nodeId }` to the environment document, or use an adapter whose world is a " +
  "process on a port or a directory of files";

const MISSING_START_COMMAND =
  "this world declares no `start.command`, and the sim-data adapter will not judge a broker it did " +
  "not let the application provision - a world holding whatever an earlier run left in it is not the " +
  "world this contract describes";

/**
 * The address this world really bound, as the port itself reports it.
 *
 * One field holding three renderings of one fact - the endpoint `listen()` returned, and the two
 * halves `snapshot().node` reads - because all three come from the same port call and a reader must
 * never be able to see two of them disagree. A second field, or a helper that composed the endpoint
 * from the halves, would be a second implementation of one spelling.
 *
 * It is deliberately *not* the declaration. `#data()` holds what the document asked for, where
 * `port: 0` stays `0` because that is what was written; this holds what was chosen instead. Both are
 * logged at bind time, because a log holding only the document's spelling cannot answer "which port
 * did it really use" and a log holding only the bound one cannot be compared with the document the
 * reader is holding.
 */
interface DataAddress {
  readonly endpoint: string;
  readonly host: string;
  readonly port: number;
}

export class SimDataEnvironment implements EnvironmentAdapter {
  readonly kind = "sim-data";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #injected: DataPort | undefined;
  readonly #provisionTimeoutMs: number;
  readonly #stateDir: string;

  #port: DataPort | null = null;
  #id: string | null = null;
  #address: DataAddress | null = null;

  /** Whether this world's application has provisioned it in *this* environment's lifetime. */
  #provisioned = false;
  /** What the application's provisioning program printed, in order. Read by `probe()`, never by a verdict. */
  #provisionOutput: string | null = null;

  /**
   * What the **runner** answered when the application's provisioning program was started, or `null`.
   *
   * Read off the result rather than recomputed here, and that distinction is the whole of the seam:
   * this adapter states *what the world allows*, and only the runner knows what it actually applied.
   */
  #confinement: ConfinementResult | null = null;

  constructor(plan: EnvironmentPlan, options: SimDataEnvironmentOptions) {
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
    const data = this.#plan.data;
    if (data === null || data.cluster === "" || data.host === "") {
      throw new EnvironmentError(MISSING_DATA);
    }
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_START_COMMAND);

    if (this.#id === null) this.#id = `sim-data:${data.cluster}`;
    this.#port =
      this.#injected ??
      tcpData({
        cluster: data.cluster,
        nodeId: data.nodeId,
        host: data.host,
        port: data.port,
      });
    // The declaration, not the address: nothing has been bound yet, and `port: 0` is a *statement*
    // that the port is decided at bind time rather than a hole this adapter should fill in early.
    this.#logger.debug("environment.create", {
      id: this.#id,
      cluster: data.cluster,
      nodeId: data.nodeId,
      host: data.host,
      port: data.port,
      note: "the address as the document declares it; `port: 0` asks the operating system to choose, and start() reports the port that was chosen",
    });
    return { id: this.#id };
  }

  /**
   * Bind the socket, then let the application provision the broker.
   *
   * The order is the design and it is the same design `sim-container` uses: the world has to be
   * listening before the application's program runs, because that program is about to connect to an
   * address this world supplies - and a program that had to start its own broker would be
   * provisioning something that is not the world under test.
   */
  async start(id: string): Promise<void> {
    this.#requireId(id);
    await this.#listen(id);
    this.#logger.debug("environment.start", {
      id,
      note: "the broker is listening and the application's provisioning program is about to run against it",
    });
    await this.#deployApplication(id);
    this.#provisioned = true;
  }

  /**
   * Nothing left to do: the application provisioned *itself* during `start()`.
   *
   * Recorded as an explicit no-op rather than an empty body, so a reader can tell "nothing to do" from
   * "not done" - and so the note can name which command did the provisioning, which is what a reader of
   * `environment.json` wants when a criterion about a missing topic fails.
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note:
        "the application's own provisioning program opened the socket and issued its requests during " +
        "start(); this world creates no topic and produces no record on the application's behalf",
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
   * Three facts, all of them observed: the socket is really bound, the port's own identity names the
   * cluster and node id the document declared, and - when the document declared one - the application's
   * own output matched its readiness pattern. `statusCode` is `null` throughout, because a broker has
   * no status to return over a socket and inventing `200` here would be the substitution claiming an
   * HTTP surface it does not have.
   *
   * The identity check is not a formality even though the port is built from the plan: the port is an
   * injected seam, so a test can hand this adapter a world that answers as somebody else - and that is
   * exactly the case where every reading would describe a broker the contract is not about.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const data = this.#plan.data;
    if (data === null) {
      return { ok: false, statusCode: null, message: MISSING_DATA, patternSeen: null };
    }

    if (this.#address === null) {
      return {
        ok: false,
        statusCode: null,
        message: "the substitute broker is not listening, so this world was never started",
        patternSeen: null,
      };
    }

    const identity = this.#requirePort().identity();
    if (identity.cluster !== data.cluster || identity.nodeId !== data.nodeId) {
      return {
        ok: false,
        statusCode: null,
        message:
          `the broker reports itself as \`${identity.cluster}\` node ${String(identity.nodeId)}, and ` +
          `this document declares \`${data.cluster}\` node ${String(data.nodeId)} - the world holds a ` +
          "different broker's identity than the one this contract is about",
        patternSeen: null,
      };
    }

    const patternSeen = this.#patternSeen();
    if (patternSeen === false) {
      return {
        ok: false,
        statusCode: null,
        message: `the application's provisioning program never printed /${String(this.#plan.start.readyPattern)}/`,
        patternSeen: null,
      };
    }
    return { ok: true, statusCode: null, message: null, patternSeen };
  }

  /**
   * Write down what this world holds, into a file whose name a second run of the same plan produces too.
   *
   * The name is **fixed rather than stamped with the time**, and that is a decision about this world
   * rather than a shortcut. Nothing in the broker reads a clock: no timestamp is taken, no id is
   * drawn from entropy and every listing is sorted, so two identical runs produce byte-identical
   * readings - which is the property M1 measures. `sim-cloud` names its snapshot after `Date.now()`,
   * and for a provider account that is harmless; here it would put the one nondeterministic value in
   * the tree inside the run's own bundle, in a file a reader is meant to compare across runs.
   *
   * A fixed name does mean a second `snapshot()` call replaces the first file. That is deliberate and
   * safe: a run takes exactly one baseline, `EnvironmentManager` holds that one id, and `restore()`
   * reads the file the most recent `snapshot()` wrote - one world, one baseline, in one process.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    if (!this.#provisioned) {
      throw new EnvironmentError("this environment has not been started; there is nothing to snapshot");
    }
    const name = "sim-data.broker.json";
    const dir = this.#snapshotsDir();
    await this.#io.mkdirp(dir);
    await this.#io.writeTextFile(`${dir}/${name}`, this.#requirePort().dump());
    this.#logger.debug("environment.snapshot", { id, snapshot: name });
    return name;
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    const path = `${this.#snapshotsDir()}/${snapshotId}`;
    const state = await this.#io.readTextFile(path);
    if (state === null) throw new EnvironmentError(`there is no snapshot \`${snapshotId}\` to restore`);
    this.#requirePort().load(state);
    this.#logger.debug("environment.restore", { id, snapshot: snapshotId });
  }

  /**
   * Reset is first-class, and for a broker world "restarting" means inhabiting a fresh log.
   *
   * Clearing without re-provisioning would leave a world that is clean and a run that reports every
   * topic absent and every group unknown - which reads like an application defect and is an artifact
   * of the reset. The world's own request record is deliberately *not* cleared: `data.request` is a
   * criterion about what the run did, and a reset that erased it would destroy the evidence of a
   * violation by repairing it. The *meter* is cleared, because a meter counts events in the current
   * life and a bill carried over from the previous world describes two worlds with one number.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        "reset.strategy is `snapshot-restore`, and this world restores a baseline through `restore()` " +
          "on the snapshot `EnvironmentManager` takes after the provisioner has run - `reset()` is not " +
          "that path. This branch is reached only when a caller invokes `reset()` directly with that " +
          "strategy: answering it by rebuilding the log would substitute a different mechanism for the " +
          "one the document asked for, and a rebuild that failed to reproduce the baseline would report " +
          "an application's failure for a world's reason",
      );
    }

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#dataEnv(),
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
        note: "a custom strategy was requested without a command; falling back to rebuilding the log",
      });
    }

    const port = this.#requirePort();
    port.clear();
    await port.close();
    this.#address = null;
    await this.#listen(id);
    await this.#deployApplication(id);
    // Read back through `#requireAddress()` rather than `this.#address?.endpoint`: the assignment to
    // `null` two statements up narrows the field for the rest of the function, and a reader who sees
    // `?.` here would reasonably conclude the address may still be missing. It cannot be - `#listen`
    // either bound the socket or threw - so the accessor states that instead of the optional chain
    // implying otherwise.
    this.#logger.debug("environment.reset", {
      id,
      strategy: "restart",
      endpoint: this.#requireAddress().endpoint,
    });
  }

  /**
   * Close the socket and leave the log in memory.
   *
   * Nothing is deleted, because every artifact a bundle names was written from a reading of this
   * world and a `data.record` failure report quotes a record that was in it. The in-memory log
   * outlives the socket, so a reader can still ask this object what it held; what has ended is the
   * transport, which is what a program on the other end can observe.
   */
  async stop(id: string): Promise<void> {
    this.#requireId(id);
    await this.#requirePort().close();
    this.#address = null;
    this.#logger.debug("environment.stop", {
      id,
      note: "the substitute broker's socket has been closed; the log it held is still in the reading",
    });
  }

  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    await this.#requirePort().close();
    this.#port = null;
    this.#address = null;
    this.#provisioned = false;
    this.#id = null;
    this.#provisionOutput = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    if (!this.#provisioned) {
      throw new EnvironmentError("this environment has not been started; call start() before observing it");
    }
    const base = {
      kind: DATA_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion against a broker it never commanded, which is a verdict the observation cannot
      // justify.
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
            `the sim-data adapter performs \`run\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the ` +
              "criterion would be judged against a broker it never commanded",
          ),
        };
      }

      if (act) {
        const port = this.#requirePort();
        for (const step of steps) {
          if (step.kind !== "run") continue;
          // Synchronous, and it returns the record it filed: the command is performed in process
          // rather than sent over the socket, so there is no frame to wait for. Every record it
          // produces is filed `source: "criterion"`, which is what stops a criterion's own command
          // from satisfying a criterion about the application.
          const record = port.run(step.argv);
          if (record.result === "invalid-request") {
            // A command this world cannot read is the *contract's* own defect rather than the world's
            // decision, so it is warned about.
            this.#logger.warn("environment.run", {
              criterionId: request.criterionId,
              argv: step.argv,
              reason: record.reason,
              note: "this world does not perform that command; the result is in the reading",
            });
          } else if (record.result !== "ok") {
            // Reported at `debug`, not warned about, because a criterion may be built on the world
            // refusing it - and a warning that fires on an expected refusal trains the reader to skip
            // warnings, which is how the one that matters gets skipped.
            this.#logger.debug("environment.run", {
              criterionId: request.criterionId,
              argv: step.argv,
              result: record.result,
              reason: record.reason,
            });
          }
        }
      }

      const port = this.#requirePort();
      const reading = port.snapshot();
      const data: DataObservationData = {
        cluster: reading.cluster,
        node: reading.node,
        simulated: DATA_SIMULATED_SURFACES,
        topics: reading.topics,
        groups: reading.groups,
        requests: port.requests(),
        meter: port.meters(),
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
   * `network` is `unsupported` and not silently. A broker *is* a socket, so the answer a reader might
   * expect better of is this one - but nothing here enforces which hosts the *application* reaches,
   * and `core/environment/confinement.ts` has no network flag to apply, so there is nothing to derive
   * the value from and no measurement that could make it `enforced`. Reporting `enforced` would name
   * a guard that does not exist, and reporting `not-requested` would suggest a policy was honoured
   * when there is nothing for it to be true of.
   *
   * `filesystemWrite` **is a reading and no longer a sentence**. It says `enforced` when the runner
   * measurably confined the application's provisioning child and `unsupported` when it did not,
   * because a literal is wrong in both directions: it reports no boundary for a world whose runtime
   * really did refuse a write outside the application directory, and it would report one for a world
   * that asked for an allowance and was given none.
   *
   * The crossings list is empty, and here that emptiness is one specific statement rather than a
   * field left out: no step kind in this world names a place. A `run` step carries a command vector
   * whose operands are a topic name, a partition index, a key, a value, a group id and an offset, and
   * every one of them resolves against the world's own held state - so `metadata /etc/passwd` asks
   * about a *topic* with that name, which does not exist, and never touches a file. The one address in
   * the world is the socket, and the document's host is held to loopback by the loader, by name,
   * before a world exists.
   */
  boundaries(): BoundaryReport {
    return {
      network: this.#plan.boundary.network === "allow" ? "not-requested" : "unsupported",
      filesystemWrite: this.#confinement?.applied === true ? "enforced" : "unsupported",
      crossings: [],
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). A broker world
   * produces no screenshot and no trace - there is no page - so a criterion that declares one of those
   * gets the missing-evidence guard rather than an artifact invented to satisfy it: `INCONCLUSIVE`,
   * never a `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: DataObservationData,
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

    if (data.requests.length > 0) {
      // The traffic, on its own, because this is the artifact a human reads when a criterion about
      // what the application asked for failed: "the topic was never created" leaves the reader
      // guessing whether the application asked and was refused, or never asked at all - and the
      // request records answer exactly that, one line each, with the origin printed first. Written
      // only when there is one: a world nothing has spoken to has no traffic, and an empty file would
      // be an artifact that says nothing while counting as one.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.requests.json`,
        "json",
        `${JSON.stringify(data.requests, null, 2)}\n`,
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
          `the sim-data adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- the application ------------------------------------------------------------------------

  /**
   * Bind a socket and remember the address it really reached.
   *
   * One site, because two would be two places that have to agree about which address `#address`
   * holds - and the declared/bound distinction is the one fact this world most needs to keep straight.
   * `start()` and `reset()` both come through here for that reason.
   */
  async #listen(id: string): Promise<void> {
    const declared = this.#data();
    const port = this.#requirePort();
    const endpoint = await port.listen({ host: declared.host, port: declared.port });
    const bound = port.snapshot().node;
    this.#address = { endpoint, host: bound.host, port: bound.port };
    this.#logger.debug("environment.listen", {
      id,
      declared: `${declared.host}:${String(declared.port)}`,
      endpoint,
    });
  }

  /**
   * Run the application's own provisioning program against the live substitute broker.
   *
   * The environment variables are injected rather than taken from the document, and {@link DATA_ENV}
   * says why: the address is decided by `listen()`, which happens immediately before this call. The
   * operator's own variables are spread first, so a derived name cannot be shadowed by a declaration.
   *
   * Four checks, and each one exists because its absence would be blamed on the application:
   *
   *  - the program finished inside the budget, because a provisioning run that hangs would otherwise
   *    be reported as every criterion timing out one at a time;
   *  - it exited zero, because a program that failed and left a partly-provisioned log is not a world
   *    a contract about a complete log can be judged in;
   *  - the declared `readyPattern` really appeared, because that is the only signal the application
   *    itself gives that it finished rather than merely stopped;
   *  - and the broker holds at least one request from the application *since this run of the
   *    provisioner started*. That last one is this world's version of `sim-k8s`'s "the registry the
   *    substitution reads is the application's own build output": the substitute holds exactly what
   *    the provisioner put in it, so a program that exited zero without opening the socket has
   *    provisioned nothing, and every criterion would then report an absent topic for a reason that is
   *    not the application's fault - an environment failure, refused here rather than left to surface
   *    as a mysterious empty log.
   *
   * The watermark is what makes that fourth check a statement about *this* run. A count over the whole
   * life of the world would be satisfied by the first iteration's traffic, so after a `restart` reset
   * whose provisioner never connected it would pass - on an empty log, which is the one situation the
   * check exists to catch.
   */
  async #deployApplication(id: string): Promise<void> {
    const port = this.#requirePort();
    const { command, args, readyPattern } = this.#plan.start;
    const requestsBefore = port.requests().length;
    this.#logger.info("environment.deploy.application", {
      command,
      args,
      cwd: this.#plan.appPath,
      endpoint: this.#requireAddress().endpoint,
      cluster: this.#data().cluster,
      nodeId: this.#data().nodeId,
    });

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#dataEnv(),
        // The allowance is a value; applying it is `core/process.ts`'s job. **This world's allowance
        // is its application directory**, the same tree `sim-k8s` names and for a related reason: the
        // substitution and the transport sit on opposite sides of a socket, so the substitute's state
        // - topics, partitions, offsets, groups - is held in memory rather than in a sandbox tree, and
        // the application directory is the one directory this world can honestly point at. A
        // `writeRoots` naming a sandbox would name a place that does not exist.
        confinement: {
          readRoots: [this.#plan.appPath],
          writeRoots: [this.#plan.appPath],
        },
        onStdout: (chunk) => this.#logger.debug("provision.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("provision.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#provisionTimeoutMs,
    );

    // Read off the result the runner produced, never recomputed from the plan beside it. The log line
    // names both halves for the reason `local-process`'s does: a reader asking "was this child
    // confined" and a reader asking "why not" are two questions, and one of them is a `reason` only
    // the runner ever held.
    this.#confinement = result.confinement ?? null;
    this.#logger.info("environment.deploy.confinement", {
      applied: this.#confinement?.applied ?? false,
      reason: this.#confinement === null ? "no allowance was requested" : this.#confinement.reason,
    });

    // Kept whatever happened next, including on a timeout: the partial output of a program that never
    // finished is the evidence that explains why, and `probe()` reports the readiness signal from here
    // rather than declining to look at the one thing it was given.
    this.#provisionOutput = `${result.stdout}\n${result.stderr}`;

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
    if (readyPattern !== null && !new RegExp(readyPattern).test(this.#provisionOutput)) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) never printed /${readyPattern}/; ` +
          `output: ${tail(result.stdout)}`,
      );
    }

    const made = port
      .requests()
      .slice(requestsBefore)
      .filter((record) => record.source === "application").length;
    if (made === 0) {
      throw new EnvironmentError(
        `the application's provisioning program (\`${command}\`) exited successfully and put no ` +
          `request to the broker at ${this.#requireAddress().endpoint} in this run - the substitute ` +
          "holds exactly what the application asked it to hold, and with nothing asked every criterion " +
          "about this log would report an absent topic that the application never tried to create",
      );
    }
    this.#logger.debug("environment.provision", {
      id,
      requests: made,
      note: "the application provisioned the broker over its own socket",
    });
  }

  #dataEnv(): Readonly<Record<string, string>> {
    const data = this.#data();
    const address = this.#requireAddress();
    return {
      ...this.#plan.env,
      [DATA_ENV.cluster]: data.cluster,
      [DATA_ENV.nodeId]: String(data.nodeId),
      [DATA_ENV.host]: address.host,
      [DATA_ENV.port]: String(address.port),
      [DATA_ENV.broker]: address.endpoint,
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
    if (this.#provisionOutput === null) return null;
    const pattern = this.#plan.start.readyPattern;
    if (pattern === null) return true;
    return new RegExp(pattern).test(this.#provisionOutput);
  }

  /** The declaration, or a refusal naming what is missing. Resolved through one door so no two readers disagree. */
  #data(): NonNullable<EnvironmentPlan["data"]> {
    const data = this.#plan.data;
    if (data === null) throw new EnvironmentError(MISSING_DATA);
    return data;
  }

  /** The address really bound, or a refusal. See {@link DataAddress} for why this is one field and not three. */
  #requireAddress(): DataAddress {
    const address = this.#address;
    if (address === null) throw new EnvironmentError("the substitute broker is not listening");
    return address;
  }

  #requirePort(): DataPort {
    const port = this.#port;
    if (port === null) {
      throw new EnvironmentError("this environment was never created; call create() before starting it");
    }
    return port;
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment was never created; call create() before using it");
    }
    if (this.#id !== id) {
      throw new EnvironmentError(`this environment is \`${this.#id}\`, and \`${id}\` is a different world`);
    }
  }
}
