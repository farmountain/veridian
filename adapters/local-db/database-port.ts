/**
 * The storage boundary for a database world.
 *
 * A port plus a single SQLite implementation, in the same shape as `core/io.ts` and
 * `core/process.ts`. The reason is the same one both of those give: the adapter above it has to be
 * provable without the thing underneath it, and a stronger isolation - or a second engine - has
 * exactly one place to land.
 *
 * ## What was measured before any of this was written
 *
 * `node:sqlite` is the engine, and its behaviour was read off a running Node rather than assumed:
 *
 * - `StatementSync.all()` answers *every* statement. An `INSERT` returns `[]` rather than throwing,
 *   so there is no need for a "is this a query?" heuristic and none is used.
 * - `StatementSync.columns()` reports the result columns even when zero rows came back, so a result
 *   set's shape does not depend on whether it happened to contain data.
 * - `StatementSync.columns()` reports a **computed** column with `column: null` and the name in
 *   `name`: `SELECT SUM(quantity * unit_price_cents) AS total_cents` comes back as
 *   `{column: null, database: null, name: "total_cents", table: null, type: null}`. Reading `column`
 *   alone therefore loses every aggregate and every expression - which is the defect `columnLabel`
 *   below exists to fix, and it was found by running a criterion against a real SUM rather than by
 *   reasoning about the API.
 * - `new DatabaseSync(path)` **creates the file when it does not exist.** This is the fact that
 *   shapes the whole adapter: a probe that simply opened the database would bring an empty world
 *   into being and then report it healthy. Existence is checked by the caller, before opening.
 *
 * ## Errors are data, not exceptions
 *
 * A statement that will not run is an ordinary outcome - the schema under test may be wrong, or the
 * criterion's SQL may be - and it is recorded per statement so the adapter can name *which* step
 * failed and what the engine said. Only a failure to open or to read the schema leaves this port as
 * a throw, because that is a failure of the world rather than of a step inside it. The two become
 * different failure kinds in the observation, which is what keeps "the application is broken" apart
 * from "the sandbox could not be brought up".
 */

import type { DbTableReading, DbValue } from "../../core/environment/db-observation.ts";

export interface DbInspectRequest {
  /** The database file. Already resolved against the application directory by the caller. */
  readonly path: string;
  /** Run in order. A criterion's actions, ending in the query it judges. May be empty. */
  readonly statements: readonly string[];
}

export interface DbStatementOutcome {
  /** The statement as written, so a report can quote what failed without paraphrase. */
  readonly statement: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly DbValue[])[];
  /** The engine's own message, or `null` when the statement ran. */
  readonly error: string | null;
}

export interface DbInspection {
  readonly tables: readonly DbTableReading[];
  /** One outcome per statement, in the order given. Empty when nothing was asked to run. */
  readonly results: readonly DbStatementOutcome[];
}

export interface DatabasePort {
  /**
   * Open the database, read its schema, run `statements` in order, close.
   *
   * One call rather than an open/close pair because a database world has no connection to hold: the
   * world is the file, and a connection kept open across a reset would be a handle onto a file the
   * reset has already replaced.
   */
  inspect(request: DbInspectRequest): Promise<DbInspection>;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** SQLite's own table list, minus the internals it maintains for itself. */
const TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/** Double every quote, which is how an identifier is escaped inside a double-quoted identifier. */
const quoted = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/**
 * A cell as this vocabulary can carry it.
 *
 * A BLOB is the case this exists for: it has no text spelling, so writing `null` for it would be a
 * statement about the data that is not true. The refusal is returned rather than thrown because it
 * is a property of one cell, and the outcome shape already has a field for exactly that.
 */
function readValue(value: unknown): DbValue | { readonly unusable: string } {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") {
    // In range it is an integer like any other; out of range it stays text rather than silently
    // losing precision, which is the more useful of the two wrong-looking options.
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  const shape = Array.isArray(value) ? "a list" : (value as { constructor?: { name?: string } })?.constructor?.name;
  return { unusable: `${shape ?? typeof value} is not a value this vocabulary can carry` };
}

/**
 * The one SQLite implementation.
 *
 * The import is dynamic and of a *builtin*: `node:sqlite` is present in every supported runtime, so
 * this is not a lazy dependency in the sense Playwright is - it is here so the module can be loaded
 * by a test that never opens a database, and so the `ExperimentalWarning` it prints is emitted only
 * when a database world is actually used.
 */
export function sqliteDatabase(): DatabasePort {
  return {
    async inspect({ path, statements }: DbInspectRequest): Promise<DbInspection> {
      const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
        DatabaseSync: new (path: string) => SyncDatabase;
      };
      const db = new DatabaseSync(path);
      try {
        const tables = readTables(db);
        const results: DbStatementOutcome[] = [];
        for (const statement of statements) {
          results.push(readStatement(db, statement));
        }
        return { tables, results };
      } finally {
        db.close();
      }
    },
  };
}

/**
 * The slice of `node:sqlite` this port calls, declared structurally rather than imported.
 *
 * The module is experimental, and its declaration file is a moving target between Node releases: a
 * port that named the real types would fail to compile on a Node it otherwise runs on. Four members
 * are all this file ever touches, and naming them here is what turns "the engine changed shape" into
 * a compile error instead of an `undefined is not a function` in the middle of a run.
 */
interface SyncStatement {
  /** The selected columns, readable before any row - an empty result still has a shape. */
  columns(): readonly { readonly column?: unknown; readonly name?: unknown }[];
  all(): readonly unknown[];
}

interface SyncDatabase {
  prepare(sql: string): SyncStatement;
  close(): void;
}

/**
 * How a result column is named, for a criterion and for the row it is zipped against.
 *
 * `column` is `null` for a computed column and the name the operator can actually refer to is in
 * `name`: `SELECT SUM(quantity * unit_price_cents) AS total_cents` reports
 * `{column: null, name: "total_cents"}`. Measured on Node 22.18.0, and measured precisely because the
 * first version read `column` alone and filtered the `null`s out - so an aggregate's column vanished
 * from the result's shape, every row was zipped against an empty column list, and a criterion reading
 * `total_cents` was told its query "did not select a column `total_cents`; it selected none". The
 * query had selected it. That message named a cause the reporter had not observed, and it sent the
 * reader to audit an acceptance contract that was correct.
 *
 * `name` is the fallback rather than the first choice because for a plain column the two agree, and
 * `column` is the more specific of the two. Where they differ irreconcilably is a result naming one
 * column twice (`SELECT a.id, b.id ...`): `all()` keys its row objects by name, so the second value
 * overwrites the first and no positional reading can recover it. That is a shape this vocabulary
 * cannot carry, and it is recorded here rather than left to be discovered.
 */
function columnLabel(entry: { readonly column?: unknown; readonly name?: unknown }): string | null {
  if (typeof entry.column === "string" && entry.column !== "") return entry.column;
  if (typeof entry.name === "string" && entry.name !== "") return entry.name;
  return null;
}

function readStatement(db: SyncDatabase, statement: string): DbStatementOutcome {
  try {
    const prepared = db.prepare(statement);
    // `columns()` rather than the first row's keys: a result set with no rows still has a shape, and
    // a validator asking about a column of an empty result must be told the column was selected.
    const columns = prepared
      .columns()
      .map(columnLabel)
      .filter((name): name is string => name !== null);
    const raw = prepared.all() as readonly unknown[];
    const rows: DbValue[][] = [];
    const extras: string[] = [];

    for (const record of raw) {
      const cells: DbValue[] = [];
      for (const column of columns) {
        const value = readValue((record as Record<string, unknown>)[column]);
        if (value !== null && typeof value === "object") {
          extras.push(`${column} holds ${value.unusable}`);
          cells.push(null);
        } else {
          cells.push(value);
        }
      }
      rows.push(cells);
    }

    if (extras.length > 0) {
      return { statement, columns, rows: [], error: `${statement} read a cell it cannot report: ${extras.join("; ")}` };
    }
    return { statement, columns, rows, error: null };
  } catch (error) {
    return { statement, columns: [], rows: [], error: describe(error) };
  }
}

function readTables(db: SyncDatabase): DbTableReading[] {
  const names = (db.prepare(TABLES_SQL).all() as readonly { readonly name?: unknown }[])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string");

  return names.map((name) => {
    const columns = (db.prepare(`PRAGMA table_info(${quoted(name)})`).all() as readonly {
      readonly name?: unknown;
    }[])
      .map((column) => column.name)
      .filter((column): column is string => typeof column === "string");
    const counted = db.prepare(`SELECT COUNT(*) AS n FROM ${quoted(name)}`).all() as readonly {
      readonly n?: unknown;
    }[];
    const rows = counted[0]?.n;
    return { name, columns, rows: typeof rows === "number" ? rows : 0 };
  });
}
