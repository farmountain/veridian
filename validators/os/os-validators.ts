/**
 * The `os.*` validator family - the vocabulary an acceptance criterion uses to judge a Windows or
 * macOS system.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`OsObservationData`) and never opens a file, never runs a program,
 * never touches the sandbox tree and never sees an adapter. That is why the vocabulary lives in
 * `core/environment/os-observation.ts` rather than beside the substitute: `validators/*` may not import
 * `adapters/*`, so a validator here cannot know whether the system was real, a virtual machine, or
 * substituted - it can be tested with no world running at all, and re-read from a bundle a year later
 * with nothing installed.
 *
 * The names are therefore `os.*` and not `sim-os.*`. The criterion is about the system, not about what
 * stood in for it, and the substitution *is* recorded - in the reading's own `simulated` field -
 * because a verdict reached against a substitute has to say so where the verdict is, not in the name of
 * the vocabulary that reached it.
 *
 * ## The two records, and the three questions about one file
 *
 * The action record (`execs`) is kept apart from the state record (everything else), as it is in the
 * POSIX family, because the two answer different questions with different repairs: `os.ran` is about
 * what the application's provisioning *did*, and a file already in the sandbox is not evidence that
 * this run's provisioning created it.
 *
 * The state questions are split three ways on purpose, and the split is the family's centre:
 *
 * - `os.owner` reads the **owning account** - a fact about who holds the object.
 * - `os.acl` reads the **entries written on it** - what was granted, to whom, and whether each grant
 *   was explicit or inherited.
 * - `os.access` reads the **decision that follows** - what one named account may actually do, which is
 *   the answer to the ordering rules and not a sum of the entries.
 *
 * They are three validators rather than one because they are three facts with three repairs. An owner
 * that is wrong is a `chown`; an entry that should not be there is an `icacls /remove` or a
 * `defaults`-scoped policy change; and access that is too broad when every entry looks correct is an
 * *inheritance* defect, which is a different place in the document and a different fix. A single
 * validator judging "the file is owned by `cart` and `cart` may read it and nobody else may" would
 * report one defect where there are three - and on Windows it would report a `chown` for a system that
 * expresses the same intent as an ACL.
 *
 * `os.access` judges the world's decision, never a re-derivation of it. The ordering rules - explicit
 * beats inherited, deny beats allow, groups are consulted, `Everyone` last, nothing matched is a
 * refusal - are exactly the part of a real system that is easy to model *almost* correctly, and a
 * model that is almost correct produces a confident wrong answer. So the world decides, records the
 * decision *and the entry that fired*, and this family judges the decision. `os.acl` is what a reader
 * opens when the decision is not the one they wanted.
 *
 * ## Status discipline
 *
 * The same branches as the other families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the world*: an absent path, an
 *   account that was never created, a service that is not running, a command that exited non-zero.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at: a path the reading does not hold,
 *   a security record for a file the world found but never governed, a text the reading declined to
 *   carry, a program this run never ran, a service definition the world could not read an account out
 *   of.
 * - `ERROR` - the *criterion* is unusable (a target that is not a path as this family spells it, a
 *   malformed `<account>:<path>` reference, a comparison against the wrong vocabulary) or the world
 *   arrived unreadable. Never `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * ## The guards this world needs beyond the other families
 *
 * - **A target is validated by the family's own resolver, and its refusal is quoted.** `resolveOsPath`,
 *   `resolveAclRef` and `resolveSettingContainer` know *why* a target cannot be used - a forward slash
 *   on Windows, a relative path, a `..` segment, `HKCU` - and they return that reason with the refusal
 *   rather than `null`. This family quotes the reason verbatim instead of writing one message covering
 *   every possible cause, because a message that names a cause its reporter did not observe is the
 *   defect this repository has already paid for twice.
 * - **A fact the reading disowns is not judged.** `OsFileReading.textWithheld` names why the contents
 *   are absent, and a validator that treated that as an empty file would report a defect nobody
 *   observed. `OsServiceReading.account` is empty when the world could not read one out of a service
 *   definition, and `os.principal` reports `INCONCLUSIVE` rather than judging the empty string. And a
 *   security record the world does not hold is not an empty ACL: `aclAt` returns `null`, and a path the
 *   tree walk found but the world never governed is `INCONCLUSIVE`, because "nothing was granted" and
 *   "nobody wrote down what was granted" are different facts.
 * - **`"none"` is a decision; `null` is a gap.** `permissionsOf` returns `"none"` when the world
 *   refused every permission - a fact, judged - and `null` when no decision was recorded, which is a
 *   gap in the reading and is `INCONCLUSIVE`. Collapsing the two would turn an unrecorded decision into
 *   a confident "this account may do nothing".
 * - **Case folding is the family's, not the operator's.** `fileOn` and `aclAt` fold when the reading
 *   says the family's volumes fold, so `C:\ProgramData\Veridian` and `c:\programdata\veridian` name one
 *   directory - which they are - while a path that differs beyond case on a case-sensitive family is a
 *   different path, and the reading records which world it is.
 *
 * ## What this family deliberately does not judge
 *
 * Recorded rather than left implied, because a gap nobody wrote down is discovered as a bug:
 *
 * - a file's `kind` (`file` / `directory` / `symlink`), its `bytes` and its `sha256` digest;
 * - an account's `home`, its `groups` and its `kind` - `os.account` answers *whether* an account
 *   exists, and a contract that means "and it is an ordinary user rather than a service account" has
 *   no validator for that yet;
 * - who created an account or wrote a setting (`createdBy`, `writtenBy`) - the analogue of
 *   `posix.installed`, and the provenance question this family does not answer;
 * - a service's `enabled` flag, its `pid` and its `command`;
 * - the `port` a service's command line asked for - a service that declared a port and could not be
 *   reached at it reports `failed`, which is the fact a contract actually wants, and the number itself
 *   is not assertable;
 * - the world's own identity: `host`, `family`, `system`, `root`, `user`, `caseSensitive` and
 *   `simulated`;
 * - a command's `stdout`, `stderr`, `exitCode` and `durationMs` - `os.ran` judges how a program ended,
 *   and a contract that wanted to grep its output has no validator for that;
 * - a container's values keyed individually: `os.setting` judges the container rendered as
 *   `name=value` lines, so "this key holds exactly one autostart entry" is a sentence and "the value
 *   named `Autostart` equals X" is a `contains` against the rendering rather than a field read.
 *
 * Each of these is a determinate fact the reading already carries, so adding one is a small change to
 * this file. None is added speculatively: a validator nothing asks for is a verdict nothing needs, and
 * every one of them would need its own tests before it could be trusted.
 */

import {
  OS_EXEC_RESULTS,
  OS_OBSERVATION_KIND,
  OS_SERVICE_STATUSES,
  aclAt,
  accountNamed,
  execsOf,
  fileOn,
  isOsObservationData,
  permissionsOf,
  resolveAclRef,
  resolveOsPath,
  resolveSettingContainer,
  serviceNamed,
  settingValues,
  settingsIn,
} from "../../core/environment/os-observation.ts";
import type {
  OsAclReading,
  OsExecRecord,
  OsExecSource,
  OsFileReading,
  OsObservationData,
} from "../../core/environment/os-observation.ts";
import type { ComparisonKey } from "../../core/acceptance/plan.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  comparePresence,
  compareText,
  compareWord,
  judge,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `os.ACL` is not merely unconventional - it
 * is an acceptance contract that cannot be written at all.
 */
export const OS_VALIDATOR_NAMES = {
  file: "os.file",
  contents: "os.contents",
  owner: "os.owner",
  access: "os.access",
  acl: "os.acl",
  account: "os.account",
  setting: "os.setting",
  service: "os.service",
  running: "os.running",
  principal: "os.principal",
  ran: "os.ran",
  probe: "os.probe",
} as const;

// ---- reading the document ------------------------------------------------------------------------

const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" && value !== null && "status" in value;

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): OsObservationData | AssertionResult {
  if (isOsObservationData(observation.data)) return observation.data;
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
 * A path as the *family* spells it, or an answer quoting the resolver's own reason for refusing it.
 *
 * The reason is quoted rather than summarized, and that is the improvement
 * `core/environment/os-observation.ts` records in its own documentation: where a resolver returns
 * `null` the validator has to invent a message covering every cause it might have been, and the
 * invented message sends the reader to inspect whatever the author happened to think of. Here the
 * resolver is the thing that knows, so its words are the ones a reader gets.
 */
function sandboxPath(
  validator: string,
  document: OsObservationData,
  target: string | null,
): string | AssertionResult {
  if (target === null) {
    return noTarget(validator, "a path, written as this family spells it");
  }
  const resolved = resolveOsPath(document.family, target);
  if (resolved.kind === "refused") return unusable(validator, target, resolved.reason);
  return resolved.value;
}

/** The `<account>:<path>` reference `os.access` targets, or the resolver's reason for refusing it. */
function aclReference(
  validator: string,
  document: OsObservationData,
  target: string | null,
): { readonly account: string; readonly path: string } | AssertionResult {
  if (target === null) {
    return noTarget(validator, "an `<account>:<path>` reference");
  }
  const resolved = resolveAclRef(document.family, target);
  if (resolved.kind === "refused") return unusable(validator, target, resolved.reason);
  return resolved.value;
}

/** The store container `os.setting` targets, or the resolver's reason for refusing it. */
function storeContainer(
  validator: string,
  document: OsObservationData,
  target: string | null,
): string | AssertionResult {
  if (target === null) {
    return noTarget(validator, "a configuration store container");
  }
  const resolved = resolveSettingContainer(document.family, target);
  if (resolved.kind === "refused") return unusable(validator, target, resolved.reason);
  return resolved.value;
}

// ---- comparisons against a closed vocabulary ------------------------------------------------------

const compareServiceStatus = compareWord(OS_SERVICE_STATUSES, "a service status");
const compareExecResult = compareWord(OS_EXEC_RESULTS, "the result of a command");

// ---- the shared "the reading does not hold this" branch -------------------------------------------

/**
 * The file at a canonical path, or the branch that says the world does not hold one.
 *
 * `INCONCLUSIVE` rather than `FAIL`, and it hands the presence question to the validator that owns it.
 * "There is no file here" and "this file's owner is wrong" are different defects, and only one of them
 * is worth repairing the ownership of.
 */
function fileReading(
  validator: string,
  path: string,
  document: OsObservationData,
  what: string,
): OsFileReading | AssertionResult {
  const found = fileOn(document, path);
  if (found !== null) return found;
  return unanswered(
    validator,
    path,
    `The reading holds no ${what} at ${quote(path)}, so there is nothing to read. Whether the path ` +
      `should exist at all is the question ${quote(OS_VALIDATOR_NAMES.file)} answers; this validator ` +
      "can only report that there was nothing to measure. The path is matched exactly, as a name rather " +
      "than a pattern" +
      (document.caseSensitive
        ? ", and this system's volumes do not fold case."
        : ", folded to lower case because this system's volumes fold case."),
  );
}

/**
 * The security record at a canonical path, or the branch that says the world holds none.
 *
 * Distinct from "the path is not there", and the distinction is the point of returning an assertion
 * rather than an empty record: the tree walk finds files the world never governed - a file the
 * application wrote directly onto the sandbox - and reporting that as "nothing is permitted on this
 * file" would be a confident answer where the truth is that nobody wrote the permissions down.
 */
function aclReading(
  validator: string,
  path: string,
  document: OsObservationData,
): OsAclReading | AssertionResult {
  const found = aclAt(document, path);
  if (found !== null) return found;
  return unanswered(
    validator,
    path,
    `The reading holds ${quote(path)} among its files but holds no security record for it, so there ` +
      "is nothing to read. This is not an empty access control list: an empty list is a file nobody " +
      "was granted anything on, and this is a file whose permissions the world never recorded - a " +
      "different fact, with a different repair.",
  );
}

/**
 * One security record's entries, rendered one per line, sorted.
 *
 * Renderings rather than a list, for the same reason `settingValues` renders a container: the
 * interesting questions about a security record are about the record *as a whole* - "is there any
 * explicit deny here", "is everything on this file inherited", "was `Everyone` granted anything" - and
 * a criterion that could only ask about one entry at a time could ask none of them.
 *
 * The shape is chosen to be targetable by `contains`: `account:permission:allow|deny`, with
 * `:inherited` appended when the entry came from a parent. So `contains: "Everyone:read:allow"` is the
 * sentence "anyone at all may read this", and `contains: ":deny"` is "something here is explicitly
 * denied". An inherited `allow` reads differently from an explicit one, which is exactly the
 * distinction a hardening contract keeps getting wrong.
 */
function renderAcl(record: OsAclReading): string {
  return [...record.entries]
    .sort((left, right) => {
      const byAccount = left.account.toLowerCase().localeCompare(right.account.toLowerCase());
      return byAccount !== 0 ? byAccount : left.permission.localeCompare(right.permission);
    })
    .map(
      (entry) =>
        `${entry.account}:${entry.permission}:${entry.allow ? "allow" : "deny"}` +
        (entry.inherited ? ":inherited" : ""),
    )
    .join("\n");
}

// ---- the family -----------------------------------------------------------------------------------

/**
 * Whether the world holds anything at a path.
 *
 * The most-asked question in the family and the one that decides whether any of the others can be
 * asked at all: a contract checking contents, an owner or an access decision almost always wants the
 * path to exist first, and a criterion that only checked the owner would report `INCONCLUSIVE` on an
 * absent path - correct, and less useful than the sentence "there is nothing there".
 *
 * A directory is held by the same reading as a file, so this answers "is there something at this path"
 * and says nothing about what kind of thing it is. That is deliberate and it is why `kind` is on the
 * gap list above: a criterion that means "this is a directory" currently has to say it through
 * `os.contents` coming back unusable, which is a worse sentence than a comparison would be.
 */
const file: Validator = {
  name: OS_VALIDATOR_NAMES.file,
  needsTarget: true,
  targetNoun: "path, written as this family spells it (`C:\\ProgramData\\Veridian\\policy.conf`)",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, file.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(file.name, document, targetOf(raw));
    if (isAssertion(path)) return path;
    return judge(
      file.name,
      path,
      `something at ${quote(path)} on the sandbox`,
      fileOn(document, path) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * The text a file held when the world read it.
 *
 * The contents are *in* the reading rather than behind a path, on purpose: a bundle that recorded a
 * path and a promise to open it would be evidence of nothing after the next reset, while a bundle that
 * recorded the text is evidence a year later with the file long gone.
 *
 * The `textWithheld` branch is the one that keeps this honest. The reading declines to carry contents
 * that are binary, that name a directory, that name a symbolic link, or that exceed the world's bound,
 * and it names which - and a validator that compared the criterion against an empty string would
 * report a defect in the application that nobody observed. So a withheld text is `INCONCLUSIVE`, naming
 * the reason the reading gave.
 */
const contents: Validator = {
  name: OS_VALIDATOR_NAMES.contents,
  needsTarget: true,
  targetNoun: "path, written as this family spells it (`C:\\ProgramData\\Veridian\\policy.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, contents.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(contents.name, document, targetOf(raw));
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

/**
 * The account that owns a path.
 *
 * Beside `os.access` rather than merged with it, because a hardening contract asks both and the two
 * failures have different repairs: an owner that is not the service account is a change to the object's
 * ownership, while access that is too broad is a change to the grants *or* to the parent the grants were
 * inherited from. A validator that judged "the file is owned by `cart` and only `cart` may read it" as
 * one comparison would report one defect where there are two, and on a family that expresses
 * ownership and permission as one structure it would report the wrong repair for one of them.
 *
 * The owner is read from the file reading rather than from the security record, so this validator
 * answers even for a path the world holds no record for. That is the honest answer: ownership is a
 * property of the object, and the world always knows it, while the entries *on* it are what the record
 * adds.
 */
const owner: Validator = {
  name: OS_VALIDATOR_NAMES.owner,
  needsTarget: true,
  targetNoun: "path, written as this family spells it (`C:\\ProgramData\\Veridian\\policy.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, owner.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(owner.name, document, targetOf(raw));
    if (isAssertion(path)) return path;
    const found = fileReading(owner.name, path, document, "file");
    if (isAssertion(found)) return found;
    return judge(owner.name, path, `the owner of ${quote(path)}`, found.owner, raw, compareText);
  },
};

/**
 * The account that owns a path, and the account that may be granted access to it, are different
 * questions in one direction only - and the one this family must not blur is the other one. Named
 * separately here rather than inside `os.acl` because a criterion that wants to know *what was
 * written* and a criterion that wants to know *what it means* are answered from two different places
 * in the reading: the entry list, and the world's own decision.
 */

/**
 * What one account may actually do with a path, as the world decided it.
 *
 * The rendering is the reading's own: `read,write`, `read`, or `none`. It is text rather than two
 * booleans so that a criterion writes one sentence - `equals: "read"` - instead of a pair that can
 * disagree with itself, and so that `contains: "write"` is a question about one permission that does
 * not have to name the other.
 *
 * The `null` branch is the one that keeps this honest. `permissionsOf` returns `null` when the reading
 * holds **no decision** for either permission, which is a gap; it returns `"none"` when the world
 * decided and refused both, which is a fact. Judged here they are `INCONCLUSIVE` and `FAIL`
 * respectively, because "this account may do nothing" and "nobody recorded what this account may do"
 * are different answers, and only one of them accuses the application.
 */
const access: Validator = {
  name: OS_VALIDATOR_NAMES.access,
  needsTarget: true,
  targetNoun: "reference, written `<account>:<path>` (e.g. `cart:C:\\ProgramData\\Veridian\\p.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, access.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const reference = aclReference(access.name, document, target);
    if (isAssertion(reference)) return reference;
    const record = aclReading(access.name, reference.path, document);
    if (isAssertion(record)) return record;
    const permission = permissionsOf(record, reference.account);
    if (permission === null) {
      return unanswered(
        access.name,
        target,
        `The reading holds a security record for ${quote(reference.path)} but records no decision ` +
          `for ${quote(reference.account)} and either permission, so the world never concluded what ` +
          "that account may do. This is a gap in the reading rather than a refusal - a refusal is " +
          "recorded as `none` and is judged - and a validator may not derive the answer from the entry " +
          "list, because the ordering rules are exactly the part of a real system that is easy to " +
          "model almost correctly.",
      );
    }
    return judge(
      access.name,
      target,
      `what ${quote(reference.account)} may do with ${quote(reference.path)}`,
      permission,
      raw,
      compareText,
    );
  },
};

/**
 * The entries written on a path, as the world holds them.
 *
 * The complement of `os.access`: the decision is what a criterion usually wants, and this is what a
 * reader opens when the decision is not the one they expected. It answers *which* entry fired and
 * whether that entry came from the object or from a parent - which is the difference between a grant
 * that is written here and a grant that will reappear after this file is replaced.
 *
 * An empty rendering is a real answer: a security record with no entries governs nothing, so
 * `equals: ""` is a sentence a criterion can write, and it is the sentence "nobody has been granted
 * anything on this path". A path the world holds *no* record for is a different fact and is
 * `INCONCLUSIVE`.
 */
const acl: Validator = {
  name: OS_VALIDATOR_NAMES.acl,
  needsTarget: true,
  targetNoun: "path, written as this family spells it (`C:\\ProgramData\\Veridian\\policy.conf`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, acl.name, null);
    if (isAssertion(document)) return document;
    const path = sandboxPath(acl.name, document, targetOf(raw));
    if (isAssertion(path)) return path;
    const record = aclReading(acl.name, path, document);
    if (isAssertion(record)) return record;
    return judge(
      acl.name,
      path,
      `the entries governing ${quote(path)}`,
      renderAcl(record),
      raw,
      compareText,
    );
  },
};

/**
 * Whether the system holds an account by a name.
 *
 * The question almost every Windows and macOS contract asks before any of the others - and the one
 * that goes wrong most quietly, because a criterion about the *kind* of account a provisioner created
 * would find no account at all and report a failure about the kind. So presence is its own validator
 * with its own repair: an account that was never created is a missing provisioning step, and an
 * account that exists when it should not is a provisioning step that ran when it should not have.
 *
 * `equals: true` and `equals: false` are the two sentences, and `present` / `absent` are accepted
 * because a contract saying "the account `cart` is absent" reads better than one saying `equals: false`
 * about it.
 */
const account: Validator = {
  name: OS_VALIDATOR_NAMES.account,
  needsTarget: true,
  targetNoun: "account name",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, account.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(account.name, "an account name");
    return judge(
      account.name,
      target,
      `the account ${quote(target)}`,
      accountNamed(document, target) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * What a configuration store container holds.
 *
 * The family's third new question, and the one with no POSIX analogue at all: neither a registry key
 * nor a preference domain is a file, so a contract about autostart, about a listening address or about
 * whose profile a setting lives in had no way to be written before this.
 *
 * The container is rendered by the reading as one `name=value` line per value, sorted by name, with the
 * empty string for a container that holds nothing. That last part is what makes the interesting
 * sentence writable: "this store holds no autostart entry" is `equals: ""`, and "this container holds
 * only what we put there" is an `equals` against the whole rendering, while "does it hold one at all"
 * is `contains: "Autostart="`. A criterion that could only ask about one named value at a time could
 * ask none of those, and the one it could ask would be answered by a field read rather than by the
 * container as a whole.
 *
 * The rendering is unambiguous by construction: the world refuses a value carrying a newline, naming
 * why, so no `contains` can match across two entries.
 */
const setting: Validator = {
  name: OS_VALIDATOR_NAMES.setting,
  needsTarget: true,
  targetNoun: "store container (`HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`, or `com.veridian.app`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, setting.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const container = storeContainer(setting.name, document, target);
    if (isAssertion(container)) return container;
    return judge(
      setting.name,
      target,
      `the values in the store container ${quote(container)}`,
      settingValues(settingsIn(document, container)),
      raw,
      compareText,
    );
  },
};

/**
 * Whether the system holds a service by a name.
 *
 * Split from `os.running` rather than folded into it, because the two answers are different facts with
 * different repairs - "the service was never registered" is a missing definition and "the service is
 * registered and stopped" is a service that failed to start - and because a reading holds services that
 * were never started, with `stopped` as their status. A service the reading does not hold at all is
 * `INCONCLUSIVE` in `os.running`, since that validator cannot tell a missing service from a stopped
 * one, and reporting the first as `FAIL` there would accuse the application of a defect the world does
 * not have the facts to support.
 */
const service: Validator = {
  name: OS_VALIDATOR_NAMES.service,
  needsTarget: true,
  targetNoun: "service name",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, service.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(service.name, "a service name");
    return judge(
      service.name,
      target,
      `the service ${quote(target)}`,
      serviceNamed(document, target) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * Whether a service is running.
 *
 * The vocabulary is the reading's own three words, and the third one carries the evidence: `running`
 * is reported only after the world really reached the port the service declared, and `failed` is
 * reported when it declared one and the connection did not answer. So a criterion saying
 * `equals: "running"` is a claim about a socket somebody knocked on, not a replay of the fact that a
 * start command exited zero - which is the difference between a simulated world and a stub.
 *
 * `failed` and `stopped` are different answers rather than two words for one: `stopped` means the
 * service is not running and was not asked to be, and `failed` means it was asked and the world could
 * not confirm it. A contract that only had `stopped` would report a service that crashed on start as a
 * service nobody started.
 */
const running: Validator = {
  name: OS_VALIDATOR_NAMES.running,
  needsTarget: true,
  targetNoun: "service name",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, running.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(running.name, "a service name");
    const found = serviceNamed(document, target);
    if (found === null) {
      return unanswered(
        running.name,
        target,
        `The reading holds no service ${quote(target)}, so there is no status to read. Whether the ` +
          `service should exist is the question ${quote(OS_VALIDATOR_NAMES.service)} answers; this ` +
          "validator can only report whether an existing service is running, and a service that is not " +
          "there is not a service that is stopped.",
      );
    }
    return judge(
      running.name,
      target,
      `the status of the service ${quote(target)}`,
      found.status,
      raw,
      compareServiceStatus,
    );
  },
};

/**
 * The account a service runs as.
 *
 * The hardening question, and the one this family exists beside `sim-posix` for: "the web service must
 * not run as `SYSTEM`" and "the daemon must not run as `root`" are two different sentences in two
 * different worlds, and both are answered here from one field, because both families record the
 * principal as a name.
 *
 * The empty string is the branch that matters. The reading records an empty account when it could not
 * read one out of a service definition - a plist with no `UserName`, an `sc create` that named no
 * `obj=` - and judging that against `equals: "cart"` would report a defect in the application for a
 * fact the *world* could not determine. So an unreadable principal is `INCONCLUSIVE`, naming what the
 * reading actually held.
 */
const principal: Validator = {
  name: OS_VALIDATOR_NAMES.principal,
  needsTarget: true,
  targetNoun: "service name",
  comparisons: ["equals", "contains", "matches"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, principal.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(principal.name, "a service name");
    const found = serviceNamed(document, target);
    if (found === null) {
      return unanswered(
        principal.name,
        target,
        `The reading holds no service ${quote(target)}, so there is no principal to read. ` +
          `Whether the service should exist is the question ${quote(OS_VALIDATOR_NAMES.service)} ` +
          "answers; this validator can only report who an existing service runs as.",
      );
    }
    if (found.account === "") {
      return unanswered(
        principal.name,
        target,
        `The reading holds the service ${quote(target)} but records no account for it, so the world ` +
          "could not read a principal out of the service's own definition. Judging an empty account " +
          "against an expected one would report a defect in the application for a fact this world " +
          "never determined - and a service whose principal is unknown is exactly the service a " +
          "hardening contract has to look at by hand.",
      );
    }
    return judge(
      principal.name,
      target,
      `the account the service ${quote(target)} runs as`,
      found.account,
      raw,
      compareText,
    );
  },
};

// ---- the action record ----------------------------------------------------------------------------

/**
 * The newest execution of a program by one source, or the branch that says there is none.
 *
 * The **newest** is judged, for the same reason `k8s.applied` and `posix.ran` judge the newest: the
 * record is a chronological log, and a program this world refused on an early iteration and performed
 * after a repair is a program that works now. The reading is per-observation, so an earlier
 * iteration's record is judged by that iteration's criterion.
 *
 * A program the world never ran at all, and a program only ever run by somebody else, are reported as
 * different facts: the first is an absence of a record, the second is a record that is not evidence
 * about the application. Naming which one it is sends the reader somewhere different.
 */
function execBy(
  validator: string,
  target: string,
  document: OsObservationData,
  source: OsExecSource,
  other: readonly [name: string, described: string],
): OsExecRecord | AssertionResult {
  const all = execsOf(document, target);
  if (all.length === 0) {
    return unanswered(
      validator,
      target,
      `The world recorded no execution of ${quote(target)} at all, so there is nothing to judge. ` +
        "This is the absence of a record rather than a command that failed: a command that ran and " +
        "exited non-zero is judged here, and so is a command this world refused to answer.",
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
 * The reader of provisioning: a policy file written, an account created, a service registered. Four
 * results, and the four are different repairs - `completed` is the pass, `nonzero` is the program's own
 * defect, `refused` is this world declining to answer (a program the register does not hold, an
 * argument that climbs out of the sandbox), and `timed-out` is the boundary doing its job.
 *
 * The target is the program **as the caller named it**, not `argv[0]`, because the world resolves
 * `argv[0]` to the substitute it ran - and keying on that would make this validator unfindable for
 * exactly the commands the world substituted, which are the ones a criterion is most likely to ask
 * about.
 */
const ran: Validator = {
  name: OS_VALIDATOR_NAMES.ran,
  needsTarget: true,
  targetNoun: "program name, as the caller named it",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, ran.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(ran.name, "a program name");
    const found = execBy(ran.name, target, document, "application", [
      OS_VALIDATOR_NAMES.probe,
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
 * A separate validator, not a qualifier on `os.ran`, and the separation is the point: a criterion that
 * ran a command is asking what the *world* did to the criterion, not what the application did. The
 * contract this exists for is containment - a criterion that runs `type ../../etc/hosts` on Windows or
 * `cat ../../etc/passwd` on macOS and asserts `equals: "refused"`, which is the only way a contract can
 * state that the sandbox guard held. Judging that through `os.ran` would let a run pass on the strength
 * of the run's own questions, which is the false pass this product exists to refuse.
 *
 * A second use, and the reason it is worth its own tests: a criterion can use it to *create* the state
 * another criterion then judges, and the read source recorded on the result is what tells a later
 * reader which of the two wrote a setting. That provenance is not assertable by any validator yet - the
 * `writtenBy` gap above - but it is in the reading, so a human can see it.
 */
const probe: Validator = {
  name: OS_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "program name, as the criterion named it",
  comparisons: ["equals"],
  observationKind: OS_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(probe.name, "a program name");
    const found = execBy(probe.name, target, document, "criterion", [
      OS_VALIDATOR_NAMES.ran,
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
export const OS_VALIDATORS: readonly Validator[] = Object.freeze([
  file,
  contents,
  owner,
  acl,
  access,
  account,
  setting,
  service,
  running,
  principal,
  ran,
  probe,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function osValidators(): Validator[] {
  return [...OS_VALIDATORS];
}
