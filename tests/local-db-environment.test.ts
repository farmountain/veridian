import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sqliteDatabase } from "../adapters/local-db/database-port.ts";
import type { DatabasePort } from "../adapters/local-db/database-port.ts";
import { DB_ENGINE, LocalDbEnvironment } from "../adapters/local-db/local-db-environment.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { DB_OBSERVATION_KIND, isDbObservationData } from "../core/environment/db-observation.ts";
import { EnvironmentError } from "../core/failure.ts";
import { memoryIo } from "../core/io.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { fixedClock, recordingLogger, silentLogger } from "./helpers/clock.ts";

/**
 * The database world, at the two layers it is built from.
 *
 * The storage port is exercised against the **real** `node:sqlite` and a real file, because the facts
 * worth holding here are facts about that engine - what it reports for a computed column, what it
 * does with a NULL, whether opening a path that does not exist creates one. None of those can be
 * asserted about a fake, and one of them was already the cause of a false statement to an operator.
 *
 * The adapter is exercised against a **fake** port, which is what the port exists for: whether a
 * world refuses to be created without a `databasePath`, whether a probe answers honestly, and whether
 * a refusal survives a reset are questions about this adapter rather than about SQLite.
 */

// ---- the storage port, against the real engine ---------------------------------------------------------

interface Seeded {
  readonly dir: string;
  readonly path: string;
  dispose(): Promise<void>;
}

/** A database built with the same SQL the example's build script uses, so the shape is the real one. */
async function seed(): Promise<Seeded> {
  const dir = await mkdtemp(join(tmpdir(), "veridian-db-"));
  const path = join(dir, "data.db");
  const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      close(): void;
    };
  };
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE products (
        sku TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity_on_hand INTEGER NOT NULL,
        reorder_level INTEGER NOT NULL
      );
      CREATE TABLE order_lines (
        id INTEGER PRIMARY KEY,
        sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL
      );
      INSERT INTO products VALUES ('WIDGET', 'Widget', 1000, 30, 10);
      INSERT INTO products VALUES ('GADGET', 'Gadget', 2500, 4, 10);
      INSERT INTO products VALUES ('DOODAD', 'Doodad', 500, 8, 8);
      INSERT INTO order_lines (sku, quantity, unit_price_cents) VALUES ('WIDGET', 2, 1000);
      INSERT INTO order_lines (sku, quantity, unit_price_cents) VALUES ('GADGET', 3, 2500);
      INSERT INTO order_lines (sku, quantity, unit_price_cents) VALUES ('DOODAD', 6, 500);
      CREATE TABLE scratch (payload BLOB, note TEXT);
      INSERT INTO scratch VALUES (x'deadbeef', NULL);
    `);
  } finally {
    db.close();
  }
  return { dir, path, dispose: async () => await rm(dir, { recursive: true, force: true }) };
}

describe("the storage port reads what the engine actually reports", () => {
  it("names a computed column by the alias its result carries", async () => {
    // The regression this test exists for. `columns()` reports a *computed* column as
    // `{column: null, name: "total_cents"}`, so a port that read `column` alone and filtered the
    // nulls out lost every aggregate - and a criterion reading `total_cents` was then told its query
    // "did not select a column `total_cents`; it selected none". The query had selected it. The
    // message named a cause the reporter had not observed, and it sent the reader to audit an
    // acceptance contract that was correct.
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT SUM(quantity * unit_price_cents) AS total_cents FROM order_lines"],
      });

      const outcome = inspection.results[0];
      assert.ok(outcome !== undefined);
      assert.equal(outcome.error, null, "the statement must run for this test to mean anything");
      assert.deepEqual(outcome.columns, ["total_cents"], "an aggregate's column vanished from the result");
      assert.deepEqual(outcome.rows, [[12500]], "the aggregate's value must be read, not dropped");
    } finally {
      await world.dispose();
    }
  });

  it("reports a plain column by name, and a row in the query's own column order", async () => {
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT quantity_on_hand, sku FROM products WHERE sku = 'WIDGET'"],
      });

      const outcome = inspection.results[0];
      assert.ok(outcome !== undefined);
      assert.deepEqual(outcome.columns, ["quantity_on_hand", "sku"]);
      assert.deepEqual(outcome.rows, [[30, "WIDGET"]]);
    } finally {
      await world.dispose();
    }
  });

  it("reads a SQL NULL as null rather than as an unreadable cell", async () => {
    // `typeof null === "object"`, so a port that detected a refusal with a `typeof` check would read
    // every NULL as "a cell this vocabulary cannot carry" - and a criterion asserting `equals: null`
    // would fail on a database that was exactly right. NULL is a fact the database reported.
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT note FROM scratch"],
      });

      const outcome = inspection.results[0];
      assert.ok(outcome !== undefined);
      assert.equal(outcome.error, null, `a NULL must not be an error; got ${String(outcome.error)}`);
      assert.deepEqual(outcome.rows, [[null]]);
    } finally {
      await world.dispose();
    }
  });

  it("refuses a BLOB by naming the column, instead of writing a null it did not read", async () => {
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT payload FROM scratch"],
      });

      const outcome = inspection.results[0];
      assert.ok(outcome !== undefined);
      assert.ok(outcome.error !== null, "a BLOB has no text spelling, so it is a refusal rather than a value");
      assert.match(outcome.error, /payload/);
      assert.match(outcome.error, /is not a value this vocabulary can carry/);
      assert.deepEqual(outcome.rows, [], "a refused reading must not also look like an empty result");
    } finally {
      await world.dispose();
    }
  });

  it("keeps a shape for a result with no rows", async () => {
    // A validator asking about a column of an empty result has to be told the column was selected.
    // "No rows" and "no such column" are different answers and lead to different repairs.
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT sku, shortfall FROM (SELECT sku, 0 AS shortfall FROM products) WHERE 0"],
      });

      const outcome = inspection.results[0];
      assert.ok(outcome !== undefined);
      assert.equal(outcome.error, null);
      assert.deepEqual(outcome.columns, ["sku", "shortfall"]);
      assert.deepEqual(outcome.rows, []);
    } finally {
      await world.dispose();
    }
  });

  it("records a broken statement as that statement's error, and still runs the rest", async () => {
    // Per statement, in order: a criterion's action sequence has to be able to say *which* step the
    // engine refused, and one bad statement must not hide the outcome of the others.
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({
        path: world.path,
        statements: ["SELECT nope FROM products", "SELECT COUNT(*) AS n FROM products"],
      });

      assert.equal(inspection.results.length, 2);
      assert.ok(inspection.results[0]?.error !== null, "the bad statement must carry the engine's message");
      assert.match(inspection.results[0]?.error ?? "", /nope/);
      assert.equal(inspection.results[1]?.error, null, "the next statement must still have run");
      assert.deepEqual(inspection.results[1]?.rows, [[3]]);
    } finally {
      await world.dispose();
    }
  });

  it("describes every user table, in name order, with its columns and row count", async () => {
    const world = await seed();
    try {
      const inspection = await sqliteDatabase().inspect({ path: world.path, statements: [] });

      assert.deepEqual(
        inspection.tables.map((table) => table.name),
        ["order_lines", "products", "scratch"],
        "the table list must be stable and must exclude SQLite's own internals",
      );
      const products = inspection.tables.find((table) => table.name === "products");
      assert.deepEqual(products?.columns, [
        "sku",
        "name",
        "unit_price_cents",
        "quantity_on_hand",
        "reorder_level",
      ]);
      assert.equal(products?.rows, 3, "the row count is read separately, so an empty table is visible");
      assert.deepEqual(inspection.results, [], "no statements were asked for, so none may be reported");
    } finally {
      await world.dispose();
    }
  });

  it("creates the database when the path does not exist, which is why the caller checks first", async () => {
    // Measured rather than assumed, and recorded here because the whole adapter is shaped by it: a
    // probe that opened the database to say hello would bring an empty world into being and then
    // report it healthy. The port's behaviour is the fact; the checks in `LocalDbEnvironment` are the
    // consequence, and the test below holds that half.
    const world = await seed();
    try {
      const missing = join(world.dir, "not-built-yet.db");
      const inspection = await sqliteDatabase().inspect({ path: missing, statements: ["SELECT 1 AS one"] });

      assert.deepEqual(inspection.tables, [], "a database that was just created has no user tables");
      assert.deepEqual(inspection.results[0]?.rows, [[1]]);
      assert.ok(
        (await sqliteDatabase().inspect({ path: missing, statements: [] })).tables.length === 0,
        "the second call must be reading a file that now exists",
      );
    } finally {
      await world.dispose();
    }
  });
});

// ---- the adapter, against a fake port ------------------------------------------------------------------

const plan = (overrides: Partial<EnvironmentPlan> = {}): EnvironmentPlan => ({
  adapter: "local-db",
  app: "app",
  appPath: "/virtual/app",
  env: {},
  dependencyInstall: null,
  start: { command: "node", args: ["build.mjs", "data.db"], readyPattern: "ready:" },
  url: null,
  databasePath: "data.db",
  cluster: null,
  posix: null,
  os: null,
  cloud: null,
  health: { path: null, expectStatus: null, timeoutMs: 5_000, intervalMs: 10, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: false, viewport: { width: 1280, height: 720 }, locale: null, timezoneId: null },
  boundary: { network: "deny", allow: [], filesystemWrite: "sandbox" },
  ...overrides,
});

const request = (overrides: Partial<ObservationRequest> = {}): ObservationRequest => ({
  criterionId: "AC-001",
  runId: "run-1",
  steps: [{ sql: "SELECT 1 AS one" }],
  targets: ["one"],
  evidence: [],
  ...overrides,
});

interface FakePort {
  readonly port: DatabasePort;
  readonly calls: { readonly path: string; readonly statements: readonly string[] }[];
}

function fakePort(answer?: (path: string) => Promise<unknown>): FakePort {
  const calls: { readonly path: string; readonly statements: readonly string[] }[] = [];
  return {
    calls,
    port: {
      async inspect({ path, statements }) {
        calls.push({ path, statements });
        if (answer !== undefined) await answer(path);
        return { tables: [{ name: "reorder_items", columns: ["sku", "shortfall"], rows: 1 }], results: [] };
      },
    },
  };
}

function fakeProcesses(result: Partial<ProcessResult> = {}): ProcessRunner {
  const settled: ProcessResult = {
    code: 0,
    signal: null,
    stdout: "inventory-db ready: 3 products, 1 to reorder\n",
    stderr: "",
    timedOut: false,
    ...result,
  };
  return {
    run(request: ProcessRequest) {
      return {
        pid: 1,
        exited: Promise.resolve(settled),
        output: () => settled.stdout,
        error: () => settled.stderr,
        write: () => undefined,
        waitForPattern: async () => true,
        stop: async () => undefined,
      };
    },
  };
}

function harness(
  environment: EnvironmentPlan,
  options: { readonly port?: DatabasePort; readonly files?: Readonly<Record<string, string>> } = {},
): { readonly subject: LocalDbEnvironment; readonly port: FakePort; readonly io: ReturnType<typeof memoryIo> } {
  const port = fakePort();
  const io = memoryIo({ "app/build.mjs": "// the build\n", ...options.files });
  const subject = new LocalDbEnvironment(environment, {
    io,
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
    logger: silentLogger,
    processes: fakeProcesses(),
    stateDir: ".veridian",
    database: options.port ?? port.port,
  });
  return { subject, port, io };
}

/**
 * A world that has been created *and* started.
 *
 * `observe` refuses before `start`, and it is right to: the build is what brings the world into
 * existence, so a criterion judged before it would be judging a file that another run left behind.
 * Starting here also runs the build through the fake process runner, which is the half of `start`
 * that checks the command left a database where the plan said it would.
 */
async function ready(
  environment: EnvironmentPlan,
  options: { readonly port?: DatabasePort; readonly files?: Readonly<Record<string, string>> } = {},
): Promise<ReturnType<typeof harness> & { readonly id: string }> {
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

describe("the local-db environment refuses a document it cannot drive", () => {
  it("names the missing databasePath rather than timing out later", async () => {
    const { subject } = harness(plan({ databasePath: null }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /databasePath/),
    );
  });

  it("refuses to judge a database it did not build", async () => {
    // A database file left over from an earlier run is not the world the contract describes, and a
    // world with no build command cannot be reset into a fresh one - so this is a definition problem,
    // reported before anything runs.
    const { subject } = harness(plan({ start: { command: "", args: [], readyPattern: null } }));
    await assert.rejects(() => subject.create(), (error: unknown) =>
      assertEnvironmentError(error, /start\.command/),
    );
  });
});

describe("readiness is a verdict this world reached, not a status code it lacks", () => {
  it("answers ok when the file exists and the engine opens it", async () => {
    const { subject, port, id } = await ready(plan(), { files: { "app/data.db": "" } });
    const probe = await subject.probe(id);

    assert.equal(probe.ok, true);
    assert.equal(probe.statusCode, null, "a world with no HTTP must not invent a 200");
    assert.equal(probe.message, null);
    assert.equal(port.calls.length, 1);
    assert.deepEqual(port.calls[0]?.statements, ["SELECT 1"]);
  });

  it("says there is no file, naming the path it checked", async () => {
    // Created but not started, and deliberately: the probe is the method that must not invent a
    // world, and the build is what would have. A probe that opened the database to say hello would
    // create the very file it is asking about - which is why `sqliteDatabase()` is documented as
    // creating a missing path, and why `probe` checks before it opens.
    const { subject } = harness(plan());
    const { id } = await subject.create();
    const probe = await subject.probe(id);

    assert.equal(probe.ok, false);
    assert.equal(probe.statusCode, null);
    assert.match(probe.message ?? "", /no database file at .*data\.db/);
  });

  it("refuses to start a world whose build left no database behind", async () => {
    // The other half of the same rule: a build command that *exits 0* and writes nothing has not
    // built the world. A run that took the exit code as the answer would go on to judge criteria
    // against whatever an earlier run happened to leave at that path - and then it would have to
    // reset into the same emptiness.
    const { subject } = harness(plan());
    const { id } = await subject.create();
    await assert.rejects(
      () => subject.start(id),
      (error: unknown) => assertEnvironmentError(error, /exited successfully and left no database/),
    );
  });

  it("carries the engine's own message when the file is there and unreadable", async () => {
    const { subject } = harness(plan(), { files: { "app/data.db": "" } });
    const port: DatabasePort = {
      async inspect() {
        throw new Error("file is not a database");
      },
    };
    const broken = new LocalDbEnvironment(plan(), {
      io: memoryIo({ "app/data.db": "" }),
      clock: fixedClock(),
      logger: silentLogger,
      processes: fakeProcesses(),
      stateDir: ".veridian",
      database: port,
    });
    const { id } = await broken.create();
    await broken.start(id);
    const probe = await broken.probe(id);

    assert.equal(probe.ok, false);
    assert.match(probe.message ?? "", /file is not a database/);
    assert.equal(subject.kind, "local-db", "the healthy subject must be unrelated to the broken one");
  });
});

describe("a step this world cannot perform is named, not skipped", () => {
  it("refuses a browser step rather than judging a criterion it never acted on", async () => {
    const { subject, id } = await ready(plan(), { files: { "app/data.db": "" } });
    const observation = await subject.execute(id, request({ steps: [{ click: "#buy" }] }));

    assert.equal(observation.data, null, "no reading may be produced for a step that could not run");
    assert.equal(observation.error?.kind, "VALIDATOR_ERROR");
    assert.match(observation.error?.message ?? "", /performs `sql` steps/);
    assert.match(observation.error?.message ?? "", /`click`/);
  });

  it("returns the reading with no query when the criterion ran no statement", async () => {
    // `null` and "a query that returned nothing" are different facts: the first means the criterion
    // never asked a question, the second means it asked one and got an empty answer. Collapsing them
    // would let a missing step read as a passing count of zero.
    const { subject, id } = await ready(plan(), { files: { "app/data.db": "" } });
    const observation = await subject.observe(id, request({ steps: [] }));

    assert.equal(observation.error, null, `observe must succeed; got ${String(observation.error?.message)}`);
    assert.equal(observation.kind, DB_OBSERVATION_KIND);
    assert.ok(isDbObservationData(observation.data));
    assert.equal(observation.data.query, null);
    assert.equal(observation.data.engine, DB_ENGINE);
    assert.ok(observation.data.database.endsWith("app/data.db"), observation.data.database);
  });
});

describe("a boundary this adapter cannot hold is stated as unheld", () => {
  it("reports both policies unsupported rather than claiming an enforcement it has no mechanism for", async () => {
    const { subject } = await ready(plan(), { files: { "app/data.db": "" } });
    const report = subject.boundaries();

    assert.equal(report.network, "unsupported");
    assert.equal(report.filesystemWrite, "unsupported", "there is no sandbox here to confine a write in");
    assert.deepEqual(report.crossings, []);
  });

  it("refuses an ATTACH, records the crossing, and does not clear it on reset", async () => {
    // A reset restores the world; it does not restore the record. An iteration that reached outside
    // the boundary must not be followed by a clean one that reports PASS, with the evidence of the
    // violation destroyed by the very act of repairing it.
    const { subject, port, id } = await ready(plan(), { files: { "app/data.db": "" } });

    const escaped = await subject.execute(
      id,
      request({ steps: [{ sql: "ATTACH DATABASE 'C:/elsewhere.db' AS outside" }] }),
    );

    assert.equal(escaped.error?.kind, "SECURITY_VIOLATION");
    assert.match(escaped.error?.message ?? "", /filesystemWrite: sandbox/);
    assert.deepEqual(port.calls, [], "a refused statement must never reach the engine");
    assert.equal(subject.boundaries().crossings.length, 1);
    assert.equal(subject.boundaries().crossings[0]?.criterionId, "AC-001");
    assert.equal(subject.boundaries().crossings[0]?.boundary, "filesystemWrite");

    await subject.reset(id);
    assert.equal(
      subject.boundaries().crossings.length,
      1,
      "the reset cleared the crossing, so a repaired world would report the violation had not happened",
    );
  });

  it("passes a leading-keyword check is not fooled by whitespace or case", async () => {
    const { subject, port, id } = await ready(plan(), { files: { "app/data.db": "" } });

    const escaped = await subject.execute(id, request({ steps: [{ sql: "\n  aTtAcH DATABASE 'x.db' AS x" }] }));
    assert.equal(escaped.error?.kind, "SECURITY_VIOLATION");
    assert.deepEqual(port.calls, []);
  });
});

describe("the evidence a database world can produce is the reading itself", () => {
  it("writes the observation as a json artifact, and no screenshot it cannot take", async () => {
    const { subject, io, id } = await ready(plan(), { files: { "app/data.db": "" } });
    const observation = await subject.observe(id, request({ steps: [] }));

    const artifact = observation.artifacts.find((entry) => entry.path.endsWith("AC-001.observation.json"));
    assert.ok(artifact !== undefined, `no observation artifact was written: ${JSON.stringify(observation.artifacts)}`);
    assert.equal(artifact.kind, "json");
    assert.equal(artifact.criterionId, "AC-001");
    assert.ok(artifact.bytes !== null && artifact.bytes !== undefined && artifact.bytes > 0);

    const written = await io.readTextFile(`.veridian/runs/run-1/${artifact.path}`);
    assert.ok(written !== null, "the artifact is in the ledger but not on disk");
    assert.ok(isDbObservationData(JSON.parse(written)), "the artifact must be a readable database document");
  });

  it("records the engine, because a verdict from a simulated world is a claim about that world", async () => {
    const { subject, io, id } = await ready(plan(), { files: { "app/data.db": "" } });
    await subject.observe(id, request({ steps: [] }));

    const written = await io.readTextFile(".veridian/runs/run-1/artifacts/AC-001.observation.json");
    const data: unknown = JSON.parse(written ?? "null");
    assert.ok(isDbObservationData(data));
    assert.equal(data.engine, "sqlite", "the substituted engine must be recorded in every reading");
    assert.equal(data.tables[0]?.name, "reorder_items");
  });

  it("reports the evidence it was not asked for as missing rather than inventing an artifact", async () => {
    const logger = recordingLogger();
    const io = memoryIo({ "app/data.db": "" });
    const subject = new LocalDbEnvironment(plan(), {
      io,
      clock: fixedClock(),
      logger,
      processes: fakeProcesses(),
      stateDir: ".veridian",
      database: fakePort().port,
    });
    const { id } = await subject.create();
    await subject.start(id);
    const observation = await subject.observe(id, request({ steps: [], evidence: ["screenshot"] }));

    assert.deepEqual(
      observation.artifacts.map((entry) => entry.kind),
      ["json"],
      "a screenshot cannot be taken of a database, so none may be recorded as one",
    );
    assert.equal(logger.entries.some((entry) => entry.level === "warn"), true, "the gap must be recorded");
  });
});
