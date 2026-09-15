/**
 * The filesystem boundary for a process world.
 *
 * A port plus a single implementation over `node:fs`, in the same shape as `core/io.ts`,
 * `core/process.ts` and `adapters/local-db/database-port.ts`. The reason is the one all three give:
 * the adapter above it has to be provable without the thing underneath it, and a stronger isolation -
 * or a second filesystem - has exactly one place to land.
 *
 * ## Why this is not just `IoPort`
 *
 * `IoPort` was measured rather than assumed before this file was written. It has `readTextFile`,
 * `exists`, `writeTextFile` and `remove`, and **no `stat`**. So it can tell an adapter whether a path
 * is there and what text is in it, and cannot tell it three things this world's vocabulary asks for:
 * whether the entry is a file, a directory or a socket; how many bytes it holds; and whether the
 * bytes are text at all.
 *
 * The first and the last are not conveniences. `process.kind` is a criterion's *subject* - "the
 * program left a directory here and a file there" is a property of an application that a reader of
 * its source cannot check - and a `readTextFile` that returned `null` for a directory would let the
 * world report "absent" about a place that exists. That is the class of untrue reading this product
 * exists to make impossible, so the vocabulary carries `kind` and `bytes`, and this port is what can
 * fill them.
 *
 * ## What it deliberately does not do
 *
 * It does not write. The world never authors the application's output; the application does, through
 * the `run` steps the criterion performs and through the program the world starts. A probe that could
 * write would let an adapter fabricate the artifact it then judges, and no test would catch it because
 * the reading would be consistent with itself.
 *
 * It does not refuse an escaping path either. That decision belongs to
 * `core/environment/process-observation.ts`'s `processPath`, which is the one place the world's own
 * path grammar lives, and a second copy here would be a second grammar - the defect this repository
 * has recorded under the name of an environment predicate written twice.
 */

import { readFile, stat } from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProcessFileReading } from "../../core/environment/process-observation.ts";

/**
 * The largest file this world will read for a text comparison.
 *
 * 1 MiB, and it is a **refusal rather than a truncation**: a file beyond it gets `text: null` with a
 * stated reason, and `process.contents` answers `INCONCLUSIVE`. Handing a comparison the first
 * megabyte of a larger file would make `equals` false for a file that is right and `contains` true
 * for one that is wrong, and both of those are readings a criterion would act on.
 *
 * Exported so a test can assert the bound is a real one rather than re-typing the literal - a cap
 * nobody can read is a cap nobody can check.
 */
export const MAX_TEXT_BYTES = 1_048_576;

export interface FileProbeRequest {
  /**
   * The sandbox directory on this machine, as an absolute path the caller has already resolved.
   *
   * The adapter hands in `#hostRoot(block)`, which is the io port's `resolve` of the plan's `root` -
   * not `block.root` itself. The plan's field is the **resolved document spelling** (the loader
   * resolves every path a document declares against that document's base), so it is relative to the
   * io root, and joining it onto a root a second time here produced a doubled path. This seam takes
   * the accession, never the declaration; the declaration is what the *reading* records.
   */
  readonly root: string;
  /** The world-relative path, normalised by `processPath` - `/`-joined, with no leading separator. */
  readonly path: string;
}

export interface FileProbe {
  /**
   * Read one path inside the world's root.
   *
   * Answers; never throws for a condition the reading has a field for. An absent entry is a reading
   * (`exists: false`), not an error - "the program did not write this file" is the most common
   * genuine defect a criterion in this world finds, and an adapter that threw on it would report an
   * environment failure for an application failure.
   */
  read(request: FileProbeRequest): Promise<ProcessFileReading>;
}

/** The error code of a rejection, or `null` when it is not an error with one. */
function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * The one implementation.
 *
 * Every path is a real path on this machine, resolved by joining the already-validated relative
 * spelling onto the sandbox root. Nothing here is simulated, which is why the reading this fills
 * carries no `simulated` field: the file the criteria judge is the file the application wrote.
 */
export function nodeFileProbe(): FileProbe {
  return {
    async read({ root, path }: FileProbeRequest): Promise<ProcessFileReading> {
      // Split rather than joined as a single string so the `/` spelling the vocabulary normalises to
      // is turned into this platform's separators once, here, instead of in every caller.
      const host = nodePath.join(root, ...path.split("/"));

      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(host);
      } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          return { path, exists: false, kind: "absent", bytes: null, text: null, textWithheld: null };
        }
        // A permission refusal, a locking violation, a broken link target. Something *is* there and
        // this world could not classify it, so the reading says exactly that rather than claiming the
        // entry is absent - an absent entry is a repair an operator can make, and this is not one.
        return {
          path,
          exists: true,
          kind: "other",
          bytes: null,
          text: null,
          textWithheld: `this world could not read the entry (${code ?? "no error code"})`,
        };
      }

      if (info.isDirectory()) {
        return {
          path,
          exists: true,
          kind: "directory",
          bytes: null,
          text: null,
          textWithheld: "a directory holds entries rather than contents, so there is no text to compare",
        };
      }
      if (!info.isFile()) {
        return {
          path,
          exists: true,
          kind: "other",
          bytes: null,
          text: null,
          textWithheld: "the entry is neither a file nor a directory, so it has no text to compare",
        };
      }

      if (info.size > MAX_TEXT_BYTES) {
        return {
          path,
          exists: true,
          kind: "file",
          bytes: info.size,
          text: null,
          textWithheld:
            `the file is ${String(info.size)} bytes, beyond the ${String(MAX_TEXT_BYTES)} this world ` +
            "reads for comparison",
        };
      }

      let buffer: Buffer;
      try {
        buffer = await readFile(host);
      } catch (error) {
        return {
          path,
          exists: true,
          kind: "file",
          bytes: info.size,
          text: null,
          textWithheld: `this world could not read the file (${codeOf(error) ?? "no error code"})`,
        };
      }

      if (buffer.includes(0)) {
        // Measured on the bytes rather than on a decoded string: `toString("utf8")` replaces invalid
        // sequences with U+FFFD and a binary file read that way would look like text with a few odd
        // characters in it. Its size is still reported, so `process.size` remains answerable.
        return {
          path,
          exists: true,
          kind: "file",
          bytes: info.size,
          text: null,
          textWithheld: "the file holds NUL bytes, so it is binary rather than text",
        };
      }

      return {
        path,
        exists: true,
        kind: "file",
        bytes: info.size,
        text: buffer.toString("utf8"),
        textWithheld: null,
      };
    },
  };
}
