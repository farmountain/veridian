/**
 * Where this demo's manifests live, and the one implementation of "write back what actually changed".
 *
 * The demo and the repair agent both edit the application's own files, and both are run as separate
 * processes: the demo injects defects and reads them back, and the CLI spawns the repair agent as a
 * child so that the repair is done by something external to Veridian - which is the whole premise of
 * the product. Two programs editing the same two files is exactly the situation where a second copy of
 * "repair the first defect, then write the file" goes wrong: the copies would disagree about which
 * file changed, and the disagreement would look like a defect that keeps coming back.
 *
 * So there is one `repairOne` (in `defects.ts`) and one `restoreAll` (here), and both the demo and the
 * agent call them rather than re-implementing either.
 *
 * ## Writing is derived from comparing, not from intent
 *
 * `writeChanged` compares the text it was given against the text on disk and writes only what differs.
 * A helper that wrote whatever its caller said had changed would announce edits the caller merely
 * intended - and this project has already paid for that once: `examples/shopping-cart/demo.ts` had its
 * own copy of a replacement, left a defect injected, and still printed that it had restored the
 * correct app. A function that changes a file must not announce a change it has not verified.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFECTS, DEPLOYMENT, MANIFEST_FILES, SERVICE, repairOne, status } from "./defects.ts";
import type { ManifestFile, ManifestText } from "./defects.ts";

/** The application directory, resolved against this module rather than the working directory. */
export const APP_DIR = new URL("./app/", import.meta.url);

/** The URL of one manifest file. */
export function manifestUrl(file: ManifestFile): URL {
  return new URL(file, APP_DIR);
}

/** The text of each manifest file, as it is on disk right now. */
export function readManifests(): ManifestText {
  // Both keys are written out rather than built from `MANIFEST_FILES`, so that a third file added to
  // the table fails to compile here instead of being silently read as `undefined`.
  const texts: Record<ManifestFile, string> = { [DEPLOYMENT]: "", [SERVICE]: "" };
  for (const file of MANIFEST_FILES) {
    texts[file] = readFileSync(fileURLToPath(manifestUrl(file)), "utf8");
  }
  return texts;
}

/**
 * Write every file whose text differs from `before`, and report which ones were written.
 *
 * The return value is the files *actually* written rather than the files the caller expected to
 * change, which is the difference between a receipt and a claim.
 */
export function writeChanged(before: ManifestText, after: ManifestText): readonly string[] {
  const written: string[] = [];
  for (const file of MANIFEST_FILES) {
    if (after[file] !== before[file]) {
      writeFileSync(fileURLToPath(manifestUrl(file)), after[file], "utf8");
      written.push(file);
    }
  }
  return written;
}

/**
 * Undo every defect this demo injects, and refuse to report success unless the files really say so.
 *
 * Bounded by the size of the defect table: `repairOne` repairs exactly one defect per call, so a table
 * of two defects cannot need a third call. The `status` check afterwards is what makes the bound safe
 * rather than lucky - if anything is still injected, or if a block has become ambiguous, this throws
 * instead of leaving a defect in the tree for the next command to trip over.
 */
export function restoreAll(): readonly string[] {
  let files = readManifests();
  const repaired: string[] = [];
  for (let step = 0; step < DEFECTS.length; step += 1) {
    const outcome = repairOne(files);
    if (outcome.repaired === null) break;
    repaired.push(`${outcome.repaired.defect.id} in ${outcome.repaired.file}`);
    files = outcome.files;
  }
  writeChanged(readManifests(), files);

  const stranded = status(files).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    throw new Error(
      `the application still carries ${String(stranded.length)} injected defect(s) after restoring: ` +
        stranded.map((entry) => `${entry.defect.id} in ${entry.file} is ${entry.state}`).join(", "),
    );
  }
  return repaired;
}
