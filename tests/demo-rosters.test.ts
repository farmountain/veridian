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

function declaredScripts(manifest: string): Record<string, string> {
  const parsed: unknown = JSON.parse(manifest);
  assert.ok(
    typeof parsed === "object" && parsed !== null && "scripts" in parsed,
    "package.json no longer carries a `scripts` object for this roster to be held against",
  );

  return (parsed as { scripts: Record<string, string> }).scripts;
}

function declaredDemoScripts(manifest: string): readonly string[] {
  return Object.keys(declaredScripts(manifest))
    .filter((name) => name === "demo" || name.startsWith("demo:"))
    .sort();
}

/**
 * Whether a workflow really *runs* a command rather than mentioning one.
 *
 * Two things make this a line rather than a substring. A `#` comment naming a script is a note about
 * CI, and a roster that accepted one would be satisfied by the sentence explaining why the command
 * exists - so the line has to *be* the command, with nothing before `npm` but indentation or the
 * `run:` key itself. And the file uses both spellings of that key, which the first version of this
 * function did not: `run: |` followed by bare command lines (the demo loop) and `run: npm run x` as
 * an inline scalar (the self-acceptance step). Only the block form was matched, so the check failed
 * against a workflow that was correctly running the command - *a guard has to read every spelling of
 * the thing it is looking for, or it reports a correct document as wrong.*
 */
function runsInWorkflow(body: string, name: string): boolean {
  return workflowRunIndex(body, name) >= 0;
}

/**
 * Where in a workflow the line that runs `name` sits, or `-1` when no line does.
 *
 * The single definition of "this line is the command": `runsInWorkflow` asks whether such a line
 * exists, and the ordering check in the fourth roster asks *where* it is. Two regexes would be two
 * answers to one question, which is the divergence this repository has a whole entry about, so the
 * shape lives here and both callers read it.
 */
function workflowRunIndex(body: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[ \\t]*(run:[ \\t]*)?npm run ${escaped}[ \\t]*$`, "m").exec(body);
  return match?.index ?? -1;
}

/**
 * Every demo a workflow would run, read out of the workflow rather than out of a note about it.
 *
 * Two shapes have to be read together because the file uses both, and the third list this file
 * exists to reconcile is the workflow's. A demo named literally (`npm run demo:no-browser`) is a
 * command; the twelve worlds are not written out at all - the job holds `for world in db k8s ...`
 * and runs `npm run demo:$world` - so a check that scraped only literals would find one world per
 * *name*, and a check that scraped only the loop would miss the refusal.
 *
 * `$world` is deliberately not expanded by the regex but by the loop list it reads, and a match
 * containing `$` is discarded rather than kept: `echo "::group::npm run demo:$world"` is a line in
 * this file, and taking it as a command would put a variable name in a roster of scripts.
 */
function demosInWorkflow(body: string): readonly string[] {
  const names = new Set<string>();

  for (const match of body.matchAll(/npm run (demo(?::[a-z0-9-]+)?)/g)) {
    if (match[1] !== undefined) names.add(match[1]);
  }

  // The loop is the job's real roster and is required to be there: if it is gone the twelve worlds
  // are run by nothing, which is the defect this whole check is about rather than a gap in parsing.
  const loop = /\bfor world in ([^;]+);/.exec(body);
  assert.ok(
    loop?.[1] !== undefined,
    ".github/workflows/ci.yml no longer carries a `for world in ...; do` loop, so the demos this " +
      "check reads have moved and the roster it derives is not a claim about CI any more",
  );

  for (const world of loop[1].split(/\s+/).filter((word) => word.length > 0)) {
    names.add(`demo:${world}`);
  }

  return [...names].sort();
}

const manifest = await repo.readTextFile("package.json");
const readme = await repo.readTextFile("README.md");
const agents = await repo.readTextFile("AGENTS.md");
const workflow = await repo.readTextFile(".github/workflows/ci.yml");

assert.ok(manifest !== null, "package.json could not be read");
assert.ok(readme !== null, "README.md could not be read");
assert.ok(agents !== null, "AGENTS.md could not be read");
assert.ok(workflow !== null, ".github/workflows/ci.yml could not be read");

const declared = declaredDemoScripts(manifest);
const inReadme = commandsIn(readme);
const inAgents = commandsIn(agents);
const inWorkflow = demosInWorkflow(workflow);

/** The shape both acceptance routes are named with: the bare name, or a `:`-suffixed sibling. */
const ACCEPTANCE = "acceptance";

/**
 * The self-acceptance routes: every manifest script named `acceptance` or `acceptance:*`.
 *
 * **Derived rather than listed, and that is a correction rather than a flourish.** The first version
 * of this roster held one constant, `const ACCEPTANCE = "acceptance"`, and asked its four questions
 * of that one name - so when `acceptance:ladder` landed, declared, shipped and runnable, this file
 * went on being green while reading none of it. That is the same shape as `hasNoHttp` growing a
 * clause per world while `tests/environment-gaps.test.ts` carried the same vocabulary by hand one
 * world behind: *a test that re-states a register instead of iterating it can only cover the members
 * it was written with.* The set is now read out of the manifest, so the next route is held by this
 * file the moment it is declared.
 *
 * Each route's *driver* is derived from the script's own body rather than restated beside it, which
 * is the same move one layer in: the roster's job is to say that the command a reader is promised
 * exists, and a promised command whose target file was never written is `Missing script` with an
 * extra step. Reading the path out of the body is what lets the existence of that file be asserted
 * rather than a regex literal agreed with.
 */
function acceptanceRoutes(manifest: string): readonly { name: string; driver: string }[] {
  const scripts = declaredScripts(manifest);

  return Object.keys(scripts)
    .filter((name) => name === ACCEPTANCE || name.startsWith(`${ACCEPTANCE}:`))
    .sort()
    .map((name) => {
      const body = scripts[name] ?? "";
      // `node scripts/ladder.mjs` - the path is the first word ending in `.mjs`, which is the only
      // shape either route uses and the shape a third one would have to use to be run by node.
      const match = /(\S+\.mjs)/.exec(body);
      return { name, driver: match?.[1] ?? "" };
    });
}

const acceptanceScripts = acceptanceRoutes(manifest);

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

/**
 * Every declared demo must be run by a CI job, and this is the third list of that one roster.
 *
 * It was written because the gap it closes was real and green: the `worlds` job ran **seven** demos
 * while `package.json` declared thirteen, so `demo:api`, `demo:local-process`, `demo:data` and
 * `demo:cockpit` were declared, shipped and documented in `README.md` and run by **no CI job at
 * all** - and every run of the workflow was green, because a job that runs seven of thirteen demos
 * passes. The names in this file's other two checks were correct the whole time; they simply could
 * not see the third roster, and a check that passes over a roster it does not read is the shape this
 * whole guard family exists to refuse.
 *
 * The demos are run from a matrix-free shell loop rather than from `strategy.matrix`, which is why
 * `demosInWorkflow` reads the loop's own world list instead of a YAML list - and the assertion below
 * is deliberately about *coverage* rather than about the job's shape, so a job may be restructured
 * without this file having an opinion about how.
 */
describe("every declared demo is run by a CI job", () => {
  it("holds a roster large enough for the comparison to mean anything", () => {
    assert.ok(
      inWorkflow.length >= 12,
      `.github/workflows/ci.yml runs ${String(inWorkflow.length)} demos, so this roster is ` +
        "checking almost nothing - either the workflow was gutted or the demos moved to a shape " +
        "this file cannot read",
    );
  });

  it("runs every demo the manifest declares, so no world is checked by nothing", () => {
    assert.deepEqual(
      declared.filter((name) => !inWorkflow.includes(name)),
      [],
      "a demo `package.json` declares is run by no CI job: it is shipped and documented, and " +
        "nothing in the workflow ever executes it - which is a green build over an unrun command",
    );
  });

  it("runs no demo the manifest does not declare", () => {
    assert.deepEqual(
      inWorkflow.filter((name) => !declared.includes(name)),
      [],
      "the workflow runs a demo `package.json` does not declare, so the job fails on a missing " +
        "script - or, worse, on a script that was deleted and whose world is now unrun",
    );
  });
});

/**
 * The fourth roster, and the first whose subjects are not demos: Veridian's own acceptance contracts.
 *
 * `acceptance/` holds the goals, the contracts and the environments, `scripts/*.mjs` drive them, and
 * the application under test is the CLI itself - so each route is a thing a reader can walk, which
 * makes it a name that has to appear in the same four places the demo roster does.
 *
 * The two routes answer different questions and that is why there are two rather than one.
 * `acceptance/veridian-mvp.yaml` judges the command line **as a product** - seven criteria about
 * exits, output and files, observed once with `--no-repair`. `acceptance/ladder/acceptance.yaml`
 * judges it **as a witness** - four criteria about the record a *nested* run wrote, so the outer
 * world is a `local-process` host running the CLI and the inner one is a `local-process` host the
 * CLI itself started. Neither would have found the other's defects.
 *
 * Neither is a `demo:*` script, and naming them one would have been the cheaper edit: the existing
 * derivation would have picked both up with no change to this file at all. A demo shows a defect
 * being found and repaired, and these contracts have no defect to repair - `maxIterations: 1` with
 * `--no-repair` makes them controls rather than demonstrations - so borrowing the prefix would have
 * enrolled them in three checks above that would then have been satisfied by a lie. The roster they
 * actually belong to is this one, and the reason they need a check at all is the defect this
 * repository has now paid for four times: a name declared somewhere and read by nothing.
 */
describe("the self-acceptance routes are reachable from every place that names them", () => {
  it("holds a roster large enough for the comparison to mean anything", () => {
    // The same floor argument the demo roster makes: rename the scripts and this set empties, after
    // which every assertion below is a claim about the empty set and passes without reading anything.
    assert.ok(
      acceptanceScripts.length >= 2,
      `package.json declares ${String(acceptanceScripts.length)} acceptance routes, so this roster ` +
        "is checking almost nothing - either the naming convention changed or a route was removed",
    );
  });

  it("declares each route, and each drives a script file that exists", async () => {
    for (const route of acceptanceScripts) {
      assert.notEqual(
        route.driver,
        "",
        `the \`${route.name}\` script names no .mjs file, so this roster cannot tell what it runs - ` +
          "and a route whose driver is unreadable is a route nothing here is about",
      );

      const source = await repo.readTextFile(route.driver);
      assert.notEqual(
        source,
        null,
        `the \`${route.name}\` script drives ${route.driver}, which does not exist - so the command ` +
          "README.md and AGENTS.md hand a reader fails at its first step",
      );
    }
  });

  it("names every route in README.md's quickstart block", () => {
    for (const route of acceptanceScripts) {
      assert.ok(
        inReadme.includes(route.name),
        `README.md's quickstart never names \`npm run ${route.name}\`, so the front door does not ` +
          "offer a route that answers a question its tests cannot - for `acceptance` that is 'does " +
          "Veridian work?', for `acceptance:ladder` it is 'does the ambiguity ladder work, inside a " +
          "run of Veridian?'",
      );
    }
  });

  it("names every route in AGENTS.md's command block", () => {
    for (const route of acceptanceScripts) {
      assert.ok(
        inAgents.includes(route.name),
        `AGENTS.md's \`Running things:\` block never names \`npm run ${route.name}\`, so the ` +
          "hand-off to the next agent does not carry a contract that judges this repository with " +
          "its own product",
      );
    }
  });

  it("is run by a CI job, rather than only described by one", () => {
    for (const route of acceptanceScripts) {
      assert.ok(
        runsInWorkflow(workflow, route.name),
        `.github/workflows/ci.yml never runs \`npm run ${route.name}\`, so the contract is ` +
          "declared, documented twice and executed by nothing - which is exactly the defect the " +
          "demo half of this file was written for",
      );
    }
  });

  it("runs each route before the demo loop, so the artifact's newest reading is the Cockpit's", () => {
    const loopAt = /^[ \t]*for world in [^\n]*; do[ \t]*$/m.exec(workflow)?.index ?? -1;

    assert.ok(
      loopAt >= 0,
      ".github/workflows/ci.yml no longer carries a `for world in ...; do` loop, so there is " +
        "nothing for the acceptance steps to be ordered against",
    );

    for (const route of acceptanceScripts) {
      const routeAt = workflowRunIndex(workflow, route.name);

      assert.ok(
        routeAt >= 0,
        `the \`npm run ${route.name}\` step is not in .github/workflows/ci.yml, so its position ` +
          "cannot be checked at all",
      );
      assert.ok(
        routeAt < loopAt,
        `the \`npm run ${route.name}\` step runs *after* the demo loop. Every run in this job ` +
          "writes the same `.veridian/latest-result.json`, and the upload step at the end carries " +
          "the whole of `.veridian/` - so the reading a reader opens first is whichever run wrote " +
          "that file last, and the upload step's own comment says that has to be `cockpit`. Below " +
          "the loop, this step is the last writer instead, and the artifact's comment goes on " +
          "describing a bundle it no longer carries. A comment about CI is read by nothing; this " +
          "is that comment as an assertion",
      );
    }
  });
});
