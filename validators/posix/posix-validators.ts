/**
 * The `posix.*` validator family - the vocabulary an acceptance criterion uses to judge a POSIX-like
 * system.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`PosixObservationData`) and never opens a file, never runs a
 * program, never touches the sandbox tree and never sees an adapter. That is why the vocabulary lives
 * in `core/environment/posix-observation.ts` rather than beside the substitute: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know whether the system was real, a container, or
 * substituted - it can be tested with no world running at all, and it can be re-read from a bundle a
 * year later with nothing installed.
 *
 * The names are therefore `posix.*` and not `sim-posix.*`. The criterion is about the system, not about
 * what stood in for it, and the substitution *is* recorded - in the reading's own `simulated` field -
 * because a verdict reached against a substitute has to say so where the verdict is, not in the name
 * of the vocabularly that reached it.
 *
 * ## The action record and the state record
 *
 * A system reading keeps *what was executed* apart from *what the system holds*, and the family mirrors
 * that split rather than collapsing it, because the two answer different questions with different
 * repairs:
 *
 * - `posix.ran` and `posix.probe` read `execs` - what a program did, and how it ended. A file that was
 *   already in the base image is not evidence that this run's provisioning created it; a command that
 *   was refused and one that exited non-zero are different defects with different repairs.
 * - `posix.file`, `posix.permission`, `posix.owner`, `posix.contents`, `posix.user`, `posix.package`,
 *   `posix.service`, `posix.running` and `posix.port` read state - what the world holds.
 * - `posix.installed` reads the *provenance* of a state fact, which is the one question neither record
 *   answers alone: a package present on the host is not evidence that this run installed it.
 *
 * `posix.ran` and `posix.probe` are separate validators rather than one with a qualifier, because the
 * two read different sources and only one of them is evidence about the application. A criterion's own
 * probe says what the world did *to the criterion* - which is how a containment contract asserts that
 * the world refuses a command that climbs out of the sandbox - and a contract that could confuse the
 * two could pass a run on the strength of its own questions.
 *
 * ## Status discipline
 *
 * The same branches as the other families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the world*: an absent file, a mode
 *   that is not the one declared, a service that is not running, a command that exited non-zero.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at: a path the reading does not hold,
 *   a program the world never ran, a file whose contents the reading declined to read, a port whose
 *   open state the reading did not confirm.
 * - `ERROR` - the *criterion* is unusable (a target that is not a sandbox path, a port that is not a
 *   number, a comparison against the wrong vocabulary) or the world arrived unreadable. Never
 *   `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * ## The three guards this world needs beyond the other families
 *
 * - **A target that is not a sandbox path is refused rather than repaired.** A path is written as the
 *   sandbox spells it (`/etc/veridian/app.conf`), so a Windows spelling is an `ERROR` and not a silent
 *   rewrite - a criterion that only worked on the operator's laptop would otherwise report the
 *   application as broken.
 * - **A fact the reading disowns is not judged.** `PosixFileReading.textWithheld` names why the
 *   contents are absent, and a validator that treated that as an empty file would report a defect in
 *   the application that nobody observed. `PosixPortReading.verified` is the same shape one field over:
 *   a port the reading *claims* is listening without having reached a socket is not an observation, and
 *   no comparison is judged against it. (`state: "closed"` needs no such flag: `closed` *is* the record
 *   of knocking and getting no answer, which is the observation itself.)
 * - **Canonicalisation is the operator's spelling, not the world's.** `posixPath` collapses a trailing
 *   or repeated slash, so `/etc//veridian/` and `/etc/veridian` name the same file - which they are,
 *   and a criterion that failed on the difference would be reporting a spelling as a defect.
 *
 * ## What this family deliberately does not judge
 *
 * Recorded rather than left implied, because a gap nobody wrote down is discovered as a bug:
 *
 * - a file's `kind` (`file` / `directory` / `symlink`), its `bytes` and its `sha256` digest;
 * - a user's `uid`, `gid`, `shell`, `home` and `groups`;
 * - a package's `version`, and the difference between "never installed" and "installed and then
 *   removed" - both read as `absent`, which is a true answer to the question `posix.package` asks and
 *   is not an answer to any other;
 * - a service's `enabled` flag and its `pid`;
 * - a port's `address` and its `protocol`;
 * - a command's `stdout`, `stderr`, `exitCode` and `durationMs` - `posix.ran` judges how a program
 *   ended, and a contract that wanted to grep its output has no validator for that;
 * - the world's own identity: `host`, `distribution` and `root`.
 *
 * Each of these is a determinate fact the reading already carries, so adding one is a small change to
 * this file. None of them is added speculatively: a validator nothing asks for is a verdict nothing
 * needs, and every one of them would need its own tests before it could be trusted.
 */

import {
  POSIX_EXEC_RESULTS,
  POSIX_EXEC_SOURCES,
  POSIX_OBSERVATION_KIND,
  POSIX_PORT_STATES,
  POSIX_SERVICE_STATUSES,
  execsOf,
  fileAt,
  isPosixObservationData,
  packageNamed,
  portAt,
  posixPath,
  serviceNamed,
  userNamed,
} from "../../core/environment/posix-observation.ts";
import type {
  PosixExecRecord,
  PosixExecSource,
  PosixFileReading,
  PosixObservationData,
  PosixPackageReading,
} from "../../core/environment/posix-observation.ts";
import type { ComparisonKey } from "../../core/acceptance/plan.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  comparePresence,
  compareText,
  compareWord,
  describe,
  judge,
  notDeclared,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { ComparisonOutcome } from "../../core/validation/assertions.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `posix.textWithheld` is not merely
 * unconventional - it is an acceptance contract that cannot be written at all.
 */
export const POSIX_VALIDATOR_NAMES = {
  file: "posix.file",
  permission: "posix.permission",
  owner: "posix.owner",
  contents: "posix.contents",
  user: "posix.user",
  package: "posix.package",
  installed: "posix.installed",
  service: "posix.service",
  running: "posix.running",
  port: "posix.port",
  ran: "posix.ran",
  probe: "posix.probe",
} as const;

// ---- reading the document ------------------------------------------------------------------------

const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" && value !== null && "status" in value;

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): PosixObservationData | AssertionResult {
  if (isPosixObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a system document, so ` +
      "there is nothing to read. The adapter produced the reading, so this is a defect in the " +
      "environment rather than a system the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * A path as the *sandbox* spells it, canonicalised, or an answer saying why it cannot be used.
 *
 * A path that is not absolute, or that carries a `\`, is refused rather than repaired. Silently
 * rewriting a Windows path would let an operator write a criterion that works only on their laptop,
 * and the failure would surface as a `FAIL` against the application.
 */
function sandboxPath(validator: string, target: string | null): string | AssertionResult {
  if (target === null) return noTarget(validator, "a file path, written as the sandbox spells it");
  if (target.includes("\\")) {
    return unusable(
      validator,
      target,
      `A path in this world is written with forward slashes, and it received ${quote(target)}. ` +
        "Rewriting it silently would let a criterion pass on one operator's machine and report the " +
        "application as broken on another, so it is refused instead.",
    );
  }
  const path = posixPath(target);
  if (path === null) {
    return unusable(
      validator,
      target,
      `A path in this world is absolute, written from the sandbox root - \`/etc/veridian/app.conf\` - ` +
        `and it received ${quote(target)}.`,
    );
  }
  return path;
}

/** A port number, written as a string because that is what a target is. */
function portNumber(validator: string, target: string | null): number | AssertionResult {
  if (target === null) return noTarget(validator, "a port number");
  if (!/^\d+$/.test(target)) {
    return unusable(
      validator,
      target,
      `A port is written as a number, and it received ${quote(target)}. A target that is not a ` +
        "number would otherwise be reported as a port the world is not listening on, which is a " +
        "failure to parse a contract being told as a failure of the application.",
    );
  }
  return Number(target);
}

// ---- comparisons against a closed vocabulary ------------------------------------------------------

const compareInstaller = compareWord(POSIX_EXEC_SOURCES, "who installed a package");
const compareServiceStatus = compareWord(POSIX_SERVICE_STATUSES, "a service status");
const comparePortState = compareWord(POSIX_PORT_STATES, "a port's state");
const compareExecResult = compareWord(POSIX_EXEC_RESULTS, "the result of a command");

// ---- the shared "the reading does not hold this" branch -------------------------------------------

/**
 * The file at a canonical path, or the branch that says the world does not hold one.
 *
 * `INCONCLUSIVE` rather than `FAIL`, and it hands the presence question to the validator that owns it
 * - which is the same shape `k8s.image` uses when it finds no deployment. "The file is not there" and
 * "the mode is wrong" are different defects, and only one of them is worth repairing the contents for.
 */
function fileReading(
  validator: string,
  path: string,
  document: PosixObservationData,
  what: string,
): PosixFileReading | AssertionResult {
  const found = fileAt(document, path);
  if (found !== null) return found;
  return unanswered(
    validator,
    path,
    `The reading holds no ${what} at ${quote(path)}, so there is nothing to read. Whether the file ` +
      `should exist is the question ` +
      `${quote(POSIX_VALIDATOR_NAMES.file)} answers; this validator can only report that there was ` +
      "nothing to measure. The path is matched exactly, as a name rather than a pattern, after the " +
      "operator's spelling has been canonicalised.",
  );
}

/**
 * A package the world holds *and* records as installed, or `null`.
 *
 * Written once and read by `posix.package`, because the distinction it makes is the one that turns a
 * false pass into a true answer: the world keeps a removed package in the same list, and only the
 * status separates "installed" from "was installed and is not any more".
 */
function installedPackage(document: PosixObservationData, name: string): PosixPackageReading | null {
  const found = packageNamed(document, name);
  return found !== null && found.status === "installed" ? found : null;
}

// ---- the family -----------------------------------------------------------------------------------

/**
 * Whether an inode record exists at a path.
 *
 * The most-asked question in the family and the one that decides whether any of the others can be
 * asked at all: a contract checking a mode, an owner or a contents almost always wants the file to
 * exist first, and a criterion that only checked the mode would report `INCONCLUSIVE` on a missing
 * file - correct, and less useful than the sentence "the file is not there".
 */
const file: Validator = {
  name: POSIX_VALIDATOR_NAMES.file,
  needsTarget: true,
  targetNoun: "file path, written as the sandbox spells it (`/etc/veridian/app.conf`)",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, file.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(file.name, targetOf(raw));
    if (isAssertion(path)) return path;
    return judge(
      file.name,
      path,
      `the file ${quote(path)} in the sandbox`,
      fileAt(document, path) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * The mode bits at a path.
 *
 * Compared as text rather than as a number, because there is no number: the reading records canonical
 * four-digit octal (`"0600"`, `"0755"`), and `644` as a criterion would be ambiguous between octal and
 * decimal the moment anything looked at it. `equals: "0600"` is a sentence with one reading.
 *
 * What this validator reports is the *mode*, and nothing more. Whether the account the criteria act as
 * can actually read the file is a different question - a `0600` file is readable by its owner - and the
 * answer to it is in the `owner` field, which is why `posix.owner` exists beside this one rather than
 * being folded into it.
 */
const permission: Validator = {
  name: POSIX_VALIDATOR_NAMES.permission,
  needsTarget: true,
  targetNoun: "file path, written as the sandbox spells it (`/etc/veridian/app.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, permission.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(permission.name, targetOf(raw));
    if (isAssertion(path)) return path;
    const found = fileReading(permission.name, path, document, "file");
    if (isAssertion(found)) return found;
    return judge(
      permission.name,
      path,
      `the mode of ${quote(path)}`,
      found.mode,
      raw,
      compareText,
    );
  },
};

/**
 * The account that owns a path.
 *
 * Beside `posix.permission` rather than merged with it, because a hardening contract asks both and the
 * two failures have different repairs: a mode that is too open is a `chmod`, and an owner that is not
 * the service account is a `chown`. A validator that judged "the file is owned by `app` and is `0600`"
 * as one comparison would report one defect where there are two.
 */
const owner: Validator = {
  name: POSIX_VALIDATOR_NAMES.owner,
  needsTarget: true,
  targetNoun: "file path, written as the sandbox spells it (`/etc/veridian/app.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, owner.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(owner.name, targetOf(raw));
    if (isAssertion(path)) return path;
    const found = fileReading(owner.name, path, document, "file");
    if (isAssertion(found)) return found;
    return judge(owner.name, path, `the owner of ${quote(path)}`, found.owner, raw, compareText);
  },
};

/**
 * The text a file held when the world read it.
 *
 * The contents are *in* the reading rather than behind a path, on purpose: a bundle that recorded a
 * path and a promise to open it would be evidence of nothing after the next reset, while a bundle that
 * recorded the bytes is evidence a year later with the file long gone.
 *
 * The `textWithheld` branch is the one that keeps this honest. The reading declines to carry contents
 * that are binary or too large, and names why - and a validator that compared the criterion against an
 * empty string would report a defect in the application that nobody observed. So a withheld text is
 * `INCONCLUSIVE`, naming the reason the reading gave.
 */
const contents: Validator = {
  name: POSIX_VALIDATOR_NAMES.contents,
  needsTarget: true,
  targetNoun: "file path, written as the sandbox spells it (`/etc/veridian/app.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, contents.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(contents.name, targetOf(raw));
    if (isAssertion(path)) return path;
    const found = fileReading(contents.name, path, document, "file");
    if (isAssertion(found)) return found;
    const text = found.text;
    if (text === null) {
      return unanswered(
        contents.name,
        path,
        `The reading holds ${quote(path)} but did not carry its contents: ` +
          `${found.textWithheld ?? "the reading recorded no reason"}. A validator may not open a file - ` +
          "the reading is all it has - so there is nothing to compare, and judging against an empty " +
          "file would report a defect in the application that nobody observed.",
      );
    }
    return judge(contents.name, path, `the contents of ${quote(path)}`, text, raw, compareText);
  },
};

/** Whether the world holds an account by a name. */
const user: Validator = {
  name: POSIX_VALIDATOR_NAMES.user,
  needsTarget: true,
  targetNoun: "account name",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, user.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(user.name, "an account name");
    return judge(
      user.name,
      target,
      `the account ${quote(target)}`,
      userNamed(document, target) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * Whether a package is installed.
 *
 * ## Presence is not membership in the database
 *
 * The world keeps a package it has removed in its database, with `status: "removed"`, exactly as a
 * real package manager does - and that is the detail this validator exists to get right. A presence
 * test over the list would find it and report `PASS`, which is a false pass of the shape the whole
 * product refuses: the criterion said the package is installed, the world had just removed it, and the
 * reading held both facts in one record. So the status is read, through the closed
 * {@link POSIX_PACKAGE_STATUSES} vocabulary, and `present` means *installed* rather than *mentioned*.
 *
 * The other half of the question - "the application installed `ufw`" - is not this validator's, and
 * cannot be: a package in the base image is installed without this run having done anything.
 * {@link POSIX_VALIDATOR_NAMES.installed} reads the provenance, and a contract that wants both facts
 * states both.
 *
 * A gap, recorded rather than papered over: `absent` covers "never installed" and "installed and then
 * removed" alike. Both are true answers to the question this validator asks - neither is installed -
 * and the difference is not currently assertable at all. Synthesizing a status for it would be a fact
 * nothing observed.
 */
const packageValidator: Validator = {
  name: POSIX_VALIDATOR_NAMES.package,
  needsTarget: true,
  targetNoun: "package name",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, packageValidator.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(packageValidator.name, "a package name");
    return judge(
      packageValidator.name,
      target,
      `the package ${quote(target)} in the world's package database`,
      installedPackage(document, target) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * Who put a package there.
 *
 * The provenance question, and the one that closes the false pass this family would otherwise leave
 * open. A base image that already held `openssl` is not evidence that this run's provisioning
 * installed anything, and a contract that only checked presence could pass a run whose install step
 * did nothing at all. This is the same distinction `k8s.applied` draws between "a resource exists" and
 * "this run submitted it".
 *
 * The vocabulary is the reading's own `POSIX_EXEC_SOURCES`: `application` for a package the run's own
 * provisioning installed, `world` for one the base image held, `criterion` for one a criterion
 * installed while probing. A package the reading does not hold is `INCONCLUSIVE` naming
 * `posix.package`, because "installed by nobody" and "the world has never heard of it" are different
 * facts.
 *
 * What this validator does **not** say is that the package is still installed. A package the world
 * removed still has a provenance, and reporting it is correct - but a contract that means "this run
 * installed it, and it is there" has two clauses and states both, with `posix.package` carrying the
 * other one.
 */
const installed: Validator = {
  name: POSIX_VALIDATOR_NAMES.installed,
  needsTarget: true,
  targetNoun: "package name",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, installed.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(installed.name, "a package name");
    const found = packageNamed(document, target);
    if (found === null) {
      return unanswered(
        installed.name,
        target,
        `The world's package database holds no ${quote(target)}, so there is no provenance to read. ` +
          `Whether it should be installed at all is the question ${quote(POSIX_VALIDATOR_NAMES.package)} ` +
          "answers; this validator can only report who put a package there when there is one.",
      );
    }
    return judge(
      installed.name,
      target,
      `who installed ${quote(target)}`,
      found.installedBy,
      raw,
      compareInstaller,
    );
  },
};

/** Whether the world holds a unit by a name. */
const service: Validator = {
  name: POSIX_VALIDATOR_NAMES.service,
  needsTarget: true,
  targetNoun: "unit name",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, service.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(service.name, "a unit name");
    return judge(
      service.name,
      target,
      `the unit ${quote(target)}`,
      serviceNamed(document, target) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * Whether a unit is running.
 *
 * Split from `posix.service` rather than folded into it, because the two answers are different facts
 * with different repairs - "the unit was never created" is a missing file and "the unit exists and is
 * stopped" is a service that failed to start - and because a reading holds units that were never
 * started, with `stopped` as their status. A unit the reading does not hold at all is `INCONCLUSIVE`
 * naming `posix.service`, since this validator cannot tell a missing unit from a stopped one, and
 * reporting the first as `FAIL` on this criterion would accuse the application of a defect the world
 * does not have the facts to support.
 */
const running: Validator = {
  name: POSIX_VALIDATOR_NAMES.running,
  needsTarget: true,
  targetNoun: "unit name",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, running.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(running.name, "a unit name");
    const found = serviceNamed(document, target);
    if (found === null) {
      return unanswered(
        running.name,
        target,
        `The world holds no unit ${quote(target)}, so there is no status to read. Whether the unit ` +
          `should exist is the question ${quote(POSIX_VALIDATOR_NAMES.service)} answers; this ` +
          "validator can only report whether an existing unit is running, and a unit that is not " +
          "there is not a unit that is stopped.",
      );
    }
    return judge(
      running.name,
      target,
      `the status of the unit ${quote(target)}`,
      found.status,
      raw,
      compareServiceStatus,
    );
  },
};

/**
 * Whether a port answers.
 *
 * ## The one place this family refuses a fact the reading stated
 *
 * `verified` is the reading telling the criterion how strong its own claim is: `true` only when the
 * world really bound a socket and really reached it. A port recorded as `listening` with
 * `verified: false` is a table entry rather than an observation, and no comparison is judged against
 * it - `INCONCLUSIVE` either way, because an unconfirmed listening claim does not falsify a criterion
 * that expected `closed` any more than it satisfies one that expected `listening`. This is the rule
 * the whole product is built on: a verdict a substitution cannot justify must not be reported.
 *
 * `state: "closed"` needs no such guard, and deliberately: `closed` *is* the record of knocking and
 * getting no answer, which is the observation rather than a promise of one. Reading `verified` as
 * "the port is open" and refusing every `false` would have made half this validator's vocabulary
 * unwritable, which is the shape of a rule invented rather than derived.
 *
 * Reachability: no adapter in this repository produces `listening` with `verified: false` - it is a
 * property of the *reading vocabulary*, which any producer of `posix` observations may fill in, and
 * this validator is a function over a document. The test suite supplies such a document, which is what
 * makes this branch a guard rather than a sentence.
 */
const port: Validator = {
  name: POSIX_VALIDATOR_NAMES.port,
  needsTarget: true,
  targetNoun: "port number",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, port.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const number = portNumber(port.name, target);
    if (isAssertion(number)) return number;
    const found = portAt(document, number);
    if (found === null) {
      return unanswered(
        port.name,
        target,
        `The reading holds no entry for port ${number}, so nothing declared it and nothing bound it. ` +
          "A port the world never heard of and a port that is closed are different facts, and only " +
          "the second is one this validator can report.",
      );
    }
    if (found.state === "listening" && !found.verified) {
      return unanswered(
        port.name,
        target,
        `The reading records port ${number} as listening but did not reach a socket, so the claim is ` +
          "a table entry rather than an observation. This criterion is judged by what the world " +
          "measured, and a state the reading disowns is not a measurement.",
      );
    }
    return judge(
      port.name,
      target,
      `the state of port ${number}`,
      found.state,
      raw,
      comparePortState,
    );
  },
};

// ---- the action record ----------------------------------------------------------------------------

/**
 * The newest execution of a program by one source, or the branch that says there is none.
 *
 * The **newest** is judged, for the same reason `k8s.applied` judges the newest submission: the record
 * is a chronological log, and a program the world refused on an early iteration and completed after a
 * repair is a program that works now. The reading is per-observation, so the earlier iteration's
 * record is judged by the earlier iteration's criterion.
 *
 * A program the world never ran at all, and a program only ever run by somebody else, are reported as
 * different facts: the first is an absence of a record, the second is a record that is not evidence
 * about the application - and naming which one it is sends the reader somewhere different.
 */
function execBy(
  validator: string,
  target: string,
  document: PosixObservationData,
  source: PosixExecSource,
  other: readonly [name: string, described: string],
): PosixExecRecord | AssertionResult {
  const all = execsOf(document, target);
  if (all.length === 0) {
    return unanswered(
      validator,
      target,
      `The world recorded no execution of ${quote(target)} at all, so there is nothing to judge. ` +
        "This is the absence of a record rather than a command that failed: a command that ran and " +
        "exited non-zero is judged here, and so is a command the world refused.",
    );
  }
  const mine = all.filter((record) => record.source === source);
  const last = mine[mine.length - 1];
  if (last === undefined) {
    const issued = [...new Set(all.map((record) => record.source))].join(", ");
    return unanswered(
      validator,
      target,
      `Every recorded execution of ${quote(target)} was issued by ${issued}, and this validator reads ` +
        `only the executions issued by ${source}. Those are different questions with different ` +
        `validators - ${quote(other[0])} is the one that reads the executions issued by ${other[1]} - ` +
        "and a criterion's own command is not evidence about the application.",
    );
  }
  return last;
}

/**
 * How the application's own invocation of a program ended.
 *
 * The reader of provisioning: an install step, a hardening script, a service start. `completed` is the
 * pass, and the three other results are different repairs - `nonzero` is the program's own defect,
 * `refused` is the world declining to run it (a package the index does not hold, a command that climbs
 * out of the sandbox), and `timed-out` is the boundary doing its job.
 *
 * The target is the program **as the caller named it**, not `argv[0]`, because the world resolves
 * `argv[0]` to the substitute it ran - and keying on that would make this validator unfindable for
 * exactly the commands the world substituted, which are the ones a criterion is most likely to ask
 * about.
 */
const ran: Validator = {
  name: POSIX_VALIDATOR_NAMES.ran,
  needsTarget: true,
  targetNoun: "program name, as the caller named it",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, ran.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(ran.name, "a program name");
    const found = execBy(ran.name, target, document, "application", [
      POSIX_VALIDATOR_NAMES.probe,
      "the criterion",
    ]);
    if (isAssertion(found)) return found;
    return judge(
      ran.name,
      target,
      `the result of the newest execution of ${quote(target)} by the application`,
      found.result,
      raw,
      compareExecResult,
    );
  },
};

/**
 * How the criterion's *own* invocation of a program ended.
 *
 * A separate validator, not a qualifier on `posix.ran`, and the separation is the point: a criterion
 * that ran a command is asking what the *world* did, not what the application did. The contract this
 * exists for is containment - a criterion that runs `cat ../../etc/shadow` and asserts
 * `equals: "refused"`, which is the only way a contract can state that the sandbox guard held. Judging
 * that through `posix.ran` would let a run pass on the strength of the run's own questions, which is
 * the false pass this whole product exists to refuse.
 */
const probe: Validator = {
  name: POSIX_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "program name, as the criterion named it",
  comparisons: ["equals"],
  observationKind: POSIX_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(probe.name, "a program name");
    const found = execBy(probe.name, target, document, "criterion", [
      POSIX_VALIDATOR_NAMES.ran,
      "the application",
    ]);
    if (isAssertion(found)) return found;
    return judge(
      probe.name,
      target,
      `the result of the newest execution of ${quote(target)} by the criterion`,
      found.result,
      raw,
      compareExecResult,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const POSIX_VALIDATORS: readonly Validator[] = Object.freeze([
  file,
  permission,
  owner,
  contents,
  user,
  packageValidator,
  installed,
  service,
  running,
  port,
  ran,
  probe,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function posixValidators(): Validator[] {
  return [...POSIX_VALIDATORS];
}
