/**
 * The eight tools this surface exposes, and the Core capability each one projects.
 *
 * Two rules govern every entry here, and both come from the design this file was written against.
 *
 * 1. **Every capability already exists.** An MCP tool may not be the *first* implementation of
 *    anything. Each row below names the function that already does the work; the tool's handler
 *    calls it and renders its answer. A tool that decided something Core does not decide would make
 *    this surface a second, weaker Veridian - which is the thing the project's own doctrine forbids
 *    in as many words: *MCP is the door. Veridian is the building.*
 *
 * 2. **The register is exactly the tools `docs/PLAN.md` names.** Two sections of the plan list
 *    tools: the Level-3 diagram (six names) and the "Potential tools" list (eight names, `avf.`-
 *    prefixed). Between them they carry fourteen rows across **nine** spellings, because one
 *    capability is spelled twice - `get_result` in the first list and `get_validation_result` in the
 *    second. This register holds the *eight* that remain once that pair is collapsed, and
 *    `tests/mcp-demo.test.ts` parses the plan and pins this list to them - because a bare union is
 *    nine names and a set comparison made against the wrong side of a spelling collision passes for
 *    the wrong reason.
 *
 * Why `snapshot_environment` is one tool rather than two: `PLAN.md` gives `snapshot` and `restore`
 * one row, and `EnvironmentManager` holds them as `snapshot(): Promise<string>` and
 * `restore(snapshotId): Promise<void>`. Splitting them would make this register nine tools and
 * invent a name no section of the plan carries, so the one tool takes an optional `snapshotId` -
 * absent means *take one*, present means *restore that one* - and its answer states which it did.
 * That is the pair projected as Core holds it, rather than a new vocabulary laid over it.
 */

import { DEFAULT_STATE_DIR } from "../cli/arguments.ts";
import type { BrowserChoice } from "../cli/validate.ts";

/** One tool: what it is called, what it does, and what a caller may pass. */
export interface McpTool {
  readonly name: string;
  /** A short human label, for a client that renders one. */
  readonly title: string;
  /** What the tool does, in the words a caller needs - including what it does *not* do. */
  readonly description: string;
  /**
   * The Core capability this tool projects, as `file#member` where it can be spelled that way.
   *
   * Stated rather than implied so that the "every capability already exists" rule is readable at the
   * register rather than discoverable only in the handler.
   */
  readonly projects: string;
  /** JSON Schema for the arguments object, in the shape the transport expects. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------------------------
// Argument shapes, declared once
// ---------------------------------------------------------------------------------------------

/**
 * The arguments every tool that names a contract takes.
 *
 * Declared as builders rather than as four literals repeated eight times: the alternative is eight
 * descriptions of `goalPath` that agree today and are edited one at a time later. This is the same
 * argument the `STEP_KINDS` guard makes one layer down - a vocabulary the code owns and a document
 * re-states will fall behind the code.
 *
 * Each default below is read from its owner rather than restated, because a default written twice is
 * a pair that agrees until one of them moves. `DEFAULT_STATE_DIR` is the spelling `cli/arguments.ts`
 * uses while parsing, so a caller who omits `stateDir` here and a caller who omits `--state-dir`
 * there reach the same directory; and `BROWSER_CHOICES` is keyed by `BrowserChoice`, which is the
 * union `cli/arguments.ts` derives - so a fourth member of that union is a compile error here rather
 * than an enum that quietly offers three of four.
 */
function goalPathProperty(): Readonly<Record<string, unknown>> {
  return {
    type: "string",
    description:
      "Path to the goal document, and the contract beside it. Relative to the server's working directory, or absolute.",
  };
}

function stateDirProperty(): Readonly<Record<string, unknown>> {
  return {
    type: "string",
    default: DEFAULT_STATE_DIR,
    description:
      "The directory the run's state and evidence bundle live under, in the same spelling `--state-dir` takes.",
  };
}

/**
 * The browser choices, keyed by the union `cli/validate.ts` derives from the command line.
 *
 * A `Record<BrowserChoice, true>` rather than an array: an array of three strings agrees with a
 * four-member union for as long as nobody adds the fourth member, and nothing would fail when they
 * did. Keyed this way, `npx tsc --noEmit` is the guard - the same trick `LEVEL_ORDER` in
 * `cli/support.ts` uses to make a `LogLevel` a total map rather than a list.
 */
const BROWSER_CHOICES: Readonly<Record<BrowserChoice, true>> = {
  auto: true,
  playwright: true,
  none: true,
};

/**
 * The same choices as an ordered list, for the two readers that need one: the schema's `enum`, and
 * the dispatcher's membership test and its refusal message.
 *
 * Derived rather than written a second time. The assertion states what the record's own type already
 * means - every key of a `Record<BrowserChoice, true>` is a `BrowserChoice` - and it is needed
 * because `Object.keys` answers `string[]` for every record it is handed.
 */
export const BROWSER_CHOICE_NAMES: readonly BrowserChoice[] = Object.keys(
  BROWSER_CHOICES,
) as BrowserChoice[];

/**
 * The choice a caller gets by omitting `browser`, named once for the schema and for the dispatcher.
 *
 * Not `BROWSER_CHOICE_NAMES[0]`: the dispatcher reaches for this value on a path where the schema's
 * own `default` could not be read, so a fallback expressed as *the first element of a list* would be
 * a position standing in for a meaning.
 */
export const DEFAULT_BROWSER_CHOICE: BrowserChoice = "auto";

function browserProperty(): Readonly<Record<string, unknown>> {
  return {
    type: "string",
    enum: BROWSER_CHOICE_NAMES,
    default: DEFAULT_BROWSER_CHOICE,
    description:
      "Which browser the run may drive. `auto` asks the environment document; `none` makes every browser observation INCONCLUSIVE rather than passing it.",
  };
}

function headedProperty(): Readonly<Record<string, unknown>> {
  return {
    type: "boolean",
    default: false,
    description: "Run the browser with a window. Ignored when no browser is used.",
  };
}

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "create_environment",
    title: "Create the environment a contract names",
    description:
      "DEFINE the goal and build the world the contract names, then prepare it. Core's lifecycle creates and starts a world in one public step (`EnvironmentManager#prepare`), so this tool and `start_environment` reach the same step and differ in what they report: this one names the world, `start_environment` reads its readiness. A contract naming an adapter this build does not register is refused, with the registered worlds named.",
    projects: "cli/validate.ts#buildEnvironment + core/environment/manager.ts#prepare",
    inputSchema: {
      type: "object",
      properties: {
        goalPath: goalPathProperty(),
        stateDir: stateDirProperty(),
        browser: browserProperty(),
        headed: headedProperty(),
      },
      required: ["goalPath"],
      additionalProperties: false,
    },
  },
  {
    name: "start_environment",
    title: "Report the readiness of the prepared world",
    description:
      "Answer with the manager's state, its identity, the transitions it has made and the boundary report it measured. If this process holds no prepared world it builds and prepares one first, and says so in the answer rather than silently doing work the caller did not ask for.",
    projects: "core/environment/manager.ts#prepare + #awaitHealth",
    inputSchema: {
      type: "object",
      properties: {
        goalPath: goalPathProperty(),
        stateDir: stateDirProperty(),
        browser: browserProperty(),
        headed: headedProperty(),
      },
      required: ["goalPath"],
      additionalProperties: false,
    },
  },
  {
    name: "run_validation",
    title: "Run the validation loop over a contract",
    description:
      "DEFINE, build a world of its own, run the validation loop over it and write the evidence bundle. Repairs nothing on its own: `noRepair` defaults to true, so the application is observed exactly once and a failing criterion is reported rather than repaired. Pass `repair` with a command to let the loop run it between iterations.",
    projects: "cli/validate.ts#runValidation",
    inputSchema: {
      type: "object",
      properties: {
        goalPath: goalPathProperty(),
        stateDir: stateDirProperty(),
        browser: browserProperty(),
        headed: headedProperty(),
        repair: {
          type: "array",
          items: { type: "string" },
          description:
            "A repair command and its arguments, run between iterations. Omitted means the loop observes once and reports.",
        },
        noRepair: {
          type: "boolean",
          default: true,
          description:
            "Observe the application exactly once, attempting no iteration. Defaults to true here, because an MCP caller has no terminal for the manual gate to wait on.",
        },
      },
      required: ["goalPath"],
      additionalProperties: false,
    },
  },
  {
    name: "get_result",
    title: "Read the run's result",
    description:
      "Read the reading the loop writes on every terminal path. A workspace with no run is an error naming the command that produces one, not an empty result - `{}` reads as 'a run that passed nothing' rather than 'no run'.",
    projects: ".veridian/latest-result.json, written by core/evidence/writer.ts#writeResult",
    inputSchema: {
      type: "object",
      properties: { stateDir: stateDirProperty() },
      additionalProperties: false,
    },
  },
  {
    name: "get_failure",
    title: "Read what failed, and who tried to repair it",
    description:
      "Read the failure report and every repair transcript the run left, in one answer. This is the only tool that reads two files, deliberately: the report says what was observed and the transcript says what the repair actor did about it, and two calls to learn one thing would be this surface inventing a protocol Core does not have. Nothing in the verdict reads the transcript.",
    projects: ".veridian/latest-failure.md beside <stateDir>/runs/<run>/artifacts/repair-<n>.log",
    inputSchema: {
      type: "object",
      properties: { stateDir: stateDirProperty() },
      additionalProperties: false,
    },
  },
  {
    name: "get_evidence",
    title: "Read the bundle's artifact ledger",
    description:
      "Read the artifact ledger the bundle records for its newest run: every artifact's path, kind, owning criterion and byte count, beside the required evidence that is missing and whether the bundle is complete. The ledger is last-write-wins per path, so a screenshot observed four times is one row.",
    projects: "Core/evidence#WrittenResult.artifacts, as result.json records it",
    inputSchema: {
      type: "object",
      properties: { stateDir: stateDirProperty() },
      additionalProperties: false,
    },
  },
  {
    name: "reset_environment",
    title: "Reset the prepared world",
    description:
      "Reset the world so the next observation cannot inherit contaminated state. Reset is first-class in this product rather than test cleanup, and the answer states what the reset did. If this process holds no prepared world it builds and prepares one first, and says so.",
    projects: "core/environment/manager.ts#reset",
    inputSchema: {
      type: "object",
      properties: {
        goalPath: goalPathProperty(),
        stateDir: stateDirProperty(),
        browser: browserProperty(),
        headed: headedProperty(),
      },
      required: ["goalPath"],
      additionalProperties: false,
    },
  },
  {
    name: "snapshot_environment",
    title: "Take or restore a snapshot",
    description:
      "With `snapshotId` absent, take a snapshot of the prepared world and answer its id. With `snapshotId` present, restore that snapshot. The answer states which of the two it did, because the same tool name reaching two different operations must not leave the caller to infer which happened.",
    projects: "core/environment/manager.ts#snapshot / #restore",
    inputSchema: {
      type: "object",
      properties: {
        goalPath: goalPathProperty(),
        stateDir: stateDirProperty(),
        browser: browserProperty(),
        headed: headedProperty(),
        snapshotId: {
          type: "string",
          description:
            "The snapshot to restore. Omitted means take one instead; the id a snapshot is given is chosen by the world and returned.",
        },
      },
      required: ["goalPath"],
      additionalProperties: false,
    },
  },
];

/** Every registered tool name, derived from the register rather than listed a second time. */
export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map((tool) => tool.name);

/** The tool registered under a name, or `null`. Callers report the absence; nothing guesses. */
export function findTool(name: string): McpTool | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}
