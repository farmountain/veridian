/**
 * The mobile substitute: a device's store, and the register of commands that acts on it.
 *
 * `sim-mobile` is the eighth `sim-*` world and the twelfth world overall, and this file is the
 * substitution - the thing standing in for a device, an emulator and an operating system. It is the
 * runtime family's port one family out: the application is a real child process printing command
 * vectors on its stdout, this file executes them, and a criterion reads what the store holds
 * afterwards. No device, no emulator, no instruction translation, no guest OS, no guest kernel and no
 * display are anywhere in the loop; `MOBILE_SIMULATED_SURFACES` names every surface that is stood in,
 * and the reading carries that list as `simulated`, so a PASS is traceable to a named substitute
 * rather than to unexamined reality.
 *
 * Three things here are **real** rather than substituted, and each one is load-bearing:
 *
 * 1. **The application executes for real.** A real child process, real stdout bytes and the operating
 *    system's own exit code. The adapter starts it, not this file - this file only ever sees the
 *    command vectors it printed.
 * 2. **The interface is real.** `bundle.launch` really starts the bundle's own entry point as a second
 *    child process, under a file allowance the adapter supplies. That is why a bundle's `launches` is a
 *    count of processes rather than a counter somebody incremented, and why its `exitCode` and captured
 *    output are readings of a real exit rather than of a computation.
 * 3. **The substitution is declared.** Every limit this world has is written *inside* the value a
 *    criterion compares - `rendered and never drawn`, `declared by the bundle, never prompted for`,
 *    `queued, never delivered` - rather than in a footnote beside it. A substitute that is honest about
 *    its own boundary has to carry that honesty into the comparison, or it reports a limit as held and
 *    a promise as kept.
 *
 * Two things are deliberately **not** recorded, both for reasons the runtime family already paid for:
 *
 * - **No wall clock and no pid.** M1 asks whether the same code produced the same result twice, over
 *   readings this file writes - so a timestamp or a process id would make two runs of one unchanged
 *   program differ, and the metric would report a divergence that is a property of the observation
 *   rather than of the application under it. The only monotonic numbers here are `boots` and
 *   `launches`, which are counts of events rather than readings of a clock.
 * - **No keychain value.** An entry records that a value exists, how many bytes it is and what it
 *   hashes to - never the value itself. A plaintext secret would land in `result.json`, in
 *   `latest-failure.md` and in an uploaded CI artefact, which is three places a credential must not be.
 *
 * What this file does **not** do: it decides no verdicts. Those live in `validators/mobile/*`, which
 * read a document of this shape and never import this module - which is what keeps a validator family
 * from depending on the adapter it happens to be judging today.
 */

import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import {
  deepLinkParts,
  deepLinkProblem,
  isMobileAction,
  MOBILE_ACTIONS,
  MOBILE_SIMULATED_SURFACES,
  permissionKey,
} from "../../core/environment/mobile-observation.ts";
import type {
  MobileAction,
  MobileActionResult,
  MobileBundleReading,
  MobileBundleState,
  MobileCallRecord,
  MobileClient,
  MobileDeepLinkReading,
  MobileDeviceReading,
  MobileDeviceState,
  MobileKeychainReading,
  MobileLogReading,
  MobileNotificationPriority,
  MobileNotificationReading,
  MobileObservationData,
  MobileOrientation,
  MobileOrientationReading,
  MobilePermissionReading,
  MobilePermissionState,
  MobilePlatform,
  MobileScreenReading,
  MobileWorldReading,
} from "../../core/environment/mobile-observation.ts";
import { withDeadline } from "../../core/process.ts";
import type { ProcessConfinement, ProcessHandle, ProcessRunner } from "../../core/process.ts";

/** What this substitute calls itself. Declared, never inferred - the reading carries it verbatim. */
export const SIM_DEVICE_NAME = "veridian-mobile-sim";

/** This substitute's own version. Not the platform's, which is a value the device was told. */
export const SIM_DEVICE_VERSION = "sim-1.0.0";

/** The API level the substitute reports unless the application names another one. */
export const SIM_DEVICE_API_LEVEL = 34;

/** How much of a stream a bundle's log keeps, in bytes. */
const LOG_BOUND = 64 * 1024;

/**
 * Whether anything in this world can put a frame on a surface.
 *
 * A constant rather than a literal `false`, so the reading is *computed from what the world is* rather
 * than asserting a value beside it. The distinction matters: `drawn: false` is a claim a reader has to
 * take on faith, while `drawn: HAS_RENDERER` is a claim the code can be changed to falsify - and it is
 * the same shape as the boundary clauses that were implemented, tested and could not be false.
 */
const HAS_RENDERER = false;

/** Whether this world has a permission prompt. It has none: a decision is recorded, never asked for. */
const HAS_PROMPT_MECHANISM = false;

/** Whether this world can deliver a notification. It cannot: one is queued and never delivered. */
const HAS_PUSH_SERVICE = false;

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

/**
 * What a command did, in the four answers the family distinguishes.
 *
 * `absent` and `refused` are separate members on purpose, and the split is the cluster family's
 * paid-for rule: a resource the world does not hold and a request the world will not answer are two
 * different observations, and a substitute that merges them reports one cause for the other. HTTP
 * already has a word for each, and the container world's `404`-versus-`405` defect is what it cost to
 * learn that a merged answer makes the verdict unearned.
 */
interface Outcome {
  readonly result: MobileActionResult;
  readonly status: number;
  readonly reason?: string;
  readonly resource?: string | null;
}

const answered = (resource: string | null = null): Outcome => ({ result: "answered", status: 0, resource });

const absent = (reason: string, resource: string | null = null): Outcome => ({
  result: "absent",
  status: 1,
  reason,
  resource,
});

const refused = (reason: string, resource: string | null = null): Outcome => ({
  result: "refused",
  status: 1,
  reason,
  resource,
});

const failed = (status: number, reason: string, resource: string | null = null): Outcome => ({
  result: "failed",
  status,
  reason,
  resource,
});

// ---------------------------------------------------------------------------------------------
// The port's published surface
// ---------------------------------------------------------------------------------------------

/** One command as it arrives: the vector, and which of the two clients issued it. */
export interface MobileExecRequest {
  readonly argv: readonly string[];
  readonly client: MobileClient;
}

/** What the adapter hands the substitute. */
export interface MobilePortOptions {
  /** The sandbox this world owns. Everything it writes lives under here and nowhere else. */
  readonly root: string;
  /** Where a relative source path is resolved from - the application's own tree. */
  readonly contextRoot: string;
  /** The declared identity, such as `sim-cart-device`. The serial is derived from it. */
  readonly device: string;
  /** The platform the device reports. A record, not an installed operating system. */
  readonly platform: MobilePlatform;
  /** How to start a child process. The seam the confinement travels through. */
  readonly processes: ProcessRunner;
  /**
   * The file allowance a launched bundle runs under.
   *
   * Supplied by the adapter rather than built here, because the allowance is derived from the goal's
   * declared boundaries and this file sees only a command vector. Passing it in is what keeps the
   * boundary a property of the run rather than a property of the substitute.
   */
  readonly confinement?: ProcessConfinement;
  /** How long a launch may take before it is given up on. */
  readonly defaultLaunchMs?: number;
}

/**
 * A command naming a path this world may not open.
 *
 * Kept rather than dropped, on the boundary rule the whole tree follows: a crossing is evidence about
 * the run, and the verdict reads the list rather than a boolean beside it.
 */
export interface MobileEscape {
  readonly client: MobileClient;
  readonly spelled: string;
}

/**
 * The substitute, as the adapter sees it.
 *
 * Two facts about this interface are deliberate rather than incidental, and both were paid for
 * elsewhere in the tree:
 *
 * - **The call record survives a reset.** `reset()` restores the world; it does not restore the
 *   record. Clearing the log would destroy the evidence of a violation with the very act of repairing
 *   the world, which is the shape of false pass M3 exists to refuse.
 * - **`read()` is pure.** It writes nothing, advances nothing and starts nothing. A reading that
 *   settled a process's fate would be an observation that edits what it observes, and a measurement
 *   nobody can repeat is an opinion.
 */
export interface MobilePort {
  /** Create the world. Idempotent in effect: it builds the world rather than adding to one. */
  prepare(): Promise<void>;
  /** Restore the world to what `prepare()` produced, keeping the call record and the escapes. */
  reset(): Promise<void>;
  /** Run one command vector and record what it did. */
  exec(request: MobileExecRequest): Promise<MobileCallRecord>;
  /** Read the whole world. Starts nothing, writes nothing, changes nothing. */
  read(): Promise<MobileObservationData>;
  /** Every path this world was asked to open and would not. */
  escapes(): readonly MobileEscape[];
  /** Stop anything still running, keeping the sandbox so a bundle can still quote it. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// The store's own records
// ---------------------------------------------------------------------------------------------

interface DeepLinkRecord {
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  opened: number;
}

interface BundleRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly versionCode: number;
  state: MobileBundleState;
  exitCode: number | null;
  launches: number;
  readonly entryPoint: string;
  /**
   * The vector the bundle declares, and never what a launch passed it.
   *
   * The flags `bundle.launch` is given are the criterion's own request, and they are recorded where a
   * request belongs - in the call record's `command`, which is the argv as it was really written. A
   * bundle reading that changed with the last launch would be a reading of the run's own history
   * wearing the bundle's name, and this field would stop being the thing an install declares.
   */
  readonly command: string[];
  readonly dataDir: string;
  readonly files: number;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly declared: string[];
  readonly deepLinks: DeepLinkRecord[];
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
  /** Where the bundle's files really are on this machine. Never leaves the adapter's own reading. */
  readonly dir: string;
  handle: ProcessHandle | null;
  running: boolean;
}

interface NotificationRecord {
  readonly bundle: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly priority: MobileNotificationPriority;
}

interface KeychainRecord {
  readonly bundle: string;
  readonly key: string;
  readonly digest: string;
  readonly bytes: number;
  readonly accessible: string;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const sha256 = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

const tail = (text: string, limit = 300): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `...${flat.slice(flat.length - limit)}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What a directory holds, as this machine really reads it. Deterministic, so M1 can compare two. */
interface Walked {
  readonly files: number;
  readonly sizeBytes: number;
  readonly digest: string;
}

const walkTree = async (dir: string): Promise<Walked> => {
  const hash = createHash("sha256");
  let files = 0;
  let sizeBytes = 0;
  const visit = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(current, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(path);
        files += 1;
        sizeBytes += bytes.byteLength;
        // The relative path travels with the bytes, so two trees holding the same files under
        // different names cannot digest the same. A digest over contents alone would call them equal.
        hash.update(relative);
        hash.update(bytes);
      }
    }
  };
  await visit(dir, "");
  return { files, sizeBytes, digest: `sha256:${hash.digest("hex").slice(0, 12)}` };
};

// ---------------------------------------------------------------------------------------------
// The one command grammar
// ---------------------------------------------------------------------------------------------

interface Parsed {
  readonly flags: ReadonlyMap<string, readonly string[]>;
  readonly subject: string | null;
  readonly rest: readonly string[];
}

type ParseResult = { readonly ok: true; readonly value: Parsed } | { readonly ok: false; readonly reason: string };

/**
 * Parse one command vector's arguments after the action's two words.
 *
 * One grammar for every command, and it is the runtime family's, because a second grammar would be a
 * second set of rules about where a subject ends and a flag begins - and the two would disagree the
 * first time a command carried an odd number of words. Flags come first, `--flag=value` and
 * `--flag value` are both accepted, a repeated flag accumulates rather than overwrites, `--` ends flag
 * parsing, and an unknown flag is a refusal that names it *and* lists what the action does accept.
 */
const parse = (argv: readonly string[], valueFlags: readonly string[]): ParseResult => {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  let ended = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    if (ended || !token.startsWith("--") || token === "--") {
      if (token === "--" && !ended) {
        ended = true;
        index += 1;
        continue;
      }
      rest.push(token);
      index += 1;
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals < 0 ? token : token.slice(0, equals);
    if (!valueFlags.includes(name)) {
      return {
        ok: false,
        reason:
          `${JSON.stringify(name)} is not a flag this action takes. It takes ` +
          (valueFlags.length === 0 ? "none" : valueFlags.join(", ")),
      };
    }
    let value: string;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined) {
        return { ok: false, reason: `${JSON.stringify(name)} needs a value and the command ends after it` };
      }
      value = next;
      index += 1;
    }
    const held = flags.get(name);
    if (held === undefined) flags.set(name, [value]);
    else held.push(value);
    index += 1;
  }
  // The first word that is not a flag is the subject; everything after it is the command's tail.
  // `noUncheckedIndexedAccess` is why this reads `?? null` rather than trusting the index.
  const rest0 = rest[0];
  if (rest0 === undefined) return { ok: true, value: { flags, subject: null, rest: [] } };
  return { ok: true, value: { flags, subject: rest0, rest: rest.slice(1) } };
};

const flag = (parsed: Parsed, name: string): string | undefined => parsed.flags.get(name)?.[0];

const flagAll = (parsed: Parsed, name: string): readonly string[] => parsed.flags.get(name) ?? [];

const numberFlag = (parsed: Parsed, name: string): number | null => {
  const raw = flag(parsed, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const truthy = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "yes" || raw === "1";
};

// ---------------------------------------------------------------------------------------------
// The flag register
// ---------------------------------------------------------------------------------------------

const BOOT_VALUE_FLAGS = [
  "--model",
  "--manufacturer",
  "--os",
  "--api-level",
  "--locale",
  "--width",
  "--height",
  "--density",
  "--scale",
] as const;

const ROTATE_VALUE_FLAGS = ["--orientation", "--lock"] as const;

const INSTALL_VALUE_FLAGS = [
  "--id",
  "--name",
  "--version",
  "--version-code",
  "--entry",
  "--permission",
  "--deeplink",
] as const;

const LAUNCH_VALUE_FLAGS = ["--arg"] as const;

const NOTIFICATION_VALUE_FLAGS = ["--channel", "--title", "--body", "--priority"] as const;

const KEYCHAIN_VALUE_FLAGS = ["--value", "--accessible"] as const;

/**
 * Which flags each action takes.
 *
 * Closed per action rather than global, on the runtime family's rule: two actions may happen to share
 * a parser without sharing a vocabulary, and a world that accepted `--channel` on `device.boot` would
 * be a world reporting an answer to a question nobody asked. Read off this table rather than restated,
 * so a criterion's refusal names exactly what the action it named accepts.
 */
export const MOBILE_VALUE_FLAGS = {
  "device.boot": BOOT_VALUE_FLAGS,
  "device.rotate": ROTATE_VALUE_FLAGS,
  "bundle.install": INSTALL_VALUE_FLAGS,
  "bundle.launch": LAUNCH_VALUE_FLAGS,
  "notification.post": NOTIFICATION_VALUE_FLAGS,
  "keychain.set": KEYCHAIN_VALUE_FLAGS,
} as const;

const valueFlagsFor = (action: MobileAction): readonly string[] => {
  const declared: Readonly<Record<string, readonly string[]>> = MOBILE_VALUE_FLAGS;
  return declared[action] ?? [];
};

/**
 * The flag values that must never be written down.
 *
 * A call record carries the command vector and the reading carries the call records, so a secret
 * handed to `keychain set --value` would travel into `result.json`, into `latest-failure.md` and into
 * an uploaded CI artefact - which is precisely what the keychain's own record refuses to do. Redacting
 * rather than omitting the word is deliberate: the record keeps the *shape* of the request, because
 * what a criterion reads a call for is that a request was made and what it asked for, and the value
 * itself is the one part of it no criterion may read.
 */
const SECRET_VALUE_FLAGS: readonly string[] = ["--value"];

const recordedCommand = (argv: readonly string[]): string => {
  let redact = false;
  return argv
    .map((word) => {
      if (redact) {
        redact = false;
        return "<redacted>";
      }
      redact = SECRET_VALUE_FLAGS.includes(word);
      return word;
    })
    .join(" ");
};

// ---------------------------------------------------------------------------------------------
// The substitute
// ---------------------------------------------------------------------------------------------

export function mobilePort(options: MobilePortOptions): MobilePort {
  const root = options.root;
  const contextRoot = options.contextRoot;
  const processes = options.processes;
  const confinement = options.confinement;
  const launchMs = options.defaultLaunchMs ?? 30_000;

  const bundlesDir = join(root, "store", "bundles");
  const dataDirRoot = join(root, "data");

  const bundles = new Map<string, BundleRecord>();
  const notifications: NotificationRecord[] = [];
  const keychain: KeychainRecord[] = [];
  /** `${bundle}/${permission key}` to the decision. Absent means `not-determined`. */
  const grants = new Map<string, MobilePermissionState>();
  const calls: MobileCallRecord[] = [];
  const escapes: MobileEscape[] = [];

  /**
   * Who is issuing the command in progress.
   *
   * One writer and one reader, set by `exec()` before dispatch and restored in a `finally`, because the
   * boundary predicate sits many frames below the one frame that knows which client asked. Threading it
   * through every handler would make it a parameter of twenty-two functions that mostly do not care
   * about it, and the one that does is the one that would be forgotten.
   */
  let currentClient: MobileClient = "criterion";

  // The declared identity, and the serial derived from it. Derived, not generated: a generated serial
  // would differ between two runs of one unchanged application, which is a difference M1 would read as
  // the application's.
  const deviceId = `EMULATOR-${sha256(options.device).slice(0, 8).toUpperCase()}`;

  let deviceState: MobileDeviceState = "off";
  let boots = 0;
  let orientation: MobileOrientation = "portrait";
  let locked = false;
  let model = "Veridian Sim Device";
  let manufacturer = "Veridian";
  let osName = "Android";
  let osVersion = "14";
  let apiLevel = SIM_DEVICE_API_LEVEL;
  let locale = "en-US";
  let width = 1080;
  let height = 2400;
  let densityDpi = 420;
  let scale = 2.75;

  // -------------------------------------------------------------------------------------------
  // Paths
  // -------------------------------------------------------------------------------------------

  /**
   * The path a command named, as this machine can open it - or a refusal, and an escape.
   *
   * Relative paths resolve against the application's own tree, because that is where a provisioner
   * stands when it names its own source. A path is accepted when it is inside the application's tree or
   * inside this world's sandbox, and refused otherwise *by recording the attempt*: a command that
   * resolved a path outside both would read the developer's own filesystem while calling it the
   * sandbox's, which is the one thing this world must not do - and an inventory of crossings nobody
   * keeps is a boundary nobody can audit.
   */
  const resolveHostPath = (spelled: string, client: MobileClient): { readonly path: string } | { readonly reason: string } => {
    const candidate = isAbsolute(spelled) ? resolvePath(spelled) : resolvePath(contextRoot, spelled);
    const inside = (base: string): boolean => candidate === base || candidate.startsWith(base + (process.platform === "win32" ? "\\" : "/"));
    if (inside(resolvePath(contextRoot)) || inside(resolvePath(root))) return { path: candidate };
    escapes.push({ client, spelled });
    return {
      reason:
        `"${spelled}" is outside both directories a command may open - ` +
        `the application's own tree (${resolvePath(contextRoot)}) and this world's sandbox ` +
        `(${resolvePath(root)})`,
    };
  };

  // -------------------------------------------------------------------------------------------
  // Readings
  // -------------------------------------------------------------------------------------------

  const permissionReadingsOf = (record: BundleRecord): readonly MobilePermissionReading[] => {
    const keys = new Set<string>();
    for (const name of record.declared) keys.add(permissionKey(name));
    for (const held of grants.keys()) {
      const cut = held.indexOf("/");
      if (cut < 0) continue;
      if (held.slice(0, cut) === record.id) keys.add(held.slice(cut + 1));
    }
    return [...keys].sort().map((key) => {
      const declaredName = record.declared.find((name) => permissionKey(name) === key) ?? null;
      return {
        // A permission the device holds a decision about but nobody declared still has to be nameable,
        // so one is spelled from the platform's own namespace. A world that omitted the name would
        // leave a criterion unable to quote the permission it is asking about.
        name: declaredName ?? `android.permission.${key.toUpperCase()}`,
        key,
        declared: declaredName !== null,
        state: grants.get(`${record.id}/${key}`) ?? "not-determined",
        prompted: HAS_PROMPT_MECHANISM,
        reason: null,
      };
    });
  };

  const deepLinkReadingsOf = (record: BundleRecord): readonly MobileDeepLinkReading[] =>
    record.deepLinks.map((link) => ({
      scheme: link.scheme,
      host: link.host,
      path: link.path,
      bundle: record.id,
      opened: link.opened,
    }));

  const bundleReadingOf = (record: BundleRecord): MobileBundleReading => ({
    id: record.id,
    name: record.name,
    version: record.version,
    versionCode: record.versionCode,
    state: record.state,
    running: record.running,
    exitCode: record.exitCode,
    launches: record.launches,
    entryPoint: record.entryPoint,
    command: [...record.command],
    dataDir: record.dataDir,
    files: record.files,
    sizeBytes: record.sizeBytes,
    digest: record.digest,
    permissions: permissionReadingsOf(record),
    deepLinks: deepLinkReadingsOf(record),
  });

  const logReadingOf = (record: BundleRecord): MobileLogReading => ({
    bundle: record.id,
    runs: record.launches,
    stdout: record.stdout,
    stderr: record.stderr,
    stdoutBytes: record.stdoutBytes,
    stderrBytes: record.stderrBytes,
    truncated: record.truncated,
  });

  /**
   * A notification's identity, derived from the bundle and its place in that bundle's own list.
   *
   * Derived rather than sequenced globally, because a global counter would make the second bundle to
   * post also depend on how many the first one posted - so two runs whose bundles posted in a different
   * order would name the same notification differently. A position inside the bundle is a fact about the
   * bundle, which is what makes it stable, and it is the same spelling a criterion addresses a
   * notification by.
   */
  const notificationIdOf = (record: NotificationRecord): string => {
    const position = notifications.filter((held) => held.bundle === record.bundle).indexOf(record) + 1;
    return `${record.bundle}#${String(position)}`;
  };

  const notificationReadingOf = (record: NotificationRecord): MobileNotificationReading => ({
    id: notificationIdOf(record),
    bundle: record.bundle,
    channel: record.channel,
    title: record.title,
    body: record.body,
    priority: record.priority,
    delivered: HAS_PUSH_SERVICE,
  });

  const keychainReadingOf = (record: KeychainRecord): MobileKeychainReading => ({
    bundle: record.bundle,
    key: record.key,
    digest: record.digest,
    bytes: record.bytes,
    accessible: record.accessible,
  });

  const screenReading = (): MobileScreenReading => ({
    width,
    height,
    densityDpi,
    scale,
    drawn: HAS_RENDERER,
  });

  const orientationReading = (): MobileOrientationReading => ({
    orientation,
    rotationDegrees: orientation === "landscape" ? 90 : 0,
    locked,
  });

  const deviceReading = (): MobileDeviceReading => ({
    id: deviceId,
    model,
    manufacturer,
    platform: options.platform,
    osName,
    osVersion,
    locale,
    state: deviceState,
    orientation: orientationReading(),
    screen: screenReading(),
    boots,
  });

  // -------------------------------------------------------------------------------------------
  // Rebuilding the world
  // -------------------------------------------------------------------------------------------

  /**
   * Build the world this run will use, from nothing.
   *
   * `prepare()` and `reset()` are this one function and nothing else, which is the `sim-posix` rule
   * this repository paid a false PASS for: two implementations of one rule disagree the first time a
   * world arrives that only one of them was written for. Here the two would differ by whether the
   * previous run's bundles survived, and the symptom would be a progression one iteration out of step
   * rather than an error - a bundle a criterion found without the application installing it.
   *
   * `calls` and `escapes` are deliberately **not** cleared. See the interface's own note: a reset
   * restores the world, not the record.
   */
  const rebuild = async (): Promise<void> => {
    for (const record of bundles.values()) {
      if (record.handle !== null) await record.handle.stop();
    }
    await rm(root, { recursive: true, force: true });
    await mkdir(bundlesDir, { recursive: true });
    await mkdir(dataDirRoot, { recursive: true });
    bundles.clear();
    notifications.length = 0;
    keychain.length = 0;
    grants.clear();
    deviceState = "off";
    boots = 0;
    orientation = "portrait";
    locked = false;
  };

  // -------------------------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------------------------

  /**
   * The one action this world gates on the device being up, and the message says exactly that.
   *
   * The first draft named three - "nothing can be installed on, launched from or read off a device
   * that is not booted" - while `launchBundle` is this guard's only caller. So the refusal claimed two
   * rules the world does not hold: `bundle.install` is answered on a device that is `off`, which
   * `mobile-port.test.ts` asserts directly rather than through this sentence. *An error message may
   * only name a cause the reporter observed*, and a reader who learned to trust this one would go
   * looking for a boot gate on installation that was never written.
   */
  const requireDevice = (): Outcome | null =>
    deviceState === "booted"
      ? null
      : refused(
          `the device is ${deviceState}; launching a bundle is something a running device does, and ` +
            `nothing can be launched from a device that is not booted`,
        );

  const requireBundle = (id: string | null): { readonly record: BundleRecord } | { readonly outcome: Outcome } => {
    if (id === null) return { outcome: refused("this action names the bundle it acts on, and the command names none") };
    const record = bundles.get(id);
    if (record === undefined) {
      const held = [...bundles.keys()].sort();
      return {
        outcome: absent(
          `this device holds no bundle with the id ${JSON.stringify(id)}. It holds ` +
            (held.length === 0 ? "none" : held.join(", ")),
        ),
      };
    }
    return { record };
  };

  const bootDevice = async (parsed: Parsed): Promise<Outcome> => {
    const named = flag(parsed, "--model");
    if (named !== undefined) model = named;
    const maker = flag(parsed, "--manufacturer");
    if (maker !== undefined) manufacturer = maker;
    const os = flag(parsed, "--os");
    if (os !== undefined) osName = os;
    const api = numberFlag(parsed, "--api-level");
    if (api !== null) apiLevel = api;
    const place = flag(parsed, "--locale");
    if (place !== undefined) locale = place;
    const wide = numberFlag(parsed, "--width");
    if (wide !== null) width = wide;
    const tall = numberFlag(parsed, "--height");
    if (tall !== null) height = tall;
    const dpi = numberFlag(parsed, "--density");
    if (dpi !== null) densityDpi = dpi;
    const density = numberFlag(parsed, "--scale");
    if (density !== null) scale = density;
    deviceState = "booted";
    // A count of boot requests, not of transitions: a device asked to boot twice was asked twice, and
    // the number is here so a criterion can assert that a provisioner really did bring it up.
    boots += 1;
    return answered(deviceId);
  };

  const shutdownDevice = async (): Promise<Outcome> => {
    deviceState = "off";
    orientation = "portrait";
    locked = false;
    return answered(deviceId);
  };

  const rotateDevice = async (parsed: Parsed): Promise<Outcome> => {
    const wanted = flag(parsed, "--orientation");
    if (wanted !== undefined) {
      if (wanted !== "portrait" && wanted !== "landscape") {
        return refused(
          `a device is rotated to "portrait" or "landscape", and this command names ${JSON.stringify(wanted)}`,
        );
      }
      orientation = wanted;
    }
    locked = truthy(flag(parsed, "--lock"), locked);
    return answered(orientationReading().orientation);
  };

  const installBundle = async (parsed: Parsed): Promise<Outcome> => {
    const id = flag(parsed, "--id");
    if (id === undefined || id === "") {
      return refused(`installing a bundle names it with --id, and this command names none`);
    }
    const source = parsed.subject;
    if (source === null) {
      return refused(`installing a bundle names the directory to install from, and the command names none`);
    }
    const resolved = resolveHostPath(source, currentClient);
    if ("reason" in resolved) return refused(resolved.reason, id);

    let isDirectory = false;
    try {
      isDirectory = (await stat(resolved.path)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      return absent(
        `the bundle source ${JSON.stringify(source)} is not a directory this machine can open, so there ` +
          `is nothing to install`,
        id,
      );
    }

    const entryPoint = flag(parsed, "--entry") ?? "main.mjs";
    const dir = join(bundlesDir, id);
    await rm(dir, { recursive: true, force: true });
    await cp(resolved.path, dir, { recursive: true });

    const walked = await walkTree(dir);
    const dataDir = join(dataDirRoot, id);
    await mkdir(dataDir, { recursive: true });

    const record: BundleRecord = {
      id,
      name: flag(parsed, "--name") ?? id,
      version: flag(parsed, "--version") ?? "0.0.0",
      versionCode: numberFlag(parsed, "--version-code") ?? 0,
      state: "installed",
      exitCode: null,
      launches: 0,
      entryPoint,
      command: [entryPoint, ...flagAll(parsed, "--arg")],
      dataDir,
      files: walked.files,
      sizeBytes: walked.sizeBytes,
      digest: walked.digest,
      declared: [...flagAll(parsed, "--permission")],
      deepLinks: [],
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      truncated: false,
      dir,
      handle: null,
      running: false,
    };

    for (const uri of flagAll(parsed, "--deeplink")) {
      const parts = deepLinkParts(uri);
      if (parts === null) {
        return refused(
          `the deep link ${JSON.stringify(uri)} is not one: ${deepLinkProblem(uri) ?? "it could not be read"}`,
          id,
        );
      }
      record.deepLinks.push({ scheme: parts.scheme, host: parts.host, path: parts.path, opened: 0 });
    }

    // Replacing a bundle keeps the decisions a previous install's criteria recorded, because a
    // reinstall of a running device is the ordinary way to change an application and the grants belong
    // to the device rather than to the files. What is dropped is nothing - the decisions are keyed by
    // the bundle's id, which is the same id.
    bundles.set(id, record);
    return answered(id);
  };

  const launchBundle = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;

    const booted = requireDevice();
    if (booted !== null) return booted;

    if (record.state === "removed") {
      return refused(
        `bundle ${record.id} was uninstalled, so it is recorded and not runnable. Install it again to ` +
          `launch it`,
        record.id,
      );
    }

    const path = join(record.dir, record.entryPoint);
    let present = false;
    try {
      present = (await stat(path)).isFile();
    } catch {
      present = false;
    }
    if (!present) {
      // Reported at launch rather than at install on purpose: this world records what a bundle
      // *declares* when it is installed and tells the truth about what is *really there* when it is
      // run, which is the same separation the runtime family keeps between a declared mount and a path
      // that can actually be opened.
      return absent(
        `bundle ${record.id} declares its entry point as ${JSON.stringify(record.entryPoint)}, and the ` +
          `installed tree holds no such file. It is installed from files this machine can read, so the ` +
          `file the bundle named was never written`,
        record.id,
      );
    }

    const args = [path, ...flagAll(parsed, "--arg")];
    const handle = processes.run({
      command: process.execPath,
      args,
      cwd: record.dir,
      confinement,
    });
    record.handle = handle;
    record.running = true;
    record.state = "running";
    record.launches += 1;

    try {
      const result = await withDeadline(handle, launchMs);
      record.exitCode = result.code;
      const out = result.stdout;
      const err = result.stderr;
      record.stdoutBytes += out.length;
      record.stderrBytes += err.length;
      const combined = record.stdout + out;
      if (combined.length > LOG_BOUND) {
        record.stdout = combined.slice(combined.length - LOG_BOUND);
        record.truncated = true;
      } else {
        record.stdout = combined;
      }
      const errCombined = record.stderr + err;
      if (errCombined.length > LOG_BOUND) {
        record.stderr = errCombined.slice(errCombined.length - LOG_BOUND);
        record.truncated = true;
      } else {
        record.stderr = errCombined;
      }
      if (result.timedOut) {
        record.state = "stopped";
        return failed(
          1,
          `bundle ${record.id} was still running after ${String(launchMs)}ms and was stopped. It wrote ` +
            `${tail(out) === "" ? "nothing to stdout" : `to stdout: ${tail(out)}`}`,
          record.id,
        );
      }
      record.state = "stopped";
      return answered(record.id);
    } finally {
      record.handle = null;
      record.running = false;
    }
  };

  const terminateBundle = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    if (record.handle !== null) {
      await record.handle.stop();
      record.handle = null;
      record.running = false;
    }
    record.state = "stopped";
    return answered(record.id);
  };

  const uninstallBundle = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    if (record.handle !== null) {
      await record.handle.stop();
      record.handle = null;
      record.running = false;
    }
    record.state = "removed";
    await rm(record.dir, { recursive: true, force: true });
    await rm(record.dataDir, { recursive: true, force: true });
    // The record stays in the store with `removed` as its state, and the decisions go with the
    // application. A criterion can still ask *what* was removed - which is the question the family's
    // `mobile.bundle` validator exists for, and the one `mobile.installed` deliberately does not answer.
    for (const key of [...grants.keys()]) {
      if (key.startsWith(`${record.id}/`)) grants.delete(key);
    }
    return answered(record.id);
  };

  const clearBundleData = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    await rm(record.dataDir, { recursive: true, force: true });
    await mkdir(record.dataDir, { recursive: true });
    return answered(record.id);
  };

  const decidePermission = (state: MobilePermissionState) => async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    const spelled = parsed.rest[0];
    if (spelled === undefined || spelled === "") {
      return refused(
        `${state === "not-determined" ? "resetting" : `${state === "granted" ? "granting" : "denying"}`} ` +
          `a permission names it after the bundle, and the command names none`,
        record.id,
      );
    }
    // A criterion writes `camera`; a device holds `android.permission.CAMERA`. The short key is the
    // family's own spelling and is computed by the vocabulary rather than parsed again here, so a
    // manifest name and a short key cannot normalise to two different entries.
    const key = spelled.includes(".") ? permissionKey(spelled) : spelled;
    grants.set(`${record.id}/${key}`, state);
    return answered(`${record.id}/${key}`);
  };

  const registerDeepLink = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    const uri = parsed.rest[0];
    if (uri === undefined || uri === "") {
      return refused(`registering a deep link names the URI after the bundle, and the command names none`, record.id);
    }
    const parts = deepLinkParts(uri);
    if (parts === null) {
      return refused(
        `${JSON.stringify(uri)} is not a deep link: ${deepLinkProblem(uri) ?? "it could not be read"}`,
        record.id,
      );
    }
    const already = record.deepLinks.find(
      (link) => link.scheme === parts.scheme && link.host === parts.host && link.path === parts.path,
    );
    if (already !== undefined) return answered(uri);
    record.deepLinks.push({ scheme: parts.scheme, host: parts.host, path: parts.path, opened: 0 });
    return answered(uri);
  };

  const openDeepLink = async (parsed: Parsed): Promise<Outcome> => {
    const uri = parsed.subject;
    if (uri === null) return refused(`opening a deep link names the URI, and the command names none`);
    const parts = deepLinkParts(uri);
    if (parts === null) {
      return refused(`${JSON.stringify(uri)} is not a deep link: ${deepLinkProblem(uri) ?? "it could not be read"}`);
    }
    for (const record of bundles.values()) {
      for (const link of record.deepLinks) {
        // Scheme and host exactly, path by prefix - see `deepLinkParts`. A path of "" is the whole host,
        // so it matches every path under it, which is what registering `veridian://cart` means.
        if (link.scheme !== parts.scheme || link.host !== parts.host) continue;
        if (link.path !== "" && !parts.path.startsWith(link.path)) continue;
        link.opened += 1;
        return answered(uri);
      }
    }
    return absent(
      `no bundle on this device has registered ${JSON.stringify(uri)}. Open is resolved against the ` +
        `links bundles registered, and nothing resolves it`,
      uri,
    );
  };

  const postNotification = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    const priority = flag(parsed, "--priority") ?? "normal";
    if (priority !== "low" && priority !== "normal" && priority !== "high") {
      return refused(
        `a notification's priority is "low", "normal" or "high", and this command names ` +
          `${JSON.stringify(priority)}`,
        record.id,
      );
    }
    const posted: NotificationRecord = {
      bundle: record.id,
      channel: flag(parsed, "--channel") ?? "default",
      title: flag(parsed, "--title") ?? "",
      body: flag(parsed, "--body") ?? "",
      priority,
    };
    notifications.push(posted);
    return answered(notificationIdOf(posted));
  };

  const readLogs = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    return answered(held.record.id);
  };

  const setKeychain = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    const record = held.record;
    const key = parsed.rest[0];
    if (key === undefined || key === "") {
      return refused(`writing a keychain entry names the key after the bundle, and the command names none`, record.id);
    }
    const value = flag(parsed, "--value");
    if (value === undefined) {
      return refused(`writing a keychain entry names the value with --value, and this command names none`, record.id);
    }
    const entry: KeychainRecord = {
      bundle: record.id,
      key,
      // The digest travels; the value never does. A plaintext secret in a reading is a plaintext secret
      // in `result.json`, in `latest-failure.md` and in an uploaded CI artefact.
      digest: `sha256:${sha256(value).slice(0, 12)}`,
      bytes: Buffer.byteLength(value, "utf8"),
      accessible: flag(parsed, "--accessible") ?? "when-unlocked",
    };
    const at = keychain.findIndex((held) => held.bundle === record.id && held.key === key);
    if (at < 0) keychain.push(entry);
    else keychain[at] = entry;
    return answered(`${record.id}/${key}`);
  };

  const listKeychain = async (): Promise<Outcome> => answered(null);

  const inspectBundle = async (parsed: Parsed): Promise<Outcome> => {
    const held = requireBundle(parsed.subject);
    if ("outcome" in held) return held.outcome;
    return answered(held.record.id);
  };

  const listBundles = async (): Promise<Outcome> => answered(null);

  const listNotifications = async (): Promise<Outcome> => answered(null);

  const deviceInfo = async (): Promise<Outcome> => answered(deviceId);

  const devicePing = async (): Promise<Outcome> => answered(deviceId);

  /**
   * The register.
   *
   * A flat table keyed on the action name, exactly as the runtime family's is: simple actions are inline
   * closures and the ones that do real work delegate to a named function, so the table reads as *what
   * this world answers* rather than as an index into twenty-two bodies.
   */
  const HANDLERS: Readonly<Record<string, (parsed: Parsed) => Promise<Outcome>>> = {
    "device.boot": bootDevice,
    "device.shutdown": shutdownDevice,
    "device.info": deviceInfo,
    "device.rotate": rotateDevice,
    "device.ping": devicePing,
    "bundle.install": installBundle,
    "bundle.launch": launchBundle,
    "bundle.terminate": terminateBundle,
    "bundle.inspect": inspectBundle,
    "bundle.list": listBundles,
    "bundle.uninstall": uninstallBundle,
    "bundle.clearData": clearBundleData,
    "permission.grant": decidePermission("granted"),
    "permission.deny": decidePermission("denied"),
    "permission.reset": decidePermission("not-determined"),
    "deepLink.register": registerDeepLink,
    "deepLink.open": openDeepLink,
    "notification.post": postNotification,
    "notification.list": listNotifications,
    "logs.read": readLogs,
    "keychain.set": setKeychain,
    "keychain.list": listKeychain,
  };

  /**
   * The action a vector names, or `null`.
   *
   * The first two words are the noun and the verb, so `bundle install com.veridian.cart` is
   * `bundle.install`. A vector naming a pair that is not a member normalises to **nothing** rather than
   * to the nearest member: the call record carries `action: null`, which is the honest answer, and the
   * refusal names the whole register so an operator can see what the world does answer.
   */
  const actionOf = (argv: readonly string[]): MobileAction | null => {
    const candidate = `${argv[0] ?? ""}.${argv[1] ?? ""}`;
    return isMobileAction(candidate) ? candidate : null;
  };

  return {
    async prepare(): Promise<void> {
      await rebuild();
    },

    async reset(): Promise<void> {
      await rebuild();
    },

    async exec(request: MobileExecRequest): Promise<MobileCallRecord> {
      const argv = request.argv;
      const action = actionOf(argv);
      const command = recordedCommand(argv);
      const fallback = argv[2] ?? null;
      let outcome: Outcome;
      const previous = currentClient;
      currentClient = request.client;
      try {
        if (action === null) {
          outcome = refused(
            `\`${command}\` names no action. This world answers ` +
              `${[...MOBILE_ACTIONS].join(", ")}, each written as two words - the noun and then the verb`,
            fallback,
          );
        } else {
          const handler = HANDLERS[action];
          if (handler === undefined) {
            outcome = refused(
              `\`${action}\` is an action this register names and does not implement, so this world can ` +
                `neither answer it nor refuse it for a reason an operator can act on`,
              fallback,
            );
          } else {
            const parsed = parse(argv.slice(2), valueFlagsFor(action));
            outcome = parsed.ok ? await handler(parsed.value) : refused(parsed.reason, fallback);
          }
        }
      } finally {
        currentClient = previous;
      }
      const record: MobileCallRecord = {
        action,
        client: request.client,
        command,
        resource: outcome.resource ?? null,
        result: outcome.result,
        status: outcome.status,
        reason: outcome.reason ?? null,
      };
      calls.push(record);
      return record;
    },

    async read(): Promise<MobileObservationData> {
      const held = [...bundles.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      const world: MobileWorldReading = {
        name: SIM_DEVICE_NAME,
        version: SIM_DEVICE_VERSION,
        apiLevel,
        bundles: held.length,
        launched: held.reduce((total, record) => total + record.launches, 0),
        notifications: notifications.length,
      };
      return {
        device: options.device,
        world,
        state: deviceReading(),
        // The sandbox as this machine can open it, resolved here rather than by a reader. The
        // *declared* root is the document's own spelling and lives in the adapter's reading; the two
        // are separate fields because they are separate facts, and the machine family paid for
        // conflating them.
        sandbox: resolvePath(root),
        simulated: MOBILE_SIMULATED_SURFACES,
        calls: [...calls],
        bundles: held.map(bundleReadingOf),
        logs: held.map(logReadingOf),
        notifications: notifications.map(notificationReadingOf),
        keychain: keychain.map(keychainReadingOf),
      };
    },

    escapes(): readonly MobileEscape[] {
      return [...escapes];
    },

    async stop(): Promise<void> {
      for (const record of bundles.values()) {
        if (record.handle !== null) {
          await record.handle.stop();
          record.handle = null;
          record.running = false;
        }
      }
      // The sandbox is deliberately left where it is, because a bundle quotes paths inside it.
    },
  };
}

/** A guard the tests use, and the reading path uses nothing else. */
export const isMobileExecRequest = (value: unknown): value is MobileExecRequest =>
  isRecord(value) && Array.isArray(value["argv"]) && typeof value["client"] === "string";
