/**
 * Discover the validator families from the directories on disk, rather than from a list.
 *
 * Two guards in this tree ask questions whose subject is *every family*: `readme-rosters.test.ts`
 * asks whether the README prints each family's roster, and `validator-registration.test.ts` asks
 * whether the CLI can judge with each family it can find. Both were first written with the families
 * spelled out by hand, which is the defect shape `AGENTS.md` records twice - *a test that re-states a
 * predicate rather than iterating the register can only cover the worlds it was written with*. A
 * hand-written list of eleven families passes for the wrong reason right up until a twelfth directory
 * lands and neither guard notices; a discovered one cannot.
 *
 * So the subject is the filesystem: a directory under `validators/` holding an `index.ts`, whose
 * module re-exports its family. What is *not* discovered is the roster - that has to be the family's
 * own constant, because the question is whether the document and the register agree with each other,
 * and an answer derived from either one alone would agree with itself.
 *
 * A family's module is imported dynamically, one directory at a time. Nothing here is a product
 * dependency: this is a helper for two test files, and it walks `validators/` because that is the
 * only place the answer lives.
 */

import type { IoPort } from "../../core/io.ts";

/** One family, as it is found on disk. */
export interface ValidatorFamily {
  /** The directory under `validators/`, which is also how the README's layout block names it. */
  readonly family: string;
  /**
   * The `*_VALIDATOR_NAMES` record the family exports, or `null` when it exports none.
   *
   * `null` is a finding rather than a fallback: a family with no roster of its own is a family whose
   * names exist only inside `validators/` and `cli/validators.ts`, which is exactly the duplication
   * that let `web.visible` go missing from every document.
   */
  readonly names: Record<string, string> | null;
  /** Every validator name the family's module can produce, deduplicated and sorted. */
  readonly validators: readonly string[];
}

/**
 * Every validator family this repository holds, ordered by directory name.
 *
 * The order is the filesystem's, sorted, so a failure message reads the same on every platform and
 * two runs of the same suite report the same first difference.
 */
export async function discoverValidatorFamilies(io: IoPort): Promise<readonly ValidatorFamily[]> {
  const entries = await io.readDir("validators");
  const families: string[] = [];
  for (const entry of [...entries].sort()) {
    // A directory that holds an `index.ts` is a family; anything else under `validators/` - a stray
    // file, a directory whose module was removed - is not, and is therefore not expected to be a
    // family anywhere else either.
    if (await io.exists(`validators/${entry}/index.ts`)) families.push(entry);
  }

  const discovered: ValidatorFamily[] = [];
  for (const family of families) {
    const module = (await import(`../../validators/${family}/index.ts`)) as Record<string, unknown>;
    discovered.push({
      family,
      names: rosterOf(module),
      validators: validatorsIn(module),
    });
  }
  return discovered;
}

/** The `*_VALIDATOR_NAMES` record a family's module exports, if it exports exactly one. */
function rosterOf(module: Record<string, unknown>): Record<string, string> | null {
  for (const [key, value] of Object.entries(module)) {
    if (!key.endsWith("_VALIDATOR_NAMES")) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, held]) => typeof held === "string")) {
      return value as Record<string, string>;
    }
  }
  return null;
}

/**
 * Every validator name a family's module can produce.
 *
 * A family exports its validators as a frozen array (`DATA_VALIDATORS`) and often as a factory that
 * hands out a fresh copy (`dataValidators()`); both are read here, because either one alone would
 * let a name that only one of them holds go unnoticed.
 */
function validatorsIn(module: Record<string, unknown>): readonly string[] {
  const names = new Set<string>();
  for (const value of Object.values(module)) {
    if (typeof value === "function") {
      // Called with no arguments and its `this` bound to nothing: a family's factory reads nothing,
      // which is what makes `Reflect.apply` the right way to ask it rather than a cast.
      collect(Reflect.apply(value, undefined, []) as unknown, names);
      continue;
    }
    collect(value, names);
  }
  return [...names].sort();
}

/** Add every validator-looking member of `value` to `names`. */
function collect(value: unknown, names: Set<string>): void {
  if (!Array.isArray(value)) return;
  const held: string[] = [];
  for (const member of value) {
    if (typeof member !== "object" || member === null) return;
    const candidate = member as { name?: unknown; validate?: unknown };
    if (typeof candidate.name !== "string") return;
    if (typeof candidate.validate !== "function") return;
    held.push(candidate.name);
  }
  for (const name of held) names.add(name);
}
