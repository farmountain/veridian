/**
 * The `process.*` validator family - the vocabulary an acceptance criterion uses to judge a process
 * boundary.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`ProcessObservationData`) and never spawns a process, never opens
 * a file and never sees a runner. That is why the vocabulary lives in
 * `core/environment/process-observation.ts` rather than beside the adapter: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know how a command was started, cannot become
 * untestable the day the process runner changes, and can be re-read from a bundle a year later with
 * nothing running at all.
 *
 * ## The family, one question at a time
 *
 * Twelve names, because twelve different questions are asked of a command and of a file, and each has
 * a different repair. Collapsing any two of them would report one defect where there are two:
 *
 * - `process.host` - *which* world produced this reading, asked of the reading itself.
 * - `process.probe` - everything this criterion did to this world, as one reading.
 * - `process.argv` - what was run, spelled as the criterion asked for it.
 * - `process.state` - how it ended, as one of the four words the reading owns.
 * - `process.exitcode` - the code alone, for a criterion that has to compare a number.
 * - `process.run` - the ending and both streams as one line, which is what a failure report quotes.
 * - `process.stdout` - one stream's text. A wrong exit code is not a wrong log line.
 * - `process.stderr` - the other stream. A warning on stderr is not a defect on stdout.
 * - `process.file` - whether a path holds anything at all.
 * - `process.kind` - what kind of thing it holds.
 * - `process.contents` - the file's text.
 * - `process.size` - the file's length, for a criterion that has to ask about size without reading it.
 *
 * ## Two grammars in one family, and why each validator holds its own
 *
 * Six of these name their subject by **command selector** and four by **path**. The two subjects
 * cannot be told apart by their spelling alone, so the grammar belongs to the *validator* rather than
 * to the target: `process.run` reads its target as a selector and `process.contents` reads its target
 * as a path, so neither can misinterpret the other's spelling. The one ambiguity a reader could
 * construct - a file called `1` - is resolved by rule rather than by guess, and
 * `commandSelectorOf`'s own doc states the rule. Neither grammar is re-implemented here: the parser
 * the adapter uses to decide what to perform is the parser these validators use to decide what to
 * read, which is what makes "the criterion named a position and the position was performed" one rule
 * rather than two that can disagree.
 *
 * ## Status discipline
 *
 * The same branches as every other family, chosen so a wrong answer is never produced:
 *
 * - `PASS` - the comparison held and the command or the file was actually recorded.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the application's behaviour*: an
 *   exit code that was not zero, a stream that printed nothing, a file whose text lost a line.
 * - `INCONCLUSIVE` - nobody looked. The criterion performed fewer commands than the position it
 *   named, so there is no command to read; or a path whose text the world declined to carry, or which
 *   holds nothing, so there is no text or length to compare.
 * - `ERROR` - the *criterion* is unusable (a target that is neither a selector nor a path inside the
 *   world, a comparison that wants a number and got a word) or the world arrived unreadable. Never
 *   `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * A command that never exited is a `FAIL` on `process.exitcode` and **not** an error, and the message
 * quotes how it ended rather than a code that does not exist. A reading with `exitCode: null` has no
 * comparison that can hold, and reporting it as `INCONCLUSIVE` would hide an application that hangs
 * behind a criterion that politely declined to judge it - which is the one shape this product exists
 * to refuse.
 */

import type { Observation } from "../../core/environment/types.ts";
import type {
  ProcessCommandRecord,
  ProcessFileReading,
  ProcessObservationData,
} from "../../core/environment/process-observation.ts";
import {
  PROCESS_APPLICATION,
  PROCESS_COMMAND_STATES,
  PROCESS_FILE_KINDS,
  PROCESS_OBSERVATION_KIND,
  commandAbsentReason,
  commandAt,
  commandSelectorOf,
  fileAt,
  isProcessObservationData,
  processPath,
  renderArgv,
  renderCommand,
  renderFile,
  renderHost,
  renderStream,
} from "../../core/environment/process-observation.ts";
import { ENV_READINGS, readEnvironmentCrawl } from "../../core/environment/env-crawl.ts";
import type { EnvReading } from "../../core/environment/env-crawl.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  compareWord,
  expectedOf,
  judge,
  quote,
  statedComparisons,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * A criterion, a test and a failure report all spell these strings. Exporting the literal type of each
 * means a rename breaks the compiler instead of producing an acceptance contract that quietly
 * resolves to no validator at all.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `process.exitCode` would not merely be
 * unconventional - it is an acceptance contract that cannot be written at all.
 */
export const PROCESS_VALIDATOR_NAMES = {
  host: "process.host",
  probe: "process.probe",
  environment: "process.environment",
  argv: "process.argv",
  state: "process.state",
  exitcode: "process.exitcode",
  run: "process.run",
  stdout: "process.stdout",
  stderr: "process.stderr",
  file: "process.file",
  kind: "process.kind",
  contents: "process.contents",
  size: "process.size",
} as const;

/** The two streams a criterion may ask about, and the order a reader would look for them in. */
const STREAM_NAMES = ["stdout", "stderr"] as const;

/** What a command target names, said once, because five validators ask for one. */
const COMMAND_NOUN = `a command, named as \`${PROCESS_APPLICATION}\` or as a position counted from 1`;

/** What a path target names, said once, because four validators ask for one. */
const PATH_NOUN = "a path inside the world's own tree";

// ---- reading the document ------------------------------------------------------------------------

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): ProcessObservationData | AssertionResult {
  if (isProcessObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a process document, so ` +
      "there is nothing to read. The adapter produced the measurement, so this is a defect in the " +
      "environment rather than a criterion the application failed.",
    "ENVIRONMENT_FAILURE",
  );
}

/**
 * Whether a helper returned a verdict instead of the value it was asked for.
 *
 * It keys on `validator`, which is the rule the sibling family next door wrote down after paying for
 * it: **a discriminator has to key on a field the other shape cannot have.** Nothing a validator in
 * this family returns carries a `validator` field, and no reading it returns does either - a
 * `ProcessCommandRecord` has a `state`, a `ProcessFileReading` has a `kind`, and neither has a
 * `status`, so a `status`-keyed test would be safe here by luck. It is not written that way, because
 * being safe by luck is what stops being true the day the reading grows a field.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { validator?: unknown }).validator === "string" &&
  "status" in value;

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

/** How a failure report names the command a selector picked out. */
const subjectOf = (selector: string): string =>
  selector === PROCESS_APPLICATION
    ? "the program this world started"
    : `command ${selector} of this criterion`;

// ---- the two grammars ----------------------------------------------------------------------------

/**
 * The command a target names, with the selector it named it by.
 *
 * The selector comes back with the record because a failure report quotes *which* command it was
 * judged against, and re-parsing the target at each site to recover it would be a second reading of
 * one name - the shape that goes wrong the first time the grammar grows a spelling.
 */
function commandNamed(
  validator: string,
  document: ProcessObservationData,
  target: string | null,
): { readonly selector: string; readonly record: ProcessCommandRecord } | AssertionResult {
  if (target === null) return noTarget(validator, COMMAND_NOUN);
  const parsed = commandSelectorOf(target);
  if (!parsed.ok) return unusable(validator, target, parsed.message);
  const record = commandAt(document, parsed.selector);
  if (record === null) {
    return unanswered(validator, target, commandAbsentReason(document, parsed.selector));
  }
  return { selector: parsed.selector, record };
}

/**
 * The reading of the path a target names.
 *
 * A target that leaves the world's tree is `unusable` rather than `unanswered`, and the difference
 * matters: `processPath` refuses a spelling this world cannot name, so the criterion named something
 * that is not a place here - while an *absent* file is a place the world looked at and found empty,
 * and that is a fact about the application. Merging the two would report a contract that cannot be
 * read as a file the application failed to write.
 */
function fileNamed(
  validator: string,
  document: ProcessObservationData,
  target: string | null,
): ProcessFileReading | AssertionResult {
  if (target === null) return noTarget(validator, PATH_NOUN);
  const path = processPath(target);
  if (path === null) {
    return unusable(
      validator,
      target,
      `A path is read relative to the root this world names, and ${quote(target)} is not one: a ` +
        "leading separator, a drive letter and a `..` that leaves the root each name this machine's " +
        "filesystem rather than the world's. Write the path the way the criterion's own command " +
        "wrote it, relative to the root the reading names.",
    );
  }
  const reading = fileAt(document, path);
  if (reading === null) {
    return unanswered(
      validator,
      path,
      `The reading carries no entry for ${quote(path)}, so nobody looked. A path is read when a ` +
        "criterion names it as a target, so a reading with no entry for one has a defect in the " +
        "adapter rather than an answer about the application.",
    );
  }
  return reading;
}

// ---- the renderings a failure report quotes ------------------------------------------------------

/**
 * The whole reading, as an operator reads it.
 *
 * Composed here rather than in the observation module because it exists for exactly one validator and
 * every part of it is printed by the helper that owns that part - so a change to how a stream or a
 * file is spelled reaches this line too. A summary that assembled its own formatting would be free to
 * disagree with the renderings a failure report quotes beside it.
 */
function renderProbe(document: ProcessObservationData): string {
  const lines = [renderHost(document)];
  if (document.application !== null) {
    lines.push(`application: ${renderArgv(document.application)} - ${renderCommand(document.application)}`);
  }
  document.commands.forEach((record, index) => {
    lines.push(`command ${String(index + 1)}: ${renderArgv(record)} - ${renderCommand(record)}`);
  });
  for (const reading of document.files) {
    lines.push(`file ${reading.path}: ${renderFile(reading)}`);
  }
  return lines.join("\n");
}

// ---- 1. which world, and everything a criterion did to it ----------------------------------------

const host: Validator = {
  name: PROCESS_VALIDATOR_NAMES.host,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, host.name, null);
    if (isAssertion(document)) return document;
    // The reading's own subject, which the document declared rather than the adapter derived. A
    // criterion asking this question is asking whether the bundle in front of it describes the world
    // it meant, and that is a question about the reading and not about the commands.
    return judge(
      host.name,
      document.host,
      "the world this reading names",
      renderHost(document),
      raw,
      compareText,
    );
  },
};

const probe: Validator = {
  name: PROCESS_VALIDATOR_NAMES.probe,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, null);
    if (isAssertion(document)) return document;
    return judge(
      probe.name,
      document.host,
      "everything this criterion did to this world",
      renderProbe(document),
      raw,
      compareText,
    );
  },
};

/** What an `process.environment` target names, said once so the refusal and the message agree. */
const ENVIRONMENT_NOUN = `one of ${ENV_READINGS.join(", ")}`;

/** Whether a target names a reading this vocabulary has, so the refusal can be made before the read. */
const isEnvReading = (value: string): value is EnvReading =>
  (ENV_READINGS as readonly string[]).includes(value);

/**
 * The fourth dimension of the world: what the application could **see**.
 *
 * The other three boundary dimensions are `process.probe`'s subject or the bundle's, and this one is a
 * separate validator because it answers a different question from all of them. `process.probe` renders
 * what the application *did*; this renders what it could have read, and the two differ in exactly the
 * case that matters - an application whose behaviour was entirely within its allowance, in a world
 * that handed it every credential in the operator's shell.
 *
 * Two refusals are deliberate rather than defensive. An **unknown target** is refused by name rather
 * than answered with an empty string, because a criterion comparing against a reading nobody took would
 * report a defect in the application for a mistake in the contract. A **null crawl** is reported as
 * `unusable` rather than as an empty environment, because "this world started no process" and "the
 * process saw nothing" are different facts and only one of them is what `null` means.
 *
 * ### Why this validator declares text comparisons and not `atLeast`/`atMost`
 *
 * Seven of the eleven readings are counts, and the other four are words, so `atLeast` looks like it
 * belongs here - and it declared it at first, which was a **lie in the register**: the guard that reads
 * a validator's `comparisons` is not the guard that performs them, and this one passes `compareText`,
 * which refuses `atLeast` with *"`atLeast` is not declared by this validator; it compares with equals,
 * contains and matches."* A contract written against the advertised set therefore failed at run time
 * with a message that contradicted the register. `compareCounts` would not help either, because
 * `comparisons` is a property of the *validator* and not of the target: declaring numeric comparisons
 * here would advertise `mode atLeast 1` as well, which would compare `"declared"` against a number.
 *
 * So the honest set is the one the code performs. Every reading leaves this module as text - that is
 * `readEnvironmentCrawl`'s whole design, and it is what makes a leak unrepresentable - so "some names
 * were seen" is spelled the way the sibling example spells the same question,
 * `matches: "^[1-9][0-9]*$"`, and `equals: "0"` compares a rendered count against a rendered count.
 * *A register may only advertise the comparisons its own comparator performs*, and the per-validator
 * granularity means the narrower vocabulary is the true one.
 */
const environment: Validator = {
  name: PROCESS_VALIDATOR_NAMES.environment,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, environment.name, target);
    if (isAssertion(document)) return document;
    if (target === null) return noTarget(environment.name, ENVIRONMENT_NOUN);
    if (!isEnvReading(target)) {
      return unusable(
        environment.name,
        target,
        `\`${target}\` does not name a reading of the environment. This validator reads ` +
          `${ENVIRONMENT_NOUN}, which is a closed set - an unrecognised target is refused rather than ` +
          "answered with a reading nobody took.",
      );
    }
    const crawl = document.environment;
    if (crawl === null) {
      return unusable(
        environment.name,
        target,
        "this world started no process, so there was no environment to read. The reading is `null` " +
          "rather than an empty crawl, because a world that handed a child nothing and a world that " +
          "started no child are different facts.",
      );
    }
    return judge(
      environment.name,
      target,
      `the \`${target}\` reading of the environment this world's application could see`,
      readEnvironmentCrawl(crawl, target),
      raw,
      compareText,
    );
  },
};

// ---- 2. the command ----------------------------------------------------------------------------
const argv: Validator = {
  name: PROCESS_VALIDATOR_NAMES.argv,
  needsTarget: true,
  targetNoun: COMMAND_NOUN,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, argv.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = commandNamed(argv.name, document, targetOf(raw));
    if (isAssertion(found)) return found;
    return judge(
      argv.name,
      found.selector,
      `what ${subjectOf(found.selector)} ran`,
      renderArgv(found.record),
      raw,
      compareText,
    );
  },
};

const state: Validator = {
  name: PROCESS_VALIDATOR_NAMES.state,
  needsTarget: true,
  targetNoun: COMMAND_NOUN,
  comparisons: ["equals"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, state.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = commandNamed(state.name, document, targetOf(raw));
    if (isAssertion(found)) return found;
    // The vocabulary is the reading's and is passed in as a parameter, so a criterion asking whether a
    // command `equals: "finished"` is reported as a contract that cannot be read rather than as a
    // comparison that is always false. The second shape is indistinguishable from an application
    // defect, and it sends an agent to repair working code.
    return judge(
      state.name,
      found.selector,
      `how ${subjectOf(found.selector)} ended`,
      found.record.state,
      raw,
      compareWord(PROCESS_COMMAND_STATES, "how a command ended"),
    );
  },
};

const exitcode: Validator = {
  name: PROCESS_VALIDATOR_NAMES.exitcode,
  needsTarget: true,
  targetNoun: COMMAND_NOUN,
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, exitcode.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = commandNamed(exitcode.name, document, targetOf(raw));
    if (isAssertion(found)) return found;

    // A command that never exited has no code, so every comparison against one is false - and if the
    // application was expected to finish, that is a defect rather than a question nobody answered.
    // The message quotes *how* it ended instead of a code, because a code is the one thing this
    // reading does not have.
    if (found.record.exitCode === null) {
      return assertion(
        exitcode.name,
        found.selector,
        "FAIL",
        null,
        expectedOf(raw, statedComparisons(raw)),
        `Expected ${subjectOf(found.selector)} to exit with a code, but it ` +
          `${renderCommand(found.record)}. A command that never exited has no exit code, so every ` +
          "comparison against one is false - and an application that hangs is a defect in the " +
          "application.",
      );
    }
    return judge(
      exitcode.name,
      found.selector,
      `the exit code of ${subjectOf(found.selector)}`,
      found.record.exitCode,
      raw,
      compareCounts,
    );
  },
};

const run: Validator = {
  name: PROCESS_VALIDATOR_NAMES.run,
  needsTarget: true,
  targetNoun: COMMAND_NOUN,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, run.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = commandNamed(run.name, document, targetOf(raw));
    if (isAssertion(found)) return found;
    // The whole command as one line: how it ended and what each stream produced. This is the
    // catch-all, and it is deliberately the *only* place the ending and the two streams are one value
    // - a criterion that wants one of them alone says which, and is then judged by a name that fails
    // for its own reason.
    return judge(
      run.name,
      found.selector,
      `what ${subjectOf(found.selector)} did`,
      renderCommand(found.record),
      raw,
      compareText,
    );
  },
};

/**
 * One of the two streams.
 *
 * A factory rather than two literals, because the two differ in exactly one field name and the
 * wording of everything a failure report says about them is otherwise identical. Two copies would be
 * free to disagree about how they name the command they judged.
 */
function streamValidator(name: string, which: (typeof STREAM_NAMES)[number]): Validator {
  return {
    name,
    needsTarget: true,
    targetNoun: COMMAND_NOUN,
    comparisons: ["equals", "contains", "matches"],
    observationKind: PROCESS_OBSERVATION_KIND,
    validate(raw, observation) {
      const document = readDocument(observation, name, targetOf(raw));
      if (isAssertion(document)) return document;
      const found = commandNamed(name, document, targetOf(raw));
      if (isAssertion(found)) return found;
      // The empty string is a stream that was captured and holds nothing, which is a different fact
      // from a stream nobody read. `equals: ""` is how a contract states "this command said nothing",
      // and it is a real assertion: it is false the moment the application prints a line.
      return judge(
        name,
        found.selector,
        `what ${subjectOf(found.selector)} wrote to ${which} ` +
          `(${renderStream(which, found.record[which])})`,
        found.record[which].text,
        raw,
        compareText,
      );
    },
  };
}

const stdout: Validator = streamValidator(PROCESS_VALIDATOR_NAMES.stdout, "stdout");
const stderr: Validator = streamValidator(PROCESS_VALIDATOR_NAMES.stderr, "stderr");

// ---- 3. the file ---------------------------------------------------------------------------------

const file: Validator = {
  name: PROCESS_VALIDATOR_NAMES.file,
  needsTarget: true,
  targetNoun: PATH_NOUN,
  comparisons: ["equals"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, file.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = fileNamed(file.name, document, targetOf(raw));
    if (isAssertion(found)) return found;
    return judge(
      file.name,
      found.path,
      `whether ${quote(found.path)} is there`,
      found.exists,
      raw,
      comparePresence,
    );
  },
};

const kind: Validator = {
  name: PROCESS_VALIDATOR_NAMES.kind,
  needsTarget: true,
  targetNoun: PATH_NOUN,
  comparisons: ["equals"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, kind.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = fileNamed(kind.name, document, targetOf(raw));
    if (isAssertion(found)) return found;
    // The same closed vocabulary the reading is written from, rather than a second list written here.
    // A criterion asking whether a path holds `equals: "symlink"` is then reported as a contract that
    // cannot be read, which is the honest answer - this world does not have that kind of thing to
    // report, and `other` is what it says instead.
    return judge(
      kind.name,
      found.path,
      `what kind of thing ${quote(found.path)} holds`,
      found.kind,
      raw,
      compareWord(PROCESS_FILE_KINDS, `what ${quote(found.path)} holds`),
    );
  },
};

const contents: Validator = {
  name: PROCESS_VALIDATOR_NAMES.contents,
  needsTarget: true,
  targetNoun: PATH_NOUN,
  comparisons: ["equals", "contains", "matches"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, contents.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = fileNamed(contents.name, document, targetOf(raw));
    if (isAssertion(found)) return found;

    // `text === null` is the branch that keeps this honest. Comparing a criterion against an empty
    // string here would report a defect in an application nobody read: the reading either withheld
    // the text for a stated reason, or the path holds nothing to read at all. Both are questions left
    // unanswered, and the world's own reason is quoted rather than paraphrased.
    if (found.text === null) {
      return unanswered(
        contents.name,
        found.path,
        found.textWithheld !== null
          ? `${quote(found.path)} has no text to compare: ${found.textWithheld}.`
          : `${quote(found.path)} holds ${renderFile(found)}, so there is no text to compare. A ` +
            "comparison against an empty string would report a defect in an application nobody read.",
      );
    }
    return judge(
      contents.name,
      found.path,
      `the contents of ${quote(found.path)}`,
      found.text,
      raw,
      compareText,
    );
  },
};

const size: Validator = {
  name: PROCESS_VALIDATOR_NAMES.size,
  needsTarget: true,
  targetNoun: PATH_NOUN,
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: PROCESS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, size.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = fileNamed(size.name, document, targetOf(raw));
    if (isAssertion(found)) return found;

    // The same branch as `contents`, for the same reason: a directory and an absent file have no
    // length, and comparing one against `0` would make "empty" indistinguishable from "not a file".
    if (found.bytes === null) {
      return unanswered(
        size.name,
        found.path,
        `${quote(found.path)} holds ${renderFile(found)}, so it has no length to compare. A ` +
          "comparison against zero would report a defect in an application nobody measured.",
      );
    }
    return judge(
      size.name,
      found.path,
      `the size of ${quote(found.path)}`,
      found.bytes,
      raw,
      compareCounts,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const PROCESS_VALIDATORS: readonly Validator[] = Object.freeze([
  host,
  probe,
  environment,
  argv,
  state,
  exitcode,
  run,
  stdout,
  stderr,
  file,
  kind,
  contents,
  size,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function processValidators(): Validator[] {
  return [...PROCESS_VALIDATORS];
}
