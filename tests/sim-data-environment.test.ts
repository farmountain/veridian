/**
 * The `sim-data` adapter's own behaviour, judged without a broker.
 *
 * The substitute's *rules* are held by `adapters/sim-data/data-port.test.ts`, which drives a real port
 * against a real socket and real frames. This file is one layer out and asks a different question:
 * what does the adapter do with the plan it was handed, the port it was given, and the record that
 * port produced? So the port here is a substitute for the substitute - it answers from a table,
 * counts what it was asked, and never opens a socket - and every assertion is about the adapter
 * rather than about the world underneath it.
 *
 * Three behaviours are the whole reason this world exists in the shape it does:
 *
 * - **The address is decided by `listen()`, and the application is told it.** `port: 0` is a statement
 *   that the operating system chooses, so the three address variables exist only after a socket is
 *   really bound. A test that declared a fixed port would leave the one case that matters unreached.
 * - **The check that the application spoke is a statement about *this* run.** The substitute holds
 *   exactly what the application put in it, so a program that exited zero without opening the socket
 *   has provisioned nothing - and the watermark is what stops the first iteration's traffic from
 *   answering that question on the second iteration's behalf.
 * - **A reset rebuilds the log and re-provisions it, and does not touch the request record.**
 *   Rebuilding without re-provisioning leaves a clean world and a run reporting every topic absent -
 *   an artifact of the reset that reads like an application defect.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_ENV, SimDataEnvironment } from "../adapters/sim-data/sim-data-environment.ts";
import { DATA_COMMAND_WORDS, dataCommandUsage } from "../adapters/sim-data/data-port.ts";
import type { DataIdentity, DataPort } from "../adapters/sim-data/data-port.ts";
import {
  DATA_OBSERVATION_KIND,
  DATA_SIMULATED_SURFACES,
} from "../core/environment/data-observation.ts";
import type {
  DataGroupReading,
  DataObservationData,
  DataRequestRecord,
  DataTopicReading,
} from "../core/environment/data-observation.ts";
import type { EnvironmentPlan, Observation, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import type { Logger } from "../core/clarification/types.ts";
import { fixedClock } from "./helpers/clock.ts";

// ---- fixtures -------------------------------------------------------------------------------------

const DATA = {
  cluster: "veridian-data",
  nodeId: 1,
  host: "127.0.0.1",
  /** Deliberately `0`: the port this world uses is the one `listen()` reached, never the declaration. */
  port: 0,
} as const;

/** The port a bound socket would report. Anything but the declared `0`, so the two can be told apart. */
const BOUND_PORT = 41_007;

/**
 * A plan whose readiness pattern is declared once, the way the loader declares it.
 *
 * `core/environment/load.ts` reads `readyPattern` **from `start` and from nowhere else** and hands the
 * same value to `plan.health.readyPattern`, because that is the field the manager's readiness gate and
 * every adapter's `probe()` read. A fixture that let the two disagree would be a fixture in which the
 * world reads a pattern no document could ever set - the exact defect that made the manager's gate
 * unfalsifiable once already - so this derives it in the one place and passes the derivation on.
 */
const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => {
  const start = {
    command: "node",
    args: ["provision.mjs"],
    readyPattern: null as string | null,
    ...overrides.start,
  };
  return {
    adapter: "sim-data",
    app: "app",
    appPath: "/virtual/app",
    env: {},
    dependencyInstall: null,
    start,
    url: null,
    api: null,
    databasePath: null,
    cluster: null,
    posix: null,
    os: null,
    cloud: null,
    container: null,
    vscode: null,
    process: null,
    data: { ...DATA },
    health: {
      path: null,
      expectStatus: null,
      timeoutMs: 5_000,
      intervalMs: 10,
      readyPattern: start.readyPattern,
      ...overrides.health,
    },
    reset: { strategy: "restart", command: null },
    browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
    boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
    ...overrides,
  };
};

const request = (overrides: Partial<ObservationRequest> = {}): ObservationRequest => ({
  criterionId: "AC-001",
  runId: "run-1",
  steps: [{ run: ["metadata"] }],
  targets: ["data.topic/cart-events"],
  evidence: [],
  ...overrides,
});

interface RecordedEntry {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A logger that keeps the *fields*, because several of this world's facts are only visible there. */
function capableLogger(): { readonly entries: RecordedEntry[] } & Logger {
  const entries: RecordedEntry[] = [];
  const push =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      entries.push({ level, message, fields: fields ?? {} });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn") };
}

/** One request record, filed by whoever put it. Shaped exactly as `data-observation.ts` declares. */
const record = (
  source: "application" | "criterion",
  api: string,
  overrides: Partial<DataRequestRecord> = {},
): DataRequestRecord => ({
  api,
  apiKey: 19,
  apiVersion: 6,
  correlationId: source === "application" ? 1 : null,
  clientId: source === "application" ? "cart-web" : null,
  source,
  result: "ok",
  errorCode: 0,
  reason: null,
  bytesIn: 64,
  bytesOut: 12,
  ...overrides,
});

const TOPIC: DataTopicReading = {
  name: "cart-events",
  partitions: [
    {
      index: 0,
      leaderId: DATA.nodeId,
      replicas: [DATA.nodeId, DATA.nodeId, DATA.nodeId],
      isr: [DATA.nodeId],
      lowWatermark: 0,
      highWatermark: 2,
      records: [
        {
          offset: 0,
          timestamp: 0,
          key: "cart-1",
          value: "created",
          keyHex: null,
          valueHex: null,
          headers: [],
        },
      ],
    },
  ],
  replicationFactor: 3,
  configs: [],
};

const GROUP: DataGroupReading = {
  groupId: "cart-indexer",
  generationId: 1,
  protocolType: "consumer",
  state: "stable",
  members: [{ memberId: "m-1", clientId: "cart-web", protocol: "range", assignmentBytes: 0 }],
  committed: [{ topic: "cart-events", partition: 0, offset: 1, metadata: null }],
};

interface FakePort {
  readonly port: DataPort;
  /** Every command a criterion put to this world, in order. */
  readonly runs: readonly (readonly string[])[];
  /** The order the world's own event and the application's program happened in. */
  readonly events: string[];
  /** The answer `run()` gives. Replaced by a test about a command this world rules out. */
  runAnswer: DataRequestRecord | null;
  /** Called when the application's program runs. `null` models a program that never opened a socket. */
  onProvision: (() => void) | null;
  /** The identity `identity()` reports. Replaced by a test about a broker that is somebody else. */
  identity: DataIdentity;
  /** The node `listen()` really reached - what every address this adapter hands out is derived from. */
  bound: { readonly id: number; readonly host: string; readonly port: number };
  /** The endpoint `listen()` answers with. */
  endpoint: string;
  topology: { topics: readonly DataTopicReading[]; groups: readonly DataGroupReading[] };
  listenError: Error | null;
  snapshotError: Error | null;
  loadError: Error | null;
  /** Put one request on the socket, as the application's own client does. */
  connect(api?: string): DataRequestRecord;
  listenCount(): number;
  closeCount(): number;
  clearCount(): number;
  readonly dumped: string[];
  readonly loaded: string[];
}

function fakePort(): FakePort {
  const records: DataRequestRecord[] = [];
  const runs: (readonly string[])[] = [];
  const dumped: string[] = [];
  const loaded: string[] = [];
  let listens = 0;
  let closes = 0;
  let clears = 0;

  const state: FakePort = {
    runs,
    events: [],
    runAnswer: null,
    onProvision: null,
    identity: { ...DATA },
    bound: { id: DATA.nodeId, host: DATA.host, port: BOUND_PORT },
    endpoint: `tcp://${DATA.host}:${String(BOUND_PORT)}`,
    topology: { topics: [], groups: [] },
    listenError: null,
    snapshotError: null,
    loadError: null,
    dumped,
    loaded,
    connect(api = "CreateTopics") {
      const filed = record("application", api);
      records.push(filed);
      return filed;
    },
    listenCount: () => listens,
    closeCount: () => closes,
    clearCount: () => clears,
    port: {
      async listen() {
        listens += 1;
        state.events.push("listen");
        if (state.listenError !== null) throw state.listenError;
        return state.endpoint;
      },
      async close() {
        closes += 1;
        state.events.push("close");
      },
      identity: () => state.identity,
      apis: () => [],
      run(argv) {
        runs.push(argv);
        // Filed exactly as the real port files it: with the party that asked. A double that recorded
        // the command without its source would make "a criterion's own command does not satisfy a
        // criterion about the application" untestable - which is what `source` exists for.
        const filed =
          state.runAnswer ?? record("criterion", "Metadata", { bytesIn: 0, bytesOut: 0 });
        records.push(filed);
        return filed;
      },
      requests: () => records,
      snapshot() {
        if (state.snapshotError !== null) throw state.snapshotError;
        return {
          cluster: state.identity.cluster,
          node: state.bound,
          topics: state.topology.topics,
          groups: state.topology.groups,
        };
      },
      meters: () => ({
        requests: records.length,
        bytesIn: 64,
        bytesOut: 12,
        recordsProduced: 1,
        recordsFetched: 0,
      }),
      clear() {
        clears += 1;
        state.topology = { topics: [], groups: [] };
        // The request record is deliberately *not* cleared, which is the whole reason the watermark
        // below has to exist. A double that cleared it would have made a correct adapter and a
        // cumulative one indistinguishable.
      },
      dump() {
        const state_ = `${state.identity.cluster}:${records.length}`;
        dumped.push(state_);
        return state_;
      },
      load(text) {
        if (state.loadError !== null) throw state.loadError;
        loaded.push(text);
      },
    },
  };
  return state;
}

/**
 * A process runner that records the request and answers it, and tells the port that the application
 * spoke - because in this world the application's only way into the world is a socket, and a double
 * that never filed a request would make every provisioning assertion here vacuous.
 *
 * `delayMs` is not a sleep: it is how a test makes a program genuinely outlive a deadline, because
 * `runToCompletion` decides `timedOut` from **its own timer** and overwrites whatever the result
 * claimed. A double that resolved instantly with `timedOut: true` would leave the adapter's deadline
 * branch unreached while appearing to exercise it - a green test over a path nothing walked.
 */
function fakeProcesses(
  world: FakePort,
  answers: readonly Partial<ProcessResult>[] = [{}],
  options: { readonly delayMs?: number } = {},
): ProcessRunner & { readonly calls: readonly ProcessRequest[] } {
  const calls: ProcessRequest[] = [];
  let index = 0;
  return {
    calls,
    run(processRequest: ProcessRequest) {
      calls.push(processRequest);
      world.events.push("provision");
      world.onProvision?.();
      const answer = answers[Math.min(index, answers.length - 1)] ?? {};
      index += 1;
      const settled: ProcessResult = {
        code: 0,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        ...answer,
      };
      return {
        pid: 1,
        exited:
          options.delayMs === undefined
            ? Promise.resolve(settled)
            : new Promise((resolve) => setTimeout(() => resolve(settled), options.delayMs)),
        output: () => settled.stdout,
        error: () => settled.stderr,
        write: () => undefined,
        waitForPattern: async () => true,
        stop: async () => undefined,
      };
    },
  };
}

interface Harness {
  readonly subject: SimDataEnvironment;
  /** The double. Always present, whatever port the adapter was handed, so assertions can read it. */
  readonly port: FakePort;
  readonly io: ReturnType<typeof memoryIo>;
  readonly processes: ProcessRunner & { readonly calls: readonly ProcessRequest[] };
  readonly logger: ReturnType<typeof capableLogger>;
}

interface HarnessOptions {
  readonly answers?: readonly Partial<ProcessResult>[];
  readonly provisionTimeoutMs?: number;
  /** How long the application's program takes to finish, so a deadline can really be crossed. */
  readonly delayMs?: number;
  readonly runAnswer?: DataRequestRecord;
  /** `false` models a provisioning program that exited zero without opening the socket. */
  readonly connects?: boolean;
  readonly identity?: DataIdentity;
  readonly boundPort?: number;
  readonly endpoint?: string;
  readonly topology?: { readonly topics?: readonly DataTopicReading[]; readonly groups?: readonly DataGroupReading[] };
  readonly listenError?: Error;
  readonly snapshotError?: Error;
  readonly loadError?: Error;
}

function harness(environment: EnvironmentPlan, options: HarnessOptions = {}): Harness {
  const port = fakePort();
  port.identity = options.identity ?? { ...DATA };
  port.bound = { id: port.identity.nodeId, host: port.identity.host, port: options.boundPort ?? BOUND_PORT };
  port.endpoint = options.endpoint ?? `tcp://${port.bound.host}:${String(port.bound.port)}`;
  port.topology = { topics: options.topology?.topics ?? [], groups: options.topology?.groups ?? [] };
  port.runAnswer = options.runAnswer ?? null;
  port.listenError = options.listenError ?? null;
  port.snapshotError = options.snapshotError ?? null;
  port.loadError = options.loadError ?? null;
  port.onProvision =
    options.connects === false
      ? null
      : () => {
          port.connect();
        };
  const io = memoryIo({}, "/virtual");
  const processes = fakeProcesses(port, options.answers, { delayMs: options.delayMs });
  const logger = capableLogger();
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimDataEnvironment(environment, {
      io,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger,
      processes,
      stateDir: ".veridian",
      port: port.port,
      provisionTimeoutMs: options.provisionTimeoutMs,
    }),
  };
}

async function ready(
  environment: EnvironmentPlan = plan(),
  options: HarnessOptions = {},
): Promise<Harness & { readonly id: string }> {
  const built = harness(environment, options);
  const { id } = await built.subject.create();
  await built.subject.start(id);
  return { ...built, id };
}

const assertEnvironmentError = (error: unknown, pattern: RegExp): true => {
  assert.ok(error instanceof EnvironmentError, `expected an EnvironmentError, got ${String(error)}`);
  assert.match(error.message, pattern);
  return true;
};

/** The reading an observation carries, or a failure naming what it carried instead. */
const dataOf = (observation: Observation): DataObservationData => {
  assert.ok(observation.data !== null, `expected a reading, got ${JSON.stringify(observation.error)}`);
  return observation.data as DataObservationData;
};

/** The entries a logger carries for one message, at one level. */
const entriesAt = (
  logger: ReturnType<typeof capableLogger>,
  level: string,
  message: string,
): readonly RecordedEntry[] =>
  logger.entries.filter((entry) => entry.level === level && entry.message === message);

// ---- refusals before anything runs -----------------------------------------------------------------

describe("the sim-data world refuses a document it cannot stand in for", () => {
  it("names the missing data declaration rather than judging a broker nobody described", async () => {
    const built = harness(plan({ data: null }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `data` declaration/),
    );
  });

  it("refuses a declaration with a blank cluster, naming the field rather than defaulting it", async () => {
    const built = harness(plan({ data: { ...DATA, cluster: "" } }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `data` declaration/),
    );
  });

  it("refuses a world that declares no start command, because it cannot provision itself", async () => {
    const built = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /declares no `start\.command`/),
    );
  });

  it("refuses to observe a world that was created but never started", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /call start\(\) before observing it/),
    );
  });

  it("refuses an id that belongs to a different environment", async () => {
    const built = await ready();
    await assert.rejects(
      () => built.subject.observe("sim-data:somebody-else", request()),
      (error: unknown) => assertEnvironmentError(error, /`sim-data:somebody-else` is a different world/),
    );
  });

  it("keys the world on the cluster, because a broker is named by the cluster it answers for", async () => {
    const built = harness(plan({ data: { ...DATA, cluster: "orders" } }));
    const created = await built.subject.create();
    assert.equal(created.id, "sim-data:orders");
    assert.equal(built.logger.entries.find((entry) => entry.message === "environment.create")?.fields["cluster"], "orders");
  });
});

// ---- the address, in one spelling and five names ----------------------------------------------------

describe("the world's address reaches a separate process, and is one fact in five names", () => {
  it("hands the provisioner the cluster, the node, both halves of the address and the whole of it", async () => {
    const built = await ready();
    const env = built.processes.calls[0]?.env ?? {};
    assert.equal(env[DATA_ENV.cluster], DATA.cluster);
    assert.equal(env[DATA_ENV.nodeId], String(DATA.nodeId));
    assert.equal(env[DATA_ENV.host], DATA.host);
    assert.equal(env[DATA_ENV.port], String(BOUND_PORT));
    assert.equal(env[DATA_ENV.broker], `tcp://${DATA.host}:${String(BOUND_PORT)}`);
  });

  it("hands over the port that was bound rather than the one the document asked for", async () => {
    // The document says `0`, which asks the operating system to choose. A world that exported the
    // declaration would tell the application to connect to port zero, which is not a port.
    const built = await ready(plan({ data: { ...DATA, port: 0 } }));
    const env = built.processes.calls[0]?.env ?? {};
    assert.equal(DATA.port, 0);
    assert.equal(env[DATA_ENV.port], String(BOUND_PORT));
    assert.notEqual(env[DATA_ENV.port], "0");
  });

  it("records both spellings of the address it bound, so a reader can pair a log with a document", async () => {
    const built = await ready();
    const listen = built.logger.entries.find((entry) => entry.message === "environment.listen");
    assert.equal(listen?.fields["declared"], `${DATA.host}:0`);
    assert.equal(listen?.fields["endpoint"], built.port.endpoint);
  });

  it("passes the operator's own variables through beside the five it derives", async () => {
    const built = await ready(plan({ env: { CART_TENANT: "acme", LOG_LEVEL: "debug" } }));
    const env = built.processes.calls[0]?.env ?? {};
    assert.equal(env["CART_TENANT"], "acme");
    assert.equal(env["LOG_LEVEL"], "debug");
    assert.equal(env[DATA_ENV.cluster], DATA.cluster);
  });

  it("hands over exactly five derived names when the document declares none", async () => {
    const built = await ready();
    const env = built.processes.calls[0]?.env ?? {};
    const derived = Object.values(DATA_ENV);
    assert.deepEqual(
      Object.keys(env).sort(),
      [...derived].sort(),
      "five names and nothing else: a sixth would be a fact no document asked for",
    );
  });

  it("declares each of the five names once, and names the whole against the halves it joins", () => {
    const names = Object.values(DATA_ENV);
    assert.equal(names.length, 5);
    assert.equal(new Set(names).size, 5, "two names spelled the same would make one of them unreadable");
    assert.equal(DATA_ENV.broker, "VERIDIAN_DATA_BROKER");
    // `[A-Z_]+` rather than `[A-Z]+`, and exactly one of the five needs it. The count is asked of the
    // vocabulary rather than written beside it: the sentence that used to stand here said "two of the
    // five carry an underscore", which was a claim about the list that nothing read - and was wrong
    // about it by one.
    for (const name of names) assert.match(name, /^VERIDIAN_DATA_[A-Z_]+$/);
    assert.equal(
      names.filter((name) => name.slice("VERIDIAN_DATA_".length).includes("_")).length,
      1,
      "one tail carries an underscore; the widened character class is for it and nothing else",
    );
  });

  it("binds the socket before the application's program runs", async () => {
    // The order is the design, not an implementation detail: the program connects to an address this
    // world has to be listening on, so a world that ran it first would hand it a socket that is not
    // there and read the connection refused as the application's defect.
    const built = await ready();
    assert.deepEqual(built.port.events, ["listen", "provision"]);
  });
});

// ---- readiness ---------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by looking", () => {
  it("answers not-ok naming an unbound socket when the world was created but never started", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    const probe = await built.subject.probe(id);
    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /broker is not listening/);
    assert.equal(probe.patternSeen, null);
  });

  it("answers ok with no pattern declared, and never invents a status code", async () => {
    const built = await ready();
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, true);
    assert.equal(probe.statusCode, null, "a broker has no status to return over a socket");
    assert.equal(probe.message, null);
    // Nothing was declared, and this adapter *does* read the program's stdout: `null` here means the
    // check declined to look, and `true` means it looked and there was nothing to find.
    assert.equal(probe.patternSeen, true);
  });

  it("names a different broker's identity rather than answering about the declared one", async () => {
    const built = await ready(plan(), {
      identity: { cluster: "somebody-else", nodeId: 9, host: DATA.host, port: BOUND_PORT },
    });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /reports itself as `somebody-else` node 9/);
    assert.match(probe.message ?? "", /this document declares `veridian-data` node 1/);
    assert.equal(probe.patternSeen, null);
  });

  it("reports the readiness pattern seen, as a boolean, when it really appeared", async () => {
    const built = await ready(plan({ start: { command: "node", args: [], readyPattern: "broker ready" } }), {
      answers: [{ stdout: "cart-web provisioning\nbroker ready\n" }],
    });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, true);
    assert.equal(probe.patternSeen, true);
  });

  it("reads the readiness signal from the output a program wrote before it was killed", async () => {
    // The partial output is kept on the timeout path rather than discarded, and this is the case that
    // says so: the provisioning run was refused, and the world is still able to answer about the one
    // thing it was given. Reporting `patternSeen: null` here would be declining to look at the output
    // the adapter is holding, which is a verdict this world did not have to decline.
    const built = harness(plan({ start: { command: "node", args: [], readyPattern: "broker ready" } }), {
      answers: [{ stdout: "cart-web provisioning\nbroker ready\n" }],
      delayMs: 120,
      provisionTimeoutMs: 20,
    });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within 20ms/),
    );
    const probe = await built.subject.probe(id);
    assert.equal(probe.patternSeen, true, "the output the program did print was read rather than dropped");
    assert.equal(probe.ok, true, "the socket is bound and the identity matches; only the provisioner failed");
  });

  it("repeats the same verdict for the same world, because nothing here reads a clock", async () => {
    const built = await ready();
    const first = await built.subject.probe(built.id);
    const second = await built.subject.probe(built.id);
    assert.deepEqual(first, second);
  });
});

// ---- the application's own provisioning --------------------------------------------------------------

describe("the application provisions the broker over its own socket", () => {
  it("runs the declared command in the application's own directory", async () => {
    const built = await ready();
    assert.equal(built.processes.calls.length, 1);
    assert.equal(built.processes.calls[0]?.command, "node");
    assert.deepEqual(built.processes.calls[0]?.args, ["provision.mjs"]);
    assert.equal(built.processes.calls[0]?.cwd, "/virtual/app");
  });

  it("files the application's own requests as the application's, beside a criterion's", async () => {
    const built = await ready();
    await built.subject.execute(built.id, request({ steps: [{ run: ["create-topic", "cart-events", "3", "3"] }] }));
    const observation = await built.subject.observe(built.id, request());
    const sources = dataOf(observation).requests.map((entry) => entry.source);
    assert.deepEqual(sources, ["application", "criterion"]);
    assert.deepEqual(built.port.runs, [["create-topic", "cart-events", "3", "3"]]);
  });

  it("refuses a provisioning program that exited non-zero, naming the code and its stderr", async () => {
    const built = harness(plan(), { answers: [{ code: 2, stderr: "no broker to reach\n" }] });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 2: no broker to reach/),
    );
    assert.deepEqual(
      entriesAt(built.logger, "debug", "environment.provision"),
      [],
      "a refused provisioning run is not reported as a provisioned world",
    );
  });

  it("refuses a provisioning program that did not finish, naming the deadline", async () => {
    const built = harness(plan(), { answers: [{}], delayMs: 120, provisionTimeoutMs: 20 });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within 20ms/),
    );
    assert.deepEqual(entriesAt(built.logger, "debug", "environment.provision"), []);
  });

  it("refuses a provisioning program that exited zero and asked the broker for nothing", async () => {
    // The case this four-check sequence exists for: a program that succeeds without being a
    // provisioner. The world is empty, and every criterion about it would report an absent topic the
    // application never tried to create - an application-looking failure for a world's reason.
    const built = harness(plan(), { connects: false });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /put no request to the broker/),
    );
    assert.deepEqual(entriesAt(built.logger, "debug", "environment.provision"), []);
  });

  it("counts the request the application made in this run, not the one the last run made", async () => {
    // The watermark, and the reason it is a watermark rather than a count. The record deliberately
    // keeps the first provisioning's request - which is what makes the cumulative test pass on an
    // empty world - so an adapter that asked "has the application ever spoken" would report a
    // correctly rebuilt world as provisioned when nothing had connected to it.
    const built = await ready();
    assert.equal(built.port.listenCount(), 1);
    built.port.onProvision = null;
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) => assertEnvironmentError(error, /put no request to the broker/),
    );
    assert.equal(built.port.listenCount(), 2, "the rebuild really began before the check refused it");
    assert.equal(
      built.port.port.requests().filter((entry) => entry.source === "application").length,
      1,
      "the earlier run's request is still in the record - that is exactly what the watermark ignores",
    );
  });

  it("refuses a provisioning program that never printed the declared readiness pattern", async () => {
    const declared = plan({ start: { command: "node", args: [], readyPattern: "broker ready" } });
    const built = harness(declared, { answers: [{ stdout: "cart-web provisioning\n" }] });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /never printed \/broker ready\//),
    );
  });

  it("records the provisioning program's own command line, so a reader sees what it ran", async () => {
    const built = await ready();
    const deploy = built.logger.entries.find((entry) => entry.message === "environment.deploy.application");
    assert.equal(deploy?.fields["command"], "node");
    assert.deepEqual(deploy?.fields["args"], ["provision.mjs"]);
    assert.equal(deploy?.fields["endpoint"], built.port.endpoint);
  });

  it("reports how many requests the application put, rather than leaving a reader to count them", async () => {
    const built = await ready();
    const provision = built.logger.entries.find((entry) => entry.message === "environment.provision");
    assert.equal(provision?.fields["requests"], 1);
  });
});

// ---- a criterion acts through `run` steps -------------------------------------------------------------

describe("a criterion acts through `run` steps, and only through them", () => {
  it("performs a run step and returns the reading", async () => {
    const built = await ready();
    built.port.topology = { topics: [TOPIC], groups: [] };
    const observation = await built.subject.execute(
      built.id,
      request({ steps: [{ run: ["create-topic", "cart-events", "3", "3"] }] }),
    );
    assert.equal(observation.error, null);
    assert.equal(observation.kind, DATA_OBSERVATION_KIND);
    assert.deepEqual(built.port.runs, [["create-topic", "cart-events", "3", "3"]]);
    assert.equal(dataOf(observation).topics.length, 1);
  });

  it("refuses an acting step it cannot perform, naming the step number and its kind", async () => {
    const built = await ready();
    const observation = await built.subject.execute(built.id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(observation.error?.message ?? "", /step 1 of AC-001 is `click`/);
    assert.deepEqual(built.port.runs, [], "the world was not commanded at all");
  });

  it("names the position of the step it cannot perform, not the first one", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({ steps: [{ run: ["metadata"] }, { sql: "select 1" }] }),
    );
    assert.match(observation.error?.message ?? "", /step 2 of AC-001 is `sql`/);
    assert.deepEqual(
      built.port.runs,
      [],
      "nothing is performed for a criterion any of whose steps this world cannot perform - not even the runs before it",
    );
  });

  it("does not refuse a non-run step it was only asked to observe", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.error, null);
    assert.deepEqual(built.port.runs, []);
  });

  it("makes a criterion's own command wait for no frame, because it is performed in process", async () => {
    const built = await ready();
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["metadata"] }] }));
    const criterion = dataOf(observation).requests.find((entry) => entry.source === "criterion");
    assert.ok(criterion !== undefined);
    assert.equal(criterion.correlationId, null, "there was no request frame to correlate an answer with");
  });

  it("warns about a command this world cannot read, because that is the contract's own defect", async () => {
    const built = await ready(plan(), {
      runAnswer: record("criterion", "unsupported", {
        result: "invalid-request",
        errorCode: 42,
        reason: "`frobnicate` is not a command this world performs",
      }),
    });
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["frobnicate"] }] }));
    assert.equal(observation.error, null);
    const warned = entriesAt(built.logger, "warn", "environment.run");
    assert.equal(warned.length, 1);
    assert.match(String(warned[0]?.fields["reason"]), /not a command this world performs/);
    assert.equal(
      dataOf(observation).requests.at(-1)?.result,
      "invalid-request",
      "the refusal is in the reading rather than thrown at the criterion",
    );
  });

  it("does not warn about a refusal a criterion may be built on, because that trains a reader to skip warnings", async () => {
    const built = await ready(plan(), {
      runAnswer: record("criterion", "Produce", {
        result: "refused",
        errorCode: 3,
        reason: "there is no topic called `nope` in this world",
      }),
    });
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["produce", "nope", "0", "k", "v"] }] }));
    assert.equal(observation.error, null);
    assert.deepEqual(entriesAt(built.logger, "warn", "environment.run"), []);
    const noted = entriesAt(built.logger, "debug", "environment.run");
    assert.equal(noted.length, 1);
    assert.equal(noted[0]?.fields["result"], "refused");
  });

  it("performs every run step of a criterion, in the order the contract wrote them", async () => {
    const built = await ready();
    await built.subject.execute(
      built.id,
      request({
        steps: [
          { run: ["create-topic", "cart-events", "3", "3"] },
          { run: ["produce", "cart-events", "0", "cart-1", "created"] },
          { run: ["fetch", "cart-events", "0"] },
        ],
      }),
    );
    assert.deepEqual(
      built.port.runs.map((argv) => argv[0]),
      ["create-topic", "produce", "fetch"],
    );
  });
});

// ---- evidence ----------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the traffic only when the world was really spoken to", async () => {
    const built = await ready();
    const observation = await built.subject.execute(built.id, request());
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json", "artifacts/AC-001.requests.json"],
    );
    for (const artifact of observation.artifacts) {
      assert.equal(artifact.criterionId, "AC-001");
      assert.equal(artifact.kind, "json");
    }
    const written = await built.io.readTextFile(".veridian/runs/run-1/artifacts/AC-001.requests.json");
    assert.match(written ?? "", /"source": "application"/);
  });

  it("writes the traffic file for a criterion that never acted, because the record is never empty", async () => {
    // The traffic file's condition is `requests.length > 0`, and through a started world that is
    // always true: `start()` refuses a provisioner that put nothing in the record, and neither
    // `clear()` nor a reset ever empties it. So the empty case is **unreachable here rather than
    // tested here**, and the honest thing is to say so instead of faking for it - a test that forced
    // an empty record would be asserting the behaviour of a world this adapter refuses to create.
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ evidence: ["json"] }));
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json", "artifacts/AC-001.requests.json"],
    );
    const data = dataOf(observation);
    assert.equal(data.requests.length, 1, "the application's own request, and no step of the criterion's");
    assert.equal(data.requests[0]?.source, "application");
  });

  it("warns about a kind it did not write, without claiming it wrote it", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ evidence: ["screenshot", "json"] }));
    const warned = entriesAt(built.logger, "warn", "environment.evidence");
    assert.equal(warned.length, 1);
    assert.equal(warned[0]?.fields["kind"], "screenshot");
    assert.match(
      String(warned[0]?.fields["note"]),
      /writes `json` artifacts for a criterion and cannot produce `screenshot`/,
    );
    assert.ok(observation.artifacts.some((artifact) => artifact.kind === "json"));
  });

  it("does not warn about a kind it did write", async () => {
    const built = await ready();
    await built.subject.observe(built.id, request({ evidence: ["json"] }));
    assert.deepEqual(entriesAt(built.logger, "warn", "environment.evidence"), []);
  });

  it("names every kind it wrote when a criterion asked for more than one thing", async () => {
    const built = await ready();
    await built.subject.observe(built.id, request({ evidence: ["console", "trace"] }));
    const warned = entriesAt(built.logger, "warn", "environment.evidence");
    assert.deepEqual(warned.map((entry) => entry.fields["kind"]), ["console", "trace"]);
    assert.match(String(warned[0]?.fields["note"]), /writes `json` artifacts/);
  });

  it("answers a reading it could not build with an environment failure, never with empty data", async () => {
    const built = await ready();
    built.port.snapshotError = new Error("the broker was closed underneath this world");
    const observation = await built.subject.observe(built.id, request());
    assert.equal(observation.data, null);
    assert.deepEqual(observation.artifacts, []);
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(observation.error?.message ?? "", /closed underneath this world/);
  });

  it("stamps the observation with the run, the criterion and the world's own kind", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ criterionId: "AC-004", runId: "run-9" }));
    assert.equal(observation.kind, "data.broker");
    assert.equal(observation.runId, "run-9");
    assert.equal(observation.environmentId, built.id);
    assert.equal(observation.capturedAt, "2026-01-01T00:00:00.000Z");
  });

  it("carries the declared surfaces, so a pass is traceable to a named substitute", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request());
    assert.deepEqual(dataOf(observation).simulated, [...DATA_SIMULATED_SURFACES]);
    assert.equal(dataOf(observation).simulated.length, 7);
  });

  it("carries the meter beside the state, because a bill is not a resource", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request());
    const data = dataOf(observation);
    assert.equal(data.meter.requests, 1);
    assert.equal(data.meter.recordsProduced, 1);
    assert.deepEqual(data.topics, [], "the log is what the world holds; the meter is what it served");
    assert.deepEqual(data.simulated, [...DATA_SIMULATED_SURFACES]);
  });
});

// ---- the lifecycle ------------------------------------------------------------------------------------

describe("the lifecycle is the same one every other world exposes", () => {
  it("records deploy as an explicit no-op naming the command rather than leaving it empty", async () => {
    const built = await ready();
    await built.subject.deploy(built.id);
    const deploy = built.logger.entries.find((entry) => entry.message === "environment.deploy");
    assert.equal(deploy?.fields["command"], "node");
    assert.match(String(deploy?.fields["note"]), /issued its requests during start\(\)/);
    assert.equal(built.processes.calls.length, 1, "deploy performs nothing of its own");
  });

  it("clears the log, closes the socket, binds a new one and re-provisions on a restart reset", async () => {
    const built = await ready();
    await built.subject.reset(built.id);
    assert.equal(built.port.clearCount(), 1);
    assert.equal(built.port.closeCount(), 1);
    assert.equal(built.port.listenCount(), 2);
    assert.equal(built.processes.calls.length, 2, "the application provisioned the fresh log again");
    const reset = built.logger.entries.filter((entry) => entry.message === "environment.reset");
    assert.equal(reset.at(-1)?.fields["strategy"], "restart");
    assert.equal(reset.at(-1)?.fields["endpoint"], built.port.endpoint);
  });

  it("rebuilds rather than clears, so a reset world reads as empty rather than as a defective one", async () => {
    const built = await ready();
    built.port.topology = { topics: [TOPIC], groups: [GROUP] };
    await built.subject.reset(built.id);
    const observation = await built.subject.observe(built.id, request());
    assert.deepEqual(dataOf(observation).topics, [], "the log was cleared by the world, not skipped");
    assert.equal(built.port.listenCount(), 2, "and the application was given a socket to rebuild it through");
  });

  it("keeps the request record across a reset, because a repair does not undo what the run did", async () => {
    const built = await ready();
    await built.subject.execute(built.id, request({ steps: [{ run: ["create-topic", "cart-events", "3", "3"] }] }));
    await built.subject.reset(built.id);
    const observation = await built.subject.observe(built.id, request());
    const sources = dataOf(observation).requests.map((entry) => entry.source);
    assert.deepEqual(
      sources,
      ["application", "criterion", "application"],
      "an erasing reset would destroy the evidence of a violation by repairing it",
    );
  });

  it("refuses a snapshot-restore reset by name, naming the path that does carry it", async () => {
    const built = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) =>
        assertEnvironmentError(error, /restores a baseline through `restore\(\)`/),
    );
    assert.equal(built.port.clearCount(), 0, "the log is not rebuilt when the reset is refused");
  });

  it("snapshots under a fixed name a second identical run would produce too", async () => {
    const built = await ready();
    const first = await built.subject.snapshot(built.id);
    const second = await built.subject.snapshot(built.id);
    assert.equal(first, "sim-data.broker.json");
    assert.equal(second, first, "a stamped name would put the one nondeterministic value in the bundle");
    assert.deepEqual(built.port.dumped, ["veridian-data:1", "veridian-data:1"]);
  });

  it("writes the snapshot through the io root, so the file a bundle names is the file on disk", async () => {
    const built = await ready();
    const name = await built.subject.snapshot(built.id);
    const written = await built.io.readTextFile(`.veridian/snapshots/${name}`);
    assert.equal(written, built.port.dumped.at(-1));
  });

  it("refuses to snapshot a world that has not been started, naming why rather than an absence", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.snapshot(id),
      (error: unknown) => assertEnvironmentError(error, /has not been started; there is nothing to snapshot/),
    );
  });

  it("restores the state a snapshot holds, and refuses one that is not there", async () => {
    const built = await ready();
    const name = await built.subject.snapshot(built.id);
    await built.subject.restore(built.id, name);
    assert.equal(built.port.loaded.at(-1), built.port.dumped.at(-1));
    await assert.rejects(
      () => built.subject.restore(built.id, "prior.json"),
      (error: unknown) => assertEnvironmentError(error, /no snapshot `prior\.json` to restore/),
    );
  });

  it("reports a restore the world refused rather than reporting a restored world", async () => {
    const built = await ready();
    const name = await built.subject.snapshot(built.id);
    built.port.loadError = new Error("the snapshot names a format this world does not read");
    // Asserted on the message rather than on `EnvironmentError`, and that is a statement about who
    // refused: the substitute's own reading of the file travels as it was raised, because wrapping it
    // would rename the cause the reporter observed. `sim-cloud` reports the same case the same way.
    await assert.rejects(
      () => built.subject.restore(built.id, name),
      /the snapshot names a format this world does not read/,
    );
    assert.deepEqual(built.port.loaded, [], "the state never reached the world, so nothing was restored");
  });

  it("runs a declared custom reset command instead of rebuilding the log", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }));
    await built.subject.reset(built.id);
    assert.equal(built.port.clearCount(), 0);
    assert.equal(built.port.listenCount(), 1);
    assert.equal(built.processes.calls.length, 2, "the custom command ran instead");
    assert.equal(built.processes.calls.at(-1)?.command, "npm");
  });

  it("hands a custom reset the same five facts the provisioner got", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }));
    await built.subject.reset(built.id);
    const custom = built.processes.calls.at(-1)?.env ?? {};
    assert.equal(custom[DATA_ENV.cluster], DATA.cluster);
    assert.equal(custom[DATA_ENV.broker], built.port.endpoint);
    assert.equal(custom[DATA_ENV.port], String(BOUND_PORT));
  });

  it("refuses a custom reset command that fails, rather than falling back to a rebuild", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }), {
      answers: [{}, { code: 2, stderr: "no reset script\n" }],
    });
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 2: no reset script/),
    );
    assert.equal(built.port.clearCount(), 0, "a failed reset is not quietly replaced by a rebuild");
  });

  it("warns, and still rebuilds, when a custom strategy declares no command", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: null } }));
    await built.subject.reset(built.id);
    assert.equal(built.port.clearCount(), 1);
    assert.equal(
      entriesAt(built.logger, "warn", "environment.reset").length,
      1,
      "the fallback is said out loud rather than performed silently",
    );
  });

  it("closes the socket on stop and leaves the log where a bundle can still quote it", async () => {
    const built = await ready();
    built.port.topology = { topics: [TOPIC], groups: [] };
    await built.subject.stop(built.id);
    assert.equal(built.port.closeCount(), 1);
    assert.equal(built.port.clearCount(), 0, "stopping is not resetting");
    // A bundle quotes records that were in this log, so `stop()` leaves it in memory. It is
    // `destroy()` that returns this world to an uncreated state, and that is the case below.
    assert.equal(built.port.port.snapshot().topics.length, 1);
  });

  it("destroys back to an uncreated state, so the instance cannot be used again", async () => {
    const built = await ready();
    await built.subject.destroy(built.id);
    assert.equal(built.port.closeCount(), 1);
    await assert.rejects(
      () => built.subject.observe(built.id, request()),
      (error: unknown) => assertEnvironmentError(error, /was never created/),
    );
  });

  it("reports both boundary policies against the plan, and files no crossing it never saw", async () => {
    const built = await ready();
    const report = built.subject.boundaries();
    assert.equal(report.network, "unsupported", "a policy of none is still a policy this world cannot hold");
    assert.equal(report.filesystemWrite, "unsupported");
    assert.deepEqual(report.crossings, [], "no step in this world names a place, so there is nothing to cross");
  });

  it("distinguishes a boundary the operator never asked for from one it cannot enforce", async () => {
    const built = await ready(plan({ boundary: { network: "allow", allow: [], filesystemWrite: "deny" } }));
    assert.equal(built.subject.boundaries().network, "not-requested");
    assert.equal(built.subject.boundaries().filesystemWrite, "unsupported");
  });

  it("offers a command register a criterion can be written against, and usage for every word", () => {
    assert.deepEqual([...DATA_COMMAND_WORDS], ["create-topic", "produce", "fetch", "metadata", "commit"]);
    const usage = dataCommandUsage();
    assert.equal(
      usage.length,
      DATA_COMMAND_WORDS.length,
      "every word has usage and no word has two, or a contract author reads a command that is not there",
    );
    for (const word of DATA_COMMAND_WORDS) {
      assert.ok(
        usage.some((line) => line.startsWith(`${word} `)),
        `\`${word}\` is a word this world performs and no usage line names it`,
      );
    }
  });

  it("does not perform a command the register does not hold", async () => {
    const built = await ready();
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["join-group"] }] }));
    // The port is what rules the word out; the adapter files the result rather than second-guessing it.
    assert.equal(observation.error, null);
    assert.deepEqual(built.port.runs, [["join-group"]]);
  });
});
