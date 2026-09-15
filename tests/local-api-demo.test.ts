import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { API_OBSERVATION_KIND } from "../core/environment/api-observation.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { DEFECTS, inject, repairOne, status } from "../examples/local-api/defects.ts";
import { API_VALIDATOR_NAMES, apiValidators } from "../validators/api/api-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The ninth demo, and the third world that is not simulated.
 *
 * `examples/local-api/demo.ts` claims in its own header that this file fails loudly if the restore
 * ever stops working. That claim is the reason this file exists, and it is asserted below rather than
 * left as a sentence in a doc comment - a citation of a test that does not exist is the same class of
 * defect as a validator that reports a pass it did not observe.
 *
 * Beyond the restore, everything here is about the property this world was built to prove: **an
 * application can be judged through its own interface, with nothing rendered and nothing
 * substituted.** The web world observes a *rendering* of the application and the six `sim-*` worlds
 * observe substitutes standing in for infrastructure. This one observes the application itself - a
 * status code, a header and a pointer into a JSON body - and if `EnvironmentAdapter` had quietly been
 * a browser harness, or if the core had assumed a page anywhere, one of these assertions would be the
 * one that says so.
 *
 * Two guards below are specific to this family and would be worth nothing in another world, because
 * the grammar they hold is the grammar a *position* introduces:
 *
 *   - a criterion's `call` count bounds every position its expectations name, because a position past
 *     the last request is `INCONCLUSIVE` rather than a failure - a contract defect, not an
 *     application one;
 *   - a target that is a position must be *written* as a position, since the schema admits any string
 *     and the validator is the only other thing that reads it.
 */

const repo = nodeIo();
const servicePath = "examples/local-api/app/server.mjs";
const goalPath = "examples/local-api/goal.yaml";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(repo));

async function readService(): Promise<string> {
  const body = await repo.readTextFile(servicePath);
  assert.ok(body !== null, `${servicePath} is missing, so the demo has no application to validate`);
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
        registry: new ValidatorRegistry(apiValidators()),
        registeredAdapters: ["local-api"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the api goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

/**
 * How many requests a criterion puts, which is the bound on every position it may name.
 *
 * A criterion with no `call` steps can still be judged - `api.service` asks about the world rather
 * than about a request - and it is the only such expectation this contract uses.
 */
function callCount(criterion: ResolvedDefinition["plan"]["criteria"][number]): number {
  return criterion.steps.filter((step) => step.kind === "call").length;
}

/** The position a target names, or `null` when the target does not name one. */
function positionOf(target: string): number | null {
  const head = target.split("/")[0] ?? "";
  const digits = head.split(":")[0] ?? "";
  return /^[1-9][0-9]*$/.test(digits) ? Number.parseInt(digits, 10) : null;
}

// ---- the shipped application is the correct one --------------------------------------------------------

describe("the shipped service is the correct one", () => {
  it("carries none of the four defects", async () => {
    const states = status(await readService());

    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${servicePath}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/local-api/demo.ts " +
          "--restore-only` to put the service back.",
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
      // The defect ids ascend with the criteria they name, which is what makes the repair agent's
      // "first still-injected defect, in criterion order" the same order a reader of this table sees.
      assert.ok(
        defect.correct.includes("\n") === false,
        `${defect.id}: the block spans more than one line, so this table now depends on the ` +
          "checkout's line ending - see the ending-insensitivity test below",
      );
    }
  });

  it("scopes every defect to the file the repair agent patches", async () => {
    // The demo injects into one file and restores that one file. A block that lived somewhere else
    // would be a defect the injection never landed, and the run would report a green first pass for
    // an application that was never broken - the exact false PASS this product exists to refuse.
    const body = await readService();

    for (const defect of DEFECTS) {
      assert.ok(
        body.includes(defect.correct),
        `${defect.id} is declared against ${servicePath} and its correct form is not in that file, ` +
          "so injecting it would change nothing and the demo would start from a passing world",
      );
    }
  });
});

// ---- injecting and repairing is a round trip -----------------------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all four, then repairs exactly one per call, in criterion order", async () => {
    const original = await readService();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "the first injection must land every defect");
    assert.deepEqual(first.alreadyInjected, []);

    // Idempotent: a second injection is a no-op, so a re-run cannot double-patch the service.
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

    // The progression, asserted rather than described: 4, 3, 2, 1, 0. A repair that fixed everything
    // at once would take the run from four defects straight to PASS and skip the intermediate
    // observations that show the criteria being judged independently of one another - including the
    // two pairs that share a defect.
    assert.deepEqual(counts, [4, 3, 2, 1, 0]);
    assert.equal(text, original, "the round trip must return the service to exactly its checked-in bytes");

    const done = repairOne(text);
    assert.equal(done.repaired, null, "a fifth repair has nothing to do");
    assert.equal(done.text, text);
  });

  it("refuses to guess when the file is not the file this table describes", () => {
    const stranger = "// a different service, with none of the four edits in it\n";

    for (const entry of status(stranger)) assert.equal(entry.state, "unknown");

    assert.throws(() => inject(stranger), /neither the correct nor the defective/);
    assert.throws(() => repairOne(stranger), /neither the correct nor the defective/);
    assert.equal(status(stranger).length, DEFECTS.length, "every defect must be reported, not the first");
  });

  it("is ending-insensitive by construction, which is why the rule is tested elsewhere", async () => {
    // The rule this project paid for twice: a textual overlay authored with `\n` against a CRLF
    // checkout matches nothing, and the run then reports a PASS the application never earned.
    //
    // **That rule cannot be exercised by this demo, and this test says so instead of pretending
    // otherwise.** Every block in this table is a single line, so `newlineOf`/`inStyle` never reach
    // it and the file's ending cannot change the outcome. The rule is held by
    // `tests/defect-text.test.ts`, against the shared implementation with synthetic multi-line
    // blocks, where breaking it is actually detectable. The per-defect single-line assertion lives in
    // the table test above; what is worth holding *here* is the consequence.
    for (const entry of DEFECTS) {
      assert.ok(
        !entry.correct.includes("\n") && !entry.defective.includes("\n"),
        `${entry.id} is multi-line, so this demo now depends on the file's line ending and ` +
          "`tests/defect-text.test.ts` is no longer the only place that rule is held",
      );
    }

    // And the file's own ending is a property of the *checkout*, not of this repository: `git ls-files
    // --eol` reports the committed blob as `lf` while a Windows worktree is `crlf`, because
    // `core.autocrlf` differs per platform and there is no `.gitattributes`. Asserting one ending
    // would be a statement about the developer's machine. What holds everywhere is that the ending is
    // *consistent* - `newlineOf` picks whichever came first and a file with both matches only part of
    // itself.
    const body = await readService();
    const crlf = (body.match(/\r\n/g) ?? []).length;
    const lf = (body.match(/\n/g) ?? []).length - crlf;
    assert.equal(
      crlf === 0 || lf === 0,
      true,
      `${servicePath} has mixed line endings (${String(crlf)} CRLF, ${String(lf)} LF), so ` +
        "`newlineOf` would pick whichever came first and match only part of the file",
    );

    // Both endings behave identically, because no block spans a line.
    for (const eol of ["\n", "\r\n"] as const) {
      const variant = body.replace(/\r\n|\n/g, eol);
      let text = inject(variant).text;
      for (let i = 0; i < DEFECTS.length; i += 1) {
        const step = repairOne(text);
        assert.notEqual(
          step.repaired,
          null,
          `repair ${String(i + 1)} found nothing to fix in a ${JSON.stringify(eol)} service`,
        );
        text = step.text;
      }
      assert.equal(text, variant, `the round trip must restore a ${JSON.stringify(eol)} service byte for byte`);
    }
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

  it("plans eight mandatory criteria in the order the contract declares them", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.deepEqual(
      ids,
      ["AC-001", "AC-002", "AC-003", "AC-004", "AC-005", "AC-006", "AC-007", "AC-008"],
    );
    assert.equal(outcome.plan.mandatory.length, 8, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
  });

  it("declares its goal id, so the cross-goal contradiction guard is live", async () => {
    // Not cosmetic. `linkAcceptance` refuses a contract that names a different goal, but a contract
    // that names *no* goal has a null id and the guard's branch is never reached - which is how this
    // repository once shipped a world whose whole cross-goal check was dormant while every other
    // world's was exercised. Read the value rather than the field's presence.
    const outcome = await define();
    assert.equal(outcome.plan.goalId, "local-api");
  });

  it("names only registered validators of this world's family", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(API_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          API_OBSERVATION_KIND,
          `${criterion.criterion.id} names a validator that does not read this world's observation`,
        );
      }
    }
  });

  it("judges every criterion through `call` steps, which is the only kind this world performs", async () => {
    // A contract constraint rather than a style preference. This adapter performs `call` and nothing
    // else, so a criterion carrying a `goto`, a `sql` or a `run` would be refused by name at run time
    // - and the refusal would read as an environment problem rather than a contract one.
    const outcome = await define();

    for (const criterion of outcome.plan.criteria) {
      const kinds = new Set(criterion.steps.map((step) => step.kind));
      for (const kind of kinds) {
        assert.equal(
          kind,
          "call",
          `${criterion.criterion.id} carries a \`${kind}\` step, and local-api performs only \`call\`: ` +
            "a criterion asking this world for anything else is asking a question the world refuses",
        );
      }
    }
  });

  it("declares the artifact every artifact-reading expectation needs", async () => {
    // A world with no page to screenshot has `json` as its reading itself, and it is the only artifact
    // kind this adapter can produce. Forgetting the `evidence` entry would make the demo unusable for
    // a reason that has nothing to do with the application.
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

  it("bounds every position it names by the number of requests it puts", async () => {
    // The grammar this family introduces, and the failure mode it has: a position past the last
    // request is `INCONCLUSIVE`, not a failure - so a criterion that named request 5 while putting
    // four would be reported as a world that did not answer rather than as a contract that asked for
    // something that never happened.
    const outcome = await define();

    for (const criterion of outcome.plan.criteria) {
      const calls = callCount(criterion);
      for (const expectation of criterion.expectations) {
        const target = expectation.target;
        if (target === null) continue;
        // `api.service` is targetless and `api.log` names a stream, so neither carries a position.
        if (expectation.validator.name === API_VALIDATOR_NAMES.log) {
          assert.ok(
            target === "stdout" || target === "stderr",
            `${criterion.criterion.id} reads ${expectation.validator.name} on \`${target}\`, and this ` +
              "world reads two streams",
          );
          continue;
        }
        if (expectation.validator.name === API_VALIDATOR_NAMES.service) continue;

        assert.match(
          String(positionOf(target)),
          /^[1-9][0-9]*$/,
          `${criterion.criterion.id}: \`${target}\` does not open with a 1-based position, and ` +
            `${expectation.validator.name} reads its subject by position`,
        );
        const position = positionOf(target) ?? 0;
        assert.ok(
          position >= 1 && position <= calls,
          `${criterion.criterion.id} names position ${String(position)} and puts ${String(calls)} ` +
            "request(s), so the reading it asks for does not exist in that criterion",
        );
      }
    }
  });

  it("reads the version header on a response the contract also creates, so one edit is read twice", async () => {
    // The demo's headline, held as a property of the contract rather than as a sentence in a comment.
    // D4 edits the one constant every response carries. Two criteria read that header, on two
    // different routes, which is what makes the edit visible as two readings rather than one - and a
    // contract that read it on a single route would describe the version as a property of a route.
    const outcome = await define();
    const headerCriteria = outcome.plan.criteria.filter((criterion) =>
      criterion.expectations.some(
        (expectation) =>
          expectation.validator.name === API_VALIDATOR_NAMES.header &&
          (expectation.target ?? "").endsWith(":x-cart-version"),
      ),
    );

    assert.deepEqual(
      headerCriteria.map((criterion) => criterion.criterion.id),
      ["AC-006", "AC-007"],
      "the version header must be read by two criteria, and D4 is the defect that moves both",
    );

    // And they read it on different requests, or the second criterion would be a second reading of
    // one exchange rather than of the service's shared response helper.
    const positions = headerCriteria.map((criterion) =>
      criterion.expectations
        .filter((expectation) => (expectation.target ?? "").endsWith(":x-cart-version"))
        .map((expectation) => (expectation.target ?? "").split(":")[0]),
    );
    assert.notDeepEqual(positions[0], positions[1], "both header criteria read the same exchange");
  });

  it("describes a world with an address, no browser, and a reset that restarts it", async () => {
    const outcome = await define();
    const { adapter, url, browser, health, reset, api } = outcome.environment;

    assert.equal(adapter, "local-api");
    assert.equal(url, "http://127.0.0.1:4327");

    // The distinction this example exists to demonstrate. This world *has* a `url`, so the loader
    // would infer a browser from it - and the document states `browser.enabled: false` to refuse
    // one. A page rendered here would be a second renderer standing between the application and the
    // reading, which is exactly what this world was built to remove.
    assert.equal(browser.enabled, false, "an API world must refuse the browser its url would imply");

    assert.equal(health.path, "/health");
    assert.equal(health.expectStatus, 200);

    // `restart` rather than a repair: the service holds its items in memory, so the only thing that
    // makes a second iteration a fresh world is a new process re-seeding from the frozen catalog.
    assert.equal(reset.strategy, "restart");

    // The service identity every reading carries, declared by the document rather than inferred from
    // the directory the process happened to run in.
    assert.equal(api?.service, "cart-api");
  });

  it("starts a service that waits for a fact rather than for a sleep", async () => {
    const outcome = await define();
    const { start, app, appPath } = outcome.environment;

    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/local-api/app"), `appPath resolved to ${appPath}`);
    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "server.mjs"), "the world starts something else");

    // The readiness check is source-controlled twice - a regex in the document, a `write` in the
    // service - so the two are tied together. A pattern that no longer matches is an environment that
    // never becomes ready, which reads as a broken application rather than a broken contract.
    const pattern = start.readyPattern;
    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");
    assert.match("cart-api listening on http://127.0.0.1:4327", new RegExp(pattern));

    const service = await readService();
    assert.ok(
      service.includes("cart-api listening on http://"),
      "server.mjs no longer prints the line the readiness pattern waits for",
    );
    // And the health route it is checked against really is a route, not a socket that happens to be
    // open: the readiness line and the health path must both be implemented by the service.
    assert.ok(service.includes('pathname === "/health"'), "server.mjs no longer serves the health route");
  });
});
