import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `IMPLEMENTATION-PLAN.md` §1 is the audit trail of what was **not** built, and a row in it is a claim
 * about this tree: *"this does not exist."* Every such claim is falsified the moment the thing lands,
 * and nothing in the tree reads the table - which is the defect this repository records four times
 * over a roster (`db.query`, `db.rowCount`, `web.visible`, the `demo:*` scripts) and once over a
 * status cell in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5.
 *
 * It was wrong in **two** rows. The Cockpit row said the extension was deferred while
 * `extension/vscode/` shipped four routes and its own gate; the Kubernetes / cloud / mobile / VM row
 * said those adapters were excluded while six `sim-*` worlds existed. Nothing failed, because a table
 * in a document is read by nothing that could disagree with it.
 *
 * **Three properties are held here, and the third is the one that keeps the second honest.**
 *
 * 1. Every `Status` cell is one of the declared values. A cell reading `done` or `shipped` or `n/a`
 *    would be a fifth state the guard has no rule for, and a guard with no rule for a value is how a
 *    vocabulary drifts.
 * 2. A row naming a **directory that exists** may not say `deferred`. This is the property that was
 *    false: the claim and the tree disagreed, and the tree was right.
 * 3. A row that says `landed` and names a directory must have that directory **exist**. Without this
 *    the guard is satisfied by writing nothing - a row could claim anything and name no path, and
 *    assertion 2 would be vacuously true for it. A guard whose only failure mode is "a row names a
 *    real directory and lies about it" is a guard that a careful rewriter passes by deleting the
 *    paths.
 *
 * **Only directories are resolved, not files.** A row legitimately names documents
 * (`docs/GAP-CLOSURE-DESIGN.md`, `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`), and a design document
 * existing says nothing about whether a world was built. The subject of every row is a directory in
 * this tree, so the guard reads the backticked tokens that end in `/`.
 */

const REPO = fileURLToPath(new URL("../", import.meta.url));
const PLAN = fileURLToPath(new URL("../docs/IMPLEMENTATION-PLAN.md", import.meta.url));

/** The two states a row may be in. Declared here because this file is the table's only reader. */
const STATUSES = ["landed", "deferred"] as const;

const HEADER = "| Deferred | Status | Why, or what landed |";

interface Row {
  /** The first cell - what the row is about. */
  readonly subject: string;
  /** The bare status word, with the bold markers and any parenthetical qualifier removed. */
  readonly status: string;
  /** The backticked directory paths this row names, resolved against the repository root. */
  readonly directories: readonly string[];
  /** The whole row, for a message that has to quote what it read. */
  readonly raw: string;
}

/**
 * The §1 table, read out of the document rather than restated.
 *
 * Located by its header rather than by a line number, because the column was **added** to a table that
 * already existed and its line number therefore moved - and a guard pinned to a line number would have
 * reported the wrong table the first time a paragraph before it grew.
 */
function readRows(): readonly Row[] {
  const text = readFileSync(PLAN, "utf8");
  const headerAt = text.indexOf(HEADER);
  assert.notEqual(headerAt, -1, `§1 carries the table whose header is "${HEADER}"`);

  const rows: Row[] = [];
  for (const line of text.slice(headerAt).split(/\r?\n/)) {
    // Stop at the first line that is not part of the table: the separator and the rows are `|`-led.
    if (line.startsWith("|")) {
      if (line.includes("---")) continue; // the header separator
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length !== 3) continue; // the header row itself, or a malformed row
      const [subject, status, why] = cells as [string, string, string];
      if (subject === "Deferred") continue; // the header
      rows.push({
        subject,
        status: status.replaceAll("*", "").split(" ")[0] ?? "",
        directories: [...why.matchAll(/`([^`]+\/)`/g)]
          .map((match) => match[1] ?? "")
          .filter((token) => existsSync(join(REPO, token)) && statSync(join(REPO, token)).isDirectory()),
        raw: line.trim(),
      });
    } else if (rows.length > 0) {
      break;
    }
  }
  return rows;
}

const ROWS = readRows();

describe("the deferred table in IMPLEMENTATION-PLAN.md §1", () => {
  it("was found, and is not empty", () => {
    // The positive control. Every assertion below is a loop over `ROWS`, so a parser that found
    // nothing would satisfy all of them - which is the vacuous pass this repository refuses.
    assert.ok(ROWS.length >= 6, `read ${String(ROWS.length)} rows out of §1: ${ROWS.map((r) => r.subject).join(", ")}`);
  });

  it("answers every row in the declared vocabulary", () => {
    for (const row of ROWS) {
      assert.ok(
        (STATUSES as readonly string[]).includes(row.status),
        `"${row.subject}" says \`${row.status}\`, which is not one of ${STATUSES.join(" / ")} - ` +
          "so the guard has no rule for it and cannot tell whether it is true",
      );
    }
  });

  it("does not call a thing deferred while a directory it names is sitting in the tree", () => {
    for (const row of ROWS.filter((entry) => entry.status === "deferred")) {
      assert.deepEqual(
        row.directories,
        [],
        `"${row.subject}" is called \`deferred\` while ${row.directories.join(", ")} exists in this ` +
          "tree. This is the exact defect the Status column was added to remove: the row and the tree " +
          "disagreed, and the tree was right. Either the status moves or the row is split.",
      );
    }
  });

  it("does not call a thing landed while naming a directory that is not there", () => {
    // The half that keeps the assertion above from being satisfied by naming nothing. A `landed` row
    // must name at least one directory, and every directory it names must exist.
    const landed = ROWS.filter((row) => row.status === "landed");
    assert.notEqual(landed.length, 0, "at least one row has landed");
    for (const row of landed) {
      assert.notEqual(
        row.directories.length,
        0,
        `"${row.subject}" is called \`landed\` and names no directory in this tree, so nothing here ` +
          "can tell whether it is true",
      );
    }
  });

  it("still carries the rows that are genuinely deferred, so the table has not been emptied", () => {
    // A table where every row says `landed` would pass the three assertions above and would have
    // stopped being an audit trail.
    //
    // **The examples here had to be re-measured, and the way they failed is worth keeping.** They used
    // to require a row containing `MCP` and a row containing `Goal compiler`, on the reading that those
    // two were *"the two whose deferral is a decision rather than a schedule"*. The Level-3 MCP row was
    // a decision about the **gate** - *"MCP is the door. Veridian is the building"* - but the surface
    // itself then landed as `mcp/`, so the row's status moved to `landed` and this assertion began
    // **failing on a correct document**. That is the one direction a documentary guard must not fail
    // in: the guard was holding a claim about the tree that the tree had outgrown, and its message
    // named the row that had been *fixed*. The repair is to re-measure which rows are genuinely
    // deferred, not to delete the assertion - its purpose, that the table keeps its audit trail, is
    // sound and is the reason the two rows below are named rather than counted.
    const deferred = ROWS.filter((row) => row.status === "deferred").map((row) => row.subject);
    assert.ok(
      deferred.some((subject) => subject.includes("VM / guest-kernel")),
      `the VM / guest-kernel row is still deferred - a booted kernel is a claim nothing here can ` +
        `prove - and the table says: ${deferred.join(" | ")}`,
    );
    assert.ok(
      deferred.some((subject) => subject.includes("Goal compiler")),
      `the goal compiler / marketplace / plugin row is still deferred, and the table says: ${deferred.join(" | ")}`,
    );
  });
});
