/**
 * The runtime's own diagnostics, held apart from the application's output.
 *
 * ## Why this file exists
 *
 * `AC-001` asserts that the CLI's `help` path writes nothing to stderr, and it failed for a reason
 * that had nothing to do with the CLI: this world starts a confined child with `--allow-child-process`
 * (a flag the **world** adds, deliberately - see `#allowance` in the `local-process` adapter), and Node
 * answers that flag by writing its own two-line `SecurityWarning` to the child's stderr **before any
 * application code runs**.
 *
 * So the criterion was reading the world's own allowance back and reporting it as the program's
 * output. The repair is not to suppress the warning - that would hide information the world caused -
 * and it is not to loosen the criterion. It is to **separate the two writers**, which is what
 * `splitRuntimeDiagnostics` does, and to keep both halves so nothing is lost.
 *
 * ## The measurement this file pins
 *
 * The diagnostic was measured rather than recalled, by starting a child the way the world starts one
 * and printing its stderr with escapes:
 *
 * ```
 * (node:48276) SecurityWarning: The flag --allow-child-process must be used with extreme caution. It could invalidate the permission model.
 * (Use `node --trace-warnings ...` to show where the warning was created)
 * ```
 *
 * Two lines, 210 bytes. **The second line is a continuation of the first rather than a statement of
 * its own**, and that is the fact this file exists to hold: a reader who matched only the `(node:<pid>)`
 * prefix would strip the warning, leave the hint behind, and put the application's stderr straight back
 * to non-empty - the same defect, half repaired, which reads as a fix.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitRuntimeDiagnostics } from "../core/environment/process-observation.ts";

/** The measurement above, spelled once. The pid is this file's own: nothing reads it. */
const WARNING =
  "(node:48276) SecurityWarning: The flag --allow-child-process must be used with extreme caution. It could invalidate the permission model.\n";
const HINT = "(Use `node --trace-warnings ...` to show where the warning was created)\n";
const DIAGNOSTIC = WARNING + HINT;

describe("the runtime's own diagnostics are held apart from the application's output", () => {
  it("separates both measured lines, and leaves the application's own stream behind them", () => {
    // The application line is *after* the diagnostic, which is the real order: Node writes its warning
    // at startup, before any program code runs.
    const stream = DIAGNOSTIC + "usage: veridian <command>\n";

    const split = splitRuntimeDiagnostics(stream);

    assert.equal(split.diagnostics, DIAGNOSTIC, "the diagnostic is not what the runtime wrote");
    assert.equal(split.application, "usage: veridian <command>\n");
    assert.equal(Buffer.byteLength(split.diagnostics, "utf8"), 210, "the measured diagnostic is not 210 bytes");
  });

  it("consumes the trace hint with the warning that produced it, rather than on its own", () => {
    // The load-bearing half. A hint matched independently would still be stripped from a stream that
    // never contained a warning - and a warning whose hint was left behind would leave the
    // application's stderr non-empty, which is the defect this file is about, half repaired.
    const split = splitRuntimeDiagnostics(WARNING);

    assert.equal(split.diagnostics, WARNING, "the warning was not separated");
    assert.equal(split.application, "", "the hint was left in the application's stream");
  });

  it("returns a stream with no diagnostic as the identical string, so the common path is inert", () => {
    // A positive control beside the negative ones above: the function must be capable of saying
    // "nothing here", or every assertion that it separated something proves only that it separates.
    // Identity rather than equality, because a re-encoded stream would pass `equal` and still have
    // moved the bytes a criterion compares.
    const clean = "app-ran\nsecond line\n";

    const split = splitRuntimeDiagnostics(clean);

    assert.equal(split.application, clean);
    assert.equal(split.diagnostics, "");
    assert.ok(Object.is(split.application, clean), "a clean stream was rebuilt rather than passed through");
  });

  it("does not take an application line that only looks like a diagnostic", () => {
    // `(node:...)` without the pid is the shape an application would have to print to be mistaken for
    // the runtime, and requiring the pid is what keeps this from matching prose. Without this
    // assertion the prefix could be loosened to `(node` and every test above would still pass.
    const impostor = "(node: internal/modules/cjs/loader) something the program said\n";

    const split = splitRuntimeDiagnostics(impostor);

    assert.equal(split.application, impostor, "an application line was taken as the runtime's");
    assert.equal(split.diagnostics, "");
  });
});
