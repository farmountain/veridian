import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  ClarificationEngine,
  NullPromptPort,
  scriptedPromptPort,
} from "../core/clarification/engine.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { hasPointer, parentOf } from "../core/clarification/pointer.ts";
import { ambiguityId } from "../core/clarification/types.ts";
import { resolveDefinition } from "../core/definition.ts";
import { DefinitionError } from "../core/goal/index.ts";
import { memoryIo, nodeIo, type MemoryIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import type { Validator } from "../core/validation/types.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * DEFINE, end to end: a real goal file, the repository's real schemas, the real derivations, and the
 * real protocol.
 *
 * These tests exist to hold one line: *no stage proceeds past a gap, and the only way past a gap is
 * the ladder.* Everything else in the Core depends on that, because an unresolved gap that reaches
 * execution becomes a verdict nobody earned.
 */

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(nodeIo()));

const fakeValidator = (
  name: string,
  comparisons: readonly string[] = ["equals", "contains"],
): Validator => ({
  name,
  needsTarget: true,
  comparisons,
  observationKind: "web-page",
  validate: (expectation) => ({
    validator: name,
    target: typeof expectation["target"] === "string" ? expectation["target"] : null,
    status: "PASS",
    actual: null,
    expected: null,
    message: null,
  }),
});

const registry = (): ValidatorRegistry =>
  new ValidatorRegistry([fakeValidator("web.ui.text"), fakeValidator("web.ui.count")]);

const SPARSE_GOAL = 'statement: "A shopper can add an item and see the cart total update."\n';

const CRITERION = `version: 1
goal_id: goal
criteria:
  - id: AC-001
    description: "The cart count reflects the number of items added."
    steps:
      - goto: "http://127.0.0.1:4173/"
      - click: "#add-to-cart"
    expect:
      - validator: web.ui.text
        target: "#cart-count"
        equals: "1"
    evidence:
      - screenshot
`;

/**
 * Deliberately sparse too.
 *
 * `/health/path` has no schema default at all, so it is the one gap here that can only be closed by
 * the engine's own conservative default \u2014 which makes it the case that proves rung 3 is reachable
 * and not merely documented.
 */
const SPARSE_ENVIRONMENT = `adapter: local-web
app: .
start:
  command: node
  args: ["serve.mjs"]
url: "http://127.0.0.1:4173"
`;

const workspace = (files: Record<string, string>): MemoryIo =>
  memoryIo({
    "shopping-cart/goal.yaml": SPARSE_GOAL,
    "shopping-cart/acceptance.yaml": CRITERION,
    "shopping-cart/environment.yaml": SPARSE_ENVIRONMENT,
    ...files,
  });

const clarifier = (io: MemoryIo, user = NullPromptPort): ClarificationEngine =>
  new ClarificationEngine({
    derive: createDeriver(defaultDeriveRules(io)),
    user,
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
    logger: silentLogger,
  });

const define = async (io: MemoryIo, engine: ClarificationEngine, goalPath = "shopping-cart/goal.yaml") =>
  resolveDefinition(io, await schemas(), { goalPath, registry: registry(), registeredAdapters: ["local-web"] }, engine);

describe("DEFINE resolves a contract through the ambiguity protocol", () => {
  it("completes a sparse goal from values the schema already fixes, without asking anyone", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    // Every gap was closed by derivation, and every derivation cites a real location.
    assert.ok(outcome.reports.goal.records.length >= 8, "a sparse goal leaves many gaps to close");
    for (const record of outcome.reports.goal.records) {
      assert.equal(record.resolution.via, "derived", `${record.ambiguity.path} was not derived`);
      assert.match(
        (record.resolution as { evidence: string }).evidence,
        /^(schema default - schemas\/[a-z]+\.schema\.json#|derived from filename )/,
        `${record.ambiguity.path} cites evidence that cannot be checked`,
      );
    }

    // Nothing required a judgement call, so no rung past DERIVE was reached.
    assert.equal(outcome.reports.goal.byVia.defaulted, 0);
    assert.equal(outcome.reports.goal.byVia.inferred, 0);
    assert.equal(outcome.reports.goal.byVia.deferred, 0);

    // The human boundary was never crossed. This is the whole reason the ladder is ordered this way.
    assert.equal(outcome.reports.goal.questionsAsked, 0);

    assert.equal(outcome.goal.limits.maxIterations, 10);
    assert.equal(outcome.goal.limits.maxRuntimeMs, 300_000);
    assert.equal(outcome.goal.limits.networkPolicy, "deny");
    assert.equal(outcome.goal.limits.filesystemWrite, "sandbox");
    assert.equal(outcome.goal.acceptance, "acceptance.yaml");
  });

  it("resolves the acceptance contract's own version and gating rather than rejecting the file", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    assert.equal(outcome.contract.version, 1);
    // `/mandatory` is a gap that gates the verdict, so the ladder is allowed to reason about it —
    // and the schema's declared default is the answer. Filling it with `true` can only make the run
    // harder to pass, never easier, which is what makes it fail-safe.
    assert.equal(outcome.plan.criteria[0]?.criterion.mandatory, true);
    assert.equal(outcome.plan.mandatory.length, 1);
    assert.equal(outcome.plan.optional.length, 0);
  });

  it("resolves sibling paths against the goal file, not the working directory", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));
    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    assert.equal(outcome.acceptancePath, "shopping-cart/acceptance.yaml");
    assert.equal(outcome.environmentPath, "shopping-cart/environment.yaml");
  });

  it("decodes the contract into a plan the executor cannot misread", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));
    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    const plan = outcome.plan.criteria[0];
    assert.ok(plan);
    assert.deepEqual(
      plan.steps.map((step) => step.kind),
      ["goto", "click"],
    );
    assert.equal(plan.maxCriterionMs, 30_000, "the goal's per-criterion limit reaches the plan");

    // The validator is resolved to an object here, so observation time has no lookup left to fail.
    assert.equal(plan.expectations[0]?.validator.name, "web.ui.text");
    assert.deepEqual(plan.expectations[0]?.comparisons, ["equals"]);
    assert.equal(plan.expectations[0]?.target, "#cart-count");
  });
});

describe("DEFINE refuses to invent what it cannot derive", () => {
  it("reports a goal with no statement instead of producing a plan", async () => {
    const io = workspace({ "shopping-cart/goal.yaml": "acceptance: acceptance.yaml\n" });
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;

    assert.ok(
      outcome.unresolved.some((entry) => entry.path === "/statement"),
      "the missing statement must be reported as unresolved and blocking",
    );
    assert.match(outcome.reason, /statement/);
    // The turnstile: no plan, no goal, no verdict — the caller cannot proceed past the gap.
    assert.equal("plan" in outcome, false);
    assert.equal("goal" in outcome, false);
  });

  it("deferred the statement rather than guessing one", async () => {
    const io = workspace({ "shopping-cart/goal.yaml": "acceptance: acceptance.yaml\n" });
    const engine = clarifier(io);
    const outcome = await define(io, engine);

    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;

    const record = outcome.reports.goal.records.find((entry) => entry.ambiguity.path === "/statement");
    assert.ok(record);
    assert.equal(record.resolution.via, "deferred");
    // A headless run has no human to ask, so it defers. That is the anti-hang guarantee: the run
    // ends, and reports, instead of blocking forever on a question nobody will answer.
    assert.equal((record.resolution as { reason: string }).reason, "no_user_available");
  });

  it("asks exactly one question when a human is available, and uses the answer", async () => {
    const io = workspace({ "shopping-cart/goal.yaml": "acceptance: acceptance.yaml\n" });
    const user = scriptedPromptPort({
      [ambiguityId("goal", "/statement", "missing_value")]:
        "A shopper can add an item and see the cart total update.",
    });

    const outcome = await define(io, clarifier(io, user));

    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    // One question, not nine: the derivable gaps were still derived, and only the blocking
    // non-derivable one reached the human.
    assert.deepEqual(user.asked, [ambiguityId("goal", "/statement", "missing_value")]);
    assert.equal(outcome.reports.goal.byVia.answered, 1);
    assert.equal(
      outcome.goal.statement,
      "A shopper can add an item and see the cart total update.",
    );
  });

  it("reports an expectation no validator can evaluate, before anything is executed", async () => {
    const io = workspace({
      "shopping-cart/acceptance.yaml": CRITERION.replace("web.ui.text", "web.ui.textual"),
    });
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;

    assert.ok(
      outcome.unresolved.some(
        (entry) => entry.kind === "unresolvable_entity" && entry.question.includes("web.ui.textual"),
      ),
      `expected an unresolvable validator, got ${JSON.stringify(outcome.unresolved.map((e) => e.path))}`,
    );
    assert.match(outcome.reason, /web\.ui\.textual/);
  });

  it("reports a contract that contradicts itself, because one scenario cannot hold two values", async () => {
    // Same steps, same target, two expected values. This is the shape a detector without a model of
    // the application can *prove* unsatisfiable: whatever the application does, one observation
    // cannot be both "1" and "2".
    const contradicting = `${CRITERION}  - id: AC-002
    description: "A second criterion reads the same observable, in the same scenario, differently."
    steps:
      - goto: "http://127.0.0.1:4173/"
      - click: "#add-to-cart"
    expect:
      - validator: web.ui.text
        target: "#cart-count"
        equals: "2"
    evidence:
      - screenshot
`;
    const io = workspace({ "shopping-cart/acceptance.yaml": contradicting });
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;
    assert.ok(outcome.unresolved.some((entry) => entry.kind === "conflicting"));
  });

  it("accepts one observable holding different values in different scenarios", async () => {
    // The ordinary shape of an acceptance contract, and the shape that made a detector comparing
    // (validator, target) pairs alone report correct contracts as unsatisfiable: add an item and see
    // one row, then add and remove it and see none. Both statements are true of the same selector, at
    // different moments, and only the steps distinguish them.
    const twoScenarios = `${CRITERION}  - id: AC-002
    description: "The cart is empty again once the line is removed."
    steps:
      - goto: "http://127.0.0.1:4173/"
      - click: "#add-to-cart"
      - click: "#remove-item"
    expect:
      - validator: web.ui.text
        target: "#cart-count"
        equals: "0"
    evidence:
      - screenshot
`;
    const io = workspace({ "shopping-cart/acceptance.yaml": twoScenarios });
    const outcome = await define(io, clarifier(io));

    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `a contract whose criteria differ only by their steps must resolve: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") return;
    assert.equal(outcome.plan.criteria.length, 2);
  });

  it("names every gap at a path that resolves to a place in the document", async () => {
    // A path is not decoration: the engine writes a resolution to it and the failure report quotes it
    // to whoever has to fix the contract. A pointer built by escaping an already-escaped pointer names
    // a key called `/criteria/2`, sits in no container, and reads as a document nobody wrote.
    const io = workspace({
      "shopping-cart/acceptance.yaml": CRITERION.replace('        target: "#cart-count"\n', ""),
    });
    const outcome = await define(io, clarifier(io));
    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;

    const document: unknown = parseYaml((await io.readTextFile("shopping-cart/acceptance.yaml")) ?? "");
    const reported = [...outcome.unresolved, ...outcome.deferred];
    assert.ok(reported.length > 0, "a contract with no target and no mandatory flag must report both");

    for (const entry of reported) {
      assert.ok(
        !entry.path.includes("~1"),
        `${entry.path} (${entry.kind}) carries an escaped separator, so it names one key rather than a path`,
      );
      // The leaf may legitimately be absent - that is the gap - but its container must exist, or
      // nothing the engine writes there is part of this document.
      assert.ok(
        hasPointer(document, parentOf(entry.path)),
        `${entry.path} (${entry.kind}) sits in a container that does not exist, so a resolution would be written into a document of its own`,
      );
    }
  });

  it("refuses a contract written for a different goal, since the verdict would mean nothing", async () => {
    const io = workspace({
      "shopping-cart/acceptance.yaml": CRITERION.replace("goal_id: goal", "goal_id: some-other-goal"),
    });

    await assert.rejects(
      () => define(io, clarifier(io)),
      (error: unknown) => {
        assert.ok(error instanceof DefinitionError, `expected a DefinitionError, got ${String(error)}`);
        assert.match(error.message, /some-other-goal/);
        assert.match(error.message, /goal/);
        return true;
      },
    );
  });
});

describe("DEFINE resolves the environment through the same conversation", () => {
  it("builds a plan with no optional fields from a sparse environment file", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    const environment = outcome.environment;
    assert.equal(environment.adapter, "local-web");
    assert.deepEqual(environment.start.args, ["serve.mjs"]);
    assert.equal(environment.reset.strategy, "restart");
    assert.equal(environment.browser.enabled, true);
    assert.equal(environment.health.expectStatus, 200);
    assert.equal(environment.health.timeoutMs, 20_000);

    // No schema default exists for `health.path`, so this one had to come from the engine's own
    // conservative choice. The two rungs differ in kind, and the report must show which was used.
    assert.equal(environment.health.path, "/");
    const pathRecord = outcome.reports.environment.records.find(
      (entry) => entry.ambiguity.path === "/health/path",
    );
    assert.ok(pathRecord);
    assert.equal(pathRecord.resolution.via, "defaulted");
    assert.match((pathRecord.resolution as { assumption: string }).assumption, /ENVIRONMENT_FAILURE/);

    const statusRecord = outcome.reports.environment.records.find(
      (entry) => entry.ambiguity.path === "/health/expectStatus",
    );
    assert.ok(statusRecord);
    assert.equal(statusRecord.resolution.via, "derived");
    assert.match(
      (statusRecord.resolution as { evidence: string }).evidence,
      /schemas\/environment\.schema\.json#/,
    );
  });

  it("resolves the application directory against the environment file", async () => {
    const io = workspace({});
    const outcome = await define(io, clarifier(io));
    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    // `app: .` is relative to the environment file, not to the process working directory.
    assert.equal(outcome.environment.appPath, "shopping-cart");
    assert.equal(outcome.environmentPath, "shopping-cart/environment.yaml");
  });

  it("derives the start command from the application's own manifest when the file omits it", async () => {
    const io = workspace({
      "shopping-cart/environment.yaml": SPARSE_ENVIRONMENT.replace(
        'start:\n  command: node\n  args: ["serve.mjs"]\n',
        "",
      ),
      "shopping-cart/package.json": JSON.stringify({ scripts: { serve: "node serve.mjs" } }),
    });
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") return;

    assert.equal(outcome.environment.start.command, "npm");
    assert.deepEqual(outcome.environment.start.args, ["run", "serve"]);

    const record = outcome.reports.environment.records.find((entry) => entry.ambiguity.path === "/start");
    assert.ok(record);
    assert.equal(record.resolution.via, "derived");
    // The citation is what makes the derivation checkable rather than plausible-looking.
    assert.match(
      (record.resolution as { evidence: string }).evidence,
      /shopping-cart\/package\.json#scripts\.serve/,
    );
  });

  it("refuses to invent a start command when the manifest offers no preference", async () => {
    const io = workspace({
      "shopping-cart/environment.yaml": SPARSE_ENVIRONMENT.replace(
        'start:\n  command: node\n  args: ["serve.mjs"]\n',
        "",
      ),
      "shopping-cart/package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
    });
    const outcome = await define(io, clarifier(io));

    // A world whose entry point is unknown is a world that must not be entered, and guessing a
    // command here would produce an ENVIRONMENT_FAILURE blaming the application for Veridian's guess.
    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;
    assert.ok(outcome.unresolved.some((entry) => entry.path === "/start"));
  });

  it("says so when an environment names an adapter that will never run it", async () => {
    const io = workspace({
      "shopping-cart/environment.yaml": SPARSE_ENVIRONMENT.replace("local-web", "kubernetes"),
    });
    const outcome = await define(io, clarifier(io));

    assert.equal(outcome.kind, "incomplete");
    if (outcome.kind !== "incomplete") return;

    const record = outcome.unresolved.find((entry) => entry.path === "/adapter");
    assert.ok(record);
    assert.equal(record.kind, "unresolvable_entity");
    assert.deepEqual(record.candidates, ["local-web"]);
  });
});

describe("DEFINE is deterministic", () => {
  it("produces identical ids and identities when the same definition is resolved twice", async () => {
    const first = await define(workspace({}), clarifier(workspace({})));
    const second = await define(workspace({}), clarifier(workspace({})));

    assert.equal(first.kind, "resolved");
    assert.equal(second.kind, "resolved");
    if (first.kind !== "resolved" || second.kind !== "resolved") return;

    // M1 depends on this: a repeat run must raise the same gaps and reach the same conclusions.
    assert.deepEqual(
      first.reports.goal.records.map((entry) => [entry.ambiguity.id, entry.resolution.via]),
      second.reports.goal.records.map((entry) => [entry.ambiguity.id, entry.resolution.via]),
    );
    assert.deepEqual(first.goal, second.goal);
  });
});
