import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryIo } from "../core/io.ts";
import type { EliReport, EliRow } from "../core/metrics/index.ts";
import { listEliRows, parseRunSnapshot, subjectOf } from "../core/metrics/index.ts";

/**
 * The ELI join, proven without a browser and without a store.
 *
 * The join reads two files per run - `result.json` through the same reader the metrics use, and
 * `environment.json` for the world - so the properties worth asserting are the ones a
 * plausible-but-wrong implementation gets quietly wrong:
 *
 *  - **One row per run, whatever the run concluded.** A dropped row is a denominator that shrinks,
 *    which is how "how many runs of this goal" comes back smaller than the runs on disk.
 *  - **The group is the goal *and* the world.** Grouping on the adapter alone is the nearest
 *    mistake, and it is not detectable from a fixture where every adapter serves one goal: that
 *    fixture passes under both keys. The fixture here therefore contains **two goals judged by one
 *    adapter**, which is the only shape that can tell the two keys apart.
 *  - **A bundle that names no world is a row with a null world.** Not a dropped row, and not a row
 *    that invents a name - the latter being the defect the join exists downstream of, where a
 *    `sim-cloud` bundle could name its adapter and could not name its account.
 *  - **The subject is the one M1 computes.** Asserted by calling `subjectOf` on the same bundle
 *    rather than by restating the format, so a second implementation of the rule fails here.
 */

const RESULT = (runId: string): string => `.veridian/runs/${runId}/result.json`;
const ENVIRONMENT = (runId: string): string => `.veridian/runs/${runId}/environment.json`;

interface RunScript {
  readonly runId: string;
  readonly goalId: string;
  readonly adapter: string;
  readonly verdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly iterations?: number;
  /**
   * The world this run's plan declared.
   *
   * `undefined` omits the `world` key entirely, which is the shape a bundle written before
   * `worldIdentity()` existed has; a value is written as given; `null` is written as an explicit
   * "declared none". All three have to join as a null world, and they arrive by three different
   * routes.
   */
  readonly world?: unknown;
  /** `"absent"` writes no `environment.json` at all, which is a run that never recorded a world. */
  readonly environment?: "present" | "absent";
}

/** A `result.json`, shaped the way `serializeResult` writes it. */
const resultJson = (script: RunScript): string =>
  JSON.stringify({
    run_id: script.runId,
    goal_id: script.goalId,
    state: script.verdict === "PASS" ? "COMPLETED" : "FAILED",
    verdict: script.verdict ?? "FAIL",
    environmentValid: true,
    criteria: [{ criterion_id: "AC-001", status: "PASS", mandatory: true, missing_evidence: [] }],
    iterations: Array.from({ length: script.iterations ?? 1 }, (_, index) => ({
      iteration: index + 1,
      verdict: script.verdict ?? "FAIL",
      criteria: [{ criterion_id: "AC-001", status: "PASS" }],
    })),
    // `adapter` reaches `RunSnapshot` from here, not from `environment.json` - the two files record
    // it separately and this is the half the metrics read.
    environment: { adapter: script.adapter, transitions: [] },
  });

/** An `environment.json`, shaped the way `serializeEnvironment` writes it. */
const environmentJson = (script: RunScript): string =>
  JSON.stringify({
    adapter: script.adapter,
    app: "app",
    appPath: "/app",
    url: null,
    databasePath: null,
    ...(script.world === undefined ? {} : { world: script.world }),
  });

const bundle = (script: RunScript): Record<string, string> => {
  const files: Record<string, string> = { [RESULT(script.runId)]: resultJson(script) };
  if (script.environment !== "absent") files[ENVIRONMENT(script.runId)] = environmentJson(script);
  return files;
};

const seed = (scripts: readonly RunScript[]): Record<string, string> =>
  Object.assign({}, ...scripts.map(bundle));

const row = (report: EliReport, runId: string): EliRow => {
  const found = report.rows.find((candidate) => candidate.runId === runId);
  assert.ok(found !== undefined, `the join must carry a row for ${runId}`);
  return found;
};

/**
 * Five goals over three adapters, and **two of the goals share an adapter**.
 *
 * That repetition is the whole fixture. Without it, "group by goal and world" and "group by world"
 * produce the same partition and every assertion below holds either way, which is the trap
 * `docs/INSTRUMENT-AND-PROMPT-PLAN.md` S3A records: a comparison test whose population had one
 * signature cannot see a missing comparison.
 */
const HISTORY: readonly RunScript[] = [
  { runId: "run-01", goalId: "goal-alpha", adapter: "local-web", verdict: "FAIL", iterations: 2, world: { kind: "web", name: "http://127.0.0.1:4173" } },
  { runId: "run-02", goalId: "goal-alpha", adapter: "local-web", verdict: "PASS", world: { kind: "web", name: "http://127.0.0.1:4173" } },
  { runId: "run-03", goalId: "goal-beta", adapter: "local-db", verdict: "PASS", world: { kind: "database", name: "cart.db" } },
  { runId: "run-04", goalId: "goal-gamma", adapter: "local-web", verdict: "FAIL", world: { kind: "web", name: "http://127.0.0.1:5173" } },
  { runId: "run-05", goalId: "goal-delta", adapter: "sim-cloud", verdict: "PASS", world: { kind: "cloud", name: "acct-cart" } },
  { runId: "run-06", goalId: "goal-epsilon", adapter: "local-web", verdict: "FAIL" },
];

describe("the join answers one row per run, and refuses to lose one", () => {
  it("returns one row per run, keyed by run id, over a history with several goals and adapters", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");

    assert.deepEqual(
      report.rows.map((entry) => entry.runId),
      ["run-01", "run-02", "run-03", "run-04", "run-05", "run-06"],
      "every run is a row, in the run-name order the history was built in",
    );
    assert.equal(new Set(report.rows.map((entry) => entry.runId)).size, report.rows.length, "and no run is a row twice");
    assert.deepEqual(report.unreadable, [], "nothing here is unreadable");
  });

  it("carries the goal, the adapter, the verdict, the state and the iteration count off the bundle", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");
    const alpha = row(report, "run-01");

    assert.equal(alpha.goalId, "goal-alpha");
    assert.equal(alpha.adapter, "local-web");
    assert.equal(alpha.verdict, "FAIL");
    assert.equal(alpha.state, "FAILED");
    assert.equal(alpha.iterationCount, 2, "the loop went round twice, and that is a count rather than the trips");
  });

  it("reports a bundle whose result cannot be read instead of joining it", async () => {
    const io = memoryIo({
      ...seed(HISTORY),
      [RESULT("run-07")]: "{ this is not json",
    });
    const report = await listEliRows(io, ".veridian");

    assert.equal(report.rows.length, 6, "the unreadable run is not a row");
    assert.equal(report.unreadable.length, 1);
    assert.match(report.unreadable[0] ?? "", /run-07/);
  });
});

describe("the group is the goal in its world, not the world alone", () => {
  it("puts two runs of one goal against one adapter in a single group", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");
    const alpha = report.groups.find((group) => group.subject === "goal-alpha@local-web");

    assert.ok(alpha !== undefined, "the two runs of goal-alpha are one group");
    assert.deepEqual(
      alpha.rows.map((entry) => entry.runId),
      ["run-01", "run-02"],
    );
  });

  it("keeps two different goals apart even when one adapter judged both", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");

    // Three goals were judged by `local-web`, so a join keyed on the adapter would produce *one*
    // `local-web` group here. Asserting the count is what makes that mistake fail: the rows would
    // still be present either way.
    const browserless = report.groups.filter((group) => group.subject.endsWith("@local-web"));
    assert.equal(browserless.length, 3, "goal-alpha, goal-gamma and goal-epsilon are three groups, not one");
    for (const group of browserless) {
      assert.equal(
        new Set(group.rows.map((entry) => entry.goalId)).size,
        1,
        `the group ${group.subject} holds one goal, not several`,
      );
    }
  });

  it("counts one group per goal over a history where no goal spans two adapters", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");

    const goals = new Set(HISTORY.map((script) => script.goalId));
    assert.equal(goals.size, 5, "the fixture holds five goals");
    assert.equal(report.groups.length, goals.size, "and the join answers five groups, because it is keyed on the goal");
  });

  it("groups by the subject the metrics group by, rather than by a second spelling of it", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");
    const parsed = parseRunSnapshot(JSON.parse(resultJson(HISTORY[0] as RunScript)));

    assert.ok(parsed !== null, "the fixture parses as a run snapshot");
    assert.equal(row(report, "run-01").subject, subjectOf(parsed), "the join and M1 agree because they call one function");
    assert.equal(row(report, "run-01").subject, "goal-alpha@local-web", "and the string is the goal in its adapter");
  });
});

describe("a run that does not name its world is a row with no world", () => {
  it("labels the world from the record's kind and name, which is not the adapter", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");
    const cloud = row(report, "run-05");

    assert.equal(cloud.world, "cloud:acct-cart", "the account is named, not only the provider");
    assert.equal(cloud.adapter, "sim-cloud", "and the adapter is recorded beside it under its own name");
    assert.notEqual(cloud.world, cloud.adapter, "which are two different questions");
  });

  it("answers a null world for a bundle written before the identity field existed", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");
    const legacy = row(report, "run-06");

    assert.equal(legacy.world, null, "not declared is a reading, and it is not the string unknown");
    assert.equal(legacy.adapter, "local-web", "the adapter is still readable, and it is not a name for the world");
    assert.equal(legacy.subject, "goal-epsilon@local-web", "so the run still joins - it is not lost for want of a world");
  });

  it("answers a null world when the run recorded no environment at all", async () => {
    const io = memoryIo(seed([{ runId: "run-09", goalId: "goal-zeta", adapter: "local-web", environment: "absent" }]));
    const report = await listEliRows(io, ".veridian");

    assert.equal(report.rows.length, 1, "the run is still a row");
    assert.equal(row(report, "run-09").world, null);
  });

  it("answers a null world for an environment record that has no world key", async () => {
    const io = memoryIo(seed([{ runId: "run-10", goalId: "goal-eta", adapter: "local-web" }]));
    const report = await listEliRows(io, ".veridian");

    assert.equal(row(report, "run-10").world, null);
  });

  it("does not invent a group for runs that name no world", async () => {
    const report = await listEliRows(memoryIo(seed(HISTORY)), ".veridian");

    assert.deepEqual(
      report.groups.map((group) => group.subject).sort(),
      ["goal-alpha@local-web", "goal-beta@local-db", "goal-delta@sim-cloud", "goal-epsilon@local-web", "goal-gamma@local-web"],
      "the absent world is not a subject, so it neither appears nor merges with a real one",
    );
  });
});

describe("the join answers an empty history with an empty ledger", () => {
  it("returns no rows and no groups when nothing has ever run", async () => {
    const report = await listEliRows(memoryIo(), ".veridian");

    assert.deepEqual(report.rows, []);
    assert.deepEqual(report.groups, []);
    assert.deepEqual(report.unreadable, []);
  });
});
