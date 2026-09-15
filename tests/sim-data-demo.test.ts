/**
 * The eleventh demo, judged from the documents' side and from the world's side.
 *
 * Like every other `*-demo.test.ts`, this file holds the claims the demo's own documents make about
 * themselves: that the shipped provisioning program is the correct one, that the defect table is in
 * criterion order and each of its blocks lands exactly once, that injecting and repairing round-trips
 * the file byte for byte in either line ending, and that the goal, the contract and the environment
 * describe one world and no other.
 *
 * It does one thing no other demo test in this tree does: **it runs the world**. The substitute broker
 * `adapters/sim-data/data-port.ts` binds is real, the application `examples/sim-data/app/provision.mjs`
 * is a real child process run by the real `nodeProcessRunner`, and the reading every assertion below
 * quotes is the one the adapter's own `observe()` produced. That exists because `goal.yaml` names this
 * file as the place a property is checked that no criterion can check - the records carry no headers -
 * and a property about *the batch the broker stored* cannot be read off a document.
 *
 * Three further facts are only visible from here, because they are claims a document makes about code
 * and nothing in the product reads:
 *
 * - `acceptance.yaml` states how many criteria there are, how many validators they exercise, how many
 *   criteria act in the world through a `run` step and how many of those expect to be refused - and it
 *   commits this file to reading those counts off *it*. Four prose figures, four assertions here.
 * - `DATA_ENV` declares five names and publishes all five; the shipped application reads two. A test
 *   that asserted the two sets were equal would fail on correct product code, so it asserts the
 *   measured relationship instead.
 * - Every pinned string in the contract is compared against the world's *own renderer* for that
 *   subject, so a contract and a renderer cannot drift apart silently. The wording lives in
 *   `core/environment/data-observation.ts` and the expectation lives in the operator's document; this
 *   file is the only thing that holds the two together.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DATA_COMMAND_WORDS, tcpData } from "../adapters/sim-data/data-port.ts";
import { DATA_ENV, SimDataEnvironment } from "../adapters/sim-data/sim-data-environment.ts";
import { DATA_APIS, dataApiSpelling } from "../adapters/sim-data/protocol.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { resolveDefinition, type ResolvedDefinition } from "../core/definition.ts";
import {
  DATA_OBSERVATION_KIND,
  DATA_SIMULATED_SURFACES,
  dataCommittedAt,
  dataGroupNamed,
  dataMemberNamed,
  dataPartitionAt,
  dataRecordAt,
  dataTopicNamed,
  parseDataRef,
  renderCommitted,
  renderGroup,
  renderMember,
  renderNodeIdentity,
  renderPartition,
  renderRecord,
  renderTopic,
} from "../core/environment/data-observation.ts";
import type {
  DataObservationData,
  DataRefNoun,
  DataRequestRecord,
} from "../core/environment/data-observation.ts";
import type { EnvironmentPlan, ObservationRequest } from "../core/environment/types.ts";
import { memoryIo, nodeIo } from "../core/io.ts";
import { nodeProcessRunner } from "../core/process.ts";
import type { ProcessRunner } from "../core/process.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import { ValidatorRegistry } from "../core/validation/registry.ts";
import { inStyle, newlineOf, occurrences } from "../examples/defect-text.ts";
import { DEFECTS, PROVISION_FILE, inject, repairOne, status } from "../examples/sim-data/defects.ts";
import { APP_DIR, readProvision, restoreAll, writeChanged } from "../examples/sim-data/source.ts";
import {
  DATA_VALIDATOR_NAMES,
  DATA_VALIDATORS,
  dataValidators,
} from "../validators/data/data-validators.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

// ---- the demo's own facts, stated once -------------------------------------------------------------

const repo = nodeIo();

const goalPath = "examples/sim-data/goal.yaml";
const contractPath = "examples/sim-data/acceptance.yaml";
const environmentPath = "examples/sim-data/environment.yaml";
const demoPath = "examples/sim-data/demo.ts";

/** The criteria the demo's narration says the four defects are filed against, in table order. */
const FILED = ["AC-004", "AC-005", "AC-011", "AC-014"] as const;

/**
 * The commands the three acting criteria put to the world, and what each criterion reads back.
 *
 * Two targets are API names and the third is a *command word this world does not perform*, spelled the
 * way the world recorded its refusal. That difference is not decoration: a criterion that ran
 * `leavegroup` and probed an API name would be reading a request that was never made.
 */
const PROBED = ["Metadata", "CreateTopics", "refused command 'leavegroup'"] as const;

/**
 * The number a document spells, so a figure in prose can be compared with the code it describes.
 *
 * Deliberately a table rather than a parser: a spelled number this file does not know is a number
 * nothing can check, and an assertion that skipped it would be the vacuous pass this whole file exists
 * to avoid. Adding a world means adding its counts here, which is the point.
 */
const SPELLED: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  three: 3,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  twenty: 20,
  "twenty-one": 21,
  "twenty-three": 23,
  "twenty-seven": 27,
});

function spelled(word: string): number {
  const value = SPELLED[word.trim().toLowerCase()];
  assert.ok(
    value !== undefined,
    `this file has no number for ${JSON.stringify(word)}, so a document that spelled a count that way ` +
      "would be read as agreeing with the code by nothing reading it",
  );
  return value;
}

/** The comment banner a document opens with, comment markers removed and wrapped into one line. */
function headerOf(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("#"))
    .map((line) => line.replace(/^#\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

const CONTRACT_HEADER = headerOf(readFileSync(new URL(`../${contractPath}`, import.meta.url), "utf8"));

// ---- resolution ------------------------------------------------------------------------------------

let schemasCache: Promise<SchemaSet> | undefined;
const schemas = (): Promise<SchemaSet> => (schemasCache ??= loadSchemaSet(repo));

let definition: Promise<ResolvedDefinition> | undefined;

/**
 * The demo's documents, resolved the way a run resolves them.
 *
 * Nothing here writes, starts or observes: a definition that cannot be resolved is a defect in the
 * demo, and every test below reaches it through this one memoised promise so the cost is paid once.
 */
function define(): Promise<ResolvedDefinition> {
  definition ??= (async () => {
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
        registry: new ValidatorRegistry(dataValidators()),
        registeredAdapters: ["sim-data"],
      },
      clarifier,
    );
    assert.equal(
      outcome.kind,
      "resolved",
      outcome.kind === "resolved"
        ? ""
        : `the demo's own documents must resolve without an operator: ${outcome.reason}`,
    );
    if (outcome.kind !== "resolved") throw new Error("unreachable");
    return outcome;
  })();
  return definition;
}

// ---- the world, really running ---------------------------------------------------------------------

interface Provisioned {
  /** How many times the world was asked to run a program. */
  readonly count: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut: boolean;
}

interface LiveWorld {
  readonly reading: DataObservationData;
  readonly requests: readonly DataRequestRecord[];
  readonly provisioned: Provisioned;
  /** The plan the world was built from, so an assertion can compare the document with what ran. */
  readonly environment: EnvironmentPlan;
}

/**
 * A runner that delegates to the real one and keeps what came back.
 *
 * The adapter reads the child's output through its own handle and never reports it, so a test that
 * wanted to see the application's completeness line would have to spawn the program a second time -
 * and a second spawn is a second run, whose stdout is evidence about a run no criterion judged. This
 * records the one the world really ran.
 */
function recordingRunner(): {
  readonly runner: ProcessRunner;
  readonly recorded: Provisioned;
  readonly settled: () => Promise<void>;
} {
  const recorded = {
    count: 0,
    stdout: "",
    stderr: "",
    code: null as number | null,
    timedOut: false,
  };
  const pending: Promise<void>[] = [];
  const runner: ProcessRunner = {
    run(request) {
      recorded.count += 1;
      const handle = nodeProcessRunner.run(request);
      pending.push(
        handle.exited.then((result) => {
          recorded.stdout = result.stdout;
          recorded.stderr = result.stderr;
          recorded.code = result.code;
          recorded.timedOut = result.timedOut;
        }),
      );
      return handle;
    },
  };
  /**
   * Resolve once every child this runner started has reported its exit.
   *
   * The record above is filled in by a promise, so reading it before that promise settles is a
   * question about the machine's schedule rather than about the program: the fields would read empty
   * for a program that ran perfectly, and would read full for the same program on the run before.
   * There is no turn count to wait, so this waits on the condition itself - the shape the
   * `smoke-out.mjs` fixed-turn wait taught this repository once already.
   */
  const settled = async (): Promise<void> => {
    await Promise.all(pending);
  };
  return { runner, recorded, settled };
}

let live: Promise<LiveWorld> | undefined;

/**
 * The demo's world, provisioned by the demo's application, observed by the demo's own adapter.
 *
 * One run for the whole file, because the fourth iteration's question - what does the log hold - has
 * one answer and asking it five times would be five sockets for one reading.
 *
 * The io port is `memoryIo`, so the evidence the adapter writes for the observation lands in a virtual
 * filesystem rather than in this checkout. The application directory is the real one, because a child
 * process needs a directory this machine can open.
 */
function world(): Promise<LiveWorld> {
  live ??= (async () => {
    const { environment } = await define();
    const declaration = environment.data;
    assert.notEqual(declaration, null, "this world was resolved without a broker to stand in for");
    const port = tcpData({
      cluster: declaration?.cluster ?? "",
      nodeId: declaration?.nodeId ?? 0,
      host: declaration?.host ?? "",
      port: declaration?.port ?? 0,
    });
    const io = memoryIo({}, "/virtual");
    const { runner, recorded, settled } = recordingRunner();
    const subject = new SimDataEnvironment(environment, {
      io,
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      logger: silentLogger,
      processes: runner,
      stateDir: ".veridian",
      port,
    });

    const { id } = await subject.create();
    try {
      await subject.start(id);
      await subject.deploy(id);
      const request: ObservationRequest = {
        criterionId: "AC-001",
        runId: "sim-data-demo",
        steps: [],
        targets: [],
        evidence: [],
      };
      const observation = await subject.observe(id, request);
      assert.ok(
        observation.data !== null,
        `the world produced no reading: ${JSON.stringify(observation.error)}`,
      );
      // The adapter reads the child's output into its own handle and does not report it, so the
      // record below is a reading of the run rather than of the machine's timing - which is why the
      // exit is awaited here instead of being hoped for.
      await settled();
      return {
        reading: observation.data as DataObservationData,
        requests: port.requests(),
        provisioned: { ...recorded },
        environment,
      };
    } finally {
      await subject.stop(id);
      await subject.destroy(id);
    }
  })();
  return live;
}

// ---- the pins --------------------------------------------------------------------------------------

/**
 * The string one expectation pins, read out of the resolved contract rather than restated here.
 *
 * `key` names the comparison rather than being fixed to `equals`, because one criterion in this
 * contract pins a *shape* rather than a value: AC-001 compares the world's identity with `matches`,
 * since the port is whatever the machine had free and a criterion pinning a number would be pinning
 * this machine's ephemeral allocation. A helper that read `equals` for every criterion would have
 * found nothing there and reported the absence as a defect in the contract.
 */
function pinned(
  target: ResolvedDefinition,
  criterionId: string,
  validator: string,
  key = "equals",
): string {
  const entry = target.plan.criteria.find((candidate) => candidate.criterion.id === criterionId);
  assert.ok(entry !== undefined, `the contract plans no ${criterionId}`);
  const expectation = entry.expectations.find(
    (candidate) => candidate.validator.name === validator,
  );
  assert.ok(expectation !== undefined, `${criterionId} carries no ${validator} expectation`);
  const value = expectation.raw[key];
  assert.equal(
    typeof value,
    "string",
    `${criterionId}: ${validator} pins no string under ${key}, so there is nothing for this file to compare`,
  );
  return value as string;
}

/**
 * What one target reads, rendered by the world's own renderer for its noun.
 *
 * Resolved through the same readers a validator uses, so a claim here cannot disagree with a verdict
 * the family would reach about the same target - and the renderer is the family's, so a contract whose
 * expectation was edited without its renderer fails here rather than in a bundle nobody diffed.
 */
function rendering(data: DataObservationData, noun: DataRefNoun, target: string): string {
  const ref = parseDataRef(noun, target);
  assert.ok(ref !== null, `${JSON.stringify(target)} is not in this world's own ${noun} grammar`);
  const parts = ref.parts;
  if (noun === "topic") {
    const topic = dataTopicNamed(data, parts[0] ?? "");
    assert.ok(topic !== null, `the world holds no topic ${JSON.stringify(target)}`);
    return renderTopic(topic);
  }
  if (noun === "partition") {
    const topic = dataTopicNamed(data, parts[0] ?? "");
    assert.ok(topic !== null, `the world holds no topic ${JSON.stringify(parts[0] ?? "")}`);
    const partition = dataPartitionAt(topic, Number(parts[1]));
    assert.ok(partition !== null, `the world holds no partition ${JSON.stringify(target)}`);
    return renderPartition(partition);
  }
  if (noun === "record") {
    const topic = dataTopicNamed(data, parts[0] ?? "");
    assert.ok(topic !== null, `the world holds no topic ${JSON.stringify(parts[0] ?? "")}`);
    const partition = dataPartitionAt(topic, Number(parts[1]));
    assert.ok(partition !== null, `the world holds no partition ${JSON.stringify(parts[1] ?? "")}`);
    const record = dataRecordAt(partition, Number(parts[2]));
    assert.ok(record !== null, `the world holds no record at ${JSON.stringify(target)}`);
    return renderRecord(record);
  }
  const group = dataGroupNamed(data, parts[0] ?? "");
  assert.ok(group !== null, `the world holds no group ${JSON.stringify(parts[0] ?? "")}`);
  if (noun === "group") return renderGroup(group);
  if (noun === "member") {
    const member = dataMemberNamed(group, parts[1] ?? "");
    assert.ok(member !== null, `the world's group holds no member ${JSON.stringify(target)}`);
    return renderMember(member);
  }
  const entry = dataCommittedAt(group, parts[1] ?? "", Number(parts[2]));
  assert.ok(entry !== null, `the world's group holds no committed offset ${JSON.stringify(target)}`);
  return renderCommitted(entry);
}

/** One expectation's target, or the empty string when it has none. */
function targetOf(entry: ResolvedDefinition["plan"]["criteria"][number], validator: string): string {
  const expectation = entry.expectations.find(
    (candidate) => candidate.validator.name === validator,
  );
  return expectation?.target ?? "";
}

/**
 * The command word one criterion's `run` step issues.
 *
 * Read through the engine's own union rather than through a cast: `kind` discriminates, so the step
 * that survives the guard *is* the run step and its `argv` is a field the compiler can see. A cast
 * here would have made this file's subject the step's shape instead, and a step kind whose payload
 * moved would fail as a type error about a field rather than as a reading about a command.
 */
function commandOf(entry: ResolvedDefinition["plan"]["criteria"][number]): string | null {
  for (const step of entry.steps) {
    if (step.kind !== "run") continue;
    const first = step.argv[0];
    if (typeof first === "string") return first;
  }
  return null;
}

const injectedIds = (text: string): readonly string[] =>
  status(text)
    .filter((entry) => entry.state === "injected")
    .map((entry) => entry.defect.id);

// ---- the shipped program is the correct one ---------------------------------------------------------

describe("the shipped provisioning program is the correct one", () => {
  it("reports all four defects intact, and none of them is a no-op", () => {
    const program = readProvision();
    const entries = status(program);
    assert.deepEqual(
      injectedIds(program),
      [],
      `run \`node ${demoPath} --restore-only\` to put the shipped program back`,
    );
    assert.deepEqual(
      entries.map((entry) => entry.state),
      ["intact", "intact", "intact", "intact"],
      "a shipped program with a defect already in it makes the demo's first pass meaningless",
    );
    for (const entry of entries) {
      assert.notEqual(
        entry.defect.correct,
        entry.defect.defective,
        `${entry.defect.id} replaces its block with itself, so injecting it would change nothing`,
      );
      assert.ok(
        !entry.defect.correct.includes(entry.defect.defective),
        `${entry.defect.id}: \`correct\` contains \`defective\`, so the state cannot be told apart - ` +
          "there is no way to read which of the two a file holds",
      );
      assert.ok(
        !entry.defect.defective.includes(entry.defect.correct),
        `${entry.defect.id}: \`defective\` contains \`correct\``,
      );
      assert.ok(entry.defect.summary.trim().length > 0, `${entry.defect.id} carries no summary`);
    }
  });

  it("files each defect against a criterion of this contract, and never two against one", async () => {
    const outcome = await define();
    assert.deepEqual(
      DEFECTS.map((entry) => entry.criterionId),
      [...FILED],
      "the table is in criterion order, and a reordering would change what the demo's progression means",
    );
    assert.equal(new Set(DEFECTS.map((entry) => entry.criterionId)).size, DEFECTS.length);
    assert.equal(new Set(DEFECTS.map((entry) => entry.id)).size, DEFECTS.length);
    assert.equal(DEFECTS.length, 4);
    assert.equal(PROVISION_FILE, "provision.mjs");
    for (const entry of DEFECTS) {
      assert.match(entry.criterionId, /^AC-[0-9]{3}$/);
    }
    const planned = new Set(outcome.plan.criteria.map((entry) => entry.criterion.id));
    assert.deepEqual(
      FILED.filter((id) => !planned.has(id)),
      [],
      "a defect filed against a criterion nothing plans can never be read by a run, so a repair would " +
        "be judged by the criteria the defect also moves and never by the one it is",
    );
  });

  it("keeps every anchor exactly once, and only the release block spans a line", () => {
    const program = readProvision();
    const newline = newlineOf(program);
    for (const entry of DEFECTS) {
      assert.equal(
        occurrences(program, inStyle(entry.correct, newline)),
        1,
        `${entry.id}: the correct block must occur exactly once - \`String.replace\` edits the first ` +
          "match, so a second occurrence would leave one site unedited",
      );
      assert.equal(
        occurrences(program, inStyle(entry.defective, newline)),
        0,
        `${entry.id}: the defective block is already in the shipped program`,
      );
    }
    const spanning = DEFECTS.filter((entry) => entry.correct.includes("\n")).map((entry) => entry.id);
    assert.deepEqual(
      spanning,
      ["D3"],
      "`D3` is the only block that can reach the ending conversion at all - which is why the conversion " +
        "is proved against synthetic blocks in `tests/defect-text.test.ts` and only observed here",
    );
  });
});

// ---- nothing is lost in the round trip --------------------------------------------------------------

describe("injecting and repairing round-trips the same bytes", () => {
  it("is idempotent, repairs in table order, and restores the program exactly", () => {
    const original = readProvision();
    const seeded = inject(original);
    assert.deepEqual(seeded.injected, DEFECTS.map((entry) => entry.id));
    assert.deepEqual(
      status(seeded.text).map((entry) => entry.state),
      ["injected", "injected", "injected", "injected"],
    );

    const again = inject(seeded.text);
    assert.deepEqual(again.injected, []);
    assert.deepEqual(again.alreadyInjected, DEFECTS.map((entry) => entry.id));
    assert.equal(again.text, seeded.text, "injecting twice must be a no-op rather than a second edit");

    let text = seeded.text;
    const counts: number[] = [];
    for (let step = 0; step < DEFECTS.length; step += 1) {
      counts.push(injectedIds(text).length);
      const repaired = repairOne(text);
      assert.ok(repaired.repaired !== null, `iteration ${String(step + 1)} found nothing to repair`);
      text = repaired.text;
    }
    counts.push(injectedIds(text).length);
    assert.deepEqual(
      counts,
      [4, 3, 2, 1, 0],
      "the repair walk descends one per defect, which is the shape the demo's progression reports",
    );
    assert.equal(text, original, "repairing every defect restores the shipped program byte for byte");
    assert.equal(repairOne(text).repaired, null, "a clean program has nothing to repair");
  });

  it("re-expresses the whole table in either ending, and the checked-in file in only one", () => {
    const original = readProvision();
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
    const crlf = occurrences(original, "\r\n");
    const lf = occurrences(original, "\n") - crlf;
    assert.ok(
      crlf === 0 || lf === 0,
      `the checked-in ${PROVISION_FILE} carries both line endings, so \`newlineOf\` has no single answer`,
    );
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
        DEFECTS.map((entry) => entry.id),
        "every defect is named as it is undone, in table order - `restoreAll`'s own doc comment states " +
          "that it returns the ids it repaired, so an expectation carrying the file name would be a shape " +
          "the function was never written to have",
      );
      assert.equal(readProvision(), before, "the file on disk is byte-identical to what it was");
      assert.deepEqual(restoreAll(), [], "restoring a clean file writes nothing and claims nothing");
    } finally {
      writeChanged(readProvision(), before);
    }
  });
});

// ---- the world, really running ----------------------------------------------------------------------

describe("the world the contract describes is the world that runs", () => {
  it("provisions itself from a real child process, and the application says so", async () => {
    const { environment, provisioned, reading } = await world();
    assert.equal(
      provisioned.count,
      1,
      "a deploy that ran the application twice, or never, is not the run the contract describes",
    );
    assert.equal(provisioned.code, 0, `the provisioner exited ${String(provisioned.code)}`);
    assert.equal(provisioned.timedOut, false);
    assert.equal(provisioned.stderr.trim(), "", "the provisioner wrote to stderr");
    const pattern = environment.health.readyPattern ?? "";
    assert.ok(
      pattern.length > 0,
      "the world was resolved without a readiness pattern, so nothing says the application spoke",
    );
    assert.match(
      provisioned.stdout,
      new RegExp(pattern),
      "the line the world waits for is the line the application printed",
    );
    assert.ok(reading.topics.length > 0, "the application provisioned nothing into the world");
  });

  it("answers every request the application made, and files each one as the application's", async () => {
    const { requests } = await world();
    const fromApplication = requests.filter((entry) => entry.source === "application");
    assert.ok(
      fromApplication.length >= 1,
      "the substitute holds nothing the application asked it, which means the guard this world uses " +
        "to tell a provisioned world from an empty one had nothing to read",
    );
    assert.deepEqual(
      fromApplication.filter((entry) => entry.result !== "ok").map((entry) => entry.api),
      [],
      "`goal.yaml` states that every request the application put to the broker was answered `ok`",
    );
    assert.deepEqual(
      requests.filter((entry) => entry.source === "criterion"),
      [],
      "this file sent no command of its own, so a record filed against a criterion would be a record " +
        "the world made up",
    );
  });

  it("holds exactly the topics the contract says it holds, and the batch each one carries", async () => {
    const outcome = await define();
    const { reading } = await world();
    const declared = outcome.plan.criteria
      .filter((entry) => entry.expectations.some((e) => e.validator.name === DATA_VALIDATOR_NAMES.topic))
      .flatMap((entry) =>
        entry.expectations
          .filter((e) => e.validator.name === DATA_VALIDATOR_NAMES.topic)
          .map((e) => e.target ?? ""),
      );
    assert.deepEqual(
      reading.topics.map((topic) => topic.name).sort(),
      [...declared].sort(),
      "the world holds exactly the topics this contract names - a topic the application created and no " +
        "criterion names, or one a criterion names and the application never created, would both read " +
        "as a contract and a world that disagree",
    );

    const records = reading.topics
      .flatMap((topic) => topic.partitions)
      .flatMap((partition) => partition.records);
    assert.equal(records.length, 5, "four orders and the pipeline's own checkpoint");
    assert.deepEqual(
      records.map((record) => record.key).sort(),
      ["index-cart-events", "ord-1001", "ord-1002", "ord-1003", "ord-1004"],
    );
    assert.deepEqual(
      records
        .filter((record) => record.value !== null && record.value.includes("ord-"))
        .map((record) => record.value)
        .sort(),
      [
        '{"order":"ord-1001","release":"1.0.0"}',
        '{"order":"ord-1002","release":"1.0.0"}',
        '{"order":"ord-1003","release":"1.0.0"}',
        '{"order":"ord-1004","release":"1.0.0"}',
      ],
      "every record carries the release constant the shipped program holds",
    );
  });

  it("stores every record with its header list present and empty", async () => {
    const { reading } = await world();
    const batches = reading.topics.map((topic) => ({
      topic: topic.name,
      records: topic.partitions.flatMap((partition) => partition.records),
    }));
    const total = batches.reduce((sum, batch) => sum + batch.records.length, 0);
    assert.equal(total, 5, "the property below has to be stated about a batch that exists");
    for (const batch of batches) {
      for (const record of batch.records) {
        assert.ok(
          Array.isArray(record.headers),
          `${batch.topic} offset ${String(record.offset)}: the header list is absent rather than empty`,
        );
        assert.equal(
          record.headers.length,
          0,
          `${batch.topic} offset ${String(record.offset)} carries headers, and \`goal.yaml\` states ` +
            "that this stream has none - named there as a fact about what the application writes rather " +
            "than as a clause, because no criterion in the family could fail over it",
        );
      }
    }
  });

  it("pins the contract's own strings to the world's own renderers", async () => {
    const outcome = await define();
    const { reading, requests, environment } = await world();
    const node = reading.node;
    const identity = `${reading.cluster} (${renderNodeIdentity(node)})`;
    const pattern = pinned(outcome, "AC-001", DATA_VALIDATOR_NAMES.node, "matches");
    assert.ok(
      pattern.startsWith("^") && pattern.endsWith("$"),
      "`data.node` is targetless, so the string it compares is built by `renderNodeIdentity` rather " +
        "than read out of the target - and a pattern that is not anchored would match a rendering " +
        "that happened to carry this world's name inside a longer line",
    );
    assert.ok(
      new RegExp(pattern).test(identity),
      `the contract pins ${JSON.stringify(pattern)} and this world renders ${JSON.stringify(identity)}`,
    );
    assert.equal(
      node.host,
      environment.data?.host,
      "the endpoint's host is the one this world bound, and the declaration asked for the same one",
    );

    const rows: readonly { readonly criterion: string; readonly validator: string; readonly noun: DataRefNoun }[] = [
      { criterion: "AC-004", validator: DATA_VALIDATOR_NAMES.layout, noun: "topic" },
      { criterion: "AC-005", validator: DATA_VALIDATOR_NAMES.layout, noun: "topic" },
      { criterion: "AC-006", validator: DATA_VALIDATOR_NAMES.partition, noun: "partition" },
      { criterion: "AC-007", validator: DATA_VALIDATOR_NAMES.partition, noun: "partition" },
      { criterion: "AC-008", validator: DATA_VALIDATOR_NAMES.partition, noun: "partition" },
      { criterion: "AC-012", validator: DATA_VALIDATOR_NAMES.group, noun: "group" },
      { criterion: "AC-013", validator: DATA_VALIDATOR_NAMES.member, noun: "member" },
      { criterion: "AC-014", validator: DATA_VALIDATOR_NAMES.commit, noun: "commit" },
      { criterion: "AC-015", validator: DATA_VALIDATOR_NAMES.partition, noun: "partition" },
    ];
    for (const row of rows) {
      const entry = outcome.plan.criteria.find((candidate) => candidate.criterion.id === row.criterion);
      assert.ok(entry !== undefined, `the contract plans no ${row.criterion}`);
      const target = targetOf(entry, row.validator);
      assert.notEqual(target, "", `${row.criterion} names no ${row.validator} target`);
      assert.equal(
        pinned(outcome, row.criterion, row.validator),
        rendering(reading, row.noun, target),
        `${row.criterion}: the pinned string is not what this world renders for ${JSON.stringify(target)}`,
      );
    }

    assert.equal(
      pinned(outcome, "AC-002", DATA_VALIDATOR_NAMES.call),
      "ok",
      "the application's `ApiVersions` request was not answered `ok`",
    );
    // The record's `api` is the world's *own* rendering of the API - `ApiVersions(18) v0` - while the
    // contract's target is the bare name the `data.call` grammar takes. They are deliberately
    // different strings, so the spelling is read off the register rather than recalled: a test that
    // searched this list for `"ApiVersions"` would find nothing and report a healthy run as speechless.
    const negotiation = DATA_APIS.find((api) => api.name === "ApiVersions");
    assert.ok(negotiation !== undefined, "the world's own register no longer names `ApiVersions`");
    const apiVersions = requests.find((entry) => entry.api === dataApiSpelling(negotiation));
    assert.ok(apiVersions !== undefined, "the application never asked this world what it supports");
    assert.equal(apiVersions.result, "ok");
  });
});

// ---- the goal, the contract and the environment agree ------------------------------------------------

describe("the goal, the contract and the environment agree", () => {
  it("resolves without asking the operator anything and without deferring anything", async () => {
    const outcome = await define();
    for (const [stage, report] of Object.entries(outcome.reports)) {
      assert.equal(report.questionsAsked, 0, `${stage}: a question was asked about a complete demo`);
      assert.equal(report.byVia.deferred, 0, `${stage}: a value was deferred that the document states`);
    }
  });

  it("describes a broker world and no other kind", async () => {
    const { environment } = await define();
    assert.equal(environment.adapter, "sim-data");
    assert.equal(environment.app, "app");
    assert.ok(
      environment.appPath.replace(/\\/g, "/").endsWith("examples/sim-data/app"),
      `the application directory resolved to ${environment.appPath}`,
    );
    assert.equal(environment.url, null, "this world answers on a socket it opens, not on a URL");
    assert.equal(environment.api, null);
    assert.equal(environment.databasePath, null);
    assert.equal(environment.cluster, null);
    assert.equal(environment.posix, null);
    assert.equal(environment.os, null);
    assert.equal(environment.cloud, null);
    assert.equal(environment.container, null);
    assert.equal(environment.vscode, null);
    assert.equal(environment.process, null);
    assert.notEqual(environment.data, null, "a verdict here has to say which broker it stood in for");
    assert.equal(environment.browser.enabled, false);
    assert.equal(environment.health.path, null);
    assert.equal(environment.health.expectStatus, null);
    assert.equal(environment.start.command, "node");
    assert.ok(environment.start.args.includes("provision.mjs"));
    assert.equal(environment.reset.strategy, "restart");
  });

  it("names the cluster, the node and the address it asked for", async () => {
    const { environment } = await define();
    assert.equal(environment.data?.cluster, "veridian-data");
    assert.equal(environment.data?.nodeId, 1);
    assert.equal(
      environment.data?.port,
      0,
      "the declaration is what the document wrote, and `0` is a statement that the operating system " +
        "chooses - the bound port is a fact about the run and is only in the reading",
    );
    const loader = readFileSync(new URL("../core/environment/load.ts", import.meta.url), "utf8");
    assert.ok(
      loader.includes('["127.0.0.1", "::1", "localhost"]'),
      "this world may only bind loopback, and the rule that enforces that is the loader's own list",
    );
  });

  it("judges all twenty criteria and none of them optional", async () => {
    const outcome = await define();
    assert.deepEqual(
      outcome.plan.criteria.map((entry) => entry.criterion.id),
      Array.from({ length: spelled("Twenty") }, (_unused, index) => `AC-${String(index + 1).padStart(3, "0")}`),
      "the contract's criteria are numbered once each, in order",
    );
    assert.equal(outcome.plan.mandatory.length, outcome.plan.criteria.length);
    assert.equal(outcome.plan.optional.length, 0);
    assert.equal(outcome.plan.goalId, "sim-data");
    assert.equal(
      outcome.contract.goalId,
      outcome.goal.id,
      "a contract naming a different goal would be judged against another goal's environment",
    );
    assert.equal(outcome.goal.id, "sim-data");
  });

  it("uses every validator the family registers, and reads the family's own observation", async () => {
    const outcome = await define();
    const used = new Set(
      outcome.plan.criteria.flatMap((entry) =>
        entry.expectations.map((expectation) => expectation.validator.name),
      ),
    );
    assert.deepEqual(
      [...used].sort(),
      [...new Set(Object.values(DATA_VALIDATOR_NAMES))].sort(),
      "the contract claims to exercise the whole family; a criterion is the only thing that can hold that",
    );
    assert.equal(used.size, Object.keys(DATA_VALIDATOR_NAMES).length);
    for (const entry of outcome.plan.criteria) {
      for (const expectation of entry.expectations) {
        assert.equal(
          expectation.validator.observationKind,
          DATA_OBSERVATION_KIND,
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

  it("has exactly one targetless validator, and it is the one that names the broker", () => {
    const targetless = DATA_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(
      targetless,
      [DATA_VALIDATOR_NAMES.node],
      "a validator that needs no target asks about the world itself. `acceptance.yaml` said there were " +
        "two - `data.meter` takes a meter name - and a count in prose is a claim about the code, so the " +
        "code is what this reads",
    );
  });

  it("leaves the loop room to run once per defect and to stop", async () => {
    const { goal } = await define();
    const limits = goal.limits;
    assert.ok(
      limits.maxIterations > DEFECTS.length,
      "the first pass cannot repair anything, so the loop needs one more iteration than it has defects - " +
        "and a ceiling that equals the run it bounds is a fixture rather than a bound",
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

// ---- the contract's own counts are the document's counts ----------------------------------------------

describe("the contract's own counts are the document's counts", () => {
  it("states its four figures, and the code is what each one is checked against", async () => {
    const outcome = await define();
    assert.ok(
      CONTRACT_HEADER.includes("tests/sim-data-demo.test.ts"),
      "the header names this file as the place its counts are read, so it has to stay the file that reads them",
    );

    const counts = /(\w+) criteria over all (\w+) validators/.exec(CONTRACT_HEADER);
    assert.ok(counts !== null, `the header states no criterion and validator counts: ${CONTRACT_HEADER}`);
    assert.equal(outcome.plan.criteria.length, spelled(counts[1] ?? ""));
    assert.equal(Object.keys(DATA_VALIDATOR_NAMES).length, spelled(counts[2] ?? ""));

    const acting = /(\w+) of them act inside the world through a `run` step/.exec(CONTRACT_HEADER);
    assert.ok(acting !== null, "the header states no count of criteria that act in the world");
    const running = outcome.plan.criteria.filter((entry) =>
      entry.steps.some((step) => step.kind === "run"),
    );
    assert.equal(running.length, spelled(acting[1] ?? ""));

    const refusing = /and (\w+) of those expects the world to \*\*refuse\*\* it/.exec(CONTRACT_HEADER);
    assert.ok(refusing !== null, "the header states no count of criteria that expect a refusal");
    const refused = running.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "invalid-request"),
    );
    assert.equal(
      refused.length,
      spelled(refusing[1] ?? ""),
      "a substitute that refused nothing would satisfy every criterion written against the " +
        "application's own traffic, so this count is the one the world's honesty rests on",
    );
  });

  it("names three run steps, and each one's command is a word this world knows", async () => {
    const outcome = await define();
    const { requests } = await world();
    const running = outcome.plan.criteria.filter((entry) =>
      entry.steps.some((step) => step.kind === "run"),
    );
    assert.deepEqual(
      running.map((entry) => entry.criterion.id),
      ["AC-016", "AC-017", "AC-018"],
    );
    assert.deepEqual(
      running.map((entry) => commandOf(entry)),
      ["metadata", "create-topic", "leavegroup"],
      "the three commands, in criterion order - the first two are words this world performs and the " +
        "third is one it does not",
    );

    const words: readonly string[] = ["create-topic", "produce", "fetch", "metadata", "commit"];
    assert.deepEqual(
      [...DATA_COMMAND_WORDS],
      words,
      "the vocabulary this file checks each step against is the port's own register",
    );
    for (const entry of running) {
      const command = commandOf(entry);
      assert.ok(command !== null, `${entry.criterion.id} carries a run step with no command this file can read`);
      const performed = words.includes(command);
      const probe = targetOf(entry, DATA_VALIDATOR_NAMES.probe);
      assert.ok(
        probe.toLowerCase().includes(command.replace(/-/g, "")),
        `${entry.criterion.id}: the criterion runs ${JSON.stringify(command)} and probes ` +
          `${JSON.stringify(probe)} - a probe that does not name what the step did reads a request the ` +
          "criterion never made",
      );
      assert.equal(
        performed,
        !/refused/.test(probe),
        performed
          ? `${entry.criterion.id}: this world performs ${JSON.stringify(command)}, so its probe target ` +
            "has to name the API the request reached rather than a refusal"
          : `${entry.criterion.id}: this world does not perform ${JSON.stringify(command)}, so its probe ` +
            "target has to be the refusal the world recorded - an API name here would send a reader " +
            "looking for a feature the world does not have",
      );
    }
    const probes = running.map((entry) => targetOf(entry, DATA_VALIDATOR_NAMES.probe));
    assert.deepEqual(
      probes,
      [...PROBED],
      "two API names and one refusal spelling, which is the whole reason this family's target may be " +
        "either - and `AC-018` is the criterion that holds that half",
    );

    assert.equal(
      requests.filter((entry) => entry.api === "LeaveGroup").length,
      0,
      "a command the criterion sends in process must never reach the socket, or the application's own " +
        "traffic and the judge's would be one record",
    );
  });

  it("reads the refusal the criterion's own command earned, not one off a step", async () => {
    const outcome = await define();
    const refusing = outcome.plan.criteria.filter((entry) =>
      entry.expectations.some((expectation) => expectation.raw["equals"] === "refused"),
    );
    assert.deepEqual(
      refusing.map((entry) => entry.criterion.id),
      ["AC-017"],
      "`AC-017` reads the refusal the *criterion* got: the application's `CreateTopics` for two fresh " +
        "topics is answered `ok`, and the criterion's for a topic the world already holds is refused. " +
        "Two different questions about one API, both right - and `AC-018`'s refusal is a different " +
        "result word (`invalid-request`) about a command the world does not implement at all",
    );
  });

  it("never judges a criterion about the application with the judge's own request", async () => {
    const outcome = await define();
    const acting = outcome.plan.criteria.filter((entry) =>
      entry.steps.some((step) => step.kind === "run"),
    );
    for (const entry of acting) {
      assert.ok(
        entry.expectations.some(
          (expectation) => expectation.validator.name === DATA_VALIDATOR_NAMES.probe,
        ),
        `${entry.criterion.id}: the command this criterion sent has to be read back, or the world's ` +
          "record of it is written into the bundle and judged by nothing",
      );
    }
    // `data.call` reads the application's traffic and `data.probe` reads the criterion's own, so an
    // acting criterion legitimately carries both - which is why this asserts what the two *mean*
    // rather than that one excludes the other. The separation is the world's: a record's `source` is
    // filed at the one door it arrived through.
    const both = outcome.plan.criteria
      .filter((entry) => {
        const names = entry.expectations.map((expectation) => expectation.validator.name);
        return (
          names.includes(DATA_VALIDATOR_NAMES.call) && names.includes(DATA_VALIDATOR_NAMES.probe)
        );
      })
      .map((entry) => entry.criterion.id);
    assert.deepEqual(
      both,
      ["AC-016", "AC-017"],
      "two criteria compare the application's answer with the criterion's own, which is the one place " +
        "the two doors into this world can be seen to be two",
    );
  });
});

// ---- the world says it is a substitute ---------------------------------------------------------------

describe("the world says it is a substitute", () => {
  it("declares every surface it stands in for, from a closed list", () => {
    assert.deepEqual(
      [...DATA_SIMULATED_SURFACES],
      [
        "broker",
        "replication",
        "group-coordination",
        "log-storage",
        "retention",
        "transactions",
        "partitioning",
      ],
      "a world that stands something in has to say so where the reading is, and the list is closed",
    );
  });

  it("declares five names, publishes five, and the application reads two", () => {
    assert.deepEqual(
      Object.entries(DATA_ENV),
      [
        ["cluster", "VERIDIAN_DATA_CLUSTER"],
        ["nodeId", "VERIDIAN_DATA_NODE_ID"],
        ["host", "VERIDIAN_DATA_HOST"],
        ["port", "VERIDIAN_DATA_PORT"],
        ["broker", "VERIDIAN_DATA_BROKER"],
      ],
      "the five names this world declares - a renaming is a breaking change to every program it starts",
    );
    const program = readProvision();
    const read = new Set(program.match(/VERIDIAN_DATA_[A-Z_]+/g) ?? []);
    assert.deepEqual(
      [...read].sort(),
      [DATA_ENV.host, DATA_ENV.port].sort(),
      "the shipped application speaks a protocol over a socket, so the two halves are what it needs - " +
        "and the other three are published for a log line, a criterion's message or a program that " +
        "would rather not join two strings. A test asserting the two sets were equal would fail on " +
        "correct product code",
    );
    const declared = new Set<string>(Object.values(DATA_ENV));
    for (const name of read) {
      assert.ok(
        declared.has(name),
        `${name} is read by the application and declared by nothing`,
      );
    }
  });

  it("waits for the line the application prints, and the line counts what the run sent", async () => {
    const { environment } = await define();
    const program = readProvision();
    const pattern = environment.start.readyPattern;
    assert.equal(
      pattern,
      environment.health.readyPattern,
      "the loader reads `readyPattern` from `start` and hands the same value to the health policy; two " +
        "readings of one fact in one plan is one reading too many",
    );
    assert.ok(
      pattern !== null && pattern.length > 0,
      "a world with no status code has only the application's own line to wait for",
    );
    const literal = /say\(`(cart-broker provisioned:[^`]*)`\)/.exec(program);
    assert.ok(
      literal !== null,
      "the completeness line is the readiness signal, so it has to be a line the program really prints",
    );
    assert.match(
      literal[1] ?? "",
      /cart-broker provisioned: \$\{String\(requests\)\} requests, \$\{String\(TOPICS\.length\)\} topics, \$\{String\(produced\)\} records/,
      "every figure is read off what the run sent, so no test may assert the sentence as a literal - " +
        "the line says what this run did rather than what some run once did",
    );
    // The two spellings of one sentence have to be compared where they agree. The pattern describes
    // what the program *prints* - `\d+` - while the source holds the expression that will print it -
    // `${String(x)}` - so applying the pattern to the source compares a number against the code that
    // computes one and can never match. What can be checked, and is the whole of the claim, is that
    // the pattern is this sentence's own words with each figure replaced.
    const inProgram = (literal[1] ?? "").split(/\$\{String\([^)]*\)\}/);
    assert.deepEqual(
      pattern.split(/\\d\+/),
      inProgram,
      "the readiness pattern is the completeness line's own words with each figure replaced by " +
        "`\\d+`, so a pattern waiting for a sentence the program never prints fails here rather than " +
        "as a timeout the world would report as an application that never spoke",
    );
  });

  it("declares no path, because nothing in this world is a file this machine can open", async () => {
    const { environment } = await define();
    const source = readFileSync(new URL(`../${demoPath}`, import.meta.url), "utf8");
    assert.ok(
      source.includes("no Apache Kafka") || source.includes("no Kafka"),
      "the demo has to say what it did not start, or a reader takes the substitute for the thing",
    );
    assert.equal(
      APP_DIR.pathname.replace(/\\/g, "/").endsWith("examples/sim-data/app/"),
      true,
      "the application directory is the one the demo's own source file resolves",
    );
    assert.equal(environment.api, null);
    const yaml = readFileSync(new URL(`../${environmentPath}`, import.meta.url), "utf8");
    assert.ok(
      !/\n\s*path:/.test(yaml),
      "this world has no HTTP surface, so a `path` in its environment document is a field nothing reads",
    );
  });
});
