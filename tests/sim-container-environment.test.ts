/**
 * The `sim-container` adapter's own behaviour, judged without a runtime.
 *
 * The substitute's *rules* are held by `adapters/sim-container/container-port.test.ts`, which drives a
 * real port against a real temporary sandbox and real child processes. This file is one layer out and
 * asks a different question: what does the adapter do with the plan it was handed, the port it was
 * given, and the record that port produced? So the port here is a substitute for the substitute - it
 * answers from a table, counts what it was asked, and never starts a process - and every assertion is
 * about the adapter rather than about the world underneath it.
 *
 * Two of the behaviours here are the whole reason this world exists in the shape it does:
 *
 * - **A criterion's escape is a reading and the application's is a crossing.** The port records who
 *   asked, and this adapter is what turns one of those two into something the run fails on. Getting the
 *   parties the wrong way round would either fail every contract that probes the guard or excuse the
 *   application for reaching outside the world.
 * - **A reset rebuilds the world and re-provisions it, and does not touch the record.** Rebuilding
 *   without re-provisioning leaves a clean world and a run reporting every image absent - an artifact of
 *   the reset that reads like an application defect.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIM_RUNTIME_API_VERSION, SIM_RUNTIME_NAME, SIM_RUNTIME_VERSION } from "../adapters/sim-container/container-port.ts";
import type { ContainerEscape, ContainerPort } from "../adapters/sim-container/container-port.ts";
import {
  CONTAINER_ENV,
  CONTAINER_WORKSPACE,
  SimContainerEnvironment,
  parseCommandLine,
} from "../adapters/sim-container/sim-container-environment.ts";
import {
  CONTAINER_ACTIONS,
  CONTAINER_SIMULATED_SURFACES,
  isContainerObservationData,
} from "../core/environment/container-observation.ts";
import type {
  ContainerCallRecord,
  ContainerClient,
  ContainerObservationData,
} from "../core/environment/container-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import type { Logger } from "../core/clarification/types.ts";
import { fixedClock } from "./helpers/clock.ts";

/**
 * The fake process runner records the request and answers it, so `stdout` is what the application
 * "printed" - which is the only channel this world reads. A double that ran a program and returned
 * nothing would make every provisioning assertion here vacuous.
 */

// ---- fixtures -------------------------------------------------------------------------------------

const CONTAINER = {
  runtime: "docker",
  platform: "linux",
  root: ".veridian/sandbox-container",
} as const;

/** The image store the world builds on `prepare()`, seeded so `probe()` can see it. */
const STORE = `${CONTAINER.root}/store/images/keep`;

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
    adapter: "sim-container",
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
    container: { ...CONTAINER },
    vscode: null,
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
  steps: [{ run: ["container", "list"] }],
  targets: ["container.runtime"],
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

const EMPTY_READING: ContainerObservationData = {
  runtime: CONTAINER.runtime,
  version: SIM_RUNTIME_VERSION,
  sandbox: "/virtual/.veridian/sandbox-container",
  os: CONTAINER.platform,
  architecture: "x86_64",
  simulated: [...CONTAINER_SIMULATED_SURFACES],
  calls: [],
  images: [],
  containers: [],
  logs: [],
};

const reading = (overrides: Partial<ContainerObservationData> = {}): ContainerObservationData => ({
  ...EMPTY_READING,
  ...overrides,
});

const CALL: ContainerCallRecord = {
  action: "image.build",
  client: "provisioner",
  command: "image build -t cart-web:1 image",
  resource: "cart-web:1",
  result: "answered",
  status: 0,
  reason: null,
};

interface FakePort {
  readonly port: ContainerPort;
  /** Every command line put to this world, in order, with its source. */
  readonly commands: readonly { readonly argv: readonly string[]; readonly client: ContainerClient }[];
  /** The record this substitute answers with, for every command it does not refuse. */
  answer: ContainerCallRecord;
  /** This substitute's reading. Replaced by a test that is about what the adapter does with a reading. */
  current: ContainerObservationData;
  /** When this returns a spelling, the command is refused as naming a place outside the world. */
  escapeOn: ((argv: readonly string[]) => string | null) | null;
  /** When set, `read()` rejects with it - the "a reading the adapter could not build" case. */
  readError: Error | null;
  prepareCount(): number;
  resetCount(): number;
  stopCount(): number;
}

function fakePort(): FakePort {
  const commands: { argv: readonly string[]; client: ContainerClient }[] = [];
  const escapes: ContainerEscape[] = [];
  let prepares = 0;
  let resets = 0;
  let stops = 0;

  const state: FakePort = {
    commands,
    answer: CALL,
    current: EMPTY_READING,
    escapeOn: null,
    readError: null,
    prepareCount: () => prepares,
    resetCount: () => resets,
    stopCount: () => stops,
    port: {
      async prepare() {
        prepares += 1;
      },
      async reset() {
        resets += 1;
        state.current = EMPTY_READING;
      },
      async exec(req) {
        commands.push({ argv: req.argv, client: req.client });
        const spelled = state.escapeOn?.(req.argv) ?? null;
        if (spelled !== null) {
          // Filed exactly as the real port files it: at the one predicate that decides the question,
          // tagged with the party that asked. A double that recorded the refusal without the client
          // would make "the application's escape fails the run and a criterion's does not"
          // untestable - which is the property this file most needs to hold.
          escapes.push({ client: req.client, spelled });
          return {
            ...state.answer,
            client: req.client,
            command: req.argv.join(" "),
            result: "refused",
            status: 1,
            reason: `\`${spelled}\` lies outside this world`,
          };
        }
        return { ...state.answer, client: req.client, command: req.argv.join(" ") };
      },
      async read() {
        if (state.readError !== null) throw state.readError;
        return state.current;
      },
      escapes: () => escapes,
      async stop() {
        stops += 1;
      },
    },
  };
  return state;
}

/**
 * A process runner that records the request and answers it.
 *
 * `delayMs` is not a sleep: it is how a test makes a program genuinely outlive a deadline, because
 * `runToCompletion` decides `timedOut` from **its own timer** and overwrites whatever the result
 * claimed. A double that resolved instantly with `timedOut: true` would leave the adapter's deadline
 * branch unreached while appearing to exercise it - a green test over a path nothing walked.
 */
function fakeProcesses(
  answers: readonly Partial<ProcessResult>[] = [{}],
  delayMs?: number,
): ProcessRunner & { readonly calls: readonly ProcessRequest[] } {
  const calls: ProcessRequest[] = [];
  let index = 0;
  return {
    calls,
    run(processRequest: ProcessRequest) {
      calls.push(processRequest);
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
          delayMs === undefined
            ? Promise.resolve(settled)
            : new Promise((resolve) => setTimeout(() => resolve(settled), delayMs)),
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
  readonly subject: SimContainerEnvironment;
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
  /** Set before `start()`, because the provisioner runs during it. */
  readonly escapeOn?: (argv: readonly string[]) => string | null;
  readonly answer?: ContainerCallRecord;
}

function harness(environment: EnvironmentPlan, options: HarnessOptions = {}): Harness {
  const port = fakePort();
  const io = memoryIo({ [STORE]: "" }, "/virtual");
  const processes = fakeProcesses(options.answers, options.delayMs);
  const logger = capableLogger();
  port.escapeOn = options.escapeOn ?? null;
  port.answer = options.answer ?? CALL;
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimContainerEnvironment(environment, {
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

/** The `calls` an adapter's warning left behind, by message. */
const warnings = (logger: ReturnType<typeof capableLogger>, message: string): readonly RecordedEntry[] =>
  logger.entries.filter((entry) => entry.level === "warn" && entry.message === message);

// ---- refusals before anything runs -----------------------------------------------------------------

describe("the sim-container world refuses a document it cannot stand in for", () => {
  it("names the missing container declaration rather than judging a runtime nobody described", async () => {
    const built = harness(plan({ container: null }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /has no `container` declaration/),
    );
  });

  it("refuses a declaration with a blank runtime, naming the field rather than defaulting it", async () => {
    const built = harness(plan({ container: { ...CONTAINER, runtime: "" } }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /container: \{ runtime, platform, root \}/),
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
      (error: unknown) => assertEnvironmentError(error, /has not been started/),
    );
  });

  it("refuses an id that belongs to a different environment", async () => {
    const built = await ready();
    await assert.rejects(
      () => built.subject.observe("sim-container:podman", request()),
      (error: unknown) => assertEnvironmentError(error, /is `sim-container:docker`, and `sim-container:podman`/),
    );
  });

  it("keys the world on the runtime, and records both spellings of its root", async () => {
    const built = await ready();
    assert.equal(built.subject.kind, "sim-container");
    assert.equal(built.id, `sim-container:${CONTAINER.runtime}`);
    const create = built.logger.entries.find((entry) => entry.message === "environment.create");
    assert.equal(create?.fields["root"], CONTAINER.root);
    assert.equal(create?.fields["host"], built.io.resolve(CONTAINER.root));
    assert.equal(create?.fields["platform"], CONTAINER.platform);
  });
});

// ---- what reaches the application ------------------------------------------------------------------

describe("the world's facts reach a separate process, and a container path is not a host path", () => {
  it("hands the provisioner the sandbox, the workspace, the runtime and the platform", async () => {
    const built = await ready();
    const [first] = built.processes.calls;
    assert.ok(first !== undefined);
    assert.equal(first.env?.[CONTAINER_ENV.sandbox], built.io.resolve(CONTAINER.root));
    assert.equal(first.env?.[CONTAINER_ENV.workspace], CONTAINER_WORKSPACE);
    assert.equal(first.env?.[CONTAINER_ENV.runtime], CONTAINER.runtime);
    assert.equal(first.env?.[CONTAINER_ENV.platform], CONTAINER.platform);
    assert.equal(first.cwd, built.io.resolve("/virtual/app"));
  });

  it("spells the workspace as a container path, which this machine could never open", async () => {
    const built = await ready();
    const workspace = built.processes.calls[0]?.env?.[CONTAINER_ENV.workspace] ?? "";
    // The whole reason the pair exists: the application is handed one path it can open and one it
    // cannot, and a program that passed the second to a host-taking command is refused by name.
    assert.equal(workspace, "/workspace");
    assert.ok(!workspace.includes(built.io.resolve("/virtual")));
    assert.notEqual(workspace, built.processes.calls[0]?.env?.[CONTAINER_ENV.sandbox]);
  });

  it("passes the operator's own variables through beside the four it derives", async () => {
    const built = await ready(plan({ env: { CART_PORT: "8080" } }));
    // The application reads this to decide what to publish. An adapter that derived four names and
    // dropped the document's own environment would run a program that read `undefined`, defaulted,
    // and provisioned a world every criterion then judged - nothing failing, and nothing reported.
    assert.equal(built.processes.calls[0]?.env?.["CART_PORT"], "8080");
    assert.equal(built.processes.calls[0]?.env?.[CONTAINER_ENV.runtime], CONTAINER.runtime);
  });

  it("hands over exactly four derived names when the document declares none", async () => {
    const built = await ready();
    const keys = Object.keys(built.processes.calls[0]?.env ?? {}).filter((key) => key !== "CART_PORT");
    assert.deepEqual(
      keys.sort(),
      [CONTAINER_ENV.platform, CONTAINER_ENV.runtime, CONTAINER_ENV.sandbox, CONTAINER_ENV.workspace].sort(),
    );
    // Every derived name is namespaced, so an application cannot confuse one of this world's facts for
    // a real runtime's variable of the same idea.
    for (const key of keys) assert.match(key, /^VERIDIAN_CONTAINER_/);
  });

  it("declares all four names once, and the workspace name against the constant beside it", () => {
    assert.deepEqual(Object.keys(CONTAINER_ENV).sort(), ["platform", "runtime", "sandbox", "workspace"]);
    assert.equal(CONTAINER_ENV.workspace, "VERIDIAN_CONTAINER_WORKSPACE");
    assert.equal(CONTAINER_WORKSPACE, "/workspace");
  });
});

// ---- readiness -------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by looking", () => {
  it("answers not-ok naming the missing store when the world was never built", async () => {
    const built = harness(plan());
    // No seed at the store path: the world was never prepared, and this is what that looks like.
    const io = memoryIo({}, "/virtual");
    const bare = new SimContainerEnvironment(plan(), {
      io,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger: built.logger,
      processes: built.processes,
      stateDir: ".veridian",
      port: built.port.port,
    });
    const { id } = await bare.create();
    await bare.start(id);
    const probe = await bare.probe(id);
    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /holds no image store, so the world was never built/);
  });

  it("answers ok with no pattern declared, and never invents a status code", async () => {
    const built = await ready();
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, true);
    assert.equal(probe.statusCode, null);
    assert.equal(probe.patternSeen, null);
    assert.equal(probe.message, null);
  });

  it("names a different runtime's identity rather than answering about the declared one", async () => {
    const built = await ready();
    built.port.current = reading({ runtime: "podman", os: "linux" });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /reports itself as `podman`/);
    assert.match(probe.message ?? "", /declares `docker`/);
  });

  it("reports the readiness pattern seen, as a boolean", async () => {
    const built = await ready(plan({ start: { command: "node", args: ["provision.mjs"], readyPattern: "cart ready" } }), {
      answers: [{ stdout: "building\ncart ready\n" }],
    });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, true);
    assert.equal(probe.patternSeen, true);
    assert.equal(probe.statusCode, null);
  });

  it("does not report a pattern seen for a program that never printed it", async () => {
    const built = await ready(plan({ start: { command: "node", args: ["provision.mjs"], readyPattern: "cart ready" } }), {
      answers: [{ stdout: "building\n" }],
    });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, false);
    assert.equal(probe.patternSeen, null);
    assert.match(probe.message ?? "", /never printed \/cart ready\//);
  });

  it("names a reading whose platform is not the one the document declares", async () => {
    const built = await ready();
    built.port.current = reading({ runtime: CONTAINER.runtime, os: "windows" });
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /reports itself as `docker` on `windows`/);
    assert.match(probe.message ?? "", /declares `docker` on `linux`/);
  });

  it("records the application's own command line, so a reader can see what it asked for", async () => {
    const built = await ready();
    const start = built.logger.entries.find((entry) => entry.message === "environment.provision.application");
    assert.equal(start?.fields["command"], "node");
    assert.deepEqual(start?.fields["args"], ["provision.mjs"]);
    assert.equal(start?.fields["cwd"], "/virtual/app");
    assert.equal(start?.fields["root"], CONTAINER.root);
    assert.equal(start?.fields["host"], built.io.resolve(CONTAINER.root));
  });
});

// ---- the application's own provisioning -------------------------------------------------------------

describe("the application provisions the world through vectors the world really executes", () => {
  it("runs every JSON argument vector the program printed, as the provisioner", async () => {
    const built = await ready(plan(), {
      answers: [
        {
          stdout:
            '["image","build","-t","cart-web:1","image"]\n["container","create","--name","cart","cart-web:1"]\n',
        },
      ],
    });
    assert.deepEqual(built.port.commands, [
      { argv: ["image", "build", "-t", "cart-web:1", "image"], client: "provisioner" },
      { argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" },
    ]);
  });

  it("files the application's own commands in the same record the criteria's go into", async () => {
    const built = await ready(plan(), { answers: [{ stdout: '["runtime","info"]\n' }] });
    await built.subject.execute(built.id, request({ steps: [{ run: ["container", "list"] }] }));
    assert.deepEqual(
      built.port.commands.map((command) => command.client),
      ["provisioner", "criterion"],
    );
  });

  it("records a line it cannot read as an observation rather than throwing", async () => {
    const built = await ready(plan(), { answers: [{ stdout: 'building the image\n["runtime","info"]\n' }] });
    assert.deepEqual(built.port.commands, [{ argv: ["runtime", "info"], client: "provisioner" }]);
    const warned = warnings(built.logger, "environment.provision.line");
    assert.equal(warned.length, 1);
    assert.equal(warned[0]?.fields["line"], "building the image");
    assert.equal(built.port.commands.length, 1, "the narration performed nothing and lost nothing");
  });

  it("records a command the world does not implement as a refusal, rather than failing the start", async () => {
    const built = await ready(plan(), {
      answers: [{ stdout: '["container","prune"]\n' }],
      answer: {
        ...CALL,
        action: null,
        result: "refused",
        status: 1,
        reason: "this world does not implement `container prune`",
      },
    });
    assert.equal(built.port.commands.length, 1, "the command was put to the world");
    const warned = warnings(built.logger, "environment.provision.refused");
    assert.equal(warned.length, 1, "the refusal is said out loud, because a reader would otherwise never see it");
    assert.match(String(warned[0]?.fields["reason"]), /does not implement/);
    // The world started: a refusal is a fact about the application, and only a criterion may judge it.
    const observation = await built.subject.observe(built.id, request());
    assert.equal(observation.error, null);
  });

  it("refuses a provisioning program that exited non-zero, naming the code and its stderr", async () => {
    // The subject that must fail is the one whose *own* runner answers with a failure: an id handed to
    // a second instance created nothing, so the refusal would name the wrong cause entirely.
    const built = harness(plan(), { answers: [{ code: 3, stderr: "no Dockerfile\n" }] });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 3: no Dockerfile/),
    );
  });

  it("refuses a provisioning program that did not finish, naming the deadline", async () => {
    const built = harness(plan(), { provisionTimeoutMs: 20, delayMs: 300 });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within 20ms/),
    );
  });
});

// ---- `run` steps, and only them ---------------------------------------------------------------------

describe("a criterion acts through `run` steps, and only through them", () => {
  it("executes a run step as the criterion's own probe and returns the reading", async () => {
    const built = await ready(plan(), { answers: [{ stdout: "" }] });
    built.port.current = reading({ calls: [CALL] });
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["volume", "create", "cart-data"] }] }));
    assert.equal(observation.error, null);
    assert.equal(observation.kind, "container.runtime");
    assert.deepEqual(built.port.commands.at(-1), { argv: ["volume", "create", "cart-data"], client: "criterion" });
    assert.equal(isContainerObservationData(observation.data), true);
  });

  it("refuses an acting step it cannot perform, naming the step number and its kind", async () => {
    // The application's own command is put in the record first, so "nothing was performed for the
    // criterion" is a claim about a record that is not simply empty.
    const built = await ready(plan(), { answers: [{ stdout: '["runtime","info"]\n' }] });
    const observation = await built.subject.execute(built.id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(observation.error?.message ?? "", /step 1 of AC-001 is `click`/);
    assert.deepEqual(built.port.commands, [{ argv: ["runtime", "info"], client: "provisioner" }]);
  });

  it("names the position of the step it cannot perform, not the first one", async () => {
    const built = await ready(plan(), { answers: [{ stdout: '["runtime","info"]\n' }] });
    const observation = await built.subject.execute(
      built.id,
      request({ steps: [{ run: ["container", "list"] }, { sql: "select 1" }] }),
    );
    assert.match(observation.error?.message ?? "", /step 2 of AC-001 is `sql`/);
    assert.deepEqual(
      built.port.commands,
      [{ argv: ["runtime", "info"], client: "provisioner" }],
      "nothing is performed for a criterion any of whose steps this world cannot perform - not even the runs before it",
    );
  });

  it("does not refuse a non-run step it was only asked to observe", async () => {
    const built = await ready(plan(), { answers: [{ stdout: '["runtime","info"]\n' }] });
    const observation = await built.subject.observe(built.id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.error, null);
    assert.deepEqual(built.port.commands, [{ argv: ["runtime", "info"], client: "provisioner" }]);
  });

  it("records a ruled-out command in the reading and warns, rather than failing the criterion", async () => {
    const built = await ready(plan(), {
      answer: { ...CALL, result: "refused", status: 1, reason: "this world has no registry" },
    });
    const observation = await built.subject.execute(built.id, request({ steps: [{ run: ["image", "pull", "nginx"] }] }));
    assert.equal(observation.error, null);
    assert.equal(built.port.commands.at(-1)?.client, "criterion");
    const warned = warnings(built.logger, "environment.run");
    assert.equal(warned.length, 1);
    assert.equal(warned[0]?.fields["criterionId"], "AC-001");
  });
});

// ---- the boundary, and who crossed it ---------------------------------------------------------------

describe("an escape by the application is a crossing, and one by a criterion is a reading", () => {
  it("files the application's escape as a crossing the run fails on", async () => {
    const built = await ready(plan(), {
      answers: [{ stdout: '["container","create","-v","../../secrets:/secrets","cart-web:1"]\n' }],
      escapeOn: () => "../../secrets",
    });
    const report = built.subject.boundaries();
    assert.equal(report.crossings.length, 1);
    assert.equal(report.crossings[0]?.boundary, "filesystemWrite");
    assert.equal(report.crossings[0]?.criterionId, null);
    assert.match(report.crossings[0]?.subject ?? "", /named `\.\.\/\.\.\/secrets`, which lies outside this world/);
  });

  it("does not file a criterion's escape as a crossing, even after a reset re-reads the record", async () => {
    // The guard can only be exercised *after* a criterion has escaped and *before* the next provisioning
    // reads the record, because that is the only moment the two party names are in one list. Asserting at
    // the moment of the escape alone would pass with the guard deleted: nothing would have looked yet.
    const built = await ready(plan(), { escapeOn: () => "/etc/passwd" });
    const observation = await built.subject.execute(
      built.id,
      request({ steps: [{ run: ["image", "build", "/etc"] }] }),
    );
    assert.equal(observation.error, null, "the refusal is a fact the criterion is allowed to judge");
    const warned = built.logger.entries.filter((entry) => entry.message === "environment.run");
    assert.equal(warned.length, 1, "the criterion's refusal is recorded rather than thrown");
    assert.match(String(warned[0]?.fields["reason"]), /lies outside this world/);
    assert.deepEqual(built.subject.boundaries().crossings, []);

    await built.subject.reset(built.id);
    assert.deepEqual(
      built.subject.boundaries().crossings,
      [],
      "a criterion that probes the guard is not the application violating it - the re-provisioning " +
        "reads the same record, and this is the filter that tells the two parties apart",
    );
  });

  it("keeps a crossing across a reset, and counts each provisioning's own", async () => {
    const built = await ready(plan(), {
      answers: [{ stdout: '["container","create","-v","../../secrets:/secrets","cart-web:1"]\n' }],
      escapeOn: () => "../../secrets",
    });
    assert.equal(built.subject.boundaries().crossings.length, 1);
    await built.subject.reset(built.id);
    assert.equal(
      built.subject.boundaries().crossings.length,
      2,
      "a repair does not undo a violation, and the reset does not clear the record of one",
    );
    await built.subject.reset(built.id);
    assert.equal(
      built.subject.boundaries().crossings.length,
      3,
      "the watermark keeps each provisioning reporting its own escape and never the previous one again",
    );
  });

  it("reports both boundary policies unsupported, and its containment guard separately", async () => {
    const built = await ready();
    const report = built.subject.boundaries();
    assert.equal(report.network, "unsupported");
    assert.equal(report.filesystemWrite, "unsupported");
    assert.deepEqual(report.crossings, []);
  });

  it("distinguishes a boundary the operator never asked for from one it cannot enforce", async () => {
    const built = await ready(plan({ boundary: { network: "allow", allow: [], filesystemWrite: "deny" } }));
    const report = built.subject.boundaries();
    assert.equal(report.network, "not-requested");
    assert.equal(report.filesystemWrite, "unsupported", "a policy of none is still a policy this world cannot hold");
  });
});

// ---- evidence -----------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the transcript only when the run issued commands", async () => {
    const built = await ready();
    built.port.current = reading({ calls: [CALL] });
    const observation = await built.subject.execute(built.id, request());
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json", "artifacts/AC-001.calls.json"],
    );
    for (const artifact of observation.artifacts) {
      assert.equal(artifact.criterionId, "AC-001");
      assert.equal(artifact.kind, "json");
    }
    const written = await built.io.readTextFile(".veridian/runs/run-1/artifacts/AC-001.calls.json");
    assert.match(written ?? "", /"action": "image\.build"/);
  });

  it("writes only the reading when the world holds no commands at all", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request());
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json"],
    );
  });

  it("warns about a kind it did not write, without claiming it wrote it", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ evidence: ["screenshot", "json"] }));
    const warned = warnings(built.logger, "environment.evidence");
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
    assert.deepEqual(warnings(built.logger, "environment.evidence"), []);
  });

  it("answers a reading it could not build with an environment failure, never with empty data", async () => {
    const built = await ready();
    built.port.readError = new Error("the sandbox was removed underneath this world");
    const observation = await built.subject.observe(built.id, request());
    assert.equal(observation.data, null);
    assert.deepEqual(observation.artifacts, []);
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(observation.error?.message ?? "", /removed underneath this world/);
  });

  it("stamps the observation with the run, the criterion and the world's own kind", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ criterionId: "AC-004", runId: "run-9" }));
    assert.equal(observation.kind, "container.runtime");
    assert.equal(observation.runId, "run-9");
    assert.equal(observation.environmentId, built.id);
    assert.equal(observation.capturedAt, "2026-01-01T00:00:00.000Z");
  });
});

// ---- the lifecycle ------------------------------------------------------------------------------------

describe("the lifecycle is the same one every other world exposes", () => {
  it("prepares the store before the application provisions it", async () => {
    const built = await ready();
    const prepared = built.port.prepareCount();
    assert.equal(prepared, 1);
    // `prepare()` is the world's; the provisioner is the application's. Both happened, in that order,
    // and the log says which command did the second.
    assert.equal(built.processes.calls.length, 1);
  });

  it("records deploy as an explicit no-op naming the command rather than leaving it empty", async () => {
    const built = await ready(plan(), { answers: [{ stdout: '["runtime","info"]\n' }] });
    await built.subject.deploy(built.id);
    const deploy = built.logger.entries.find((entry) => entry.message === "environment.deploy");
    assert.equal(deploy?.fields["command"], "node");
    assert.match(String(deploy?.fields["note"]), /issued its commands during start\(\)/);
    assert.deepEqual(
      built.port.commands.map((command) => command.client),
      ["provisioner"],
      "deploy performs nothing of its own",
    );
  });

  it("rebuilds the store and re-provisions it on a restart reset", async () => {
    const built = await ready();
    await built.subject.reset(built.id);
    assert.equal(built.port.resetCount(), 1);
    assert.equal(built.processes.calls.length, 2, "the application provisioned the clean world again");
    const reset = built.logger.entries.filter((entry) => entry.message === "environment.reset");
    assert.equal(reset.at(-1)?.fields["strategy"], "restart");
  });

  it("refuses a snapshot-restore reset by name, naming the path that does carry it", async () => {
    const built = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) =>
        assertEnvironmentError(error, /never arrives here through `EnvironmentManager\.reset\(\)`/),
    );
    assert.equal(built.port.resetCount(), 0, "the world is not rebuilt when the reset is refused");
  });

  it("refuses a snapshot and a restore, each naming the reason rather than an absence", async () => {
    const built = await ready();
    await assert.rejects(
      () => built.subject.snapshot(built.id),
      (error: unknown) => assertEnvironmentError(error, /would produce a snapshot that restores a world that is not the one that was running/),
    );
    await assert.rejects(
      () => built.subject.restore(built.id, "prior"),
      (error: unknown) => assertEnvironmentError(error, /no snapshot `prior` for this adapter to put back/),
    );
  });

  it("runs a declared custom reset command instead of rebuilding the store", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }));
    await built.subject.reset(built.id);
    assert.equal(built.port.resetCount(), 0);
    assert.equal(built.processes.calls.length, 2, "the custom command ran instead");
    assert.equal(built.processes.calls.at(-1)?.command, "npm");
  });

  it("hands a custom reset the same four facts the provisioner got", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }));
    await built.subject.reset(built.id);
    const custom = built.processes.calls.at(-1);
    assert.equal(custom?.env?.[CONTAINER_ENV.sandbox], built.io.resolve(CONTAINER.root));
    assert.equal(custom?.env?.[CONTAINER_ENV.workspace], CONTAINER_WORKSPACE);
  });

  it("refuses a custom reset command that fails, rather than falling back to a rebuild", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "npm" } }), {
      answers: [{}, { code: 2, stderr: "no reset script\n" }],
    });
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 2: no reset script/),
    );
    assert.equal(built.port.resetCount(), 0, "a failed reset is not quietly replaced by a rebuild");
  });

  it("warns, and still rebuilds, when a custom strategy declares no command", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: null } }));
    await built.subject.reset(built.id);
    assert.equal(built.port.resetCount(), 1);
    assert.equal(
      warnings(built.logger, "environment.reset").length,
      1,
      "the fallback is said out loud rather than performed silently",
    );
  });

  it("stops every child on stop, and leaves the sandbox where a bundle can still quote it", async () => {
    const built = await ready();
    await built.subject.stop(built.id);
    assert.equal(built.port.stopCount(), 1);
    assert.equal(built.port.resetCount(), 0, "stopping is not resetting");
    // The sandbox is deliberately left in place, because a bundle quotes paths inside it: a `stop()`
    // that deleted it would leave every artifact path in the run's own evidence pointing at nothing.
    // It is `destroy()` that returns this world to an uncreated state, and that is the case below.
    assert.equal(await built.io.exists(built.io.resolve(CONTAINER.root)), true);
  });

  it("destroys back to an uncreated state, so the instance cannot be used again", async () => {
    const built = await ready();
    await built.subject.destroy(built.id);
    assert.equal(built.port.stopCount(), 1);
    await assert.rejects(
      () => built.subject.observe(built.id, request()),
      (error: unknown) => assertEnvironmentError(error, /was never created/),
    );
  });

  it("names the runtime the readings carry, and the substitution's surfaces as declared constants", () => {
    assert.equal(SIM_RUNTIME_NAME, "veridian-container-sim");
    assert.equal(SIM_RUNTIME_API_VERSION, "v1");
    assert.equal(CONTAINER_ACTIONS.length, 19);
    assert.equal(CONTAINER_SIMULATED_SURFACES.length, 7);
  });
});

// ---- one line of a program's output --------------------------------------------------------------------

describe("a line of the application's output is read as a command or as nothing at all", () => {
  it("reads a JSON array of strings as an argument vector", () => {
    assert.deepEqual(parseCommandLine('["image","build","-t","x:1"]'), ["image", "build", "-t", "x:1"]);
  });

  it("answers null for narration rather than inventing a command out of it", () => {
    assert.equal(parseCommandLine("building the image"), null);
    assert.equal(parseCommandLine(""), null);
    assert.equal(parseCommandLine("{ not json"), null);
  });

  it("answers null for a JSON value that is not an array of non-blank strings", () => {
    assert.equal(parseCommandLine('{"run":"image"}'), null);
    assert.equal(parseCommandLine("[]"), null);
    assert.equal(parseCommandLine('["image", 7]'), null);
    assert.equal(parseCommandLine('["image", null]'), null);
    assert.equal(parseCommandLine('["image",""]'), null);
    assert.equal(parseCommandLine('["image","   "]'), null);
    assert.equal(parseCommandLine('["image",["build"]]'), null);
    assert.equal(parseCommandLine("null"), null);
  });
});
