#!/usr/bin/env node
/**
 * Run Veridian's own acceptance contract, twice.
 *
 * Twice is the point rather than thoroughness. `acceptance/environment.yaml` declares `app: ..` and
 * `process.root: sandbox`, so the world's root and the `--state-dir` its criteria pass are one
 * directory - and AC-002's `init` refuses when `config.yaml` is already there. `#rebuild` in
 * `adapters/local-process` is what empties that tree, and it runs at `create()`, so *every* run
 * starts from an empty one.
 *
 * The second run is what makes the check the same check on every machine. A single run only catches a
 * dropped rename-by-rebuild where the tree was already populated before it started, which is never
 * the case on a fresh checkout and is not reliably the case anywhere else. Run 1 leaves its own
 * `config.yaml` behind - nothing removes the tree at the end of a run, only at the start of the next
 * one - so run 2 inherits exactly the state run 1 produced, in the same invocation, on any machine.
 * Measured rather than argued: with the removal in `#rebuild` commented out, run 1 exits 0 and run 2
 * exits 1 with AC-002 and AC-003 failing on an inherited `config.yaml`, and that reading came from
 * deleting `sandbox/` first so run 1 began where CI's fresh checkout begins.
 *
 * `.mjs` for the same reason `scripts/copy-assets.mjs` is: it drives the CLI, so it has to be
 * runnable before anything in the repository has been type-checked.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The repository root, derived from this file rather than from the working directory.
 *
 * `--goal` is resolved against the caller's directory, so a script that inherited whatever directory
 * it was invoked from would resolve the goal differently depending on where the operator stood. The
 * contract's own `app: ..` is resolved against the *goal document's* directory, so the sandbox it
 * declares is the same tree from anywhere - it is only this argument that needs a fixed origin.
 */
const repo = fileURLToPath(new URL("..", import.meta.url));

const args = [
  "cli/veridian.ts",
  "validate",
  "--goal",
  "acceptance/veridian-mvp.yaml",
  "--no-memory",
  "--no-repair",
];

/** The run's verdict, which is written to stdout; the progress chatter goes to stderr on purpose. */
const verdictOf = (stdout) =>
  stdout
    .split(/\r?\n/)
    .find((line) => /^(PASS|FAIL|ERROR|INCONCLUSIVE|ABORTED|MAX_ITERATIONS)\b/.test(line))
    ?.trim() ?? "(no verdict line)";

const failed = [];

for (const pass of [1, 2]) {
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  /**
   * `status`, not `code`.
   *
   * `spawnSync` reports a completed child's exit status as `status` and reserves `code` for a spawn
   * that never happened - on the `error` object, not on the result. Reading `result.code` gives
   * `undefined` for every run that actually executed, and `undefined !== 0` is true, so a guard
   * written that way calls every healthy run a failure. Measured: this script's first execution
   * printed `run 1: exit undefined - PASS (COMPLETED, 1 iteration(s))` and exited 1 over a contract
   * that passed 7/7 - a runner that reported the opposite of what it had just read. A `status` of
   * `null` (the child was signalled) is not 0 either, and is a failure for the same reason.
   */
  const exitCode = result.status;

  console.log(`run ${String(pass)}: exit ${String(exitCode)} - ${verdictOf(stdout)}`);

  if (result.error !== undefined) {
    // A spawn that never happened is a different observation from a run that failed, and the only
    // place its cause exists is here.
    console.error(`run ${String(pass)} could not start: ${result.error.message}`);
  }

  if (exitCode !== 0) {
    failed.push(pass);
    console.error(`\n--- run ${String(pass)} stdout ---\n${stdout}\n--- run ${String(pass)} stderr ---\n${stderr}`);
  }
}

if (failed.length > 0) {
  console.error(
    `\nThe contract did not pass on run ${failed.join(" and ")}. A first run that passes and a ` +
      "second that fails is the signature of a world a run inherited rather than built: " +
      "`#rebuild` in `adapters/local-process` is what removes the sandbox between iterations, and " +
      "`/sandbox/` in `.gitignore` is the rule that keeps that tree out of the repository.",
  );
  process.exit(1);
}

console.log(
  "\nboth invocations passed: the contract is repeatable, so the world each run judged was rebuilt " +
    "rather than inherited from the previous one.",
);
