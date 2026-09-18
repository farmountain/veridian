/**
 * The `mobile` block of an environment document: what the loader reads out of it, and the spellings
 * it refuses.
 *
 * The twelfth world block, and the fourth whose subject is a *device* rather than a system, a cluster
 * or an account. Three facts are read - the device identity a reading names, the platform that decides
 * how a path inside the device's own storage is spelled, and the sandbox root on this machine the
 * world's bundles and its device state live in - and the interesting half of this file is not that
 * they parse. It is *which layer refuses which spelling*, asserted rather than assumed, because
 * `schemas/environment.schema.json` and `core/environment/load.ts` both refuse some of the same
 * spellings and the schema refuses them **first**: `finalizeEnvironment` asserts the document against
 * the strict schema before it reads a single field. `SchemaViolationError` is not a `DefinitionError`,
 * and which of the two is thrown is exactly which half of the pair is load-bearing.
 *
 * That distinction is why the refusal below names both the path and the error's own type rather than
 * only a message. A test that asserted the loader's sentence would describe a guard the run never
 * reaches for a validated document, and would break for the wrong reason the day a schema constraint
 * moved.
 *
 * The refusals only the loader can make are the ones `minLength: 1` cannot see - a `device` of
 * `"   "`, a `root` of `"   "` - and they are asserted beside the schema refusals rather than in place
 * of them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalizeEnvironment } from "../core/environment/index.ts";
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
  path: "examples/sim-mobile/environment.yaml",
  dir: "examples/sim-mobile",
  text: "",
};

/**
 * A document that is valid apart from the `mobile` block under test, so a refusal can only be about
 * one of the three fields this file is about. `mobile` is omitted rather than set when the caller
 * passes `undefined`, because "no block" and "a null block" are two spellings this file asserts
 * separately.
 */
const documentWith = (mobile: unknown): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    adapter: "sim-mobile",
    app: "app",
    start: { command: "node", args: ["app/provision.mjs"] },
  };
  return mobile === undefined ? base : { ...base, mobile };
};

const readPlan = async (mobile: unknown) =>
  finalizeEnvironment(documentWith(mobile), await schemas(), SOURCE, LIMITS);

/**
 * The error a document raises, or a failure naming what was planned instead.
 *
 * The acceptance branch throws outside the `try` on purpose: an `assert.fail` placed inside it would
 * be caught by the very catch that exists to hand back a refusal, and the test would then report the
 * assertion as the refusal it was looking for.
 */
const refused = async (mobile: unknown): Promise<Error> => {
  try {
    await readPlan(mobile);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`the document was accepted where a refusal was expected: ${JSON.stringify(mobile)}`);
};

/** A schema refusal: the path, and the constraint that produced it rather than the reader that would have. */
const assertSchemaRefused = (error: Error, what: string, path: string, keyword: string): void => {
  assert.ok(
    error instanceof SchemaViolationError,
    `${what} was accepted by the schema and read ${error.name}: ${error.message}`,
  );
  const match = error.errors.find((entry) => entry.path === path && entry.keyword === keyword);
  assert.ok(
    match !== undefined,
    `${what}: expected ${path} refused for ${keyword}, and the schema filed ${error.errors
      .map((entry) => `${entry.path} (${entry.keyword})`)
      .join(", ")}`,
  );
};

/** A loader refusal: exactly one defect, at the path this file names. Returns it for the caller. */
const assertLoaderRefused = (error: Error, path: string, message: RegExp): DefinitionError => {
  assert.ok(error instanceof DefinitionError, `expected a DefinitionError and read ${error.name}: ${error.message}`);
  assert.equal(
    error.errors.length,
    1,
    `the loader files one defect per refusal, and filed ${String(error.errors.length)}`,
  );
  const [first] = error.errors;
  assert.ok(first !== undefined);
  assert.equal(first.path, path);
  assert.match(first.message, message);
  return error;
};

describe("the mobile block is read into the plan", () => {
  it("reads the device and the platform, and resolves the sandbox root against the application", async () => {
    const plan = await readPlan({ device: "sim-cart-device", platform: "android", root: "sandbox" });
    assert.equal(plan.mobile?.device, "sim-cart-device");
    assert.equal(plan.mobile?.platform, "android");
    // Resolved against `appPath`, not against the process working directory - the same rule
    // `container.root`, `vscode.root` and `process.root` follow, and the reason a plan can state a
    // path every reader of the bundle can open.
    assert.equal(plan.mobile?.root, "examples/sim-mobile/app/sandbox");
  });

  it("refuses a platform this substitution does not implement, and names the one it does", async () => {
    const error = await refused({ device: "sim-cart-device", platform: "ios", root: "sandbox" });
    // Measured rather than assumed, and the measurement is the finding: the schema states `platform`
    // as an `enum` and is asserted before any field is read, so the refusal a *validated* document
    // reaches is the schema's. `readMobile` validates the vocabulary a second time only so that the
    // reason is readable in the loader rather than arriving as a JSON pointer and a keyword - which
    // makes that second check unreachable from a document the schema has already judged, exactly as
    // `readContainer`'s `CONTAINER_PLATFORMS` check and `readOs`'s `OS_FAMILIES` check already are.
    assertSchemaRefused(error, "an unimplemented platform", "$.mobile.platform", "enum");
    assert.match(error.message, /android/);
  });

  it("refuses a device or a root that is only whitespace, which the schema cannot see", async () => {
    const blankDevice = await refused({ device: "   ", platform: "android", root: "sandbox" });
    assertLoaderRefused(blankDevice, "$.mobile.device", /missing device/);
    const blankRoot = await refused({ device: "sim-cart-device", platform: "android", root: "   " });
    assertLoaderRefused(blankRoot, "$.mobile.root", /missing root/);
  });

  it("plans no device for a document that declares neither an omitted block nor a null one", async () => {
    for (const mobile of [undefined, null]) {
      const plan = await readPlan(mobile);
      assert.equal(plan.mobile, null);
    }
  });
});
