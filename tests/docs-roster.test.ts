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
 * **The scope is the table, not the whole file, and the difference is measurable rather than
 * stylistic.** `AGENTS.md` names `docs/PLAN.md` seven times: once in this table and six more in the
 * rosters and cross-references below it. A test that asked whether each document is named *somewhere*
 * would therefore pass with the table two rows short - the same vacuous pass
 * `tests/observation-vocabulary.test.ts` was written after discovering in its own first draft, where
 * every stem in the enumeration was also named elsewhere in the document. So the scope is the table
 * block, the third assertion below proves the scope narrowed, and it fails if it silently stops
 * narrowing.
 *
 * **The flat rule, stated here because this is the file it applies to.** The document question is
 * answered over `docs/*.md` - one level, no recursion - and the row parser's character class has no
 * `/` in it, so a document in a subdirectory is invisible to **both** halves. That is not an oversight
 * to be repaired by recursion: `docs/phases/` holds fourteen files with an index of its own and a
 * guard of its own (`tests/phases-roster.test.ts`), and making this guard walk into it would make the
 * Documentation table carry fourteen rows that duplicate that index. What this guard now asks instead
 * is the question the omission left open and that nothing else asks: **is the directory itself named?**
 * A whole tree can arrive unindexed, and it did - `docs/phases/` was absent from this table while a
 * reader following the table would have had no way to know the program existed. So files are matched
 * flat, and directories are matched as directories, and the two rules are stated rather than implied.
 *
 * **And the counts are prose this file does not pin.** Four sites in the tree state the suite total in
 * the present tense (`AGENTS.md`, `README.md` twice, and `docs/BUILD-AND-TEST-COMMANDS.md`). What is
 * asserted below is that they **agree with each other**, which catches the half-updated figure - one
 * site moved and the others not. What no test in this tree can catch is the
 * day all of them move together and none of them is re-measured, because *a count cannot be pinned by
 * a test that itself changes the count*; that case is repaired by re-taking the measurement, and the
 * four sites are named here so the next pass knows where to take it.
 *
 * **And the arithmetic beside a total is read too.** `docs/RULES-PAID-FOR.md` records a defect where
 * all four sites agreed on `2782` while three decomposed it as `2608 plus 92` and one as `2690 plus
 * 92` - a true total printed beside a false addition, because the guard's pattern matched the total
 * and nothing read its neighbours. The second assertion below closes that: each site's addition must
 * reach its own total, and the sites must credit the VS Code Cockpit with the same figure. What it
 * still cannot do is confirm that figure against the Cockpit itself - it is read from these sites
 * rather than taken from the extension's suite, so a change there arrives as disagreement between
 * sites rather than as truth, and that limit is stated rather than left to be discovered.
 */

/**
 * The documents whose present-tense count claims are compared with each other.
 *
 * A list rather than a walk, because these are the sites a reader is *promised* the figure at: a
 * fourth spelling in an archived design document is a measurement of that document's own moment and
 * is deliberately not in this list. `docs/RULES-PAID-FOR.md` and `docs/DIGITAL-TWIN-DESIGN.md` both
 * carry older totals and both are right to - they are records of past measurements, and rewritng them
 * would destroy the audit trail the register exists to be.
 *
 * `docs/phases/13-the-always-on-budget.md` was in this list and was removed, because a phase file
 * records the moment the phase closed and a live figure cannot be asked of a past moment. It is the
 * defect the register already carries in the other direction - a figure whose *unit* or *state* was
 * left unstated, so a later pass freshens a number that should have been anchored. That file's line
 * now says `exited 0` and `when this phase closed`, which is the same treatment phase 08's line
 * already had (and which is why phase 08 was never in this list).
 */
const COUNT_SITES = [
  "AGENTS.md",
  "README.md",
  "docs/BUILD-AND-TEST-COMMANDS.md",
] as const;

/**
 * The one spelling of a live count claim, shared by both assertions below.
 *
 * A `const` rather than two inline literals because the two assertions are about *the same sentence*:
 * if the spellings drifted apart, one could read a total from a sentence the other did not read an
 * addition from, and the pair would agree about nothing while appearing to agree. Callers strip
 * asterisks first, because one site emphasises the figure.
 *
 * `matchAll` clones the pattern it is given, so a shared global `RegExp` does not carry `lastIndex`
 * between the two callers.
 */
const COUNT_CLAIM = /(\d[\d,]{2,6})\s+(?:passing\s+)?tests?\s+over\s+(\d[\d,]{0,5})\s*suites?/g;

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

/** Every `docs/<name>/` a table row names as a directory, deduplicated. */
function directoriesNamed(rows: readonly string[]): readonly string[] {
  const names = new Set<string>();
  for (const row of rows) {
    // The row's link target is a file (the directory's own index); the *label* is what a reader scans
    // for, so the match is on the backticked name rather than on the href.
    for (const match of row.matchAll(/`(docs\/[A-Za-z0-9._-]+\/)`/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

const agents = (await repo.readTextFile("AGENTS.md")) ?? "";
const rows = documentationTable(agents);
const indexed = documentsNamed(rows);
const directories = directoriesNamed(rows);
const onDisk = (await repo.readDir("docs"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `docs/${name}`)
  .sort();

/**
 * Every child of `docs/` that is a **directory holding markdown**, spelled `docs/<name>/`.
 *
 * `readDir` returns bare names, so a file and a directory are indistinguishable from the list alone,
 * and `readTextFile` answers `null` for a directory and for a missing file alike. Asking `readDir`
 * *inside* the entry settles it: a markdown file yields nothing - the read fails and the port swallows
 * the error - while a directory yields its children.
 */
const docDirectories: string[] = [];
for (const name of await repo.readDir("docs")) {
  const children = await repo.readDir(`docs/${name}`);
  if (children.some((child) => child.endsWith(".md"))) docDirectories.push(`docs/${name}/`);
}

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

  it("indexes every subdirectory of docs that holds a document", () => {
    // The control first, and it is the one this file cannot do without: `readDir` swallows every error
    // and returns `[]`, so a walk that looked in the wrong place would leave the assertion below
    // comparing two empty lists and passing - the reason `docs-roster`'s sibling guard opens with the
    // same check. A directory added to `docs/` and left unindexed is a tree no reader is told about.
    assert.ok(
      docDirectories.length > 0,
      "the subdirectory walk found no directory holding markdown, so the assertion below compared " +
        "two empty lists. Either docs/ holds no such subdirectory any more - in which case this " +
        "assertion should be deleted rather than left vacuous - or the walk is looking in the wrong " +
        "place.",
    );

    const missing = docDirectories.filter((name) => !directories.includes(name));
    assert.deepEqual(
      missing,
      [],
      `${String(missing.length)} subdirectory(ies) of docs/ hold documents and have no row in the ` +
        `Documentation table: ${missing.join(", ")}. This is the half the flat rule left open: files ` +
        `are matched one level deep by design, so a whole tree can arrive unindexed in silence - which ` +
        `is what docs/phases/ did, holding thirteen phase files and an index while the table did not ` +
        `name it.`,
    );
  });

  it("holds the live count sites to one figure, so a half-updated total fails", async () => {
    // What this catches: one site moved and the others left behind. What it cannot catch, and says so
    // in the doc block: all of them moving together and none being re-measured, because a count cannot
    // be pinned by a test that itself changes the count. So the claim is agreement, not truth.
    const figures = new Map<string, readonly string[]>();
    for (const name of COUNT_SITES) {
      // Asterisks are stripped first because one site emphasises the figure (`at **2569** tests over
      // **426** suites`) and a pattern built for the other three would report that site as silent.
      const text = ((await repo.readTextFile(name)) ?? "").replaceAll("*", "");
      const found = [...text.matchAll(COUNT_CLAIM)].map(
        (match) => `${match[1] ?? ""} tests over ${match[2] ?? ""} suites`,
      );
      figures.set(name, found);
    }

    // The control: every site must yield a figure, or the comparison below is over misses and every
    // site agrees by being empty - which is the vacuous pass this file warns about twice above.
    const silent = [...figures].filter(([, found]) => found.length === 0).map(([name]) => name);
    assert.deepEqual(
      silent,
      [],
      `no count figure was extracted from ${silent.join(", ")}. Either the figure was removed from ` +
        `that site - in which case remove it from COUNT_SITES too, or the pattern has stopped ` +
        `matching the spelling that site now uses.`,
    );

    const distinct = [...new Set([...figures.values()].flat())].sort();
    assert.equal(
      distinct.length,
      1,
      `the live count sites state ${String(distinct.length)} different figures: ${distinct.join(" | ")}. ` +
        `A total corrected in one document and not in the others is the defect this assertion exists ` +
        `for; re-measure rather than choosing between them.`,
    );
  });

  it("holds each site's addition to its own total, so the arithmetic beside a figure is read", async () => {
    // The gap `docs/RULES-PAID-FOR.md` names and did not close: *"a pattern that matches the total
    // cannot see the arithmetic beside it."* Every site states the total **and** an addition that
    // reaches it - the tree's own figure plus the Cockpit's - and the assertion above reads only the
    // total, so the addition was free to be wrong inside a sentence that looked verified. It has been
    // wrong: that register entry records `2782` decomposed as `2608 plus 92` at three sites and `2690
    // plus 92` at the fourth, a false decomposition printed beside a true total. The gap was then paid
    // for again in the pass that wrote this assertion - the same figure moved by hand through four
    // documents and missed on the first sweep, because nothing read the half that had moved.
    //
    // What this cannot catch is what the assertion above cannot catch either: every site moving
    // together with none re-measured. And the Cockpit's figure is *read from these sites* rather than
    // taken from the extension's own suite, so a change there surfaces as disagreement between sites,
    // never as truth. Both limits are named because a guard whose limits are unstated gets trusted
    // past them.
    const claims: { site: string; total: number; own: number; cockpit: number }[] = [];
    const unread: string[] = [];
    for (const name of COUNT_SITES) {
      const text = ((await repo.readTextFile(name)) ?? "").replaceAll("*", "");
      for (const match of text.matchAll(COUNT_CLAIM)) {
        // A window rather than the document: the addition belongs to the same sentence as the total,
        // and a stray `own <n>` in a later paragraph would be paired with a total it does not
        // describe. 400 characters covers the longest of the four - a wrapped comment line - and
        // stops well short of the paragraph after it.
        const window = text.slice(match.index, match.index + 400);
        const own = /\bown\s+(\d[\d,]*)/i.exec(window)?.[1];
        // Two spellings, both in use: the figure then the noun (`the 92 the VS Code Cockpit`), and
        // the noun then the figure (`the Cockpit's 92`). Read as shapes because a fourth site may use
        // either, and a guard that knew only one would silently drop the sites that chose the other.
        const cockpit =
          /(\d[\d,]*)\s+the\s+VS\s+Code\s+Cockpit/i.exec(window)?.[1] ??
          /Cockpit'?s\s+(\d[\d,]*)/i.exec(window)?.[1];
        if (own === undefined || cockpit === undefined) {
          unread.push(`${name}: ${match[0]}`);
        } else {
          claims.push({
            site: name,
            total: Number((match[1] ?? "").replaceAll(",", "")),
            own: Number(own.replaceAll(",", "")),
            cockpit: Number(cockpit.replaceAll(",", "")),
          });
        }
      }
    }

    // The control, and it is the one this file warns about twice: a total read without an addition
    // beside it must fail here rather than pass by being absent from `claims` - otherwise deleting a
    // decomposition would quietly reduce this guard to the assertion above.
    assert.deepEqual(
      unread,
      [],
      `a count claim at ${unread.join(", ")} states a total with no addition beside it. Either the ` +
        `decomposition was deleted - in which case the tree has stopped making the claim and this ` +
        `assertion should be deleted with it - or the sentence was reworded into a shape the two ` +
        `patterns here do not read. Add the spelling; do not drop the site.`,
    );
    // The second control, and the stronger one: every named site must have contributed at least one
    // claim, so that a pattern which matched nothing at all cannot pass by agreeing with itself.
    assert.deepEqual(
      [...new Set(claims.map((claim) => claim.site))].sort(),
      [...COUNT_SITES].sort(),
      `no addition was read from one or more of the count sites, so nothing below was compared.`,
    );

    const wrong = claims
      .filter((claim) => claim.own + claim.cockpit !== claim.total)
      .map(
        (claim) =>
          `${claim.site}: ${String(claim.own)} + ${String(claim.cockpit)} != ${String(claim.total)}`,
      );
    assert.deepEqual(
      wrong,
      [],
      `the addition beside a count does not reach the total it sits under - ${wrong.join("; ")}. ` +
        `The total is pinned to one figure by the assertion above, so a mismatch here is the half a ` +
        `reader calibrates the rest of the sentence against, and until this test it was the half ` +
        `nothing read.`,
    );

    const credit = [...new Set(claims.map((claim) => claim.cockpit))].sort();
    assert.equal(
      credit.length,
      1,
      `the sites credit the VS Code Cockpit with ${String(credit.length)} different figures ` +
        `(${credit.join(", ")}) while stating the same total. Two additions cannot reach one total ` +
        `unless a site's own figure absorbed the difference, which is the trade this assertion exists ` +
        `to refuse.`,
    );
  });
});
