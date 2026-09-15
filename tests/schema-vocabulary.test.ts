import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AMBIGUITY_KINDS, AMBIGUITY_ORIGINS, DEFER_REASONS, RUNGS } from "../core/clarification/types.ts";
import { EVIDENCE_KINDS } from "../core/acceptance/types.ts";
import { ARTIFACT_KINDS } from "../core/environment/types.ts";
import { FAILURE_TAXONOMY } from "../core/failure.ts";
import { nodeIo } from "../core/io.ts";
import { RUN_STATES, TERMINAL_STATES } from "../core/run/types.ts";
import { ALL_SCHEMA_URIS } from "../core/schema/registry.ts";
import { CRITERION_STATUSES } from "../core/validation/types.ts";

/**
 * The schemas and the code must agree about what the words mean.
 *
 * This file exists because they stopped agreeing, and the cost was the whole product. Every
 * vocabulary below is declared in TypeScript and then written out again in JSON Schema, because a
 * JSON Schema cannot import a TypeScript array. A hand-kept second copy of a list is the same drift
 * hazard as a hand-kept second copy of a function: when `AMBIGUITY_ORIGINS` grew an `iteration`
 * member - a gap raised once a run is under way - `result.schema.json` was not told, and the result
 * of the canonical demo failed its own self-check:
 *
 *     veridian: schemas/result.schema.json does not satisfy its schema:
 *       - $.clarifications.records[4].origin: "iteration" is not one of "goal", "acceptance", ...
 *
 * The engine had recorded something true and the contract refused to believe it. So the rule is
 * stated once and enforced mechanically, in both directions:
 *
 *  1. **Exactly one definition per vocabulary.** A schema that re-lists a vocabulary another schema
 *     already defines is how the drift starts, so a second copy is itself the failure - it is
 *     referenced (`ambiguity.schema.json#/$defs/Origin`), never retyped.
 *  2. **A slot that names a vocabulary must accept all of it.** Where a schema enumerates the values
 *     of a slot whose name is the vocabulary's name (`"origin"`, `"status"`, `$defs.State`), the
 *     list has to be the whole vocabulary or one of the subsets the code itself exports. A partial
 *     list is a schema that forbids a value its own engine emits, which is what made a finished run
 *     unable to record that it had finished; a leftover superset is the same error from the other
 *     side, promising values the engine cannot produce.
 *
 * Matching on the slot name matters, and the reason is instructive. An overlap test alone is not
 * enough: `run.schema.json`'s twelve run states share the word `ERROR` with `CRITERION_STATUSES`,
 * and `$defs.Verdict` is legitimately a *subset* of the criterion statuses (`PASS`, `FAIL`,
 * `INCONCLUSIVE` are three of the five). Neither is drift, and a guard that called them drift would
 * be switched off within a week. Drift is not two lists sharing a word; it is two lists claiming to
 * be the same list, and that is exactly what the slot name reveals.
 */

const repo = nodeIo();

interface Vocabulary {
  readonly name: string;
  readonly values: readonly string[];
  /** Property names (and `$defs` names) whose values this vocabulary claims as its own. */
  readonly slots: readonly string[];
  /** Sub-vocabularies the code exports by name, which a schema is entitled to enumerate. */
  readonly subsets?: readonly (readonly string[])[];
}

const VOCABULARIES: readonly Vocabulary[] = [
  { name: "AMBIGUITY_ORIGINS", values: AMBIGUITY_ORIGINS, slots: ["origin"] },
  { name: "AMBIGUITY_KINDS", values: AMBIGUITY_KINDS, slots: ["kind"] },
  { name: "DEFER_REASONS", values: DEFER_REASONS, slots: ["reason"] },
  { name: "RUNGS", values: RUNGS, slots: ["rung", "rungsattempted", "via"] },
  { name: "CRITERION_STATUSES", values: CRITERION_STATUSES, slots: ["status"] },
  { name: "FAILURE_TAXONOMY", values: FAILURE_TAXONOMY, slots: ["failurekind", "kind"] },
  { name: "RUN_STATES", values: RUN_STATES, slots: ["state"], subsets: [TERMINAL_STATES] },
];

interface FoundEnum {
  readonly uri: string;
  readonly pointer: string;
  /** The key the enum's own object sits under: `origin`, `reason`, a `$defs` name. */
  readonly slot: string;
  readonly values: readonly string[];
  /**
   * How the schema spelled the list, which decides what a disagreement means.
   *
   * An `enum` states a vocabulary in one place, so there may be exactly one of them per vocabulary.
   * A `const` group states it as one branch per member instead: the resolution ladder is written
   * that way, because each rung carries its own payload (`grounds` and `rounds` for a self-prompted
   * answer, `assumption` for a defaulted one), so the branches cannot share one list. Grouping them
   * is therefore not a second copy of `$defs.Rung` - it is the same vocabulary seen through the
   * union's shape - and the two are held to different rules: one definition, any number of groups,
   * but a group must name the whole vocabulary and must name it in the engine's order.
   */
  readonly kind: "enum" | "const";
}

/** A `const` found in a schema, kept until its siblings are known. */
interface FoundConst {
  readonly pointer: string;
  readonly slot: string;
  readonly value: string;
}

/** The deepest pointer every member shares, so a group names where it lives rather than one of its
 * branches. `#/$defs/Resolution/oneOf/3/properties/via` becomes `#/$defs/Resolution/oneOf`. */
function commonPrefix(pointers: readonly string[]): string {
  const tokens = (pointers[0] ?? "").split("/");
  let keep = tokens.length;
  for (const pointer of pointers) {
    const parts = pointer.split("/");
    let index = 0;
    while (index < keep && index < parts.length && parts[index] === tokens[index]) index += 1;
    keep = index;
  }
  return tokens.slice(0, keep).join("/");
}

/**
 * Every `enum` of strings and every group of `const` strings, with a JSON pointer and a slot name.
 *
 * `const` is read because a schema that spells a vocabulary as a `oneOf` of single-value branches
 * holds it just as plainly as one that spells it as an `enum`, and a walker that saw only `enum`
 * reported nothing at all about the six resolution branches - so the rung vocabulary's schema half
 * was the one half of it with no guard, while the engine half had one. A guard that inspects a
 * vocabulary is worth having only if it looks at the shape the vocabulary was actually written in.
 */
function enumsIn(document: unknown, uri: string): FoundEnum[] {
  const found: FoundEnum[] = [];
  const consts: FoundConst[] = [];

  const walk = (node: unknown, pointer: string, slot: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${String(index)}`, slot));
      return;
    }
    if (typeof node !== "object" || node === null) return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const token = key.replace(/~/g, "~0").replace(/\//g, "~1");
      const here = `${pointer}/${token}`;
      if (key === "enum" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
        found.push({
          uri,
          pointer: here,
          slot: slot.toLowerCase(),
          values: value as string[],
          kind: "enum",
        });
        continue;
      }
      if (key === "const" && typeof value === "string") {
        consts.push({ pointer: here, slot: slot.toLowerCase(), value });
        continue;
      }
      walk(value, here, key);
    }
  };

  walk(document, "", "");

  // Grouped by slot, so six branches of one union read as one list rather than as six partial ones.
  const bySlot = new Map<string, FoundConst[]>();
  for (const entry of consts) {
    const group = bySlot.get(entry.slot) ?? [];
    group.push(entry);
    bySlot.set(entry.slot, group);
  }
  for (const [slot, group] of bySlot) {
    found.push({
      uri,
      pointer: commonPrefix(group.map((entry) => entry.pointer)),
      slot,
      values: group.map((entry) => entry.value),
      kind: "const",
    });
  }

  return found;
}

let cache: Promise<readonly FoundEnum[]> | undefined;
function allEnums(): Promise<readonly FoundEnum[]> {
  cache ??= (async () => {
    const documents = await Promise.all(
      ALL_SCHEMA_URIS.map(async (uri) => {
        const body = await repo.readTextFile(uri);
        assert.ok(body !== null, `${uri} is listed in ALL_SCHEMA_URIS but could not be read`);
        return enumsIn(JSON.parse(body) as unknown, uri);
      }),
    );
    return documents.flat();
  })();
  return cache;
}

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

describe("schemas and code share one vocabulary", () => {
  it("reads the enums it claims to police", async () => {
    const found = await allEnums();
    // A guard that silently inspected nothing would pass forever. These lists are load-bearing, so
    // each one has to be somewhere in the contracts.
    for (const vocabulary of VOCABULARIES) {
      assert.ok(
        found.some((entry) => entry.values.some((value) => vocabulary.values.includes(value))),
        `${vocabulary.name} appears in no schema enum, so this guard is no longer checking it and the schemas have stopped describing it at all`,
      );
    }
  });

  it("defines each vocabulary in exactly one place", async () => {
    const found = await allEnums();
    for (const vocabulary of VOCABULARIES) {
      // Only `enum` counts as a definition. A `const` group is the same vocabulary written through
      // a union's shape, and it is policed by the slot rule below instead - which is the stronger
      // rule for it, because a group has to match member for member *and* in order.
      const copies = found.filter(
        (entry) => entry.kind === "enum" && sameMembers(entry.values, vocabulary.values),
      );
      assert.ok(
        copies.length <= 1,
        `${vocabulary.name} is enumerated in ${copies.map((entry) => `${entry.uri}${entry.pointer}`).join(" and ")}. ` +
          "A typed-out second copy of a vocabulary is a copy that can fall behind: reference the first one instead " +
          "(see result.schema.json's origin, which points at ambiguity.schema.json#/$defs/Origin).",
      );
    }
  });

  it("writes the resolution ladder in the order the engine walks it", async () => {
    const found = await allEnums();
    const ladder = found.find(
      (entry) => entry.kind === "const" && entry.slot === "via",
    );
    assert.ok(
      ladder !== undefined,
      "no `via` slot states the resolution ladder as one branch per rung, so this check has stopped " +
        "looking at it and the ladder is described nowhere a reader can trust",
    );
    assert.deepEqual(
      [...ladder.values],
      [...RUNGS],
      "The branches of the resolution union *are* the ladder, so their order is the ladder's order. " +
        "A schema that prints the rungs in one order while the engine walks them in another documents " +
        "a ladder nobody climbs - and the order is not cosmetic here, because the placement of " +
        "`self_prompted` between `defaulted` and `answered` is the whole reason a self-generated " +
        "answer can never displace a declared fail-safe default.",
    );
  });

  it("never enumerates part of a vocabulary in a slot that names it", async () => {
    const found = await allEnums();
    for (const entry of found) {
      for (const vocabulary of VOCABULARIES) {
        if (!vocabulary.slots.includes(entry.slot)) continue;

        const overlap = entry.values.filter((value) => vocabulary.values.includes(value));
        if (overlap.length === 0) continue;

        const exact = sameMembers(entry.values, vocabulary.values);
        const declaredSubset = (vocabulary.subsets ?? []).some((subset) => sameMembers(entry.values, subset));
        if (exact || declaredSubset) continue;

        const missing = vocabulary.values.filter((value) => !entry.values.includes(value));
        const extra = entry.values.filter((value) => !vocabulary.values.includes(value));
        assert.fail(
          // `entry.uri` is already `schemas/<name>.schema.json` - the schema set's own spelling. A
          // literal `schemas/` added to it produced `schemas/schemas/ambiguity.schema.json`, a path
          // nothing can open, in the one message a reader consults to find the file that disagrees.
          `${entry.uri}${entry.pointer} is the \`${entry.slot}\` slot, so it claims to speak for ` +
            `${vocabulary.name} - but it does not.` +
            (missing.length > 0 ? ` It forbids ${missing.join(", ")}, which the engine can emit.` : "") +
            (extra.length > 0 ? ` It allows ${extra.join(", ")}, which the engine cannot emit.` : "") +
            ` List every member of ${vocabulary.name}, reference the one definition it already has, or export ` +
            "the narrower list in code so it can be declared here as a subset.",
        );
      }
    }
  });

  it("only lets a criterion require an artifact some world can produce", () => {
    // The artifact kinds an adapter may *declare* and the kinds a criterion may *demand* are two
    // lists answering two questions, so they are allowed to differ - `log` is producible and not
    // demandable. The direction of that difference is not free, though: a demanded kind that no
    // adapter can declare is a criterion whose evidence can never exist, which is a guarantee of
    // missing evidence reported as if the application had failed. `json` was added to
    // `EVIDENCE_KINDS` for the database world, whose evidence *is* JSON; this is the check that
    // adding it was a widening and not a promise.
    for (const kind of EVIDENCE_KINDS) {
      assert.ok(
        (ARTIFACT_KINDS as readonly string[]).includes(kind),
        `EVIDENCE_KINDS names "${kind}", which is not an ArtifactKind, so no adapter can ever ` +
          "declare it and a criterion requiring it can only end in missing evidence.",
      );
    }
  });
});
