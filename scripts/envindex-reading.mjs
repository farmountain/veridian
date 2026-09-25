#!/usr/bin/env node
/**
 * Take the environment index over the runs actually on disk.
 *
 * The question this answers is the one no bundle could answer before the `process.environment` seam
 * existed: **what could the applications these runs judged actually see?** A bundle's `env` block is
 * the world's *declaration* - the two or three names its document set - and a reader who finds only
 * that block reasonably concludes that is what the application could read. Measured on this machine,
 * an application under a two-name declaration could see eighty-four names, five of them
 * credential-shaped and all five populated.
 *
 * Like `scripts/denv-reading.mjs`, this is a **command a reader re-runs** rather than a unit test,
 * and for the same reason: `.veridian/` is gitignored, holds zero committed files, and every test over
 * a run history in this tree builds one in memory. A test asserting this reading over `.veridian/runs`
 * would pass on this machine and fail on a fresh clone, which is a check that reports the checkout
 * rather than the code.
 *
 * ## What it fails on, and what it deliberately does not
 *
 * **An inherited credential is a reading, not a failure.** It reports what a run permitted, and a
 * history full of `inherit` worlds reporting inherited credentials is this instrument working: the
 * default mode has always been to hand the child the operator's environment, and the point of
 * measuring is to make that visible rather than to make it red.
 *
 * What it **does** fail on is the control - *an empty index is satisfied by a function that reads
 * nothing*, so a run over a missing directory would report every subject clean while examining no
 * bundle at all. The control asserts that the directory yielded rows, and that at least one row
 * yielded a crawl, which is the known-present discipline the sibling script established.
 *
 * Usage: `node scripts/envindex-reading.mjs [state-dir]` (default `.veridian`).
 */

import { fileURLToPath } from "node:url";

import { nodeIo } from "../core/io.ts";
import { listEnvIndex } from "../core/metrics/index.ts";

const stateDir = process.argv[2] ?? ".veridian";
const io = nodeIo();
const report = await listEnvIndex(io, stateDir);

/** Wide enough for the longest subject in this repository, and spelled once. */
const pad = (text, width) => text.padEnd(width);

process.stdout.write(`\nEnvironment index - state dir: ${stateDir}\n`);
const rows = report.groups.reduce((total, group) => total + group.runs.length, 0);
process.stdout.write(`subjects: ${String(report.groups.length)}\n`);
process.stdout.write(`runs carrying a crawl: ${String(rows)}\n`);
process.stdout.write(
  `runs whose environment document carried NO crawl: ${String(report.runsWithoutReading.length)}\n`,
);
if (report.runsWithoutReading.length > 0) {
  process.stdout.write(
    "  (a bundle written before the crawler existed, or a world that started no child - " +
      "counted as unmeasured, never as clean)\n",
  );
  for (const runId of report.runsWithoutReading.slice(0, 5)) process.stdout.write(`  ${runId}\n`);
  if (report.runsWithoutReading.length > 5) {
    process.stdout.write(`  ... and ${String(report.runsWithoutReading.length - 5)} more\n`);
  }
}
process.stdout.write("\n");

process.stdout.write(
  `${pad("subject", 34)} ${pad("runs", 5)} ${pad("mode", 10)} ${pad("visible", 8)} ${pad("creds", 6)} ${pad("undeclared", 11)}\n`,
);

let undeclaredRuns = 0;
const union = new Set();
for (const group of report.groups) {
  undeclaredRuns += group.runsWithInheritedCredentials;
  for (const name of group.inheritedCredentialNames) union.add(name);
  const visible = group.runs.length === 0 ? "-" : String(Math.max(...group.runs.map((run) => run.visible)));
  process.stdout.write(
    `${pad(group.subject, 34)} ${pad(String(group.runs.length), 5)} ${pad(group.modes.join("+") || "-", 10)} ${pad(visible, 8)} ${pad(String(group.credentialNames.length), 6)} ${pad(String(group.runsWithInheritedCredentials), 11)}\n`,
  );
}

process.stdout.write("\n");
if (union.size > 0) {
  process.stdout.write(`credential-shaped names no world declared, across every subject:\n`);
  for (const name of [...union].sort()) process.stdout.write(`  ${name}\n`);
} else {
  process.stdout.write("no subject gave its application an undeclared credential-shaped name.\n");
}
process.stdout.write(`\nruns that handed over an undeclared credential: ${String(undeclaredRuns)}\n`);

// The control. An index that read nothing reports every subject clean, so a reading that examined no
// bundle and a history that is genuinely clean must not be able to print the same thing.
const measured = report.groups.filter((group) => group.runs.length > 0).length;
if (measured === 0) {
  process.stdout.write(
    "\nCONTROL FAILED: not one subject yielded a run carrying a crawl, so this reading examined " +
      "nothing and its emptiness is not a finding.\n",
  );
  process.exit(1);
}
process.stdout.write(`CONTROL OK: ${String(measured)} subject(s) yielded a crawl to read.\n`);

// The path is printed rather than assumed so a reader can re-run the command themselves.
const scriptPath = fileURLToPath(import.meta.url);
process.stdout.write(`\nre-run: node ${scriptPath} ${stateDir}\n`);
