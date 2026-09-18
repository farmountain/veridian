import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";

/**
 * The documents that enumerate `core/environment/*-observation.ts` must enumerate all of them.
 *
 * This guard exists because the enumeration had drifted in **both** documents, in the same direction
 * and by different amounts: `AGENTS.md`'s `core/environment/` layout entry stopped at
 * `process-observation.ts` - the tenth family - while `validators/data/` and `validators/mobile/`
 * below it declared the eleventh and the twelfth, and `README.md`'s layering paragraph named eleven
 * of the twelve files. Nothing failed, because a list of file names in a document is read by nothing
 * that could disagree with it - the shape `AGENTS.md` records three times over `db.query`,
 * `db.rowCount` and `web.visible`.
 *
 * The cost of the drift is specific rather than aesthetic. The chain is what an author building the
 * next world reads to learn which files to add, and its members carry their ordinals (`the
 * eleventh`, `the twelfth`), so a chain that stops at ten while twelve families exist tells that
 * author to add a file as `the eleventh` - colliding with a file that has held that number since
 * before they arrived.
 *
 * **The question is asked of the enumeration, not of the document, and that was measured rather than
 * assumed.** Every one of the twelve names also appears in a `validators/` row below the chain in
 * `AGENTS.md` - twice over for most of them, and three times for `data` and `mobile` - so a guard
 * that asked whether the *document* names all twelve would have gone on passing with the chain
 * missing two families, which is precisely the drift this file was written after. Scoping is
 * therefore what makes this a guard rather than a formality.
 *
 * The scope is expressed per document because the two documents are different kinds of thing:
 * `AGENTS.md`'s enumeration is a layout entry that opens at column zero and continues on indented
 * lines, and `README.md`'s is a prose paragraph that ends at the first blank line. Neither rule
 * restates the other. Within the scope a hyphen-broken token is rejoined before searching, because
 * `AGENTS.md` breaks *inside* a name - `vscode-` and `observation.ts` on consecutive lines, and the
 * same again for `data-` - which is the rule the tree's CRLF entries record one layer out: read the
 * spelling the file actually holds, not the one its author typed.
 */

const io = nodeIo();

/** `mobile-observation.ts` once a wrap is rejoined, and the stem it names. */
const OBSERVATION = /\b([a-z0-9-]+)-observation\.ts/g;

/** How many names an enumeration has to hold before its scope is believed. */
const SCOPE_FLOOR = 5;

/**
 * One document that carries an enumeration, and the rule that says how far it runs.
 *
 * A third document would be added by writing one entry here and nothing else, which is the property
 * the guard's own doc block claims.
 */
interface Enumeration {
  /** The file, as `core/io.ts` resolves it - the operator's root, not Veridian's. */
  readonly document: string;
  /** Whether `line` continues the enumeration, rather than ending it. */
  readonly continues: (line: string) => boolean;
}

const ENUMERATIONS: readonly Enumeration[] = [
  // A layout entry: it opens at column zero and every continuation line is indented.
  { document: "AGENTS.md", continues: (line) => /^\s/.test(line) && line.trim().length > 0 },
  // A prose paragraph: it runs to the first blank line.
  { document: "README.md", continues: (line) => line.trim().length > 0 },
];

/** Every stem of a `*-observation.ts` file `core/environment/` holds, sorted. */
async function filesOnDisk(): Promise<readonly string[]> {
  const entries = await io.readDir("core/environment");
  return entries
    .filter((entry) => entry.endsWith("-observation.ts"))
    .map((entry) => entry.slice(0, -"-observation.ts".length))
    .sort();
}

/**
 * The enumeration one document carries, as one string.
 *
 * It begins at the first line naming an observation file and runs while that document's own rule
 * says it continues, so the answer is a fact about the enumeration rather than about the file.
 */
function enumerationIn(body: string, continues: (line: string) => boolean): string {
  const lines = body.split(/\r?\n/);
  const opens = lines.findIndex((line) => line.includes("-observation.ts"));
  if (opens === -1) return "";
  const block: string[] = [lines[opens] ?? ""];
  for (let index = opens + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!continues(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

/**
 * Every distinct stem a document names inside its enumeration.
 *
 * The two normalisations are separate on purpose. The first repairs a wrap an editor introduced
 * *inside* a name, which is not a difference in the name; the second collapses the remaining
 * whitespace so that a match cannot depend on where the line was broken a second time.
 */
function namedStems(block: string): readonly string[] {
  const rejoined = block.replace(/-\s*\r?\n\s*/g, "-").replace(/\s+/g, " ");
  const stems = new Set<string>();
  for (const match of rejoined.matchAll(OBSERVATION)) stems.add(match[1] ?? "");
  return [...stems].sort();
}

/** What one document's enumeration names, and the scope it was read from. */
async function enumerationOf(entry: Enumeration): Promise<{ body: string; named: readonly string[] }> {
  const body = await io.readTextFile(entry.document);
  assert.ok(body !== null, `${entry.document} could not be read`);
  const named = namedStems(enumerationIn(body, entry.continues));
  // The scope's own control. Without it a rule that grabbed one line - or nothing - would leave the
  // two assertions below agreeing with a document they had not read, and the message would name the
  // vocabulary when the fault was the scope.
  assert.ok(
    named.length >= SCOPE_FLOOR,
    `the enumeration read out of ${entry.document} names ${String(named.length)} file(s), which is ` +
      `too few to be the vocabulary - so this guard's scope, not the document, is what needs ` +
      `reading. Named: ${named.join(", ") || "(none)"}.`,
  );
  assert.ok(
    named.includes("web"),
    `the enumeration read out of ${entry.document} does not name the web family, which is the ` +
      "vocabulary's first member, so the scope did not find the enumeration's start",
  );
  return { body, named };
}

const onDisk = await filesOnDisk();

describe("the observation vocabulary is enumerated in full by every document that lists it", () => {
  it("finds the vocabulary on disk, so the comparisons below cannot pass vacuously", () => {
    // A guard that compares two empty sets passes and reports nothing. This is the floor the rest of
    // the suite stands on: if `core/environment/` were ever read wrongly - a changed root, a renamed
    // directory, a port that answered an empty listing - every assertion below would agree with
    // itself and this suite would go on being green.
    assert.ok(
      onDisk.length > SCOPE_FLOOR,
      `core/environment/ holds ${String(onDisk.length)} *-observation.ts file(s), so there is little ` +
        "here for a document to be held against",
    );
  });

  for (const entry of ENUMERATIONS) {
    it(`names every vocabulary file in ${entry.document}`, async () => {
      const { named } = await enumerationOf(entry);
      for (const stem of onDisk) {
        assert.ok(
          named.includes(stem),
          `${entry.document} names no \`${stem}-observation.ts\` in its enumeration. The family is ` +
            `on disk, so a reader who learns this vocabulary from ${entry.document} never learns ` +
            `about it. Named: ${named.join(", ")}.`,
        );
      }
    });

    it(`invents no vocabulary file in ${entry.document}`, async () => {
      const { named } = await enumerationOf(entry);
      for (const stem of named) {
        assert.ok(
          onDisk.includes(stem),
          `${entry.document}'s enumeration names \`${stem}-observation.ts\`, which ` +
            `core/environment/ does not hold. On disk: ${onDisk.join(", ")}. A name with no file ` +
            "behind it is a vocabulary member an author will go looking for and not find.",
        );
      }
    });
  }
});
