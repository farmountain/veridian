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
    // scope - so a claim about the *wiring* can only be read. It is worth reading, because the
    // defect it prevents is a second list: a caller that built its registry from a handful of
    // families inlined beside its imports would typecheck, pass every other guard, and judge some
    // criteria as `unresolvable_entity` for a reason no test would ever name.
    //
    // This assertion used to read `cli/veridian.ts`, and it failed the moment the composition moved
    // to `cli/session.ts`. That is the guard working rather than the guard breaking: it named the file
    // it had been told to read, and the registry is no longer built there. Naming one file was the
    // mechanism's weakness and not its purpose, so the walk is over `cli/` and the register's own file
    // is *derived* from the code that declares it. The replacement is strictly stronger than what it
    // replaced: a second construction site, or a second file inlining a few families, is now caught
    // wherever it lands rather than only in the entry point.
    const modules = (await repo.readDir("cli")).filter((name) => name.endsWith(".ts")).sort();
    assert.ok(
      modules.length >= 5,
      `cli/ holds ${modules.length} modules, which is too few to be the tree this guard was written for`,
    );

    const sources = new Map<string, string>();
    for (const name of modules) {
      const text = await repo.readTextFile(`cli/${name}`);
      assert.ok(text !== null, `cli/${name} was listed by readDir and could not be read`);
      sources.set(name, text);
    }

    // The register is the file that declares `allValidators`, derived rather than recalled.
    const register = [...sources].filter(([, text]) => /export function allValidators\(/.test(text));
    assert.equal(
      register.length,
      1,
      `the roster of validator families is declared in ${register.length} files under cli/ ` +
        `(${register.map(([name]) => name).join(", ") || "none"}) - "what can a run judge with" has ` +
        "exactly one answer",
    );
    const registerFile = register[0]?.[0] ?? "";

    // One construction site, and it is built from the register rather than from families picked here.
    const builders = [...sources]
      .filter(([, text]) => /new ValidatorRegistry\(/.test(text))
      .map(([name]) => name);
    assert.equal(
      builders.length,
      1,
      `the validator registry is constructed in ${builders.length} places under cli/ ` +
        `(${builders.join(", ") || "none"}) - a second construction site is a second answer to ` +
        '"what can a run judge with", and a criterion judged by the wrong one reports ' +
        "`unresolvable_entity` at DEFINE",
    );
    const builder = builders[0] ?? "";
    assert.match(
      sources.get(builder) ?? "",
      /new ValidatorRegistry\(allValidators\(\)\)/,
      `cli/${builder} constructs a \`ValidatorRegistry\` from something other than \`allValidators()\`, ` +
        "so what a run can judge with is decided in a second place that this guard does not read",
    );

    // And no module other than the register spreads validator families itself.
    const spreaders = [...sources]
      .filter(([name, text]) => name !== registerFile && /\.\.\.\w*[Vv]alidators\(\)/.test(text))
      .map(([name]) => name);
    assert.deepEqual(
      spreaders,
      [],
      `these modules under cli/ spread validator families themselves (${spreaders.join(", ")}): the ` +
        `register belongs in cli/${registerFile}, where it is held against the directories on disk`,
    );
  });
});
