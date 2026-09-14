import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { DB_OBSERVATION_KIND } from "../core/environment/db-observation.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { DEFECTS, inject, repairOne, status } from "../examples/inventory-db/defects.ts";
import { DB_VALIDATOR_NAMES, dbValidators } from "../validators/database/db-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The second demo, held to the same standard as the first.
 *
 * `examples/inventory-db/demo.ts` claims in its own header that this file fails loudly if the restore
 * ever stops working. That claim is the reason this file exists, and it is asserted below rather than
 * left as a sentence in a doc comment - a citation of a test that does not exist is the same class of
 * defect as a validator that reports a pass it did not observe.
 *
 * Beyond the restore, everything here is about the property the whole example was written to prove:
 * **the world is a seam, not a browser.** No port, no page, no console, no process to keep alive -
 * and yet the same DEFINE pipeline, the same plan, the same validator registry and the same evidence
 * kinds. If any of that had quietly assumed HTTP, one of these assertions would be the one that says
 * so.
 */

const repo = nodeIo();
const buildPath = "examples/inventory-db/app/build.mjs";
const goalPath = "examples/inventory-db/goal.yaml";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(repo));

async function readBuild(): Promise<string> {
  const body = await repo.readTextFile(buildPath);
  assert.ok(body !== null, `${buildPath} is missing, so the demo has no application to validate`);
  return body;
}

/** The whole DEFINE stage, exactly as the CLI runs it: the real schemas, the real validator family. */
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
        registry: new ValidatorRegistry(dbValidators()),
        registeredAdapters: ["local-db"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the inventory goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

// ---- the shipped application is the correct one --------------------------------------------------------

describe("the shipped build script is the correct one", () => {
  it("carries none of the three defects", async () => {
    const states = status(await readBuild());

    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${buildPath}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/inventory-db/demo.ts " +
          "--restore-only` to put the script back.",
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", () => {
    for (const defect of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the
      // longer and the round trip would stop being a round trip.
      //
      // D1 is the reason this assertion is not vacuous: `quantityOnHand: 30,` is a *prefix* of
      // `quantityOnHand: 300,` once the trailing punctuation is removed, and without it the correct
      // form would be found inside the defective one - the injection would be a no-op that reported
      // success, and the state would read `unknown`. The comma is load-bearing, not style.
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

  it("names each defect once, and each defect names the criterion that catches it", () => {
    const ids = DEFECTS.map((defect) => defect.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so the report cannot name one");

    const criteria = DEFECTS.map((defect) => defect.criterionId);
    assert.equal(
      new Set(criteria).size,
      criteria.length,
      "two defects claim the same criterion, so a repair that fixed neither could still look like " +
        "progress - the failure count would fall by one either way",
    );

    for (const defect of DEFECTS) {
      assert.match(defect.criterionId, /^AC-[0-9]{3}$/, `${defect.id} names an impossible criterion`);
      assert.ok(defect.summary.trim().length > 0, `${defect.id} has no summary for a failure report`);
    }
  });

  it("fails exactly the criterion each defect names, and no other", async () => {
    // The discrimination claim, checked against the *contract's* own criteria rather than against a
    // hand-written list: every criterion the demo asserts on is either the one some defect breaks or
    // AC-004, which no defect touches. A defect that broke a second criterion would make the run's
    // progression (one repair, one failure removed) a coincidence rather than a measurement.
    const outcome = await define();
    const broken = new Set(DEFECTS.map((defect) => defect.criterionId));
    const planned = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.equal(planned.length, DEFECTS.length + 1, `the contract plans ${planned.join(", ")}`);
    for (const id of broken) {
      assert.ok(planned.includes(id), `${id} is named by a defect but the contract does not declare it`);
    }
    const untouched = planned.filter((id) => !broken.has(id));
    assert.deepEqual(
      untouched,
      ["AC-004"],
      "exactly one criterion must be independent of the defects; the run needs something that passes " +
        "from the first iteration, or a green world is indistinguishable from a world nobody judged",
    );
  });
});

// ---- injecting and repairing is a round trip -----------------------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all three, then repairs exactly one per call, in criterion order", async () => {
    const original = await readBuild();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "the first injection must land every defect");
    assert.deepEqual(first.alreadyInjected, []);

    // Idempotent: a second injection is a no-op, so a re-run cannot double-patch the script.
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
    // observations that show the criteria being judged independently of one another.
    assert.deepEqual(counts, [3, 2, 1, 0]);
    assert.equal(text, original, "the round trip must return the script to exactly its checked-in bytes");

    const done = repairOne(text);
    assert.equal(done.repaired, null, "a fourth repair has nothing to do");
    assert.equal(done.text, text);
  });

  it("refuses to guess when the script is not the script this table describes", () => {
    const stranger = "// a different build script, with none of the three edits in it\n";

    for (const entry of status(stranger)) assert.equal(entry.state, "unknown");

    assert.throws(() => inject(stranger), /neither the correct nor the defective/);
    assert.throws(() => repairOne(stranger), /neither the correct nor the defective/);
    assert.equal(status(stranger).length, DEFECTS.length, "every defect must be reported, not the first");
  });

  it("is ending-insensitive by construction, which is why the rule is tested elsewhere", async () => {
    // The rule this project paid for: a textual overlay authored with `\n` against a CRLF checkout
    // matches nothing, and the run then reports a PASS the application never earned.
    //
    // **That rule cannot be exercised by this demo, and this test says so instead of pretending
    // otherwise.** Every block in this table is a single line, so `newlineOf`/`inStyle` never reach
    // it and the file's ending cannot change the outcome. Measured rather than asserted: with
    // `newlineOf` replaced by a function that always returns `"\n"`, the whole suite still passed.
    // The rule is therefore held by `tests/defect-text.test.ts`, against the shared implementation
    // with synthetic multi-line blocks, where breaking it is actually detectable.
    //
    // What is worth holding *here* is the consequence: this table is ending-insensitive, so the
    // database demo behaves identically on an LF checkout and a CRLF one.
    for (const entry of DEFECTS) {
      assert.ok(
        !entry.correct.includes("\n") && !entry.defective.includes("\n"),
        `${entry.id} is multi-line, so this demo now depends on the file's line ending and ` +
          "`tests/defect-text.test.ts` is no longer the only place that rule is held",
      );
    }

    // And the file's own ending is a property of the *checkout*, not of this repository:
    // `git ls-files --eol` reports the committed blob as `lf` while a Windows worktree is `crlf`,
    // because `core.autocrlf` differs per platform and there is no `.gitattributes`. The first
    // version of this test asserted `\r\n` and could therefore never pass on `ubuntu-latest`. It
    // asserts the file's *presence* and that its ending is *consistent* - two facts that hold
    // everywhere - rather than naming one ending and proving nothing on the other.
    const body = await readBuild();
    const crlf = (body.match(/\r\n/g) ?? []).length;
    const lf = (body.match(/\n/g) ?? []).length - crlf;
    assert.equal(
      crlf === 0 || lf === 0,
      true,
      `${buildPath} has mixed line endings (${String(crlf)} CRLF, ${String(lf)} LF), so ` +
        "`newlineOf` would pick whichever came first and match only part of the file",
    );

    // Both endings behave identically, because no block spans a line.
    for (const eol of ["\n", "\r\n"] as const) {
      const variant = body.replace(/\r\n|\n/g, eol);
      let text = inject(variant).text;
      for (let i = 0; i < DEFECTS.length; i += 1) {
        const step = repairOne(text);
        assert.notEqual(step.repaired, null, `repair ${String(i + 1)} found nothing to fix in a ${JSON.stringify(eol)} script`);
        text = step.text;
      }
      assert.equal(text, variant, `the round trip must restore a ${JSON.stringify(eol)} script byte for byte`);
    }
  });
});

// ---- the three documents are consistent with one another ----------------------------------------------

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
    assert.equal(outcome.plan.goalId, "inventory-db");
  });

  it("names only registered validators, so no expectation can fail on lookup", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(DB_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          DB_OBSERVATION_KIND,
          `${criterion.criterion.id} names a validator that does not read this world's observation`,
        );
      }
    }
  });

  it("declares the artifact every artifact-reading expectation needs", async () => {
    // A file-backed world has no page to screenshot, so `json` is the reading itself and is the only
    // artifact any of these criteria can be given. Forgetting the `evidence` entry would make the
    // demo unusable for a reason that has nothing to do with the application.
    const outcome = await define();

    for (const criterion of outcome.plan.criteria) {
      for (const expectation of criterion.expectations) {
        assert.ok(
          criterion.evidence.includes("json" as EvidenceKind),
          `${criterion.criterion.id} reads ${expectation.validator.name} but does not declare a json ` +
            "artifact, so a passing verdict would rest on evidence the bundle was not asked to keep",
        );
      }
    }
  });

  it("reads each expectation's target out of the statement that produces it", async () => {
    // A spelling agreement, not a semantic one - and a cheap guard against the class of defect this
    // example actually hit. `db.value` on `total_cents` was reported as "the query did not select a
    // column `total_cents`" because the adapter could not see a computed column, and the message sent
    // the reader to audit a contract that was correct. The step and the target are written in two
    // places, so they are tied together here rather than discovered at run time.
    const outcome = await define();

    for (const criterion of outcome.plan.criteria) {
      const statements = criterion.steps
        .filter((step) => step.kind === "sql")
        .map((step) => (step.kind === "sql" ? step.statement : ""));

      // A criterion with no statements judges the landing state - the built database rather than a
      // result set - so there is nothing for its target to agree with. `db.table` reads the schema
      // for the same reason.
      if (statements.length === 0) continue;

      for (const expectation of criterion.expectations) {
        if (expectation.target === null) continue;
        if (expectation.validator.name === DB_VALIDATOR_NAMES.table) continue;
        // `db.column` names `table.column`, so only the column is expected in the SQL text.
        const named = expectation.target.includes(".")
          ? expectation.target.split(".").at(-1) ?? ""
          : expectation.target;
        assert.ok(
          statements.some((statement) => statement.includes(named)),
          `${criterion.criterion.id} asks ${expectation.validator.name} about \`${named}\`, which none ` +
            `of its statements selects: ${statements.join(" | ") || "(no sql steps)"}`,
        );
      }
    }
  });

  it("describes a world with no address, and says so rather than leaving it blank", async () => {
    const outcome = await define();
    const { url, adapter, databasePath, health, browser } = outcome.environment;

    assert.equal(adapter, "local-db");
    assert.equal(url, null, "a world reached by opening a file has no address to expect a status from");
    assert.ok(
      databasePath !== null && databasePath.endsWith("examples/inventory-db/app/data.db"),
      `databasePath resolved to ${String(databasePath)}`,
    );

    // The distinction this example exists to demonstrate: absence is recorded as absence. An empty
    // string or a defaulted 200 would make "this world has no address" indistinguishable from
    // "nobody filled the field in".
    assert.equal(health.path, null);
    assert.equal(health.expectStatus, null);
    assert.equal(browser.enabled, false, "a world with no page must not carry an enabled browser");
  });

  it("starts a build that waits for a fact rather than for a sleep", async () => {
    const outcome = await define();
    const { start, app, appPath } = outcome.environment;

    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/inventory-db/app"), `appPath resolved to ${appPath}`);
    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "build.mjs"), "the world starts something else");

    // The readiness check is source-controlled twice - a regex here, a `write` in the build - so the
    // two are tied together. A pattern that no longer matches is an environment that never becomes
    // ready, which reads as a broken application rather than a broken contract.
    const pattern = start.readyPattern;
    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");
    assert.match("inventory-db ready: 3 products, 1 to reorder", new RegExp(pattern));

    const build = await readBuild();
    assert.ok(
      build.includes("inventory-db ready:"),
      "build.mjs no longer prints the line the readiness pattern waits for",
    );
  });

  it("resets by rebuilding the file rather than by repairing it", async () => {
    // Reset is first-class, and for a file-backed world "the world is fresh" can only mean "the file
    // was produced again from source". A build that inserted without deleting first would accumulate:
    // the second iteration would see the first one's rows and every count in the contract would drift
    // until a criterion was satisfied by accident.
    const outcome = await define();
    assert.equal(outcome.environment.reset.strategy, "restart");

    const build = await readBuild();
    assert.match(
      build,
      /rmSync\(\s*target\s*,\s*\{[^}]*force:\s*true/,
      "the build does not remove the database before creating it, so a reset would not be a reset",
    );
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
    assert.equal(outcome.goal.limits.networkPolicy, "deny");
    assert.equal(
      outcome.goal.limits.filesystemWrite,
      "sandbox",
      "the build has to be able to create the file it is asked to create, which is a write inside " +
        "the world",
    );
  });
});
