import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STEP_CODEC_COVERAGE, STEP_KINDS, WAIT_STATES, decodeStep, encodeStep } from "../core/acceptance/plan.ts";
import type { ValidationStep } from "../core/acceptance/plan.ts";
import { nodeIo } from "../core/io.ts";

/**
 * The step register and `schemas/acceptance.schema.json` must describe the same set of actions.
 *
 * The register itself is `core/acceptance/steps.ts`; this file is the guard that holds it to the
 * schema, and it is the reason the register could replace a hand-kept list without losing a check.
 * `tests/schema-vocabulary.test.ts` holds the vocabularies a schema writes out as an `enum`. The
 * step register is not one of those and could not be: a step is a *single-key object*, so the schema
 * states its members as `oneOf` branches whose `required` key is the action name, and there is no
 * `enum` anywhere for the other guard to find. That is why this file exists. `apply` was added for
 * the cluster world and `run` for the system world, and before the register each of those was an
 * entry in a nine-string list plus a `case` in two switches - the kind `decodeStep` accepted and the
 * schema rejected, or the reverse, was one forgotten edit away. *A list written in three places is
 * reconciled by nothing.*
 *
 * The second half is the executable half. A register that agrees with its schema and whose decoder
 * cannot decode every member is still broken, and the failure is invisible until a contract uses the
 * one kind nobody tried. So every kind is decoded, round-tripped through `encodeStep`, and re-decoded,
 * with the wire shape checked against the schema's own branch - a step whose shape the schema would
 * refuse is a step no operator could have written, which makes it a kind this build cannot honour
 * rather than a kind it supports.
 */

const repo = nodeIo();

/** The wire shapes the schema's `Step.oneOf` accepts: one required key each, nothing else allowed. */
async function schemaStepBranches(): Promise<Map<string, Set<string>>> {
  const body = await repo.readTextFile("schemas/acceptance.schema.json");
  assert.ok(body !== null, "schemas/acceptance.schema.json could not be read");

  const document = JSON.parse(body) as { $defs?: Record<string, unknown> };
  const step = document.$defs?.["Step"];
  assert.ok(step !== undefined, "acceptance.schema.json no longer defines $defs.Step");

  const branches = (step as { oneOf?: unknown[] }).oneOf;
  assert.ok(Array.isArray(branches) && branches.length > 0, "$defs.Step has no oneOf branches");

  const found = new Map<string, Set<string>>();
  for (const branch of branches) {
    const object = branch as { required?: unknown[]; properties?: Record<string, unknown>; additionalProperties?: unknown };
    const required = object.required;
    assert.ok(
      Array.isArray(required) && required.length === 1,
      "every Step branch must require exactly one action key, or a step could name two actions " +
        "that the decoder will refuse for a reason the schema did not mention",
    );
    const key = String(required[0]);

    // `additionalProperties: false` is what makes the key *the* action rather than one of several
    // fields. Without it a step could carry `sql` and `click` at once, which `decodeStep` rejects as
    // naming two actions - so the schema would accept a contract the engine calls a defect.
    assert.equal(
      object.additionalProperties,
      false,
      `the Step branch for "${key}" allows extra properties, so it is not a single-action step`,
    );
    assert.ok(
      object.properties !== undefined && key in object.properties,
      `the Step branch for "${key}" requires a key it does not describe`,
    );
    assert.ok(!found.has(key), `"${key}" appears in two Step branches`);
    found.set(key, new Set(Object.keys(object.properties ?? {})));
  }
  return found;
}

/** Wire records that exercise every branch, keyed by the kind they decode to. */
const WIRE: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  goto: { goto: "http://127.0.0.1:4173/" },
  click: { click: "#add" },
  reload: { reload: {} },
  fill: { fill: { target: "#qty", value: "2" } },
  select: { select: { target: "#size", value: "large" } },
  press: { press: { target: "#qty", key: "Enter" } },
  waitFor: { waitFor: { target: "#total", state: "visible" } },
  sql: { sql: "SELECT COUNT(*) FROM cart_items" },
  apply: { apply: "manifests/deployment.yaml" },
  run: { run: ["cat", "/etc/veridian/secret.conf"] },
};

describe("the step register describes every world's actions", () => {
  it("lists exactly the kinds the schema accepts, in both directions", async () => {
    const branches = await schemaStepBranches();
    assert.deepEqual(
      [...branches.keys()].sort(),
      [...STEP_KINDS].sort(),
      "STEP_KINDS and $defs.Step disagree. " +
        `In the schema and not in the code: ${[...branches.keys()].filter((k) => !(STEP_KINDS as readonly string[]).includes(k)).join(", ") || "(none)"}. ` +
        `In the code and not in the schema: ${(STEP_KINDS as readonly string[]).filter((k) => !branches.has(k)).join(", ") || "(none)"}.`,
    );
  });

  it("leaves nothing in the register without a wire record to decode", () => {
    // A kind in the register with no fixture here would let the loop below quietly test eight of
    // nine actions while reporting that it tested the register.
    assert.deepEqual([...Object.keys(WIRE)].sort(), [...STEP_KINDS].sort());
  });

  it("decodes every kind and round-trips it back to the same shape", () => {
    for (const kind of STEP_KINDS) {
      const wire = WIRE[kind];
      assert.ok(wire !== undefined, kind);
      const decoded = decodeStep(wire, "AC-001", 0);
      assert.equal(decoded.kind, kind);
      const reencoded = encodeStep(decoded);
      // Round-trip through the decoder again, so the assertion is "the encoder's output is something
      // the decoder accepts" rather than a string comparison of two objects written on one line.
      const again = decodeStep(reencoded, "AC-001", 0);
      assert.deepEqual(again, decoded, `${kind} does not survive a round trip`);
    }
  });

  it("refuses a step naming two actions, which is why the schema forbids the extra key", () => {
    assert.throws(
      () => decodeStep({ click: "#add", sql: "SELECT 1" }, "AC-001", 0),
      /a step must name exactly one action; found click, sql/,
    );
  });

  it("refuses a step naming no action at all", () => {
    assert.throws(
      () => decodeStep({}, "AC-001", 0),
      /a step must name exactly one action; found none/,
    );
  });

  it("only puts a string where the schema's branch says a string goes", async () => {
    // `reload` is the one branch whose value the schema types as a boolean, and the decoder ignores
    // it - `reload` has no server state, so the value is a marker rather than an argument. Asserting
    // the *types* keeps a future branch from being added as a string where the schema says object.
    const branches = await schemaStepBranches();
    assert.deepEqual([...(branches.get("reload") ?? [])], ["reload"]);
    assert.deepEqual([...(branches.get("fill") ?? [])], ["fill"]);
    for (const kind of STEP_KINDS) {
      const properties = branches.get(kind);
      assert.ok(properties !== undefined && properties.size >= 1, kind);
      const value = (WIRE[kind] ?? {})[kind];
      assert.notEqual(value, undefined, `${kind}'s fixture does not carry its own key`);
    }
  });

  it("keeps the wait states the decoder defaults to inside the schema's list", async () => {
    const body = await repo.readTextFile("schemas/acceptance.schema.json");
    assert.ok(body !== null, "schemas/acceptance.schema.json could not be read");
    const document = JSON.parse(body) as { $defs?: Record<string, { oneOf?: unknown[] }> };
    const branches = document.$defs?.["Step"]?.oneOf ?? [];
    const wait = branches
      .map((branch) => branch as { required?: unknown[]; properties?: Record<string, { properties?: Record<string, { enum?: unknown[] }> }> })
      .find((branch) => branch.required?.[0] === "waitFor");
    assert.ok(wait !== undefined, "no waitFor branch");
    const declared = wait.properties?.["waitFor"]?.properties?.["state"]?.enum;
    assert.ok(Array.isArray(declared), "waitFor.state has no enum, so the decoder and the schema cannot be compared");
    assert.deepEqual([...declared], [...WAIT_STATES]);
  });

  it("decodes a step of every kind into a shape the schema would accept", async () => {
    // The schema is the operator's contract, so the assertion that matters is not "the decoder
    // returned something" but "the decoder returned something an operator could have written". The
    // check is structural rather than a full JSON Schema validation, because the interesting failure
    // is a *key* the branch does not describe - `encodeStep` writing `value` where the schema said
    // `key`, which is how a contract and an adapter come to disagree while both look correct.
    const branches = await schemaStepBranches();
    for (const kind of STEP_KINDS) {
      const record = encodeStep(decodeStep(WIRE[kind] ?? {}, "AC-001", 0));
      const expectedKeys = branches.get(kind) ?? new Set<string>();
      assert.deepEqual([...Object.keys(record)].sort(), [...expectedKeys].sort(), kind);
    }
  });
});

describe("the decode of a kind is total, not partial", () => {
  it("narrows every member of the register, leaving no kind without a codec", () => {
    // The switch that used to live in `decodeStep` had no `default`, so a kind added to `STEP_KINDS`
    // and not to the switch was a type error rather than a runtime hole. The register keeps that
    // guarantee in a stronger form - `STEP_CODEC_COVERAGE` is a `Record<StepKind, true>`, so a member
    // of the union with no entry is a typecheck failure - and this asserts the *observable* half:
    // the coverage record and the derived list are the same set, and every kind decodes to itself.
    assert.deepEqual(
      Object.keys(STEP_CODEC_COVERAGE).sort(),
      [...STEP_KINDS].sort(),
      "STEP_KINDS is derived from the register, so a kind in one and not the other means the " +
        "coverage record and the codec table were edited apart",
    );
    const kinds = STEP_KINDS.map((kind) => decodeStep(WIRE[kind] ?? {}, "AC-001", 0).kind);
    assert.deepEqual([...kinds].sort(), [...STEP_KINDS].sort());
    const steps: readonly ValidationStep[] = STEP_KINDS.map((kind) => decodeStep(WIRE[kind] ?? {}, "AC-001", 0));
    assert.equal(steps.length, STEP_KINDS.length);
  });

  it("refuses an argument vector that is empty or carries a blank", () => {
    // `run` is the only branch whose value is an array, and an empty one is the interesting
    // refusal: `[]` would spawn nothing and exit 0, which a criterion would read as "the command
    // succeeded" - a pass earned by never running the command.
    assert.throws(() => decodeStep({ run: [] }, "AC-001", 0), /run must be a non-empty array/);
    assert.throws(() => decodeStep({ run: ["cat", ""] }, "AC-001", 0), /run\[1\] must be a non-empty string/);
    assert.throws(() => decodeStep({ run: "cat /etc/shadow" }, "AC-001", 0), /run must be a non-empty array/);
    const parsed = decodeStep({ run: ["cat", "/etc/shadow"] }, "AC-001", 0);
    assert.deepEqual(parsed, { kind: "run", argv: ["cat", "/etc/shadow"] });
  });
});
