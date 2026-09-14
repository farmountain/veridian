import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { K8S_OBSERVATION_KIND } from "../core/environment/k8s-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { DEFECTS, MANIFEST_FILES, inject, repairOne, status } from "../examples/sim-k8s/defects.ts";
import type { ManifestFile, ManifestText } from "../examples/sim-k8s/defects.ts";
import { readManifests } from "../examples/sim-k8s/manifests.ts";
import { K8S_VALIDATOR_NAMES, k8sValidators } from "../validators/k8s/k8s-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The third demo, held to the standard of the first two.
 *
 * `examples/sim-k8s/demo.ts` exists to prove one claim the previous two could not: that
 * `EnvironmentAdapter` is a seam with room for a world that is **simulated**, not merely local. The
 * application deploys itself into a substitute control plane over HTTP-ish routes the application
 * really calls, and the objects it submits are real state the substitute really holds - but there is
 * no cluster software, no container runtime and no scheduler anywhere in the loop, and this file
 * holds the two halves of that: the interfaces are real, and the substitution is declared.
 *
 * It also holds the half of the line-ending rule that `tests/inventory-db-demo.test.ts` says it
 * cannot. `D1`'s block is **multi-line** (`name: cart-web` and its `labels:` line), so the rule this
 * project paid for once - a `\n` block against a CRLF checkout matches nothing, and the run reports a
 * `PASS` the application never earned - is reachable here, and exercised against the real files on
 * disk rather than against a fixture. The database demo's table is single-line, which is why its own
 * test says the rule has to be held somewhere it can be broken; this is that somewhere.
 */

const repo = nodeIo();
const goalPath = "examples/sim-k8s/goal.yaml";

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
        registry: new ValidatorRegistry(k8sValidators()),
        registeredAdapters: ["sim-k8s"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-k8s goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

/** The manifests as they are checked in, read through the same helper the demo and the agent share. */
async function shipped(): Promise<ManifestText> {
  return readManifests();
}

// ---- the shipped manifests are the correct ones --------------------------------------------------

describe("the shipped manifests are the correct ones", () => {
  it("carries neither defect, in either file", async () => {
    const states = status(await shipped());

    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${entry.file}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/sim-k8s/demo.ts " +
          "--restore-only` to put the manifests back.",
      );
    }
  });

  it("declares edits whose correct and defective forms cannot be confused for one another", async () => {
    for (const entry of DEFECTS) {
      // If either form contained the other, `String.replace` would match the shorter inside the
      // longer and the round trip would stop being a round trip - the injection would be a no-op that
      // reported success, and the state would read `unknown`.
      assert.ok(
        !entry.defect.correct.includes(entry.defect.defective),
        `${entry.defect.id}: the defective form is a substring of the correct form`,
      );
      assert.ok(
        !entry.defect.defective.includes(entry.defect.correct),
        `${entry.defect.id}: the correct form is a substring of the defective form`,
      );
      assert.notEqual(entry.defect.correct, entry.defect.defective, `${entry.defect.id}: identical forms`);

      // And the file each block belongs to is one the table actually reads, so a defect cannot be
      // declared against a file nobody looks at - which would be a defect that never fails.
      assert.ok(
        MANIFEST_FILES.includes(entry.file),
        `${entry.defect.id} names ${entry.file}, which the table does not read`,
      );
    }
  });

  it("names each defect once, and each defect names the criterion that catches it", () => {
    const ids = DEFECTS.map((entry) => entry.defect.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so the report cannot name one");

    const criteria = DEFECTS.map((entry) => entry.defect.criterionId);
    assert.equal(
      new Set(criteria).size,
      criteria.length,
      "two defects claim the same criterion, so a repair that fixed neither could still look like " +
        "progress - the failure count would fall by one either way",
    );

    for (const entry of DEFECTS) {
      assert.match(entry.defect.criterionId, /^AC-[0-9]{3}$/, `${entry.defect.id} names an impossible criterion`);
      assert.ok(entry.defect.summary.trim().length > 0, `${entry.defect.id} has no summary for a failure report`);
    }
  });

  it("puts at most one defect in each file, so a repair cannot be credited to the wrong one", () => {
    // Not a rule the engine needs - `repairOne` takes a file at a time and would work with two blocks
    // in one file. It is a property of *this* table, and it is asserted because the failure report
    // names a defect and a file, so two defects in one file would make "repaired D1 in
    // manifests/service.yaml" an ambiguous sentence.
    const perFile = new Map<string, number>();
    for (const entry of DEFECTS) perFile.set(entry.file, (perFile.get(entry.file) ?? 0) + 1);

    for (const [file, count] of perFile) {
      assert.equal(count, 1, `${file} carries ${String(count)} defects, so a repair report cannot name one`);
    }
    assert.equal(
      perFile.size,
      MANIFEST_FILES.length,
      "the table reads a file no defect lives in, or a defect's file is not read",
    );
  });

  it("fails exactly the criteria the demo's narration claims, and leaves three untouched", async () => {
    // The discrimination claim, checked against the *contract's* own criteria rather than against a
    // hand-written list. `D2` is visible through four criteria and `D1` through two, and the table
    // names the one criterion that reads the defect itself in each case - the tag in the spec, the
    // missing object - so a reader who follows the id lands on the criterion that would have caught
    // it even if every derived count had happened to be right.
    const outcome = await define();
    const named = new Set(DEFECTS.map((entry) => entry.defect.criterionId));
    const planned = outcome.plan.criteria.map((entry) => entry.criterion.id);

    assert.deepEqual(
      DEFECTS.map((entry) => entry.defect.criterionId),
      ["AC-003", "AC-007"],
      "the defects must be walked in criterion order, because `repairOne` repairs the first one it finds",
    );

    for (const id of named) {
      assert.ok(planned.includes(id), `${id} is named by a defect but the contract does not declare it`);
    }

    // The criteria the defects are *not* allowed to be the named cause of: AC-001/AC-002 are the
    // Deployment's two records and survive both defects on the run the demo narrates, AC-006 is the
    // Service's action record and goes INCONCLUSIVE rather than FAIL, and AC-009/AC-010 deploy
    // objects of the contract's own making. None of them may be claimed by a defect, because a defect
    // that claimed one would make the run's progression a coincidence rather than a measurement.
    for (const id of ["AC-001", "AC-002", "AC-006", "AC-009", "AC-010"]) {
      assert.ok(!named.has(id), `${id} is the independent half of the contract and a defect claims it`);
    }
  });
});

// ---- injecting and repairing is a round trip -----------------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("injects both, then repairs exactly one per call, in criterion order", async () => {
    const original = await shipped();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "the first injection must land every defect");
    assert.deepEqual(first.alreadyInjected, []);

    // Idempotent: a second injection is a no-op, so a re-run cannot double-patch a manifest.
    const second = inject(first.files);
    assert.deepEqual(second.injected, []);
    assert.equal(second.alreadyInjected.length, DEFECTS.length);
    assert.deepEqual(second.files, first.files);

    const counts = [DEFECTS.length];
    let files = first.files;
    for (const entry of DEFECTS) {
      const step = repairOne(files);
      assert.equal(step.repaired?.defect.id, entry.defect.id, "repairs must follow criterion order");
      assert.equal(step.repaired?.file, entry.file, "a repair was credited to the wrong file");
      files = step.files;
      counts.push(status(files).filter((state) => state.state === "injected").length);
    }

    // The progression, asserted rather than described: 2, 1, 0. A repair that fixed both at once
    // would take the run from two named failures straight to PASS and skip the intermediate
    // observation that shows the criteria being judged independently of one another.
    assert.deepEqual(counts, [2, 1, 0]);
    assert.deepEqual(files, original, "the round trip must return the manifests to their checked-in bytes");

    const done = repairOne(files);
    assert.equal(done.repaired, null, "a third repair has nothing to do");
    assert.deepEqual(done.files, files);
  });

  it("leaves the other file untouched, so a repair is confined to the defect it names", async () => {
    const original = await shipped();
    const injected = inject(original).files;

    const [first, second] = MANIFEST_FILES;
    assert.ok(first !== undefined && second !== undefined, "the table must name two files for this case");

    const step = repairOne(injected);
    assert.equal(step.repaired?.file, first);
    assert.equal(
      step.files[second],
      injected[second],
      `${second} was rewritten by a repair that named a different file, so the report and the edit disagree`,
    );
    assert.equal(step.files[first], original[first]);
  });

  it("exercises the line-ending rule, because one of its blocks is multi-line", async () => {
    // The rule this project paid for: a textual overlay authored with `\n` against a CRLF checkout
    // matches nothing, and the run then reports a `PASS` the application never earned.
    //
    // `tests/inventory-db-demo.test.ts` states that its own table is single-line and therefore
    // ending-insensitive by construction, so the rule cannot be exercised there. It **can** be
    // exercised here: `D1`'s block spans two lines, and the checked-in manifests on this machine hold
    // CRLF. So this assertion is not a restatement of the demo's narration - it is the case that would
    // fail if `defect-text.ts` stopped re-expressing a block in the file's own ending, and the
    // injection itself is the proof, because `injectDefects` throws when a block matches neither form.
    const multiLine = DEFECTS.filter((entry) => entry.defect.correct.includes("\n"));
    assert.equal(
      multiLine.length,
      1,
      "exactly one block must span a line, or this test is asserting a property of a table it does " +
        "not describe - the same mistake the database demo's first version made in the other direction",
    );

    const original = await shipped();
    for (const file of MANIFEST_FILES) {
      const body = original[file];
      const crlf = (body.match(/\r\n/g) ?? []).length;
      const lf = (body.match(/\n/g) ?? []).length - crlf;
      assert.equal(
        crlf === 0 || lf === 0,
        true,
        `${file} has mixed line endings (${String(crlf)} CRLF, ${String(lf)} LF), so ` +
          "`newlineOf` would pick whichever came first and match only part of the file",
      );
    }

    // Both endings behave identically: the same injection lands, the same two repairs clear it, and
    // the text returns byte for byte. This is what makes the demo platform-independent.
    for (const eol of ["\n", "\r\n"] as const) {
      const variant: Record<ManifestFile, string> = { ...original };
      for (const file of MANIFEST_FILES) variant[file] = original[file].replace(/\r\n|\n/g, eol);

      let files: ManifestText = variant;
      const injected = inject(files);
      assert.equal(
        injected.injected.length,
        DEFECTS.length,
        `the injection found nothing to change in a ${JSON.stringify(eol)} manifest set, which is the ` +
          "defect this rule exists to prevent",
      );
      files = injected.files;

      for (const entry of DEFECTS) {
        const step = repairOne(files);
        assert.notEqual(step.repaired, null, `repair of ${entry.defect.id} found nothing to fix`);
        files = step.files;
      }

      for (const file of MANIFEST_FILES) {
        const text = files[file];
        assert.equal(text, variant[file], `the round trip must restore a ${JSON.stringify(eol)} ${file}`);
        assert.ok(
          text.includes(eol),
          `${file} was rewritten with a different ending than it was read with`,
        );
      }
    }
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

  it("asks the cluster world for its three facts and none of the four HTTP ones", async () => {
    // The two defects this example's first run found, held here so they cannot come back:
    //
    // 1. `cluster.name` is a *place*, not a key. Read as a literal key it is absent from every correct
    //    document, so the ladder reported three blocking gaps for values that were present.
    // 2. Every HTTP question is meaningless for a world with no socket. The predicate that skipped
    //    them knew only about a database file, so this world was asked for a URL, was handed
    //    `expectStatus: 200` and had `browser.enabled` derived `true` - a value the loader refuses
    //    outright when there is no url, which is why the run aborted with "this definition cannot be
    //    run" before it ever reached the cluster.
    //
    // The general form of both is held by `tests/environment-gaps.test.ts`, driven by the worlds table
    // rather than by this document. This asserts the *resolved* plan, which is the artifact a reader
    // of the bundle sees.
    const outcome = await define();
    const { cluster, app, appPath, start, health, reset, browser, adapter, url, databasePath } =
      outcome.environment;

    assert.equal(adapter, "sim-k8s");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/sim-k8s/app"), `appPath resolved to ${appPath}`);

    assert.ok(cluster !== null, "the plan carries no cluster, so a verdict from it could not say which one");
    assert.equal(cluster.name, "sim-local");
    assert.equal(cluster.namespace, "dev");
    assert.ok(
      cluster.imagesPath.endsWith("examples/sim-k8s/app/build/images"),
      `imagesPath resolved to ${cluster.imagesPath}`,
    );

    // Absence recorded as absence - the distinction the database demo makes for a file, made here for
    // a cluster. An empty string or a defaulted 200 would make "this world has no address"
    // indistinguishable from "nobody filled the field in".
    assert.equal(url, null);
    assert.equal(databasePath, null, "a cluster world is not a file-backed world");
    assert.equal(health.path, null);
    assert.equal(health.expectStatus, null);
    assert.equal(browser.enabled, false, "a world with no page must not carry an enabled browser");

    assert.equal(start.command, "node");
    assert.ok(start.args.some((arg) => arg === "deploy.mjs"), "the world starts something else");
    assert.equal(reset.strategy, "restart");
  });

  it("plans ten criteria in the order the contract declares them, all mandatory", async () => {
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
    ]);
    assert.equal(outcome.plan.mandatory.length, 10, "every criterion of the demo is mandatory");
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-k8s");
  });

  it("names only registered validators, and every one reads the cluster observation", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(K8S_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          K8S_OBSERVATION_KIND,
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

  it("deploys the application itself, and reads that apart from what the cluster holds", async () => {
    // The split this example was written around, and the reason it has ten criteria rather than six:
    // the action record and the state record answer different questions, and collapsing them is a
    // false pass with a longer name - an object already in the cluster before the run is not evidence
    // that this run deployed anything.
    const outcome = await define();
    const criteria = new Map(outcome.plan.criteria.map((entry) => [entry.criterion.id, entry]));

    const names = (id: string): readonly string[] =>
      (criteria.get(id)?.expectations ?? []).map((expectation) => expectation.validator.name);

    assert.deepEqual(names("AC-001"), [K8S_VALIDATOR_NAMES.applied]);
    assert.deepEqual(names("AC-002"), [K8S_VALIDATOR_NAMES.deployment]);
    assert.deepEqual(names("AC-006"), [K8S_VALIDATOR_NAMES.applied]);
    assert.deepEqual(names("AC-007"), [K8S_VALIDATOR_NAMES.service]);

    // The first four criteria observe the application's own behaviour during `start`, so a contract
    // that applied the manifests itself would be validating the contract rather than the software.
    for (const id of ["AC-001", "AC-002", "AC-003", "AC-004", "AC-005", "AC-006", "AC-007", "AC-008"]) {
      assert.equal(
        criteria.get(id)?.steps.length,
        0,
        `${id} acts on the world, so it no longer judges what the application did on its own`,
      );
    }

    // The last two act, deliberately: a world an agent cannot deploy into is a world it cannot repair
    // in, and the refusal case has to be provoked rather than waited for.
    for (const id of ["AC-009", "AC-010"]) {
      assert.ok((criteria.get(id)?.steps.length ?? 0) > 0, `${id} declares no step, so it provokes nothing`);
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
    assert.equal(outcome.goal.limits.networkPolicy, "deny");
    assert.equal(
      outcome.goal.limits.filesystemWrite,
      "sandbox",
      "the build has to be able to write the substitute registry it is asked to write, which is a " +
        "write inside the world",
    );
  });
});

// ---- the substitution is declared, not passed off as real ------------------------------------------

describe("the world says it is a substitute", () => {
  it("waits for a fact the deploy program actually prints, not for a sleep", async () => {
    const outcome = await define();
    const pattern = outcome.environment.start.readyPattern;

    assert.ok(pattern !== null, "the world must wait for a readiness pattern rather than for a sleep");
    assert.match(
      "cart-web deployed: 4 objects applied to dev",
      new RegExp(pattern),
      "the readiness pattern no longer matches the line the deploy program prints",
    );

    const deploy = await repo.readTextFile("examples/sim-k8s/app/deploy.mjs");
    assert.ok(deploy !== null, "examples/sim-k8s/app/deploy.mjs is missing, so the demo deploys nothing");
    assert.ok(
      deploy.includes("cart-web deployed:"),
      "deploy.mjs no longer prints the line the readiness pattern waits for",
    );
  });

  it("reads the registry the substitution is pointed at, rather than a list of image names", async () => {
    // A list of image names would be a second source of truth about what was built, and the
    // interesting failure - a manifest naming a tag nothing ever built - would then be a knob someone
    // set rather than a disagreement between two artifacts the run really produced.
    const outcome = await define();
    const imagesPath = outcome.environment.cluster?.imagesPath ?? "";
    assert.ok(imagesPath.endsWith("build/images"), `imagesPath resolved to ${imagesPath}`);

    const build = await repo.readTextFile("examples/sim-k8s/app/build.mjs");
    assert.ok(build !== null, "examples/sim-k8s/app/build.mjs is missing, so the registry is never produced");
    assert.ok(
      build.includes("registry.local/cart-web:1.4.0"),
      "the build no longer produces the tag the Deployment asks for, so AC-003 would fail on a " +
        "correct application",
    );
  });

  it("carries the goal's declared boundary into the plan, where an adapter can act on it", async () => {
    // The third clause of the PASS rule has to be falsifiable, and a boundary that stopped at
    // `GoalLimits` would be documentable and unenforceable at once. The bound is only meaningful if
    // the value reaches the artifact the adapter is built from - which is the same shape as
    // `--browser none` reaching a plan that still promised a browser.
    const outcome = await define();

    assert.equal(outcome.environment.boundary.network, "deny");
    assert.equal(
      outcome.environment.boundary.filesystemWrite,
      "sandbox",
      "the declared filesystem policy is what the adapter is asked to uphold, so it must reach the plan",
    );
  });
});
