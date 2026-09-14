/**
 * Locating and driving the Veridian CLI.
 *
 * ## Why the Cockpit drives the CLI rather than linking Core
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` Phase B says the extension *"drives Core through the same
 * interface the CLI does"*, and `AGENTS.md` says it is *"a thin client over a stable local Core
 * interface, so that CLI, CI, and MCP can drive the same engine later."* Those two sentences only
 * have one implementation that satisfies both: the extension uses **the interface that exists**,
 * which is the CLI, and adds nothing to it.
 *
 * The alternative - importing `core/` and calling `runValidationLoop` in process - was rejected for
 * three reasons, and they are worth stating because it looks like the shorter path:
 *
 * 1. `runValidate` in `cli/veridian.ts` is where the run's *world* is assembled: the browser choice
 *    applied to the plan, the boundary disclosure, the reproduction capture, the run handle. That
 *    is not a function of the definitions; it is a function of the process. An extension that
 *    re-implemented it would be a second place a run is composed, and the two would disagree the
 *    first time one of them grew a step - which is exactly the defect this repository has already
 *    paid for once, when `hasNoHttp` was written twice.
 * 2. A long run must be cancellable and must not block the extension host. A child process gives
 *    both for free; an in-process run gives neither without inventing a scheduler.
 * 3. The Cockpit must work against an *installed* Veridian in a consumer's workspace, where there
 *    is no source tree to import from at all.
 *
 * ## Locating the CLI is a decision, so it is a pure function
 *
 * `resolveCli` takes an `exists` probe rather than touching the filesystem, so the resolution order
 * is testable without creating any of the layouts it chooses between. Order, and why:
 *
 * 1. `veridian.cli` - the operator said so. Taken at face value, relative to the workspace root.
 * 2. `<root>/cli/veridian.ts` - Veridian **checked out** in the workspace. Here the source *is* the
 *    program and Node runs it directly, which is the property the whole repository is built on.
 *    Tried before the installed copy on purpose: a workspace holding this path *is* a Veridian
 *    checkout, and running the released copy beside it would mean the operator's edits had no
 *    effect - the most confusing possible outcome for the person most likely to install this
 *    extension early.
 * 3. `<root>/node_modules/veridian/dist/cli/veridian.js` - Veridian **installed** in the workspace.
 *    The package's compiled entry, not `node_modules/.bin/veridian`: a `.cmd` shim on Windows cannot
 *    be spawned without a shell, and `dist/cli/veridian.js` is the same program by the same name on
 *    both platforms. (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` is why the installed copy is
 *    JavaScript; see `AGENTS.md`, `## Distribution`.)
 * 4. `npx --no-install veridian` - last resort, and only against something already on the machine:
 *    `--no-install` so that opening an editor never silently downloads a package.
 *
 * A resolution that finds nothing returns `null` rather than guessing, and the caller says which
 * paths it looked in - because "Veridian is not installed" and "Veridian is installed somewhere I
 * did not look" are different facts and only one of them is the operator's to fix.
 */

import { spawn } from "node:child_process";

/** The four subcommands the Cockpit exposes. There is no fifth: the CLI has no more. */
export type CliCommand = "init" | "clarify" | "validate" | "metrics";

/** The browser choices the CLI accepts, spelled exactly as its own flag spells them. */
export type BrowserChoice = "auto" | "playwright" | "none";

/** What the operator configured, after narrowing from `unknown`. */
export interface CliSettings {
  readonly cliPath: string | null;
  readonly goal: string | null;
  readonly stateDir: string;
  readonly browser: BrowserChoice;
}

/** One process to run. `shell` is set only where the platform forces it - see `resolveCli`. */
export interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: boolean;
  /** A single line for the log. Never used to decide anything. */
  readonly display: string;
}

/** What a finished process produced. */
export interface CliOutcome {
  readonly code: number | null;
  readonly signal: string | null;
  /** Everything the child wrote to stderr, which is where the CLI deliberately puts its logs. */
  readonly stderr: string;
}

/** The one thing this file needs from the outside world, so its decisions can be tested. */
export interface CliRunner {
  run(invocation: Invocation, onLine: (line: string) => void): Promise<CliOutcome>;
}

// ---------------------------------------------------------------------------------------------
// Pure: which paths are candidates, and which one wins
// ---------------------------------------------------------------------------------------------

/** The candidate paths, in the order they are tried. Exported so a failure can name them. */
export function cliCandidates(root: string): readonly string[] {
  return [joinRoot(root, "cli", "veridian.ts"), joinRoot(root, "node_modules", "veridian", "dist", "cli", "veridian.js")];
}

function joinRoot(root: string, ...parts: readonly string[]): string {
  const separator = root.endsWith("/") || root.endsWith("\\") ? "" : "/";
  return `${root}${separator}${parts.join("/")}`;
}

/** `true` when a path looks like something Node should be asked to run rather than executed. */
function isScript(path: string): boolean {
  return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") || path.endsWith(".ts");
}

/**
 * Turn a script path into the command that runs it.
 *
 * `process.execPath` rather than the string `"node"`: the extension host is itself a Node process,
 * and the branch that runs Veridian from source must use the *same* interpreter - the one `.nvmrc`
 * and `engines.node` were written for - rather than whatever `node` happens to be first on `PATH`.
 */
function scriptInvocation(script: string, args: readonly string[], cwd: string): Invocation {
  return {
    executable: process.execPath,
    args: [script, ...args],
    cwd,
    shell: false,
    display: `${process.execPath} ${[script, ...args].join(" ")}`,
  };
}

/**
 * Whether a path is already anchored: a POSIX root, a Windows drive, or a UNC share.
 *
 * One definition, used by the configured-CLI resolution, by the goal lookup and by the state
directory. Three copies of this rule is three chances to disagree - and the disagreement would be
silent, producing a path like `/ws/D:/state` that no filesystem has and no error message explains.
 */
export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(path);
}

/** Resolve a configured or candidate path against the workspace root. */
function resolveAgainst(root: string, path: string): string {
  return isAbsolutePath(path) ? path : joinRoot(root, path.replace(/^\.\//, ""));
}

/**
 * Which CLI to run, or `null` when none of the four routes exists.
 *
 * `existing` is the injected probe, so this is a pure function of (settings, root, probe).
 */
export function resolveCli(
  settings: CliSettings,
  root: string,
  existing: (path: string) => boolean,
): Invocation | null {
  const configured = settings.cliPath;
  if (configured !== null && configured.trim() !== "") {
    const path = resolveAgainst(root, configured.trim());
    // Not probed: the operator named it. Probing would let a missing file silently fall through to
    // a *different* Veridian than the one they chose, which is worse than saying it is missing.
    return isScript(path) ? scriptInvocation(path, [], root) : directInvocation(path, [], root);
  }

  for (const candidate of cliCandidates(root)) {
    if (!existing(candidate)) continue;
    return scriptInvocation(candidate, [], root);
  }

  // `npx.cmd` on Windows, and Windows will not spawn a `.cmd` without a shell. Everything else here
  // is spawned without one, because going through a shell reassembles the program's own quoting.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    executable: npx,
    args: ["--no-install", "veridian"],
    cwd: root,
    shell: true,
    display: `${npx} --no-install veridian`,
  };
}

function directInvocation(executable: string, args: readonly string[], cwd: string): Invocation {
  return { executable, args, cwd, shell: false, display: `${executable} ${args.join(" ")}` };
}

// ---------------------------------------------------------------------------------------------
// Pure: the arguments a subcommand is given
// ---------------------------------------------------------------------------------------------

/**
 * The arguments appended after the subcommand.
 *
 * `--state-dir` is passed **always**, not only when it differs from the CLI's default. Two defaults
 * that agree today are two defaults that will disagree later, and the disagreement would be silent:
 * the extension would read a `.veridian/` the run did not write to.
 *
 * `--goal` is passed when one was found. `validate` and `clarify` need it; the others do not, and
 * `metrics` is handed `--defects` by the caller instead.
 */
export function commandArguments(
  settings: CliSettings,
  command: CliCommand,
  extra: readonly string[],
): readonly string[] {
  const args: string[] = [command];
  if (command === "validate" || command === "clarify") {
    if (settings.goal !== null) args.push("--goal", settings.goal);
    if (command === "validate") args.push("--browser", settings.browser);
  }
  args.push("--state-dir", settings.stateDir);
  args.push(...extra);
  return args;
}

/**
 * The whole invocation for a subcommand, given where the CLI was found.
 *
 * Nothing is filtered out of `base.args`, and an earlier version of this function did filter - it
 * dropped the literal string `veridian`, to stop the `npx veridian` fallback carrying the word
 * twice. That was wrong for a reason worth keeping written down: `base.args` holds the script path
 * for every other route, and a script path that happens to end in a directory called `veridian`
 * would have been silently deleted from the command. The word only ever needed to be there once
 * *per route*, and each route above already spells its own arguments correctly, so appending is the
 * whole job. *A transformation that "cleans up" a value it did not create will eventually clean up
 * something else.*
 */
export function planInvocation(
  base: Invocation,
  settings: CliSettings,
  command: CliCommand,
  extra: readonly string[] = [],
): Invocation {
  const args = commandArguments(settings, command, extra);
  return {
    ...base,
    args: [...base.args, ...args],
    display: `${base.executable} ${[...base.args, ...args].join(" ")}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The real runner
// ---------------------------------------------------------------------------------------------

/**
 * Run the CLI and stream its stderr.
 *
 * Only stderr, and that is not an oversight. `cli/support.ts` sends every log line there
 * deliberately - the run's result is a file and stdout is the summary a caller reads - so streaming
 * stdout would render the same progress twice and put the one machine-readable stream in an output
 * channel no machine reads. The Cockpit takes its verdict from the bundle, never from the console.
 */
export function systemRunner(): CliRunner {
  return {
    async run(invocation, onLine) {
      return await new Promise<CliOutcome>((resolve) => {
        const child = spawn(invocation.executable, [...invocation.args], {
          cwd: invocation.cwd,
          shell: invocation.shell,
          windowsHide: true,
        });

        let stderr = "";
        let carry = "";

        const consume = (chunk: string): void => {
          stderr += chunk;
          const lines = `${carry}${chunk}`.split(/\r?\n/);
          carry = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim() !== "") onLine(line);
          }
        };

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          consume(chunk);
        });

        // stdout is drained and discarded rather than left unread: a child whose stdout buffer fills
        // blocks forever, and a hung run with no output is worse than output nobody wanted.
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", () => {
          /* deliberately unread - see the doc comment */
        });

        child.on("error", (error) => {
          onLine(`could not start Veridian: ${error.message}`);
          resolve({ code: null, signal: null, stderr });
        });

        child.on("close", (code, signal) => {
          if (carry.trim() !== "") onLine(carry);
          resolve({ code, signal, stderr });
        });
      });
    },
  };
}
