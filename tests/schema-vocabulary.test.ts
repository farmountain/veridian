import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allDetectors, runtimeDetectors } from "../core/clarification/detect.ts";
import {
  ClarificationEngine,
  NullPromptPort,
  scriptedPromptPort,
  scriptedSelfPromptPort,
  type ClarificationEngineDeps,
} from "../core/clarification/engine.ts";
import {
  AMBIGUITY_KINDS,
  AMBIGUITY_ORIGINS,
  DEFER_REASONS,
  RUNGS,
  ambiguity,
  ambiguityId,
  failSafeDefault,
  type Ambiguity,
  type Clock,
  type DeferReason,
  type Rung,
} from "../core/clarification/types.ts";
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
 *
 * The same rule has a second half, about the code rather than the schemas, and it is the last
 * `describe` in this file: a vocabulary the ladder owns must be answerable by the ladder, so every
 * origin has a detector, every rung has a gap that stops there, and every deferral reason has a path
 * that produces it. A name no code path emits is not a vocabulary; it is a comment.
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

// ---------------------------------------------------------------------------------------------
// The same rule from the other side: a vocabulary the ladder owns must be answerable by the ladder.
// ---------------------------------------------------------------------------------------------

/**
 * Every word the clarification layer owns, held to a code path that produces it.
 *
 * The `describe` above holds the *schemas* to the vocabulary. This one holds the *code* to it, which
 * is the same defect seen from the other side: a name the engine can emit but no path can produce is
 * not a vocabulary, it is a comment. Three claims, and each derives its coverage from the register
 * rather than from a list written beside it - a hand-kept list of what is covered is a second copy of
 * the vocabulary, and it drifts exactly as the schema copies did.
 *
 *  1. Every `AMBIGUITY_ORIGINS` member is named by exactly one of the two detector tables, and no
 *     table names anything that is not a member. The tables partition the origins - four DEFINE-time
 *     detectors and three that read a run's own output - so "exactly one" is the whole claim: zero is
 *     a gap nothing can raise, and two is a gap two detectors raise at once.
 *  2. Every `RUNGS` member is where the ladder stops, for some gap the ladder was handed.
 *  3. Every `DEFER_REASONS` member is produced by some gap.
 *
 * Claims 2 and 3 are declared as `Record<Rung, ...>` and `Record<DeferReason, ...>`, so a member
 * added to the vocabulary without a scenario that reaches it is a *typecheck* error rather than an
 * assertion a loop never got to. That is deliberate, and it is the strongest form available: the
 * compiler holds the roster and the assertions hold the behaviour of each entry. The third claim's
 * other direction - that no deferral carries a reason outside the vocabulary - is held by the same
 * mechanism, because `Resolution`'s deferred branch declares `reason: DeferReason`.
 */

const ladderClock = (): Clock => {
  const at = 1_000;
  return { now: () => at, iso: () => new Date(at).toISOString() };
};

/** A gap that no port is configured to answer in most scenarios, so it walks to the end. */
const ladderGap = (path: string, blocking: boolean): Ambiguity =>
  ambiguity({
    origin: "goal",
    path,
    kind: "missing_value",
    question: `What is ${path}?`,
    blocking,
  });

interface LadderScenario {
  /** Only the rungs this scenario needs. A deriver installed beside a self-prompt port would prove
   *  nothing about which of the two answered. */
  readonly deps: ClarificationEngineDeps;
  readonly gaps: readonly Ambiguity[];
}

/**
 * One scenario per rung: the smallest gap that stops the ladder there.
 *
 * `inferred`, `answered` and `self_prompted` are all blocking on purpose - rung 2 is spent only where
 * the answer changes a verdict, and rungs 4 and 5 exist only for a gap a human would have been asked
 * about - so a non-blocking gap in any of those three would prove nothing about the rung.
 */
const RUNG_SCENARIOS: Readonly<Record<Rung, LadderScenario>> = {
  derived: {
    deps: {
      user: NullPromptPort,
      clock: ladderClock(),
      derive: {
        derive: () => ({ value: "derived-value", evidence: "schema default at /probe/derived" }),
      },
    },
    gaps: [ladderGap("/probe/derived", false)],
  },
  inferred: {
    deps: {
      user: scriptedPromptPort({}),
      clock: ladderClock(),
      infer: {
        infer: () =>
          Promise.resolve({ value: "inferred-value", confidence: 0.95, source: "memory:prior-run" }),
      },
    },
    gaps: [ladderGap("/probe/inferred", true)],
  },
  defaulted: {
    deps: { user: NullPromptPort, clock: ladderClock() },
    gaps: [
      {
        ...ladderGap("/probe/defaulted", true),
        ...failSafeDefault(10, "a cap of ten cannot make a run report PASS more readily than the truth"),
      },
    ],
  },
  self_prompted: {
    deps: {
      user: NullPromptPort,
      clock: ladderClock(),
      selfPrompt: scriptedSelfPromptPort({
        [ambiguityId("goal", "/probe/self", "missing_value")]: {
          value: "self-value",
          confidence: 0.95,
          grounds: "read /probe/self out of the contract in hand",
        },
      }),
    },
    gaps: [ladderGap("/probe/self", true)],
  },
  answered: {
    deps: {
      user: scriptedPromptPort({
        [ambiguityId("goal", "/probe/answered", "missing_value")]: "the operator's answer",
      }),
      clock: ladderClock(),
    },
    gaps: [ladderGap("/probe/answered", true)],
  },
  deferred: {
    deps: { user: NullPromptPort, clock: ladderClock() },
    gaps: [ladderGap("/probe/deferred", false)],
  },
};

/**
 * One scenario per deferral reason: the smallest gap whose ladder ends without a value.
 *
 * The branch order inside the engine's `#deferReason` is what decides which reason is *producible*,
 * and two facts about it are worth stating because neither is guessable from the vocabulary:
 *
 *  - `non_blocking` is returned before anything else is considered, so a non-blocking gap can never
 *    be deferred for any other reason. That is why every other scenario here is blocking.
 *  - The wall clock and the question budget are checked only inside the asking rounds, so those two
 *    reasons cannot be produced by a gap alone. Their scenarios set one budget knob to its boundary
 *    and let an available-but-silent prompt port do the rest.
 *
 * `not_derivable` and `no_default` differ by one thing, and it is the thing the fail-safe rule is
 * about: whether the author declared a default at all. `not_derivable` is a gap whose author declared
 * a value and argued for it with nothing, so the default is ignored and nothing else closes it;
 * `no_default` is a gap whose author declared nothing.
 */
const DEFER_SCENARIOS: Readonly<Record<DeferReason, LadderScenario>> = {
  not_derivable: {
    deps: { user: scriptedPromptPort({}), clock: ladderClock() },
    gaps: [
      {
        ...ladderGap("/probe/not-derivable", true),
        defaultValue: "unusable-default",
        defaultRationale: "",
      },
    ],
  },
  no_default: {
    deps: { user: scriptedPromptPort({}), clock: ladderClock() },
    gaps: [ladderGap("/probe/no-default", true)],
  },
  low_confidence: {
    deps: {
      user: scriptedPromptPort({}),
      clock: ladderClock(),
      infer: {
        // Below `inferThreshold`, so the rung is attempted and refused rather than skipped.
        infer: () =>
          Promise.resolve({ value: "maybe", confidence: 0.69, source: "memory:prior-run" }),
      },
    },
    gaps: [ladderGap("/probe/low-confidence", true)],
  },
  no_user_available: {
    deps: { user: NullPromptPort, clock: ladderClock() },
    gaps: [ladderGap("/probe/no-user", true)],
  },
  non_blocking: {
    deps: { user: NullPromptPort, clock: ladderClock() },
    gaps: [ladderGap("/probe/non-blocking", false)],
  },
  question_budget_exhausted: {
    deps: {
      user: scriptedPromptPort({}),
      clock: ladderClock(),
      policy: { maxQuestionsPerRun: 0 },
    },
    gaps: [ladderGap("/probe/no-questions-left", true)],
  },
  time_budget_exhausted: {
    deps: {
      user: scriptedPromptPort({}),
      clock: ladderClock(),
      policy: { budgetMs: 0 },
    },
    gaps: [ladderGap("/probe/no-time-left", true)],
  },
};

describe("the ladder answers every word it owns", () => {
  it("gives each origin a detector in exactly one register", () => {
    const tables: readonly (readonly { readonly origin: string }[])[] = [
      allDetectors(),
      runtimeDetectors(),
    ];
    const named = tables.flat().map((entry) => entry.origin);

    assert.ok(
      named.length > 0,
      "neither detector table names an origin, so this test proves nothing about either of them",
    );
    for (const origin of AMBIGUITY_ORIGINS) {
      const count = named.filter((value) => value === origin).length;
      assert.equal(
        count,
        1,
        `AMBIGUITY_ORIGINS names "${origin}" and ${String(count)} of the two detector tables ` +
          "claim it. Zero is a gap no run can ever raise; two is a gap two detectors raise at once, " +
          "so the ladder is handed the same question twice.",
      );
    }
    for (const origin of named) {
      assert.ok(
        (AMBIGUITY_ORIGINS as readonly string[]).includes(origin),
        `a detector table claims origin "${origin}", which is not a member of AMBIGUITY_ORIGINS, ` +
          "so nothing declares what a resolution of it would mean.",
      );
    }
  });

  it("stops the ladder on every rung the vocabulary names", async () => {
    for (const rung of RUNGS) {
      const scenario = RUNG_SCENARIOS[rung];
      const outcome = await new ClarificationEngine(scenario.deps).resolve({}, [...scenario.gaps]);
      const record = outcome.report.records[0];
      assert.ok(
        record,
        `the scenario written for the "${rung}" rung recorded no resolution at all, so it proves ` +
          "nothing about that rung",
      );
      assert.equal(
        record.resolution.via,
        rung,
        `the gap written to stop the ladder at "${rung}" resolved via ` +
          `"${record.resolution.via}" instead. Either the scenario no longer reaches that rung or ` +
          "the rung itself moved.",
      );
      assert.equal(
        record.rungsAttempted[record.rungsAttempted.length - 1],
        rung,
        `the "${rung}" resolution did not record "${rung}" as the last rung it attempted, so the ` +
          "record of how it was resolved disagrees with the resolution.",
      );
      assert.ok(
        record.rungsAttempted.length <= RUNGS.length,
        `the "${rung}" resolution recorded ${String(record.rungsAttempted.length)} rungs attempted ` +
          `out of ${String(RUNGS.length)}, which the ladder cannot do: it is a straight line and ` +
          "each rung is attempted at most once per gap.",
      );
      assert.equal(
        new Set(record.rungsAttempted).size,
        record.rungsAttempted.length,
        `the "${rung}" resolution recorded the same rung twice, which means the ladder revisited a ` +
          "rung - the one property that makes its termination structural.",
      );
      assert.equal(
        outcome.report.byVia[rung],
        1,
        `the summary counted ${String(outcome.report.byVia[rung])} resolutions via "${rung}" for a ` +
          "gap that resolved exactly once.",
      );
    }
  });

  it("defers for every reason the vocabulary names", async () => {
    for (const reason of DEFER_REASONS) {
      const scenario = DEFER_SCENARIOS[reason];
      const outcome = await new ClarificationEngine(scenario.deps).resolve({}, [...scenario.gaps]);
      const record = outcome.report.records[0];
      assert.ok(
        record,
        `the scenario written for "${reason}" recorded no resolution at all, so it proves nothing ` +
          "about that reason",
      );
      assert.equal(
        record.resolution.via,
        "deferred",
        `the gap written to be deferred as "${reason}" resolved via "${record.resolution.via}" ` +
          "instead of deferring, so it produced a value where the document says there is none.",
      );
      assert.equal(
        record.resolution.via === "deferred" ? record.resolution.reason : null,
        reason,
        `the gap written to be deferred as "${reason}" was deferred as something else. The order of ` +
          "the branches that choose a reason is part of the ladder, not an implementation detail: " +
          "reordering them changes which reasons a run can produce without changing any of them.",
      );
      assert.equal(
        record.rungsAttempted[record.rungsAttempted.length - 1],
        "deferred",
        `the "${reason}" deferral did not record "deferred" as the last rung it attempted, so its ` +
          "own record does not say that it stopped.",
      );
    }
  });
});
