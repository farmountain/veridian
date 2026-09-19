/**
 * The two claims `mcp/tools.ts` and `mcp/server.ts` make about themselves, held as executable rules.
 *
 * `mcp/tools.ts`'s header says this register "is exactly the tools `docs/PLAN.md` names" and that
 * "`tests/mcp-demo.test.ts` parses the plan and pins this list to them". `mcp/server.ts`'s header
 * says the surface is a door and never a second Veridian, which is only true while `core/` has never
 * heard of it. Both sentences name this file, so this file is where they stop being sentences.
 *
 * Three rules, each one a way the surface could ship broken:
 *
 * 1. **The plan's two tool lists agree with the register.** The plan lists tools twice, in two
 *    different shapes, and spells one capability twice - `get_result` as a branch leaf in the
 *    Level-3 diagram, `get_validation_result` in the `avf.`-prefixed "Potential tools" list. A bare
 *    union is therefore nine spellings across fourteen rows, and a set comparison made against the
 *    wrong side of that collision passes for the wrong reason. The collapse is a named alias here
 *    rather than something a reader is expected to notice.
 *
 * 2. **`core/` does not know this surface exists.** That rule is what keeps MCP an interface to
 *    Veridian rather than a second Veridian, and the only way to hold it is to read every file in
 *    the layer that must not have heard of it.
 *
 * 3. **Every name the register publishes obeys the pattern the protocol declares.** The pattern is
 *    imported rather than restated - `mcp/server.test.ts` already carries one literal copy of it,
 *    and a second copy is a second thing to keep in step.
 *
 * What this file cannot hold is whether the program runs. `scripts/mcp-smoke.mjs` spawns the real
 * server as a child and drives it over a real pipe, because that is the half a `node --test` file
 * cannot be.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeIo } from "../core/io.ts";
import { MCP_TOOL_NAME_PATTERN } from "../mcp/protocol.ts";
import { MCP_TOOL_NAMES } from "../mcp/tools.ts";

const repo = nodeIo();
const plan = (await repo.readTextFile("docs/PLAN.md")) ?? "";

/** Every fenced block in a document, as its delimiter line numbers, paired by a toggle. */
function fencedBlocks(lines: readonly string[]): readonly (readonly [number, number])[] {
  const blocks: [number, number][] = [];
  let open = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*```/.test(lines[index] ?? "")) continue;
    if (open < 0) open = index;
    else {
      blocks.push([open, index]);
      open = -1;
    }
  }
  return blocks;
}

/**
 * The body of the fenced block a marker belongs to, or nothing when the marker or its fence has
 * moved.
 *
 * Located by the marker's *content* rather than by a line number, because `docs/PLAN.md` carries a
 * second hierarchy diagram - `AVF Core` branching to `VS Code`, `CLI` and `MCP` - and a reader that
 * said "find the first fence mentioning MCP" would grab that one instead. This reader takes the
 * marker as an argument, so it cannot grab a block nobody asked for.
 *
 * The two blocks this file cares about sit in two different relations to their markers, which is
 * the whole reason this reader has two cases rather than one. The `AVF MCP` diagram *contains* its
 * marker, as the root of a tree. The `Potential tools:` list is *introduced* by its marker, on the
 * line above. A reader that only handled the second case would return whatever fence happened to
 * follow the diagram - a block holding neither the marker nor a tool name - and the assertion that
 * the block carries its own marker is what would catch it.
 */
function fenceFor(lines: readonly string[], marker: string): readonly string[] {
  const markerAt = lines.findIndex((line) => line.trim() === marker);
  if (markerAt < 0) return [];
  const blocks = fencedBlocks(lines);
  const found =
    blocks.find(([start, end]) => markerAt > start && markerAt < end) ??
    blocks.find(([start]) => start > markerAt);
  if (found === undefined) return [];
  return lines.slice(found[0] + 1, found[1]).map((line) => line.trim());
}

/**
 * The Level-3 diagram draws each tool as a box-drawing leaf, so a name is what follows the branch.
 * An anchored one-name-per-line reader matches none of these six and reports an empty list - a
 * claim about the reader rather than about the plan. The box-drawing range is written as escapes so
 * this file's own source stays ASCII.
 */
function diagramToolNames(body: readonly string[]): readonly string[] {
  const names: string[] = [];
  for (const line of body) {
    const match = /^[\u2500-\u257F\s]*([a-z][a-z0-9_]*)$/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/** The "Potential tools" list names one tool per line, each behind the same prefix. */
function prefixedToolNames(body: readonly string[], prefix: string): readonly string[] {
  const names: string[] = [];
  for (const line of body) {
    if (!line.startsWith(prefix)) continue;
    const name = line.slice(prefix.length);
    if (/^[a-z][a-z0-9_]*$/.test(name)) names.push(name);
  }
  return names;
}

/**
 * One capability, two spellings. The register fixes `get_result` - the diagram's - so the
 * "Potential tools" spelling is folded onto it, and only here, so the collision stays visible.
 */
const PLAN_ALIASES: Readonly<Record<string, string>> = { get_validation_result: "get_result" };

function plannedToolNames(): readonly string[] {
  const lines = plan.split(/\r?\n/);
  const diagram = diagramToolNames(fenceFor(lines, "AVF MCP"));
  const potential = prefixedToolNames(fenceFor(lines, "Potential tools:"), "avf.");
  const collapsed = new Set<string>();
  for (const name of [...diagram, ...potential]) collapsed.add(PLAN_ALIASES[name] ?? name);
  return [...collapsed].sort();
}

describe("the MCP tool register against the plan's own tool lists", () => {
  it("finds both lists, each in its own shape, so the comparisons below are not vacuous", () => {
    assert.ok(plan.length > 0, "docs/PLAN.md could not be read");
    const lines = plan.split(/\r?\n/);
    const diagram = fenceFor(lines, "AVF MCP");
    const potential = fenceFor(lines, "Potential tools:");
    assert.ok(diagram.length >= 6, `the fence below "AVF MCP" holds ${String(diagram.length)} line(s)`);
    assert.ok(potential.length >= 8, `the fence below "Potential tools:" holds ${String(potential.length)} line(s)`);
    assert.equal(diagramToolNames(diagram).length, 6, `the Level-3 diagram names ${String(diagramToolNames(diagram).length)} tool(s): ${diagramToolNames(diagram).join(", ")}`);
    assert.equal(prefixedToolNames(potential, "avf.").length, 8, `the "Potential tools" list names ${String(prefixedToolNames(potential, "avf.").length)} tool(s): ${prefixedToolNames(potential, "avf.").join(", ")}`);
  });

  it("reads the Level-3 diagram and not the architecture diagram above the tool list", () => {
    const lines = plan.split(/\r?\n/);
    const diagram = fenceFor(lines, "AVF MCP");
    assert.ok(diagram.some((line) => line === "AVF MCP"), `the block the "AVF MCP" marker belongs to does not carry the marker line: ${diagram.join(" | ")}`);
    assert.ok(!diagram.some((line) => line.includes("VS Code")), `the block the "AVF MCP" marker belongs to is a hierarchy diagram, not the tool list: ${diagram.join(" | ")}`);
    const potential = fenceFor(lines, "Potential tools:");
    assert.ok(potential.every((line) => /^avf\.[a-z][a-z0-9_]*$/.test(line)), `the block the "Potential tools:" marker introduces holds a line that is not a prefixed tool name: ${potential.join(" | ")}`);
  });

  it("registers the eight tools the plan's fourteen rows collapse to", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8, `the register holds ${String(MCP_TOOL_NAMES.length)} tool(s): ${MCP_TOOL_NAMES.join(", ")}`);
  });

  it("holds exactly the tools the plan names, once the one capability spelled twice is collapsed", () => {
    assert.deepEqual(plannedToolNames(), [...MCP_TOOL_NAMES].sort());
  });

  it("names a tool the register omits, and names a register entry the plan does not", () => {
    const planned = new Set(plannedToolNames());
    const registered = new Set<string>(MCP_TOOL_NAMES);
    assert.deepEqual([...registered].filter((name) => !planned.has(name)), [], "these tools are registered and the plan never names them");
    assert.deepEqual([...planned].filter((name) => !registered.has(name)), [], "the plan names these tools and the register holds none of them");
  });

  it("keeps the one capability the plan spells twice collapsed to the spelling the register uses", () => {
    const kinds = Object.keys(PLAN_ALIASES);
    assert.deepEqual(kinds, ["get_validation_result"], "the alias table no longer describes the collision it was written for");
    assert.ok((MCP_TOOL_NAMES as readonly string[]).includes(PLAN_ALIASES["get_validation_result"] ?? ""), "the alias points at a name the register does not publish");
    assert.ok(!(MCP_TOOL_NAMES as readonly string[]).includes(kinds[0] ?? ""), `the register publishes the spelling the alias exists to collapse: ${String(kinds[0])}`);
  });
});

const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every `.ts` file under a directory, as a sorted path relative to it. */
function sourceFiles(directory: string, relative = ""): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(directory, next));
    else if (entry.name.endsWith(".ts")) found.push(next);
  }
  return found.sort();
}

const CORE_FILES = sourceFiles(join(SOURCE_ROOT, "core"));

describe("the door rule, read off the tree rather than asserted about it", () => {
  it("walks the core layer, so the check below cannot pass by finding nothing", () => {
    assert.ok(CORE_FILES.length >= 60, `the core layer holds ${String(CORE_FILES.length)} TypeScript file(s)`);
    assert.ok(CORE_FILES.includes("io.ts"), `expected io.ts among the core layer's files: ${CORE_FILES.join(", ")}`);
  });

  it("keeps core/ unaware of the surface, which is what makes MCP a door onto Veridian", () => {
    const offenders: string[] = [];
    for (const file of CORE_FILES) {
      const lines = readFileSync(join(SOURCE_ROOT, "core", file), "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/\bmcp\b/i.test(line)) offenders.push(`core/${file}:${String(index + 1)}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, [], `the core layer must not know this surface exists: ${offenders.join(" ; ")}`);
  });
});

describe("the names the register publishes", () => {
  it("obeys the surface naming rule the protocol declares", () => {
    for (const name of MCP_TOOL_NAMES) {
      assert.ok(MCP_TOOL_NAME_PATTERN.test(name), `"${name}" does not match the name pattern mcp/protocol.ts declares`);
    }
  });

  it("is a rule that rejects the spellings the plan's lists and this family do not use", () => {
    assert.ok(!MCP_TOOL_NAME_PATTERN.test("avf.get_result"), "a prefixed name must not pass the surface naming rule");
    assert.ok(!MCP_TOOL_NAME_PATTERN.test("get-result"), "a hyphenated name must not pass the surface naming rule");
    assert.ok(!MCP_TOOL_NAME_PATTERN.test("Get_result"), "a capitalised name must not pass the surface naming rule");
  });
});
