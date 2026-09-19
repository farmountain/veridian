/**
 * The fourth artifact check, and the only one that can prove the MCP surface *runs*.
 *
 * `mcp/server.test.ts` holds the surface's decisions against an injected context, which is the half
 * a `node --test` file can be. What a fake cannot prove is that the *program* works: that the entry
 * point starts when it is spawned, that frames travel over a real pipe, that a refusal comes back
 * shaped the way a client reads it, and that the process leaves cleanly when its input closes. So
 * this script spawns `mcp/server.ts` as a real child and drives it with real frames - the same shape
 * `scripts/smoke-dist.mjs` uses one runtime out, because the shipped artifact is the one no test in
 * `tests/` can reach.
 *
 * It is a `.mjs` rather than a test for the reason `smoke-dist.mjs`, `acceptance.mjs` and
 * `e2e-install.mjs` are: it drives a program through a child process, so it has to be runnable
 * whatever state the tree's types are in. It imports the protocol and tool vocabularies from the
 * source `.ts` files rather than restating them, so a name or a version cannot be recalled wrongly
 * here - and `MCP_SERVER_VERSION` is deliberately *not* the manifest's version, so the assertion
 * below does not expect one.
 *
 * Six checks, each one a way the surface could be wrong while its unit suite stayed green:
 *
 *   1. `initialize` answers with a protocol revision this server supports, and names itself.
 *   2. `tools/list` returns exactly the tools the register holds.
 *   3. `tools/call` for `get_result` against a populated history returns a parsed reading.
 *   4. The same call against a history with no run refuses, and says *why*, and names the directory.
 *   5. An unknown method is `-32601`; an unknown tool name is `-32602`. Two different answers,
 *      because a request that does not exist and a request that is malformed are two different
 *      problems - the distinction a substitute control plane once paid for by merging 404 and 405.
 *   6. The process exits 0 when its input closes, so a caller can tell a finished session from a
 *      hung one.
 *
 * A smoke test that cannot fail is a formality, so each of these was falsified rather than trusted -
 * with one correction that only the measurement could have produced. Check 6's falsification as
 * `docs/ISOLATION-AND-MCP-PLAN.md` §4.7 first worded it - "remove the close handler" - is a probe
 * that does not fire: deleting `lines.on("close", ...)` from `mcp/server.ts` leaves the answer
 * arriving (6 of 6 spawns) and the process exiting 0, because Node keeps the loop alive for a pending
 * pipe write and nothing in that state had set an exit code. What check 6 actually holds is
 * *termination in the presence of a handle that outlives the request*, and the probe that fires is to
 * replace the handler's own `process.exit(0)` with a `setInterval` - measured,
 * `smoke: FAIL the process exits 0 when its input closes - the server had not left after 10000 ms`,
 * exit 1. The unit suite is green under both probes, which is the reason this script exists rather
 * than a second `node --test` file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME } from "../mcp/protocol.ts";
import { MCP_TOOL_NAMES } from "../mcp/tools.ts";

const EXCHANGE_TIMEOUT_MS = 20000;
const EXIT_TIMEOUT_MS = 10000;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverPath = join(repoRoot, "mcp", "server.ts");

const failures = [];
function check(description, condition, detail) {
  if (condition) {
    console.log(`smoke: ok   ${description}`);
    return;
  }
  console.log(`smoke: FAIL ${description}${detail === undefined ? "" : ` - ${detail}`}`);
  failures.push(description);
}

/** The entry point is asserted before the spawn, so a missing file names the path rather than an exit code. */
if (!existsSync(serverPath)) {
  console.error(`smoke: FAIL the server entry point is not there: ${serverPath}`);
  console.error("smoke: 1 check(s) failed");
  process.exit(1);
}

/** A directory the operating system makes, spelled with forward slashes so a refusal can quote it. */
function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix)).replace(/\\/g, "/");
}

const emptyDir = tempDir("veridian-mcp-empty-");
const populatedDir = tempDir("veridian-mcp-run-");

const child = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let complaints = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  complaints += chunk;
});

/**
 * Responses arrive in the order the requests were made, because the server chains its handlers -
 * so a queue of waiters is the whole reader this needs. Blank lines are skipped: the transport is
 * newline-delimited JSON with no `Content-Length` header, and a trailing newline is not a frame.
 */
const waiting = [];
let buffered = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  for (;;) {
    const at = buffered.indexOf("\n");
    if (at < 0) break;
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    if (line.trim() === "") continue;
    const settle = waiting.shift();
    if (settle === undefined) continue;
    try {
      settle({ frame: JSON.parse(line), problem: null });
    } catch (error) {
      settle({ frame: null, problem: `the frame was not JSON: ${String(error)}` });
    }
  }
});
child.stdout.on("close", () => {
  while (waiting.length > 0) {
    const settle = waiting.shift();
    settle?.({ frame: null, problem: "the server closed its output before answering" });
  }
});

function nextFrame() {
  return new Promise((settle) => {
    waiting.push(settle);
  });
}

function bounded(promise, milliseconds, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, milliseconds);
    void promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

let sequence = 0;
async function send(method, params) {
  sequence += 1;
  const request = { jsonrpc: "2.0", id: sequence, method };
  if (params !== undefined) request.params = params;
  child.stdin.write(`${JSON.stringify(request)}\n`);
  return await bounded(nextFrame(), EXCHANGE_TIMEOUT_MS, {
    frame: null,
    problem: `the server did not answer ${method} within ${String(EXCHANGE_TIMEOUT_MS)} ms`,
  });
}

try {
  writeFileSync(
    join(populatedDir, "latest-result.json"),
    JSON.stringify({ run_id: "run-1", verdict: "PASS", state: "COMPLETED", iteration: 1, reasons: [] }),
    "utf8",
  );

  // 1. The handshake.
  const initialized = await send("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "veridian-mcp-smoke", version: "0" },
  });
  const handshake = initialized.frame?.result;
  check(
    "initialize answers with a protocol revision this server supports",
    handshake?.protocolVersion === MCP_PROTOCOL_VERSION,
    initialized.problem ?? `got ${JSON.stringify(handshake?.protocolVersion)}`,
  );
  check(
    "initialize names the server",
    handshake?.serverInfo?.name === MCP_SERVER_NAME,
    initialized.problem ?? `got ${JSON.stringify(handshake?.serverInfo)}`,
  );

  // 2. The register, as a client sees it.
  const listed = await send("tools/list", {});
  const names = (listed.frame?.result?.tools ?? []).map((tool) => tool.name).sort();
  const expected = [...MCP_TOOL_NAMES].sort();
  check(
    "tools/list returns exactly the tools the register holds",
    listed.problem === null && names.join(",") === expected.join(","),
    listed.problem ?? `expected ${expected.join(", ")} and got ${names.join(", ")}`,
  );

  // 3. A reading of a run that exists.
  const read = await send("tools/call", { name: "get_result", arguments: { stateDir: populatedDir } });
  const reading = read.frame?.result?.structuredContent;
  const text = read.frame?.result?.content?.[0]?.text ?? "";
  check(
    "tools/call for get_result reads a populated history",
    read.problem === null && read.frame?.result?.isError === false && reading?.verdict === "PASS" && text.includes("run-1"),
    read.problem ?? `isError=${JSON.stringify(read.frame?.result?.isError)} verdict=${JSON.stringify(reading?.verdict)} text=${JSON.stringify(text)}`,
  );

  // 4. A reading of a run that does not exist: a refusal, and a reason that names the directory.
  const empty = await send("tools/call", { name: "get_result", arguments: { stateDir: emptyDir } });
  const refusalReason = empty.frame?.result?.structuredContent?.refused?.reason;
  check(
    "tools/call refuses a history with no run, naming the directory it looked in",
    empty.problem === null &&
      empty.frame?.result?.isError === true &&
      refusalReason === `There is no run to read in "${emptyDir}".`,
    empty.problem ?? `isError=${JSON.stringify(empty.frame?.result?.isError)} reason=${JSON.stringify(refusalReason)}`,
  );

  // 5. Two different problems, two different answers.
  const unknownMethod = await send("tools/does-not-exist", {});
  check(
    "an unknown method is -32601",
    unknownMethod.frame?.error?.code === -32601,
    unknownMethod.problem ?? `got ${JSON.stringify(unknownMethod.frame?.error)}`,
  );
  const unknownTool = await send("tools/call", { name: "no_such_tool", arguments: { stateDir: emptyDir } });
  check(
    "an unknown tool name is -32602",
    unknownTool.frame?.error?.code === -32602,
    unknownTool.problem ?? `got ${JSON.stringify(unknownTool.frame?.error)}`,
  );

  // 6. A finished session, so a caller can tell it from a hung one.
  child.stdin.end();
  const exited = await bounded(
    new Promise((settle) => {
      child.once("exit", (code) => {
        settle(code);
      });
    }),
    EXIT_TIMEOUT_MS,
    null,
  );
  check(
    "the process exits 0 when its input closes",
    exited === 0,
    exited === null ? `the server had not left after ${String(EXIT_TIMEOUT_MS)} ms` : `exit code ${String(exited)}`,
  );
  if (exited === null) child.kill();
} finally {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
  rmSync(emptyDir, { recursive: true, force: true });
  rmSync(populatedDir, { recursive: true, force: true });
}

if (complaints.trim() !== "") {
  console.log("smoke: the server wrote to stderr:");
  console.log(complaints.trimEnd());
}

if (failures.length > 0) {
  console.error(`smoke: ${String(failures.length)} check(s) failed`);
  process.exit(1);
}
console.log("smoke: all MCP surface checks passed");
