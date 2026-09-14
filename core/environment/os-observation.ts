/**
 * The reading an operating-system world produces, and the vocabulary that keeps it honest.
 *
 * This file is the whole of what `validators/os/*` is allowed to know. It holds no class, opens no
 * socket and reads no file: it is the *shape of an observation*, and it lives in `core/environment/`
 * because `validators/*` may not import `adapters/*`. The same rule produced `web-observation.ts`,
 * `db-observation.ts`, `k8s-observation.ts` and `posix-observation.ts`, and the fact that a fifth
 * world needed no change to `core/validation` is the claim Phase C made - now made for the fifth
 * time, and the second time for a world whose subject is an operating system.
 *
 * ## Why this is not `sim-posix` with different words
 *
 * A second system world is worth having only if it asks questions the first one cannot. `sim-posix`
 * models an account, a mode, an owner, a package, a unit and a port; a world that modelled the same
 * six things while saying "Windows" in its readings would be a renamed fixture, and every hour spent
 * on it would be an hour that taught nothing.
 *
 * The surfaces this family exists for are the ones a POSIX mode cannot express, and each is a
 * question a real hardening contract asks:
 *
 * - **The access decision**, not the mode bits. `sim-posix` reports a mode and leaves the reader to
 *   reason about it, because a POSIX mode *is* the access decision. Windows has no mode at all: an
 *   ACL is a list of (account, permission, allow|deny) entries, inheritance changes its meaning, and
 *   a deny granted explicitly beats an allow inherited. So this world records the **decision it
 *   reached** - {@link OsAccessDecision} - and a validator judges that decision rather than trying to
 *   re-implement `AccessCheck` from a table.
 * - **The platform's own configuration store.** A Windows service autostart lives in the registry;
 *   a macOS one lives in a preference domain. Both are *named containers of named values*, neither is
 *   a file, and neither is expressible as a file check. {@link OsSettingReading} models the store,
 *   and `os.setting` judges the container's contents as a whole - which is the question a
 *   persistence check actually asks.
 * - **The account a service runs as.** A unit's `User=` line and a Windows service's `obj=` are the
 *   same fact written two ways, and it is the single most common privilege-escalation finding in
 *   either system. {@link OsServiceReading.account} records it, and `os.principal` judges it.
 * - **Path semantics.** A drive letter and a backslash, and a volume that folds case, are not
 *   cosmetic. A criterion written with a POSIX path is a criterion for a different machine, and this
 *   world refuses the spelling by name rather than resolving it.
 *
 * ## What "simulated" means here, and what it deliberately does not cover
 *
 * Three conditions have to hold, and each of them is a thing this file can be read against:
 *
 * 1. **The application executes for real.** The provisioner is an ordinary child process, started by
 *    `ProcessRunner`, whose exit code, stdout and stderr are the child's own. It really writes files
 *    into the sandbox tree with `node:fs`, through the host path the adapter hands it.
 * 2. **The interfaces are real.** Files are really written to a real directory tree. The commands the
 *    application issues are executed, in order, through a register that is reached by name. Nothing
 *    here answers a question about a file by consulting a table of things it was told about the file:
 *    {@link OsFileReading.bytes} and {@link OsFileReading.sha256} come from a real `lstat` and a real
 *    hash of the bytes on disk.
 * 3. **The substitution is declared.** {@link OS_SIMULATED_SURFACES} names every surface a real system
 *    would provide that this world does not, and the reading carries the list, so a `PASS` reached
 *    here is traceable to a named substitute rather than to unexamined reality.
 *
 * What is *not* simulated is the part that makes a verdict worth having: the application's execution,
 * the observation of it, the evidence recorded, the criterion's authority to pass or fail, the reset,
 * and the fact that the reset happened.
 *
 * ## The two records, and why they are separate
 *
 * Every reading keeps the **action record** apart from the **state record**:
 *
 * - {@link OsExecRecord} is what ran - the argv the world actually executed, by whom, with what exit
 *   code, and with what output.
 * - {@link OsFileReading}, {@link OsAclReading}, {@link OsAccountReading}, {@link OsSettingReading}
 *   and {@link OsServiceReading} are what the system now holds.
 *
 * Collapsing the first into the second is a false pass with a longer name: "the machine-wide policy
 * key does not exist" is a claim about the *store*, and "the application never wrote it" is a claim
 * about an *attempt*. A contract that only ever checked state could pass on a run whose provisioner
 * never ran, because an untouched system looks exactly like a system that was correctly configured to
 * be empty. `os.ran` reads the second record, and `os.setting` reads the first, so the two are never
 * the same sentence.
 *
 * ## The honest edge: the access decision
 *
 * `acl` is on the simulated list, and that is a real limitation stated rather than hidden. The host
 * this product runs on may be Linux or macOS, where `icacls` does not exist and where the sandbox
 * tree's real ACLs are whatever the filesystem decided - so a world that asked the host whether an
 * account may write a path would report the host's answer and would report it *differently on a
 * different platform*, which breaks the one property a validation world exists to provide. Instead
 * the world records the entries its own operations were asked for and decides read/write questions
 * against that record, exactly as a kernel decides `AccessCheck` against a security descriptor. The
 * substitution is faithful to the check and honest about the enforcement: it is the world's decision,
 * not the host's. {@link OsAccessDecision.because} records *which* entry decided, so a reader can
 * audit the decision instead of taking it on trust.
 */

/** The families this world stands in for. Declared here because the reading names one of them. */
export const OS_FAMILIES = ["windows", "macos"] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];

/** The observation kind. A validator refuses any other, so a page cannot be judged as a machine. */
export const OS_OBSERVATION_KIND = "os.system";

/** How a family is spelled in a sentence, so the vocabulary is written down once. */
export const OS_FAMILY_LABELS: Readonly<Record<OsFamily, string>> = Object.freeze({
  windows: "Windows",
  macos: "macOS",
});

/**
 * Every surface a real system would provide that this world does not.
 *
 * Membership is a claim about *this world*, not a disclaimer: each entry names something the code can
 * be inspected against, and each one is a reason a reading from here must carry the list rather than
 * being indistinguishable from a reading taken on a real Windows 11 machine.
 *
 * The application process and the filesystem are deliberately **not** on the list, because they are
 * real. A list that named everything would be as uninformative as one that named nothing.
 *
 * Two of the entries - `registry` and `preferences` - are per-family. The world substitutes the
 * registry for a `windows` reading and the preference domains for a `macos` one, and the reading
 * carries only the ones that apply, so the list states what stood in for *this* system rather than
 * what one of the two families might have needed.
 */
export const OS_SIMULATED_SURFACES = [
  /** There is no syscall isolation and no kernel: the child is an ordinary process on this host. */
  "kernel",
  /** A recorded system identity, not an installed image with a real Win32 or Darwin ABI. */
  "os-identity",
  /**
   * Drive letters, a backslash as the separator, and a volume that folds case are conventions this
   * world implements - so a criterion about them is a criterion about the *model*.
   */
  "path-semantics",
  /** Read and write questions are decided from the world's own security record, not by the host. */
  "acl",
  /** A real named-value store with the registry's addressing, not the registry's implementation. */
  "registry",
  /** A real named-value store with `defaults`' addressing, not CFPreferences' implementation. */
  "preferences",
  /** A real catalog of services and a real start, but no SCM and no launchd. */
  "service-manager",
  /** The sandbox has no network at all; egress is refused, not routed. */
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

export type OsSimulatedSurface = (typeof OS_SIMULATED_SURFACES)[number];

/** How one command ended. `refused` is the world declining to run it, which is not an exit code. */
export const OS_EXEC_RESULTS = ["completed", "nonzero", "refused", "timed-out"] as const;
export type OsExecResult = (typeof OS_EXEC_RESULTS)[number];

/** Who asked for a command. A criterion's own probe is not evidence about the application. */
export const OS_EXEC_SOURCES = ["application", "criterion", "world"] as const;
export type OsExecSource = (typeof OS_EXEC_SOURCES)[number];

export const OS_FILE_KINDS = ["file", "directory", "symlink"] as const;
export type OsFileKind = (typeof OS_FILE_KINDS)[number];

/**
 * Whether an account is a login account or one a service runs as.
 *
 * The distinction is load bearing rather than descriptive: "the service account exists" and "a person
 * can log in as this" are different findings, and a world that held one undifferentiated list of
 * names could not tell an operator which of the two a `FAIL` was about.
 */
export const OS_ACCOUNT_KINDS = ["user", "service"] as const;
export type OsAccountKind = (typeof OS_ACCOUNT_KINDS)[number];

export const OS_SERVICE_STATUSES = ["running", "stopped", "failed"] as const;
export type OsServiceStatus = (typeof OS_SERVICE_STATUSES)[number];

/**
 * The permissions this world decides access for.
 *
 * `read` and `write`, and deliberately not `execute`. Both an ACL entry and a POSIX mode express the
 * first two unambiguously, while "execute" means something different on a machine that can mark a
 * file executable and a machine that decides it from a file extension - and a vocabulary that carried
 * one word for two semantics is the defect this repository has already paid for twice. A hardening
 * contract asks about read and write; the third is left out and said so here rather than modelled
 * badly.
 */
export const OS_PERMISSIONS = ["read", "write"] as const;
export type OsPermission = (typeof OS_PERMISSIONS)[number];

/** What the world decided. Recorded, never re-derived by a reader. */
export const OS_ACCESS_DECISIONS = ["permitted", "refused"] as const;
export type OsAccessDecisionValue = (typeof OS_ACCESS_DECISIONS)[number];

/** Who put a value in the store. Provenance, because "the store holds it" and "this run wrote it" differ. */
export const OS_SETTING_WRITERS = ["world", "application", "criterion"] as const;
export type OsSettingWriter = (typeof OS_SETTING_WRITERS)[number];

/**
 * The type words the store understands, per family.
 *
 * Two lists rather than one, because the families genuinely have different type systems and a single
 * merged list would let a `macos` reading record `REG_DWORD`. The world checks a stated type against
 * the family's own list, so a type that does not belong to the system under test is refused where it
 * is written rather than appearing in a reading as though the system had it.
 */
export const OS_SETTING_TYPES: Readonly<Record<OsFamily, readonly string[]>> = Object.freeze({
  windows: ["REG_SZ", "REG_DWORD"],
  macos: ["string", "integer", "boolean"],
});

/**
 * One command, as it actually ran.
 *
 * `argv` is recorded as resolved, not as written: if the world substituted a program for the one the
 * application named, the substitution is in the record rather than in a log line nobody keeps. That
 * is the property that makes `os.ran` a question about what happened rather than about what was
 * asked - and the difference is exactly the difference between a simulated world and a stub.
 */
export interface OsExecRecord {
  readonly source: OsExecSource;
  /** The argv the world executed. `argv[0]` is the resolved path when the world resolved one. */
  readonly argv: readonly string[];
  /** The program as the caller named it, before any resolution. What a criterion targets. */
  readonly program: string;
  readonly result: OsExecResult;
  /** `null` when nothing was spawned, because a refusal has no exit code and must not be given one. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why the world refused, when it did. `null` otherwise. */
  readonly reason: string | null;
  readonly durationMs: number;
}

/**
 * One file, as the world's tree walk found it.
 *
 * `text` is the bounded contents rather than a promise to read them, because a validator may not open
 * anything - and because a bundle that records "the file contained X at observation time" is evidence,
 * while a bundle that records a path is an invitation to read a file that has since been reset.
 *
 * There is no `mode` here, and that is the family's central difference from `sim-posix`. On Windows a
 * file has no mode; on either family the question "what may this account do with it" is answered by
 * the security record rather than by three octal digits, and it lives in {@link OsAclReading} where
 * the entries that decided it can be read beside the decision.
 */
export interface OsFileReading {
  /**
   * As the system spells it: `C:\ProgramData\Veridian\policy.conf`, or
   * `/Library/Application Support/veridian/policy.conf`. Never as the host spells it.
   */
  readonly path: string;
  readonly kind: OsFileKind;
  readonly bytes: number;
  readonly owner: string;
  readonly group: string;
  readonly sha256: string | null;
  /** Whole contents when they are text and within the bound; `null` otherwise. */
  readonly text: string | null;
  /** Why `text` is null, when it is. Never a silent absence. */
  readonly textWithheld: string | null;
}

/** One entry of a security record. `allow: false` is an explicit deny, which outranks an allow. */
export interface OsAclEntry {
  readonly account: string;
  readonly permission: OsPermission;
  readonly allow: boolean;
  /** `true` when the entry came from a parent rather than being set on this object. */
  readonly inherited: boolean;
}

/**
 * What the world decided for one (account, permission) pair, and which entry decided it.
 *
 * This is the field that keeps the access question honest. A validator may not re-implement
 * `AccessCheck` from an entry list - the ordering rules, the inheritance rules and the
 * deny-beats-allow rule are exactly the part of a real system that is easy to model *almost*
 * correctly, and a model that is almost correct produces a confident wrong answer. So the world
 * decides and records the decision with its reason, and a criterion judges the decision.
 */
export interface OsAccessDecision {
  readonly account: string;
  readonly permission: OsPermission;
  readonly decision: OsAccessDecisionValue;
  /** Which entry decided it, in words. The audit trail for the decision above. */
  readonly because: string;
}

/** How access to one path is governed, and what the world concluded from it. */
export interface OsAclReading {
  readonly path: string;
  /** The owning account, repeated here so an ACL can be read without the file list to hand. */
  readonly owner: string;
  /** The POSIX bits, on a family that has them. `null` on Windows, which has none. */
  readonly mode: string | null;
  readonly entries: readonly OsAclEntry[];
  /** The decisions, for every account the world knows and both permissions it decides. */
  readonly decisions: readonly OsAccessDecision[];
}

/** One account the system holds. */
export interface OsAccountReading {
  readonly name: string;
  readonly kind: OsAccountKind;
  /** The account's own directory, as the system spells it. Empty when the family has no concept of one. */
  readonly home: string;
  readonly groups: readonly string[];
  /** Which command created it. `world` for the accounts a system ships with. */
  readonly createdBy: OsSettingWriter;
}

/**
 * One named value in the platform's own configuration store.
 *
 * The store is addressed differently by each family and the reading keeps the family's own addressing
 * rather than flattening it: {@link container} is a registry key path on Windows and a preference
 * domain on macOS, and {@link name} is the value's name within it. Flattening them into one dotted
 * string would be the world inventing a third addressing scheme and then judging criteria written in
 * it, which is a substitution nobody asked for.
 */
export interface OsSettingReading {
  /** `system` for a machine-wide value, `user` for one scoped to an account. */
  readonly scope: "system" | "user";
  readonly container: string;
  readonly name: string;
  /** The value as text, so `equals` is a sentence with exactly one reading. */
  readonly value: string;
  /** The store's own type word, from {@link OS_SETTING_TYPES} for this family. */
  readonly type: string;
  readonly writtenBy: OsSettingWriter;
}

/** One service the system holds. */
export interface OsServiceReading {
  readonly name: string;
  readonly status: OsServiceStatus;
  readonly enabled: boolean;
  readonly command: string;
  readonly pid: number | null;
  /** The account the service runs as. Empty when the world could not read one out of its definition. */
  readonly account: string;
  /** The port the service's own command line asked for, or `null` when it asked for none. */
  readonly port: number | null;
}

/**
 * The document every `os.*` validator reads.
 *
 * `caseSensitive` is recorded rather than implied, because it is the one path semantic that decides
 * whether two different target spellings are the same path - and a reading that left it out would
 * make a `PASS` on a case-folding volume indistinguishable from a `PASS` on a case-sensitive one.
 */
export interface OsObservationData {
  readonly host: string;
  readonly family: OsFamily;
  /** The recorded identity: `Windows 11 23H2`, `macOS 14.5`. A record, not an installed image. */
  readonly system: string;
  readonly root: string;
  readonly user: string;
  readonly caseSensitive: boolean;
  readonly simulated: readonly OsSimulatedSurface[];
  readonly execs: readonly OsExecRecord[];
  readonly files: readonly OsFileReading[];
  readonly acls: readonly OsAclReading[];
  readonly accounts: readonly OsAccountReading[];
  readonly settings: readonly OsSettingReading[];
  readonly services: readonly OsServiceReading[];
}

// ---- structural checks ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || typeof value === "number";

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isExec = (value: unknown): value is OsExecRecord =>
  isRecord(value) &&
  typeof value["source"] === "string" &&
  isStringArray(value["argv"]) &&
  typeof value["program"] === "string" &&
  typeof value["result"] === "string" &&
  isNullableNumber(value["exitCode"]) &&
  typeof value["stdout"] === "string" &&
  typeof value["stderr"] === "string" &&
  isNullableString(value["reason"]) &&
  typeof value["durationMs"] === "number";

const isFile = (value: unknown): value is OsFileReading =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  typeof value["kind"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["owner"] === "string" &&
  typeof value["group"] === "string" &&
  isNullableString(value["sha256"]) &&
  isNullableString(value["text"]) &&
  isNullableString(value["textWithheld"]);

const isAclEntry = (value: unknown): value is OsAclEntry =>
  isRecord(value) &&
  typeof value["account"] === "string" &&
  typeof value["permission"] === "string" &&
  typeof value["allow"] === "boolean" &&
  typeof value["inherited"] === "boolean";

const isAccessDecision = (value: unknown): value is OsAccessDecision =>
  isRecord(value) &&
  typeof value["account"] === "string" &&
  typeof value["permission"] === "string" &&
  typeof value["decision"] === "string" &&
  typeof value["because"] === "string";

const isAcl = (value: unknown): value is OsAclReading =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  typeof value["owner"] === "string" &&
  isNullableString(value["mode"]) &&
  Array.isArray(value["entries"]) &&
  value["entries"].every(isAclEntry) &&
  Array.isArray(value["decisions"]) &&
  value["decisions"].every(isAccessDecision);

const isAccount = (value: unknown): value is OsAccountReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["kind"] === "string" &&
  typeof value["home"] === "string" &&
  isStringArray(value["groups"]) &&
  typeof value["createdBy"] === "string";

const isSetting = (value: unknown): value is OsSettingReading =>
  isRecord(value) &&
  typeof value["scope"] === "string" &&
  typeof value["container"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["value"] === "string" &&
  typeof value["type"] === "string" &&
  typeof value["writtenBy"] === "string";

const isService = (value: unknown): value is OsServiceReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["status"] === "string" &&
  typeof value["enabled"] === "boolean" &&
  typeof value["command"] === "string" &&
  isNullableNumber(value["pid"]) &&
  typeof value["account"] === "string" &&
  isNullableNumber(value["port"]);

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a system document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs: the first sends an agent to the application, the second to the
 * environment.
 */
export function isOsObservationData(value: unknown): value is OsObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["host"] !== "string") return false;
  if (typeof value["family"] !== "string") return false;
  if (typeof value["system"] !== "string") return false;
  if (typeof value["root"] !== "string") return false;
  if (typeof value["user"] !== "string") return false;
  if (typeof value["caseSensitive"] !== "boolean") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!Array.isArray(value["execs"]) || !value["execs"].every(isExec)) return false;
  if (!Array.isArray(value["files"]) || !value["files"].every(isFile)) return false;
  if (!Array.isArray(value["acls"]) || !value["acls"].every(isAcl)) return false;
  if (!Array.isArray(value["accounts"]) || !value["accounts"].every(isAccount)) return false;
  if (!Array.isArray(value["settings"]) || !value["settings"].every(isSetting)) return false;
  return Array.isArray(value["services"]) && value["services"].every(isService);
}

// ---- resolving a target, in the family's own spelling --------------------------------------------

/**
 * The result of turning a criterion's target into a value this world can look up.
 *
 * A discriminated result rather than `string | null`, and that is the one place this file deliberately
 * does better than `posix-observation.ts`. There, a target that did not resolve came back as `null`,
 * and the validator had to write one message covering every reason it might not have - which is the
 * shape of an error message naming a cause its reporter did not observe. Here the *resolver* is the
 * thing that knows why, so the reason travels with the refusal and the validator quotes it.
 */
export type OsTargetResult<T> =
  | { readonly kind: "target"; readonly value: T }
  | { readonly kind: "refused"; readonly reason: string };

const refused = <T>(reason: string): OsTargetResult<T> => ({ kind: "refused", reason });
const resolved = <T>(value: T): OsTargetResult<T> => ({ kind: "target", value });

/**
 * Whether volumes in each family fold case.
 *
 * A table rather than a hard-coded answer, because it is a property of the *family* and every reader
 * of the vocabulary is entitled to ask about a family rather than about this world's opinion. Both
 * families this world stands in for fold case on their default volumes; the Linux system `sim-posix`
 * stands in for is the one that does not. Writing that down is the point: a criterion that finds a
 * file spelled with the wrong case passes here and would fail there, and the reading says which world
 * it was.
 */
export const OS_CASE_FOLDING: Readonly<Record<OsFamily, boolean>> = Object.freeze({
  windows: true,
  macos: true,
});

/** Whether the family's default volume treats two spellings as one path. */
export function caseSensitive(family: OsFamily): boolean {
  return !OS_CASE_FOLDING[family];
}

/**
 * The accounts a hardening contract may not be judged as, per family, in lower case.
 *
 * The same rule `readPosix` applies to `root`, written where the family vocabulary lives rather than
 * where the refusal happens, because it is a fact about the systems rather than about the loader. An
 * account on this list holds every permission on its system, so a criterion that asked whether a file
 * is unreadable - decided as this account - would answer about a machine nobody can log into, and the
 * answer would be `FAIL` for a file that is in fact world-readable.
 *
 * `SYSTEM` on Windows and `root` on macOS are the unconstrained ones; `Administrator` is included for
 * Windows because an elevated administrator token carries the backup privilege, which is the right to
 * read a file whatever its ACL says - so it is unconstrained for exactly the question this family
 * asks.
 */
export const PRIVILEGED_OS_ACCOUNTS: Readonly<Record<OsFamily, readonly string[]>> = Object.freeze({
  windows: ["system", "localsystem", "administrator"],
  macos: ["root", "wheel"],
});

/** The sandbox root as this family spells it, for a message that has to show one. */
export function rootSpelling(family: OsFamily): string {
  return family === "windows" ? "C:\\" : "/";
}

/**
 * A path as the *system* spells it, canonicalised, or the reason it cannot be used.
 *
 * Targets are written as the system spells them - `C:\ProgramData\Veridian\policy.conf` on Windows,
 * `/Library/Application Support/veridian/policy.conf` on macOS - because that is the only spelling
 * that survives the world being run on a different machine. **A target spelled for the other family
 * is refused by name**, not repaired: silently rewriting `/etc/veridian` into `\etc\veridian` would
 * let an operator write a criterion that only works on their laptop, and the failure would surface as
 * a `FAIL` against the application - which is the worst possible place for it to surface.
 *
 * A `..` segment is refused too, and for a reason that is about the world rather than about taste: a
 * sandbox path names a place inside the tree the reading was taken from, and a target that could
 * climb out of it would name a place in the *host's* tree under the sandbox's name.
 */
export function resolveOsPath(family: OsFamily, target: string): OsTargetResult<string> {
  const trimmed = target.trim();
  if (trimmed === "") return refused("a path cannot be empty");

  if (family === "windows") {
    if (trimmed.includes("/")) {
      return refused(
        `this world stands in for ${OS_FAMILY_LABELS.windows}, where a path separates with a ` +
          "backslash, and " + `${JSON.stringify(trimmed)} is spelled for a system that separates ` +
          "with a forward slash. Rewriting it silently would let a criterion pass on one operator's " +
          "machine and report the application as broken on another, so it is refused instead.",
      );
    }
    if (!/^[A-Za-z]:\\/.test(trimmed)) {
      return refused(
        `an absolute path in this world begins with a drive letter, as in ` +
          `\`C:\\ProgramData\\Veridian\`; it received ${JSON.stringify(trimmed)}.`,
      );
    }
    const drive = `${trimmed[0] ?? "C"}`.toUpperCase();
    const rest = trimmed.slice(2).replace(/\\{2,}/g, "\\").replace(/\\+$/, "");
    const segments = rest.split("\\").filter((segment) => segment !== "");
    if (segments.includes("..")) {
      return refused(
        "a path with a `..` segment names a place outside the tree it was read from, so this world " +
          "will not resolve it - the reading only ever holds places inside the sandbox.",
      );
    }
    return resolved(segments.length === 0 ? `${drive}:\\` : `${drive}:\\${segments.join("\\")}`);
  }

  if (trimmed.includes("\\")) {
    return refused(
      `this world stands in for ${OS_FAMILY_LABELS.macos}, where a path separates with a forward ` +
        "slash, and " + `${JSON.stringify(trimmed)} is spelled for a system that separates with a ` +
        "backslash. Rewriting it silently would let a criterion pass on one operator's machine and " +
        "report the application as broken on another, so it is refused instead.",
    );
  }
  if (!trimmed.startsWith("/")) {
    return refused(
      `an absolute path in this world is written from the sandbox root, as in ` +
        `\`/Library/Application Support/veridian/policy.conf\`; it received ${JSON.stringify(trimmed)}.`,
    );
  }
  const segments = trimmed.split("/").filter((segment) => segment !== "");
  if (segments.includes("..")) {
    return refused(
      "a path with a `..` segment names a place outside the tree it was read from, so this world " +
        "will not resolve it - the reading only ever holds places inside the sandbox.",
    );
  }
  return resolved(segments.length === 0 ? "/" : `/${segments.join("/")}`);
}

/**
 * The account and path an `os.acl` target names, or the reason it names neither.
 *
 * The form is `<account>:<path>` - `svc:C:\ProgramData\Veridian` - and the separator is unambiguous
 * rather than merely conventional: neither family permits a `:` in an account name, so splitting on
 * the **first** colon is exact even though a Windows path carries one of its own in its drive letter.
 *
 * Two facts in one target is a compromise, and it is the same one `k8s` already makes with
 * `namespace/name`: an access question is *about* an account and a path together, and the schema gives
 * an expectation exactly one `target` field. The alternative - a second field in the expectation, or
 * a validator that quietly judges only the account the criteria act as - would each have been a
 * bigger lie than a documented separator.
 */
export function resolveAclRef(
  family: OsFamily,
  target: string,
): OsTargetResult<{ readonly account: string; readonly path: string }> {
  const trimmed = target.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) {
    return refused(
      "an access question names an account and a path together, written `<account>:<path>` - as in " +
        "`svc:C:\\ProgramData\\Veridian`. This target named no account.",
    );
  }
  const account = trimmed.slice(0, colon).trim();
  const rest = trimmed.slice(colon + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(account)) {
    return refused(
      `${JSON.stringify(account)} is not an account name this world can look up. Account names begin ` +
        "with a letter and hold letters, digits, dots, dashes and underscores.",
    );
  }
  const path = resolveOsPath(family, rest);
  if (path.kind === "refused") return path;
  return resolved({ account, path: path.value });
}

/**
 * The container an `os.setting` target names, in the family's own addressing.
 *
 * A registry key path on Windows (`HKLM\SOFTWARE\Veridian\Policy`) and a preference domain on macOS
 * (`com.example.veridian`). The two are refused for each other, on the same rule as a path.
 *
 * `HKCU` is refused **by name**, and that refusal is deliberate rather than an omission. A
 * per-user autostart entry is a real persistence mechanism, but it is not what this world's criteria
 * are about: the plan states one account, the readings are taken as that account, and a store scoped
 * to whoever happened to be logged in when the run started would be judged against a user nobody
 * named. Refusing it here means the criterion that reaches for it is told so, in the words it needs,
 * rather than silently resolving to a store the world does not hold.
 */
export function resolveSettingContainer(
  family: OsFamily,
  target: string,
): OsTargetResult<string> {
  const trimmed = target.trim();
  if (trimmed === "") return refused("a store location cannot be empty");

  if (family === "windows") {
    if (trimmed.includes("/")) {
      return refused(
        `this world stands in for ${OS_FAMILY_LABELS.windows}, where the store is addressed with ` +
          `backslashes; it received ${JSON.stringify(trimmed)}.`,
      );
    }
    const segments = trimmed.split("\\").filter((segment) => segment !== "");
    const hive = (segments[0] ?? "").toUpperCase();
    if (hive !== "HKLM") {
      if (hive === "HKCU") {
        return refused(
          "this world holds the machine-wide store only. A per-user autostart entry is a real " +
            "persistence mechanism, but this plan names one account and the readings are taken as " +
            "that account - so a store scoped to whoever was logged in would be judged against a " +
            "user nobody described.",
        );
      }
      return refused(
        `the store is addressed from a hive, and this world holds \`HKLM\` alone; it received ` +
          `${JSON.stringify(segments[0] ?? trimmed)}.`,
      );
    }
    if (segments.length < 2) {
      return refused(
        `a hive on its own is not a store location; name the key under it, as in ` +
          `\`HKLM\\SOFTWARE\\Veridian\\Policy\` (received ${JSON.stringify(trimmed)}).`,
      );
    }
    return resolved(`HKLM\\${segments.slice(1).join("\\")}`);
  }

  if (trimmed.includes("\\") || trimmed.includes(":")) {
    return refused(
      `this world stands in for ${OS_FAMILY_LABELS.macos}, where the store is addressed by ` +
        `preference domain - \`com.example.veridian\`; it received ${JSON.stringify(trimmed)}.`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    return refused(
      `a preference domain is a reverse-DNS name, as in \`com.example.veridian\`; it received ` +
        `${JSON.stringify(trimmed)}.`,
    );
  }
  return resolved(trimmed);
}

// ---- the questions a family asks of the document -------------------------------------------------

/**
 * The file the reading holds at `path`, or `null`. Exact, because a path is a name and not a pattern -
 * except on a family whose volumes fold case, where the comparison folds with them.
 *
 * The folding is the family's semantics and not a convenience: on a real Windows volume
 * `C:\ProgramData\Veridian` and `c:\programdata\veridian` are one directory, and a reading that
 * refused to see that would report the operator's capitalisation as a defect in the application.
 * `caseSensitive` is in the reading so a reader can tell which world produced the answer.
 */
export function fileOn(data: OsObservationData, path: string): OsFileReading | null {
  if (!caseSensitive(data.family)) {
    const folded = path.toLowerCase();
    return data.files.find((file) => file.path.toLowerCase() === folded) ?? null;
  }
  return data.files.find((file) => file.path === path) ?? null;
}

export function aclAt(data: OsObservationData, path: string): OsAclReading | null {
  if (!caseSensitive(data.family)) {
    const folded = path.toLowerCase();
    return data.acls.find((acl) => acl.path.toLowerCase() === folded) ?? null;
  }
  return data.acls.find((acl) => acl.path === path) ?? null;
}

export function accountNamed(data: OsObservationData, name: string): OsAccountReading | null {
  return data.accounts.find((account) => account.name === name) ?? null;
}

export function serviceNamed(data: OsObservationData, name: string): OsServiceReading | null {
  return data.services.find((service) => service.name === name) ?? null;
}

/** Every value the store holds under one container, in the order the store keeps them. */
export function settingsIn(data: OsObservationData, container: string): readonly OsSettingReading[] {
  return data.settings.filter((setting) => setting.container === container);
}

/**
 * The container's contents as one text, which is what `os.setting` judges.
 *
 * One `name=value` line per value, sorted by name, joined with `\n` - and the empty string when the
 * container holds nothing, which is what makes "this store holds no autostart entry" a sentence a
 * criterion can write as `equals: ""`.
 *
 * A rendering rather than a list, because the interesting question about a persistence mechanism is
 * about the container as a whole: "does this key hold an autostart value" is `contains: "Autostart="`,
 * and "does it hold only what we put there" is `equals: "LogLevel=warn;Path=..."`. A criterion that
 * could only ask about one named value at a time could not ask either of those.
 *
 * Values are single-line by construction - the world refuses a value carrying a newline, naming why -
 * so the join is unambiguous and a `contains` cannot match across two entries.
 */
export function settingValues(values: readonly OsSettingReading[]): string {
  return [...values]
    .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
    .map((setting) => `${setting.name}=${setting.value}`)
    .join("\n");
}

/**
 * The permissions one account holds at a path, rendered canonically, or `null` when the reading does
 * not hold that pair.
 *
 * `"none"` when the world refused every permission, and the distinction between `"none"` and `null`
 * is the whole reason this returns a nullable string: `null` means *no decision was recorded*, which
 * is a gap in the reading and is judged `INCONCLUSIVE`, while `"none"` means *the world decided and
 * the answer is no*, which is a fact and is judged `FAIL` when the criterion expected otherwise.
 */
export function accessOf(
  acl: OsAclReading,
  account: string,
  permission: OsPermission,
): OsAccessDecisionValue | null {
  const found = acl.decisions.find(
    (entry) =>
      entry.permission === permission && entry.account.toLowerCase() === account.toLowerCase(),
  );
  return found?.decision ?? null;
}

/** The permissions an account holds at a path, rendered `read,write` / `read` / `none`. */
export function permissionsOf(acl: OsAclReading, account: string): string | null {
  const held: string[] = [];
  for (const permission of OS_PERMISSIONS) {
    const decision = accessOf(acl, account, permission);
    if (decision === null) return null;
    if (decision === "permitted") held.push(permission);
  }
  return held.length === 0 ? "none" : held.join(",");
}

/**
 * Every execution of one program, in the order they happened.
 *
 * Keyed on the *program as the caller named it*, not on `argv[0]`, and the distinction is load
 * bearing: `argv[0]` holds the resolved path when the world substituted a program, so keying on it
 * would make `os.ran` unfindable for exactly the commands the world substituted - the ones a
 * criterion is most likely to ask about.
 */
export function execsOf(data: OsObservationData, program: string): readonly OsExecRecord[] {
  return data.execs.filter((exec) => exec.program === program);
}

/**
 * A number as a port, or `null` when the target is not one.
 *
 * Refused rather than coerced: `Number("")` is `0`, `Number(" 80 ")` is `80`, and a target that
 * silently becomes port 0 would be judged as a closed port and reported as a `FAIL` against a service
 * that closed nothing.
 */
export function portNumber(target: string): number | null {
  if (!/^\d{1,5}$/.test(target)) return null;
  const value = Number(target);
  return value >= 1 && value <= 65535 ? value : null;
}
