import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BoundaryReport, EnvironmentPlan } from "../core/environment/types.ts";
import { environmentRecord, serializeEnvironment } from "../core/evidence/index.ts";
import { memoryIo } from "../core/io.ts";
import { listEliEnvDeltas } from "../core/metrics/index.ts";
import {
  EXPORT_DECISIONS,
  EXPORT_RULES,
  envDelta,
  exportEnvironment,
  ruleFor,
} from "../core/metrics/denv.ts";

/**
 * dENV: the predicate is total, and the delta answers AC-5.
 *
 * Both properties here share a failure mode that a fixture can hide, so the fixtures are built to
 * expose it rather than to pass:
 *
 *  - **A predicate is not proven by a document that lacks a key.** "The export has no `env`" is true
 *    of a predicate that refuses everything, of a serialiser that wrote nothing, and of a fixture
 *    that never had one. So every refusal is asserted beside a **positive control** that says the key
 *    was there before the export, and beside a **sibling** that says the export was not empty.
 *  - **AC-5's `empty` is not proven by an empty function.** A delta that compares nothing is empty
 *    between any two readings. What gives the empty answer meaning is the split between the world's
 *    resources and this run's own facts, so the delta is asserted empty across a **per-run** change
 *    and non-empty across a **resource** change, and the two fixtures differ in nothing else.
 */

/**
 * An app path as an operator's checkout really spells it: absolute, with the drive and the repository
 * directory in front of the app's own name. The rendering's whole job is to remove that prefix, so a
 * fixture with a relative path could not tell a rendering from a passthrough.
 */
const OPERATOR_CHECKOUT = "D:\\all_projects\\Veridian\\examples\\shopping-cart";

/** Values that exist only to be looked for in the artifact. Named so a failure says which one leaked. */
const ARG_SECRET = "--token=shh-this-is-the-command-line";
const ENV_SECRET = "Bearer shh-this-is-the-inherited-environment";

const plan: EnvironmentPlan = {
  adapter: "local-web",
  app: "shopping-cart",
  appPath: OPERATOR_CHECKOUT,
  env: { PATH: "/usr/bin", API_TOKEN: ENV_SECRET },
  dependencyInstall: null,
  start: { command: "node", args: ["serve.mjs", ARG_SECRET], readyPattern: null },
  url: "http://127.0.0.1:4173",
  api: null,
  databasePath: null,
  cluster: null,
  posix: null,
  os: null,
  cloud: null,
  container: null,
  vscode: null,
  process: null,
  data: null,
  mobile: null,
  health: { path: "/health", expectStatus: 200, timeoutMs: 20_000, intervalMs: 100, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: null, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
};

const boundary: BoundaryReport = { network: "enforced", filesystemWrite: "enforced", crossings: [] };

/** A record built through the real constructor, so the fixture cannot invent a shape the writer rejects. */
const record = (overrides: Partial<EnvironmentPlan> = {}) =>
  environmentRecord({ ...plan, ...overrides }, null, [], true, boundary);

describe("dENV - the export predicate is total over the record", () => {
  it("has a rule of its own for every key the serialiser writes, and no rule for a key it does not", () => {
    // Both directions, because the two drifts are different defects. A document key with no rule falls
    // through to the default branch, where a refusal nobody decided looks like a decision; a rule for a
    // key the document no longer holds is a decision about nothing, which reads as a covered field.
    const written = Object.keys(serializeEnvironment(record())).sort();
    const ruled = [...Object.keys(EXPORT_RULES)].sort();
    assert.deepEqual(ruled, written);
  });

  it("reaches the default branch, so a key invented after the table is refused rather than kept", () => {
    const ruling = ruleFor("a_key_invented_after_this_was_written");
    assert.equal(ruling.decision, "refused");
    assert.equal(ruling.resource, false);
    assert.match(ruling.reason, /no rule/);
  });

  it("carries only decisions its own vocabulary declares", () => {
    // The same shape `tests/boundary-roster.test.ts` holds over `BOUNDARY_ENFORCEMENTS`: a value
    // vocabulary is only one vocabulary if every member a rule uses is a member it declares.
    for (const [key, rule] of Object.entries(EXPORT_RULES)) {
      assert.ok(
        (EXPORT_DECISIONS as readonly string[]).includes(rule.decision),
        `${key} carries \`${rule.decision}\`, which is not one of ${EXPORT_DECISIONS.join(", ")}`,
      );
      assert.ok(rule.reason.length > 0, `${key} carries no reason, so a reader cannot tell why`);
    }
  });
});

describe("dENV - a refused value never reaches an artifact", () => {
  it("refuses the command line and the inherited environment, and says so", () => {
    const before = serializeEnvironment(record());

    // Step 1 of the probe: the positive control. If this half fails, the test measured a fixture that
    // never carried the keys rather than a predicate that refused them.
    assert.equal(before["command"], "node");
    assert.deepEqual(before["args"], ["serve.mjs", ARG_SECRET]);
    assert.equal((before["env"] as Record<string, string>)["API_TOKEN"], ENV_SECRET);

    // Step 2.
    const { document, refused } = exportEnvironment(record());

    // Step 3: the *values* are looked for in the artifact, not the keys. A key check passes for an
    // export that moved the secret under another name; a value search does not.
    const artifact = JSON.stringify(document);
    assert.equal(artifact.includes(ARG_SECRET), false, "the command line's argument reached the artifact");
    assert.equal(artifact.includes(ENV_SECRET), false, "the inherited environment's value reached the artifact");
    assert.equal(Object.hasOwn(document, "command"), false);
    assert.equal(Object.hasOwn(document, "args"), false);
    assert.equal(Object.hasOwn(document, "env"), false);

    // And the known-good sibling: without this half, a predicate that refuses everything passes.
    assert.equal(document["adapter"], "local-web");
    assert.equal(document["app"], "shopping-cart");
    assert.equal(document["url"], "http://127.0.0.1:4173");

    // The refusal is an observation rather than an absence, so it is recorded with a reason.
    assert.deepEqual(refused.map((entry) => entry.key).sort(), ["args", "command", "env"]);
    for (const entry of refused) assert.ok(entry.reason.length > 0);
  });

  it("keeps the declaration and drops the operator's prefix, rather than dropping the field", () => {
    const before = serializeEnvironment(record());
    assert.equal(before["app_path"], OPERATOR_CHECKOUT);

    const { document } = exportEnvironment(record());

    // `rendered` is a third answer and not a second spelling of `refused`: the key is still there and
    // the world's own name for the app is still in it.
    assert.equal(document["app_path"], "shopping-cart");
    assert.equal(JSON.stringify(document).includes("all_projects"), false);
  });
});

describe("dENV - AC-5, the delta between two readings of one subject", () => {
  it("is empty when the world came back to the same resources", () => {
    assert.deepEqual(envDelta(serializeEnvironment(record()), serializeEnvironment(record())), []);
  });

  it("is empty across a per-run difference, which is what makes the empty answer mean something", () => {
    // Two runs of one world reach READY at two instants and take however many attempts they take. A
    // delta over every key would report both, and every pair of runs would differ - so the split
    // between the world's resources and this run's own facts is not a refinement, it is the metric.
    const first = serializeEnvironment(record());
    const second = {
      ...first,
      health_report: {
        ok: true,
        message: "ready",
        attempts: 7,
        elapsedMs: 1_234,
        url: null,
        statusCode: null,
        readyPatternSatisfied: null,
      },
      transitions: [{ from: "READY", to: "EXECUTING", at: "2026-01-01T00:00:09.000Z", reason: "started" }],
    };
    assert.deepEqual(envDelta(first, second), []);
  });

  it("names the resource that did not come back, which is the probe's reading", () => {
    // The design's falsification probe for AC-5: "Blow away a reset; dENV must become non-empty and
    // name the resource." A reset that did not replay its strategy is a world that came back
    // different, so the declaration is what changes here and nothing else.
    const before = serializeEnvironment(record());
    const after = serializeEnvironment(record({ reset: { strategy: plan.reset.strategy, command: "node reset.mjs" } }));

    const differences = envDelta(before, after);
    assert.deepEqual(
      differences.map((entry) => entry.key),
      ["reset"],
    );
    assert.deepEqual(differences[0]?.before, { strategy: "restart", command: null });
    assert.deepEqual(differences[0]?.after, { strategy: "restart", command: "node reset.mjs" });
  });

  it("reports a resource that went missing, so the walk is over both sides", () => {
    // A delta computed over the intersection of the two key sets reports a world that came back with
    // one resource fewer as having come back the same. Only a union walk can see a removal.
    const before = serializeEnvironment(record());
    const withoutApp = { ...before };
    delete withoutApp["app"];

    assert.deepEqual(
      envDelta(before, withoutApp).map((entry) => entry.key),
      ["app"],
    );
  });

  it("ignores a key that no export may carry, because a refused value is not a resource", () => {
    const before = serializeEnvironment(record());
    const otherCommand = { ...before, command: "/some/other/operator/bin/node" };
    assert.deepEqual(envDelta(before, otherCommand), []);
  });
});

/**
 * The reading over a run **history**, which is where AC-5's "*all fifteen of its pairs*" is counted.
 *
 * The fixtures above prove the delta function; these prove the join over bundles, and the property
 * they hold is the one a naive reading gets wrong: **an empty delta must arrive beside a non-zero
 * denominator.** `nonEmptyPairs: 0` is the same number for a world that came back unchanged and for a
 * subject the reader could not open a single bundle of, so the pair count is asserted in the same
 * breath as the emptiness. A reading that reported only differences would pass every assertion here
 * while measuring nothing, which is the shape this repository has paid for repeatedly.
 *
 * The history is built in memory rather than read from `.veridian/`: that directory is gitignored and
 * holds no committed file, so a test reading it would pass on the machine the history was written on
 * and fail on a fresh clone - a check reporting the checkout rather than the code. The reading over
 * this repository's **own** bundles is `scripts/denv-reading.mjs`, and it calls the same function.
 */

const RESULT_PATH = (runId: string): string => `.veridian/runs/${runId}/result.json`;
const ENVIRONMENT_PATH = (runId: string): string => `.veridian/runs/${runId}/environment.json`;

interface SeededRun {
  readonly runId: string;
  readonly goalId: string;
  readonly adapter: string;
  /** `"absent"` writes no `environment.json` at all. */
  readonly environment?: "present" | "absent";
  /** `"broken"` writes one that cannot be parsed. */
  readonly document?: Record<string, unknown> | "broken";
}

const resultJson = (run: SeededRun): string =>
  JSON.stringify({
    run_id: run.runId,
    goal_id: run.goalId,
    state: "COMPLETED",
    verdict: "PASS",
    environmentValid: true,
    criteria: [{ criterion_id: "AC-001", status: "PASS", mandatory: true, missing_evidence: [] }],
    iterations: [{ iteration: 1, verdict: "PASS", criteria: [{ criterion_id: "AC-001", status: "PASS" }] }],
    // The adapter reaches `RunSnapshot` from here, not from `environment.json`.
    environment: { adapter: run.adapter, transitions: [] },
  });

const history = (runs: readonly SeededRun[]): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const run of runs) {
    files[RESULT_PATH(run.runId)] = resultJson(run);
    if (run.environment === "absent") continue;
    if (run.document === "broken") files[ENVIRONMENT_PATH(run.runId)] = "{ not json";
    else files[ENVIRONMENT_PATH(run.runId)] = JSON.stringify(run.document ?? serializeEnvironment(record()));
  }
  return files;
};

const runsOf = (goalId: string, adapter: string, count: number): readonly SeededRun[] =>
  Array.from({ length: count }, (_, index) => ({
    runId: `run-${String(index + 1).padStart(2, "0")}`,
    goalId,
    adapter,
  }));

describe("dENV over a run history - AC-5's denominator", () => {
  it("compares every pair of a subject's runs, so a clean subject still reports its denominator", async () => {
    // Six runs of one subject is AC-5's own shape: `C(6,2)` is fifteen, and the assertion is on both
    // numbers at once because either one alone is satisfied by the wrong thing. `pairsCompared: 15`
    // with a non-zero `nonEmptyPairs` would be a world that did not come back; `nonEmptyPairs: 0`
    // with `pairsCompared: 0` would be a reader that opened nothing.
    const report = await listEliEnvDeltas(memoryIo(history(runsOf("shopping-cart", "local-web", 6))), ".veridian");

    assert.equal(report.groups.length, 1);
    const [group] = report.groups;
    assert.ok(group !== undefined, "the history declares one subject, so there is one group");
    assert.equal(group.pairsCompared, 15, "six runs of one subject are fifteen pairs, not five");
    assert.equal(group.nonEmptyPairs, 0, "identical documents came back to the same resources");
    assert.deepEqual(group.movingKeys, []);
    assert.deepEqual(report.unreadableEnvironments, []);
  });

  it("groups by the subject the join computes, so two goals in one adapter are two subjects", async () => {
    const report = await listEliEnvDeltas(
      memoryIo(history([...runsOf("goal-alpha", "local-web", 2), { runId: "run-99", goalId: "goal-beta", adapter: "local-web" }])),
      ".veridian",
    );

    assert.deepEqual(
      report.groups.map((group) => group.subject).sort(),
      ["goal-alpha@local-web", "goal-beta@local-web"],
      "grouping on the adapter alone would have merged these into one subject",
    );
  });

  it("names the resource that moved, rather than only counting the pairs that moved", async () => {
    const other = serializeEnvironment(record({ reset: { strategy: "custom", command: null } }));
    const report = await listEliEnvDeltas(
      memoryIo(
        history([
          { runId: "run-01", goalId: "goal-alpha", adapter: "local-web" },
          { runId: "run-02", goalId: "goal-alpha", adapter: "local-web", document: other },
        ]),
      ),
      ".veridian",
    );

    const [group] = report.groups;
    assert.equal(group?.pairsCompared, 1);
    assert.equal(group?.nonEmptyPairs, 1);
    assert.deepEqual(group?.movingKeys, ["reset"]);
    assert.deepEqual(group?.pairs[0]?.before, "run-01");
    assert.deepEqual(group?.pairs[0]?.after, "run-02");
  });

  it("reports a run whose document cannot be read instead of treating it as clean", async () => {
    // Both halves of the trap. The broken run is **reported**, and it is **excluded from the pair
    // count** - so a subject whose runs cannot be opened reports `pairsCompared` that says so rather
    // than an empty delta that reads as agreement.
    const report = await listEliEnvDeltas(
      memoryIo(
        history([
          { runId: "run-01", goalId: "goal-alpha", adapter: "local-web" },
          { runId: "run-02", goalId: "goal-alpha", adapter: "local-web" },
          { runId: "run-03", goalId: "goal-alpha", adapter: "local-web", document: "broken" },
          { runId: "run-04", goalId: "goal-alpha", adapter: "local-web", environment: "absent" },
        ]),
      ),
      ".veridian",
    );

    assert.deepEqual(report.unreadableEnvironments, ["run-03", "run-04"]);
    const [group] = report.groups;
    assert.equal(group?.runIds.length, 2, "only the two readable runs are compared");
    assert.equal(group?.pairsCompared, 1, "and the denominator says two runs, not four");
  });

  it("yields no group at all for a history with no runs, which is the control's reading", async () => {
    // The `scripts/denv-reading.mjs` control asserts exactly this, and it is asserted here too because
    // the command's green line depends on it: zero subjects must be *no subjects*, so that the
    // script fails rather than printing a clean table over nothing.
    const report = await listEliEnvDeltas(memoryIo({}), ".veridian");
    assert.deepEqual(report.groups, []);
    assert.deepEqual(report.unreadableEnvironments, []);
  });
});
