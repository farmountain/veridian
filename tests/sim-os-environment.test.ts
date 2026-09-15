import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OS_ENV, SimOsEnvironment } from "../adapters/sim-os/sim-os-environment.ts";
import { OS_IDENTITY_PATHS } from "../adapters/sim-os/os-port.ts";
import type { OsPort } from "../adapters/sim-os/os-port.ts";
import { OS_OBSERVATION_KIND, isOsObservationData } from "../core/environment/os-observation.ts";
import type {
  OsExecRecord,
  OsObservationData,
  OsSimulatedSurface,
} from "../core/environment/os-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import type { Logger } from "../core/clarification/types.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The simulated operating-system world, against a fake substitute.
 *
 * The port has its own suite, held against a real tree and real sockets, because the facts worth
 * holding there are facts about a filesystem. *This* suite is about the adapter: whether it refuses to
 * build a system it cannot describe, whether a readiness pattern can be reported from a run that never
 * completed, whether the application's escape is recorded differently from a criterion's, and whether
 * the sandbox root it hands to a *second process* is the same directory the port was handed.
 *
 * That last one is the reason this file exists at all. It is the defect this world shipped: the
 * document says `root: app/.sandbox`, the port resolved that against the io root, and the application -
 * a separate process spawned with `cwd` set to its own directory - resolved the same string against
 * that. One string, two trees, and every criterion still passed, because the port and the application
 * agreed on where the wrong place was. A path handed to a second process is only ever absolute or
 * ambiguous, and nothing in a contract can see which it got.
 *
 * Four assertions here are load-bearing, and each is written to fail for the right reason:
 *
 * - **the derived root, in three places.** `create()`, `start()` and the provision log have to name the
 *   same resolved path, and it has to be `io.resolve(os.root)` - not the raw document value and not the
 *   doubled `appPath` form. Three readings of one fact, because two of them disagreeing is how the
 *   first fix left a bundle quoting a path this machine cannot open.
 * - **a non-`run` step in an acting call.** `VALIDATOR_ERROR`, not an exception and not a silent skip,
 *   because a criterion judged in a system it never acted on is a verdict the reading cannot justify.
 * - **the asymmetry between the two callers.** An application's escape across the sandbox boundary
 *   becomes a crossing, which fails the run; a criterion's does not, because the operator's own
 *   document is allowed to probe the guard.
 * - **`probe()` cannot report a pattern from a run that did not complete.** The field it matches
 *   against is assigned after the refusals, so a timed-out provisioning program is a failed world
 *   rather than a partially-ready one.
 */

// ---- fixtures -------------------------------------------------------------------------------------

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "sim-os",
  app: "app",
  appPath: "/virtual/app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["provision.mjs"], readyPattern: null },
  url: null,
  api: null,
  databasePath: null,
  cluster: null,
  posix: null,
  os: { family: "windows", system: "Windows Server 2022", user: "svc-audit", root: "app/.sandbox" },
  cloud: null,
  container: null,
  vscode: null,
  health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 10, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
  ...overrides,
});

const request = (overrides: Partial<ObservationRequest> = {}): ObservationRequest => ({
  criterionId: "AC-001",
  runId: "run-1",
  steps: [{ run: ["whoami"] }],
  targets: ["whoami"],
  evidence: [],
  ...overrides,
});

/** The surfaces a `windows` reading carries. The port reports one family's pair, not both. */
const WINDOWS_SURFACES: readonly OsSimulatedSurface[] = [
  "kernel",
  "os-identity",
  "path-semantics",
  "acl",
  "registry",
  "service-manager",
  "egress",
  "provisioning",
];

/** The world's own identity file, as the port writes it. `probe()` reads the family and system here. */
const identityOf = (family: string, system: string): string =>
  `${JSON.stringify({ family, system, simulated: true }, null, 2)}\n`;

/** A reading a fake port returns. Every field a real one sets, so `isOsObservationData` holds. */
const reading = (execs: readonly OsExecRecord[] = []): OsObservationData => {
  const text = identityOf("windows", "Windows Server 2022");
  return {
    host: "veridian-sim-os",
    family: "windows",
    system: "Windows Server 2022",
    root: "/tmp/veridian-sim-os",
    user: "svc-audit",
    caseSensitive: false,
    simulated: WINDOWS_SURFACES,
    execs,
    files: [
      {
        path: OS_IDENTITY_PATHS.windows,
        kind: "file",
        bytes: Buffer.byteLength(text),
        owner: "svc-audit",
        group: "svc-audit",
        sha256: "a".repeat(64),
        text,
        textWithheld: null,
      },
    ],
    acls: [],
    accounts: [],
    settings: [],
    services: [],
  };
};

interface RecordedEntry {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * A logger that keeps the *fields*, which `recordingLogger` deliberately drops.
 *
 * The three readings of the resolved root are asserted from the log, and a double that kept only the
 * message could not tell `app/.sandbox` from `/virtual/app/.sandbox` - which is exactly the difference
 * this file exists to hold.
 */
function capableLogger(): { readonly entries: RecordedEntry[] } & Logger {
  const entries: RecordedEntry[] = [];
  const push =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      entries.push({ level, message, fields: fields ?? {} });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn") };
}

interface FakePort {
  readonly port: OsPort;
  /** Every argument vector the adapter asked this world to execute, in order, with its source. */
  readonly execs: readonly { readonly argv: readonly string[]; readonly source: string }[];
  readonly recorded: readonly OsExecRecord[];
  readonly snapshots: readonly string[];
  readonly restores: readonly string[];
  prepareCount(): number;
  resetCount(): number;
  stopCount(): number;
}

/**
 * A substitute that answers from a table rather than from a tree.
 *
 * `refuse` is a predicate rather than a list so a test can say "anything that climbs out" without
 * spelling every escaping argument vector out - and so the escape assertions here and the containment
 * assertions in the port's suite are visibly one rule seen from two layers.
 */
function fakePort(
  options: {
    readonly refuse?: (argv: readonly string[]) => boolean;
    readonly reading?: OsObservationData;
    readonly prepare?: () => Promise<void>;
  } = {},
): FakePort {
  const execs: { argv: readonly string[]; source: string }[] = [];
  const recorded: OsExecRecord[] = [];
  const snapshots: string[] = [];
  const restores: string[] = [];
  const refuse = options.refuse ?? ((): boolean => false);
  let prepares = 0;
  let resets = 0;
  let stops = 0;

  return {
    execs,
    recorded,
    snapshots,
    restores,
    prepareCount: () => prepares,
    resetCount: () => resets,
    stopCount: () => stops,
    port: {
      async prepare() {
        prepares += 1;
        await options.prepare?.();
      },
      async reset() {
        resets += 1;
      },
      async exec(exec) {
        execs.push({ argv: exec.argv, source: exec.source });
        const denied = refuse(exec.argv);
        const record: OsExecRecord = {
          source: exec.source,
          argv: exec.argv,
          program: exec.argv[0] ?? "",
          result: denied ? "refused" : "completed",
          exitCode: denied ? null : 0,
          stdout: "",
          stderr: "",
          reason: denied ? "this command climbs out of the sandbox" : null,
          durationMs: 1,
        };
        // Filed here, exactly as the real port files it. A double that returned a record without
        // adding it to the list the reading is built from would make `read()` disagree with the port it
        // stands in for - and it would have made "a criterion's refusal is in the reading" untestable,
        // which is the defect this line was written for rather than a detail of the fixture.
        recorded.push(record);
        return record;
      },
      record(entry) {
        recorded.push(entry);
      },
      async snapshot(destination) {
        snapshots.push(destination);
      },
      async restoreFrom(source) {
        restores.push(source);
      },
      async read() {
        return options.reading ?? reading([...recorded]);
      },
      async stop() {
        stops += 1;
      },
    },
  };
}

function fakeProcesses(
  answers: readonly Partial<ProcessResult>[] = [{}],
  /** A delay before `exited` resolves, so a real deadline can elapse in front of it. */
  delayMs = 0,
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
      const exited =
        delayMs === 0
          ? Promise.resolve(settled)
          : new Promise<ProcessResult>((resolve) => {
              setTimeout(() => {
                resolve(settled);
              }, delayMs);
            });
      return {
        pid: 1,
        exited,
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
  readonly subject: SimOsEnvironment;
  readonly port: FakePort;
  readonly io: ReturnType<typeof memoryIo>;
  readonly processes: ProcessRunner & { readonly calls: readonly ProcessRequest[] };
  readonly logger: ReturnType<typeof capableLogger>;
}

interface HarnessOptions {
  readonly port?: FakePort;
  readonly answers?: readonly Partial<ProcessResult>[];
  readonly files?: Readonly<Record<string, string>>;
  readonly provisionTimeoutMs?: number;
  readonly delayMs?: number;
}

function harness(environment: EnvironmentPlan, options: HarnessOptions = {}): Harness {
  const port = options.port ?? fakePort();
  const io = memoryIo({
    // The world's own root, as the io port resolves `app/.sandbox`. Seeded so the snapshot and
    // restore assertions address a directory that exists rather than one this test invented.
    ".veridian/snapshots/prior/marker": "",
    ...options.files,
  });
  const processes = fakeProcesses(options.answers, options.delayMs ?? 0);
  const logger = capableLogger();
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimOsEnvironment(environment, {
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

// ---- refusals before anything runs -----------------------------------------------------------------

describe("the sim-os world refuses a document it cannot stand in for", () => {
  it("names the missing os declaration rather than building an undescribed system", async () => {
    const { subject } = harness(plan({ os: null }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /no `os` declaration/),
    );
  });

  it("refuses to judge a system it did not let the application provision", async () => {
    const { subject } = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /no `start\.command`/),
    );
  });

  it("refuses to observe a world that was created but never started", async () => {
    // The provisioning program is what makes the sandbox *this* contract's world. A criterion judged
    // before it ran would be judging whatever a previous run left in the directory - which reads like
    // an application defect and is an artifact of the harness.
    const { subject } = harness(plan());
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /has not been started/),
    );
  });

  it("refuses an id that belongs to a different environment", async () => {
    const { subject } = await ready();
    await assert.rejects(
      () => subject.observe("sim-os:windows:somebody-else", request()),
      (error: unknown) => assertEnvironmentError(error, /addressed as/),
    );
  });
});

// ---- the sandbox root, in three places -------------------------------------------------------------

describe("the root handed to a second process is one absolute path, derived once", () => {
  it("resolves the document's relative root through the io port, not against the app path", async () => {
    const { logger, io, processes } = await ready();
    const created = logger.entries.find((entry) => entry.message === "environment.create");
    assert.ok(created, "create() has to record the world it built, including where it built it");

    assert.equal(
      created.fields["root"],
      "/virtual/app/.sandbox",
      "the application is a *separate* process spawned with `cwd` set to its own directory, so a " +
        "relative root is one string naming two trees. Resolving it against `appPath` instead would " +
        "build /virtual/app/app/.sandbox - a world in the wrong place that still passes every " +
        "criterion, because the port and the application agree on where the wrong place is",
    );
    assert.equal(
      created.fields["root"],
      io.resolve(plan().os?.root ?? ""),
      "the derivation has to be the io port's own answer, because that is the spelling the port's " +
        "`node:fs` calls use",
    );
    assert.equal(
      processes.calls[0]?.env?.[OS_ENV.host],
      "/virtual/app/.sandbox",
      "the port and the application were handed different directories, so the world rebuilt one tree " +
        "while the application provisioned another beside it",
    );
  });

  it("records one reading of the root across create, start and the provision log", async () => {
    // Three writes of one fact, and two of them disagreeing is how the first fix left a bundle naming
    // a path this machine cannot open while the port was handed the path it can.
    const { logger } = await ready();
    const read = (message: string): unknown => {
      const entry = logger.entries.find((item) => item.message === message);
      assert.ok(entry, `${message} was never recorded`);
      return entry.fields["root"];
    };
    assert.equal(read("environment.create"), "/virtual/app/.sandbox");
    assert.equal(
      read("environment.start"),
      read("environment.create"),
      "start() logged a different root than create() did, so the bundle holds two readings of where " +
        "this world lived",
    );

    const provision = logger.entries.find(
      (entry) => entry.message === "environment.provision.application",
    );
    assert.ok(provision);
    assert.equal(
      provision.fields["root"],
      "app/.sandbox",
      "the document's own value, which is what a reader comparing the log with their file needs",
    );
    assert.equal(
      provision.fields["host"],
      "/virtual/app/.sandbox",
      "and the host path beside it, because neither reading alone answers where the world lived",
    );
  });

  it("hands the application the world's spelling of its own root and no borrowed variable names", async () => {
    const { processes } = await ready();
    const env = processes.calls[0]?.env ?? {};
    assert.equal(env[OS_ENV.root], "C:\\", "the world's spelling, which is the one a criterion names");
    assert.equal(env[OS_ENV.family], "windows");
    assert.equal(env[OS_ENV.system], "Windows Server 2022");
    assert.equal(env[OS_ENV.user], "svc-audit");
    assert.equal(
      env["SystemRoot"],
      undefined,
      "a world with no login environment may not borrow the real ecosystem's variable names, or the " +
        "application will behave as though it had been logged in",
    );
    assert.equal(env["USERNAME"], undefined);
    assert.equal(env["PATH"], undefined);
  });

  it("spells the root for a macOS world with a forward slash", async () => {
    const { processes } = await ready(
      plan({
        os: { family: "macos", system: "macOS 14.5", user: "dev", root: "app/.sandbox" },
      }),
    );
    assert.equal(processes.calls[0]?.env?.[OS_ENV.root], "/");
  });
});

// ---- readiness --------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by looking", () => {
  it("answers ok with no pattern declared, and never invents a status code", async () => {
    const { subject, id } = await ready();
    const probe = await subject.probe(id);
    assert.equal(probe.ok, true);
    assert.equal(
      probe.statusCode,
      null,
      "a system has no status to return, and 200 would be an HTTP claim this world cannot make",
    );
    assert.equal(probe.message, null);
    assert.equal(probe.patternSeen, null, "no pattern was declared, so `null` - not `false`");
  });

  it("says the world was never built when the reading holds no identity file", async () => {
    const empty = { ...reading(), files: [] };
    const { subject } = harness(plan(), { port: fakePort({ reading: empty }) });
    const { id } = await subject.create();
    await subject.start(id);
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /was never built/);
    assert.ok(
      (probe.message ?? "").includes(OS_IDENTITY_PATHS.windows),
      "the message names the path it looked for, so the reader is not sent hunting",
    );
  });

  it("names a different system's identity rather than answering about the declared one", async () => {
    const wrong = {
      ...reading(),
      files: [
        {
          ...reading().files[0]!,
          text: identityOf("windows", "Windows 11 23H2"),
        },
      ],
    };
    const { subject } = harness(plan(), { port: fakePort({ reading: wrong }) });
    const { id } = await subject.create();
    await subject.start(id);
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /holds a different system's identity/);
  });

  it("reports the readiness pattern seen, as a boolean", async () => {
    const { subject, id } = await ready(
      plan({
        health: {
          path: null,
          expectStatus: null,
          timeoutMs: 5_000,
          intervalMs: 10,
          readyPattern: "provisioned",
        },
      }),
      { answers: [{ stdout: "provisioned 4 commands\n" }] },
    );
    const probe = await subject.probe(id);
    assert.equal(probe.ok, true);
    assert.equal(
      probe.patternSeen,
      true,
      "`patternSeen` is a boolean - reporting the pattern text back would make the field's type a " +
        "description of the document rather than an answer about the run",
    );
  });

  it("does not report a pattern seen for a provisioning program that never ran to completion", async () => {
    // The decisive one. A timed-out program can still have printed the pattern, so a world that held
    // the output before checking the deadline would report readiness for a run that failed - and the
    // `start()` refusal is what the operator needs, not a probe that agrees with the application.
    // The deadline is real: `runToCompletion` sets `timedOut` from its own timer, so the fake process
    // has to settle *after* it for the timeout path to be the one under test.
    const { subject, processes } = harness(
      plan({ start: { command: "node", args: ["provision.mjs"], readyPattern: "ready" } }),
      { answers: [{ stdout: "ready\n" }], provisionTimeoutMs: 1, delayMs: 40 },
    );
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within/),
    );
    assert.equal(processes.calls.length, 1);
  });

  it("refuses a provisioning program that exits non-zero, naming the code and its stderr", async () => {
    const { subject } = harness(plan(), { answers: [{ code: 2, stderr: "the account already exists\n" }] });
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) =>
        assertEnvironmentError(error, /exited with code 2: the account already exists/),
    );
  });

  it("refuses a provisioning program that never printed the declared pattern", async () => {
    const { subject } = harness(
      plan({ start: { command: "node", args: ["provision.mjs"], readyPattern: "ready:" } }),
      { answers: [{ stdout: "working\n" }] },
    );
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /never printed \/ready:\//),
    );
  });
});

// ---- the application's own work ----------------------------------------------------------------------

describe("the application provisions the world through vectors the world really executes", () => {
  it("runs every JSON argument vector the provisioning program printed, as the application", async () => {
    const { port } = await ready(plan(), {
      answers: [
        { stdout: '["net","user","svc-cart","/add"]\n["icacls","C:\\\\ProgramData\\\\Veridian","/grant","svc-cart:(R)"]\n' },
      ],
    });
    const application = port.execs.filter((entry) => entry.source === "application");
    assert.deepEqual(
      application.map((entry) => [...entry.argv]),
      [
        ["net", "user", "svc-cart", "/add"],
        ["icacls", "C:\\ProgramData\\Veridian", "/grant", "svc-cart:(R)"],
      ],
      "the world executes what the program said, with no word-splitting layer to disagree about it",
    );
  });

  it("files the application's own invocation in the same record the criteria's commands go into", async () => {
    const { port } = await ready(plan(), { answers: [{ stdout: '["whoami"]\n' }] });
    const own = port.recorded.find((entry) => entry.program === "node");
    assert.ok(own, "the provisioning program's own invocation is missing from the record");
    assert.equal(own.result, "completed");
    assert.equal(own.exitCode, 0);
    assert.equal(
      own.source,
      "application",
      "a reading that held only what the criteria ran could not answer whether the application's " +
        "program ran at all",
    );
  });

  it("records a line it cannot read as an observation rather than throwing", async () => {
    // A program that narrates to stdout has produced a fact about itself. Throwing here would report
    // "the world could not start" for what is actually "the application printed something odd", and
    // the criterion that reads the transcript is where that becomes a verdict.
    const { port, logger } = await ready(plan(), { answers: [{ stdout: "hardening the system\n" }] });
    assert.equal(port.execs.filter((entry) => entry.source === "application").length, 0);
    assert.ok(
      logger.entries.some(
        (entry) => entry.message === "environment.provision" && entry.level === "warn",
      ),
      "an unreadable provisioning line has to leave something in the log",
    );
  });

  it("warns about a command the world does not answer without failing the start", async () => {
    // The fake has to refuse, or the warning it is asserted against cannot exist: an ordinary double
    // answers everything, which is what the world does with `net` and not with `choco`. Written as a
    // real program's name rather than an invented one, because "a program this world does not have" is
    // the fact being reported.
    const refusing = fakePort({ refuse: (argv) => argv[0] === "choco" });
    const { logger, id, subject } = await ready(plan(), {
      port: refusing,
      answers: [{ stdout: '["choco","install","nodejs"]\n' }],
    });
    assert.ok(
      logger.entries.some((entry) => entry.message === "environment.provision" && entry.level === "warn"),
      "a world that does not answer a program has to say so, or the run silently judged a system " +
        "nothing touched",
    );
    const observation = await subject.observe(id, request());
    assert.equal(observation.error, null, "an unanswered program is a fact about the application");
  });
});

// ---- acting, and the asymmetry between the two callers ------------------------------------------------

describe("a criterion acts through `run` steps, and only through them", () => {
  it("executes a run step as the criterion's own probe and returns the reading", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request());

    assert.equal(observation.kind, OS_OBSERVATION_KIND);
    assert.equal(observation.error, null);
    assert.ok(isOsObservationData(observation.data));
    assert.deepEqual(
      port.execs.filter((entry) => entry.source === "criterion").map((entry) => [...entry.argv]),
      [["whoami"]],
    );
  });

  it("refuses an acting call whose step it cannot perform, and does not act at all", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request({ steps: [{ click: "#submit" }] }));

    assert.equal(
      observation.data,
      null,
      "a criterion judged in a system it never acted on has no reading",
    );
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(
      observation.error?.message ?? "",
      /performs `run` steps, and step 1 of AC-001 is `click`/,
    );
    assert.equal(port.execs.length, 0, "the refusal has to come before anything is executed");
  });

  it("does not refuse a non-run step it was only asked to observe", async () => {
    // `observe` is not asked to act, so a step it cannot perform is not a step it failed to perform -
    // the step belongs to whichever adapter owns that world, and this call is a reading.
    const { subject, id } = await ready();
    const observation = await subject.observe(id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.error, null);
    assert.ok(isOsObservationData(observation.data));
  });

  it("records a criterion's refused command in the reading and warns about it", async () => {
    // Recorded rather than thrown: a refusal is a fact about this world that a criterion is allowed to
    // be built on. Warned as well, because a contract that runs a command this world does not answer
    // and never reads the refusal would otherwise pass on a system nothing touched.
    const refusing = fakePort({ refuse: (argv) => argv[0] === "choco" });
    const { subject, id, logger } = await ready(plan(), { port: refusing });
    const observation = await subject.execute(id, request({ steps: [{ run: ["choco", "install"] }] }));

    assert.equal(observation.error, null);
    const execs = (observation.data as OsObservationData).execs;
    assert.equal(execs.at(-1)?.result, "refused");
    assert.equal(execs.at(-1)?.exitCode, null, "a refusal has no exit code and must not be given one");
    assert.ok(logger.entries.some((entry) => entry.message === "environment.run" && entry.level === "warn"));
  });

  it("takes an escape by the application as a safety crossing and one by a criterion as a reading", async () => {
    const escaping = (argv: readonly string[]): boolean =>
      argv.some((token) => token.split(/[\\/]/).includes(".."));
    const port = fakePort({ refuse: escaping });
    const { subject, id } = await ready(plan(), {
      port,
      answers: [{ stdout: '["type","..\\\\..\\\\Windows\\\\win.ini"]\n' }],
    });

    const afterProvisioning = subject.boundaries();
    assert.equal(
      afterProvisioning.crossings.length,
      1,
      "the application reached for the host's filesystem and nothing recorded it",
    );
    assert.equal(afterProvisioning.crossings[0]?.boundary, "filesystemWrite");
    assert.match(afterProvisioning.crossings[0]?.subject ?? "", /win\.ini/);

    await subject.execute(id, request({ steps: [{ run: ["type", "..\\..\\Windows\\win.ini"] }] }));
    assert.equal(
      subject.boundaries().crossings.length,
      1,
      "a criterion's escape is not a safety event: the operator already has those privileges, and a " +
        "contract has to be able to assert that this world is contained and still pass",
    );
  });

  it("keeps the crossings across a reset, because a repair does not undo a violation", async () => {
    const escaping = (argv: readonly string[]): boolean =>
      argv.some((token) => token.split(/[\\/]/).includes(".."));
    const port = fakePort({ refuse: escaping });
    const { subject, id } = await ready(plan(), {
      port,
      answers: [{ stdout: '["type","..\\\\..\\\\Windows\\\\win.ini"]\n' }],
    });
    assert.equal(subject.boundaries().crossings.length, 1);

    await subject.reset(id);
    assert.equal(
      subject.boundaries().crossings.length,
      2,
      "the reset re-provisioned the world, so the application reached outside it a second time - and " +
        "a reset that erased the record would have destroyed the evidence of a violation by repairing it",
    );
  });

  it("reports both boundary policies unsupported, and its containment guard separately", async () => {
    const { subject } = await ready();
    const report = subject.boundaries();
    assert.equal(report.network, "unsupported");
    assert.equal(report.filesystemWrite, "unsupported");
    assert.deepEqual([...report.crossings], []);
  });

  it("distinguishes a boundary the operator never asked for from one it cannot enforce", async () => {
    const { subject } = await ready(
      plan({ boundary: { network: "allow", allow: [], filesystemWrite: "sandbox" } }),
    );
    assert.equal(
      subject.boundaries().network,
      "not-requested",
      "an open network is not an unenforced policy, and reporting them as one hides a real gap",
    );
  });
});

// ---- evidence ------------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the transcript only when the run issued commands", async () => {
    const { subject, id, io } = await ready(plan(), { answers: [{ stdout: '["whoami"]\n' }] });
    const observation = await subject.execute(id, request());
    const paths = observation.artifacts.map((artifact) => artifact.path).sort();
    assert.deepEqual(paths, ["artifacts/AC-001.execs.json", "artifacts/AC-001.observation.json"]);
    assert.ok(await io.exists(".veridian/runs/run-1/artifacts/AC-001.observation.json"));
    assert.equal(observation.artifacts.every((artifact) => artifact.criterionId === "AC-001"), true);
  });

  it("writes only the reading when the world's reading holds no commands", async () => {
    // The artifact set is derived from the *reading*, not from the commands the adapter asked for. The
    // port therefore has to be one whose reading reports no execs at all - which is not a realistic
    // world and is exactly the point: an adapter that wrote a transcript from its own intentions would
    // produce a file for a world that ran nothing, and no fixture in which every exec is also recorded
    // can tell those two apart. The application's own invocation is normally in the reading (it is
    // filed by `record()`), which is why the empty case needs a port that reports otherwise.
    const quiet = fakePort({ reading: reading([]) });
    const { subject, id } = await ready(plan(), { port: quiet });
    const observation = await subject.observe(id, request());
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json"],
      "an empty transcript is a file a reader has to open to learn nothing",
    );
  });

  it("puts the application's own provisioning command in the transcript beside the criteria's", async () => {
    const { subject, id } = await ready(plan(), { answers: [{ stdout: '["whoami"]\n' }] });
    const observation = await subject.execute(id, request());
    const transcript = (observation.data as OsObservationData).execs;
    assert.deepEqual(
      transcript.map((entry) => [entry.source, entry.program]),
      [
        ["application", "node"],
        ["application", "whoami"],
        ["criterion", "whoami"],
      ],
      "a reader asking whether the application's program ran at all has to be able to see it in the " +
        "transcript - and the middle entry is the world doing what the program *printed*, filed under " +
        "the caller that asked for it rather than under the program as though it were a criterion",
    );
  });

  it("warns about an evidence kind it did not write, without claiming it wrote it", async () => {
    // The `local-db` and `sim-k8s` adapters warned for every requested kind including the one they had
    // just written, so the demo printed "produces `json` and cannot produce `json`" thirty times - and
    // a reader who learned to skip those lines had learned to skip the one that is true.
    const { subject, id, logger } = await ready(plan(), { answers: [{ stdout: '["whoami"]\n' }] });
    await subject.execute(id, request({ evidence: ["json", "screenshot"] }));

    const warnings = logger.entries.filter(
      (entry) => entry.message === "environment.evidence" && entry.level === "warn",
    );
    assert.equal(warnings.length, 1, "`json` was written by this call and must not be warned about");
    assert.equal(warnings[0]?.fields["kind"], "screenshot", "the warning names the kind it cannot write");
  });

  it("answers a missing reading with an environment failure rather than an empty observation", async () => {
    const broken = fakePort();
    const subject = new SimOsEnvironment(plan(), {
      io: memoryIo({}),
      clock: fixedClock(),
      logger: silentLogger,
      processes: fakeProcesses(),
      stateDir: ".veridian",
      port: {
        ...broken.port,
        read: async () => {
          throw new Error("the sandbox root was removed underneath the world");
        },
      },
    });
    const { id } = await subject.create();
    await subject.start(id);
    const observation = await subject.observe(id, request());

    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(observation.error?.message ?? "", /removed underneath/);
  });
});

// ---- lifecycle -----------------------------------------------------------------------------------------

describe("the lifecycle is the same one every other world exposes", () => {
  it("prepares the sandbox before the application provisions it", async () => {
    // The order is the design: a provisioning program names commands that act on the sandbox, so the
    // sandbox has to exist first. Asserted together, because either half alone passes trivially.
    const { port, processes } = await ready();
    assert.equal(port.prepareCount(), 1);
    assert.equal(processes.calls.length, 1);
  });

  it("rebuilds the sandbox and re-provisions it on a restart reset", async () => {
    const { subject, id, port, processes } = await ready();
    await subject.reset(id);
    assert.equal(port.resetCount(), 1);
    assert.equal(
      processes.calls.length,
      2,
      "rebuilding without re-provisioning would leave a clean world reporting every account missing - " +
        "which reads like an application defect and is an artifact of the reset",
    );
  });

  it("refuses a snapshot-restore reset that has no snapshot, naming the alternative", async () => {
    const { subject, id } = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => subject.reset(id),
      (error: unknown) =>
        assertEnvironmentError(error, /take one with `snapshot\(\)` before the first criterion/),
    );
  });

  it("runs a declared custom reset command instead of rebuilding", async () => {
    const { subject, id, port, processes } = await ready(
      plan({ reset: { strategy: "custom", command: "node" } }),
    );
    await subject.reset(id);
    assert.equal(processes.calls.length, 2, "the custom command is a real second invocation");
    assert.equal(port.resetCount(), 0, "and the sandbox was not rebuilt behind the operator's back");
  });

  it("refuses a custom reset command that fails, rather than resetting by accident", async () => {
    const { subject } = harness(plan({ reset: { strategy: "custom", command: "node" } }), {
      answers: [{}, { code: 3, stderr: "cannot reset\n" }],
    });
    const { id } = await subject.create();
    await subject.start(id);
    await assert.rejects(
      () => subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /reset command `node` exited with code 3/),
    );
  });

  it("hands the port a snapshot directory under the state root, and returns the name it used", async () => {
    const { subject, id, port } = await ready();
    const name = await subject.snapshot(id);
    assert.match(name, /^sim-os-windows-svc-audit-\d+\.os$/);
    assert.deepEqual(
      [...port.snapshots],
      [`.veridian/snapshots/${name}`],
      "the port has to be handed somewhere this machine can write, and a bundle's paths depend on where",
    );
  });

  it("resolves a restore from the state root rather than from the caller's directory", async () => {
    const port = fakePort();
    const { subject } = harness(plan(), { port });
    const { id } = await subject.create();
    await subject.start(id);
    await subject.restore(id, "prior");
    assert.deepEqual([...port.restores], [".veridian/snapshots/prior"]);
  });

  it("refuses a snapshot before the world has been started", async () => {
    const { subject } = harness(plan());
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.snapshot(id),
      (error: unknown) => assertEnvironmentError(error, /nothing to snapshot/),
    );
  });

  it("refuses a restore from a snapshot name that is not there", async () => {
    const { subject, id } = await ready();
    await assert.rejects(
      () => subject.restore(id, "never-taken"),
      (error: unknown) => assertEnvironmentError(error, /no snapshot `never-taken` to restore/),
    );
  });

  it("records deploy as an explicit no-op rather than leaving it empty", async () => {
    const { subject, id, logger } = await ready();
    await subject.deploy(id);
    const entry = logger.entries.find((item) => item.message === "environment.deploy");
    assert.ok(entry, "an unrecorded no-op is indistinguishable from a step that was not done");
    assert.equal(
      entry.fields["command"],
      "node",
      "the note names which command did the provisioning, which is what a reader of environment.json " +
        "wants when a criterion about a missing account fails",
    );
  });

  it("closes the listeners on stop, and destroys back to an uncreated state", async () => {
    const { subject, id, port } = await ready();
    await subject.stop(id);
    assert.equal(port.stopCount(), 1);
    await subject.destroy(id);
    assert.equal(port.stopCount(), 2);
    await assert.rejects(
      () => subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /has not been created/),
    );
  });

  it("closes listeners once when the port prepared nothing, rather than twice for effect", async () => {
    // The world's own tree is deliberately left in place on stop, because a bundle quotes paths inside
    // it - so `stop()` is one act, and a test that counted two would be counting a call rather than a
    // consequence. This is the half that is checkable here; the tree is the port suite's subject.
    const { subject, id, port } = await ready();
    await subject.stop(id);
    assert.equal(port.stopCount(), 1);
    assert.equal(port.prepareCount(), 1, "stopping is not preparing");
  });
});
