import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";

/**
 * The manifest's declared *routes* are claims about the world the package ships into, and each one is
 * written in two files that nothing reconciles.
 *
 * This is the guard the repository calls for under "the package manager validates the dependency tree,
 * not the metadata that describes the package" - an entry `package.json` and `package-lock.json` each
 * state, and which `npm ci` accepts when they disagree. The repository has paid for the shape twice:
 * the licence drifted (`UNLICENSED` in the lockfile's root entry, `MIT` in the manifest) for as long as
 * one had been edited without the other, and moving `bin` to `./dist/cli/veridian.js` left the
 * lockfile's root entry still naming `cli/veridian.ts`.
 *
 * ## What it holds
 *
 * W4 declared Playwright an optional peer, which is a route expressed as three facts - it is a peer,
 * it is optional, and it is in neither of the two dependency blocks it must not be one of - and the
 * first two are each written twice. The assertions read the manifest and the lockfile rather than
 * restating the range, so a floor raised in one place and not the other fails here instead of at
 * somebody's `npm install`.
 *
 * The README assertions exist for the reason `AGENTS.md` gives: the front door described Playwright as
 * *not a dependency*, which was true while no peer was declared and is now the wrong half of the
 * truth, and a README that names a route the manifest does not declare is the same defect as one that
 * names a command that no longer behaves that way.
 *
 * ## Why every derivation is lazy
 *
 * `peersOf`, `peerMetaOf` and `lockedRootOf` are called inside the test that needs them rather than
 * once at module scope. A block removed from the manifest is the interesting failure, and a guard that
 * read it at import time would report that as a file that could not be loaded - one unhelpful message
 * standing in for three named properties.
 *
 * ## Falsified rather than trusted
 *
 * Four probes, each reverted byte for byte, on a harness that detected and printed every file's ending
 * first: removing `peerDependencies` from the manifest fails **three** subtests, because a missing
 * block is not an isolated property - the declaration, the lower bound and the lockfile pin all read
 * it; flipping `optional` to `false` in both files fails **one**; dropping the range from the
 * lockfile's root entry alone fails **one**; and restoring the README's two older claims fails
 * **two**. A probe whose anchor is absent reports `did not fire` rather than passing, which is how the
 * first README anchor was caught claiming a line break the file does not have.
 */

const repo = nodeIo();

interface JsonObject {
  readonly [key: string]: unknown;
}

async function readObject(file: string): Promise<JsonObject> {
  const text = await repo.readTextFile(file);
  assert.ok(text !== null, `${file} could not be read, so the route it declares cannot be checked`);
  const value: unknown = JSON.parse(text);
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${file} is not a JSON object, so this guard is reading something other than a document`,
  );

  return value as JsonObject;
}

/** A named block of a document, refused by name when it is absent rather than read as empty. */
function blockOf(document: JsonObject, key: string, file: string): JsonObject {
  const value = document[key];
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${file} no longer carries a \`${key}\` object for this guard to hold`,
  );

  return value as JsonObject;
}

async function peersOf(): Promise<JsonObject> {
  return blockOf(await readObject("package.json"), "peerDependencies", "package.json");
}

async function peerMetaOf(): Promise<JsonObject> {
  return blockOf(await readObject("package.json"), "peerDependenciesMeta", "package.json");
}

/**
 * The lockfile's root entry - `packages[""]` - which is the one place a lockfile restates the
 * manifest's own metadata. A lockfile also lists every *installed* package under `packages`, which is
 * a different question: a peer that is not installed has no entry there and must not have one.
 */
async function lockedRootOf(): Promise<JsonObject> {
  const packages = blockOf(await readObject("package-lock.json"), "packages", "package-lock.json");
  const root = packages[""];
  assert.ok(
    typeof root === "object" && root !== null && !Array.isArray(root),
    'package-lock.json carries no root entry under `packages[""]`, so the two places a peer ' +
      "declaration is written cannot be compared",
  );

  return root as JsonObject;
}

describe("the Playwright peer declaration", () => {
  it("declares playwright as a peer, so a package manager can state the requirement", async () => {
    const range = (await peersOf())["playwright"];

    assert.ok(
      typeof range === "string" && range.length > 0,
      "package.json declares no `peerDependencies.playwright`, so an installed Veridian reaches a " +
        "browser contract with nothing at install time saying what it needs - which is the route W4 " +
        "exists to declare rather than to document",
    );
  });

  it("admits a later release rather than pinning one", async () => {
    const range = String((await peersOf())["playwright"]);

    assert.match(
      range,
      /^>=\d+\.\d+\.\d+$/,
      `the declared floor ${range} is not a lower bound. A peer pinned to one version refuses every ` +
        "other, and the adapter is written against a structural slice of the API rather than against " +
        "a release, so a pin would be stricter than the code",
    );
  });

  it("marks the peer optional, so installing veridian without a browser still succeeds", async () => {
    const meta = (await peerMetaOf())["playwright"];

    assert.ok(
      typeof meta === "object" && meta !== null && (meta as JsonObject)["optional"] === true,
      "package.json does not mark `playwright` optional under `peerDependenciesMeta`, so a package " +
        "manager would refuse - or warn on - an install with no browser. A world with no browser is " +
        "already an honest INCONCLUSIVE rather than a failure, so the install must not be stricter",
    );
  });

  it("keeps playwright out of both dependency blocks it must not be one of", async () => {
    const manifest = await readObject("package.json");

    for (const key of ["dependencies", "devDependencies"]) {
      const block = blockOf(manifest, key, "package.json");
      assert.equal(
        Object.hasOwn(block, "playwright"),
        false,
        `package.json lists playwright under \`${key}\`, and a peer is by definition not one of ` +
          "these: a real dependency installs a browser nobody asked for and makes the world's honest " +
          "INCONCLUSIVE unreachable",
      );
    }
  });

  it("pins the lockfile's root entry to the manifest, so the two cannot disagree", async () => {
    const peers = await peersOf();
    const meta = await peerMetaOf();
    const lockedRoot = await lockedRootOf();

    assert.deepEqual(
      lockedRoot["peerDependencies"],
      peers,
      "the lockfile's root entry states a different `peerDependencies` from package.json - and `npm " +
        "ci` reconciles the dependency tree rather than this metadata, so a disagreement here " +
        "installs cleanly and ships a claim the lockfile denies",
    );
    assert.deepEqual(
      lockedRoot["peerDependenciesMeta"],
      meta,
      "the lockfile's root entry states a different `peerDependenciesMeta` from package.json, so one " +
        "of the two files says the peer is optional and the other does not",
    );
  });

  it("installs nothing for the peer, so the declaration cannot quietly satisfy itself", async () => {
    const packages = blockOf(
      await readObject("package-lock.json"),
      "packages",
      "package-lock.json",
    );
    const installed = Object.keys(packages).filter((path) => /(^|\/)playwright(-core)?$/.test(path));

    assert.deepEqual(
      installed,
      [],
      "package-lock.json lists an installed playwright package, so the optional peer has been " +
        "resolved rather than left to the user - and the degradation the README describes would no " +
        "longer be reachable on a clean install",
    );
  });
});

describe("what the front door says about the peer", () => {
  it("names playwright as an optional peer, which is the route the manifest declares", async () => {
    const readme = await repo.readTextFile("README.md");
    assert.ok(readme !== null, "README.md could not be read");

    assert.match(
      readme,
      /optional peer/i,
      "README.md does not name playwright as an optional peer, so the route the manifest declares is " +
        "described nowhere a reader would look for it - a declared route and a documented route are " +
        "two different claims",
    );
  });

  it("no longer offers the reader the older wording, which the peer declaration falsified", async () => {
    const readme = await repo.readTextFile("README.md");
    assert.ok(readme !== null, "README.md could not be read");

    assert.equal(
      /not a dependency/i.test(readme),
      false,
      "README.md still says playwright is `not a dependency`, which was true while the package " +
        "declared no peer at all and is now the wrong half of the truth: it is an optional peer, and a " +
        "reader who is told it is not a dependency has no reason to expect the install-time notice",
    );
  });
});
