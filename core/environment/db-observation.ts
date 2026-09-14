/**
 * The vocabulary a database adapter and a database validator share.
 *
 * It lives here, beside `web-observation.ts`, for exactly the reason that file gives: `validators/*`
 * may not import `adapters/*`, so the document a validator reads has to be declared in a layer
 * neither of them owns. A validator that read the adapter's own types would be untestable without a
 * database installed and would have to be rewritten the day the storage engine changed.
 *
 * ## What this file deliberately does not contain
 *
 * No SQL, no engine, no connection. It is a *reading*: what the database looked like when the world
 * looked at it. Which engine produced it and how the file was opened are the adapter's business, and
 * a reader of a bundle a year later must be able to judge it without either.
 */

/** Adapter-defined observation kind. Validators declare the kind they understand. */
export const DB_OBSERVATION_KIND = "db.database";

/**
 * What a SQL engine can hand back here.
 *
 * `null` is SQL NULL - a fact the database reported, not a gap in the reading. The distinction
 * matters because a validator that cannot tell "the column holds NULL" from "the column was never
 * read" would have to guess, and guessing is the one thing this product exists to prevent.
 */
export type DbValue = string | number | null;

/** One table, named and described. Enough to answer "does it exist, and does it have the column?". */
export interface DbTableReading {
  readonly name: string;
  readonly columns: readonly string[];
  /** Row count at the moment of reading. Recorded so a schema question can be told from an empty one. */
  readonly rows: number;
}

/**
 * The result of the criterion's own query.
 *
 * `statement` is recorded because a reader has to be able to see *what* produced these numbers. A
 * result set with no statement beside it is an assertion nobody can audit - the same reason the
 * bundle keeps the acceptance contract next to the run.
 */
export interface DbQueryReading {
  readonly statement: string;
  readonly columns: readonly string[];
  /** Rows as arrays, in the query's own column order, so a reading is not a set of mutable keys. */
  readonly rows: readonly (readonly DbValue[])[];
}

export interface DbObservationData {
  /**
   * The engine that answered, recorded in every reading.
   *
   * A verdict from a simulated world is a claim about *that* world, and this field is what makes the
   * claim readable a year later. An application written for PostgreSQL and judged against SQLite has
   * been judged - really, on real data - and the two engines do not accept exactly the same SQL, so a
   * reader who cannot see which one answered cannot tell how far the verdict reaches.
   */
  readonly engine: string;
  /**
   * The database file this world is, as resolved at construction.
   *
   * Recorded rather than left implicit: a bundle whose evidence came from a database it does not name
   * cannot be reproduced, and the first question asked of any database result is *which* database.
   */
  readonly database: string;
  /** Every user table in the database, in name order. */
  readonly tables: readonly DbTableReading[];
  /**
   * The criterion's query and its result, or `null` when the criterion ran no `sql` step.
   *
   * `null` and "a query that returned nothing" are different facts and are kept apart: the first
   * means the criterion never asked a question, the second means it asked one and got an empty
   * answer. Collapsing them would let a missing step read as a passing count of zero.
   */
  readonly query: DbQueryReading | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isRow = (value: unknown): value is (string | number | null)[] =>
  Array.isArray(value) &&
  value.every((cell) => cell === null || typeof cell === "string" || typeof cell === "number");

const isTable = (value: unknown): value is DbTableReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  isStringArray(value["columns"]) &&
  typeof value["rows"] === "number";

const isQuery = (value: unknown): value is DbQueryReading =>
  isRecord(value) &&
  typeof value["statement"] === "string" &&
  isStringArray(value["columns"]) &&
  Array.isArray(value["rows"]) &&
  value["rows"].every(isRow);

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a database document", and the answer is what decides between a
 * validator judging a world and a validator reporting that the world arrived unreadable. Those are
 * different verdicts with different repairs, so the question has to be asked structurally rather
 * than assumed from the observation's `kind`.
 */
export function isDbObservationData(value: unknown): value is DbObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["engine"] !== "string") return false;
  if (typeof value["database"] !== "string") return false;
  if (!Array.isArray(value["tables"]) || !value["tables"].every(isTable)) return false;
  return value["query"] === null || isQuery(value["query"]);
}

/** The named table, or `null` when the database does not have one. Absence is an ordinary answer. */
export function tableOf(data: DbObservationData, name: string): DbTableReading | null {
  return data.tables.find((table) => table.name === name) ?? null;
}

/**
 * The index of a column in a result set, or `null` when the query did not select it.
 *
 * An index rather than the value because the *reader* has to name the column that was missing, and
 * that spelling only exists here. Returning `null` rather than `-1` keeps "not selected" out of the
 * arithmetic entirely.
 */
export function columnIndexOf(query: DbQueryReading, name: string): number | null {
  const index = query.columns.indexOf(name);
  return index === -1 ? null : index;
}
