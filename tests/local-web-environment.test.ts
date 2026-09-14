/**
 * Offline proof that the local-web environment is a *world* and not a hopeful wrapper.
 *
 * PLAN §6.1 asks for exactly this: `local-web` tested "against a fake ProcessRunner: start, health,
 * stop, and a reset that kills and respawns". Both seams are faked — no child process is spawned and
 * no browser is launched — so the suite runs in milliseconds everywhere, including on a machine that
 * has never run `npm run e2e:install`. That is deliberate: the adapter's *logic* must be provable
 * without the 150 MB dependency, or CI would only ever check the parts that do not matter.
 *
 * The fakes are written to be adversarial where it counts. `FakeHandle.waitForPattern` fails when the
 * process is silent, and `FakeHandle.stop` resolves the exit promise, because the two ways a boot can
 * go wrong — the app never speaks, and the app dies first — are the two the adapter has to tell apart
 * in its own message.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EnvironmentError } from "../core/failure.ts";
import type { Clock, Logger } from "../core/clarification/types.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import type { ProcessHandle, ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { memoryIo } from "../core/io.ts";
import type { MemoryIo } from "../core/io.ts";
import { BUNDLE_FILES, bundleLayout } from "../core/evidence/index.ts";
import { PLAYWRIGHT_MISSING } from "../adapters/local-web/browser-port.ts";
import type {
  BrowserLaunchOptions,
  BrowserPage,
  BrowserPort,
  BrowserRefusal,
  BrowserSession,
  RawTarget,
} from "../adapters/local-web/browser-port.ts";
import { LocalWebEnvironment } from "../adapters/local-web/local-web-environment.ts";
import type { FetchLike } from "../adapters/local-web/local-web-environment.ts";
import { fixedClock, recordingLogger } from "./helpers/clock.ts";

// ---- fakes --------------------------------------------------------------------------------------

interface FakeProgram {
  /** Text the process prints as soon as it is spawned. */
  readonly stdout?: string;
  readonly stderr?: string;
  /** Exit immediately with this code instead of staying up. */
  readonly exit?: number;
  /** Print nothing at all, so a declared readiness pattern can never be satisfied. */
  readonly silent?: boolean;
}

class FakeHandle implements ProcessHandle {
  readonly pid: number;
  readonly exited: Promise<ProcessResult>;
  readonly request: ProcessRequest;
  readonly program: FakeProgram;
  stopped = false;
  #settle!: (result: ProcessResult) => void;

  constructor(pid: number, request: ProcessRequest, program: FakeProgram) {
    this.pid = pid;
    this.request = request;
    this.program = program;
    this.exited = new Promise<ProcessResult>((resolve) => {
      this.#settle = resolve;
    });
    if (program.exit !== undefined) {
      // A one-shot command (`npm install`) resolves its own exit; nothing has to stop it.
      this.#settle({
        code: program.exit,
        signal: null,
        stdout: program.stdout ?? "",
        stderr: program.stderr ?? "",
        timedOut: false,
      });
    }
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
    // The same rule the real handle follows: an exit is a *result*, not a throw, and a process that
    // has gone away can never become ready.
    if (this.program.exit !== undefined) return false;
    return new RegExp(pattern).test(this.output());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.#settle({ code: null, signal: "SIGTERM", stdout: this.output(), stderr: this.error(), timedOut: false });
  }

  /** Settle as if the process had already exited, for the tests about a boot that dies. */
  crash(code: number): void {
    this.#settle({ code, signal: null, stdout: this.output(), stderr: this.error(), timedOut: false });
  }
}

interface FakeProcesses {
  readonly runner: ProcessRunner;
  readonly launched: FakeHandle[];
  readonly requests: ProcessRequest[];
}

/**
 * A program per command, or a *sequence* of programs for a command that is launched more than once.
 *
 * The sequence matters: the whole point of a reset is that the second launch is a different process
 * from the first, so a fake that answered every launch identically could not express "the first one
 * booted and the second one did not". The last entry repeats.
 */
type Program = FakeProgram | readonly FakeProgram[];

function fakeProcesses(programs: Readonly<Record<string, Program>> = {}): FakeProcesses {
  const launched: FakeHandle[] = [];
  const requests: ProcessRequest[] = [];
  const counts = new Map<string, number>();
  let nextPid = 1000;
  return {
    launched,
    requests,
    runner: {
      run(request: ProcessRequest): ProcessHandle {
        requests.push(request);
        const entry = programs[request.command];
        const index = counts.get(request.command) ?? 0;
        counts.set(request.command, index + 1);
        const program = Array.isArray(entry)
          ? (entry[Math.min(index, entry.length - 1)] ?? {})
          : (entry ?? {});
        const handle = new FakeHandle(nextPid++, request, program);
        launched.push(handle);
        return handle;
      },
    },
  };
}

class FakePage implements BrowserPage {
  readonly actions: string[] = [];
  closed = false;
  #url = "about:blank";
  #readings: Readonly<Record<string, RawTarget>>;
  readonly #refusals: BrowserRefusal[] = [];
  #broken: string | null = null;

  constructor(readings: Readonly<Record<string, RawTarget>> = {}) {
    this.#readings = readings;
  }

  /** Stand in for the request guard: what the real page would have refused, this page is told. */
  refuse(subject: string): void {
    this.#refusals.push({ subject, at: "2026-01-01T00:00:00.000Z" });
  }

  /**
   * Make the next action throw.
   *
   * A refused subresource is very often the reason the step after it fails - the button never wired
   * itself up because the script that would have wired it was blocked - so the two have to be
   * expressible together. Without this the fake could only produce a refusal on a run that went on to
   * succeed, which is the one case where collecting it does not matter.
   */
  break(next: string): void {
    this.#broken = next;
  }

  async goto(url: string): Promise<void> {
    if (this.#broken !== null) {
      const message = this.#broken;
      this.#broken = null;
      throw new Error(message);
    }
    this.actions.push(`goto ${url}`);
    this.#url = url;
  }
  async reload(): Promise<void> {
    this.actions.push("reload");
  }
  async click(selector: string): Promise<void> {
    this.actions.push(`click ${selector}`);
  }
  async fill(selector: string, value: string): Promise<void> {
    this.actions.push(`fill ${selector}=${value}`);
  }
  async select(selector: string, value: string): Promise<void> {
    this.actions.push(`select ${selector}=${value}`);
  }
  async press(selector: string, key: string): Promise<void> {
    this.actions.push(`press ${selector} ${key}`);
  }
  async waitFor(selector: string, state: string): Promise<void> {
    this.actions.push(`waitFor ${selector} ${state}`);
  }
  async read(selectors: readonly string[]): Promise<Readonly<Record<string, RawTarget>>> {
    this.actions.push(`read ${selectors.join(",")}`);
    const result: Record<string, RawTarget> = {};
    for (const selector of selectors) {
      const entry = this.#readings[selector];
      if (entry !== undefined) result[selector] = entry;
    }
    return result;
  }
  url(): string {
    return this.#url;
  }
  async title(): Promise<string | null> {
    return "Cart";
  }
  async content(): Promise<string> {
    return "<html><body>cart</body></html>";
  }
  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array([137, 80, 78, 71]);
  }
  consoleEntries() {
    return [{ level: "error", text: "boom", at: "2026-01-01T00:00:00.000Z" }];
  }
  networkEntries() {
    return [
      { method: "GET", url: "http://127.0.0.1:4173/", status: 200, at: "2026-01-01T00:00:00.000Z" },
      { method: "GET", url: "http://127.0.0.1:4173/missing.png", status: 404, at: "2026-01-01T00:00:00.000Z" },
      { method: "GET", url: "", status: null, at: "2026-01-01T00:00:00.000Z" },
    ];
  }
  refusals(): readonly BrowserRefusal[] {
    return [...this.#refusals];
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

interface FakeBrowser {
  readonly port: BrowserPort;
  readonly pages: FakePage[];
  readonly tracePaths: (string | null)[];
  readonly launches: BrowserLaunchOptions[];
  sessionsClosed: number;
}

function fakeBrowser(
  options: {
    readonly readings?: Readonly<Record<string, RawTarget>>;
    readonly failLaunch?: string;
    /** Runs on each page before it is handed to the adapter, so a test can prepare it. */
    readonly onPage?: (page: FakePage) => void;
  } = {},
): FakeBrowser {
  const pages: FakePage[] = [];
  const tracePaths: (string | null)[] = [];
  const launches: BrowserLaunchOptions[] = [];
  const state = { sessionsClosed: 0 };

  const session: BrowserSession = {
    kind: "fake",
    async newPage(tracePath: string | null): Promise<BrowserPage> {
      tracePaths.push(tracePath);
      const page = new FakePage(options.readings ?? {});
      pages.push(page);
      options.onPage?.(page);
      return page;
    },
    async close(): Promise<void> {
      state.sessionsClosed += 1;
    },
  };

  return {
    pages,
    tracePaths,
    launches,
    get sessionsClosed() {
      return state.sessionsClosed;
    },
    port: {
      kind: "fake",
      async launch(launch: BrowserLaunchOptions) {
        launches.push(launch);
        if (options.failLaunch !== undefined) throw new Error(options.failLaunch);
        return session;
      },
    },
  };
}

// ---- fixtures -----------------------------------------------------------------------------------

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "local-web",
  app: "examples/shopping-cart",
  appPath: "/virtual/examples/shopping-cart",
  env: { PORT: "4173" },
  dependencyInstall: null,
  start: { command: "node", args: ["serve.mjs"], readyPattern: "Listening on" },
  url: "http://127.0.0.1:4173",  databasePath: null,  health: { path: "/health", expectStatus: 200, timeoutMs: 5_000, intervalMs: 100, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "deny" },
  ...overrides,
});

const request = (overrides: Partial<ObservationRequest> = {}): ObservationRequest => ({
  criterionId: "AC-001",
  runId: "run-1",
  steps: [{ goto: "http://127.0.0.1:4173/" }],
  targets: ["#total"],
  evidence: [],
  ...overrides,
});

interface Harness {
  readonly subject: LocalWebEnvironment;
  readonly io: MemoryIo;
  readonly logger: Logger;
  readonly clock: Clock;
}

function harness(
  environment: EnvironmentPlan,
  options: {
    readonly processes?: ProcessRunner;
    readonly browser?: BrowserPort | null;
    readonly fetch?: FetchLike;
    readonly logger?: Logger;
  } = {},
): Harness {
  const io = memoryIo({ "examples/shopping-cart/serve.mjs": "// the application" });
  const logger = options.logger ?? recordingLogger();
  const clock = fixedClock();
  const subject = new LocalWebEnvironment(environment, {
    io,
    clock,
    logger,
    processes: options.processes ?? fakeProcesses().runner,
    browser: options.browser ?? null,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    stateDir: ".veridian",
  });
  return { subject, io, logger, clock };
}

const running = (program: FakeProgram = { stdout: "Listening on http://127.0.0.1:4173\n" }) => program;

const assertEnvironmentError = (error: unknown, pattern: RegExp): true => {
  assert.ok(error instanceof EnvironmentError, `expected an EnvironmentError, got ${String(error)}`);
  assert.match(error.message, pattern);
  return true;
};

// ---- lifecycle ----------------------------------------------------------------------------------

describe("the local-web environment brings an application up", () => {
  it("starts the application in its own directory and waits for its readiness signal", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), { processes: processes.runner });

    const { id } = await h.subject.create();
    await h.subject.start(id);

    assert.equal(id, "local-web:examples/shopping-cart");
    const launch = processes.requests[0];
    assert.equal(launch?.command, "node");
    assert.deepEqual(launch?.args, ["serve.mjs"]);
    // The application must not be started from Veridian's own working directory: a readiness pattern
    // printed into the wrong cwd is a bug with no symptom until the port never opens.
    assert.equal(launch?.cwd, "/virtual/examples/shopping-cart");
    assert.equal(launch?.env?.["PORT"], "4173");
  });

  it("refuses to call the application started when the readiness pattern never arrives", async () => {
    const processes = fakeProcesses({ node: { silent: true } });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();

    await assert.rejects(
      () => h.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not print \/Listening on\//),
    );
  });

  it("tells a boot that died apart from one that was merely slow", async () => {
    const processes = fakeProcesses({ node: { exit: 3, stderr: "EADDRINUSE: port 4173 is taken\n" } });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();

    await assert.rejects(
      () => h.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 3.*EADDRINUSE/s),
    );
  });

  it("installs dependencies first, and never starts the application if the install fails", async () => {
    const processes = fakeProcesses({ "npm install": { exit: 1, stderr: "npm ERR! network" } });
    const h = harness(plan({ dependencyInstall: "npm install" }), { processes: processes.runner });
    const { id } = await h.subject.create();

    await assert.rejects(
      () => h.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /dependency installation \(`npm install`\) exited with code 1/),
    );
    // Zero launches of the start command: a world that installs nothing must not be brought up and
    // then judged, because every criterion would fail for a reason that is not the application's.
    assert.equal(processes.launched.length, 1);
    assert.equal(processes.requests[0]?.command, "npm install");
  });

  it("offers no dependency install when the plan declares none", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    assert.equal(processes.requests.length, 1);
    assert.equal(processes.requests[0]?.command, "node");
  });

  it("refuses to drive an environment that was never created", async () => {
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner });
    await assert.rejects(
      () => h.subject.probe("local-web:examples/shopping-cart"),
      (error: unknown) => assertEnvironmentError(error, /has not been created/),
    );
  });

  it("refuses to drive an environment that was created under a different id", async () => {
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner });
    await h.subject.create();
    await assert.rejects(
      () => h.subject.probe("local-web:somewhere-else"),
      (error: unknown) => assertEnvironmentError(error, /addressed as/),
    );
  });
});

// ---- health -------------------------------------------------------------------------------------

describe("the local-web environment answers health probes", () => {
  it("reports the status code and the readiness signal as two separate facts", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), {
      processes: processes.runner,
      fetch: async () => ({ status: 200, dispose: () => undefined }),
    });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const probe = await h.subject.probe(id);
    assert.equal(probe.statusCode, 200);
    assert.equal(probe.message, null);
    assert.equal(probe.patternSeen, true);
  });

  it("reports a refused connection as a probe message rather than throwing", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), {
      processes: processes.runner,
      // A probe that throws makes the retry policy impossible to state: the manager would see an
      // exception instead of a status, and "three attempts" would become an exception three times.
      fetch: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4173");
      },
    });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const probe = await h.subject.probe(id);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /ECONNREFUSED/);
  });

  it("offers no readiness signal at all when the plan never asked for one", async () => {
    const processes = fakeProcesses({ node: running() });
    const environment = plan({ start: { command: "node", args: ["serve.mjs"], readyPattern: null } });
    const h = harness(environment, {
      processes: processes.runner,
      fetch: async () => ({ status: 200, dispose: () => undefined }),
    });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    // `null`, not `false`. "I cannot see stdout" and "I looked and it is not there" are different
    // claims, and the manager's readiness rule reads them differently on purpose.
    assert.equal((await h.subject.probe(id)).patternSeen, null);
  });
});

// ---- reset --------------------------------------------------------------------------------------

describe("the local-web environment resets a world", () => {
  it("kills the application and brings a new one up", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await h.subject.reset(id);

    assert.equal(processes.launched.length, 2, "a reset must start a *new* process");
    assert.equal(processes.launched[0]?.stopped, true, "the previous process must be gone");
    assert.notEqual(
      processes.launched[0]?.pid,
      processes.launched[1]?.pid,
      "restarting must produce a different process, or the reset is a no-op wearing a label",
    );
  });

  it("waits for the new process to be ready before returning", async () => {
    const processes = fakeProcesses({ node: [running(), { silent: true }] });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    // A reset that returned while the replacement was still booting would hand the next criterion a
    // world that is *nearly* ready — the flakiness M4 exists to forbid. The failure is loud instead.
    await assert.rejects(
      () => h.subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /did not print \/Listening on\//),
    );
    assert.equal(processes.launched[0]?.stopped, true, "the old process is stopped before the new one is judged");
  });

  it("runs a custom reset command instead of restarting", async () => {
    const processes = fakeProcesses({ "node": running(), "node reset-db.mjs": { exit: 0 } });
    const environment = plan({ reset: { strategy: "custom", command: "node reset-db.mjs" } });
    const h = harness(environment, { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await h.subject.reset(id);

    assert.equal(processes.requests.at(-1)?.command, "node reset-db.mjs");
    // The start command ran once and was not run again: `launched` also collects the reset command's
    // own handle, so counting handles would count the reset itself as a restart.
    assert.equal(
      processes.requests.filter((entry) => entry.command === "node").length,
      1,
      "a custom reset does not restart the application",
    );
  });

  it("reports a failed custom reset as an environment failure rather than continuing in a dirty world", async () => {
    const processes = fakeProcesses({ node: running(), "node reset-db.mjs": { exit: 1, stderr: "locked" } });
    const environment = plan({ reset: { strategy: "custom", command: "node reset-db.mjs" } });
    const h = harness(environment, { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await assert.rejects(
      () => h.subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /reset command `node reset-db.mjs` exited with code 1/),
    );
  });

  it("refuses a snapshot-restore reset instead of pretending to have restored anything", async () => {
    const environment = plan({ reset: { strategy: "snapshot-restore", command: null } });
    const h = harness(environment, { processes: fakeProcesses({ node: running() }).runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await assert.rejects(
      () => h.subject.reset(id),
      (error: unknown) => assertEnvironmentError(error, /snapshot-restore/),
    );
    await assert.rejects(
      () => h.subject.snapshot(id),
      (error: unknown) => assertEnvironmentError(error, /cannot restore a snapshot/),
    );
  });
});

// ---- observation --------------------------------------------------------------------------------

describe("the local-web environment observes a page", () => {
  const total = (value: string): RawTarget => ({
    found: true,
    count: 1,
    text: value,
    value: null,
    visible: true,
    error: null,
  });

  it("replays the criterion's steps in a fresh page and records the reading in the bundle", async () => {
    const browser = fakeBrowser({ readings: { "#total": total("$42.00") } });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(
      id,
      request({ steps: [{ goto: "http://x/" }, { click: "#add" }, { waitFor: { target: "#total", state: "visible" } }], evidence: ["screenshot", "console"] }),
    );

    assert.equal(observation.error, null);
    assert.equal(observation.kind, "web.page");
    const page = browser.pages[0];
    assert.ok(page !== undefined);
    assert.deepEqual(page.actions, [
      "goto http://x/",
      "click #add",
      "waitFor #total visible",
      "read #total",
    ]);
    assert.equal(page.closed, true, "every criterion's page must be disposed of, pass or fail");

    // The reading is always written down, whatever the criterion declared: a judgement cites `actual`
    // values that came from here, and an assertion about a page state that was never stored is a
    // claim with no evidence behind it. Queried through the io port rather than by reading the fake's
    // map, so the assertion is about what the adapter wrote and not about how the fake stores it.
    const runDir = bundleLayout(".veridian", "run-1").runDir;
    assert.equal(await h.io.exists(`${runDir}/${BUNDLE_FILES.artifacts}/AC-001.observation.json`), true);
    assert.equal(await h.io.exists(`${runDir}/${BUNDLE_FILES.screenshots}/AC-001.png`), true);
    assert.equal(await h.io.exists(`${runDir}/${BUNDLE_FILES.artifacts}/AC-001.console.json`), true);

    const kinds = observation.artifacts.map((artifact) => artifact.kind);
    assert.deepEqual(kinds, ["json", "screenshot", "console"]);
    for (const artifact of observation.artifacts) {
      assert.equal(artifact.criterionId, "AC-001");
      assert.ok(!artifact.path.startsWith("/"), `artifact paths stay relative to the run dir: ${artifact.path}`);
    }
  });

  it("records the target reading the criterion asked about, and nothing it did not", async () => {
    const browser = fakeBrowser({ readings: { "#total": total("$42.00") } });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request({ steps: [], targets: ["#total"] }));
    const data = observation.data as { targets: Record<string, RawTarget> };

    assert.deepEqual(Object.keys(data.targets), ["#total"]);
    assert.equal(data.targets["#total"]?.text, "$42.00");
  });

  it("says the adapter never looked, rather than claiming the element is absent", async () => {
    // The browser returns nothing for `#subtotal`, which is what a broken reading looks like.
    const browser = fakeBrowser({ readings: { "#total": total("$42.00") } });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request({ steps: [], targets: ["#total", "#subtotal"] }));
    const data = observation.data as { targets: Record<string, RawTarget> };

    assert.equal(data.targets["#subtotal"]?.found, false);
    assert.notEqual(
      data.targets["#subtotal"]?.error,
      null,
      "a missing reading must not be indistinguishable from a missing element",
    );
  });

  it("derives whether a response was a success from its status, where the status is authoritative", async () => {
    const browser = fakeBrowser();
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request({ steps: [] }));
    const data = observation.data as { network: readonly { status: number | null; ok: boolean }[] };

    assert.deepEqual(
      data.network.map((entry) => entry.ok),
      [true, false, false],
      "200 is ok, 404 is not, and no response at all is not",
    );
  });

  it("hands the browser an absolute path for the trace and records a relative one", async () => {
    const browser = fakeBrowser();
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request({ steps: [], evidence: ["trace"] }));

    // Two spellings for one file: Playwright needs where the OS finds it, the bundle records where a
    // reader finds it. The browser receives the *resolved* path — produced by the io port, which is
    // what makes it absolute on a real filesystem — while the artifact stays relative so the bundle
    // can be moved. Asserted against the port's own resolution, because "absolute" is the port's
    // promise to the child process and not a property of this string.
    const tracePath = browser.tracePaths[0];
    assert.equal(
      tracePath,
      h.io.resolve(`${bundleLayout(".veridian", "run-1").runDir}/${BUNDLE_FILES.trace}/AC-001.zip`),
    );
    assert.equal(
      observation.artifacts.find((artifact) => artifact.kind === "trace")?.path,
      `${BUNDLE_FILES.trace}/AC-001.zip`,
    );
  });

  it("passes no trace path to the browser when the criterion asked for no trace", async () => {
    const browser = fakeBrowser();
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await h.subject.execute(id, request({ steps: [], evidence: ["screenshot"] }));
    assert.equal(browser.tracePaths[0], null);
  });

  it("reports a browser that will not launch as an environment failure, not a test failure", async () => {
    const browser = fakeBrowser({ failLaunch: PLAYWRIGHT_MISSING });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request());

    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(observation.error?.message ?? "", /Playwright is not installed/);
  });

  it("fails the observation rather than judging a page when the environment has no browser", async () => {
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: null });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request());
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(observation.error?.message ?? "", /Playwright is not installed/);
  });

  it("names the browser policy when the environment was planned without a browser", async () => {
    const environment = plan({
      browser: { enabled: false, viewport: null, locale: null, timezoneId: null },
    });
    const h = harness(environment, { processes: fakeProcesses({ node: running() }).runner, browser: null });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    const observation = await h.subject.execute(id, request());
    assert.match(observation.error?.message ?? "", /browser\.enabled: false/);
  });

  it("contains a step the contract could never have produced instead of throwing at the loop", async () => {
    const browser = fakeBrowser({ readings: { "#total": total("$42.00") } });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    // Two actions in one record. `decodeStep` rejects it; the adapter turns that rejection into an
    // observation carrying the reason, so the criterion keeps its identity in the bundle.
    const observation = await h.subject.execute(id, request({ steps: [{ goto: "http://x/", click: "#add" }] }));

    assert.equal(observation.data, null);
    assert.notEqual(observation.error, null);
    assert.equal(browser.pages[0]?.closed, true);
  });

  it("observes without acting when asked to observe", async () => {
    const browser = fakeBrowser({ readings: { "#total": total("$42.00") } });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await h.subject.observe(id, request({ steps: [{ goto: "http://x/" }, { click: "#add" }] }));

    assert.deepEqual(browser.pages[0]?.actions, ["read #total"]);
  });
});

// ---- teardown -----------------------------------------------------------------------------------

describe("the local-web environment reports the boundary it actually held", () => {
  const total = (value: string): RawTarget => ({
    found: true,
    count: 1,
    text: value,
    value: null,
    visible: true,
    error: null,
  });

  const up = async (h: Harness): Promise<string> => {
    const { id } = await h.subject.create();
    await h.subject.start(id);
    return id;
  };

  it("hands the browser the plan's boundary and the application's own origin", async () => {
    const environment = plan({
      url: "http://127.0.0.1:4317",
      boundary: { network: "allow-list", allow: ["https://api.example.com"], filesystemWrite: "sandbox" },
    });
    const browser = fakeBrowser();
    const h = harness(environment, { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request());

    const launch = browser.launches[0];
    assert.ok(launch !== undefined);
    assert.deepEqual(launch.boundary, environment.boundary);
    // Derived from the plan's URL, not from the request's first step: a boundary is a property of the
    // world, and the world's front door is what the plan declared.
    assert.equal(launch.appOrigin, "http://127.0.0.1:4317");
  });

  it("says a boundary was not requested rather than calling it enforced", async () => {
    const environment = plan({ boundary: { network: "allow", allow: [], filesystemWrite: "deny" } });
    const browser = fakeBrowser();
    const h = harness(environment, { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request());

    // `allow` means no guard, so "enforced" would be a claim about a component that does not exist.
    assert.equal(h.subject.boundaries().network, "not-requested");
    assert.deepEqual(h.subject.boundaries().crossings, []);
  });

  it("reports the network boundary as enforced once a page has been built under it", async () => {
    const browser = fakeBrowser();
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);

    // Before any page: nothing has been held yet, and the adapter says so rather than guessing from
    // the plan. The plan is an intention; this is the measurement.
    assert.equal(h.subject.boundaries().network, "unsupported");

    await h.subject.execute(id, request());
    assert.equal(h.subject.boundaries().network, "enforced");
  });

  it("does not claim a boundary its page never came up under", async () => {
    const browser = fakeBrowser({ failLaunch: PLAYWRIGHT_MISSING });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request());

    // The page never existed, so no guard was ever attached. `enforced` here would be the F1 defect
    // wearing a new field: a policy read out of a document and reported as if it had been applied.
    assert.equal(h.subject.boundaries().network, "unsupported");
  });

  it("reports the filesystem boundary as unsupported, because this adapter cannot hold one", async () => {
    const environment = plan({ boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" } });
    const browser = fakeBrowser();
    const h = harness(environment, { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request());

    // The application runs as an ordinary child process with the operator's privileges, so `sandbox`
    // is a word in a file for as long as that is true. Saying `enforced` would be the exact
    // false-confidence this field exists to remove.
    assert.equal(h.subject.boundaries().filesystemWrite, "unsupported");
  });

  it("records a refused request against the criterion that made it", async () => {
    const browser = fakeBrowser({
      onPage: (created) => { created.refuse("GET https://tracker.example.net/p.gif"); },
    });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request({ criterionId: "AC-007" }));

    const crossings = h.subject.boundaries().crossings;
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0]?.boundary, "network");
    assert.equal(crossings[0]?.subject, "GET https://tracker.example.net/p.gif");
    assert.equal(crossings[0]?.criterionId, "AC-007");
  });

  it("records a refusal even when the observation then failed, because the refusal is usually why", async () => {
    const browser = fakeBrowser({
      onPage: (created) => {
        created.refuse("GET https://cdn.example.com/app.js");
        created.break("the page never finished loading");
      },
    });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    const observation = await h.subject.execute(id, request({ criterionId: "AC-009" }));

    assert.equal(observation.data, null);
    // The reading is taken in the `finally`. A blocked script is exactly the reason the step after it
    // throws, so collecting refusals only on the success path would drop them in the only case where
    // they explain anything.
    const crossings = h.subject.boundaries().crossings;
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0]?.criterionId, "AC-009");
  });

  it("accumulates crossings across criteria instead of overwriting them", async () => {
    const browser = fakeBrowser({
      onPage: (created) => { created.refuse("GET https://cdn.example.com/app.js"); },
    });
    const h = harness(plan(), { processes: fakeProcesses({ node: running() }).runner, browser: browser.port });
    const id = await up(h);
    await h.subject.execute(id, request({ criterionId: "AC-001" }));
    await h.subject.execute(id, request({ criterionId: "AC-002" }));

    assert.deepEqual(
      h.subject.boundaries().crossings.map((entry) => entry.criterionId),
      ["AC-001", "AC-002"],
    );
  });
});

describe("the local-web environment gives the world back", () => {
  it("stops the application and closes the browser without touching the application directory", async () => {
    const processes = fakeProcesses({ node: running() });
    const browser = fakeBrowser();
    const h = harness(plan(), { processes: processes.runner, browser: browser.port });
    const { id } = await h.subject.create();
    await h.subject.start(id);
    await h.subject.execute(id, request({ steps: [] }));

    await h.subject.destroy(id);

    assert.equal(processes.launched[0]?.stopped, true);
    assert.equal(browser.sessionsClosed, 1);
    // The application directory is the user's source tree. An adapter that removes it on the way out
    // is a bug that takes a working copy with it.
    assert.equal(await h.io.exists("examples/shopping-cart/serve.mjs"), true);
  });

  it("stops idempotently, because it runs on the failure path too", async () => {
    const processes = fakeProcesses({ node: running() });
    const h = harness(plan(), { processes: processes.runner });
    const { id } = await h.subject.create();
    await h.subject.start(id);

    await h.subject.stop(id);
    await h.subject.stop(id);

    assert.equal(processes.launched.length, 1);
  });
});
