import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, describe, it } from "node:test";

import { PROCESS_ENV, PROCESS_ENV_NAMES } from "../adapters/local-process/index.ts";
import type { EvidenceKind } from "../core/acceptance/types.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import { PROCESS_OBSERVATION_KIND } from "../core/environment/process-observation.ts";
import { nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { newlineOf, occurrences } from "../examples/defect-text.ts";
import { DEFECTS, inject, repairOne, status } from "../examples/local-process/defects.ts";
import { PROCESS_VALIDATOR_NAMES, processValidators } from "../validators/process/process-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The tenth demo, and the second world that is not simulated at all.
 *
 * `examples/local-process/demo.ts` asserts its own outcome - it fails if the run does not descend to
 * nine of nine - but that assertion is about *the application the demo ships*, and the demo's own
 * narration is about the *reach* of each defect. Those are different claims and this file holds the
 * second one, because a reach table is a claim about every expectation in the contract and the
 * repository has already paid once for a table whose commentary was written from a defect's *name*
 * rather than read off a run.
 *
 * The guard below that earns its place is the row probe. A defect's `criterionId` is a claim that the
 * defect's block sits on *that criterion's code path*, and the only way to hold that claim is to
 * compile the application, inject the defect, run it, and watch the value the criterion compares
 * move. Reading the two blocks side by side proves nothing: the fourth defect in this table was first
 * aimed at a narration line that criterion's own command never reaches, and the table looked right.
 *
 * Everything here therefore runs the *real* program through the *real* interpreter, in a sandbox
 * this file creates and deletes, with the world's own environment names - `VERIDIAN_PROCESS_ROOT` and
 * friends - rather than a rewrite of what the application reads.
 */

const repo = nodeIo();
const programPath = "examples/local-process/app/cart-build.mjs";
const demoPath = "examples/local-process/demo.ts";
const goalPath = "examples/local-process/goal.yaml";
const environmentPath = "examples/local-process/environment.yaml";
const CHANNEL = "nightly";
/** The fragment of the banner the world's readiness check waits for. Held against the source below. */
const READY_LITERAL = "cart-build audit daemon ready";

let cached: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (cached ??= loadSchemaSet(repo));

async function readProgram(): Promise<string> {
  const body = await repo.readTextFile(programPath);
  assert.ok(body !== null, `${programPath} is missing, so the demo has no application to validate`);
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
        registry: new ValidatorRegistry(processValidators()),
        registeredAdapters: ["local-process"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved" ? "" : `the process goal must resolve; it did not: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return resolved;
}

/**
 * Where each defect is observable, and what the world's program answers once it is in.
 *
 * `token` is the value the *shipped* application produces. It is also the value the filed
 * criterion's own assertion names, which is what makes the reach below derivable rather than
 * recalled: a criterion is moved by a defect exactly when its expectations quote the value that
 * defect changes. Measured against the demo's own run, this derivation reproduces the failing count
 * of every iteration - which is the whole reason it is written as a derivation.
 */
interface DefectRow {
  readonly defect: string;
  readonly criterion: string;
  readonly validator: string;
  readonly target: string;
  /**
   * The value the shipped program answers with - the value the filed criterion's expectation quotes.
   *
   * It is deliberately *not* the contract's own spelling of that comparison. `D2` moves the exit
   * code `4`, and the document pinning it says `"equals": 4`, so asking whether the raw JSON
   * *contains* `"equals":4` credits `D2` with `AC-006` as well - whose size expectation serializes
   * as `"equals":42`. That is exactly what the first version of this file did, and the derivation
   * below then disagreed with the run. `moved` asks the typed comparison instead.
   */
  readonly answered: string;
  /** What the world answers with the defect in. */
  readonly injected: string;
  /**
   * Whether one of this criterion's compared values is the value this defect moves.
   *
   * Typed rather than textual, because the question is about a value and not about how a document
   * happens to serialize one.
   */
  readonly moved: (values: readonly unknown[]) => boolean;
  /** A reduced, normalized reading of the run - the one value that moves. */
  readonly probe: (program: string, sandbox: string) => Promise<string>;
}

/** One expectation as the plan holds it: the keys the engine parsed, and the document that stated them. */
type PlannedExpectation = ResolvedDefinition["plan"]["criteria"][number]["expectations"][number];

/** The values one expectation compares, read by the keys the engine parsed - never the raw text. */
function comparedValues(expectation: PlannedExpectation): readonly unknown[] {
  return expectation.comparisons.map((key) => expectation.raw[key]);
}

/** A compared string that carries a given reading. */
function mentions(needle: string): (values: readonly unknown[]) => boolean {
  return (values) => values.some((value) => typeof value === "string" && value.includes(needle));
}

/** A compared number that is exactly a given one - the exit code, which has no spelling to match. */
function equalsNumber(expected: number): (values: readonly unknown[]) => boolean {
  return (values) => values.some((value) => value === expected);
}

const ROOT_OF_HOST = /version [0-9.]+/;
const CHAN = /\bchan\w+\b/;
const EMPTY = "<stdout empty>";

const ROWS: readonly DefectRow[] = [
  {
    defect: "D1-release-version-drifts",
    criterion: "AC-003",
    validator: PROCESS_VALIDATOR_NAMES.stdout,
    target: "1",
    answered: "1.4.0",
    injected: "version 1.4.1",
    moved: mentions("1.4.0"),
    probe: async (program, sandbox) => (await runProgram(program, ["build"], sandbox)).stdout.match(ROOT_OF_HOST)?.[0] ?? "<no version printed>",
  },
  {
    defect: "D2-stray-list-emptied",
    criterion: "AC-005",
    validator: PROCESS_VALIDATOR_NAMES.exitcode,
    target: "3",
    answered: "4",
    injected: "0",
    moved: equalsNumber(4),
    probe: async (program, sandbox) => {
      await runProgram(program, ["build"], sandbox);
      await runProgram(program, ["add", "dist/extra.txt"], sandbox);
      const verified = await runProgram(program, ["verify"], sandbox);
      return String(verified.code);
    },
  },
  {
    defect: "D3-banner-misspelt",
    criterion: "AC-001",
    validator: PROCESS_VALIDATOR_NAMES.stdout,
    target: "app",
    answered: "channel",
    injected: "chanel",
    moved: mentions("audit daemon ready (channel nightly"),
    probe: async (program, sandbox) => (await bannerOf(program, sandbox)).match(CHAN)?.[0] ?? "<no banner printed>",
  },
  {
    defect: "D4-narration-on-stderr",
    criterion: "AC-006",
    validator: PROCESS_VALIDATOR_NAMES.stdout,
    target: "1",
    answered: "cart-build: added notes/todo.txt",
    injected: EMPTY,
    moved: mentions("cart-build: added notes/todo.txt"),
    probe: async (program, sandbox) => {
      const added = await runProgram(program, ["add", "notes/todo.txt"], sandbox);
      const said = added.stdout.trim();
      return said === "" ? EMPTY : said;
    },
  },
];

interface AppRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The environment the world itself installs, so the application is run as the world runs it. */
function environmentFor(sandbox: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [PROCESS_ENV.host]: "cart-builder",
    [PROCESS_ENV.root]: sandbox,
    [PROCESS_ENV.app]: dirname(sandbox),
    CART_BUILD_CHANNEL: CHANNEL,
  };
}

/**
 * One command, run to completion.
 *
 * `stdin` is `ignore` on purpose, because that is how the world spawns it: a program that prompted
 * would get an immediate end of input rather than a conversation, so a criterion that waited for a
 * prompt would wait forever. The entry point is `process.execPath` rather than a bare `node`, so the
 * test uses the interpreter that is actually running it.
 */
function runProgram(program: string, args: readonly string[], sandbox: string): Promise<AppRun> {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [program, ...args], {
      cwd: dirname(program),
      env: environmentFor(sandbox),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = child.stdout;
    const err = child.stderr;
    if (out === null || err === null) {
      fail(new Error("both streams are piped, so neither can be absent"));
      return;
    }
    let stdout = "";
    let stderr = "";
    out.setEncoding("utf8");
    err.setEncoding("utf8");
    out.on("data", (chunk: string) => (stdout += chunk));
    err.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

/**
 * The first line the daemon prints, which is the banner the world's readiness check waits for.
 *
 * Bounded rather than awaited forever: a daemon that printed nothing would otherwise make this file
 * hang, and a hang is not a verdict. The bound is the other half of the check - a wait that could not
 * fail would turn every row below into a formality.
 */
function bannerOf(program: string, sandbox: string): Promise<string> {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [program, "daemon"], {
      cwd: dirname(program),
      env: environmentFor(sandbox),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = child.stdout;
    const err = child.stderr;
    if (out === null || err === null) {
      fail(new Error("both streams are piped, so neither can be absent"));
      return;
    }
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      fail(new Error("the daemon printed no banner within 10s"));
    }, 10_000);
    out.setEncoding("utf8");
    // Drained rather than ignored: a full pipe would otherwise hold the process open behind a
    // buffer nobody is reading, which is a hang dressed up as a slow daemon.
    err.setEncoding("utf8");
    err.on("data", () => {});
    out.on("data", (chunk: string) => {
      stdout += chunk;
      if (settled || !stdout.includes("\n")) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      settle(stdout);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(error);
    });
  });
}

/** The shipped program, the injected one, and a sandbox each row gets a fresh child of. */
let prepared: Promise<{ root: string; shipped: string; injected: string }> | undefined;
function prepare(): Promise<{ root: string; shipped: string; injected: string }> {
  prepared ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "veridian-local-process-"));
    const shipped = await readProgram();
    const injected = inject(shipped);
    assert.equal(
      injected.injected.length,
      DEFECTS.length,
      "every defect must be injectable into the shipped program for the rows below to mean anything",
    );
    const injectedPath = join(root, "cart-build.defective.mjs");
    const shippedPath = join(root, "cart-build.mjs");
    await writeFile(shippedPath, shipped, "utf8");
    await writeFile(injectedPath, injected.text, "utf8");
    return { root, shipped: shippedPath, injected: injectedPath };
  })();
  return prepared;
}

async function sandboxFor(root: string, row: string): Promise<string> {
  return mkdtemp(join(root, `sandbox-${row}-`));
}

after(async () => {
  const pending = prepared;
  if (pending === undefined) return;
  try {
    await rm((await pending).root, { recursive: true, force: true });
  } catch {
    // A cleanup that failed is not a verdict about the world, and a test that failed for it would be
    // reporting the operating system rather than the program.
  }
});

describe("the shipped application is the correct one", () => {
  it("reports all four defects intact, and none of them is a no-op", async () => {
    const program = await readProgram();
    const states = status(program);

    assert.deepEqual(
      states.map((entry) => entry.state),
      states.map(() => "intact"),
      "the demo's application must ship correct, or the first iteration proves nothing",
    );
    for (const defect of DEFECTS) {
      assert.notEqual(
        defect.correct,
        defect.defective,
        `${defect.id} replaces a block with itself, so injecting it would change nothing`,
      );
      assert.equal(
        defect.correct.includes(defect.defective),
        false,
        `${defect.id}'s correct block contains its defective block, so the two cannot be told apart`,
      );
      assert.equal(defect.defective.includes(defect.correct), false, `${defect.id} is ambiguous`);
    }
  });

  it("files each defect against a criterion of this contract, and never two against one", async () => {
    const outcome = await define();
    const declared = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));

    assert.equal(new Set(DEFECTS.map((defect) => defect.id)).size, DEFECTS.length);
    assert.equal(new Set(DEFECTS.map((defect) => defect.criterionId)).size, DEFECTS.length);
    for (const defect of DEFECTS) {
      assert.match(defect.criterionId, /^AC-[0-9]{3}$/);
      assert.ok(declared.has(defect.criterionId), `${defect.id} is filed against a criterion no contract declares`);
      assert.ok(defect.summary.trim().length > 0, `${defect.id} explains nothing`);
    }
  });

  it("keeps every defect block on one line, so the table cannot depend on a line ending", async () => {
    for (const defect of DEFECTS) {
      assert.equal(defect.correct.includes("\n"), false, `${defect.id}'s correct block is multi-line`);
      assert.equal(defect.defective.includes("\n"), false, `${defect.id}'s defective block is multi-line`);
    }
  });
});

describe("injecting and repairing round-trips the same bytes", () => {
  it("is idempotent, repairs in table order, and restores the program exactly", async () => {
    const original = await readProgram();
    const first = inject(original);
    assert.equal(first.injected.length, DEFECTS.length);

    const again = inject(first.text);
    assert.deepEqual(again.injected, [], "a second injection must add nothing");
    assert.equal(again.alreadyInjected.length, DEFECTS.length);
    assert.equal(again.text, first.text, "injecting twice must change nothing");

    let text = first.text;
    const counts: number[] = [DEFECTS.length];
    for (const defect of DEFECTS) {
      const step = repairOne(text);
      assert.equal(step.repaired?.id, defect.id, "repairs must follow table order");
      assert.equal(step.repaired?.criterionId, defect.criterionId);
      text = step.text;
      counts.push(status(text).filter((entry) => entry.state === "injected").length);
    }
    assert.deepEqual(counts, [4, 3, 2, 1, 0]);
    assert.equal(text, original, "four repairs must restore the shipped bytes");

    const exhausted = repairOne(text);
    assert.equal(exhausted.repaired, null);
    assert.equal(exhausted.text, text);
  });

  it("refuses a program it neither recognises nor can edit", async () => {
    const stranger = "export const nothing = 1;\n";
    assert.deepEqual(
      status(stranger).map((entry) => entry.state),
      DEFECTS.map(() => "unknown"),
    );
    assert.throws(() => inject(stranger), /neither the correct nor the defective/);
    assert.throws(() => repairOne(stranger), /neither the correct nor the defective/);
    assert.equal(status(stranger).length, DEFECTS.length);
  });

  it("expresses every block in whatever ending the program it is editing uses", async () => {
    // Every block in this table is single-line, so the ending cannot change the outcome here - which
    // is exactly why this test asserts the *insensitivity* rather than a particular ending. Asserting
    // that this file is CRLF would be an assertion about the developer's git configuration: measured,
    // the committed blob is LF, `core.autocrlf` is true here and false in CI, and the first version
    // of this assertion failed on ubuntu for that reason and could never have passed there.
    const program = await readProgram();
    const lf = occurrences(program, "\n");
    const crlf = occurrences(program, "\r\n");
    assert.ok(crlf === 0 || crlf === lf, "the shipped program must not mix line endings");

    for (const ending of ["\n", "\r\n"]) {
      const variant = DEFECTS.map((defect) => defect.correct).join(ending);
      const injected = DEFECTS.reduce((text, defect) => inject(text).text, variant);
      assert.equal(status(injected).filter((entry) => entry.state === "injected").length, DEFECTS.length);
      const repaired = DEFECTS.reduce((text) => repairOne(text).text, injected);
      assert.equal(repaired, variant);
    }
    assert.equal(newlineOf(program), crlf > 0 ? "\r\n" : "\n");
  });
});

describe("every defect moves the value its own criterion compares", () => {
  it("names its filed criterion, a registered validator of this world's family and a path on it", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(PROCESS_VALIDATOR_NAMES));

    for (const row of ROWS) {
      const defect = DEFECTS.find((entry) => entry.id === row.defect);
      assert.ok(defect !== undefined, `${row.defect} is named by a row and not by the table`);
      assert.equal(defect.criterionId, row.criterion, `${row.defect} is filed against another criterion`);
      assert.ok(registered.has(row.validator), `${row.validator} is not a registered validator`);

      const criterion = outcome.plan.criteria.find((entry) => entry.criterion.id === row.criterion);
      assert.ok(criterion !== undefined, `${row.criterion} is not in the contract`);
      const expectation = criterion.expectations.find(
        (entry) => entry.validator.name === row.validator && entry.target === row.target,
      );
      assert.ok(
        expectation !== undefined,
        `${row.criterion} does not read ${row.validator} on \`${row.target}\`, so this defect is filed ` +
          "against a criterion that never looks at it",
      );
      assert.ok(
        row.moved(comparedValues(expectation)),
        `${row.criterion}'s \`${row.validator}\` comparison does not read the value ${row.defect} changes, ` +
          "so a repair would be invisible to the criterion filed against it",
      );
    }
  });

  it("changes what the program answers, run through the real interpreter", async () => {
    const { root, shipped, injected } = await prepare();

    for (const row of ROWS) {
      const sandbox = await sandboxFor(root, row.defect);
      const correct = await row.probe(shipped, sandbox);
      assert.ok(
        correct.includes(row.answered),
        `${row.criterion} is filed against ${row.defect}, but the shipped program answered ` +
          `\`${correct}\` where the criterion reads \`${row.answered}\``,
      );

      const sandboxForInjected = await sandboxFor(root, `${row.defect}-injected`);
      const defective = await row.probe(injected, sandboxForInjected);
      assert.equal(
        defective,
        row.injected,
        `${row.defect} was injected and the program still answered \`${defective}\`, so the defect is ` +
          `${row.criterion}'s alone to notice only if this value moved`,
      );
    }
  });

  it("derives the descent the demo narrates, and the demo narrates exactly that", async () => {
    // The reach map written down rather than reasoned from the defects' names. A criterion is moved by
    // a defect when its own expectations quote the value that defect changes, so the set of criteria
    // that fail in the first iteration, and the iteration at which each one clears, both follow from
    // the contract - and the figure the demo prints has to be that figure.
    const outcome = await define();
    const movers = new Map<string, string[]>();
    for (const row of ROWS) {
      for (const criterion of outcome.plan.criteria) {
        const quoted = criterion.expectations.some((entry) => row.moved(comparedValues(entry)));
        if (!quoted) continue;
        const list = movers.get(criterion.criterion.id) ?? [];
        list.push(row.defect);
        movers.set(criterion.criterion.id, list);
      }
    }
    const reach = new Map(ROWS.map((row) => [row.defect, moversOf(movers, row.defect)]));
    assert.deepEqual(reach.get("D1-release-version-drifts"), ["AC-003", "AC-004", "AC-008"]);
    assert.deepEqual(reach.get("D2-stray-list-emptied"), ["AC-005"]);
    assert.deepEqual(reach.get("D3-banner-misspelt"), ["AC-001"]);
    assert.deepEqual(reach.get("D4-narration-on-stderr"), ["AC-006"]);

    const repaired = new Set<string>();
    const descent = [movers.size];
    for (const row of ROWS) {
      repaired.add(row.defect);
      descent.push(
        [...movers.entries()].filter(([, defects]) => defects.some((id) => !repaired.has(id))).length,
      );
    }
    assert.deepEqual(descent, [6, 3, 2, 1, 0]);

    const demo = await repo.readTextFile(demoPath);
    assert.ok(demo !== null, `${demoPath} is missing, so the narrated figure cannot be checked`);
    assert.ok(
      demo.includes(descent.join(" -> ")),
      `the demo narrates a descent that is not ${descent.join(" -> ")}, which is what this contract's ` +
        "reach produces - a figure in prose is a claim about the run",
    );
  });

  it("never aims a defect at the line the world's readiness check waits for", async () => {
    // The third defect was first written against the *readiness* line, and the first demo run ended
    // `INCONCLUSIVE`: the world waited for a banner that never came, so nothing was ever observed and
    // nothing could be repaired. A defect has to leave the world standing, because a criterion can
    // only be observed - and a repair only reached - while the world is up.
    const outcome = await define();
    const program = await readProgram();
    const pattern = outcome.environment.start?.readyPattern ?? "";
    assert.notEqual(pattern, "");
    const ready = new RegExp(pattern);

    // The pattern the world waits for is a fragment of a line the program prints, so the two are held
    // against each other rather than assumed to agree.
    assert.ok(program.includes(READY_LITERAL), `${programPath} never prints \`${READY_LITERAL}\``);
    assert.match(READY_LITERAL, ready);

    // The rule is not "no defect touches the banner" - `D3` *is* the banner, and that is the point of
    // it. The rule is that the readiness line survives the edit, so the world still comes up with the
    // defect in place and the run reaches a repair. Applying each defect to the source is the only way
    // to ask that: testing a block on its own fails for `D3`, whose block contains the phrase, and
    // says nothing about the other three, whose blocks are elsewhere in the file entirely.
    for (const defect of DEFECTS) {
      const edited = program.replace(defect.correct, defect.defective);
      assert.notEqual(edited, program, `${defect.id}'s block is not in the shipped program`);
      assert.ok(
        edited.includes(READY_LITERAL),
        `${defect.id} removes the readiness line the world waits for, so a run would come up, ` +
          "observe nothing and reach no repair",
      );
    }
  });
});

describe("the goal, the contract and the environment agree", () => {
  it("resolves every gap from material the documents already hold", async () => {
    const outcome = await define();
    for (const [name, report] of Object.entries(outcome.reports)) {
      assert.equal(report.questionsAsked, 0, `the ${name} document asked the operator a question`);
      assert.equal(report.byVia.deferred, 0, `the ${name} document left something deferred`);
    }
  });

  it("plans nine mandatory criteria in the order the contract declares them", async () => {
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
    ]);
    assert.equal(outcome.plan.mandatory.length, 9);
    assert.equal(outcome.plan.optional.length, 0);
  });

  it("declares its goal id, so the cross-goal contradiction guard is live", async () => {
    const outcome = await define();
    assert.equal(outcome.plan.goalId, "local-process");
  });

  it("names only registered validators of this world's family", async () => {
    const outcome = await define();
    const registered = new Set<string>(Object.values(PROCESS_VALIDATOR_NAMES));

    for (const criterion of outcome.plan.criteria) {
      assert.ok(criterion.expectations.length > 0, `${criterion.criterion.id} asserts nothing`);
      for (const expectation of criterion.expectations) {
        assert.ok(
          registered.has(expectation.validator.name),
          `${criterion.criterion.id} uses ${expectation.validator.name}, which is not a registered validator`,
        );
        assert.equal(
          expectation.validator.observationKind,
          PROCESS_OBSERVATION_KIND,
          `${criterion.criterion.id} names a validator that does not read this world's observation`,
        );
      }
    }
  });

  it("declares the artifact every artifact-reading expectation needs", async () => {
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

  it("carries a `run` step on every criterion that reads a command by position", async () => {
    // This adapter observes and never acts: a command enters the world only through the criterion's
    // own `run` step. A criterion reading position 2 with one `run` step would be reported as a world
    // that did not answer rather than as a contract that asked for a command nobody issued.
    const outcome = await define();
    for (const criterion of outcome.plan.criteria) {
      const runs = criterion.steps.filter((step) => step.kind === "run").length;
      for (const expectation of criterion.expectations) {
        const target = expectation.target;
        if (target === null || !/^[1-9][0-9]*$/.test(target)) continue;
        assert.ok(
          Number.parseInt(target, 10) <= runs,
          `${criterion.criterion.id} reads command ${target} and issues ${runs}`,
        );
      }
    }
  });

  it("describes a world with no page, no substitute and nothing rendered", async () => {
    const outcome = await define();
    const { adapter, app, appPath, url, browser, health, reset, start } = outcome.environment;
    const block = outcome.environment.process;

    assert.equal(adapter, "local-process");
    assert.equal(app, "app");
    assert.ok(appPath.endsWith("examples/local-process/app"), `appPath is ${appPath}`);
    assert.equal(url, null, "this world has no address: it runs a program, it does not serve a page");
    assert.equal(browser.enabled, false, "a page here would be a browser this world never opens");
    assert.ok(health.intervalMs > 0 && health.timeoutMs > 0, "a health policy must bound itself");
    assert.equal(reset.strategy, "restart");
    assert.notEqual(start, null);
    assert.equal(start?.command, "node");
    assert.ok(start?.args.includes("cart-build.mjs"), "the world must start the application");

    // A field saying `simulated: none` would suggest the other answer was available. Two worlds in
    // this tree are not simulated at all, and neither carries a simulated-surface constant - so the
    // absence is a claim, and this is what holds it.
    assert.equal(
      Object.hasOwn(outcome.environment, "simulated"),
      false,
      "local-process stands nothing in, so a simulated surface would be a claim it cannot support",
    );

    if (block === null) {
      assert.fail("this world declares a process block, so the plan must carry one");
    }
    // `root` in the plan is the *accession* - the tree resolved once against `appPath`. The reading
    // relativises it back to the world's own spelling, so what is asserted here is the relationship
    // between the two: `"sandbox"` alone would restate the document, and the resolved path alone
    // would be a statement about this machine's working directory.
    const declared = relative(appPath, block.root).replaceAll("\\", "/");

    assert.equal(block.host, "cart-builder");
    assert.equal(
      declared,
      "sandbox",
      `the plan's root resolves to ${block.root}, which is not the tree the document declares`,
    );
    assert.equal(block.application?.command, "node");
    assert.ok(block.application?.args.includes("cart-build.mjs"));
    assert.equal(block.application?.args.includes("daemon"), true);
  });

  it("prints the world's own spelling of the declaration, never the path it resolved to", async () => {
    // The reading this world records carries the declaration and the accession separately, because a
    // resolved path in a reading makes the verdict a consequence of how the operator spelled their
    // command line. These are the measured witnesses: the identical contract, program and machine
    // passed 9/9 with a relative `--goal` and failed AC-001 with an absolute one, and the only thing
    // that differed was the string the criterion compared.
    const outcome = await define();
    const host = outcome.plan.criteria.find((entry) => entry.criterion.id === "AC-001");

    assert.notEqual(host, undefined);
    const comparison = host?.expectations.find(
      (entry) => entry.validator.name === PROCESS_VALIDATOR_NAMES.host,
    );
    assert.notEqual(comparison, undefined);

    const block = outcome.environment.process;
    if (block === null) {
      assert.fail("this world declares a process block, so the plan must carry one");
    }
    const quoted = JSON.stringify(comparison?.raw);
    const declared = relative(outcome.environment.appPath, block.root).replaceAll("\\", "/");

    assert.equal(
      declared,
      "sandbox",
      `the plan's root resolves to ${block.root}, which is not the tree the document declares`,
    );
    assert.match(quoted, /cart-builder \(root sandbox\)/);
    assert.ok(
      quoted.includes(declared),
      "the criterion must compare the world's own spelling of the declaration, which is the half the " +
        "reading records",
    );
    assert.equal(
      quoted.includes(outcome.environment.appPath),
      false,
      "the criterion compares the path the operator's command line resolved to, so the verdict would " +
        "be a fact about how the goal was spelled rather than about the world",
    );
    assert.equal(/[A-Za-z]:/.test(quoted), false, "a criterion must not compare a drive-qualified path");
    assert.equal(quoted.includes("\\\\"), false, "a criterion must not compare a platform separator");
  });

  it("names the same environment variables the application reads, read out of both files", async () => {
    const program = await readProgram();
    const document = await repo.readTextFile(environmentPath);
    assert.ok(document !== null, `${environmentPath} is missing, so the world has no document`);
    const declared = new Set(PROCESS_ENV_NAMES);
    const read = new Set(program.match(/VERIDIAN_PROCESS_[A-Z_]+/g) ?? []);

    // This assertion was an exact equality against three names, and it was **right until it was
    // wrong**. `workspace-audit` needed a fourth - `VERIDIAN_PROCESS_OBSERVE`, which is how a program
    // learns the read surface its own document declared - and the equality then reported the adapter
    // as at fault for declaring a name this one example happens not to read.
    //
    // A test whose message is a roster goes stale on every addition, so the claim is restored to what
    // this test is actually about, from both directions and out of both files. **Supplied**: every
    // name the environment document says the world sets must be one the adapter declares - the defect
    // this exists for, a document promising a variable nothing sets, which is a real one because the
    // document is what a contract author reads. **Read**: every name the program reads must be
    // declared, and it must read `root`, or the world has built a sandbox nobody is inside. What is
    // deliberately *not* asserted is that the document names every name the adapter declares: a name
    // an example ignores costs nothing, and pinning that is how this went stale.
    const promised = new Set(document.match(/`(VERIDIAN_PROCESS_[A-Z_]+)`/gu) ?? []);
    assert.ok(
      promised.size > 0,
      "the world's document names none of its own variables, so this reconciliation would be vacuous",
    );
    for (const name of promised) {
      const bare = name.replaceAll("`", "");
      assert.ok(declared.has(bare), `the document promises ${bare}, which the adapter never sets`);
    }

    assert.ok(read.size > 0, "the application reads none of this world's names, so the world sets none it needs");
    for (const name of read) {
      assert.ok(declared.has(name), `the application reads ${name}, which this world never sets`);
    }
    assert.ok(read.has(PROCESS_ENV.root), "the application must read the tree the world created for it");
  });
});

/** The criteria of the contract that quote a value, for a defect that changes it. */
function moversOf(movers: ReadonlyMap<string, readonly string[]>, defect: string): readonly string[] {
  return [...movers.entries()]
    .filter(([, defects]) => defects.includes(defect))
    .map(([criterion]) => criterion)
    .sort();
}
