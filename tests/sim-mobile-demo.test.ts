import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import {
  MOBILE_OBSERVATION_KIND,
  MOBILE_PLATFORMS,
  MOBILE_SIMULATED_SURFACES,
} from "../core/environment/mobile-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { MOBILE_ENV, MOBILE_WORKSPACE } from "../adapters/sim-mobile/sim-mobile-environment.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-mobile/defects.ts";
import { readProvision, restoreAll, writeChanged } from "../examples/sim-mobile/source.ts";
import {
  MOBILE_VALIDATOR_NAMES,
  MOBILE_VALIDATORS,
  mobileValidators,
} from "../validators/mobile/mobile-validators.ts";
import { inStyle, newlineOf, occurrences } from "../examples/defect-text.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The twelfth demo, held to the standard of the first eleven.
 *
 * `examples/sim-mobile/` exists to prove a claim the previous eleven could not: that a simulated world
 * can be a **handset**. A real provisioning program really runs, really writes a build context into its
 * own tree, really prints a command stream on stdout and real narration on stderr - and a substitute
 * device answers every command in process, holding a booted device with an OS, a screen and an
 * orientation, an installed bundle with a manifest, an entry point, a digest and a launch count, a
 * runtime permission model, deep links, a notification queue and a keychain whose digests travel while
 * its values never do. There is no emulator, no Android, no APK, no ART, no adb daemon, no guest kernel
 * and no real device anywhere in the loop.
 *
 * This file holds what is specific to *this* demo and nothing already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather than
 *   its consequence, each naming a different criterion, and deliberately in criterion order because that
 *   order *is* the repair agent's order and therefore the demo's progression.
 * - **the reach of `D2`** - the one defect here that moves more than one reading, and the second reading
 *   is the point of it: a release string reaches a notification body, which nobody thinks of as carrying
 *   one. The reach is derived from the table and the contract rather than recalled, and the derivation
 *   is compared **typed** rather than as serialized text, because `"equals":4` is a substring of
 *   `"equals":42` and a substring scan would credit a defect for a criterion it never touches.
 * - **the readiness line**, which this world prints on **stderr** rather than stdout - because stdout is
 *   the command channel here. A defect aimed at that line would take the world down instead of moving a
 *   criterion, so the guard composes the edited program and asks whether the line survives, with the
 *   positive control that stops a stale anchor from passing vacuously.
 * - **the round trip on the real file**, because the whole progression rests on taking `provision.mjs` to
 *   the wrong state and getting the same bytes back.
 * - **the resolved definition** - the artifact a reader of the bundle sees - including the `mobile`
 *   block, which is the only thing that lets a verdict say *which* device it stood in for, and the
 *   sandbox root, which must not be the application's own directory.
 * - **the world's own declaration of what it substituted**, because a reading that carried no such list
 *   could still be believed, and would be believed about the wrong thing.
 *
 * What is deliberately **not** here: the per-iteration verdicts. They are measured by running
 * `npm run demo:mobile`, which is the demo's own contract, and this file pins the *table* the progression
 * is derived from - which criterion each defect names, that those four are disjoint, and that the other
 * twenty-one are unreachable from the table. A literal list of verdicts copied from one run would be a
 * claim about a run that nothing could reproduce; the run's own `iterations` carry it instead.
 */

const repo = nodeIo();
const goalPath = "examples/sim-mobile/goal.yaml";

/** The four criteria a defect is filed against, in the order the repair agent walks them. */
const FILED = ["AC-005", "AC-007", "AC-013", "AC-015"] as const;

/** The three criteria that act in the world with a `run` step, in contract order. */
const RUNNING = ["AC-023", "AC-024", "AC-025"] as const;

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
        registry: new ValidatorRegistry(mobileValidators()),
        registeredAdapters: ["sim-mobile"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-mobile goal must resolve; it did not: ${outcome.reason}`,
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
          "between injecting the defects and repairing them; run `node examples/sim-mobile/demo.ts " +
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

  it("names each defect once and each criterion once, in criterion order", () => {
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
      [...new Set(criteria)],
      [...FILED],
      "two defects claim one criterion, so a repair that fixed neither would still look like progress",
    );
    for (const entry of DEFECTS) {
      assert.match(entry.criterionId, /^AC-[0-9]{3}$/, `${entry.id} names a criterion id nothing parses`);
    }
    assert.equal(DEFECTS.length, 4, "the demo's progression is written for four defects");
  });

  it("moves more than one reading from exactly one of the four, and that one is `D2`", async () => {
    // Derived from the table and the contract, never recalled - and the derivation is the reason this
    // test exists rather than a list beside the defects. Each defect's correct form is asked for the one
    // string literal it pins (the last quoted string in the block, which is the value the assignment or
    // the flag carries), and every criterion is asked whether what it compares still names that literal.
    //
    // The comparison is **typed**, against the value the engine parsed. A substring scan over serialized
    // JSON answers "does this string appear"; the question is "is this the value". The trap is real in
    // this repository's own history - `"equals":4` appears inside `"equals":42` - and this table has a
    // second shape of it: `D3`'s defective form `camer` is a *prefix* of its correct form `camera`, so a
    // scan keyed on the defective spelling would have found `AC-013` too and agreed by accident.
    const outcome = await define();

    const literalOf = (defect: (typeof DEFECTS)[number]): string => {
      const quoted = [...defect.correct.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
      const last = quoted[quoted.length - 1];
      if (last === undefined) {
        throw new Error(
          `${defect.id}: its correct form pins no string literal, so its reach cannot be derived from ` +
            "the contract and this row would prove nothing",
        );
      }
      return last;
    };

    const reach = DEFECTS.map((defect) => {
      const needle = literalOf(defect);
      const moved = outcome.plan.criteria
        .filter((entry) =>
          entry.expectations.some((expectation) =>
            expectation.comparisons.some((key) => {
              const value = expectation.raw[key];
              return typeof value === "string" && value.includes(needle);
            }),
          ),
        )
        .map((entry) => entry.criterion.id);
      return `${defect.id} -> ${moved.join(", ")}`;
    });

    assert.deepEqual(
      reach,
      ["D1 -> AC-005", "D2 -> AC-007, AC-016", "D3 -> AC-013", "D4 -> AC-015"],
      "the reach table the run measured is the reach the contract implies, and it is derived here " +
        "rather than written beside the defects",
    );
    assert.deepEqual(
      DEFECTS.filter((defect) => reach.some((row) => row.startsWith(`${defect.id} -> `) && row.includes(", ")))
        .map((defect) => defect.id),
      ["D2"],
      "exactly one defect moves more than one reading - it is the one whose release constant is printed " +
        "both in the bundle the device holds and in the notification body, so one edit moves two " +
        "criteria and the other three are the controls it is read against",
    );
  });

  it("edits the file the world derives everything from, and nothing it generates", () => {
    assert.equal(
      PROVISION_FILE,
      "provision.mjs",
      "the defects live in the input to provisioning; a defect in the generated context would be erased " +
        "by the next iteration's own provisioning and the demo would report a repair nobody saw",
    );
    for (const entry of status(readProvision())) {
      assert.notEqual(entry.state, "unknown", `${entry.defect.id} is in the ambiguous state`);
    }
  });

  it("has every anchor present exactly once, in the file's own line ending", () => {
    const program = readProvision();
    const newline = newlineOf(program);
    for (const defect of DEFECTS) {
      // `String.replace` edits the first match, so a second occurrence would leave one site unedited and
      // the demo would report progress on a defect it only half injected. Counted through `inStyle`,
      // because a block authored with `\n` cannot match a CRLF checkout at all - and the negative half of
      // a line-ending-blind check is the half that passes vacuously.
      assert.equal(
        occurrences(program, inStyle(defect.correct, newline)),
        1,
        `${defect.id}'s correct block does not occur exactly once in ${PROVISION_FILE}`,
      );
      assert.equal(
        occurrences(program, inStyle(defect.defective, newline)),
        0,
        `${defect.id}'s defective block is already in ${PROVISION_FILE}`,
      );
    }
  });

  it("carries three single-line blocks and exactly one that spans a line", () => {
    const spanning = DEFECTS.filter((entry) => entry.correct.includes("\n")).map((entry) => entry.id);
    assert.deepEqual(
      spanning,
      ["D4"],
      "the line-ending rule is only reachable through a block that spans a line, and `D4` is the one " +
        "selected for it - the channel and the title of the notification are two lines of one vector, and " +
        "a one-line block naming only the title would still occur once, but the whole vector is what a " +
        "reader reads",
    );
  });

  it("leaves the readiness line intact under every one of the four", () => {
    // The readiness line is what the world's own `start.readyPattern` waits for, and this world prints it
    // on stderr rather than stdout. A defect that misspelled it would make the world never come up, so the
    // criterion the defect is filed against would never be observed and the run would report
    // `INCONCLUSIVE` - a defect whose intent was to be observable instead taking the run down. The guard
    // asks the *edited* program, because that is what the world sees, and asserts the edit happened first
    // so a stale anchor cannot make the question vacuous.
    const program = readProvision();
    assert.ok(
      occurrences(program, "provisioned: ") === 1,
      "the readiness line is assembled in exactly one place, so a guard can ask whether it survives",
    );
    // The edit goes through `inStyle`, because `D4`'s block spans a line and this checkout holds the
    // program in CRLF while the table is authored with `\n`. `String.replace` with the raw block matches
    // nothing on such a checkout, so the guard would have asked its question about an *unedited* program
    // and reported the defect safe on the strength of an edit that never happened.
    const newline = newlineOf(program);
    for (const defect of DEFECTS) {
      const edited = program.replace(inStyle(defect.correct, newline), inStyle(defect.defective, newline));
      assert.notEqual(edited, program, `${defect.id}: the anchor is not in the shipped program`);
      assert.ok(
        edited.includes("provisioned: "),
        `${defect.id} edits the line the world waits for, so the criterion it is filed against could ` +
          "never be observed",
      );
      assert.ok(
        /com\.veridian\.cart/.test(edited),
        `${defect.id} removes the application name the readiness line begins with`,
      );
    }
  });
});

// ---- the command stream is the interface the substitution rests on ---------------------------------

describe("the command stream is the interface the substitution rests on", () => {
  it("declares exactly the variables the world publishes, and reads all of them", () => {
    const declared = Object.values(MOBILE_ENV);
    const read = new Set(readProvision().match(/VERIDIAN_MOBILE_[A-Z_]+/g) ?? []);
    assert.equal(
      declared.length,
      4,
      "the world publishes four names - the sandbox, the workspace, the device and the platform - and a " +
        "fifth would be a variable no application could have been written against",
    );
    for (const name of declared) {
      assert.ok(read.has(name), `the application never reads ${name}, so the world is publishing it to nobody`);
    }
    assert.deepEqual(
      [...read].sort(),
      [...declared].sort(),
      "the application reads a name the world does not publish, or the reverse - and this is the list a " +
        "reader consults to learn the interface",
    );
  });

  it("prints each command as one JSON argument vector on stdout, and all narration on stderr", () => {
    const program = readProvision();
    assert.match(
      program,
      /process\.stdout\.write\(JSON\.stringify\(argv\)/,
      "the world parses stdout line by line into argument vectors, so the encoding is the interface",
    );
    assert.match(
      program,
      /process\.stderr\.write\(line \+ "\\n"\)/,
      "every human-readable line goes to stderr, which is why this world's readiness line arrives on " +
        "stderr and why the adapter tests its pattern against both streams combined",
    );
    assert.match(
      program,
      /for \(const argv of COMMANDS\)/,
      "the stream is derived from the table, so its length is the table's length rather than a count",
    );
  });

  it("refuses a platform or a workspace it does not provision rather than adapting to it", () => {
    const program = readProvision();
    assert.deepEqual(
      [...MOBILE_PLATFORMS],
      ["android"],
      "this world answers one platform, and the application refuses any other by name rather than " +
        "adapting to it, because the path grammar a device answers with is part of what that device is",
    );
    assert.match(
      program,
      /platform !== PLATFORM/,
      "a program that adapted to another family would provision a system nobody asked for and report " +
        "success for it",
    );
    assert.match(
      program,
      /workspace !== WORKSPACE/,
      "a world that declared a different workspace would be answered with a layout rooted somewhere " +
        "else, so the disagreement is refused by name",
    );
    assert.match(
      program,
      /required\(MOBILE_ENV\.platform\)/,
      "the platform is read from the world, not assumed - the world is the only authority on it",
    );
  });

  it("writes its build context into its own tree, and clears it every time", () => {
    const program = readProvision();
    assert.match(
      program,
      /rmSync\(contextDir, \{ recursive: true, force: true \}\)/,
      "the context lives beside the application rather than inside the sandbox, so the world's own reset " +
        "does not clear it and this program is the only thing that can - and a context a run inherited is " +
        "not a context that run built",
    );
    assert.match(
      program,
      /for \(const entry of SOURCES\)/,
      "the files are written from the list the bundle count is derived from, so a count read off the " +
        "writes cannot drift from the writes",
    );
    assert.equal(
      occurrences(program, "writeFileSync(join(contextDir"),
      2,
      "one call site for the sources and one for the manifest - the manifest is written separately " +
        "because it is serialized from the same list the count comes from, and a third call site would " +
        "mean a file nothing counted",
    );
  });
});

// ---- injecting and repairing round-trips the same bytes --------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("takes the program to the defective state and back, one defect at a time", () => {
    const original = readProvision();

    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length, "injecting must land every defect");
    assert.deepEqual(
      first.injected,
      DEFECTS.map((entry) => entry.id),
      "injection walks the table in table order, which is the order the repairs undo",
    );

    const second = inject(first.text);
    assert.equal(second.text, first.text, "a second injection must be a no-op on a defective program");
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
        `${entry.id}: a defective program still has the next defect the table names`,
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
    assert.equal(repairOne(text).repaired, null, "a clean program has nothing left to repair");
  });

  it("confines one repair to the one defect it names", () => {
    const original = readProvision();
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
    const original = readProvision();
    const spanning = DEFECTS.filter((entry) => entry.correct.includes("\n")).map((entry) => entry.id);
    assert.deepEqual(spanning, ["D4"], "only `D4` can reach the conversion at all");

    for (const eol of ["\n", "\r\n"]) {
      const body = original.replace(/\r\n|\n/g, eol);
      const seeded = inject(body);
      assert.equal(
        seeded.injected.length,
        DEFECTS.length,
        `injecting into a program stored with ${JSON.stringify(eol)} line endings must land all four`,
      );
      let text = seeded.text;
      for (let step = 0; step < DEFECTS.length; step += 1) {
        const repaired = repairOne(text);
        assert.ok(repaired.repaired !== null, `a ${JSON.stringify(eol)} program has something to repair`);
        text = repaired.text;
      }
      assert.equal(text, body, `a ${JSON.stringify(eol)} program must come back byte for byte`);
      assert.ok(text.includes(eol), "the ending the test supplied is the ending that came back");
    }

    // The checked-in file is not mixed, which is the property that makes `newlineOf` answerable at all: a
    // file with both endings would have no single answer, and `inStyle` would convert to the wrong one for
    // half its blocks.
    const crlf = occurrences(original, "\r\n");
    const lf = occurrences(original, "\n") - crlf;
    assert.ok(crlf === 0 || lf === 0, `the checked-in ${PROVISION_FILE} carries both line endings`);
  });

  it("restores the real file, and reports what it actually wrote", () => {
    const before = readProvision();
    try {
      const written = writeChanged(before, inject(before).text);
      assert.deepEqual(written, [PROVISION_FILE], "writeChanged reports the file it wrote");
      assert.equal(readProvision(), inject(before).text, "the file on disk is the defective one");

      const repaired = restoreAll();
      assert.deepEqual(
        repaired,
        DEFECTS.map((entry) => `${entry.id} in ${PROVISION_FILE}`),
        "every defect is named as it is undone, in table order",
      );
      assert.equal(readProvision(), before, "the file on disk is byte-identical to what it was");
      assert.deepEqual(restoreAll(), [], "restoring a clean file writes nothing and claims nothing");
    } finally {
      writeChanged(readProvision(), before);
    }
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

  it("describes a mobile world and no other kind", async () => {
    const { environment } = await define();
    assert.equal(environment.adapter, "sim-mobile");
    assert.equal(environment.app, "app");
    assert.ok(
      environment.appPath.replace(/\\/g, "/").endsWith("examples/sim-mobile/app"),
      `the application directory resolved to ${environment.appPath}`,
    );
    assert.equal(environment.url, null, "this world is reached by running a program, not by a socket");
    assert.equal(environment.databasePath, null);
    assert.equal(environment.cluster, null);
    assert.equal(environment.posix, null);
    assert.equal(environment.os, null);
    assert.equal(environment.cloud, null);
    assert.equal(environment.container, null, "a device is not a runtime, and the blocks must not blur");
    assert.notEqual(environment.mobile, null, "a verdict here has to say which device it stood in for");
    assert.equal(environment.browser.enabled, false);
    assert.equal(environment.health.path, null);
    assert.equal(environment.health.expectStatus, null);
    assert.equal(environment.start.command, "node");
    assert.ok(environment.start.args.includes("provision.mjs"));
    assert.equal(environment.reset.strategy, "restart");
  });

  it("names the device and the platform it substitutes, and the tree it keeps them in", async () => {
    const { environment } = await define();
    assert.equal(environment.mobile?.device, "sim-cart-device");
    assert.equal(environment.mobile?.platform, "android");
    const root = (environment.mobile?.root ?? "").replace(/\\/g, "/");
    assert.ok(
      root.endsWith("examples/sim-mobile/app/sandbox"),
      `the sandbox root is resolved against the application directory and must land under it, not at ` +
        `${environment.mobile?.root ?? "<none>"} - rooting the world at the application directory would ` +
        "delete the code under test on the first reset",
    );
    assert.notEqual(
      root,
      MOBILE_WORKSPACE,
      "the host spelling of the sandbox and the device's own workspace are two different directories, " +
        "and a program that passed the host path to a command would be refused",
    );
  });

  it("judges all twenty-five criteria and none of them optional", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);
    assert.deepEqual(
      ids,
      Array.from({ length: 25 }, (_unused, index) => `AC-${String(index + 1).padStart(3, "0")}`),
      "the contract's criteria are numbered once each, in order",
    );
    assert.equal(outcome.plan.mandatory.length, 25);
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-mobile");
    assert.equal(
      outcome.contract.goalId,
      outcome.goal.id,
      "a contract naming a different goal would be judged against another goal's environment",
    );
    assert.equal(outcome.goal.id, "sim-mobile");
  });

  it("uses every validator the family registers, and reads the family's own observation", async () => {
    const outcome = await define();
    const used = new Set(
      outcome.plan.criteria.flatMap((entry) => entry.expectations.map((expectation) => expectation.validator.name)),
    );
    assert.deepEqual(
      [...used].sort(),
      [...new Set(Object.values(MOBILE_VALIDATOR_NAMES))].sort(),
      "the contract claims to exercise the whole family; a criterion is the only thing that can hold that",
    );
    assert.equal(used.size, 12);
    for (const entry of outcome.plan.criteria) {
      for (const expectation of entry.expectations) {
        assert.equal(
          expectation.validator.observationKind,
          MOBILE_OBSERVATION_KIND,
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

  it("has five targetless validators, and they are the ones that ask about the world itself", () => {
    const targetless = MOBILE_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(
      targetless,
      [
        MOBILE_VALIDATOR_NAMES.device,
        MOBILE_VALIDATOR_NAMES.os,
        MOBILE_VALIDATOR_NAMES.screen,
        MOBILE_VALIDATOR_NAMES.orientation,
        MOBILE_VALIDATOR_NAMES.installed,
      ],
      "the device, its operating system, its screen, the orientation it is held at and how many bundles " +
        "it holds are five questions about the world rather than about one thing inside it",
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

  it("names no defect in any criterion description, so the ids live in one table", async () => {
    const outcome = await define();
    const naming = outcome.plan.criteria
      .filter((entry) => /\bD[1-4]\b/.test(entry.criterion.description))
      .map((entry) => entry.criterion.id);
    assert.deepEqual(
      naming,
      [],
      "this contract's descriptions describe the reading rather than the edit behind it, so a description " +
        "cannot go stale against `defects.ts` - the table is the only place a defect is named",
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
  it("names three run steps, one of which expects the world to refuse it", async () => {
    const outcome = await define();
    const running = outcome.plan.criteria.filter((entry) => entry.steps.some((step) => step.kind === "run"));
    assert.deepEqual(
      running.map((entry) => entry.criterion.id),
      [...RUNNING],
      "a criterion acts in the world rather than only reading it, and these three are the ones",
    );

    const refusing = running.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-025"],
      "a substitute that answered `answered` to a command it does not implement would satisfy every " +
        "criterion written against the application's own traffic - and this world answers a closed " +
        "register, so the refusal is a *result* in the reading rather than an exception",
    );

    for (const entry of running) {
      const probes = entry.expectations.filter(
        (expectation) => expectation.validator.name === MOBILE_VALIDATOR_NAMES.probe,
      );
      assert.ok(
        probes.length >= 1,
        `${entry.criterion.id}: the command this criterion sent has to be read back, or the world's ` +
          "record of it is written into the bundle and judged by nothing",
      );
      assert.ok(
        entry.expectations.every(
          (expectation) => expectation.validator.name !== MOBILE_VALIDATOR_NAMES.call,
        ),
        `${entry.criterion.id}: \`mobile.probe\` reads what the *run* asked the world and \`mobile.call\` ` +
          "reads what the *criterion* asked it - judging a criterion about the application's traffic with " +
          "the judge's own request would let a contract be satisfied by the questions Veridian asked " +
          "rather than by the answers the application earned",
      );
    }

    const targets = running
      .flatMap((entry) => entry.expectations)
      .filter((expectation) => expectation.validator.name === MOBILE_VALIDATOR_NAMES.probe)
      .map((expectation) => expectation.target);
    assert.deepEqual(
      targets,
      ["device.rotate", "bundle.uninstall", "device factoryReset"],
      "two targets are action names and the third is a command line no handler serves, which is the " +
        "whole reason this family's target may be either spelling - and `AC-025` holds that half",
    );
  });

  it("judges one other refusal off the application's own traffic", async () => {
    const outcome = await define();
    const refusing = outcome.plan.criteria.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-022", "AC-025"],
      "`AC-022` reads the refusal the *application* received from the command it sent first; `AC-025` " +
        "reads one the criterion asked for itself - two different questions with two different answers, " +
        "and the pair inverts where a reader expects it",
    );
  });

  it("uses the call validator only where the criterion's own request is the subject", async () => {
    const outcome = await define();
    const calling = outcome.plan.criteria
      .filter((entry) =>
        entry.expectations.some(
          (expectation) => expectation.validator.name === MOBILE_VALIDATOR_NAMES.call,
        ),
      )
      .map((entry) => entry.criterion.id);
    assert.deepEqual(
      calling,
      ["AC-020", "AC-021", "AC-022"],
      "three criteria read the request the application made - the bundle it installed, the bundle it " +
        "launched and the command the world refused it",
    );
    const callTargets = outcome.plan.criteria
      .flatMap((entry) => entry.expectations)
      .filter((expectation) => expectation.validator.name === MOBILE_VALIDATOR_NAMES.call)
      .map((expectation) => expectation.target);
    assert.deepEqual(
      callTargets,
      ["bundle.install", "bundle.launch", "device factoryReset"],
      "no criterion reads the `permission.grant` request, which is why `D3` - a swap that leaves the " +
        "command well formed - has nothing else in the contract to disturb",
    );
  });

  it("pairs a probe with a second reading on exactly two criteria", async () => {
    const outcome = await define();
    const paired = outcome.plan.criteria
      .filter((entry) => {
        const names = entry.expectations.map((expectation) => expectation.validator.name);
        return names.includes(MOBILE_VALIDATOR_NAMES.probe) && names.length > 1;
      })
      .map((entry) => entry.criterion.id);
    assert.deepEqual(
      paired,
      ["AC-023", "AC-024"],
      "a criterion that acts in the world is asked two questions: whether the world did what it was " +
        "told, and what the world holds afterwards. `AC-025` asks only the first, because the world " +
        "refused the command and nothing changed",
    );
    const probes = MOBILE_VALIDATORS.filter(
      (validator) => validator.name === MOBILE_VALIDATOR_NAMES.probe,
    )[0];
    assert.ok(probes !== undefined);
    assert.deepEqual(
      probes.comparisons,
      ["equals"],
      "an action has four possible results and none of them is a substring of another, so this validator " +
        "compares one value and offers no `contains` an expectation could hide in",
    );
    const call = MOBILE_VALIDATORS.filter((validator) => validator.name === MOBILE_VALIDATOR_NAMES.call)[0];
    assert.ok(call !== undefined);
    assert.deepEqual(call.comparisons, ["equals"]);
  });
});

// ---- the world says it is a substitute -------------------------------------------------------------

describe("the world says it is a substitute", () => {
  it("declares every surface it stands in for, from a closed list", () => {
    assert.deepEqual(
      [...MOBILE_SIMULATED_SURFACES],
      [
        "device",
        "emulator",
        "touch-os",
        "display",
        "input",
        "sandbox",
        "keychain-service",
        "app-store",
        "push-service",
      ],
      "this list is the substitution's own declaration, and the reading carries it verbatim - a reading " +
        "that carried no such list could still be believed, and would be believed about the wrong thing",
    );
  });

  it("publishes all four names the application reads, and no more", () => {
    assert.deepEqual(
      Object.values(MOBILE_ENV).sort(),
      [
        "VERIDIAN_MOBILE_DEVICE",
        "VERIDIAN_MOBILE_PLATFORM",
        "VERIDIAN_MOBILE_SANDBOX",
        "VERIDIAN_MOBILE_WORKSPACE",
      ],
      "the world is the only authority on the device and the platform, and the application reads both",
    );
    assert.equal(
      MOBILE_WORKSPACE,
      "/data/local/tmp/workspace",
      "the world declares the convention rather than discovering it, so one spelling answers on both " +
        "sides - and it is deliberately not the sandbox's own host path",
    );
    assert.notEqual(
      MOBILE_WORKSPACE,
      "/workspace",
      "the device's workspace and the runtime world's are different conventions, and sharing one " +
        "spelling across two worlds would make a path that is right in one silently wrong in the other",
    );
  });

  it("announces readiness with a line the world's own pattern matches", async () => {
    const { environment } = await define();
    const pattern = environment.start.readyPattern;
    assert.notEqual(pattern, null, "a world started as a process needs something to wait for");
    assert.equal(
      environment.health.readyPattern,
      pattern,
      "the plan carries the readiness signal twice - once for the adapter, once for the manager - and two " +
        "spellings of it would let the two disagree about when the world was up",
    );
    assert.match(
      "com.veridian.cart provisioned: 5 files, 12 commands",
      new RegExp(pattern ?? ""),
      "the readiness pattern is matched against the line the application actually prints",
    );
    const program = readProvision();
    const application = /const APPLICATION = "([^"]+)";/.exec(program)?.[1];
    assert.ok(
      typeof application === "string" && application.length > 0,
      "the program names the application in one place, and this reads it from there rather than " +
        "restating it - a restated name is a spelling the pattern and the program can disagree about",
    );
    assert.match(
      `${application} provisioned: 5 files, 12 commands`,
      new RegExp(pattern ?? ""),
      "the readiness line is built from the program's own application name, and the world's own pattern " +
        "has to match it - read the program and the pattern against each other, not one of them alone",
    );
    assert.match(
      program,
      /String\(BUNDLE_FILES\.length\)[\s\S]*String\(COMMANDS\.length\)/,
      "the completeness line reads its counts off the arrays it actually sent, so it cannot disagree " +
        "with the stream",
    );
    assert.match(program, /return 0;/, "provisioning is complete when the program says so");
  });

  it("carries the digest of a keychain value while never recording the value", () => {
    const program = readProvision();
    assert.match(
      program,
      /const SESSION_VALUE = /,
      "the application supplies a secret, so there is something whose value must not survive",
    );
    assert.match(
      program,
      /const SESSION_KEY = /,
      "the entry is named by a key, and the reading is about the key rather than the value",
    );
    assert.match(
      program,
      /"keychain", "set", SESSION_KEY, APPLICATION/,
      "the subject of a keychain command is the entry name and the bundle follows it - getting that " +
        "order backwards names an entry nothing holds, which is the same class of failure `D3` is",
    );
  });
});
