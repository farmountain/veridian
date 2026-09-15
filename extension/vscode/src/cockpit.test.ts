/**
 * The activation path, driven with no editor and no disk.
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` Phase B accepts the extension when *"a Core-facing session
 * test runs headless"*. This is that test: every command `activate.ts` registers is invoked here
 * against a recorded port, a scripted runner and an in-memory bundle, and the assertions are about
 * what the Cockpit ran, what it said, and what it put on the dashboard.
 *
 * What it deliberately does not cover is the binding itself - `host/vscode-port.ts` and
 * `host/activate.ts` are the two files that import `vscode`, and no test here can load them. The
 * document names that rather than describing it as working.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { CliOutcome, CliRunner, Invocation } from "./cli.ts";
import type { BundlePaths, RunSummary } from "./bundle.ts";
import { commandIds, createCockpit } from "./cockpit.ts";
import type { Cockpit } from "./cockpit.ts";
import { createFakePort } from "./fake-port.ts";
import type { FakePort } from "./fake-port.ts";

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

interface Harness {
  readonly port: FakePort;
  readonly cockpit: Cockpit;
  readonly runs: Invocation[];
  readonly summaries: BundlePaths[];
  setOutcome(outcome: CliOutcome): void;
  setSummary(summary: RunSummary | null): void;
}

const PASSING: RunSummary = {
  runId: "run-1",
  verdict: "PASS",
  state: "COMPLETED",
  iteration: 3,
  criteria: [
    { criterionId: "AC-001", status: "PASS", mandatory: true, message: null },
    { criterionId: "AC-002", status: "PASS", mandatory: true, message: null },
  ],
  blocking: [],
  reasons: [],
  iterations: [{ iteration: 1, verdict: "FAIL", passed: 1, failed: 1, undecided: 0, note: "first" }],
  evidenceComplete: true,
};

function harness(options: { root?: string | null; activeFile?: string | null; settings?: Record<string, unknown>; exists?: (path: string) => boolean } = {}): Harness {
  const port = createFakePort({
    root: options.root === undefined ? "/ws" : options.root,
    activeFile: options.activeFile ?? null,
    settings: options.settings ?? {},
  });
  const runs: Invocation[] = [];
  const summaries: BundlePaths[] = [];
  let outcome: CliOutcome = { code: 0, signal: null, stderr: "" };
  let summary: RunSummary | null = null;

  const runner: CliRunner = {
    async run(invocation, onLine): Promise<CliOutcome> {
      runs.push(invocation);
      onLine("veridian info: log line");
      return await Promise.resolve(outcome);
    },
  };

  // The checkout route, so path assertions are deterministic on every platform.
  const exists = options.exists ?? ((path: string): boolean => path === "/ws/cli/veridian.ts");

  const cockpit = createCockpit({
    port,
    runner,
    exists,
    summarise: async (paths): Promise<RunSummary | null> => {
      summaries.push(paths);
      return await Promise.resolve(summary);
    },
  });

  return {
    port,
    cockpit,
    runs,
    summaries,
    setOutcome: (value) => {
      outcome = value;
    },
    setSummary: (value) => {
      summary = value;
    },
  };
}

/** Register and hand back, so every test exercises the same registration the host performs. */
function activated(options: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(options);
  h.cockpit.registerAll();
  return h;
}

const STATE = join("/ws", ".veridian");

const SUBCOMMANDS = ["init", "clarify", "validate", "metrics"];

/**
 * The plan, with the route's own prefix removed.
 *
 * `args` opens with whatever it takes to reach the CLI - the script path for a checkout,
 * `--no-install veridian` for npx - so a test that indexes the array directly asserts the route as
 * well as the plan, and would break the day the route changes for a reason that has nothing to do
 * with the plan. These tests are about the plan.
 */
function afterCommand(args: readonly string[]): string[] {
  const at = args.findIndex((arg) => SUBCOMMANDS.includes(arg));
  return [...args].slice(at);
}

// ---------------------------------------------------------------------------------------------
// The roster is one list, read twice
// ---------------------------------------------------------------------------------------------

test("the manifest and the Cockpit declare the same commands", () => {
  // A list of names in a document is a claim about the code, and the cheapest way to hold it is a
  // test that reads the code. This repository has already paid for exactly this drift once, when
  // `db.query` stood in three documents and in no source file.
  const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    contributes: { commands: { command: string; title: string; category: string }[] };
  };
  const declared = manifest.contributes.commands.map((entry) => entry.command);
  assert.deepEqual([...declared].sort(), [...commandIds()].sort());
  for (const entry of manifest.contributes.commands) {
    assert.equal(entry.category, "Veridian", `${entry.command} must sit under the Veridian category`);
    assert.ok(entry.title.length > 0);
  }
});

test("every declared command is registered exactly once and kept for disposal", () => {
  const h = activated();
  assert.deepEqual(h.port.commands.map((command) => command.id), [...commandIds()]);
  assert.equal(new Set(h.port.commands.map((command) => command.id)).size, commandIds().length);
  // Two commands plus the output channel and the status bar. A handle the host never kept is a
  // handler that survives deactivation and fires into a disposed editor.
  assert.equal(h.port.kept.length, commandIds().length + 2);
});

test("the subcommands the Cockpit exposes are the ones the CLI has", () => {
  assert.deepEqual([...activated().cockpit.commands], ["init", "clarify", "validate", "metrics"]);
});

// ---------------------------------------------------------------------------------------------
// Conditions the operator has to fix
// ---------------------------------------------------------------------------------------------

test("with no folder open, every command refuses and names why", async () => {
  for (const id of commandIds()) {
    const h = activated({ root: null });
    await h.port.invoke(id);
    assert.equal(h.runs.length, 0, `${id} must not run without a folder`);
    assert.equal(h.port.errors.length, 1, `${id} must say something`);
    assert.match(h.port.errors[0] ?? "", /folder/i);
  }
});

test("with no Veridian found, the message names the paths that were searched", async () => {
  const h = activated({ exists: () => false });
  // `veridian.cli` unset, no candidate present. The npx route always produces an invocation, so this
  // is the case where the operator asked for a command and npx is the last resort - it runs, and
  // what it finds (or fails to find) is reported by the process. What must *not* happen is a
  // silent no-op.
  h.setOutcome({ code: 127, signal: null, stderr: "not found" });
  await h.port.invoke("veridian.init");
  assert.equal(h.runs.length, 1);
  assert.match(h.port.lines.join("\n"), /--no-install veridian/);
  assert.match(h.port.lines.join("\n"), /unrecognised exit code 127/);
});

test("without a goal, validate and clarify refuse before starting anything", async () => {
  for (const id of ["veridian.validate", "veridian.clarify"]) {
    const h = activated();
    await h.port.invoke(id);
    assert.equal(h.runs.length, 0, `${id} must not run without a goal`);
    assert.match(h.port.errors[0] ?? "", /No goal document/);
  }
});

test("metrics runs without a goal, because it reads runs that already happened", async () => {
  const h = activated();
  await h.port.invoke("veridian.metrics");
  assert.equal(h.port.errors.length, 0);
  assert.equal(h.runs.length, 1);
  assert.deepEqual(afterCommand(h.runs[0]!.args), ["metrics", "--state-dir", STATE]);
});

// ---------------------------------------------------------------------------------------------
// Locating the goal: three sources, in the order an operator expects
// ---------------------------------------------------------------------------------------------

test("a configured goal wins", async () => {
  const h = activated({ settings: { "veridian.goal": "spec/goal.yaml" }, activeFile: "/ws/goal.yaml" });
  await h.port.invoke("veridian.validate");
  assert.deepEqual(afterCommand(h.runs[0]!.args).slice(0, 3), [
    "validate",
    "--goal",
    join("/ws", "spec/goal.yaml"),
  ]);
});

test("an open goal.yaml is the goal", async () => {
  const h = activated({ activeFile: "/somewhere/else/goal.yaml" });
  await h.port.invoke("veridian.validate");
  assert.deepEqual(afterCommand(h.runs[0]!.args).slice(0, 3), [
    "validate",
    "--goal",
    "/somewhere/else/goal.yaml",
  ]);
});

test("an open file that is merely YAML is not a goal", async () => {
  // Every document in a Veridian workspace is YAML, so guessing from the extension would run a
  // contract the operator never pointed at.
  const h = activated({
    activeFile: "/ws/acceptance.yaml",
    exists: (path) => path === "/ws/cli/veridian.ts" || path === join("/ws", "goal.yaml"),
  });
  await h.port.invoke("veridian.validate");
  assert.deepEqual(afterCommand(h.runs[0]!.args).slice(0, 3), [
    "validate",
    "--goal",
    join("/ws", "goal.yaml"),
  ]);
});

test("the workspace root's goal.yaml is the fallback, and its absence is not", async () => {
  const h = activated({ exists: (path) => path === "/ws/cli/veridian.ts" });
  await h.port.invoke("veridian.validate");
  assert.equal(h.runs.length, 0);
  assert.match(h.port.errors[0] ?? "", /No goal document/);
});

// ---------------------------------------------------------------------------------------------
// Exit codes: a FAIL is a result, not a malfunction
// ---------------------------------------------------------------------------------------------

test("PASS, FAIL and INCONCLUSIVE are reported as information, never as errors", async () => {
  for (const [code, expected] of [
    [0, /PASS/],
    [1, /FAIL/],
    [2, /INCONCLUSIVE .* not a pass/],
  ] as const) {
    const h = activated({ exists: (p) => p === "/ws/cli/veridian.ts" || p === join("/ws", "goal.yaml") });
    h.setOutcome({ code, signal: null, stderr: "" });
    await h.port.invoke("veridian.validate");
    assert.equal(h.port.errors.length, 0, `exit ${String(code)} must not be an error dialog`);
    assert.equal(h.port.information.length, 1);
    assert.match(h.port.information[0] ?? "", expected);
  }
});

test("exit 3 is an error, because the run never happened", async () => {
  const h = activated();
  h.setOutcome({ code: 3, signal: null, stderr: "" });
  await h.port.invoke("veridian.init");
  assert.equal(h.port.information.length, 0);
  assert.match(h.port.errors[0] ?? "", /could not be loaded/);
});

test("a process that never started is an error, and the log still holds the attempt", async () => {
  const h = activated();
  h.setOutcome({ code: null, signal: null, stderr: "" });
  await h.port.invoke("veridian.init");
  assert.equal(h.port.errors.length, 1);
  assert.match(h.port.errors[0] ?? "", /could not be started/);
  assert.match(h.port.lines.join("\n"), /> .*veridian\.ts init/);
});

test("the exit code is logged with its meaning, so the log explains itself", async () => {
  const h = activated();
  h.setOutcome({ code: 1, signal: null, stderr: "" });
  await h.port.invoke("veridian.init");
  assert.match(h.port.lines.join("\n"), /exit 1: FAIL - the application did not meet the contract/);
});

test("a runner that throws still refreshes the dashboard and reports the failure", async () => {
  const port = createFakePort({ root: "/ws", settings: {} });
  const seen: BundlePaths[] = [];
  let threw = false;
  const cockpit = createCockpit({
    port,
    runner: {
      async run(): Promise<CliOutcome> {
        threw = true;
        throw new Error("spawn EACCES");
      },
    },
    exists: () => false,
    summarise: async (paths) => {
      seen.push(paths);
      return await Promise.resolve(null);
    },
  });
  cockpit.registerAll();
  await port.invoke("veridian.init");

  assert.equal(threw, true);
  // The refresh in `finally` is the point: a run that could not be observed still gets a dashboard
  // reading, because the previously-recorded run is the only evidence left of what happened.
  assert.equal(seen.length, 1);
  assert.match(port.lines.join("\n"), /could not be observed: spawn EACCES/);
  assert.equal(port.errors.length, 1);
});

test("an unrecognised exit code is reported as unrecognised rather than as success", async () => {
  const h = activated();
  h.setOutcome({ code: 42, signal: null, stderr: "" });
  await h.port.invoke("veridian.init");
  assert.match(h.port.lines.join("\n"), /unrecognised exit code 42/);
  assert.match(h.port.information[0] ?? "", /unrecognised exit code 42/);
});

test("metrics reports its own exit codes, because it judges no application", async () => {
  const h = activated();
  h.setOutcome({ code: 1, signal: null, stderr: "" });
  await h.port.invoke("veridian.metrics");

  const said = [...h.port.lines, ...h.port.information].join("\n");
  assert.match(said, /at least one metric was violated/);
  // Read through the run's table, this same `1` arrives as the dialog "FAIL - the application did not
  // meet the contract" - about a command that started no world and looked at no application.
  assert.doesNotMatch(said, /did not meet the contract/);
  assert.equal(h.port.errors.length, 0);
});

test("an empty history is information for metrics, and says what was missing", async () => {
  const h = activated();
  h.setOutcome({ code: 2, signal: null, stderr: "" });
  await h.port.invoke("veridian.metrics");

  // `2` is still not a pass and is still not an error; what changed is that the sentence is now about
  // the thing this subcommand actually found.
  assert.equal(h.port.errors.length, 0);
  assert.match(h.port.lines.join("\n"), /no run bundle to measure/);
  assert.doesNotMatch(h.port.lines.join("\n"), /nothing could decide it/);
});

// ---------------------------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------------------------

test("before any run, the dashboard says so instead of showing nothing", async () => {
  const h = activated();
  await h.cockpit.refresh();
  // A blank dashboard and a dashboard whose read failed look identical, and only one of them is
  // worth investigating - so the tooltip names the file that was looked for.
  assert.equal(h.port.statusText, "Veridian: no run yet");
  assert.match(h.port.statusTooltip ?? "", /latest-result\.json/);
});

test("the dashboard reports the last verdict and carries the reasons", async () => {
  const h = activated();
  h.setSummary({ ...PASSING, verdict: "FAIL", blocking: [], reasons: ["AC-002 failed"] });
  await h.cockpit.refresh();
  assert.equal(h.port.statusText, "Veridian: FAIL (no criteria recorded, iteration 3)");
  assert.equal(h.port.statusTooltip, "AC-002 failed");
});

test("with no folder open the dashboard hides rather than lying", async () => {
  const h = activated({ root: null });
  await h.cockpit.refresh();
  assert.equal(h.port.statusText, null);
});

test("the state directory the dashboard reads is the one the CLI is told to write", async () => {
  // The whole class of defect this guards: the extension reading `.veridian/` while the run wrote
  // somewhere else, silently, with both sides looking correct in isolation.
  const h = activated({ settings: { "veridian.stateDir": "build/v" } });
  await h.cockpit.refresh();
  await h.port.invoke("veridian.init");
  const readDir = h.summaries[0]?.stateDir;
  const args = [...h.runs[0]!.args];
  const written = args[args.indexOf("--state-dir") + 1];
  assert.equal(readDir, join("/ws", "build/v"));
  assert.equal(written, join("/ws", "build/v"));
});

test("an absolute state directory is not re-rooted under the workspace", async () => {
  const absolute = process.platform === "win32" ? "D:\\state\\veridian" : "/var/veridian";
  const h = activated({ settings: { "veridian.stateDir": absolute } });
  await h.port.invoke("veridian.init");
  const args = [...h.runs[0]!.args];
  assert.equal(args[args.indexOf("--state-dir") + 1], absolute);
});

// ---------------------------------------------------------------------------------------------
// Settings are what a human typed, so none is trusted
// ---------------------------------------------------------------------------------------------

test("a browser setting that is not one of the two words falls back to auto", async () => {
  const h = activated({
    settings: { "veridian.browser": "Playwright" },
    exists: (p) => p === "/ws/cli/veridian.ts" || p === join("/ws", "goal.yaml"),
  });
  await h.port.invoke("veridian.validate");
  const args = [...h.runs[0]!.args];
  // Passed through as `Playwright` this would be rejected by the CLI as a bad flag, and the operator
  // would get an error about Veridian for a capital letter in their settings file.
  assert.equal(args[args.indexOf("--browser") + 1], "auto");
});

test("blank strings read as unset rather than as an empty path", async () => {
  const h = activated({ settings: { "veridian.cli": "   ", "veridian.stateDir": "" } });
  await h.port.invoke("veridian.init");
  // An empty `veridian.cli` would otherwise resolve to the workspace root and be spawned.
  assert.equal(h.runs[0]!.args[0], "/ws/cli/veridian.ts");
  const args = [...h.runs[0]!.args];
  assert.equal(args[args.indexOf("--state-dir") + 1], STATE);
});

// ---------------------------------------------------------------------------------------------
// The evidence viewer
// ---------------------------------------------------------------------------------------------

test("showResult opens the result file and prints the run in the log", async () => {
  const h = activated();
  h.setSummary(PASSING);
  await h.port.invoke("veridian.showResult");
  assert.deepEqual(h.port.opened, [join(STATE, "latest-result.json")]);
  const log = h.port.lines.join("\n");
  assert.match(log, /run {6}run-1/);
  assert.match(log, /verdict {2}PASS {3}\(COMPLETED, iteration 3\)/);
  assert.match(log, /evidence complete/);
  assert.match(log, /1\. FAIL {2}1 passed, 1 failed, 0 undecided {2}first/);
});

test("showResult with nothing recorded says so instead of opening a missing file", async () => {
  const h = activated();
  await h.port.invoke("veridian.showResult");
  assert.deepEqual(h.port.opened, []);
  assert.match(h.port.information[0] ?? "", /no run result yet/);
  assert.equal(h.port.errors.length, 0);
});

test("showResult labels each blocking criterion with whether it was mandatory", async () => {
  const h = activated();
  h.setSummary({
    ...PASSING,
    verdict: "FAIL",
    blocking: [
      { criterionId: "AC-002", status: "FAIL", mandatory: true, message: "expected 3 rows" },
      { criterionId: "AC-004", status: "INCONCLUSIVE", mandatory: false, message: null },
    ],
  });
  await h.port.invoke("veridian.showResult");
  const log = h.port.lines.join("\n");
  assert.match(log, /AC-002 {2}FAIL {2}\(mandatory\)/);
  assert.match(log, /AC-004 {2}INCONCLUSIVE {2}\(optional\)/);
  assert.match(log, /expected 3 rows/);
});

test("an incomplete evidence bundle is printed in capitals, not folded into the verdict", async () => {
  const h = activated();
  h.setSummary({ ...PASSING, evidenceComplete: false });
  await h.port.invoke("veridian.showResult");
  assert.match(h.port.lines.join("\n"), /evidence INCOMPLETE/);
});

test("openFailure opens the report when it exists and reports its absence when it does not", async () => {
  const present = activated({ exists: (p) => p === join(STATE, "latest-failure.md") });
  await present.port.invoke("veridian.openFailure");
  assert.deepEqual(present.port.opened, [join(STATE, "latest-failure.md")]);

  const absent = activated({ exists: () => false });
  await absent.port.invoke("veridian.openFailure");
  assert.deepEqual(absent.port.opened, []);
  // A missing failure report is not an error: it is the ordinary state of a workspace whose last run
  // passed, and an error dialog for it would be an interruption that says nothing.
  assert.equal(absent.port.errors.length, 0);
  assert.match(absent.port.information[0] ?? "", /no failure report/);
});

// ---------------------------------------------------------------------------------------------
// What the summariser is handed
// ---------------------------------------------------------------------------------------------

test("the summariser is always handed all three bundle paths", async () => {
  const h = activated();
  await h.cockpit.refresh();
  assert.deepEqual(h.summaries[0], {
    stateDir: STATE,
    lastResult: join(STATE, "latest-result.json"),
    lastFailure: join(STATE, "latest-failure.md"),
    runsDir: join(STATE, "runs"),
  });
});

test("the manifest's entry point is a file that exists", () => {
  // `main` is written in `package.json` and in `src/host/activate.ts`, and nothing else reconciles
  // them. A `main` naming an output the build does not produce activates an extension that does
  // nothing at all, silently - the same shape as a `bin` and a lockfile disagreeing.
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
    main: string;
  };
  assert.equal(manifest.main, "./out/host/activate.js");
  // And the source that entry is compiled from, so the pair is checked against the tree and not
  // against a recollection of it.
  const source = fileURLToPath(new URL("./host/activate.ts", import.meta.url));
  const text = readFileSync(source, "utf8");
  assert.match(text, /export function activate\(/);
  assert.match(text, /export function deactivate\(/);
});
