import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";

/**
 * Every `demo:*` script `package.json` declares must be named in the code blocks of `README.md` and
 * `AGENTS.md`.
 *
 * This is the guard the repository calls for under "a roster in prose and a roster in a registry are
 * two lists of the same thing, and only one of them is executable" - and it was written because the
 * drift was already here. `AGENTS.md`'s `Running things:` block listed eleven of the thirteen
 * declared scripts and silently omitted **two**: `demo:vscode` and `demo:data` were declared,
 * shipped and documented in `README.md`, and named nowhere in the block a reader consults to learn
 * what can be run. Nothing failed, because a list of names in a document is read by nothing that
 * could disagree with it. It was found by walking the roster by hand during the twelfth demo's
 * landing, which is the expensive way and the reason this file exists.
 *
 * Two decisions about what this holds, both deliberate.
 *
 * **It reads fenced code blocks, not the whole file.** A name mentioned in prose is not a command a
 * reader can lift, and the defect this guards against was a missing *block* entry while the same demo
 * was described at length in the document's own layout table. Matching the whole file would have
 * passed over exactly the drift that prompted the file.
 *
 * **It requires both command blocks to name every declared demo, and tolerates exactly one named
 * exemption in `README.md`.** `AGENTS.md` is the hand-off to the next agent and its block is the
 * operational roster, so a script missing from it is the defect. `README.md`'s quickstart block omits
 * `demo:no-browser` because that script demonstrates a refusal rather than a pass and is introduced
 * in its own paragraph further down instead - so requiring an identical set of both documents would
 * be requiring a document to say something it means not to say. Draining that into a filter with no
 * name would be the defect this whole file is about, so it is a constant with an assertion beside it.
 */

const repo = nodeIo();

/**
 * Every command a document's fenced code blocks would hand a reader, as the words after `npm run`.
 *
 * The `demo` prefix is compared whole rather than by `startsWith`, because `demo` is a prefix of
 * `demo:db` and a roster check that could not tell those apart would be a check on the first three
 * characters of every script name.
 */
function commandsIn(body: string): readonly string[] {
  const names = new Set<string>();
  let fenced = false;

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) continue;

    const match = /^npm run (\S+)/.exec(line.trim());
    if (match?.[1] !== undefined) names.add(match[1]);
  }

  return [...names];
}

function declaredDemoScripts(manifest: string): readonly string[] {
  const parsed: unknown = JSON.parse(manifest);
  assert.ok(
    typeof parsed === "object" && parsed !== null && "scripts" in parsed,
    "package.json no longer carries a `scripts` object for this roster to be held against",
  );

  const scripts = (parsed as { scripts: Record<string, string> }).scripts;
  return Object.keys(scripts)
    .filter((name) => name === "demo" || name.startsWith("demo:"))
    .sort();
}

const manifest = await repo.readTextFile("package.json");
const readme = await repo.readTextFile("README.md");
const agents = await repo.readTextFile("AGENTS.md");

assert.ok(manifest !== null, "package.json could not be read");
assert.ok(readme !== null, "README.md could not be read");
assert.ok(agents !== null, "AGENTS.md could not be read");

const declared = declaredDemoScripts(manifest);
const inReadme = commandsIn(readme);
const inAgents = commandsIn(agents);

/**
 * The one declared demo `README.md` is not required to put in its quickstart block.
 *
 * `demo:no-browser` demonstrates a *refusal* rather than a pass - it runs the canonical contract with
 * `--browser none` and must end `INCONCLUSIVE` - so it is introduced in its own paragraph further
 * down the page instead of in the list of demos to run. The exemption is a named constant rather
 * than an inline filter so that a second script quietly joining it is a visible edit, and it is
 * paired with an assertion that the exempted script still appears *somewhere* on the page: an
 * exemption whose script nobody documents is how a script goes undocumented while a guard passes.
 *
 * This is also the failure this file's first run produced - the comment above the code stated the
 * reader-versus-roster distinction and the code asserted the stricter claim anyway, so the guard
 * failed on a correct document. A comment describing what an implementation does is not the
 * implementation.
 */
const NOT_IN_README_QUICKSTART: readonly string[] = ["demo:no-browser"];

describe("the demo rosters name the scripts that exist", () => {
  it("holds a roster large enough for the comparison to mean anything", () => {
    // A vacuous guard is worse than none, and this one goes vacuous the moment the manifest renames
    // its scripts: the filter would find nothing, and a check that every member of an empty set is
    // documented passes without looking at either document. The floor is how this guard says it
    // looked at something rather than how it says the count is right - the count is not the claim.
    assert.ok(
      declared.length >= 12,
      `package.json declares ${String(declared.length)} demo scripts, so this roster is checking ` +
        "almost nothing - either the naming convention changed or the demos were removed",
    );
  });

  it("lets a reader run every declared demo from README.md", () => {
    const exempt = new Set(NOT_IN_README_QUICKSTART);
    assert.deepEqual(
      declared.filter((name) => !inReadme.includes(name) && !exempt.has(name)),
      [],
      "README.md's code blocks no longer let a reader run every declared demo",
    );

    for (const name of NOT_IN_README_QUICKSTART) {
      assert.ok(
        readme.includes(`npm run ${name}`),
        `README.md exempts \`${name}\` from its quickstart block and then never names the command ` +
          "anywhere on the page, so the exemption has become an omission",
      );
    }
  });

  it("names every declared demo in AGENTS.md's command block", () => {
    assert.deepEqual(
      declared.filter((name) => !inAgents.includes(name)),
      [],
      "AGENTS.md's `Running things:` block no longer names every declared demo - the script is " +
        "declared and shipped, and the document a reader consults does not say it exists",
    );
  });

  it("names no demo the manifest does not declare", () => {
    const invented = [...inReadme, ...inAgents]
      .filter((name) => name === "demo" || name.startsWith("demo:"))
      .filter((name) => !declared.includes(name))
      .sort();

    assert.deepEqual(
      invented,
      [],
      "a document names a demo script `package.json` does not declare, which is the `db.query` " +
        "defect with a command instead of a validator: a list of names in a document is read by " +
        "nothing that could disagree with it",
    );
  });
});
