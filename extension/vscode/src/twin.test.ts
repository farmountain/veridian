/**
 * The twin surface: the join, and the two rules that keep it a *reading*.
 *
 * `docs/phases/05-the-cockpit-twin-surface.md` states its acceptance criterion as **AC-9** of
 * `docs/DIGITAL-TWIN-PLAN.md` §4 - *a twin panel reads the ELI, and the extension gains **no**
 * validation logic* - and adds the part that decides whether the criterion is real:
 *
 * > asserted by reading the module's imports, not by reading the panel.
 *
 * That is the first group of tests below, and it is a source reading rather than a behavioural one on
 * purpose. A panel that computes a verdict and *happens* not to print it still computes a verdict;
 * a module whose import list is `node:path` and the bundle reader cannot have imported a validator,
 * whatever its body does with the numbers.
 *
 * ## The second thing this file is for
 *
 * The Cockpit may not import `core/`, so the join is re-taken in the client and a second reader of a
 * document can drift from the document. `twin.ts`'s header names that cost. These tests pay it by
 * pinning each spelling the twin depends on against **the file that owns it**:
 *
 * | The twin reads | Owned by | Pinned by |
 * |---|---|---|
 * | `result.json`'s `goal_id` | `schemas/result.schema.json` (it is `required`) | *the schema requires the field the join keys on* |
 * | `environment.adapter` | `core/metrics/metrics.ts` (the schema's `environment` is an untyped bag) | *the adapter is read the way the metrics read it* |
 * | `?@?` for a missing half, and the `@` | `core/metrics/metrics.ts`'s `subjectOf` | *the subject is the one M1 computes* |
 * | `result.json`, `environment.json` | `core/evidence/types.ts`'s `BUNDLE_FILES` | *the row files are the bundle's own names* |
 *
 * Each of those fails **by name** when the file it pins moves, which is the only kind of guard that
 * is worth having here - a bare `0 !== 1` would say a number changed and not which document did it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROW_FILES,
  declaredWorld,
  groupTwinRows,
  listTwin,
  renderTwin,
  subjectOf,
  twinRow,
  type TwinIo,
  type TwinRow,
} from "./twin.ts";

/** A file in the repository, by its path from the root. The two readers the Cockpit is not allowed. */
function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");
}

function twinSource(): string {
  return readFileSync(fileURLToPath(new URL("./twin.ts", import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------------------------
// AC-9: no validation logic
// ---------------------------------------------------------------------------------------------

test("the twin surface imports the bundle reader and a path joiner, and nothing else", () => {
  const specifiers = [...twinSource().matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

  assert.deepEqual(
    specifiers,
    ["node:path", "./bundle.ts"],
    "twin.ts's import list is how AC-9 is decided: a surface that reads the join and renders it " +
      "imports a path joiner and the bundle reader. Anything else here is the extension acquiring a " +
      "dependency on the engine - and `./cli.ts` records the three reasons it may not have one.",
  );
});

test("the twin surface cannot spell a verdict of its own", () => {
  const source = twinSource();

  // Not "does not print a verdict" - *cannot write the literal*. A module with no `"PASS"` in it is a
  // module that cannot be comparing a run's verdict against PASS, which is where a client starts
  // deciding instead of showing.
  assert.doesNotMatch(
    source,
    /["'](?:PASS|FAIL|INCONCLUSIVE)["']/,
    "twin.ts spells a verdict as a string literal, so it is not only passing through what the bundle " +
      "recorded - the verdict must come from `summariseResult` and be rendered unchanged",
  );
  assert.ok(
    source.includes("summariseResult"),
    "twin.ts no longer reads its verdict, state and iteration through `summariseResult`, so it has " +
      "either grown a second reading of `result.json` or stopped reading one at all",
  );
});

// ---------------------------------------------------------------------------------------------
// The four spellings, pinned against the files that own them
// ---------------------------------------------------------------------------------------------

test("the schema requires the field the join keys on", () => {
  const schema = JSON.parse(readRepo("schemas/result.schema.json")) as Record<string, unknown>;
  const required = schema["required"];

  assert.ok(Array.isArray(required), "result.schema.json must declare a required list");
  assert.ok(
    required.includes("goal_id"),
    "result.schema.json stopped requiring `goal_id`, so a valid bundle may omit the half of the " +
      "subject the join keys on - and every such run would silently join on `?` instead of on its goal",
  );
});

test("the adapter is read the way the metrics read it", () => {
  const metrics = readRepo("core/metrics/metrics.ts");

  // The schema's `environment` node is `{"type": ["object", "null"]}` with no properties, so it does
  // not own this spelling and there is nothing to pin against it. `metrics.ts` does own it: its
  // `parseRunSnapshot` is the reader that M1's subject is built from.
  assert.ok(
    metrics.includes('environment?.["adapter"]'),
    "core/metrics/metrics.ts no longer reads `environment.adapter`, so the spelling twin.ts depends " +
      "on is declared nowhere - and the twin would join every run onto `?@?` while reporting success",
  );
});

test("the subject is the one M1 computes", () => {
  const metrics = readRepo("core/metrics/metrics.ts");
  const spelling = /export const subjectOf = \([^)]*\): string => `([^`]*)`;/.exec(metrics);

  assert.ok(
    spelling !== null,
    "core/metrics/metrics.ts no longer declares `subjectOf` as a single template literal, so this " +
      "pin cannot see the spelling it is pinning - and it must be re-aimed rather than deleted",
  );
  assert.equal(
    spelling[1],
    '${run.goalId ?? "?"}@${run.adapter ?? "?"}',
    "the subject M1 groups on has changed, and the twin groups on its own copy of the formula - so " +
      "the panel's subjects and the metrics' subjects would disagree while both looked right",
  );
  // The copy in the client, evaluated. Two cases, because the fallback is the half that matters: a
  // run with no goal must still join, and it joins on the same `?` the metrics use.
  assert.equal(subjectOf({ ...ROW, goal: "cart", adapter: "local-web" }), "cart@local-web");
  assert.equal(subjectOf({ ...ROW, goal: null, adapter: null }), "?@?");
});

test("the row files are the bundle's own names", () => {
  const types = readRepo("core/evidence/types.ts");

  assert.ok(
    types.includes('result: "result.json"'),
    "BUNDLE_FILES.result is no longer `result.json`, and twin.ts reads a literal of that name",
  );
  assert.ok(
    types.includes('environment: "environment.json"'),
    "BUNDLE_FILES.environment is no longer `environment.json`, and twin.ts reads a literal of that name",
  );
  assert.deepEqual({ ...ROW_FILES }, { result: "result.json", environment: "environment.json" });
});

// ---------------------------------------------------------------------------------------------
// Rows and grouping
// ---------------------------------------------------------------------------------------------

const ROW: TwinRow = {
  runId: "run-1",
  goal: "cart",
  adapter: "local-web",
  world: null,
  verdict: "PASS",
  state: "COMPLETED",
  iteration: 1,
};

/** A `result.json` as the runner writes one: only the fields a row is read from. */
function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: "run-1",
    goal_id: "cart",
    verdict: "PASS",
    state: "COMPLETED",
    iteration: 1,
    criteria: [],
    environment: { adapter: "local-web" },
    ...overrides,
  };
}

test("a row carries what the bundle recorded, and invents nothing", () => {
  const row = twinRow(result(), { world: { kind: "web", name: "shopping-cart" } });

  assert.notEqual(row, null);
  assert.equal(row?.runId, "run-1");
  assert.equal(row?.goal, "cart");
  assert.equal(row?.adapter, "local-web");
  assert.deepEqual(row?.world, { kind: "web", name: "shopping-cart" });
  assert.equal(row?.verdict, "PASS");
});

test("a bundle with no readable verdict is null rather than a row with a default", () => {
  assert.equal(twinRow(result({ verdict: "MOSTLY_OK" }), {}), null);
  assert.equal(twinRow(result({ verdict: undefined }), {}), null);
  assert.equal(twinRow(null, {}), null);
  assert.equal(twinRow("not a document", {}), null);
});

test("a bundle written before the world identity existed reads as an unnamed world, not as an absent run", () => {
  const row = twinRow(result(), { adapter: "local-web" });

  assert.notEqual(row, null, "a bundle with no `world` block is still a run, and must still have a row");
  assert.equal(row?.world, null);
});

test("a world block is read by its kind, and a name is optional", () => {
  assert.deepEqual(declaredWorld({ world: { kind: "database", name: "inventory" } }), {
    kind: "database",
    name: "inventory",
  });
  assert.deepEqual(declaredWorld({ world: { kind: "posix" } }), { kind: "posix", name: null });
  assert.equal(declaredWorld({ world: { name: "nameless" } }), null, "a block with no kind is not a world");
  assert.equal(declaredWorld({}), null);
  assert.equal(declaredWorld(null), null);
});

test("two runs of one goal on one adapter join, and two goals do not", () => {
  const rows: readonly TwinRow[] = [
    { ...ROW, runId: "run-1", goal: "cart", adapter: "local-web" },
    { ...ROW, runId: "run-2", goal: "cart", adapter: "local-web" },
    { ...ROW, runId: "run-3", goal: "inventory", adapter: "local-web" },
    { ...ROW, runId: "run-4", goal: "cart", adapter: "local-db" },
  ];
  const groups = groupTwinRows(rows);

  assert.deepEqual(
    groups.map((group) => group.subject),
    ["cart@local-web", "inventory@local-web", "cart@local-db"],
    "the join is on the whole subject: grouping on the adapter alone would merge the two goals, " +
      "which is the defect `core/metrics/metrics.ts` spells out at `subjectOf`",
  );
  assert.deepEqual(
    groups[0]?.rows.map((row) => row.runId),
    ["run-1", "run-2"],
  );
});

test("runs that name no goal still join, on the same `?` the metrics use", () => {
  const groups = groupTwinRows([
    { ...ROW, runId: "run-1", goal: null, adapter: "local-web" },
    { ...ROW, runId: "run-2", goal: null, adapter: "local-web" },
  ]);

  assert.equal(groups.length, 1, "a group per run would report an unnamed goal as a difference between runs");
  assert.equal(groups[0]?.subject, "?@local-web");
  assert.equal(groups[0]?.rows.length, 2);
});

// ---------------------------------------------------------------------------------------------
// Reading a history
// ---------------------------------------------------------------------------------------------

/** An in-memory state directory. Paths are split on both separators: `join` is the platform's. */
function ioWith(
  runs: Readonly<Record<string, { readonly result?: unknown; readonly environment?: unknown }>>,
): TwinIo {
  return {
    async readJson(path: string): Promise<unknown> {
      const parts = path.split(/[\\/]/);
      const file = parts[parts.length - 1] ?? "";
      const runId = parts[parts.length - 2] ?? "";
      const run = runs[runId];
      if (run === undefined) return await Promise.resolve(null);
      const value = file === ROW_FILES.result ? run.result : run.environment;
      return await Promise.resolve(value ?? null);
    },
    async listRunIds(): Promise<readonly string[]> {
      return await Promise.resolve(Object.keys(runs).sort());
    },
    runDir: (runId) => `/state/runs/${runId}`,
  };
}

const PATHS = { stateDir: "/state", lastResult: "", lastFailure: "", runsDir: "" } as const;

test("every run on disk contributes exactly one row", async () => {
  const reading = await listTwin(
    ioWith({
      "run-1": { result: result({ run_id: "run-1" }), environment: { world: { kind: "web", name: "cart" } } },
      "run-2": { result: result({ run_id: "run-2" }), environment: { world: { kind: "web", name: "cart" } } },
      "run-3": { result: result({ run_id: "run-3", goal_id: "other" }) },
    }),
    PATHS,
  );

  const rows = reading.groups.flatMap((group) => group.rows);
  assert.deepEqual(
    rows.map((row) => row.runId).sort(),
    ["run-1", "run-2", "run-3"],
    "the join is one row per run on disk - a run that contributed no row is a run the panel is " +
      "silently not showing, which is the reading lying about its own coverage",
  );
  assert.deepEqual(reading.unreadable, []);
  assert.equal(reading.groups.length, 2);
});

test("a bundle that cannot be read is reported, not dropped", async () => {
  const reading = await listTwin(
    ioWith({
      "run-1": { result: result() },
      "run-2": { result: { run_id: "run-2" } },
      "run-3": { result: result({ run_id: "run-3" }) },
    }),
    PATHS,
  );

  assert.equal(reading.groups.flatMap((group) => group.rows).length, 2);
  assert.deepEqual(
    reading.unreadable,
    ["run-2: result.json is absent, is not JSON, or names no verdict"],
    "a bundle that exists and cannot be read must be named: three runs of which the panel shows two " +
      "is a different fact from a history of two, and only one of them is worth investigating",
  );
});

test("a history with no runs is an empty reading rather than a failure", async () => {
  const reading = await listTwin(ioWith({}), PATHS);

  assert.deepEqual(reading.groups, []);
  assert.deepEqual(reading.unreadable, []);
  assert.deepEqual(renderTwin(reading), [
    "No runs on disk. Run a validation first, then ask for the twin again.",
  ]);
});

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

test("the rendering has the rows, the counts and no verdict of its own", () => {
  const lines = renderTwin({
    groups: [
      {
        subject: "cart@local-web",
        rows: [
          { ...ROW, runId: "run-1", verdict: "FAIL", world: { kind: "web", name: "cart" } },
          { ...ROW, runId: "run-2", verdict: "PASS", world: { kind: "web", name: null } },
        ],
      },
    ],
    unreadable: [],
  });
  const text = lines.join("\n");

  assert.match(text, /^1 subject\(s\), 2 run\(s\)$/m);
  assert.match(text, /^cart@local-web {2}\(2 run\(s\)\)$/m);
  assert.match(text, /run-1 {2}FAIL {2}COMPLETED {2}iteration 1 {2}web\/cart/);
  assert.match(text, /run-2 {2}PASS {2}COMPLETED {2}iteration 1 {2}web/);
  // There is no total, no "latest" and no majority. `1 PASS, 1 FAIL` is what a group shows whether
  // one defect survived both runs or a different one broke each; the rows are the reading.
  assert.doesNotMatch(text, /latest|majority|overall|summary/i);
});

test("a run whose world the bundle did not name says so rather than showing a blank", () => {
  const lines = renderTwin({
    groups: [{ subject: "cart@local-web", rows: [{ ...ROW, world: null }] }],
    unreadable: [],
  });

  assert.match(lines.join("\n"), /iteration 1 {2}unknown world/);
});
