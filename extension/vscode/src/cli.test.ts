/**
 * Tests for locating and driving the CLI.
 *
 * The resolution order is four routes and the failure mode of a wrong one is silent: a run that
 * drives a *different* Veridian than the operator chose still produces output, still exits 0, and
 * still writes a bundle - just not to the state directory the extension then reads. So the order is
 * asserted rather than described, and the probe is injected so the test can choose a layout instead
 * of creating one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CliSettings } from "./cli.ts";
import { cliCandidates, commandArguments, planInvocation, resolveCli } from "./cli.ts";

/** A POSIX-style root: `cliCandidates` joins with `/` on every platform, so this is deterministic. */
const ROOT = "/ws";

function settings(overrides: Partial<CliSettings> = {}): CliSettings {
  return { cliPath: null, goal: null, stateDir: ".veridian", browser: "auto", ...overrides };
}

function none(_path: string): boolean {
  return false;
}

function only(...paths: readonly string[]): (path: string) => boolean {
  return (path) => paths.includes(path);
}

const CHECKOUT = "/ws/cli/veridian.ts";
const INSTALLED = "/ws/node_modules/veridian/dist/cli/veridian.js";

// ---------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------

test("the checkout is tried before the installed package", () => {
  // A workspace that holds `cli/veridian.ts` *is* a Veridian checkout. Running the released copy
  // beside it would mean the operator's edits had no effect - the most confusing possible outcome
  // for the person most likely to install this extension early - so the source wins where both
  // exist, and the installed package is what a consumer's workspace holds.
  assert.deepEqual([...cliCandidates(ROOT)], [CHECKOUT, INSTALLED]);
});

test("a trailing separator on the root does not produce a doubled one", () => {
  // The operator's `workspaceRoot` comes from the editor and may or may not end in a separator.
  // A doubled one produces a path no filesystem has, so the probe would report "not installed" for
  // an installation sitting right there.
  const trailing = [...cliCandidates("/ws/")];
  assert.deepEqual(trailing, [...cliCandidates("/ws")]);
  for (const candidate of trailing) assert.ok(!candidate.includes("//"), candidate);
});

// ---------------------------------------------------------------------------------------------
// Resolution order
// ---------------------------------------------------------------------------------------------

test("a configured path is used even when it does not exist", () => {
  const resolved = resolveCli(settings({ cliPath: "./tools/my-veridian.js" }), ROOT, none);
  assert.ok(resolved !== null);
  // Not probed: falling through to another Veridian would run a program the operator did not name,
  // and report the result as though they had. Saying "not found" is the honest failure.
  assert.equal(resolved.args[0], "/ws/tools/my-veridian.js");
  assert.equal(resolved.executable, process.execPath);
});

test("a configured path keeps absolute and Windows forms intact", () => {
  const posix = resolveCli(settings({ cliPath: "/opt/v/cli.js" }), ROOT, none);
  assert.equal(posix?.args[0], "/opt/v/cli.js");
  const drive = resolveCli(settings({ cliPath: "D:\\v\\cli.js" }), ROOT, none);
  assert.equal(drive?.args[0], "D:\\v\\cli.js");
  const unc = resolveCli(settings({ cliPath: "\\\\host\\share\\cli.js" }), ROOT, none);
  assert.equal(unc?.args[0], "\\\\host\\share\\cli.js");
});

test("a configured executable that is not a script is run directly", () => {
  const resolved = resolveCli(settings({ cliPath: "veridian" }), ROOT, none);
  assert.ok(resolved !== null);
  assert.equal(resolved.executable, "/ws/veridian");
  assert.deepEqual([...resolved.args], []);
});

test("the installed package is chosen when it exists", () => {
  const resolved = resolveCli(settings(), ROOT, only(INSTALLED));
  assert.ok(resolved !== null);
  assert.equal(resolved.args[0], INSTALLED);
  assert.equal(resolved.cwd, ROOT);
  assert.equal(resolved.shell, false);
});

test("the checkout is chosen when only it exists, and is run by the host's own interpreter", () => {
  const resolved = resolveCli(settings(), ROOT, only(CHECKOUT));
  assert.ok(resolved !== null);
  assert.equal(resolved.args[0], CHECKOUT);
  // `process.execPath`, never the string "node": the source route must use the interpreter the
  // extension host is running under, which is the one `.nvmrc` and `engines.node` describe.
  assert.equal(resolved.executable, process.execPath);
});

test("nothing found falls back to npx, and never installs anything", () => {
  const resolved = resolveCli(settings(), ROOT, none);
  assert.ok(resolved !== null);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  assert.equal(resolved.executable, npx);
  assert.deepEqual([...resolved.args], ["--no-install", "veridian"]);
  // `--no-install` so that opening an editor cannot start a download, and a shell because Windows
  // will not spawn a `.cmd` without one. Both are asserted, because both are the reason this route
  // is last rather than first.
  assert.equal(resolved.shell, true);
});

test("the npx fallback is reached only when no candidate exists", () => {
  for (const present of [INSTALLED, CHECKOUT]) {
    const resolved = resolveCli(settings(), ROOT, only(present));
    assert.equal(resolved?.args[0], present);
  }
});

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

test("--state-dir is passed to every subcommand, not only when it differs from the default", () => {
  // Two defaults that agree today are two defaults that will disagree later, and the disagreement
  // would be silent: the extension would read a `.veridian/` the run did not write to.
  for (const command of ["init", "clarify", "validate", "metrics"] as const) {
    const args = commandArguments(settings(), command, []);
    const at = args.indexOf("--state-dir");
    assert.ok(at !== -1, `${command} must carry --state-dir`);
    assert.equal(args[at + 1], ".veridian");
  }
});

test("only validate and clarify are given a goal", () => {
  const withGoal = settings({ goal: "/ws/goal.yaml" });
  assert.deepEqual([...commandArguments(withGoal, "validate", [])], [
    "validate",
    "--goal",
    "/ws/goal.yaml",
    "--browser",
    "auto",
    "--state-dir",
    ".veridian",
  ]);
  assert.deepEqual([...commandArguments(withGoal, "clarify", [])], [
    "clarify",
    "--goal",
    "/ws/goal.yaml",
    "--state-dir",
    ".veridian",
  ]);
  // `init` writes a starter config and `metrics` reads runs already on disk; neither takes a goal,
  // and passing one would be an error the operator never caused.
  assert.deepEqual([...commandArguments(withGoal, "init", [])], ["init", "--state-dir", ".veridian"]);
  assert.deepEqual([...commandArguments(withGoal, "metrics", [])], ["metrics", "--state-dir", ".veridian"]);
});

test("only validate is given a browser", () => {
  // `clarify` resolves the definition without starting a world, so it has no browser to choose.
  const args = commandArguments(settings({ goal: "/ws/goal.yaml", browser: "none" }), "clarify", []);
  assert.ok(!args.includes("--browser"));
});

test("extra arguments come last, where the CLI expects them", () => {
  const args = commandArguments(settings(), "metrics", ["--defects", "AC-001,AC-002"]);
  assert.deepEqual([...args], ["metrics", "--state-dir", ".veridian", "--defects", "AC-001,AC-002"]);
});

// ---------------------------------------------------------------------------------------------
// Composing the whole invocation
// ---------------------------------------------------------------------------------------------

test("planning appends to the route's own arguments and drops nothing from them", () => {
  const base = resolveCli(settings(), "C:/src/veridian", only("C:/src/veridian/cli/veridian.ts"));
  assert.ok(base !== null);
  const planned = planInvocation(base, settings({ goal: "goal.yaml" }), "validate");
  assert.equal(planned.args[0], "C:/src/veridian/cli/veridian.ts");
  assert.equal(planned.executable, process.execPath);
  assert.deepEqual([...planned.args].slice(1), [
    "validate",
    "--goal",
    "goal.yaml",
    "--browser",
    "auto",
    "--state-dir",
    ".veridian",
  ]);
});

test("the display line is the argv, so the log says what actually ran", () => {
  const base = resolveCli(settings(), ROOT, only(CHECKOUT));
  assert.ok(base !== null);
  const planned = planInvocation(base, settings(), "init");
  assert.equal(planned.display, `${process.execPath} ${CHECKOUT} init --state-dir .veridian`);
  assert.equal(planned.display.startsWith(planned.executable), true);
});
