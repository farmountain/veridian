import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EnvironmentManager } from "../core/environment/manager.ts";
import type {
  EnvironmentAdapter,
  EnvironmentPlan,
  HealthProbe,
  Observation,
} from "../core/environment/types.ts";
import type { ObservationRequest } from "../core/environment/types.ts";
import { EnvironmentError } from "../core/failure.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The manager is where two failure-classification rules live, and both of them fail *quietly* when
 * they are wrong. An environment failure reported as a test failure sends an external agent to
 * repair healthy code; a reset failure reported as an environment failure blames a world that was
 * working until the reset. Neither shows up as a crash, so both need tests that name them.
 */

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "fake",
  app: ".",
  appPath: "app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["serve.mjs"], readyPattern: null },
  url: "http://127.0.0.1:4173",  databasePath: null,  cluster: null,  health: {
    path: "/health",
    expectStatus: 200,
    timeoutMs: 300,
    intervalMs: 100,
    readyPattern: null,
  },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: null, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "deny" },
  ...overrides,
});

interface FakeAdapter extends EnvironmentAdapter {
  readonly calls: string[];
  readonly sleeps: number[];
}

interface FakeOptions {
  readonly probes?: readonly (HealthProbe | Error)[];
  readonly failAt?: "create" | "start" | "deploy" | "reset" | "restore" | "snapshot";
  readonly snapshotId?: string;
}

// `ok: null` is the HTTP world saying "compare my status code" - the adapter has no separate verdict.
const HEALTHY: HealthProbe = { ok: null, statusCode: 200, message: null, patternSeen: null };

/** Probes are consumed in order; the last one repeats. */
function fakeAdapter(options: FakeOptions = {}): FakeAdapter {
  const calls: string[] = [];
  const queue = options.probes ? [...options.probes] : [HEALTHY];
  let probeCount = 0;

  const maybeThrow = (step: "create" | "start" | "deploy" | "reset" | "restore" | "snapshot"): void => {
    if (options.failAt === step) throw new EnvironmentError(`the fake adapter failed at ${step}`);
  };

  const observation = (): Observation => ({
    kind: "web.page",
    capturedAt: "2026-01-01T00:00:00.000Z",
    environmentId: "env-1",
    runId: "run-1",
    data: {},
    artifacts: [],
    error: null,
  });

  return {
    calls,
    sleeps: [],
    kind: "fake",
    async create() {
      calls.push("create");
      maybeThrow("create");
      return { id: "env-1" };
    },
    async start() {
      calls.push("start");
      maybeThrow("start");
    },
    async deploy() {
      calls.push("deploy");
      maybeThrow("deploy");
    },
    async execute() {
      calls.push("execute");
      return observation();
    },
    async observe() {
      calls.push("observe");
      return observation();
    },
    async probe() {
      calls.push("probe");
      const next = queue.length > 1 ? queue.shift() : queue[0];
      probeCount += 1;
      if (next instanceof Error) throw next;
      return next ?? HEALTHY;
    },
    async snapshot() {
      calls.push("snapshot");
      maybeThrow("snapshot");
      return options.snapshotId ?? "snap-1";
    },
    async restore() {
      calls.push("restore");
      maybeThrow("restore");
    },
    async reset() {
      calls.push("reset");
      maybeThrow("reset");
    },
    async stop() {
      calls.push("stop");
    },
    async destroy() {
      calls.push("destroy");
    },
    boundaries() {
      return { network: "enforced" as const, filesystemWrite: "unsupported" as const, crossings: [] };
    },
  } satisfies EnvironmentAdapter & { calls: string[]; sleeps: number[] };
}

const manager = (adapter: EnvironmentAdapter, sleep: (ms: number) => Promise<void> = async () => undefined) =>
  new EnvironmentManager({ adapter, clock: fixedClock(), logger: silentLogger, sleep });

describe("PREPARE drives the lifecycle in order and records it", () => {
  it("creates, starts, deploys, then proves the world is valid before declaring it ready", async () => {
    const adapter = fakeAdapter();
    const subject = manager(adapter);

    const result = await subject.prepare(plan());

    assert.equal(result.ok, true);
    assert.equal(subject.state, "ready");
    assert.equal(subject.id, "env-1");
    assert.deepEqual(adapter.calls, ["create", "start", "deploy", "probe"]);
    assert.deepEqual(
      subject.transitions.map((entry) => `${entry.from}->${entry.to}`),
      [
        "defined->creating",
        "creating->created",
        "created->starting",
        "starting->started",
        "started->deploying",
        "deploying->deployed",
        "deployed->ready",
      ],
    );
  });

  it("retries the health check until it passes, and reports how many attempts it took", async () => {
    const adapter = fakeAdapter({
      probes: [
        { ok: null, statusCode: null, message: "ECONNREFUSED", patternSeen: null },
        { ok: null, statusCode: 503, message: null, patternSeen: null },
        HEALTHY,
      ],
    });
    const sleeps: number[] = [];
    const subject = manager(adapter, async (ms) => {
      sleeps.push(ms);
    });

    const result = await subject.prepare(plan());

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.health.attempts, 3);
    assert.equal(result.health.statusCode, 200);
    assert.equal(result.health.url, "http://127.0.0.1:4173/health");
    assert.deepEqual(sleeps, [100, 100]);
  });

  it("stops after a bounded number of attempts even when the clock never advances", async () => {
    // The frozen clock is the point: with a fixed clock `elapsedMs` stays 0 forever, so this test
    // passes only because the loop has a *second*, independent exit. A loop with one exit hangs here,
    // and a hang in the prepare phase is indistinguishable from a slow application.
    const adapter = fakeAdapter({ probes: [new Error("still not up")] });
    const subject = manager(adapter);

    const result = await subject.prepare(plan());

    assert.equal(result.ok, false);
    if (result.ok) return;
    // 300ms / 100ms => 3 attempts.
    assert.equal(result.health?.attempts, 3);
    assert.equal(adapter.calls.filter((call) => call === "probe").length, 3);
  });

  it("classifies a health-check failure as ENVIRONMENT_FAILURE, never as a test failure", async () => {
    const adapter = fakeAdapter({ probes: [new Error("connect ECONNREFUSED 127.0.0.1:4173")] });
    const subject = manager(adapter);

    const result = await subject.prepare(plan());

    assert.equal(result.ok, false);
    if (result.ok) return;
    // The whole product turns on this line. The application was never observed, so nothing is known
    // about it; reporting TEST_FAILURE here would be Veridian inventing a result.
    assert.equal(result.failure.kind, "ENVIRONMENT_FAILURE");
    assert.match(result.failure.message, /127\.0\.0\.1:4173\/health/);
  });

  it("cleans up a half-started world so the next run does not inherit a held port", async () => {
    const adapter = fakeAdapter({ failAt: "deploy" });
    const subject = manager(adapter);

    const result = await subject.prepare(plan());

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "ENVIRONMENT_FAILURE");
    assert.match(adapter.calls.join(" "), /deploy .*stop .*destroy/);
    assert.equal(subject.state, "destroyed");
  });

  it("requires both the status and a declared readiness pattern when the adapter can see stdout", async () => {
    const adapter = fakeAdapter({ probes: [{ ok: null, statusCode: 200, message: null, patternSeen: false }] });
    const subject = manager(adapter);

    const result = await subject.prepare(
      plan({
        health: {
          path: "/health",
          expectStatus: 200,
          timeoutMs: 100,
          intervalMs: 50,
          readyPattern: "listening on",
        },
      }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "ENVIRONMENT_FAILURE");
    assert.equal(result.health?.readyPatternSatisfied, false);
  });
});

describe("RESET is the state a validator must never inherit", () => {
  it("resets through the adapter and re-proves the world before returning it", async () => {
    const adapter = fakeAdapter();
    const subject = manager(adapter);
    await subject.prepare(plan());
    adapter.calls.length = 0;

    const result = await subject.reset();

    assert.equal(result.ok, true);
    assert.deepEqual(adapter.calls, ["reset", "probe"]);
    assert.equal(subject.state, "ready");
  });

  it("reports a reset that throws as RESET_FAILURE, not as an environment failure", async () => {
    const adapter = fakeAdapter({ failAt: "reset" });
    const subject = manager(adapter);
    await subject.prepare(plan());

    const result = await subject.reset();

    assert.equal(result.ok, false);
    if (result.ok) return;
    // The environment was valid a moment ago; the reset broke it.
    assert.equal(result.failure.kind, "RESET_FAILURE");
    assert.equal(subject.state, "error");
  });

  it("reports a world that did not survive its own reset as RESET_FAILURE", async () => {
    const adapter = fakeAdapter({ probes: [HEALTHY, new Error("gone")] });
    const subject = manager(adapter);
    await subject.prepare(plan());

    const result = await subject.reset();

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Not ENVIRONMENT_FAILURE: blaming the world here would hide the fact that the *reset* is what
    // left it unusable, and reset is the mechanism the whole repeat-run metric depends on.
    assert.equal(result.failure.kind, "RESET_FAILURE");
  });

  it("takes a baseline snapshot only when the plan asked for restore-based reset", async () => {
    const restarting = fakeAdapter();
    await manager(restarting).prepare(plan());
    assert.equal(restarting.calls.includes("snapshot"), false);

    const restoring = fakeAdapter();
    const subject = manager(restoring);
    await subject.prepare(plan({ reset: { strategy: "snapshot-restore", command: null } }));

    assert.equal(restoring.calls.filter((call) => call === "snapshot").length, 1);
    restoring.calls.length = 0;
    const result = await subject.reset();
    assert.equal(result.ok, true);
    assert.deepEqual(restoring.calls, ["restore", "probe"]);
  });

  it("refuses a snapshot-restore reset that has no baseline to restore", async () => {
    const adapter = fakeAdapter({ failAt: "snapshot" });
    const subject = manager(adapter);
    await subject.prepare(plan({ reset: { strategy: "snapshot-restore", command: null } }));

    const result = await subject.reset();

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "RESET_FAILURE");
    assert.match(result.failure.message, /no baseline snapshot/);
  });

  it("refuses to reset a world that was never prepared", async () => {
    const adapter = fakeAdapter();
    const subject = manager(adapter);

    const result = await subject.reset();

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, "RESET_FAILURE");
    assert.deepEqual(adapter.calls, []);
  });
});

describe("the manager refuses to observe a world it has not validated", () => {
  it("throws when asked to execute before it is ready", async () => {
    const subject = manager(fakeAdapter());
    const request: ObservationRequest = {
      criterionId: "AC-001",
      runId: "run-1",
      steps: [],
      targets: [],
      evidence: [],
    };

    await assert.rejects(
      () => subject.execute(request),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentError);
        assert.match(error.message, /not "ready"/);
        return true;
      },
    );
  });

  it("tears down idempotently and never throws, because it runs on error paths", async () => {
    const adapter = fakeAdapter();
    const subject = manager(adapter);
    await subject.prepare(plan());

    await subject.teardown();
    await subject.teardown();

    assert.deepEqual(adapter.calls.filter((call) => call === "stop").length, 1);
    assert.equal(subject.transitions.at(-1)?.to, "destroyed");
  });
});
