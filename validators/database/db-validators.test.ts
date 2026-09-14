import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DB_OBSERVATION_KIND } from "../../core/environment/db-observation.ts";
import type {
  DbObservationData,
  DbQueryReading,
  DbTableReading,
} from "../../core/environment/db-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry, evaluateCriterion } from "../../core/validation/registry.ts";
import type { AssertionResult, CriterionSpec } from "../../core/validation/types.ts";
import { DB_VALIDATORS, DB_VALIDATOR_NAMES, dbValidators } from "./db-validators.ts";

/**
 * The `db.*` family, proven offline against literal documents.
 *
 * `validators/playwright/web-ui-validators.test.ts` explains why this is a document test and not a
 * port test; the reason is the same here and slightly stronger. A database validator never opens a
 * database - it reads a `DbObservationData` - so handing it one written by hand is the *only* way to
 * reach the branches that matter without an engine installed. The `local-db` demo proves the adapter
 * produces such a document; nothing else proves the family judges one correctly, which is why this
 * file exists at all.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - an unreadable document,
 *    a criterion that ran no `sql` step, a column nobody selected, an empty result set - is asserted
 *    to be `INCONCLUSIVE` or `ERROR`, never `PASS`.
 *  - **A defect is a `FAIL`.** A missing table, a forgotten column, a wrong row count are the shapes a
 *    broken migration and a broken seed actually take.
 *  - **The distinction that makes the repairs different.** "The table is absent" and "the table is
 *    empty" and "the value is wrong" and "there was no value" are four facts, and a validator that
 *    collapsed any two of them would send the agent at the wrong file.
 */

const registry = new ValidatorRegistry(dbValidators());

const table = (name: string, columns: readonly string[], rows: number): DbTableReading => ({
  name,
  columns,
  rows,
});

const cartItems = table("cart_items", ["id", "sku", "quantity"], 3);
const products = table("products", ["id", "sku", "quantity_on_hand", "reorder_level"], 5);

const document = (overrides: Partial<DbObservationData> = {}): DbObservationData => ({
  engine: "sqlite",
  database: ".veridian/environments/inventory.db",
  tables: [cartItems, products],
  query: null,
  ...overrides,
});

const query = (overrides: Partial<DbQueryReading> = {}): DbQueryReading => ({
  statement: "SELECT quantity FROM cart_items WHERE sku = 'A-1'",
  columns: ["quantity"],
  rows: [[2]],
  ...overrides,
});

const observed = (data: unknown, kind: string = DB_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "local-db:examples/inventory-db",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.json", kind: "json" }],
  error: null,
});

/**
 * A document from the *other* world, typed as that world's to keep it honest.
 *
 * Annotated rather than written inline so that a change to `WebObservationData` breaks this file
 * instead of quietly turning the fixture into something no adapter would ever emit - at which point
 * the test would be asserting that a nonsense object is not a database document, which nothing
 * needed proving.
 */
const webDocument: WebObservationData = {
  url: "http://127.0.0.1:4173/",
  title: "Shopping Cart",
  targets: {},
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
};

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point, not the criterion's: it deliberately bypasses the
 * observation-kind check so that the family's own status discipline is what is under test.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...fields });

const expect = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = judge(raw, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${String(raw["validator"])}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

const spec = (
  expect_: readonly Readonly<Record<string, unknown>>[],
  evidence: readonly string[] = [],
): CriterionSpec => ({
  id: "AC-001",
  description: "the cart holds the quantity that was added",
  mandatory: true,
  evidence,
  steps: [],
  expect: expect_,
});

const evaluate = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  observation: Observation,
  evidence: readonly string[] = [],
) =>
  evaluateCriterion(spec(expectations, evidence), observation, {
    registry,
    runId: observation.runId,
    environmentId: observation.environmentId,
    timestamp: observation.capturedAt,
  });

// ---- the family describes itself ------------------------------------------------------------------

describe("the database validator family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the four it has", () => {
    assert.deepEqual(
      registry.names(),
      DB_VALIDATORS.map((validator) => validator.name).sort(),
    );
    // Pinned as a literal as well as against the export, because both `README.md` and
    // `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` listed a fifth - `db.query` - that no validator here
    // implements. A name in the inventory that no registry resolves is the same defect as a count
    // that does not match the run: a claim nobody can act on.
    assert.deepEqual(registry.names(), ["db.column", "db.count", "db.table", "db.value"]);
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    // `acceptance.schema.json` pins `Expectation.validator` to this pattern, so `db.rowCount` is not
    // merely unconventional - it is an acceptance contract that cannot be written at all.
    for (const validator of DB_VALIDATORS) {
      assert.match(validator.name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, validator.name);
    }
    assert.equal(DB_VALIDATOR_NAMES.count, "db.count", "the count validator's name is lower case");
  });

  it("reads the database observation kind, and never the web one", () => {
    for (const validator of DB_VALIDATORS) {
      assert.equal(validator.observationKind, DB_OBSERVATION_KIND, validator.name);
      assert.notEqual(validator.observationKind, WEB_OBSERVATION_KIND, validator.name);
    }
  });

  it("declares exactly the comparisons it can answer", () => {
    const declared = Object.fromEntries(
      DB_VALIDATORS.map((validator) => [validator.name, [...validator.comparisons]]),
    );
    assert.deepEqual(declared, {
      [DB_VALIDATOR_NAMES.table]: ["equals"],
      [DB_VALIDATOR_NAMES.column]: ["equals"],
      [DB_VALIDATOR_NAMES.count]: ["equals", "atLeast", "atMost"],
      [DB_VALIDATOR_NAMES.value]: ["equals", "contains", "matches", "atLeast", "atMost"],
    });
    // A table either exists or it does not; there is no order to it. Declaring `atLeast` here would
    // put a comparison in a contract that no code path can ever judge.
    assert.deepEqual([...registry.require(DB_VALIDATOR_NAMES.table).comparisons], ["equals"]);
  });

  it("declares no comparison key the acceptance vocabulary does not have", () => {
    for (const validator of DB_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, validator.name);
      for (const comparison of validator.comparisons) {
        assert.ok(
          ["equals", "contains", "matches", "atLeast", "atMost"].includes(comparison),
          `${validator.name} declares unknown comparison "${comparison}"`,
        );
      }
    }
  });

  it("says which noun its target names, so the ladder asks a question with an answer", () => {
    const nouns = Object.fromEntries(DB_VALIDATORS.map((v) => [v.name, v.targetNoun]));
    assert.deepEqual(nouns, {
      [DB_VALIDATOR_NAMES.table]: "table",
      [DB_VALIDATOR_NAMES.column]: "column",
      [DB_VALIDATOR_NAMES.count]: "table",
      [DB_VALIDATOR_NAMES.value]: "column",
    });
    // "element" is what the field *means when it is absent* - the browser family's default - so a
    // database validator that left it undefined would make the clarification ladder ask which
    // *element* to inspect, in a contract with no page anywhere in it.
    for (const validator of DB_VALIDATORS) {
      assert.notEqual(validator.targetNoun, "element", validator.name);
    }
    const descriptors = registry.descriptors();
    assert.deepEqual(descriptors.map((d) => d.name), registry.names());
    for (const descriptor of descriptors) assert.ok("targetNoun" in descriptor, descriptor.name);
  });

  it("only asks for a target where a target is the question", () => {
    for (const validator of DB_VALIDATORS) {
      assert.equal(validator.needsTarget, true, validator.name);
    }
  });

  it("hands out a fresh array so a registry cannot reorder the family", () => {
    const first = dbValidators();
    const second = dbValidators();
    assert.notEqual(first, second);
    assert.notEqual(first, DB_VALIDATORS);
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
    assert.ok(Object.isFrozen(DB_VALIDATORS), "the exported family must be frozen");
  });
});

// ---- a document nobody can read -------------------------------------------------------------------

describe("an unreadable observation is never a judgement", () => {
  const unreadable: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["a number", 42],
    ["a bare string", DB_OBSERVATION_KIND],
    ["an array", []],
    ["an engine that is not a string", { engine: 12, database: "x", tables: [], query: null }],
    ["a database that is not a string", { engine: "sqlite", database: 7, tables: [], query: null }],
    ["tables that are not a list", { engine: "sqlite", database: "x", tables: "none", query: null }],
    [
      "a table missing its columns and rows",
      { engine: "sqlite", database: "x", tables: [{ name: "cart_items" }], query: null },
    ],
    [
      "a query missing its columns",
      { engine: "sqlite", database: "x", tables: [], query: { statement: "SELECT 1" } },
    ],
    [
      "a query whose rows are not a list of scalar cells",
      {
        engine: "sqlite",
        database: "x",
        tables: [],
        query: { statement: "SELECT 1", columns: ["a"], rows: [{ a: 1 }] },
      },
    ],
  ];

  for (const [label, data] of unreadable) {
    it(`reports ENVIRONMENT_FAILURE for ${label}, under every validator`, () => {
      for (const name of registry.names()) {
        const result = judge(expectation(name, { target: "cart_items", equals: true }), observed(data));
        assert.equal(result.status, "ERROR", `${name} on ${label} gave ${result.status}`);
        assert.equal(result.failureKind, "ENVIRONMENT_FAILURE", `${name} on ${label}`);
        assert.match(
          String(result.message),
          /does not carry a database document/,
          `${name} on ${label}`,
        );
      }
    });
  }

  it("reads a well-formed document without complaint, so the check above is not vacuous", () => {
    const result = judge(
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }),
      observed(document()),
    );
    assert.equal(result.status, "PASS");
    assert.equal(result.failureKind, null);
    assert.equal(result.message, null, "a passing assertion carries no message for a reader to skim");
  });

  it("does not mistake the other families' documents for its own", () => {
    for (const name of registry.names()) {
      const result = judge(
        expectation(name, { target: "cart_items", equals: true }),
        observed(webDocument, WEB_OBSERVATION_KIND),
      );
      assert.equal(result.status, "ERROR", name);
      assert.match(String(result.message), /does not carry a database document/, name);
    }
  });
});

// ---- `db.table` -----------------------------------------------------------------------------------

describe("db.table answers whether a table exists, and can answer no", () => {
  it("passes for a table the database has", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "products", equals: "present" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails for a table that was never created, and names it", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "orders", equals: true }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /Expected the table `orders` to be present, but it is false\./);
    assert.equal(result.actual, false);
  });

  it("passes when the criterion expects the table to be absent", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "orders", equals: "absent" }),
      observed(document()),
      "PASS",
    );
  });

  it("passes for a table that exists and holds no rows, because empty is not absent", () => {
    const empty = document({ tables: [table("cart_items", ["id", "sku", "quantity"], 0)] });
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }),
      observed(empty),
      "PASS",
    );
  });

  it("refuses a name as a comparison, because existence is a boolean question", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: "cart_items" }),
      observed(document()),
      "ERROR",
      /wants true, false, "present" or "absent"/,
    );
  });

  it("errors rather than guessing when the criterion names no table", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { equals: true }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
  });

  it("errors when the expectation states no comparison at all", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- `db.column` ----------------------------------------------------------------------------------

describe("db.column asks about a column of a named table", () => {
  it("passes for a column the table has", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.column, { target: "products.reorder_level", equals: true }),
      observed(document()),
      "PASS",
    );
  });

  it("fails for a column a migration forgot, naming the table it looked in", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.column, { target: "products.reorder_threshold", equals: true }),
      observed(document()),
      "FAIL",
    );
    assert.match(
      String(result.message),
      /Expected the column `reorder_threshold` of `products` to be present, but it is false\./,
    );
  });

  it("passes when the criterion expects the column not to be there", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.column, { target: "cart_items.discount", equals: "absent" }),
      observed(document()),
      "PASS",
    );
  });

  it("reports that it could not look when the table itself is missing", () => {
    const missing = document({ tables: [products] });
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.column, { target: "cart_items.quantity", equals: true }),
      observed(missing),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /has no table `cart_items`/);
    assert.match(String(result.message), /it has products/);
  });

  it("insists on `table.column`, because a bare column name has no single answer", () => {
    for (const target of ["quantity", ".quantity", "cart_items."]) {
      expect(
        expectation(DB_VALIDATOR_NAMES.column, { target, equals: true }),
        observed(document()),
        "ERROR",
        /A column is named as/,
      );
    }
  });

  it("errors rather than guessing when the criterion names no column", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.column, { equals: true }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
  });
});

// ---- `db.count` -----------------------------------------------------------------------------------

describe("db.count counts the rows of a named table", () => {
  it("passes on the expected count and fails on any other", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
      observed(document()),
      "PASS",
    );
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 4 }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /Expected the number of rows in `cart_items` to equal 4, but it is 3\./);
  });

  it("orders a count with atLeast and atMost", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "products", atLeast: 5 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "products", atMost: 5 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "products", atLeast: 6 }),
      observed(document()),
      "FAIL",
    );
  });

  it("treats zero rows as a count of zero, not as an absence to be excused", () => {
    const empty = document({ tables: [table("cart_items", ["id", "sku", "quantity"], 0)] });
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 0 }),
      observed(empty),
      "PASS",
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
      observed(empty),
      "FAIL",
    );
  });

  it("refuses a text comparison, because a count is a number", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", contains: "3" }),
      observed(document()),
      "ERROR",
      /is not declared by this validator/,
    );
  });

  it("refuses a count written as a string, which is a criterion defect and not a defect in the data", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: "3" }),
      observed(document()),
      "ERROR",
      /compares a count with a number/,
    );
  });

  it("reports that it could not count when the table is missing", () => {
    const missing = document({ tables: [products] });
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
      observed(missing),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /has no table `cart_items`/);
  });

  it("says `none at all` when the database has no tables", () => {
    const empty = document({ tables: [] });
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
      observed(empty),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /it has none at all/);
  });
});

// ---- `db.value`: the type-aware comparison --------------------------------------------------------

describe("db.value reads the criterion's own query", () => {
  const answer = (overrides: Partial<DbQueryReading> = {}): DbObservationData =>
    document({ query: query(overrides) });

  it("reports that there was no question when the criterion ran no sql step", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }),
      observed(document()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /carries no query result/);
  });

  it("reports a column the query never selected, naming the columns it did", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "price", equals: 1 }),
      observed(answer({ columns: ["quantity", "sku"], rows: [[2, "A-1"]] })),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /did not select a column `price`/);
    assert.match(String(result.message), /it selected `quantity`, `sku`/);
  });

  it("says a query selected nothing rather than listing nothing", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }),
      observed(answer({ columns: [], rows: [] })),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /it selected none/);
  });

  it("reports an empty result set as unanswered, not as a wrong value", () => {
    const result = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }),
      observed(answer({ rows: [] })),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /returned no rows/);
    assert.match(String(result.message), /An empty result and a wrong value are different defects/);
  });

  it("orders a cell that holds a number", () => {
    const observed_ = observed(answer({ rows: [[2]] }));
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }), observed_, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", atLeast: 1 }), observed_, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", atMost: 1 }), observed_, "FAIL");
    const failed = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 99 }),
      observed_,
      "FAIL",
    );
    assert.match(
      String(failed.message),
      /Expected the column `quantity` of the criterion's query to equal 99, but it is 2\./,
    );
  });

  it("searches a cell that holds text", () => {
    const observed_ = observed(answer({ columns: ["sku"], rows: [["A-1"]] }));
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "sku", equals: "A-1" }), observed_, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "sku", contains: "A-" }), observed_, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "sku", matches: "^A-\\d+$" }), observed_, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "sku", matches: "[" }), observed_, "ERROR", /does not compile/);
    // The keys are decided by the *data*, so an ordering key on a text column is refused rather
    // than silently comparing strings.
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "sku", atLeast: 1 }),
      observed_,
      "ERROR",
      /is not declared by this validator/,
    );
  });

  it("refuses a comparison whose type does not match the cell's, in both directions", () => {
    // This is the whole reason the comparator is type-aware. Rendering every cell as text would turn
    // `equals: 3` against an integer column into a silent FAIL and `equals: "3"` into a silent PASS -
    // one trap written twice, and the report would not say which had happened.
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: "2" }),
      observed(answer()),
      "ERROR",
      /compares a count with a number/,
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "sku", equals: 2 }),
      observed(answer({ columns: ["sku"], rows: [["2"]] })),
      "ERROR",
      /compares text with a string/,
    );
  });

  it("treats a SQL NULL as the value it is", () => {
    const nullCell = observed(answer({ rows: [[null]] }));
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: null }),
      nullCell,
      "PASS",
    );
    const failed = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", atLeast: 1 }),
      nullCell,
      "FAIL",
    );
    assert.match(String(failed.message), /but it is SQL NULL\./);
  });

  it("refuses null as the right-hand side of anything but `equals`", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", contains: null }),
      observed(answer()),
      "ERROR",
      /Only "equals" can ask/,
    );
  });

  it("fails an `equals: null` against a column that holds a value", () => {
    const failed = expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: null }),
      observed(answer()),
      "FAIL",
    );
    assert.match(
      String(failed.message),
      /Expected the column `quantity` of the criterion's query to be SQL NULL, but it is 2\./,
    );
  });

  it("requires every stated comparison to hold", () => {
    const two = observed(answer({ rows: [[2]] }));
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", atLeast: 1, atMost: 3 }),
      two,
      "PASS",
    );
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", atLeast: 1, atMost: 1 }),
      two,
      "FAIL",
    );
  });

  it("errors when the expectation states no comparison", () => {
    expect(
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity" }),
      observed(answer()),
      "ERROR",
      /states no comparison/,
    );
  });

  it("reads the first row of the result, and says so by reading only that one", () => {
    const many = observed(answer({ rows: [[7], [8]] }));
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 7 }), many, "PASS");
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 8 }), many, "FAIL");
  });

  it("reads a cell the row did not supply as SQL NULL, because the missing column was caught earlier", () => {
    // `columnIndexOf` is what refuses a column the query did not select; by the time a cell is read,
    // the column exists in the result set, so a row shorter than the column list is a driver that
    // returned fewer cells - not a criterion naming something that was never there.
    const short = observed(answer({ columns: ["quantity", "note"], rows: [[5]] }));
    expect(expectation(DB_VALIDATOR_NAMES.value, { target: "note", equals: null }), short, "PASS");
  });
});

// ---- the distinctions a repair depends on ---------------------------------------------------------

describe("the statuses stay apart, because the repairs differ", () => {
  it("fails an absent table while reporting that the validators needing to look inside could not", () => {
    const missing = document({ tables: [products] });
    assert.equal(
      judge(expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }), observed(missing)).status,
      "FAIL",
      "a table that is not there is a defect in the application",
    );
    assert.equal(
      judge(expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }), observed(missing)).status,
      "INCONCLUSIVE",
      "a count of a table nobody could look inside is not a finding",
    );
    assert.equal(
      judge(expectation(DB_VALIDATOR_NAMES.column, { target: "cart_items.quantity", equals: true }), observed(missing))
        .status,
      "INCONCLUSIVE",
      "nor is a column check",
    );
  });

  it("distinguishes a missing column from a missing table", () => {
    const noColumn = document({ tables: [table("products", ["id", "sku"], 5)] });
    assert.equal(
      judge(expectation(DB_VALIDATOR_NAMES.column, { target: "products.reorder_level", equals: true }), observed(noColumn))
        .status,
      "FAIL",
      "the table was read and the column is not in it",
    );
    assert.equal(
      judge(expectation(DB_VALIDATOR_NAMES.column, { target: "orders.id", equals: true }), observed(noColumn)).status,
      "INCONCLUSIVE",
      "the table was never read, so the column was never looked for",
    );
  });
});

// ---- M3: nothing unobserved is a pass -------------------------------------------------------------

describe("M3: nothing that was not observed is reported as a pass", () => {
  const notPassable: readonly (readonly [string, Record<string, unknown>, Observation])[] = [
    [
      "a criterion that ran no sql step",
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }),
      observed(document()),
    ],
    [
      "a column the query never selected",
      expectation(DB_VALIDATOR_NAMES.value, { target: "price", equals: 1 }),
      observed(document({ query: query() })),
    ],
    [
      "an empty result set",
      expectation(DB_VALIDATOR_NAMES.value, { target: "quantity", equals: 2 }),
      observed(document({ query: query({ rows: [] }) })),
    ],
    [
      "a table nobody could find",
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
      observed(document({ tables: [products] })),
    ],
    [
      "a column of a table nobody could find",
      expectation(DB_VALIDATOR_NAMES.column, { target: "cart_items.quantity", equals: true }),
      observed(document({ tables: [products] })),
    ],
    [
      "an expectation with no comparison",
      expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items" }),
      observed(document()),
    ],
    [
      "a criterion that named no target",
      expectation(DB_VALIDATOR_NAMES.table, { equals: true }),
      observed(document()),
    ],
    [
      "a document from another world",
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }),
      observed(webDocument, WEB_OBSERVATION_KIND),
    ],
    [
      "a document nobody can read",
      expectation(DB_VALIDATOR_NAMES.table, { target: "cart_items", equals: true }),
      observed({ engine: "sqlite" }),
    ],
  ];

  for (const [label, raw, observation] of notPassable) {
    it(`is not a PASS: ${label}`, () => {
      const result = judge(raw, observation);
      assert.notEqual(result.status, "PASS", `${label} produced ${result.status}`);
      assert.ok(
        result.status === "INCONCLUSIVE" || result.status === "ERROR",
        `${label} produced ${result.status}, which is neither a finding nor an abstention`,
      );
    });
  }
});

// ---- the criterion-level entry point ---------------------------------------------------------------

describe("a validator is never asked to judge a world it cannot see", () => {
  it("refuses a web observation for a database criterion", () => {
    const result = evaluate(
      [expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 })],
      observed(webDocument, WEB_OBSERVATION_KIND),
    );
    assert.equal(result.status, "ERROR");
    assert.match(
      String(result.message),
      /reads "db\.database" observations but received "web\.page"/,
    );
    assert.match(String(result.message), /A validator must never be asked to judge a world it cannot see/);
  });

  it("judges a database observation through the same entry point", () => {
    const result = evaluate(
      [
        expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 }),
        expectation(DB_VALIDATOR_NAMES.table, { target: "products", equals: "present" }),
      ],
      observed(document()),
    );
    assert.equal(result.status, "PASS");
  });

  it("will not pass a criterion whose required evidence is missing, even when the assertions passed", () => {
    const result = evaluate(
      [expectation(DB_VALIDATOR_NAMES.count, { target: "cart_items", equals: 3 })],
      observed(document()),
      ["log"],
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.deepEqual(result.missingEvidence, ["log"]);
    assert.match(String(result.message), /An unproven pass is not a pass/);
  });
});
