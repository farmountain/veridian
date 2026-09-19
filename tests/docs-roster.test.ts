import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";

/**
 * Every `docs/*.md` file must have a row in `AGENTS.md`'s Documentation table, and every row in that
 * table must name a file that exists.
 *
 * `AGENTS.md` obliges the row in as many words - "Add a one-line index entry here for each new doc
 * instead of duplicating its content in this file" - and nothing held it. `docs/` gained an eighth
 * file while the table still listed seven, and the drift was invisible for exactly the reason this
 * repository records four times over: a list of names in a document is read by nothing that could
 * disagree with it. The nearest existing checks each name one document for their own purpose
 * (`boundary-roster.test.ts` reads `BOUNDARY-ENFORCEMENT.md`, `implementation-plan-status.test.ts`
 * reads `IMPLEMENTATION-PLAN.md`) and none enumerates the directory, so a new document could arrive
 * un-indexed in silence - which is what happened.
 *
 * **The question is asked of the table, not of the whole file, and the difference is measurable
 * rather than stylistic.** `AGENTS.md` names `docs/PLAN.md` seven times: once in this table and six
 * more in the rosters and cross-references below it. A test that asked whether each document is named
 * *somewhere* would therefore pass with the table two rows short - the same vacuous pass
 * `tests/observation-vocabulary.test.ts` was written after discovering in its own first draft, where
 * every stem in the enumeration was also named elsewhere in the document. So the scope is the table
 * block, the third assertion below proves the scope narrowed, and it fails if it silently stops
 * narrowing.
 */

const repo = nodeIo();

/** The table's own rows, from its header down to the first line that is not a row. */
function documentationTable(body: string): readonly string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\|\s*Document\s*\|\s*Contents\s*\|\s*$/.test(line));
  if (start === -1) return [];

  const rows: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    // The `|---|` separator row opens with `|` as well, so it is a row for this purpose and carries
    // no name. Stopping on the first line that is not a row is what keeps a later table out - the
    // Agent customizations table two headings below is the one that would otherwise be absorbed.
    if (!line.startsWith("|")) break;
    rows.push(line);
  }

  return rows;
}

/** Every `docs/<file>.md` a table row names, deduplicated because the separator row carries none. */
function documentsNamed(rows: readonly string[]): readonly string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const match of row.matchAll(/`(docs\/[A-Za-z0-9._-]+\.md)`/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

const agents = (await repo.readTextFile("AGENTS.md")) ?? "";
const rows = documentationTable(agents);
const indexed = documentsNamed(rows);
const onDisk = (await repo.readDir("docs"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `docs/${name}`)
  .sort();

describe("the Documentation table in AGENTS.md", () => {
  it("indexes every document the docs directory holds", () => {
    const missing = onDisk.filter((name) => !indexed.includes(name));
    assert.deepEqual(
      missing,
      [],
      `${String(missing.length)} document(s) in docs/ have no row in the Documentation table: ` +
        `${missing.join(", ")}. AGENTS.md asks for a one-line index entry per new doc, and this is ` +
        `the check that asks for it.`,
    );
  });

  it("names a document that exists for every row it carries", () => {
    const dangling = indexed.filter((name) => !onDisk.includes(name));
    assert.deepEqual(
      dangling,
      [],
      `${String(dangling.length)} row(s) name a document docs/ does not hold: ${dangling.join(", ")}.`,
    );
  });

  it("reads the Documentation table rather than the whole of AGENTS.md", () => {
    // The scope's two boundaries, each measured, because a set test over the whole document cannot
    // see a block that is short when every member of that block is also named elsewhere. Neither
    // assertion below is what makes the scope work - the falsification recorded at the head of this
    // file does that, by deleting the `docs/PLAN.md` row from the table and watching the first
    // assertion name it. These hold the two boundaries that deletion relies on.
    assert.ok(
      rows.length >= 1,
      "the Documentation table's header was not found, so the scope collapsed to nothing and the " +
        "two assertions above were asked of an empty block",
    );

    assert.ok(
      rows.some((row) => /^\|\s*\[`README\.md`\]/.test(row)),
      "the block does not reach the table's first data row, so it began below the table it names",
    );

    assert.ok(
      !rows.some((row) => /^\|\s*File\s*\|\s*Applies when\s*\|/.test(row)),
      "the block ran past the Documentation table and absorbed the Agent customizations table",
    );

    // Why the scope is needed at all, as a measurement of this document rather than an argument:
    // `docs/PLAN.md` is named once in the table and again in every roster below it, so a question
    // asked of the whole file would be answered by text that is not an index entry.
    const wholeFile = agents.split("docs/PLAN.md").length - 1;
    assert.ok(
      wholeFile > indexed.filter((name) => name === "docs/PLAN.md").length,
      `AGENTS.md names docs/PLAN.md ${String(wholeFile)} time(s) and the table names it ` +
        `${String(indexed.filter((name) => name === "docs/PLAN.md").length)}; with those equal the ` +
        `scope would no longer be narrower than the document`,
    );
  });

  it("keeps the rule that obliges a row for each new doc", () => {
    assert.match(
      agents,
      /Add a one-line index entry here for each new doc/,
      "the sentence this guard exists to hold has been removed from AGENTS.md, so the guard is " +
        "now holding a convention nothing states",
    );
  });
});
