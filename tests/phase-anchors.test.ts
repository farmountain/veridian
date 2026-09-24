/**
 * Every phase's status names the thing it was measured against.
 *
 * `docs/phases/12-memory-and-the-end-of-the-program.md` states this as its fourth acceptance
 * criterion - *every phase document carries a status that is true of the tree **as measured**, and
 * each gives the anchor - a path, a symbol or a command - it was measured against* - and the reason
 * it is a criterion rather than a sentence is the defect the phase program itself was built to fix.
 *
 * ## Why a status cell can be false while two documents agree
 *
 * `docs/phases/README.md`'s index compares each row's status against the phase file's own
 * `| **Status** |` cell, and `tests/phases-roster.test.ts` holds that comparison. It is a real guard
 * and it catches real drift - but **it compares the table to the file, and both can be wrong about
 * the tree in the same words.** Phase 06 was found that way: its row and its cell both said `next`
 * while the world it describes was already built and committed. Agreement is not truth, and this
 * file is the second question.
 *
 * ## What this guard can and cannot check
 *
 * It cannot check that a status is *true*. No test can read a sentence and compare it to a tree. What
 * it checks is the weaker, decidable half: **the status names an anchor, and a path anchor points at
 * something that exists.** That is exactly the property that fails first, because a document that
 * cites a file is a document that can be caught citing a file that was renamed away - and a status
 * citing nothing at all cannot be caught at all.
 *
 * Three shapes count as an anchor, and each is resolved rather than pattern-matched:
 *
 * | Shape | Resolved by |
 * |---|---|
 * | a path with a `/` in it, in backticks | the file must exist under the repository root |
 * | a bare file name in backticks (`` `result.schema.json` ``) | some file with that name must exist in the tree |
 * | a command in backticks (`` `npm run gate` ``, `` `node --test` ``) | an `npm run X` must name a script `package.json` declares |
 *
 * ## Two controls, because a guard over an empty scope passes forever
 *
 * The first asserts the walk found the phase files at all, and that they are the same scope
 * `tests/phases-roster.test.ts` reads. The second asserts the anchor vocabulary is **exercised**:
 * across the corpus there must be at least one path anchor and at least one command anchor, so that
 * "every status has an anchor" cannot be satisfied by a rule that no longer recognises anything.
 *
 * ## This is a third guard over one directory, and that is deliberate
 *
 * `docs-roster` reads the top level of `docs/` and cannot see a subdirectory at all; `phases-roster`
 * reads the **index table**. Neither reads a phase file's status cell. `AGENTS.md` records the cost
 * of a document crediting a guard with coverage it does not have, so the questions are split by
 * scope rather than piled into one file: the index, the table, and now the cells.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PHASES = fileURLToPath(new URL("../docs/phases/", import.meta.url));

/** A phase file, by the naming convention the directory already uses. Not a hand-kept list. */
const PHASE_FILE = /^\d{2}-[\w.-]+\.md$/;

/** The status cell, as the index's own parser expects to find it. */
const STATUS_CELL = /^\|\s\*\*Status\*\*\s\|\s*(.*?)\s*\|\s*$/;

/** A backticked token. Everything the guard resolves starts life as one of these. */
const BACKTICKED = /`([^`]+)`/g;

/** An anchor that goes through a directory, so it is a path from the root or it is nothing. */
const PATH_WITH_DIRECTORY = /^[\w][\w.-]*(\/[\w.-]+)+$/;

/** A bare file name: resolved by looking for one anywhere in the tree, so it must have an extension. */
const BARE_FILE_NAME = /^[\w][\w.-]*\.[A-Za-z0-9]+$/;

/** A command. Anything else in backticks is prose wearing code formatting. */
const COMMAND = /^(?:npm run|node|npx)\s+\S+/;

/** Every file in the tree, by base name. Walked once, so a bare-name anchor can be resolved. */
function everyFileName(): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else {
        names.add(entry.name);
      }
    }
  };
  walk(ROOT);
  return names;
}

/** The npm scripts, so a command anchor is checked against the manifest rather than trusted. */
function npmScripts(): readonly string[] {
  const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(manifest.scripts ?? {});
}

/** One phase file's status cell, or `null` when the file has no cell this guard can read. */
function statusCellOf(file: string): string | null {
  const lines = readFileSync(`${PHASES}${file}`, "utf8").split("\n");
  for (const line of lines) {
    const match = STATUS_CELL.exec(line);
    if (match !== null) return match[1] ?? "";
  }
  return null;
}

/** The first reason this cell names nothing resolvable, or `null` when it names something. */
function anchorProblem(
  cell: string,
  scripts: readonly string[],
  fileNames: ReadonlySet<string>,
): string | null {
  const tokens = [...cell.matchAll(BACKTICKED)].map((match) => match[1] ?? "");

  for (const token of tokens) {
    const command = /^npm run\s+(\S+)/.exec(token);
    if (command !== null) {
      const script = command[1] ?? "";
      if (scripts.includes(script)) return null;
      continue;
    }
    if (COMMAND.test(token)) return null;

    if (PATH_WITH_DIRECTORY.test(token)) {
      try {
        readFileSync(`${ROOT}${token}`, "utf8");
        return null;
      } catch {
        // A path anchor that does not resolve is the one failure this guard exists to catch, so it
        // is reported below rather than passed over - and it says which path, because "the status
        // has no anchor" and "the status cites a file that is not there" are different defects.
        return `cites \`${token}\`, and no such file exists under the repository root`;
      }
    }
    if (BARE_FILE_NAME.test(token) && fileNames.has(basename(token))) return null;
  }

  return (
    "names no anchor: a status is measured against something, so it has to say what - a path with a " +
    "slash in it, a bare file name, or a command (`npm run <script>`, `node ...`, `npx ...`)"
  );
}

const PHASE_FILES = readdirSync(PHASES).filter((entry) => PHASE_FILE.test(entry)).sort();

test("reads the phase files it claims to police", () => {
  // A guard that walked the wrong directory, or a directory that lost its files, would pass the
  // assertion below by having nothing to assert - which is the vacuous pass this control exists for.
  assert.ok(
    PHASE_FILES.length >= 13,
    `docs/phases/ holds ${String(PHASE_FILES.length)} phase files, and this guard is written to read ` +
      "every one of them: a walk that found fewer is a walk that has stopped covering the program",
  );
  assert.ok(
    PHASE_FILES.some((file) => statusCellOf(file)?.includes("built") === true),
    "no phase file states a status containing `built`, so the convention this guard reads is not the " +
      "one the files use and it is policing a vocabulary nobody writes",
  );
});

test("exercises every anchor shape it recognises", () => {
  const scripts = npmScripts();
  const fileNames = everyFileName();
  const kinds = { path: 0, command: 0 };

  for (const file of PHASE_FILES) {
    const cell = statusCellOf(file);
    if (cell === null) continue;
    for (const match of cell.matchAll(BACKTICKED)) {
      const token = match[1] ?? "";
      if (COMMAND.test(token) || /^npm run\s+\S+/.test(token)) kinds.command += 1;
      else if (PATH_WITH_DIRECTORY.test(token) || (BARE_FILE_NAME.test(token) && fileNames.has(basename(token)))) {
        kinds.path += 1;
      }
    }
    void scripts;
  }

  assert.ok(kinds.path > 0, "no phase status cites a path, so the path half of this guard is not exercised");
  assert.ok(
    kinds.command > 0,
    "no phase status cites a command, so the command half of this guard is not exercised",
  );
});

test("every phase's status names the anchor it was measured against", () => {
  const scripts = npmScripts();
  const fileNames = everyFileName();

  for (const file of PHASE_FILES) {
    const cell = statusCellOf(file);
    assert.notEqual(cell, null, `${file} has no \`| **Status** |\` cell, so its status is stated nowhere`);
    const problem = anchorProblem(cell ?? "", scripts, fileNames);
    assert.equal(
      problem,
      null,
      `${file}'s status ${problem ?? ""}. A status that names its anchor can be re-taken by the next ` +
        "session; a status that names none is a sentence, and this program has already paid for the " +
        "difference once - phase 06's row and its cell agreed with each other and both were false.",
    );
  }
});

test("the control can fail, which is the only thing that makes the assertion above worth having", () => {
  // The guard's own probe, kept as a test rather than as a comment: a cell with no anchor is reported,
  // a path that does not resolve is reported, and a real path is accepted. Without this, a rule that
  // returned `null` unconditionally would look identical to a rule that works.
  const scripts = npmScripts();
  const fileNames = everyFileName();

  assert.match(
    anchorProblem("built -- the guards are green", scripts, fileNames) ?? "",
    /names no anchor/,
  );
  assert.match(
    anchorProblem("built -- see `core/metrics/nowhere-at-all.ts`", scripts, fileNames) ?? "",
    /no such file exists/,
  );
  assert.equal(anchorProblem("built -- see `core/metrics/eli.ts`", scripts, fileNames), null);
  assert.equal(anchorProblem("built -- `npm run gate` exits 0", scripts, fileNames), null);
  assert.match(
    anchorProblem("built -- `npm run does-not-exist`", scripts, fileNames) ?? "",
    /names no anchor/,
    "a command anchor is resolved against the manifest: a status citing a script nobody declared is " +
      "a status citing a command that cannot be run, and accepting it would make the command shape a " +
      "pattern rather than a check",
  );
  assert.equal(anchorProblem("built -- see `result.schema.json`", scripts, fileNames), null);
});
