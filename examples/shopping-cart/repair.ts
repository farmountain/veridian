#!/usr/bin/env node
/**
 * The external agent, standing in for a coding agent, in the canonical demo.
 *
 * Veridian does not repair anything: it decides whether the software works. Repair is the client's
 * job, so the demo's repair step is an ordinary process invoked through
 * `--repair node examples/shopping-cart/repair.ts`. The protocol between them is the exit code -
 * zero means "I changed something, observe the application again", non-zero means "I did not" - so
 * nothing here needs to speak a private dialect to the loop.
 *
 * What this script reads is the point of the demo's second half. All Veridian hands over is the
 * environment:
 *
 *   VERIDIAN_RESULT          the run's `result.json` (every criterion, its status, its assertions)
 *   VERIDIAN_FAILURE_REPORT  `.veridian/latest-failure.md` (the same failures, written for a reader)
 *   VERIDIAN_ITERATION       1-based iteration number
 *
 * So this script *learns why it was invoked by reading a file*, exactly as an external agent would.
 * The choice of which defect to fix is then deterministic - the first one still present, in
 * criterion order - because a repair that fixed all three defects at once would skip the
 * intermediate runs that show the criteria being judged independently.
 *
 * Usage:
 *   node repair.ts              repair the next defect; exit 1 if none is left
 *   node repair.ts --restore    re-inject all three defects, so the demo can be run again
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const cartPath = fileURLToPath(new URL("./app/cart.js", import.meta.url));
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
 * phrasing. Reading it out is enough to show it is both present and legible - which is what M5
 * (evidence completeness) and the whole "the agent reads the result, not the harness" claim need.
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
  const body = await readFile(cartPath, "utf8");

  if (argv.includes("--restore")) {
    const { text, injected, alreadyInjected } = inject(body);
    await writeFile(cartPath, text, "utf8");
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
        ? `nothing to repair, and cart.js is not in a recognised state for: ${unknown.join(", ")}`
        : "nothing left to repair, so this iteration makes no change",
    );
    return 1;
  }

  const { text, repaired } = repairOne(body);
  if (repaired === null) {
    log("nothing left to repair, so this iteration makes no change");
    return 1;
  }

  await writeFile(cartPath, text, "utf8");
  log(`fixed ${repaired.id} (${repaired.criterionId}): ${repaired.summary}`);
  log(`still injected after this repair: ${String(failing.length - 1)} defect(s); the run observes again`);
  return 0;
}

log(`defect table: ${DEFECTS.map((defect) => `${defect.id}->${defect.criterionId}`).join(" ")}`);
process.exitCode = await main();
