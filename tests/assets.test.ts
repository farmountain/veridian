import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { describe, it } from "node:test";

import { assetsRoot } from "../core/assets.ts";
import { nodeIo } from "../core/io.ts";
import { ALL_SCHEMA_URIS, loadSchemaSet } from "../core/schema/index.ts";

/**
 * Where Veridian finds its own files.
 *
 * This exists because the CLI used to read the schemas through a port rooted at `process.cwd()`,
 * which is correct only while the program is run from the repository root. Every test in this
 * repository happens to run from there, so nothing caught it - the defect was invisible to a suite
 * that shares the property that hid it. That is the general shape of the bug, and the reason these
 * tests assert on the *root* rather than on a load that would succeed either way.
 */

describe("the asset root", () => {
  it("is an absolute path, because a relative one would be re-resolved against the cwd", () => {
    assert.equal(isAbsolute(assetsRoot()), true);
  });

  it("names the package root, holding both the manifest and the schema directory", () => {
    // These two are what "package root" means here, and `scripts/copy-assets.mjs` reproduces both
    // under `dist/` so that the compiled layout satisfies the same definition. If this test needs
    // changing because a file moved, the copy step needs the same change.
    assert.equal(existsSync(join(assetsRoot(), "package.json")), true);
    assert.equal(existsSync(join(assetsRoot(), "schemas")), true);
  });

  it("holds every schema the loader will ask it for", () => {
    for (const uri of ALL_SCHEMA_URIS) {
      assert.equal(existsSync(join(assetsRoot(), uri)), true, `missing from the asset root: ${uri}`);
    }
  });
});

describe("loading the schema set through the asset root", () => {
  it("resolves every schema without consulting the working directory", async () => {
    const io = nodeIo({ root: assetsRoot() });

    // `exists` rather than a full `loadSchemaSet` assertion, so a schema that fails to *parse* is
    // reported as a parse failure rather than as a wrong root. The next test covers the parse.
    for (const uri of ALL_SCHEMA_URIS) {
      assert.equal(await io.exists(uri), true, `the asset root could not find: ${uri}`);
    }

    const schemas = await loadSchemaSet(io);
    for (const uri of ALL_SCHEMA_URIS) {
      assert.equal(schemas.has(uri), true, `the schema set omitted: ${uri}`);
    }
  });

  it("finds nothing through a port rooted anywhere else, so the root is what makes it work", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "veridian-assets-"));

    try {
      const io = nodeIo({ root: elsewhere });

      // This is the defect, demonstrated rather than asserted: an installed CLI reading through an
      // unrooted port is this call with a different directory, and it reports a missing goal schema
      // that shipped inside its own package.
      assert.equal(await io.exists("schemas/goal.schema.json"), false);
      await assert.rejects(() => loadSchemaSet(io));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
