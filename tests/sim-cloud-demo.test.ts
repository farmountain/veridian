import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import {
  CLOUD_OBSERVATION_KIND,
  CLOUD_SIMULATED_SURFACES,
  principalProblem,
} from "../core/environment/cloud-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { CLOUD_ENV } from "../adapters/sim-cloud/sim-cloud-environment.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-cloud/defects.ts";
import { readProvision, restoreAll, writeChanged } from "../examples/sim-cloud/source.ts";
import { inStyle, newlineOf, occurrences } from "../examples/defect-text.ts";
import { CLOUD_VALIDATOR_NAMES, cloudValidators } from "../validators/cloud/cloud-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The sixth demo, held to the standard of the first five.
 *
 * `examples/sim-cloud/demo.ts` exists to prove that a simulated world can be judged against a contract
 * that has no page, no process tree, no database file and no cluster in it. The application really runs,
 * really speaks HTTP to a real socket, and is really judged on what an account holds - and the account
 * is a substitute: a request-signing surface, a policy evaluator and a meter that this machine computes
 * rather than one any provider does. The three simulated worlds before it attacked a cluster, a system
 * and a machine; this one attacks an *account*, which is the only one of the four with no path, no
 * directory and no file anywhere in its loop.
 *
 * This file holds what is specific to *this* demo and nothing already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather than
 *   its consequence, each naming a different criterion, and each anchored in the shipped program. Two
 *   defects that claimed one criterion would let a repair that fixed neither look like progress.
 * - **`D4` is the only block that spans a line**, which is what makes the line-ending rule reachable
 *   here. The rule itself is held against synthetic blocks by `tests/defect-text.test.ts`; what is held
 *   here is that *this* table reaches it, and that both endings round-trip.
 * - **the round trip on the real file**, because the demo's whole progression rests on taking
 *   `provision.mjs` to the wrong state and getting the same bytes back.
 * - **the resolved definition** - the artifact a reader of the bundle sees - including the `cloud` block,
 *   which is the only thing that lets a verdict say *which* account it stood in for, and the absence of
 *   every other world's block, because a cloud account is not a cluster, a system or a machine.
 * - **the interface the substitution rests on**: the five names the adapter sets are exactly the five
 *   the provisioning program reads, and the readiness pattern waits for a line the program really prints.
 * - **the substitution is declared**, so a `PASS` is traceable to a named substitute rather than to
 *   unexamined reality.
 *
 * What is deliberately **not** here: the per-iteration progression. It is measured by running
 * `npm run demo:cloud`, which is the demo's own contract, and this file pins the *table* the progression
 * is derived from - which criterion each defect names, that those four are disjoint, and which of the
 * contract's twenty-three other criteria a defect is not allowed to be the named cause of. A literal
 * list of iteration verdicts copied from one run would be a claim about a run that nothing could
 * reproduce.
 */

const repo = nodeIo();
const goalPath = "examples/sim-cloud/goal.yaml";

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
        registry: new ValidatorRegistry(cloudValidators()),
        registeredAdapters: ["sim-cloud"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved"
        ? ""
        : `the sim-cloud goal must resolve; it did not: ${outcome.reason}`,
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

/** A file in this repository, read as the text it is - for the claims that are about two files agreeing. */
function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// ---- the shipped provisioning program is the correct one -----------------------------------------

describe("the shipped provisioning program is the correct one", () => {
  it("carries none of the four defects", () => {
    for (const entry of status(readProvision())) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${PROVISION_FILE}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/sim-cloud/demo.ts " +
          "--restore-only` to put the program back.",
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", () => {
    for (const defect of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the longer:
      // the injection would be a no-op that reported success, and the state would read `unknown` - which
      // is the state that makes a criterion unfalsifiable rather than failing.
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

  it("anchors every edit in the program it edits, and nowhere else", () => {
    // The overlay is textual and `String.replace` takes the first match, so a `correct` form that occurs
    // twice would be edited once and the other site would keep reading as correct - and a defective form
    // that occurs on a *correct* program would make the shipped tree read as injected, which is the
    // state that makes the first test in this file fail for a reason nobody could act on.
    //
    // Both counts are taken against the block *expressed in the file's own line ending*, which is the
    // same conversion `defectStates` performs and the reason `inStyle` exists: the declared spelling of
    // `D4` is written with `\n` and this checkout stores the program with CRLF, so a bare `includes`
    // here would be an assertion about `core.autocrlf` rather than about the table. It would also pass
    // vacuously for the negative half, which is the worse of the two failures.
    const program = readProvision();
    const newline = newlineOf(program);

    for (const defect of DEFECTS) {
      assert.equal(
        occurrences(program, inStyle(defect.correct, newline)),
        1,
        `${defect.id}: its correct form must appear exactly once in ${PROVISION_FILE}, expressed in ` +
          "that file's own line ending - two occurrences would leave one site unedited, and none would " +
          "make the state read as `unknown`",
      );
      assert.equal(
        occurrences(program, inStyle(defect.defective, newline)),
        0,
        `${defect.id}: its defective form is already in the shipped program, so a correct tree would ` +
          "read as a carried defect",
      );
    }
  });

  it("names each defect once and each criterion once, in criterion order", () => {
    const ids = DEFECTS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so a report cannot name one");
    assert.deepEqual(ids, ["D1", "D2", "D3", "D4"]);

    const criteria = DEFECTS.map((entry) => entry.criterionId);
    assert.equal(
      new Set(criteria).size,
      criteria.length,
      "two defects claim one criterion, so a repair that fixed neither would look like progress",
    );
    assert.deepEqual(criteria, ["AC-003", "AC-009", "AC-013", "AC-026"]);

    // Table order is contract order, which is what makes one repair per iteration read as a progression:
    // the repair agent takes the first still-injected defect in table order, so the fourth iteration is
    // the one that reaches the last criterion.
    const numbered = criteria.map((id) => Number(id.slice(3)));
    assert.deepEqual(
      numbered,
      [...numbered].sort((left, right) => left - right),
      "the table is not in criterion order, so a repair pass would move the contract out of order",
    );
  });
});

// ---- injecting and repairing round-trips the same bytes -------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all four, then repairs exactly one per call, in criterion order", () => {
    const original = readProvision();

    const first = inject(original);
    assert.deepEqual(first.injected, DEFECTS.map((entry) => entry.id));
    assert.deepEqual(first.alreadyInjected, []);
    assert.deepEqual(
      injected(first.text),
      DEFECTS.map((entry) => entry.id),
      "an injection left a defect in the `unknown` state, which is a defect no criterion can decide",
    );

    // Idempotent: a second injection is a no-op, so a re-run cannot patch the same block twice and turn
    // a two-line replacement into a four-line one.
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

    // The progression, asserted rather than described: 4, 3, 2, 1, 0. A repair that cleared two at once
    // would take the run from four injected defects to two and skip an observation that shows the
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
      step.text.includes("{ blocked: true }"),
      "the repaired defect's own block is still the defective one",
    );
  });

  it("reaches the line-ending rule, because exactly one block spans a line", () => {
    // The rule this project paid for: a textual overlay authored with `\n` against a CRLF checkout
    // matches nothing, and the run then reports a `PASS` the application never earned. A table of
    // single-line blocks never reaches the conversion, which is how the second demo's comment came to
    // claim a coverage it did not have.
    const multiLine = DEFECTS.filter((entry) => entry.correct.includes("\n"));
    assert.deepEqual(
      multiLine.map((entry) => entry.id),
      ["D4"],
      "`D4` must be the block that spans a line, or this table cannot reach the conversion at all",
    );

    // Both endings behave identically. The bodies are supplied by the test rather than read from the
    // checkout: an assertion about the endings of the file on disk is an assertion about the developer's
    // `core.autocrlf`, and the first version of this rule's test failed on Linux for exactly that reason.
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
      assert.ok(
        text.includes(eol),
        "the program was rewritten with a different ending than it was read with",
      );
    }

    // And the checked-in file is not mixed, so `newlineOf` cannot pick one ending and match half of it.
    // This is a property of the file, read as a fact about the tree rather than asserted as a
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
      assert.deepEqual(
        repaired,
        DEFECTS.map((entry) => `${entry.id} in ${PROVISION_FILE}`),
      );
      assert.deepEqual(
        injected(readProvision()),
        [],
        "the tree is still carrying a defect it reported fixed",
      );
      assert.equal(readProvision(), original, "the round trip did not return the file to its own bytes");

      // The second call reports nothing, which is the half that matters: `restoreAll` derives what it did
      // from what it wrote, so it cannot announce repairs it did not make.
      assert.deepEqual(restoreAll(), []);
    } finally {
      // The tree is left exactly as it was found, whatever happened above. A test that can strand the
      // demo's application in a defective state would make every later run's first iteration unreadable,
      // which is the failure this file's first test exists to name.
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

  it("asks the account for its facts and none of the HTTP, database, cluster, system or machine ones", async () => {
    // A world with no page, no socket to probe and no status to expect. Every HTTP question is
    // meaningless here, and the predicate that skips them is decided once, on the shape of the world,
    // rather than re-derived by the loader and the detector separately - two implementations of one rule
    // disagree the first time a world arrives that only one of them was written for. A cloud world is the
    // fourth shape to arrive at that predicate, which is why the assertion is here and not only in the
    // gaps suite.
    const outcome = await define();
    const {
      adapter,
      app,
      appPath,
      url,
      databasePath,
      cluster,
      posix,
      os,
      browser,
      health,
      start,
      reset,
      cloud,
    } = outcome.environment;

    assert.equal(adapter, "sim-cloud");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/sim-cloud/app"), `appPath resolved to ${appPath}`);

    // Absence recorded as absence: an empty string or a defaulted 200 would make "this world has no
    // address" indistinguishable from "nobody filled the field in". The reason `url` matters more here
    // than anywhere else is documented in the environment document itself - the loader infers a browser
    // from a url, so a url beside a cloud block would be the `--browser none` defect one world out.
    assert.equal(url, null);
    assert.equal(databasePath, null);
    assert.equal(cluster, null, "a cloud account is not a cluster");
    assert.equal(posix, null, "a cloud account is not a POSIX system");
    assert.equal(os, null, "a cloud account is not a machine");
    assert.equal(health.path, null);
    assert.equal(health.expectStatus, null);
    assert.equal(browser.enabled, false, "a world with no page must not carry an enabled browser");

    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "provision.mjs"), "the world starts something else");
    assert.equal(reset.strategy, "restart");
    assert.ok(cloud !== null, "the plan carries no cloud block, so a verdict could not say which account");
  });

  it("never judges as an account root, in the plan or anywhere in the contract", async () => {
    // The refusal is a false-pass argument rather than a preference: every policy in an account yields to
    // an account root, so a hardening contract judged as one answers `FAIL` for the bucket it was asked
    // to protect and would answer `PASS` for an account no ordinary workload runs in. The loader refuses
    // five such names; what is held here is that *this* document is not relying on that refusal, and that
    // no criterion in the contract reaches for one either - a criterion acting as `root` would be
    // demonstrating the refusal rather than the world.
    const outcome = await define();
    const cloud = outcome.environment.cloud;

    assert.ok(cloud !== null);
    assert.equal(
      cloud.principal,
      "svc-cart",
      "the demo's narration, the program and the contract all name this service account",
    );
    assert.equal(principalProblem(cloud.principal), null, "the plan judges as a privileged identity");
    assert.equal(principalProblem(cloud.account), null, "the account itself is a privileged identity");

    // Every identity the contract names is derived from the contract rather than listed here, and each
    // has to be one the program actually creates: `svc-cart` is the pipeline principal the application
    // runs as, and `svc-reader` is the account it creates for the front end. A third name would be a
    // criterion judging as an account nothing in this program is - which in a substitute world means
    // judging a policy that was never written, and reading the absence of it as a failure.
    const acceptance = source("../examples/sim-cloud/acceptance.yaml");
    const acted = new Set(
      (acceptance.match(/principal\/[a-z0-9._-]+:/g) ?? []).map((reference) =>
        reference.slice("principal/".length, -1),
      ),
    );
    const program = readProvision();

    assert.ok(acted.size > 0, "no criterion names a principal, so nothing was judged as an account");
    for (const name of acted) {
      assert.equal(principalProblem(name), null, `a criterion acts as ${name}`);
      assert.ok(
        name === cloud.principal || program.includes(name),
        `${name} is not an identity this program creates, so a criterion would judge a policy nobody wrote`,
      );
    }
    assert.deepEqual([...acted].sort(), ["svc-cart", "svc-reader"]);
  });

  it("names a substitute rather than a provider, and declares the surfaces it stood in for", async () => {
    // The obligation a simulated world has to meet and a real one does not: a reader of the bundle has to
    // be able to tell that this run was judged against a substitute. A provider and a region spelled the
    // way a real one is would make the verdict indistinguishable from a run against a real account -
    // which is the one thing a simulation is never allowed to be.
    const outcome = await define();
    const cloud = outcome.environment.cloud;
    assert.ok(cloud !== null);

    const realProvider = /^(aws|amazon|amazonaws|azure|microsoft|gcp|google)/i;
    for (const value of [cloud.provider, cloud.region, cloud.account]) {
      assert.ok(
        !realProvider.test(value),
        `${value} names a real provider, so a bundle would read as a real account`,
      );
    }
    assert.ok(
      !/^[a-z]{2}-[a-z]+-\d$/.test(cloud.region),
      `${cloud.region} is spelled the way a provider's own region names are, so a reader could not tell`,
    );

    // And the surfaces it substituted, which is what the declaration on the reading is for. The list is
    // only informative because it is partial - a list that named everything would say nothing - so the
    // things that *are* real here must not be on it.
    const surfaces = [...CLOUD_SIMULATED_SURFACES];
    assert.equal(new Set(surfaces).size, surfaces.length, "a surface is named twice");
    for (const real of ["http", "transport", "process", "digest", "sha256"]) {
      assert.ok(
        !(surfaces as readonly string[]).includes(real),
        `${real} is real and is on the list of substituted surfaces`,
      );
    }

    // The declaration reaches the reading rather than sitting in a constant beside it: this is the same
    // rule as a capability report derived from what the code did. `tests/cloud-observation.test.ts` holds
    // the other half - that a reading without it is not a reading this family will judge.
    const adapterSource = source("../adapters/sim-cloud/sim-cloud-environment.ts");
    assert.ok(
      adapterSource.includes("simulated: CLOUD_SIMULATED_SURFACES"),
      "the adapter no longer passes the substituted surfaces into the reading, so a bundle would " +
        "record an account with no statement of what was stood in for",
    );
  });

  it("sets exactly the names the provisioning program reads, and no others", async () => {
    // Two files that must agree, and nothing reconciled them: the adapter sets five names and the
    // application reads five, and a name that exists in one and not the other is a program started with
    // an empty string - which is the failure mode where the account is not named at all.
    const declared = Object.values(CLOUD_ENV);
    const program = readProvision();
    const read = new Set(program.match(/VERIDIAN_CLOUD_[A-Z_]+/g) ?? []);

    assert.deepEqual(
      [...read].sort(),
      [...declared].sort(),
      "the program reads a variable the adapter does not set, or the adapter sets one nothing reads",
    );
    assert.equal(
      declared.length,
      5,
      "the program requires five facts - the address, the provider, the region, the account and the " +
        "principal - and it refuses to run without all of them",
    );
    assert.ok(
      declared.every((name) => name.startsWith("VERIDIAN_CLOUD_")),
      "a variable the adapter sets is not in this world's own namespace",
    );
    assert.ok(
      !/VERIDIAN_CLOUD_[A-Z_]*ROOT/.test(program),
      "the program reads a root directory, and an account has no path - a criterion that read one would " +
        "read this machine while claiming to read the account",
    );
  });

  it("plans twenty-seven criteria in the order the contract declares them, all mandatory", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.deepEqual(
      ids,
      Array.from({ length: 27 }, (_, index) => `AC-${String(index + 1).padStart(3, "0")}`),
      "the plan must carry every criterion the contract declares, in the order it declares them",
    );
    assert.equal(outcome.plan.mandatory.length, 27, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-cloud");
  });

  it("names only registered cloud validators, and every one reads the cloud observation", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(CLOUD_VALIDATOR_NAMES));

    assert.equal(registered.size, 11, "the family's roster is the eleven names its criteria are written against");

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          CLOUD_OBSERVATION_KIND,
          `${criterion.criterion.id} names a validator that does not read this world's observation`,
        );
      }
      assert.ok(
        criterion.evidence.includes("json" as EvidenceKind),
        `${criterion.criterion.id} declares no json artifact, so a passing verdict would rest on ` +
          "evidence the bundle was not asked to keep",
      );
    }
  });

  it("names the criterion that reads each defect, not the consequence of one", async () => {
    // The discrimination claim, checked against the *contract's* own criteria rather than against a
    // hand-written list. Each defect is visible through more than one criterion and the table names the
    // one that reads the state the defect edited - the policy the program wrote, the object's tags, the
    // dead-letter queue's count - so a reader who follows the id lands on the criterion that would have
    // caught it even if every derived consequence had happened to be right.
    const outcome = await define();
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    const named = new Set(DEFECTS.map((entry) => entry.criterionId));

    for (const id of named) {
      assert.ok(planned.has(id), `${id} is named by a defect but the contract does not declare it`);
    }

    // The criteria a defect is *not* allowed to be the named cause of, with the reason each is here:
    //
    // - `AC-005` (`cloud.tag` on the bucket) moves with `D2` and is its partner, from the other side:
    //   the tagging request is aimed at the wrong resource, so the bucket gains a tag it was never
    //   given. `D2` names `AC-009`, the object that carries none, because that is the reading the defect
    //   changes and `AC-005` is downstream of it.
    // - `AC-011` (`cloud.setting` on the work queue's message count) moves with `D3` and is its partner:
    //   the queue the program created holds none. `D3` names `AC-013`, the dead-letter queue holding a
    //   message, because a queue that only ever receives failures holding work is the defect itself and
    //   an empty work queue is what follows from it. The pair is what lets a reader tell a lost message
    //   from a misrouted one.
    // - `AC-027` (`cloud.access` on the principal, the action and the bucket) moves with `D4` and is its
    //   partner: the account's answer is still "no" and the rule it came from is no longer the statement
    //   that exists to refuse it. `D4` names `AC-026`, the policy the program wrote, because a policy is
    //   the state the defect edited and the decision is derived from it.
    // - The rest read facts no defect touches: the bucket, its versioning, its encryption and its tag
    //   set, the object and its settings, the queue's existence, encryption, retention and redelivery
    //   limit, the secret and its versions, the reader principal's policy and its decision, the
    //   application's own request record, the criterion's own probe, the meter, and the receipts bucket's
    //   policy - which is the control that proves `D4` moves one bucket's protection and not both.
    for (const id of [
      "AC-001",
      "AC-002",
      "AC-004",
      "AC-005",
      "AC-006",
      "AC-007",
      "AC-008",
      "AC-010",
      "AC-011",
      "AC-012",
      "AC-014",
      "AC-015",
      "AC-016",
      "AC-017",
      "AC-018",
      "AC-019",
      "AC-020",
      "AC-021",
      "AC-022",
      "AC-023",
      "AC-024",
      "AC-025",
      "AC-027",
    ]) {
      assert.ok(!named.has(id), `${id} is not a defect's own criterion and a defect claims it`);
    }

    assert.deepEqual([...named].sort(), ["AC-003", "AC-009", "AC-013", "AC-026"]);
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
    assert.equal(
      outcome.goal.limits.networkPolicy,
      "deny",
      "the world binds a loopback socket and the adapter reports that limit as `unsupported` rather " +
        "than as `enforced`; the declaration is still what the run is judged against",
    );
    assert.equal(
      outcome.goal.limits.filesystemWrite,
      "sandbox",
      "this world keeps its whole account in memory, so a write the application asked for is legitimately " +
        "absent - but a request naming a path outside the account must be refusable and recorded",
    );
  });

  it("carries the goal's declared boundary into the plan, where an adapter can act on it", async () => {
    // The third clause of the PASS rule has to be falsifiable, and a boundary that stopped at
    // `GoalLimits` would be documentable and unenforceable at once. The bound is only meaningful if the
    // value reaches the artifact the adapter is built from - the same shape as `--browser none` reaching
    // a plan that still promised a browser.
    const outcome = await define();

    assert.equal(outcome.environment.boundary.network, "deny");
    assert.equal(
      outcome.environment.boundary.filesystemWrite,
      "sandbox",
      "the declared filesystem policy is what the adapter is asked to uphold, so it must reach the plan",
    );
  });
});

// ---- the world says it is a substitute ------------------------------------------------------------

describe("the world says it is a substitute", () => {
  it("waits for a fact the provisioning program actually prints, not for a sleep", async () => {
    const outcome = await define();
    const cloud = outcome.environment.cloud;
    assert.ok(cloud !== null);

    const pattern = outcome.environment.start.readyPattern;
    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");

    // Both directions of the same claim, read out of the program rather than recalled: the line this
    // demo announces what it provisioned on, with this plan's account in it, must be a line the pattern
    // matches. A pattern recalled from a transcript and asserted here would be an assertion about the
    // person who wrote it.
    const announcement = readProvision()
      .split(/\r?\n/)
      .find((line) => line.includes("provisioned:")) ?? "";
    assert.notEqual(announcement, "", "provision.mjs no longer announces what it provisioned");

    const rendered = announcement.replace(/\$\{[^}]*\}/g, (expression) =>
      expression.includes("ACCOUNT") ? cloud.account : "3",
    );
    assert.match(
      rendered,
      new RegExp(pattern),
      `the readiness pattern no longer matches the line the provisioning program prints (${rendered})`,
    );
  });
});
