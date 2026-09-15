import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { VSCODE_OBSERVATION_KIND, VSCODE_SIMULATED_SURFACES } from "../core/environment/vscode-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { VSCODE_ENV } from "../adapters/sim-vscode/sim-vscode-environment.ts";
import { DEFECTS, EXTENSION_FILE, inject, repairOne, status } from "../examples/sim-vscode/defects.ts";
import { readExtension, restoreAll, writeChanged } from "../examples/sim-vscode/source.ts";
import { VSCODE_VALIDATOR_NAMES, VSCODE_VALIDATORS, vscodeValidators } from "../validators/vscode/vscode-validators.ts";
import { inStyle, newlineOf, occurrences } from "../examples/defect-text.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The eighth demo, held to the standard of the first seven.
 *
 * `examples/sim-vscode/demo.ts` exists to prove the claim the previous seven could not: that a simulated
 * world can be an **extension host**. A real extension is really installed into a substitute host, a
 * real Node process per action really loads it and really calls it, and the world records the
 * registrations, invocations, status bar items, output channels, settings reads, durable state, files
 * and API refusals that result - with no VS Code, no Electron, no extension host process, no marketplace,
 * no user profile and no renderer anywhere in the loop.
 *
 * This file holds what is specific to *this* demo and nothing already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather than
 *   its consequence, and each naming a different criterion, because two defects that claimed one
 *   criterion would let a repair that fixed neither look like progress.
 * - **the ascending order of the filed criteria**, which is not tidiness: the repair agent walks the
 *   table in criterion order, so a table whose headline defect came *last* would leave several
 *   iterations reporting the same number of failures and the progression would read as flaky rather
 *   than as a diagnosis. Here `D1` is both the first criterion and the widest consequence, and the
 *   measured progression is `4, 3, 2, 1, 0`.
 * - **`D2` is the only block that spans a line**, which is what makes the line-ending rule reachable
 *   here at all. The rule itself is held against synthetic blocks by `tests/defect-text.test.ts`; what
 *   is held here is that *this* table reaches it, that both endings round trip, and that every one of
 *   the four anchors occurs exactly once in the shipped extension - which is the property
 *   `String.replace` needs and which a table of blocks nobody counted cannot state.
 * - **the round trip on the real file**, because the demo's whole progression rests on taking
 *   `extension.js` to the wrong state and getting the same bytes back.
 * - **the resolved definition** - the artifact a reader of the bundle sees - including the `vscode`
 *   block, which is the only thing that lets a verdict say *which* host it stood in for.
 * - **the two refusals, which are not the same refusal**: `AC-019` reads the answer the *application's*
 *   own uninstall command received, `AC-020` reads one the *criterion* asked for with a step of its
 *   own, and `AC-023` reads an API this host does not implement. Three questions with three different
 *   answers, and a contract that collapsed them would be satisfiable by the wrong one.
 * - **the world's own declaration of what it substituted**, because a reading that carried no such list
 *   could still be believed, and would be believed about the wrong thing.
 *
 * What is deliberately **not** here: the per-iteration progression. It is measured by running
 * `npm run demo:vscode`, which is the demo's own contract, and this file pins the *table* the
 * progression is derived from - which criterion each defect names, that those four are disjoint, and
 * that the other nineteen are unreachable from the table. A literal list of iteration verdicts copied
 * from one run would be a claim about a run that nothing could reproduce.
 */

const repo = nodeIo();
const goalPath = "examples/sim-vscode/goal.yaml";

/**
 * One of the demo's own application files, read off disk. Synchronous and `node:fs`-backed on purpose:
 * this is a fact about the repository the test is running in, not about a world, so it must not go
 * through a port that a substituted implementation could answer differently.
 */
function appFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../examples/sim-vscode/app/${relative}`, import.meta.url)), "utf8");
}

const PROVISIONER_FILE = "provision.mjs";
const MANIFEST_FILE = "extension/package.json";

/**
 * The four criteria a defect is filed against, in the order the repair agent walks them.
 *
 * Ascending, and that is a property rather than an accident - see the file comment. The list is written
 * once here and the table is asserted against it, so a defect filed somewhere new fails this file
 * before it can move the number the demo prints each iteration.
 */
const FILED = ["AC-014", "AC-015", "AC-016", "AC-017"] as const;

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
        registry: new ValidatorRegistry(vscodeValidators()),
        registeredAdapters: ["sim-vscode"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-vscode goal must resolve; it did not: ${outcome.reason}`,
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

// ---- the shipped extension is the correct one -------------------------------------------------------

describe("the shipped extension is the correct one", () => {
  it("carries none of the four defects", () => {
    for (const entry of status(readExtension())) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is not intact in ${EXTENSION_FILE}. A previous demo run was interrupted ` +
          "between injecting the defects and repairing them; run `node examples/sim-vscode/demo.ts " +
          "--restore-only` to put the extension back.",
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

  it("names each defect once and each criterion once, in ascending criterion order", () => {
    const ids = DEFECTS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "two defects share an id, so a report cannot name one");

    const criteria = DEFECTS.map((entry) => entry.criterionId);
    assert.deepEqual(
      criteria,
      [...FILED],
      "the table is walked in criterion order, and a reordering changes the order the repair agent " +
        "fixes things in - which is a change to what the progression means, not a tidy-up",
    );
    assert.deepEqual(
      [...criteria].sort(),
      [...criteria],
      "the filed criteria must ascend: the agent repairs the first failing one each iteration, so a " +
        "headline defect filed after a narrow one would leave the failure count flat for an iteration " +
        "and the demo would read as flaky rather than as a diagnosis",
    );
    assert.deepEqual(
      [...new Set(criteria)],
      [...FILED],
      "two defects claim one criterion, so a repair that fixed neither would still look like progress",
    );
    for (const entry of DEFECTS) {
      assert.match(entry.criterionId, /^AC-[0-9]{3}$/, `${entry.id} names a criterion id nothing parses`);
    }
    assert.equal(DEFECTS.length, 4, "the demo's progression is written for four defects");
  });

  it("edits the extension the world installs from, and nothing it generates", () => {
    assert.equal(
      EXTENSION_FILE,
      "extension/extension.js",
      "the defects live in the extension's own entry point - the file `install extension/package.json` " +
        "reads - because the world is rebuilt and re-provisioned from this tree before every iteration. " +
        "A defect injected into the installed copy under `sandbox/` would be erased by the next " +
        "iteration's own provisioning and the demo would report a repair nobody observed",
    );
    for (const entry of status(readExtension())) {
      assert.notEqual(entry.state, "unknown", `${entry.defect.id} is in the ambiguous state`);
    }
  });

  it("has every anchor present exactly once, in the file's own line ending", () => {
    const program = readExtension();
    const newline = newlineOf(program);
    for (const defect of DEFECTS) {
      // `String.replace` edits the first match, so a second occurrence would leave one site unedited and
      // the demo would report progress on a defect it only half injected. Counted through `inStyle`,
      // because a block authored with `\n` cannot match a CRLF checkout at all - and the negative half of
      // that check is the one that passes vacuously.
      assert.equal(
        occurrences(program, inStyle(defect.correct, newline)),
        1,
        `${defect.id}'s correct block does not occur exactly once in ${EXTENSION_FILE}`,
      );
      assert.equal(
        occurrences(program, inStyle(defect.defective, newline)),
        0,
        `${defect.id}'s defective block is already in ${EXTENSION_FILE}`,
      );
    }
  });

  it("carries three single-line blocks and exactly one that spans a line", () => {
    const spanning = DEFECTS.filter((entry) => entry.correct.includes("\n")).map((entry) => entry.id);
    assert.deepEqual(
      spanning,
      ["D2"],
      "the line-ending rule is only reachable through a block that spans a line, and `D2` is the one " +
        "that does: the channel line and the settings read beside it are one edit's worth of context",
    );
  });
});

// ---- the world installs from the manifest, and the extension is a real program ----------------------

describe("the world installs from the manifest, and the extension is a real program", () => {
  it("declares the four host names the provisioner reads, and wants all of them", () => {
    const declared = Object.values(VSCODE_ENV);
    assert.equal(
      declared.length,
      4,
      "the world publishes four names - the sandbox, the workspace, the host and the api version - and " +
        "a fifth would be a variable no extension could have been written against",
    );
    // The extension itself reads no environment name: it is written against the editor API, and a
    // coupling to the substitute's own variables would be a coupling to the world rather than to the
    // host it stands in for. The *provisioner* is the program that reads them, and it is the program the
    // world answers - so the agreement worth holding is between the adapter's constant and the
    // provisioner's own source, which is the file a reader consults to learn the interface.
    const wanted = new Set(appFile(PROVISIONER_FILE).match(/VERIDIAN_VSCODE_[A-Z_]+/g) ?? []);
    assert.deepEqual(
      [...wanted].sort(),
      [...declared].sort(),
      "the provisioner reads a name the world does not publish, or the reverse - and this is the list a " +
        "reader consults to learn the interface",
    );
    assert.deepEqual(
      readExtension().match(/VERIDIAN_VSCODE_[A-Z_]+/g) ?? [],
      [],
      "an extension that read the sandbox's own variables would be coupled to the substitute rather than " +
        "to the editor API it is written against",
    );
  });

  it("has a manifest whose declared commands are the ones the extension registers", () => {
    const manifest = JSON.parse(appFile(MANIFEST_FILE)) as {
      name?: unknown;
      main?: unknown;
      engines?: { vscode?: unknown };
      contributes?: { commands?: readonly { command?: unknown }[] };
    };
    assert.equal(manifest.name, "cart-web", "the world installs by the manifest's name, not the directory");
    assert.equal(manifest.main, "extension.js", "the world loads the entry point the manifest names");
    assert.equal(manifest.engines?.vscode, "^1.100.0");
    const declared = (manifest.contributes?.commands ?? []).map((entry) => entry.command);
    assert.deepEqual(
      declared,
      ["cart.add", "cart.preview-json"],
      "two contributions, and both are registered by the extension - a contribution nothing registers is " +
        "a declared command no criterion can observe running",
    );
    for (const command of declared) {
      assert.match(
        readExtension(),
        new RegExp(`registerCommand\\("${String(command)}"`),
        `the manifest declares ${String(command)} and the extension never registers it`,
      );
    }
  });

  it("unwinds what it was handed, because a host process ends in `deactivate`", () => {
    const program = readExtension();
    // An extension whose `deactivate` cannot reach the list it was given leaves every disposal reading
    // `false`, which would make `vscode.subscription` a criterion that cannot fail. The list is held at
    // module level because the host calls `deactivate()` with no arguments - the same fact the port's own
    // test fixture exists to hold.
    assert.match(
      program,
      /let subscriptions = \[\];/,
      "the extension must remember the list it was handed, or its `deactivate` has nothing to unwind",
    );
    assert.match(program, /subscriptions = context\.subscriptions;/, "assigned during `activate`");
    assert.match(
      program,
      /function deactivate\(\) \{[\s\S]*?\.dispose\(\)[\s\S]*?\}/,
      "`deactivate` must actually release something, or every disposal reading is a value that is false " +
        "by construction",
    );
  });
});

// ---- injecting and repairing round-trips the same bytes --------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("takes the extension to the defective state and back, one defect at a time", () => {
    const original = readExtension();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "injecting must land every defect");
    assert.deepEqual(
      first.injected,
      DEFECTS.map((entry) => entry.id),
      "injection walks the table in table order, which is the order the repairs undo",
    );

    const second = inject(first.text);
    assert.equal(second.text, first.text, "a second injection must be a no-op on a defective extension");
    assert.deepEqual(
      second.alreadyInjected,
      DEFECTS.map((entry) => entry.id),
      "the second pass reports every defect as already injected, in table order",
    );

    const counts = [injected(first.text).length];
    let text = first.text;
    for (const [step, entry] of DEFECTS.entries()) {
      const repaired = repairOne(text);
      assert.ok(
        repaired.repaired !== null,
        `${entry.id}: a defective extension still has the next defect the table names`,
      );
      assert.equal(
        repaired.repaired.id,
        entry.id,
        `the repair agent walks the table in criterion order, so step ${String(step)} is ${entry.id}`,
      );
      text = repaired.text;
      counts.push(injected(text).length);
    }
    assert.deepEqual(counts, [4, 3, 2, 1, 0], "each repair removes exactly one defect and no more");
    assert.equal(text, original, "the round trip must return the same bytes, ending for ending");
    assert.equal(repairOne(text).repaired, null, "a clean extension has nothing left to repair");
  });

  it("confines one repair to the one defect it names", () => {
    const original = readExtension();
    const text = inject(original).text;
    const first = repairOne(text);
    assert.ok(first.repaired !== null);

    assert.deepEqual(
      injected(first.text),
      DEFECTS.filter((entry) => entry.id !== first.repaired?.id).map((entry) => entry.id),
      "a repair that moved a second defect would make one iteration's progress unreadable",
    );
    assert.ok(
      first.text.includes(first.repaired.correct),
      "the repaired block has to be present in the file the repair returned",
    );
  });

  it("re-expresses the whole table in either ending, and the checked-in file in only one", () => {
    const original = readExtension();
    const spanning = DEFECTS.filter((entry) => entry.correct.includes("\n")).map((entry) => entry.id);
    assert.deepEqual(spanning, ["D2"], "only `D2` can reach the conversion at all");

    for (const eol of ["\n", "\r\n"]) {
      const body = original.replace(/\r\n|\n/g, eol);
      const seeded = inject(body);
      assert.equal(
        seeded.injected.length,
        DEFECTS.length,
        `injecting into an extension stored with ${JSON.stringify(eol)} line endings must land all four`,
      );
      let text = seeded.text;
      for (let step = 0; step < DEFECTS.length; step += 1) {
        const repaired = repairOne(text);
        assert.ok(repaired.repaired !== null, `a ${JSON.stringify(eol)} extension has something to repair`);
        text = repaired.text;
      }
      assert.equal(text, body, `a ${JSON.stringify(eol)} extension must come back byte for byte`);
      assert.ok(text.includes(eol), "the ending the test supplied is the ending that came back");
    }

    // The checked-in file is not mixed, which is the property that makes `newlineOf` answerable at all: a
    // file with both endings would have no single answer, and `inStyle` would convert to the wrong one for
    // half its blocks.
    const crlf = occurrences(original, "\r\n");
    const lf = occurrences(original, "\n") - crlf;
    assert.ok(crlf === 0 || lf === 0, `the checked-in ${EXTENSION_FILE} carries both line endings`);
  });

  it("restores the real file, and reports what it actually wrote", () => {
    const before = readExtension();
    try {
      const written = writeChanged(before, inject(before).text);
      assert.deepEqual(written, [EXTENSION_FILE], "writeChanged reports the file it wrote");
      assert.equal(readExtension(), inject(before).text, "the file on disk is the defective one");

      const repaired = restoreAll();
      assert.deepEqual(
        repaired,
        DEFECTS.map((entry) => `${entry.id} in ${EXTENSION_FILE}`),
        "every defect is named as it is undone, in table order",
      );
      assert.equal(readExtension(), before, "the file on disk is byte-identical to what it was");
      assert.deepEqual(restoreAll(), [], "restoring a clean file writes nothing and claims nothing");
    } finally {
      writeChanged(readExtension(), before);
    }
  });

  it("writes nothing when there is nothing to write", () => {
    const before = readExtension();
    assert.deepEqual(writeChanged(before, before), [], "an unchanged file must not be rewritten");
    assert.equal(readExtension(), before, "and the file on disk must be untouched");
  });
});

// ---- the goal, the contract and the environment agree ----------------------------------------------

describe("the goal, the contract and the environment agree", () => {
  it("resolves without asking the operator anything and without deferring anything", async () => {
    const outcome = await define();
    for (const [stage, report] of Object.entries(outcome.reports)) {
      assert.equal(report.questionsAsked, 0, `${stage}: a question was asked about a demo that is complete`);
      assert.equal(report.byVia.deferred, 0, `${stage}: a value was deferred that the document states`);
    }
  });

  it("describes an extension-host world and no other kind", async () => {
    const { environment } = await define();
    assert.equal(environment.adapter, "sim-vscode");
    assert.equal(environment.app, "app");
    assert.ok(
      environment.appPath.replace(/\\/g, "/").endsWith("examples/sim-vscode/app"),
      `the application directory resolved to ${environment.appPath}`,
    );
    assert.equal(environment.url, null, "this world is reached by running a program, not by a socket");
    assert.equal(environment.databasePath, null);
    assert.equal(environment.cluster, null);
    assert.equal(environment.posix, null);
    assert.equal(environment.os, null);
    assert.equal(environment.cloud, null);
    assert.equal(environment.container, null);
    assert.notEqual(environment.vscode, null, "a verdict here has to say which host it stood in for");
    assert.equal(environment.browser.enabled, false);
    assert.equal(environment.health.path, null);
    assert.equal(environment.health.expectStatus, null);
    assert.equal(environment.start.command, "node");
    assert.ok(environment.start.args.includes("provision.mjs"));
    assert.equal(environment.reset.strategy, "restart");
  });

  it("names the host and api version it substitutes, and the tree it keeps them in", async () => {
    const { environment } = await define();
    assert.equal(environment.vscode?.host, "veridian-vscode-sim");
    assert.equal(
      environment.vscode?.apiVersion,
      "1.100.0",
      "the api version is what the extension's own `engines.vscode` floor is compared against, so a " +
        "world that got it wrong would admit or refuse an extension it never loaded",
    );
    assert.equal(
      environment.vscode?.activationEvent,
      "onCommand:cart.add",
      "the activation event is how the world knows when to load the extension, and a contract that " +
        "activated on nothing would have no host process to read",
    );
    const root = (environment.vscode?.root ?? "").replace(/\\/g, "/");
    assert.ok(
      root.endsWith("examples/sim-vscode/app/sandbox"),
      `the sandbox root is resolved against the application directory and must land under it, not at ` +
        `${environment.vscode?.root ?? "<none>"} - rooting the world at the application directory would ` +
        "delete the extension under test on the first reset",
    );
    assert.notEqual(
      root,
      environment.appPath.replace(/\\/g, "/"),
      "the sandbox and the application directory are two different trees, and the world only owns the " +
        "second one",
    );
  });

  it("judges all twenty-three criteria and none of them optional", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);
    assert.deepEqual(
      ids,
      Array.from({ length: 23 }, (_unused, index) => `AC-${String(index + 1).padStart(3, "0")}`),
      "the contract's criteria are numbered once each, in order",
    );
    assert.equal(outcome.plan.mandatory.length, 23);
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-vscode");
    assert.equal(
      outcome.contract.goalId,
      outcome.goal.id,
      "a contract naming a different goal would be judged against another goal's environment",
    );
    assert.equal(outcome.goal.id, "sim-vscode");
  });

  it("uses every validator the family registers, and reads the family's own observation", async () => {
    const outcome = await define();
    const used = new Set(
      outcome.plan.criteria.flatMap((entry) => entry.expectations.map((expectation) => expectation.validator.name)),
    );
    assert.deepEqual(
      [...used].sort(),
      [...new Set(Object.values(VSCODE_VALIDATOR_NAMES))].sort(),
      "the contract claims to exercise the whole family; a criterion is the only thing that can hold that",
    );
    assert.equal(used.size, 17);
    for (const entry of outcome.plan.criteria) {
      for (const expectation of entry.expectations) {
        assert.equal(
          expectation.validator.observationKind,
          VSCODE_OBSERVATION_KIND,
          `${entry.criterion.id}: ${expectation.validator.name} reads another family's observation`,
        );
      }
      assert.ok(
        entry.evidence.includes("json"),
        `${entry.criterion.id} declares no json artifact, so its reading cannot be a reader's evidence`,
      );
      assert.equal(entry.criterion.mandatory, true);
    }
  });

  it("has five targetless validators, and each asks about the world itself", () => {
    const targetless = VSCODE_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(
      targetless,
      [
        VSCODE_VALIDATOR_NAMES.host,
        VSCODE_VALIDATOR_NAMES.identity,
        VSCODE_VALIDATOR_NAMES.engine,
        VSCODE_VALIDATOR_NAMES.activation,
        VSCODE_VALIDATOR_NAMES.message,
      ],
      "the questions that name no target are the ones about the world and the extension as a whole: which " +
        "host this is, which extension it loaded, whether the engine floor admitted it, whether it " +
        "activated, and what it said while it did",
    );
  });

  it("files every defect against a criterion that is planned", async () => {
    const outcome = await define();
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    const missing = FILED.filter((id) => !planned.has(id));
    assert.deepEqual(
      missing,
      [],
      "a defect filed against a criterion nothing plans can never be read by a run, so a repair would be " +
        "judged by the criteria the defect also moves and never by the one it is",
    );
  });

  it("leaves the loop room to run once per defect and to stop", async () => {
    const outcome = await define();
    const limits = outcome.goal.limits;
    assert.ok(
      limits.maxIterations >= DEFECTS.length + 1,
      "the first pass cannot repair anything, so the loop needs one more iteration than it has defects",
    );
    assert.ok(limits.maxRuntimeMs >= 1_000);
    assert.ok(limits.maxCriterionMs >= 100);
    assert.equal(limits.networkPolicy, "deny");
    assert.equal(limits.filesystemWrite, "sandbox");
  });

  it("carries the goal's boundary into the plan, where the adapter can hold it", async () => {
    const { environment, goal } = await define();
    assert.equal(
      environment.boundary.network,
      goal.limits.networkPolicy,
      "a run-time fact that reaches the object built from the plan and not the plan itself is the " +
        "`--browser none` defect: the adapter sees only the plan",
    );
    assert.equal(environment.boundary.filesystemWrite, goal.limits.filesystemWrite);
  });
});

// ---- the contract's own counts ---------------------------------------------------------------------

describe("the contract's own counts are the document's counts", () => {
  it("names two run steps, one of which expects the world to refuse it", async () => {
    const outcome = await define();
    const running = outcome.plan.criteria.filter((entry) => entry.steps.some((step) => step.kind === "run"));
    assert.deepEqual(
      running.map((entry) => entry.criterion.id),
      ["AC-020", "AC-023"],
      "`acceptance.yaml` header states these counts and commits this file to reading them off the " +
        "document, because a count in prose drifts at exactly the rate at which nothing reads it",
    );

    const refusing = running.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-020"],
      "`AC-020` sends a command this world does not implement and reads the refusal back. `AC-023` runs a " +
        "step too, and its step is not there to be refused: it is there to start a host process, because " +
        "the refusal record it reads belongs to a process and every rebuild clears it",
    );

    for (const entry of running) {
      assert.ok(
        entry.expectations.every(
          (expectation) => expectation.validator.name !== VSCODE_VALIDATOR_NAMES.call,
        ),
        `${entry.criterion.id}: \`vscode.probe\` reads what the *run* asked the world and \`vscode.call\` ` +
          "reads what the *criterion* asked it - judging a criterion about its own command with the " +
          "application's traffic would let a contract be satisfied by the questions the application asked " +
          "rather than by the answers the criterion earned",
      );
    }

    const vectors = running.map((entry) =>
      entry.steps.filter((step) => step.kind === "run").map((step) => step.argv.join(" ")),
    );
    assert.deepEqual(
      vectors,
      [["strip cart-web"], ["activate"]],
      "a run step is an argument vector rather than a command line, and the joined spelling is what the " +
        "reading is keyed by - so the target a criterion asserts on is derived from the step it sent",
    );

    const probeTargets = running.map((entry) =>
      entry.expectations
        .filter((expectation) => expectation.validator.name === VSCODE_VALIDATOR_NAMES.probe)
        .map((expectation) => expectation.target),
    );
    assert.deepEqual(
      probeTargets,
      [["strip cart-web"], []],
      "`AC-020`'s own step is a command this world is expected to refuse, so the criterion reads it back - " +
        "and reads it back at the line it sent, which is the line the world keys its record by. `AC-023`'s " +
        "step is read by nothing command-shaped, and that is what the step is for: it exists to start a " +
        "host process, because the refusal record this criterion *does* read belongs to a process and " +
        "every rebuild clears it. If a later edit gives `AC-023` a probe, this assertion is what says the " +
        "contract changed shape",
    );
  });

  it("judges three different refusals, and says which is which", async () => {
    const outcome = await define();
    const refused = outcome.plan.criteria.filter((entry) =>
      entry.expectations.some(
        (expectation) =>
          expectation.raw["equals"] === "refused" ||
          (typeof expectation.raw["contains"] === "string" &&
            expectation.raw["contains"].includes("does not implement")),
      ),
    );
    assert.deepEqual(
      refused.map((entry) => entry.criterion.id),
      ["AC-019", "AC-020", "AC-023"],
      "`AC-019` reads the answer the application's own uninstall received, `AC-020` reads one the " +
        "criterion asked for with a step of its own, and `AC-023` reads an API this host does not " +
        "implement - three questions with three different answers, and a contract that collapsed them " +
        "would be satisfiable by the wrong one",
    );
    const byName = (id: string): readonly string[] => {
      const entry = refused.find((criterion) => criterion.criterion.id === id);
      return (entry?.expectations ?? []).map((expectation) => expectation.validator.name);
    };
    assert.deepEqual(byName("AC-019"), [VSCODE_VALIDATOR_NAMES.call]);
    assert.deepEqual(byName("AC-020"), [VSCODE_VALIDATOR_NAMES.probe]);
    assert.deepEqual(byName("AC-023"), [VSCODE_VALIDATOR_NAMES.refusal]);
  });

  it("names a defect's exit through the world's own refusal rather than through an exit code", async () => {
    const outcome = await define();
    const uninstall = outcome.plan.criteria.find((entry) => entry.criterion.id === "AC-019");
    assert.ok(uninstall !== undefined);
    assert.deepEqual(
      uninstall.expectations.map((expectation) => expectation.target),
      ["uninstall cart-web"],
      "an action this world does not hold is refused by name, and the reading records the joined command " +
        "line, so the target is the command line rather than an action name",
    );
  });
});

// ---- the world says it is a substitute -------------------------------------------------------------

describe("the world says it is a substitute", () => {
  it("declares every surface it stands in for, from a closed list", () => {
    assert.deepEqual(
      [...VSCODE_SIMULATED_SURFACES],
      [
        "extension-host",
        "module-resolution",
        "activation-events",
        "command-registry",
        "window",
        "configuration",
        "workspace",
      ],
      "this list is the substitution's own declaration, and the reading carries it verbatim - a reading " +
        "that carried no such list could still be believed, and would be believed about the wrong thing",
    );
  });

  it("publishes all four names the provisioner reads, and no more", () => {
    assert.deepEqual(
      Object.values(VSCODE_ENV).sort(),
      [
        "VERIDIAN_VSCODE_API_VERSION",
        "VERIDIAN_VSCODE_HOST",
        "VERIDIAN_VSCODE_SANDBOX",
        "VERIDIAN_VSCODE_WORKSPACE",
      ],
      "the world is the only authority on the host and the api version, and the provisioner reads both",
    );
    assert.notEqual(
      VSCODE_ENV.sandbox,
      VSCODE_ENV.workspace,
      "the sandbox and the workspace are two different directories, not two spellings of one: a " +
        "criterion reads files in the workspace, and a program that wrote to the sandbox would be " +
        "writing into a directory the next reset deletes",
    );
  });

  it("announces readiness with a line the world's own pattern matches", async () => {
    const { environment } = await define();
    const pattern = environment.start.readyPattern;
    assert.notEqual(pattern, null, "a world started as a process needs something to wait for");
    assert.equal(
      environment.health.readyPattern,
      pattern,
      "the plan carries the readiness signal twice - once for the adapter, once for the manager - and " +
        "two spellings of it would let the two disagree about when the world was up",
    );
    assert.match(
      "cart-web provisioned: 6 commands on veridian-vscode-sim",
      new RegExp(pattern ?? ""),
      "the readiness pattern is matched against the line the application actually prints",
    );
    const provisioner = appFile(PROVISIONER_FILE);
    const application = /const APPLICATION = "([^"]+)";/.exec(provisioner)?.[1];
    assert.ok(
      typeof application === "string" && application.length > 0,
      "the program names the application in one place, and this reads it from there rather than " +
        "restating it - a restated name is a spelling the pattern and the program can disagree about",
    );
    assert.match(
      `${application} provisioned: 6 commands on veridian-vscode-sim`,
      new RegExp(pattern ?? ""),
      "the readiness line is built from the program's own application name, and the world's own pattern " +
        "has to match it - read the program and the pattern against each other, not one of them alone",
    );
    assert.match(
      provisioner,
      /String\(STEPS\.length\)/,
      "the completeness line reads its count off the array it actually sent, so it cannot disagree with " +
        "the stream",
    );
    assert.match(provisioner, /return 0;/, "provisioning is complete when the program says so");
  });

  it("sends its commands as JSON argument vectors on stdout and its narration on stderr", () => {
    const provisioner = appFile(PROVISIONER_FILE);
    assert.match(
      provisioner,
      /process\.stdout\.write\(`\$\{JSON\.stringify\(argv\)\}\\n`\)/,
      "the world parses stdout line by line into argument vectors, so the encoding is the interface and " +
        "a command written to stderr would be narration rather than an instruction",
    );
    assert.match(
      provisioner,
      /process\.stderr\.write/,
      "everything a human reads goes to stderr, so the command stream stays machine-readable",
    );
    assert.match(
      provisioner,
      /for \(const argv of STEPS\)/,
      "the stream is derived from the table, so its length is the table's length rather than a count",
    );
    assert.equal(
      (provisioner.match(/process\.stdout\.write/g) ?? []).length,
      1,
      "exactly one write reaches stdout, so nothing can interleave with the command vectors",
    );
  });
});
