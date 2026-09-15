import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allValidators } from "../cli/validators.ts";
import { nodeIo } from "../core/io.ts";
import { ValidatorRegistry } from "../core/validation/index.ts";
import { discoverValidatorFamilies } from "./helpers/validator-families.ts";

/**
 * Every family on disk has to be a family this build can judge with.
 *
 * This is the fourth spelling of the defect `AGENTS.md` records three times - `db.query` named in
 * three documents and absent from the code, `db.rowCount` unwritable under the schema, `web.visible`
 * implemented and named by no document - and it is the one with the worst consequence, because
 * nothing else in the tree can see it. A family under `validators/` that `allValidators()` never
 * spreads is a family whose names the *schema* accepts, whose reading vocabulary a *world* produces,
 * and whose criteria every run reports `unresolvable_entity`, at DEFINE, before anything starts: an
 * operator writing a contract from the code they can read gets told the validator does not exist.
 *
 * The subject is the filesystem and the register, in that order, so the guard covers a family nobody
 * has written yet. The one thing it does *not* cover is a name the schema would refuse - that is
 * `validatorSchemaPattern`'s question, held by `tests/step-kinds.test.ts`'s neighbour for step kinds
 * and by `readme-rosters.test.ts` for the roster a document prints.
 */

const repo = nodeIo();
const families = await discoverValidatorFamilies(repo);
const registry = new ValidatorRegistry(allValidators());

describe("the validator families on disk are the families this build registers", () => {
  it("finds the families by walking `validators/`, not by being told", () => {
    // A sanity check on the instrument, and the positive control for the two assertions below: a
    // discovery that found nothing would make "every family is registered" true and empty. The
    // directory count is not pinned - a twelfth family must not need an edit here - but a run that
    // found no family at all is a broken guard rather than a clean one.
    assert.ok(
      families.length >= 10,
      `found ${families.length} validator families under validators/, which is too few to be the ` +
        "tree this guard was written for",
    );
    assert.ok(
      registry.names().length > families.length,
      "the registry holds fewer names than there are families, so some family contributes nothing",
    );
  });

  it("registers every validator a family produces, and invents none", () => {
    const discovered = new Set<string>();
    for (const family of families) {
      for (const name of family.validators) discovered.add(name);
    }

    const registered = registry.names();
    const missing = [...discovered].filter((name) => !registry.has(name)).sort();
    assert.deepEqual(
      missing,
      [],
      `these validators exist under validators/ and no run can judge with them: ${missing.join(", ")}. ` +
        "A contract naming one is refused with `unresolvable_entity` at DEFINE, which sends the " +
        "operator to inspect the validator they just read in the source tree.",
    );

    const invented = registered.filter((name) => !discovered.has(name)).sort();
    assert.deepEqual(
      invented,
      [],
      `these validators are registered and no family on disk produces them: ${invented.join(", ")}. ` +
        "A registered name is a promise that a criterion can be answered by it.",
    );
  });

  it("holds one family per vocabulary, named by its own directory", () => {
    for (const family of families) {
      assert.ok(
        family.validators.length > 0,
        `validators/${family.family}/index.ts produces no validator at all - a directory that is a ` +
          "family to this guard and to the README's layout block, and answers nothing",
      );

      const prefixes = new Set(family.validators.map((name) => name.split(".")[0] ?? ""));
      assert.equal(
        prefixes.size,
        1,
        `validators/${family.family}/ mixes the vocabulary prefixes ` +
          `${[...prefixes].sort().join(", ")} - a family is one namespace, and a validator outside ` +
          "its family's prefix is one a reader of that family will never look for",
      );

      for (const name of family.validators) {
        assert.match(
          name,
          /^[a-z0-9]+(\.[a-z0-9]+)+$/,
          `validators/${family.family}/ declares "${name}", which the acceptance schema's pattern ` +
            "would refuse - so no contract can name it, however well it works",
        );
      }
    }
  });

  it("exports a roster of its own names, and the roster is the names", () => {
    for (const family of families) {
      assert.notEqual(
        family.names,
        null,
        `validators/${family.family}/index.ts exports no \`*_VALIDATOR_NAMES\` record, so the only ` +
          "list of this family's names is the code itself - which is how `web.visible` came to be " +
          "implemented, registered and named by no document at all",
      );

      const declared = Object.values(family.names ?? {}).sort();
      assert.deepEqual(
        declared,
        [...family.validators],
        `validators/${family.family}/'s roster disagrees with the validators it produces. ` +
          `Declared: ${declared.join(", ")}. Produced: ${family.validators.join(", ")}.`,
      );
    }
  });

  it("keeps the family list in one place, which is a file the CLI reads", async () => {
    // The entry point cannot be imported by a test - `cli/veridian.ts` calls `main()` at module
    // scope - so this claim about its *wiring* can only be read. It is worth reading, because the
    // defect it prevents is a second list: an entry point that builds its registry from a handful of
    // families inlined beside the imports would typecheck, pass every other guard, and judge some
    // criteria as `unresolvable_entity` for a reason no test would ever name.
    const entry = await repo.readTextFile("cli/veridian.ts");
    assert.ok(entry !== null, "cli/veridian.ts could not be read");

    assert.match(
      entry,
      /new ValidatorRegistry\(allValidators\(\)\)/,
      "cli/veridian.ts no longer builds its registry from `allValidators()`, so what a run can judge " +
        "with is decided in a second place that tests/validator-registration.test.ts does not read",
    );
    assert.doesNotMatch(
      entry,
      /\.\.\.\w*[Vv]alidators\(\)/,
      "cli/veridian.ts spreads validator families itself - the register belongs in cli/validators.ts, " +
        "where it can be held against the directories on disk",
    );
  });
});
