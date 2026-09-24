import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";

/**
 * `docs/phases/README.md` is the index for the phase program, and it is written to be the one file a
 * reader opens before reading exactly one phase file. Everything it says about the twelve phases is a
 * claim about the directory beside it, and until this file existed **nothing read both**.
 *
 * It was wrong when this guard was written, in two ways at once, and the pair is instructive:
 *
 * - Rows `09` to `12` named `09-instrument-residual-readings.md`, `10-ladder-residual-readings.md`,
 *   `11-documentation-currency.md` and `12-the-next-world.md` - four files that are not in this
 *   directory - while the four that **are** (`09-documentation-currency.md`,
 *   `10-veridian-judged-by-veridian.md`, `11-the-distribution-and-environments-ledger.md`,
 *   `12-memory-and-the-end-of-the-program.md`) held no row at all. The index described a programme
 *   that had been re-planned, and the re-planning never reached the table.
 * - The paragraph that used to close the file credited the coverage to `tests/docs-roster.test.ts`,
 *   and that guard cannot hold this directory: its selection reads the **top level** of `docs/` and
 *   its row parser's character class contains no `/`, so a document in a subdirectory is invisible to
 *   both halves. Neither half is a defect - it was written for a flat directory, and flat is all it
 *   claims - and that is precisely why the sentence was one: **a capability credited to a guard that
 *   does not have it is the same shape as a capability list written beside the code instead of
 *   derived from it**, which this repository records five times over. Nothing failed, because a
 *   roster in prose is read by nothing that could disagree with it.
 *
 * **The scope is the table, and the vocabulary is read out of the document rather than restated
 * here.** A second copy of the eight status words in this file would be free to drift from the list
 * the document declares, and the drift would be invisible in exactly the direction that matters -
 * the document could drop a member and the guard would still accept it. So the members are parsed
 * from the declaration, the statuses are parsed from the rows and the phase files, and the questions
 * below are about **agreement**.
 *
 * One exception, filed where it sits: the context budget is a question of **shape** rather than of
 * agreement, because there is nothing for it to agree with. A phase file that names what to read and
 * not what to avoid is a file whose reader will fill the window with the first list, and this whole
 * directory exists to prevent that - so the budget's two halves are required rather than assumed.
 *
 * The three scope controls are load-bearing rather than decorative, because `nodeIo().readDir`
 * swallows every error and returns `[]`: a mistyped directory name would leave every set-based
 * assertion comparing two empty lists and passing. `reads a directory that is actually there` is the
 * check that says the list is a reading, and the two controls that bound the table say the block did
 * not collapse.
 */

const repo = nodeIo();

type Entry = {
  readonly number: string;
  readonly title: string;
  readonly file: string;
  readonly status: string;
};

/** Spelled counts, so the document's own word for the list's length can be compared with it. */
const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The table under `## The twelve`, from its header row down to the first line that is not a row. */
function twelveTable(body: string): readonly string[] {
  const start = body.indexOf("## The twelve");
  if (start === -1) return [];
  const after = body.indexOf("\n## ", start + 1);
  const block = body.slice(start, after === -1 ? undefined : after);
  const lines = block.split(/\r?\n/);
  const header = lines.findIndex((line) => /^\|\s*#\s*\|\s*Phase\s*\|/.test(line));
  if (header === -1) return [];

  const rows: string[] = [];
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("|")) break;
    rows.push(line);
  }
  return rows;
}

/**
 * A status cell reduced to the state it names: emphasis removed, and everything from the separator
 * onward dropped. The phase files explain their status after the separator (`gated by 07 -- buildable
 * in shape, unsafe to build in fact`) while the table is terse (`gated by 07`), because the table is
 * read once and the phase file is read alone - so the comparison is of the states, not the prose.
 */
function statusStem(cell: string): string {
  const plain = cell.split("**").join("").trim();
  const cut = plain.indexOf(" -- ");
  return (cut === -1 ? plain : plain.slice(0, cut)).trim();
}

/** The statuses the document declares, read from its own bullets. Nothing is recalled here. */
function declaredStatuses(body: string): readonly string[] {
  const start = body.indexOf("Statuses mean exactly this");
  if (start === -1) return [];
  const after = body.indexOf("\n## ", start);
  const block = body.slice(start, after === -1 ? undefined : after);
  return [...block.matchAll(/^- \*\*(.+?)\*\* -- /gm)].map((match) => match[1] ?? "");
}

/**
 * Whether a status begins with a declared member. `gated by N` is declared with a placeholder, so
 * its `N` stands for the digits of a phase number rather than for a literal; every other member is
 * compared as written, escaped because a member may contain a space or punctuation.
 */
function declares(members: readonly string[], status: string): boolean {
  return members.some((member) => {
    const pattern = `^${member.split("N").map(escapeRegExp).join("\\d+")}(\\b|$)`;
    return new RegExp(pattern).test(status);
  });
}

/**
 * The rows parsed into entries, with the rows that could not be parsed returned beside them rather
 * than skipped. A row this guard cannot read is a row it is not checking, so it is reported by name
 * instead of being dropped - the same reason `undetected` exists in `boundary-roster.test.ts`.
 */
function parseRows(rows: readonly string[]): {
  readonly entries: readonly Entry[];
  readonly malformed: readonly string[];
} {
  const entries: Entry[] = [];
  const malformed: string[] = [];

  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (cells.length !== 5 || !/^\d{2}$/.test(cells[0] ?? "")) {
      malformed.push(row);
      continue;
    }

    const link = /^\[(.+?)\]\(\.\/(.+?)\)$/.exec(cells[1] ?? "");
    if (link === null) {
      malformed.push(row);
      continue;
    }

    entries.push({
      number: cells[0] ?? "",
      title: link[1] ?? "",
      file: link[2] ?? "",
      status: statusStem(cells[3] ?? ""),
    });
  }

  return { entries, malformed };
}

const readme = (await repo.readTextFile("docs/phases/README.md")) ?? "";
const rows = twelveTable(readme);
const { entries, malformed } = parseRows(rows);
const declared = declaredStatuses(readme);

const onDisk = (await repo.readDir("docs/phases"))
  .filter((name) => /^\d{2}-[\w.-]+\.md$/.test(name))
  .sort();
const indexed = entries.map((entry) => entry.file).sort();

/**
 * Each phase file's own body, read **once**. Two questions are asked of every one of them - what
 * state it says it is in, and what context it says it needs - and a second read would be a second
 * chance for the two answers to be about different text.
 */
const fileBodies = new Map<string, string>();
for (const name of onDisk) {
  fileBodies.set(name, (await repo.readTextFile(`docs/phases/${name}`)) ?? "");
}

/** Each phase file's own `| **Status** |` cell, read rather than recalled. */
const fileStatuses = new Map<string, string>();
for (const [name, body] of fileBodies) {
  const match = /^\| \*\*Status\*\* \| (.+?) \|$/m.exec(body);
  fileStatuses.set(name, statusStem(match?.[1] ?? ""));
}

/** The header paragraph's five files and the byte count it states for each of them. */
const sizes = [...readme.slice(0, readme.indexOf("## The twelve")).matchAll(
  /`(docs\/[A-Za-z0-9._/-]+\.md)`\s+([\d,]+)/g,
)].map((match) => ({
  file: match[1] ?? "",
  stated: Number((match[2] ?? "").replaceAll(",", "")),
}));

const measured = new Map<string, number>();
for (const { file } of sizes) {
  const text = (await repo.readTextFile(file)) ?? "";
  measured.set(file, new TextEncoder().encode(text).length);
}

describe("the phase index in docs/phases/README.md", () => {
  it("reads a directory that is actually there", () => {
    // The scope control, and the one this guard cannot do without: `readDir` catches every error and
    // returns `[]`, so a mistyped directory would leave the set comparisons below reporting two
    // empty lists as agreement. This is the assertion that says the list is a reading of the tree.
    assert.ok(
      rows.length >= 1,
      "the table under `## The twelve` was not found, so every assertion below was asked of an " +
        "empty block",
    );

    assert.ok(
      onDisk.length > 0,
      "docs/phases holds no `NN-*.md` file, so the two set comparisons below would agree about " +
        "nothing. Either the directory moved - in which case this guard needs its path corrected - " +
        "or the phase files were renamed out of the `NN-` shape this index is built on.",
    );

    assert.deepEqual(
      malformed,
      [],
      `${String(malformed.length)} row(s) of the table could not be parsed, so they are not being ` +
        `checked: ${malformed.join(" | ")}`,
    );
  });

  it("names every phase file the directory holds", () => {
    const missing = onDisk.filter((name) => !indexed.includes(name));
    assert.deepEqual(
      missing,
      [],
      `${String(missing.length)} phase file(s) in docs/phases have no row in the table: ` +
        `${missing.join(", ")}. This is the drift that was sitting in the table when this guard was ` +
        `written - four files that do not exist were named in its last four rows while four real ` +
        `files there had none.`,
    );
  });

  it("names a file that exists for every row it carries", () => {
    const dangling = indexed.filter((name) => !onDisk.includes(name));
    assert.deepEqual(
      dangling,
      [],
      `${String(dangling.length)} row(s) name a file docs/phases does not hold: ` +
        `${dangling.join(", ")}.`,
    );
  });

  it("numbers the phases 01 to 12 with no gap and no repeat", () => {
    const numbers = entries.map((entry) => entry.number).sort();
    const expected = Array.from({ length: onDisk.length }, (_, index) =>
      String(index + 1).padStart(2, "0"),
    );
    assert.deepEqual(
      numbers,
      expected,
      "the table's phase numbers are not 01..N in step with the files on disk, so a phase was " +
        "dropped, repeated or renumbered in one of the two places and not the other",
    );
  });

  it("declares a closed list of statuses and states its length correctly", () => {
    const word = /^That is a \*\*closed list of (\w+)\*\*/m.exec(readme)?.[1] ?? "";
    const stated = COUNT_WORDS[word] ?? null;
    assert.notEqual(
      stated,
      null,
      "the document does not state the length of its status vocabulary in words, so the list's " +
        "own count is not being read by anything",
    );
    assert.equal(
      declared.length,
      stated,
      `the document says its status vocabulary is a closed list of ${word} (${String(stated)}) ` +
        `and declares ${String(declared.length)} member(s): ${declared.join(", ")}`,
    );
  });

  it("spells every status with a word the document declares", () => {
    const undeclared = [
      ...entries.map((entry) => `row ${entry.number}: ${entry.status}`),
      ...[...fileStatuses].map(([name, status]) => `${name}: ${status}`),
    ].filter((line) => !declares(declared, line.slice(line.indexOf(":") + 2)));

    assert.deepEqual(
      undeclared,
      [],
      `status(es) spelled with a word the document does not declare: ${undeclared.join("; ")}. A ` +
        `status is the document's own vocabulary rather than the phase's - which is how \`built\` ` +
        `came to be used by a phase file before the list had it.`,
    );
  });

  it("gives every phase the same status in the table and in its own file", () => {
    const disagreements: string[] = [];
    for (const entry of entries) {
      const own = fileStatuses.get(entry.file);
      if (own === undefined) continue;
      if (own !== entry.status) {
        disagreements.push(`${entry.number}: table says "${entry.status}", file says "${own}"`);
      }
    }

    assert.deepEqual(
      disagreements,
      [],
      `${String(disagreements.length)} phase(s) disagree with themselves about what state they are ` +
        `in: ${disagreements.join("; ")}. The phase file is the one that is read alone, so a reader ` +
        `who trusts the table and a reader who trusts the file are reading two programmes.`,
    );
  });

  it("states the byte count it measured for each of the five source documents", () => {
    assert.equal(
      sizes.length,
      5,
      `the header names ${String(sizes.length)} document(s) with a byte count, and it says it is ` +
        `reading five`,
    );

    const wrong = sizes
      .map(({ file, stated }) => ({ file, stated, actual: measured.get(file) ?? -1 }))
      .filter(({ stated, actual }) => stated !== actual);

    assert.deepEqual(
      wrong.map(({ file, stated, actual }) => `${file}: says ${String(stated)}, is ${String(actual)}`),
      [],
      "the header paragraph's byte counts have moved since they were taken. This is the same claim " +
        "the document's own refusal is about - a count recalled rather than taken - and a document " +
        "saying a byte total is a measurement nobody re-runs unless something reads it.",
    );
  });

  it("totals those five counts into the figure it quotes", () => {
    const stated = Number(
      (/totalling \*\*([\d,]+) bytes\*\*/.exec(readme)?.[1] ?? "0").replaceAll(",", ""),
    );
    const total = sizes.reduce((sum, { stated: each }) => sum + each, 0);
    assert.equal(
      stated,
      total,
      `the header quotes a total of ${String(stated)} bytes and its own five figures add up to ` +
        `${String(total)}`,
    );
  });

  it("gives every phase file a context budget that names what to read and what not to", () => {
    const unbudgeted = onDisk.filter(
      (name) => !/^## Context budget$/m.test(fileBodies.get(name) ?? ""),
    );
    assert.deepEqual(
      unbudgeted,
      [],
      `${String(unbudgeted.length)} phase file(s) carry no \`## Context budget\` heading: ` +
        `${unbudgeted.join(", ")}. A phase is a context budget rather than a topic, and a file ` +
        `that does not state its own leaves its reader to guess - which is the failure this ` +
        `directory exists to remove.`,
    );

    const halved = onDisk.filter((name) => {
      const body = fileBodies.get(name) ?? "";
      return !/^\*\*Read:\*\* \S/m.test(body) || !/^\*\*Do not read:\*\* \S/m.test(body);
    });
    assert.deepEqual(
      halved,
      [],
      `${String(halved.length)} phase file(s) state a budget without both halves: ` +
        `${halved.join(", ")}. \`**Read:**\` is the list a reader follows and the one that spends ` +
        `the window; \`**Do not read:**\` is the one that keeps it small. A budget holding only ` +
        `the first is a budget a reader can obey and still run out of room.`,
    );
  });
});
