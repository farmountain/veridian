/**
 * The register of methods and error codes this server can answer.
 *
 * This is the authority on how each method is spelled, in the same role
 * `adapters/sim-data/protocol.ts` plays for its twelve broker APIs: one list, read by the
 * dispatcher and by the guards, so a method the loop implements and the register omits (or the
 * reverse) is impossible rather than merely unlikely.
 *
 * Two rules this file exists to hold:
 *
 * 1. **A method that does not exist and a request that is malformed are two different answers.**
 *    JSON-RPC already has a word for each - `-32601` and `-32600` - and this project's older rule
 *    says why it matters: a resource that is absent and a request that is refused are two different
 *    observations. The same applies one layer in to an unknown *tool name*, which is `-32602`
 *    because the method (`tools/call`) was served and its argument was what this build does not hold.
 *
 * 2. **The protocol revision is declared rather than negotiated.** The transport this server speaks
 *    has been revised several times, and a server that claims three revisions supports three. One is
 *    named below, `initialize` answers with it whatever the client asked for, and the client is free
 *    to disconnect - which is the behaviour the specification describes and the only claim this
 *    build can actually support.
 */

/** The one JSON-RPC version this server writes. There is no other. */
export const JSON_RPC_VERSION = "2.0";

/**
 * A request id. `null` is written when the request's own id could not be read, because a response
 * still has to name what it is answering and inventing an id would name a request nobody sent.
 */
export type JsonRpcId = string | number | null;

/** One frame as it arrived, before anything is believed about it. Every field is `unknown`. */
export interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

export interface JsonRpcErrorShape {
  readonly code: number;
  readonly message: string;
  /** Set where the answer is about a name this build does not hold - the name, not a paraphrase. */
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorShape;
}

/**
 * The five codes this server can produce, and no others.
 *
 * `-32603` is present because a handler may genuinely fail in a way nobody modelled, and a server
 * that answered such a failure with silence would be the "never throws" rule read as "never says
 * anything". A *tool* failure is not this code: it is a successful response whose result carries
 * `isError: true`, which is the shape the transport reserves for it.
 */
export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];

/** Every method this server implements, in the order the handshake reaches them. */
export const MCP_METHODS = [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
] as const;

export type McpMethod = (typeof MCP_METHODS)[number];

export function isMcpMethod(value: string): value is McpMethod {
  return (MCP_METHODS as readonly string[]).includes(value);
}

/**
 * The one notification, named separately because it is the only method answered with silence.
 *
 * A notification carries no id, so there is nothing to answer even in principle - but this one is
 * stated by name rather than inferred from the absence of an id, because "no id arrived" and "this
 * is the notification that closes the handshake" are two different facts and only the second is the
 * one the loop acts on.
 */
export const MCP_INITIALIZED_NOTIFICATION = "notifications/initialized";

/**
 * The protocol revision this build supports.
 *
 * Declared, not negotiated. A range would be a claim that every revision inside it behaves the same
 * way here, and nothing in this tree can check that - so one revision is named and `initialize`
 * answers with it.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** How `serverInfo` names this server. */
export const MCP_SERVER_NAME = "veridian";

/**
 * The implementation version reported in `serverInfo`.
 *
 * A **declared literal**, not the package manifest resolved at run time - and the reason is a defect
 * this repository has already paid for twice: `assetsRoot()` is one level up from the module, so from
 * the source tree it is the repository root while from `dist/` it is `dist/` - and `dist/` carries no
 * `package.json`, because the manifest travels beside it rather than inside it. A version that
 * resolves from the source tree and not from the installed package is the two-roots defect wearing a
 * new hat. A literal has no roots at all, so it cannot resolve differently depending on where it is
 * read from; the cost is that it must be kept in step by hand, which is why
 * `tests/version-reconciliation.test.ts` reads both manifests and this constant and fails naming each
 * figure rather than trusting this one.
 *
 * **This read `"unreleased"` until 0.6.0, and the word had outlived its fact by one release.** The
 * comment above it said *"This surface has never been released, and that is what it says about
 * itself"* - true when written, false the moment v0.5.0 shipped, whose own release notes open *"The
 * engine gains a fourth way in. A Model Context Protocol surface lands beside the CLI, the CI job and
 * the VS Code Cockpit."* Nothing read the value, so the string survived a release that falsified it.
 * It is the same class as the plan document that kept a `deferred` row for a surface that had
 * shipped one pass earlier, and it is the reason the guard below exists rather than a convention:
 * *a string that describes a state is a claim about that state, and a claim no program reads is a
 * claim that only has to look right.*
 */
export const MCP_SERVER_VERSION = "0.6.0";

/**
 * The shape every tool name has, and the reason it is stricter than the protocol requires.
 *
 * A tool name is echoed back in an error's `data` so a caller can tell which name was refused, and a
 * caller cannot tell that from a name carrying punctuation it did not type. The pattern also rules
 * out the hyphen, which is the spelling this project's validator names had to drop for the same
 * class of reason.
 */
export const MCP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A successful response. */
export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

/** A failed response. */
export function rpcFailure(id: JsonRpcId, code: JsonRpcErrorCode, message: string, data?: unknown): JsonRpcFailure {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** Whether a frame is a notification - the absence of an `id` member, not a null one. */
export function isNotification(frame: JsonRpcRequest): boolean {
  return !Object.hasOwn(frame, "id") || frame.id === undefined;
}

/**
 * The id a frame names, or `null` when it names none this server can echo.
 *
 * A number and a string are both legal JSON-RPC ids and both are echoed as written. `null` is
 * returned for `null`, for `undefined` and for an object - not because they are interchangeable but
 * because the only honest id to write back is one the caller sent.
 */
export function idOf(frame: JsonRpcRequest): JsonRpcId {
  const id = frame.id;
  if (typeof id === "string" || typeof id === "number") return id;
  return null;
}
