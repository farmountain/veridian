/**
 * Command-line parsing, as a pure function.
 *
 * Deliberately its own module with no side effects: `cli/veridian.ts` is a bin whose bottom line runs
 * `main()`, so anything living there is awkward to test. Argument handling is where the CLI's contract
 * is written down — which flags exist, which are mutually exclusive, what the defaults are — and a
 * contract that can only be exercised by spawning a process is a contract that gets checked by hand.
 *
 * Nothing here touches `process.env`, the filesystem, or the clock. It reads `argv` and returns a
 * value, so every rule below is a unit test rather than a shell script.
 */

import type { EnvironmentPlan } from "../core/environment/types.ts";
import type { LogLevel } from "./support.ts";

export type Command = "validate" | "clarify" | "init" | "metrics" | "help";

export interface CliArguments {
  readonly command: Command;
  /** Path to `goal.yaml`, relative to the process's working directory. */
  readonly goalPath: string;
  /** Where run bundles are written. `.veridian` unless overridden. */
  readonly stateDir: string;
  /**
   * `auto` follows the environment document's own browser policy. `none` overrides it off, which is
   * how a run that cannot install Playwright still produces a result — it will be a FAIL or an
   * INCONCLUSIVE with a recorded reason, and that is a truthful outcome, not a broken one.
   */
  readonly browser: "auto" | "playwright" | "none";
  /** The repair command and its arguments, when `--repair` was given. */
  readonly repair: readonly string[] | null;
  readonly noRepair: boolean;
  /** An explicit memory server URL. `null` means "fall back to the environment, then the default". */
  readonly memoryUrl: string | null;
  readonly noMemory: boolean;
  /** Set false to watch the run happen. */
  readonly headed: boolean;
  /** Allow `init` to overwrite an existing configuration. */
  readonly force: boolean;
  /**
   * Criteria a known defect was expected to break, from `--defects`.
   *
   * Ground truth for M2 (were the defects detected) and M3 (did a run pass while one was present).
   * Veridian cannot derive it: the bundle records what was observed, not what was intended, so a
   * metric that reported detection without it would be grading the runs against themselves.
   */
  readonly defects: readonly string[];
  readonly logLevel: LogLevel;
}

/** A caller error: the command line was wrong, and no run was attempted. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS: ReadonlySet<string> = new Set(["validate", "clarify", "init", "metrics", "help"]);
const BROWSER_CHOICES: ReadonlySet<string> = new Set(["auto", "playwright", "none"]);
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn"]);

/** Flags that carry a value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "goal",
  "state-dir",
  "browser",
  "memory",
  "defects",
  "log-level",
]);

/** Flags that are present or absent. */
const SWITCH_FLAGS: ReadonlySet<string> = new Set([
  "no-repair",
  "no-memory",
  "headed",
  "force",
  "verbose",
  "quiet",
  "help",
]);

export const DEFAULT_GOAL_PATH = "goal.yaml";
export const DEFAULT_STATE_DIR = ".veridian";
export const DEFAULT_MEMORY_URL = "http://127.0.0.1:3030";

export const USAGE = `veridian - the sandbox testing and validation layer for AI coding agents

Usage
  veridian validate [options]        Define a goal, then run it and validate the result.
  veridian clarify  [options]        Resolve the goal's ambiguities and print the transcript.
                                     Nothing is executed and no application is started.
  veridian init     [options]        Create the state directory and a starter configuration.
  veridian metrics  [options]        Report the success metrics (M1..M5) over the runs in the
                                     state directory. Reads bundles; runs nothing.
  veridian help                      Show this text.

Options
  --goal <path>        Goal document to run. Default: ${DEFAULT_GOAL_PATH}
  --state-dir <path>   Where run bundles are written. Default: ${DEFAULT_STATE_DIR}
  --repair <command> [args...]
                       Repair the application between failed iterations. Must be the last
                       option, because everything after it belongs to the command.
                       Environment: VERIDIAN_RESULT, VERIDIAN_FAILURE_REPORT, VERIDIAN_ITERATION.
  --no-repair          Observe the application exactly once. No iteration is attempted.
  --browser <choice>   auto | playwright | none. Default: auto (follow the environment document).
  --defects <ids>      metrics: comma-separated criteria a known defect was expected to break
                       (for example --defects AC-001,AC-003). Without it M2 and M3 report
                       INCONCLUSIVE rather than a comfortable PASS.
  --headed             Show the browser. Default is headless, because that is what a CI run has.
  --memory <url>       Memory server base URL. Default: $HIPCORTEX_URL, then ${DEFAULT_MEMORY_URL}
  --no-memory          Do not consult or write memory at all.
  --log-level <level>  debug | info | warn. Default: info
  --verbose            Same as --log-level debug.
  --quiet              Same as --log-level warn.
  --force              init: overwrite an existing configuration.
  -h, --help           Show this text.

Exit codes
  0  PASS - every mandatory criterion passed with its required evidence present.
  1  FAIL - at least one mandatory criterion failed.
  2  INCONCLUSIVE, or a definition that could not be resolved. Neither is success.
  3  The command line itself was unusable, or this build cannot run the requested goal.

  metrics exits 0 when the history is clean, 1 when a metric was violated, and 2 when there is no
  run to measure - an empty history is INCONCLUSIVE, not success.`;

/**
 * Parse `argv` (already stripped of `node` and the script path).
 *
 * Throws `UsageError` rather than exiting, so that the exit code and the message are decided by one
 * place — the bin — instead of being scattered across the parser.
 */
export function parseArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  let repair: readonly string[] | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--repair") {
      // Everything after `--repair` is the command. This is why the usage text says it must come
      // last: `--repair node repair.mjs --goal x` would hand `--goal x` to the repair process, and
      // the alternative — guessing where one command ends and the next option begins — would mean
      // splitting on a flag name that a repair script is perfectly entitled to use itself.
      const rest = argv.slice(index + 1);
      if (rest.length === 0) {
        throw new UsageError("--repair needs a command, for example: --repair node repair.mjs");
      }
      repair = rest;
      break;
    }

    if (token === "-h") {
      switches.add("help");
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      const name = equals === -1 ? body : body.slice(0, equals);
      const inline = equals === -1 ? null : body.slice(equals + 1);

      if (VALUE_FLAGS.has(name)) {
        const next = argv[index + 1];
        const value = inline ?? next;
        if (value === undefined || (inline === null && value.startsWith("--"))) {
          throw new UsageError(`--${name} needs a value`);
        }
        if (inline === null) index += 1;
        values.set(name, value);
        continue;
      }

      if (SWITCH_FLAGS.has(name)) {
        if (inline !== null) throw new UsageError(`--${name} does not take a value`);
        switches.add(name);
        continue;
      }

      throw new UsageError(`unknown option "--${name}"`);
    }

    if (token.startsWith("-") && token.length > 1) {
      throw new UsageError(`unknown option "${token}"`);
    }

    positionals.push(token);
  }

  const [explicit, ...extra] = positionals;
  const command = explicit ?? "help";
  if (!COMMANDS.has(command)) {
    throw new UsageError(
      `unknown command "${command}". Expected one of: validate, clarify, init, metrics, help.`,
    );
  }
  if (extra.length > 0) {
    throw new UsageError(
      `unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")}. ` +
        `Every input after the command is an option - did you mean --goal?`,
    );
  }

  const noRepair = switches.has("no-repair");
  if (noRepair && repair !== null) {
    throw new UsageError("--no-repair and --repair ask for opposite things; give one of them");
  }

  const browser = values.get("browser") ?? "auto";
  if (!BROWSER_CHOICES.has(browser)) {
    throw new UsageError(`--browser must be auto, playwright or none; received "${browser}"`);
  }

  const declaredLevel = values.get("log-level");
  if (declaredLevel !== undefined && !LOG_LEVELS.has(declaredLevel)) {
    throw new UsageError(
      `--log-level must be debug, info or warn; received "${declaredLevel}"`,
    );
  }
  const logLevel = (declaredLevel ??
    (switches.has("verbose") ? "debug" : switches.has("quiet") ? "warn" : "info")) as LogLevel;

  return {
    command: command as Command,
    goalPath: values.get("goal") ?? DEFAULT_GOAL_PATH,
    stateDir: values.get("state-dir") ?? DEFAULT_STATE_DIR,
    browser: browser as CliArguments["browser"],
    repair,
    noRepair,
    memoryUrl: values.get("memory") ?? null,
    noMemory: switches.has("no-memory"),
    headed: switches.has("headed"),
    force: switches.has("force"),
    defects: (values.get("defects") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    logLevel,
  };
}

/**
 * The environment a run will actually use, with `--browser` applied.
 *
 * `--browser` is a statement about *this* run's world, so it has to reach the plan the adapter is
 * built from, not merely decide whether a browser object is constructed. When it did not,
 * `--browser none` left the plan saying `browser.enabled: true` while the run drove no browser at
 * all - and the adapter, which can see only the plan, named the one cause it could not rule out:
 * "Playwright is not installed". Playwright was installed. The operator had turned the browser off
 * deliberately, and the run blamed a missing dependency for it, which sends the reader to install a
 * 150 MB browser to fix a flag.
 *
 * Two consequences, and the second is the one that matters. The message becomes true: a disabled
 * plan is now reported as `browser.enabled: false`, which is a fact about the plan. And the
 * *environment record* describes the world the run used rather than the document it was configured
 * with - the same rule as the artifact ledger and the live `envRecord()`, applied one layer out.
 *
 * `auto` keeps the document's own answer, because that is what `auto` means.
 */
export function applyBrowserChoice(
  environment: EnvironmentPlan,
  choice: CliArguments["browser"],
): EnvironmentPlan {
  const enabled =
    choice === "playwright" ? true : choice === "none" ? false : environment.browser.enabled;
  return environment.browser.enabled === enabled
    ? environment
    : { ...environment, browser: { ...environment.browser, enabled } };
}
