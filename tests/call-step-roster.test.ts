import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Which worlds perform a `call` step, held to what the documents say about them.
 *
 * ## Why this guard exists
 *
 * `call` is the sixth step kind, and the only one that puts the **criterion's own** request to a world
 * rather than reading a request the application made. How many worlds perform it is therefore a fact a
 * contract author depends on: a criterion whose meaning rests on asking the world directly can only be
 * judged by a world that can be asked.
 *
 * That fact drifted, in three documents at once, and nothing noticed for several passes because **no
 * guard read it**. `AGENTS.md` said `sim-cloud` was *"one of **three** worlds that perform a `call`
 * step"* and named `sim-data` as the third; `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` called `sim-cloud`
 * *"the only world that performs a `call` step"* in one section and `local-api` the same thing in
 * another, and a third section said the cloud plan *"and only the cloud plan"* admits it. **The count
 * is two**, and the sharpest evidence that nothing was checking is that one of those paragraphs called
 * `local-api` the only performer while naming `sim-cloud` as the world the kind came from - a
 * contradiction inside a single paragraph.
 *
 * ## What it derives, and from what
 *
 * The walk is the one `tests/boundary-roster.test.ts` established: every `adapters/*` directory, every
 * `.ts` file that says `implements EnvironmentAdapter`. A world performs `call` when its text carries
 * one of the **two** spellings this tree writes it in - an entry `call: true` in a
 * `STEP_KINDS_PERFORMED` register, or an admits-only-`call` guard `step.kind !== "call"`. Both are
 * specific to this question, and both are asserted to be *findable* rather than assumed: the positive
 * control below fails if the walk finds no world at all, so a mistyped marker reports as a broken
 * probe rather than as a world that stopped performing `call`.
 *
 * ## What it does not derive, stated rather than implied
 *
 * This is a **source-text** roster, and the register of rules paid for says plainly what that is worth:
 * *"a source-text guard is cheap, survives refactors that change behaviour, and answers a different
 * question - so write it, and then write the half that runs the thing."* The half that runs the thing
 * already exists and is per world: `tests/sim-cloud-environment.test.ts`, `tests/sim-os-environment.test.ts`,
 * `tests/sim-posix-environment.test.ts` and `tests/sim-vscode-environment.test.ts` each assert that an
 * acting call **refuses a step it cannot perform** rather than skipping it, and
 * `tests/local-api-demo.test.ts` asserts that every criterion there is judged through `call` steps. So
 * this file answers *what do the documents claim, and does the code agree*; the behaviour of any one
 * world is answered where that world's suite already answers it.
 *
 * ## The two documents, and the two questions asked of them
 *
 * 1. **`AGENTS.md` states a count**, and a count is a claim: the number it writes must equal the number
 *    derived here. It is written as a word (`one of **two** worlds`), so the word is mapped and
 *    compared - which is the only way a spelled number can be checked at all.
 * 2. **`docs/DISTRIBUTION-AND-ENVIRONMENTS.md` states the same count in two places** - the sentence
 *    that introduces the kind and the `call` step row of §7 - and both must agree with the code.
 *
 * ## Why this is a count check and not a search for forbidden words
 *
 * The first draft of this file asserted the *absence* of the two absolutes that had rotted - "*the only
 * world that performs a `call` step*" and "*and only the cloud plan, admits it*". It failed immediately,
 * on the **correction**: the paragraph that fixed the first absolute quotes it, so a regex over the
 * whole document matches the sentence explaining that the sentence was wrong. That is a trap this
 * repository has already paid for once, in the register, in almost these words - *"a guard written as a
 * regex over a module's whole source cannot pass when the module's own prose uses the word it
 * forbids"* - and the trap is worth meeting twice, because the fix generalises: **ask a question the
 * defect fails and the correction passes.** A count does that. "Only one world" states no count, so the
 * old text cannot satisfy this check; the corrected text states one and can.
 *
 * The same reasoning is why the roster is compared as a *count* rather than as a list of names: a
 * document may name a world for any number of reasons, and a list of names in a document is read by
 * nothing that could disagree with it - which is the defect, not the guard.
 */

const REPO = fileURLToPath(new URL("../", import.meta.url));
const ADAPTERS = join(REPO, "adapters");

/** The two spellings of "this world performs `call`", each specific to the question. */
const MARKERS = [/\bcall:\s*true\b/u, /!==\s*"call"/u] as const;

/**
 * Every adapter whose text declares it performs a `call` step.
 *
 * Returns a sorted list of adapter directory names, which is the name a reader would use - the world
 * is the directory, and the files inside it are its parts.
 */
function worldsPerformingCall(): readonly string[] {
  const worlds: string[] = [];

  for (const dir of readdirSync(ADAPTERS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(ADAPTERS, dir.name);

    let performs = false;
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(join(dirPath, file), "utf8");
      // The interface needle, not the filename: a file that implements the interface is an adapter
      // whatever it is called, and `boundary-roster` records what a `*-environment.ts` selection
      // over-claimed once it was paired with the directory names beside it.
      if (!text.includes("implements EnvironmentAdapter")) continue;
      if (MARKERS.some((marker) => marker.test(text))) performs = true;
    }
    if (performs) worlds.push(dir.name);
  }

  return worlds.sort();
}

/**
 * The spelled numbers this check understands.
 *
 * Deliberately not a general number-word parser: a guard that tries to read every spelling drifts into
 * being a grammar, and the failure it would produce is a parse error rather than a count that disagrees.
 * A word outside this map is reported as an unreadable claim, which is the honest outcome.
 */
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4 };

const agents = readFileSync(join(REPO, "AGENTS.md"), "utf8");
const distribution = readFileSync(join(REPO, "docs/DISTRIBUTION-AND-ENVIRONMENTS.md"), "utf8");

describe("the `call` step roster", () => {
  const worlds = worldsPerformingCall();

  it("finds the worlds that perform it, and the walk is not empty", () => {
    // The control. A marker that stopped matching - a refactor, a typo in this file - would leave an
    // empty set and every assertion below would pass over nothing, which is the failure mode a roster
    // guard has instead of a crash.
    assert.notEqual(
      worlds.length,
      0,
      "the walk found no world that performs a `call` step. Either the markers in this file no " +
        "longer match how the adapters are written, or every world stopped performing it - and " +
        "`tests/local-api-demo.test.ts` asserts the opposite of the second for `local-api`.",
    );
  });

  it("is exactly `local-api` and `sim-cloud`", () => {
    assert.deepEqual(
      worlds,
      ["local-api", "sim-cloud"],
      "the worlds that perform a `call` step have moved. `sim-cloud` introduced the kind and " +
        "`local-api` reuses it; a third world performing it, or one of these two stopping, is a change " +
        "the documents below state a count for and must be corrected in the same pass.",
    );
  });

  it("AGENTS.md writes the count it derived, as a word that can be read", () => {
    const claim = /one of \*\*(\w+)\*\* worlds that/u.exec(agents);
    assert.notEqual(claim, null, "AGENTS.md no longer states how many worlds perform a `call` step");

    const word = (claim?.[1] ?? "").toLowerCase();
    const stated = NUMBER_WORDS[word];
    assert.notEqual(
      stated,
      undefined,
      `AGENTS.md writes the count as "${word}", which this check cannot read as a number. A figure ` +
        "written as a word is a figure no comparison reaches, which is why it is the half that drifts.",
    );
    assert.equal(
      stated,
      worlds.length,
      `AGENTS.md says one of ${String(stated)} worlds perform a \`call\` step, and ${String(worlds.length)} do: ${worlds.join(", ")}`,
    );
  });

  it("AGENTS.md does not name a world that performs no `call` step as one that does", () => {
    // The sentence it used to carry: *"`local-api` does it for every criterion, and `sim-data` for the
    // ones that ask the broker a question of its own."* `sim-data` performs only `run` steps and lets a
    // criterion put its own request to the broker **on a `run` step's behalf**, read back by the
    // `data.probe` validator - which is the same end by a different route, not the same step kind.
    assert.ok(
      !/`sim-data` for the ones that ask/u.test(agents),
      "AGENTS.md names `sim-data` as performing a `call` step. It does not: it performs only `run` " +
        "steps and reaches a criterion's own request through one, read back by `data.probe`.",
    );
  });

  it("the distribution document states the count in both places it makes the claim", () => {
    // Two sites, because the document makes the claim twice and a count that agrees in one place and
    // disagrees in another is the half-updated figure this repository keeps paying for.
    const sites = [
      { where: "the sentence introducing the kind", pattern: /one of \*\*(\w+)\*\* worlds that perform/u },
      { where: "the `call` step row of §7", pattern: /\*\*(\w+) worlds perform it\*\*/u },
    ] as const;

    for (const site of sites) {
      const claim = site.pattern.exec(distribution);
      assert.notEqual(
        claim,
        null,
        `docs/DISTRIBUTION-AND-ENVIRONMENTS.md no longer states how many worlds perform a \`call\` ` +
          `step in ${site.where}. Either the sentence was removed - in which case the roster lost its ` +
          "claim rather than gaining one - or it was reworded past this check, which needs re-aiming.",
      );

      const word = (claim?.[1] ?? "").toLowerCase();
      const stated = NUMBER_WORDS[word];
      assert.notEqual(
        stated,
        undefined,
        `${site.where} writes the count as '${word}', which this check cannot read as a number.`,
      );
      assert.equal(
        stated,
        worlds.length,
        `${site.where} says ${String(stated)} worlds perform a \`call\` step, and ` +
          `${String(worlds.length)} do: ${worlds.join(", ")}`,
      );
    }
  });
});
