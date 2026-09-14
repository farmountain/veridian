import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { POSIX_OBSERVATION_KIND } from "../core/environment/posix-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-posix/defects.ts";
import { readProvision, restoreAll, writeChanged } from "../examples/sim-posix/source.ts";
import { POSIX_VALIDATOR_NAMES, posixValidators } from "../validators/posix/posix-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The fourth demo, held to the standard of the first three.
 *
 * `examples/sim-posix/demo.ts` exists to prove the claim the previous three could not: that
 * `EnvironmentAdapter` is a seam with room for a world whose subject is the *operating system* - a
 * real program provisioning a real tree, deciding permissions as a named account, binding a real
 * loopback socket through a `systemctl start` it really calls, and refusing a path that escapes the
 * sandbox. The world is simulated and the simulation is declared; the execution, the observation and
 * the verdict are not.
 *
 * This file holds what is specific to *this* demo and nothing that is already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather
 *   than its consequence, and each naming a different criterion, because two defects that claimed one
 *   criterion would let a repair that fixed neither look like progress.
 * - **`D4` is the only block that spans a line**, which is what makes the line-ending rule reachable
 *   here. The rule itself is held against synthetic blocks by `tests/defect-text.test.ts`; what is
 *   held here is that *this* table reaches it.
 * - **the round trip on the real file**, because the demo's whole progression rests on taking
 *   `provision.mjs` to the wrong state and getting the same bytes back.
 * - **the resolved definition**, which is the artifact a reader of the bundle sees.
 */

const repo = nodeIo();
const goalPath = "examples/sim-posix/goal.yaml";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(repo));

let resolved: Promise<ResolvedDefinition> | undefined;

/** The whole DEFINE stage, exactly as the CLI runs it: the real schemas, the real validator family. */
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
        registry: new ValidatorRegistry(posixValidators()),
        registeredAdapters: ["sim-posix"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-posix goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

/** Every defect's own state, as a list of ids in table order - the shape a failure report names. */
function injected(text: string): readonly string[] {
  return status(text)
    .filter((entry) => entry.state === "injected")
    .map((entry) => entry.defect.id);
}

// ---- the shipped provisioning program is the correct one -----------------------------------------

describe("the shipped provisioning program is the correct one", () => {
  it("carries none of the four defects", async () => {
    for (const entry of status(readProvision())) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${PROVISION_FILE}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/sim-posix/demo.ts " +
          "--restore-only` to put the program back.",
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", () => {
    for (const defect of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the
      // longer: the injection would be a no-op that reported success and the state would read
      // `unknown` - which is the state that makes a criterion unfalsifiable rather than failing.
      assert.ok(
        !defect.correct.includes(defect.defective),
        `${defect.id}: the defective form is a substring of the correct form`,
      );
      assert.ok(
        !defect.defective.includes(defect.correct),
        `${defect.id}: the correct form is a substring of the defective form`,
      );
      assert.notEqual(defect.correct, defect.defective, `${defect.id}: identical forms`);
      assert.ok(defect.summary.trim().length > 0, `${defect.id} has no summary for a failure report`);
    }
  });

  it("names each defect once and each criterion once, in criterion order", () => {
    const ids = DEFECTS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so a report cannot name one");

    // Criterion order is the order `repairOne` walks, and the order the demo's progression descends
    // in. Asserted as a list rather than as a set because a reordering would change which criterion
    // recovers first while every count stayed identical - a run that still ended in PASS, having
    // stopped being a diagnosis.
    assert.deepEqual(
      DEFECTS.map((entry) => entry.criterionId),
      ["AC-003", "AC-006", "AC-008", "AC-010"],
      "the defects must be walked in criterion order, because `repairOne` repairs the first it finds",
    );

    const criteria = DEFECTS.map((entry) => entry.criterionId);
    assert.equal(
      new Set(criteria).size,
      criteria.length,
      "two defects claim the same criterion, so a repair that fixed neither could still look like " +
        "progress - the failure count would fall by one either way",
    );

    for (const defect of DEFECTS) {
      assert.match(defect.criterionId, /^AC-[0-9]{3}$/, `${defect.id} names an impossible criterion`);
    }
    assert.equal(
      DEFECTS.length,
      4,
      "the demo's narration and `goal.yaml`'s iteration bound are both written for four defects",
    );
  });

  it("puts every defect in the one file the table reads", () => {
    assert.equal(PROVISION_FILE, "provision.mjs");
    const text = readProvision();
    for (const defect of DEFECTS) {
      // A defect whose block is in neither form is a defect that can never fail, so the table must be
      // answered for the file the demo actually injects into rather than for a fixture.
      assert.notEqual(
        status(text).find((entry) => entry.defect.id === defect.id)?.state,
        "unknown",
        `${defect.id} matches neither form in ${PROVISION_FILE}, so injecting it would silently do nothing`,
      );
    }
  });
});

// ---- injecting and repairing round-trips the same bytes -------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all four, then repairs exactly one per call, in criterion order", () => {
    const original = readProvision();

    const first = inject(original);
    assert.deepEqual(first.injected, DEFECTS.map((entry) => entry.id));
    assert.deepEqual(first.alreadyInjected, []);

    // Idempotent: a second injection is a no-op, so a re-run cannot patch the same block twice and
    // turn a two-line replacement into a four-line one.
    const second = inject(first.text);
    assert.deepEqual(second.injected, []);
    assert.deepEqual(second.alreadyInjected, DEFECTS.map((entry) => entry.id));
    assert.equal(second.text, first.text);

    const counts = [injected(first.text).length];
    let text = first.text;
    for (const defect of DEFECTS) {
      const step = repairOne(text);
      assert.equal(step.repaired?.id, defect.id, "repairs must follow criterion order");
      text = step.text;
      counts.push(injected(text).length);
    }

    // The progression, asserted rather than described: 4, 3, 2, 1, 0. A repair that cleared two at
    // once would take the run from four named failures to two and skip an observation that shows the
    // criteria being judged independently - which is the demonstration the goal was written for.
    assert.deepEqual(counts, [4, 3, 2, 1, 0]);
    assert.equal(text, original, "the round trip must return the program to its checked-in bytes");

    const done = repairOne(text);
    assert.equal(done.repaired, null, "a fifth repair has nothing to do");
    assert.equal(done.text, text);
  });

  it("confines a repair to the defect it names, so it cannot be credited to another", () => {
    const injectedText = inject(readProvision()).text;

    const step = repairOne(injectedText);
    assert.equal(step.repaired?.id, "D1");
    assert.deepEqual(
      injected(step.text),
      ["D2", "D3", "D4"],
      "one repair changed more than the block it named, so the failure report and the edit disagree",
    );
    assert.ok(
      step.text.includes('export const SERVICE_ACCOUNT = "cart";'),
      "the repaired defect's own block is still the defective one",
    );
  });

  it("reaches the line-ending rule, because exactly one block spans a line", () => {
    // The rule this project paid for: a textual overlay authored with `\n` against a CRLF checkout
    // matches nothing, and the run then reports a `PASS` the application never earned. A table of
    // single-line blocks never reaches the conversion, which is how the first demo's comment came to
    // claim a coverage it did not have.
    const multiLine = DEFECTS.filter((entry) => entry.correct.includes("\n"));
    assert.deepEqual(
      multiLine.map((entry) => entry.id),
      ["D4"],
      "`D4` must be the block that spans a line, or this table cannot reach the conversion at all",
    );

    // Both endings behave identically. The bodies are supplied by the test rather than read from the
    // checkout: an assertion about the endings of the file on disk is an assertion about the
    // developer's `core.autocrlf`, and the first version of this rule's test failed on Linux for
    // exactly that reason.
    const original = readProvision();
    for (const eol of ["\n", "\r\n"] as const) {
      const body = original.replace(/\r\n|\n/g, eol);
      const landed = inject(body);
      assert.deepEqual(
        landed.injected,
        DEFECTS.map((entry) => entry.id),
        `the injection found nothing to change in a ${JSON.stringify(eol)} program, which is the ` +
          "defect this rule exists to prevent",
      );

      let text = landed.text;
      for (const defect of DEFECTS) {
        const step = repairOne(text);
        assert.equal(step.repaired?.id, defect.id);
        text = step.text;
      }
      assert.equal(text, body, `the round trip must restore a ${JSON.stringify(eol)} program`);
      assert.ok(text.includes(eol), "the program was rewritten with a different ending than it was read with");
    }

    // And the checked-in file is not mixed, so `newlineOf` cannot pick one ending and match half of
    // it. This is a property of the file, read as a fact about the tree rather than asserted as a
    // requirement - a checkout storing this file as LF is correct and must stay correct.
    const crlf = (original.match(/\r\n/g) ?? []).length;
    const lf = (original.match(/\n/g) ?? []).length - crlf;
    assert.ok(
      crlf === 0 || lf === 0,
      `${PROVISION_FILE} has mixed line endings (${String(crlf)} CRLF, ${String(lf)} LF), so the ` +
        "conversion would match only part of a block",
    );
  });

  it("puts the real file back, and reports only the repairs it made", () => {
    const original = readProvision();
    try {
      const wrote = writeChanged(original, inject(original).text);
      assert.deepEqual(wrote, [PROVISION_FILE], "the injection did not reach the file it named");

      const repaired = restoreAll();
      assert.deepEqual(repaired, DEFECTS.map((entry) => `${entry.id} in ${PROVISION_FILE}`));
      assert.deepEqual(injected(readProvision()), [], "the tree is still carrying a defect it reported fixed");
      assert.equal(readProvision(), original, "the round trip did not return the file to its own bytes");

      // The second call reports nothing, which is the half that matters: `restoreAll` derives what it
      // did from what it wrote, so it cannot announce repairs it did not make.
      assert.deepEqual(restoreAll(), []);
    } finally {
      // The tree is left exactly as it was found, whatever happened above. A test that can strand the
      // demo's application in a defective state would make every later run's first iteration
      // unreadable, which is the failure this file's first test exists to name.
      writeChanged(readProvision(), original);
    }
    assert.equal(readProvision(), original);
  });
});

// ---- the three documents are consistent with one another ------------------------------------------

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

  it("asks the posix world for its three facts and none of the HTTP or database ones", async () => {
    // A world with a filesystem and a loopback socket and no URL at all. Every HTTP question is
    // meaningless here, and the predicate that skips them is decided once, on the shape of the world,
    // rather than re-derived by the loader and the detector separately - two implementations of one
    // rule disagree the first time a world arrives that only one of them was written for.
    const outcome = await define();
    const { adapter, app, appPath, url, databasePath, cluster, browser, health, start, reset, posix } =
      outcome.environment;

    assert.equal(adapter, "sim-posix");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/sim-posix/app"), `appPath resolved to ${appPath}`);

    // Absence recorded as absence: an empty string or a defaulted 200 would make "this world has no
    // address" indistinguishable from "nobody filled the field in".
    assert.equal(url, null);
    assert.equal(databasePath, null);
    assert.equal(cluster, null, "a posix world is not a cluster world");
    assert.equal(health.path, null);
    assert.equal(health.expectStatus, null);
    assert.equal(browser.enabled, false, "a world with no page must not carry an enabled browser");

    assert.ok(posix !== null, "the plan carries no posix block, so a verdict could not say which system");
    assert.equal(posix.distribution, "debian", "the world must declare which system it stood in for");
    assert.notEqual(
      posix.user,
      "root",
      "the criteria would act as root, and root reads every file - so a hardening contract judged " +
        "as root reports a pass for a system no ordinary user can log into",
    );
    assert.ok(
      posix.root.endsWith("examples/sim-posix/app/sandbox"),
      `the sandbox root resolved to ${posix.root}, which is outside the application's own tree`,
    );

    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "provision.mjs"), "the world starts something else");
    assert.equal(reset.strategy, "restart");
  });

  it("waits for a fact the provisioning program actually prints, not for a sleep", async () => {
    const outcome = await define();
    const pattern = outcome.environment.start.readyPattern;

    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");
    assert.match(
      "cart-web provisioned: 3 files installed, 8 commands issued on debian",
      new RegExp(pattern),
      "the readiness pattern no longer matches the line the provisioning program prints",
    );

    const program = readProvision();
    assert.ok(
      program.includes("cart-web provisioned:"),
      "provision.mjs no longer prints the line the readiness pattern waits for",
    );
  });

  it("plans thirteen criteria in the order the contract declares them, all mandatory", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.deepEqual(ids, [
      "AC-001",
      "AC-002",
      "AC-003",
      "AC-004",
      "AC-005",
      "AC-006",
      "AC-007",
      "AC-008",
      "AC-009",
      "AC-010",
      "AC-011",
      "AC-012",
      "AC-013",
    ]);
    assert.equal(outcome.plan.mandatory.length, 13, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-posix");
  });

  it("names only registered validators, and every one reads the posix observation", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(POSIX_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          POSIX_OBSERVATION_KIND,
          `${criterion.criterion.id} names a validator that does not read this world's observation`,
        );
      }
      assert.ok(
        criterion.evidence.includes("json" as EvidenceKind),
        `${criterion.criterion.id} declares no json artifact, so a passing verdict would rest on ` +
          "evidence the bundle was not asked to keep",
      );
      assert.ok(
        criterion.steps.every((step) => step.kind === "run"),
        `${criterion.criterion.id} declares a step this world cannot perform; the port refuses those, ` +
          "and a refused acting call is an environment failure rather than a verdict",
      );
    }
  });

  it("names the criterion that reads each defect, not the consequence of one", async () => {
    // The discrimination claim, checked against the *contract's* own criteria rather than against a
    // hand-written list. Each defect is visible through more than one criterion and the table names
    // the one that reads the defect itself - the account, the path, the mode, the state - so a reader
    // who follows the id lands on the criterion that would have caught it even if every derived
    // consequence had happened to be right.
    const outcome = await define();
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    const named = new Set(DEFECTS.map((entry) => entry.criterionId));

    for (const id of named) {
      assert.ok(planned.has(id), `${id} is named by a defect but the contract does not declare it`);
    }

    // The criteria a defect is *not* allowed to be the named cause of, with the reason each is here:
    //
    // - `AC-007` reads the baseline's *contents*. It is `D2`'s partner and its verdict is
    //   `INCONCLUSIVE`, not `FAIL`, because the file it would have read is not in its reading at all -
    //   the pair that proves `INCONCLUSIVE` is not a softer `FAIL`.
    // - `AC-009` reads the secrets file's *owner*. It stays green while `D3` is injected, which is the
    //   evidence that `posix.owner` and `posix.permission` are two questions rather than one twice.
    // - `AC-011` (the port listening) and `AC-012` (the criterion's own read of the secret) are
    //   consequences of `D4` and `D3`. A defect that claimed one of them would make the progression a
    //   coincidence rather than a measurement.
    // - `AC-001`, `AC-002`, `AC-004`, `AC-005` and `AC-013` read facts no defect touches: the package
    //   actions, the unit's presence and contents, and the sandbox's refusal of an escaping path.
    for (const id of [
      "AC-001",
      "AC-002",
      "AC-004",
      "AC-005",
      "AC-007",
      "AC-009",
      "AC-011",
      "AC-012",
      "AC-013",
    ]) {
      assert.ok(!named.has(id), `${id} is not a defect's own criterion and a defect claims it`);
    }

    assert.deepEqual([...named].sort(), ["AC-003", "AC-006", "AC-008", "AC-010"]);
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
      "the provisioning program has to be able to write the tree inside the sandbox, which is a " +
        "write inside the world rather than outside it",
    );
  });
});
