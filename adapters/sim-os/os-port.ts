/**
 * The substitute an operating-system world acts through: Windows and macOS, modelled rather than
 * installed.
 *
 * ## What is real, and what is substituted
 *
 * Three things are real, and they are the three that make a verdict from this world worth having:
 *
 * - **The sandbox is a real tree.** The world is rooted at a directory on this host, and the files the
 *   application writes are real files with real lengths and real SHA-256 hashes. `read()` walks them
 *   with `readdir` and `lstat`; nothing in a `bytes` or a `sha256` field is invented. When the
 *   application's provisioner writes a file with `node:fs`, it appears in the next reading **without
 *   the world being told**, which is the property that separates a modelled world from a stub.
 * - **The services bind real sockets.** Starting a service that declares a port binds a real TCP port
 *   on `127.0.0.1`, and the reading reports `running` only after a real `connect(2)` reached it.
 *   Stopping the service really closes the socket. A service's state is therefore earned rather than
 *   replayed from the fact that a start command ran.
 * - **The application process is real.** It is an ordinary child process with the operator's own
 *   privileges, run through the same `ProcessRunner` the rest of Veridian uses, and its exit code,
 *   stdout and stderr are its own.
 *
 * What is substituted is named in {@link OS_SIMULATED_SURFACES} and carried by every reading: the
 * kernel (there is none - no syscall isolation and no ABI), the system identity (a recorded string,
 * not an installed image), path semantics, the access decision, the configuration store, the service
 * manager, egress, and the provisioning channel itself. `registry` and `preferences` are per-family,
 * and the reading carries only the one that applies, so the list states what stood in for *this*
 * system rather than what either family might have needed.
 *
 * ## Why a program register rather than a directory of scripts
 *
 * Every command this world performs is answered **in process**, by a function in a register keyed by
 * the program's name. Nothing is spawned to answer a command. That is deliberate, and the reason is
 * the same one `sim-posix` gives: a real `icacls` or `reg` would have to be an executable, and an
 * executable would have to be interpreted, which introduces a *second* substitution with its own
 * quoting rules to get wrong. The reflective part is that the argument vector is preserved exactly -
 * what the application said is what the world executes, with no word-splitting layer in between that
 * could disagree about it.
 *
 * **A program the world does not answer is refused by name**, in a record that lists what it does
 * answer, and the refusal is a fact a criterion may be built on. It is never faked, and it is never
 * silently a no-op - a world that quietly did nothing for an unregistered command would report a
 * clean system for a provisioner that never ran.
 *
 * ## The access decision, and why the world decides it
 *
 * `Read this file as this account` is the question this family exists for, and it is the one a POSIX
 * mode cannot express. Windows has no mode at all: an ACL is a list of `(account, permission,
 * allow|deny)` entries whose *meaning* depends on inheritance and on deny-beats-allow. So this world
 * keeps its own security record and reaches a **decision**, and {@link OsAclReading.decisions} records
 * the decision together with the entry that produced it.
 *
 * There is **one rule**, and it is written once, in {@link decide}, for both families. macOS arrives
 * at entries from `chmod` and `chown` rather than from an ACL editor, but the entries are the same
 * shape and the decision is reached by the same code - because two implementations of one rule
 * disagree the first time a world arrives that only one of them was written for, and that has already
 * cost this repository once.
 *
 * The host may be Linux or macOS, where `icacls` does not exist and where a sandbox tree's real ACLs
 * are whatever that filesystem decided. Asking the host would report the host's answer, and would
 * report it *differently on a different platform*, which breaks the one property a validation world
 * exists to provide. The decision is therefore the world's, taken against its own record, exactly as
 * a kernel reaches `AccessCheck` against a security descriptor - and the substitution is declared
 * rather than implied.
 *
 * ## A read must not mutate
 *
 * `read()` is a pure function of the world's state. It advances no counter, records no event and
 * starts no listener; it writes nothing and it changes nothing. It does open sockets, because a
 * connect is an *observation* of a listening port and not a change to one - but it never *makes* the
 * port listening.
 *
 * That is not fastidiousness. M1 asks whether the same code produced the same result twice, and it
 * answers by comparing two of these documents: a reading that edited what it read would make one
 * world look like two, and a measurement nobody can repeat is an opinion. The same defect was found
 * and fixed in the cluster substitute, where a snapshot's derivation recorded an event and a second
 * read of a namespace reported `count: 2`.
 *
 * ## One lifecycle, one implementation
 *
 * `prepare()` and `reset()` are the same act at two boundaries and there is one `rebuild()` behind
 * both. This is not tidiness: `sim-posix` inherited a tree the previous run had left behind, and two
 * criteria reported `PASS` on a file from someone else's run. *A world a run inherits is not a world
 * that run built*, and a criterion may never pass on an artifact the run did not produce.
 *
 * The exec record is deliberately **not** cleared by a reset. A reset restores the world; it does not
 * restore the record. An iteration that reached outside the boundary must not be followed by a clean
 * one that reports `PASS` with the evidence of the violation destroyed by the very act of repairing
 * it.
 */

import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { join } from "node:path";
import {
  OS_PERMISSIONS,
  OS_SETTING_TYPES,
  OS_SIMULATED_SURFACES,
  caseSensitive,
  resolveOsPath,
  resolveSettingContainer,
} from "../../core/environment/os-observation.ts";
import type {
  OsAccessDecision,
  OsAccountKind,
  OsAccountReading,
  OsAclEntry,
  OsAclReading,
  OsExecRecord,
  OsExecResult,
  OsExecSource,
  OsFamily,
  OsFileReading,
  OsObservationData,
  OsPermission,
  OsServiceReading,
  OsServiceStatus,
  OsSettingReading,
  OsSettingWriter,
  OsSimulatedSurface,
} from "../../core/environment/os-observation.ts";

// ---- the world's own vocabulary -------------------------------------------------------------------

/**
 * The one pseudo-principal both families have.
 *
 * Windows spells it `Everyone` and macOS spells it `everyone`; it is capitalised once here so that an
 * ACL entry naming it is written the same way whichever family the reading came from, and so that a
 * criterion asking whether a file is readable by anybody writes one string rather than two.
 */
export const EVERYONE = "Everyone";

/** The drive letter this world's sandbox answers to. A Windows token naming another one is an escape. */
export const SANDBOX_DRIVE = "C";

/**
 * The file the world writes its own identity into, as each family spells it.
 *
 * Exported because the adapter reads it in `probe()`, and a path two files have to agree about is a
 * path that should exist in one place. It lives *inside* the sandbox tree, so it is disposed of by the
 * same reset that disposes of everything else, and so a run's first iteration cannot read a previous
 * run's identity.
 */
export const OS_IDENTITY_PATHS: Readonly<Record<OsFamily, string>> = Object.freeze({
  windows: "C:\\ProgramData\\Veridian\\identity.json",
  macos: "/var/db/veridian/identity.json",
});

/**
 * Where a named account's own directory is, as the family spells it.
 *
 * Used for the account the world seeds for the plan's user and for accounts a provisioner creates, so
 * that "the service account has a home directory under `Users`" is a real place rather than a string
 * the world made up.
 */
export function homeOf(family: OsFamily, account: string): string {
  return family === "windows" ? `C:\\Users\\${account}` : `/Users/${account}`;
}

/**
 * Whether one argument names a place outside the sandbox.
 *
 * Two shapes, both real rather than hypothetical. A `..` segment walks out of the tree by
 * construction. A Windows token naming a drive other than the sandbox's names a **drive of this
 * machine** - and because this world drops the drive letter when it maps a path onto a host path, a
 * token naming `D:` would be silently rewritten onto the sandbox and read a file the developer keeps
 * outside it while the reading described it as the world's own. Refused instead, so a criterion may
 * assert that this world is contained and have that assertion mean something.
 *
 * **Exported, and the reason is that two callers need the same answer.** The port refuses the command;
 * the adapter watches for the *application's* attempts so it can file a boundary crossing. Written
 * twice, the two would agree on `..` and disagree the first time a token named another drive - which
 * is the case only one of them would have been written for. One rule, one place.
 */
export function osEscapes(family: OsFamily, token: string): boolean {
  const segments = token.split(/[\\/]/);
  if (segments.includes("..")) return true;
  if (family !== "windows") return false;
  const drive = /^([A-Za-z]):/.exec(token);
  return drive !== null && (drive[1] ?? "").toUpperCase() !== SANDBOX_DRIVE;
}

/**
 * The directories each family's system has, created before the application's provisioner runs.
 *
 * A short list rather than a filesystem image, and that is the honest shape: this world does not
 * install a system, it *builds a small one whose layout is a fact a hardening contract can name*. The
 * layout is real, so a criterion that says "the policy file is not inside the directory the system
 * serves from" is a criterion about this world and not about a convention nothing holds.
 */
const SEED_DIRECTORIES: Readonly<Record<OsFamily, readonly string[]>> = Object.freeze({
  windows: [
    "C:\\ProgramData\\Veridian",
    "C:\\Program Files\\Veridian",
    "C:\\Windows\\System32\\drivers\\etc",
    "C:\\Windows\\Temp",
  ],
  macos: [
    "/Library/Application Support/veridian",
    "/Library/LaunchDaemons",
    "/etc",
    "/var/db/veridian",
    "/var/log",
    "/tmp",
  ],
});

/**
 * The accounts each family's system ships with.
 *
 * Both lists include the accounts a hardening contract most often asks about and, just as important,
 * the accounts it most often gets *wrong*: `SYSTEM` and `root` are here so that a criterion naming
 * them finds them rather than reporting a missing account, and so that the loader's refusal of them as
 * the *criteria's* account has something to refuse.
 *
 * `Everyone` is deliberately absent. It is a well-known principal rather than an account, it holds no
 * home directory and no group membership, and listing it here would make "the account `Everyone`
 * exists" a fact about the system rather than about the one entry every ACL is written with.
 */
const BASE_ACCOUNTS: Readonly<Record<OsFamily, readonly OsAccountReading[]>> = Object.freeze({
  windows: [
    { name: "SYSTEM", kind: "service", home: "", groups: ["SYSTEM"], createdBy: "world" },
    {
      name: "Administrator",
      kind: "user",
      home: "C:\\Users\\Administrator",
      groups: ["Administrators"],
      createdBy: "world",
    },
  ],
  macos: [
    { name: "root", kind: "user", home: "/var/root", groups: ["wheel"], createdBy: "world" },
    { name: "_www", kind: "service", home: "/var/empty", groups: ["_www"], createdBy: "world" },
  ],
});

/** The POSIX bits a seeded directory and a seeded file carry on the family that has modes. */
const DIRECTORY_MODE = "0755";
const FILE_MODE = "0644";

/** The cap on the text a reading carries for one file, in bytes. */
const TEXT_BOUND = 64 * 1024;

// ---- shapes -------------------------------------------------------------------------------------- 

/** How one command ended, as a register entry states it. */
interface Outcome {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Overrides the result derived from the exit code. Used only for a refusal. */
  readonly result?: OsExecResult;
  readonly reason?: string;
}

/** One command the world is asked to perform. */
export interface OsExecRequest {
  readonly argv: readonly string[];
  readonly source: OsExecSource;
}

/**
 * What governs access to one path.
 *
 * `mode` is the family's own spelling of the POSIX bits and is `null` on Windows, which has none. It
 * is a *reading* field only: the decision is reached from {@link entries} on both families, so a
 * criterion cannot pass here on three octal digits that a real `AccessCheck` would have overruled.
 */
interface SecurityRecord {
  owner: string;
  mode: string | null;
  entries: OsAclEntry[];
}

/** A service the world holds. `pid` is assigned once, when it starts, and never re-derived. */
interface ServiceState {
  running: boolean;
  pid: number | null;
  command: string;
  account: string;
  port: number | null;
}

/** A register entry: a program name resolved to the work this world performs for it. */
type Handler = (argv: readonly string[]) => Promise<Outcome>;

/**
 * The interface the adapter depends on, so the adapter's own behaviour is testable without a tree.
 *
 * The same seam `sim-posix`, `sim-k8s` and `local-db` each declare. `record()` is separate from
 * `exec()` on purpose: the *application's* own process is run by the adapter through Veridian's
 * `ProcessRunner`, so the adapter hands the world the record of it rather than the world spawning it
 * a second time - and a reading that held only what the *criteria* ran could not answer the first
 * question worth asking about a failed provisioning.
 */
export interface OsPort {
  /** Build the system from nothing, then seed it. */
  prepare(): Promise<void>;
  /** The same act, at an iteration boundary. */
  reset(): Promise<void>;
  exec(request: OsExecRequest): Promise<OsExecRecord>;
  record(record: OsExecRecord): void;
  /** Copy the tree and the world's own bookkeeping somewhere else. */
  snapshot(destination: string): Promise<void>;
  /** Rebuild the tree from a snapshot and put the bookkeeping back. */
  restoreFrom(source: string): Promise<void>;
  read(): Promise<OsObservationData>;
  /** Release the listeners. Never removes the root, so a bundle's paths still resolve. */
  stop(): Promise<void>;
}

export interface OsPortOptions {
  /** The sandbox root on this host. The world's `C:\` or `/` is this directory. */
  readonly root: string;
  readonly family: OsFamily;
  /** The release the readings name, e.g. `Windows 11 23H2`. A record, not an installed image. */
  readonly system: string;
  /** The account the criteria act as. Access is decided *as* this account. */
  readonly user: string;
}

// ---- pure helpers ---------------------------------------------------------------------------------

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Whether two account names are the same account.
 *
 * Folded, on both families, and for a reason that is about the systems rather than about convenience:
 * Windows account names are case-insensitive by construction, and macOS resolves `staff` and `Staff`
 * to one group. A world that compared them exactly would report a missing account for an entry that
 * names it in different case - a `FAIL` against the application for a fact about the world's string
 * comparison.
 */
const sameAccount = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/**
 * A number this world hands out as a process id, starting above the range a real system reserves.
 *
 * Monotonic within a world's lifetime and stored in the service record rather than re-derived, so that
 * two readings of one world report the same id and M1 can compare them. A restore puts the counter
 * back beside the services it names, because a snapshot that restored `pid: 1204` while leaving the
 * counter at 1200 would hand the *next* service an id the world already holds.
 */
const FIRST_PID = 1200;

/**
 * The port a service's own command line asked for, or `null` when it asked for none.
 *
 * One documented spelling, both families: `--port 8080` or `--port=8080` or `/port:8080` inside the
 * service's command text. A service whose command declares no port binds nothing, and the reading
 * says `port: null` rather than guessing - which is why a service can be `running` without a socket
 * and a criterion about a port has to name a service that declared one.
 */
function portIn(command: string): number | null {
  const match = /(?:--port[= ]|\/port[:=])\s*(\d{1,5})/.exec(command);
  const digits = match?.[1];
  if (digits === undefined) return null;
  const value = Number(digits);
  return value >= 1 && value <= 65535 ? value : null;
}

/**
 * The entries a POSIX mode implies, for the accounts a family with modes knows.
 *
 * macOS arrives at an ACL from `chmod` rather than from an ACL editor, and this is where that happens.
 * Owner, group and everyone each get an entry per bit, so the *decision* is reached by the one rule
 * both families share rather than by a second rule written for macOS alone.
 *
 * The owner's group is looked up rather than assumed: a mode's group bits are about the file's group,
 * and a world that attributed them to the owner's primary group would decide access for a group the
 * entry does not name.
 */
function entriesForMode(
  mode: string,
  owner: string,
  group: string,
  inherited: boolean,
): OsAclEntry[] {
  const bits = Number.parseInt(mode.padStart(4, "0").slice(1), 8);
  const ownerBits = (bits >> 6) & 7;
  const groupBits = (bits >> 3) & 7;
  const otherBits = bits & 7;
  const entries: OsAclEntry[] = [];
  const add = (account: string, allowed: number): void => {
    if ((allowed & 4) !== 0) entries.push({ account, permission: "read", allow: true, inherited });
    if ((allowed & 2) !== 0) entries.push({ account, permission: "write", allow: true, inherited });
  };
  add(owner, ownerBits);
  add(group, groupBits);
  add(EVERYONE, otherBits);
  return entries;
}

/**
 * The subset of a property list this world understands.
 *
 * Real launchd reads an XML property list in full, with nested dictionaries and typed values. This
 * world reads the three shapes a service definition actually uses: `key`/`string` and `key`/`integer`
 * pairs, and `ProgramArguments` as an array of strings.
 *
 * It returns `null` for anything it cannot read, and that is deliberate rather than a fallback: a plist
 * this world cannot read is a plist whose service it cannot hold, and `launchctl load` says so by name
 * rather than registering a service with an empty command line. A registered service with no command
 * is exactly the shape of a clean reading for a program that never ran.
 */
function parsePlist(
  text: string,
): Readonly<Record<string, string | number | boolean | readonly string[]>> | null {
  const keys = [...text.matchAll(/<key>([\s\S]*?)<\/key>/g)];
  if (keys.length === 0) return null;
  const found: Record<string, string | number | boolean | readonly string[]> = {};
  for (let index = 0; index < keys.length; index += 1) {
    const match = keys[index];
    if (match === undefined || match.index === undefined) continue;
    const name = decodeEntities(match[1] ?? "");
    const bodyStart = match.index + match[0].length;
    const next = keys[index + 1];
    const bodyEnd = next?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd);
    const value = /<([a-z]+)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    if (value === null) continue;
    const tag = value[1] ?? "";
    if (tag === "array") {
      found[name] = [...body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((entry) =>
        decodeEntities(entry[1] ?? ""),
      );
      continue;
    }
    if (tag === "string") {
      found[name] = decodeEntities(value[2] ?? "");
      continue;
    }
    if (tag === "integer") {
      found[name] = Number(value[2] ?? "0");
      continue;
    }
    if (tag === "true") {
      found[name] = true;
      continue;
    }
    if (tag === "false") {
      found[name] = false;
    }
  }
  return found;
}

// ---- the world ------------------------------------------------------------------------------------

/**
 * Build a substitute operating system at `options.root`.
 *
 * Every mutable fact lives in this closure, which is what makes a world disposable: `osPort(...)`
 * twice is two worlds, and `rebuild()` returns one of them to its opening state.
 */
export function osPort(options: OsPortOptions): OsPort {
  const { root, family, system, user } = options;
  const seededAccounts = BASE_ACCOUNTS[family];

  /** The security record for each path the world governs. A path with no record is not governed. */
  const security = new Map<string, SecurityRecord>();
  /** Every account this world holds, including the one the criteria act as. */
  const accounts = new Map<string, OsAccountReading>();
  /** The store, in the family's own addressing. Keyed by path rather than by name, like the rest. */
  const settings = new Map<string, OsSettingReading>();
  const services = new Map<string, ServiceState>();
  /** The real loopback listeners. A port in here is a port something can actually reach. */
  const listeners = new Map<number, Server>();
  const execs: OsExecRecord[] = [];
  let nextPid = FIRST_PID;

  // ---- the two spellings, and the one place they meet --------------------------------------------

  /**
   * Map a path as the *system* spells it onto a path on *this host*.
   *
   * This is the only place the two spellings meet, and keeping it to one place is the rule `sim-posix`
   * learned: a world with two conversions has two chances to disagree about which filesystem a reading
   * describes. The drive letter is dropped rather than honoured, because the world's `C:\` is not this
   * machine's `C:\` - it is a directory, and a command naming a different drive is refused as an
   * escape before it gets here.
   */
  const hostOf = (sandboxPath: string): string => {
    const segments =
      family === "windows"
        ? sandboxPath.replace(/^[A-Za-z]:[\\/]?/, "").split("\\")
        : sandboxPath.split("/");
    return join(root, ...segments.filter((segment) => segment !== ""));
  };

  /** The same path the other way, for a reading's `path` field. */
  const spell = (segments: readonly string[]): string =>
    family === "windows"
      ? segments.length === 0
        ? `${SANDBOX_DRIVE}:\\`
        : `${SANDBOX_DRIVE}:\\${segments.join("\\")}`
      : segments.length === 0
        ? "/"
        : `/${segments.join("/")}`;

  // ---- the security record -----------------------------------------------------------------------

  /**
   * Decide whether one account holds one permission at one path. **The one rule, for both families.**
   *
   * Written out because an access decision computed by a rule nobody stated is a verdict nobody can
   * audit. In order:
   *
   * 1. **An explicit entry naming the subject wins over every inherited one.** That is what *explicit*
   *    means on both families, and it is why `inherited` is a field on the entry rather than a comment.
   * 2. **Among entries of the same kind, a `deny` beats an `allow`.** Both families agree here, and it
   *    is the direction that fails safe: a world that had this backwards would permit reads a real ACL
   *    refuses, which is a false `PASS` on the single question this family exists to answer.
   * 3. **The subject's groups are consulted** when no entry names the subject itself. A group entry is
   *    an entry whose `account` is one of the subject's groups - which is why the vocabulary needs no
   *    `scope` field, and why an ACL written for a group is not invisible to the account inside it.
   * 4. **`Everyone` matches everybody**, and is consulted last among entries of its kind.
   * 5. **Nothing matched: `refused`.** Not "permitted because nobody said no". A resource with no entry
   *    for an account is one that account may not read, which is the answer both families give - and
   *    treating silence as consent is how a hardening contract passes against an unprotected file.
   *
   * `because` names which entry fired, so the decision is auditable rather than authoritative.
   */
  const decide = (
    record: SecurityRecord,
    subject: string,
    groups: readonly string[],
    permission: OsPermission,
  ): OsAccessDecision => {
    const names = (entry: OsAclEntry): boolean =>
      sameAccount(entry.account, subject) ||
      groups.some((group) => sameAccount(entry.account, group)) ||
      sameAccount(entry.account, EVERYONE);

    const describeEntry = (entry: OsAclEntry): string => {
      const kind = entry.allow ? "allow" : "deny";
      const origin = entry.inherited ? "inherited" : "explicit";
      const scope = sameAccount(entry.account, subject)
        ? "this account"
        : sameAccount(entry.account, EVERYONE)
          ? "every account"
          : "a group it belongs to";
      return `an ${origin} ${kind} for \`${entry.account}\` (${scope})`;
    };

    for (const inherited of [false, true]) {
      const candidates = record.entries.filter(
        (entry) => entry.inherited === inherited && entry.permission === permission && names(entry),
      );
      const deny = candidates.find((entry) => !entry.allow);
      if (deny !== undefined) {
        return {
          account: subject,
          permission,
          decision: "refused",
          because: `${describeEntry(deny)} outranks every allow at the same level`,
        };
      }
      const allow = candidates.find((entry) => entry.allow);
      if (allow !== undefined) {
        return { account: subject, permission, decision: "permitted", because: describeEntry(allow) };
      }
    }

    return {
      account: subject,
      permission,
      decision: "refused",
      because:
        "no entry names this account, a group it belongs to, or every account for this permission; " +
        "both families refuse when nothing matches, and this world does not treat silence as consent",
    };
  };

  /**
   * The subjects a decision is computed for: every account the world holds, plus `Everyone`.
   *
   * Enumerated rather than lazily answered, because {@link OsAclReading.decisions} promises the
   * decisions for every account the world knows and `accessOf` looks one up. A reading that held only
   * the subjects somebody had asked about would make the same file look differently governed depending
   * on which criteria ran first.
   */
  const subjects = (): readonly { readonly name: string; readonly groups: readonly string[] }[] => [
    ...[...accounts.values()]
      .map((account) => ({ name: account.name, groups: account.groups }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    { name: EVERYONE, groups: [] },
  ];

  const decisionsFor = (record: SecurityRecord): readonly OsAccessDecision[] => {
    const out: OsAccessDecision[] = [];
    for (const subject of subjects()) {
      for (const permission of OS_PERMISSIONS) {
        out.push(decide(record, subject.name, subject.groups, permission));
      }
    }
    return out;
  };

  /**
   * Record how access to a path is governed. The only way a path becomes governed.
   *
   * The record it stored is returned, and that return value is load-bearing rather than a convenience:
   * {@link recordFor} hands the map a freshly built record and then hands *the same object* back, because
   * a program that mutates the record it was given has to be mutating the world's record. It was two
   * objects once - `note` wrapped what it was given in a new literal, `recordFor` returned its own - and
   * so `icacls` on a file the application had just written (a file with no record yet) removed and
   * granted entries on a copy the map had never seen. Every reading afterwards described the pristine
   * default: a permission the world's own command had reported removing, still granted, in a world whose
   * `read()` was the only thing looking. A command that exits 0 while the world it just edited is
   * unchanged is the substitute lying about its own work, which is the one thing a substitution may not
   * do.
   */
  const note = (
    path: string,
    owner: string,
    mode: string | null,
    entries: OsAclEntry[],
  ): SecurityRecord => {
    const record: SecurityRecord = { owner, mode, entries };
    security.set(path, record);
    return record;
  };

  /**
   * The security record for a path, looked up with the family's case folding.
   *
   * A family whose volumes fold case treats two spellings as one path, and a world that looked the
   * record up exactly would report an unprotected file for a file whose record is spelled with a
   * different capital - a `FAIL` against the application for a fact about the world's map.
   */
  const securityAt = (path: string): SecurityRecord | null => {
    if (caseSensitive(family)) return security.get(path) ?? null;
    const folded = path.toLowerCase();
    for (const [held, record] of security) {
      if (held.toLowerCase() === folded) return record;
    }
    return null;
  };

  /**
   * The security record for a path, creating a default one when the world has none.
   *
   * The default is **the account the world was seeded with owning it, readable by everyone and writable
   * by its owner**, which is what a directory a program creates gets on both families. It is a
   * documented default rather than an empty entry list, because an empty list would make every file a
   * program created unreadable by it, and a criterion would then report a defect about a file the
   * application legitimately wrote.
   */
  const recordFor = (path: string): SecurityRecord => {
    const held = securityAt(path);
    if (held !== null) return held;
    const owner = user;
    const mode = family === "macos" ? FILE_MODE : null;
    const entries: OsAclEntry[] =
      family === "macos"
        ? entriesForMode(FILE_MODE, owner, accounts.get(owner)?.groups[0] ?? owner, false)
        : [
            ...OS_PERMISSIONS.map((permission) => ({
              account: owner,
              permission,
              allow: true,
              inherited: false,
            })),
            { account: EVERYONE, permission: "read" as const, allow: true, inherited: false },
          ];
    // The object the map holds, not a second one that merely starts out equal to it - see `note`.
    return note(path, owner, mode, entries);
  };

  // ---- writing -----------------------------------------------------------------------------------

  const write = async (
    path: string,
    contents: string,
    owner: string,
    mode: string | null,
    entries: OsAclEntry[],
  ): Promise<void> => {
    const hostPath = hostOf(path);
    await mkdir(join(hostPath, ".."), { recursive: true });
    await writeFile(hostPath, contents, "utf8");
    note(path, owner, mode, entries);
  };

  /** A directory or file the *world* created, with the family's own default governance. */
  const worldReadable = (path: string, owner: string, directory: boolean): OsAclEntry[] =>
    family === "macos"
      ? entriesForMode(
          directory ? DIRECTORY_MODE : FILE_MODE,
          owner,
          accounts.get(owner)?.groups[0] ?? owner,
          false,
        )
      : [
          { account: owner, permission: "read", allow: true, inherited: false },
          { account: owner, permission: "write", allow: true, inherited: false },
          { account: EVERYONE, permission: "read", allow: true, inherited: false },
        ];

  // ---- the register ------------------------------------------------------------------------------

  /**
   * Read a file as the account the criteria act as, and let the *decision* answer.
   *
   * The access decision is the whole point: this is not "does the file exist" but "may this account
   * read it", and the answer comes from {@link decide} rather than from a mode the host cannot
   * express. Both families have a program for this - `type` on Windows, `cat` on macOS - and both are
   * answered by this one function, because two spellings of one question should not be two
   * implementations of the answer.
   */
  const readAsAccount = async (path: string): Promise<Outcome> => {
    const held = securityAt(path);
    const stats = await lstat(hostOf(path)).catch(() => null);
    if (stats === null) {
      return { exitCode: 1, stderr: `cannot find the path because it does not exist: ${path}\n` };
    }
    if (stats.isDirectory()) {
      return { exitCode: 1, stderr: `${path}: is a directory\n` };
    }
    const record = held ?? recordFor(path);
    const decision = decide(record, user, accounts.get(user)?.groups ?? [], "read");
    if (decision.decision === "refused") {
      return { exitCode: 1, stderr: `Access is denied. (${path}) - ${decision.because}\n` };
    }
    const text = await readFile(hostOf(path), "utf8").catch(() => null);
    if (text === null) return { exitCode: 1, stderr: `${path}: is not text\n` };
    return { exitCode: 0, stdout: text };
  };

  /** Whether a path exists at all. A fact about the tree, not about permissions. */
  const existsAt = async (path: string): Promise<boolean> =>
    (await lstat(hostOf(path)).catch(() => null)) !== null;

  /** A real connect to a real loopback port. `true` only when something answered. */
  const connects = async (port: number): Promise<boolean> =>
    new Promise<boolean>((settle) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      const done = (value: boolean): void => {
        socket.destroy();
        settle(value);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });

  const bind = async (port: number): Promise<boolean> =>
    new Promise<boolean>((settle) => {
      const server = createServer();
      server.once("error", () => settle(false));
      server.listen({ port, host: "127.0.0.1" }, () => {
        listeners.set(port, server);
        settle(true);
      });
    });

  const startService = async (name: string, program: string): Promise<Outcome> => {
    const held = services.get(name);
    if (held === undefined) {
      return {
        exitCode: 1,
        stderr: `${program}: the service \`${name}\` is not held by this world\n`,
      };
    }
    if (held.port !== null && !listeners.has(held.port)) {
      const bound = await bind(held.port);
      if (!bound) {
        return {
          exitCode: 1,
          stderr:
            `${program}: the service \`${name}\` declares port ${String(held.port)} and this world ` +
            "could not bind it, so the service was not started\n",
        };
      }
    }
    nextPid += 1;
    services.set(name, { ...held, running: true, pid: nextPid });
    return { exitCode: 0, stdout: `${program}: the service \`${name}\` is running\n` };
  };

  const stopService = (name: string, program: string): Outcome => {
    const held = services.get(name);
    if (held === undefined) {
      return { exitCode: 1, stderr: `${program}: the service \`${name}\` is not held by this world\n` };
    }
    if (held.port !== null) {
      listeners.get(held.port)?.close();
      listeners.delete(held.port);
    }
    services.set(name, { ...held, running: false, pid: null });
    return { exitCode: 0 };
  };

  const renderDacl = (path: string): string => {
    const record = recordFor(path);
    const lines = [`${path} ${record.owner}:(${record.mode === null ? "F" : record.mode})`];
    for (const entry of record.entries) {
      const perms = entry.permission === "read" ? "R" : "W";
      const denied = entry.allow ? "" : "(DENY)";
      const inherited = entry.inherited ? "(I)" : "";
      lines.push(`${path} ${entry.account}:(${perms})${denied}${inherited}`);
    }
    return `${lines.join("\n")}\n`;
  };

  /**
   * Parse `<account>:(PERMS)` as `icacls` writes it.
   *
   * `R`, `W`, `RW`, `M` and `F` are accepted and the rest are refused by name. `F` and `M` are the two
   * real `icacls` words that mean "more than read and write"; they map to both permissions **and the
   * mapping is stated here** rather than left for a reader to infer, because this world decides two
   * permissions and a permission it silently dropped would make a criterion about it pass for a reason
   * nothing recorded.
   */
  const parseGrant = (
    token: string,
  ): { readonly account: string; readonly permissions: readonly OsPermission[] } | string => {
    const match = /^(.*):\(([A-Za-z]+)\)$/.exec(token);
    if (match === null) return `icacls: the argument \`${token}\` is not written <account>:(PERMS)`;
    const account = (match[1] ?? "").trim();
    const word = (match[2] ?? "").toUpperCase();
    const permissions: OsPermission[] =
      word === "R"
        ? ["read"]
        : word === "W"
          ? ["write"]
          : word === "RW" || word === "WR"
            ? ["read", "write"]
            : word === "F" || word === "M"
              ? ["read", "write"]
              : [];
    if (account === "" || permissions.length === 0) {
      return `icacls: the permission \`${word}\` is not one this world decides; it understands R, W, RW, M and F`;
    }
    return { account, permissions };
  };

  const icacls = async (argv: readonly string[]): Promise<Outcome> => {
    const target = argv[0];
    if (target === undefined) return { exitCode: 1, stderr: "icacls: missing path\n" };
    const located = resolveOsPath(family, target);
    if (located.kind === "refused") return { exitCode: 1, stderr: `icacls: ${located.reason}\n` };
    const path = located.value;
    if (!(await existsAt(path))) {
      return { exitCode: 1, stderr: `icacls: \`${path}\`: The system cannot find the file specified.\n` };
    }
    const flags = argv.slice(1);
    if (flags.length === 0) return { exitCode: 0, stdout: renderDacl(path) };

    const record = recordFor(path);
    let changed = 0;
    let pending: string | null = null;
    for (const flag of flags) {
      if (flag === "/inheritance:r") {
        // Both families have a word for this and both mean the same thing: what was inherited stops
        // being inherited, which *promotes* it to an explicit entry rather than deleting it. Deleting
        // it would silently grant access where the real command only changes provenance.
        record.entries = record.entries.map((entry) => ({ ...entry, inherited: false }));
        changed += 1;
        continue;
      }
      if (flag === "/grant" || flag === "/deny" || flag === "/remove") {
        pending = flag;
        continue;
      }
      if (pending === null) continue;
      const parsed = parseGrant(flag);
      if (typeof parsed === "string") return { exitCode: 1, stderr: `${parsed}\n` };
      if (pending === "/remove") {
        // The permission word is the operand, not decoration. `/remove <account>:(W)` withdraws the
        // *write* grant and leaves a read grant standing; removing every entry for the account instead
        // performs a different command than the one the application issued, reports success for it,
        // and makes two different programs - one that withdraws read and write and one that withdraws
        // only read - produce an identical world. A criterion can then never tell them apart, which is
        // how a demo came to ship a defect that no reading could see.
        const before = record.entries.length;
        record.entries = record.entries.filter(
          (entry) =>
            !(
              sameAccount(entry.account, parsed.account) &&
              parsed.permissions.includes(entry.permission)
            ),
        );
        changed += before - record.entries.length;
      } else {
        const allow = pending === "/grant";
        for (const permission of parsed.permissions) {
          record.entries = record.entries.filter(
            (entry) =>
              !(
                sameAccount(entry.account, parsed.account) &&
                entry.permission === permission &&
                entry.inherited === false
              ),
          );
          record.entries.push({ account: parsed.account, permission, allow, inherited: false });
          changed += 1;
        }
      }
      pending = null;
    }
    if (pending !== null) {
      return { exitCode: 1, stderr: `icacls: \`${pending}\` needs an argument\n` };
    }
    if (changed === 0) {
      return { exitCode: 1, stderr: "icacls: no change was asked for\n" };
    }
    return { exitCode: 0, stdout: `Successfully processed ${String(changed)} files.\n` };
  };

  /**
   * A real scan of the loopback ports this world holds, spelled as each family spells it.
   *
   * It is the one program here that *observes* rather than mutates, and it is genuinely real: the
   * sockets it reaches were bound in response to the application's own start command and by nothing
   * else, so a contract asking whether a port is exposed reads an answer the world earned.
   */
  const netstat = async (): Promise<Outcome> => {
    const ports = [...new Set([...listeners.keys(), ...declaredPorts()])].sort((left, right) => left - right);
    const lines: string[] = [];
    for (const port of ports) {
      const open = await connects(port);
      lines.push(
        family === "windows"
          ? `  TCP    127.0.0.1:${String(port)}    0.0.0.0:0    ${open ? "LISTENING" : "CLOSED"}`
          : `tcp4       0      0  127.0.0.1.${String(port)}     *.*    ${open ? "LISTEN" : "CLOSED"}`,
      );
    }
    const header = family === "windows" ? "  Proto  Local Address          Foreign Address        State\n" : "";
    return { exitCode: 0, stdout: `${header}${lines.join("\n")}${lines.length === 0 ? "" : "\n"}` };
  };

  const reg = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = (argv[0] ?? "").toLowerCase();
    const container = argv[1];
    if (container === undefined) return { exitCode: 1, stderr: "reg: missing key\n" };
    const located = resolveSettingContainer(family, container);
    if (located.kind === "refused") return { exitCode: 1, stderr: `reg: ${located.reason}\n` };
    const key = located.value;
    const rest = argv.slice(2);
    const value = flagValue(rest, "/v");
    const type = flagValue(rest, "/t");
    const data = flagValue(rest, "/d");

    if (verb === "add") {
      if (value === null) return { exitCode: 1, stderr: "reg: add requires /v <name>\n" };
      const typeWord = (type ?? "REG_SZ").toUpperCase();
      if (!OS_SETTING_TYPES.windows.includes(typeWord)) {
        return {
          exitCode: 1,
          stderr:
            `reg: \`${typeWord}\` is not a type this system has; it understands ` +
            `${OS_SETTING_TYPES.windows.join(", ")}\n`,
        };
      }
      if (data === null) return { exitCode: 1, stderr: "reg: add requires /d <value>\n" };
      return writeSetting(key, value, data, typeWord, SOURCE_OF());
    }
    if (verb === "query") {
      const held = settingsFor(key);
      if (value === null) {
        if (held.length === 0) {
          return {
            exitCode: 1,
            stderr: `ERROR: The system was unable to find the specified registry key or value.\n`,
          };
        }
        return { exitCode: 0, stdout: renderRegistry(key, held) };
      }
      const one = held.find((setting) => setting.name.toLowerCase() === value.toLowerCase());
      if (one === undefined) {
        return {
          exitCode: 1,
          stderr: `ERROR: The system was unable to find the specified registry key or value.\n`,
        };
      }
      return { exitCode: 0, stdout: renderRegistry(key, [one]) };
    }
    if (verb === "delete") {
      if (value === null) {
        const before = settingsFor(key).length;
        for (const [held, setting] of [...settings]) {
          if (setting.container === key) settings.delete(held);
        }
        return before === 0
          ? { exitCode: 1, stderr: "ERROR: The system was unable to find the specified registry key or value.\n" }
          : { exitCode: 0, stdout: `The operation completed successfully.\n` };
      }
      const removed = [...settings.entries()].filter(
        ([, setting]) => setting.container === key && sameAccount(setting.name, value),
      );
      if (removed.length === 0) {
        return {
          exitCode: 1,
          stderr: "ERROR: The system was unable to find the specified registry key or value.\n",
        };
      }
      for (const [held] of removed) settings.delete(held);
      return { exitCode: 0, stdout: `The operation completed successfully.\n` };
    }
    return { exitCode: 1, stderr: `reg: unknown verb \`${verb}\`\n` };
  };

  const defaults = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = (argv[0] ?? "").toLowerCase();
    const domain = argv[1];
    if (domain === undefined) return { exitCode: 1, stderr: "defaults: missing domain\n" };
    const located = resolveSettingContainer(family, domain);
    if (located.kind === "refused") return { exitCode: 1, stderr: `defaults: ${located.reason}\n` };
    const container = located.value;
    const rest = argv.slice(2);

    if (verb === "write") {
      const name = rest[0];
      if (name === undefined) return { exitCode: 1, stderr: "defaults: write needs a key\n" };
      const typeFlag = rest.find((token) => token.startsWith("-"));
      const words: Record<string, string> = {
        "-string": "string",
        "-int": "integer",
        "-integer": "integer",
        "-bool": "boolean",
      };
      const type = typeFlag === undefined ? null : (words[typeFlag] ?? null);
      if (type === null) {
        return {
          exitCode: 1,
          stderr:
            `defaults: this world understands ${Object.keys(words).join(", ")} and nothing else; ` +
            `it received ${JSON.stringify(typeFlag ?? "")}\n`,
        };
      }
      const data = rest[rest.indexOf(typeFlag ?? "") + 1];
      if (data === undefined) return { exitCode: 1, stderr: "defaults: write needs a value\n" };
      return writeSetting(container, name, data, type, SOURCE_OF());
    }
    if (verb === "read") {
      const held = settingsFor(container);
      const name = rest[0];
      if (name === undefined) {
        if (held.length === 0) {
          return {
            exitCode: 1,
            stderr: `Domain ${container} does not exist\n`,
          };
        }
        const body = [...held]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((setting) => `    ${setting.name} = ${setting.value};`)
          .join("\n");
        return { exitCode: 0, stdout: `{\n${body}\n}\n` };
      }
      const one = held.find((setting) => setting.name === name);
      if (one === undefined) {
        return {
          exitCode: 1,
          stderr: `The domain/default pair of (${container}, ${name}) does not exist\n`,
        };
      }
      return { exitCode: 0, stdout: `${one.value}\n` };
    }
    if (verb === "delete") {
      const name = rest[0];
      const removed = [...settings.entries()].filter(
        ([, setting]) =>
          setting.container === container && (name === undefined || setting.name === name),
      );
      if (removed.length === 0) {
        return {
          exitCode: 1,
          stderr: `The domain/default pair of (${container}, ${name ?? ""}) does not exist\n`,
        };
      }
      for (const [held] of removed) settings.delete(held);
      return { exitCode: 0 };
    }
    return { exitCode: 1, stderr: `defaults: unknown verb \`${verb}\`\n` };
  };

  const net = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = (argv[0] ?? "").toLowerCase();
    if (verb === "user") {
      const name = argv[1];
      if (name === undefined) return { exitCode: 1, stderr: "The syntax of this command is incorrect.\n" };
      const flag = (argv[2] ?? "").toLowerCase();
      if (flag === "/add") return createAccount(name, "user", SOURCE_OF());
      if (flag === "/delete") return deleteAccount(name);
      const held = [...accounts.values()].find((account) => sameAccount(account.name, name));
      if (held === undefined) {
        return { exitCode: 2, stderr: `The user name could not be found.\n` };
      }
      return {
        exitCode: 0,
        stdout:
          `User name                    ${held.name}\n` +
          `Local Group Memberships      ${held.groups.join(" ")}\n`,
      };
    }
    if (verb === "localgroup") {
      const group = argv[1];
      if (group === undefined) return { exitCode: 1, stderr: "The syntax of this command is incorrect.\n" };
      const flag = (argv[2] ?? "").toLowerCase();
      if (flag === "/add") {
        return { exitCode: 0, stdout: `The command completed successfully.\n` };
      }
      const member = argv[2];
      if (member === undefined) {
        return { exitCode: 0, stdout: `Alias name     ${group}\n` };
      }
      const held = [...accounts.values()].find((account) => sameAccount(account.name, member));
      if (held === undefined) {
        return { exitCode: 2, stderr: `The user name could not be found.\n` };
      }
      if (!held.groups.some((existing) => sameAccount(existing, group))) {
        accounts.set(held.name, { ...held, groups: [...held.groups, group] });
      }
      return { exitCode: 0, stdout: `The command completed successfully.\n` };
    }
    return { exitCode: 1, stderr: `net: unknown verb \`${verb}\`\n` };
  };

  const sysadminctl = async (argv: readonly string[]): Promise<Outcome> => {
    // Folded once, because `sysadminctl` spells its verbs in camel case and a provisioner may not.
    // `flagValue` folds too, so the *value* is found whichever way the verb was written - and the
    // value is what matters here, because `-addUser svc` is the whole point of the command.
    const verb = (argv[0] ?? "").toLowerCase();
    if (verb === "-adduser") {
      const name = flagValue(argv, "-addUser");
      if (name === null) return { exitCode: 1, stderr: "sysadminctl: -addUser needs a name\n" };
      return createAccount(name, "user", SOURCE_OF());
    }
    if (verb === "-deleteuser") {
      const name = flagValue(argv, "-deleteUser");
      if (name === null) return { exitCode: 1, stderr: "sysadminctl: -deleteUser needs a name\n" };
      return deleteAccount(name);
    }
    return {
      exitCode: 1,
      stderr: `sysadminctl: this world answers -addUser and -deleteUser and nothing else\n`,
    };
  };

  const launchctl = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = (argv[0] ?? "").toLowerCase();
    const operand = argv[1];
    if (operand === undefined) return { exitCode: 1, stderr: `launchctl: \`${verb}\` needs an argument\n` };

    if (verb === "load" || verb === "bootstrap") {
      const path = resolveOsPath(family, operand);
      if (path.kind === "refused") return { exitCode: 1, stderr: `launchctl: ${path.reason}\n` };
      const text = await readFile(hostOf(path.value), "utf8").catch(() => null);
      if (text === null) {
        return { exitCode: 1, stderr: `launchctl: \`${path.value}\` could not be read\n` };
      }
      const parsed = parsePlist(text);
      if (parsed === null) {
        return {
          exitCode: 1,
          stderr:
            `launchctl: \`${path.value}\` is not a property list this world can read. It reads ` +
            "`key`/`string` and `key`/`integer` pairs and `ProgramArguments` as an array of strings, " +
            "and it will not register a service it cannot read a command out of.\n",
        };
      }
      const label = typeof parsed["Label"] === "string" ? parsed["Label"] : null;
      const rawArguments = parsed["ProgramArguments"];
      const programArguments = Array.isArray(rawArguments) ? rawArguments : [];
      if (label === null || programArguments.length === 0) {
        return {
          exitCode: 1,
          stderr:
            `launchctl: \`${path.value}\` names no Label or no ProgramArguments, so this world has ` +
            "no service to hold\n",
        };
      }
      const command = programArguments.join(" ");
      const account = typeof parsed["UserName"] === "string" ? parsed["UserName"] : "root";
      services.set(label, {
        running: false,
        pid: null,
        command,
        account,
        port: portIn(command),
      });
      return { exitCode: 0, stdout: `${path.value}: loaded \`${label}\`\n` };
    }
    if (verb === "unload" || verb === "bootout") {
      const path = resolveOsPath(family, operand);
      const label = path.kind === "target" ? plistLabel(await readFile(hostOf(path.value), "utf8").catch(() => null)) : null;
      const name = label ?? operand.replace(/\.plist$/, "").replace(/^.*\//, "");
      if (!services.has(name)) {
        return { exitCode: 1, stderr: `launchctl: the service \`${name}\` is not held by this world\n` };
      }
      const held = services.get(name);
      if (held?.port !== null && held?.port !== undefined) {
        listeners.get(held.port)?.close();
        listeners.delete(held.port);
      }
      services.delete(name);
      return { exitCode: 0 };
    }
    if (verb === "start") {
      const found = [...services.keys()].find((held) => held === operand) ?? null;
      if (found === null) {
        return { exitCode: 1, stderr: `launchctl: the service \`${operand}\` is not held by this world\n` };
      }
      return startService(found, "launchctl");
    }
    if (verb === "stop") {
      return stopService(operand, "launchctl");
    }
    if (verb === "list") {
      if (operand === "" || argv.length === 1) {
        const lines = [...services.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, held]) =>
            held.running
              ? `${String(held.pid ?? 0)}\t0\t${name}`
              : `-\t0\t${name}`,
          );
        return { exitCode: 0, stdout: `PID\tStatus\tLabel\n${lines.join("\n")}${lines.length === 0 ? "" : "\n"}` };
      }
      const held = services.get(operand);
      if (held === undefined) {
        return { exitCode: 1, stderr: `launchctl: the service \`${operand}\` is not held by this world\n` };
      }
      return {
        exitCode: 0,
        stdout:
          `{\n\t"Label" = "${operand}";\n\t"Program" = "${held.command}";\n` +
          `\t"UserName" = "${held.account}";\n\t"PID" = ${String(held.pid ?? 0)};\n}\n`,
      };
    }
    return { exitCode: 1, stderr: `launchctl: unknown verb \`${verb}\`\n` };
  };

  const sc = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = (argv[0] ?? "").toLowerCase();
    const name = argv[1];
    if (name === undefined) return { exitCode: 1, stderr: "sc: missing service name\n" };

    if (verb === "create") {
      // `sc` writes its options as `key= value` pairs, and the *value* is a separate word. That is a
      // real quirk of the real command and it is also the `adduser` defect waiting to happen: a parser
      // that treated every word as an operand would take the command line as the service's name and
      // the account as its command. Both spellings are accepted here - `key= value` and `key=value` -
      // and each key consumes exactly one following word when it is given as its own token.
      const options = keywordPairs(argv.slice(2));
      const command = options["binPath"] ?? options["binpath"] ?? "";
      if (command === "") {
        return { exitCode: 1, stderr: "sc: create requires binPath= <command>\n" };
      }
      const account = options["obj"] ?? options["object"] ?? "LocalSystem";
      services.set(name, {
        running: false,
        pid: null,
        command,
        account: account === "" ? "LocalSystem" : account,
        port: portIn(command),
      });
      return {
        exitCode: 0,
        stdout: `[SC] CreateService SUCCESS\n`,
      };
    }
    if (verb === "start") return startService(name, "sc");
    if (verb === "stop") return stopService(name, "sc");
    if (verb === "delete") {
      const held = services.get(name);
      if (held === undefined) {
        return { exitCode: 1, stderr: `[SC] OpenService FAILED 1060:\nThe specified service does not exist as an installed service.\n` };
      }
      if (held.port !== null) {
        listeners.get(held.port)?.close();
        listeners.delete(held.port);
      }
      services.delete(name);
      return { exitCode: 0, stdout: `[SC] DeleteService SUCCESS\n` };
    }
    if (verb === "query" || verb === "qc") {
      const held = services.get(name);
      if (held === undefined) {
        return {
          exitCode: 1,
          stderr: `[SC] OpenService FAILED 1060:\nThe specified service does not exist as an installed service.\n`,
        };
      }
      const state = held.running ? "RUNNING" : "STOPPED";
      return {
        exitCode: 0,
        stdout:
          `SERVICE_NAME: ${name}\n        TYPE               : 10  WIN32_OWN_PROCESS\n` +
          `        STATE              : ${held.running ? "4" : "1"}   ${state}\n` +
          `        BINARY_PATH_NAME   : ${held.command}\n` +
          `        SERVICE_START_NAME : ${held.account}\n`,
      };
    }
    return { exitCode: 1, stderr: `sc: unknown verb \`${verb}\`\n` };
  };

  const chmod = async (argv: readonly string[]): Promise<Outcome> => {
    const [mode, ...paths] = argv;
    if (mode === undefined || paths.length === 0) {
      return { exitCode: 1, stderr: "chmod: missing operand\n" };
    }
    if (!/^[0-7]{3,4}$/.test(mode)) {
      return { exitCode: 1, stderr: `chmod: invalid mode: \`${mode}'\n` };
    }
    const canonical = mode.padStart(4, "0");
    for (const spelling of paths) {
      const located = resolveOsPath(family, spelling);
      if (located.kind === "refused") return { exitCode: 1, stderr: `chmod: ${located.reason}\n` };
      if (!(await existsAt(located.value))) {
        return { exitCode: 1, stderr: `chmod: ${located.value}: No such file or directory\n` };
      }
      const record = recordFor(located.value);
      const group = accounts.get(record.owner)?.groups[0] ?? record.owner;
      // The ACL is *replaced* rather than amended, because that is what a mode is: one word that says
      // everything about who may do what. Amending would let a mode of `0600` coexist with a wider
      // explicit grant, and the decision would then be reached from entries the command never set.
      record.entries = entriesForMode(canonical, record.owner, group, false);
      record.mode = canonical;
    }
    return { exitCode: 0 };
  };

  const chown = async (argv: readonly string[]): Promise<Outcome> => {
    const [spec, ...paths] = argv;
    if (spec === undefined || paths.length === 0) {
      return { exitCode: 1, stderr: "chown: missing operand\n" };
    }
    const [owner, group] = spec.split(":");
    for (const spelling of paths) {
      const located = resolveOsPath(family, spelling);
      if (located.kind === "refused") return { exitCode: 1, stderr: `chown: ${located.reason}\n` };
      if (!(await existsAt(located.value))) {
        return { exitCode: 1, stderr: `chown: ${located.value}: No such file or directory\n` };
      }
      const record = recordFor(located.value);
      record.owner = owner === undefined || owner === "" ? record.owner : owner;
      const groupName =
        group === undefined || group === ""
          ? (accounts.get(record.owner)?.groups[0] ?? record.owner)
          : group;
      record.entries = entriesForMode(record.mode ?? FILE_MODE, record.owner, groupName, false);
    }
    return { exitCode: 0 };
  };

  const readSource: { current: OsExecSource } = { current: "world" };
  const SOURCE_OF = (): OsSettingWriter => readSource.current;

  const createAccount = (
    name: string,
    kind: OsAccountKind,
    createdBy: OsSettingWriter,
  ): Outcome => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
      return { exitCode: 1, stderr: `the account name \`${name}\` is not one this world can hold\n` };
    }
    if ([...accounts.values()].some((account) => sameAccount(account.name, name))) {
      return { exitCode: 1, stderr: `the account \`${name}\` already exists\n` };
    }
    accounts.set(name, {
      name,
      kind,
      home: homeOf(family, name),
      groups: [name],
      createdBy,
    });
    return { exitCode: 0, stdout: `the account \`${name}\` was created\n` };
  };

  const deleteAccount = (name: string): Outcome => {
    const held = [...accounts.keys()].find((existing) => sameAccount(existing, name));
    if (held === undefined) {
      return { exitCode: 1, stderr: `the account \`${name}\` is not held by this world\n` };
    }
    accounts.delete(held);
    return { exitCode: 0 };
  };

  // ---- the register ------------------------------------------------------------------------------

  /**
   * The programs Windows answers, and only these.
   *
   * A `Map` rather than an object literal, because a program's name is data here - the refusal path
   * quotes the whole set back to whoever asked for a program the world does not answer, and an object's
   * keys would have to be re-sorted at that point to make the message stable.
   */
  const windowsOnly: readonly (readonly [string, Handler])[] = [
    ["icacls", icacls],
    ["reg", reg],
    ["sc", sc],
    ["net", net],
    ["type", async (argv) => readAsAccount(argv[0] ?? "")],
    [
      "where",
      async (argv) => {
        const path = resolveOsPath(family, argv[0] ?? "");
        if (path.kind === "refused") return { exitCode: 1, stderr: `where: ${path.reason}\n` };
        return (await existsAt(path.value))
          ? { exitCode: 0, stdout: `${path.value}\n` }
          : { exitCode: 1, stderr: `INFO: Could not find files for the given pattern.\n` };
      },
    ],
    [
      "ver",
      async () => {
        // The identity is a *record*, not an installed image, and it is printed with a line that says
        // so - because a reading whose whole claim is traceability should not hand a criterion a
        // version string it could mistake for the truth about the machine it is running on.
        return {
          exitCode: 0,
          stdout: `\nVeridian simulated ${system} [recorded identity, not an installed image]\n\n`,
        };
      },
    ],
    [
      "whoami",
      async () => {
        return { exitCode: 0, stdout: `${family}\\${user}\n` };
      },
    ],
  ];

  /** The programs macOS answers, and only these. */
  const macosOnly: readonly (readonly [string, Handler])[] = [
    ["chmod", chmod],
    ["chown", chown],
    ["launchctl", launchctl],
    ["defaults", defaults],
    ["sysadminctl", sysadminctl],
    ["cat", async (argv) => readAsAccount(argv[0] ?? "")],
    [
      "which",
      async (argv) => {
        const path = resolveOsPath(family, argv[0] ?? "");
        if (path.kind === "refused") return { exitCode: 1, stderr: `which: ${path.reason}\n` };
        return (await existsAt(path.value))
          ? { exitCode: 0, stdout: `${path.value}\n` }
          : { exitCode: 1, stderr: `${argv[0] ?? ""} not found\n` };
      },
    ],
    [
      "sw_vers",
      async () => {
        const version = /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(system)?.[1] ?? "unknown";
        return {
          exitCode: 0,
          stdout: `ProductName:\tmacOS\nProductVersion:\t${version}\nBuildVersion:\tveridian-simulated\n`,
        };
      },
    ],
    [
      "id",
      async () => {
        const held = accounts.get(user);
        const groups = held?.groups ?? [user];
        return {
          exitCode: 0,
          stdout:
            `uid=501(${user}) gid=20(${groups[0] ?? user}) groups=${groups.join(",")}\n`,
        };
      },
    ],
  ];

  /**
   * The register: the programs this world answers, and the work it performs for each.
   *
   * Built from the family's own table plus the two programs **both** families have, so that the
   * family-specific set is stated once and the shared set is not duplicated into it - two copies of one
   * rule disagree the first time a world arrives that only one of them was written for.
   */
  const register: ReadonlyMap<string, Handler> = new Map<string, Handler>([
    ...(family === "windows" ? windowsOnly : macosOnly),
    ["netstat", netstat],
    [
      "curl",
      // `egress` is a declared substitute: this sandbox has no network beyond loopback, so a request
      // that leaves it is refused rather than answered. A contract that asks whether the application
      // reached out reads this through `os.ran`, and the answer is a fact about an *attempt* rather
      // than about a page - which is the honest shape for a world with no route out.
      async (argv) => ({
        exitCode: 6,
        stderr: `curl: (6) Could not resolve host: ${argv.at(-1) ?? ""}\n`,
        result: "refused" as OsExecResult,
        reason:
          "this world has no egress; nothing outside 127.0.0.1 can be reached from the sandbox, so " +
          "the request is refused rather than routed",
      }),
    ],
  ]);

  // ---- small parsers the register needs ----------------------------------------------------------

  /** The value of a `/flag` or `-flag` style option, or `null` when the option is not present. */
  function flagValue(argv: readonly string[], flag: string): string | null {
    for (let index = 0; index < argv.length; index += 1) {
      const word = argv[index];
      if (word === undefined) continue;
      if (word.toLowerCase() === flag.toLowerCase()) return argv[index + 1] ?? null;
      if (word.toLowerCase().startsWith(`${flag.toLowerCase()}=`)) {
        return word.slice(flag.length + 1);
      }
    }
    return null;
  }

  /**
   * `sc`'s `key= value` options.
   *
   * A key given as `key=` on its own consumes the **next word** as its value, which is the real
   * command's rule and is the point rather than a detail: a parser that treated every word as an
   * operand would read `binPath= "node app.mjs" obj= LocalSystem` as a service whose command is
   * `obj=` and whose account is nothing at all. *A flag's value is not an operand* - the defect this
   * repository already paid for once, in `adduser`, wearing different clothes.
   */
  function keywordPairs(argv: readonly string[]): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 1) {
      const word = argv[index];
      if (word === undefined || !word.includes("=")) continue;
      const equals = word.indexOf("=");
      const key = word.slice(0, equals).toLowerCase();
      const inline = word.slice(equals + 1);
      if (inline !== "") {
        out[key] = inline;
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.includes("=")) {
        out[key] = next;
        index += 1;
      } else {
        out[key] = "";
      }
    }
    return out;
  }

  function plistLabel(text: string | null): string | null {
    if (text === null) return null;
    const label = parsePlist(text)?.["Label"];
    return typeof label === "string" ? label : null;
  }

  const settingsFor = (container: string): readonly OsSettingReading[] =>
    [...settings.values()]
      .filter((setting) => setting.container === container)
      .sort((left, right) => left.name.localeCompare(right.name));

  const renderRegistry = (key: string, values: readonly OsSettingReading[]): string =>
    `\nHKEY_LOCAL_MACHINE\\${key.replace(/^HKLM\\/, "")}\n` +
    values.map((setting) => `    ${setting.name}    ${setting.type}    ${setting.value}`).join("\n") +
    "\n\n";

  /**
   * Put one value in the store, refusing anything the store cannot hold.
   *
   * A value carrying a newline is refused **by name**, and that refusal is what makes
   * `settingValues()`'s line rendering unambiguous: a criterion asking whether a container contains
   * `Autostart=yes` would otherwise be able to match across two entries, and the reading would report
   * a persistence mechanism that does not exist.
   */
  function writeSetting(
    container: string,
    name: string,
    value: string,
    type: string,
    writtenBy: OsSettingWriter,
  ): Outcome {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
      return { exitCode: 1, stderr: `\`${name}\` is not a value name this store can hold\n` };
    }
    if (value.includes("\n") || value.includes("\r")) {
      return {
        exitCode: 1,
        stderr:
          "a store value is one line in this world, and this one carries a line break - which would " +
          "make a criterion searching the container for one entry match across two\n",
      };
    }
    const key = `${container}\u0000${name}`;
    settings.set(key, { scope: "system", container, name, value, type, writtenBy });
    return { exitCode: 0, stdout: "The operation completed successfully.\n" };
  }

  // ---- the ports services declare ---------------------------------------------------------------

  /** Every port a held service declares, whether or not it is running. The set `netstat` reports. */
  const declaredPorts = (): readonly number[] =>
    [...services.values()]
      .map((held) => held.port)
      .filter((port): port is number => port !== null);

  // ---- the exec path ----------------------------------------------------------------------------

  const run = async (request: OsExecRequest): Promise<OsExecRecord> => {
    const started = Date.now();
    const program = request.argv[0] ?? "";
    const escaping = request.argv.slice(1).find((token) => osEscapes(family, token));
    if (escaping !== undefined) {
      const refusedRecord: OsExecRecord = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: "refused",
        exitCode: null,
        stdout: "",
        stderr: "",
        reason:
          `\`${escaping}\` names a place this world does not hold: ${root} is the whole filesystem ` +
          "it has, and resolving the argument would reach this machine's tree instead",
        durationMs: 0,
      };
      execs.push(refusedRecord);
      return refusedRecord;
    }

    const handler = register.get(program);
    let result: OsExecRecord;
    if (handler === undefined) {
      result = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: "refused",
        exitCode: null,
        stdout: "",
        stderr: "",
        reason:
          `this world answers ${[...register.keys()].sort().join(", ")} and nothing else. ` +
          `\`${program}\` is not among them, so the command was not run - and a shell would be a ` +
          "second substitution, so there is none to wrap it in either",
        durationMs: 0,
      };
    } else {
      const previous = readSource.current;
      readSource.current =
        request.source === "criterion" ? "criterion" : request.source === "application" ? "application" : "world";
      let answered: Outcome;
      try {
        answered = await handler(request.argv.slice(1));
      } catch (error) {
        answered = {
          exitCode: 1,
          stderr: `${program}: ${error instanceof Error ? error.message : String(error)}\n`,
        };
      } finally {
        readSource.current = previous;
      }
      result = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: answered.result ?? (answered.exitCode === 0 ? "completed" : "nonzero"),
        exitCode: answered.exitCode,
        stdout: answered.stdout ?? "",
        stderr: answered.stderr ?? "",
        reason: answered.reason ?? null,
        durationMs: Date.now() - started,
      };
    }
    execs.push(result);
    return result;
  };

  // ---- reading ----------------------------------------------------------------------------------

  /**
   * Walk the real tree.
   *
   * Real bytes, real sizes, real hashes - so a file the application wrote is in the reading whether or
   * not the world was told about it, which is the property that separates a modelled system from a
   * stub. The owner and the group come from the security record when the world made the file, and from
   * the account the criteria act as when the application did.
   */
  const walk = async (segments: readonly string[], found: OsFileReading[]): Promise<void> => {
    const entries = await readdir(join(root, ...segments), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = [...segments, entry.name];
      const path = spell(child);
      const hostPath = join(root, ...child);
      const stats = await lstat(hostPath).catch(() => null);
      if (stats === null) continue;
      const held = securityAt(path);
      const owner = held?.owner ?? user;
      const group = accounts.get(owner)?.groups[0] ?? owner;
      if (entry.isDirectory()) {
        found.push({
          path,
          kind: "directory",
          bytes: 0,
          owner,
          group,
          sha256: null,
          text: null,
          textWithheld: "a directory has no contents",
        });
        await walk(child, found);
        continue;
      }
      if (entry.isSymbolicLink()) {
        found.push({
          path,
          kind: "symlink",
          bytes: 0,
          owner,
          group,
          sha256: null,
          text: null,
          textWithheld: "a symbolic link is not followed; the link is the reading",
        });
        continue;
      }
      const data = await readFile(hostPath).catch(() => null);
      if (data === null) continue;
      const isText = !data.includes(0) && data.length <= TEXT_BOUND;
      found.push({
        path,
        kind: "file",
        bytes: data.length,
        owner,
        group,
        sha256: sha256(data),
        text: isText ? data.toString("utf8") : null,
        textWithheld: isText
          ? null
          : data.length > TEXT_BOUND
            ? `contents exceed ${String(TEXT_BOUND)} bytes; the hash is the reading`
            : "contents are not text",
      });
    }
  };

  /**
   * The acls, for every governed path.
   *
   * A path the walk found but the world has no record for is deliberately **not** given one: an empty
   * ACL would be a claim that nothing governs the path, when what is true is that the world was never
   * told how it should be governed. `aclAt` returns `null` for it and the validator reports
   * `INCONCLUSIVE`, which is the difference between "ungoverned" and "unmeasured".
   */
  const aclReadings = (): readonly OsAclReading[] =>
    [...security.entries()]
      .map(([path, record]) => ({
        path,
        owner: record.owner,
        mode: record.mode,
        // Copied, one entry at a time. A reading that shared the world's own objects could be edited
        // by whoever read it, and the *next* reading would then describe a system nobody configured.
        entries: record.entries.map((entry) => ({ ...entry })),
        decisions: decisionsFor(record).map((decision) => ({ ...decision })),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));

  /**
   * The services, with `running` earned rather than replayed.
   *
   * A service that declares a port is reported `running` **only after a real connect reached it**, and
   * that is the whole reason this function is async. A service with no port has no socket to reach, so
   * its recorded state is the reading - and the status vocabulary says `running` for both, because
   * from the world's point of view both are running; what differs is how the world knows.
   *
   * The jobs launchd holds *on disk* are merged in here rather than stored: a job file the application
   * wrote is a job the system holds, and it must appear in the reading whether or not anyone announced
   * it. Merging rather than registering is what keeps `read()` a pure function - a reading that wrote
   * the discovery back into the world would make the first reading of a system and the second two
   * different observations of it, and only one of them would be repeatable.
   */
  const serviceReadings = async (): Promise<readonly OsServiceReading[]> => {
    const held: (readonly [string, ServiceState])[] = [...services.entries()];
    for (const [label, state] of await jobsOnDisk()) {
      if (!services.has(label)) held.push([label, state]);
    }
    const out: OsServiceReading[] = [];
    for (const [name, state] of [...held].sort(([left], [right]) => left.localeCompare(right))) {
      let status: OsServiceStatus = "stopped";
      if (state.running) {
        status = state.port === null ? "running" : (await connects(state.port)) ? "running" : "failed";
      }
      out.push({
        name,
        status,
        enabled: state.running,
        command: state.command,
        pid: state.running ? state.pid : null,
        account: state.account,
        port: state.port,
      });
    }
    return out;
  };

  /**
   * Every launchd job declared on disk, read and parsed but **not** registered.
   *
   * A plist this world cannot read contributes no job rather than a job with an empty command line:
   * a service with no command is a service with nothing to start, and reporting one would put a name
   * in the reading that no program could ever have answered to.
   */
  const jobsOnDisk = async (): Promise<readonly (readonly [string, ServiceState])[]> => {
    if (family !== "macos") return [];
    const directory = hostOf("/Library/LaunchDaemons");
    const entries = await readdir(directory).catch(() => []);
    const found: (readonly [string, ServiceState])[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".plist")) continue;
      const text = await readFile(join(directory, entry), "utf8").catch(() => null);
      const parsed = text === null ? null : parsePlist(text);
      const rawArguments = parsed?.["ProgramArguments"];
      const programArguments = Array.isArray(rawArguments) ? rawArguments : [];
      if (programArguments.length === 0) continue;
      const label =
        typeof parsed?.["Label"] === "string" ? parsed["Label"] : entry.replace(/\.plist$/, "");
      const command = programArguments.join(" ");
      found.push([
        label,
        {
          running: false,
          pid: null,
          command,
          account: typeof parsed?.["UserName"] === "string" ? parsed["UserName"] : "root",
          port: portIn(command),
        },
      ]);
    }
    return found;
  };

  // ---- lifecycle --------------------------------------------------------------------------------

  const seed = async (): Promise<void> => {
    for (const path of SEED_DIRECTORIES[family]) {
      await mkdir(hostOf(path), { recursive: true });
      note(path, family === "windows" ? "SYSTEM" : "root", DIRECTORY_MODE, worldReadable(path, family === "windows" ? "SYSTEM" : "root", true));
    }
    accounts.clear();
    for (const account of seededAccounts) accounts.set(account.name, account);
    accounts.set(user, {
      name: user,
      kind: "user",
      home: homeOf(family, user),
      groups: [user],
      createdBy: "world",
    });
    await mkdir(hostOf(homeOf(family, user)), { recursive: true });
    note(
      homeOf(family, user),
      family === "windows" ? "SYSTEM" : "root",
      DIRECTORY_MODE,
      worldReadable(homeOf(family, user), family === "windows" ? "SYSTEM" : "root", true),
    );

    settings.clear();
    services.clear();
    security.clear();
    // The seed directories were noted before the map was cleared, so they are written again here -
    // and the double note is deliberate: a reset that cleared the records *after* seeding would leave
    // a world whose directories exist and whose governance does not, and every access criterion would
    // report `INCONCLUSIVE` for a reason the reset caused.
    for (const path of SEED_DIRECTORIES[family]) {
      note(path, family === "windows" ? "SYSTEM" : "root", DIRECTORY_MODE, worldReadable(path, family === "windows" ? "SYSTEM" : "root", true));
    }
    for (const path of [homeOf(family, user)]) {
      note(path, family === "windows" ? "SYSTEM" : "root", DIRECTORY_MODE, worldReadable(path, family === "windows" ? "SYSTEM" : "root", true));
    }

    const identity = OS_IDENTITY_PATHS[family];
    await write(
      identity,
      `${JSON.stringify({ family, system, simulated: surfaces(), host: "veridian-sim-os" }, null, 2)}\n`,
      family === "windows" ? "SYSTEM" : "root",
      family === "macos" ? FILE_MODE : null,
      worldReadable(identity, family === "windows" ? "SYSTEM" : "root", false),
    );
    nextPid = FIRST_PID;
  };

  /** The surfaces that apply to this family. `registry` and `preferences` are the per-family pair. */
  const surfaces = (): readonly OsSimulatedSurface[] =>
    OS_SIMULATED_SURFACES.filter((surface) =>
      family === "windows" ? surface !== "preferences" : surface !== "registry",
    );

  const closeListeners = (): void => {
    for (const server of listeners.values()) server.close();
    listeners.clear();
  };

  /**
   * The bookkeeping, as a document.
   *
   * A `Map` is not JSON, and a round-trip that silently became `{}` would restore a world whose files
   * have owners no account holds and whose ACLs govern nothing - which is exactly the failure a
   * snapshot is taken to prevent. Both directions are therefore written out here, in one place, keyed
   * by path like the readings are.
   */
  const dumpWorld = (): string =>
    JSON.stringify(
      {
        security: [...security.entries()],
        accounts: [...accounts.values()],
        settings: [...settings.values()],
        services: [...services.entries()],
        nextPid,
      },
      null,
      2,
    );

  const loadWorld = (text: string): void => {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("this world's snapshot does not hold a readable state document");
    }
    const state = parsed as {
      security?: [string, SecurityRecord][];
      accounts?: OsAccountReading[];
      settings?: OsSettingReading[];
      services?: [string, ServiceState][];
      nextPid?: number;
    };
    security.clear();
    for (const [path, record] of state.security ?? []) security.set(path, record);
    accounts.clear();
    for (const account of state.accounts ?? []) accounts.set(account.name, account);
    settings.clear();
    for (const setting of state.settings ?? []) settings.set(`${setting.container}\u0000${setting.name}`, setting);
    services.clear();
    for (const [name, held] of state.services ?? []) services.set(name, held);
    nextPid = state.nextPid ?? nextPid;
  };

  const snapshotTree = async (destination: string): Promise<void> => {
    await rm(destination, { recursive: true, force: true });
    await cp(root, join(destination, "host"), { recursive: true });
    await writeFile(join(destination, "world.json"), dumpWorld(), "utf8");
  };

  const restoreTree = async (source: string): Promise<void> => {
    const state = await readFile(join(source, "world.json"), "utf8").catch(() => null);
    if (state === null) {
      throw new Error(`there is no state document at ${join(source, "world.json")} to restore`);
    }
    closeListeners();
    await rm(root, { recursive: true, force: true });
    await cp(join(source, "host"), root, { recursive: true });
    loadWorld(state);
    // A service the snapshot had running is running again, and the only way that can be true is for a
    // socket to be bound again. Recording `running: true` without binding would make the reading
    // report a fact nobody observed - the one thing this world may never do - and the next `read()`
    // would say `failed` for a service the snapshot called healthy.
    for (const [name, held] of services) {
      if (held.running) await startService(name, "restore");
    }
  };

  /**
   * Build the system from nothing.
   *
   * `prepare()` and `reset()` are the same act at two boundaries - the start of a run and the start of
   * an iteration - and they are one implementation because two implementations of one rule disagree
   * the first time a world arrives that only one of them was written for. That is not a maxim; it is
   * the `sim-posix` defect, where a `prepare()` that only made directories inherited the previous
   * run's tree and two criteria reported `PASS` on a file from someone else's run.
   */
  const rebuild = async (): Promise<void> => {
    closeListeners();
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await seed();
  };

  return {
    prepare: rebuild,
    async reset() {
      await rebuild();
      // The exec record is deliberately kept: a reset restores the world, it does not restore the
      // record. An iteration that reached outside the boundary must not be followed by a clean one
      // that reports PASS with the evidence destroyed by the very act of repairing it.
    },
    exec: run,
    record(record) {
      execs.push(record);
    },
    snapshot: snapshotTree,
    restoreFrom: restoreTree,
    /**
     * Read the system.
     *
     * Every collection is **copied out of the world** rather than handed to the caller, one object at a
     * time. That is the "a read must not mutate the record it reads" rule taken one step further: a
     * reading that shared the world's own objects could be *edited* by whoever read it, and the next
     * reading would describe a system nobody configured. The world's state does not change here, and
     * nothing here can change it from outside either.
     */
    async read() {
      const files: OsFileReading[] = [];
      await walk([], files);
      files.sort((left, right) => left.path.localeCompare(right.path));

      return {
        host: "veridian-sim-os",
        family,
        system,
        root,
        user,
        caseSensitive: caseSensitive(family),
        simulated: surfaces(),
        execs: execs.map((record) => ({ ...record, argv: [...record.argv] })),
        files,
        acls: aclReadings(),
        accounts: [...accounts.values()]
          .map((account) => ({ ...account, groups: [...account.groups] }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        settings: [...settings.values()]
          .map((setting) => ({ ...setting }))
          .sort(
            (left, right) =>
              left.container.localeCompare(right.container) || left.name.localeCompare(right.name),
          ),
        services: await serviceReadings(),
      };
    },
    async stop() {
      closeListeners();
    },
  };
}
