/**
 * The MCP surface: the transcript loop, the dispatcher, and the eight handlers behind it.
 *
 * This is the fourth consumer of the Core, beside `cli/`, `extension/vscode/` and the tests. It is a
 * **door**, and this file exists to keep it one: every handler calls a function that already did the
 * work before there was a server, and nothing here decides whether an application is correct. The
 * project's own doctrine, held as a measurement rather than as an intention - *MCP is the door.
 * Veridian is the building.*
 *
 * Four rules this file exists to hold:
 *
 * 1. **Never throws.** A frame that cannot be read is a JSON-RPC error, which is *an answer*. A
 *    request for something absent and a request that is malformed are two different answers, the
 *    same distinction a substitute control plane paid for when it merged `404` and `405`. Only a
 *    handler's own unforeseen failure becomes `-32603`, and that is stated rather than swallowed.
 *
 * 2. **Stdout is the protocol channel.** Every log line, warning and progress note goes to stderr,
 *    because `consoleLogger` writes there for the command line's reason and the reason holds twice
 *    over here: a byte of chatter in stdout is a frame no client can parse.
 *
 * 3. **The register is the authority on the arguments.** The dispatcher reads each argument's type,
 *    enum, default and requiredness out of the `inputSchema` the tool publishes, so the reader and
 *    the published schema cannot disagree - which is the defect this repository has recorded five
 *    times, arriving at a sixth vocabulary.
 *
 * 4. **One world is held at a time, and it is torn down.** `EnvironmentManager#prepare` creates,
 *    starts, deploys and waits for health in one public step, so `create_environment`,
 *    `start_environment`, `reset_environment` and `snapshot_environment` all reach the *same* step
 *    and differ in what they report and what they do next. Holding the world is what makes `reset`
 *    and `snapshot` mean anything: reporting `ready` about a world already torn down would be a
 *    claim about something that is gone, which is the one kind of claim this product refuses.
 */

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

import type { Ambiguity, Logger } from "../core/clarification/index.ts";
import type { IncompleteDefinition } from "../core/definition.ts";
import { bundleLayout } from "../core/evidence/index.ts";
import type { RunBundleLayout } from "../core/evidence/index.ts";
import { nodeIo } from "../core/io.ts";
import type { IoPort } from "../core/io.ts";

import { DEFAULT_MEMORY_URL } from "../cli/arguments.ts";
import { openSession } from "../cli/session.ts";
import type { Session, SessionOptions } from "../cli/session.ts";
import { consoleLogger } from "../cli/support.ts";
import { buildEnvironment, runValidation } from "../cli/validate.ts";
import type {
  BrowserChoice,
  BuiltWorld,
  EnvironmentOutcome,
  EnvironmentRequest,
  RunRequest,
  ValidationOutcome,
} from "../cli/validate.ts";

import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  MCP_INITIALIZED_NOTIFICATION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  idOf,
  isMcpMethod,
  isNotification,
  rpcFailure,
  rpcResult,
} from "./protocol.ts";
import type { JsonRpcFailure, JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "./protocol.ts";
import {
  BROWSER_CHOICE_NAMES,
  DEFAULT_BROWSER_CHOICE,
  MCP_TOOLS,
  MCP_TOOL_NAMES,
  findTool,
} from "./tools.ts";
import type { McpTool } from "./tools.ts";

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

/** An answer to a `tools/call`, before it is shaped into the transport's result object. */
interface ToolAnswer {
  /**
   * Whether the *tool* failed. Not a JSON-RPC error: the transport reserves this shape for it, and
   * the difference matters - `-32602` says the request could not be served, while `isError: true`
   * says it was served and the answer is a refusal with a reason.
   */
  readonly isError: boolean;
  /** The human reading, and the only part a client that ignores structured content will show. */
  readonly text: string;
  /** The same answer as values, so a caller is not left parsing prose. */
  readonly structured?: unknown;
}

/**
 * The answer a handler produces, or `null` when its arguments could not address anything.
 *
 * `null` is deliberately not an error object: the reason lives in the reader's own `problems`, so
 * there is one list of what was wrong with a request rather than two that can disagree.
 */
type ToolAnswerOrNull = Promise<ToolAnswer | null>;

function answered(text: string, structured: unknown): ToolAnswer {
  return { isError: false, text, structured };
}

function refused(reason: string, detail: string): ToolAnswer {
  return { isError: true, text: `${reason}\n${detail}`, structured: { refused: { reason, detail } } };
}

// ---------------------------------------------------------------------------------------------
// Reading arguments out of the schema the tool publishes
// ---------------------------------------------------------------------------------------------

/** The slice of a tool's `inputSchema` the reader consults. */
interface ArgumentSpecs {
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required: readonly string[];
}

interface ToolArguments {
  readonly failed: boolean;
  readonly problems: readonly string[];
  /**
   * A string argument, whose *requiredness the schema decides*: absent and the schema lists the name
   * in `required` is a problem, absent otherwise is simply `null`.
   */
  required(name: string): string | null;
  /** A string argument the schema leaves open. `null` when absent, which is not a failure. */
  optional(name: string): string | null;
  /** A string argument whose schema states a `default`; the fallback comes from the schema. */
  defaulted(name: string): string;
  flag(name: string): boolean;
  browser(): BrowserChoice;
  /** A non-empty array of strings, or `null` when absent. Absent is not a failure. */
  strings(name: string): readonly string[] | null;
}

/**
 * Read a tool's argument specs out of the schema it publishes.
 *
 * One cast, at one seam, on a value `mcp/tools.ts` authors: the alternative is a second declaration
 * of which arguments exist, their types and which are required - and two lists of one vocabulary
 * disagree the first time only one of them is edited.
 */
function specsOf(tool: McpTool): ArgumentSpecs {
  const schema = tool.inputSchema as {
    readonly properties?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly required?: readonly unknown[];
  };
  const required = (schema.required ?? []).filter((name): name is string => typeof name === "string");
  return { properties: schema.properties ?? {}, required };
}

function readArguments(specs: ArgumentSpecs, params: unknown): ToolArguments {
  const raw: Readonly<Record<string, unknown>> =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const problems: string[] = [];

  const specOf = (name: string): Readonly<Record<string, unknown>> => specs.properties[name] ?? {};
  const present = (name: string): boolean => raw[name] !== undefined && raw[name] !== null;
  // The schema's own `required` list, so "is this field required" is answered where the tool declares
  // it rather than by which reader a handler happened to reach for.
  const requiredNames = new Set(specs.required);

  /**
   * A string, checked against the type the schema publishes.
   *
   * Pushes a problem only when the value is present and unusable, so `required` can tell "absent"
   * from "wrong type" and say which it was - an operator told `goalPath is required` will look for a
   * missing field, and one told `goalPath must be a string` will look at the value they sent.
   */
  const stringOrNull = (name: string): string | null => {
    if (!present(name)) return null;
    const value = raw[name];
    if (typeof value !== "string") {
      problems.push(`"${name}" must be a string`);
      return null;
    }
    if (value.trim() === "") {
      problems.push(`"${name}" must not be empty`);
      return null;
    }
    return value;
  };

  return {
    get problems() {
      return problems;
    },
    get failed() {
      return problems.length > 0;
    },

    required(name: string): string | null {
      const value = stringOrNull(name);
      if (value === null && !present(name) && requiredNames.has(name)) {
        problems.push(`"${name}" is required`);
      }
      return value;
    },

    /**
     * An argument the schema does not require.
     *
     * Separate from `required` because the two answer different questions, and one of them is
     * `snapshot_environment`'s whole interface: an absent `snapshotId` means *take one*, while an
     * absent `goalPath` means the caller has not said what to act on. Reading an optional field with
     * the required reader pushed `is required` for a field the schema says may be omitted, which set
     * `args.failed` and made the branch consuming the absence unreachable - a tool that could never
     * do half of what its own description promised.
     */
    optional(name: string): string | null {
      return stringOrNull(name);
    },

    defaulted(name: string): string {
      const value = stringOrNull(name);
      if (value !== null) return value;
      const declared = specOf(name)["default"];
      if (typeof declared === "string") return declared;
      problems.push(`"${name}" has no default in the tool's own schema`);
      return "";
    },

    flag(name: string): boolean {
      if (present(name)) {
        const value = raw[name];
        if (typeof value !== "boolean") {
          problems.push(`"${name}" must be a boolean`);
          return false;
        }
        return value;
      }
      const declared = specOf(name)["default"];
      if (typeof declared === "boolean") return declared;
      problems.push(`"${name}" has no default in the tool's own schema`);
      return false;
    },

    browser(): BrowserChoice {
      const value = this.defaulted("browser");
      if (value === "" && problems.length > 0) return DEFAULT_BROWSER_CHOICE;
      if (!(BROWSER_CHOICE_NAMES as readonly string[]).includes(value)) {
        problems.push(`"browser" must be one of ${BROWSER_CHOICE_NAMES.join(", ")}`);
        return DEFAULT_BROWSER_CHOICE;
      }
      // Sound because `BROWSER_CHOICE_NAMES` is typed by `BrowserChoice`: the check above is the
      // membership test the compiler cannot see through `includes`.
      return value as BrowserChoice;
    },

    strings(name: string): readonly string[] | null {
      if (!present(name)) return null;
      const value = raw[name];
      if (!Array.isArray(value)) {
        problems.push(`"${name}" must be an array of strings`);
        return null;
      }
      if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
        problems.push(`"${name}" must contain only non-empty strings`);
        return null;
      }
      if (value.length === 0) {
        problems.push(`"${name}" must not be empty when present`);
        return null;
      }
      return value as readonly string[];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Renderings
// ---------------------------------------------------------------------------------------------

/**
 * A world's transitions, as the chain an operator reads.
 *
 * The reasons are carried in structured content rather than in this line: a chain of eight
 * transitions with eight reasons is a paragraph, and the shape of the chain is the fact a reader
 * wants first.
 */
function chainOf(transitions: readonly { readonly from: string; readonly to: string }[]): string {
  const first = transitions[0];
  if (first === undefined) return "(no transitions recorded)";
  return [first.from, ...transitions.map((step) => step.to)].join(" -> ");
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Whether a result document records a failure to explain, and if so the record itself.
 *
 * One predicate for two readers, because they have to agree: `describeResult` renders a `failure:`
 * line only when this answers a record, and `getFailure` takes its "nothing to explain" branch on
 * the same answer. A second spelling of the rule is how one document comes to be described as having
 * a failure by one half of an answer and as having none by the other.
 *
 * A missing key and an explicit `null` are both "no failure". `serializeResult` writes the second,
 * but this reads `latest-result.json`, which is a Level-2 interface an external actor may write -
 * and a document that never mentions a failure is not a document that has one. That is the same
 * tolerant read `textOrNull` and `numberOf` perform for every other absent field; a strict
 * comparison against `null` made this the one field whose absence was read as its presence, which
 * reported a failure report path for a run that recorded no failure and, in the same answer, that
 * the report was not written.
 */
function failureOf(
  result: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const failure = result["failure"];
  return typeof failure === "object" && failure !== null
    ? (failure as Readonly<Record<string, unknown>>)
    : null;
}

/**
 * The reading a result file carries, as one paragraph.
 *
 * Only fields `serializeResult` is known to write are read here: the run's id, its verdict, its
 * state, the iteration it stopped at, its failure and its reasons. The whole document is also
 * returned as structured content, so a caller wanting anything else does not read prose - and this
 * function cannot misname a field it does not know about.
 */
function describeResult(result: Readonly<Record<string, unknown>>): string {
  const runId = textOrNull(result["run_id"]) ?? "(unnamed run)";
  const verdict = textOrNull(result["verdict"]) ?? "UNKNOWN";
  const state = textOrNull(result["state"]) ?? "UNKNOWN";
  const iteration = numberOf(result["iteration"]);
  const lines = [`run ${runId}: ${verdict} (${state}, ${String(iteration ?? 0)} iteration(s))`];

  const failure = failureOf(result);
  if (failure !== null) {
    const kind = textOrNull(failure["kind"]) ?? "UNKNOWN";
    const message = textOrNull(failure["message"]) ?? "";
    const criterion = textOrNull(failure["criterion_id"]);
    lines.push(
      `failure: ${kind}${criterion === null ? "" : ` [${criterion}]`}${message === "" ? "" : ` - ${message}`}`,
    );
  }

  const reasons = result["reasons"];
  if (Array.isArray(reasons) && reasons.length > 0) {
    lines.push("reasons:");
    for (const reason of reasons) lines.push(`  - ${String(reason)}`);
  }
  return lines.join("\n");
}

/** A gap the ladder could not close, as the pointer it named and the question it asked. */
function describeGap(gap: Ambiguity): string {
  return `  ${gap.path} - ${gap.question}`;
}

/**
 * A contract that cannot be run yet.
 *
 * The gaps are quoted with their pointers, because a pointer is where an operator's answer is
 * written and what the failure report will name; paraphrasing it would send the reader to look for a
 * field with a different spelling.
 */
function incompleteRefusal(definition: IncompleteDefinition): ToolAnswer {
  const unresolved = definition.unresolved.map(describeGap);
  const deferred = definition.deferred.map(describeGap);
  const parts = [`A contract that cannot be run yet: ${definition.reason}`];
  if (unresolved.length > 0) parts.push(`Unresolved:\n${unresolved.join("\n")}`);
  if (deferred.length > 0) parts.push(`Deferred:\n${deferred.join("\n")}`);
  parts.push("Answer the gaps where the documents say the answer goes, or run: veridian validate --goal <goal.yaml>");
  return refused(parts[0] as string, parts.slice(1).join("\n"));
}

// ---------------------------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------------------------

/**
 * What the surface reaches Core through.
 *
 * `build` and `run` are injectable so the suite can drive the loop and the register without opening
 * a session, loading a schema set or reaching for a memory substrate - and their defaults are the
 * real functions, so a production call cannot accidentally get a double. The two are the same two a
 * command line reaches: this surface adds an entry point, not a second lifecycle.
 */
export interface McpContext {
  /** Reads this surface's own files. Not a session's `io`, because a read must not need a session. */
  readonly io: IoPort;
  readonly logger: Logger;
  /** The defaults every session this surface opens is given, so a tool and the CLI resolve alike. */
  readonly sessionOptions: SessionOptions;
  readonly build: (request: EnvironmentRequest) => Promise<EnvironmentOutcome>;
  readonly run: (request: RunRequest) => Promise<ValidationOutcome>;
}

/**
 * The defaults the surface opens sessions with - the command line's own defaults.
 *
 * Deliberately not quieter ones. Memory is enabled and degrades loudly (`HttpMemory` never throws
 * and flips its own flag), and rung 4 is enabled because it is the run answering its *own* gap from
 * material it already holds rather than a prompt to a human. A surface with its own defaults would
 * answer a different question than the one the operator asked with the same documents.
 */
const SURFACE_SESSION_OPTIONS: SessionOptions = {
  memoryUrl: DEFAULT_MEMORY_URL,
  noMemory: false,
  noSelfPrompt: false,
};

export function defaultContext(options: { readonly logger?: Logger } = {}): McpContext {
  return {
    io: nodeIo(),
    logger: options.logger ?? consoleLogger(),
    sessionOptions: SURFACE_SESSION_OPTIONS,
    build: buildEnvironment,
    run: runValidation,
  };
}

// ---------------------------------------------------------------------------------------------
// The held world
// ---------------------------------------------------------------------------------------------

/** A world this server built, and the request it was built for. */
interface HeldWorld {
  readonly goalPath: string;
  readonly stateDir: string;
  readonly browser: BrowserChoice;
  readonly headed: boolean;
  readonly world: BuiltWorld;
}

interface WorldRequest {
  readonly goalPath: string;
  readonly stateDir: string;
  readonly browser: BrowserChoice;
  readonly headed: boolean;
}

/** The world a handler worked on, plus how it got there. */
type WorldAttempt =
  | { readonly kind: "refused"; readonly answer: ToolAnswer }
  | {
      readonly kind: "ready";
      readonly held: HeldWorld;
      /** `built` when this call prepared it, `reused` when the held world already matched. */
      readonly prepared: "built" | "reused";
      /** The prepare reading, present only when this call actually prepared the world. */
      readonly prepare: { readonly id: string; readonly transitions: readonly unknown[] } | null;
    };

// ---------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------

export type ServerFrame = JsonRpcResponse | JsonRpcFailure;

export interface McpServer {
  /** Answer one already-parsed frame, or `null` when the frame was a notification. */
  handle(frame: unknown): Promise<ServerFrame | null>;
  /** Parse one transport frame and answer it. An unparseable frame is `-32700`, which is an answer. */
  handleLine(line: string): Promise<ServerFrame | null>;
  /** Whether a world is currently held. Read by the suite; the handler never needs it. */
  readonly holding: boolean;
  /** Tear down any held world. Safe to call twice, never throws. */
  close(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createServer(context: McpContext): McpServer {
  let held: HeldWorld | null = null;

  async function openSessionFor(): Promise<Session> {
    return await openSession(context.sessionOptions, context.logger);
  }

  // -------------------------------------------------------------------------------------------
  // The world every acting tool reaches
  // -------------------------------------------------------------------------------------------

  /**
   * Reuse the held world when the request names the same one, otherwise build and prepare a fresh.
   *
   * Identity is the request **resolved through the context's own `io`**, not as written: `./g.yaml`
   * and `g.yaml` are one file, and deciding that here rather than asking the port would be this
   * surface inventing a path rule that already exists.
   *
   * A world is never held across a *changed* request. The old one is torn down first, because a
   * server that accumulated worlds would leak a child process per distinct goal - the orphan this
   * project's manager already goes out of its way to prevent.
   */
  async function worldFor(request: WorldRequest, prepare: boolean): Promise<WorldAttempt> {
    const canonical = (path: string): string => context.io.resolve(path);
    const matches =
      held !== null &&
      held.goalPath === canonical(request.goalPath) &&
      held.stateDir === canonical(request.stateDir) &&
      held.browser === request.browser &&
      held.headed === request.headed;

    if (matches && held !== null) {
      return { kind: "ready", held, prepared: "reused", prepare: null };
    }

    if (held !== null) await close();

    const outcome = await context.build({
      session: await openSessionFor(),
      logger: context.logger,
      goalPath: request.goalPath,
      stateDir: request.stateDir,
      browser: request.browser,
      headed: request.headed,
    });

    if (outcome.kind === "incomplete") return { kind: "refused", answer: incompleteRefusal(outcome.definition) };
    if (outcome.kind === "unusable") {
      return { kind: "refused", answer: refused(outcome.refusal.title, outcome.refusal.body) };
    }

    const built: HeldWorld = {
      goalPath: canonical(request.goalPath),
      stateDir: canonical(request.stateDir),
      browser: request.browser,
      headed: request.headed,
      world: outcome.world,
    };

    if (!prepare) {
      return { kind: "ready", held: built, prepared: "built", prepare: null };
    }

    const prepared = await outcome.world.manager.prepare(outcome.world.environment);
    if (!prepared.ok) {
      // A world that failed to prepare is still a world that may have spawned something. Tearing it
      // down before reporting is what stops a failed `start` from leaving a process behind - the
      // one defence this project has against an orphan outliving the run that made it.
      await outcome.world.manager.teardown();
      const failure = prepared.failure;
      const detail = [
        `The application did not become valid, so no criterion was observed.`,
        `adapter: ${outcome.world.environment.adapter}`,
        `state: ${prepared.state}`,
        `transitions: ${chainOf(prepared.transitions)}`,
        `run again with the goal, or read the world's own output above (stderr).`,
      ].join("\n");
      return {
        kind: "refused",
        answer: refused(`${failure.kind}: ${failure.message}`, detail),
      };
    }

    held = built;
    return { kind: "ready", held: built, prepared: "built", prepare: prepared };
  }

  async function close(): Promise<void> {
    const current = held;
    held = null;
    if (current === null) return;
    await current.world.manager.teardown();
  }

  // -------------------------------------------------------------------------------------------
  // The eight handlers
  // -------------------------------------------------------------------------------------------

  function createEnvironment(args: ToolArguments): ToolAnswerOrNull {
    const goalPath = args.required("goalPath");
    const stateDir = args.defaulted("stateDir");
    const browser = args.browser();
    const headed = args.flag("headed");
    if (args.failed) return Promise.resolve(null);
    return worldFor({ goalPath: goalPath as string, stateDir, browser, headed }, true).then((attempt) => {
      if (attempt.kind === "refused") return attempt.answer;
      const world = attempt.held.world;
      const prepare = attempt.prepare;
      const structured = {
        prepared: attempt.prepared,
        adapter: world.environment.adapter,
        browser: world.browserLabel,
        state: world.manager.state,
        id: world.manager.id,
        transitions: prepare?.transitions ?? world.manager.transitions,
        boundaries: world.manager.boundaries(),
        environment: world.environment,
      };
      const text = [
        `world ${attempt.prepared} for "${world.environment.adapter}": state ${world.manager.state}`,
        `browser: ${world.browserLabel}`,
        `transitions: ${chainOf(world.manager.transitions)}`,
      ].join("\n");
      return answered(text, structured);
    });
  }

  function startEnvironment(args: ToolArguments): ToolAnswerOrNull {
    const goalPath = args.required("goalPath");
    const stateDir = args.defaulted("stateDir");
    const browser = args.browser();
    const headed = args.flag("headed");
    if (args.failed) return Promise.resolve(null);
    return worldFor({ goalPath: goalPath as string, stateDir, browser, headed }, true).then((attempt) => {
      if (attempt.kind === "refused") return attempt.answer;
      const world = attempt.held.world;
      const text = [
        `world ${attempt.prepared === "reused" ? "already prepared" : "prepared"}: state ${world.manager.state}`,
        `id: ${String(world.manager.id)}`,
        `transitions: ${chainOf(world.manager.transitions)}`,
      ].join("\n");
      return answered(text, {
        prepared: attempt.prepared,
        state: world.manager.state,
        id: world.manager.id,
        transitions: world.manager.transitions,
        boundaries: world.manager.boundaries(),
      });
    });
  }

  async function runValidationTool(args: ToolArguments): Promise<ToolAnswer | null> {
    const goalPath = args.required("goalPath");
    const stateDir = args.defaulted("stateDir");
    const browser = args.browser();
    const headed = args.flag("headed");
    const repair = args.strings("repair");
    const noRepair = args.flag("noRepair");
    if (args.failed) return null;

    const outcome = await context.run({
      session: await openSessionFor(),
      logger: context.logger,
      goalPath: goalPath as string,
      stateDir,
      browser,
      headed,
      repair,
      noRepair,
      onNotice: (notice) => {
        context.logger.warn(notice.topic, notice.fields);
      },
    });

    if (outcome.kind === "incomplete") return incompleteRefusal(outcome.definition);
    if (outcome.kind === "unusable") return refused(outcome.refusal.title, outcome.refusal.body);

    const result = outcome.result;
    const structured = {
      runId: outcome.runId,
      verdict: result.verdict,
      state: result.state,
      iterations: result.iterations.length,
      environmentValid: result.environmentValid,
      resultPath: result.resultPath,
      failureReportPath: result.failureReportPath,
      failure: result.failure,
      reasons: result.reasons,
      guards: result.guards,
    };
    const text = [
      `run ${outcome.runId}: ${result.verdict} (${result.state}, ${String(result.iterations.length)} iteration(s))`,
      `result: ${result.resultPath}`,
      result.failure === null
        ? "no failure recorded"
        : `failure: ${result.failure.kind} - ${result.failure.message}`,
      `read it again with get_result, and the bundle's ledger with get_evidence.`,
    ].join("\n");
    return answered(text, structured);
  }

  // -------------------------------------------------------------------------------------------
  // Reading what a run left
  // -------------------------------------------------------------------------------------------

  /**
   * The layout for a state directory.
   *
   * `bundleLayout` is the authority on where a bundle's files live, so this surface asks it rather
   * than spelling `latest-result.json` a second time and being wrong the day the layout moves. The
   * run id is only part of the answer for paths *inside* a run's own directory; `latestResult` and
   * `latestFailure` sit above it and do not depend on one, which is why the empty id below is a
   * placeholder rather than a claim about a run named "".
   */
  function layoutOf(stateDir: string, runId = ""): RunBundleLayout {
    return bundleLayout(stateDir, runId);
  }

  async function readResultFile(stateDir: string): Promise<
    | { readonly kind: "absent" }
    | { readonly kind: "unreadable"; readonly path: string; readonly message: string }
    | { readonly kind: "parsed"; readonly path: string; readonly result: Readonly<Record<string, unknown>> }
  > {
    const path = layoutOf(stateDir).latestResult;
    let text: string | null;
    try {
      text = await context.io.readTextFile(path);
    } catch (error) {
      return { kind: "unreadable", path, message: messageOf(error) };
    }
    // `IoPort#readTextFile` answers `null` for a file that is not there rather than throwing, which
    // is why an empty history is a fact this surface can *state* instead of an error it has to catch.
    if (text === null) return { kind: "absent" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { kind: "unreadable", path, message: `not JSON: ${messageOf(error)}` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "unreadable", path, message: "not a JSON object" };
    }
    return { kind: "parsed", path, result: parsed as Readonly<Record<string, unknown>> };
  }

  /** The refusal §4.3 requires, naming the command that produces the thing that is absent. */
  function noRun(stateDir: string): ToolAnswer {
    return refused(
      `There is no run to read in "${stateDir}".`,
      `Run one with: veridian validate --goal <goal.yaml> --state-dir ${stateDir}\n` +
        `or call the run_validation tool, which writes the same bundle.`,
    );
  }

  function unreadable(path: string, problem: string): ToolAnswer {
    return refused(`${path} exists but could not be read as a result.`, `reason: ${problem}`);
  }

  async function getResult(args: ToolArguments): Promise<ToolAnswer | null> {
    const stateDir = args.defaulted("stateDir");
    if (args.failed) return null;
    const read = await readResultFile(stateDir);
    if (read.kind === "absent") return noRun(stateDir);
    if (read.kind === "unreadable") return unreadable(read.path, read.message);
    return answered(describeResult(read.result), read.result);
  }

  async function getFailure(args: ToolArguments): Promise<ToolAnswer | null> {
    const stateDir = args.defaulted("stateDir");
    if (args.failed) return null;
    const read = await readResultFile(stateDir);
    if (read.kind === "absent") return noRun(stateDir);
    if (read.kind === "unreadable") return unreadable(read.path, read.message);

    const runId = textOrNull(read.result["run_id"]) ?? "";
    const iteration = numberOf(read.result["iteration"]) ?? 0;
    const failure = failureOf(read.result);
    const layout = layoutOf(stateDir, runId);

    /**
     * The actor's own transcripts, found by asking for each iteration the result names.
     *
     * Not by listing a directory: `readTextFile` answers `null` for a file that is not there, so
     * absence is a value rather than a second error path - and the count comes from the run's own
     * reading rather than from whatever a directory happens to contain.
     */
    const transcripts: { readonly path: string; readonly text: string }[] = [];
    for (let index = 1; index <= iteration; index += 1) {
      const path = `${layout.runDir}/artifacts/repair-${String(index)}.log`;
      let text: string | null = null;
      try {
        text = await context.io.readTextFile(path);
      } catch (error) {
        context.logger.warn("a repair transcript could not be read", { path, message: messageOf(error) });
      }
      if (text !== null) transcripts.push({ path, text });
    }

    if (failure === null) {
      // The run line comes first, so the answer names which run it is about before saying there is
      // nothing to explain about it - the layout the branch below uses, and the one `get_result`
      // already answers with. Without it a caller holding two state directories had to infer which
      // run each answer described from the sentence alone, and the run line is also where a verdict
      // or a state is reported for a run that did not fail.
      return answered(
        [
          describeResult(read.result),
          `The newest run (${runId === "" ? "unnamed" : runId}) recorded no failure, so there is nothing to explain.`,
        ].join("\n"),
        { runId, verdict: textOrNull(read.result["verdict"]), failure: null, transcripts: [] },
      );
    }

    const report = layout.latestFailure;
    let reportText: string | null = null;
    try {
      reportText = await context.io.readTextFile(report);
    } catch (error) {
      context.logger.warn("the failure report could not be read", { path: report, message: messageOf(error) });
    }

    const text = [
      describeResult(read.result),
      `failure report: ${report}${reportText === null ? " (not written)" : ""}`,
      transcripts.length === 0
        ? "repair transcripts: none - no iteration repaired anything."
        : `repair transcripts: ${String(transcripts.length)}, at ${layout.runDir}/artifacts/repair-<n>.log`,
    ].join("\n");

    return answered(text, {
      runId,
      failure,
      report: { path: report, text: reportText },
      transcripts,
      note:
        "A transcript is the repair actor's own output, written before the run acted on its answer. " +
        "Nothing in the verdict reads it: a repair is believed only once the criteria are re-observed " +
        "from a clean world.",
    });
  }

  async function getEvidence(args: ToolArguments): Promise<ToolAnswer | null> {
    const stateDir = args.defaulted("stateDir");
    if (args.failed) return null;
    const read = await readResultFile(stateDir);
    if (read.kind === "absent") return noRun(stateDir);
    if (read.kind === "unreadable") return unreadable(read.path, read.message);

    const evidence = read.result["evidence"];
    if (typeof evidence !== "object" || evidence === null) {
      return refused(
        `${read.path} carries no evidence ledger.`,
        "That file was not written by this build's evidence writer, so nothing here can say what a " +
          `run produced. Write one with: veridian validate --goal <goal.yaml> --state-dir ${stateDir}`,
      );
    }

    const ledger = evidence as Readonly<Record<string, unknown>>;
    const artifacts = ledger["artifacts"];
    const rows = Array.isArray(artifacts) ? artifacts : [];
    const complete = ledger["complete"] === true;
    const bundlePath = textOrNull(ledger["bundlePath"]) ?? layoutOf(stateDir).runDir;

    const text = [
      `bundle: ${bundlePath}`,
      `artifacts: ${String(rows.length)}, complete: ${complete ? "yes" : "no"}`,
      complete
        ? "Every required artifact exists."
        : `Missing: ${JSON.stringify(ledger["missing"] ?? [])}`,
      "The ledger is last-write-wins per path: an artifact observed four times is one row.",
    ].join("\n");

    return answered(text, {
      bundlePath,
      complete,
      missing: ledger["missing"] ?? [],
      artifacts: rows,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Acting on the held world
  // -------------------------------------------------------------------------------------------

  async function resetEnvironment(args: ToolArguments): Promise<ToolAnswer | null> {
    const goalPath = args.required("goalPath");
    const stateDir = args.defaulted("stateDir");
    const browser = args.browser();
    const headed = args.flag("headed");
    if (args.failed) return null;

    const attempt = await worldFor({ goalPath: goalPath as string, stateDir, browser, headed }, true);
    if (attempt.kind === "refused") return attempt.answer;

    const manager = attempt.held.world.manager;
    const reset = await manager.reset();
    if (!reset.ok) {
      return refused(
        `${reset.failure.kind}: ${reset.failure.message}`,
        [
          `The world did not come back to a valid state, so nothing may be observed against it.`,
          `state: ${reset.state}`,
          `transitions: ${chainOf(reset.transitions)}`,
        ].join("\n"),
      );
    }
    return answered(
      [
        `world reset: state ${reset.state}, ${String(reset.transitions.length)} transition(s) recorded`,
        `transitions: ${chainOf(reset.transitions)}`,
        "Reset is first-class here rather than test cleanup: a validator must never inherit contaminated state.",
      ].join("\n"),
      {
        prepared: attempt.prepared,
        strategy: attempt.held.world.environment.reset.strategy,
        state: reset.state,
        id: reset.id,
        transitions: reset.transitions,
      },
    );
  }

  async function snapshotEnvironment(args: ToolArguments): Promise<ToolAnswer | null> {
    const goalPath = args.required("goalPath");
    const stateDir = args.defaulted("stateDir");
    const browser = args.browser();
    const headed = args.flag("headed");
    // Optional, not required: the tool's schema lists only `goalPath` in `required`, and an absent id
    // is the request to *take* one - which is half of what this tool does.
    const snapshotId = args.optional("snapshotId");
    if (args.failed) return null;

    const attempt = await worldFor({ goalPath: goalPath as string, stateDir, browser, headed }, true);
    if (attempt.kind === "refused") return attempt.answer;
    const manager = attempt.held.world.manager;

    if (snapshotId === null) {
      const taken = await manager.snapshot();
      return answered(
        `snapshot taken: ${taken}\nPass it back as "snapshotId" to restore it.`,
        { did: "took", snapshotId: taken, state: manager.state, prepared: attempt.prepared },
      );
    }

    await manager.restore(snapshotId);
    return answered(
      `restored snapshot ${snapshotId}: state ${manager.state}`,
      { did: "restored", snapshotId, state: manager.state, prepared: attempt.prepared },
    );
  }

  const HANDLERS: Readonly<Record<string, (args: ToolArguments) => ToolAnswerOrNull>> = {
    create_environment: (args) => createEnvironment(args),
    start_environment: (args) => startEnvironment(args),
    run_validation: (args) => runValidationTool(args),
    get_result: (args) => getResult(args),
    get_failure: (args) => getFailure(args),
    get_evidence: (args) => getEvidence(args),
    reset_environment: (args) => resetEnvironment(args),
    snapshot_environment: (args) => snapshotEnvironment(args),
  };

  // -------------------------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------------------------

  function initializeResult(): Record<string, unknown> {
    return {
      // Whatever the client asked for. The revision is declared, not negotiated: a server that
      // claims a range supports the range, and nothing in this tree can check that it does.
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      instructions:
        "Every tool here projects a capability the Veridian command line already has, so a tool call " +
        "and a command line answer the same question the same way. The environment is the product; " +
        "this surface is a door onto it, not a second Veridian.",
    };
  }

  function listResult(): Record<string, unknown> {
    return {
      tools: MCP_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // Published on purpose. It makes "every capability already exists" a fact a caller can read
        // rather than a promise in a document - and a client that does not know the field ignores it.
        projects: tool.projects,
      })),
    };
  }

  async function callTool(id: JsonRpcId, params: unknown): Promise<ServerFrame> {
    const call =
      typeof params === "object" && params !== null ? (params as Readonly<Record<string, unknown>>) : {};
    const name = textOrNull(call["name"]);
    if (name === null) {
      return rpcFailure(id, JSON_RPC_ERROR_CODES.invalidParams, 'tools/call requires a string "name"', {
        tools: MCP_TOOL_NAMES,
      });
    }

    const tool = findTool(name);
    if (tool === null) {
      // `-32602`, not `-32601`: the *method* `tools/call` was served and its argument was what this
      // build does not hold. An absent resource and a refused request are two different answers.
      return rpcFailure(id, JSON_RPC_ERROR_CODES.invalidParams, `no tool is registered under "${name}"`, {
        name,
        tools: MCP_TOOL_NAMES,
      });
    }

    const args = readArguments(specsOf(tool), call["arguments"]);
    if (args.failed) {
      return rpcFailure(
        id,
        JSON_RPC_ERROR_CODES.invalidParams,
        `arguments for "${name}" could not address anything`,
        { name, problems: args.problems },
      );
    }

    try {
      const answer = await HANDLERS[tool.name]?.(args);
      if (answer === undefined) {
        // Unreachable while `HANDLERS` covers the register; a guard rather than a cast, because the
        // register is the thing a ninth tool would edit and this is what tells an implementer that
        // a name is not enough.
        return rpcFailure(id, JSON_RPC_ERROR_CODES.internalError, `"${name}" is registered but has no handler`);
      }
      if (answer === null) {
        return rpcFailure(
          id,
          JSON_RPC_ERROR_CODES.invalidParams,
          `arguments for "${name}" could not address anything`,
          { name, problems: args.problems },
        );
      }
      const content = [{ type: "text", text: answer.text }];
      const result =
        answer.structured === undefined
          ? { content, isError: answer.isError }
          : { content, structuredContent: answer.structured, isError: answer.isError };
      return rpcResult(id, result);
    } catch (error) {
      // The one place a handler's unforeseen failure becomes a protocol error. It names the tool,
      // because a message that named only the cause would send the reader to inspect the wrong one.
      context.logger.warn("an MCP tool failed", { tool: tool.name, message: messageOf(error) });
      return rpcFailure(id, JSON_RPC_ERROR_CODES.internalError, `the "${name}" tool failed: ${messageOf(error)}`);
    }
  }

  async function handle(frame: unknown): Promise<ServerFrame | null> {
    if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
      return rpcFailure(null, JSON_RPC_ERROR_CODES.invalidRequest, "a JSON-RPC frame must be an object");
    }
    const request = frame as JsonRpcRequest;
    const id = idOf(request);

    if (request.jsonrpc !== JSON_RPC_VERSION) {
      return rpcFailure(
        id,
        JSON_RPC_ERROR_CODES.invalidRequest,
        `"jsonrpc" must be "${JSON_RPC_VERSION}"`,
      );
    }

    const method = request.method;
    if (typeof method !== "string") {
      return rpcFailure(id, JSON_RPC_ERROR_CODES.invalidRequest, '"method" must be a string');
    }

    if (isNotification(request)) {
      // A notification is never answered, including an unknown one: there is no id to answer, and
      // the transport says a server MUST NOT reply. `notifications/initialized` is named rather than
      // inferred from the missing id, because "no id arrived" and "the handshake is being closed"
      // are two different facts and only the second is the one the loop acts on.
      if (method === MCP_INITIALIZED_NOTIFICATION) context.logger.debug("mcp handshake complete");
      return null;
    }

    if (!isMcpMethod(method)) {
      return rpcFailure(id, JSON_RPC_ERROR_CODES.methodNotFound, `unknown method: ${method}`, { method });
    }

    if (method === "initialize") return rpcResult(id, initializeResult());
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") return rpcResult(id, listResult());
    return await callTool(id, request.params);
  }

  async function handleLine(line: string): Promise<ServerFrame | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      return rpcFailure(
        null,
        JSON_RPC_ERROR_CODES.parseError,
        `frame is not JSON: ${messageOf(error)}`,
        { frame: line.length > 200 ? `${line.slice(0, 200)}...` : line },
      );
    }
    return await handle(parsed);
  }

  return {
    handle,
    handleLine,
    get holding() {
      return held !== null;
    },
    close,
  };
}

// ---------------------------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------------------------

/** Whether this module was invoked as the program, rather than imported by a suite or a client. */
function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  const here = fileURLToPath(import.meta.url);
  const a = resolvePath(invoked);
  const b = resolvePath(here);
  // Windows paths are case-insensitive, and the drive letter a shell prints is not always the one
  // `import.meta.url` carries. Comparing byte for byte would refuse to start the server the smoke
  // test just spawned, and the refusal would look like a missing entry point.
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Serve MCP over stdio until the input closes, then exit 0.
 *
 * Frames are answered **in the order they arrived**, because two concurrent `tools/call`s would race
 * for the one held world and the loser's report would be about a world that had already been torn
 * down. Writes are chained for the same reason at the other end of the pipe: the process must not
 * exit while a frame is still in flight, or the last answer is truncated and the client reads a
 * silence it cannot distinguish from a crash.
 */
export function serveStdio(context: McpContext): void {
  const server = createServer(context);
  let writing: Promise<void> = Promise.resolve();

  const out = (frame: ServerFrame): void => {
    const text = `${JSON.stringify(frame)}\n`;
    writing = writing.then(
      () =>
        new Promise<void>((settle) => {
          process.stdout.write(text, () => {
            settle();
          });
        }),
    );
  };

  let answering: Promise<void> = Promise.resolve();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  lines.on("line", (line) => {
    if (line.trim() === "") return;
    answering = answering.then(async () => {
      const frame = await server.handleLine(line);
      if (frame !== null) out(frame);
    });
  });

  lines.on("close", () => {
    void answering.then(async () => {
      await server.close();
      await writing;
      process.exit(0);
    });
  });
}

if (isEntryPoint()) {
  serveStdio(defaultContext());
}
