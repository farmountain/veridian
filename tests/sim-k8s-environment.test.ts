import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SimK8sEnvironment, CLUSTER_ENV } from "../adapters/sim-k8s/sim-k8s-environment.ts";
import type { ClusterPort, ClusterSnapshot } from "../adapters/sim-k8s/cluster-port.ts";
import type { K8sApplyRecord } from "../core/environment/k8s-observation.ts";
import type { EnvironmentPlan } from "../core/environment/types.ts";
import { confineChild, confinementCapability, type ConfinementResult } from "../core/environment/confinement.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessHandle, ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { fixedClock, recordingLogger } from "./helpers/clock.ts";

/**
 * The simulated cluster world, against a fake control plane and a fake runner.
 *
 * The substitute plane has its own suite, held against real sockets, because the facts worth holding
 * there are facts about an HTTP surface. *This* suite is about the adapter - and the single fact it
 * exists to hold is the one `docs/GAP-CLOSURE-DESIGN.md` §W1 was written for: **the write boundary a
 * cluster world reports is a measurement of what its runner did, not a sentence about what its plan
 * says.**
 *
 * That distinction decides how the runner double below is written. It calls the **real**
 * `confineChild` for every request that carries an allowance and keeps the answer, because a double
 * that dropped the allowance would make `boundaries()` report `unsupported` for a world that had just
 * handed over a perfectly good one - and the reading would then be untestable rather than tested. The
 * same rule `tests/local-process-environment.test.ts` records was paid for once already.
 *
 * There was no suite in this file's place before it: `tests/sim-k8s-demo.test.ts` drives the real
 * filesystem through `nodeIo` and injects no runner at all, so no test in the tree constructed
 * `SimK8sEnvironment` and the adapter's own behaviour - refusals, readiness, and this reading - had
 * no unit coverage.
 */

// ---- fixtures ---------------------------------------------------------------------------------------

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "sim-k8s",
  app: "app",
  appPath: "/virtual/app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["deploy.mjs"], readyPattern: null },
  url: null,
  api: null,
  databasePath: null,
  cluster: { name: "sim-local", namespace: "dev", imagesPath: "app/build/images" },
  posix: null,
  os: null,
  cloud: null,
  container: null,
  vscode: null,
  process: null,
  data: null,
  mobile: null,
  health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 10, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
  ...overrides,
});

interface FakeCluster {
  readonly port: ClusterPort;
  /** How many times the world asked the plane to empty itself. */
  readonly clears: () => number;
  /** Every address the world bound, in order - the port answers one each time, as a real bind does. */
  readonly bound: readonly string[];
}

function fakeCluster(): FakeCluster {
  const bound: string[] = [];
  let clears = 0;
  let closed = 0;
  const empty: ClusterSnapshot = { deployments: [], pods: [], services: [], events: [] };
  const record: K8sApplyRecord = {
    source: "POST /apis/apps/v1/namespaces/dev/deployments",
    kind: "Deployment",
    name: "cart-web",
    namespace: "dev",
    result: "created",
    reason: null,
  };
  return {
    bound,
    clears: () => clears,
    port: {
      async listen() {
        // A distinct URL per bind, so a reset that forgot to re-bind would be visible rather than
        // silently reusing the address the previous life of the world was reachable at.
        const url = `http://127.0.0.1:${String(41000 + bound.length)}`;
        bound.push(url);
        return url;
      },
      async close() {
        closed += 1;
      },
      applies: () => [record],
      snapshot: () => empty,
      clear: () => {
        clears += 1;
      },
      dump: () => JSON.stringify({ closed }),
      load: () => undefined,
      submit: () => record,
    },
  };
}

interface FakeProcesses {
  readonly runner: ProcessRunner;
  readonly requests: readonly ProcessRequest[];
  /**
   * What the **runner** decided for each request, exactly as the real one reports it.
   *
   * Kept beside `requests` rather than folded into it, because the two are the two halves of the
   * seam: the adapter states the allowance it asked for, and only the runner knows whether the
   * mechanism could be applied to the vector it was handed.
   */
  readonly confined: readonly (ConfinementResult | null)[];
}

/**
 * A runner that starts nothing, but really decides the allowance.
 *
 * `answers` indexes per request, repeating the last entry, so a suite can script a reset's second
 * child without scripting the first.
 */
function fakeProcesses(answers: readonly Partial<ProcessResult>[] = [{}]): FakeProcesses {
  const requests: ProcessRequest[] = [];
  const confined: (ConfinementResult | null)[] = [];
  let index = 0;
  return {
    requests,
    confined,
    runner: {
      run(request: ProcessRequest): ProcessHandle {
        requests.push(request);
        // The allowance is applied here because applying it is the *runner's* job - that is the whole
        // of the seam this double stands in for. `confineChild` is the real mechanism.
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
        confined.push(confinement);
        const answer = answers[Math.min(index, answers.length - 1)] ?? {};
        index += 1;
        const settled: ProcessResult = {
          code: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          ...answer,
          confinement,
        };
        return {
          pid: index,
          confinement,
          exited: Promise.resolve(settled),
          output: () => settled.stdout,
          error: () => settled.stderr,
          waitForPattern: async () => true,
          stop: async () => undefined,
        };
      },
    },
  };
}

interface Harness {
  readonly subject: SimK8sEnvironment;
  readonly cluster: FakeCluster;
  readonly processes: FakeProcesses;
  readonly io: ReturnType<typeof memoryIo>;
  readonly logger: ReturnType<typeof recordingLogger>;
}

function harness(environment: EnvironmentPlan, answers: readonly Partial<ProcessResult>[] = [{}]): Harness {
  const cluster = fakeCluster();
  const io = memoryIo({
    // The registry the deploy program would have written. `#deployApplication()` requires it to
    // exist after a zero exit - a deploy program that built nothing is an environment failure - and
    // `cluster.images` resolves *inside* the application directory, which is the fact this world's
    // allowance rests on.
    "app/build/images/image-0.json": JSON.stringify({ image: "registry.local/cart-web:1.4.0" }),
  });
  const processes = fakeProcesses(answers);
  const logger = recordingLogger();
  return {
    cluster,
    processes,
    io,
    logger,
    subject: new SimK8sEnvironment(environment, {
      io,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger,
      processes: processes.runner,
      cluster: cluster.port,
      stateDir: ".veridian",
    }),
  };
}

// ---- the world's own lifecycle ----------------------------------------------------------------------

describe("sim-k8s: the lifecycle it really performs", () => {
  it("binds the control plane before the application deploys into it", async () => {
    const { subject, cluster, processes } = harness(plan());

    const { id } = await subject.create();
    assert.equal(id, "sim-k8s:dev");
    assert.equal(cluster.bound.length, 0, "create must not bind an address");

    await subject.start(id);
    assert.equal(cluster.bound.length, 1, "start binds the plane the application is about to call");
    assert.equal(processes.requests.length, 1, "and runs the deploy program exactly once");
  });

  it("hands the deploy program the address the plane really bound, not one the document could state", async () => {
    const { subject, cluster, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    const env = processes.requests[0]?.env;
    assert.ok(env !== undefined, "the deploy program must have been handed an environment");
    assert.deepEqual(Object.keys(env).sort(), Object.values(CLUSTER_ENV).sort());
    assert.equal(env[CLUSTER_ENV.api], cluster.bound[0], "the address is the one listen() returned");
    assert.equal(env[CLUSTER_ENV.namespace], "dev");
    assert.equal(
      env[CLUSTER_ENV.images],
      "app/build/images",
      "the registry travels as the document spelled it - the program resolves it, and the allowance covers the tree it lands in",
    );
  });

  it("refuses a document with no cluster block, naming the field it needed", async () => {
    const { subject } = harness(plan({ cluster: null }));
    await assert.rejects(() => subject.create(), /has no `cluster` declaration/u);
  });

  it("refuses a world that declares no deploy command rather than judging a cluster it never let anyone fill", async () => {
    const { subject } = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(() => subject.create(), /declares no `start\.command`/u);
  });

  it("empties the cluster and re-deploys into it on a restart reset", async () => {
    const { subject, cluster, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    await subject.reset(id);

    assert.equal(cluster.clears(), 1, "a restart begins with an empty cluster");
    assert.equal(cluster.bound.length, 2, "and with a control plane bound again");
    assert.equal(processes.requests.length, 2, "the objects have to be put back by the thing that put them there");
  });
});

// ---- the boundary report is derived from what the world did ------------------------------------------

describe("sim-k8s: the boundary report is derived from what the world did", () => {
  it("reports the write boundary unsupported before the deploy program has been started", async () => {
    const { subject } = harness(plan());
    await subject.create();

    // Nothing has been confined yet, and a world with no child must not claim a boundary over one.
    assert.equal(subject.boundaries().filesystemWrite, "unsupported");
    assert.deepEqual(subject.boundaries().crossings, [], "a refusal the runtime makes is not a crossing this world observed");
  });

  it("hands the runner an allowance to write over the application directory, which is where the registry lives", async () => {
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);

    const request = processes.requests[0];
    assert.ok(request !== undefined, "the deploy program was started");
    assert.deepEqual(
      request.confinement?.writeRoots,
      ["/virtual/app"],
      "the write allowance is the directory the manifests are resolved against, and nothing beside it",
    );
    // Asserted as containment rather than as an exact vector *deliberately*. What the read allowance
    // additionally names is a fact about this machine's filesystem - `dependencyReadRoots` walks real
    // directories - and pinning it here would have made this test a statement about the developer's
    // checkout. The property that is about the world is the one below, and the width of the read
    // allowance is held by the test after it, which supplies the dependency itself.
    assert.ok(
      request.confinement?.readRoots.includes("/virtual/app") === true,
      `a read allowance narrower than the write allowance would refuse the child the registry it writes: ${String(request.confinement?.readRoots.join(", "))}`,
    );
  });

  it("hands the runner a read allowance that reaches the dependencies the application imports", async () => {
    // A real tree, because the thing under test is a derivation over the real filesystem: the
    // permission model enforces its allowlists against the interpreter's module resolution, so a
    // dependency has to exist in a place the walk can find before the walk can name it.
    const tree = mkdtempSync(join(tmpdir(), "veridian-sim-k8s-allowance-"));
    const appPath = join(tree, "app");
    mkdirSync(appPath, { recursive: true });
    mkdirSync(join(tree, "node_modules", "cart-yaml"), { recursive: true });
    try {
      const { subject, processes } = harness(plan({ appPath }));
      const { id } = await subject.create();
      await subject.start(id);

      const allowance = processes.requests[0]?.confinement;
      assert.ok(allowance !== undefined, "the deploy program was handed an allowance");
      assert.ok(
        allowance.readRoots.includes(join(tree, "node_modules")),
        `a program's source and its dependencies are two directories, and an allowance naming only the application tree refuses the package the program imports before its first statement runs - which the world then reports as the application's own environment failure: ${allowance.readRoots.join(", ")}`,
      );
      assert.deepEqual(
        [...allowance.writeRoots],
        [appPath],
        "the read allowance is the wider one, and the write allowance was not widened with it - so the boundary `filesystemWrite` measures is exactly what it measured before",
      );
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
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

    assert.equal(processes.confined[0]?.applied, true, "the deploy child really was confined");
    assert.equal(processes.confined[0]?.command, process.execPath, "it runs under the interpreter the flags belong to");
    assert.equal(processes.confined[0]?.args[0], "--permission", "and carries the flag that enforces the allowance");
    assert.equal(subject.boundaries().filesystemWrite, "enforced");
  });

  it("does not report enforcement for a deploy program the confinement model cannot reach", async () => {
    const { subject, processes } = harness(
      plan({ start: { command: "cmd", args: ["/c", "deploy.bat"], readyPattern: null } }),
    );
    const { id } = await subject.create();
    await subject.start(id);

    assert.equal(
      processes.confined[0]?.applied,
      false,
      "the runner states that it refused the allowance rather than silently confining something it cannot reach",
    );
    assert.equal(processes.confined[0]?.command, "cmd", "so the vector that starts is the one declared");
    assert.notEqual(
      subject.boundaries().filesystemWrite,
      "enforced",
      "an ordinary process with the operator's privileges is not a confined one",
    );
  });

  it("confines the replacement as well as the first child", async () => {
    const { subject, processes } = harness(plan());
    const { id } = await subject.create();
    await subject.start(id);
    await subject.reset(id);

    // The adapter's half: every application-shaped request carries an allowance, including the one a
    // reset makes, so confining the replacement is the runner's decision rather than the adapter
    // remembering to ask twice.
    const replacement = processes.requests[1];
    assert.ok(replacement !== undefined, "reset re-deployed");
    assert.ok(
      replacement.confinement !== undefined,
      "the replacement is handed an allowance, so confining it is the runner's decision rather than the adapter remembering",
    );
    assert.equal(processes.confined[1]?.applied, true, "and the runner really applied it");
    assert.equal(subject.boundaries().filesystemWrite, "enforced", "the reading survives the reset");
  });

  it("leaves the operator's own reset command unconfined, because one word cannot describe two authors", async () => {
    const { subject, processes } = harness(plan({ reset: { strategy: "custom", command: "node" } }));
    const { id } = await subject.create();
    await subject.start(id);
    await subject.reset(id);

    // Two children in one world, and only the first one is the application's. The command below comes
    // out of the operator's environment document, so Veridian did not write it and starts it as
    // declared. The application's own deploy program is the child whose author Veridian does not
    // control, and that is the one the allowance goes on.
    assert.equal(processes.requests.length, 2, "the deploy program, then the operator's reset command");
    assert.equal(processes.requests[0]?.confinement?.writeRoots[0], "/virtual/app");
    assert.equal(processes.confined[0]?.applied, true);

    const reset = processes.requests[1];
    assert.ok(reset !== undefined, "the reset command was started");
    assert.equal(reset.command, "node");
    assert.equal(reset.confinement, undefined, "the operator's own command is started as declared");
    assert.equal(processes.confined[1], null, "and the runner reports no allowance for it");
    // The reading still describes the confinement the world really performed - and the fact that a
    // *second*, unconfined child ran beside it is a fact about which child the boundary is about.
    assert.equal(subject.boundaries().filesystemWrite, "enforced", "the reading names the application child, not the operator's");
  });
});
