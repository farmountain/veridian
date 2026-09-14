/**
 * The `web.*` validator family — the vocabulary an acceptance criterion uses to judge a web page.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`WebObservationData`) and never touches a browser, a port or a
 * clock. That is the entire reason the vocabulary lives in `core/environment/web-observation.ts`
 * rather than beside the Playwright adapter: `validators/*` may not import `adapters/*`, so a
 * validator cannot know how the page was driven, cannot become untestable the day the driver is
 * replaced, and can be judged from the bundle a year later without a browser installed.
 *
 * The names are therefore `web.*` and not `playwright.*`. The criterion is about a web page, not
 * about which driver looked at it; a validator named after its driver is a validator that cannot be
 * swapped when the driver is.
 *
 * ## Status discipline
 *
 * Every branch here is chosen so that a wrong answer is never produced:
 *
 * - `PASS` — the comparison held, and the world was actually looked at.
 * - `FAIL` — the comparison did not hold. Reserved for facts about *the application*: an element
 *   that did not render, a total that did not recalculate, a request that 404'd.
 * - `INCONCLUSIVE` — nobody looked. A selector Playwright could not evaluate, a selector the
 *   observation never reported, a console the criterion never asked to be captured. Reporting this
 *   as `FAIL` would send an external agent to repair an application that was never examined;
 *   reporting it as `PASS` is the one outcome this product exists to make impossible.
 * - `ERROR` — the *criterion* is unusable (a comparison that wants a number and got a word) or the
 *   world arrived unreadable. Always carries `failureKind`, and never `TEST_FAILURE`: a typo in an
 *   acceptance contract is not a defect in the application.
 *
 * ## Comparisons
 *
 * Each validator states which comparison keys it understands and reads only those.
 * `core/acceptance/plan.ts` refuses an expectation stating a key its validator does not declare, so
 * there is no path through the plan that silently ignores half of a claim. When an expectation
 * states more than one comparison, *all* of them must hold: `{ equals: "x", contains: "y" }` is one
 * claim with two conditions, not two claims to be resolved by whichever a reader notices first.
 */

import type { ArtifactKind, Observation } from "../../core/environment/types.ts";
import {
  assertion,
  brief,
  compareCounts,
  comparePresence,
  compareText,
  compareTruth,
  describe,
  expectedOf,
  judge,
  notDeclaredMessage,
  plural,
  quote,
  statedComparisons,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import {
  WEB_OBSERVATION_KIND,
  isWebObservationData,
  targetOf,
} from "../../core/environment/web-observation.ts";
import type {
  WebObservationData,
  WebTargetObservation,
} from "../../core/environment/web-observation.ts";
import type { FailureKind } from "../../core/failure.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * A criterion, a test and a failure report all spell these strings. Exporting the literal type of
 * each means a rename breaks the compiler instead of producing an acceptance contract that quietly
 * resolves to no validator at all.
 */
export const WEB_UI_VALIDATOR_NAMES = {
  element: "web.element",
  visible: "web.visible",
  text: "web.text",
  value: "web.value",
  count: "web.count",
  url: "web.url",
  console: "web.console.clean",
  network: "web.network.ok",
} as const;

// The comparison primitives that used to be defined here now live in
// `core/validation/assertions.ts`, because the database validator family needs the same semantics
// and one vocabulary with two definitions is a vocabulary that eventually disagrees with itself.
// They are imported above; what remains below is the part that is about a *web* world.

// ---- the shape every scalar validator follows -----------------------------------------------------

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): WebObservationData | AssertionResult {
  if (isWebObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a web document, so ` +
      "there is nothing to read. The adapter produced the measurement, so this is a defect in the " +
      "environment rather than a criterion the application failed.",
    "ENVIRONMENT_FAILURE",
  );
}

function readTarget(
  observation: Observation,
  document: WebObservationData,
  validator: string,
  selector: string | null,
): WebTargetObservation | AssertionResult {
  if (selector === null) {
    return unusable(validator, null, "This validator reads exactly one selector and the criterion named none.");
  }
  const reading = targetOf(document, selector);
  if (reading === null) {
    return unanswered(
      validator,
      selector,
      `The observation reports nothing about ${quote(selector)}. The contract tells the adapter ` +
        "which selectors to read, so a missing reading means the selector was never looked at.",
    );
  }
  if (reading.error !== null) {
    return unanswered(
      validator,
      selector,
      `Reading ${quote(selector)} did not answer the question: ${reading.error}`,
    );
  }
  return reading;
}

const isAssertion = (value: WebObservationData | WebTargetObservation | AssertionResult): value is AssertionResult =>
  "status" in value;

const captured = (observation: Observation, kind: ArtifactKind): boolean =>
  observation.artifacts.some((artifact) => artifact.kind === kind);


/**
 * A verdict over a list of offending entries — console errors, failed requests.
 *
 * `equals: true` is the readable way to write "none" and is translated into the count it means, so
 * the two spellings cannot drift apart and `atMost` has exactly one definition. `equals: false` is
 * refused: "the application must log an error" is not a criterion this family states, and accepting
 * it would put a sentence in a contract that no reader interprets as its author did.
 */
function judgeOffenders(
  validator: string,
  subject: string,
  unit: string,
  offenders: readonly string[],
  raw: Readonly<Record<string, unknown>>,
): AssertionResult {
  const stated = statedComparisons(raw);
  if (stated.length === 0) {
    return unusable(validator, null, `The expectation on ${subject} states no comparison.`);
  }
  const found =
    offenders.length === 0
      ? "none"
      : `${offenders.length} ${plural(unit, offenders.length)}: ${brief(offenders)}`;

  for (const key of stated) {
    const expected = raw[key];
    let holds: boolean;
    let phrase: string;
    if (key === "equals") {
      if (expected !== true) {
        return unusable(
          validator,
          null,
          `"equals" on ${subject} wants true (none). Assert "atMost: n" to allow a tolerated number ` +
            `instead; it received ${describe(expected)}.`,
        );
      }
      holds = offenders.length === 0;
      phrase = `to have no ${plural(unit, 2)}`;
    } else if (key === "atMost") {
      if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) {
        return unusable(
          validator,
          null,
          `"atMost" on ${subject} wants a whole number of ${plural(unit, 2)}; it received ` +
            `${describe(expected)}.`,
        );
      }
      holds = offenders.length <= expected;
      phrase = `to have at most ${expected} ${plural(unit, expected)}`;
    } else {
      return unusable(validator, null, notDeclaredMessage(key, "equals and atMost"));
    }
    if (!holds) {
      return assertion(
        validator,
        null,
        "FAIL",
        offenders,
        expected,
        `Expected ${subject} ${phrase}, but it had ${found}.`,
      );
    }
  }
  return assertion(validator, null, "PASS", offenders, expectedOf(raw, stated), null);
}

// ---- the family ----------------------------------------------------------------------------------

const element: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.element,
  needsTarget: true,
  comparisons: ["equals"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, element.name, null);
    if (isAssertion(document)) return document;
    const selector = typeof raw["target"] === "string" ? raw["target"] : null;
    const reading = readTarget(observation, document, element.name, selector);
    if (isAssertion(reading)) return reading;
    return judge(
      element.name,
      selector,
      `the element ${selector === null ? "named by the criterion" : quote(selector)}`,
      reading.found,
      raw,
      comparePresence,
    );
  },
};

const visible: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.visible,
  needsTarget: true,
  comparisons: ["equals"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, visible.name, null);
    if (isAssertion(document)) return document;
    const selector = typeof raw["target"] === "string" ? raw["target"] : null;
    const reading = readTarget(observation, document, visible.name, selector);
    if (isAssertion(reading)) return reading;
    // An element that is not there is not visible, and that is a fact about the application rather
    // than a gap in the observation — which is why it is judged rather than reported as unanswered.
    const present = reading.found;
    return judge(
      visible.name,
      selector,
      `the element ${selector === null ? "named by the criterion" : quote(selector)}`,
      present && reading.visible,
      raw,
      compareTruth,
    );
  },
};

const text: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.text,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, text.name, null);
    if (isAssertion(document)) return document;
    const selector = typeof raw["target"] === "string" ? raw["target"] : null;
    const reading = readTarget(observation, document, text.name, selector);
    if (isAssertion(reading)) return reading;
    return judge(
      text.name,
      selector,
      `the text of ${selector === null ? "the element named by the criterion" : quote(selector)}`,
      // An absent element has no text, so `?? ""` reads as "the expected text is not on the page".
      // That fails every expectation that expects something — the most ordinary defect in the whole
      // catalogue — and passes `equals: ""`, which is also right: a banner that is not on the page
      // is not showing a message. Either way the answer comes from the application, not from a gap
      // in the observation, which is why it is judged rather than reported as unanswered.
      reading.text ?? "",
      raw,
      compareText,
    );
  },
};

const value: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.value,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, value.name, null);
    if (isAssertion(document)) return document;
    const selector = typeof raw["target"] === "string" ? raw["target"] : null;
    const reading = readTarget(observation, document, value.name, selector);
    if (isAssertion(reading)) return reading;
    if (reading.found && reading.value === null) {
      // A matched element with no `value` is a criterion aimed at a `<div>`: nobody can answer it,
      // and answering anyway would be a guess dressed up as a measurement.
      return unanswered(
        value.name,
        selector,
        `The element matching ${quote(String(selector))} carries no value, so there is nothing to ` +
          "compare. Only form controls have one.",
      );
    }
    return judge(
      value.name,
      selector,
      `the value of ${selector === null ? "the element named by the criterion" : quote(selector)}`,
      reading.value ?? "",
      raw,
      compareText,
    );
  },
};

const count: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.count,
  needsTarget: true,
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, count.name, null);
    if (isAssertion(document)) return document;
    const selector = typeof raw["target"] === "string" ? raw["target"] : null;
    const reading = readTarget(observation, document, count.name, selector);
    if (isAssertion(reading)) return reading;
    return judge(
      count.name,
      selector,
      `the number of elements matching ${selector === null ? "the criterion's selector" : quote(selector)}`,
      reading.count,
      raw,
      compareCounts,
    );
  },
};

const url: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.url,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, url.name, null);
    if (isAssertion(document)) return document;
    return judge(url.name, null, "the page URL", document.url, raw, compareText);
  },
};

const consoleClean: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.console,
  needsTarget: false,
  comparisons: ["equals", "atMost"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, consoleClean.name, null);
    if (isAssertion(document)) return document;
    if (!captured(observation, "console")) {
      // An empty console and an unwatched console produce the same array. Without the artifact there
      // is no way to tell them apart, and believing the empty one would be a false PASS.
      return unanswered(
        consoleClean.name,
        null,
        "The observation carries no `console` artifact, so a silent console cannot be told apart " +
          "from one nobody watched. Declare `console` in the criterion's evidence so the adapter is " +
          "asked to capture it.",
        document.console,
      );
    }
    const errors = document.console
      .filter((entry) => entry.level.toLowerCase() === "error")
      .map((entry) => describe(entry.text));
    return judgeOffenders(
      consoleClean.name,
      "the browser console",
      "console error",
      errors,
      raw,
    );
  },
};

const networkOk: Validator = {
  name: WEB_UI_VALIDATOR_NAMES.network,
  needsTarget: false,
  comparisons: ["equals", "atMost"],
  observationKind: WEB_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, networkOk.name, null);
    if (isAssertion(document)) return document;
    if (!captured(observation, "network")) {
      return unanswered(
        networkOk.name,
        null,
        "The observation carries no `network` artifact, so a page that made no failed requests " +
          "cannot be told apart from one nobody watched. Declare `network` in the criterion's " +
          "evidence so the adapter is asked to capture it.",
        document.network,
      );
    }
    const failed = document.network
      .filter((entry) => !entry.ok)
      .map((entry) =>
        entry.status === null
          ? `${entry.method} ${entry.url} got no response`
          : `${entry.method} ${entry.url} answered ${entry.status}`,
      );
    return judgeOffenders(networkOk.name, "the page's network traffic", "failed request", failed, raw);
  },
};

/** The whole family, in the order a reader would look for it. */
export const WEB_UI_VALIDATORS: readonly Validator[] = Object.freeze([
  element,
  visible,
  text,
  value,
  count,
  url,
  consoleClean,
  networkOk,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function webUiValidators(): Validator[] {
  return [...WEB_UI_VALIDATORS];
}
