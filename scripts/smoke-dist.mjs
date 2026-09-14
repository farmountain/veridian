#!/usr/bin/env node
/**
 * Drive the *built* CLI, from a working directory that is not the package.
 *
 * Why this exists, in one sentence: without it, every test in `tests/` covers `.ts` files that are
 * never shipped, and the artifact that *is* shipped is covered by nothing. `AGENTS.md` names that
 * exact shape as the unverified claim this project refuses to make, and it is the reason the
 * registry path was declined rather than half-built.
 *
 * Both things it asserts are things that genuinely break, and each break has a distinct symptom:
 *
 *  1. `dist/` exists and carries its non-code assets. `tsc` emits JavaScript and nothing else, so a
 *     build without `scripts/copy-assets.mjs` produces a package whose own schemas are absent.
 *
 *  2. The built CLI runs, and resolves its own assets, from a directory that is not the package.
 *     This is the assertion the whole build step exists for. `dist/cli/veridian.js` is executed with
 *     `cwd` set to a fresh temporary directory and given an *absolute* goal path, so nothing is
 *     being read from the repository by accident.
 *
 * The second check drives a real, browserless run of the canonical demo and requires exit code 2.
 * That is a deliberately chosen number rather than "not zero". `--browser none` means every
 * criterion is a browser observation, so the run is four `INCONCLUSIVE` criteria and the loop
 * refusing to judge what it did not observe. Exit 3 is the definition phase failing - a schema that
 * could not be read, or a goal that could not be found - which is precisely the failure an
 * installed CLI would have had when it looked for `schemas/` in the caller's directory. So 2 proves
 * the schemas loaded, the contract resolved and the loop ran; 3 is the defect this file exists to
 * catch; and "exit 0" would mean the run had passed, which with no browser it cannot.
 *
 * Run it with `npm run smoke:dist`, after `npm run build`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const distCli = join(root, "dist", "cli", "veridian.js");
const demoGoal = join(root, "examples", "shopping-cart", "goal.yaml");

/** Exit 2: the run finished and every criterion was INCONCLUSIVE. See the header for why not 0. */
const EXPECTED_BROWSERLESS_EXIT = 2;

const failures = [];

/**
 * Run the built CLI with an absolute executable path and an explicit working directory, so that
 * neither the script's own cwd nor the shell's PATH can stand in for the package being correct.
 */
function run(args, cwd) {
  const result = spawnSync(process.execPath, [distCli, ...args], {
    cwd,
    encoding: "utf8",
    // A stray `NODE_OPTIONS` in the calling environment would be a hidden input to this check.
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  return {
    code: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function check(description, condition, detail) {
  if (condition) {
    process.stdout.write(`smoke: ok    ${description}\n`);
    return;
  }
  process.stdout.write(`smoke: FAIL  ${description}\n`);
  failures.push(`${description}${detail ? ` - ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// 1. The build output carries its assets.
// ---------------------------------------------------------------------------------------------

const sourceSchemas = readdirSync(join(root, "schemas")).sort();
const builtSchemas = (() => {
  try {
    return readdirSync(join(root, "dist", "schemas")).sort();
  } catch {
    return null;
  }
})();

check(
  "the build emitted dist/cli/veridian.js",
  (() => {
    try {
      readdirSync(join(root, "dist", "cli"));
      return true;
    } catch {
      return false;
    }
  })(),
  `expected ${distCli}`,
);

check(
  `the build carries all ${sourceSchemas.length} schemas into dist/schemas/`,
  builtSchemas !== null && builtSchemas.join(",") === sourceSchemas.join(","),
  builtSchemas === null
    ? "dist/schemas/ does not exist - run `node scripts/copy-assets.mjs`"
    : `dist has [${builtSchemas.join(", ")}], source has [${sourceSchemas.join(", ")}]`,
);

// ---------------------------------------------------------------------------------------------
// 2. The built CLI works from somewhere that is not the package.
// ---------------------------------------------------------------------------------------------

const elsewhere = mkdtempSync(join(tmpdir(), "veridian-smoke-"));

try {
  const help = run(["help"], elsewhere);
  check(
    "the built CLI answers `help` with exit 0 from another directory",
    help.code === 0,
    `exit ${help.code}; output: ${help.output.trim().slice(0, 400)}`,
  );

  const observed = run(
    [
      "validate",
      "--goal",
      demoGoal,
      "--state-dir",
      join(elsewhere, ".veridian"),
      "--browser",
      "none",
      "--no-repair",
    ],
    elsewhere,
  );

  check(
    `a browserless run of the canonical demo exits ${EXPECTED_BROWSERLESS_EXIT}, not 3`,
    observed.code === EXPECTED_BROWSERLESS_EXIT,
    observed.code === 3
      ? `exit 3 is the definition phase failing - the built CLI could not find its own goal schema. Output: ${observed.output
          .trim()
          .slice(0, 600)}`
      : `exit ${observed.code}; output: ${observed.output.trim().slice(0, 600)}`,
  );
} finally {
  rmSync(elsewhere, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\nsmoke: ${failures.length} check(s) failed\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write("\nsmoke: the built artifact runs, and finds its own assets, from anywhere\n");
