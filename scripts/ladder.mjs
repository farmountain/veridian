#!/usr/bin/env node
/**
 * Run Veridian's ladder contract, twice.
 *
 * The contract judges a *run* of the CLI rather than the CLI as a product: four criteria invoke the
 * inner contract in `acceptance/ladder/fixtures/`, and then read the ambiguity record that inner run
 * wrote about the gaps it met. All four outer criteria can be decided by this world, so the outer run
 * is expected to `PASS` - and the thing it passes by is proving that a run which could not decide
 * anything said so.
 *
 * ## Why the state directory is passed here rather than declared in the environment document
 *
 * `acceptance/ladder/environment.yaml` declares `process.root: sandbox/ladder/fixture`, and
 * `#rebuild` in `adapters/local-process` empties that directory when the world is *created*. The CLI
 * writes its own bundle **before** the world is created, so a `--state-dir` inside the root would be
 * destroyed by the world whose bundle it holds. It is therefore a sibling of the root, and this script
 * is what passes it - which is why the path is written here and only described there.
 *
 * ## Why twice
 *
 * Run 1 is the measurement; run 2 is the check that the measurement is repeatable. That is M1's
 * question - *did the same code give the same result twice* - asked of this contract about itself,
 * and it costs one extra invocation to ask.
 *
 * The concrete hazard a single run cannot see is in the world, not in the contract. The root is
 * emptied at `create()`, and each criterion's state directory lives inside it, so run 1 leaves
 * `ac-001/` through `ac-004/` populated. Run 2 begins by removing them - nothing removes the tree at
 * the end of a run, only at the start of the next one - and AC-001's `process.file` expectation is
 * precisely the one that would be satisfied by a record left behind by the previous run rather than
 * written by this one. Starting run 2 where a fresh checkout starts is what keeps that from being the
 * reason it passes.
 *
 * `.mjs` for the same reason `scripts/acceptance.mjs` and `scripts/copy-assets.mjs` are: it drives the
 * CLI through a child process, so it has to be runnable before anything in the repository has been
 * type-checked.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The repository root, derived from this file rather than from the working directory.
 *
 * `--goal` is resolved against the caller's directory, so a script that inherited whatever directory
 * it was invoked from would resolve the goal differently depending on where the operator stood. The
 * contract's own `app: ../..` is resolved against the *goal document's* directory, so `cli/veridian.ts`
 * is reached from anywhere - it is only this argument that needs a fixed origin.
 */
const repo = fileURLToPath(new URL("..", import.meta.url));

const args = [
  "cli/veridian.ts",
  "validate",
  "--goal",
  "acceptance/ladder/goal.yaml",
  "--state-dir",
  "sandbox/ladder/outer",
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
   * written that way calls every healthy run a failure. The sibling script paid for this rule: its
   * first execution printed `run 1: exit undefined - PASS (COMPLETED, 1 iteration(s))` and exited 1
   * over a contract that passed 7/7 - a runner that reported the opposite of what it had just read.
   * A `status` of `null` (the child was signalled) is not 0 either, and is a failure for the same
   * reason.
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
    `\nThe ladder contract did not pass on run ${failed.join(" and ")}. Read the four criteria as one ` +
      "chain: AC-001 says the world started the CLI and the CLI said INCONCLUSIVE for the reasons " +
      "this contract was written around, AC-002 to AC-004 say the record the CLI wrote carries the " +
      "resolutions, the rungs, the deferral's reason and all seven origins. A failure in AC-001 is a " +
      "world or fixture problem; a failure in the other three is a record that stopped naming " +
      "something it used to name.",
  );
  process.exit(1);
}

console.log(
  "\nboth invocations passed: a run of the inner contract resolved its own gaps, recorded the rung " +
    "each resolution reached, and did so twice running.",
);
