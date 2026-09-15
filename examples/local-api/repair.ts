#!/usr/bin/env node
/**
 * The external agent, standing in for a coding agent, in the API demo.
 *
 * Veridian does not repair anything: it decides whether the software works. Repair is the client's
 * job, so this is an ordinary process invoked through `--repair node <this file>`, and the protocol
 * between them is the exit code - zero means "I changed something, observe the world again", non-zero
 * means "I did not". Nothing here speaks a private dialect to the loop.
 *
 * What it reads is the point:
 *
 *   VERIDIAN_RESULT          the run's `result.json` (every criterion, its status, its assertions)
 *   VERIDIAN_FAILURE_REPORT  `.veridian/latest-failure.md` (the same failures, written for a reader)
 *   VERIDIAN_ITERATION       1-based iteration number
 *
 * So it *learns why it was invoked by reading a file*, exactly as an external agent must - and for
 * this world the report is unusually direct, because an `api.json` failure carries the pointer it
 * read, the value it found there and the value the contract stated. A reader does not have to infer
 * which price is wrong; the failure names the path inside the response body.
 *
 * The choice of which defect to fix is deterministic - the first one still present, in criterion
 * order - because a repair that fixed all four at once would skip the intermediate runs that show the
 * criteria being judged independently, including the two that share a defect.
 *
 * Usage:
 *   node repair.ts              repair the next defect; exit 1 if none is left
 *   node repair.ts --restore    re-inject all four defects, so the demo can be run again
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const servicePath = fileURLToPath(new URL("./app/server.mjs", import.meta.url));
const iteration = process.env["VERIDIAN_ITERATION"] ?? "?";
const failureReport = process.env["VERIDIAN_FAILURE_REPORT"] ?? "";
const resultPath = process.env["VERIDIAN_RESULT"] ?? "";

function log(line: string): void {
  process.stdout.write(`repair[iteration ${iteration}]: ${line}\n`);
}

/**
 * Read the artifacts Veridian produced, and say what they say.
 *
 * Printed rather than used to choose a fix. Choosing from the report would make the demo's repair
 * order depend on how the report happens to be worded, and the demo would then be testing its own
 * phrasing. Reading it out is enough to show it is present and legible - which is what M5 (evidence
 * completeness) and the "the agent reads the result, not the harness" claim need.
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
  const body = await readFile(servicePath, "utf8");

  if (argv.includes("--restore")) {
    const { text, injected, alreadyInjected } = inject(body);
    await writeFile(servicePath, text, "utf8");
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
        ? `nothing to repair, and server.mjs is not in a recognised state for: ${unknown.join(", ")}`
        : "nothing left to repair, so this iteration makes no change",
    );
    return 1;
  }

  const { text, repaired } = repairOne(body);
  if (repaired === null) {
    log("nothing left to repair, so this iteration makes no change");
    return 1;
  }

  await writeFile(servicePath, text, "utf8");
  log(`fixed ${repaired.id} (${repaired.criterionId}): ${repaired.summary}`);
  log(`still injected after this repair: ${String(failing.length - 1)} defect(s); the world is restarted`);
  return 0;
}

log(`defect table: ${DEFECTS.map((defect) => `${defect.id}->${defect.criterionId}`).join(" ")}`);
process.exitCode = await main();
