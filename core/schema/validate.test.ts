import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { nodeIo, preloadSchemas, type IoPort } from "../io.ts";
import { SchemaValidator, SchemaViolationError, validateAgainst, type JsonSchema } from "./validate.ts";

/**
 * The repository root, taken from this file's own location.
 *
 * `fileURLToPath` rather than `url.pathname`, because the two differ in a way that shows on only
 * one platform. `pathname` carries a leading `/` that has to be stripped to leave a Windows drive
 * letter intact (`/D:/repo` -> `D:/repo`); stripping it turns a POSIX path into a relative one
 * (`/home/x/repo` -> `home/x/repo`), which the port then resolves against the cwd into a directory
 * that does not exist. Every schema read from that root then reports the file as missing.
 *
 * `demo.ts` and `app/serve.mjs` already use `fileURLToPath`; this was the last hand-rolled copy.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const SCHEMA_URIS = [
  "schemas/ambiguity.schema.json",
  "schemas/goal.schema.json",
  "schemas/acceptance.schema.json",
  "schemas/environment.schema.json",
  "schemas/run.schema.json",
  "schemas/result.schema.json",
] as const;

const withSchemas = async (): Promise<{ io: IoPort; loader: { load(uri: string): unknown } }> => {
  const io = nodeIo({ root: repoRoot });
  const loader = await preloadSchemas(io, SCHEMA_URIS);
  return { io, loader };
};

describe("schema validator", () => {
  it("reports the type mismatch with an accessor path", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, count: { type: "integer" } },
    };
    const errors = validateAgainst(schema, { id: "AC-001", count: "one" });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.path, "$.count");
    assert.equal(errors[0]?.keyword, "type");
  });

  it("indexes array elements in the reported path", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { items: { type: "array", items: { type: "string" } } },
    };
    const errors = validateAgainst(schema, { items: ["ok", 7] });
    assert.equal(errors[0]?.path, "$.items[1]");
  });

  it("stops descending once the type is wrong, so one mistake is not reported five times", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          required: ["a", "b", "c"],
          properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } },
        },
      },
    };
    const errors = validateAgainst(schema, { nested: "not an object" });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.keyword, "type");
  });

  it("rejects an unknown property, because a silently ignored field is a believed requirement", () => {
    const schema: JsonSchema = {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
    };
    const errors = validateAgainst(schema, { id: "x", typo: 1 });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.path, "$.typo");
    assert.match(errors[0]?.message ?? "", /unknown property/);
  });

  it("checks patterns, bounds and lengths", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        code: { type: "string", pattern: "^AC-[0-9]{3}$" },
        ratio: { type: "number", minimum: 0, maximum: 1 },
        name: { type: "string", minLength: 2 },
        list: { type: "array", minItems: 1, maxItems: 2 },
      },
    };
    const errors = validateAgainst(schema, {
      code: "AC-1",
      ratio: 1.5,
      name: "a",
      list: [],
    });
    assert.deepEqual(
      errors.map((e) => e.keyword).sort(),
      ["maximum", "minItems", "minLength", "pattern"],
    );
  });

  it("reports an invalid pattern in the schema rather than crashing the run", () => {
    const errors = validateAgainst({ type: "string", pattern: "([unclosed" }, "anything");
    assert.equal(errors[0]?.keyword, "pattern");
    assert.match(errors[0]?.message ?? "", /invalid pattern/);
  });

  it("treats a value matching two oneOf branches as an error, not as a success", () => {
    const schema: JsonSchema = {
      oneOf: [{ type: "number" }, { type: "integer" }],
    };
    const errors = validateAgainst(schema, 3);
    assert.equal(errors[0]?.keyword, "oneOf");
    assert.match(errors[0]?.message ?? "", /matches 2 permitted forms/);
  });

  it("resolves a local $ref through $defs", () => {
    const schema: JsonSchema = {
      $defs: { Id: { type: "string", pattern: "^AC-[0-9]{3}$" } },
      type: "object",
      properties: { id: { $ref: "#/$defs/Id" } },
    };
    assert.equal(validateAgainst(schema, { id: "AC-001" }).length, 0);
    assert.equal(validateAgainst(schema, { id: "nope" })[0]?.keyword, "pattern");
  });

  it("resolves a cross-file $ref through a loader", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { rep: { $ref: "other.schema.json#/$defs/Rep" } },
    };
    const loader = {
      load: () => ({ $defs: { Rep: { type: "string", minLength: 3 } } }),
    };
    assert.equal(validateAgainst(schema, { rep: "abc" }, "schemas/a.schema.json", loader).length, 0);
    const errors = validateAgainst(schema, { rep: "a" }, "schemas/a.schema.json", loader);
    assert.equal(errors[0]?.keyword, "minLength");
  });

  it("fails loudly when an external ref is used without a loader", () => {
    const errors = validateAgainst({ $ref: "missing.schema.json#/$defs/X" }, 1, "schemas/a.schema.json");
    assert.match(errors[0]?.message ?? "", /no loader was provided/);
  });

  it("detects a cyclical schema reference instead of recursing forever", () => {
    const schema: JsonSchema = {
      $defs: {
        A: { $ref: "#/$defs/B" },
        B: { $ref: "#/$defs/A" },
      },
      $ref: "#/$defs/A",
    };
    const errors = validateAgainst(schema, 1);
    assert.equal(errors[0]?.keyword, "$ref");
    assert.match(errors[0]?.message ?? "", /cyclical/);
  });

  it("reports a $ref that does not resolve", () => {
    const errors = validateAgainst({ $ref: "#/$defs/Nope" }, 1);
    assert.match(errors[0]?.message ?? "", /does not resolve/);
  });

  it("throws SchemaViolationError with a readable summary on assert()", () => {
    const validator = new SchemaValidator("schemas/x.schema.json", {
      type: "object",
      required: ["id"],
    });
    assert.throws(
      () => validator.assert({}),
      (error: unknown) => {
        assert.ok(error instanceof SchemaViolationError);
        assert.match(error.message, /schemas\/x\.schema\.json does not satisfy its schema/);
        assert.match(error.message, /missing required property "id"/);
        return true;
      },
    );
  });
});

describe("the repository's own schemas", () => {
  it("all parse and declare a title, a type and an id", async () => {
    const { io } = await withSchemas();
    for (const uri of SCHEMA_URIS) {
      const text = await io.readTextFile(uri);
      assert.ok(text, `${uri} is missing`);
      const schema = JSON.parse(text) as JsonSchema;
      assert.equal(typeof schema["title"], "string", `${uri} has no title`);
      assert.equal(typeof schema["$id"], "string", `${uri} has no $id`);
    }
  });

  it("accepts a minimal well-formed goal and rejects one with a typo'd field", async () => {
    const { loader } = await withSchemas();
    const goalSchema = loader.load("schemas/goal.schema.json") as JsonSchema;
    const good = {
      version: 1,
      id: "shopping-cart",
      statement: "A shopper can add an item and see the cart total update.",
      acceptance: "acceptance.yaml",
      environment: "environment.yaml",
      limits: {
        maxIterations: 10,
        maxRuntimeMs: 300_000,
        maxCriterionMs: 30_000,
        networkPolicy: "deny",
        filesystemWrite: "sandbox",
      },
    };
    assert.deepEqual(validateAgainst(goalSchema, good, "schemas/goal.schema.json", loader), []);

    const bad = { ...good, acceptanceCriteria: "acceptance.yaml" };
    const errors = validateAgainst(goalSchema, bad, "schemas/goal.schema.json", loader);
    assert.equal(errors.length, 1, `expected exactly the typo, got ${JSON.stringify(errors)}`);
    assert.equal(errors[0]?.path, "$.acceptanceCriteria");
    assert.equal(errors[0]?.keyword, "additionalProperties");
  });

  it("requires the whole safety-limit block, because an omitted limit reads as an unlimited one", async () => {
    const { loader } = await withSchemas();
    const goalSchema = loader.load("schemas/goal.schema.json") as JsonSchema;
    const errors = validateAgainst(
      goalSchema,
      {
        version: 1,
        id: "shopping-cart",
        statement: "A shopper can add an item and see the cart total update.",
        acceptance: "acceptance.yaml",
        environment: "environment.yaml",
        limits: { maxIterations: 10 },
      },
      "schemas/goal.schema.json",
      loader,
    );
    assert.equal(errors.length, 4, `expected the four missing limits, got ${JSON.stringify(errors)}`);
    for (const key of ["maxRuntimeMs", "maxCriterionMs", "networkPolicy", "filesystemWrite"]) {
      assert.ok(
        errors.some((error) => error.message.includes(`"${key}"`)),
        `expected a missing-required error for ${key}`,
      );
    }
  });

  it("rejects a goal whose statement is missing, since the goal must be an observable end state", async () => {
    const { loader } = await withSchemas();
    const goalSchema = loader.load("schemas/goal.schema.json") as JsonSchema;
    const errors = validateAgainst(
      goalSchema,
      { id: "shopping-cart", version: 1 },
      "schemas/goal.schema.json",
      loader,
    );
    assert.ok(errors.length >= 1);
    assert.ok(errors.every((error) => error.keyword === "required"));
    assert.ok(
      errors.some((error) => /missing required property "statement"/.test(error.message)),
      `expected a missing-statement error, got ${JSON.stringify(errors)}`,
    );
  });

  it("resolves the cross-file $ref from run.schema.json into result.schema.json", async () => {
    const { loader } = await withSchemas();
    const runSchema = loader.load("schemas/run.schema.json") as JsonSchema;
    const run = {
      id: "run-20260101-000000-abcdef",
      goal_id: "shopping-cart",
      environment_id: null,
      state: "CREATED",
      iteration: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      transitions: [],
      reproducibility: {
        capturedAt: "2026-01-01T00:00:00.000Z",
        platform: "win32",
        arch: "x64",
        node: "v22.18.0",
        veridian: "0.1.0",
        gitCommit: null,
        gitDirty: null,
        appVersion: null,
        playwright: null,
        browser: null,
        seed: 0,
        timezone: "UTC",
        networkPolicy: "deny",
        env: {},
      },
    };
    assert.deepEqual(validateAgainst(runSchema, run, "schemas/run.schema.json", loader), []);
  });

  it("rejects an unknown run state", async () => {
    const { loader } = await withSchemas();
    const runSchema = loader.load("schemas/run.schema.json") as JsonSchema;
    const errors = validateAgainst(
      runSchema,
      { id: "run-20260101-000000-abcdef", goal_id: "g", state: "RUNNING" },
      "schemas/run.schema.json",
      loader,
    );
    assert.ok(errors.some((e) => e.path === "$.state"), JSON.stringify(errors));
  });
});
