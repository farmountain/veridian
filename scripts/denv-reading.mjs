#!/usr/bin/env node
/**
 * Take the dENV reading over the runs actually on disk.
 *
 * `AC-5` states dENV as *"empty across a clean reset"*, and the phase that carries it asks for the
 * reading to be taken **on this repository's own bundles rather than on a fixture**. That request
 * cannot be answered by a unit test, and the reason is worth writing down rather than discovering
 * again: `.veridian/` is gitignored, holds zero committed files, and every test over a run history
 * in this tree builds one in memory through `memoryIo`. A test asserting a delta over
 * `.veridian/runs` would pass on this machine and fail on a fresh clone, which is a check that
 * reports the checkout rather than the code.
 *
 * So the reading is a **command a reader re-runs**, in the shape the repository already uses for
 * measurements that CI cannot reach - `scripts/acceptance.mjs`, `scripts/ladder.mjs`,
 * `scripts/mcp-smoke.mjs`. The function it calls is the same one the committed suite exercises over
 * fixtures, so the two readings cannot disagree about the rule and can only disagree about the data.
 *
 * ## What this script fails on, and what it deliberately does not
 *
 * A **non-empty delta is a reading, not a failure.** The measurement below shows several subjects
 * whose pairs differ on `boundary`, `app_path` or `world`, and those differences are contract drift
 * and the operator's checkout rather than a world that failed to come back - which is why AC-5 scopes
 * the *empty* claim to a single subject rather than taking it across subjects. Exiting non-zero on
 * those would make a green history report red, which is the precise defect
 * `docs/INSTRUMENT-AND-PROMPT-PLAN.md` found in M3.
 *
 * What it **does** fail on is the control. *An empty delta is satisfied by a function that compares
 * nothing*, so a reading taken over a missing or empty directory would report every subject clean
 * while comparing no pairs at all. The control asserts that the directory yielded subjects, and that
 * at least one of them yielded a pair - the same known-present discipline the predicate's own test
 * uses, asked of the data rather than of the fixture.
 *
 * Usage: `node scripts/denv-reading.mjs [state-dir]` (default `.veridian`).
 */

import { fileURLToPath } from "node:url";

import { nodeIo } from "../core/io.ts";
import { listEliEnvDeltas } from "../core/metrics/index.ts";

const repo = fileURLToPath(new URL("..", import.meta.url));
const stateDir = process.argv[2] ?? ".veridian";

const io = nodeIo(repo);
const report = await listEliEnvDeltas(io, stateDir);

const rows = report.groups.map((group) => ({
  subject: group.subject,
  runs: group.runIds.length,
  pairs: group.pairsCompared,
  nonEmpty: group.nonEmptyPairs,
  moving: group.movingKeys.join(","),
}));

console.log(`dENV reading - state dir: ${stateDir}`);
console.log(`subjects: ${String(rows.length)}`);
console.log(`runs whose environment document could not be read: ${String(report.unreadableEnvironments.length)}`);
if (report.unreadableEnvironments.length > 0) {
  console.log(`  ${report.unreadableEnvironments.join(", ")}`);
}
console.log("");
console.log("subject | runs | pairs | nonEmptyPairs | movingKeys");
for (const row of rows) {
  console.log(
    `${row.subject} | ${String(row.runs)} | ${String(row.pairs)} | ${String(row.nonEmpty)} | ${row.moving}`,
  );
}
console.log("");

const compared = rows.reduce((sum, row) => sum + row.pairs, 0);

/**
 * The control. Both halves are needed: `subjects > 0` says the directory is a runs directory, and
 * `compared > 0` says at least one subject held two readable runs. Without the second, a history
 * whose every subject held one run would print a clean table over zero comparisons - which is the
 * shape of a green reading that measured nothing.
 */
const problems = [];
if (rows.length === 0) {
  problems.push(
    `${stateDir} yielded no subjects at all, so every row above is absent rather than clean. ` +
      `Either the path is wrong or that history is empty.`,
  );
} else if (compared === 0) {
  problems.push(
    `${stateDir} yielded ${String(rows.length)} subject(s) and zero pair(s) to compare, so the ` +
      `empty deltas this script would report are the emptiness of a function that compared nothing.`,
  );
}

if (problems.length > 0) {
  console.error("CONTROL FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`pairs compared: ${String(compared)}`);
console.log("CONTROL OK: the directory yielded subjects and at least one pair to compare.");
