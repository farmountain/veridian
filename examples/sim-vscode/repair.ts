/**
 * The external repair agent: what an AI coding agent stands in for during the demo.
 *
 * It is deliberately *outside* Veridian. It is handed a goal, a failure report and an iteration number,
 * and it edits the application's own source with no other channel to the engine - which is the whole
 * separation the product rests on: `Agent = Actor`, `Veridian Environment = World`,
 * `Validator = Judge`. Nothing here decides whether the repair worked; the contract does, on the next
 * iteration, by reading the world again - which for this world means a fresh set of host processes,
 * because there is no editor here to keep an extension resident in.
 *
 * ## The only channel
 *
 * The loop hands over three environment variables and nothing else:
 *
 *   - `VERIDIAN_RESULT` - the path to the run's `result.json` so far.
 *   - `VERIDIAN_FAILURE_REPORT` - the path to `latest-failure.md`, the human-readable rendering.
 *   - `VERIDIAN_ITERATION` - which iteration this is, so the transcript can be read in order.
 *
 * This agent reads the failure report and the iteration number and **not** `result.json`. That is a
 * choice with a reason: the report is the rendering a human would read, and an agent that parsed the
 * structured result would be a second implementation of the diagnosis, so a demo of *this* agent would
 * be proving that a reader of `result.json` works rather than that the loop's feedback is usable. The
 * variable is still named here, because a reader comparing the two sides should be able to see which of
 * the three channels this program chose and be able to disagree with the choice.
 *
 * ## The exit protocol
 *
 * `0` means "I changed something, evaluate again". Any non-zero exit stops the loop. That is why the
 * two "nothing to do" paths below return `1` rather than `0`: a loop that kept iterating on an agent
 * that had nothing left to do would spend its iteration budget proving the same thing, and the ceiling
 * would arrive as `MAX_ITERATIONS` instead of as the success it actually was.
 *
 * ## What it repairs, and what it refuses to do
 *
 * It repairs **the first still-injected defect in criterion order**, one per iteration - AC-014, then
 * AC-015, then AC-016, then AC-017. It does not parse the failure report to decide which one: the
 * report is printed, for the transcript, and the defect table decides. The reason is stated rather than
 * hidden - a demo agent that read the report would be a second implementation of the diagnosis, and the
 * demo would then be proving that a hard-coded table works, which is not the claim. One defect per
 * iteration is also what makes the progression a diagnosis rather than a batch edit: iteration three's
 * report is what iteration two's repair left behind.
 *
 * ## What the first repair is, and why the report alone does not name it
 *
 * `D1`'s consequences include two criteria that other defects are also filed against - a cart that is
 * never written back makes the status text and the channel's running count wrong, and both of those
 * surfaces have a defect of their own in this table. So iteration one's report names more failures than
 * there are defects, and an agent that repaired whichever criterion it read first would repair a
 * symptom instead of the cause. Walking the table in criterion order is what makes the first repair the
 * widest one, so the failures shrink by one criterion per iteration after it rather than in a batch.
 *
 * It verifies each repair before announcing it. A function that edits a file must not report a repair
 * it has not confirmed, and `status` re-reads the text it just wrote rather than trusting the return
 * value of the edit. That matters here because `D2`'s block is two lines: a repair that matched the
 * channel line and left the `const limit` line behind would report itself fixed while having edited
 * nothing, since `injectDefects` counts occurrences of a block rather than lines.
 */

import { readFileSync } from "node:fs";

import { EXTENSION_FILE, repairOne, status } from "./defects.ts";
import { readExtension, restoreAll, writeChanged } from "./source.ts";

const iteration = process.env["VERIDIAN_ITERATION"] ?? "?";

function log(line: string): void {
  process.stdout.write(`repair[iteration ${iteration}]: ${line}\n`);
}

/** Print the head of the failure report, so the transcript shows what this iteration was told. */
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
    log(
      `the failure report at ${path} could not be read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 12);
  for (const line of lines) log(line);
}

function main(): number {
  if (process.argv.slice(2).includes("--restore")) {
    const repaired = restoreAll();
    log(repaired.length === 0 ? `${EXTENSION_FILE} was already correct` : `restored: ${repaired.join(", ")}`);
    return 0;
  }

  const before = readExtension();
  report();

  const outcome = repairOne(before);
  const repaired = outcome.repaired;
  if (repaired === null) {
    log("nothing left to repair, so this iteration makes no change");
    return 1;
  }

  const written = writeChanged(before, outcome.text);
  if (written.length === 0) {
    log(`chose to repair ${repaired.id} but nothing on disk needed writing`);
    return 1;
  }

  const verified = status(readExtension()).find((entry) => entry.defect.id === repaired.id);
  if (verified?.state !== "intact") {
    log(
      `repaired ${repaired.id} in ${written.join(", ")} and could not verify it: ` +
        `state is ${String(verified?.state)}`,
    );
    return 1;
  }

  log(`repaired ${repaired.id} in ${written.join(", ")}: ${repaired.summary}`);
  return 0;
}

process.exitCode = main();
