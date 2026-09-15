import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COST_MODEL, httpCloud } from "../adapters/sim-cloud/cloud-port.ts";
import type {
  CloudCallOutcome,
  CloudIdentity,
  CloudPort,
  CloudRequest,
  CloudSnapshot,
} from "../adapters/sim-cloud/cloud-port.ts";

// Derived from the port's own signatures rather than imported under a second spelling. The port
// declares the record and the source types locally and does not re-export them, and a test that
// restated either shape would be free to drift from the one the reading is actually built from.
type CloudCallRecord = ReturnType<CloudPort["calls"]>[number];
type CloudCallSource = Parameters<CloudPort["call"]>[1];
import { CLOUD_ENV, SimCloudEnvironment } from "../adapters/sim-cloud/sim-cloud-environment.ts";
import { isCloudObservationData } from "../core/environment/cloud-observation.ts";
import type {
  CloudDecisionReading,
  CloudMeterReading,
  CloudQueueReading,
} from "../core/environment/cloud-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import type { Logger } from "../core/clarification/types.ts";
import { fixedClock } from "./helpers/clock.ts";

/**
 * The simulated provider-account world, against a substitute held in memory.
 *
 * The port has its own suite, held against real sockets, because the facts worth holding there are
 * facts about HTTP. *This* suite is about the adapter: whether it refuses to judge an account it did
 * not let the application provision, whether the four declaration facts reach a separate process,
 * whether a readiness pattern can be reported from a run that never completed, whether a criterion's
 * request is refused when it names a host this world does not serve, and whether the crossing that
 * refusal records survives the reset that repairs the world.
 *
 * Five assertions here are load-bearing, and each is written to fail for the right reason:
 *
 * - **the four declaration facts, and no borrowed names.** An account world hands its provisioner an
 *   address it cannot know (the OS picks the port) and a region, account and principal it must not
 *   guess. It must *not* hand over `AWS_*`, `AZURE_*` or `GOOGLE_*`, because a program that found
 *   those would reach for an SDK, fail against a service that does not exist, and have the failure
 *   blamed on the application.
 * - **no filesystem variable at all.** This is the only world whose plan carries no path, and a
 *   `VERIDIAN_CLOUD_ROOT` would be the first step toward a criterion that reads this machine while
 *   claiming to read the account.
 * - **a non-`call` step in an acting call is refused**, as `VALIDATOR_ERROR` rather than an exception
 *   or a silent skip, because a criterion judged against an account it never put a request to is a
 *   verdict the reading cannot justify.
 * - **a target naming a foreign host is a crossing as well as a refusal.** The application holds this
 *   world's address and nothing else, so the request is one it could never have made.
 * - **`probe()` cannot report a partly-ready world.** A program that printed the pattern and then hung
 *   is a failed world; the pattern it printed is still reported, because it was really seen.
 *
 * The fake process runner puts one request to the account every time the *provisioner* runs, because
 * that is what a provisioner does - and a double that ran a program without a call would make every
 * start in this file fail on the "asked nothing" check instead of on the property under test.
 */

// ---- fixtures -------------------------------------------------------------------------------------

const ACCOUNT = {
  provider: "simulated",
  region: "eu-west-1",
  account: "acct-cart",
  principal: "cart-provisioner",
} as const;

/** The one request the provisioner makes, on every run. A real route, so the real port serves it. */
const PROVISION_REQUEST: CloudRequest = {
  method: "POST",
  path: "/v1/queues",
  body: '{"name":"cart-jobs"}',
};

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "sim-cloud",
  app: "app",
  appPath: "/virtual/app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["provision.mjs"], readyPattern: null },
  url: null,
  databasePath: null,
  cluster: null,
  posix: null,
  os: null,
  cloud: { ...ACCOUNT },
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
  steps: [{ call: { method: "GET", path: "/v1/version", body: null } }],
  targets: ["provider.describe"],
  evidence: [],
  ...overrides,
});

interface RecordedEntry {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A logger that keeps the *fields*, because several refusals are only visible there. */
function capableLogger(): { readonly entries: RecordedEntry[] } & Logger {
  const entries: RecordedEntry[] = [];
  const push =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      entries.push({ level, message, fields: fields ?? {} });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn") };
}

const EMPTY_SNAPSHOT: CloudSnapshot = {
  buckets: [],
  objects: [],
  queues: [],
  secrets: [],
  principals: [],
};

const EMPTY_METERS: CloudMeterReading = { requests: 0, objects: 0, bytes: 0, costUnits: 0 };

interface FakePort {
  readonly port: CloudPort;
  /** Every request put to this account, in order, with its source. */
  readonly asked: readonly { readonly request: CloudRequest; readonly source: CloudCallSource }[];
  readonly loaded: readonly string[];
  readonly bindings: readonly string[];
  listenCount(): number;
  closeCount(): number;
  clearCount(): number;
  dumpCount(): number;
}

interface FakePortOptions {
  readonly answer?: (request: CloudRequest) => Partial<CloudCallOutcome>;
  readonly snapshot?: CloudSnapshot | (() => CloudSnapshot);
  readonly decisions?: readonly CloudDecisionReading[];
}

/**
 * A substitute that answers from a table rather than from a socket.
 *
 * `answer` is a function rather than a map so a test can say "everything this world serves is
 * answered" without spelling every route out, and so the assertions can distinguish a request the
 * adapter *made* from one this world answered.
 */
function fakePort(options: FakePortOptions = {}): FakePort {
  const asked: { request: CloudRequest; source: CloudCallSource }[] = [];
  const records: CloudCallRecord[] = [];
  const loaded: string[] = [];
  const bindings: string[] = [];
  const decisions = options.decisions ?? [];
  let listens = 0;
  let closes = 0;
  let clears = 0;
  let dumps = 0;

  const read = (): CloudSnapshot => {
    const held = options.snapshot;
    if (typeof held === "function") return held();
    return held ?? EMPTY_SNAPSHOT;
  };

  return {
    asked,
    loaded,
    bindings,
    listenCount: () => listens,
    closeCount: () => closes,
    clearCount: () => clears,
    dumpCount: () => dumps,
    port: {
      async listen(address) {
        listens += 1;
        const url = `http://${address.host}:${String(4000 + listens)}`;
        bindings.push(url);
        return url;
      },
      async close() {
        closes += 1;
      },
      call(req, source) {
        asked.push({ request: req, source });
        const answer = options.answer?.(req) ?? {};
        const record: CloudCallRecord = {
          source,
          action: answer.action ?? "provider.describe",
          method: req.method,
          path: req.path,
          principal: req.principal ?? ACCOUNT.principal,
          resource: answer.resource ?? null,
          result: answer.result ?? "ok",
          status: answer.status ?? 200,
          reason: answer.reason ?? null,
          durationMs: 0,
        };
        // Filed here, exactly as the real port files it. A double that returned an outcome without
        // adding it to the list the reading is built from would make `calls()` disagree with the port
        // it stands in for - and it would have made "a criterion's request is in the reading"
        // untestable, which is the reason this line is here rather than a detail of the fixture.
        records.push(record);
        return { ...record, body: record.result === "ok" ? "{}" : "" };
      },
      calls: () => records,
      decisions: () => decisions,
      snapshot: read,
      meters: (): CloudMeterReading => ({ ...EMPTY_METERS, requests: records.length }),
      clear() {
        clears += 1;
        records.length = 0;
      },
      dump() {
        dumps += 1;
        return `{"account":${JSON.stringify(ACCOUNT.account)},"n":${String(dumps)}}`;
      },
      load(state) {
        loaded.push(state);
      },
      identity: (): CloudIdentity => ({ ...ACCOUNT }),
    },
  };
}

function fakeProcesses(
  answers: readonly Partial<ProcessResult>[] = [{}],
  /** A delay before `exited` resolves, so a real deadline can elapse in front of it. */
  delayMs = 0,
  /** What the provisioner does while it runs. Called before the run settles, because it does. */
  onRun?: () => void,
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
      // A program that exits zero has made its requests by the time it exits, so the calls land before
      // the deadline can win - which is what a real provisioner does, and what makes the "asked
      // nothing" check a check rather than a race.
      if (settled.code === 0) onRun?.();
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
  readonly subject: SimCloudEnvironment;
  /** The double. Always present, whatever port the adapter was handed, so assertions can read it. */
  readonly port: FakePort;
  readonly io: ReturnType<typeof memoryIo>;
  readonly processes: ProcessRunner & { readonly calls: readonly ProcessRequest[] };
  readonly logger: ReturnType<typeof capableLogger>;
}

interface HarnessOptions {
  readonly cloud?: CloudPort;
  readonly answers?: readonly Partial<ProcessResult>[];
  readonly files?: Readonly<Record<string, string>>;
  readonly deployTimeoutMs?: number;
  readonly delayMs?: number;
  /** `false` for a provisioner that exits zero having asked the account nothing. */
  readonly provision?: boolean;
}

function harness(environment: EnvironmentPlan, options: HarnessOptions = {}): Harness {
  const port = fakePort();
  const cloud = options.cloud ?? port.port;
  const io = memoryIo({
    // A snapshot from an earlier run, so the restore assertions address a file that exists rather
    // than one this test invented.
    ".veridian/snapshots/prior/account.json": '{"account":"acct-cart","n":0}',
    ...options.files,
  });
  const processes = fakeProcesses(
    options.answers,
    options.delayMs ?? 0,
    options.provision === false
      ? undefined
      : () => void cloud.call(PROVISION_REQUEST, "application"),
  );
  const logger = capableLogger();
  return {
    port,
    io,
    processes,
    logger,
    subject: new SimCloudEnvironment(environment, {
      io,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger,
      processes,
      stateDir: ".veridian",
      cloud,
      deployTimeoutMs: options.deployTimeoutMs,
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

describe("the sim-cloud world refuses a document it cannot stand in for", () => {
  it("names the missing cloud declaration rather than judging an account nobody described", async () => {
    const built = harness(plan({ cloud: null }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `cloud` declaration/),
    );
    assert.equal(built.processes.calls.length, 0, "the refusal comes before anything runs");
  });

  it("refuses a declaration with a blank field, naming the field rather than defaulting it", async () => {
    const built = harness(plan({ cloud: { ...ACCOUNT, principal: "" } }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /no `cloud` declaration/),
    );
  });

  it("refuses to judge an account it did not let the application provision", async () => {
    const built = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(
      () => built.subject.create(),
      (error: unknown) => assertEnvironmentError(error, /declares no `start\.command`/),
    );
  });

  it("refuses to observe a world that was created but never started", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    assert.equal(built.processes.calls.length, 0, "create() runs nothing, so nothing should have run");
    await assert.rejects(
      () => built.subject.observe(id, request()),
      (error: unknown) => assertEnvironmentError(error, /call start\(\) before observing/),
    );
  });

  it("refuses an id that belongs to a different environment", async () => {
    const built = await ready();
    await assert.rejects(
      () => built.subject.stop("sim-cloud:somebody-else"),
      (error: unknown) => assertEnvironmentError(error, /addressed as `sim-cloud:somebody-else`/),
    );
  });

  it("keys the world on the account, and records all four facts it was built from", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    assert.equal(
      id,
      "sim-cloud:acct-cart",
      "two runs against one account under two principals are two looks at one world",
    );
    const entry = built.logger.entries.find((item) => item.message === "environment.create");
    assert.equal(entry?.fields["provider"], ACCOUNT.provider);
    assert.equal(entry?.fields["region"], ACCOUNT.region);
    assert.equal(entry?.fields["principal"], ACCOUNT.principal);
  });
});

// ---- the four declaration facts, and no borrowed names -----------------------------------------------

describe("the account's four facts reach a separate process, and nothing borrowed does", () => {
  it("hands the provisioner the address, provider, region, account and principal", async () => {
    const built = await ready();
    const injected = built.processes.calls[0]?.env ?? {};
    assert.equal(injected[CLOUD_ENV.api], built.port.bindings[0]);
    assert.equal(injected[CLOUD_ENV.provider], ACCOUNT.provider);
    assert.equal(injected[CLOUD_ENV.region], ACCOUNT.region);
    assert.equal(injected[CLOUD_ENV.account], ACCOUNT.account);
    assert.equal(injected[CLOUD_ENV.principal], ACCOUNT.principal);
  });

  it("passes the operator's own variables through beside the five it derives", async () => {
    const built = await ready(plan({ env: { CART_REGION: "eu" } }));
    const injected = built.processes.calls[0]?.env ?? {};
    assert.equal(injected["CART_REGION"], "eu");
    assert.equal(injected[CLOUD_ENV.region], ACCOUNT.region);
  });

  it("names no real provider's variable, so the application cannot reach for an SDK", async () => {
    const built = await ready();
    const names = Object.keys(built.processes.calls[0]?.env ?? {});
    for (const borrowed of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
      "AWS_ENDPOINT_URL",
      "AZURE_CLIENT_ID",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "CLOUDSDK_CONFIG",
    ]) {
      assert.ok(
        !names.includes(borrowed),
        `${borrowed} would invite an SDK this world cannot serve: ${names.join(", ")}`,
      );
    }
  });

  it("declares no filesystem variable at all, because an account has no directory", async () => {
    const built = await ready();
    const names = Object.keys(built.processes.calls[0]?.env ?? {});
    assert.ok(
      names.includes(CLOUD_ENV.account),
      "the injected environment is non-empty, so the loop below is a check and not a formality",
    );
    for (const name of names) {
      assert.ok(
        !/ROOT|_DIR|_PATH|_HOME$/.test(name),
        `${name} names a place, and this world's plan carries none: ${names.join(", ")}`,
      );
    }
  });
});

// ---- readiness ---------------------------------------------------------------------------------------

describe("readiness is a verdict this world reached by asking", () => {
  it("answers not-ok naming its own missing address before anything has been bound", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    const probe = await built.subject.probe(id);
    assert.equal(probe.ok, false);
    assert.equal(probe.message, "the substitute provider account is not listening");
    assert.equal(probe.patternSeen, null, "nothing has run, so no stdout was observed");
  });

  it("answers not-ok naming the transport when the declared address answers nothing", async () => {
    const built = await ready();
    const probe = await built.subject.probe(built.id);
    assert.equal(probe.ok, false, "the double binds no socket, so a real request really fails");
    assert.equal(typeof probe.message, "string");
    assert.equal(probe.patternSeen, true, "no pattern was declared, and stdout was really observed");
  });

  it("reports the readiness pattern seen, as a boolean, when the program printed it", async () => {
    const built = await ready(
      plan({
        start: { command: "node", args: ["p.mjs"], readyPattern: "provisioned: [0-9]+ buckets" },
      }),
      { answers: [{ stdout: "cart-web provisioned: 3 buckets\n" }] },
    );
    assert.equal((await built.subject.probe(built.id)).patternSeen, true);
  });

  it("refuses the run whose program never printed the pattern, and reports it not seen", async () => {
    const built = harness(
      plan({
        start: { command: "node", args: ["p.mjs"], readyPattern: "provisioned: [0-9]+ buckets" },
      }),
      { answers: [{ stdout: "starting up\n" }] },
    );
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) =>
        assertEnvironmentError(error, /never printed \/provisioned: \[0-9\]\+ buckets\//),
    );
    assert.equal((await built.subject.probe(id)).patternSeen, false);
  });

  it("does not report a partly ready world when the program printed the pattern then hung", async () => {
    const built = harness(
      plan({
        start: { command: "node", args: ["p.mjs"], readyPattern: "provisioned: [0-9]+ buckets" },
      }),
      { answers: [{ stdout: "provisioned: 3 buckets\n" }], delayMs: 60, deployTimeoutMs: 1 },
    );
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /did not finish within 1ms/),
    );
    // The output is kept before the deadline is judged, deliberately: the partial output of a program
    // that never finished is the evidence explaining why, and declining to look at it would throw away
    // the only thing the world was given. So the pattern it really printed is really reported - and the
    // world is still failed, which is the distinction this test exists to hold.
    assert.equal((await built.subject.probe(id)).patternSeen, true);
    assert.equal((await built.subject.probe(id)).ok, false);
  });
});

describe("readiness over a real socket, because a substitute that answers nothing is not readiness", () => {
  it("answers ok when the account really declares which surfaces it substitutes", async () => {
    const cloud = httpCloud({ ...ACCOUNT });
    const built = harness(plan(), { cloud });
    const { id } = await built.subject.create();
    try {
      await built.subject.start(id);
      const probe = await built.subject.probe(id);
      assert.equal(probe.message, null, "a healthy account reports no explanation");
      assert.equal(probe.ok, true);
      assert.equal(probe.statusCode, 200);
      const observation = await built.subject.observe(id, request());
      assert.ok(isCloudObservationData(observation.data));
      assert.equal(observation.data.account, ACCOUNT.account);
      assert.equal(observation.data.provider, ACCOUNT.provider);
      assert.ok(
        observation.data.simulated.length > 0,
        "a simulated world declares what it substitutes, and the reading carries it",
      );
      assert.match(
        observation.data.api,
        /^http:\/\/127\.0\.0\.1:[0-9]+$/,
        "the reading names the address this world really bound",
      );
    } finally {
      await built.subject.stop(id);
    }
  });
});

// ---- the provisioner -----------------------------------------------------------------------------------

describe("the application provisions the world, and the world refuses a run that did not", () => {
  it("binds the account before the provisioner runs, so the address can be handed over", async () => {
    const built = await ready();
    assert.equal(built.port.listenCount(), 1);
    assert.equal(built.port.bindings[0], "http://127.0.0.1:4001");
    assert.equal(built.processes.calls[0]?.env?.[CLOUD_ENV.api], built.port.bindings[0]);
  });

  it("files the application's own request in the same record the criteria's go into", async () => {
    const built = await ready();
    assert.deepEqual(
      built.port.asked.map((entry) => entry.source),
      ["application"],
    );
    const observation = await built.subject.observe(built.id, request());
    assert.ok(isCloudObservationData(observation.data));
    assert.deepEqual(
      observation.data.calls.map((record) => record.source),
      ["application"],
      "the world holds what the application put in it, and the reading says whose it was",
    );
  });

  it("refuses a provisioner that exited non-zero, naming the code and its stderr", async () => {
    const built = harness(plan(), { answers: [{ code: 3, stderr: "bucket name is taken\n" }] });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 3: bucket name is taken/),
    );
  });

  it("refuses a provisioner that exited successfully having asked the account nothing", async () => {
    const built = harness(plan(), { provision: false });
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.start(id),
      (error: unknown) =>
        assertEnvironmentError(error, /exited successfully and put no request to the account/),
    );
    assert.equal(built.port.asked.length, 0, "the refusal is about a real absence, not a guess");
  });

  it("records deploy as an explicit no-op naming the command, rather than leaving it empty", async () => {
    const built = await ready();
    await built.subject.deploy(built.id);
    const entry = built.logger.entries.find((item) => item.message === "environment.deploy");
    assert.match(String(entry?.fields["note"]), /made its calls during start\(\)/);
    assert.equal(entry?.fields["command"], "node");
    assert.equal(built.port.listenCount(), 1, "deploying nothing must not bind a second account");
  });
});

// ---- a criterion acts through `call` steps, and only through them ---------------------------------------

describe("a criterion acts through `call` steps, and only through them", () => {
  it("puts the criterion's request to the account and files it in the reading", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({
        steps: [
          {
            call: {
              method: "PUT",
              path: "/v1/storage/buckets/cart-assets",
              body: '{"region":"eu"}',
            },
          },
        ],
      }),
    );
    assert.equal(observation.error, null);
    assert.deepEqual(
      built.port.asked.map((entry) => entry.source),
      ["application", "criterion"],
    );
    const last = built.port.asked.at(-1);
    assert.equal(last?.request.path, "/v1/storage/buckets/cart-assets");
    assert.equal(last?.request.body, '{"region":"eu"}');
    assert.ok(isCloudObservationData(observation.data));
    const record = observation.data.calls.at(-1);
    assert.equal(record?.source, "criterion");
    assert.equal(record?.path, "/v1/storage/buckets/cart-assets");
    assert.equal(record?.method, "PUT");
  });

  it("refuses an acting call whose step it cannot perform, and does not act at all", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({
        steps: [{ call: { method: "GET", path: "/v1/version", body: null } }, { run: ["whoami"] }],
      }),
    );
    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(String(observation.error?.message), /step 2 of AC-001 is `run`/);
    assert.deepEqual(
      built.port.asked.map((entry) => entry.source),
      ["application"],
      "the criterion was refused before a single request was put",
    );
  });

  it("does not refuse a non-call step it was only asked to observe", async () => {
    const built = await ready();
    const observation = await built.subject.observe(built.id, request({ steps: [{ run: ["whoami"] }] }));
    assert.equal(observation.error, null);
    assert.equal(built.port.asked.length, 1, "an observation puts no request of its own");
  });

  it("puts several `call` steps in order, so a contract can build a state before it asks", async () => {
    const built = await ready();
    await built.subject.execute(
      built.id,
      request({
        steps: [
          { call: { method: "PUT", path: "/v1/storage/buckets/cart-assets", body: null } },
          {
            call: {
              method: "PUT",
              path: "/v1/storage/buckets/cart-assets/objects/a.png",
              body: "x",
            },
          },
        ],
      }),
    );
    assert.deepEqual(
      built.port.asked.filter((entry) => entry.source === "criterion").map((entry) => entry.request.path),
      ["/v1/storage/buckets/cart-assets", "/v1/storage/buckets/cart-assets/objects/a.png"],
    );
  });

  it("keeps a refusal the account answered in the reading rather than failing the criterion", async () => {
    const built = await ready(plan(), {
      cloud: fakePort({
        answer: () => ({
          result: "refused",
          status: 403,
          reason: "the account refused s3.deleteObject",
        }),
      }).port,
    });
    const observation = await built.subject.observe(built.id, request());
    assert.equal(observation.error, null, "a refusal is an observation a criterion may be built on");
    assert.ok(isCloudObservationData(observation.data));
    const record = observation.data.calls.at(-1);
    assert.equal(record?.result, "refused");
    assert.match(String(record?.reason), /the account refused/);
    assert.equal(built.subject.boundaries().crossings.length, 0, "a refusal is not a crossing");
  });
});

// ---- the boundary guard ---------------------------------------------------------------------------------

describe("a request this world does not serve is a crossing, and a repair does not undo it", () => {
  it("refuses a target naming another host, naming the cause and recording the crossing", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({
        criterionId: "AC-007",
        steps: [{ call: { method: "GET", path: "http://elsewhere.example/v1/metering", body: null } }],
      }),
    );
    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "SECURITY_VIOLATION");
    assert.match(String(observation.error?.message), /names a host/);
    assert.deepEqual(
      built.port.asked.map((entry) => entry.source),
      ["application"],
      "the guard refuses before the account is asked",
    );
    const crossings = built.subject.boundaries().crossings;
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0]?.boundary, "network");
    assert.equal(crossings[0]?.criterionId, "AC-007");
    assert.equal(crossings[0]?.subject, "call GET http://elsewhere.example/v1/metering");
  });

  it("refuses an unrooted target rather than inventing what it was relative to", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({ steps: [{ call: { method: "GET", path: "v1/version", body: null } }] }),
    );
    assert.equal(observation.error?.kind, "SECURITY_VIOLATION");
    assert.match(String(observation.error?.message), /is not rooted/);
    assert.equal(built.subject.boundaries().crossings.length, 1);
  });

  it("serves a path that merely contains a colon, because an object key may", async () => {
    const built = await ready();
    const observation = await built.subject.execute(
      built.id,
      request({
        steps: [
          {
            call: {
              method: "PUT",
              path: "/v1/storage/buckets/cart-assets/objects/a:b",
              body: null,
            },
          },
        ],
      }),
    );
    assert.equal(observation.error, null);
    assert.equal(built.subject.boundaries().crossings.length, 0);
  });

  it("keeps the crossing across a reset, because a repair does not undo a violation", async () => {
    const built = await ready();
    await built.subject.execute(
      built.id,
      request({ steps: [{ call: { method: "GET", path: "//elsewhere.example/v1", body: null } }] }),
    );
    await built.subject.reset(built.id);
    assert.equal(built.port.clearCount(), 1, "the reset really emptied the account");
    assert.equal(
      built.subject.boundaries().crossings.length,
      1,
      "clearing the record would destroy the evidence of the violation by repairing it",
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
    const built = await ready(
      plan({ boundary: { network: "allow", allow: [], filesystemWrite: "sandbox" } }),
    );
    assert.equal(built.subject.boundaries().network, "not-requested");
    assert.equal(built.subject.boundaries().filesystemWrite, "unsupported");
  });
});

// ---- evidence ---------------------------------------------------------------------------------------------

describe("evidence is derived from what was written", () => {
  it("writes the reading, and the account's decisions only when it reached some", async () => {
    const bare = await ready();
    const plain = await bare.subject.observe(bare.id, request());
    assert.deepEqual(
      plain.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json"],
    );

    const rich = await ready(plan(), {
      cloud: fakePort({
        decisions: [
          {
            principal: ACCOUNT.principal,
            action: "s3.deleteObject",
            resource: "object/cart-assets/logo.png",
            allowed: false,
            entry: "none",
            account: ACCOUNT.account,
          },
        ],
      }).port,
    });
    const withDecisions = await rich.subject.observe(rich.id, request());
    assert.deepEqual(
      withDecisions.artifacts.map((artifact) => artifact.path),
      ["artifacts/AC-001.observation.json", "artifacts/AC-001.decisions.json"],
    );
    assert.ok(
      (withDecisions.artifacts[1]?.bytes ?? 0) > 0,
      "an empty narrative is not an artifact",
    );
    assert.equal(
      await rich.io.exists(".veridian/runs/run-1/artifacts/AC-001.decisions.json"),
      true,
      "a bundle that names a file has to have written it",
    );
  });

  it("warns about an evidence kind it did not write, without claiming it wrote it", async () => {
    const built = await ready();
    await built.subject.observe(built.id, request({ evidence: ["screenshot"] }));
    const warning = built.logger.entries.find((item) => item.message === "environment.evidence");
    assert.equal(warning?.fields["kind"], "screenshot");
    assert.match(
      String(warning?.fields["note"]),
      /writes `json` artifacts for a criterion and cannot produce `screenshot`/,
    );
    assert.ok(
      !String(warning?.fields["note"]).includes("cannot produce `json`"),
      "the capability report is derived from the writes, so it cannot contradict itself",
    );
  });

  it("does not warn about a kind it did write", async () => {
    const built = await ready();
    await built.subject.observe(built.id, request({ evidence: ["json"] }));
    assert.equal(
      built.logger.entries.some((item) => item.message === "environment.evidence"),
      false,
    );
  });

  it("answers a reading it could not build with an environment failure, never with empty data", async () => {
    const built = await ready(plan(), {
      cloud: fakePort({
        snapshot: () => {
          throw new Error("the account's object store is unreadable");
        },
      }).port,
    });
    const observation = await built.subject.observe(built.id, request());
    assert.equal(observation.data, null);
    assert.equal(observation.error?.kind, "ENVIRONMENT_FAILURE");
    assert.match(String(observation.error?.message), /object store is unreadable/);
    assert.deepEqual(
      observation.artifacts,
      [],
      "a failed reading writes no evidence claiming otherwise",
    );
  });
});

// ---- the lifecycle ------------------------------------------------------------------------------------------

describe("the lifecycle is the same one every other world exposes", () => {
  it("rebuilds the account and re-provisions it on a restart reset", async () => {
    const built = await ready();
    assert.equal(built.processes.calls.length, 1);
    await built.subject.reset(built.id);
    assert.equal(built.port.clearCount(), 1);
    assert.equal(built.port.closeCount(), 1);
    assert.equal(built.port.listenCount(), 2);
    assert.equal(built.processes.calls.length, 2, "the provisioner is what puts the account back");
    assert.equal(built.port.bindings[1], "http://127.0.0.1:4002", "a reset re-binds a live account");
  });

  it("refuses a snapshot-restore reset by name, naming the path that does carry it", async () => {
    const built = await ready(plan({ reset: { strategy: "snapshot-restore", command: null } }));
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) =>
        assertEnvironmentError(error, /this world restores a baseline through `restore\(\)`/),
    );
    assert.equal(built.port.clearCount(), 0, "a refused reset must not quietly restart instead");
  });

  it("runs a declared custom reset command instead of rebuilding", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "node" } }));
    await built.subject.reset(built.id);
    assert.equal(built.processes.calls.length, 2, "the custom command ran instead of the provisioner");
    assert.equal(built.processes.calls[1]?.command, "node");
    assert.deepEqual(built.processes.calls[1]?.args, []);
    assert.equal(built.port.clearCount(), 0);
  });

  it("hands a custom reset the same account facts the provisioner got", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "node" } }));
    await built.subject.reset(built.id);
    const injected = built.processes.calls[1]?.env ?? {};
    assert.equal(injected[CLOUD_ENV.account], ACCOUNT.account);
    assert.equal(injected[CLOUD_ENV.api], built.port.bindings[0]);
  });

  it("refuses a custom reset command that fails, rather than falling back to a rebuild", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: "node" } }), {
      answers: [{}, { code: 9, stderr: "no account to reset" }],
    });
    await assert.rejects(
      () => built.subject.reset(built.id),
      (error: unknown) => assertEnvironmentError(error, /exited with code 9: no account to reset/),
    );
    assert.equal(built.port.closeCount(), 0, "a failed custom reset must not fall back to a rebuild");
  });

  it("warns, and still rebuilds, when a custom strategy declares no command", async () => {
    const built = await ready(plan({ reset: { strategy: "custom", command: null } }));
    await built.subject.reset(built.id);
    const warning = built.logger.entries.find(
      (item) => item.message === "environment.reset" && item.level === "warn",
    );
    assert.match(String(warning?.fields["note"]), /falling back to restarting the account/);
    assert.equal(built.port.listenCount(), 2);
  });

  it("writes a snapshot under the state root and returns the name it used", async () => {
    const built = await ready();
    const name = await built.subject.snapshot(built.id);
    assert.match(name, /^sim-cloud-[0-9]+\.account\.json$/);
    assert.equal(built.port.dumpCount(), 1);
    const state = await built.io.readTextFile(`.veridian/snapshots/${name}`);
    assert.equal(state, '{"account":"acct-cart","n":1}', "the name returned is the file written");
  });

  it("resolves a restore from the state root rather than from the caller's directory", async () => {
    const built = await ready();
    await built.subject.restore(built.id, "prior/account.json");
    assert.deepEqual(built.port.loaded, ['{"account":"acct-cart","n":0}']);
  });

  it("refuses a snapshot before the world has been started", async () => {
    const built = harness(plan());
    const { id } = await built.subject.create();
    await assert.rejects(
      () => built.subject.snapshot(id),
      (error: unknown) => assertEnvironmentError(error, /there is nothing to snapshot/),
    );
  });

  it("refuses a restore from a snapshot name that is not there", async () => {
    const built = await ready();
    await assert.rejects(
      () => built.subject.restore(built.id, "prior/absent.json"),
      (error: unknown) => assertEnvironmentError(error, /there is no snapshot `prior\/absent.json`/),
    );
  });

  it("closes the account on stop, and destroys back to an uncreated state", async () => {
    const built = await ready();
    await built.subject.stop(built.id);
    assert.equal(built.port.closeCount(), 1);
    const afterStop = await built.subject.probe(built.id);
    assert.equal(afterStop.ok, false, "a closed account is not ready");
    assert.equal(afterStop.message, "the substitute provider account is not listening");
    await built.subject.destroy(built.id);
    await assert.rejects(
      () => built.subject.stop(built.id),
      (error: unknown) => assertEnvironmentError(error, /has not been created/),
    );
  });

  it("carries the whole reading, not a subset, when the account holds resources", async () => {
    const queue: CloudQueueReading = {
      name: "cart-jobs",
      messages: 0,
      inFlight: 0,
      deadLetterQueue: null,
      encryption: "none",
      visibilityTimeoutSeconds: 30,
      attributes: {},
      tags: {},
    };
    const built = await ready(plan(), {
      cloud: fakePort({
        snapshot: {
          buckets: [
            {
              name: "cart-assets",
              region: ACCOUNT.region,
              versioning: "never",
              encryption: "AES256",
              publicAccessBlocked: true,
              policy: [],
              objects: 0,
              tags: {},
            },
          ],
          objects: [],
          queues: [queue],
          secrets: [],
          principals: [],
        },
      }).port,
    });
    const observation = await built.subject.observe(built.id, request());
    assert.ok(isCloudObservationData(observation.data));
    assert.equal(observation.data.buckets[0]?.name, "cart-assets");
    assert.equal(observation.data.buckets[0]?.publicAccessBlocked, true);
    assert.equal(observation.data.queues[0]?.name, "cart-jobs");
    assert.equal(observation.data.costModel, COST_MODEL);
    assert.equal(typeof observation.data.meters.costUnits, "number");
  });
});
