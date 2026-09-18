/**
 * The mobile family's reading vocabulary: what a criterion may ask about a device.
 *
 * This is the eighth `sim-*` world and the twelfth world overall, and it is the *contract* between the
 * substitute, the adapters and the validators - the same role
 * {@link file://./container-observation.ts} plays for the runtime family. A validator reads a document
 * of this shape and never imports an adapter, which is the rule that has now held eleven times: a
 * family whose world is entirely made up still needs no change in `core/` beyond the file it reads.
 *
 * ## The three conditions a simulated world must satisfy
 *
 * 1. **The application executes for real.** The provisioner is a real child process, started by a real
 *    runner, and its stdout is read as bytes. Its exit code is the operating system's.
 * 2. **The interface is real.** The application provisions the device by printing command vectors this
 *    world parses, and `bundle.launch` really starts the bundle's entry point as a second child
 *    process - which is why `launches` is a count of processes rather than a counter.
 * 3. **The substitution is declared.** {@link MOBILE_SIMULATED_SURFACES} names every surface that is
 *    stood in for, the reading carries it as `simulated`, and every limit the world states about itself
 *    is written *inside the value a criterion compares* rather than in a footnote beside it.
 *
 * What is **real** here: the provisioner process, its exit code and its bytes; the bundle's files as
 * this machine reads them, and the digest computed over them; the launched process, its exit code and
 * the stdout and stderr it really wrote. What is **substituted**: there is no device, no emulator, no
 * instruction translation, no guest operating system, no guest kernel, no display, no input pipeline,
 * no kernel-enforced sandbox, no keychain service, no app store and no push service.
 *
 * ## Two things this family deliberately does not record
 *
 * **No wall clock, and no pid.** There are no timestamps, no durations and no process ids anywhere in
 * this document - the rule the container family paid for. `metrics`' M1 compares two runs' readings of
 * one unchanged program, and a clock or a pid would make the same program differ between them, which
 * turns the one metric that can detect a flaky world into a metric that always reports a difference.
 * The one place a monotonic count appears is `boots` and `launches`, which are counts of events rather
 * than readings of a clock.
 *
 * **No value in the keychain.** A keychain entry records that a value exists, how long it is and the
 * digest of it, and never the value itself. A substitute that wrote the plaintext into a reading would
 * put a secret into `result.json`, into `latest-failure.md` and into an uploaded CI artefact - which is
 * the one thing a keychain exists to prevent. This is a *reading*'s decision and not the world's: the
 * world may hold whatever the application gave it, and what it hands a criterion is the digest.
 *
 * ## The stated limits, and why each lives in a compared string
 *
 * Four readings here would claim more than the world did if their rendering omitted the substitution,
 * and the container family's `renderLimit` is the precedent: it compares `memory 268435456 bytes, cpus
 * 1, pids 64 (declared, not enforced)` because a value without the parenthetical would say a limit
 * *held*. The four are:
 *
 * | Reading | The parenthetical it carries |
 * |---|---|
 * | {@link renderScreen} | `rendered and never drawn` |
 * | {@link renderPermission} | `declared by the bundle, never prompted for` |
 * | {@link renderNotification} | `queued, never delivered` |
 * | {@link renderDeepLink} | `resolved, no bundle launched` |
 *
 * and {@link renderKeychain} carries `value not recorded` for the fifth fact of the same kind.
 *
 * The rule is not decoration. A `contains` in a contract is a sentence about a rendering, so a
 * criterion that pins `recorded and never dispatched` is *asserting the substitution* as well as the
 * event - and a future world that really dispatched a touch would fail that criterion rather than
 * quietly satisfy it. *A verdict may only claim what its reading observed*, and the cheapest way to
 * hold that is to put the observation in the text being compared.
 *
 * ## What this file does not do
 *
 * It decides no verdicts. Which status each comparison earns is `validators/mobile/*`, the layer above
 * - the same boundary `core/environment/db-observation.ts` draws for the database family. It also does
 * not parse a command vector: that is `adapters/sim-mobile/mobile-port.ts`, because a command vector is
 * the *world's* spelling and a reading is the *criterion's*.
 */

/** The `kind` every reading in this family carries. */
export const MOBILE_OBSERVATION_KIND = "mobile.device";

/**
 * Every surface this world stands in for.
 *
 * Nine members, and each one names something a reader would otherwise be entitled to assume was real.
 * The first three are the design's own (`device`, `emulator`, `touch-os`); the rest were added because
 * the readings this file declares make claims they cover - a reading of a screen claims a display, a
 * reading of a permission claims a sandbox, a reading of a keychain entry claims something that
 * protects it.
 *
 * The list is what `simulated-surfaces.test.ts` compares against the world table in
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`, so a surface named here and nowhere else fails a test rather
 * than living in one document only.
 */
export const MOBILE_SIMULATED_SURFACES = [
  /** No physical device, no device image and no hardware of any kind. */
  "device",
  /** No emulator process and no instruction translation. A launched bundle is a Node process. */
  "emulator",
  /** No guest operating system and no guest kernel. Nothing is booted. */
  "touch-os",
  /** The screen's geometry is a record; nothing composes a frame and nothing draws one. */
  "display",
  /** A touch event is recorded and never dispatched, because there is no input pipeline. */
  "input",
  /** A permission is declared by a bundle's manifest; no kernel gates a call on it. */
  "sandbox",
  /** Nothing encrypts, unlocks or protects a stored value; only a digest is kept. */
  "keychain-service",
  /** No package is downloaded, verified or signature-checked. A bundle is read from disk. */
  "app-store",
  /** No notification leaves the device, because there is no push service to carry it. */
  "push-service",
] as const;

export type MobileSimulatedSurface = (typeof MOBILE_SIMULATED_SURFACES)[number];

/**
 * How a command the world was asked to perform ended.
 *
 * `absent` and `refused` are two different observations and the split is the cluster family's, paid for
 * once: a resource that is missing and a request that is not served are different facts with different
 * repairs. A request for a bundle the device does not hold is `absent`; a request this world does not
 * implement, or one that names a path outside the sandbox, is `refused`. `failed` is a command the
 * world really performed whose process exited non-zero.
 */
export const MOBILE_ACTION_RESULTS = ["answered", "absent", "refused", "failed"] as const;

export type MobileActionResult = (typeof MOBILE_ACTION_RESULTS)[number];

/**
 * Who asked.
 *
 * The one field that makes a criterion's own request distinguishable from the application's, which is
 * the distinction the cloud and data families paid for: `mobile.call` reads the **application's**
 * record and `mobile.probe` the **criterion's**, so a contract cannot earn a pass with a request it
 * made itself.
 */
export const MOBILE_CLIENTS = ["provisioner", "criterion"] as const;

export type MobileClient = (typeof MOBILE_CLIENTS)[number];

/** Whether the device is up. Two members: a device is either booted or it is not. */
export const MOBILE_DEVICE_STATES = ["off", "booted"] as const;

export type MobileDeviceState = (typeof MOBILE_DEVICE_STATES)[number];

/**
 * The axis the device is held on.
 *
 * Two members rather than four, and the reason is that a real device API answers with a *quadrant* -
 * which edge is up - and a quadrant is a fact about a sensor this world does not have. What it does
 * hold is the axis the contract asked for, so it says the axis and refuses a criterion that names a
 * quadrant by naming this list.
 */
export const MOBILE_ORIENTATIONS = ["portrait", "landscape"] as const;

export type MobileOrientation = (typeof MOBILE_ORIENTATIONS)[number];

/**
 * The platforms this world stands in for.
 *
 * A list with **one** member, on the same argument the container family records for `linux`: a platform
 * decides which manifest format, which permission namespace and which path grammar a bundle is read
 * with, so a document naming a platform this world does not implement would be a document whose every
 * criterion was answered by a grammar written for a different one. A constant would be a fact with
 * nowhere to grow; a list is where a second platform is *declared*, and until one is, a document that
 * names one is refused by a sentence that names the list.
 */
export const MOBILE_PLATFORMS = ["android"] as const;

export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

/**
 * What a bundle on this device is doing.
 *
 * `removed` is a state rather than the absence of a record, and the distinction matters: a criterion
 * asking whether a package was uninstalled wants to read that the world *was asked to remove it and
 * did*, which is a different fact from a bundle id that was never installed at all. That is the same
 * shape as the machine family's `absent`-versus-`refused` split.
 */
export const MOBILE_BUNDLE_STATES = ["installed", "running", "stopped", "removed"] as const;

export type MobileBundleState = (typeof MOBILE_BUNDLE_STATES)[number];

/**
 * What the device says about a permission.
 *
 * `not-determined` is deliberately distinct from `denied`, because they are different facts with
 * different repairs: `denied` is a request that was refused, `not-determined` is one nobody ever
 * answered - which is the state a real device reports before a prompt, and the state this world holds
 * permanently for anything the bundle declares and no criterion grants.
 */
export const MOBILE_PERMISSION_STATES = ["granted", "denied", "not-determined"] as const;

export type MobilePermissionState = (typeof MOBILE_PERMISSION_STATES)[number];

/** The stream a launched bundle wrote to. */
export const MOBILE_LOG_CHANNELS = ["stdout", "stderr"] as const;

export type MobileLogChannel = (typeof MOBILE_LOG_CHANNELS)[number];

/** How loud a notification the application posted is. A closed list, so a criterion may name one. */
export const MOBILE_NOTIFICATION_PRIORITIES = ["low", "normal", "high"] as const;

export type MobileNotificationPriority = (typeof MOBILE_NOTIFICATION_PRIORITIES)[number];

/**
 * The action vocabulary, in the spelling a criterion and a call record both use.
 *
 * `bundle.install` and `permission.grant` rather than `adb install` and `adb shell pm grant`, because a
 * record that stored the command line as the action would be storing the *client's* spelling, and a
 * second client naming the same action differently would then be a second action. The command line is
 * kept beside it in {@link MobileCallRecord.command}, as it arrived.
 *
 * The list is closed. A command vector naming something outside it is refused by name, which is the
 * `call` step's rule one family over: a vocabulary that grows must grow its refusals with it.
 */
export const MOBILE_ACTIONS = [
  "device.boot",
  "device.shutdown",
  "device.info",
  "device.rotate",
  "device.ping",
  "bundle.install",
  "bundle.launch",
  "bundle.terminate",
  "bundle.inspect",
  "bundle.list",
  "bundle.uninstall",
  "bundle.clearData",
  "permission.grant",
  "permission.deny",
  "permission.reset",
  "deepLink.register",
  "deepLink.open",
  "notification.post",
  "notification.list",
  "logs.read",
  "keychain.set",
  "keychain.list",
] as const;

export type MobileAction = (typeof MOBILE_ACTIONS)[number];

/**
 * Whether a string is one of {@link MOBILE_ACTIONS}.
 *
 * A predicate rather than a second list beside the tuple, on the container family's rule: this family's
 * action table is the names themselves, so the tuple *is* the membership test and a second copy of it
 * would be free to drift from the one the handlers are keyed on.
 */
export function isMobileAction(value: string): value is MobileAction {
  return (MOBILE_ACTIONS as readonly string[]).includes(value);
}

/** One command vector the world was asked to perform, and what it did. */
export interface MobileCallRecord {
  /**
   * The action the command named, or `null` when this world does not implement it.
   *
   * The `null` is the design, for the reason the runtime family records at the same field: this
   * family's vocabulary is closed, so a command vector naming `device.factoryReset` normalises to
   * nothing. Recording it under the action it most nearly resembles would be a record asserting a call
   * that was never made, and dropping it would leave a contract unable to observe the refusal - which
   * is the observation a contract about a *substitute* most needs to be able to make.
   */
  readonly action: MobileAction | null;
  readonly client: MobileClient;
  /**
   * The command line as it arrived, joined with single spaces.
   *
   * Every other field here is derived from this one, so keeping it is what makes the record auditable
   * rather than asserted - and the operator's failure report quotes what the application actually said.
   */
  readonly command: string;
  /** The thing the command named, in this family's reference spelling, or `null` when it named none. */
  readonly resource: string | null;
  readonly result: MobileActionResult;
  /**
   * The status the command line itself reported. `0` for a command that was performed and whose bundle
   * process exited non-zero, because those are two different facts: `failed` is the bundle's exit code
   * and this is the client's.
   */
  readonly status: number;
  /** Why the world refused, when it did. `null` otherwise. */
  readonly reason: string | null;
}

/**
 * The screen, as the world resolved it.
 *
 * `drawn` is computed by the world from whether it has a renderer at all - it has none, so it answers
 * `false` - rather than written as a literal, and the distinction is the defect `safetyViolation: null`
 * already cost this project: a field written as a literal by the writer is a claim pretending to be a
 * record, because even a screen that *was* drawn could not have been reported. A future substitution
 * with real compositing would compute `true` without this file changing.
 *
 * The geometry is real in the sense that matters: the contract declares it and the world resolves it,
 * so a criterion comparing `1080x2400 at 420dpi` is comparing a value the world holds rather than one
 * it echoed back.
 */
export interface MobileScreenReading {
  readonly width: number;
  readonly height: number;
  readonly densityDpi: number;
  readonly scale: number;
  /** Whether anything really reached a surface. Computed by the world; never asserted. */
  readonly drawn: boolean;
}

/** Which way up the device is held, and whether the contract pinned it. */
export interface MobileOrientationReading {
  readonly orientation: MobileOrientation;
  /** The rotation the world resolved for this orientation, in degrees. */
  readonly rotationDegrees: number;
  /**
   * Whether the contract asked the device to stop following rotation.
   *
   * A lock is a *declaration* - it says what the world will answer to a later rotate - and it is the
   * one field of this reading that is not a fact about geometry.
   */
  readonly locked: boolean;
}

/**
 * One permission a bundle declares, and what the device answers about it.
 *
 * Three facts that are deliberately not collapsed into one:
 *
 * - `declared` is what the bundle's own manifest says. A declaration is not a grant.
 * - `state` is what the device answers. It may be `granted` for a permission the manifest never
 *   declared, because a criterion can grant anything - which is a real device's behaviour too.
 * - `prompted` is whether a user was ever asked. Computed by the world from whether it has a prompt
 *   mechanism at all; it has none, so it answers `false`.
 *
 * The three exist because they repair differently: a permission that was never declared is a manifest
 * defect, one that is denied is a policy defect, and one nobody prompted for is a substitution the
 * operator has to know about before they write a criterion about consent.
 */
export interface MobilePermissionReading {
  /** The name as the manifest spells it, e.g. `android.permission.CAMERA`. */
  readonly name: string;
  /** The short key a criterion writes in a target, e.g. `camera`. Derived from `name`, never stored twice. */
  readonly key: string;
  readonly declared: boolean;
  readonly state: MobilePermissionState;
  /** Whether a user was ever asked. Computed by the world; never asserted. */
  readonly prompted: boolean;
  /** Why the world refused to change it, when it did. `null` otherwise. */
  readonly reason: string | null;
}

/**
 * One deep link a bundle registered.
 *
 * `opened` is a count of resolutions the world performed for a client, and the reading says what a
 * resolution *was*: the world matched a URI to the bundle that registered it and recorded that it did.
 * No process starts, which is why {@link renderDeepLink} says so - a bare `opened 1 time(s)` would
 * claim a launch that never happened.
 *
 * The URI is held in three parts rather than as one string, because the matching rule needs them apart:
 * a scheme and a host are matched exactly and a path is matched by prefix, which is what makes a
 * criterion able to register `veridian://cart` and then assert that `veridian://cart/item` resolved.
 */
export interface MobileDeepLinkReading {
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  /** The bundle id that registered it. */
  readonly bundle: string;
  readonly opened: number;
}

/**
 * One notification the application posted.
 *
 * `id` is derived from the bundle and the position in that bundle's own list, so it is deterministic:
 * the same run posts the same ids, and M1 can compare two runs' readings. `delivered` is computed by
 * the world from whether it has a push service at all; it has none, so it answers `false`.
 */
export interface MobileNotificationReading {
  readonly id: string;
  readonly bundle: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly priority: MobileNotificationPriority;
  /** Whether anything carried it off the device. Computed by the world; never asserted. */
  readonly delivered: boolean;
}

/**
 * The bytes a launched bundle really wrote.
 *
 * A bundle may be launched more than once, so `runs` is a count rather than a flag and the output is
 * the concatenation of every launch - a real device keeps one log per bundle and so does this one.
 * `truncated` says when the world stopped keeping bytes, so a criterion reading a log is never reading
 * a prefix it believes is the whole story.
 */
export interface MobileLogReading {
  readonly bundle: string;
  readonly runs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly truncated: boolean;
}

/**
 * One keychain entry, and the one field it deliberately does not have.
 *
 * There is no `value`. The world keeps the digest and the length, so two writes of the same secret
 * agree and two writes of different ones do not - which is everything a criterion needs to assert that
 * a secret was stored, and nothing that would put the secret into the evidence bundle. The absence is a
 * decision rather than an omission, and this doc comment is where it is written down: a reading that
 * carried the plaintext would be a keychain that leaks by being observed.
 */
export interface MobileKeychainReading {
  readonly bundle: string;
  readonly key: string;
  /** `sha256:<hex>`, computed over the value the application gave. The value itself is never kept here. */
  readonly digest: string;
  readonly bytes: number;
  /** The accessibility class the command asked for, e.g. `when-unlocked`. A record, not a policy. */
  readonly accessible: string;
}

/**
 * One bundle on the device.
 *
 * The logs are a separate list, on the rule the cloud and runtime families both follow: a bundle
 * reading is about *what the bundle is* and a log reading is about *what it said*, and merging them
 * would make one record answer two questions with two different repair paths.
 *
 * `running` is observed when the reading is taken, from the real child process, and it exists beside
 * `state` because they can disagree in a way worth seeing: a bundle whose state is `running` and whose
 * process has already exited is the shape of a program that returned while its supervisor was not
 * looking. `digest` is computed over the bundle's files as this machine really read them, which is what
 * makes "the device holds the code we just built" a thing a criterion can check.
 */
export interface MobileBundleReading {
  /** The bundle id, e.g. `com.veridian.cart`. The name a target spells. */
  readonly id: string;
  /** The display name from the manifest. */
  readonly name: string;
  /** The version string from the manifest, e.g. `1.4.0`. */
  readonly version: string;
  /** The monotonic version number a device compares instead of the string. */
  readonly versionCode: number;
  readonly state: MobileBundleState;
  readonly running: boolean;
  /** The exit code the operating system reported for the last launch, or `null` if none finished. */
  readonly exitCode: number | null;
  /** How many times the world really started this bundle's entry point. A count of processes. */
  readonly launches: number;
  /** The file inside the bundle the world starts, relative to it. */
  readonly entryPoint: string;
  /** The command line the bundle was last launched with. */
  readonly command: readonly string[];
  /** Where the device holds this bundle's writable data, in the device's own spelling. */
  readonly dataDir: string;
  readonly files: number;
  readonly sizeBytes: number;
  /** The digest of the bundle's files as this machine read them. Real, not recorded. */
  readonly digest: string;
  readonly permissions: readonly MobilePermissionReading[];
  readonly deepLinks: readonly MobileDeepLinkReading[];
}

/**
 * What the substitute says about itself.
 *
 * `name` and `version` are declared rather than inferred, so a bundle quoting `veridian-mobile-sim` is
 * quoting an identity the world stated instead of a string a reader assembled from a filename. The
 * counts are the world's own - and they are counts of real things: `bundles` is the number of records
 * the store holds, `launches` the number of processes it really started.
 */
export interface MobileWorldReading {
  /** The substitute identity, e.g. `veridian-mobile-sim`. Declared, never inferred. */
  readonly name: string;
  readonly version: string;
  /** The device API level this world answers as. A record, not an installed operating system. */
  readonly apiLevel: number;
  readonly bundles: number;
  readonly launched: number;
  readonly notifications: number;
}

/**
 * Everything a criterion may read about the device.
 *
 * The top-level fields are ordered the way a reader asks the questions: what the world is, what the
 * device is, what it holds, and what was done to it.
 *
 * `device` is the declared identity and `state` is the device's own reading, which is the same split
 * the runtime family draws between its `runtime` string and its readings - a name is not a state, and a
 * bundle that quoted the declared name where an operator expected the model would send its reader to
 * the wrong document.
 */
export interface MobileObservationData {
  /** The device identity the environment document declared, e.g. `sim-cart-device`. */
  readonly device: string;
  readonly world: MobileWorldReading;
  readonly state: MobileDeviceReading;
  /**
   * The world's own sandbox directory, as this machine spells it.
   *
   * Absolute, and resolved by the adapter rather than by a reader: a bundle that named the document's
   * relative spelling would be quoting a path that is not the path the world really wrote to, which is
   * the defect the machine family paid for when it logged a resolved root and a declared one side by
   * side and a reader trusted the wrong one.
   */
  readonly sandbox: string;
  /** The substituted surfaces, from the closed vocabulary above. */
  readonly simulated: readonly MobileSimulatedSurface[];
  readonly calls: readonly MobileCallRecord[];
  readonly bundles: readonly MobileBundleReading[];
  readonly logs: readonly MobileLogReading[];
  readonly notifications: readonly MobileNotificationReading[];
  readonly keychain: readonly MobileKeychainReading[];
}

/** The device's own state, which is the subject the family is named after. */
export interface MobileDeviceReading {
  /** The device serial, derived from the declared identity so the same document gives the same device. */
  readonly id: string;
  readonly model: string;
  readonly manufacturer: string;
  readonly platform: MobilePlatform;
  readonly osName: string;
  readonly osVersion: string;
  readonly locale: string;
  readonly state: MobileDeviceState;
  readonly orientation: MobileOrientationReading;
  readonly screen: MobileScreenReading;
  /** How many times the world was asked to boot it. A count of events, not of a clock. */
  readonly boots: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isScreen = (value: unknown): value is MobileScreenReading =>
  isRecord(value) &&
  typeof value["width"] === "number" &&
  typeof value["height"] === "number" &&
  typeof value["densityDpi"] === "number" &&
  typeof value["scale"] === "number" &&
  typeof value["drawn"] === "boolean";

const isOrientation = (value: unknown): value is MobileOrientationReading =>
  isRecord(value) &&
  typeof value["orientation"] === "string" &&
  typeof value["rotationDegrees"] === "number" &&
  typeof value["locked"] === "boolean";

const isDevice = (value: unknown): value is MobileDeviceReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["model"] === "string" &&
  typeof value["manufacturer"] === "string" &&
  typeof value["platform"] === "string" &&
  typeof value["osName"] === "string" &&
  typeof value["osVersion"] === "string" &&
  typeof value["locale"] === "string" &&
  typeof value["state"] === "string" &&
  isOrientation(value["orientation"]) &&
  isScreen(value["screen"]) &&
  typeof value["boots"] === "number";

const isWorld = (value: unknown): value is MobileWorldReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["version"] === "string" &&
  typeof value["apiLevel"] === "number" &&
  typeof value["bundles"] === "number" &&
  typeof value["launched"] === "number" &&
  typeof value["notifications"] === "number";

const isCall = (value: unknown): value is MobileCallRecord =>
  isRecord(value) &&
  (value["action"] === null || typeof value["action"] === "string") &&
  typeof value["client"] === "string" &&
  typeof value["command"] === "string" &&
  (value["resource"] === null || typeof value["resource"] === "string") &&
  typeof value["result"] === "string" &&
  typeof value["status"] === "number" &&
  (value["reason"] === null || typeof value["reason"] === "string");

const isPermission = (value: unknown): value is MobilePermissionReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["declared"] === "boolean" &&
  typeof value["state"] === "string" &&
  typeof value["prompted"] === "boolean" &&
  (value["reason"] === null || typeof value["reason"] === "string");

const isDeepLink = (value: unknown): value is MobileDeepLinkReading =>
  isRecord(value) &&
  typeof value["scheme"] === "string" &&
  typeof value["host"] === "string" &&
  typeof value["path"] === "string" &&
  typeof value["bundle"] === "string" &&
  typeof value["opened"] === "number";

const isBundle = (value: unknown): value is MobileBundleReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["version"] === "string" &&
  typeof value["versionCode"] === "number" &&
  typeof value["state"] === "string" &&
  typeof value["running"] === "boolean" &&
  (value["exitCode"] === null || typeof value["exitCode"] === "number") &&
  typeof value["launches"] === "number" &&
  typeof value["entryPoint"] === "string" &&
  isStringArray(value["command"]) &&
  typeof value["dataDir"] === "string" &&
  typeof value["files"] === "number" &&
  typeof value["sizeBytes"] === "number" &&
  typeof value["digest"] === "string" &&
  Array.isArray(value["permissions"]) &&
  value["permissions"].every(isPermission) &&
  Array.isArray(value["deepLinks"]) &&
  value["deepLinks"].every(isDeepLink);

const isLog = (value: unknown): value is MobileLogReading =>
  isRecord(value) &&
  typeof value["bundle"] === "string" &&
  typeof value["runs"] === "number" &&
  typeof value["stdout"] === "string" &&
  typeof value["stderr"] === "string" &&
  typeof value["stdoutBytes"] === "number" &&
  typeof value["stderrBytes"] === "number" &&
  typeof value["truncated"] === "boolean";

const isNotification = (value: unknown): value is MobileNotificationReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["bundle"] === "string" &&
  typeof value["channel"] === "string" &&
  typeof value["title"] === "string" &&
  typeof value["body"] === "string" &&
  typeof value["priority"] === "string" &&
  typeof value["delivered"] === "boolean";

const isKeychain = (value: unknown): value is MobileKeychainReading =>
  isRecord(value) &&
  typeof value["bundle"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["digest"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["accessible"] === "string";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a device document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs: the first sends an agent to the application, the second to the
 * environment.
 */
export function isMobileObservationData(value: unknown): value is MobileObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["device"] !== "string") return false;
  if (!isWorld(value["world"])) return false;
  if (!isDevice(value["state"])) return false;
  if (typeof value["sandbox"] !== "string") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!Array.isArray(value["calls"]) || !value["calls"].every(isCall)) return false;
  if (!Array.isArray(value["bundles"]) || !value["bundles"].every(isBundle)) return false;
  if (!Array.isArray(value["logs"]) || !value["logs"].every(isLog)) return false;
  if (!Array.isArray(value["notifications"]) || !value["notifications"].every(isNotification)) {
    return false;
  }
  if (!Array.isArray(value["keychain"]) || !value["keychain"].every(isKeychain)) return false;
  return true;
}

// ---- resolving a target, in the family's own spelling --------------------------------------------

/**
 * The result of turning a criterion's target into a value this world can look up.
 *
 * A discriminated result rather than `T | null`, for the reason three families before this one record:
 * a target that did not resolve and came back as `null` forces the validator to write one message
 * covering every reason it might not have, which is the shape of an error message naming a cause its
 * reporter never observed. Here the *resolver* knows why, so the reason travels with the refusal and
 * the validator quotes it.
 */
export type MobileTargetResult<T> =
  | { readonly kind: "target"; readonly value: T }
  | { readonly kind: "refused"; readonly reason: string };

const refused = <T>(reason: string): MobileTargetResult<T> => ({ kind: "refused", reason });
const resolved = <T>(value: T): MobileTargetResult<T> => ({ kind: "target", value });

/**
 * The things a criterion may name, one member per grammar.
 *
 * Five kinds and five grammars rather than one, and the *validator* chooses between them rather than
 * the spelling - the process family's rule, one more family out. The reason it has to be that way is
 * that these are five different kinds of name: `com.veridian.cart` is an id, `veridian://cart/item` is
 * a URI, `com.veridian.cart#2` is an id and a position, and `bundle.install` is a member of a closed
 * action vocabulary. Flattening them into one grammar would force every criterion to type a prefix the
 * subject does not need, and would make a mistyped URI resolve as a bundle id.
 */
export type MobileRef =
  | { readonly kind: "bundle"; readonly bundle: string }
  | { readonly kind: "permission"; readonly bundle: string; readonly permission: string }
  | { readonly kind: "keychain"; readonly bundle: string; readonly key: string }
  | { readonly kind: "deepLink"; readonly uri: string }
  | { readonly kind: "notification"; readonly bundle: string; readonly index: number };

/** The five kinds of thing a target may name. Named once, and read by the refusals that list them. */
export const MOBILE_REF_KINDS = ["bundle", "permission", "keychain", "deepLink", "notification"] as const;

export type MobileRefKind = (typeof MOBILE_REF_KINDS)[number];

/**
 * What a bundle id may contain.
 *
 * A bundle id is a reversed domain, so it carries dots; it never carries the separator this family uses
 * to scope one thing inside a bundle (`/`), a scheme's delimiter (`:`) or a position marker (`#`),
 * because those are the three characters the other four grammars need to stay unambiguous. The pattern
 * is therefore tighter than the runtime family's, which admits `:` on purpose because an image tag has
 * one - *a grammar's terms are its own, and copying a neighbour's alphabet is how a reference becomes
 * ambiguous.*
 */
const BUNDLE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/**
 * What a permission key or a keychain key may contain.
 *
 * Lower case, and it may carry `_` because a manifest's `ACCESS_FINE_LOCATION` becomes
 * `access_fine_location` - the family's names are lower case but the words inside them keep their
 * separation, which is the convention every other family in this tree follows.
 */
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const bundleProblem = (spelled: string): string | null => {
  if (spelled === "") {
    return "a bundle id is required, and the target names an empty one";
  }
  if (spelled.includes("/")) {
    return (
      `a target scopes a permission or a keychain entry inside a bundle with "/", so a bundle id ` +
      `carrying one cannot be read. This one is ${JSON.stringify(spelled)}`
    );
  }
  if (spelled.includes("#")) {
    return (
      `a target names a notification inside a bundle as "<bundle>#<position>", so a bundle id ` +
      `carrying "#" cannot be read. This one is ${JSON.stringify(spelled)}`
    );
  }
  if (!BUNDLE_PATTERN.test(spelled)) {
    return (
      `a bundle id is a reversed domain in lower case, with at least two segments - ` +
      `"com.veridian.cart" rather than "cart" - and this one is ${JSON.stringify(spelled)}`
    );
  }
  return null;
};

const keyProblem = (noun: string, spelled: string): string | null => {
  if (spelled === "") return `${noun} is required, and the target names an empty one`;
  if (!KEY_PATTERN.test(spelled)) {
    return (
      `a ${noun} is lower case and may carry letters, digits, ".", "_" and "-"; this one is ` +
      JSON.stringify(spelled)
    );
  }
  return null;
};

/** Whether a target arrived with whitespace it did not intend. */
const surroundingWhitespace = (target: string): string | null =>
  target === target.trim()
    ? null
    : `a target is written without surrounding whitespace; this one is ${JSON.stringify(target)}`;

/**
 * A bundle id, which is the target a `mobile.bundle` or a `mobile.logs` criterion writes.
 *
 * Targets are trimmed and then *checked* for it rather than silently trimmed, on the rule the provider
 * and runtime families both follow: a target with a stray space is a typo the operator wants named, and
 * quietly repairing it teaches them it was fine.
 */
export function resolveBundleTarget(target: string): MobileTargetResult<string> {
  const spaced = surroundingWhitespace(target);
  if (spaced !== null) return refused(spaced);
  const problem = bundleProblem(target);
  if (problem !== null) return refused(problem);
  return resolved(target);
}

/**
 * A bundle and the thing scoped inside it, which is the target a `mobile.permission` or a
 * `mobile.keychain` criterion writes.
 *
 * Split at the **first** slash, because a bundle id cannot contain one - so a key carrying a slash is
 * refused rather than silently read as a longer bundle id, which is the mistake a split-at-the-last
 * rule would make in the opposite direction.
 */
export function resolveScopedTarget(
  target: string,
  noun: string,
): MobileTargetResult<{ readonly bundle: string; readonly key: string }> {
  const spaced = surroundingWhitespace(target);
  if (spaced !== null) return refused(spaced);
  const cut = target.indexOf("/");
  if (cut < 0) {
    return refused(
      `a ${noun} target is written "<bundle>/<${noun}>", and this one names no separator: ` +
        `${JSON.stringify(target)}`,
    );
  }
  const bundle = target.slice(0, cut);
  const key = target.slice(cut + 1);
  const bundleDefect = bundleProblem(bundle);
  if (bundleDefect !== null) return refused(bundleDefect);
  const keyDefect = keyProblem(noun, key);
  if (keyDefect !== null) return refused(keyDefect);
  return resolved({ bundle, key });
}

/** The three parts of a deep link, or the reason the text is not one. */
type DeepLinkSplit =
  | { readonly kind: "parts"; readonly scheme: string; readonly host: string; readonly path: string }
  | { readonly kind: "problem"; readonly reason: string };

/**
 * The one place a deep link's grammar is implemented.
 *
 * It is written as a split returning either the parts or the reason rather than as a validator,
 * because *two* callers need it and they need different halves: a criterion writes a whole URI and is
 * answered with a refusal, while this world's own register registers and opens URIs and needs the three
 * parts to match one against the other. Written twice - a predicate in the vocabulary and a splitter in
 * the port - the two would agree until the first URI that only one of them was written for, which is
 * the defect this repository has paid for often enough to name: *two implementations of one rule
 * disagree the first time a world arrives that only one of them was written for.*
 *
 * The scheme is constrained to the alphabet the URI specification allows rather than to this family's
 * name pattern, because `veridian-cart` is a legal scheme and a legal scheme is not a bundle id -
 * *a grammar's terms are its own.*
 */
const splitDeepLink = (target: string): DeepLinkSplit => {
  const matched = /^([a-z][a-z0-9+.-]*):\/\//.exec(target);
  if (matched === null) {
    return {
      kind: "problem",
      reason:
        `a deep link is a whole URI - "veridian://cart/item" - and this one names no ` +
        `"<scheme>://": ${JSON.stringify(target)}`,
    };
  }
  const rest = target.slice(matched[0].length);
  const slash = rest.indexOf("/");
  const host = slash < 0 ? rest : rest.slice(0, slash);
  if (host === "") {
    return {
      kind: "problem",
      reason: `a deep link names a host between "://" and the path: ${JSON.stringify(target)}`,
    };
  }
  const path = slash < 0 ? "" : rest.slice(slash);
  if (path !== "" && !path.startsWith("/")) {
    return { kind: "problem", reason: `a deep link's path begins with "/": ${JSON.stringify(target)}` };
  }
  return { kind: "parts", scheme: matched[1] ?? "", host, path };
};

/** Why a URI cannot be read as a deep link, or `null` when it can. */
export function deepLinkProblem(target: string): string | null {
  const split = splitDeepLink(target);
  return split.kind === "problem" ? split.reason : null;
}

/**
 * The three parts of a deep link, or `null`.
 *
 * Held as three parts rather than as one string because that is what makes the matching rule
 * expressible: a registered link is matched with its scheme and its host **exactly** and its path by
 * **prefix**, which is what lets a bundle register `veridian://cart` and resolve `veridian://cart/item`
 * - the behaviour of every real deep-link router, and the reason this family does not compare two URIs
 * for equality. A single string would make the prefix rule a string operation written at the call site,
 * which is a second implementation of the grammar by another name.
 */
export function deepLinkParts(
  target: string,
): { readonly scheme: string; readonly host: string; readonly path: string } | null {
  const split = splitDeepLink(target);
  return split.kind === "parts" ? { scheme: split.scheme, host: split.host, path: split.path } : null;
}

/**
 * A deep link, as a criterion writes it: a whole URI.
 *
 * Three parts are required and each is checked separately, so the refusal can say which one is wrong.
 * The check itself lives in {@link splitDeepLink}, because the register needs the same grammar's other
 * half and a criterion's question and the world's question are one rule asked from two sides.
 */
export function resolveDeepLinkTarget(target: string): MobileTargetResult<string> {
  const spaced = surroundingWhitespace(target);
  if (spaced !== null) return refused(spaced);
  const problem = deepLinkProblem(target);
  if (problem !== null) return refused(problem);
  return resolved(target);
}

/**
 * A notification, as a criterion writes it: a bundle id and a 1-based position in that bundle's list.
 *
 * The position is 1-based on the rule `api.status` and `data.record` already follow, because the thing
 * a criterion author counts when they look at a contract is the list they wrote - and an off-by-one in
 * a position that a target and a failure report both quote is the one error that sends a reader to the
 * wrong line.
 */
export function resolveNotificationTarget(
  target: string,
): MobileTargetResult<{ readonly bundle: string; readonly index: number }> {
  const spaced = surroundingWhitespace(target);
  if (spaced !== null) return refused(spaced);
  const cut = target.indexOf("#");
  if (cut < 0) {
    return refused(
      `a notification target is written "<bundle>#<position>", and this one names no "#": ` +
        JSON.stringify(target),
    );
  }
  const bundle = target.slice(0, cut);
  const spelled = target.slice(cut + 1);
  const bundleDefect = bundleProblem(bundle);
  if (bundleDefect !== null) return refused(bundleDefect);
  if (!/^[1-9][0-9]*$/.test(spelled)) {
    return refused(
      `a notification position is a 1-based whole number, so the first notification a bundle posted ` +
        `is "1"; this one is ${JSON.stringify(spelled)}`,
    );
  }
  return resolved({ bundle, index: Number.parseInt(spelled, 10) });
}

/**
 * An action name, as a criterion writes it: a member of {@link MOBILE_ACTIONS}.
 *
 * A target that is not a member is refused by naming the list rather than being recorded as an action
 * this world nearly implements. That matters more here than anywhere else in the family, because the
 * criterion's own request *is* the subject of `mobile.probe` - so a probe that could not name its
 * action would be a criterion about a request nobody could identify.
 */
export function resolveActionTarget(target: string): MobileTargetResult<MobileAction> {
  const spaced = surroundingWhitespace(target);
  if (spaced !== null) return refused(spaced);
  if (!isMobileAction(target)) {
    return refused(
      `this family answers a closed set of actions, each spelled "<noun>.<verb>" - one of ` +
        `${MOBILE_ACTIONS.join(", ")} - and this target names ${JSON.stringify(target)}`,
    );
  }
  return resolved(target);
}

/** The reference a reading or a call record stores, built from a resolved one. */
export function mobileRefSpelling(ref: MobileRef): string {
  switch (ref.kind) {
    case "bundle":
      return ref.bundle;
    case "permission":
      return `${ref.bundle}/${ref.permission}`;
    case "keychain":
      return `${ref.bundle}/${ref.key}`;
    case "deepLink":
      return ref.uri;
    case "notification":
      return `${ref.bundle}#${String(ref.index)}`;
  }
}

/**
 * The short key a permission's manifest name is addressed by.
 *
 * A criterion writes `camera`; a manifest writes `android.permission.CAMERA`. The mapping exists
 * because the *target* is a spelling a contract author types, and making them type the platform's own
 * namespace would tie every contract to one platform - which is the thing
 * {@link MOBILE_PLATFORMS} exists to make a refusal rather than an assumption. Every segment after
 * the last dot, lower-cased: that is the whole rule, and it is here rather than in the validators
 * because a refusal has to be able to compute the spelling it wanted.
 */
export function permissionKey(name: string): string {
  const segments = name.split(".");
  const last = segments[segments.length - 1] ?? "";
  return last.toLowerCase();
}

/** The bundle with this id, whatever state the device holds it in, or `null`. */
export function bundleNamed(
  data: MobileObservationData,
  id: string,
): MobileBundleReading | null {
  return data.bundles.find((bundle) => bundle.id === id) ?? null;
}

/**
 * The bundles the device really holds.
 *
 * `removed` is filtered out rather than kept, because a criterion asking what is installed is asking a
 * question about presence - and a record that says `removed` is the world's answer that a package was
 * there and is not. The record itself is kept in `data.bundles` so a criterion can still ask *what* was
 * removed, which is the difference between the two questions `mobile.installed` and `mobile.bundle`
 * exist to keep apart.
 */
export function installedBundles(
  data: MobileObservationData,
): readonly MobileBundleReading[] {
  return data.bundles.filter((bundle) => bundle.state !== "removed");
}

/**
 * The permission this key addresses on this bundle, or `null`.
 *
 * Matched on the derived {@link permissionKey} rather than on the manifest name, because the key is the
 * spelling a criterion writes - and looked up *within* the bundle, because two bundles may declare the
 * same permission with different answers, which is the ordinary shape of a contract about consent.
 */
export function permissionFor(
  data: MobileObservationData,
  bundle: string,
  key: string,
): MobilePermissionReading | null {
  const held = bundleNamed(data, bundle);
  if (held === null) return null;
  return held.permissions.find((permission) => permission.key === key) ?? null;
}

/**
 * The notification this bundle posted at this position, or `null`.
 *
 * The 1-based position is into **this bundle's own list**, in the order the world posted them, so a
 * criterion naming `com.veridian.cart#2` is naming the second notification that bundle posted and not
 * the second one on the device - which is why {@link MobileNotificationReading.id} carries the bundle
 * as well as the position.
 */
export function notificationAt(
  data: MobileObservationData,
  bundle: string,
  index: number,
): MobileNotificationReading | null {
  const held = data.notifications.filter((notification) => notification.bundle === bundle);
  return held[index - 1] ?? null;
}

/** The keychain entry this bundle holds under this key, or `null`. */
export function keychainEntry(
  data: MobileObservationData,
  bundle: string,
  key: string,
): MobileKeychainReading | null {
  return (
    data.keychain.find((entry) => entry.bundle === bundle && entry.key === key) ?? null
  );
}

/**
 * The deep link this URI addresses, or `null`.
 *
 * A path is matched by **prefix** and a scheme and host exactly, which is the rule a real device uses
 * and the reason {@link MobileDeepLinkReading} holds three parts: a criterion can register
 * `veridian://cart` and then assert that `veridian://cart/item` resolved, and a world that compared
 * whole strings would report a registration that does not exist.
 */
export function deepLinkFor(
  data: MobileObservationData,
  uri: string,
): MobileDeepLinkReading | null {
  for (const bundle of data.bundles) {
    for (const link of bundle.deepLinks) {
      const prefix = `${link.scheme}://${link.host}${link.path}`;
      if (uri === prefix || (uri.startsWith(prefix) && uri.startsWith(`${prefix}/`))) return link;
    }
  }
  return null;
}

/** Every call one client made, in the order the world answered them. */
export function mobileCallsOf(
  data: MobileObservationData,
  client: MobileClient,
): readonly MobileCallRecord[] {
  return data.calls.filter((call) => call.client === client);
}

/** The log reading for a bundle, or `null` when it was never launched. */
export function logsOf(data: MobileObservationData, bundle: string): MobileLogReading | null {
  return data.logs.find((log) => log.bundle === bundle) ?? null;
}

// ---- what a validator may quote --------------------------------------------------------------

/**
 * `sim-cart-device Veridian Pixel 8 android Android 14, booted, 3 bundle(s), locale en-US`
 *
 * The device, in the order an operator reads it: which device, what it is, what it runs, whether it is
 * up, and what it holds. A device that has never been booted says so, because "the world was created
 * and nothing has started it" is the state a run begins in and a criterion may legitimately open with.
 */
export function renderDevice(device: MobileDeviceReading): string {
  const bundles = device.state === "booted" ? "" : " (never booted)";
  return (
    `${device.id} ${device.manufacturer} ${device.model} ${device.platform} ` +
    `${device.osName} ${device.osVersion}, ${device.state}${bundles}, locale ${device.locale}`
  );
}

/**
 * `Android 14 (apiLevel 34)` - the operating system, as a record rather than an installation.
 *
 * The word `recorded` is deliberately absent: {@link MOBILE_SIMULATED_SURFACES} already names
 * `touch-os`, and this rendering is the string a criterion pins for the *version*, not for the
 * substitution. The two facts belong in two places, and a parenthetical here would put the same claim
 * in both.
 */
export function renderOs(device: MobileDeviceReading, apiLevel: number): string {
  return `${device.osName} ${device.osVersion} (apiLevel ${String(apiLevel)})`;
}

/**
 * `1080x2400 at 420dpi, scale 2.625 (rendered and never drawn)` - and the parenthetical is the point.
 *
 * The geometry is resolved for real: the contract declares it and the world computes the scale from it.
 * What did not happen is that anything reached a surface, and a criterion that pinned the geometry
 * without the parenthetical would be asserting a screen this world never drew. This is the
 * `container.limit` precedent - the substitution belongs *inside* the value, not beside it.
 */
export function renderScreen(screen: MobileScreenReading): string {
  const drawn = screen.drawn ? "drawn" : "rendered and never drawn";
  return (
    `${String(screen.width)}x${String(screen.height)} at ${String(screen.densityDpi)}dpi, ` +
    `scale ${String(screen.scale)} (${drawn})`
  );
}

/** `landscape (rotation 90, unlocked)` - the axis, the rotation the world resolved, and the lock. */
export function renderOrientation(orientation: MobileOrientationReading): string {
  return (
    `${orientation.orientation} (rotation ${String(orientation.rotationDegrees)}, ` +
    `${orientation.locked ? "locked" : "unlocked"})`
  );
}

/**
 * `camera (android.permission.CAMERA): granted (declared by the bundle, never prompted for)`
 *
 * Three facts in one line, and the parenthetical is computed from two fields rather than written as a
 * constant: `declared` is the bundle's manifest and `prompted` is whether the world ever asked a user.
 * A permission that was *not* declared and was granted by a criterion says so instead, because that is
 * a different defect with a different repair - a manifest missing a line rather than a policy pointing
 * the wrong way.
 */
export function renderPermission(permission: MobilePermissionReading): string {
  const declared = permission.declared ? "declared by the bundle" : "not declared by the bundle";
  const prompted = permission.prompted ? "prompted for" : "never prompted for";
  const why = permission.reason === null ? "" : ` - ${permission.reason}`;
  return (
    `${permission.key} (${permission.name}): ${permission.state} ` +
    `(${declared}, ${prompted})${why}`
  );
}

/**
 * `com.veridian.cart Cart 1.4.0 (versionCode 14) [installed], entry "main.js", 6 file(s), digest
 * sha256:...` - the bundle's record, and the digest of the files this machine really read.
 *
 * `launches` and the exit code are here rather than in a separate reading because a launch count is a
 * fact about *the bundle* - the same fact `container.runs` is, one family over.
 */
export function renderBundle(bundle: MobileBundleReading): string {
  const exit = bundle.exitCode === null ? "" : `, last exit ${String(bundle.exitCode)}`;
  return (
    `${bundle.id} ${bundle.name} ${bundle.version} (versionCode ${String(bundle.versionCode)}) ` +
    `[${bundle.state}], entry ${JSON.stringify(bundle.entryPoint)}, ` +
    `${String(bundle.files)} file(s), ${String(bundle.sizeBytes)} byte(s), ` +
    `digest ${bundle.digest}, launched ${String(bundle.launches)} time(s)${exit}`
  );
}

/**
 * `3 bundle(s): com.veridian.cart, com.veridian.driver, com.veridian.store` - the set the device holds.
 *
 * A set rather than one record, which is what makes `mobile.installed` a different question from
 * `mobile.bundle`: the first asks what is on the device, the second asks what one bundle says about
 * itself. An empty device renders `0 bundle(s)`, not an empty string, so a criterion comparing the
 * installed set after an uninstall has a value to compare against.
 */
export function renderInstalled(bundles: readonly MobileBundleReading[]): string {
  const ids = bundles.map((bundle) => bundle.id).sort();
  return `${String(ids.length)} bundle(s)${ids.length === 0 ? "" : `: ${ids.join(", ")}`}`;
}

/**
 * `veridian://cart/item -> com.veridian.cart (opened 1 time(s), resolved, no bundle launched)`
 *
 * The parenthetical says what a resolution *was*. A bare `opened 1 time(s)` would claim the bundle ran,
 * and nothing ran: the world matched a URI to the bundle that registered it and recorded that it did.
 * That is the whole difference between a deep link being handled and being routed.
 */
export function renderDeepLink(link: MobileDeepLinkReading): string {
  return (
    `${link.scheme}://${link.host}${link.path} -> ${link.bundle} ` +
    `(opened ${String(link.opened)} time(s), resolved, no bundle launched)`
  );
}

/**
 * `com.veridian.cart#1 cart-updates/normal: "Order ready" - 3 item(s) (queued, never delivered)`
 *
 * `queued` rather than `posted`, because posting is what the application asked for and queuing is what
 * the world did with it. There is no push service, so nothing carried it anywhere - and a criterion
 * about a notification is nearly always a criterion about *delivery*, which is the fact this rendering
 * refuses to overstate.
 */
export function renderNotification(notification: MobileNotificationReading): string {
  const delivered = notification.delivered ? "delivered" : "queued, never delivered";
  return (
    `${notification.id} ${notification.channel}/${notification.priority}: ` +
    `${JSON.stringify(notification.title)} - ${notification.body} (${delivered})`
  );
}

/**
 * `com.veridian.cart/session-token: 64 byte(s), sha256:... (when-unlocked, value not recorded)`
 *
 * The last two words are the decision. The world really hashed what the application gave it, so a
 * criterion can assert that a secret was written and that a second write of the same secret agreed -
 * and the value itself is not in this document, because this document becomes `result.json`,
 * `latest-failure.md` and an uploaded CI artefact.
 */
export function renderKeychain(entry: MobileKeychainReading): string {
  return (
    `${entry.bundle}/${entry.key}: ${String(entry.bytes)} byte(s), ${entry.digest} ` +
    `(${entry.accessible}, value not recorded)`
  );
}

/**
 * `com.veridian.cart: stdout 128 byte(s), stderr 0 byte(s) over 2 launch(es)` - what was said, and how
 * much of it the world kept.
 *
 * `truncated` appears as a word when it is true, because a criterion reading a log has to be able to
 * tell a bundle that said little from one that said more than the world kept.
 */
export function renderLogs(log: MobileLogReading): string {
  const truncated = log.truncated ? ", truncated" : "";
  return (
    `${log.bundle}: stdout ${String(log.stdoutBytes)} byte(s), ` +
    `stderr ${String(log.stderrBytes)} byte(s) over ${String(log.runs)} launch(es)${truncated}`
  );
}

/**
 * One line an operator reads: the action, who asked, and how it ended.
 *
 * `null` renders as the word `unimplemented` rather than as an empty string, because a record whose
 * action is absent is the world's answer to a command it does not serve - which is an observation a
 * contract about a substitute may legitimately make, and an empty field would read as a missing one.
 */
export function renderCall(call: MobileCallRecord): string {
  const action = call.action === null ? "unimplemented" : call.action;
  const who = call.client === "criterion" ? "criterion" : "provisioner";
  const reason = call.reason === null ? "" : ` - ${call.reason}`;
  return `${action} (${who}) -> ${call.result}${reason}: ${call.command}`;
}
