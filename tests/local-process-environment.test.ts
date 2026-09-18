import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocalProcessEnvironment, PROCESS_ENV, PROCESS_ENV_NAMES } from "../adapters/local-process/local-process-environment.ts";
import type { Clock, Logger } from "../core/clarification/index.ts";
import { confineChild, confinementCapability, type ConfinementResult } from "../core/environment/confinement.ts";
import type { EnvironmentPlan } from "../core/environment/types.ts";
import { memoryIo } from "../core/io.ts";
import type { MemoryIo } from "../core/io.ts";
import type { ProcessHandle, ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { fixedClock, recordingLogger } from "./helpers/clock.ts";

/**
 * The tenth world's own suite.
 *
 * It exists for two reasons, and neither is coverage for its own sake.
 *
 * The first is that this adapter had no suite of its own - only `local-process-demo.test.ts` and the
 * demo itself - so every verdict it produces was held by one happy path through one contract. A
 * verdict path reachable only through a single example is a path whose failure modes are untested,
 * which is the shape this repository has already paid for once, at the database family.
 *
 * The second is that the property this suite is built around was **observed**, not reasoned about.
 * `run-20260916-114813-ded994` aborted with `ENVIRONMENT_FAILURE` - "the world could not be reset
 * after iteration 3" - and nothing in four subsequent clean runs reproduced it. The mechanism is an
 * ordering: `ProcessHandle.stop()` awaits `exited` on POSIX but returns as soon as `taskkill` closes
 * on Windows, so the *previous* child's exit can be delivered after the *next* one has been
 * published. `#spawn` guards its publication for exactly that reason, and the fake below is written
 * so that the guard is the difference between a running world and a wedged one.
 *
 * ## Why the fake's `stop()` does not settle `exited`
 *
 * The `local-web` suite's fake *does* settle it, because that adapter is judged by a different
 * question. Here settling it would erase the very ordering this suite exists to hold - a double that
 * resolves on `stop()` cannot express "the exit lands later", which is the real behaviour on the
 * platform the failure was seen on. So this fake's `stop()` marks the handle stopped and returns,
 * and the exit is delivered by the runner at a moment the test chooses.
 */

interface FakeProgram {
  readonly stdout?: string;
  readonly stderr?: string;
  /** When set, the handle reports the exit before it ever prints a readiness line. */
  readonly exit?: number;
  /** When true, `waitForPattern` never matches, which is a program that starts and says nothing. */
  readonly silent?: boolean;
}

/**
 * A child process this test owns.
 *
 * `stopped` and `exitDelivered` are separate on purpose, because separating them is what lets a
 * test say "this child was killed" and "its exit was reported" as two different facts - and the
 * defect this suite holds is one where the first is true and the second arrives too late.
 */
class FakeHandle implements ProcessHandle {
  readonly pid: number;
  readonly exited: Promise<ProcessResult>;
  readonly request: ProcessRequest;
  readonly program: FakeProgram;
  /**
   * What the fake runner did with the allowance on the request, exactly as the real one reports it.
   *
   * The real runner decides before the process exists and stamps both the handle and every result, so
   * a world can answer a boundary question at any point in its life. A fake that skipped this would
   * leave `handle.confinement` undefined and `boundaries()` would report `unsupported` for a world
   * that had just handed over a perfectly good allowance - the double has to reproduce the property
   * the reading is about, or the reading is untestable.
   */
  readonly confinement: ConfinementResult | null;
  stopped = false;
  exitDelivered = false;
  #settle!: (result: ProcessResult) => void;

  constructor(
    pid: number,
    request: ProcessRequest,
    program: FakeProgram,
    confinement: ConfinementResult | null,
  ) {
    this.pid = pid;
    this.request = request;
    this.program = program;
    this.confinement = confinement;
    this.exited = new Promise<ProcessResult>((resolve) => {
      this.#settle = resolve;
    });
  }

  output(): string {
    return this.program.stdout ?? "";
  }

  error(): string {
    return this.program.stderr ?? "";
  }

  async waitForPattern(pattern: string): Promise<boolean> {
    if (this.stopped) return false;
    if (this.program.silent === true) return false;
    if (this.program.exit !== undefined) return false;
    return new RegExp(pattern).test(this.output());
  }

  /**
   * Kill this child and resolve - deliberately **without** delivering its exit.
   *
   * This is the measured ordering on Windows, where `taskkill` closing is what `stop()` waits for
   * and the child's own `close` event arrives afterwards. A double that delivered the exit here
   * could not reproduce the failure this suite is about.
   */
  async stop(): Promise<void> {
    this.stopped = true;
  }

  /** Deliver this child's exit, at a moment the test chooses. Idempotent. */
  deliverExit(): void {
    if (this.exitDelivered) return;
    this.exitDelivered = true;
    this.#settle({
      code: null,
      signal: "SIGTERM",
      stdout: this.output(),
      stderr: this.error(),
      timedOut: false,
    });
  }

  /** Exit on its own, before any readiness line - a program that dies during boot. */
  crash(code: number): void {
    if (this.exitDelivered) return;
    this.exitDelivered = true;
    this.#settle({
      code,
      signal: null,
      stdout: this.output(),
      stderr: this.error(),
      timedOut: false,
    });
  }
}

interface FakeProcesses {
  readonly runner: ProcessRunner;
  readonly launched: FakeHandle[];
  readonly requests: ProcessRequest[];
}

type Program = FakeProgram | readonly FakeProgram[];
type Programs = Readonly<Record<string, Program>>;

/**
 * A process runner that never spawns anything.
 *
 * `deliverExitsOnRun` decides *when* a stopped child's exit lands, and the two settings are two
 * orderings of the same race rather than two conveniences. With it on, the exit arrives while the
 * replacement is being started - before `#spawn` has published the new handle. With it off, the
 * test delivers it afterwards, by hand, which is the order the real platform produces.
 */
function fakeProcesses(programs: Programs = {}, deliverExitsOnRun = true): FakeProcesses {
  let nextPid = 1000;
  const launched: FakeHandle[] = [];
  const requests: ProcessRequest[] = [];
  const counts = new Map<string, number>();

  const runner: ProcessRunner = {
    run(request: ProcessRequest): ProcessHandle {
      if (deliverExitsOnRun) {
        // Every child that has already been stopped reports its exit *now* - which is what happens
        // for real when `stop()` returned before the child's `close` event did.
        for (const previous of launched) {
          if (previous.stopped) previous.deliverExit();
        }
      }
      // The allowance is applied here because applying it is the *runner's* job - that is the whole
      // of the seam this double stands in for. `confineChild` is the real mechanism, so the answer
      // recorded on the handle is the one the product would have produced for this request.
      const confinement =
        request.confinement === undefined
          ? null
          : confineChild({
              command: request.command,
              args: request.args,
              readRoots: request.confinement.readRoots,
              writeRoots: request.confinement.writeRoots,
              ...(request.confinement.allowChildProcess === undefined
                ? {}
                : { allowChildProcess: request.confinement.allowChildProcess }),
            });
      // The vector that is really started, which is the confined one when there was an allowance.
      const command = confinement === null ? request.command : confinement.command;
      const index = counts.get(command) ?? 0;
      counts.set(command, index + 1);
      const entry = programFor(programs, command);
      const program = Array.isArray(entry) ? (entry[Math.min(index, entry.length - 1)] ?? {}) : entry;
      const handle = new FakeHandle((nextPid += 1), request, program, confinement);
      launched.push(handle);
      requests.push(request);
      return handle;
    },
  };

  return { runner, launched, requests };
}

/**
 * The program a launched command runs, looked up the way the runner spells the vector it starts.
 *
 * This is not a convenience: the adapter hands the runner the command the document declared, and the
 * runner replaces it with the **absolute path to the interpreter** when it applies the allowance. A
 * fixture keyed on the declared spelling alone finds no program for a confined child, reads an empty
 * stdout, and fails every `start()` here on the readiness wait - a double that cannot follow its own
 * product is a suite about a world nobody runs.
 *
 * So a command that is not a key verbatim is looked up by its basename without a trailing `.exe`,
 * lowercased - the same rule `core/environment/confinement.ts` uses to decide whether a command is a
 * Node interpreter at all. `programs.cmd` still resolves for `cmd`, so the one test that starts a
 * non-Node command needs no special case either.
 */
function programFor(programs: Programs, command: string): Program {
  const declared = programs[command];
  if (declared !== undefined) return declared;
  const base = (command.replace(/\\/g, "/").split("/").pop() ?? command).replace(/\.exe$/iu, "").toLowerCase();
  return programs[base] ?? {};
}

const READY = "cart-builder ready on channel alpha\n";

function plan(overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan {
  return {
    adapter: "local-process",
    app: "examples/local-process",
    appPath: "/virtual/examples/local-process",
    env: {},
    dependencyInstall: null,
    start: {
      command: "node",
      args: ["provision.mjs"],
      readyPattern: "cart-builder ready",
    },
    url: null,
    api: null,
    databasePath: null,
    cluster: null,
    posix: null,
    os: null,
    cloud: null,
    container: null,
    vscode: null,
    process: {
      host: "veridian-local-process",
      application: { command: "node", args: ["provision.mjs"] },
      root: "sandbox",
    },
    data: null,
    mobile: null,
    health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 50, readyPattern: null },
    reset: { strategy: "restart", command: null },
    browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
    boundary: { network: "deny", allow: [], filesystemWrite: "deny" },
    ...overrides,
  } as EnvironmentPlan;
}

interface Harness {
  readonly subject: LocalProcessEnvironment;
  readonly io: MemoryIo;
  readonly logger: ReturnType<typeof recordingLogger>;
  readonly clock: Clock;
  readonly processes: FakeProcesses;
  readonly logs: Pick<ReturnType<typeof recordingLogger>, "entries"> & { entries: readonly { readonly level: string; readonly message: string }[] };
}

function harness(
  environment: EnvironmentPlan,
  programs: Programs = { node: { stdout: READY } },
  deliverExitsOnRun = true,
): Harness {
  const io = memoryIo({ "examples/local-process/provision.mjs": "// the application" });
  const logger = recordingLogger();
  const clock: Clock = fixedClock();
  const processes = fakeProcesses(programs, deliverExitsOnRun);
  const subject = new LocalProcessEnvironment(environment, {
    io,
    clock,
    logger: logger as unknown as Logger,
    processes: processes.runner,
    stateDir: ".veridian",
  });
  return { subject, io, logger, clock, processes, logs: logger };
}

function assertEnvironmentError(error: unknown, pattern: RegExp): void {
  assert.ok(error instanceof Error, `expected an EnvironmentError, got ${String(error)}`);
  assert.match(error.message, pattern);
}

describe("local-process: the lifecycle it really performs", () => {
  it("creates the sandbox, starts the program it was given, and reports itself running", async () => {
    const { subject, processes } = harness(plan());

    const { id } = await subject.create();
    assert.equal(id, "local-process:examples/local-process");
    assert.equal(processes.launched.length, 0, "create must not start the program");

    await subject.start(id);
    assert.equal(processes.launched.length, 1, "start must start the program exactly once");

    const health = await subject.probe(id);
    assert.equal(health.ok, true, `expected a running world, got: ${health.message ?? ""}`);
    assert.equal(health.patternSeen, true, "the readiness line was on stdout, so it must be seen");
  });

  it("hands the program the three names the adapter declares, and none of them is the document's own spelling", async () => {
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    const env = processes.launched[0]?.request.env;
    assert.ok(env !== undefined, "the program must have been handed an environment");

    assert.deepEqual(Object.keys(env).sort(), [...PROCESS_ENV_NAMES].sort(), "the three declared names are the three handed over");
    assert.equal(env[PROCESS_ENV.host], "veridian-local-process", "the identity the readings name");
    assert.equal(env[PROCESS_ENV.app], "/virtual/examples/local-process", "the application directory");
    assert.match(String(env[PROCESS_ENV.root]), /sandbox$/u, "the sandbox as this machine can open it");
  });

  it("refuses a document with no process block, naming the field it needed", async () => {
    const { subject } = harness(plan({ process: null }));
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => {
        assertEnvironmentError(error, /this world declares no `process` block/u);
        return true;
      },
    );
  });

  it("refuses a process block with no root, because a world with no directory is not a world", async () => {
    const { subject } = harness(plan({ process: { host: "veridian-local-process", application: null, root: "" } }));
    await assert.rejects(
      () => subject.create(),
      (error: unknown) => {
        assertEnvironmentError(error, /`process\.root` is empty/u);
        return true;
      },
    );
  });

  it("refuses snapshot and restore by name rather than downgrading them to a restart", async () => {
    const { subject } = harness(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    const { id } = await subject.create();

    await assert.rejects(
      () => subject.snapshot(id),
      (error: unknown) => {
        assertEnvironmentError(error, /cannot restore a snapshot/u);
        return true;
      },
    );
    await assert.rejects(
      () => subject.restore(id, "snap-1"),
      (error: unknown) => {
        assertEnvironmentError(error, /cannot restore snapshot `snap-1`/u);
        return true;
      },
    );
  });

  it("starts no program when the contract declares none, and still reports itself healthy", async () => {
    const { subject, processes, logger } = harness(plan({ process: { host: "veridian-local-process", application: null, root: "sandbox" } }));

    const { id } = await subject.create();
    await subject.start(id);

    assert.equal(processes.launched.length, 0, "a world that declares no application starts none");
    assert.equal(processes.requests.length, 0, "and issues no command at all");
    assert.equal((await subject.probe(id)).ok, true, "having no daemon is not a failure");
    assert.ok(
      logger.entries.some((entry) => entry.message === "environment.start"),
      "the branch that announces and returns must be the branch that ran, not `MISSING_APPLICATION`",
    );
  });
});

describe("local-process: a previous child's exit is not the current child's state", () => {
  it("reports the world running after a reset even though the previous child's exit lands during the rebuild", async () => {
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    await subject.reset(id);

    assert.equal(processes.launched.length, 2, "reset replaces the program rather than reusing it");
    assert.equal(processes.launched[0]?.stopped, true, "the previous child was killed");
    assert.equal(processes.launched[0]?.exitDelivered, true, "and its exit really was delivered - otherwise this test proves nothing");

    const health = await subject.probe(id);
    assert.equal(
      health.ok,
      true,
      `a dead child's exit must not be read as the live child's state: ${health.message ?? ""}`,
    );
    assert.equal(health.patternSeen, true, "the replacement printed the readiness line");
  });

  it("reports the world running when the previous child's exit lands after the replacement is published", async () => {
    // The realistic ordering, and the sharper half of the guard: the exit arrives *after* `#spawn`
    // has published the new handle, which is the moment an unguarded publication writes into the
    // wrong slot.
    const { subject, processes } = harness(plan(), { node: { stdout: READY } }, false);
    const { id } = await subject.create();
    await subject.start(id);
    await subject.reset(id);

    const previous = processes.launched[0];
    assert.ok(previous !== undefined, "reset must have started a replacement");
    previous.deliverExit();
    // Awaiting the same promise the adapter registered on is what makes this deterministic: the
    // promise's callbacks run in registration order, so the adapter's has already run.
    await previous.exited;

    const health = await subject.probe(id);
    assert.equal(health.ok, true, `a late exit from a dead child wedged the world: ${health.message ?? ""}`);
  });

  it("does report the world stopped when the child it is actually holding exits", async () => {
    // The positive control for the two above: the guard must drop a *stale* exit without dropping
    // the current one, or "always running" would pass them just as well.
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    const current = processes.launched[0];
    assert.ok(current !== undefined, "the program was started");
    current.crash(3);
    await current.exited;

    const health = await subject.probe(id);
    assert.equal(health.ok, false, "a child that exited is not a running world");
    assert.match(String(health.message), /is not running/u);
  });

  it("confines the replacement as well as the first child", async () => {
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);
    await subject.reset(id);

    const second = processes.launched[1];
    assert.ok(second !== undefined, "reset started a replacement");
    // The adapter's half: every request carries an allowance, including the one a reset makes.
    assert.ok(
      second.request.confinement !== undefined,
      "the replacement is handed an allowance, so confining it is the runner's decision rather than the adapter remembering",
    );
    // The runner's half, read off the handle: the vector that is really started is the confined one.
    assert.equal(
      second.confinement?.command,
      process.execPath,
      "the replacement runs under the interpreter the flags belong to",
    );
    assert.equal(second.confinement?.args[0], "--permission", "and carries the flag that enforces the allowance");
  });
});

describe("local-process: the boundary report is derived from what the world did", () => {
  it("reports the write boundary unsupported before any child has been started", async () => {
    const { subject } = harness(plan());
    const { id } = await subject.create();

    // Nothing has been confined yet, and a world with no child must not claim a boundary over one.
    assert.equal(subject.boundaries().filesystemWrite, "unsupported");
    assert.deepEqual(subject.boundaries().crossings, [], "a refusal the runtime makes is not a crossing this world observed");
    assert.equal(id, "local-process:examples/local-process");
  });

  it("reports the write boundary enforced once a Node child really was confined", async () => {
    const capability = confinementCapability();
    assert.equal(
      capability.available,
      true,
      `this suite asserts enforcement, so it can only run where enforcement exists: ${capability.reason}`,
    );

    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);
    assert.equal(processes.launched[0]?.confinement?.args[0], "--permission", "the child really was confined");

    assert.equal(subject.boundaries().filesystemWrite, "enforced");
  });

  it("does not report enforcement for a command the confinement model cannot reach", async () => {
    const { subject, processes } = harness(
      plan({ process: { host: "veridian-local-process", application: { command: "cmd", args: ["/c", "build.bat"] }, root: "sandbox" } }),
      // `cmd` is not Node, so the runner refuses the allowance by name and `cmd` is what really starts.
      { cmd: { stdout: READY } },
    );
    const { id } = await subject.create();
    await subject.start(id);

    assert.equal(processes.launched[0]?.request.command, "cmd", "the request names the program the document declared");
    assert.equal(
      processes.launched[0]?.confinement?.applied,
      false,
      "and the runner states that it refused the allowance rather than silently confining something it cannot reach",
    );
    assert.equal(processes.launched[0]?.confinement?.command, "cmd", "so the vector that starts is the one declared");
    assert.notEqual(subject.boundaries().filesystemWrite, "enforced", "an ordinary process with the operator's privileges is not a confined one");
  });

  it("reports network as unenforceable when a boundary is asked for and not-requested when it is not", async () => {
    // `--allow-net` does not exist in the permission model, so a requested network boundary is a
    // boundary this world cannot hold - and saying `unsupported` for the same reason as the write
    // boundary would merge "I chose not to enforce this" with "I cannot".
    const denied = harness(plan({ boundary: { network: "deny", allow: [], filesystemWrite: "deny" } }));
    await denied.subject.create();
    assert.equal(denied.subject.boundaries().network, "unenforceable");
    assert.equal(denied.subject.boundaries().filesystemWrite, "unsupported");

    const allowed = harness(plan({ boundary: { network: "allow", allow: ["127.0.0.1"], filesystemWrite: "deny" } }));
    await allowed.subject.create();
    assert.equal(allowed.subject.boundaries().network, "not-requested");
  });
});
