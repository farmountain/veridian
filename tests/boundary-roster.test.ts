import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { BOUNDARY_ENFORCEMENTS, type BoundaryEnforcement } from "../core/environment/types.ts";

/**
 * The boundary vocabulary in `core/environment/types.ts` makes a claim about which worlds answer the
 * network question *which way*, and until this file existed that claim was held by prose alone.
 *
 * It was wrong. The doc block said `unenforceable` *"is how `network` is reported for a host child
 * process"* - a universal rule - while `local-web` and `local-api` are both host-child worlds and both
 * report `enforced`. The sentence had been written when `local-process` was the only world that could
 * confine a child at all, and it generalised one world's answer to its siblings the moment they
 * caught up. Nothing failed, because a sentence in a doc comment is read by nothing that could
 * disagree with it - the same shape as `db.query`, `db.rowCount`, `web.visible` and the `demo:*`
 * rosters, each of which was a name in a document that no code path checked.
 *
 * **What the split actually is, measured across all eleven adapters rather than argued.** The three
 * worlds that call `confineChild` - `local-api`, `local-process`, `local-web` - are exactly the three
 * whose `boundaries()` names a *measured* network answer (`enforced` or `unenforceable`). The other
 * eight name `unsupported`, because they act in process and hold no boundary to measure. Within the
 * confining three the split is by front door: a world whose every request passes a guarded route
 * (`local-web`'s Playwright guard, `local-api`'s own request guard) really can refuse one, so it
 * reports `enforced`; `local-process`'s subject is a program rather than a front door, so it has only
 * the child's own socket to reason about and reports `unenforceable`, because `node --allow-net` does
 * not exist on this runtime.
 *
 * **These assertions are derived from the adapters, not listed beside them.** The roster is walked off
 * `adapters/**\/*-environment.ts`, and `confines` is computed from whether an adapter's own source
 * calls `confineChild` rather than from a hand-kept set of three names. That is the repository's own
 * rule - *"a test that iterates a list can only cover the list it was written with; the coverage has
 * to come from the register"* - and it is why a twelfth world cannot join either side of this split in
 * silence, which is exactly how the sentence this file replaces went stale.
 *
 * **One assertion here is static and covers a world that has no unit suite at all.** `local-api` ships
 * a demo and nothing else - `tests/local-api-demo.test.ts` asserts nothing about boundaries, and there
 * is no `tests/local-api-environment.test.ts` - so the derivation at its `filesystemWrite` arm is
 * reached by no test in this tree. Reading that arm and requiring it to mention `#confinement` is
 * weaker than driving it, and it is much stronger than the nothing that was there: it is the
 * difference between the literal that caused a live defect and the derivation that replaced it, and it
 * holds for all three sites at once.
 */

const ADAPTERS = fileURLToPath(new URL("../adapters/", import.meta.url));
const TYPES = fileURLToPath(new URL("../core/environment/types.ts", import.meta.url));

interface AdapterRow {
  readonly name: string;
  /** The `network` arm of `boundaries()` - the answer this world gives, not the prose around it. */
  readonly networkArm: string;
  /** The `filesystemWrite` arm, same rule. */
  readonly filesystemArm: string;
  /** Whether this adapter starts a real child it can confine. Derived, never listed. */
  readonly confines: boolean;
}

/**
 * Every adapter's two boundary answers, discovered from the tree.
 *
 * The arm is taken as the span between `boundaries()` and the word `filesystemWrite`, because that
 * span *is* the network answer - prose included. Scanning for the vocabulary words inside it asks the
 * question the doc block makes: which words does this world's answer name?
 */
function adapterRows(): readonly AdapterRow[] {
  const rows: AdapterRow[] = [];

  for (const dir of readdirSync(ADAPTERS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(ADAPTERS, dir.name);

    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith("-environment.ts")) continue;
      const text = readFileSync(join(dirPath, file), "utf8");
      const at = text.indexOf("boundaries(): BoundaryReport");
      assert.notEqual(at, -1, `${dir.name}/${file} declares boundaries()`);

      // The filesystem answer is the rest of the method: from its own word to the end of the body.
      const between = text.indexOf("filesystemWrite", at);
      assert.notEqual(between, -1, `${dir.name}/${file} answers the filesystem half too`);
      const body = text.slice(at, text.indexOf("\n  }", between));

      rows.push({
        name: dir.name,
        networkArm: text.slice(at, between),
        filesystemArm: body,
        confines: text.includes("confineChild"),
      });
    }
  }

  assert.notEqual(rows.length, 0, "the adapter roster was walked");
  return rows;
}

/**
 * Which of the four legal words a boundary arm names.
 *
 * The return type is the vocabulary itself, so "does this adapter answer in the declared
 * vocabulary" is a question the *compiler* answers - `boundaries()` returns a `BoundaryReport`, whose
 * members are `BoundaryEnforcement`. Scanning for the words here can therefore only report which of
 * the four legal ones an arm names; a fifth value would be a type error at the adapter, which is a
 * stronger guard than any assertion in this file could be, so no assertion here claims it.
 */
function wordsIn(arm: string): readonly BoundaryEnforcement[] {
  return BOUNDARY_ENFORCEMENTS.filter((word) => arm.includes(`"${word}"`));
}

const ROWS = adapterRows();
const CONFINE = ROWS.filter((row) => row.confines).map((row) => row.name).sort();
const MEASURED = ROWS.filter((row) => {
  const words = wordsIn(row.networkArm);
  return words.includes("enforced") || words.includes("unenforceable");
})
  .map((row) => row.name)
  .sort();
const NAMING_UNENFORCEABLE = ROWS.filter((row) => wordsIn(row.networkArm).includes("unenforceable"))
  .map((row) => row.name)
  .sort();
const NAMING_ENFORCED = ROWS.filter((row) => wordsIn(row.networkArm).includes("enforced"))
  .map((row) => row.name)
  .sort();

describe("the boundary vocabulary's claim about which world answers which way", () => {
  it("walks every directory that holds an adapter, so a new world cannot escape the split", () => {
    // Derived from a second walk - the directory names - rather than from a count written here. The
    // property is that this guard *covers* the tree: an adapter file that does not end in
    // `-environment.ts` is an adapter the assertions below never see, and that is exactly how a
    // roster guard goes quiet. The count is a floor beside the derivation, not the derivation.
    const dirs = readdirSync(ADAPTERS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      ROWS.map((row) => row.name).sort(),
      dirs,
      "every adapter directory contributed exactly one row to this guard's walk",
    );
    assert.ok(ROWS.length >= 11, `walked ${String(ROWS.length)} adapters`);
  });

  it("finds that the worlds which confine a child are exactly the worlds that measure the network answer", () => {
    // This is the invariant the corrected doc block states. It holds in both directions: an adapter
    // that confines a child cannot answer `unsupported` (it has a mechanism to report on), and an
    // adapter that holds no mechanism cannot answer `enforced` (nothing was applied to report).
    assert.deepEqual(
      MEASURED,
      CONFINE,
      "a world that confines a child is one that answers the network question with a measurement",
    );
    assert.deepEqual(CONFINE, ["local-api", "local-process", "local-web"]);
  });

  it("names `unenforceable` in exactly one world, and it is the world whose subject is a program", () => {
    assert.deepEqual(NAMING_UNENFORCEABLE, ["local-process"]);
  });

  it("names `enforced` in exactly the two worlds whose every request passes a guarded front door", () => {
    assert.deepEqual(NAMING_ENFORCED, ["local-api", "local-web"]);
  });

  it("never lets one world answer both ways, so the three-way split cannot collapse to two", () => {
    for (const row of ROWS) {
      const words = wordsIn(row.networkArm);
      assert.ok(
        !(words.includes("enforced") && words.includes("unenforceable")),
        `${row.name} names both \`enforced\` and \`unenforceable\`, so its answer is two claims at once`,
      );
    }
  });

  it("derives the filesystem answer from the confinement instead of declaring it", () => {
    // The live defect this holds: `local-web` and `local-api` passed an empty write allowance to a
    // child and then reported the boundary the operator asked for as `enforced`. A literal in either
    // arm is how a report stops describing the child that was really started - and `local-api` has no
    // unit suite to catch it, so this static reading is the only coverage that site has.
    for (const row of ROWS.filter((entry) => entry.confines)) {
      assert.match(
        row.filesystemArm,
        /#confinement/u,
        `${row.name} reports a filesystem boundary without reading the confinement it was started with`,
      );
    }
  });
});

describe("the doc block that states the split", () => {
  it("names every enforcement the vocabulary declares, so a fifth value cannot arrive without prose", () => {
    const text = readFileSync(TYPES, "utf8");
    const from = text.indexOf("What became of one declared boundary.");
    const to = text.indexOf("export const BOUNDARY_ENFORCEMENTS");
    assert.notEqual(from, -1, "the vocabulary's doc block was found");
    assert.notEqual(to, -1, "the vocabulary was found");
    const doc = text.slice(from, to);

    for (const word of BOUNDARY_ENFORCEMENTS) {
      assert.ok(
        doc.includes(`\`${word}\``),
        `\`${word}\` is declared but not described in the doc block that explains the vocabulary`,
      );
    }
  });

  it("names the three worlds the split is about, because that is the claim that was wrong", () => {
    const text = readFileSync(TYPES, "utf8");
    const from = text.indexOf("What became of one declared boundary.");
    const to = text.indexOf("export const BOUNDARY_ENFORCEMENTS");
    const doc = text.slice(from, to);

    // The sentence that stood here generalised `local-process`'s answer to every host child process,
    // while `local-web` and `local-api` - both host-child worlds - answered `enforced`. Naming all
    // three is what makes the corrected paragraph checkable against the adapters above.
    for (const name of ["local-process", "local-web", "local-api"]) {
      assert.ok(
        doc.includes(`\`${name}\``),
        `the doc block describes \`unenforceable\` without naming ${name}, so its claim cannot be read against that adapter`,
      );
    }
  });
});

/**
 * The documents that state this vocabulary, as opposed to the code that declares it.
 *
 * These are read as *rosters* rather than searched for words. `unsupported` and `enforced` are
 * ordinary English words and appear throughout the tree; what a document must not do is print a
 * **list** of the vocabulary that is missing a member, because that is the one shape a reader takes
 * as authoritative. `docs/BOUNDARY-ENFORCEMENT.md` did exactly that - it printed three of the four
 * from the day the fourth was added - and nobody noticed, because a list of names in a document is
 * read by nothing that could disagree with it.
 */
const DOCUMENTS = [
  fileURLToPath(new URL("../docs/BOUNDARY-ENFORCEMENT.md", import.meta.url)),
  fileURLToPath(new URL("../docs/BOUNDARY-SPINE-DESIGN.md", import.meta.url)),
  fileURLToPath(new URL("../docs/DISTRIBUTION-AND-ENVIRONMENTS.md", import.meta.url)),
] as const;

/**
 * Every roster-shaped run of quoted tokens in a text.
 *
 * A run is two or more quoted tokens separated by `|` or `,`, which is how both the prose roster
 * (`"a" | "b"`) and the array form (`["a", "b"]`) are spelled. Prose that merely mentions a word is
 * not a roster and is deliberately not matched: the question is what the document presents as the
 * vocabulary, not every place a word appears.
 */
function rostersIn(text: string): readonly (readonly string[])[] {
  const rosters: string[][] = [];
  for (const line of text.split(/\r?\n/u)) {
    const tokens = [...line.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
    if (tokens.length < 2) continue;
    // Both spellings of a roster: the prose form separates with `|`, the array form with `,`. The
    // first draft of this predicate tested only `,` and therefore found **one** roster where there
    // were two - which the population assertion below reported rather than the guard passing on a
    // population it had not measured.
    if (!/[|,]\s*"/u.test(line)) continue;
    rosters.push(tokens);
  }
  return rosters;
}

describe("the documents that print the boundary vocabulary", () => {
  it("never prints a roster of it that omits a member, in any document", () => {
    const counts = new Map<string, number>();

    for (const path of DOCUMENTS) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      let found = 0;
      for (const roster of rostersIn(readFileSync(path, "utf8"))) {
        // Only rosters that are *about* this vocabulary are judged. A line listing a different
        // vocabulary - `"deny" | "allow-list" | "allow"` - intersects this one not at all.
        const present = BOUNDARY_ENFORCEMENTS.filter((word) => roster.includes(word));
        if (present.length === 0) continue;
        found += 1;
        assert.deepEqual(
          [...present].sort(),
          [...BOUNDARY_ENFORCEMENTS].sort(),
          `${name} prints a roster of the boundary vocabulary that omits ${BOUNDARY_ENFORCEMENTS.filter((word) => !present.includes(word)).join(", ")}, so a reader takes four values for three`,
        );
      }
      counts.set(name, found);
    }

    // A guard over zero rosters passes for the wrong reason, so the population is asserted too - and
    // per document, not in aggregate, because one document printing the vocabulary twice covers for
    // another that stopped printing it at all. The floor is the document list itself rather than a
    // number recalled beside it.
    for (const [name, found] of counts) {
      assert.ok(found >= 1, `${name} states the boundary vocabulary nowhere as a roster, so this guard covered nothing in it`);
    }
  });

  it("names the one world that answers `unenforceable`, in every document that explains the split", () => {
    // Derived from the adapters, not recalled: whatever world the code named as `unenforceable` is
    // the world the prose has to name, so a twelfth world moves this expectation rather than
    // silently leaving the documents describing the old one.
    assert.equal(NAMING_UNENFORCEABLE.length, 1, "the derivation itself is no longer a single world");
    const [world] = NAMING_UNENFORCEABLE;

    for (const path of DOCUMENTS) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      assert.ok(
        readFileSync(path, "utf8").includes(`\`${world ?? ""}\``),
        `${name} explains the boundary vocabulary without naming \`${world ?? ""}\`, the one world that reports \`unenforceable\``,
      );
    }
  });

  it("keeps the answer it superseded and marks it, rather than rewriting the record", () => {
    const text = readFileSync(DOCUMENTS[0], "utf8");

    // Q4 was answered "no, it is not enforceable" and the answer was wrong about the mechanism. The
    // document records the answers the self-prompting produced, so the answer is kept and marked -
    // deleting it would destroy the evidence that the mechanism claim was made and falsified.
    assert.ok(
      text.includes("only real process isolation could hold that boundary"),
      "the superseded Q4 answer was deleted rather than marked, so the record no longer shows what was claimed",
    );
    assert.ok(text.includes("Superseded"), "the superseded Q4 answer carries no marker saying it was superseded");
    assert.ok(
      text.includes("confinementCapability"),
      "the marked answer does not name the mechanism that falsified it, so a reader cannot check the reversal",
    );
  });
});
