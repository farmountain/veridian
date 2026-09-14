import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";
import { DB_VALIDATOR_NAMES } from "../validators/database/db-validators.ts";
import { K8S_VALIDATOR_NAMES } from "../validators/k8s/k8s-validators.ts";
import { OS_VALIDATOR_NAMES } from "../validators/os/os-validators.ts";
import { WEB_UI_VALIDATOR_NAMES } from "../validators/playwright/web-ui-validators.ts";
import { POSIX_VALIDATOR_NAMES } from "../validators/posix/posix-validators.ts";

/**
 * The validator rosters `README.md` prints must be the rosters the code exports.
 *
 * This is the guard `AGENTS.md` calls for under "a roster in prose and a roster in a registry are two
 * lists of the same thing, and only one of them is executable". That entry was written after
 * `db.query` was named as a member of the database family in three documents while `DB_VALIDATORS`
 * held four entries and no source file mentioned the name; it was found by a new suite's first
 * assertion pinning `registry.names()`, not by reading the documents, because a list of names in a
 * document is read by nothing that could disagree with it.
 *
 * The drift was already here when this file was written, which is why it was worth writing rather
 * than worth believing in. `README.md` printed `web.element/text/value/count/url/console/network` -
 * a shorthand that hid two real names (`web.console.clean`, `web.network.ok`) and **omitted a third
 * entirely**: `web.visible` was implemented, registered, and named by no document at all. The
 * shorthand is what made it invisible: `text/value/count` reads as a complete enumeration because
 * every token looks like a name, and `console` looks like `web.console.clean` to a reader who is
 * not counting. So the README now spells every name out in full, comma separated, and this file
 * reads them.
 *
 * What this does **not** hold, deliberately: the order. A roster is a set, and asserting the
 * document's order against the code's would fail on an edit that changed nothing an operator can
 * observe - which is the shape of guard that gets deleted instead of obeyed.
 */

const repo = nodeIo();

/** The names a document's layout block prints for one validator family. */
function rosterIn(body: string, family: string): readonly string[] {
  const lines = body.split(/\r?\n/);
  const head = `validators/${family}/`;
  const start = lines.findIndex((line) => line.startsWith(head));
  assert.notEqual(start, -1, `README.md no longer has a layout line for ${head}`);

  // A layout entry is the `name/` column plus a description, and its description wraps onto
  // continuation lines indented to that column. The entry ends at the first line that is not a
  // continuation - which is what makes this parse the block rather than a fixed number of lines.
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index > start && !/^ {24}/.test(line)) break;
    block.push(index === start ? line.slice(head.length) : line.trim());
  }

  return block
    .join(" ")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

const FAMILIES: readonly (readonly [string, Record<string, string>])[] = [
  ["playwright", WEB_UI_VALIDATOR_NAMES],
  ["database", DB_VALIDATOR_NAMES],
  ["k8s", K8S_VALIDATOR_NAMES],
  ["posix", POSIX_VALIDATOR_NAMES],
  ["os", OS_VALIDATOR_NAMES],
];

describe("the README's validator rosters are the ones the code exports", () => {
  it("prints every name each family registers, one per token", async () => {
    const body = await repo.readTextFile("README.md");
    assert.ok(body !== null, "README.md could not be read");

    for (const [family, names] of FAMILIES) {
      const printed = rosterIn(body, family);
      const exported = Object.values(names).sort();
      assert.deepEqual(
        [...printed].sort(),
        exported,
        `README.md's ${family} roster disagrees with the code. Printed: ${printed.join(", ")}. ` +
          `Exported: ${exported.join(", ")}.\n` +
          "A name in the document and not in the code is a validator an operator can write and no " +
          "run can judge; a name in the code and not in the document is one nobody will find.",
      );
    }
  });

  it("prints names, not a shared prefix and a suffix list", async () => {
    // The specific shape the drift hid behind. `web.element/text/value` is not wrong as a *claim*
    // about three names; it is unreadable as a roster, because a reader cannot tell whether `url`
    // stands for `web.url` or for `web.url.expected`, and an omitted name does not leave a hole.
    // Every token therefore has to be a name the schema would accept: at least two segments, all
    // lower case, which is the same rule `validatorSchemaPattern` holds for a criterion.
    const body = await repo.readTextFile("README.md");
    assert.ok(body !== null, "README.md could not be read");

    for (const [family] of FAMILIES) {
      for (const token of rosterIn(body, family)) {
        assert.match(
          token,
          /^[a-z0-9]+(\.[a-z0-9]+)+$/,
          `README.md's ${family} roster prints "${token}", which is not a validator name - the ` +
            "family prefix was factored out into the column, and that is how a name went missing",
        );
      }
    }
  });
});
