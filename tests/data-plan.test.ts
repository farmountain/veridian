/**
 * The `data` block of an environment document: what the loader reads out of it, and every spelling it
 * refuses by name.
 *
 * This is the first test in the tree that drives `finalizeEnvironment`'s defect paths directly. Every
 * other family is exercised end to end - one demo, one contract, one happy path - which means a
 * refusal nothing trips is a refusal nothing holds. So the subject here is not "the eleventh world's
 * block parses"; it is *which layer refuses which spelling*, asserted rather than assumed.
 *
 * That distinction is not decoration, and it is why each refusal below names both the path and the
 * error's own type. `schemas/environment.schema.json` refuses several of the spellings this loader
 * also refuses - a fractional `nodeId`, a negative one, a `port` outside `0..65535`, an empty string
 * for `cluster` or `host` - and it refuses them *first*, because the schema assertion runs before any
 * field is read. A test that asserted only the loader's message would describe six guarded branches
 * while guarding three, and would break for the wrong reason the day a schema constraint moved:
 * `SchemaViolationError` is not a `DefinitionError`, and which of the two is thrown is exactly which
 * half of the pair is load-bearing.
 *
 * The refusals only the loader can make are the ones `minLength: 1` cannot see, and they are the
 * interesting ones: a `cluster` of `"   "`, a `host` of `"   "`, and a `host` that is not loopback.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_SIMULATED_SURFACES, finalizeEnvironment } from "../core/environment/index.ts";
import { DefinitionError } from "../core/goal/index.ts";
import type { GoalLimits, SourceRef } from "../core/goal/types.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, SchemaViolationError, type SchemaSet } from "../core/schema/index.ts";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(nodeIo()));

/** The seven limit fields a plan is built against. Nothing here reads the boundary half. */
const LIMITS: GoalLimits = {
  maxIterations: 10,
  maxRuntimeMs: 600_000,
  maxCriterionMs: 30_000,
  networkPolicy: "deny",
  networkAllowList: [],
  filesystemWrite: "sandbox",
};

const SOURCE: SourceRef = {
  path: "examples/sim-data/environment.yaml",
  dir: "examples/sim-data",
  text: "",
};

/**
 * A document that is valid apart from the `data` block under test, so a refusal can only be about one
 * of the three fields this file is about. `data` is omitted rather than set when the caller passes
 * `undefined`, because "no block" and "a null block" are two spellings this file asserts separately.
 */
const documentWith = (data: unknown): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    adapter: "sim-data",
    app: ".",
    start: { command: "node", args: ["app/provision.mjs"] },
  };
  return data === undefined ? base : { ...base, data };
};

const readPlan = async (data: unknown) => finalizeEnvironment(documentWith(data), await schemas(), SOURCE, LIMITS);

/**
 * The error a document raises, or a failure naming what was planned instead.
 *
 * The acceptance branch throws outside the `try` on purpose: a `assert.fail` placed inside it would be
 * caught by the very catch that exists to hand back a refusal, and the test would then report the
 * assertion as the refusal it was looking for.
 */
const refused = async (data: unknown): Promise<Error> => {
  try {
    await readPlan(data);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`the document was accepted where a refusal was expected: ${JSON.stringify(data)}`);
};

/** A loader refusal: exactly one defect, at the path this file names. Returns it for the caller to read. */
const assertLoaderRefused = (error: Error, path: string, message: RegExp): DefinitionError => {
  assert.ok(error instanceof DefinitionError, `expected a DefinitionError and read ${error.name}: ${error.message}`);
  assert.equal(error.errors.length, 1, `the loader files one defect per refusal, and filed ${String(error.errors.length)}`);
  const [first] = error.errors;
  assert.ok(first !== undefined);
  assert.equal(first.path, path);
  assert.match(first.message, message);
  return error;
};

/** A schema refusal: the same path, and the constraint that produced it rather than the reader that would have. */
const assertSchemaRefused = (error: Error, what: string, path: string, keyword: string): void => {
  assert.ok(
    error instanceof SchemaViolationError,
    `${what} was accepted by the schema and read ${error.name}: ${error.message}`,
  );
  const match = error.errors.find((entry) => entry.path === path && entry.keyword === keyword);
  assert.ok(
    match !== undefined,
    `${what}: expected ${path} refused for ${keyword}, and the schema filed ${error.errors.map((e) => `${e.path} (${e.keyword})`).join(", ")}`,
  );
};

describe("the data block is read into the plan", () => {
  it("reads the cluster and the broker id, and takes the default address when none is stated", async () => {
    const plan = await readPlan({ cluster: "cart-log", nodeId: 3 });
    assert.deepEqual(plan.data, { cluster: "cart-log", nodeId: 3, host: "127.0.0.1", port: 0 });
  });

  it("records the address the document stated rather than the loopback default", async () => {
    const plan = await readPlan({ cluster: "cart-log", nodeId: 0, host: "localhost", port: 19092 });
    assert.deepEqual(plan.data, { cluster: "cart-log", nodeId: 0, host: "localhost", port: 19092 });
  });

  it("accepts every spelling of loopback, which are the only hosts it accepts", async () => {
    for (const host of ["127.0.0.1", "::1", "localhost"]) {
      const plan = await readPlan({ cluster: "cart-log", nodeId: 0, host });
      assert.equal(plan.data?.host, host);
    }
  });

  it("plans no broker for a document that declares neither an omitted block nor a null one", async () => {
    for (const data of [undefined, null]) {
      const plan = await readPlan(data);
      assert.equal(plan.data, null);
    }
  });

  it("carries the seven surfaces the world stands in for, so a reading is traceable to a named substitute", () => {
    assert.deepEqual([...DATA_SIMULATED_SURFACES], [
      "broker",
      "replication",
      "group-coordination",
      "log-storage",
      "retention",
      "transactions",
      "partitioning",
    ]);
  });
});

describe("the data block is refused by name when it cannot be planned", () => {
  it("refuses a cluster that is only whitespace, which the schema's minLength cannot see", async () => {
    const error = await refused({ cluster: "   ", nodeId: 1 });
    assertLoaderRefused(error, "$.data.cluster", /names no cluster/);
  });

  it("refuses a host that is only whitespace, which the schema's minLength cannot see either", async () => {
    const error = await refused({ cluster: "cart-log", nodeId: 1, host: "   " });
    assertLoaderRefused(error, "$.data.host", /names an empty host/);
  });

  it("refuses a host that is not loopback, and names the host the document asked for", async () => {
    for (const host of ["0.0.0.0", "example.com", "10.0.0.5"]) {
      const error = assertLoaderRefused(
        await refused({ cluster: "cart-log", nodeId: 1, host }),
        "$.data.host",
        /binds a substitute broker on 127\.0\.0\.1, ::1, localhost/,
      );
      assert.match(String(error.errors[0]?.message), new RegExp(`names ${JSON.stringify(host)}`));
    }
  });

  it("leaves the schema to refuse a broker id and a port the plan could not answer as", async () => {
    const cases: readonly {
      readonly what: string;
      readonly data: unknown;
      readonly path: string;
      readonly keyword: string;
    }[] = [
      { what: "a cluster of the empty string", data: { cluster: "", nodeId: 1 }, path: "$.data.cluster", keyword: "minLength" },
      { what: "a broker id that is not a whole number", data: { cluster: "cart-log", nodeId: 1.5 }, path: "$.data.nodeId", keyword: "type" },
      { what: "a negative broker id", data: { cluster: "cart-log", nodeId: -1 }, path: "$.data.nodeId", keyword: "minimum" },
      { what: "no broker id at all", data: { cluster: "cart-log" }, path: "$.data", keyword: "required" },
      { what: "an empty host", data: { cluster: "cart-log", nodeId: 1, host: "" }, path: "$.data.host", keyword: "minLength" },
      { what: "a port above the range a socket can hold", data: { cluster: "cart-log", nodeId: 1, port: 70000 }, path: "$.data.port", keyword: "maximum" },
      { what: "a negative port", data: { cluster: "cart-log", nodeId: 1, port: -1 }, path: "$.data.port", keyword: "minimum" },
      { what: "a fractional port", data: { cluster: "cart-log", nodeId: 1, port: 1.5 }, path: "$.data.port", keyword: "type" },
      { what: "a null port, which the loader would have defaulted and the schema will not", data: { cluster: "cart-log", nodeId: 1, port: null }, path: "$.data.port", keyword: "type" },
      { what: "a data block that is a number", data: 5, path: "$.data", keyword: "type" },
    ];
    for (const entry of cases) {
      assertSchemaRefused(await refused(entry.data), entry.what, entry.path, entry.keyword);
    }
  });
});
