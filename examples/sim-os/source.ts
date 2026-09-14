/**
 * Reading, comparing and writing the one file the defects live in.
 *
 * Two programs edit this file - the demo, which injects, and the repair agent, which repairs - so there
 * is **one** implementation of undoing a defect (`repairOne`, in `defects.ts`) and **one** of putting
 * the tree back (`restoreAll`, here). `examples/shopping-cart/demo.ts` taught this project what a
 * second copy costs: it carried its own replacement, left a defect injected, and still printed
 * "restored the correct app", which is the exact failure `repairOne` was extracted to make impossible.
 *
 * The file is `app/provision.mjs`, and there is exactly one of it for this world rather than one per
 * family. The world can stand in for two families; the application cannot, and it says so itself -
 * `provision.mjs` refuses to run for a family it does not provision. A second provisioning program for
 * macOS would be a second application, and a demo that injected the same defect into two programs would
 * be two chances to teach the injection rule differently.
 *
 * ## Writing is derived from comparing, not from intent
 *
 * `writeChanged` writes only when the text actually differs, and reports what it wrote rather than what
 * it intended to write. A function that edits a file must not announce a change it has not confirmed -
 * and a demo that printed "injected 4 defects" after four no-op writes would be reporting a run's
 * inputs from its own intentions instead of from the tree the run was judged in.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFECTS, PROVISION_FILE, repairOne, status } from "./defects.ts";

/** The application directory, relative to this module. One level down is where `environment.yaml`'s `app:` points. */
export const APP_DIR = new URL("./app/", import.meta.url);

/** The file the defects live in. Derived from the container, so there is one place to change if it moves. */
export const PROVISION_URL = new URL(PROVISION_FILE, APP_DIR);

/** The provisioning program's own text, as this machine stores it - CRLF included, if that is how it is checked out. */
export function readProvision(): string {
  return readFileSync(fileURLToPath(PROVISION_URL), "utf8");
}

/**
 * Write `after` only if it differs from `before`, and return the files actually written.
 *
 * The comparison is the whole of the contract: a `before` already equal to `after` writes nothing and
 * reports nothing, so a caller can assert on the returned list instead of asserting on its own
 * intention. The list is a list rather than a boolean because the demo and the repair agent both say
 * *which* file they touched, and a message that names the file is the one a reader can check.
 */
export function writeChanged(before: string, after: string): readonly string[] {
  if (after === before) return [];
  writeFileSync(fileURLToPath(PROVISION_URL), after, "utf8");
  return [PROVISION_FILE];
}

/**
 * Undo every injected defect, and refuse to report success if anything is left.
 *
 * Bounded by `DEFECTS.length` rather than a `while (true)`: a repair loop that cannot terminate is a
 * loop that would hang a demo instead of failing it, and the count of defects is the honest upper
 * bound on the number of repairs that can be needed.
 *
 * The final `status` check is the part that matters. `repairOne` returns which defect it repaired, so a
 * caller could simply trust the count - and the count would be right up until the day a block stopped
 * matching the file. Reading the file back and naming what is still injected is what turns "I ran four
 * repairs" into "the tree is clean", which is the only one of the two this demo is allowed to print.
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
