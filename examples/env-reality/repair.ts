#!/usr/bin/env node
/**
 * The external agent, standing in for a coding agent, in the env-reality demo.
 *
 * Veridian does not repair anything: it decides whether the software works. Repair is the client's job,
 * so this is an ordinary process invoked through `--repair node <this file>`, and the protocol between
 * them is the exit code - zero means "I changed something, observe the world again", non-zero means "I
 * did not". Nothing here speaks a private dialect to the loop.
 *
 * What it reads is the point:
 *
 *   VERIDIAN_RESULT          the run's `result.json` (every criterion, its status, its assertions)
 *   VERIDIAN_FAILURE_REPORT  `.veridian/latest-failure.md` (the same failures, written for a reader)
 *   VERIDIAN_ITERATION       1-based iteration number
 *
 * So it *learns why it was invoked by reading a file*, exactly as an external agent must.
 *
 * ## What is different about this one, and it is the whole subject of the example
 *
 * Every other demo's repair is chosen from a defect table because the failing criterion names a line the
 * program printed. Here the report can be read against the **world's own reading** as well, and that is
 * a cross-check no other example has: `process.environment` appears in the same `result.json` beside the
 * program's stdout, so the agent is handed the world's crawl and the program's census at once.
 *
 * The three defects are all inside one function, so this agent's report will show one criterion
 * collapsing under two edits and another failing only because a document was never written. It reads
 * that rather than choosing from it - the choice below is deterministic, first-in-table-order, because a
 * repair that fixed all three at once would skip the intermediate runs that show the criteria being
 * judged independently.
 *
 * ## What it cannot fix
 *
 * AC-002, AC-003 and AC-004. Those judge `process.environment` - the crawl the world took of the map it
 * handed the child - and no edit to a program overlay can move them, because the map was built before
 * the program existed. So if a run ever fails on one of those three, this agent has nothing to offer and
 * says so by exiting non-zero: it is a defect in the *world*, and the honest response is a failure
 * rather than a repair.
 *
 * Usage:
 *   node repair.ts              repair the next defect; exit 1 if none is left
 *   node repair.ts --restore    re-inject all three defects, so the demo can be run again
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const programPath = fileURLToPath(new URL("./app/env-probe.mjs", import.meta.url));
const iteration = process.env["VERIDIAN_ITERATION"] ?? "?";
const failureReport = process.env["VERIDIAN_FAILURE_REPORT"] ?? "";
const resultPath = process.env["VERIDIAN_RESULT"] ?? "";

function log(line: string): void {
  process.stdout.write(`repair[iteration ${iteration}]: ${line}\n`);
}

/**
 * Read the artifacts Veridian produced, and say what they say.
 *
 * Printed rather than used to choose a fix. Choosing from the report would make the demo's repair order
 * depend on how the report happens to be worded, and the demo would then be testing its own phrasing.
 */
async function report(): Promise<void> {
  if (resultPath !== "") log(`result: ${resultPath}`);
  if (failureReport === "") {
    log("no failure report was handed over; repairing from the defect table alone");
    return;
  }
  try {
    const markdown = await readFile(failureReport, "utf8");
    log(`reading ${failureReport}`);
    for (const line of markdown.split("\n").slice(0, 12)) {
      if (line.trim() !== "") log(`  | ${line}`);
    }
  } catch (error) {
    log(`could not read ${failureReport}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const body = await readFile(programPath, "utf8");

  if (argv.includes("--restore")) {
    const { text, injected, alreadyInjected } = inject(body);
    await writeFile(programPath, text, "utf8");
    log(`restored ${String(injected.length)} defect(s): ${injected.join(", ") || "(already present)"}`);
    if (alreadyInjected.length > 0) log(`already injected: ${alreadyInjected.join(", ")}`);
    return 0;
  }

  await report();

  const failing = status(body).filter((entry) => entry.state === "injected");
  if (failing.length === 0) {
    const unknown = status(body)
      .filter((entry) => entry.state === "unknown")
      .map((entry) => entry.defect.id);
    log(
      unknown.length > 0
        ? `nothing to repair, and env-probe.mjs is not in a recognised state for: ${unknown.join(", ")}`
        : "nothing left to repair, so this iteration makes no change",
    );
    return 1;
  }

  const { text, repaired } = repairOne(body);
  if (repaired === null) {
    log("nothing left to repair, so this iteration makes no change");
    return 1;
  }

  await writeFile(programPath, text, "utf8");
  log(`fixed ${repaired.id} (${repaired.criterionId}): ${repaired.summary}`);
  log(`still injected after this repair: ${String(failing.length - 1)} defect(s); the world is restarted`);
  if (repaired.criterionId.startsWith("AC-00") && ["AC-002", "AC-003", "AC-004"].includes(repaired.criterionId)) {
    log("note: that criterion judges the world's own crawl, which this program cannot reach");
  }
  return 0;
}

log(`defect table: ${DEFECTS.map((defect) => `${defect.id}->${defect.criterionId}`).join(" ")}`);
process.exitCode = await main();
