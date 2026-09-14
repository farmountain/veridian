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
  { name: "RUNGS", values: RUNGS, slots: ["rung", "rungsattempted"] },
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
}

/** Every `enum` of strings in a schema document, with a JSON pointer and its slot name. */
function enumsIn(document: unknown, uri: string): FoundEnum[] {
  const found: FoundEnum[] = [];

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
        found.push({ uri, pointer: here, slot: slot.toLowerCase(), values: value as string[] });
        continue;
      }
      walk(value, here, key);
    }
  };

  walk(document, "", "");
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
      const copies = found.filter((entry) => sameMembers(entry.values, vocabulary.values));
      assert.ok(
        copies.length <= 1,
        `${vocabulary.name} is enumerated in ${copies.map((entry) => `${entry.uri}${entry.pointer}`).join(" and ")}. ` +
          "A typed-out second copy of a vocabulary is a copy that can fall behind: reference the first one instead " +
          "(see result.schema.json's origin, which points at ambiguity.schema.json#/$defs/Origin).",
      );
    }
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
          `schemas/${entry.uri}${entry.pointer} is the \`${entry.slot}\` slot, so it claims to speak for ` +
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
