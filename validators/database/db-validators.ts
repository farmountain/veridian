/**
 * The `db.*` validator family - the vocabulary an acceptance criterion uses to judge a database.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`DbObservationData`) and never opens a database, never touches a
 * file and never sees an engine. That is the entire reason the vocabulary lives in
 * `core/environment/db-observation.ts` rather than beside the SQLite adapter: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know how the world was built, cannot become
 * untestable the day the storage engine changes, and can be re-read from a bundle a year later
 * without SQLite installed.
 *
 * The names are therefore `db.*` and not `sqlite.*`. The criterion is about the data, not about
 * which engine answered - and the engine *is* recorded, in the observation itself, because a verdict
 * from a substituted engine has to say which one it was reached against.
 *
 * ## Status discipline
 *
 * The same four branches as the web family, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held and the database was actually read.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the data*: a table that was
 *   never created, a migration that forgot a column, a seed that inserted two rows instead of three.
 * - `INCONCLUSIVE` - nobody looked. No `sql` step was run, so there is no result set to judge; a
 *   column the query did not select; a criterion that named a table the reading never mentions.
 * - `ERROR` - the *criterion* is unusable (a comparison that wants a number and got a word) or the
 *   world arrived unreadable. Never `TEST_FAILURE`: a typo in a contract is not a defect in the
 *   application.
 *
 * ## Comparisons
 *
 * Each validator states which comparison keys it understands and reads only those, and
 * `core/acceptance/plan.ts` refuses any key a validator does not declare. When an expectation states
 * more than one, *all* of them must hold.
 *
 * `db.value` is the one place where a comparison's meaning depends on the *data*: a column holding
 * an integer is ordered (`atLeast` / `atMost`) and a column holding text is searched (`contains` /
 * `matches`). The alternative - rendering every cell as text - was rejected because it turns
 * `equals: 3` against an integer column into a silent failure and `equals: "3"` into a silent
 * success, which is a trap rather than a vocabulary.
 */

import type { Observation } from "../../core/environment/types.ts";
import type { DbObservationData, DbQueryReading, DbValue } from "../../core/environment/db-observation.ts";
import { DB_OBSERVATION_KIND, columnIndexOf, isDbObservationData, tableOf } from "../../core/environment/db-observation.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  describe,
  expectedOf,
  judge,
  quote,
  statedComparisons,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { ComparisonOutcome } from "../../core/validation/assertions.ts";
import type { ComparisonKey } from "../../core/acceptance/plan.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * A criterion, a test and a failure report all spell these strings. Exporting the literal type of
 * each means a rename breaks the compiler instead of producing an acceptance contract that quietly
 * resolves to no validator at all.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `db.rowCount` is not merely unconventional
 * - it is an acceptance contract that cannot be written at all. Found by writing the example, which
 * is the only way a rule about a *document* is ever discovered. `db.count` also keeps the word the
 * web family already uses for the same quantity (`web.count` counts elements; this counts rows), so
 * the two families name one concept one way.
 */
export const DB_VALIDATOR_NAMES = {
  table: "db.table",
  column: "db.column",
  count: "db.count",
  value: "db.value",
} as const;

// ---- reading the document ------------------------------------------------------------------------

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): DbObservationData | AssertionResult {
  if (isDbObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a database document, so ` +
      "there is nothing to read. The adapter produced the measurement, so this is a defect in the " +
      "environment rather than a criterion the data failed.",
    "ENVIRONMENT_FAILURE",
  );
}

const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" && value !== null && "status" in value;

/** The criterion named no target, which no validator here can do anything with. */
const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

/**
 * The table, or an answer saying why there is none to read.
 *
 * A table the reading does not mention is `INCONCLUSIVE` rather than a failed presence check, and the
 * distinction is the point: `db.table` asks *whether* it exists and can therefore answer "no", while
 * `db.count` and `db.column` need a table to look inside and have nothing to measure when it is
 * absent. Collapsing the two would let "the migration never ran" read as "the table is empty", which
 * are different repairs.
 */
function readTable(
  document: DbObservationData,
  validator: string,
  name: string,
): DbObservationData["tables"][number] | AssertionResult {
  const table = tableOf(document, name);
  if (table === null) {
    return unanswered(
      validator,
      name,
      `The database has no table ${quote(name)}; it has ` +
        `${document.tables.length === 0 ? "none at all" : document.tables.map((entry) => entry.name).join(", ")}. ` +
        "Whether that is the defect is a question for `db.table`; this validator can only report " +
        "that there was nothing to measure.",
    );
  }
  return table;
}

/**
 * The criterion's result set, or an answer saying why there is none.
 *
 * `query: null` is an ordinary and specific fact - the criterion ran no `sql` step, so the adapter
 * had no question to put to the database. Reporting that as an empty result would let a criterion
 * with no query pass a `db.value` check it never made.
 */
function readQuery(
  document: DbObservationData,
  validator: string,
  target: string | null,
): DbQueryReading | AssertionResult {
  if (document.query === null) {
    return unanswered(
      validator,
      target,
      "The observation carries no query result, so there is nothing to read. A `db.value` criterion " +
        "is answered from the result of a `sql` step, so it needs at least one - and an observation " +
        "taken without acting cannot see the result of an action it did not take.",
    );
  }
  return document.query;
}

// ---- `db.value`'s type-aware comparison ----------------------------------------------------------

/** The wording a comparison would have used, for a cell that holds SQL NULL instead of a value. */
function phraseFor(key: ComparisonKey, expected: unknown): string {
  if (typeof expected === "number") {
    if (key === "atLeast") return `to be at least ${String(expected)}`;
    if (key === "atMost") return `to be at most ${String(expected)}`;
  }
  if (typeof expected === "string") {
    if (key === "contains") return `to contain ${describe(expected)}`;
    if (key === "matches") return `to match /${expected}/`;
  }
  return `to equal ${describe(expected)}`;
}

/**
 * One cell against one comparison.
 *
 * Three cases, and each of them is a different fact:
 *
 * 1. **The expectation asks for SQL NULL.** Only `equals: null` can do this, and it is answered
 *    directly - `actual === null` - because a NULL is not a missing value to be compared, it is the
 *    value.
 * 2. **The column was read and holds SQL NULL.** Every other comparison is then a real failure about
 *    the data. It fails with the phrasing the comparison would have used, so the report reads
 *    `Expected the column "price" to be at least 1, but it is null` rather than something a reader
 *    has to decode.
 * 3. **The column holds a value.** A number is ordered and text is searched, decided by the data
 *    rather than by the criterion, and each branch reuses the primitive the web family uses for the
 *    same job so the two families cannot drift apart.
 */
function compareCell(key: ComparisonKey, actual: DbValue, expected: unknown): ComparisonOutcome {
  if (expected === null) {
    if (key !== "equals") {
      return {
        kind: "unusable",
        message:
          `"${key}" needs something to compare with, and it received null. Only "equals" can ask ` +
          "whether a column holds SQL NULL.",
      };
    }
    return { kind: "judged", holds: actual === null, phrase: "to be SQL NULL" };
  }
  if (actual === null) return { kind: "judged", holds: false, phrase: phraseFor(key, expected) };
  if (typeof actual === "number") return compareCounts(key, actual, expected);
  return compareText(key, actual, expected);
}

/**
 * The verdict for one cell against every comparison the author stated.
 *
 * A local copy of `judge` rather than a call to it, because `judge` constrains the actual to
 * `Scalar` and a cell can legitimately be `null`. Widening `Scalar` instead would have loosened every
 * web validator's comparator to accept a null it has no reading for - a vocabulary change made for
 * one family's benefit and paid for by all of them.
 */
function judgeCell(
  validator: string,
  target: string,
  subject: string,
  actual: DbValue,
  raw: Readonly<Record<string, unknown>>,
): AssertionResult {
  const stated = statedComparisons(raw);
  if (stated.length === 0) {
    return unusable(
      validator,
      target,
      `The expectation on ${subject} states no comparison, so there is nothing to judge. ` +
        "An expectation that cannot fail is a false PASS waiting to happen.",
    );
  }
  for (const key of stated) {
    const expected = raw[key];
    const outcome = compareCell(key, actual, expected);
    if (outcome.kind === "unusable") return unusable(validator, target, outcome.message);
    if (!outcome.holds) {
      return assertion(
        validator,
        target,
        "FAIL",
        actual,
        expected,
        `Expected ${subject} ${outcome.phrase}, but it is ${actual === null ? "SQL NULL" : describe(actual)}.`,
      );
    }
  }
  return assertion(validator, target, "PASS", actual, expectedOf(raw, stated), null);
}

// ---- the family ----------------------------------------------------------------------------------

const table: Validator = {
  name: DB_VALIDATOR_NAMES.table,
  needsTarget: true,
  targetNoun: "table",
  comparisons: ["equals"],
  observationKind: DB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, table.name, null);
    if (isAssertion(document)) return document;
    const name = typeof raw["target"] === "string" ? raw["target"] : null;
    if (name === null) return noTarget(table.name, "a table name");
    return judge(
      table.name,
      name,
      `the table ${quote(name)}`,
      tableOf(document, name) !== null,
      raw,
      comparePresence,
    );
  },
};

const column: Validator = {
  name: DB_VALIDATOR_NAMES.column,
  needsTarget: true,
  targetNoun: "column",
  comparisons: ["equals"],
  observationKind: DB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, column.name, null);
    if (isAssertion(document)) return document;
    const target = typeof raw["target"] === "string" ? raw["target"] : null;
    if (target === null) return noTarget(column.name, "a column, named as `table.column`");

    const split = target.indexOf(".");
    if (split <= 0 || split === target.length - 1) {
      return unusable(
        column.name,
        target,
        `A column is named as \`table.column\`, and it received ${quote(target)}. The table is part ` +
          "of the name on purpose: a column exists in a table, and a criterion that named only the " +
          "column would be judged against whichever table happened to have one.",
      );
    }
    const tableName = target.slice(0, split);
    const columnName = target.slice(split + 1);
    const reading = readTable(document, column.name, tableName);
    if (isAssertion(reading)) return reading;
    return judge(
      column.name,
      target,
      `the column ${quote(columnName)} of ${quote(tableName)}`,
      reading.columns.includes(columnName),
      raw,
      comparePresence,
    );
  },
};

const count: Validator = {
  name: DB_VALIDATOR_NAMES.count,
  needsTarget: true,
  targetNoun: "table",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: DB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, count.name, null);
    if (isAssertion(document)) return document;
    const name = typeof raw["target"] === "string" ? raw["target"] : null;
    if (name === null) return noTarget(count.name, "a table name");
    const reading = readTable(document, count.name, name);
    if (isAssertion(reading)) return reading;
    return judge(
      count.name,
      name,
      `the number of rows in ${quote(name)}`,
      reading.rows,
      raw,
      compareCounts,
    );
  },
};

const value: Validator = {
  name: DB_VALIDATOR_NAMES.value,
  needsTarget: true,
  targetNoun: "column",
  // Both families of comparison, because which one applies is a property of the data. A key that
  // cannot apply is refused at judging time with a message naming the reason.
  comparisons: ["equals", "contains", "matches", "atLeast", "atMost"],
  observationKind: DB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, value.name, null);
    if (isAssertion(document)) return document;
    const target = typeof raw["target"] === "string" ? raw["target"] : null;
    if (target === null) return noTarget(value.name, "a column of the criterion's own query");

    const query = readQuery(document, value.name, target);
    if (isAssertion(query)) return query;

    const index = columnIndexOf(query, target);
    if (index === null) {
      return unanswered(
        value.name,
        target,
        `The criterion's query did not select a column ${quote(target)}; it selected ` +
          `${query.columns.length === 0 ? "none" : query.columns.map((name) => quote(name)).join(", ")}. ` +
          "A column the query never selected was never read, so this is not a failed comparison.",
      );
    }
    const row = query.rows[0];
    if (row === undefined) {
      return unanswered(
        value.name,
        target,
        `The criterion's query ${quote(query.statement)} returned no rows, so there is no value to ` +
          "compare. An empty result and a wrong value are different defects, and reporting this one " +
          "as a failure would send a repair at the wrong thing.",
      );
    }
    return judgeCell(
      value.name,
      target,
      `the column ${quote(target)} of the criterion's query`,
      row[index] ?? null,
      raw,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const DB_VALIDATORS: readonly Validator[] = Object.freeze([table, column, count, value]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function dbValidators(): Validator[] {
  return [...DB_VALIDATORS];
}
