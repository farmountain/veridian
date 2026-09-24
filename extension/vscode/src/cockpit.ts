/**
 * The Cockpit: what each command does, written against `VscodePort`.
 *
 * There is no validation logic in this file, and that is a constraint rather than a coincidence.
 * `AGENTS.md`: *"Do not make VS Code the architecture."* *"VS Code != Veridian."* The Cockpit starts
 * processes, reads artifacts and renders what it found. It never decides whether anything works -
 * that decision belongs to the run, and the run writes it to a file.
 *
 * ## The distinction this file exists to get right
 *
 * A run that ends `FAIL` and a run that could not start are **different events**, and the CLI
 * already separates them with four exit codes (`cli/support.ts`): `0` PASS, `1` FAIL, `2`
 * INCONCLUSIVE, `3` the definition would not load. So a `FAIL` is *not* an error to be reported to
 * the operator as a malfunction - it is the run succeeding at finding a broken application, which
 * is the entire product. Only `3` - and a spawn that never happened - are conditions the operator
 * has to fix. Treating `1` as an error would train its reader to dismiss the one dialog this
 * extension most needs them to read, which is the same failure mode as a warning list nobody reads.
 */

import type { StatusBarItem, VscodePort } from "./port.ts";
import type { BrowserChoice, CliCommand, CliRoute, CliRunner, CliSettings } from "./cli.ts";
import { isAbsolutePath, planInvocation, resolveCli } from "./cli.ts";
import type { BundlePaths, RunSummary } from "./bundle.ts";
import { bundlePaths, describeVerdict, readLastSummary } from "./bundle.ts";
import type { TwinReading } from "./twin.ts";
import { renderTwin } from "./twin.ts";
import { join } from "node:path";

/**
 * The CLI's exit codes for a run, named. Values are `cli/support.ts`'s; the names are the meaning.
 *
 * These are `validate`'s codes. `metrics` reuses the same numbers for different things, which is
 * why it has a table of its own - see `exitMeaning`.
 */
export const EXIT_MEANING: Readonly<Record<number, string>> = {
  0: "PASS - every mandatory criterion passed",
  1: "FAIL - the application did not meet the contract",
  2: "INCONCLUSIVE - nothing could decide it; this is not a pass",
  3: "the definition could not be loaded, so no run happened",
};

/**
 * The same numbers, as `metrics` means them.
 *
 * `metrics` measures the bundles already on disk; it starts no world and judges no application, so
 * none of the four sentences above is true of it. Read through the run's table, its `1` - a violated
 * metric - arrived as the dialog *"FAIL - the application did not meet the contract"* for a command
 * that never looked at an application, and its `2` - an empty history - as *"nothing could decide
 * it"* about a command that decided precisely that there was nothing to decide. The wording below is
 * the CLI's own (`cli/veridian.ts`'s `runMetrics`), because the sentence an operator reads should be
 * the sentence the program printed.
 *
 * `3` is the top-level catch, so for this subcommand it means the command never ran - not that a
 * definition would not load, which no definition was asked for.
 */
export const EXIT_MEANING_METRICS: Readonly<Record<number, string>> = {
  0: "a clean history - nothing was violated",
  1: "at least one metric was violated, so the history is not clean",
  2: "INCONCLUSIVE - there is no run bundle to measure; this is not a pass",
  3: "the command could not run, so nothing was measured",
};

/**
 * What an exit code means **for this subcommand**.
 *
 * One number, two meanings, and the table is chosen by the command that produced the number rather
 * than by the number alone. A single table would be a claim that every subcommand's `1` is the same
 * event, which is false the day a second non-run subcommand exists.
 */
export function exitMeaning(command: CliCommand, code: number): string {
  const table = command === "metrics" ? EXIT_MEANING_METRICS : EXIT_MEANING;
  return table[code] ?? `unrecognised exit code ${String(code)}`;
}

/** Everything the Cockpit needs from outside itself, so the activation path is testable. */
export interface CockpitDeps {
  readonly port: VscodePort;
  readonly runner: CliRunner;
  /** Injected so `resolveCli` needs no filesystem: the resolution order is tested, not the disks. */
  readonly exists: (path: string) => boolean;
  /** Injected so the summary path is tested without writing a bundle. */
  readonly summarise: (paths: BundlePaths) => Promise<RunSummary | null>;
  /**
   * Injected for the same reason as `summarise`, and because the twin surface reads *every* bundle
   * rather than the last one - so a test of the panel that hit the real disk would depend on how
   * many runs happen to be on the machine running it.
   */
  readonly twin: (paths: BundlePaths) => Promise<TwinReading>;
}

/** What a Cockpit provides to whoever activated it. */
export interface Cockpit {
  /** Registers every command and returns the handles, in the order they were registered. */
  registerAll(): readonly { readonly id: string }[];
  /** Reads the last run and updates the dashboard. Called at activation and after each run. */
  refresh(): Promise<void>;
  /** The commands, so a test can assert the roster without re-listing it. */
  readonly commands: readonly CliCommand[];
}

/** The command ids, in the order they appear in the palette. One list; `registerAll` reads it. */
const COMMAND_IDS: readonly string[] = [
  "veridian.init",
  "veridian.clarify",
  "veridian.validate",
  "veridian.metrics",
  "veridian.showResult",
  "veridian.showTwin",
  "veridian.openFailure",
];

export function commandIds(): readonly string[] {
  return COMMAND_IDS;
}

// ---------------------------------------------------------------------------------------------
// Settings, narrowed from `unknown`
// ---------------------------------------------------------------------------------------------

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asBrowser(value: unknown): BrowserChoice {
  return value === "playwright" || value === "none" ? value : "auto";
}

/**
 * Read the four settings.
 *
 * Every one of them is a string a human typed into `settings.json`, so none is trusted: a
 * `veridian.browser` of `"Playwright"` would otherwise be passed to the CLI and rejected as a bad
 * flag, producing an error about Veridian for a typo in a setting. An unrecognised value falls back
 * to the documented default and the fallback is *visible* - the CLI prints the effective plan.
 */
export function readSettings(port: VscodePort): CliSettings {
  return {
    cliPath: asText(port.setting("veridian.cli")),
    goal: asText(port.setting("veridian.goal")),
    stateDir: asText(port.setting("veridian.stateDir")) ?? ".veridian",
    browser: asBrowser(port.setting("veridian.browser")),
  };
}

// ---------------------------------------------------------------------------------------------
// Locating the goal
// ---------------------------------------------------------------------------------------------

/** A file the Cockpit will treat as a goal when it is the active one. */
const GOAL_NAMES: readonly string[] = ["goal.yaml", "goal.yml"];

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Which goal document the commands run against, or `null`.
 *
 * Three sources, in the order an operator would expect: the setting, then the file they are looking
 * at, then the conventional name in the workspace root. The middle one requires the active file to
 * be *named* like a goal rather than merely to be open, because every document in a Veridian
 * workspace is YAML and guessing would run a contract the operator never pointed at.
 */
export function locateGoal(
  port: VscodePort,
  root: string,
  configured: string | null,
  existing: (path: string) => boolean,
): string | null {
  if (configured !== null) {
    return isAbsolutePath(configured) ? configured : join(root, configured);
  }

  const active = port.activeFilePath();
  if (active !== null && GOAL_NAMES.includes(baseName(active))) return active;

  for (const name of GOAL_NAMES) {
    const candidate = join(root, name);
    if (existing(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The Cockpit
// ---------------------------------------------------------------------------------------------

/** The state directory the run bundle will live in, resolved against the workspace root once. */
function stateDirOf(root: string, stateDir: string): string {
  return isAbsolutePath(stateDir) ? stateDir : join(root, stateDir);
}

/**
 * Make the state directory absolute before it is handed to anyone.
 *
 * `.veridian` happens to mean the right thing because the child process is spawned with the
 * workspace root as its `cwd` - two facts that agree today. Resolving it once, here, means the CLI
 * and the extension's own read cannot disagree even if one of those facts changes: an absolute path
 * means the same thing to both of them regardless of where either was started. That is the same
 * reasoning `commandArguments` follows when it passes `--state-dir` unconditionally rather than only
 * when it differs from the CLI's default, and the two together are what the dashboard test asserts.
 */
function resolveStateDir(settings: CliSettings, root: string): CliSettings {
  return { ...settings, stateDir: stateDirOf(root, settings.stateDir) };
}

export function createCockpit(deps: CockpitDeps): Cockpit {
  const { port } = deps;
  const output = port.createOutputChannel("Veridian");
  const status: StatusBarItem = port.createStatusBarItem("left", 100);

  /**
   * Where the child's output goes - its logs for a run, its report for `metrics`.
   *
   * Which stream that is belongs to the invocation (`streamFor`); this is only the sink. A run's
   * verdict still comes from the bundle and never from here.
   */
  const log = (line: string): void => {
    output.appendLine(line);
  };

  async function refresh(): Promise<void> {
    const root = port.workspaceRoot;
    if (root === null) {
      status.hide();
      return;
    }
    const paths = bundlePaths(stateDirOf(root, readSettings(port).stateDir));
    const summary = await deps.summarise(paths);
    if (summary === null) {
      // No run yet. The dashboard says so rather than showing a blank, because a blank dashboard and
      // a dashboard whose read failed look identical, and only one of them is worth investigating.
      status.text = "Veridian: no run yet";
      status.tooltip = `No result at ${paths.lastResult}`;
      status.show();
      return;
    }
    status.text = describeVerdict(summary);
    status.tooltip = summary.reasons.join("\n");
    status.show();
  }

  /** Resolve everything a subcommand needs, or explain why it cannot run. */
  function prepare(): {
    readonly root: string;
    readonly settings: CliSettings;
    readonly base: CliRoute;
  } | null {
    const root = port.workspaceRoot;
    if (root === null) {
      port.showErrorMessage("Veridian needs an open folder: the state directory is relative to it.");
      return null;
    }
    // Absolute before anything else looks at it. See `resolveStateDir`.
    const settings = resolveStateDir(readSettings(port), root);
    const base = resolveCli(settings, root, deps.exists);
    if (base === null) {
      // The message names the paths that were searched, because "not found" without them is a
      // report the reader cannot act on - and the fix (install it, or set `veridian.cli`) depends
      // on which of the two situations they are in.
      port.showErrorMessage(
        "Veridian not found. Open a Veridian checkout (cli/veridian.ts), or install it in this " +
          "folder (node_modules/veridian/dist/cli/veridian.js), or set `veridian.cli`.",
      );
      return null;
    }
    return { root, settings, base };
  }

  /**
   * Run one subcommand and report the outcome.
   *
   * The dialog shown depends on the exit code, and the mapping is the point of this function: `1`
   * and `2` are *results*, so they are information; `3` and a failed spawn are *conditions*, so they
   * are errors. See the file comment. The *wording* is per-command, because the same number is a
   * different event in a different subcommand - see `exitMeaning`.
   */
  async function runCommand(
    command: CliCommand,
    settings: CliSettings,
    base: CliRoute,
    extra: readonly string[],
  ): Promise<void> {
    const invocation = planInvocation(base, settings, command, extra);
    output.show(true);
    log("");
    log(`> ${invocation.display}`);

    // The dashboard is refreshed in `finally` rather than after the await, because a run that
    // *failed* has just as much right to be on the dashboard as one that passed - and if `run`
    // threw, the summary is the only thing left that can say what happened.
    let outcome: Awaited<ReturnType<CliRunner["run"]>> | null = null;
    try {
      outcome = await deps.runner.run(invocation, log);
    } catch (error) {
      log(`the run could not be observed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await refresh();
    }

    if (outcome === null || outcome.code === null) {
      port.showErrorMessage(
        `Veridian ${command} could not be started. See the Veridian output channel.`,
      );
      return;
    }
    const code = outcome.code;
    const meaning = exitMeaning(command, code);
    log(`exit ${String(code)}: ${meaning}`);

    if (code === 3) {
      port.showErrorMessage(`Veridian ${command}: ${meaning}`);
      return;
    }
    port.showInformationMessage(`Veridian ${command}: ${meaning}`);
  }

  async function withSettings(
    command: CliCommand,
    extra: readonly string[] = [],
  ): Promise<void> {
    const context = prepare();
    if (context === null) return;
    let settings = context.settings;
    if (command === "validate" || command === "clarify") {
      const goal = locateGoal(port, context.root, settings.goal, deps.exists);
      if (goal === null) {
        port.showErrorMessage(
          "No goal document. Set `veridian.goal`, or open a goal.yaml, or put one in the workspace root.",
        );
        return;
      }
      settings = { ...settings, goal };
    }
    await runCommand(command, settings, context.base, extra);
  }

  async function showResult(): Promise<void> {
    const root = port.workspaceRoot;
    if (root === null) {
      port.showErrorMessage("Veridian needs an open folder.");
      return;
    }
    const paths = bundlePaths(stateDirOf(root, readSettings(port).stateDir));
    const summary = await deps.summarise(paths);
    output.show(true);
    if (summary === null) {
      log(`no run result at ${paths.lastResult}`);
      port.showInformationMessage("Veridian: no run result yet. Run a validation first.");
      return;
    }
    log("");
    log(`run      ${summary.runId}`);
    log(`verdict  ${summary.verdict}   (${summary.state}, iteration ${String(summary.iteration)})`);
    if (summary.evidenceComplete !== null) {
      log(`evidence ${summary.evidenceComplete ? "complete" : "INCOMPLETE"}`);
    }
    if (summary.blocking.length > 0) {
      log("");
      log("criteria that did not pass:");
      for (const line of summary.blocking) {
        const mandatory = line.mandatory ? "mandatory" : "optional";
        log(`  ${line.criterionId}  ${line.status}  (${mandatory})`);
        if (line.message !== null) log(`      ${line.message}`);
      }
    }
    if (summary.iterations.length > 0) {
      log("");
      log("iterations:");
      for (const entry of summary.iterations) {
        log(
          `  ${String(entry.iteration)}. ${entry.verdict}  ` +
            `${String(entry.passed)} passed, ${String(entry.failed)} failed, ` +
            `${String(entry.undecided)} undecided  ${entry.note}`,
        );
      }
    }
    if (summary.reasons.length > 0) {
      log("");
      log("reasons:");
      for (const reason of summary.reasons) log(`  ${reason}`);
    }
    log("");
    log(`bundle: ${paths.stateDir}`);
    port.openPath(paths.lastResult);
  }

  /**
   * The twin panel: every run on disk, joined by subject and shown as rows.
   *
   * The whole of this function is *show the reading*. It does not filter to the last run - the point
   * of the join is that one run tells you a verdict and several tell you whether the verdict holds -
   * and it does not summarise, rank or total the verdicts it found. The one thing it adds is the
   * state directory, because that is the fact a reader needs in order to check the rows against the
   * files, and the Cockpit is a client of those files rather than their author.
   */
  async function showTwin(): Promise<void> {
    const root = port.workspaceRoot;
    if (root === null) {
      port.showErrorMessage("Veridian needs an open folder.");
      return;
    }
    const paths = bundlePaths(stateDirOf(root, readSettings(port).stateDir));
    output.show(true);
    log("");
    for (const line of renderTwin(await deps.twin(paths))) log(line);
    log("");
    log(`state directory: ${paths.stateDir}`);
  }

  function openFailure(): void {
    const root = port.workspaceRoot;
    if (root === null) {
      port.showErrorMessage("Veridian needs an open folder.");
      return;
    }
    const paths = bundlePaths(stateDirOf(root, readSettings(port).stateDir));
    if (!deps.exists(paths.lastFailure)) {
      port.showInformationMessage(`Veridian: no failure report at ${paths.lastFailure}.`);
      return;
    }
    port.openPath(paths.lastFailure);
  }

  function registerAll(): readonly { readonly id: string }[] {
    const handles = [
      port.registerCommand("veridian.init", async () => {
        const context = prepare();
        if (context === null) return;
        await runCommand("init", context.settings, context.base, []);
      }),
      port.registerCommand("veridian.clarify", async () => {
        await withSettings("clarify");
      }),
      port.registerCommand("veridian.validate", async () => {
        await withSettings("validate");
      }),
      port.registerCommand("veridian.metrics", async () => {
        await withSettings("metrics");
      }),
      port.registerCommand("veridian.showResult", async () => {
        await showResult();
      }),
      port.registerCommand("veridian.showTwin", async () => {
        await showTwin();
      }),
      port.registerCommand("veridian.openFailure", async () => {
        openFailure();
      }),
    ];

    // The roster and the registrations are the same list read twice, so a command that is declared
    // in the manifest and never registered - or registered twice - cannot go unnoticed. This is the
    // guard `AGENTS.md` asks for: a list of names in a document is a claim, and the cheapest way to
    // hold it is a check that reads the code.
    if (handles.length !== COMMAND_IDS.length) {
      throw new Error(
        `the Cockpit registers ${String(handles.length)} commands but declares ${String(COMMAND_IDS.length)}`,
      );
    }
    for (const handle of handles) {
      if (!COMMAND_IDS.includes(handle.id)) {
        throw new Error(`the Cockpit registered "${handle.id}", which no manifest declares`);
      }
      port.keep(handle);
    }
    port.keep(output);
    port.keep(status);
    return handles;
  }

  return { registerAll, refresh, commands: ["init", "clarify", "validate", "metrics"] };
}
