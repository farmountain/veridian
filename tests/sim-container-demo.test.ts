import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import {
  CONTAINER_OBSERVATION_KIND,
  CONTAINER_SIMULATED_SURFACES,
} from "../core/environment/container-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { CONTAINER_ENV, CONTAINER_WORKSPACE } from "../adapters/sim-container/sim-container-environment.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-container/defects.ts";
import { readProvision, restoreAll, writeChanged } from "../examples/sim-container/source.ts";
import {
  CONTAINER_VALIDATOR_NAMES,
  CONTAINER_VALIDATORS,
  containerValidators,
} from "../validators/container/container-validators.ts";
import { inStyle, newlineOf, occurrences } from "../examples/defect-text.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The seventh demo, held to the standard of the first six.
 *
 * `examples/sim-container/demo.ts` exists to prove the claim the previous six could not: that a
 * simulated world can be a **runtime**. The application really executes, really prints a command
 * stream, and the world really executes those commands - against a substitute image store, substitute
 * container records and a substitute call log, with no Docker daemon, no Podman, no containerd, no
 * `runc`, no OCI image, no layer, no namespace, no cgroup, no registry and no outbound socket anywhere
 * in the loop. The seventh world attacks two axes the others did not: its subject is a *daemon* whose
 * every answer is a recorded fact about a command it ran, and its application is judged **as an
 * account** inside containers whose processes are real while their isolation is not.
 *
 * This file holds what is specific to *this* demo and nothing already held elsewhere:
 *
 * - **the table** - four defects, each naming the one criterion that reads the defect itself rather
 *   than its consequence, and each naming a different criterion, because two defects that claimed one
 *   criterion would let a repair that fixed neither look like progress.
 * - **the two counts in the contract's own header** - four `run` steps and one refusal among them.
 *   They are read off the resolved contract, which is the engine's parse of `acceptance.yaml` and not a
 *   regex over its text, because that header explicitly commits to a test reading them here. The first
 *   version of that header said five and two, and both numbers were wrong about the file they were
 *   describing.
 * - **`D4` is the only block that spans a line**, which is what makes the line-ending rule reachable
 *   here. The rule itself is held against synthetic blocks by `tests/defect-text.test.ts`; what is held
 *   here is that *this* table reaches it, that both endings round-trip, and that every one of the four
 *   anchors occurs exactly once in the shipped program - which is the property `String.replace` needs
 *   and which a table of blocks nobody counted cannot state.
 * - **the round trip on the real file**, because the demo's whole progression rests on taking
 *   `provision.mjs` to the wrong state and getting the same bytes back.
 * - **the resolved definition** - the artifact a reader of the bundle sees - including the `container`
 *   block, which is the only thing that lets a verdict say *which* runtime it stood in for.
 * - **the world's own declaration of what it substituted**, because a reading that carried no such list
 *   could still be believed, and would be believed about the wrong thing.
 *
 * What is deliberately **not** here: the per-iteration progression. It is measured by running
 * `npm run demo:container`, which is the demo's own contract, and this file pins the *table* the
 * progression is derived from - which criterion each defect names, that those four are disjoint, and
 * that the other twenty-three are unreachable from the table. A literal list of iteration verdicts
 * copied from one run would be a claim about a run that nothing could reproduce.
 */

const repo = nodeIo();
const goalPath = "examples/sim-container/goal.yaml";

/** The four criteria a defect is filed against, in the order the repair agent walks them. */
const FILED = ["AC-010", "AC-011", "AC-018", "AC-022"] as const;

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
        registry: new ValidatorRegistry(containerValidators()),
        registeredAdapters: ["sim-container"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the sim-container goal must resolve; it did not: ${outcome.reason}`,
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
          "between injecting the defects and repairing them; run `node examples/sim-container/demo.ts " +
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

  it("edits the file the world derives everything from, and nothing it generates", () => {
    assert.equal(
      PROVISION_FILE,
      "provision.mjs",
      "the defects live in the input to provisioning; a defect in the generated context would be " +
        "erased by the next iteration's own provisioning and the demo would report a repair nobody saw",
    );
    for (const entry of status(readProvision())) {
      assert.notEqual(entry.state, "unknown", `${entry.defect.id} is in the ambiguous state`);
    }
  });

  it("has every anchor present exactly once, in the file's own line ending", () => {
    const program = readProvision();
    const newline = newlineOf(program);
    for (const defect of DEFECTS) {
      // `String.replace` edits the first match, so a second occurrence would leave one site unedited
      // and the demo would report progress on a defect it only half injected. Counted through
      // `inStyle`, because a block authored with `\n` cannot match a CRLF checkout at all - and the
      // negative half of that check is the one that passes vacuously.
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
        "selected for it - because the two mounts in the create command share a source, so a one-line " +
        "block would occur twice and both forms would report the ambiguous `unknown` state",
    );
  });
});

// ---- the command stream is the interface the substitution rests on ---------------------------------

describe("the command stream is the interface the substitution rests on", () => {
  it("declares exactly the variables the world publishes, and reads all of them", () => {
    const declared = Object.values(CONTAINER_ENV);
    const read = new Set(readProvision().match(/VERIDIAN_CONTAINER_[A-Z_]+/g) ?? []);
    assert.equal(
      declared.length,
      4,
      "the world publishes four names - the sandbox, the workspace, the runtime and the platform - " +
        "and a fifth would be a variable no application could have been written against",
    );
    for (const name of declared) {
      assert.ok(read.has(name), `the application never reads ${name}, so the world is publishing it to nobody`);
    }
    assert.deepEqual(
      [...read].sort(),
      [...declared].sort(),
      "the application reads a name the world does not publish, or the reverse - and this is the list " +
        "a reader consults to learn the interface",
    );
  });

  it("prints each command as one JSON argument vector on stdout, and never on stderr", () => {
    const program = readProvision();
    assert.match(
      program,
      /JSON\.stringify\(argv\)/,
      "the world parses stdout line by line into argument vectors, so the encoding is the interface",
    );
    assert.match(
      program,
      /process\.stdout\.write\(JSON\.stringify\(argv\)/,
      "a command written to stderr would be narration rather than an instruction",
    );
    assert.match(
      program,
      /for \(const argv of COMMANDS\)/,
      "the stream is derived from the table, so its length is the table's length rather than a count",
    );
  });

  it("refuses a platform it does not provision rather than adapting to it", () => {
    const program = readProvision();
    assert.match(
      program,
      /platform !== "linux"/,
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
      /required\(CONTAINER_ENV\.platform\)/,
      "the platform is read from the world, not assumed - the world is the only authority on it",
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

    // The checked-in file is not mixed, which is the property that makes `newlineOf` answerable at all:
    // a file with both endings would have no single answer, and `inStyle` would convert to the wrong one
    // for half its blocks.
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

  it("describes a runtime world and no other kind", async () => {
    const { environment } = await define();
    assert.equal(environment.adapter, "sim-container");
    assert.equal(environment.app, "app");
    assert.ok(
      environment.appPath.replace(/\\/g, "/").endsWith("examples/sim-container/app"),
      `the application directory resolved to ${environment.appPath}`,
    );
    assert.equal(environment.url, null, "this world is reached by running a program, not by a socket");
    assert.equal(environment.databasePath, null);
    assert.equal(environment.cluster, null);
    assert.equal(environment.posix, null);
    assert.equal(environment.os, null);
    assert.equal(environment.cloud, null);
    assert.notEqual(environment.container, null, "a verdict here has to say which runtime it stood in for");
    assert.equal(environment.browser.enabled, false);
    assert.equal(environment.health.path, null);
    assert.equal(environment.health.expectStatus, null);
    assert.equal(environment.start.command, "node");
    assert.ok(environment.start.args.includes("provision.mjs"));
    assert.equal(environment.reset.strategy, "restart");
  });

  it("names the runtime and platform it substitutes, and the tree it keeps them in", async () => {
    const { environment } = await define();
    assert.equal(environment.container?.runtime, "docker");
    assert.equal(environment.container?.platform, "linux");
    const root = (environment.container?.root ?? "").replace(/\\/g, "/");
    assert.ok(
      root.endsWith("examples/sim-container/app/sandbox"),
      `the sandbox root is resolved against the application directory and must land under it, not at ` +
        `${environment.container?.root ?? "<none>"} - rooting the world at the application directory ` +
        "would delete the code under test on the first reset",
    );
    assert.notEqual(
      root,
      CONTAINER_WORKSPACE,
      "the host spelling of the sandbox and the container's own workspace are two different directories, " +
        "and a program that passed the host path to a command would be refused",
    );
  });

  it("judges all twenty-seven criteria and none of them optional", async () => {
    const outcome = await define();
    const ids = outcome.plan.criteria.map((entry) => entry.criterion.id);
    assert.deepEqual(
      ids,
      Array.from({ length: 27 }, (_unused, index) => `AC-${String(index + 1).padStart(3, "0")}`),
      "the contract's criteria are numbered once each, in order",
    );
    assert.equal(outcome.plan.mandatory.length, 27);
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-container");
    assert.equal(
      outcome.contract.goalId,
      outcome.goal.id,
      "a contract naming a different goal would be judged against another goal's environment",
    );
    assert.equal(outcome.goal.id, "sim-container");
  });

  it("uses every validator the family registers, and reads the family's own observation", async () => {
    const outcome = await define();
    const used = new Set(
      outcome.plan.criteria.flatMap((entry) => entry.expectations.map((expectation) => expectation.validator.name)),
    );
    assert.deepEqual(
      [...used].sort(),
      [...new Set(Object.values(CONTAINER_VALIDATOR_NAMES))].sort(),
      "the contract claims to exercise the whole family; a criterion is the only thing that can hold that",
    );
    assert.equal(used.size, 19);
    for (const entry of outcome.plan.criteria) {
      for (const expectation of entry.expectations) {
        assert.equal(
          expectation.validator.observationKind,
          CONTAINER_OBSERVATION_KIND,
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

  it("has exactly one targetless validator, and it is the one that names the runtime", () => {
    const targetless = CONTAINER_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(
      targetless,
      [CONTAINER_VALIDATOR_NAMES.runtime],
      "a validator that needs no target asks about the world itself, and there is one such question here",
    );
  });

  it("files every defect against a criterion that is planned", async () => {
    const outcome = await define();
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    const missing = FILED.filter((id) => !planned.has(id));
    assert.deepEqual(
      missing,
      [],
      "a defect filed against a criterion nothing plans can never be read by a run, so a repair would " +
        "be judged by the criteria the defect also moves and never by the one it is",
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
  it("names four run steps, one of which expects the world to refuse it", async () => {
    const outcome = await define();
    const running = outcome.plan.criteria.filter((entry) => entry.steps.some((step) => step.kind === "run"));
    assert.deepEqual(
      running.map((entry) => entry.criterion.id),
      ["AC-024", "AC-025", "AC-026", "AC-027"],
      "`acceptance.yaml`'s header states these two counts and commits this file to reading them off the " +
        "document, because a count in prose drifts at exactly the rate at which nothing reads it",
    );

    const refusing = running.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-027"],
      "a substitute that answered `answered` to a command it does not implement would satisfy every " +
        "criterion written against the application's own traffic",
    );

    for (const entry of running) {
      const probes = entry.expectations.filter(
        (expectation) => expectation.validator.name === CONTAINER_VALIDATOR_NAMES.probe,
      );
      assert.ok(
        probes.length >= 1,
        `${entry.criterion.id}: the command this criterion sent has to be read back, or the world's record ` +
          "of it is written into the bundle and judged by nothing",
      );
      assert.ok(
        entry.expectations.every(
          (expectation) => expectation.validator.name !== CONTAINER_VALIDATOR_NAMES.call,
        ),
        `${entry.criterion.id}: \`container.probe\` reads what the *run* asked the world and ` +
          "`container.call` reads what the *criterion* asked it - judging a criterion about the " +
          "application's traffic with the judge's own request would let a contract be satisfied by the " +
          "questions Veridian asked rather than by the answers the application earned",
      );
    }

    const targets = running
      .flatMap((entry) => entry.expectations)
      .filter((expectation) => expectation.validator.name === CONTAINER_VALIDATOR_NAMES.probe)
      .map((expectation) => expectation.target);
    assert.deepEqual(
      targets,
      ["image.list", "image.build", "container.exec", "image prune --all"],
      "three targets are action names and the fourth is a command line, which is the whole reason this " +
        "family's target may be either spelling - and `AC-027` is the criterion that holds that half",
    );
  });

  it("judges one other refusal off the world's own record rather than off a step", async () => {
    const outcome = await define();
    const refusing = outcome.plan.criteria.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-023", "AC-027"],
      "`AC-023` reads the refusal the *application* received from the image pull it asked for; `AC-027` " +
        "reads one the criterion asked for itself - two different questions with two different answers",
    );
  });

  it("names a defect in exactly the two descriptions that were written to name one", async () => {
    const outcome = await define();
    const naming = outcome.plan.criteria
      .filter((entry) => /\bD[1-4]\b/.test(entry.criterion.description))
      .map((entry) => entry.criterion.id);
    assert.deepEqual(
      naming,
      ["AC-018", "AC-022"],
      "two descriptions name the defect they are the control for - the two where the mechanism is not " +
        "obvious from the assertion. `AC-010` and `AC-011` describe theirs without naming it, and a " +
        "criterion that gained a name it was not written with would be a document edited to match a " +
        "narration rather than a check",
    );
    assert.ok(
      outcome.plan.criteria.length - naming.length === 25,
      "the other twenty-five descriptions name no defect, which is the control - a defect id leaking " +
        "into a criterion it does not move would make a progression read as wider than it is",
    );
  });
});

// ---- the world says it is a substitute -------------------------------------------------------------

describe("the world says it is a substitute", () => {
  it("declares every surface it stands in for, from a closed list", () => {
    assert.deepEqual(
      [...CONTAINER_SIMULATED_SURFACES],
      [
        "namespaces",
        "cgroups",
        "image-layers",
        "registry",
        "published-ports",
        "volumes",
        "user-switching",
      ],
      "this list is the substitution's own declaration, and the reading carries it verbatim - a reading " +
        "that carried no such list could still be believed, and would be believed about the wrong thing",
    );
  });

  it("publishes all four names the application reads, and no more", () => {
    assert.deepEqual(
      Object.values(CONTAINER_ENV).sort(),
      [
        "VERIDIAN_CONTAINER_PLATFORM",
        "VERIDIAN_CONTAINER_RUNTIME",
        "VERIDIAN_CONTAINER_SANDBOX",
        "VERIDIAN_CONTAINER_WORKSPACE",
      ],
      "the world is the only authority on the runtime and the platform, and the application reads both",
    );
    assert.equal(
      CONTAINER_WORKSPACE,
      "/workspace",
      "the world declares the convention rather than discovering it, so one spelling answers on both sides",
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
      "cart-web provisioned: 4 files, 13 commands",
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
      `${application} provisioned: 4 files, 13 commands`,
      new RegExp(pattern ?? ""),
      "the readiness line is built from the program's own application name, and the world's own pattern " +
        "has to match it - read the program and the pattern against each other, not one of them alone",
    );
    assert.match(
      program,
      /String\(INSTALLED\.length\)[\s\S]*String\(COMMANDS\.length\)/,
      "the completeness line reads its counts off the arrays it actually sent, so it cannot disagree " +
        "with the stream",
    );
    assert.match(program, /return 0;/, "provisioning is complete when the program says so");
  });

  it("clears the build context and writes it from scratch, so no run judges one it inherited", () => {
    const program = readProvision();
    assert.match(
      program,
      /rmSync\(contextDir, \{ recursive: true, force: true \}\)/,
      "the context lives beside the application rather than inside the sandbox, so the world's own reset " +
        "does not clear it and this program is the only thing that can",
    );
    assert.equal(
      occurrences(program, "writeFileSync(join(contextDir"),
      5,
      "one Dockerfile and four programs - the four are the context the image is built from and the " +
        "Dockerfile is what describes it, and a count read off the writes cannot drift from them",
    );
    assert.equal(
      occurrences(program, "writeFileSync(join(contextDir, \"Dockerfile\")"),
      1,
      "the descriptions side of the context is written once, from the constant above it",
    );
    assert.equal(
      occurrences(program, "_SOURCE + "),
      4,
      "the four programs are written from four source arrays, so a fifth program would have to arrive " +
        "with a source rather than as a bare path",
    );
  });
});
