#!/usr/bin/env node
/**
 * The external repair agent.
 *
 * Veridian never repairs anything. It hands the failure to a program the operator supplied, and this is
 * that program for this demo: a separate OS process, spawned by the CLI's repair gate with three
 * environment variables and no other channel.
 *
 * ## The protocol it speaks
 *
 *   VERIDIAN_RESULT          the path to `result.json` for the iteration that just failed
 *   VERIDIAN_FAILURE_REPORT  the path to `latest-failure.md`, the human-readable digest
 *   VERIDIAN_ITERATION       which iteration it is being asked about
 *
 * Exit 0 means "I changed something, evaluate again". Any non-zero exit stops the loop, which is why
 * "there is nothing left to repair" is a 1 rather than a 0: reporting a repair that did not happen
 * would spend an iteration and teach the run nothing.
 *
 * ## What it actually does
 *
 * It prints the first lines of the failure report - the part of the protocol a real agent would reason
 * from - and then repairs the **first still-injected defect in criterion order**. It does not parse the
 * report to choose a defect, and it says so rather than implying otherwise: the demo's defect table is
 * what knows which defect is present, and a markdown parser here would be a second opinion that could
 * disagree with the table. What this program demonstrates is the *protocol* - an external process
 * receiving a failure, editing the application, and reporting what it changed - not an LLM's reasoning,
 * which Veridian deliberately does not contain (AGENTS.md, governing principle 2).
 *
 * `--restore` undoes every defect and exits, which is what `npm run demo:k8s -- --restore-only` uses
 * and what a developer runs after interrupting a demo mid-iteration.
 */

import { readFileSync } from "node:fs";

import { repairOne, status } from "./defects.ts";
import { readManifests, restoreAll, writeChanged } from "./manifests.ts";

const iteration = process.env["VERIDIAN_ITERATION"] ?? "?";

function log(line: string): void {
  process.stdout.write(`repair[iteration ${iteration}]: ${line}\n`);
}

/** Print the head of the failure report, which is the input a reasoning agent would work from. */
function report(): void {
  const path = process.env["VERIDIAN_FAILURE_REPORT"] ?? "";
  if (path === "") {
    log("no failure report was provided, so this iteration works from the defect table alone");
    return;
  }
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    log(`the failure report at ${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 12);
  for (const line of lines) log(line);
}

function main(): number {
  if (process.argv.slice(2).includes("--restore")) {
    const repaired = restoreAll();
    log(repaired.length === 0 ? "nothing was injected, so there is nothing to restore" : `restored: ${repaired.join(", ")}`);
    return 0;
  }

  const files = readManifests();
  report();

  const outcome = repairOne(files);
  const repaired = outcome.repaired;
  if (repaired === null) {
    log("nothing left to repair, so this iteration makes no change");
    return 1;
  }

  const written = writeChanged(files, outcome.files);
  if (written.length === 0) {
    log(`chose to repair ${repaired.defect.id} but nothing on disk needed writing`);
    return 1;
  }

  // Verify before announcing. A repair that is reported and not made is worse than no repair, because
  // the next iteration is spent re-observing a defect the agent believes it has already fixed.
  const verified = status(readManifests()).find((entry) => entry.defect.id === repaired.defect.id);
  if (verified?.state !== "intact") {
    log(`repaired ${repaired.defect.id} in ${written.join(", ")} and could not verify it: state is ${String(verified?.state)}`);
    return 1;
  }

  log(`repaired ${repaired.defect.id} in ${written.join(", ")}: ${repaired.defect.summary}`);
  return 0;
}

process.exitCode = main();
