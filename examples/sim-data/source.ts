/**
 * Reading, writing and restoring the one file this demo's defects live in.
 *
 * The application is a real program and the demo edits it by hand - `defects.ts` holds the blocks, this
 * file holds the I/O. Keeping them apart is what lets the table be tested against synthetic text and the
 * I/O be tested against the real artifact, which are two different questions: a table can be internally
 * consistent and still name a file the demo does not ship.
 *
 * ## Why every write reports which files changed, and refuses when nothing did
 *
 * `writeChanged` returns the names it changed, and an empty list when the text it was handed is
 * byte-identical to what is on disk. That is not bookkeeping. This repository has paid three times for a
 * function that edited a file and announced a change it had not made - once in the canonical demo, which
 * left a defect injected and printed "restored the correct app". A write that lands nowhere has to be
 * visible at the call site, and the cheapest way to make it visible is to return the evidence the caller
 * would otherwise have to assume.
 *
 * ## Why `restoreAll` throws rather than reporting
 *
 * It repairs defects until `repairOne` finds none left, then re-classifies the file. If any defect is
 * still `injected`, or any is `unknown`, the restore did not do what its name says, and the demo must
 * fail before it starts rather than run against an application whose state nobody can name. A demo that
 * claims to inject three defects and starts from one is a demo whose progression means nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { DEFECTS, PROVISION_FILE, repairOne, status } from "./defects.ts";

/** The application directory, resolved from this module so the demo runs from any working directory. */
export const APP_DIR = new URL("./app/", import.meta.url);

/** The one editable artifact: the provisioning program the adapter starts as a child process. */
export const PROVISION_URL = new URL(PROVISION_FILE, APP_DIR);

/** The provisioning program as it is on disk, ending included. */
export function readProvision(): string {
  return readFileSync(PROVISION_URL, "utf8");
}

/**
 * Write `after` only if it differs from `before`, and name the file when it does.
 *
 * Conditional on purpose: an unconditional write would touch the file's mtime on every iteration and
 * make the demo's own transcript claim a change where there was none.
 */
export function writeChanged(before: string, after: string): readonly string[] {
  if (before === after) return [];
  writeFileSync(PROVISION_URL, after, "utf8");
  return [PROVISION_FILE];
}

/**
 * Repair every injected defect, in table order, and confirm the result.
 *
 * Returns the ids it repaired, in the order it repaired them. Throws if anything is left that is not
 * `intact`, because at that point the program on disk is not the program the demo's narration is about.
 */
export function restoreAll(): readonly string[] {
  let text = readProvision();
  const repaired: string[] = [];
  for (let step = 0; step < DEFECTS.length; step += 1) {
    const outcome = repairOne(text);
    if (outcome.repaired === null) break;
    text = outcome.text;
    repaired.push(outcome.repaired.id);
  }
  writeChanged(readProvision(), text);

  const stuck = status(text).filter((entry) => entry.state !== "intact");
  if (stuck.length > 0) {
    const named = stuck.map((entry) => `${entry.defect.id} is ${entry.state}`).join(", ");
    throw new Error(`could not restore ${PROVISION_FILE}: ${named}`);
  }
  return repaired;
}
