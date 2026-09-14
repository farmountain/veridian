/**
 * The primitives every scalar validator is built from.
 *
 * These lived inside `validators/playwright/` until a second validator family needed them, and the
 * move is not tidying. A comparison vocabulary declared twice is a vocabulary that will eventually
 * disagree with itself, and the disagreement would be silent in the worst way: `contains` on a web
 * page and `contains` on a database row would be one word in an acceptance contract with two
 * meanings, and the failure report would not say which one a criterion was judged by.
 *
 * They sit in `core/` rather than in a folder shared by validators because the vocabulary they
 * implement (`COMPARISON_KEYS`) is already declared by the acceptance layer, and because the
 * layering rule allows any `validators/*` family to import `core/*` while forbidding one family to
 * import another. `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` records the phase that exposed this.
 */
import { COMPARISON_KEYS } from "../acceptance/plan.ts";
import type { ComparisonKey } from "../acceptance/plan.ts";
import type { FailureKind } from "../failure.ts";
import type { AssertionResult } from "./types.ts";

/** A value a validator can actually compare. Anything else is a criterion defect, not a judgement. */
export type Scalar = string | number | boolean;

export type ComparisonOutcome =
  | { readonly kind: "judged"; readonly holds: boolean; readonly phrase: string }
  | { readonly kind: "unusable"; readonly message: string };

export const assertion = (
  validator: string,
  target: string | null,
  status: AssertionResult["status"],
  actual: unknown,
  expected: unknown,
  message: string | null,
  failureKind: FailureKind | null = null,
): AssertionResult => ({ validator, target, status, actual, expected, message, failureKind });

/**
 * The criterion cannot be evaluated at all.
 *
 * `VALIDATOR_ERROR` rather than `TEST_FAILURE`, because it means a word in the acceptance contract
 * could not be turned into a question about the application. The application has not been accused of
 * anything.
 */
export const unusable = (validator: string, target: string | null, message: string): AssertionResult =>
  assertion(validator, target, "ERROR", null, null, message, "VALIDATOR_ERROR");

/**
 * The world did not answer.
 *
 * This is the branch that keeps the product honest, so it says *why* in words an external agent can
 * act on: which target, and whether it was unevaluable or simply absent from the observation.
 */
export const unanswered = (
  validator: string,
  target: string | null,
  message: string,
  actual: unknown = null,
): AssertionResult => assertion(validator, target, "INCONCLUSIVE", actual, null, message);

export const quote = (selector: string): string => `\`${selector}\``;

/** A value rendered for a failure report. Strings are quoted so `"25"` cannot be read as `25`. */
export const describe = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
};

export const compile = (source: string): RegExp | null => {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
};

export const plural = (unit: string, count: number): string => `${unit}${count === 1 ? "" : "s"}`;

/** Enough of a list to act on; a report that recites 400 entries is a report nobody reads. */
export const brief = (items: readonly string[], limit = 10): string => {
  if (items.length <= limit) return items.join("; ");
  return `${items.slice(0, limit).join("; ")}; and ${items.length - limit} more`;
};

// ---- comparison semantics ------------------------------------------------------------------------

export const notDeclaredMessage = (key: ComparisonKey, declared: string): string =>
  `"${key}" is not declared by this validator; it compares with ${declared}.`;

/**
 * A comparison this validator never stated.
 *
 * Reached only by a caller that bypassed `buildValidationPlan`, which refuses an expectation stating
 * a key its validator does not declare. Said plainly anyway, because the alternative is describing a
 * complaint about a comparison the validator never had.
 */
export const notDeclared = (key: ComparisonKey, declared: string): ComparisonOutcome => ({
  kind: "unusable",
  message: notDeclaredMessage(key, declared),
});

export function compareText(key: ComparisonKey, actual: string, expected: unknown): ComparisonOutcome {
  switch (key) {
    case "equals":
    case "contains": {
      if (typeof expected !== "string") {
        return {
          kind: "unusable",
          message: `"${key}" compares text with a string; it received ${describe(expected)}.`,
        };
      }
      return {
        kind: "judged",
        holds: key === "equals" ? actual === expected : actual.includes(expected),
        phrase:
          key === "equals" ? `to equal ${describe(expected)}` : `to contain ${describe(expected)}`,
      };
    }
    case "matches": {
      if (typeof expected !== "string") {
        return {
          kind: "unusable",
          message:
            `"matches" compares text with a regular expression written as a string; it received ` +
            `${describe(expected)}.`,
        };
      }
      const pattern = compile(expected);
      if (pattern === null) {
        return {
          kind: "unusable",
          message: `"matches" wants a regular expression; ${describe(expected)} does not compile.`,
        };
      }
      return { kind: "judged", holds: pattern.test(actual), phrase: `to match /${expected}/` };
    }
    default:
      return notDeclared(key, "equals, contains and matches");
  }
}

export function compareCounts(key: ComparisonKey, actual: number, expected: unknown): ComparisonOutcome {
  switch (key) {
    case "equals":
    case "atLeast":
    case "atMost": {
      if (typeof expected !== "number" || !Number.isFinite(expected)) {
        return {
          kind: "unusable",
          message: `"${key}" compares a count with a number; it received ${describe(expected)}.`,
        };
      }
      const holds =
        key === "equals" ? actual === expected : key === "atLeast" ? actual >= expected : actual <= expected;
      const phrase =
        key === "equals"
          ? `to equal ${expected}`
          : key === "atLeast"
            ? `to be at least ${expected}`
            : `to be at most ${expected}`;
      return { kind: "judged", holds, phrase };
    }
    default:
      return notDeclared(key, "equals, atLeast and atMost");
  }
}

const wantPhrase = (wanted: boolean, words: boolean): string =>
  words ? (wanted ? "to be present" : "to be absent") : `to be ${wanted}`;

/**
 * Booleans, with an optional reading in words.
 *
 * `present` / `absent` are accepted only where the question is the presence of an element, because
 * `equals: true` on `web.element` is a sentence nobody reads correctly the first time.
 */
export const compareBooleans =
  (acceptWords: boolean) =>
  (key: ComparisonKey, actual: boolean, expected: unknown): ComparisonOutcome => {
    if (key !== "equals") return notDeclared(key, "equals");
    const wanted =
      typeof expected === "boolean"
        ? expected
        : acceptWords && expected === "present"
          ? true
          : acceptWords && expected === "absent"
            ? false
            : null;
    if (wanted === null) {
      return {
        kind: "unusable",
        message: acceptWords
          ? `"equals" wants true, false, "present" or "absent"; it received ${describe(expected)}.`
          : `"equals" wants true or false; it received ${describe(expected)}.`,
      };
    }
    return {
      kind: "judged",
      holds: actual === wanted,
      phrase: wantPhrase(wanted, acceptWords),
    };
  };

export const comparePresence = compareBooleans(true);
export const compareTruth = compareBooleans(false);

/**
 * `equals` against a vocabulary the reading owns, rather than against free text.
 *
 * The expected value is checked against the vocabulary, so a criterion asking whether a service
 * `equals: "started"` is reported as a contract that cannot be read instead of as a comparison that is
 * always false. The second shape is the dangerous one: it is indistinguishable from an application
 * defect, and it sends an agent to repair working code.
 *
 * It lives here rather than inside a family for the reason this file's header already gives about the
 * vocabulary at large - a comparison declared twice will eventually disagree with itself. It was
 * written inside `validators/posix/` first, and the moment a second family needed it the choice was
 * between importing one family from another (forbidden - `validators/*` may not depend on
 * `validators/*`) and writing a second copy whose message wording could drift. The vocabulary is
 * passed in by the caller, so the list judged here is always the same list the reading is written
 * from, whichever world asked.
 */
export function compareWord(vocabulary: readonly string[], what: string) {
  return (key: ComparisonKey, actual: string, expected: unknown): ComparisonOutcome => {
    if (key !== "equals") return notDeclared(key, "equals");
    if (typeof expected !== "string" || !vocabulary.includes(expected)) {
      return {
        kind: "unusable",
        message:
          `"equals" on ${what} wants one of ${vocabulary.join(", ")}; it received ` +
          `${describe(expected)}.`,
      };
    }
    return { kind: "judged", holds: actual === expected, phrase: `to be ${expected}` };
  };
}

// ---- the shape every scalar validator follows -----------------------------------------------------

export const statedComparisons = (raw: Readonly<Record<string, unknown>>): readonly ComparisonKey[] =>
  COMPARISON_KEYS.filter((key) => raw[key] !== undefined);

export function expectedOf(
  raw: Readonly<Record<string, unknown>>,
  stated: readonly ComparisonKey[],
): unknown {
  if (stated.length === 0) return null;
  if (stated.length === 1) {
    const [only] = stated;
    return only === undefined ? null : raw[only];
  }
  const record: Record<string, unknown> = {};
  for (const key of stated) record[key] = raw[key];
  return record;
}

/**
 * The verdict for one observed scalar against every comparison the author stated.
 *
 * A `PASS` assertion carries no message on purpose. `core/validation/registry.ts` lifts the first
 * message it finds onto the criterion, and a passing assertion's cheerful sentence sitting above a
 * failing one is exactly the kind of artefact an agent skims and believes.
 */
export function judge<A extends Scalar>(
  validator: string,
  target: string | null,
  subject: string,
  actual: A,
  raw: Readonly<Record<string, unknown>>,
  compare: (key: ComparisonKey, actual: A, expected: unknown) => ComparisonOutcome,
): AssertionResult {
  const stated = statedComparisons(raw);
  if (stated.length === 0) {
    return unusable(
      validator,
      target,
      `The expectation on ${subject} states no comparison, so there is nothing to judge. ` +
        "An expectation that cannot fail is a false PASS waiting to happen.",
    );
  }
  for (const key of stated) {
    const expected = raw[key];
    const outcome = compare(key, actual, expected);
    if (outcome.kind === "unusable") return unusable(validator, target, outcome.message);
    if (!outcome.holds) {
      return assertion(
        validator,
        target,
        "FAIL",
        actual,
        expected,
        `Expected ${subject} ${outcome.phrase}, but it is ${describe(actual)}.`,
      );
    }
  }
  return assertion(validator, target, "PASS", actual, expectedOf(raw, stated), null);
}
