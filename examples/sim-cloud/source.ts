/**
 * Reading, writing and restoring the application's own provisioning program.
 *
 * Two programs edit this file - the demo, which injects, and the repair agent, which repairs - so there
 * is **one** implementation of undoing a defect (`repairOne`, in `defects.ts`) and **one** of putting the
 * tree back (`restoreAll`). A second copy is where the rule gets taught differently.
 *
 * It verifies before it announces. `restoreAll` re-reads the file after writing it and refuses to return
 * a list of repairs while any defect is still `injected` or `unknown`: a function that edits a file must
 * not report a change it has not confirmed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFECTS, PROVISION_FILE, repairOne, status } from "./defects.ts";

/** The application directory, so the file is named once whether it is read, written or reported. */
export const APP_DIR = new URL("./app/", import.meta.url);

export const PROVISION_URL = new URL(PROVISION_FILE, APP_DIR);

export function readProvision(): string {
  return readFileSync(fileURLToPath(PROVISION_URL), "utf8");
}

/**
 * Write the file if it changed, and report which files moved.
 *
 * An empty list means "this call changed nothing", which is a different fact from "the write failed" -
 * so the caller can tell a no-op iteration from an error without inspecting the filesystem.
 */
export function writeChanged(before: string, after: string): readonly string[] {
  if (after === before) return [];
  writeFileSync(fileURLToPath(PROVISION_URL), after, "utf8");
  return [PROVISION_FILE];
}

/**
 * Undo every defect, bounded by the table's own length.
 *
 * The bound is the table's length rather than a fixed number: `repairOne` repairs one per call, so a
 * table of four needs at most four calls, and a loop that could outlive its table would be a loop that
 * hangs on a table it cannot finish.
 */
export function restoreAll(): readonly string[] {
  const before = readProvision();
  let text = before;
  const repaired: string[] = [];
  for (let step = 0; step < DEFECTS.length; step += 1) {
    const outcome = repairOne(text);
    if (outcome.repaired === null) break;
    repaired.push(`${outcome.repaired.id} in ${PROVISION_FILE}`);
    text = outcome.text;
  }
  writeChanged(before, text);
  const stranded = status(text).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    throw new Error(
      `the provisioning program still carries ${String(stranded.length)} injected defect(s) after restoring: ` +
        stranded.map((entry) => `${entry.defect.id} in ${PROVISION_FILE} is ${entry.state}`).join(", "),
    );
  }
  return repaired;
}
