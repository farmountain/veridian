import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { captureReproducibility, environmentRecord } from "../core/evidence/writer.ts";
import { RunBundle, bundleLayout, evidenceCompleteness } from "../core/evidence/index.ts";
import type { EnvironmentRecord, RunOutcome } from "../core/evidence/index.ts";
import type { ClarificationRecord, ClarificationReport } from "../core/clarification/types.ts";
import type { EnvironmentPlan } from "../core/environment/types.ts";
import { memoryIo, nodeIo, type MemoryIo } from "../core/io.ts";
import { loadSchemaSet, SCHEMA_URIS } from "../core/schema/registry.ts";
import type { CriterionResult } from "../core/validation/types.ts";
import { rollup } from "../core/validation/rollup.ts";
import { fixedClock } from "./helpers/clock.ts";

/**
 * The bundle is the product's interface to an external agent, so what it must never do is lie by
 * omission. Two failure modes are worth naming because neither shows up as a crash:
 *
 *  - A file that is written only on the failing path. The reader then learns to treat the absence of
 *    `latest-failure.md` as "the last run passed", which is exactly backwards once a run aborts
 *    before it can report.
 *  - A required artifact that is silently not required. M5 counts evidence completeness, so the
 *    completeness report has to be the thing that decides a criterion is unproven, not a comment.
 *
 * These tests therefore assert on *presence and content* rather than on the writer being called.
 */

const VERIDIAN_DIR = ".veridian";
const RUN_ID = "run-2026-01-01T00-00-00-000Z";

const plan: EnvironmentPlan = {
  adapter: "local-web",
  app: "shopping-cart",
  appPath: "examples/shopping-cart",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["serve.mjs"], readyPattern: null },
  url: "http://127.0.0.1:4173",
  databasePath: null,
  cluster: null,
  posix: null,
  health: { path: "/health", expectStatus: 200, timeoutMs: 20_000, intervalMs: 100, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: null, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
};

const criterion = (overrides: Partial<CriterionResult> = {}): CriterionResult => ({
  criterionId: "AC-001",
  description: "the cart total reflects the items added",
  mandatory: true,
  status: "PASS",
  actual: ["$30.00"],
  expected: ["$30.00"],
  timestamp: "2026-01-01T00:00:00.000Z",
  message: null,
  missingEvidence: [],
  evidence: ["screenshots/AC-001.png"],
  environmentId: "env-1",
  runId: RUN_ID,
  assertions: [
    {
      validator: "text.equals",
      target: "#total",
      status: "PASS",
      actual: "$30.00",
      expected: "$30.00",
      message: null,
    },
  ],
  ...overrides,
});

const environment: EnvironmentRecord = environmentRecord(plan, null, [], true, {
  network: "enforced",
  filesystemWrite: "unsupported",
  crossings: [],
});

const outcome = (overrides: Partial<RunOutcome> = {}): RunOutcome => {
  const criteria = overrides.criteria ?? [criterion()];
  // From the same value the returned outcome carries, so the guards cannot describe a different run
  // than the one the caller asked for - a helper that decided the verdict on a `null` it invented
  // would report `noSafetyViolation: true` next to a non-null violation.
  const verdict = rollup({
    criteria,
    environmentValid: true,
    safetyViolation: overrides.safetyViolation ?? null,
    insufficientInformation: false,
  });
  return {
    runId: RUN_ID,
    goalId: "shopping-cart",
    state: "COMPLETED",
    iteration: 1,
    verdict: verdict.verdict,
    criteria,
    failure: verdict.failure,
    reasons: verdict.reasons,
    guards: verdict.guards,
    environment,
    iterations: [
      {
        iteration: 1,
        verdict: "PASS",
        passed: 1,
        failed: 0,
        undecided: 0,
        repaired: false,
        note: "",
        criteria: [{ criterionId: "AC-001", status: "PASS" }],
      },
    ],
    clarifications: [],
    reproducibility: {
      capturedAt: "2026-01-01T00:00:00.000Z",
      platform: "win32",
      arch: "x64",
      node: "v22.18.0",
      veridian: "0.1.0",
      gitCommit: null,
      gitDirty: null,
      playwright: null,
      browser: null,
      timezone: "UTC",
      networkPolicy: "deny",
      env: {},
    },
    limits: { maxIterations: 10, maxRuntimeMs: 300_000, elapsedMs: 1234 },
    ...overrides,
    // Restated after the spread. `Partial<RunOutcome>` widens this field to admit `undefined`, which
    // `RunOutcome` does not: the two readings are "none observed" (`null`) and "a violation" (a
    // string), and a run that stated neither has no reading at all rather than a third one.
    safetyViolation: overrides.safetyViolation ?? null,
  };
};

const bundleOn = (io: MemoryIo): RunBundle =>
  new RunBundle({ io, layout: bundleLayout(VERIDIAN_DIR, RUN_ID), clock: fixedClock() });

/**
 * Read a file out of the in-memory filesystem by its logical path.
 *
 * The memory filesystem stores absolute keys under its root, so the lookup matches on suffix �?which
 * also makes the assertion independent of how the writer chose to join its paths. A test that
 * reimplements the path join would fail whenever the writer fixed a bug in it.
 */
const textAt = (io: MemoryIo, path: string): string | undefined => {
  const wanted = path.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const [key, value] of io.files) {
    if (key === wanted || key.endsWith(`/${wanted}`)) return value;
  }
  return undefined;
};

describe("the run bundle is complete on every terminal path", () => {
  it("writes the definition, environment, log, clarifications and result, not just the result", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    await bundle.writeDefinition("version: 1\n", "version: 1\n");
    await bundle.writeEnvironment(environment);
    await bundle.log("run.started", { goal: "shopping-cart" });
    await bundle.writeClarifications([]);
    const written = await bundle.writeResult(outcome());

    const dir = `${VERIDIAN_DIR}/runs/${RUN_ID}`;
    for (const name of ["goal.yaml", "acceptance.yaml", "environment.json", "execution.log", "result.json", "clarifications.json", "failure.md"]) {
      assert.ok(textAt(io, `${dir}/${name}`) !== undefined, `${name} was not written into the bundle`);
    }

    assert.equal(written.path.endsWith("/result.json"), true);
    assert.ok(textAt(io, `${VERIDIAN_DIR}/latest-result.json`) !== undefined);
    assert.ok(textAt(io, `${VERIDIAN_DIR}/latest-failure.md`) !== undefined);
  });

  it("records one row per artifact path, because the bundle holds one file per artifact path", async () => {
    // A run observes the same criterion on every iteration and writes its evidence to the same
    // path each time, so an append-only ledger describes a bundle that does not exist. The
    // canonical demo's passing run reported thirty-six artifacts for ten files, naming
    // `artifacts/AC-001.observation.json` four times with four different sizes and leaving a reader
    // no way to tell which size is the file on disk. The newest write is the one that is there.
    const memory = memoryIo();
    const bundle = new RunBundle({
      io: memory,
      layout: bundleLayout(VERIDIAN_DIR, RUN_ID),
      clock: fixedClock(),
    });
    await bundle.init();

    const observation = "artifacts/AC-001.observation.json";
    await bundle.writeArtifact({ path: observation, kind: "json", criterionId: "AC-001" }, "first reading");
    await bundle.writeArtifact(
      { path: observation, kind: "json", criterionId: "AC-001" },
      "second reading, longer than the first",
    );
    await bundle.writeArtifact(
      { path: "screenshots/AC-001.png", kind: "screenshot", criterionId: "AC-001" },
      "a frame",
    );
    bundle.record({ path: observation, kind: "json", criterionId: "AC-001", bytes: 4096 });

    const rows = bundle.artifacts.filter((artifact) => artifact.path === observation);
    assert.equal(rows.length, 1, "one row for the one file that path names");
    assert.equal(rows[0]?.bytes, 4096, "the newest write is the one a reader will find there");
    assert.equal(bundle.artifacts.length, 2, "and the other path keeps its own row");
  });

  it("keeps two iterations apart that share every count but not every failure", async () => {
    // `passed`/`failed`/`undecided` are three numbers standing in for a whole contract, and different
    // failures land on the same three numbers: whether AC-001 broke or AC-002 broke, the summary reads
    // `passed: 1, failed: 1`. A repeat-run consistency check (M1) that compares counts would therefore
    // call two runs equal that failed different criteria - the one thing "the same code produced the
    // same result twice" is supposed to mean. The list is what makes the counts answerable.
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    const iteration = {
      iteration: 1,
      verdict: "FAIL" as const,
      passed: 1,
      failed: 1,
      undecided: 0,
      repaired: false,
      note: "",
    };
    await bundle.writeResult(
      outcome({
        iterations: [
          { ...iteration, criteria: [{ criterionId: "AC-001", status: "PASS" }, { criterionId: "AC-002", status: "FAIL" }] },
          { ...iteration, criteria: [{ criterionId: "AC-001", status: "FAIL" }, { criterionId: "AC-002", status: "PASS" }] },
        ],
      }),
    );

    const raw = textAt(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/result.json`) ?? textAt(io, `${RUN_ID}/result.json`);
    assert.ok(raw !== undefined, "the result must be on disk to be asserted about");
    const persisted = JSON.parse(raw) as {
      readonly iterations: readonly {
        readonly passed: number;
        readonly failed: number;
        readonly criteria: readonly { readonly criterion_id: string; readonly status: string }[];
      }[];
    };

    const [first, second] = persisted.iterations;
    assert.ok(first !== undefined && second !== undefined, "both iterations were written");
    assert.equal(first.passed, second.passed, "the counts genuinely collide");
    assert.equal(first.failed, second.failed);
    assert.deepEqual(
      first.criteria.filter((entry) => entry.status === "FAIL").map((entry) => entry.criterion_id),
      ["AC-002"],
      "the failing criterion is named, snake-cased like the rest of the bundle",
    );
    assert.deepEqual(
      second.criteria.filter((entry) => entry.status === "FAIL").map((entry) => entry.criterion_id),
      ["AC-001"],
      "so a comparison of the two sets can see they are not the same run",
    );
  });

  it("writes the two Level-2 agent artifacts even when the run passed", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    const written = await bundle.writeResult(outcome({ state: "COMPLETED", verdict: "PASS" }));

    // The whole point: a passing run is exactly when a reader would otherwise conclude the artifact
    // set is optional. It is not. Its presence is what makes its absence meaningful.
    assert.ok(textAt(io, `${VERIDIAN_DIR}/latest-result.json`) !== undefined);
    assert.ok(textAt(io, `${VERIDIAN_DIR}/latest-failure.md`) !== undefined);
    assert.equal(written.complete, true);
  });

  it("keeps the log's earliest lines when a later write fails, because it is appended not buffered", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    await bundle.log("iteration.started", { iteration: 1 });
    await bundle.log("observation.failed", { kind: "TIMEOUT" });

    const log = textAt(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/execution.log`) ?? "";
    const lines = log.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /iteration\.started/);
    assert.match(lines[1] ?? "", /observation\.failed/);
  });
});

describe("evidence completeness decides, it does not advise", () => {
  it("names the criterion and the kind that is missing rather than returning a boolean", () => {
    const report = evidenceCompleteness([
      criterion({ missingEvidence: ["screenshot", "trace"] }),
      criterion({ criterionId: "AC-002" }),
    ]);

    assert.deepEqual(report.missing, ["AC-001:screenshot", "AC-001:trace"]);
    assert.equal(report.complete, false);
  });

  it("reports a bundle as complete only when every criterion has all of its evidence", () => {
    assert.deepEqual(evidenceCompleteness([criterion()]), { missing: [], complete: true });
    assert.equal(evidenceCompleteness([]).complete, true);
  });

  it("does not let a criterion with missing evidence be read as a clean pass in the failure report", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    const criteria = [criterion({ status: "INCONCLUSIVE", missingEvidence: ["screenshot"] })];
    const written = await bundle.writeResult(outcome({ criteria, state: "ABORTED" }));

    const report = textAt(io, `${VERIDIAN_DIR}/latest-failure.md`) ?? "";
    assert.match(report, /AC-001:screenshot/);
    assert.equal(written.complete, false);

    // And the agent boundary is stated, not implied: Veridian reports, it does not prescribe.
    assert.match(report, /does not propose changes to the application/);
  });
});

describe("the persisted result satisfies its own contract", () => {
  it("validates the serialised result against result.schema.json before writing it", async () => {
    const root = process.cwd();
    const io = nodeIo({ root });
    const schemas = await loadSchemaSet(io);
    assert.ok(schemas.has(SCHEMA_URIS.result));

    const memory = memoryIo();
    const bundle = new RunBundle({
      io: memory,
      layout: bundleLayout(VERIDIAN_DIR, RUN_ID),
      clock: fixedClock(),
      schemas,
    });
    await bundle.init();
    await bundle.writeResult(outcome());

    const raw = textAt(memory, `${VERIDIAN_DIR}/runs/${RUN_ID}/result.json`) ?? "{}";
    const parsed: unknown = JSON.parse(raw);
    // The writer already asserted; this asserts the writer is reachable with a real schema set,
    // which is the configuration the CLI runs in.
    schemas.get(SCHEMA_URIS.result).assert(parsed);
  });

  it("writes a result that carries a clarification raised mid-run, which is the origin the run itself produces", async () => {
    // The defect this test pins, in full, because it was expensive. A run decides things the
    // definition phase could not: when the canonical demo could not observe a single criterion
    // (no browser), the loop recorded the gap in its own words, with origin `iteration`.
    // `result.schema.json` listed the six definition-time origins and not that one, so the result
    // failed its self-check, `finish()` threw, the run never recorded a verdict - and, because
    // teardown sat only on the success path, the application it had started kept the process alive
    // forever. One missing enum value, and a run that had already decided `stop` could not finish.
    const report: ClarificationReport = {
      records: [
        {
          ambiguity: {
            id: "iteration:1:AC-001",
            origin: "iteration",
            path: "/criteria/0/status",
            kind: "underspecified",
            question: "AC-001 could not be observed in this environment. Continue, or stop here?",
            blocking: false,
          },
          resolution: { via: "deferred", reason: "no_user_available" },
          rungsAttempted: ["derived", "inferred", "defaulted", "answered", "deferred"],
        } satisfies ClarificationRecord,
      ],
      questionsAsked: 0,
      rounds: 1,
      elapsedMs: 12,
      budgetExhausted: false,
      unresolvedBlocking: 0,
      byVia: { derived: 0, inferred: 0, defaulted: 0, answered: 0, deferred: 1 },
    };

    const schemas = await loadSchemaSet(nodeIo({ root: process.cwd() }));
    const memory = memoryIo();
    const bundle = new RunBundle({
      io: memory,
      layout: bundleLayout(VERIDIAN_DIR, RUN_ID),
      clock: fixedClock(),
      schemas,
    });
    await bundle.init();
    await bundle.writeClarifications([report]);
    await bundle.writeResult(
      outcome({ criteria: [criterion({ status: "INCONCLUSIVE" })], clarifications: [report] }),
    );

    const runDir = `${VERIDIAN_DIR}/runs/${RUN_ID}`;
    const parsed = JSON.parse(textAt(memory, `${runDir}/result.json`) ?? "{}") as {
      clarifications?: { records?: readonly { origin?: string }[] };
    };
    assert.equal(parsed.clarifications?.records?.[0]?.origin, "iteration");
    assert.ok(textAt(memory, `${runDir}/clarifications.json`) !== undefined, "the reports file must land too");
  });
});

describe("reproducibility records absences as absences", () => {
  it("uses null for a value it could not observe, never a plausible substitute", async () => {
    const record = await captureReproducibility({
      clock: fixedClock(),
      veridianVersion: "0.1.0",
      networkPolicy: "deny",
    });

    // `"unknown"` would read as a value and would silently compare equal across two different runs.
    assert.equal(record.gitCommit, null);
    assert.equal(record.playwright, null);
    assert.equal(record.browser, null);
    assert.equal(record.browser, null);
    assert.equal(record.networkPolicy, "deny");
    assert.notEqual(record.node, "");
  });

  it("distinguishes a clean tree from an unobserved one", async () => {
    const unknown = await captureReproducibility({ clock: fixedClock(), veridianVersion: "0.1.0" });
    const clean = await captureReproducibility({
      clock: fixedClock(),
      veridianVersion: "0.1.0",
      gitCommit: "abc123",
      gitDirty: false,
    });

    assert.equal(unknown.gitDirty, null);
    assert.equal(clean.gitDirty, false);
  });
});

describe("the bundle records the boundary as a policy and a measurement", () => {
  /**
   * A boundary that was measured and one that was merely declared are the same object until someone
   * writes down which is which. `environment.json` pairs each policy with the enforcement the adapter
   * actually achieved, because `networkPolicy: deny` in a goal is an intention and the world it ran in
   * may have been unable to honour it - which is exactly the case the browserless runs are in.
   */
  const read = (io: MemoryIo, path: string): Record<string, unknown> => {
    const raw = textAt(io, path);
    assert.ok(raw !== undefined, `${path} was not written`);
    return JSON.parse(raw) as Record<string, unknown>;
  };

  it("pairs each declared policy with its enforcement in environment.json", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    await bundle.writeEnvironment(environment);

    const record = read(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/environment.json`) as {
      readonly boundary: {
        readonly network: { readonly policy: string; readonly allow: readonly string[]; readonly enforcement: string };
        readonly filesystem_write: { readonly policy: string; readonly enforcement: string };
        readonly crossings: readonly unknown[];
      };
    };

    assert.equal(record.boundary.network.policy, "deny");
    assert.equal(record.boundary.network.enforcement, "enforced");
    assert.deepEqual(record.boundary.network.allow, []);
    // `unsupported` rather than `deny`, and that is the honest reading: no adapter in this build
    // restricts what the application writes to disk, so a goal that asked for a sandbox was not
    // granted one. Reporting it as `enforced` because the goal asked for it is the defect this
    // pairing exists to prevent.
    assert.equal(record.boundary.filesystem_write.policy, "sandbox");
    assert.equal(record.boundary.filesystem_write.enforcement, "unsupported");
    assert.deepEqual(record.boundary.crossings, []);
  });

  it("carries a crossing into environment.json with the criterion it happened in", async () => {
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    const crossed = environmentRecord(plan, null, [], true, {
      network: "enforced",
      filesystemWrite: "unsupported",
      crossings: [
        {
          boundary: "network",
          subject: "GET https://cdn.example.com/analytics.js",
          criterionId: "AC-001",
          at: "2026-01-01T00:00:01.000Z",
        },
      ],
    });
    await bundle.writeEnvironment(crossed);

    const record = read(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/environment.json`) as {
      readonly boundary: { readonly crossings: readonly Record<string, unknown>[] };
    };

    assert.equal(record.boundary.crossings.length, 1);
    const entry = record.boundary.crossings[0] ?? {};
    assert.equal(entry["subject"], "GET https://cdn.example.com/analytics.js");
    // Snake-cased like every other criterion reference in this directory, so one key means one thing.
    assert.equal(entry["criterion_id"], "AC-001");
    assert.equal(entry["boundary"], "network");
  });

  it("writes the violation itself into result.json instead of the null it used to hard-code", async () => {
    // This field was a literal. The third clause of the PASS rule - "there was no safety violation" -
    // was therefore true of every run that was ever reported, whatever the run did.
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();

    const violation = "the network boundary was crossed at 2026-01-01T00:00:01.000Z: GET https://cdn.example.com/analytics.js while observing AC-001";
    const written = outcome({ safetyViolation: violation });
    await bundle.writeResult(written);

    const result = read(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/result.json`) as {
      readonly safetyViolation: unknown;
      readonly guards: Record<string, boolean>;
    };

    assert.equal(result.safetyViolation, violation);
    assert.equal(result.guards["noSafetyViolation"], false, "the guard and the field must agree");
  });

  it("writes null rather than omitting the field when nothing was observed", async () => {
    // An absent key and a null one are different to a reader: the first says the writer forgot, the
    // second says the run looked and found nothing. Only one of those is decidable.
    const io = memoryIo();
    const bundle = bundleOn(io);
    await bundle.init();
    await bundle.writeResult(outcome());

    const result = read(io, `${VERIDIAN_DIR}/runs/${RUN_ID}/result.json`) as { readonly safetyViolation?: unknown };

    assert.equal("safetyViolation" in result, true);
    assert.equal(result.safetyViolation, null);
  });
});
