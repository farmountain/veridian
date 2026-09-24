import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { registeredAdapters } from "../cli/worlds.ts";
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
 * **What the split actually is, measured across all twelve adapters rather than argued.** Three of
 * them - `local-api`, `local-process`, `local-web` - name a *measured* network answer in their
 * `boundaries()` (`enforced` or `unenforceable`); the other nine name `unsupported`. **The split is
 * by front door, and it stopped being by child when W1 landed**: before the seam moved into
 * `core/process.ts` only three worlds confined a child at all, so `confines a child` separated the
 * two populations by accident, and the sentence this file replaced said so - a claim the seam has
 * since made vacuous for every world in the roster, because all twelve hand the runner an allowance.
 * What separates them is that
 * a world whose every request passes a guarded route (`local-web`'s Playwright guard, `local-api`'s
 * own request guard) really can refuse one and so reports `enforced`; `local-process`'s subject is a
 * program rather than a front door, so it has no door of its own - and where it once had *no* answer
 * but `unenforceable`, because `node --allow-net` does not exist on this runtime, it now has two,
 * because a container runtime can hold the boundary the interpreter cannot.
 *
 * **A world's answer is allowed to be two words when the choice between them is a reading it took.**
 * That is the shape `local-process` acquired when it adopted the isolation substrate, and it is the
 * shape this file had to learn to tell apart from a report that simply declares two claims. The
 * difference is mechanical rather than stylistic: `enforced` **and** `unenforceable` in one arm is a
 * collapse of the answer into a contradiction when both are literals, and is one answer selected from
 * a mechanism when the arm consults what the mechanism reported. So the two-word case is now permitted
 * only alongside a read of `#isolation`, which is the same discipline `DERIVES` already applies to the
 * *filesystem* arm - and it is applied here rather than relaxed, because the alternative was a guard
 * that would have refused the corrected code and accepted the incorrect one.
 *
 * **`confines` used to be derived from a call to `confineChild`, and that derivation went stale the
 * moment the mechanism moved.** W1 put the application of an allowance in `core/process.ts`, so the
 * worlds that confine a child no longer name the function at all - three of them plainly did and this
 * guard would have reported that none did. The question it actually asks is *does this world hand the
 * runner an allowance*, and after the seam that is spelled `confinement: {` on a request: the
 * adapter's own half of the decision, and the half a new world can forget. The other half is the
 * answer it reads back, and the two are asserted to be one population rather than two lists.
 *
 * **These assertions are derived from the adapters, not listed beside them.** The roster is walked off
 * every file under `adapters/` that **declares an implementation of `EnvironmentAdapter`**, and every
 * population below is computed from an adapter's own source rather than from a hand-kept set of names.
 * That is the repository's own rule - *"a test that iterates a list can only cover the list it was
 * written with; the coverage has to come from the register"* - and it is why a twelfth world cannot
 * join either side of this split in silence, which is exactly how the sentence this file replaces went
 * stale.
 *
 * **The walk used to select on the filename and pair the rows with the *directory* names, and that
 * over-claimed.** It asserted that every directory under `adapters/` is a world, which is a claim
 * about the tree's layout rather than about the code - true only for as long as every adapter
 * directory also held a world, and falsified by `adapters/sim-mobile/` for as long as that directory
 * carried a substitute device port and the reading vocabulary that goes with it and no adapter: the
 * guard reported a missing adapter for a directory that had none to be missing. That directory has
 * since gained its world, which is precisely why the mechanism had to be repaired rather than waited
 * out - a guard that holds only while a coincidence holds is not holding anything, and the
 * coincidence was two edits away from being restored. A directory with no adapter is not a world, so
 * it cannot escape a split about worlds; what can is an **adapter nobody classified**, and
 * `implements EnvironmentAdapter` finds one however it is named or filed. The register is
 * cross-checked beside it for the complementary failure - an adapter nothing can construct, and a
 * declared world with nothing behind it.
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
  /** The file the row was read out of, relative to `adapters/` - the walk asserts it covers each one. */
  readonly file: string;
  /** The `network` arm of `boundaries()` - the answer this world gives, not the prose around it. */
  readonly networkArm: string;
  /** The `filesystemWrite` arm, same rule. */
  readonly filesystemArm: string;
  /**
   * Whether this adapter hands the runner an allowance to apply.
   *
   * Derived from the request literal, never listed: after W1 the mechanism lives in the runner, so
   * the *adapter's* contribution is the value and this is what that value looks like in the source.
   */
  readonly confines: boolean;
}

/**
 * Whether an adapter hands `core/process.ts` an allowance on a request.
 *
 * The needle is the field on a request literal rather than the word `confinement`, because an adapter
 * that merely mentioned the word in a comment, or imported the result type, would satisfy a substring
 * test while handing over nothing. What has to follow the colon is a *value*, and this tree spells one
 * two ways: the object literal eleven worlds write, and a call to a helper the **adapter itself**
 * owns - `confinement: this.#allowance()`, which is how `sim-mobile` states one allowance at two
 * sites rather than writing one security-relevant expression twice and keeping the copies in step by
 * hand. `confinement: {` was the whole of the needle until that world arrived, and it reported a
 * world that hands over an allowance as one that hands over nothing.
 *
 * Admitting the second spelling costs this guard nothing it was claiming. The needle establishes only
 * that a value is *present* at the field; that the value is a `ProcessConfinement` is the compiler's
 * half, asserted at the request literal by the parameter's own type - so a helper answering anything
 * else fails `npx tsc --noEmit` rather than this test, which is a stronger guard than a pattern here
 * could be. What it still refuses is what the paragraph above says it refuses: the word inside a
 * comment, an import, a mention in a string.
 *
 * The controls that keep the widened needle honest sit beside it rather than inside it. A world that
 * names `enforced` for `filesystemWrite` must also be one that handed over an allowance, and the
 * population that hands one over must be exactly the population that reads the answer back from
 * `#confinement`. A world satisfying this needle with a call to a helper that returned nothing usable
 * would still fail those two assertions, so the widening cannot be used to smuggle a world past the
 * split.
 */
function asksForConfinement(text: string): boolean {
  return /\bconfinement:\s*(?:\{|this\.#\w+\()/u.test(text);
}

/**
 * Every adapter's two boundary answers, discovered from what the files *declare*.
 *
 * The needle is `implements EnvironmentAdapter` rather than a filename, because the filename answers
 * a question about the convention this tree writes its adapters under, and this walk is asked about
 * the code: a file that implements the interface is an adapter whatever it is called, and a file that
 * does not is not one however it is called. It replaces a `*-environment.ts` selection that was
 * paired with the directory names beside it - see the doc block above for what that over-claimed.
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
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(join(dirPath, file), "utf8");
      if (!text.includes("implements EnvironmentAdapter")) continue;

      const at = text.indexOf("boundaries(): BoundaryReport");
      assert.notEqual(
        at,
        -1,
        `${dir.name}/${file} implements \`EnvironmentAdapter\` and answers the boundary question`,
      );

      // The filesystem answer is the rest of the method: from its own word to the end of the body.
      const between = text.indexOf("filesystemWrite", at);
      assert.notEqual(between, -1, `${dir.name}/${file} answers the filesystem half too`);
      const body = text.slice(at, text.indexOf("\n  }", between));

      rows.push({
        name: dir.name,
        file,
        networkArm: text.slice(at, between),
        filesystemArm: body,
        confines: asksForConfinement(text),
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
/** The worlds that hand the runner an allowance to apply. */
const CONFINE = ROWS.filter((row) => row.confines).map((row) => row.name).sort();
/** The worlds whose `filesystemWrite` arm reads the confinement back rather than declaring a value. */
const DERIVES = ROWS.filter((row) => row.filesystemArm.includes("#confinement"))
  .map((row) => row.name)
  .sort();
/** The worlds that mention `enforced` at all in their filesystem answer. */
const NAMING_ENFORCED_WRITE = ROWS.filter((row) => row.filesystemArm.includes('"enforced"'))
  .map((row) => row.name)
  .sort();
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
/**
 * The worlds whose network answer is *chosen* from a mechanism they read, rather than declared.
 *
 * Derived from the arm itself, on the same rule `DERIVES` applies to the filesystem half: a world that
 * reports what a substrate did has to have read what the substrate said. `#isolation` is the reading
 * - the runner's own answer, held on the world after the spawn - so an arm that names one and consults
 * the other is making one claim selected from a measurement, and an arm that names two without
 * consulting anything is making two claims at once.
 */
const CONDITIONAL_NETWORK = ROWS.filter((row) => row.networkArm.includes("#isolation"))
  .map((row) => row.name)
  .sort();

describe("the boundary vocabulary's claim about which world answers which way", () => {
  it("walks every file that declares an adapter, so a world cannot escape the split unnamed", () => {
    // Derived from an independent hunt for the *same property* the walk selects on - the declaration
    // that makes a file an adapter - rather than from a count written here, or from the names of the
    // directories the files happen to sit in. The property is that this guard *covers* the tree: an
    // adapter this walk does not see is an adapter the assertions below never judge, and that is
    // exactly how a roster guard goes quiet. A count is a floor beside the derivation, not the
    // derivation itself.
    const declaring = readdirSync(ADAPTERS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(ADAPTERS, entry.name))
          .filter((file) => file.endsWith(".ts"))
          .map((file) => `${entry.name}/${file}`),
      )
      .filter((path) => readFileSync(join(ADAPTERS, path), "utf8").includes("implements EnvironmentAdapter"))
      .sort();
    assert.deepEqual(
      ROWS.map((row) => `${row.name}/${row.file}`).sort(),
      declaring,
      "every file under `adapters/` that implements the adapter interface contributed exactly one row to this guard's walk",
    );

    // The complementary half, and the one a naming convention cannot answer: the register and the
    // tree are two statements of the same roster, reconciled by nothing. An adapter nothing can
    // construct and a declared world with no adapter behind it are both worlds that escape this
    // split - the first by existing nowhere the CLI can reach, the second by existing only as an
    // entry. The `kind` a world registers under and the directory it lives in are one name written
    // twice, so this also holds the layout the walk above deliberately stopped assuming.
    assert.deepEqual(
      ROWS.map((row) => row.name).sort(),
      [...registeredAdapters()].sort(),
      "every adapter in `adapters/` is a world `cli/worlds.ts` declares, and every world it declares has one",
    );

    assert.ok(ROWS.length >= 12, `walked ${String(ROWS.length)} adapters`);
  });

  it("asks the runner for an allowance in every world, so the write boundary is a mechanism rather than a claim", () => {
    // Every world in this tree starts real children - that is the whole point of `core/process.ts` -
    // so every world has an allowance to hand over, and each one's is genuinely its own: a database
    // world writes the SQLite file it rebuilds, a `sim-*` world writes the sandbox it provisions.
    // Pinned to every row this guard walked rather than to a hand-written list of names, so a
    // world added to `adapters/` has to answer this too - and the walk's own register cross-check
    // above is what makes "every row" and "every world the CLI can construct" the same sentence.
    assert.deepEqual(
      CONFINE,
      ROWS.map((row) => row.name).sort(),
      "a world that starts a child without handing the runner an allowance is a world whose write boundary is a sentence rather than a mechanism",
    );
  });

  it("derives the filesystem answer from the confinement in exactly the worlds that asked for one", () => {
    // The two halves of the seam, asserted to be one population. An adapter that asks for an
    // allowance and then declares its own answer has a report that can disagree with the child that
    // was started - which is the live defect this file holds. An adapter that reads a confinement it
    // never asked for would be reading `null` forever and reporting `unsupported` for a working world.
    assert.deepEqual(
      DERIVES,
      CONFINE,
      "a world either asks for an allowance and reads it back, or does neither",
    );
    assert.ok(CONFINE.length >= 3, `derived ${String(CONFINE.length)} confining worlds`);
  });

  it("never lets a world name `enforced` for the write boundary without having asked for one", () => {
    // The anti-fabrication half, and it holds however many worlds have been migrated: a report of
    // `enforced` is a claim that a mechanism ran, so every world making it must be one that supplied
    // the mechanism something to apply.
    for (const name of NAMING_ENFORCED_WRITE) {
      assert.ok(CONFINE.includes(name), `${name} names \`enforced\` without handing the runner an allowance`);
    }
  });

  it("finds that the three worlds answering the network question with a measurement are the two with a guarded door and the one with no door", () => {
    // This is the invariant the corrected doc block states, and it is about the *network* arm - the
    // one answer W1 deliberately left alone. It is deliberately **not** phrased as "the worlds that
    // confine a child", which is how it was first written: W1 gave every world in the roster an
    // allowance, so that phrase now denotes every row in `ROWS` and would describe this set with a
    // property that is true of its complement too. What holds is narrower - a world whose every
    // request passes a route guard it holds can refuse one and answers `enforced`; a world with no
    // door has only the child's own socket to reason about and answers `unenforceable`; a world that
    // holds neither answers `unsupported`, whichever way the measurement would come out if it had
    // one to take.
    assert.deepEqual(
      MEASURED,
      ["local-api", "local-process", "local-web"],
      "the worlds that answer the network question with a measurement are the two with a guarded door and the one with no door",
    );
  });

  it("names `unenforceable` in exactly one world, and it is the world whose subject is a program", () => {
    assert.deepEqual(NAMING_UNENFORCEABLE, ["local-process"]);
  });

  it("names `enforced` in the two worlds with a guarded front door and the one that can hold a substrate", () => {
    // The third world is new, and it arrived with the isolation substrate rather than with a door: a
    // container severs the network by a flag the interpreter has no equivalent for, so a world whose
    // subject is a program can now answer `enforced` **when it read that one held**. Naming it here
    // rather than loosening the assertion is the point - the set is still exact, and a fourth world
    // arriving in it has to come and say why.
    assert.deepEqual(NAMING_ENFORCED, ["local-api", "local-process", "local-web"]);
    assert.deepEqual(
      CONDITIONAL_NETWORK,
      ["local-process"],
      "exactly the world that can answer either way has to be reading the mechanism that decides",
    );
  });

  it("never lets one world answer both ways unless the choice between them is a reading it took", () => {
    // The rule this holds is narrower than it first read, and the narrowing is the correction rather
    // than an exemption. Two enforcement literals in one arm is a report that is two claims at once -
    // which is why the original test existed and why it was written as a flat refusal. But a world
    // that *selected* its answer from a mechanism reading is making one claim, and the flat refusal
    // would have called that a contradiction while letting a genuine one through as long as only one
    // word was spelled. So the question is now the one that actually matters: **what decided?**
    for (const row of ROWS) {
      const words = wordsIn(row.networkArm);
      const both = words.includes("enforced") && words.includes("unenforceable");
      assert.ok(
        !both || row.networkArm.includes("#isolation"),
        `${row.name} names both \`enforced\` and \`unenforceable\` without reading the mechanism that ` +
          "would decide between them, so its answer is two claims at once",
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
