import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalizeEnvironment } from "../core/environment/index.ts";
import type { GoalLimits } from "../core/goal/index.ts";
import { resolveSibling } from "../core/goal/load.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";

/**
 * The directories a contract may read and may never write, decoded.
 *
 * ## Why this is a product change and not a convenience field
 *
 * A `local-process` contract could previously read exactly two places: its own application directory
 * and its sandbox. That pair is correct for a world that deploys a program and judges what it wrote,
 * and it made an entire class of question unaskable - *what is the reality of the tree I am actually
 * working in*. Pointing `root` at that tree is not an answer, because `root` is emptied on every
 * reset, so a world rooted there would delete the code under test on its first iteration.
 *
 * The rule this field preserves rather than relaxes is the one `local-process` states in its own
 * source: a path outside the root is **refused rather than resolved**, because opening the developer's
 * own filesystem while calling it the sandbox's is the worst thing this world could do silently. What
 * changes is only that the operator may now *declare* additional read surfaces, and a declaration is
 * exactly what makes the difference between a boundary and an accident.
 *
 * ## What is asserted here, and what is deliberately asserted elsewhere
 *
 * This file holds the **decoding**: what a document's `observe` becomes, and which documents are
 * refused for naming nothing rather than being quietly dropped. The read-only half cannot be settled
 * here at all - whether a write into an observed tree is really refused is a fact about the runtime,
 * so it is asserted where a real child is really started
 * (`tests/local-process-environment.test.ts` for the allowance, and the example's own contract for the
 * refusal itself). A test of the loader cannot produce a filesystem denial, and pretending otherwise
 * would be the shape this repository refuses: a green reading about something the test never did.
 */

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(nodeIo()));

/** Loaded once, because `finalizeEnvironment` is synchronous and asserts against the real schemas. */
const SET = await schemas();

/** The environment file this document lives in. `app` is relative to it, and so is everything after. */
const SOURCE = { path: "examples/audit/environment.yaml", dir: "examples/audit", text: "" };

/** `app` resolved the way the loader resolves it, so a relative expectation is not restated. */
const APP_PATH = resolveSibling(SOURCE, "app");

const LIMITS: GoalLimits = {
  maxIterations: 2,
  maxRuntimeMs: 60_000,
  maxCriterionMs: 30_000,
  networkPolicy: "deny",
  networkAllowList: [],
  filesystemWrite: "sandbox",
};

/** A process world, with `observe` present only when a case is about it. */
function document(observe?: unknown): Record<string, unknown> {
  return {
    adapter: "local-process",
    app: "app",
    start: { command: "node", args: ["audit.mjs"] },
    process: {
      host: "audit-host",
      root: "sandbox",
      ...(observe === undefined ? {} : { observe }),
    },
  };
}

/** The plan a document decodes to. Throws whatever the loader throws, which is what some cases assert. */
function planFor(observe?: unknown) {
  return finalizeEnvironment(document(observe), SET, SOURCE, LIMITS);
}

describe("process.observe: the read surface a document may declare", () => {
  it("resolves an absolute member as itself, so a workspace anywhere on this machine is nameable", () => {
    // Nothing relative about it: the operator named a place, and a loader that re-rooted an absolute
    // path would judge the contract against a directory nobody chose.
    const plan = planFor(["/the/operators/tree"]);
    assert.deepEqual(plan.process?.observe, ["/the/operators/tree"]);
  });

  it("resolves a relative member against the application directory, like every other path here", () => {
    // The same rule `root` and `databasePath` follow, stated once - so a contract that sits beside the
    // tree it audits can name it relatively and does not carry a machine's absolute path in its
    // document.
    const plan = planFor(["../.."]);
    assert.deepEqual(plan.process?.observe, [
      resolveSibling({ dir: APP_PATH, path: "", text: "" }, "../.."),
    ]);
  });

  it("resolves each member independently, so a document may name several places with either spelling", () => {
    const plan = planFor(["/first", "../second"]);
    assert.deepEqual(plan.process?.observe, [
      "/first",
      resolveSibling({ dir: APP_PATH, path: "", text: "" }, "../second"),
    ]);
  });

  it("treats absent and empty as the same reading, which is the one every earlier contract had", () => {
    // Deliberately not distinguished. A field whose absence meant one thing and whose empty array meant
    // another would be a difference no reading could observe, and this repository refuses a vocabulary
    // with a member nothing can distinguish.
    assert.deepEqual(planFor(undefined).process?.observe, []);
    assert.deepEqual(planFor([]).process?.observe, []);
  });

  it("refuses a blank member by name rather than skipping it", () => {
    // Skipping would hand the run a smaller allowance than the document declared, and the failure would
    // surface later as a criterion reporting that an application could not read a file the operator
    // believes they granted. Naming the entry is the only place that can be reported with the operator's
    // own document in hand.
    assert.throws(
      () => planFor(["/ok", "   "]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /process\.observe\[1\]/u);
        return true;
      },
    );
  });

  it("refuses a member that is not a string at all", () => {
    assert.throws(
      () => planFor([42]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /process\.observe\[0\]/u);
        return true;
      },
    );
  });

  it("refuses a value that is not a list, at the schema, before the loader ever sees it", () => {
    // A single string is the plausible mistake - `observe: "/tree"` reads correctly to a human - and it
    // is refused rather than coerced: a loader that accepted both spellings would be a second grammar
    // for one field.
    //
    // The assertion names the **schema's** message rather than the loader's, and that is a measurement
    // rather than a preference. `finalizeEnvironment` asserts against the schema on its first line, so
    // the type is settled before `readObserve` runs and the loader's own guard for it is unreachable
    // through this entry point. The guard is kept anyway - it is the same rejection one layer up, and
    // `readApplication` beside it holds the identical one - but a test may only claim the layer that
    // actually spoke, and this one spoke first.
    assert.throws(
      () => planFor("/the/operators/tree"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /\$\.process\.observe: expected array, received string/u);
        return true;
      },
    );
  });

  it("leaves every other world's plan without the field, because no other world may read outside itself", () => {
    // The field is on `process` and nowhere else, which is the interesting half of the design: the
    // six `sim-*` worlds already have a subject of their own to judge, and widening their reach would
    // be widening a boundary for no question it answers.
    const api = finalizeEnvironment(
      { adapter: "local-api", app: "app", url: "http://127.0.0.1:9", start: { command: "node", args: ["x.mjs"] } },
      SET,
      SOURCE,
      LIMITS,
    );
    assert.equal(api.process, null);
  });
});
