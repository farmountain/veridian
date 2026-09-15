/**
 * The vocabulary a process adapter and a process validator share.
 *
 * It lives here, beside `web-observation.ts`, `api-observation.ts` and the rest, for exactly the
 * reason that file gives: `validators/*` may not import `adapters/*`, so the document a validator
 * reads has to be declared in a layer neither of them owns.
 *
 * ## Why this is not `api-observation.ts` with a different name
 *
 * An API reading describes *an exchange*: a method put to a service, the status it answered with, the
 * bytes it sent back. A process reading describes *a command*: the arguments it was given, the
 * directory it ran in, how it ended, and what it printed on each stream - plus *a file*, because the
 * thing a program leaves behind is often not on a stream at all. `api.status` asks what a service
 * answered; there is no service here to answer. Sharing one document would force every validator to
 * acknowledge fields its world cannot produce, which is how a vocabulary starts lying about what was
 * observed.
 *
 * ## The world this document describes is real, and that changes what it may omit
 *
 * Every other reading in this directory carries a `simulated` field naming the surfaces that are
 * stood in for. This one carries none, and its absence is a claim rather than an oversight: a command
 * here really ran, on this machine, as an ordinary child process, and the file named in `files` is a
 * real file this machine can open. A field saying "simulated: none" would suggest the alternative was
 * possible. See `adapters/local-process/` for the limits the world *does* have - they are stated
 * there, by name, because a limit that is not declared is a limit a reader will assume away.
 *
 * ## `exitCode: null` is a fact, not a gap
 *
 * A command that was killed at its deadline never exited, so it has no exit code. Recording `0` - the
 * habit from a different ecosystem - would make "it timed out" indistinguishable from "it succeeded",
 * and those are the same two repairs the API reading's `status: null` keeps apart. `state` says which
 * of the three situations the record is in, and `exitCode` says what the code was when there was one.
 */

/** Adapter-defined observation kind. Validators declare the kind they understand. */
export const PROCESS_OBSERVATION_KIND = "process.exec";

/**
 * How a command ended, as a closed set.
 *
 * Four members rather than a boolean or a `timedOut` flag, because each pair among them differs by a
 * different repair. A `run` step that hit its deadline is an application that hangs; a program the
 * world ended on its way out is an application that was *stopped*, which is not a defect in it; a
 * long-lived program still running when a criterion reads it is an application doing its job; and a
 * clean exit is the one case where an exit code exists to compare at all. A boolean collapses at
 * least two of those into one word, and the word is then wrong for one of them.
 */
export const PROCESS_COMMAND_STATES = ["exited", "timed-out", "signalled", "running"] as const;
export type ProcessCommandState = (typeof PROCESS_COMMAND_STATES)[number];

/** What a path target turned out to hold. `absent` is a member, not a missing reading. */
export const PROCESS_FILE_KINDS = ["file", "directory", "other", "absent"] as const;
export type ProcessFileKind = (typeof PROCESS_FILE_KINDS)[number];

/**
 * One stream's text, with the two facts that make it readable.
 *
 * `text` is bounded - a program can print a megabyte, and a bundle is read by people - while `bytes`
 * is the true length of everything the stream produced. Keeping both is what lets a comparison say
 * `(54 bytes)` about a stream whose text was truncated, without the number being a lie about the text
 * beside it. The tail is kept rather than the head, for the reason the repair note keeps its tail: a
 * failure states its cause last.
 */
export interface ProcessStreamReading {
  /** What the stream produced, bounded. The tail is kept when it was longer than the bound. */
  readonly text: string;
  /** Everything the stream produced, counted. Never the length of `text` alone. */
  readonly bytes: number;
  /** Whether `text` is a suffix of something longer. */
  readonly truncated: boolean;
}

/**
 * One command the world ran.
 *
 * `argv` is recorded as it was dispatched, so a failure report can quote the command rather than
 * describe it. `cwd` is recorded because the same program in two directories is two programs, and a
 * reading that omitted it would make two different runs look like one.
 */
export interface ProcessCommandRecord {
  /** The command and its arguments, exactly as the criterion or the document spelled them. */
  readonly argv: readonly string[];
  /** The directory it ran in. */
  readonly cwd: string;
  /** How it ended. */
  readonly state: ProcessCommandState;
  /** The exit code, when it exited normally. `null` when it was killed, timed out, or is running. */
  readonly exitCode: number | null;
  /** The signal that ended it, when one did. `null` otherwise. */
  readonly signal: string | null;
  /** The deadline it was killed at, when it timed out. `null` otherwise. */
  readonly timedOutAfterMs: number | null;
  readonly stdout: ProcessStreamReading;
  readonly stderr: ProcessStreamReading;
}

/**
 * A path the criterion asked about, as the world found it.
 *
 * The text is *in* the reading rather than behind the path, on the same reasoning the posix family
 * records: a bundle that held a path and a promise to open it would be evidence of nothing after the
 * next reset. The `textWithheld` branch is what keeps this honest - a reading that declined to carry
 * contents names why, so a validator that compared a criterion against an empty string cannot report
 * a defect in the application that nobody observed.
 */
export interface ProcessFileReading {
  /** The path as the criterion spelled it, which is the spelling a failure report should quote. */
  readonly path: string;
  /** Whether anything is there. */
  readonly exists: boolean;
  readonly kind: ProcessFileKind;
  /** Size in bytes when it is a file. `null` otherwise, including when it is absent. */
  readonly bytes: number | null;
  /** The file's text. `null` when absent, or when the reading declined to carry it. */
  readonly text: string | null;
  /** Why `text` is `null`, when it is because the reading withheld it. `null` otherwise. */
  readonly textWithheld: string | null;
}

export interface ProcessObservationData {
  /**
   * The world identity the readings name.
   *
   * Free text rather than an enumeration: a name decides nothing a criterion can observe, and
   * enumerating it would let a label act as a rule. It is here so a bundle read later beside a result
   * from another run can say whether the two judged the same world.
   */
  readonly host: string;
  /**
   * The directory the world's own files live in, as this machine spells it.
   *
   * Recorded because every path in `files` is relative to it, and a reading that named only the
   * relative paths could not be reproduced: two runs of one contract in two sandboxes would look
   * identical while having measured two different trees.
   */
  readonly root: string;
  /** The program the world started, when the document declared one. `null` when it declared none. */
  readonly application: ProcessCommandRecord | null;
  /** Every `run` step this criterion performed, in the order it performed them. */
  readonly commands: readonly ProcessCommandRecord[];
  /** Every path this criterion asked about, in the order the criteria named them. */
  readonly files: readonly ProcessFileReading[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStream = (value: unknown): value is ProcessStreamReading =>
  isRecord(value) &&
  typeof value["text"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["truncated"] === "boolean";

const isState = (value: unknown): value is ProcessCommandState =>
  typeof value === "string" && (PROCESS_COMMAND_STATES as readonly string[]).includes(value);

const isKind = (value: unknown): value is ProcessFileKind =>
  typeof value === "string" && (PROCESS_FILE_KINDS as readonly string[]).includes(value);

const isCommand = (value: unknown): value is ProcessCommandRecord =>
  isRecord(value) &&
  Array.isArray(value["argv"]) &&
  value["argv"].every((entry) => typeof entry === "string") &&
  typeof value["cwd"] === "string" &&
  isState(value["state"]) &&
  (value["exitCode"] === null || typeof value["exitCode"] === "number") &&
  (value["signal"] === null || typeof value["signal"] === "string") &&
  (value["timedOutAfterMs"] === null || typeof value["timedOutAfterMs"] === "number") &&
  isStream(value["stdout"]) &&
  isStream(value["stderr"]);

const isFile = (value: unknown): value is ProcessFileReading =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  typeof value["exists"] === "boolean" &&
  isKind(value["kind"]) &&
  (value["bytes"] === null || typeof value["bytes"] === "number") &&
  (value["text"] === null || typeof value["text"] === "string") &&
  (value["textWithheld"] === null || typeof value["textWithheld"] === "string");

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a process document", and the answer is what decides between a
 * validator judging a world and a validator reporting that the world arrived unreadable.
 */
export function isProcessObservationData(value: unknown): value is ProcessObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["host"] !== "string") return false;
  if (typeof value["root"] !== "string") return false;
  if (value["application"] !== null && !isCommand(value["application"])) return false;
  if (!Array.isArray(value["commands"]) || !value["commands"].every(isCommand)) return false;
  return Array.isArray(value["files"]) && value["files"].every(isFile);
}

// ---- the two target grammars ---------------------------------------------------------------------

/** The selector that names the program the world started rather than one of the criterion's steps. */
export const PROCESS_APPLICATION = "app";

/**
 * Which command a target names.
 *
 * ## Two grammars in one family, on purpose
 *
 * This family is asked two different kinds of question - "what did this command do" and "what is in
 * this file" - and the two subjects cannot be told apart by their spelling alone, so the *validator*
 * holds the grammar rather than the target. A target naming a command is either the word `app` or a
 * bare 1-based position; a target naming a file is a path relative to the world's root. `process.file`
 * reads its target as a path and `process.exitcode` reads its target as a selector, so neither can
 * misinterpret the other's spelling.
 *
 * The one ambiguity a reader could construct is a file called `1`, and it is resolved by rule rather
 * than by guess: a bare positive integer is a command selector, and `./1` is a path. A path that
 * needs to be told apart from a selector has one spelling that does it.
 *
 * The position is 1-based because a failure report is read by a person counting the `run` steps in the
 * criterion they wrote, and every other id, step and expectation in this product counts from one. The
 * `commands` list itself is 0-based - that is `commandAt`'s arithmetic - and the conversion happens
 * there, once, with the place it happens named.
 */
export function commandSelectorOf(
  target: unknown,
): { readonly ok: true; readonly selector: string } | { readonly ok: false; readonly message: string } {
  if (typeof target !== "string" || target.trim() === "") {
    return {
      ok: false,
      message:
        "a command selector, written as `app` for the program the world started or as a position " +
        "`1`, `2`, ... for the criterion's own `run` steps",
    };
  }
  const text = target.trim();
  if (text === PROCESS_APPLICATION) return { ok: true, selector: text };
  if (/^[1-9][0-9]*$/.test(text)) return { ok: true, selector: text };
  return {
    ok: false,
    message:
      `\`${text}\` is neither \`${PROCESS_APPLICATION}\` nor a position counted from 1. A path ` +
      `belongs to \`process.file\` and \`process.contents\`, which read their target as a place ` +
      `inside the world rather than as a command`,
  };
}

/**
 * The command a selector names, or `null` when this criterion performed fewer commands than that.
 *
 * Index-free for `app` and index-based for a position, which is the whole distinction: the program is
 * the same program in every criterion, while "the second command" is a fact about *this* criterion
 * and must not be answered from another one's steps.
 */
export function commandAt(data: ProcessObservationData, selector: string): ProcessCommandRecord | null {
  if (selector === PROCESS_APPLICATION) return data.application;
  const position = Number(selector);
  return data.commands[position - 1] ?? null;
}

/**
 * Why the command a selector names is absent, in the reading's own terms.
 *
 * A message that named a cause it had not observed would send a reader to repair a step that is not
 * there: "no command was recorded" is true of a criterion that performed none, of a criterion that
 * asked for the fourth when it performed two, and of a world whose document declared no
 * `process.application` at all - and only the last of those three is the document's fault.
 */
export function commandAbsentReason(data: ProcessObservationData, selector: string): string {
  if (selector === PROCESS_APPLICATION) {
    return (
      "This world declared no `process.application`, so no application program was run and there " +
      "is no record of one. `process.application.command` is how a world says which program it " +
      "runs; `application: null` is how it says it runs none."
    );
  }
  const performed = data.commands.length;
  if (performed === 0) {
    return (
      "The reading carries no commands at all, so there is nothing to read. A command is recorded " +
      "when the criterion's own `run` step is performed, so a criterion that only observed put no " +
      "command to this world and cannot be answered by one."
    );
  }
  return (
    `The criterion performed ${String(performed)} ` +
    `${performed === 1 ? "command" : "commands"}, so there is no command ${selector}. A position ` +
    "counts the criterion's own `run` steps from one, in the order it ran them."
  );
}

/**
 * The world-relative path a target names, or `null` when the spelling cannot name a place inside it.
 *
 * ## Why this refuses rather than resolves
 *
 * `path.resolve` would happily turn `/etc/passwd` into a path on *this* machine and `../..` into
 * somewhere outside the sandbox, and a world that opened either while calling it the sandbox's would
 * read the developer's own filesystem under a name that says it did not. So a spelling that leaves
 * the root is refused, by this function, and the adapter records the refusal as a boundary crossing
 * rather than reporting a missing file - a resource that is absent and a place that is out of bounds
 * are two different observations, and only one of them is the application's problem.
 *
 * A leading separator, a drive letter and a `..` that pops past the root are each refused. A `.` and
 * an internal `..` are resolved, because they name a place that *is* inside.
 */
export function processPath(target: unknown): string | null {
  if (typeof target !== "string") return null;
  const text = target.trim().replace(/\\/g, "/");
  if (text === "") return null;
  // A rooted path or a drive letter names this machine's filesystem, not the world's.
  if (text.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(text)) return null;

  const parts: string[] = [];
  for (const segment of text.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length === 0 ? null : parts.join("/");
}

/**
 * The reading of a path, matched on the normalised spelling.
 *
 * Matched rather than indexed, unlike a command, because a path is its own name: two criteria that
 * ask about `out/report.txt` are asking about one file, and a position would make the same file two
 * subjects the moment a contract reordered its criteria.
 */
export function fileAt(data: ProcessObservationData, path: string): ProcessFileReading | null {
  return data.files.find((entry) => entry.path === path) ?? null;
}

// ---- how a reader is shown each of these ---------------------------------------------------------

const lines = (text: string): number => (text === "" ? 0 : text.split("\n").length);

/** One stream, as an operator reads it: a size, and whether some of it was left out. */
export function renderStream(label: string, reading: ProcessStreamReading): string {
  if (reading.bytes === 0) return `${label} empty`;
  const shown = `${String(reading.bytes)} ${reading.bytes === 1 ? "byte" : "bytes"}`;
  const count = `${String(lines(reading.text))} ${lines(reading.text) === 1 ? "line" : "lines"}`;
  return reading.truncated
    ? `${label} ${count} (${shown}, last ${String(reading.text.length)} shown)`
    : `${label} ${count} (${shown})`;
}

/**
 * How a command ended, in one phrase.
 *
 * The exit code is rendered as a number and the three non-exits are rendered as what they are, so a
 * comparison against this string can never read a timeout as a success. `renderCommand` composes it
 * with the two streams and that composition is what `process.run` compares; `process.state` compares
 * the member itself, because a criterion that only wants to know how it ended should not have to
 * spell the streams to say so.
 */
export function renderExit(record: ProcessCommandRecord): string {
  if (record.state === "exited") return `exit ${String(record.exitCode)}`;
  if (record.state === "timed-out") {
    return `timed out after ${String(record.timedOutAfterMs)}ms`;
  }
  if (record.state === "signalled") return `ended by ${String(record.signal)}`;
  return "still running";
}

/** A whole command as one line: how it ended, and what each stream produced. */
export function renderCommand(record: ProcessCommandRecord): string {
  return [
    renderExit(record),
    renderStream("stdout", record.stdout),
    renderStream("stderr", record.stderr),
  ].join(", ");
}

/** The world itself, which is the question a targetless validator in this family asks. */
export function renderHost(data: ProcessObservationData): string {
  return `${data.host} (root ${data.root})`;
}

/**
 * What kind of thing a path turned out to hold - and deliberately not how big it is.
 *
 * The size is `process.size`'s subject. A rendering that carried it would make `process.kind` a
 * second, weaker way to assert a file's length: a criterion pinning `"12 bytes of a file"` would
 * fail the day the file grew by one byte, while `process.size` would have said exactly what was
 * meant. One question, one validator.
 */
export function renderFile(reading: ProcessFileReading): string {
  if (!reading.exists) return "absent";
  if (reading.kind === "file") return "a file";
  if (reading.kind === "directory") return "a directory";
  return "something that is neither a file nor a directory";
}

/** The command line, quoted so a failure report can show what was actually run. */
export function renderArgv(record: ProcessCommandRecord): string {
  return record.argv.map((word) => (word.includes(" ") ? `"${word}"` : word)).join(" ");
}
