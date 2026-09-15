import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SimVSCodeEnvironment, VSCODE_ENV, parseCommandLine } from "../adapters/sim-vscode/sim-vscode-environment.ts";
import type { VSCodeCallRecord, VSCodeObservationData } from "../core/environment/vscode-observation.ts";
import { VSCODE_OBSERVATION_KIND, isVSCodeObservationData } from "../core/environment/vscode-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { fixedClock, recordingLogger, silentLogger } from "./helpers/clock.ts";
import type { VSCodeEscape, VSCodePort } from "../adapters/sim-vscode/vscode-port.ts";

/**
 * The simulated extension-host world, against a fake substitute.
 *
 * The port has its own suite, held against a real tree and real child processes, because the facts
 * worth holding there are facts about a generated `vscode` module and a real host process. *This* suite
 * is about the adapter, and it injects a port for the reason the option exists: whether the world
 * refuses to be created without a `vscode` declaration, whether a readiness pattern can be reported
 * seen for a run that never completed, and whether an application's escape is recorded differently from
 * a criterion's are questions about this file, not about a process - and answering them against real
 * children would make every one of them a timing question instead.
 *
 * Four assertions here are load-bearing, and each is written to fail for the right reason:
 *
 * - **an acting call refuses a step it cannot perform.** `VALIDATOR_ERROR`, not an exception and not a
 *   silent skip, because a criterion judged in an extension host it never acted on is a verdict the
 *   reading cannot justify - and the refusal has to come before the world is touched.
 * - **the asymmetry between the two callers.** An application's escape across the sandbox boundary
 *   becomes a crossing, which fails the run; a criterion's does not, because the operator's own
 *   document is allowed to probe the guard. Reversing either half breaks one assertion.
 * - **`probe()` cannot report a pattern from a run that did not complete.** The field it matches
 *   against is assigned after both refusals, so a timed-out provisioning program is a failed world
 *   rather than a partially-ready one.
 * - **a malformed step is a contract defect, not an environment failure.** `decodeStep` throws a
 *   `DefinitionError` for a record naming zero or several actions, and reporting that as an
 *   `ENVIRONMENT_FAILURE` would name a cause this adapter never observed.
 */

// ---- fixtures -----------------------------------------------------------------------------------------

const SANDBOX = "app/.veridian/sandbox-vscode";
const HOST_ROOT = `/virtual/${SANDBOX}`;

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "sim-vscode",
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
  os: null,
  cloud: null,
  container: null,
  vscode: {
    host: "veridian-vscode-sim",
    apiVersion: "1.100.0",
    activationEvent: null,
    root: SANDBOX,
    settings: {},
  },
  process: null,
  health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 10, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
  ...overrides,
});

/**
 * The health block, as its own builder.
 *
 * `probe()` reads the readiness pattern from **`health`**, not from `start` - and a test that declared
 * it under `start` would be asserting on a world where no pattern was asked about at all. Spelling the
 * whole block out here is what keeps a one-field override from silently dropping the others.
 */
const health = (readyPattern: string | null = null): EnvironmentPlan["health"] => ({
  path: null,
  expectStatus: null,
  timeoutMs: 5_000,
  intervalMs: 10,
  readyPattern,
});

const request = (overrides: Partial<ObservationRequest> = {}): ObservationRequest => ({
  criterionId: "AC-001",
  runId: "run-1",
  steps: [{ run: ["activate", "cart-web"] }],
  targets: ["activate"],
  evidence: [],
  ...overrides,
});

/** The reading a fake port returns. Every field a real one sets, so `isVSCodeObservationData` holds. */
const reading = (calls: readonly VSCodeCallRecord[] = []): VSCodeObservationData => ({
  host: "veridian-vscode-sim",
  apiVersion: "1.100.0",
  sandbox: HOST_ROOT,
  extension: {
    name: "cart-web",
    publisher: "veridian",
    version: "1.0.0",
    displayName: "Cart",
    main: "./out/extension.js",
  },
  engine: { declared: "^1.100.0", apiVersion: "1.100.0", result: "admitted", reason: null },
  activation: { event: "onCommand:cart.add", activated: true, error: null, runs: 1 },
  simulated: ["extension-host", "module-resolution", "command-registry", "configuration"],
  contributions: [
    { point: "commands", id: "cart.add", title: "Add to cart" },
    { point: "activationEvents", id: "onCommand:cart.add", title: null },
  ],
  commands: [{ id: "cart.add", registered: true, title: "Add to cart", declared: true, disposed: false }],
  invocations: [{ command: "cart.add", client: "provisioner", args: [], result: "answered", reason: null }],
  settings: [{ key: "cart-web.limit", value: "10", source: "default" }],
  status: [{ id: "cart.status", text: "3 items", tooltip: null, command: null, visible: true, alignment: "left" }],
  output: [{ channel: "Cart", lines: ["installed"], shown: false }],
  messages: [{ level: "info", message: "cart-web activated" }],
  state: [{ scope: "global", key: "cart.items", value: "3" }],
  subscriptions: [{ kind: "command", id: "cart.add", disposed: false }],
  files: [{ path: "report.json", bytes: 128, readable: true }],
  refusals: [{ api: "vscode.env", client: "extension", reason: "this world does not implement vscode.env" }],
  calls,
});

interface FakePort {
  readonly port: VSCodePort;
  /** Every command line the adapter asked this world to perform, in order, with who asked. */
  readonly execs: readonly { readonly argv: readonly string[]; readonly client: string }[];
  /** Every record this world filed, in order. */
  readonly records: readonly VSCodeCallRecord[];
  prepareCount(): number;
  resetCount(): number;
  stopCount(): number;
}

/**
 * A substitute that answers from a table rather than from a tree of real children.
 *
 * `refuse` is a predicate rather than a list so a test can say "anything that climbs out" without
 * spelling every escaping argument vector out - and so the escape test here and the containment test in
 * the port's suite are visibly the same rule seen from two layers. A refused command is filed as an
 * escape, because that is what the real port's one escape predicate does and the adapter's watermark
 * depends on the two agreeing.
 */
function fakePort(
  options: {
    readonly refuse?: (argv: readonly string[]) => boolean;
    readonly reading?: VSCodeObservationData;
  } = {},
): FakePort {
  const execs: { argv: readonly string[]; client: string }[] = [];
  const records: VSCodeCallRecord[] = [];
  const escapes: VSCodeEscape[] = [];
  const refuse = options.refuse ?? ((): boolean => false);
  let prepares = 0;
  let resets = 0;
  let stops = 0;

  return {
    execs,
    records,
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
        execs.push({ argv: exec.argv, client: exec.client });
        const denied = refuse(exec.argv);
        if (denied) {
          escapes.push({ client: exec.client, spelled: exec.argv[exec.argv.length - 1] ?? "" });
        }
        const record: VSCodeCallRecord = {
          action: denied ? null : "activate",
          client: exec.client,
          command: exec.argv.join(" "),
          resource: exec.argv[1] ?? null,
          result: denied ? "refused" : "answered",
          status: denied ? 1 : 0,
          reason: denied ? "this names a place outside the sandbox" : null,
        };
        records.push(record);
        return record;
      },
      async read() {
        return options.reading ?? reading([...records]);
      },
      escapes() {
        return [...escapes];
      },
      async stop() {
        stops += 1;
      },
    },
  };
}

function fakeProcesses(
  answers: readonly Partial<ProcessResult>[] = [{}],
  /**
   * A delay before `exited` resolves, so a real deadline can elapse in front of it - one number for
   * every call, or one per call.
   *
   * Per-call matters for the reset deadline: a single number delays the *provisioning* run too, so a
   * test that meant "the reset command never finishes" would time out the run before it and pass while
   * asserting on the wrong refusal. The last entry is reused once the list runs out.
   */
  delayMs: number | readonly number[] = 0,
): ProcessRunner & { readonly calls: readonly ProcessRequest[] } {
  const calls: ProcessRequest[] = [];
  const delays = typeof delayMs === "number" ? [delayMs] : delayMs;
  let index = 0;
  return {
    calls,
    run(processRequest: ProcessRequest) {
      calls.push(processRequest);
      const answer = answers[Math.min(index, answers.length - 1)] ?? {};
      const delay = delays[Math.min(index, delays.length - 1)] ?? 0;
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
        delay === 0
          ? Promise.resolve(settled)
          : new Promise<ProcessResult>((resolve) => {
              setTimeout(() => {
                resolve(settled);
              }, delay);
            });
      return {
        pid: 1,
        exited,
        output: () => settled.stdout,
        error: () => settled.stderr,
        waitForPattern: async () => true,
        stop: async () => undefined,
      };
    },
  };
}

interface Harness {
  readonly subject: SimVSCodeEnvironment;
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
    /** A delay before the fake process settles, one per call, or one for all of them. */
    readonly delayMs?: number | readonly number[];
  } = {},
): Harness {
  const port = options.port ?? fakePort();
  const io = memoryIo({
    [`${SANDBOX}/host/run-extension.mjs`]: "// the world's own generated host\n",
    [`${SANDBOX}/workspace/report.json`]: "{}\n",
    ...options.files,
  });
  const processes = fakeProcesses(options.answers, options.delayMs ?? 0);
  const logger = recordingLogger();
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimVSCodeEnvironment(environment, {
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

describe("the sim-vscode world refuses a document it cannot stand in for", () => {
  it("names the missing vscode declaration rather than building an undescribed host", async () => {
    const { subject } = harness(plan({ vscode: null }));
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `vscode` declaration/),
    );
  });

  it("refuses a declaration that names no host identity", async () => {
    // The identity is what a reading is *about*. A world that answered as a version it chose would make
    // the engine floor a claim nothing could contradict - which is the defect the Cockpit paid for.
    const { subject } = harness(
      plan({
        vscode: { host: "", apiVersion: "1.100.0", activationEvent: null, root: SANDBOX, settings: {} },
      }),
    );
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `vscode` declaration/),
    );
  });

  it("refuses a declaration that names no API version to answer as", async () => {
    const { subject } = harness(
      plan({
        vscode: { host: "veridian-vscode-sim", apiVersion: "", activationEvent: null, root: SANDBOX, settings: {} },
      }),
    );
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `vscode` declaration/),
    );
  });

  it("refuses a declaration that names no sandbox root", async () => {
    // The root is where the world is destroyed and rebuilt. An empty one would make the world some
    // other directory's - and the declaration is the only thing that says which.
    const { subject } = harness(
      plan({
        vscode: { host: "veridian-vscode-sim", apiVersion: "1.100.0", activationEvent: null, root: "", settings: {} },
      }),
    );
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `vscode` declaration/),
    );
  });

  it("refuses to judge a host it did not let the application provision", async () => {
    const { subject } = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `start\.command`/),
    );
  });

  it("refuses to observe a world that was created but never started", async () => {
    // The provisioning program is what makes the sandbox *this* contract's world. A criterion judged
    // before it ran would be judging whatever a previous run left in the directory - which reads like
    // an extension defect and is an artifact of the harness.
    const { subject } = harness(plan());
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /has not been started/),
    );
  });

  it("refuses an id that belongs to a different world", async () => {
    const { subject } = await ready();
    await assert.rejects(
      () => subject.observe("sim-vscode:somebody-else", request()),
      (error: unknown) => assertEnvironmentError(error, /is a different world/),
    );
  });
});

// ---- readiness ----------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by looking", () => {
  it("answers ok with no pattern declared, and never invents a status code", async () => {
    const { subject, id } = await ready();
    const probe = await subject.probe(id);
    assert.equal(probe.ok, true);
    assert.equal(probe.statusCode, null, "a host has no status to return, and 200 would be an HTTP claim");
    assert.equal(probe.message, null);
    assert.equal(probe.patternSeen, null, "no pattern was declared, so `null` - not `false`");
  });

  it("says the world was never built when the sandbox holds no generated host", async () => {
    // Measured rather than assumed: the host runner is a file this world writes, so its absence is the
    // one observation that separates "the world was not built" from "the extension did not activate".
    // The io here is a fresh one holding nothing, and it is the *only* difference from the passing case.
    const subject = new SimVSCodeEnvironment(plan(), {
      io: memoryIo({}),
      clock: fixedClock(),
      logger: silentLogger,
      processes: fakeProcesses(),
      stateDir: ".veridian",
      port: fakePort().port,
    });
    const { id } = await subject.create();
    await subject.start(id);
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /holds no generated host/);
  });

  it("names the host's own identity rather than answering about the declared one", async () => {
    // A reading that reported its own version could not be contradicted by anything, so the mismatch is
    // what makes the declared apiVersion a fact rather than a restatement.
    const port = fakePort({ reading: { ...reading(), host: "somebody-elses-host" } });
    const { subject, id } = await ready(plan(), { port });
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /holds a different host's identity/);
    assert.match(probe.message ?? "", /somebody-elses-host/, "the message has to quote what it read");
  });

  it("reports the readiness pattern seen, as a boolean", async () => {
    const { subject, id } = await ready(plan({ health: health("provisioned") }), {
      answers: [{ stdout: "cart-web provisioned: 4 files, 3 commands\n" }],
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

  it("starts the world even when the pattern is absent, and reports the absence from probe()", async () => {
    // Unlike `sim-posix`, whose `start()` refuses a program that never printed the declared pattern,
    // this world lets the run begin: a host that started and printed nothing is a fact a criterion can
    // be built on, whereas the pattern is the *application's* claim about itself. The reading is where
    // that becomes a verdict, which is why `start()` succeeds and `probe()` is the one that answers.
    const { subject, id } = await ready(plan({ health: health("ready:") }), {
      answers: [{ stdout: "working\n" }],
    });
    const probe = await subject.probe(id);
    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /never printed \/ready:\//);
  });

  it("does not answer a pattern question about a program that never ran to completion", async () => {
    // The decisive one, and the reason `probe()` has a branch for it. A timed-out program can still have
    // printed the pattern - this one does, on its first line - so a world that reported "never printed"
    // would be naming a cause it never observed and sending the reader to inspect a readiness line that
    // was correct. The deadline is real: `runToCompletion` sets `timedOut` from its own timer, so the
    // fake process has to settle *after* it for the timeout path to be the one under test.
    const { subject, processes } = harness(plan({ health: health("ready") }), {
      answers: [{ stdout: "ready\n" }],
      provisionTimeoutMs: 1,
      delayMs: 40,
    });
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within/),
    );
    assert.equal(processes.calls.length, 1);

    const probe = await subject.probe(id);
    assert.equal(
      probe.ok,
      false,
      "a world whose provisioner never finished is not ready, whatever the application printed",
    );
    assert.equal(
      probe.patternSeen,
      null,
      "`null` and not `false`: nothing was read, so there is no answer about the pattern to give",
    );
    assert.match(
      probe.message ?? "",
      /has not run to completion/,
      "the message has to name the observation this world made - the run did not finish - rather than " +
        "claiming the program never printed a pattern it printed on its first line",
    );
  });

  it("refuses a provisioning program that exits non-zero, naming the code and its stderr", async () => {
    const { subject } = harness(plan(), { answers: [{ code: 2, stderr: "no such extension\n" }] });
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 2: no such extension/),
    );
  });
});

// ---- the application's own work -----------------------------------------------------------------------

describe("the application provisions the world through vectors the world really executes", () => {
  it("runs every JSON argument vector the provisioning program printed, as the application", async () => {
    const { port } = await ready(plan(), {
      answers: [{ stdout: '["install","/virtual/app"]\n["activate","cart-web"]\n' }],
    });
    const application = port.execs.filter((entry) => entry.client === "provisioner");
    assert.deepEqual(application.map((entry) => [...entry.argv]), [
      ["install", "/virtual/app"],
      ["activate", "cart-web"],
    ]);
  });

  it("files the application's own command in the same record the criteria's commands go into", async () => {
    const { port } = await ready(plan(), { answers: [{ stdout: '["activate","cart-web"]\n' }] });
    const own = port.records.find((entry) => entry.client === "provisioner");
    assert.ok(own, "the application's own command is missing from the transcript");
    assert.equal(own.result, "answered");
    assert.equal(own.command, "activate cart-web");
  });

  it("records a line it cannot read as an observation rather than throwing", async () => {
    // A program that narrates to stdout has produced a fact about itself. Throwing here would report
    // "the world could not start" for what is actually "the application printed something odd", and the
    // criterion that reads the transcript is where that becomes a verdict.
    const { port, logger } = await ready(plan(), { answers: [{ stdout: "starting up\n" }] });
    assert.equal(port.execs.filter((entry) => entry.client === "provisioner").length, 0);
    assert.ok(
      logger.entries.some((entry) => entry.message === "environment.provision.line"),
      "an unreadable provisioning line has to leave something in the log",
    );
  });

  it("records a command the world refused as a warning, and still lets the run proceed", async () => {
    const port = fakePort({ refuse: () => true });
    const { logger } = await ready(plan(), { port, answers: [{ stdout: '["install","/virtual/app"]\n' }] });
    const warning = logger.entries.find((entry) => entry.message === "environment.provision.refused");
    assert.ok(warning, "a refused provisioning command is a fact about this world, and a silent one is invisible");
    assert.equal(warning.level, "warn");
  });

  it("hands the application both spellings of each place, and no borrowed variable names", async () => {
    const { processes } = await ready(plan({ env: { CART_PORT: "8080" } }));
    const env = processes.calls[0]?.env ?? {};
    // Absolute, and this is the assertion that matters rather than a formatting preference. The
    // application is a *separate* process spawned with `cwd` set to its own directory, so a relative
    // variable resolves against that directory while every `node:fs` call inside the port resolves the
    // same string against the io root - one string, two trees, and the world's reading then holds a host
    // the application never wrote.
    assert.equal(
      env[VSCODE_ENV.sandbox],
      HOST_ROOT,
      "the host path has to be one this machine can open from anywhere",
    );
    assert.equal(
      env[VSCODE_ENV.workspace],
      `${HOST_ROOT}/workspace`,
      "and the workspace is a different directory inside it - the only one `vscode.file` reads",
    );
    assert.equal(env[VSCODE_ENV.host], "veridian-vscode-sim");
    assert.equal(env[VSCODE_ENV.apiVersion], "1.100.0");
    assert.equal(env["CART_PORT"], "8080", "the operator's own environment is not replaced");
    assert.equal(env["HOME"], undefined, "this world has no login environment to borrow from");
    assert.equal(env["PATH"], undefined);
  });
});

// ---- acting, and the asymmetry between the two callers -------------------------------------------------

describe("a criterion acts through `run` steps, and only through them", () => {
  it("executes a run step as the criterion's own probe and returns the reading", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request());

    assert.equal(observation.kind, VSCODE_OBSERVATION_KIND);
    assert.equal(observation.error, null);
    assert.ok(isVSCodeObservationData(observation.data));
    assert.deepEqual(
      port.execs.filter((entry) => entry.client === "criterion").map((entry) => [...entry.argv]),
      [["activate", "cart-web"]],
    );
  });

  it("refuses an acting call whose step it cannot perform, and does not act at all", async () => {
    const { subject, id, port } = await ready();
    const observation = await subject.execute(id, request({ steps: [{ click: "#submit" }] }));

    assert.equal(observation.data, null, "a criterion judged in a host it never acted on has no reading");
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.ok(
      (observation.error?.message ?? "").includes(
        "the sim-vscode adapter performs `run` steps, and step 1 of AC-001 is `click`",
      ),
      `the refusal has to name the step kind and the criterion: ${String(observation.error?.message)}`,
    );
    assert.equal(port.execs.length, 0, "the refusal has to come before anything is executed");
  });

  it("does not refuse a non-run step it was only asked to observe", async () => {
    // `observe` is not asked to act, so a step it cannot perform is not a step it failed to perform - the
    // step belongs to whichever adapter owns that world, and this call is a reading.
    const { subject, id } = await ready();
    const observation = await subject.observe(id, request({ steps: [{ click: "#submit" }] }));
    assert.equal(observation.error, null);
    assert.ok(isVSCodeObservationData(observation.data));
  });

  it("reports a malformed step as a contract defect, not as an environment failure", async () => {
    // `decodeStep` throws a `DefinitionError` when a record names zero or several actions. That throw is
    // a defect in the criterion, and wrapping it in `ENVIRONMENT_FAILURE` would name a cause this
    // adapter never observed - which is the shape of error message this repository refuses.
    const { subject, id } = await ready();
    const observation = await subject.observe(id, request({ steps: [{ run: ["activate"], click: "#submit" }] }));

    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(observation.error?.message ?? "", /exactly one action/);
  });

  it("warns when the world refused a command the criterion issued, and keeps the refusal in the reading", async () => {
    const port = fakePort({ refuse: () => true });
    const { subject, id, logger } = await ready(plan(), { port });
    await subject.execute(id, request());

    const warning = logger.entries.find((entry) => entry.message === "environment.run");
    assert.ok(warning, "a contract that runs a command this world does not answer has to leave a trace");
    assert.equal(warning.level, "warn");
  });

  it("takes an escape by the application as a safety crossing and one by a criterion as a reading", async () => {
    const escaping = (argv: readonly string[]): boolean =>
      argv.some((token) => token.split(/[\\/]/).includes(".."));
    const port = fakePort({ refuse: escaping });
    const { subject, id } = await ready(plan(), {
      port,
      answers: [{ stdout: '["install","../../secrets"]\n' }],
    });

    const afterProvisioning = subject.boundaries();
    assert.equal(
      afterProvisioning.crossings.length,
      1,
      "the application reached outside the sandbox and nothing recorded it",
    );
    assert.equal(afterProvisioning.crossings[0]?.boundary, "filesystemWrite");
    assert.match(afterProvisioning.crossings[0]?.subject ?? "", /\.\.\/\.\.\/secrets/);

    const exercised = await subject.execute(id, request({ steps: [{ run: ["install", "../../secrets"] }] }));
    assert.equal(exercised.error, null, "a criterion's escape is still an observation");
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
      answers: [{ stdout: '["install","../../secrets"]\n' }],
    });
    assert.equal(subject.boundaries().crossings.length, 1);

    await subject.reset(id);
    assert.equal(
      subject.boundaries().crossings.length,
      2,
      "the reset re-provisioned the world, so the application reached outside it a second time - and a " +
        "reset that erased the record would have destroyed the evidence of a violation by repairing it",
    );
  });

  it("reports both boundary policies unsupported, because a child process holds the operator's rights", async () => {
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

// ---- evidence -----------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the transcript only when the run issued commands", async () => {
    const { subject, id, io } = await ready(plan(), { answers: [{ stdout: '["activate","cart-web"]\n' }] });
    const observation = await subject.execute(id, request());
    const paths = observation.artifacts.map((artifact) => artifact.path).sort();
    assert.deepEqual(paths, ["artifacts/AC-001.calls.json", "artifacts/AC-001.observation.json"]);
    assert.ok(await io.exists(".veridian/runs/run-1/artifacts/AC-001.observation.json"));
    assert.equal(observation.artifacts.every((artifact) => artifact.criterionId === "AC-001"), true);
  });

  it("does not write a transcript for a world where nothing was executed", async () => {
    const port = fakePort();
    const { subject, id } = await ready(plan(), { port, answers: [{ stdout: "no commands\n" }] });
    const observation = await subject.observe(id, request());
    assert.deepEqual(
      observation.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json"],
      "an empty transcript is a file a reader would have to open to learn it is empty",
    );
  });

  it("warns about an evidence kind it did not write, without claiming it wrote it", async () => {
    // The `local-db` and `sim-k8s` adapters warned for every requested kind including the one they had
    // just written, so the demo printed "produces `json` and cannot produce `json`" thirty times - and a
    // reader who learned to skip those lines had learned to skip the one that is true.
    const { subject, id, logger } = await ready(plan(), { answers: [{ stdout: '["activate","cart-web"]\n' }] });
    await subject.execute(id, request({ evidence: ["json", "screenshot"] }));

    const warnings = logger.entries.filter(
      (entry) => entry.message === "environment.evidence" && entry.level === "warn",
    );
    assert.equal(warnings.length, 1, "`json` was written by this call and must not be warned about");
  });

  it("answers a missing reading with an environment failure rather than an empty observation", async () => {
    const broken = fakePort();
    const subject = new SimVSCodeEnvironment(plan(), {
      io: memoryIo({ [`${SANDBOX}/host/run-extension.mjs`]: "// host\n" }),
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

// ---- lifecycle ----------------------------------------------------------------------------------------

describe("the lifecycle is the same one every other world exposes", () => {
  it("prepares the sandbox before the application provisions it", async () => {
    // The order is the design: the provisioning program names commands that act on the sandbox, so the
    // sandbox has to exist first. Asserted together, because either half alone passes trivially.
    const { port, processes } = await ready();
    assert.equal(port.prepareCount(), 1);
    assert.equal(processes.calls.length, 1);
  });

  it("records deploy as an explicit no-op naming the command it did not run", async () => {
    const { subject, id, processes, logger } = await ready();
    await subject.deploy(id);
    assert.ok(
      logger.entries.some((entry) => entry.message === "environment.deploy"),
      "an unrecorded no-op is indistinguishable from a step that was not done",
    );
    assert.equal(processes.calls.length, 1, "deploy must not start a second provisioning run");
  });

  it("rebuilds the sandbox and re-provisions it on a restart reset", async () => {
    const { subject, id, port, processes } = await ready();
    await subject.reset(id);
    assert.equal(port.resetCount(), 1);
    assert.equal(
      processes.calls.length,
      2,
      "rebuilding without re-provisioning would leave a clean world reporting every command missing - " +
        "which reads like an extension defect and is an artifact of the reset",
    );
  });

  it("runs a declared custom reset command instead of rebuilding", async () => {
    const { subject, id, port, processes } = await ready(
      plan({ reset: { strategy: "custom", command: "node" } }),
    );
    await subject.reset(id);
    assert.equal(processes.calls.length, 2, "the custom command is a real second invocation");
    assert.equal(port.resetCount(), 0);
    assert.equal(processes.calls[1]?.env?.[VSCODE_ENV.host], "veridian-vscode-sim", "the reset command reads the world it is resetting");
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

  it("refuses a custom reset command that never finishes, rather than resetting by accident", async () => {
    // The delay is per call on purpose: a single delay would time out the *provisioning* run, and this
    // test would pass while asserting on the wrong refusal - which is the failure mode the per-call list
    // exists to remove. Here the provisioner settles immediately and the reset command is the one that
    // never finishes.
    const { subject } = harness(plan({ reset: { strategy: "custom", command: "node" } }), {
      answers: [{}, {}],
      provisionTimeoutMs: 1,
      delayMs: [0, 40],
    });
    const { id } = await subject.create();
    await subject.start(id);
    await assert.rejects(
      () => subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /reset command `node` did not finish within/),
    );
  });

  it("refuses to photograph itself, and says what it can honestly offer instead", async () => {
    // An extension world holds live host processes. Copying its sandbox would restore a world that is
    // not the one running - so the refusal names the alternative rather than downgrading to it.
    const { subject, id } = await ready();
    await assert.rejects(
      () => subject.snapshot(id),
      (error: unknown) => assertEnvironmentError(error, /will not photograph itself/),
    );
  });

  it("refuses a restore, naming the snapshot it was asked for and the adapter it cannot come from", async () => {
    const { subject, id } = await ready();
    await assert.rejects(
      () => subject.restore(id, "prior"),
      (error: unknown) => assertEnvironmentError(error, /no snapshot `prior` for this adapter to put back/),
    );
  });

  it("refuses a snapshot-restore reset rather than silently restarting", async () => {
    const { subject, id } = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /snapshot-restore` plan never arrives here/),
    );
  });

  it("closes the host on stop, and destroys back to an uncreated state", async () => {
    const { subject, id, port, io } = await ready();
    await subject.stop(id);
    assert.equal(port.stopCount(), 1);
    assert.ok(
      await io.exists(`${SANDBOX}/host/run-extension.mjs`),
      "the sandbox is deliberately left in place: every path a bundle quotes lives under it",
    );
    await subject.destroy(id);
    assert.equal(port.stopCount(), 2);
    await assert.rejects(
      () => subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /never created/),
    );
  });
});

// ---- the provisioning program's own grammar -----------------------------------------------------------

describe("a provisioning line is a JSON argument vector, or it is narration", () => {
  it("reads a JSON array of non-blank strings as a command line", () => {
    assert.deepEqual(parseCommandLine('["install","/virtual/app"]'), ["install", "/virtual/app"]);
  });

  it("refuses narration, an empty vector, and a token that is not a string", () => {
    // Every one of these is a line a real program prints. Treating any of them as a command line would
    // make the world execute an argument vector the application never wrote.
    assert.equal(parseCommandLine("starting up"), null);
    assert.equal(parseCommandLine("[]"), null);
    assert.equal(parseCommandLine('["install",3]'), null);
    assert.equal(parseCommandLine('["install",""]'), null);
    assert.equal(parseCommandLine('["install","  "]'), null);
    assert.equal(parseCommandLine('"install"'), null);
  });

  it("does not treat a flag's value as an operand, because the vector is the operands", () => {
    // The `sim-posix` substitute paid for this: it took "the words that do not start with `-`" as its
    // operands, so `adduser --home /var/lib/cart-web cart` created an account named `/var/lib/cart-web`
    // and exited 0. Here the vector is joined whole and split by the world's own register, so a flag and
    // its value arrive intact and in order.
    assert.deepEqual(parseCommandLine('["install","--force","/virtual/app"]'), [
      "install",
      "--force",
      "/virtual/app",
    ]);
  });
});
