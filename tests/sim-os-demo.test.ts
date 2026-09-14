import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { OS_OBSERVATION_KIND } from "../core/environment/os-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { OS_ENV } from "../adapters/sim-os/sim-os-environment.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-os/defects.ts";
import { readProvision, restoreAll, writeChanged } from "../examples/sim-os/source.ts";
import { OS_VALIDATOR_NAMES, osValidators } from "../validators/os/os-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The fifth demo, held to the standard of the first four.
 *
 * `examples/sim-os/demo.ts` exists to prove the claim the previous four could not: that a **simulated
 * world** is a first-class world - an application really provisioning a substitute Windows system
 * through commands it really issues, judged as a named account, with no VM, no image, no hypervisor and
 * no boot anywhere in the loop. The fifth world attacks two axes the others did not: its subject is an
 * *operating system* whose answers are computed by one ordered rule rather than looked up in tables of
 * facts, and it stands in for two families from a single application.
 *
 * This file holds what is specific to *this* demo and nothing already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather
 *   than its consequence, and each naming a different criterion, because two defects that claimed one
 *   criterion would let a repair that fixed neither look like progress.
 * - **`D4` is the only block that spans a line**, which is what makes the line-ending rule reachable
 *   here. The rule itself is held against synthetic blocks by `tests/defect-text.test.ts`; what is held
 *   here is that *this* table reaches it, and that both endings round-trip.
 * - **the round trip on the real file**, because the demo's whole progression rests on taking
 *   `provision.mjs` to the wrong state and getting the same bytes back.
 * - **the resolved definition** - the artifact a reader of the bundle sees - including the `os` block,
 *   which is the only thing that lets a verdict say *which* system it stood in for.
 * - **the world's own refusal of a family it does not provision**, because a single application
 *   standing in for two families is a claim that has to be checked rather than commented.
 *
 * What is deliberately **not** here: the per-iteration progression. It is measured by running
 * `npm run demo:os`, which is the demo's own contract, and this file pins the *table* the progression
 * is derived from - which criterion each defect names, that those four are disjoint, and that the
 * other thirteen are unreachable from the table. A literal list of iteration verdicts copied from one
 * run would be a claim about a run that nothing could reproduce.
 */

const repo = nodeIo();
const goalPath = "examples/sim-os/goal.yaml";

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
        registry: new ValidatorRegistry(osValidators()),
        registeredAdapters: ["sim-os"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-os goal must resolve; it did not: ${outcome.reason}`,
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
  it("carries none of the four defects", () => {
    for (const entry of status(readProvision())) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${PROVISION_FILE}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/sim-os/demo.ts " +
          "--restore-only` to put the program back.",
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", () => {
    for (const defect of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the longer:
      // the injection would be a no-op that reported success, and the state would read `unknown` -
      // which is the state that makes a criterion unfalsifiable rather than failing.
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

    // Criterion order is the order `repairOne` walks and the order the demo's progression descends in.
    // Asserted as a list rather than as a set because a reordering would change which criterion
    // recovers first while every count stayed identical - a run that still ended in PASS, having
    // stopped being a diagnosis.
    assert.deepEqual(
      DEFECTS.map((entry) => entry.criterionId),
      ["AC-001", "AC-006", "AC-009", "AC-013"],
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

// ---- one application, two families: the program refuses the one it cannot provision ---------------

describe("the application refuses a family it does not provision", () => {
  it("refuses anything but windows, by name, rather than adapting", () => {
    // The claim `source.ts` and `environment.yaml` both make, held here because it is load-bearing:
    // the world can stand in for two families and the *application* cannot, so a run in which the plan
    // announced macOS would fail every criterion - and a reader would have to work out whether the
    // application was broken or the world was pointed at the wrong system. The program refuses, names
    // the family it got, and exits non-zero, which is a fact about the plan rather than about the
    // system - the same distinction `--browser none` cost this project once already.
    const program = readProvision();
    assert.match(
      program,
      /family !== "windows"/,
      "provision.mjs no longer refuses a family it does not provision, so a wrong plan would be " +
        "reported as a provisioning defect",
    );
    assert.match(program, /provisions a windows machine and the world announced/, "the refusal is unnamed");
  });

  it("reads exactly the five variables the adapter sets, because the names are written twice", () => {
    // The variable names are declared in two files - the adapter's `OS_ENV` and this program's own
    // `OS_ENV` - and reconciled by nothing, so a rename in one place and not the other gives the
    // program an empty string rather than an error. Measured against the adapter's exported table, not
    // against a list recalled here: a test that restates the names would agree with itself.
    const declared = Object.values(OS_ENV);
    const read = new Set(readProvision().match(/VERIDIAN_OS_[A-Z_]+/g) ?? []);

    for (const name of declared) {
      assert.ok(
        read.has(name),
        `provision.mjs does not read ${name}, so the world would start it with an empty ${name}`,
      );
    }
    assert.deepEqual(
      [...read].sort(),
      [...declared].sort(),
      "provision.mjs reads a variable the adapter does not set, so it would find it undefined",
    );
    assert.equal(
      declared.length,
      5,
      "the program requires five facts - the host path, the world's spelling of it, the family, the " +
        "release and the account - and it refuses to run without all of them",
    );
  });

  it("prints each command as one JSON vector per line, because that is the stream the world executes", () => {
    // The interface the substitution rests on: the application's own words on its own stdout, and a
    // substitute that parses them. Nothing else tells the world what to do, so a program that batched
    // them, prefixed them or wrote them to stderr would leave the world with nothing to run.
    const program = readProvision();
    assert.match(program, /JSON\.stringify\(argv\)/, "provision.mjs no longer prints command vectors");
    assert.match(program, /process\.stdout\.write/, "the command vectors are not written to stdout");
  });
});

// ---- injecting and repairing round-trips the same bytes -------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects all four, then repairs exactly one per call, in criterion order", () => {
    const original = readProvision();

    const first = inject(original);
    assert.deepEqual(first.injected, DEFECTS.map((entry) => entry.id));
    assert.deepEqual(first.alreadyInjected, []);

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
    // would take the run from four named failures to two and skip an observation that shows the
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
      step.text.includes('export const SERVICE_ACCOUNT = "svc-cart";'),
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

  it("asks the os world for its facts and none of the HTTP, database or cluster ones", async () => {
    // A world with no page, no socket to probe and no status to expect. Every HTTP question is
    // meaningless here, and the predicate that skips them is decided once, on the shape of the world,
    // rather than re-derived by the loader and the detector separately - two implementations of one rule
    // disagree the first time a world arrives that only one of them was written for. An `os` world is
    // the third shape to arrive at that predicate, which is why the assertion is here and not only in
    // the gaps suite.
    const outcome = await define();
    const { adapter, app, appPath, url, databasePath, cluster, browser, health, start, reset, os } =
      outcome.environment;

    assert.equal(adapter, "sim-os");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/sim-os/app"), `appPath resolved to ${appPath}`);

    // Absence recorded as absence: an empty string or a defaulted 200 would make "this world has no
    // address" indistinguishable from "nobody filled the field in".
    assert.equal(url, null);
    assert.equal(databasePath, null);
    assert.equal(cluster, null, "an os world is not a cluster world");
    assert.equal(health.path, null);
    assert.equal(health.expectStatus, null);
    assert.equal(browser.enabled, false, "a world with no page must not carry an enabled browser");

    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "provision.mjs"), "the world starts something else");
    assert.equal(reset.strategy, "restart");

    assert.ok(os !== null, "the plan carries no os block, so a verdict could not say which system");
    assert.equal(os.family, "windows", "the world must declare which system it stood in for");
  });

  it("never judges as an account that holds every permission", async () => {
    // `core/environment/load.ts` refuses `SYSTEM`, `LocalSystem` and `Administrator` by name, and the
    // reason is a false pass rather than a preference: an unconstrained account reads every file
    // whatever the ACL says, so a hardening contract judged as one answers `FAIL` for the file it was
    // asked to protect and would answer `PASS` for a machine no ordinary account can log into. The
    // refusal is held in the loader's own tests; what is held here is that *this* document is not
    // relying on it, because a demo that only passed because a validator refused to look would be
    // demonstrating the refusal rather than the world.
    const outcome = await define();
    const user = outcome.environment.os?.user ?? "";

    assert.notEqual(user, "", "the plan names no account, so no access question could be decided");
    for (const privileged of ["system", "localsystem", "administrator", "root", "wheel"]) {
      assert.notEqual(user.toLowerCase(), privileged, `the criteria would act as ${privileged}`);
    }
    assert.equal(user, "svc-audit", "the demo's narration and the contract both name this account");
  });

  it("plans seventeen criteria in the order the contract declares them, all mandatory", async () => {
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
      "AC-014",
      "AC-015",
      "AC-016",
      "AC-017",
    ]);
    assert.equal(outcome.plan.mandatory.length, 17, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-os");
  });

  it("names only registered validators, and every one reads the os observation", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(OS_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          OS_OBSERVATION_KIND,
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
    // one that reads the defect itself - the account, the store key, the service state, the entry list -
    // so a reader who follows the id lands on the criterion that would have caught it even if every
    // derived consequence had happened to be right.
    const outcome = await define();
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    const named = new Set(DEFECTS.map((entry) => entry.criterionId));

    for (const id of named) {
      assert.ok(planned.has(id), `${id} is named by a defect but the contract does not declare it`);
    }

    // The criteria a defect is *not* allowed to be the named cause of, with the reason each is here:
    //
    // - `AC-010` (`os.principal`) and `AC-012` (`os.access`) move with `D1` and move *differently*:
    //   `AC-012` answers `INCONCLUSIVE` because the reading holds no decision for an account the world
    //   does not have, which is the clearest evidence this project has that `INCONCLUSIVE` is not a
    //   softer `FAIL`. Both are consequences, so neither may be a defect's own criterion.
    // - `AC-005` reads the baseline file's contents and does not move while `D2` is injected. That is
    //   the point of `D2`: a defect in what the system was *told* must not be readable as a defect in
    //   what the application wrote down.
    // - `AC-014` (`os.access` on the secrets file) moves with `D4` and is its partner. `D4` names
    //   `AC-013`, the entry list, because that is the reading the defect changes; a defect that claimed
    //   `AC-014` would make the pair look like one criterion counted twice.
    // - The rest read facts no defect touches: the installed program, the reference file, the account's
    //   absence, the service definition, its image, its port, the probe and the sandbox's refusal of an
    //   escaping path.
    for (const id of [
      "AC-002",
      "AC-003",
      "AC-004",
      "AC-005",
      "AC-007",
      "AC-008",
      "AC-010",
      "AC-011",
      "AC-012",
      "AC-014",
      "AC-015",
      "AC-016",
      "AC-017",
    ]) {
      assert.ok(!named.has(id), `${id} is not a defect's own criterion and a defect claims it`);
    }

    assert.deepEqual([...named].sort(), ["AC-001", "AC-006", "AC-009", "AC-013"]);
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

  it("carries the goal's declared boundary into the plan, where an adapter can act on it", async () => {
    // The third clause of the PASS rule has to be falsifiable, and a boundary that stopped at
    // `GoalLimits` would be documentable and unenforceable at once. The bound is only meaningful if the
    // value reaches the artifact the adapter is built from - the same shape as `--browser none`
    // reaching a plan that still promised a browser.
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
    const pattern = outcome.environment.start.readyPattern;

    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");
    assert.match(
      "cart-web provisioned: 3 files installed, 9 commands issued on Windows Server 2022",
      new RegExp(pattern),
      "the readiness pattern no longer matches the line the provisioning program prints",
    );

    const program = readProvision();
    assert.ok(
      program.includes("cart-web provisioned:"),
      "provision.mjs no longer prints the line the readiness pattern waits for",
    );
  });

  it("declares which system it stood in for, so a PASS is traceable", async () => {
    // The obligation a simulated world has to meet and a real one does not: a reader of the bundle has
    // to be able to tell that this run was judged against a substitute, and against *which* substitute.
    // A run whose plan named no release would produce a verdict indistinguishable from one decided
    // against a real machine - which is the one thing a simulation is never allowed to be.
    const outcome = await define();
    const os = outcome.environment.os;

    assert.ok(os !== null);
    assert.equal(os.family, "windows");
    assert.equal(os.system, "Windows Server 2022", "the world must name the release it stood in for");
    assert.ok(
      os.root.endsWith("examples/sim-os/app/sandbox"),
      `the sandbox root resolved to ${os.root}, which is outside the application's own tree`,
    );
  });

  it("needs both spellings of one directory, and opens the file by one and names it by the other", async () => {
    // Two names for one directory: the sandbox is `C:\...` in the world's grammar, where every criterion
    // and every `run` step spells it, and a path under this machine's temporary tree when the program
    // opens the file. A program handed only the host path would write the world's spelling to disk and
    // create a literal `C:\` directory on whichever drive Veridian ran from - which is what
    // `docs/BOUNDARY-ENFORCEMENT.md` records one layer out, and why the adapter passes both.
    const outcome = await define();
    const os = outcome.environment.os;

    assert.ok(os !== null);
    assert.equal(os.family, "windows");
    assert.ok(
      !/^[A-Za-z]:\\/.test(os.root),
      `the plan's root is ${os.root}, which is the world's spelling - the program cannot open that ` +
        "on this machine, so it must be the host path",
    );

    const program = readProvision();
    assert.ok(
      program.includes(`process.env[OS_ENV.host]`),
      "provision.mjs no longer opens files by the host path, so it would create the world's spelling" + " on disk",
    );
    assert.ok(
      program.includes(`process.env[OS_ENV.root]`),
      "provision.mjs no longer reads the world's spelling, so the paths it writes into its files would " +
        "be this machine's",
    );
  });
});
