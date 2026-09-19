/**
 * The suite over the MCP surface: the transcript loop and the eight-tool register.
 *
 * `McpContext#build` and `#run` are injectable for exactly this reason - the loop and the register
 * can be driven without opening a session, loading a schema set or reaching for a memory substrate -
 * and their defaults in `defaultContext` are the real functions, so a production call cannot
 * accidentally get a double. The world below is therefore the one thing this suite fakes on purpose.
 * What a fake cannot prove is that the *program* works, so `scripts/mcp-smoke.mjs` spawns the real
 * server as a child and drives it over a real pipe; this file is the half that can be a `node --test`
 * file and that one is the half that cannot.
 *
 * Every message asserted here was read out of `mcp/server.ts` rather than recalled, and where a
 * vocabulary has an owner (`BROWSER_CHOICE_NAMES`, `MCP_TOOL_NAMES`, `bundleLayout`) the expectation
 * is built from that owner rather than restated - a list of names in a test is a claim about two
 * files that nothing reconciles unless the test reads both.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ambiguity,
  type Ambiguity,
  type ClarificationReport,
} from "../core/clarification/index.ts";
import type { IncompleteDefinition, ResolvedDefinition } from "../core/definition.ts";
import { bundleLayout } from "../core/evidence/index.ts";
import { memoryIo, type IoPort } from "../core/io.ts";
import type { BuiltWorld, EnvironmentOutcome, EnvironmentRequest, RunRequest } from "../cli/validate.ts";
import { silentLogger } from "../tests/helpers/clock.ts";
import {
  BROWSER_CHOICE_NAMES,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
} from "./tools.ts";
import {
  JSON_RPC_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  type JsonRpcFailure,
} from "./protocol.ts";
import { createServer, type McpContext, type McpServer, type ServerFrame } from "./server.ts";

// ------------------------------------------------------------------------------------------------
// Frame readers
//
// `ServerFrame` is a union of a result and an error, so each reader asserts which one it was given
// and then answers the part it asked for. A helper that cast without asserting would turn every
// "this frame carried an error" into an `undefined` somewhere further down.
//
// `handle` answers `null` for a frame the protocol says needs no reply, so every reader takes that
// null as well and names it - `"error" in null` would throw a `TypeError` naming no cause at all.
// ------------------------------------------------------------------------------------------------

function answered(frame: ServerFrame | null): ServerFrame {
  assert.ok(frame !== null, "the server answered nothing, so there is no frame to read");
  return frame;
}

function failed(frame: ServerFrame | null): JsonRpcFailure {
  const answer = answered(frame);
  assert.ok("error" in answer, "expected a JSON-RPC failure");
  return answer;
}

function succeeded(frame: ServerFrame | null): Readonly<Record<string, unknown>> {
  const answer = answered(frame);
  assert.ok("result" in answer, `expected a JSON-RPC result, got ${JSON.stringify(answer)}`);
  const result = answer.result;
  assert.ok(typeof result === "object" && result !== null, "a result must be an object");
  return result as Readonly<Record<string, unknown>>;
}

function structuredOf(frame: ServerFrame | null): Readonly<Record<string, unknown>> {
  const result = succeeded(frame);
  const structured = result["structuredContent"];
  assert.ok(
    typeof structured === "object" && structured !== null,
    "an answer carrying structured content must publish it",
  );
  return structured as Readonly<Record<string, unknown>>;
}

function textOf(frame: ServerFrame | null): string {
  const result = succeeded(frame);
  const content = result["content"];
  assert.ok(Array.isArray(content), "an answer must carry content");
  const first = content[0];
  assert.ok(typeof first === "object" && first !== null, "content must hold blocks");
  const text = (first as Readonly<Record<string, unknown>>)["text"];
  assert.equal(typeof text, "string", "a content block in this surface is text");
  return text as string;
}

function isErrorOf(frame: ServerFrame | null): boolean {
  return succeeded(frame)["isError"] === true;
}

/** The reason a refusal states, which is the first line of its text and one field of its content. */
function reasonOf(frame: ServerFrame | null): string {
  const refused = structuredOf(frame)["refused"];
  assert.ok(
    typeof refused === "object" && refused !== null,
    "a refusal carries its reason and its detail in structured content",
  );
  const reason = (refused as Readonly<Record<string, unknown>>)["reason"];
  assert.equal(typeof reason, "string");
  return reason as string;
}

function detailOf(frame: ServerFrame | null): string {
  const refused = structuredOf(frame)["refused"] as Readonly<Record<string, unknown>>;
  return refused["detail"] as string;
}

// ------------------------------------------------------------------------------------------------
// The world
//
// `BuiltWorld` carries a manager whose lifecycle is a real `EnvironmentManager`'s, and the surface
// reaches six members of it. Those six are what is faked; everything else is cast away, because a
// suite that had to construct a real `Goal`, `ValidationPlan` and `EnvironmentPlan` to ask whether
// `snapshot_environment` takes a snapshot would be testing the loader instead of the door.
// ------------------------------------------------------------------------------------------------

interface FakeManager {
  readonly state: string;
  readonly id: string | null;
  readonly transitions: readonly { readonly from: string; readonly to: string }[];
  prepare(environment: unknown): Promise<unknown>;
  reset(): Promise<unknown>;
  snapshot(): Promise<string>;
  restore(snapshotId: string): Promise<void>;
  teardown(): Promise<void>;
  boundaries(): readonly unknown[];
}

interface FakeWorld {
  readonly world: BuiltWorld;
  readonly manager: FakeManager;
}

interface FakeWorldOptions {
  /** Every lifecycle call this world received, by name. Shared with the recorder so order is visible. */
  readonly log: readonly string[];
  /** `prepare` answers this instead of succeeding. */
  readonly prepareFailure?: { readonly kind: string; readonly message: string };
  /** `reset` answers this instead of succeeding. */
  readonly resetFailure?: { readonly kind: string; readonly message: string };
  readonly adapter?: string;
  readonly resetStrategy?: string;
}

/**
 * A world whose lifecycle is recorded rather than performed.
 *
 * `state` moves the way a real manager's does - `ready` after a successful `prepare`, `reset` for
 * the duration of a `reset` - because two handlers report it and a fake that always answered
 * `ready` would make their answers indistinguishable.
 */
function fakeWorld(options: FakeWorldOptions): FakeWorld {
  const log = options.log as string[];
  let state = "created";
  const transitions: { from: string; to: string }[] = [];

  const manager: FakeManager = {
    get state() {
      return state;
    },
    get id() {
      return "env-1";
    },
    get transitions() {
      return transitions;
    },
    prepare: async () => {
      log.push("prepare");
      if (options.prepareFailure !== undefined) {
        state = "error";
        return {
          ok: false,
          failure: options.prepareFailure,
          state,
          transitions: [{ from: "created", to: "error" }],
        };
      }
      state = "ready";
      transitions.push({ from: "created", to: "ready" });
      return { ok: true, id: "env-1", state, transitions: [...transitions] };
    },
    reset: async () => {
      log.push("reset");
      if (options.resetFailure !== undefined) {
        state = "error";
        return {
          ok: false,
          failure: options.resetFailure,
          state,
          transitions: [...transitions],
        };
      }
      transitions.push({ from: "resetting", to: "ready" });
      state = "ready";
      return { ok: true, id: "env-1", state, transitions: [...transitions] };
    },
    snapshot: async () => {
      log.push("snapshot");
      return "snap-1";
    },
    restore: async (snapshotId: string) => {
      log.push(`restore:${snapshotId}`);
      state = "ready";
    },
    teardown: async () => {
      log.push("teardown");
      state = "destroyed";
    },
    boundaries: () => [],
  };

  const world = {
    manager,
    plan: {},
    environment: {
      adapter: options.adapter ?? "local-process",
      reset: { strategy: options.resetStrategy ?? "rebuild" },
    },
    goal: {},
    browser: null,
    browserLabel: "none",
  } as unknown as BuiltWorld;

  return { world, manager };
}

// ------------------------------------------------------------------------------------------------
// The context
// ------------------------------------------------------------------------------------------------

interface Recorder {
  readonly context: McpContext;
  readonly io: IoPort;
  readonly log: string[];
  readonly builds: EnvironmentRequest[];
  readonly runs: RunRequest[];
  /** The world most recently handed back by `build`. */
  current(): FakeWorld;
}

interface RecorderOptions {
  readonly build?: (request: EnvironmentRequest, fallback: () => EnvironmentOutcome) => Promise<EnvironmentOutcome>;
  readonly run?: (request: RunRequest, fallback: () => Promise<never>) => Promise<never>;
}

function recorder(options: RecorderOptions = {}): Recorder {
  const io = memoryIo();
  const log: string[] = [];
  const builds: EnvironmentRequest[] = [];
  const runs: RunRequest[] = [];
  let held: FakeWorld | undefined;

  const context: McpContext = {
    io,
    logger: silentLogger,
    sessionOptions: { memoryUrl: null, noMemory: true, noSelfPrompt: true },
    build: async (request) => {
      builds.push(request);
      const fallback = (): EnvironmentOutcome => {
        held = fakeWorld({ log });
        return {
          kind: "built",
          definition: {} as unknown as ResolvedDefinition,
          world: held.world,
        };
      };
      return options.build === undefined ? fallback() : await options.build(request, fallback);
    },
    run: async (request) => {
      runs.push(request);
      if (options.run !== undefined) {
        return await options.run(request, () => {
          throw new Error("this recorder has no default run outcome");
        });
      }
      throw new Error("this recorder has no run outcome; the run_validation tests supply one");
    },
  };

  return {
    context,
    io,
    log,
    builds,
    runs,
    current: () => {
      assert.ok(held !== undefined, "no world has been built yet");
      return held;
    },
  };
}

function serverFor(recorder: Recorder): McpServer {
  return createServer(recorder.context);
}

/** A `tools/call` frame, which is what every tool test below sends. */
function toolCall(id: number, name: string, args: unknown): Record<string, unknown> {
  return args === undefined
    ? { jsonrpc: "2.0", id, method: "tools/call", params: { name } }
    : { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/**
 * A world-taking tool's smallest valid call.
 *
 * `stateDir` is supplied rather than left to its schema default in most tests, because a test that
 * reads `.veridian` while another test writes it would be a test of the developer's checkout.
 */
function worldCall(name: string, stateDir = "state"): Record<string, unknown> {
  return { goalPath: "goal.yaml", stateDir };
}

/** A clarification report for a definition that was fabricated rather than resolved. */
function noReport(): ClarificationReport {
  return {
    records: [],
    questionsAsked: 0,
    rounds: 0,
    selfPromptRounds: 0,
    elapsedMs: 0,
    budgetExhausted: false,
    unresolvedBlocking: 0,
    // Spelled out rather than built from `RUNGS`, because `Record<Rung, number>` is exhaustive: a
    // rung added to the ladder fails to compile here and names this file, where a loop over the
    // register would silently grow a key nothing asserts.
    byVia: {
      derived: 0,
      inferred: 0,
      defaulted: 0,
      self_prompted: 0,
      answered: 0,
      deferred: 0,
    },
  };
}

/**
 * A contract the ladder could not close, fabricated rather than derived.
 *
 * `mcp/server.ts` reads only `reason`, `unresolved` and `deferred` out of it, but each gap is an
 * `Ambiguity` - six mandatory fields, of which the reading quotes two - so the gaps are built
 * through `ambiguity()` rather than hand-written, which is the construction helper the ladder
 * itself supports. Every question here is the same one a missing element target asks.
 */
function waitingOn(gaps: {
  readonly unresolved: readonly string[];
  readonly deferred: readonly string[];
}): IncompleteDefinition {
  const at = (path: string, blocking: boolean): Ambiguity =>
    ambiguity({
      origin: "acceptance",
      path,
      kind: "ambiguous_reference",
      question: "which element?",
      blocking,
    });

  return {
    kind: "incomplete",
    reason: `${String(gaps.unresolved.length + gaps.deferred.length)} gaps remain`,
    unresolved: gaps.unresolved.map((path) => at(path, true)),
    deferred: gaps.deferred.map((path) => at(path, false)),
    reports: { goal: noReport(), acceptance: noReport(), environment: noReport() },
  };
}

// ------------------------------------------------------------------------------------------------
// The loop
// ------------------------------------------------------------------------------------------------

describe("the MCP transcript loop", () => {
  it("declares a protocol version, its own name and the tools capability on initialize", async () => {
    const server = serverFor(recorder());
    const result = succeeded(await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" }));

    assert.equal(result["protocolVersion"], MCP_PROTOCOL_VERSION);
    const serverInfo = result["serverInfo"] as Readonly<Record<string, unknown>>;
    assert.equal(serverInfo["name"], MCP_SERVER_NAME);
    assert.equal(typeof serverInfo["version"], "string");
    const capabilities = result["capabilities"] as Readonly<Record<string, unknown>>;
    const tools = capabilities["tools"] as Readonly<Record<string, unknown>>;
    assert.equal(tools["listChanged"], false, "this register is fixed at build time");
    assert.equal(typeof result["instructions"], "string");
  });

  it("answers ping with an empty result", async () => {
    const server = serverFor(recorder());
    const result = succeeded(await server.handle({ jsonrpc: "2.0", id: 2, method: "ping" }));
    assert.deepEqual(result, {});
  });

  it("answers a notification with silence, because a notification has no id to answer to", async () => {
    const server = serverFor(recorder());
    assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(await server.handle({ jsonrpc: "2.0", method: "ping" }), null);
  });

  it("answers an unknown method with -32601 naming it, because the method did not exist", async () => {
    const server = serverFor(recorder());
    const frame = failed(await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/nope" }));

    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.methodNotFound);
    assert.equal(frame.error.message, "unknown method: tools/nope");
    assert.deepEqual(frame.error.data, { method: "tools/nope" });
  });

  it("keeps an unknown method and an unknown tool on two different codes", async () => {
    const server = serverFor(recorder());
    const unknownMethod = failed(await server.handle({ jsonrpc: "2.0", id: 4, method: "tools/nope" }));
    const unknownTool = failed(await server.handle(toolCall(5, "nope", {})));

    assert.equal(unknownMethod.error.code, JSON_RPC_ERROR_CODES.methodNotFound);
    assert.equal(unknownTool.error.code, JSON_RPC_ERROR_CODES.invalidParams);
    assert.notEqual(
      JSON_RPC_ERROR_CODES.methodNotFound,
      JSON_RPC_ERROR_CODES.invalidParams,
      "a method that does not exist and an argument this build does not hold are two answers",
    );
  });

  it("answers a frame that is not an object with -32600", async () => {
    const server = serverFor(recorder());
    for (const frame of [null, 42, "initialize", [1, 2]]) {
      const answer = failed(await server.handle(frame));
      assert.equal(answer.error.code, JSON_RPC_ERROR_CODES.invalidRequest);
      assert.equal(answer.error.message, "a JSON-RPC frame must be an object");
    }
  });

  it("answers a frame whose jsonrpc is not 2.0 with -32600", async () => {
    const server = serverFor(recorder());
    const answer = failed(await server.handle({ jsonrpc: "1.0", id: 6, method: "ping" }));
    assert.equal(answer.error.code, JSON_RPC_ERROR_CODES.invalidRequest);
    assert.equal(answer.error.message, '"jsonrpc" must be "2.0"');
  });

  it("answers a frame whose method is not a string with -32600", async () => {
    const server = serverFor(recorder());
    for (const method of [undefined, 7, null, { name: "ping" }]) {
      const answer = failed(await server.handle({ jsonrpc: "2.0", id: 7, method }));
      assert.equal(answer.error.code, JSON_RPC_ERROR_CODES.invalidRequest);
      assert.equal(answer.error.message, '"method" must be a string');
    }
  });

  it("answers an unparseable line with -32700 and a null id, because there is no id to echo", async () => {
    const server = serverFor(recorder());
    const frame = failed(await server.handleLine("{not json"));

    assert.equal(frame.id, null);
    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.parseError);
    assert.match(frame.error.message, /^frame is not JSON: /);
    assert.deepEqual(frame.error.data, { frame: "{not json" });
  });

  it("truncates the frame it quotes back, so a bad frame cannot become the answer", async () => {
    const server = serverFor(recorder());
    const long = "x".repeat(400);
    const frame = failed(await server.handleLine(long));
    const data = frame.error.data as Readonly<Record<string, unknown>>;
    const quoted = data["frame"] as string;

    assert.equal(quoted.length, 203);
    assert.equal(quoted.slice(0, 200), "x".repeat(200));
    assert.equal(quoted.slice(-3), "...");
  });

  it("routes a parseable line through the same dispatcher as a frame", async () => {
    const server = serverFor(recorder());
    const viaLine = succeeded(await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" })));
    assert.deepEqual(viaLine, {});
  });

  it("never throws, whatever it is handed", async () => {
    const server = serverFor(recorder());
    for (const frame of [undefined, null, 0, "", [], {}, { jsonrpc: "2.0" }]) {
      const answer = await server.handle(frame);
      assert.ok(answer !== null, `${JSON.stringify(frame) ?? "undefined"} must be answered`);
    }
    assert.ok((await server.handleLine("")) !== null);
  });
});

// ------------------------------------------------------------------------------------------------
// The register
// ------------------------------------------------------------------------------------------------

describe("the MCP tool register", () => {
  it("publishes exactly the names the register holds, in register order", async () => {
    const server = serverFor(recorder());
    const result = succeeded(await server.handle({ jsonrpc: "2.0", id: 10, method: "tools/list" }));
    const tools = result["tools"];
    assert.ok(Array.isArray(tools));

    const names = tools.map((tool) => (tool as Readonly<Record<string, unknown>>)["name"]);
    assert.deepEqual(names, [...MCP_TOOL_NAMES]);
  });

  it("publishes the Core capability each tool projects, so 'it already exists' is readable", async () => {
    const server = serverFor(recorder());
    const result = succeeded(await server.handle({ jsonrpc: "2.0", id: 11, method: "tools/list" }));
    const tools = result["tools"] as readonly Readonly<Record<string, unknown>>[];

    for (const tool of tools) {
      assert.equal(typeof tool["title"], "string", `${String(tool["name"])} needs a title`);
      assert.equal(typeof tool["description"], "string", `${String(tool["name"])} needs a description`);
      const projects = tool["projects"];
      assert.equal(typeof projects, "string", `${String(tool["name"])} must name the capability it projects`);
      assert.notEqual(projects, "", `${String(tool["name"])} projects an empty capability name`);
      assert.equal(typeof tool["inputSchema"], "object");
    }
  });

  it("spells every tool name the way the protocol pattern allows", () => {
    for (const name of MCP_TOOL_NAMES) {
      assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is not a tool name the surface may publish`);
    }
    assert.equal(new Set(MCP_TOOL_NAMES).size, MCP_TOOL_NAMES.length, "a duplicate name would shadow a tool");
    assert.equal(MCP_TOOLS.length, MCP_TOOL_NAMES.length);
  });

  it("declares requiredness where the tool declares it, and nowhere else", () => {
    for (const tool of MCP_TOOLS) {
      const schema = tool.inputSchema as Readonly<Record<string, unknown>>;
      assert.equal(schema["type"], "object");
      assert.equal(schema["additionalProperties"], false, `${tool.name} would accept an argument it ignores`);
      const required = schema["required"];
      if (required === undefined) continue;
      assert.ok(Array.isArray(required));
      const properties = schema["properties"] as Readonly<Record<string, unknown>>;
      for (const name of required) {
        assert.ok(
          Object.hasOwn(properties, name as string),
          `${tool.name} requires "${String(name)}", which its own schema does not describe`,
        );
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
// tools/call dispatch
// ------------------------------------------------------------------------------------------------

describe("the tools/call dispatcher", () => {
  it("refuses a call that names no tool with -32602 and the register in data", async () => {
    const server = serverFor(recorder());
    const frame = failed(await server.handle({ jsonrpc: "2.0", id: 20, method: "tools/call", params: {} }));

    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.invalidParams);
    assert.equal(frame.error.message, 'tools/call requires a string "name"');
    assert.deepEqual(frame.error.data, { tools: [...MCP_TOOL_NAMES] });
  });

  it("refuses a tool it does not register with -32602 naming it and the register", async () => {
    const server = serverFor(recorder());
    const frame = failed(await server.handle(toolCall(21, "delete_universe", {})));

    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.invalidParams);
    assert.equal(frame.error.message, 'no tool is registered under "delete_universe"');
    assert.deepEqual(frame.error.data, {
      name: "delete_universe",
      tools: [...MCP_TOOL_NAMES],
    });
  });

  it("refuses arguments that could not address anything, stating every problem at once", async () => {
    const server = serverFor(recorder());
    const frame = failed(await server.handle(toolCall(22, "create_environment", { headed: "yes" })));

    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.invalidParams);
    assert.equal(frame.error.message, 'arguments for "create_environment" could not address anything');
    const data = frame.error.data as Readonly<Record<string, unknown>>;
    assert.deepEqual(data["problems"], ['"goalPath" is required', '"headed" must be a boolean']);
  });

  it("tells a wrong type apart from an absent field", async () => {
    const server = serverFor(recorder());
    const wrongType = failed(await server.handle(toolCall(23, "create_environment", { goalPath: 42 })));
    const absent = failed(await server.handle(toolCall(24, "create_environment", {})));
    const empty = failed(await server.handle(toolCall(25, "create_environment", { goalPath: "  " })));

    assert.deepEqual((wrongType.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" must be a string',
    ]);
    assert.deepEqual((absent.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" is required',
    ]);
    assert.deepEqual((empty.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" must not be empty',
    ]);
  });

  it("refuses a browser that is not one of the choices the register publishes", async () => {
    const server = serverFor(recorder());
    const frame = failed(
      await server.handle(toolCall(26, "create_environment", { ...worldCall("create_environment"), browser: "lynx" })),
    );
    const problems = (frame.error.data as Readonly<Record<string, unknown>>)["problems"] as readonly string[];

    assert.deepEqual(problems, [`"browser" must be one of ${BROWSER_CHOICE_NAMES.join(", ")}`]);
    assert.ok(BROWSER_CHOICE_NAMES.includes("auto"), "the default must be a choice the register offers");
  });

  it("tells the three ways a list of strings can be wrong apart", async () => {
    const server = serverFor(recorder());
    const notAnArray = failed(await server.handle(toolCall(27, "run_validation", { repair: "npm test" })));
    const notStrings = failed(await server.handle(toolCall(28, "run_validation", { repair: ["npm test", " "] })));
    const empty = failed(await server.handle(toolCall(29, "run_validation", { repair: [] })));

    assert.deepEqual((notAnArray.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" is required',
      '"repair" must be an array of strings',
    ]);
    assert.deepEqual((notStrings.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" is required',
      '"repair" must contain only non-empty strings',
    ]);
    assert.deepEqual((empty.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"goalPath" is required',
      '"repair" must not be empty when present',
    ]);
  });

  it("does not reach a handler whose arguments could not be read", async () => {
    const empty = recorder();
    const server = serverFor(empty);
    await server.handle(toolCall(30, "create_environment", {}));

    assert.deepEqual(empty.builds, [], "a call that could not address a world must not build one");
    assert.equal(empty.log.length, 0);
  });
});

// ------------------------------------------------------------------------------------------------
// The held world
// ------------------------------------------------------------------------------------------------

describe("the held world", () => {
  it("holds nothing until a tool asks for one, and holds it afterwards", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    assert.equal(server.holding, false);

    await server.handle(toolCall(40, "create_environment", worldCall("create_environment")));
    assert.equal(server.holding, true);

    await server.close();
    assert.equal(server.holding, false);
  });

  it("builds a world once and reuses it for the same request", async () => {
    const rec = recorder();
    const server = serverFor(rec);

    const first = await server.handle(toolCall(41, "create_environment", worldCall("create_environment")));
    const second = await server.handle(toolCall(42, "create_environment", worldCall("create_environment")));

    assert.equal(isErrorOf(first), false);
    assert.equal(isErrorOf(second), false);
    assert.equal(structuredOf(first)["prepared"], "built");
    assert.equal(structuredOf(second)["prepared"], "reused");
    assert.equal(rec.builds.length, 1, "the second call must not build a second world");
    assert.deepEqual(rec.log, ["prepare"], "a reused world is not prepared again");
    await server.close();
  });

  it("names the adapter, the browser and the transition chain in a prepared world", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const frame = await server.handle(toolCall(43, "create_environment", worldCall("create_environment")));
    const structured = structuredOf(frame);

    assert.equal(structured["adapter"], "local-process");
    assert.equal(structured["state"], "ready");
    assert.equal(structured["browser"], "none");
    assert.deepEqual(structured["transitions"], [{ from: "created", to: "ready" }]);
    await server.close();
  });

  it("never holds a world across a changed request", async () => {
    const rec = recorder();
    const server = serverFor(rec);

    await server.handle(toolCall(44, "create_environment", { goalPath: "goal.yaml", stateDir: "state-a" }));
    await server.handle(toolCall(45, "create_environment", { goalPath: "goal.yaml", stateDir: "state-b" }));

    assert.deepEqual(rec.log, ["prepare", "teardown", "prepare"]);
    assert.equal(rec.builds.length, 2);
    await server.close();
  });

  it("tears the world down twice from two calls to close, and never once from a third", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    await server.handle(toolCall(46, "create_environment", worldCall("create_environment")));

    await server.close();
    await server.close();

    assert.deepEqual(rec.log, ["prepare", "teardown"], "close is idempotent, so a second call is nothing");
  });

  it("tears nothing down when close is called on a server that holds nothing", async () => {
    const rec = recorder();
    await serverFor(rec).close();
    assert.deepEqual(rec.log, []);
  });

  it("answers an unusable definition with the refusal the environment loader built", async () => {
    const rec = recorder({
      build: async () => ({
        kind: "unusable",
        definition: {} as unknown as ResolvedDefinition,
        refusal: { title: "this definition cannot be run", body: "browser: none is not a browser" },
      }),
    });
    const server = serverFor(rec);
    const frame = await server.handle(toolCall(47, "create_environment", worldCall("create_environment")));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), "this definition cannot be run");
    assert.equal(detailOf(frame), "browser: none is not a browser");
    assert.equal(server.holding, false);
  });

  it("answers a contract that is not resolved yet with the gaps it is waiting on", async () => {
    const rec = recorder({
      build: async () => ({
        kind: "incomplete",
        definition: waitingOn({
          unresolved: ["/criteria/0/target"],
          deferred: ["/criteria/1/target"],
        }),
      }),
    });
    const server = serverFor(rec);
    const frame = await server.handle(toolCall(48, "create_environment", worldCall("create_environment")));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), "A contract that cannot be run yet: 2 gaps remain");
    assert.match(detailOf(frame), /Unresolved:\n {2}\/criteria\/0\/target - which element\?/);
    assert.match(detailOf(frame), /Deferred:\n {2}\/criteria\/1\/target - which element\?/);
    assert.match(detailOf(frame), /veridian validate --goal <goal\.yaml>/);
  });

  it("tears a world down when preparation fails, rather than reporting a world nobody can close", async () => {
    const rec = recorder({
      build: async (_request, fallback) => {
        const outcome = fallback();
        if (outcome.kind !== "built") throw new Error("unreachable");
        const built = fakeWorld({
          log: rec?.log ?? [],
        });
        void built;
        return outcome;
      },
    });
    // The prepare failure is injected through the world the recorder builds, so the world it built
    // has to be rebuilt with one - which is what `build` above is handed the chance to do.
    void rec;

    const failing = recorder();
    const server = createServer({
      ...failing.context,
      build: async () => {
        const world = fakeWorld({
          log: failing.log,
          prepareFailure: { kind: "ENVIRONMENT_FAILURE", message: "the port never opened" },
        });
        return { kind: "built", definition: {} as unknown as ResolvedDefinition, world: world.world };
      },
    });

    const frame = await server.handle(toolCall(49, "create_environment", worldCall("create_environment")));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), "ENVIRONMENT_FAILURE: the port never opened");
    assert.match(detailOf(frame), /The application did not become valid, so no criterion was observed\./);
    assert.match(detailOf(frame), /adapter: local-process/);
    assert.match(detailOf(frame), /state: error/);
    assert.deepEqual(failing.log, ["prepare", "teardown"], "an orphan outliving its run is the one thing to refuse");
    assert.equal(server.holding, false);
  });
});

// ------------------------------------------------------------------------------------------------
// Reading what a run left
//
// These are the refusals §4.3 of the plan names by name: no run to read, stated rather than answered
// with an empty object.
// ------------------------------------------------------------------------------------------------

describe("reading a run that is not there", () => {
  it("refuses get_result with a stated reason naming the command that writes a run", async () => {
    const server = serverFor(recorder());
    const frame = await server.handle(toolCall(60, "get_result", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), 'There is no run to read in "state".');
    assert.equal(
      detailOf(frame),
      "Run one with: veridian validate --goal <goal.yaml> --state-dir state\n" +
        "or call the run_validation tool, which writes the same bundle.",
    );
    assert.notEqual(
      textOf(frame),
      "{}\n{}\n{}\n",
      "an empty object reads as a run that passed nothing rather than as no run at all",
    );
  });

  it("states the same absence for get_failure, rather than an empty failure", async () => {
    const server = serverFor(recorder());
    const frame = await server.handle(toolCall(61, "get_failure", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), 'There is no run to read in "state".');
  });

  it("states the same absence for get_evidence, rather than an empty ledger", async () => {
    const server = serverFor(recorder());
    const frame = await server.handle(toolCall(62, "get_evidence", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), 'There is no run to read in "state".');
  });

  it("tells a file that cannot be read apart from a run that is not there", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const layout = bundleLayout("state", "");
    await rec.io.writeTextFile(layout.latestResult, "{not json");

    const frame = await server.handle(toolCall(63, "get_result", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), `${layout.latestResult} exists but could not be read as a result.`);
    assert.match(detailOf(frame), /^reason: not JSON: /);
  });

  it("tells a document that is not an object apart from one that is not JSON", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const layout = bundleLayout("state", "");
    await rec.io.writeTextFile(layout.latestResult, "[]");

    const frame = await server.handle(toolCall(64, "get_result", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), `${layout.latestResult} exists but could not be read as a result.`);
    assert.equal(detailOf(frame), "reason: not a JSON object");
  });

  it("reads a run that is there, describing its verdict and its state", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const layout = bundleLayout("state", "");
    await rec.io.writeTextFile(
      layout.latestResult,
      JSON.stringify({
        run_id: "run-1",
        verdict: "FAIL",
        state: "FAILED",
        iteration: 3,
        failure: { kind: "TEST_FAILURE", criterion_id: "AC-002", message: "the badge is missing" },
        reasons: ["a criterion failed"],
      }),
    );

    const frame = await server.handle(toolCall(65, "get_result", { stateDir: "state" }));
    const result = succeeded(frame);

    assert.equal(result["isError"], false);
    assert.equal(textOf(frame).split("\n")[0], "run run-1: FAIL (FAILED, 3 iteration(s))");
    assert.match(textOf(frame), /failure: TEST_FAILURE \[AC-002\] - the badge is missing/);
    assert.match(textOf(frame), /reasons:\n {2}- a criterion failed/);
  });

  it("reports a run that recorded no failure as one with nothing to explain", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const layout = bundleLayout("state", "");
    await rec.io.writeTextFile(
      layout.latestResult,
      JSON.stringify({ run_id: "run-2", verdict: "PASS", state: "COMPLETED", iteration: 1 }),
    );

    const frame = await server.handle(toolCall(66, "get_failure", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), false);
    assert.equal(
      textOf(frame).split("\n")[1],
      "The newest run (run-2) recorded no failure, so there is nothing to explain.",
    );
    assert.equal(structuredOf(frame)["failure"], null);
  });

  it("says so when a run has no name, rather than printing an empty pair of brackets", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const layout = bundleLayout("state", "");
    await rec.io.writeTextFile(layout.latestResult, JSON.stringify({ verdict: "PASS" }));

    const frame = await server.handle(toolCall(67, "get_failure", { stateDir: "state" }));

    assert.equal(isErrorOf(frame), false);
    assert.match(textOf(frame), /The newest run \(unnamed\) recorded no failure/);
  });
});

// ------------------------------------------------------------------------------------------------
// Acting on a held world
// ------------------------------------------------------------------------------------------------

describe("acting on the held world", () => {
  it("resets the world and reports the transitions the reset recorded", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const frame = await server.handle(toolCall(70, "reset_environment", worldCall("reset_environment")));
    const structured = structuredOf(frame);

    assert.equal(isErrorOf(frame), false);
    assert.equal(structured["state"], "ready");
    assert.equal(structured["strategy"], "rebuild");
    assert.deepEqual(structured["transitions"], [
      { from: "created", to: "ready" },
      { from: "resetting", to: "ready" },
    ]);
    assert.match(textOf(frame), /world reset: state ready, 2 transition\(s\) recorded/);
    assert.match(textOf(frame), /Reset is first-class here rather than test cleanup/);
    await server.close();
  });

  it("refuses a reset that did not bring the world back, stating the state it is in", async () => {
    const rec = recorder();
    const server = createServer({
      ...rec.context,
      build: async () => {
        const world = fakeWorld({
          log: rec.log,
          resetFailure: { kind: "RESET_FAILURE", message: "the snapshot is gone" },
        });
        return { kind: "built", definition: {} as unknown as ResolvedDefinition, world: world.world };
      },
    });
    const frame = await server.handle(toolCall(71, "reset_environment", worldCall("reset_environment")));

    assert.equal(isErrorOf(frame), true);
    assert.equal(reasonOf(frame), "RESET_FAILURE: the snapshot is gone");
    assert.match(detailOf(frame), /The world did not come back to a valid state/);
    assert.match(detailOf(frame), /state: error/);
  });

  it("takes a snapshot when no snapshotId is given", async () => {
    // This is the regression the argument reader once made impossible: reading an optional field
    // with the required reader pushed `"snapshotId" is required`, set `args.failed`, and returned
    // before the branch below could be reached - so the tool could never do the half of its own
    // description that has no id in it.
    const rec = recorder();
    const server = serverFor(rec);
    const frame = await server.handle(toolCall(72, "snapshot_environment", worldCall("snapshot_environment")));

    assert.equal(isErrorOf(frame), false);
    assert.equal(structuredOf(frame)["did"], "took");
    assert.equal(structuredOf(frame)["snapshotId"], "snap-1");
    assert.equal(textOf(frame), 'snapshot taken: snap-1\nPass it back as "snapshotId" to restore it.');
    assert.deepEqual(rec.log, ["prepare", "snapshot"]);
    await server.close();
  });

  it("restores a snapshot when one is named", async () => {
    const rec = recorder();
    const server = serverFor(rec);
    const frame = await server.handle(
      toolCall(73, "snapshot_environment", { ...worldCall("snapshot_environment"), snapshotId: "snap-9" }),
    );

    assert.equal(isErrorOf(frame), false);
    assert.equal(structuredOf(frame)["did"], "restored");
    assert.equal(textOf(frame), "restored snapshot snap-9: state ready");
    assert.deepEqual(rec.log, ["prepare", "restore:snap-9"]);
    await server.close();
  });

  it("still refuses an explicitly empty snapshotId, because absent and blank are two answers", async () => {
    const server = serverFor(recorder());
    const frame = failed(
      await server.handle(
        toolCall(74, "snapshot_environment", { ...worldCall("snapshot_environment"), snapshotId: "" }),
      ),
    );

    assert.equal(frame.error.code, JSON_RPC_ERROR_CODES.invalidParams);
    assert.deepEqual((frame.error.data as Readonly<Record<string, unknown>>)["problems"], [
      '"snapshotId" must not be empty',
    ]);
  });
});
