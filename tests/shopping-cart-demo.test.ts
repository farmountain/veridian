import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { DEFECTS, inject, repairOne, status } from "../examples/shopping-cart/defects.ts";
import { WEB_UI_VALIDATOR_NAMES, webUiValidators } from "../validators/playwright/web-ui-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The canonical demo, held to the same standard as the product it demonstrates.
 *
 * The demo is the artefact this whole repository is judged by, so it is the artefact most able to
 * rot quietly: a defect whose patch no longer matches its app, a criterion naming a validator nobody
 * registered, a `goto` pointing at a port the environment stopped using. None of those would fail a
 * `tsc` run, and all of them would present as a demo that "works" while proving nothing.
 *
 * Everything here therefore runs through the *real* pipeline and the *real* app: the real schemas,
 * the real validator family, the real ambiguity protocol, and the actual bytes of `cart.js`. The one
 * thing that is not real is the browser - which is the point. If the demo can only be checked by
 * running a 150 MB download, the demo stops being checked.
 */

const repo = nodeIo();
const cartPath = "examples/shopping-cart/app/cart.js";
const goalPath = "examples/shopping-cart/goal.yaml";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(repo));

async function readCart(): Promise<string> {
  const body = await repo.readTextFile(cartPath);
  assert.ok(body !== null, `${cartPath} is missing, so the demo has no application to validate`);
  return body;
}

/** The whole DEFINE stage, exactly as the CLI runs it: no shortcuts, no injected fakes. */
let resolved: Promise<ResolvedDefinition> | undefined;
async function define(): Promise<ResolvedDefinition> {
  resolved ??= (async () => {
    const clarifier = new ClarificationEngine({
      derive: createDeriver(defaultDeriveRules(repo)),
      user: NullPromptPort,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger: silentLogger,
    });
    const outcome = await resolveDefinition(
      repo,
      await schemas(),
      {
        goalPath,
        registry: new ValidatorRegistry(webUiValidators()),
        registeredAdapters: ["local-web"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the canonical goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

// ---- the app is the app this demo was written against -------------------------------------------------

describe("the shipped app is the correct one", () => {
  it("carries none of the three defects", async () => {
    const states = status(await readCart());

    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${cartPath}. A previous demo run was interrupted ` +
          `between injecting the defects and repairing them; run \`node examples/shopping-cart/demo.ts ` +
          `--restore-only\` to put the app back.`,
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", () => {
    for (const defect of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the
      // longer and the round trip would stop being a round trip.
      assert.ok(
        !defect.correct.includes(defect.defective),
        `${defect.id}: the defective form is a substring of the correct form`,
      );
      assert.ok(
        !defect.defective.includes(defect.correct),
        `${defect.id}: the correct form is a substring of the defective form`,
      );
      assert.notEqual(defect.correct, defect.defective, `${defect.id}: the two forms are identical`);
    }
  });

  it("names each defect once, and each defect names a criterion", () => {
    const ids = DEFECTS.map((defect) => defect.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so the report cannot name one");
    for (const defect of DEFECTS) {
      assert.match(defect.criterionId, /^AC-[0-9]{3}$/, `${defect.id} names an impossible criterion`);
      assert.ok(defect.summary.trim().length > 0, `${defect.id} has no summary for a failure report`);
    }
  });
});

// ---- injecting and repairing is a round trip -----------------------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all three, then repairs exactly one per call, in criterion order", async () => {
    const original = await readCart();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "the first injection must land every defect");
    assert.deepEqual(first.alreadyInjected, []);

    // Idempotent: a second injection is a no-op, so a re-run cannot double-patch the app.
    const second = inject(first.text);
    assert.deepEqual(second.injected, []);
    assert.equal(second.alreadyInjected.length, DEFECTS.length);
    assert.equal(second.text, first.text);

    const counts = [DEFECTS.length];
    let text = first.text;
    for (const defect of DEFECTS) {
      const step = repairOne(text);
      assert.equal(step.repaired?.id, defect.id, "repairs must follow criterion order");
      assert.equal(step.repaired?.criterionId, defect.criterionId);
      text = step.text;
      counts.push(status(text).filter((entry) => entry.state === "injected").length);
    }

    // The progression, asserted rather than described: 3, 2, 1, 0. A repair that fixed everything at
    // once would take the run from three failures straight to PASS and skip the intermediate
    // observation that shows the criteria being judged independently of one another.
    assert.deepEqual(counts, [3, 2, 1, 0]);
    assert.equal(text, original, "the round trip must return the app to exactly its checked-in bytes");

    const done = repairOne(text);
    assert.equal(done.repaired, null, "a fourth repair has nothing to do");
    assert.equal(done.text, text);
  });

  it("refuses to guess when the app is not the app this table describes", () => {
    const stranger = "// a different shopping cart entirely, with none of the three edits in it\n";

    for (const entry of status(stranger)) assert.equal(entry.state, "unknown");

    assert.throws(() => inject(stranger), /D1-quantity-ignored[\s\S]*neither the correct nor the defective/);
    assert.throws(() => repairOne(stranger), /neither the correct nor the defective/);
    assert.equal(status(stranger).length, DEFECTS.length, "every defect must be reported, not the first");
  });
});

// ---- the three documents are consistent with one another -----------------------------------------------

describe("the goal, the contract and the environment agree", () => {
  it("resolves through the real pipeline with nothing left to ask a human", async () => {
    const outcome = await define();

    for (const [name, report] of Object.entries(outcome.reports)) {
      assert.equal(
        report.questionsAsked,
        0,
        `the ${name} document left ${String(report.questionsAsked)} question(s) for a human; ` +
          "self-prompting must exhaust what derivable defaults can close before a person is asked",
      );
      assert.equal(
        report.byVia.deferred,
        0,
        `the ${name} document deferred a gap, so a rule that should have decided it did not`,
      );
    }
  });

  it("plans four mandatory criteria in the order the contract declares them", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.deepEqual(ids, DEFECTS.map((defect) => defect.criterionId).concat("AC-004"));
    assert.equal(outcome.plan.mandatory.length, 4, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "shopping-cart");
  });

  it("names only registered validators, so no expectation can fail on lookup", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(WEB_UI_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
      }
    }
  });

  it("declares the artifact every artifact-reading expectation needs", async () => {
    // An expectation on the console or the wire is INCONCLUSIVE without its artifact, and an
    // INCONCLUSIVE mandatory criterion is not a PASS. Forgetting the `evidence` entry would make the
    // demo unusable for a reason that has nothing to do with the application, so it is asserted here
    // rather than discovered during a run.
    const needs: Readonly<Record<string, EvidenceKind>> = {
      [WEB_UI_VALIDATOR_NAMES.console]: "console",
      [WEB_UI_VALIDATOR_NAMES.network]: "network",
    };

    const outcome = await define();
    for (const criterion of outcome.plan.criteria) {
      for (const expectation of criterion.expectations) {
        const artifact = needs[expectation.validator.name];
        if (artifact === undefined) continue;
        assert.ok(
          criterion.evidence.includes(artifact),
          `${criterion.criterion.id} reads the ${artifact} but does not declare it as evidence`,
        );
      }
    }
  });

  it("agrees on the address of the running app, in every place that names it", async () => {
    const outcome = await define();
    const { url, start, app, appPath } = outcome.environment;

    assert.equal(outcome.environment.adapter, "local-web");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/shopping-cart/app"), `appPath resolved to ${appPath}`);
    assert.equal(start.command, "node");

    // The readiness check is source-controlled twice - a regex here, a `write` in the server - so the
    // two are tied together. A pattern that no longer matches is an environment that never becomes
    // ready, which reads as a broken application rather than a broken contract.
    const pattern = start.readyPattern;
    assert.ok(pattern !== null, "the demo must wait for a readiness pattern rather than for a sleep");
    assert.match(
      `shopping-cart listening on ${url}`,
      new RegExp(pattern),
      "the readiness pattern does not match the line the server prints",
    );
    const server = await repo.readTextFile("examples/shopping-cart/app/serve.mjs");
    assert.ok(
      server !== null && server.includes("shopping-cart listening on"),
      "serve.mjs no longer prints the line the readiness pattern waits for",
    );
    assert.ok(
      start.args.some((arg) => arg === "serve.mjs"),
      "the environment starts something other than the static server",
    );
    const appFiles = await repo.readDir(appPath);
    assert.ok(
      appFiles.includes("index.html"),
      `the app directory holds ${appFiles.join(", ") || "nothing"}, so there is no page to observe`,
    );
    assert.ok(appFiles.includes("serve.mjs"), "the start command names a file that is not there");
    assert.ok(appFiles.includes("cart.js"), "the app has no cart.js, so the defects have nothing to edit");

    // Every step that navigates goes to the app the environment starts. A criterion pointing at a
    // stale port would fail on a connection error, which the failure taxonomy would honestly report
    // as an infrastructure failure - and the demo would be blamed for the contract's mistake.
    for (const criterion of outcome.plan.criteria) {
      const gotos = criterion.steps.filter((step) => step.kind === "goto");
      assert.ok(gotos.length > 0, `${criterion.criterion.id} never navigates anywhere`);
      for (const step of gotos) {
        assert.equal(step.url, `${url}/`, `${criterion.criterion.id} navigates to a different app`);
      }
    }
  });

  it("gives the loop room for one pass plus one iteration per defect", async () => {
    const outcome = await define();
    const needed = DEFECTS.length + 1;

    assert.ok(
      outcome.goal.limits.maxIterations >= needed,
      `maxIterations is ${String(outcome.goal.limits.maxIterations)} but the demo needs ${String(needed)}`,
    );
    assert.ok(
      outcome.goal.limits.maxRuntimeMs >= 1000 && outcome.goal.limits.maxCriterionMs >= 100,
      "the demo's limits are below the schema's own floor",
    );
    // Stated, not enforced, in this MVP: the run records the policy it was given.
    assert.equal(outcome.goal.limits.networkPolicy, "deny");
  });
});
