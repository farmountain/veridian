/**
 * The environment index: a join over run bundles, and the two questions it must not conflate.
 *
 * Two halves, and only one of them needs a fixture. `crawlFrom` reads a bundle's `environment.json`,
 * which is written with snake_case keys (`inherited_credentials`) while the crawl's own type is
 * camelCase - so this is the one place where a rename can silently produce `undefined` and a reading
 * that looks like a clean environment. The second half is the report's third list.
 *
 * ## Why the third list is the subject of the file
 *
 * `EliReport` already has `unreadable` and `EliEnvReport` has `unreadableEnvironments`. `EnvIndexReport`
 * adds `runsWithoutReading`, and the reason it is separate rather than folded into either is that all
 * three answer different questions about a different pair of things:
 *
 *   unreadable                the bundle itself could not be read off disk
 *   unreadableEnvironments    the environment document was read and had no environment block
 *   runsWithoutReading        the environment block was read and carried no crawl
 *
 * The third is the one a reader of this index is most likely to misread, because **an index that drops
 * the runs it could not measure reports a clean fleet.** A subject whose every run predates
 * `process.environment` would show zero credentials and zero undeclared credentials and would be
 * indistinguishable from a subject that was measured and was clean - which is what
 * `scripts/envindex-reading.mjs`'s CONTROL exits 1 over, and it did: the first run of that script over
 * two hundred and nine pre-crawler runs printed a completely empty table and the control refused it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crawlFrom } from "../core/metrics/envindex.ts";

/**
 * What `core/evidence/writer.ts` actually puts on disk: the crawl, under `boundary`, snake_cased.
 *
 * The nesting is the first thing this fixture got wrong, and it is worth keeping as a note: the crawl is
 * not a top-level key of `environment.json` - it is `boundary.environment`, beside `boundary.substrate`
 * and the three confinement dimensions it joins. A fixture that put it at the top level tested a shape
 * the writer never produces, and the reader refused it correctly.
 */
const crawl = {
  mode: "declared",
  entries: [
    { name: "CART_CHANNEL", declared: true, credential: false, populated: true },
    { name: "OPENAI_API_KEY", declared: false, credential: true, populated: true },
  ],
  inherited: 1,
  populated: 2,
  credentials: [{ name: "OPENAI_API_KEY", declared: false, credential: true, populated: true }],
  inherited_credentials: ["OPENAI_API_KEY"],
};

const asWritten = { boundary: { environment: crawl } } as unknown as Readonly<Record<string, unknown>>;

describe("a bundle's crawl is read back through the spelling the writer used", () => {
  it("maps the snake_case key and keeps every reading", () => {
    const read = crawlFrom(asWritten);

    assert.notEqual(read, null, "a well-formed environment document did not yield a crawl");
    assert.equal(read?.mode, "declared");
    assert.equal(read?.entries.length, 2);
    assert.equal(read?.inherited, 1);
    assert.equal(read?.populated, 2);
    assert.deepEqual(
      read?.inheritedCredentials,
      ["OPENAI_API_KEY"],
      "the undeclared credential was lost in the rename, which is the one thing this mapper exists for",
    );
  });

  it("does not silently accept a document that is missing the snake_case key", () => {
    // The failure this refuses is the quiet one. If `inherited_credentials` were dropped, the crawl
    // would still be a crawl - every other field present, the count right - and its
    // `inheritedCredentials` would be *absent*, which `isEnvCrawl` reads as a malformed crawl rather
    // than as an empty list. An index built on the other behaviour would report a clean fleet.
    const { inherited_credentials: _dropped, ...without } = crawl;
    assert.equal(
      crawlFrom({ boundary: { environment: without } } as unknown as Readonly<Record<string, unknown>>),
      null,
      "a crawl missing the undeclared-credential list passed as a crawl, so its absence would be " +
        "reported as a clean environment rather than as an unreadable document",
    );
  });

  it("refuses a document that carries no crawl at all, rather than inventing an empty one", () => {
    // `environment.json` written before this seam has no crawl under `boundary`. Substituting an empty
    // crawl would make every one of two hundred and nine such runs report zero credentials - a perfect
    // score for a fleet nobody measured.
    for (const candidate of [{}, { boundary: {} }, { boundary: { environment: null } }, crawl]) {
      assert.equal(
        crawlFrom(candidate as unknown as Readonly<Record<string, unknown>>),
        null,
        `${JSON.stringify(candidate)} was read as a crawl rather than as an absent measurement`,
      );
    }
  });

  it("accepts a crawl that examined nothing, which is different from an absent one", () => {
    // The complement of the test above, and the reason both exist: an empty entries list is a reading -
    // a world that started a child and handed it an empty map - and it must come back as a crawl so the
    // index can report `visible 0` rather than `no reading`. Only a *missing* crawl is unreadable.
    const empty = crawlFrom({
      boundary: {
        environment: {
          mode: "declared",
          entries: [],
          inherited: 0,
          populated: 0,
          credentials: [],
          inherited_credentials: [],
        },
      },
    } as unknown as Readonly<Record<string, unknown>>);
    assert.notEqual(empty, null, "a crawl of nothing was refused, so it would read as unreadable");
    assert.deepEqual(empty?.entries, []);
    assert.deepEqual(empty?.inheritedCredentials, []);
  });

  it("refuses a crawl whose mode is not one this repository has", () => {
    assert.equal(
      crawlFrom({ boundary: { environment: { ...crawl, mode: "stripped" } } } as unknown as Readonly<
        Record<string, unknown>
      >),
      null,
      "an unrecognised mode passed, and a reader would have no way to tell it from a real one",
    );
  });
});
