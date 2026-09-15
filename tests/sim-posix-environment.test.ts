import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SimPosixEnvironment, POSIX_ENV } from "../adapters/sim-posix/sim-posix-environment.ts";
import type { PosixExecRecord, PosixObservationData } from "../core/environment/posix-observation.ts";
import { POSIX_OBSERVATION_KIND, isPosixObservationData } from "../core/environment/posix-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { fixedClock, recordingLogger, silentLogger } from "./helpers/clock.ts";
import type { PosixPort } from "../adapters/sim-posix/posix-port.ts";

/**
 * The simulated POSIX world, against a fake substitute.
 *
 * The port has its own suite, held against a real tree and real sockets, because the facts worth
 * holding there are facts about a filesystem. *This* suite is about the adapter, and it injects a port
 * for the reason the option exists: whether the world refuses to be created without a `posix`
 * declaration, whether a readiness pattern can be reported seen for a run that never completed, and
 * whether an application's escape is recorded differently from a criterion's are questions about this
 * file, not about a directory - and answering them against a real tree would make every one of them a
 * timing question instead.
 *
 * Three of the assertions here are the load-bearing ones, and each is written to fail for the right
 * reason:
 *
 * - **an acting call refuses a step it cannot perform.** `VALIDATOR_ERROR`, not an exception and not a
 *   silent skip, because a criterion judged in a system it never acted on is a verdict the reading
 *   cannot justify.
 * - **the asymmetry between the two callers.** An application's escape across the sandbox boundary
 *   becomes a crossing, which fails the run; a criterion's does not, because the operator's own
 *   document is allowed to probe the guard. Reversing either half breaks one assertion.
 * - **`probe()` cannot report a pattern from a run that did not complete.** The field it matches
 *   against is assigned after the refusals, so a timed-out provisioning program is a failed world
 *   rather than a partially-ready one.
 */

// ---- fixtures -----------------------------------------------------------------------------------------

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "sim-posix",
  app: "app",
  appPath: "/virtual/app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["provision.mjs"], readyPattern: null },
  url: null,
  api: null,
  databasePath: null,
  cluster: null,
  posix: { distribution: "veridian-simulated-linux", user: "app", root: "app/.sandbox" },
  os: null,
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
  steps: [{ run: ["cat", "/etc/os-release"] }],
  targets: ["/etc/os-release"],
  evidence: [],
  ...overrides,
});

/** The reading a fake port returns. Every field a real one sets, so `isPosixObservationData` holds. */
const reading = (execs: readonly PosixExecRecord[] = []): PosixObservationData => ({
  host: "/tmp/veridian-sim-posix",
  distribution: "veridian-simulated-linux",
  root: "/tmp/veridian-sim-posix",
  user: "app",
  simulated: ["kernel", "distribution", "package-manager", "package-index", "permissions", "egress"],
  execs,
  files: [],
  users: [],
  packages: [],
  services: [],
  ports: [],
});

interface FakePort {
  readonly port: PosixPort;
  /** Every argument vector the adapter asked this world to execute, in order, with its source. */
  readonly execs: readonly { readonly argv: readonly string[]; readonly source: string }[];
  readonly recorded: readonly PosixExecRecord[];
  /** Every destination `snapshot()` was handed, and every source `restoreFrom()` was handed. */
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
 * spelling every escaping argument vector out - and so the escape test and the containment test in the
 * port's suite are visibly the same rule seen from two layers.
 */
function fakePort(
  options: { readonly refuse?: (argv: readonly string[]) => boolean; readonly reading?: PosixObservationData } = {},
): FakePort {
  const execs: { argv: readonly string[]; source: string }[] = [];
  const recorded: PosixExecRecord[] = [];
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
      },
      async reset() {
        resets += 1;
      },
      async exec(exec) {
        execs.push({ argv: exec.argv, source: exec.source });
        const denied = refuse(exec.argv);
        return {
          source: exec.source,
          argv: exec.argv,
          program: exec.argv[0] ?? "",
          result: denied ? "refused" : "completed",
          exitCode: denied ? null : 0,
          stdout: denied ? "" : "",
          stderr: "",
          reason: denied ? "this command climbs out of the sandbox" : null,
          durationMs: 1,
        };
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
  readonly subject: SimPosixEnvironment;
  readonly port: FakePort;
  readonly io: ReturnType<typeof memoryIo>;
  readonly processes: ProcessRunner & { readonly calls: readonly ProcessRequest[] };
  readonly logger: ReturnType<typeof recordingLogger>;
}

function harness(
  environment: EnvironmentPlan,
  options: {
    readonly port?: FakePort;
    readonly answers?: readonly Partial<ProcessResult>[];
    readonly files?: Readonly<Record<string, string>>;
    readonly provisionTimeoutMs?: number;
    /** A delay before the fake process settles, so a real deadline can elapse in front of it. */
    readonly delayMs?: number;
  } = {},
): Harness {
  const port = options.port ?? fakePort();
  const io = memoryIo({
    "app/.sandbox/etc/os-release": "ID=veridian-simulated-linux\nNAME=Veridian Simulated Linux\n",
    ...options.files,
  });
  const processes = fakeProcesses(options.answers, options.delayMs ?? 0);
  const logger = recordingLogger();
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimPosixEnvironment(environment, {
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
  options: Parameters<typeof harness>[1] = {},
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

// ---- refusals before anything runs --------------------------------------------------------------------

describe("the sim-posix world refuses a document it cannot stand in for", () => {
  it("names the missing posix declaration rather than building an undescribed system", async () => {
    const { subject } = harness(plan({ posix: null }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /no `posix` declaration/),
    );
  });

  it("refuses a posix declaration that names no account to decide permissions as", async () => {
    const { subject } = harness(plan({ posix: { distribution: "linux", user: "", root: "app/.sandbox" } }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /no `posix` declaration/),
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
      () => subject.observe("sim-posix:somebody-else", request()),
      (error: unknown) => assertEnvironmentError(error, /addressed as/),
    );
  });
});

// ---- readiness ------------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by looking", () => {
  it("answers ok with no pattern declared, and never invents a status code", async () => {
    const { subject, id } = await ready();
    const probe = await subject.probe(id);
    assert.equal(probe.ok, true);
    assert.equal(probe.statusCode, null, "a system has no status to return, and 200 would be an HTTP claim");
    assert.equal(probe.message, null);
    assert.equal(probe.patternSeen, null, "no pattern was declared, so `null` - not `false`");
  });

  it("says the world was never built when there is no /etc/os-release", async () => {
    const built = harness(plan(), { files: {} });
    const io = memoryIo({});
    const subject = new SimPosixEnvironment(plan(), {
      io,
      clock: fixedClock(),
      logger: silentLogger,
      processes: built.processes,
      stateDir: ".veridian",
      port: built.port.port,
    });
    const { id } = await subject.create();
    await subject.start(id);
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /holds no \/etc\/os-release/);
  });

  it("names a different system's identity rather than answering about the declared one", async () => {
    const { subject, id } = await ready(plan(), { files: { "app/.sandbox/etc/os-release": "ID=debian\n" } });
    const probe = await subject.probe(id);
    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /does not name veridian-simulated-linux/);
  });

  it("reports the readiness pattern seen, as a boolean", async () => {
    const { subject, id } = await ready(plan({ health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 10, readyPattern: "provisioned" } }), {
      answers: [{ stdout: "provisioned 3 commands\n" }],
    });
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
    const { subject } = harness(plan(), { answers: [{ code: 2, stderr: "no such user\n" }] });
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 2: no such user/),
    );
  });

  it("refuses a provisioning program that never printed the declared pattern", async () => {
    const { subject } = harness(plan({ start: { command: "node", args: ["provision.mjs"], readyPattern: "ready:" } }), {
      answers: [{ stdout: "working\n" }],
    });
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /never printed \/ready:\//),
    );
  });
});

// ---- the application's own work -------------------------------------------------------------------------

describe("the application provisions the world through vectors the world really executes", () => {
  it("runs every JSON argument vector the provisioning program printed, as the application", async () => {
    const vectorized = {
      answers: [{ stdout: '["apt-get","install","-y","nginx"]\n["systemctl","start","nginx"]\n' }],
    };
    const { port } = await ready(plan(), vectorized);
    const application = port.execs.filter((entry) => entry.source === "application");
    assert.deepEqual(application.map((entry) => [...entry.argv]), [
      ["apt-get", "install", "-y", "nginx"],
      ["systemctl", "start", "nginx"],
    ]);
  });

  it("files the application's own command in the same record the criteria's commands go into", async () => {
    const { port } = await ready(plan(), { answers: [{ stdout: '["id","app"]\n' }] });
    const own = port.recorded.find((entry) => entry.program === "node");
    assert.ok(own, "the provisioning program's own invocation is missing from the record");
    assert.equal(own.result, "completed");
    assert.equal(own.exitCode, 0);
  });

  it("records a line it cannot read as an observation rather than throwing", async () => {
    // A program that narrates to stdout has produced a fact about itself. Throwing here would report
    // "the world could not start" for what is actually "the application printed something odd", and
    // the criterion that reads the transcript is where that becomes a verdict.
    const { port, logger } = await ready(plan(), { answers: [{ stdout: "starting up\n" }] });
    assert.equal(port.execs.filter((entry) => entry.source === "application").length, 0);
    assert.ok(
      logger.entries.some((entry) => entry.message === "environment.provision"),
      "an unreadable provisioning line has to leave something in the log",
    );
  });

  it("hands the application both spellings of the sandbox root and no borrowed variable names", async () => {
    const { processes } = await ready();
    const env = processes.calls[0]?.env ?? {};
    // Absolute, and this is the assertion that matters rather than a formatting preference. The
    // application is a *separate* process spawned with `cwd` set to its own directory, so a relative
    // `HOST` resolves against that directory while every `node:fs` call inside the port resolves the
    // same string against the io root - one string, two trees, and the world's reading holds a system
    // the application did not write. The declared `root` is relative (`app/.sandbox`) and the host
    // path is the io root's answer for it.
    assert.equal(
      env[POSIX_ENV.host],
      "/virtual/app/.sandbox",
      "the host path has to be one this machine can open from anywhere",
    );
    assert.equal(env[POSIX_ENV.root], "/", "the world's own spelling of the same place");
    assert.equal(env[POSIX_ENV.distribution], "veridian-simulated-linux");
    assert.equal(env[POSIX_ENV.user], "app");
    assert.equal(env["HOME"], undefined, "this world has no login environment to borrow from");
    assert.equal(env["PATH"], undefined);
  });
});

// ---- acting, and the asymmetry between the two callers ---------------------------------------------------

describe("a criterion acts through `run` steps, and only through them", () => {
  it("executes a run step as the criterion's own probe and returns the reading", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request());

    assert.equal(observation.kind, POSIX_OBSERVATION_KIND);
    assert.equal(observation.error, null);
    assert.ok(isPosixObservationData(observation.data));
    assert.deepEqual(
      port.execs.filter((entry) => entry.source === "criterion").map((entry) => [...entry.argv]),
      [["cat", "/etc/os-release"]],
    );
  });

  it("refuses an acting call whose step it cannot perform, and does not act at all", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request({ steps: [{ click: "#submit" }] }));

    assert.equal(observation.data, null, "a criterion judged in a system it never acted on has no reading");
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(observation.error?.message ?? "", /performs `run` steps, and step 1 of AC-001 is `click`/);
    assert.equal(port.execs.length, 0, "the refusal has to come before anything is executed");
  });

  it("does not refuse a non-run step it was only asked to observe", async () => {
    // `observe` is not asked to act, so a step it cannot perform is not a step it failed to perform -
    // the step belongs to whichever adapter owns that world, and this call is a reading.
    const { subject, id } = await ready();
    const observation = await subject.observe(id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.error, null);
    assert.ok(isPosixObservationData(observation.data));
  });

  it("takes an escape by the application as a safety crossing and one by a criterion as a reading", async () => {
    const escaping = (argv: readonly string[]): boolean => argv.some((token) => token.split("/").includes(".."));
    const port = fakePort({ refuse: escaping });
    const { subject, id } = await ready(plan(), {
      port,
      answers: [{ stdout: '["cat","/../etc/shadow"]\n' }],
    });

    const afterProvisioning = subject.boundaries();
    assert.equal(
      afterProvisioning.crossings.length,
      1,
      "the application reached for the host's filesystem and nothing recorded it",
    );
    assert.equal(afterProvisioning.crossings[0]?.boundary, "filesystemWrite");
    assert.match(afterProvisioning.crossings[0]?.subject ?? "", /etc\/shadow/);

    await subject.execute(id, request({ steps: [{ run: ["cat", "/../etc/shadow"] }] }));
    assert.equal(
      subject.boundaries().crossings.length,
      1,
      "a criterion's escape is not a safety event: the operator already has those privileges, and a " +
        "contract has to be able to assert that this world is contained and still pass",
    );
  });

  it("keeps the crossings across a reset, because a repair does not undo a violation", async () => {
    const escaping = (argv: readonly string[]): boolean => argv.some((token) => token.split("/").includes(".."));
    const port = fakePort({ refuse: escaping });
    const { subject, id } = await ready(plan(), {
      port,
      answers: [{ stdout: '["cat","/../etc/shadow"]\n' }],
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

// ---- evidence --------------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the transcript only when the run issued commands", async () => {
    const { subject, id, io } = await ready(plan(), { answers: [{ stdout: '["id","app"]\n' }] });
    const observation = await subject.execute(id, request());
    const paths = observation.artifacts.map((artifact) => artifact.path).sort();
    assert.deepEqual(paths, ["artifacts/AC-001.execs.json", "artifacts/AC-001.observation.json"]);
    assert.ok(await io.exists(".veridian/runs/run-1/artifacts/AC-001.observation.json"));
    assert.equal(observation.artifacts.every((artifact) => artifact.criterionId === "AC-001"), true);
  });

  it("warns about an evidence kind it did not write, without claiming it wrote it", async () => {
    // The `local-db` and `sim-k8s` adapters warned for every requested kind including the one they had
    // just written, so the demo printed "produces `json` and cannot produce `json`" thirty times - and
    // a reader who learned to skip those lines had learned to skip the one that is true.
    const { subject, id, logger } = await ready(plan(), { answers: [{ stdout: '["id","app"]\n' }] });
    await subject.execute(id, request({ evidence: ["json", "screenshot"] }));

    const warnings = logger.entries.filter(
      (entry) => entry.message === "environment.evidence" && entry.level === "warn",
    );
    assert.equal(warnings.length, 1, "`json` was written by this call and must not be warned about");
  });

  it("answers a missing reading with an environment failure rather than an empty observation", async () => {
    const broken = fakePort();
    const subject = new SimPosixEnvironment(plan(), {
      io: memoryIo({ "app/.sandbox/etc/os-release": "ID=veridian-simulated-linux\n" }),
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

// ---- lifecycle -------------------------------------------------------------------------------------------

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
      "rebuilding without re-provisioning would leave a clean world reporting every user missing - " +
        "which reads like an application defect and is an artifact of the reset",
    );
  });

  it("refuses a snapshot-restore reset that has no snapshot, naming the alternative", async () => {
    const { subject, id } = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /take one with `snapshot\(\)` before/),
    );
  });

  it("runs a declared custom reset command instead of rebuilding", async () => {
    const { subject, id, port, processes } = await ready(
      plan({ reset: { strategy: "custom", command: "node" } }),
    );
    await subject.reset(id);
    assert.equal(processes.calls.length, 2, "the custom command is a real second invocation");
    assert.equal(port.resetCount(), 0);
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
    assert.match(name, /^sim-posix-app-\d+\.posix$/);
    assert.deepEqual(
      [...port.snapshots],
      [`.veridian/snapshots/${name}`],
      "the port has to be handed somewhere this machine can write, and a bundle's paths depend on where",
    );
  });

  it("resolves a restore from the state root rather than from the caller's directory", async () => {
    const port = fakePort();
    const { subject } = harness(plan(), {
      port,
      files: { ".veridian/snapshots/prior/marker": "" },
    });
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
});
