import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_OBSERVATION_KIND } from "../../core/environment/api-observation.ts";
import { DB_OBSERVATION_KIND } from "../../core/environment/db-observation.ts";
import {
  PROCESS_COMMAND_STATES,
  PROCESS_FILE_KINDS,
  PROCESS_OBSERVATION_KIND,
  processPath,
} from "../../core/environment/process-observation.ts";
import type {
  ProcessCommandRecord,
  ProcessFileReading,
  ProcessObservationData,
  ProcessStreamReading,
} from "../../core/environment/process-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry, evaluateCriterion } from "../../core/validation/registry.ts";
import type { AssertionResult, CriterionSpec } from "../../core/validation/types.ts";
import { PROCESS_VALIDATORS, PROCESS_VALIDATOR_NAMES, processValidators } from "./process-validators.ts";

/**
 * The `process.*` family, proven offline against literal documents.
 *
 * A validator here never spawns a process and never opens a file - it reads a
 * `ProcessObservationData` - so handing it one written by hand is the *only* way to reach the branches
 * that matter without running a program. The `local-process` demo proves the adapter produces such a
 * document; nothing else proves the family judges one correctly, which is why this file exists at all.
 *
 * This is the lesson the database family paid for and recorded: **a family that decides every verdict
 * in its world needs unit coverage of its own.** A verdict path reachable only through one happy-path
 * demo is a path whose failure modes are untested, and the demo passes whether or not the family is
 * right.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - an unreadable document, a
 *    position the criterion never reached, a path nobody looked at, a file whose text was withheld, a
 *    command that never exited - is asserted to be `INCONCLUSIVE` or `ERROR`, never `PASS`.
 *  - **A defect is a `FAIL`.** A non-zero exit code, a stream that printed nothing, a file that lost a
 *    line, a file that is not there - the shapes a broken application actually takes.
 *  - **The distinction that makes the repairs different.** "The command was never run" and "the
 *    command ran and its second stream is empty" and "the file has the wrong contents" are three facts
 *    with three repairs, and a validator that collapsed any two would send an agent at the wrong file.
 *  - **A contract that cannot be read is an `ERROR`.** A comparison against a word outside the
 *    reading's own vocabulary, a target that is neither a selector nor a path inside the world, and an
 *    expectation stating no comparison at all are each reported as a defect in the *criterion* - never
 *    as an application failure, because that would send an agent to repair working code.
 */

const registry = new ValidatorRegistry(processValidators());

const stream = (text: string, truncated = false): ProcessStreamReading => ({
  text,
  bytes: Buffer.byteLength(text, "utf8"),
  truncated,
});

const command = (overrides: Partial<ProcessCommandRecord> = {}): ProcessCommandRecord => ({
  argv: ["node", "app/provision.mjs"],
  cwd: "examples/local-process",
  state: "exited",
  exitCode: 0,
  signal: null,
  timedOutAfterMs: null,
  stdout: stream("provisioned 3 files\n"),
  stderr: stream(""),
  ...overrides,
});

const reading = (overrides: Partial<ProcessFileReading> = {}): ProcessFileReading => ({
  path: "out/report.txt",
  exists: true,
  kind: "file",
  bytes: 12,
  text: "hello world\n",
  textWithheld: null,
  ...overrides,
});

/**
 * A document with one of each shape a validator has to tell apart.
 *
 * Written once and overridden, rather than built per test, because the *distinctions* are the subject:
 * a running program beside two finished commands, a `timed-out` command that has no exit code, a file,
 * a directory, an entry whose text was withheld and an entry that was never read at all. A fixture
 * that held only the happy shape could not fail for the reason that matters.
 */
const document = (overrides: Partial<ProcessObservationData> = {}): ProcessObservationData => ({
  host: "local-process:examples/local-process",
  root: "examples/local-process/.veridian/sandbox",
  application: {
    argv: ["node", "app/server.mjs"],
    cwd: "examples/local-process",
    state: "running",
    exitCode: null,
    signal: null,
    timedOutAfterMs: null,
    stdout: stream("cart-web listening on 4180\n"),
    stderr: stream(""),
  },
  commands: [
    command(),
    command({
      argv: ["node", "-e", "process.exit(3)"],
      exitCode: 3,
      stdout: stream(""),
      stderr: stream("boom\n"),
    }),
    command({
      argv: ["node", "app/slow.mjs"],
      state: "timed-out",
      exitCode: null,
      timedOutAfterMs: 60_000,
      stdout: stream("working\n"),
      stderr: stream(""),
    }),
  ],
  files: [
    reading(),
    reading({
      path: "out",
      kind: "directory",
      bytes: null,
      text: null,
      textWithheld: "a directory holds entries rather than contents, so there is no text to compare",
    }),
    reading({
      path: "notes.md",
      kind: "file",
      bytes: 1_600_000,
      text: null,
      textWithheld: "the file is 1600000 bytes, past the 1048576 this world carries as text",
    }),
    reading({ path: "missing.txt", exists: false, kind: "absent", bytes: null, text: null }),
  ],
  ...overrides,
});

const observed = (data: unknown, kind: string = PROCESS_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "local-process:examples/local-process",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/**
 * A document from the *other* world, typed as that world's so a change to it breaks this file.
 *
 * Annotated rather than written inline for the reason the API family recorded: if a fixture is
 * untyped, a change to the world's shape turns it into an object no adapter would ever emit, and the
 * test then asserts that a nonsense object is not a process document - which nothing needed proving.
 */
const webDocument = {
  url: "http://127.0.0.1:4173/",
  title: "Shopping Cart",
  targets: {},
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
};

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point rather than the criterion's: it bypasses the registry's
 * per-expectation guards on purpose, which is what makes it the right one for a question about the
 * family's own status discipline.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...fields });

/**
 * The assertion one expectation earns **through the criterion seam**, which is the path the product
 * takes.
 *
 * The declared-comparison check and the observation-kind check both live in `evaluateCriterion` rather
 * than in a family, so a test calling `validate` directly would be asserting the absence of a verdict
 * the product never reaches that way.
 */
const refused = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
): AssertionResult => {
  const first = evaluate([raw], observation).assertions[0];
  assert.ok(first, "the criterion produced no assertion at all");
  return first;
};

const expect = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = judge(raw, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${String(raw["validator"])}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

const spec = (
  expect_: readonly Readonly<Record<string, unknown>>[],
  evidence: readonly string[] = [],
): CriterionSpec => ({
  id: "AC-001",
  description: "the provisioner wrote a report and exited cleanly",
  mandatory: true,
  evidence,
  steps: [],
  expect: expect_,
});

const evaluate = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  observation: Observation,
  evidence: readonly string[] = [],
) =>
  evaluateCriterion(spec(expectations, evidence), observation, {
    registry,
    runId: observation.runId,
    environmentId: observation.environmentId,
    timestamp: observation.capturedAt,
  });

/**
 * The descriptor for one validator, read through the registry rather than off the frozen array.
 *
 * The registry is what the product consults, so a fact asserted about a descriptor here is a fact
 * about the vocabulary a contract is judged against - not about an object this test built.
 */
const described = (name: string) => {
  const found = registry.descriptors().find((descriptor) => descriptor.name === name);
  assert.ok(found, `${name} is not registered at all`);
  return found;
};

// ---- the family describes itself ------------------------------------------------------------------

describe("the process validator family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the twelve it has", () => {
    assert.deepEqual(registry.names(), Object.values(PROCESS_VALIDATOR_NAMES).sort());
    // Spelled out as well as derived, because a list built only from the thing it checks can never
    // disagree with it - and the twelve are the vocabulary a contract author reads.
    assert.deepEqual(registry.names(), [
      "process.argv",
      "process.contents",
      "process.exitcode",
      "process.file",
      "process.host",
      "process.kind",
      "process.probe",
      "process.run",
      "process.size",
      "process.state",
      "process.stderr",
      "process.stdout",
    ]);
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    for (const name of registry.names()) {
      assert.match(
        name,
        /^[a-z0-9]+(\.[a-z0-9]+)+$/,
        `${name} cannot be written in an acceptance contract at all - the schema matches validator names against this pattern`,
      );
    }
  });

  it("reads the process observation kind, and never the web, database or API one", () => {
    for (const name of registry.names()) {
      assert.equal(described(name).observationKind, PROCESS_OBSERVATION_KIND);
    }
    assert.notEqual(PROCESS_OBSERVATION_KIND, WEB_OBSERVATION_KIND);
    assert.notEqual(PROCESS_OBSERVATION_KIND, DB_OBSERVATION_KIND);
    assert.notEqual(PROCESS_OBSERVATION_KIND, API_OBSERVATION_KIND);
  });

  it("asks for a target on exactly the ten validators that name a subject", () => {
    const targetless = registry
      .names()
      .filter((name) => described(name).needsTarget === false);
    assert.deepEqual(targetless, ["process.host", "process.probe"]);
  });

  it("gives each grammar its own noun, so a rejection says which kind of name was wanted", () => {
    const commandNoun = described(PROCESS_VALIDATOR_NAMES.argv).targetNoun;
    const pathNoun = described(PROCESS_VALIDATOR_NAMES.contents).targetNoun;
    assert.ok(commandNoun !== undefined && commandNoun.length > 0);
    assert.ok(pathNoun !== undefined && pathNoun.length > 0);
    assert.notEqual(commandNoun, pathNoun);
    // Six read a selector and four read a path. If the split ever moves, the two grammars have been
    // re-assigned and a contract author's spelling is what silently changes meaning.
    const bySelector = registry
      .names()
      .filter((name) => described(name).targetNoun === commandNoun);
    const byPath = registry.names().filter((name) => described(name).targetNoun === pathNoun);
    assert.deepEqual(bySelector, [
      "process.argv",
      "process.exitcode",
      "process.run",
      "process.state",
      "process.stderr",
      "process.stdout",
    ]);
    assert.deepEqual(byPath, [
      "process.contents",
      "process.file",
      "process.kind",
      "process.size",
    ]);
  });

  it("publishes only comparisons a criterion can actually state", () => {
    for (const name of registry.names()) {
      const declared = described(name).comparisons;
      assert.ok(declared.length > 0, `${name} declares no comparison, so it can only ever pass`);
      for (const key of declared) {
        assert.match(key, /^(equals|atLeast|atMost|contains|matches)$/);
      }
    }
  });

  it("freezes the shipped array and hands a fresh one to a registry", () => {
    assert.ok(Object.isFrozen(PROCESS_VALIDATORS));
    assert.equal(PROCESS_VALIDATORS.length, 12);
    const first = processValidators();
    first.pop();
    assert.equal(processValidators().length, 12, "the roster was mutated through the accessor");
  });
});

// ---- an unreadable document -----------------------------------------------------------------------

describe("the family refuses to judge a world it cannot see", () => {
  it("reports ERROR, naming the environment, when the document is another world's", () => {
    for (const name of registry.names()) {
      const result = expect(
        expectation(name, { equals: "anything" }),
        observed(webDocument),
        "ERROR",
        /does not carry a process document/,
      );
      assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    }
  });

  it("refuses through the criterion seam when the observation kind is a different world's", () => {
    const result = refused(expectation(PROCESS_VALIDATOR_NAMES.host, { contains: "local" }), observed(webDocument, WEB_OBSERVATION_KIND));
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /must never be asked to judge a world it cannot see/);
  });

  it("does not mistake a process document for another family's", () => {
    // The structural guard is what the adapter's reading passes through, so the *wrong* direction
    // matters too: a process document must not be readable as an API or database one. The family's
    // kind is the string the registry compares, and nothing here may share it.
    assert.equal(PROCESS_OBSERVATION_KIND, "process.exec");
    assert.notEqual(PROCESS_OBSERVATION_KIND, API_OBSERVATION_KIND);
  });
});

// ---- 1. the world, and everything a criterion did to it -------------------------------------------

describe("process.host and process.probe", () => {
  it("passes when the reading names the world the criterion meant", () => {
    // The world is rendered with its root, because the root is the half a criterion asking "was this
    // the world I meant" would otherwise have to guess. Spelled out rather than derived from
    // `renderHost`, so the expectation is a claim about the value and not a copy of it.
    const rendered =
      "local-process:examples/local-process (root examples/local-process/.veridian/sandbox)";
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.host, { equals: rendered }),
      observed(document()),
      "PASS",
    );
    assert.equal(result.actual, rendered);
  });

  it("fails, naming both, when the bundle describes a different world", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.host, { equals: "local-process:somewhere-else" }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /local-process:examples\/local-process/);
  });

  it("refuses a comparison other than equals, contains or matches", () => {
    const result = refused(
      expectation(PROCESS_VALIDATOR_NAMES.host, { atLeast: 1 }),
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /does not answer/);
  });

  it("renders the whole reading for process.probe, including the root", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.probe, { contains: "0 findings" }),
      observed(document()),
      "FAIL",
    );
    const text = String(result.actual);
    assert.match(text, /local-process:examples\/local-process \(root /);
    assert.match(text, /application: node app\/server\.mjs - still running/);
    assert.match(text, /command 2: node -e process\.exit\(3\) - exit 3, stdout empty/);
  });

  it("shows a command that timed out as timing out, never as a code", () => {
    const text = String(
      judge(expectation(PROCESS_VALIDATOR_NAMES.probe, { contains: "x" }), observed(document())).actual,
    );
    assert.match(text, /timed out after 60000ms/);
    assert.doesNotMatch(text, /exit null/);
  });

  it("names each file it read, and no size - the size is process.size's subject", () => {
    const text = String(
      judge(expectation(PROCESS_VALIDATOR_NAMES.probe, { contains: "x" }), observed(document())).actual,
    );
    assert.match(text, /file out\/report\.txt: a file/);
    assert.match(text, /file out: a directory/);
    assert.match(text, /file missing\.txt: absent/);
    assert.doesNotMatch(text, /12 bytes/);
  });

  it("reports ERROR when the expectation states no comparison at all", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.host),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });
});

// ---- 2. the command selector grammar --------------------------------------------------------------

describe("a command target is a selector, read by one rule for both the world and the family", () => {
  it("resolves `app` to the program the world started", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.argv, { target: "app", equals: "node app/server.mjs" }),
      observed(document()),
      "PASS",
    );
    assert.equal(result.actual, "node app/server.mjs");
  });

  it("resolves a bare position to the criterion's own run steps, counted from one", () => {
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.argv, { target: "1", contains: "provision" }), observed(document()))
        .actual,
      "node app/provision.mjs",
    );
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.argv, { target: "2", contains: "exit" }), observed(document()))
        .actual,
      "node -e process.exit(3)",
    );
  });

  it("reads a path-shaped target as a contract that cannot be read, not as a missing command", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.run, { target: "out/report.txt", contains: "x" }),
      observed(document()),
      "ERROR",
      /belongs to `process\.file`/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("reads a spelling that is neither `app` nor a position as unusable, naming both", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.run, { target: "first", contains: "x" }),
      observed(document()),
      "ERROR",
      /is neither `app` nor a position counted from 1/,
    );
    // And it names the grammar the spelling *does* belong to, so the repair is "use a path validator"
    // rather than "guess again at the selector".
    assert.match(String(result.message), /A path belongs to `process\.file`/);
  });

  it("reports ERROR when the criterion named no target", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.run, { contains: "x" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    assert.match(String(result.message), /named as `app`/);
  });

  it("is INCONCLUSIVE, quoting the count, when the criterion performed fewer commands", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "4", equals: 0 }),
      observed(document()),
      "INCONCLUSIVE",
      /performed 3 commands, so there is no command 4/,
    );
    assert.equal(result.target, "4");
  });

  it("is INCONCLUSIVE, and says why, when the criterion performed no command at all", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 }),
      observed(document({ commands: [] })),
      "INCONCLUSIVE",
      /carries no commands at all/,
    );
  });

  it("is INCONCLUSIVE, naming the document, when the world declared no application", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.state, { target: "app", equals: "running" }),
      observed(document({ application: null })),
      "INCONCLUSIVE",
      /declared no `process\.application`/,
    );
    assert.equal(result.target, "app");
  });

  it("resolves a file named `1` as a path and the first command as a position, by rule", () => {
    // The one ambiguity a reader could construct. The rule is in `commandSelectorOf`'s doc: a bare
    // positive integer is a position, and `./1` is a path. Both readings are asserted here so the
    // rule cannot drift into a guess.
    const withFile = document({ files: [reading({ path: "1", text: "one\n", bytes: 4 })] });
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.argv, { target: "1", contains: "provision" }), observed(withFile))
        .status,
      "PASS",
    );
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "./1", equals: "one\n" }), observed(withFile))
        .status,
      "PASS",
    );
  });
});

// ---- 3. how the command ended ---------------------------------------------------------------------

describe("process.argv, process.run and process.state", () => {
  it("compares what was run, quoting a word that contains a space", () => {
    const spaced = document({
      commands: [command({ argv: ["node", "--title", "cart web"] })],
    });
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.argv, {
        target: "1",
        equals: 'node --title "cart web"',
      }),
      observed(spaced),
      "PASS",
    );
  });

  it("fails when the argument vector lost a word", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.argv, { target: "1", equals: "node app/other.mjs" }),
      observed(document()),
      "FAIL",
    );
  });

  it("compares the ending and both streams as one line", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.run, {
        target: "2",
        contains: "exit 3, stdout empty, stderr 2 lines (5 bytes)",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("reads a truncated stream as a size, saying how much of it is shown", () => {
    const truncated = document({
      commands: [command({ stdout: stream("0123456789", true) })],
    });
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.run, {
        target: "1",
        contains: "stdout 1 line (10 bytes, last 10 shown)",
      }),
      observed(truncated),
      "PASS",
    );
  });

  it("passes when a command's state equals the word the reading uses", () => {
    for (const state of PROCESS_COMMAND_STATES) {
      const one = document({ commands: [command({ state, exitCode: state === "exited" ? 0 : null })] });
      expect(
        expectation(PROCESS_VALIDATOR_NAMES.state, { target: "1", equals: state }),
        observed(one),
        "PASS",
      );
    }
  });

  it("refuses a state outside the reading's vocabulary instead of calling it a defect", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.state, { target: "1", equals: "finished" }),
      observed(document()),
      "ERROR",
      /wants one of exited, timed-out, signalled, running/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("fails when a command ended a different way than the criterion asked for", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.state, { target: "1", equals: "signalled" }),
      observed(document()),
      "FAIL",
    );
  });

  it("declares only equals for a state, so a contract cannot search one", () => {
    assert.deepEqual([...described(PROCESS_VALIDATOR_NAMES.state).comparisons], ["equals"]);
  });

  it("refuses a comparison a state does not answer, through the criterion seam", () => {
    const result = refused(
      expectation(PROCESS_VALIDATOR_NAMES.state, { target: "1", contains: "exit" }),
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /does not answer/);
  });
});

// ---- 4. the exit code ----------------------------------------------------------------------------

describe("process.exitcode", () => {
  it("passes on the code a clean command returned", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a code that is not the one asked for, and reports the real one", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "2", equals: 0 }),
      observed(document()),
      "FAIL",
    );
    assert.equal(result.actual, 3);
  });

  it("answers atLeast and atMost, for a criterion that has to bound a code", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "2", atLeast: 1, atMost: 3 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "2", atMost: 2 }),
      observed(document()),
      "FAIL",
    );
  });

  it("refuses a comparison that wants a number and got a word", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: "zero" }),
      observed(document()),
      "ERROR",
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("reports FAIL, not INCONCLUSIVE, when the command never exited", () => {
    // The branch the whole product's honesty rests on: a hanging application has no code, so every
    // comparison against one is false - and answering INCONCLUSIVE here would hide a hang behind a
    // criterion that politely declined to judge it.
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "3", equals: 0 }),
      observed(document()),
      "FAIL",
      /never exited has no exit code/,
    );
    assert.equal(result.actual, null);
    assert.equal(result.expected, 0);
  });

  it("quotes how the command ended instead of a code it does not have", () => {
    const result = judge(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "3", equals: 0 }),
      observed(document()),
    );
    assert.match(String(result.message), /timed out after 60000ms, stdout 2 lines \(8 bytes\), stderr empty/);
    assert.doesNotMatch(String(result.message), /exit null/);
  });

  it("reports FAIL for a command still running, for the same reason", () => {
    const running = document({
      commands: [command({ state: "running", exitCode: null })],
    });
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 }),
      observed(running),
      "FAIL",
      /still running/,
    );
  });

  it("reports FAIL for a command ended by a signal, quoting the signal", () => {
    const signalled = document({
      commands: [command({ state: "signalled", exitCode: null, signal: "SIGKILL" })],
    });
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 }),
      observed(signalled),
      "FAIL",
      /ended by SIGKILL/,
    );
  });

  it("declares equals, atLeast and atMost, and nothing that searches a number", () => {
    assert.deepEqual(
      [...described(PROCESS_VALIDATOR_NAMES.exitcode).comparisons],
      ["equals", "atLeast", "atMost"],
    );
  });
});

// ---- 5. the two streams --------------------------------------------------------------------------

describe("process.stdout and process.stderr are two questions, not one", () => {
  it("passes on a stream that printed what the criterion expected", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.stdout, { target: "1", contains: "provisioned 3 files" }),
      observed(document()),
      "PASS",
    );
  });

  it("passes on equality with the empty string, which is a real assertion", () => {
    // A stream that was captured and holds nothing is a different fact from a stream nobody read, and
    // `equals: ""` is how a contract states the first. It is false the moment the program prints.
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.stdout, { target: "2", equals: "" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on the empty string once the program prints a line", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.stdout, { target: "1", equals: "" }),
      observed(document()),
      "FAIL",
    );
  });

  it("keeps the two streams apart: a clean stdout does not excuse a stderr", () => {
    const observation = observed(document());
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.stdout, { target: "2", equals: "" }), observation).status,
      "PASS",
    );
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.stderr, { target: "2", equals: "" }), observation).status,
      "FAIL",
    );
  });

  it("answers matches, for a criterion that has to pin the shape of a line", () => {
    // The pattern is anchored on the newline the program actually printed: `$` in a JavaScript
    // regular expression matches end of input, not end of line, so `files$` would not match
    // `"provisioned 3 files\n"` and the assertion would fail against correct product code.
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.stdout, {
        target: "1",
        matches: "^provisioned \\d+ files\\n$",
      }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.stderr, { target: "2", matches: "^warn" }),
      observed(document()),
      "FAIL",
    );
  });

  it("names which stream it judged, so a failure report is not ambiguous", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.stderr, { target: "1", equals: "boom\n" }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /command 1 of this criterion wrote to stderr/);
    assert.match(String(result.message), /stderr empty/);
  });

  it("declares contains and matches beside equals, because a stream is text", () => {
    for (const name of [PROCESS_VALIDATOR_NAMES.stdout, PROCESS_VALIDATOR_NAMES.stderr]) {
      assert.deepEqual([...described(name).comparisons], ["equals", "contains", "matches"]);
    }
  });
});

// ---- 6. the path grammar -------------------------------------------------------------------------

describe("a path target is read inside the world's own tree, or refused by name", () => {
  it("normalises a backslash and collapses a `.` and an internal `..`", () => {
    assert.equal(processPath("out\\report.txt"), "out/report.txt");
    assert.equal(processPath("./out/./report.txt"), "out/report.txt");
    assert.equal(processPath("out/drafts/../report.txt"), "out/report.txt");
    assert.equal(processPath("  out/report.txt  "), "out/report.txt");
  });

  it("refuses a rooted path, a drive letter, an escape and the empty spelling", () => {
    for (const target of ["/etc/passwd", "C:/secrets.txt", "c:\\secrets.txt", "../outside.txt", "", "   ", ".", "./"]) {
      assert.equal(processPath(target), null, `${target} was resolved instead of refused`);
    }
  });

  it("refuses a path that climbs out of the world, through the criterion seam", () => {
    const result = refused(
      expectation(PROCESS_VALIDATOR_NAMES.file, { target: "../outside.txt", equals: "present" }),
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /leading separator, a drive letter/);
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("refuses a rooted path as a contract that cannot be read, not as a missing file", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "/etc/hosts", equals: "x" }),
      observed(document()),
      "ERROR",
      /Write the path the way the criterion's own command wrote it/,
    );
  });

  it("is INCONCLUSIVE when the reading carries no entry for the path at all", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "out/other.txt", equals: 1 }),
      observed(document()),
      "INCONCLUSIVE",
      /carries no entry for `out\/other\.txt`, so nobody looked/,
    );
    assert.equal(result.target, "out/other.txt");
  });

  it("reports ERROR when a path validator was given no target", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.kind, { equals: "file" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    assert.match(String(result.message), /inside the world's own tree/);
  });
});

// ---- 7. what a path holds ------------------------------------------------------------------------

describe("process.file and process.kind", () => {
  it("answers presence, in words and as a boolean", () => {
    const observation = observed(document());
    for (const expected of ["present", true]) {
      expect(
        expectation(PROCESS_VALIDATOR_NAMES.file, { target: "out/report.txt", equals: expected }),
        observation,
        "PASS",
      );
    }
    for (const expected of ["absent", false]) {
      expect(
        expectation(PROCESS_VALIDATOR_NAMES.file, { target: "missing.txt", equals: expected }),
        observation,
        "PASS",
      );
    }
  });

  it("fails when a file the criterion needs is not there", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.file, { target: "missing.txt", equals: "present" }),
      observed(document()),
      "FAIL",
    );
  });

  it("refuses a presence word that is neither a boolean nor present/absent", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.file, { target: "out/report.txt", equals: "yes" }),
      observed(document()),
      "ERROR",
      /wants true, false, "present" or "absent"/,
    );
  });

  it("answers the kind of thing a path holds, for each kind the reading owns", () => {
    for (const kind of PROCESS_FILE_KINDS) {
      const one = document({
        files: [reading({ path: "x", kind, exists: kind !== "absent", text: kind === "file" ? "x\n" : null, bytes: kind === "file" ? 2 : null })],
      });
      expect(
        expectation(PROCESS_VALIDATOR_NAMES.kind, { target: "x", equals: kind }),
        observed(one),
        "PASS",
      );
    }
  });

  it("refuses a kind the reading cannot report instead of failing the application", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.kind, { target: "out/report.txt", equals: "symlink" }),
      observed(document()),
      "ERROR",
      /wants one of file, directory, other, absent/,
    );
  });

  it("separates a file from a directory, which is a different repair", () => {
    const observation = observed(document());
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.kind, { target: "out", equals: "file" }), observation).status,
      "FAIL",
    );
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.kind, { target: "out", equals: "directory" }), observation).status,
      "PASS",
    );
  });

  it("declares only equals for presence and for kind", () => {
    assert.deepEqual([...described(PROCESS_VALIDATOR_NAMES.file).comparisons], ["equals"]);
    assert.deepEqual([...described(PROCESS_VALIDATOR_NAMES.kind).comparisons], ["equals"]);
  });
});

// ---- 8. text and length --------------------------------------------------------------------------

describe("process.contents and process.size are two questions about one file", () => {
  it("compares a file's text", () => {
    const observation = observed(document());
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", equals: "hello world\n" }),
      observation,
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", contains: "world" }),
      observation,
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", matches: "^hello" }),
      observation,
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", matches: "^goodbye" }),
      observation,
      "FAIL",
    );
  });

  it("is INCONCLUSIVE, quoting the world, when the entry's text was withheld", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "notes.md", contains: "x" }),
      observed(document()),
      "INCONCLUSIVE",
      /has no text to compare/,
    );
    assert.match(String(result.message), /past the 1048576 this world carries as text/);
  });

  it("is INCONCLUSIVE rather than a comparison against nothing, when there is no text", () => {
    // The branch that keeps the family honest: `equals: ""` against a directory would report a defect
    // in an application nobody read.
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "missing.txt", equals: "" }),
      observed(document()),
      "INCONCLUSIVE",
      /holds absent, so there is no text to compare/,
    );
    assert.match(String(result.message), /comparison against an empty string/);
    assert.equal(result.actual, null);
  });

  it("compares a file's length, and bounds it", () => {
    const observation = observed(document());
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "out/report.txt", equals: 12 }),
      observation,
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "out/report.txt", atLeast: 1, atMost: 12 }),
      observation,
      "PASS",
    );
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "out/report.txt", atMost: 11 }),
      observation,
      "FAIL",
    );
  });

  it("is INCONCLUSIVE, never a comparison against zero, when the path has no length", () => {
    const result = expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "out", equals: 0 }),
      observed(document()),
      "INCONCLUSIVE",
      /holds a directory, so it has no length to compare/,
    );
    assert.match(String(result.message), /comparison against zero/);
  });

  it("reports a withheld entry's real size, because the size is known even when the text is not", () => {
    expect(
      expectation(PROCESS_VALIDATOR_NAMES.size, { target: "notes.md", equals: 1_600_000 }),
      observed(document()),
      "PASS",
    );
  });

  it("keeps the two questions apart: a file can have a size and no readable text", () => {
    const observation = observed(document());
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.size, { target: "notes.md", atLeast: 1 }), observation).status,
      "PASS",
    );
    assert.equal(
      judge(expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "notes.md", contains: "x" }), observation).status,
      "INCONCLUSIVE",
    );
  });

  it("declares a number's comparisons for a size and a text's for contents", () => {
    assert.deepEqual(
      [...described(PROCESS_VALIDATOR_NAMES.size).comparisons],
      ["equals", "atLeast", "atMost"],
    );
    assert.deepEqual(
      [...described(PROCESS_VALIDATOR_NAMES.contents).comparisons],
      ["equals", "contains", "matches"],
    );
  });
});

// ---- 9. through the criterion, where the product actually judges ---------------------------------

describe("a criterion judged through the seam the product uses", () => {
  it("reports every assertion, and passes a criterion whose checks all hold", () => {
    const result = evaluate(
      [
        expectation(PROCESS_VALIDATOR_NAMES.host, { contains: "local-process" }),
        expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 }),
        expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", contains: "hello" }),
      ],
      observed(document()),
    );
    assert.equal(result.status, "PASS");
    assert.equal(result.assertions.length, 3);
  });

  it("fails the criterion when one of three assertions fails, and names it", () => {
    const result = evaluate(
      [
        expectation(PROCESS_VALIDATOR_NAMES.host, { contains: "local-process" }),
        expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "2", equals: 0 }),
        expectation(PROCESS_VALIDATOR_NAMES.contents, { target: "out/report.txt", contains: "hello" }),
      ],
      observed(document()),
    );
    assert.equal(result.status, "FAIL");
    assert.equal(result.assertions[1]?.status, "FAIL");
    assert.equal(result.assertions[0]?.status, "PASS");
    assert.equal(result.assertions[2]?.status, "PASS");
  });

  it("forces INCONCLUSIVE when the required evidence is not in the bundle", () => {
    const result = evaluate(
      [expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 })],
      observed(document()),
      ["log"],
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.deepEqual([...result.missingEvidence], ["log"]);
  });

  it("reports an unregistered validator name rather than throwing", () => {
    const result = evaluate(
      [expectation("process.exitCode", { target: "1", equals: 0 })],
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.assertions[0]?.message), /No validator registered under the name/);
  });

  it("refuses a database reading twice, once for its kind and once for its shape", () => {
    // Two different guards, and both are needed. Declared under the *process* kind, a database
    // document reaches the family and is refused by its own structural check. Declared under its own
    // kind, it never reaches the family at all, because the registry compares the kind first. A test
    // that asserted only one of these would be silent about the other hole.
    const expectation_ = expectation(PROCESS_VALIDATOR_NAMES.exitcode, { target: "1", equals: 0 });
    const asProcess = evaluate([expectation_], observed({ database: "cart.db", tables: [] }));
    assert.equal(asProcess.status, "ERROR");
    assert.match(String(asProcess.assertions[0]?.message), /does not carry a process document/);

    const asDatabase = evaluate(
      [expectation_],
      observed({ database: "cart.db", tables: [] }, DB_OBSERVATION_KIND),
    );
    assert.equal(asDatabase.status, "ERROR");
    assert.match(
      String(asDatabase.assertions[0]?.message),
      /must never be asked to judge a world it cannot see/,
    );
  });
});
