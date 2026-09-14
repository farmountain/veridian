/**
 * The reading a system world produces, and the vocabulary that keeps it honest.
 *
 * This file is the whole of what `validators/posix/*` is allowed to know. It holds no class, opens no
 * socket and reads no file: it is the *shape of an observation*, and it lives in `core/environment/`
 * because `validators/*` may not import `adapters/*`. The same rule produced
 * `web-observation.ts`, `db-observation.ts` and `k8s-observation.ts`, and the fact that a fourth
 * world needed no change to `core/validation` is the claim Phase C made, now made for the fourth time.
 *
 * The names are `posix.*` and not `sim-posix.*`. A criterion is about the system, not about which
 * host answered - and the substitution *is* recorded, in this document, because a verdict reached
 * against a substitute has to say so. Naming the adapter in the validator would have made the
 * substitution legible in exactly one place and made every contract written against this family
 * readable by no other system world - which is the same mistake, one layer up, as putting a
 * deployment's name in the world's name.
 *
 * ## What "simulated" means here, and what it deliberately does not cover
 *
 * A simulated world is not a stub. Three conditions have to hold, and each of them is a thing this
 * file can be read against:
 *
 * 1. **The application executes for real.** The provisioner is an ordinary child process, started by
 *    `ProcessRunner`, whose exit code, stdout and stderr are the child's own.
 * 2. **The interfaces are real.** Files are really written to a real directory tree under the
 *    state directory. Services really bind real TCP sockets on loopback, and `posix.port` really
 *    connects to them. Nothing here answers a question about a file by consulting a table of things
 *    it was told about the file.
 * 3. **The substitution is declared.** {@link POSIX_SIMULATED_SURFACES} names every surface a real
 *    host would provide that this world does not, and the reading carries the list, so a `PASS`
 *    reached here is traceable to a named substitute rather than to unexamined reality.
 *
 * What is *not* simulated is the part that makes a verdict worth having: the application's execution,
 * the observation of it, the evidence recorded, the criterion's authority to pass or fail, the reset,
 * and the fact that the reset happened. A world that simulated any of those would be reporting a
 * verdict it did not earn.
 *
 * ## The two records, and why they are separate
 *
 * Every reading keeps the **action record** apart from the **state record**:
 *
 * - {@link PosixExecRecord} is what ran - the argv the world actually executed, by whom, with what
 *   exit code, and with what output.
 * - {@link PosixFileReading}, {@link PosixUserReading}, {@link PosixPackageReading},
 *   {@link PosixServiceReading} and {@link PosixPortReading} are what the system now holds.
 *
 * Collapsing the first into the second is the common shortcut and it is a false pass with a longer
 * name: "the secret file is not readable" is a claim about a *file*, and "the application never
 * attempted to read it" is a claim about an *attempt*. A contract that only ever checked state could
 * pass on a run whose provisioner never ran, because an untouched system looks exactly like a system
 * that was correctly configured to be empty. `posix.ran` exists to read that second record, and
 * `posix.file` exists so the two are never the same sentence.
 *
 * ## The honest edge: permissions
 *
 * `permissions` is on the simulated list, and that is a real limitation stated rather than hidden.
 * The host this product runs on may be Windows, where `chmod` cannot express `0600` at all - so a
 * world that asked the filesystem for a mode would report whatever the platform happened to do and
 * would report it *differently on a different platform*, which breaks the one property a validation
 * world exists to provide. Instead the world records the mode its own operations were asked for, and
 * decides read/write questions against that record, exactly as a POSIX kernel decides `open(2)`
 * against an inode's mode. The substitution is faithful to the check and honest about the
 * enforcement: it is the world's decision, not the host's.
 */

/** The observation kind. A validator refuses any other, so a page cannot be judged as a system. */
export const POSIX_OBSERVATION_KIND = "posix.system";

/**
 * Every surface a real host would provide that this world does not.
 *
 * Membership is a claim about *this world*, not a disclaimer: each entry names something the code can
 * be inspected against, and each one is a reason a reading from here must carry the list rather than
 * being indistinguishable from a reading taken on a real Debian box.
 *
 * The application process, the filesystem and the loopback listeners are deliberately **not** on the
 * list, because they are real. A list that named everything would be as uninformative as one that
 * named nothing.
 */
export const POSIX_SIMULATED_SURFACES = [
  /** There is no syscall isolation: the child is an ordinary process on this host. */
  "kernel",
  /** A recorded distribution identity, not an installed root filesystem. */
  "distribution",
  /** A real executable, whose catalog is the world's own file rather than dpkg's database. */
  "package-manager",
  /** No remote repository is contacted; the available set is the world's own manifest. */
  "package-index",
  /** Read and write questions are decided from the world's inode record, not by the host kernel. */
  "permissions",
  /** The sandbox has no network beyond its own loopback listeners; egress is refused, not routed. */
  "egress",
  /**
   * The channel an application's provisioning program uses to have its work performed.
   *
   * Named here because it *is* a substitution and a reader has to be able to see it. The program
   * really runs, really decides and really prints; the operations it names are performed by the world
   * rather than by a kernel, because the kernel is the one surface a laptop cannot hand over. Listing
   * it is the difference between a world whose substitution is declared and one where the
   * application's work quietly happened somewhere the reading never mentions.
   */
  "provisioning",
] as const;

export type PosixSimulatedSurface = (typeof POSIX_SIMULATED_SURFACES)[number];

/** How one command ended. `refused` is the world declining to run it, which is not an exit code. */
export const POSIX_EXEC_RESULTS = ["completed", "nonzero", "refused", "timed-out"] as const;
export type PosixExecResult = (typeof POSIX_EXEC_RESULTS)[number];

/** Who asked for a command. A criterion's own probe is not evidence about the application. */
export const POSIX_EXEC_SOURCES = ["application", "criterion", "world"] as const;
export type PosixExecSource = (typeof POSIX_EXEC_SOURCES)[number];

export const POSIX_FILE_KINDS = ["file", "directory", "symlink"] as const;
export type PosixFileKind = (typeof POSIX_FILE_KINDS)[number];

export const POSIX_PACKAGE_STATUSES = ["installed", "removed"] as const;
export type PosixPackageStatus = (typeof POSIX_PACKAGE_STATUSES)[number];

export const POSIX_SERVICE_STATUSES = ["running", "stopped", "failed"] as const;
export type PosixServiceStatus = (typeof POSIX_SERVICE_STATUSES)[number];

/**
 * Whether a port is bound.
 *
 * Declared here, and read by `PosixPortReading` from here, because the alternative is a vocabulary
 * the observation owns written into an interface as a union *and* restated in the validator family
 * that judges it - two lists of one thing, reconciled by nothing. The database family paid for that
 * rule once already, with a step kind the engine implemented and the schema refused.
 */
export const POSIX_PORT_STATES = ["listening", "closed"] as const;
export type PosixPortState = (typeof POSIX_PORT_STATES)[number];

/**
 * One command, as it actually ran.
 *
 * `argv` is recorded as resolved, not as written: if the world substituted a program for the one the
 * application named, the substitution is in the record rather than in a log line nobody keeps. That
 * is the property that makes `posix.ran` a question about what happened rather than about what was
 * asked - and the difference is exactly the difference between a simulated world and a stub.
 */
export interface PosixExecRecord {
  readonly source: PosixExecSource;
  /** The argv the world executed. `argv[0]` is the resolved path when the world resolved one. */
  readonly argv: readonly string[];
  /** The program as the caller named it, before any resolution. What a criterion targets. */
  readonly program: string;
  readonly result: PosixExecResult;
  /** `null` when nothing was spawned, because a refusal has no exit code and must not be given one. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why the world refused, when it did. `null` otherwise. */
  readonly reason: string | null;
  readonly durationMs: number;
}

/**
 * One file, as the world's inode record holds it.
 *
 * `text` is the bounded contents rather than a promise to read them, because a validator may not open
 * anything - and because a bundle that records "the file contained X at observation time" is
 * evidence, while a bundle that records a path is an invitation to read a file that has since been
 * reset.
 */
export interface PosixFileReading {
  /** Absolute, as the sandbox spells it (`/etc/veridian/hardening.conf`), not as the host does. */
  readonly path: string;
  readonly kind: PosixFileKind;
  readonly bytes: number;
  /** Canonical four-digit octal: `"0600"`, `"0755"`. Recorded, never read back from the host. */
  readonly mode: string;
  readonly owner: string;
  readonly group: string;
  readonly sha256: string | null;
  /** Whole contents when they are text and within the bound; `null` otherwise. */
  readonly text: string | null;
  /** Why `text` is null, when it is. Never a silent absence. */
  readonly textWithheld: string | null;
}

export interface PosixUserReading {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly shell: string;
  readonly home: string;
  readonly groups: readonly string[];
}

export interface PosixPackageReading {
  readonly name: string;
  readonly version: string;
  readonly status: PosixPackageStatus;
  readonly installedBy: PosixExecSource;
}

export interface PosixServiceReading {
  readonly name: string;
  readonly status: PosixServiceStatus;
  readonly enabled: boolean;
  readonly command: string;
  /** `null` when it is not running, because a stopped service has no pid and must not be given one. */
  readonly pid: number | null;
}

/**
 * One listening port.
 *
 * `verified` is the field that keeps this honest. Many readings report a port's state from a table;
 * this one is `true` only when the world really bound a socket and really connected to it, and a
 * criterion that needs the stronger claim can say so. A port the world was *told* is open but never
 * bound would otherwise be indistinguishable from one it observed.
 */
export interface PosixPortReading {
  readonly port: number;
  readonly protocol: "tcp";
  readonly address: string;
  readonly state: PosixPortState;
  readonly service: string | null;
  readonly verified: boolean;
}

export interface PosixObservationData {
  /** The world's own identity, so a reading names the host it came from. */
  readonly host: string;
  /** The distribution identity the environment document declared. */
  readonly distribution: string;
  /** The real sandbox root on disk. Recorded so a reader can go and look. */
  readonly root: string;
  /** The account the application ran as. */
  readonly user: string;
  /** The substituted surfaces, from the closed vocabulary above. */
  readonly simulated: readonly PosixSimulatedSurface[];
  readonly execs: readonly PosixExecRecord[];
  readonly files: readonly PosixFileReading[];
  readonly users: readonly PosixUserReading[];
  readonly packages: readonly PosixPackageReading[];
  readonly services: readonly PosixServiceReading[];
  readonly ports: readonly PosixPortReading[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isExec = (value: unknown): value is PosixExecRecord =>
  isRecord(value) &&
  typeof value["source"] === "string" &&
  isStringArray(value["argv"]) &&
  typeof value["program"] === "string" &&
  typeof value["result"] === "string" &&
  (value["exitCode"] === null || typeof value["exitCode"] === "number") &&
  typeof value["stdout"] === "string" &&
  typeof value["stderr"] === "string" &&
  isNullableString(value["reason"]) &&
  typeof value["durationMs"] === "number";

const isFile = (value: unknown): value is PosixFileReading =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  typeof value["kind"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["mode"] === "string" &&
  typeof value["owner"] === "string" &&
  typeof value["group"] === "string" &&
  isNullableString(value["sha256"]) &&
  isNullableString(value["text"]) &&
  isNullableString(value["textWithheld"]);

const isUser = (value: unknown): value is PosixUserReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["uid"] === "number" &&
  typeof value["gid"] === "number" &&
  typeof value["shell"] === "string" &&
  typeof value["home"] === "string" &&
  isStringArray(value["groups"]);

const isPackage = (value: unknown): value is PosixPackageReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["version"] === "string" &&
  typeof value["status"] === "string" &&
  typeof value["installedBy"] === "string";

const isService = (value: unknown): value is PosixServiceReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["status"] === "string" &&
  typeof value["enabled"] === "boolean" &&
  typeof value["command"] === "string" &&
  (value["pid"] === null || typeof value["pid"] === "number");

const isPort = (value: unknown): value is PosixPortReading =>
  isRecord(value) &&
  typeof value["port"] === "number" &&
  typeof value["protocol"] === "string" &&
  typeof value["address"] === "string" &&
  typeof value["state"] === "string" &&
  isNullableString(value["service"]) &&
  typeof value["verified"] === "boolean";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a system document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs: the first sends an agent to the application, the second to the
 * environment.
 */
export function isPosixObservationData(value: unknown): value is PosixObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["host"] !== "string") return false;
  if (typeof value["distribution"] !== "string") return false;
  if (typeof value["root"] !== "string") return false;
  if (typeof value["user"] !== "string") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!Array.isArray(value["execs"]) || !value["execs"].every(isExec)) return false;
  if (!Array.isArray(value["files"]) || !value["files"].every(isFile)) return false;
  if (!Array.isArray(value["users"]) || !value["users"].every(isUser)) return false;
  if (!Array.isArray(value["packages"]) || !value["packages"].every(isPackage)) return false;
  if (!Array.isArray(value["services"]) || !value["services"].every(isService)) return false;
  return Array.isArray(value["ports"]) && value["ports"].every(isPort);
}

// ---- the questions a family asks of the document -------------------------------------------------

/**
 * The sandbox path a target names, canonicalised, or `null` when it does not name one.
 *
 * Targets are written as the *sandbox* spells them (`/etc/veridian/hardening.conf`), not as the host
 * does, because that is the only spelling that survives the world being run on a different machine.
 * A target with a `\` in it is refused rather than repaired: silently rewriting a Windows path would
 * let an operator write a criterion that only works on their laptop, and the failure would be a
 * `FAIL` against the application.
 *
 * A trailing slash is dropped and a repeated slash collapsed, so `/etc//veridian/` and
 * `/etc/veridian` are the same file - which they are, and a criterion that fails on the difference
 * would be reporting the operator's spelling as a defect in the application.
 */
export function posixPath(target: string): string | null {
  if (target.includes("\\")) return null;
  if (!target.startsWith("/")) return null;
  const collapsed = target.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
  return collapsed === "" ? "/" : collapsed;
}

/** The file the reading holds at `path`, or `null`. Exact, because a path is a name and not a pattern. */
export function fileAt(data: PosixObservationData, path: string): PosixFileReading | null {
  return data.files.find((file) => file.path === path) ?? null;
}

export function userNamed(data: PosixObservationData, name: string): PosixUserReading | null {
  return data.users.find((user) => user.name === name) ?? null;
}

export function packageNamed(data: PosixObservationData, name: string): PosixPackageReading | null {
  return data.packages.find((entry) => entry.name === name) ?? null;
}

export function serviceNamed(data: PosixObservationData, name: string): PosixServiceReading | null {
  return data.services.find((service) => service.name === name) ?? null;
}

export function portAt(data: PosixObservationData, port: number): PosixPortReading | null {
  return data.ports.find((entry) => entry.port === port) ?? null;
}

/**
 * Every execution of one program, in the order they happened.
 *
 * Keyed on the *program as the caller named it*, not on `argv[0]`, and the distinction is load
 * bearing: `argv[0]` holds the resolved path when the world substituted a program, so keying on it
 * would make `posix.ran` unfindable for exactly the commands the world substituted - the ones a
 * criterion is most likely to ask about. This is the "a requirement that names a place must be
 * resolved as a pointer" lesson from the other direction: here the *stable* name is the caller's.
 */
export function execsOf(data: PosixObservationData, program: string): readonly PosixExecRecord[] {
  return data.execs.filter((exec) => exec.program === program);
}

/**
 * A number as a port, or `null` when the target is not one.
 *
 * Refused rather than coerced: `Number("")` is `0`, `Number(" 80 ")` is `80`, and a target that
 * silently becomes port 0 would be judged as a closed port and reported as a `FAIL` against an
 * application that closed nothing.
 */
export function portNumber(target: string): number | null {
  if (!/^\d{1,5}$/.test(target)) return null;
  const value = Number(target);
  return value >= 1 && value <= 65535 ? value : null;
}
