/**
 * What a run can *read* about a substituted VS Code extension host.
 *
 * ## Why this file is in `core/environment/`
 *
 * A validator family must not import an adapter - `AGENTS.md` makes that layering hand-enforced - so
 * the vocabulary every family judges lives one layer down, beside the adapters that produce it. This is
 * the seventh such vocabulary, and the fifth time the rule held without a change to anything else:
 * `web-observation.ts`, `db-observation.ts`, `k8s-observation.ts`, `posix-observation.ts`,
 * `os-observation.ts`, `cloud-observation.ts` and `container-observation.ts` are the others.
 *
 * ## What this world substitutes, and what it never does
 *
 * The application is a real VS Code extension. Its `activate()` is really called, by a real Node
 * process, with a real `ExtensionContext`; the `vscode` module specifier it imports is really
 * answered, by a real Node module-resolution hook, with a real object; every command it registers is
 * really registered, and every command a criterion invokes really runs. What does not exist is VS
 * Code: there is no editor, no process tree of its own, no window, no language server, no user and no
 * profile.
 *
 * ## The substitution is carried in the value, not only in the documentation
 *
 * Three things in this file exist for that reason rather than for convenience.
 *
 * {@link VSCODE_SIMULATED_SURFACES} names each surface this world stands in for, in a closed
 * vocabulary, and every reading carries the list.
 *
 * {@link VSCodeRefusalReading} records every API an extension reached for that this world does not
 * implement, *by name*. A substitute that answered them with `undefined` would crash the extension and
 * report a defective extension; a substitute that answered them with a plausible stub would report a
 * defective world as a working one. Recording the refusal is the only answer that lets a reader tell
 * the two apart, and it is what lets a criterion assert that the extension stayed inside the surface
 * this world actually provides.
 *
 * And {@link VSCodeEngineReading} is computed rather than asserted. A real host refuses to load an
 * extension whose `engines.vscode` range does not admit its own version - which is the exact defect
 * this repository already paid for, once, when the Cockpit's declared floor was six minor releases
 * below the first host that could load it. This world computes the same answer from the same two
 * facts, so an extension that declares a floor this host cannot meet is *refused*, and a criterion can
 * observe the refusal instead of waiting for a user to report an extension that installs and never
 * starts.
 */

/** The `kind` on every reading this world produces. A reader compares it before anything else. */
export const VSCODE_OBSERVATION_KIND = "vscode.extension";

/**
 * The surfaces this world stands in for, in a closed vocabulary.
 *
 * Each member is something a reader would otherwise be entitled to believe was real. The list is
 * deliberately *not* "everything VS Code has": it names what this world takes over, so a member that
 * is absent from a reading is a surface the run did not rely on.
 */
export const VSCODE_SIMULATED_SURFACES = [
  /** There is no VS Code process. This world is the host, and it is a Node process it started itself. */
  "extension-host",
  /** `import "vscode"` is answered by a resolver hook this world installed, not by an editor. */
  "module-resolution",
  /** VS Code decides when an extension activates. This world fires one declared event, once per run. */
  "activation-events",
  /** The palette. Commands are registered into this world's table rather than into a real registry. */
  "command-registry",
  /** The status bar, the output channels and the notifications exist as records, not as pixels. */
  "window",
  /** `workspace.getConfiguration` is answered from the manifest's own declared defaults. */
  "configuration",
  /** There are no working copies. The workspace folder holds exactly what the run put in it. */
  "workspace",
] as const;

export type VSCodeSimulatedSurface = (typeof VSCODE_SIMULATED_SURFACES)[number];

/**
 * How a requested thing ended.
 *
 * The same four words the provider and runtime families use, and for the same reason: they are four
 * different observations with four different repairs. `absent` sends the reader to the manifest,
 * `refused` to the world, `failed` to the extension, and `answered` to the criterion.
 */
export const VSCODE_RESULTS = ["answered", "absent", "refused", "failed"] as const;

export type VSCodeResult = (typeof VSCODE_RESULTS)[number];

/**
 * Who asked for it.
 *
 * The extension itself can call `commands.executeCommand`, and a criterion can invoke one through an
 * `invoke` step. Keeping the two apart is what makes "the command works when the extension calls it"
 * and "the command works when the user asks for it" two observations instead of one.
 *
 * `provisioner` is the third party and it is not either of those: the application this world is asked to
 * run is the program that installs the extension and activates it, and its commands are issued by code
 * that is *not* the extension under test. Folding them into `extension` would let a criterion read a
 * command the extension never issued - the same mistake `sim-container` avoids by naming the party that
 * prints command vectors, and it is also what lets the adapter report the *application's* escapes as
 * safety events without reporting the criterion's own probes as the application's behaviour.
 */
export const VSCODE_CLIENTS = ["extension", "criterion", "provisioner"] as const;

export type VSCodeClient = (typeof VSCODE_CLIENTS)[number];

/** Whether this world's API version admits the extension's declared engine floor. Computed, never asserted. */
export const VSCODE_ENGINE_RESULTS = ["admitted", "refused"] as const;

export type VSCodeEngineResult = (typeof VSCODE_ENGINE_RESULTS)[number];

/** Where a setting's value came from. A value with no source is a value nobody can audit. */
export const VSCODE_SETTING_SOURCES = ["override", "default", "unset"] as const;

export type VSCodeSettingSource = (typeof VSCODE_SETTING_SOURCES)[number];

/** The two stores an extension may write durable state to. */
export const VSCODE_STATE_SCOPES = ["global", "workspace"] as const;

export type VSCodeStateScope = (typeof VSCODE_STATE_SCOPES)[number];

/** The severities `window.show*Message` can carry. */
export const VSCODE_MESSAGE_LEVELS = ["info", "warning", "error"] as const;

export type VSCodeMessageLevel = (typeof VSCODE_MESSAGE_LEVELS)[number];

/**
 * What kind of handle a subscription is.
 *
 * Recorded as a kind *and* an id rather than as one spelling, because "which command is still
 * registered after deactivate" and "which output channel is still open" are different leaks with
 * different repairs, and a single `"command:cart.preview"` string would force every reader to parse.
 */
export const VSCODE_SUBSCRIPTION_KINDS = ["command", "status", "output", "api"] as const;

export type VSCodeSubscriptionKind = (typeof VSCODE_SUBSCRIPTION_KINDS)[number];

/**
 * Every action this world's register holds.
 *
 * The register is the *host's* vocabulary, not the extension's: it is what a provisioning program and a
 * criterion's `run` step both issue to bring an extension into a substitute host and to act on it once
 * it is there. Declared here rather than in the adapter because a criterion may name one and the
 * registry's guard has to be able to refuse a name it does not hold - and a vocabulary written twice is
 * the defect this repository has paid for three times.
 *
 * `activate` and `invoke` both start a real host process: this world is a host, and a host that had an
 * extension loaded in a process that had already exited would be a host holding nothing.
 */
export const VSCODE_ACTIONS = [
  "install",
  "activate",
  "invoke",
  "configure",
  "unconfigure",
  "reveal",
  "reload",
] as const;

export type VSCodeAction = (typeof VSCODE_ACTIONS)[number];

/** Whether a normalised word is an action this world's register holds. */
export function isVSCodeAction(value: string): value is VSCodeAction {
  return (VSCODE_ACTIONS as readonly string[]).includes(value);
}

/**
 * One command line this world performed, exactly as it was filed.
 *
 * Every command is recorded, not only the refused ones, because the transcript is what a reader holds
 * when a criterion about a missing command fails: the reading says the command is not registered, and
 * the transcript says which commands the run issued and which of them this world would not answer.
 */
export interface VSCodeCallRecord {
  /**
   * The action this world's register resolved the command line to, or `null` when it holds none.
   *
   * `null` is the field that says this world was asked for something it does not implement, which is a
   * different fact from an action that ran and failed. Collapsing the two would leave a contract unable
   * to observe the refusal - and a contract about a substitute is exactly a contract about what the
   * substitute does and does not answer.
   */
  readonly action: VSCodeAction | null;
  readonly client: VSCodeClient;
  /** The command line as it was spelled, so a refusal can be quoted without paraphrasing. */
  readonly command: string;
  /** What the command was about - a command id, a settings key, a channel name - or `null`. */
  readonly resource: string | null;
  readonly result: VSCodeResult;
  readonly status: number;
  readonly reason: string | null;
}

/** What an extension is, as its own manifest declares it. */
export interface VSCodeIdentityReading {
  /** The manifest's `name`. */
  readonly name: string;
  /** The manifest's `publisher`, or `null` when it declares none. */
  readonly publisher: string | null;
  /** The manifest's `version`. */
  readonly version: string;
  /** The manifest's `displayName`, or `null`. */
  readonly displayName: string | null;
  /** The manifest's `main`, as it is spelled there. Resolved against the extension's own directory. */
  readonly main: string;
}

/**
 * The engine floor question, answered rather than assumed.
 *
 * `declared` is the manifest's `engines.vscode` range, `apiVersion` is what this world answers as, and
 * `result` is the world's own verdict on whether the first admits the second. A `refused` result is
 * the interesting one: it is the observation of an extension that would install into an editor which
 * cannot load it, and its `reason` is the sentence a reader needs.
 */
export interface VSCodeEngineReading {
  readonly declared: string | null;
  readonly apiVersion: string;
  readonly result: VSCodeEngineResult;
  readonly reason: string | null;
}

/**
 * One id the manifest declares, flattened.
 *
 * `point` is the contribution point - `commands`, `configuration`, `menus`, `keybindings`,
 * `activationEvents` - and `id` is the name it contributes under that point. Flattened rather than
 * nested because a criterion asks "does the manifest contribute `cart.preview` to `commands`", which
 * is one question about one pair, not a question about a tree.
 */
export interface VSCodeContributionReading {
  readonly point: string;
  readonly id: string;
  /** The `title` the manifest declared for it, where the point carries one. */
  readonly title: string | null;
}

/** One activation, as it really happened. */
export interface VSCodeActivationReading {
  /** The activation event the host fired. The first the manifest declares, or `*`. */
  readonly event: string;
  readonly activated: boolean;
  /** The error the extension's `activate` raised, or `null`. A string, because it crosses a process. */
  readonly error: string | null;
  /**
   * How many times the host process has started in this world.
   *
   * A real extension host is long-lived; this world starts one per acting observation, because the
   * process boundary is what makes the extension's execution isolated and resettable - and because
   * `ProcessRunner` gives a child no stdin, so a live conversation with it is not available. The count
   * is recorded rather than hidden so a reader is never reading a fourth activation believing it is
   * the first. State an extension persists survives, in `state.json`, exactly as a real host's does.
   */
  readonly runs: number;
}

/** One command, as the world holds it. */
export interface VSCodeCommandReading {
  readonly id: string;
  /** Whether it is registered *now*, after `deactivate` and the disposal of every subscription. */
  readonly registered: boolean;
  /** The title the manifest gives it, or `null`. A command with no title is not in the palette. */
  readonly title: string | null;
  /** Whether the manifest's `contributes.commands` names it. */
  readonly declared: boolean;
  /** Whether the registration was disposed during this activation. */
  readonly disposed: boolean;
}

/** One invocation, by whoever asked for it. */
export interface VSCodeInvocationReading {
  readonly command: string;
  readonly client: VSCodeClient;
  readonly args: readonly string[];
  readonly result: VSCodeResult;
  /** Why the world refused, why it was absent, or what the handler raised. `null` when it answered. */
  readonly reason: string | null;
}

/** One setting an extension read. */
export interface VSCodeSettingReading {
  /** The full key, section and property, e.g. `cart.preview.format`. */
  readonly key: string;
  /** The value, rendered to a string. `null` when nothing answered for it. */
  readonly value: string | null;
  readonly source: VSCodeSettingSource;
}

/** One status bar item. */
export interface VSCodeStatusReading {
  readonly id: string;
  readonly text: string;
  readonly tooltip: string | null;
  /** The command the item invokes when clicked, or `null`. */
  readonly command: string | null;
  readonly visible: boolean;
  readonly alignment: string;
}

/** One output channel, and every line written to it. */
export interface VSCodeOutputReading {
  readonly channel: string;
  readonly lines: readonly string[];
  /** Whether the extension called `show()`. A channel that was never shown was seen by nobody. */
  readonly shown: boolean;
}

/** One message the extension put in front of a user who does not exist. */
export interface VSCodeMessageReading {
  readonly level: VSCodeMessageLevel;
  readonly message: string;
}

/** One durable value the extension stored, and where it stored it. */
export interface VSCodeStateReading {
  readonly scope: VSCodeStateScope;
  readonly key: string;
  /** The value, rendered to a string. */
  readonly value: string | null;
}

/**
 * One handle the extension handed to the host to dispose.
 *
 * `disposed` is read *after* `deactivate` has run and the host has disposed the context's
 * subscriptions, so a `false` here is a handle nothing released - which is the shape of a leak and the
 * reason this is a reading rather than an assertion.
 */
export interface VSCodeSubscriptionReading {
  readonly kind: VSCodeSubscriptionKind;
  readonly id: string;
  readonly disposed: boolean;
}

/** One file the extension put in, or read from, its workspace. */
export interface VSCodeFileReading {
  /** Relative to the workspace folder, with forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly readable: boolean;
}

/**
 * One API this world was asked for and does not implement.
 *
 * The field that makes this world honest about its own edge. It is recorded for both clients, because
 * an extension that reaches for a webview and a criterion that reaches for one are the same refusal
 * observed twice - and it is a *reading* rather than an error, because a refusal here is frequently
 * the correct answer to a criterion: "the extension must not need a webview" is a claim a contract can
 * make and this world can judge.
 */
export interface VSCodeRefusalReading {
  readonly api: string;
  readonly client: VSCodeClient;
  readonly reason: string;
}

/** Everything one run can read about the world it judged. */
export interface VSCodeObservationData {
  /** The host identity the environment document declared. */
  readonly host: string;
  /** The VS Code API version this world answers as. A record, not an installation. */
  readonly apiVersion: string;
  /**
   * The world's own sandbox directory, as this machine spells it.
   *
   * Absolute, and resolved by the adapter rather than by a reader, for the reason the machine family
   * paid for: a bundle quoting the document's relative spelling names a path that is not the path the
   * world wrote to.
   */
  readonly sandbox: string;
  readonly extension: VSCodeIdentityReading;
  readonly engine: VSCodeEngineReading;
  readonly activation: VSCodeActivationReading;
  /** The substituted surfaces, from the closed vocabulary above. */
  readonly simulated: readonly VSCodeSimulatedSurface[];
  readonly contributions: readonly VSCodeContributionReading[];
  readonly commands: readonly VSCodeCommandReading[];
  readonly invocations: readonly VSCodeInvocationReading[];
  readonly settings: readonly VSCodeSettingReading[];
  readonly status: readonly VSCodeStatusReading[];
  readonly output: readonly VSCodeOutputReading[];
  readonly messages: readonly VSCodeMessageReading[];
  readonly state: readonly VSCodeStateReading[];
  readonly subscriptions: readonly VSCodeSubscriptionReading[];
  readonly files: readonly VSCodeFileReading[];
  readonly refusals: readonly VSCodeRefusalReading[];
  /** Every command line this world performed, in the order it arrived. */
  readonly calls: readonly VSCodeCallRecord[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const optionalString = (value: unknown): boolean => value === null || typeof value === "string";

const isIdentity = (value: unknown): value is VSCodeIdentityReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  optionalString(value["publisher"]) &&
  typeof value["version"] === "string" &&
  optionalString(value["displayName"]) &&
  typeof value["main"] === "string";

const isEngine = (value: unknown): value is VSCodeEngineReading =>
  isRecord(value) &&
  optionalString(value["declared"]) &&
  typeof value["apiVersion"] === "string" &&
  typeof value["result"] === "string" &&
  optionalString(value["reason"]);

const isContribution = (value: unknown): value is VSCodeContributionReading =>
  isRecord(value) &&
  typeof value["point"] === "string" &&
  typeof value["id"] === "string" &&
  optionalString(value["title"]);

const isActivation = (value: unknown): value is VSCodeActivationReading =>
  isRecord(value) &&
  typeof value["event"] === "string" &&
  typeof value["activated"] === "boolean" &&
  optionalString(value["error"]) &&
  typeof value["runs"] === "number";

const isCommand = (value: unknown): value is VSCodeCommandReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["registered"] === "boolean" &&
  optionalString(value["title"]) &&
  typeof value["declared"] === "boolean" &&
  typeof value["disposed"] === "boolean";

const isInvocation = (value: unknown): value is VSCodeInvocationReading =>
  isRecord(value) &&
  typeof value["command"] === "string" &&
  typeof value["client"] === "string" &&
  isStringArray(value["args"]) &&
  typeof value["result"] === "string" &&
  optionalString(value["reason"]);

const isSetting = (value: unknown): value is VSCodeSettingReading =>
  isRecord(value) &&
  typeof value["key"] === "string" &&
  optionalString(value["value"]) &&
  typeof value["source"] === "string";

const isStatus = (value: unknown): value is VSCodeStatusReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["text"] === "string" &&
  optionalString(value["tooltip"]) &&
  optionalString(value["command"]) &&
  typeof value["visible"] === "boolean" &&
  typeof value["alignment"] === "string";

const isOutput = (value: unknown): value is VSCodeOutputReading =>
  isRecord(value) &&
  typeof value["channel"] === "string" &&
  isStringArray(value["lines"]) &&
  typeof value["shown"] === "boolean";

const isMessage = (value: unknown): value is VSCodeMessageReading =>
  isRecord(value) && typeof value["level"] === "string" && typeof value["message"] === "string";

const isState = (value: unknown): value is VSCodeStateReading =>
  isRecord(value) &&
  typeof value["scope"] === "string" &&
  typeof value["key"] === "string" &&
  optionalString(value["value"]);

const isSubscription = (value: unknown): value is VSCodeSubscriptionReading =>
  isRecord(value) &&
  typeof value["kind"] === "string" &&
  typeof value["id"] === "string" &&
  typeof value["disposed"] === "boolean";

const isFile = (value: unknown): value is VSCodeFileReading =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["readable"] === "boolean";

const isRefusal = (value: unknown): value is VSCodeRefusalReading =>
  isRecord(value) &&
  typeof value["api"] === "string" &&
  typeof value["client"] === "string" &&
  typeof value["reason"] === "string";

const isCall = (value: unknown): value is VSCodeCallRecord =>
  isRecord(value) &&
  optionalString(value["action"]) &&
  typeof value["client"] === "string" &&
  typeof value["command"] === "string" &&
  optionalString(value["resource"]) &&
  typeof value["result"] === "string" &&
  typeof value["status"] === "number" &&
  optionalString(value["reason"]);

const every = <T>(value: unknown, guard: (entry: unknown) => entry is T): boolean =>
  Array.isArray(value) && value.every(guard);

/**
 * Whether a value can be read as a reading from this world.
 *
 * It answers "can this be read as an extension-host document", and that answer is what separates a
 * validator judging a world from a validator reporting that the world arrived unreadable. Those are
 * different verdicts with different repairs: the first sends an agent to the application, the second
 * to the environment.
 */
export function isVSCodeObservationData(value: unknown): value is VSCodeObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["host"] !== "string") return false;
  if (typeof value["apiVersion"] !== "string") return false;
  if (typeof value["sandbox"] !== "string") return false;
  if (!isIdentity(value["extension"])) return false;
  if (!isEngine(value["engine"])) return false;
  if (!isActivation(value["activation"])) return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!every(value["contributions"], isContribution)) return false;
  if (!every(value["commands"], isCommand)) return false;
  if (!every(value["invocations"], isInvocation)) return false;
  if (!every(value["settings"], isSetting)) return false;
  if (!every(value["status"], isStatus)) return false;
  if (!every(value["output"], isOutput)) return false;
  if (!every(value["messages"], isMessage)) return false;
  if (!every(value["state"], isState)) return false;
  if (!every(value["subscriptions"], isSubscription)) return false;
  if (!every(value["files"], isFile)) return false;
  if (!every(value["refusals"], isRefusal)) return false;
  if (!every(value["calls"], isCall)) return false;
  return true;
}

// ---- resolving a target, in the family's own spelling --------------------------------------------

/**
 * The result of turning a criterion's target into a value this world can look up.
 *
 * A discriminated result rather than `string | null`, for the reason the four families before this one
 * record: a target that did not resolve and came back as `null` forces the validator to write one
 * message covering every reason it might not have, which is the shape of an error message naming a
 * cause its reporter never observed. Here the *resolver* knows why, so the reason travels with the
 * refusal and the validator quotes it.
 */
export type VSCodeTargetResult<T> =
  | { readonly kind: "target"; readonly value: T }
  | { readonly kind: "refused"; readonly reason: string };

const refused = <T>(reason: string): VSCodeTargetResult<T> => ({ kind: "refused", reason });
const resolved = <T>(value: T): VSCodeTargetResult<T> => ({ kind: "target", value });

/**
 * What a command id may contain, measured against the editor's own rule rather than recalled.
 *
 * VS Code requires a command id to match `^[\w-]+(\.[\w-]+)*$` - letters, digits, underscore, hyphen
 * and dots between them - which is why an id may be `cart.preview` **and** `cart.preview-json`.
 * Copied from the runtime's own validation rather than reused from this file's neighbours, because
 * the naming rule next door (`^[a-z0-9]+(\.[a-z0-9]+)+$`, the *validator* naming rule) would refuse
 * every camel-case id, and a criterion for a real extension would be unwritable. This is the same
 * shape of error the provider family recorded when it reused the validator pattern for an action.
 */
const COMMAND_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * A settings key is `section.property`: at least one dot, and the editor's own character set otherwise.
 *
 * The first version of this pattern was lower case only - `^[a-z][a-z0-9]*(\.[a-z0-9]+)+$` - written
 * from the validator naming rule one screen up, and it was wrong about the editor in exactly the way the
 * command pattern's doc comment above warns about. `editor.codeActionsOnSave` is a real, documented
 * setting with capitals in it; `rust-analyzer.check.command` is a real one with a hyphen; and every
 * section this world's own demo declares is `cart-web.something`. A lower-case-only rule refuses all
 * three, and the *family* refused to admit it: `vscode.setting`'s own target noun is spelled
 * `` `cart-web.limit` ``, a key this pattern refused. So a target noun and the grammar beside it
 * disagreed, and the grammar was the one that was wrong.
 *
 * The dot requirement is kept, and it is a fact about *this* world rather than about the editor: the
 * substitute composes the key it records as `section + "." + key` from `getConfiguration(section)`, so a
 * full key always carries a section. A bare word would name a key no reading here can hold, and refusing
 * it by name is more useful than an `INCONCLUSIVE` that lists the keys that do exist.
 */
const SETTING_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

/** A status bar id, an output channel name or a state key: any non-empty text without a newline. */
const textNameProblem = (kind: string, name: string): string | null => {
  if (name === "") return `a ${kind} is required, and this target names an empty one`;
  if (name !== name.trim()) {
    return `a ${kind} is written without surrounding whitespace; this one is ${JSON.stringify(name)}`;
  }
  if (/[\r\n]/.test(name)) {
    return `a ${kind} is a single line; this one carries a line break, which no reader could quote`;
  }
  return null;
};

/** The command id a criterion named, or the resolver's own reason for refusing it. */
export function resolveVSCodeCommandId(target: string): VSCodeTargetResult<string> {
  if (target === "") return refused("a command id is required, and this target names an empty one");
  if (target !== target.trim()) {
    return refused(
      `a command id is written without surrounding whitespace; this one is ${JSON.stringify(target)}`,
    );
  }
  if (!COMMAND_PATTERN.test(target)) {
    return refused(
      `a command id is letters, digits, "_", "-" and "." between them, as the editor itself ` +
        `requires; this one is ${JSON.stringify(target)}`,
    );
  }
  return resolved(target);
}

/** The settings key a criterion named, or the resolver's own reason for refusing it. */
export function resolveVSCodeSettingKey(target: string): VSCodeTargetResult<string> {
  if (target !== target.trim()) {
    return refused(
      `a settings key is written without surrounding whitespace; this one is ${JSON.stringify(target)}`,
    );
  }
  if (!SETTING_PATTERN.test(target)) {
    return refused(
      `a settings key is "section.property" - at least one dot, and letters, digits, "_" and "-" ` +
        `between them, as a manifest declares one and an extension reads one; this key is ` +
        `${JSON.stringify(target)}`,
    );
  }
  return resolved(target);
}

/** The status bar id a criterion named. */
export function resolveVSCodeStatusId(target: string): VSCodeTargetResult<string> {
  const problem = textNameProblem("status bar id", target);
  return problem === null ? resolved(target) : refused(problem);
}

/** The output channel name a criterion named. */
export function resolveVSCodeChannelName(target: string): VSCodeTargetResult<string> {
  const problem = textNameProblem("output channel name", target);
  return problem === null ? resolved(target) : refused(problem);
}

/** The state key a criterion named. */
export function resolveVSCodeStateKey(target: string): VSCodeTargetResult<string> {
  const problem = textNameProblem("state key", target);
  return problem === null ? resolved(target) : refused(problem);
}

/**
 * The workspace-relative path a criterion named.
 *
 * Refused rather than normalised, on the rule the two system families already hold: this world has one
 * workspace folder, and a target that reaches out of it names a place this world does not have. A
 * backslash is refused rather than converted, because a path that is spelled in the host's convention
 * is a path a criterion got from somewhere other than this world's readings, and quietly converting it
 * would hide that.
 */
export function resolveVSCodeFilePath(target: string): VSCodeTargetResult<string> {
  const problem = textNameProblem("workspace path", target);
  if (problem !== null) return refused(problem);
  if (target.includes("\\")) {
    return refused(
      `a workspace path is written with forward slashes, as the editor's own API spells one; this ` +
        `path uses a backslash, which is this machine's convention rather than the world's`,
    );
  }
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) {
    return refused(
      `a workspace path is relative to the workspace folder, so it may not name a root; this path ` +
        `is ${JSON.stringify(target)}`,
    );
  }
  const segments = target.split("/");
  if (segments.some((segment) => segment === "..")) {
    return refused(
      `a workspace path may not reach out of the workspace folder; this path carries a ".." segment`,
    );
  }
  return resolved(target);
}

/** A store and a key, as a criterion named them. */
export interface VSCodeStateRef {
  readonly scope: VSCodeStateScope;
  readonly key: string;
}

/**
 * The store and key a criterion named, as `global/cart.items`.
 *
 * The scope is part of the reference rather than a second field on the expectation, because a target is
 * the only place a criterion has to say *which* thing it means, and "the value stored under
 * `cart.items`" is not a question this world can answer - there are two stores and an extension may use
 * both keys in both. Made a reference rather than a separate validator per store for the reason the
 * container family gives about images and containers: two stores are not two objects, they are one
 * question asked of one of two places, and a second validator would double every name in the family.
 */
export function resolveVSCodeStateRef(target: string): VSCodeTargetResult<VSCodeStateRef> {
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) {
    return refused(
      `a state reference is "<global|workspace>/<key>", so that a criterion says which store it means; ` +
        `this one is ${JSON.stringify(target)}`,
    );
  }
  const scope = target.slice(0, slash);
  if (scope !== "global" && scope !== "workspace") {
    return refused(
      `a state reference names "global" or "workspace" - the two stores the editor hands an extension - ` +
        `and this one names ${JSON.stringify(scope)}`,
    );
  }
  const key = target.slice(slash + 1);
  const problem = textNameProblem("state key", key);
  if (problem !== null) return refused(problem);
  return resolved({ scope, key });
}

// ---- lookups, so a validator reads the reading rather than re-deriving it -------------------------

/** One command by id, or `null` when this world holds none. */
export function vscodeCommand(
  data: VSCodeObservationData,
  id: string,
): VSCodeCommandReading | null {
  return data.commands.find((command) => command.id === id) ?? null;
}

/** The title the manifest declares for a command, which is what puts it in the palette. */
export function vscodeCommandTitle(
  data: VSCodeObservationData,
  id: string,
): string | null {
  return data.contributions.find((entry) => entry.point === "commands" && entry.id === id)?.title ?? null;
}

/** Every invocation the given client made, in the order they arrived. */
export function vscodeInvocationsOf(
  data: VSCodeObservationData,
  client: VSCodeClient,
): readonly VSCodeInvocationReading[] {
  return data.invocations.filter((invocation) => invocation.client === client);
}

/** The last invocation of one command, or `null` when it was never invoked. */
export function vscodeLastInvocation(
  data: VSCodeObservationData,
  command: string,
): VSCodeInvocationReading | null {
  const matching = data.invocations.filter((invocation) => invocation.command === command);
  return matching[matching.length - 1] ?? null;
}

/** One setting by key, or `null` when the extension never read it. */
export function vscodeSetting(
  data: VSCodeObservationData,
  key: string,
): VSCodeSettingReading | null {
  return data.settings.find((setting) => setting.key === key) ?? null;
}

/** One status bar item by id, or `null`. */
export function vscodeStatusItem(
  data: VSCodeObservationData,
  id: string,
): VSCodeStatusReading | null {
  return data.status.find((item) => item.id === id) ?? null;
}

/** One output channel by name, or `null` when the extension created none. */
export function vscodeOutputChannel(
  data: VSCodeObservationData,
  channel: string,
): VSCodeOutputReading | null {
  return data.output.find((entry) => entry.channel === channel) ?? null;
}

/** One workspace file by its relative path, or `null`. */
export function vscodeFile(data: VSCodeObservationData, path: string): VSCodeFileReading | null {
  return data.files.find((file) => file.path === path) ?? null;
}

/** Every value the extension stored in one scope. */
export function vscodeStateOf(
  data: VSCodeObservationData,
  scope: VSCodeStateScope,
): readonly VSCodeStateReading[] {
  return data.state.filter((entry) => entry.scope === scope);
}

/** One stored value, or `null` when nothing was written under that key. */
export function vscodeStateValue(
  data: VSCodeObservationData,
  scope: VSCodeStateScope,
  key: string,
): VSCodeStateReading | null {
  return data.state.find((entry) => entry.scope === scope && entry.key === key) ?? null;
}

/** Every id the manifest declares under one contribution point. */
export function vscodeContributionsAt(
  data: VSCodeObservationData,
  point: string,
): readonly VSCodeContributionReading[] {
  return data.contributions.filter((entry) => entry.point === point);
}

/** Every handle that was handed to the host and not released. */
export function vscodeLeakedSubscriptions(
  data: VSCodeObservationData,
): readonly VSCodeSubscriptionReading[] {
  return data.subscriptions.filter((entry) => !entry.disposed);
}

/** Whether the extension reached for an API this world does not implement. */
export function vscodeRefusedApi(
  data: VSCodeObservationData,
  api: string,
): VSCodeRefusalReading | null {
  return data.refusals.find((entry) => entry.api === api) ?? null;
}

// ---- renderings, so a failure report can quote what it judged ------------------------------------

/** One line an operator reads: the engine floor, and whether this host admits it. */
export function renderEngine(engine: VSCodeEngineReading): string {
  const declared = engine.declared === null ? "(none declared)" : `"${engine.declared}"`;
  const reason = engine.reason === null ? "" : ` - ${engine.reason}`;
  return `engines.vscode ${declared} against API ${engine.apiVersion}: ${engine.result}${reason}`;
}

/** One line an operator reads: which event fired, and whether anything answered it. */
export function renderActivation(activation: VSCodeActivationReading): string {
  const state = activation.activated ? "activated" : "did not activate";
  const error = activation.error === null ? "" : ` - ${activation.error}`;
  return `${state} on "${activation.event}" (host start ${String(activation.runs)})${error}`;
}

/** One line an operator reads: the extension, as its own manifest declares it. */
export function renderExtension(extension: VSCodeIdentityReading): string {
  const publisher = extension.publisher === null ? "" : `${extension.publisher}.`;
  const display = extension.displayName === null ? "" : ` ${JSON.stringify(extension.displayName)}`;
  return `${publisher}${extension.name} ${extension.version}${display}, entry ${JSON.stringify(extension.main)}`;
}

/** `cart.preview "Preview cart" [registered, declared]` - a command, and where it came from. */
export function renderCommand(command: VSCodeCommandReading): string {
  const title = command.title === null ? "no title" : JSON.stringify(command.title);
  const flags: string[] = [command.registered ? "registered" : "not registered"];
  if (command.declared) flags.push("declared in the manifest");
  if (command.disposed) flags.push("disposed");
  return `${command.id} ${title} [${flags.join(", ")}]`;
}

/** One line an operator reads: who asked, how it ended, and why. */
export function renderInvocation(invocation: VSCodeInvocationReading): string {
  const args = invocation.args.length === 0 ? "" : ` ${invocation.args.join(" ")}`;
  const reason = invocation.reason === null ? "" : ` - ${invocation.reason}`;
  return `${invocation.command} (${invocation.client})${args} -> ${invocation.result}${reason}`;
}

/** `cart.preview.format = "json" (from the manifest's default)` - a value, and where it came from. */
export function renderSetting(setting: VSCodeSettingReading): string {
  const value = setting.value === null ? "(nothing)" : JSON.stringify(setting.value);
  const source =
    setting.source === "override"
      ? "from the environment document"
      : setting.source === "default"
        ? "from the manifest's default"
        : "nothing answered for it";
  return `${setting.key} = ${value} (${source})`;
}

/** One line an operator reads: what the item says, and what it does when it is clicked. */
export function renderStatus(item: VSCodeStatusReading): string {
  const tooltip = item.tooltip === null ? "" : `, tooltip ${JSON.stringify(item.tooltip)}`;
  const command = item.command === null ? "" : `, runs ${item.command}`;
  return (
    `${item.id} ${JSON.stringify(item.text)} [${item.visible ? "visible" : "hidden"}, ` +
    `${item.alignment}]${tooltip}${command}`
  );
}

/** `Cart Preview (4 lines, shown)` - a channel, and whether anybody looked at it. */
export function renderOutput(output: VSCodeOutputReading): string {
  const lines = output.lines.length === 1 ? "1 line" : `${String(output.lines.length)} lines`;
  return `${output.channel} (${lines}${output.shown ? ", shown" : ", never shown"})`;
}

/** One line an operator reads: what the extension told a user who does not exist. */
export function renderMessage(message: VSCodeMessageReading): string {
  return `${message.level}: ${message.message}`;
}

/** `globalState/cart.lastPreview = "..."` - a stored value, and the store it went into. */
export function renderState(entry: VSCodeStateReading): string {
  const store = entry.scope === "global" ? "globalState" : "workspaceState";
  const value = entry.value === null ? "(nothing)" : JSON.stringify(entry.value);
  return `${store}/${entry.key} = ${value}`;
}

/** One line an operator reads: a handle, and whether it was released. */
export function renderSubscription(entry: VSCodeSubscriptionReading): string {
  return `${entry.kind} ${entry.id} [${entry.disposed ? "disposed" : "still held"}]`;
}

/** `workspace/report.json 128 bytes (not readable)` - a file the extension touched. */
export function renderFile(file: VSCodeFileReading): string {
  return `workspace/${file.path} ${String(file.bytes)} bytes (${file.readable ? "readable" : "not readable"})`;
}

/** One line an operator reads: an API this world was asked for and does not implement. */
export function renderRefusal(refusal: VSCodeRefusalReading): string {
  return `${refusal.api} (${refusal.client}) -> refused: ${refusal.reason}`;
}
