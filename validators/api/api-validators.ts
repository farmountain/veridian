/**
 * The `api.*` validator family - the vocabulary an acceptance criterion uses to judge an HTTP service.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`ApiObservationData`) and never opens a socket, never starts a
 * process and never sees a client. That is why the vocabulary lives in
 * `core/environment/api-observation.ts` rather than beside the adapter: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know how the request was sent, cannot become
 * untestable the day the HTTP client changes, and can be re-read from a bundle a year later with no
 * server running and no network at all.
 *
 * ## The family, one question at a time
 *
 * Eight names, because eight different questions are asked of an exchange and each has a different
 * repair. Collapsing any two of them would report one defect where there are two:
 *
 * - `api.service` - *which* service produced this reading, asked of the reading itself.
 * - `api.exchange` - what request was made, and what came back, as an operator reads it.
 * - `api.status` - the status code alone. A `500` and a `200` are one comparison apart.
 * - `api.header` - one response header. A wrong `content-type` is not a wrong body.
 * - `api.body` - the body as text, for a response that is not JSON.
 * - `api.bytes` - the body's size, for a criterion that has to ask about size without reading it.
 * - `api.json` - one value inside a JSON body, walked by pointer.
 * - `api.log` - what the service itself wrote, which is how a `500` is diagnosed.
 *
 * ## The position, and why it is not the path
 *
 * Six of these name their subject by **position** - the first `call` step in the criterion is
 * position 1, the second is 2 - rather than by method and path. The decision is
 * `exchangeAt`'s, and it is not a convenience: a stateful service answers `GET /orders` twice with
 * two different results, which is the ordinary shape of a contract that adds an item and then asks
 * what the cart holds. A validator that looked its exchange up by path would compare against
 * whichever it found first and report a fact about neither. A criterion that made two requests says
 * which one it means by position, and a failure report quotes the position it read.
 *
 * ## Status discipline
 *
 * The same four branches as every other family, chosen so a wrong answer is never produced:
 *
 * - `PASS` - the comparison held and the exchange was actually recorded.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the service's behaviour*: a
 *   route that answered `404`, a body that lost a field, a header set to the wrong value.
 * - `INCONCLUSIVE` - nobody looked. The criterion made fewer requests than the position it named, so
 *   there is no exchange to read; a JSON pointer that walked into a key the body does not have; a
 *   query string the body never carried.
 * - `ERROR` - the *criterion* is unusable (a position that is not a number, a comparison that wants
 *   a number and got a word) or the world arrived unreadable. Never `TEST_FAILURE`: a typo in a
 *   contract is not a defect in the application.
 *
 * A response that never arrived is a `FAIL` on `api.status` and **not** an error, and the message
 * quotes the transport's own words. A `status: null` reading has no comparison that can hold, and
 * reporting it as `INCONCLUSIVE` would hide a service that died mid-run behind a criterion that
 * politely declined to judge it.
 */

import type { Observation } from "../../core/environment/types.ts";
import type { ApiExchange, ApiObservationData } from "../../core/environment/api-observation.ts";
import {
  API_OBSERVATION_KIND,
  describeJson,
  exchangeAt,
  isApiObservationData,
  jsonOf,
  pointerIn,
} from "../../core/environment/api-observation.ts";
import {
  assertion,
  brief,
  compareCounts,
  compareText,
  describe,
  expectedOf,
  judge,
  quote,
  statedComparisons,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { ComparisonOutcome } from "../../core/validation/assertions.ts";
import type { ComparisonKey } from "../../core/acceptance/plan.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * A criterion, a test and a failure report all spell these strings. Exporting the literal type of
 * each means a rename breaks the compiler instead of producing an acceptance contract that quietly
 * resolves to no validator at all.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `api.statusCode` would not merely be
 * unconventional - it is an acceptance contract that cannot be written at all.
 */
export const API_VALIDATOR_NAMES = {
  service: "api.service",
  exchange: "api.exchange",
  status: "api.status",
  header: "api.header",
  body: "api.body",
  bytes: "api.bytes",
  json: "api.json",
  log: "api.log",
} as const;

// ---- reading the document ------------------------------------------------------------------------

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): ApiObservationData | AssertionResult {
  if (isApiObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry an HTTP document, so ` +
      "there is nothing to read. The adapter produced the measurement, so this is a defect in the " +
      "environment rather than a criterion the service failed.",
    "ENVIRONMENT_FAILURE",
  );
}

/**
 * Whether a helper returned a verdict instead of the value it was asked for.
 *
 * **It keys on `validator`, not on `status`.** The first version tested `"status" in value`, which is
 * true of *every* `ApiExchange` - an exchange's `status` is the HTTP status code - so each exchange
 * was misread as an `AssertionResult` and returned straight out of `validate`, and the family's whole
 * roster reported the *exchange* as its verdict: a status of `200` where a criterion status was
 * expected, and no message at all. The web and database families get away with a `status` test
 * because neither of their readings has such a field; this one does, and it is the field the reader
 * came for.
 *
 * The rule the fix encodes: **a discriminator has to key on a field the other shape cannot have.**
 * `AssertionResult` always carries the name of the validator that answered; nothing a validator here
 * returns carries one.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { validator?: unknown }).validator === "string" &&
  "status" in value;

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

// ---- the position grammar ------------------------------------------------------------------------

/**
 * A request, named by its position among the criterion's `call` steps.
 *
 * 1-based, because a failure report is read by a person counting the calls in the criterion they
 * wrote, and because every other criterion id, step and expectation in this product is indexed from
 * one. The exchange list itself is 0-based - that is `exchangeAt`'s arithmetic - and the conversion
 * happens here, once, with the place it happens named.
 */
function exchangeNamed(
  validator: string,
  document: ApiObservationData,
  position: number,
): ApiExchange | AssertionResult {
  if (document.exchanges.length === 0) {
    return unanswered(
      validator,
      String(position),
      "The observation carries no exchanges at all, so there is nothing to read. An exchange is " +
        "recorded when the criterion's own `call` step is sent, so a criterion that only observed " +
        "put no request to this service and cannot be answered by one.",
    );
  }
  const exchange = exchangeAt(document, position - 1);
  if (exchange === null) {
    return unanswered(
      validator,
      String(position),
      `The criterion made ${String(document.exchanges.length)} ` +
        `${document.exchanges.length === 1 ? "request" : "requests"} and this expectation names ` +
        `request ${String(position)}, so there is no answer to read. The requests it did make were ` +
        `${brief(document.exchanges.map((entry) => `${entry.method} ${entry.path}`))}.`,
    );
  }
  return exchange;
}

/**
 * A request's position, on its own - which is what most of this family names its subject by.
 *
 * Refusing a non-number here rather than coercing it is the same decision the database family makes
 * about `table.column`: `Number("second")` is `NaN`, and a criterion judged against `NaN` would
 * report a comparison that can never hold as though the service had failed it.
 */
function positionOnly(validator: string, target: string | null, what: string): number | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const position = Number(target);
  if (!Number.isInteger(position) || position < 1) {
    return unusable(
      validator,
      target,
      `A request is named by its position among the criterion's \`call\` steps - 1 for the first, 2 ` +
        `for the second - and this target reads ${quote(target)}. A position that is not a whole ` +
        "number cannot be looked up, and a criterion judged against one would report a comparison " +
        "that can never hold as though the service had failed it.",
    );
  }
  return position;
}

/**
 * A position and a header name, as `<position>:<header-name>`.
 *
 * Colon-separated rather than nested, so a failure report can quote one token - the same reasoning
 * the provider family's `principal/svc-cart:s3.getObject:object/key` reference gives. Split at the
 * **first** colon, because a header name never contains one and the position always comes first.
 */
function headerRefIn(
  validator: string,
  target: string | null,
): { readonly position: number; readonly name: string } | AssertionResult {
  if (target === null) return noTarget(validator, "a response header, as `<request>:<header-name>`");
  const split = target.indexOf(":");
  if (split <= 0 || split === target.length - 1) {
    return unusable(
      validator,
      target,
      `A header is named as \`<request>:<header-name>\` - \`1:content-type\` is the first request's ` +
        `content type - and this target reads ${quote(target)}. The request is part of the name on ` +
        "purpose: a criterion that named only the header would be judged against whichever response " +
        "happened to carry one.",
    );
  }
  const position = Number(target.slice(0, split));
  if (!Number.isInteger(position) || position < 1) {
    return unusable(
      validator,
      target,
      `The request is named by its position among the criterion's \`call\` steps and this target ` +
        `begins with ${quote(target.slice(0, split))}, which is not a whole number.`,
    );
  }
  return { position, name: target.slice(split + 1) };
}

// ---- the rendering a failure report quotes -------------------------------------------------------

/**
 * One exchange as an operator reads it.
 *
 * Three lines, and the shape is the point: a status is a verdict, and the request that produced it
 * and the size of the answer are the evidence. A criterion writes `contains: "status 200"` against
 * this rendering and gets a failure message quoting all three - which is what makes a `404` on the
 * wrong address readable without opening the bundle.
 *
 * A request that was never answered renders `no response` and the transport's own words rather than
 * a status of zero, on the rule `api-observation.ts` states: a request that never reached a server
 * has no code, and `0` would make "the connection was refused" indistinguishable from "the service
 * answered with a code nobody recognizes".
 */
export function renderExchange(exchange: ApiExchange): string {
  const outcome =
    exchange.status === null
      ? `no response${exchange.error === null ? "" : ` (${exchange.error})`}`
      : `${String(exchange.status)}`;
  return [
    `${exchange.method} ${exchange.path} -> ${exchange.url}`,
    `  status ${outcome}`,
    `  bytes ${String(exchange.bodyBytes)}`,
  ].join("\n");
}

/** The whole set, in order, for a validator that judges the criterion's traffic as one fact. */
export function renderExchanges(document: ApiObservationData): string {
  return document.exchanges.map(renderExchange).join("\n");
}

/**
 * One JSON value against one comparison.
 *
 * A local copy of the database family's `judgeCell` decision, and for the same reason: which
 * comparison applies is a property of the **value**, not of the criterion. A number is ordered
 * (`atLeast` / `atMost`) and text is searched (`contains` / `matches`), and rendering everything to
 * a string first was rejected in that family for a reason that holds identically here - it turns
 * `equals: 3` against a number into a silent failure and `equals: "3"` into a silent success.
 *
 * `null` is a value rather than a gap: `equals: null` asks whether the key holds JSON null, and it is
 * answered directly. Any *other* comparison against a null is a real failure about the body, phrased
 * the way the comparison would have been phrased so the report reads `Expected ... to be at least 1,
 * but it is null` rather than something a reader has to decode.
 */
function phraseFor(key: ComparisonKey, expected: unknown): string {
  if (typeof expected === "number") {
    if (key === "atLeast") return `to be at least ${String(expected)}`;
    if (key === "atMost") return `to be at most ${String(expected)}`;
  }
  if (typeof expected === "string") {
    if (key === "contains") return `to contain ${describe(expected)}`;
    if (key === "matches") return `to match /${expected}/`;
  }
  return `to equal ${describe(expected)}`;
}

function compareValue(
  key: ComparisonKey,
  actual: unknown,
  expected: unknown,
): ComparisonOutcome {
  if (expected === null) {
    if (key !== "equals") {
      return {
        kind: "unusable",
        message:
          `"${key}" needs something to compare with, and it received null. Only "equals" can ask ` +
          "whether a key holds JSON null.",
      };
    }
    return { kind: "judged", holds: actual === null, phrase: "to be JSON null" };
  }
  if (actual === null) return { kind: "judged", holds: false, phrase: phraseFor(key, expected) };
  if (typeof actual === "number") return compareCounts(key, actual, expected);
  if (typeof actual === "boolean") {
    if (key !== "equals") {
      return {
        kind: "unusable",
        message:
          `"${key}" is a comparison about ${typeof actual} values and cannot be applied to a ` +
          "boolean. A boolean holds its own name; there is nothing to search or to order.",
      };
    }
    return { kind: "judged", holds: actual === expected, phrase: `to be ${String(actual)}` };
  }
  if (typeof actual === "string") return compareText(key, actual, expected);
  // An object or an array. `contains` and `matches` would be a substring test over a rendering
  // nobody agreed to, so they are refused here rather than answered with one.
  if (key !== "equals") {
    return {
      kind: "unusable",
      message:
        `The key holds ${describeJson(actual)}, so "${key}" has nothing to search. A criterion ` +
        "asking about a subtree states a pointer into it, and one asking for the whole subtree " +
        "writes it as JSON in `equals`.",
    };
  }
  return {
    kind: "judged",
    holds: JSON.stringify(actual) === JSON.stringify(expected),
    phrase: `to equal ${expected === undefined ? "undefined" : JSON.stringify(expected)}`,
  };
}

/**
 * The verdict for one JSON value against every comparison the author stated.
 *
 * A local copy of `judge` rather than a call to it, because `judge` constrains the actual to
 * `Scalar` and a JSON value can legitimately be `null`, an array or an object. Widening `Scalar`
 * instead would have loosened every web validator's comparator to accept a shape it has no reading
 * for - a vocabulary change made for one family's benefit and paid for by all of them.
 */
function judgeValue(
  validator: string,
  target: string,
  subject: string,
  actual: unknown,
  raw: Readonly<Record<string, unknown>>,
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
    const outcome = compareValue(key, actual, expected);
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

// ---- 1. which service, and what was asked --------------------------------------------------------

const service: Validator = {
  name: API_VALIDATOR_NAMES.service,
  needsTarget: false,
  comparisons: ["equals"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, service.name, null);
    if (isAssertion(document)) return document;
    // The reading's own subject, which the document declared rather than the adapter derived. A
    // criterion asking this question is asking whether the bundle in front of it describes the
    // service it meant, and that is a question about the reading and not about the traffic.
    return judge(
      service.name,
      document.service,
      `the service this reading names`,
      document.service,
      raw,
      compareText,
    );
  },
};

const exchange: Validator = {
  name: API_VALIDATOR_NAMES.exchange,
  needsTarget: true,
  targetNoun: "request position, counted from 1 (`2` is the criterion's second `call`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, exchange.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const position = positionOnly(exchange.name, targetOf(raw), "a request position");
    if (isAssertion(position)) return position;
    const found = exchangeNamed(exchange.name, document, position);
    if (isAssertion(found)) return found;
    return judge(
      exchange.name,
      String(position),
      `request ${String(position)} of this criterion`,
      renderExchange(found),
      raw,
      compareText,
    );
  },
};

// ---- 2. what came back ---------------------------------------------------------------------------

const status: Validator = {
  name: API_VALIDATOR_NAMES.status,
  needsTarget: true,
  targetNoun: "request position, counted from 1 (`2` is the criterion's second `call`)",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, status.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const position = positionOnly(status.name, targetOf(raw), "a request position");
    if (isAssertion(position)) return position;
    const found = exchangeNamed(status.name, document, position);
    if (isAssertion(found)) return found;

    // A response that never arrived is a failure of the comparison, not a question left unanswered.
    // The alternative - `INCONCLUSIVE` - would let a service that died mid-run be reported as a
    // criterion nobody could judge, which is the one shape this product exists to refuse.
    if (found.status === null) {
      return assertion(
        status.name,
        String(position),
        "FAIL",
        null,
        expectedOf(raw, statedComparisons(raw)),
        `Request ${String(position)} (${found.method} ${found.path}) was answered by nothing: ` +
          `${found.error === null ? "no response arrived and the world recorded no reason" : found.error}. ` +
          "A request with no answer has no status code, so every comparison against one is false - " +
          "and if the service was expected to be up, that is a defect in the application.",
      );
    }
    return judge(
      status.name,
      String(position),
      `the status request ${String(position)} was answered with`,
      found.status,
      raw,
      compareCounts,
    );
  },
};

const header: Validator = {
  name: API_VALIDATOR_NAMES.header,
  needsTarget: true,
  targetNoun: "a response header, as `<request>:<header-name>` (`1:content-type`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, header.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = headerRefIn(header.name, targetOf(raw));
    if (isAssertion(ref)) return ref;
    const found = exchangeNamed(header.name, document, ref.position);
    if (isAssertion(found)) return found;

    const spelling = `${String(ref.position)}:${ref.name.toLowerCase()}`;
    const value = found.headers[ref.name.toLowerCase()];
    if (value === undefined) {
      const present = Object.keys(found.headers);
      return unanswered(
        header.name,
        spelling,
        `Request ${String(ref.position)} was answered without a ${quote(ref.name)} header; it ` +
          `carried ${present.length === 0 ? "none at all" : brief(present.sort())}. A header the ` +
          "service never sent was never read, so this is not a comparison that failed.",
      );
    }
    return judge(
      header.name,
      spelling,
      `the ${ref.name} header of request ${String(ref.position)}`,
      value,
      raw,
      compareText,
    );
  },
};

// ---- 3. the body ---------------------------------------------------------------------------------

const body: Validator = {
  name: API_VALIDATOR_NAMES.body,
  needsTarget: true,
  targetNoun: "request position, counted from 1 (`2` is the criterion's second `call`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, body.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const position = positionOnly(body.name, targetOf(raw), "a request position");
    if (isAssertion(position)) return position;
    const found = exchangeNamed(body.name, document, position);
    if (isAssertion(found)) return found;
    // The empty string is a body that was sent and holds nothing - a different fact from a body that
    // was not read, which cannot arise here because the adapter always reads one. `equals: ""` is how
    // a contract states "this response has no body".
    return judge(
      body.name,
      String(position),
      `the body request ${String(position)} was answered with`,
      found.body,
      raw,
      compareText,
    );
  },
};

const bytes: Validator = {
  name: API_VALIDATOR_NAMES.bytes,
  needsTarget: true,
  targetNoun: "request position, counted from 1 (`2` is the criterion's second `call`)",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, bytes.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const position = positionOnly(bytes.name, targetOf(raw), "a request position");
    if (isAssertion(position)) return position;
    const found = exchangeNamed(bytes.name, document, position);
    if (isAssertion(found)) return found;
    // The size alone, so a criterion can ask about it without reading a body it may not be able to
    // quote - and so a body that grew by one byte is reported as a size change rather than as a text
    // difference a reader has to diff by eye.
    return judge(
      bytes.name,
      String(position),
      `the number of bytes request ${String(position)} was answered with`,
      found.bodyBytes,
      raw,
      compareCounts,
    );
  },
};

const json: Validator = {
  name: API_VALIDATOR_NAMES.json,
  needsTarget: true,
  // Every comparison, because which one applies is a property of the value the pointer reached. A
  // key that cannot apply is refused at judging time with a message naming the reason.
  comparisons: ["equals", "contains", "matches", "atLeast", "atMost"],
  targetNoun: "a pointer into a response body, as `<request>/<pointer>` (`2/items/0/name`)",
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, json.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(json.name, "a pointer into a response body, as `<request>/<pointer>`");
    }
    const slash = target.indexOf("/");
    const head = slash === -1 ? target : target.slice(0, slash);
    const pointer = slash === -1 ? "" : target.slice(slash + 1);
    const position = Number(head);
    if (!Number.isInteger(position) || position < 1) {
      return unusable(
        json.name,
        target,
        `A JSON value is named as \`<request>/<pointer>\` - \`2/items/0/name\` is the name of the ` +
          `first item of the second request's body - and this target begins with ${quote(head)}, ` +
          "which is not the position of a request. The pointer alone would be judged against " +
          "whichever response happened to have such a key.",
      );
    }
    const found = exchangeNamed(json.name, document, position);
    if (isAssertion(found)) return found;

    const parsed = jsonOf(found);
    if (!parsed.ok) {
      // A body that is not JSON is a fact about the *response*, not a hole in the criterion, and it
      // is answered as such: the comparison could not be made, and the reason names the parse.
      return unanswered(
        json.name,
        target,
        `The answer to request ${String(position)} could not be read as JSON, so there is no value ` +
          `at ${pointer === "" ? "the document root" : quote(pointer)} to compare: ${parsed.message}.`,
      );
    }
    if (pointer === "") {
      return judgeValue(
        json.name,
        target,
        `the body request ${String(position)} was answered with`,
        parsed.value,
        raw,
      );
    }
    const walked = pointerIn(parsed.value, pointer);
    if (!walked.ok) {
      return unanswered(json.name, target, `The answer to request ${String(position)}: ${walked.message}.`);
    }
    return judgeValue(
      json.name,
      target,
      `${quote(pointer)} in the answer to request ${String(position)}`,
      walked.value,
      raw,
    );
  },
};

// ---- 4. what the service itself said --------------------------------------------------------------

const LOG_SOURCES = ["stdout", "stderr"] as const;

const log: Validator = {
  name: API_VALIDATOR_NAMES.log,
  needsTarget: true,
  targetNoun: "a stream the service wrote to (`stdout`, `stderr`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: API_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, log.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const source = targetOf(raw);
    if (source === null) return noTarget(log.name, `a stream the service wrote to (${LOG_SOURCES.join(", ")})`);
    if (!(LOG_SOURCES as readonly string[]).includes(source)) {
      return unusable(
        log.name,
        source,
        `${quote(source)} is not a stream this reading records. A stream is one of ` +
          `${LOG_SOURCES.join(", ")}, and a naming mistake would otherwise be reported as a service ` +
          "that said nothing, which is the shape of a real defect rather than the shape of a " +
          "contract that cannot be read.",
      );
    }
    // What the service wrote, which is how a 500 is diagnosed: a status says an answer was wrong,
    // and the line the service logged beside it says why. Bounded by the adapter, because a service
    // logging a line per request would otherwise put a megabyte into every bundle.
    const text = source === "stdout" ? document.application.stdout : document.application.stderr;
    return judge(
      log.name,
      source,
      `what the service wrote to ${source}`,
      text,
      raw,
      compareText,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const API_VALIDATORS: readonly Validator[] = Object.freeze([
  service,
  exchange,
  status,
  header,
  body,
  bytes,
  json,
  log,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function apiValidators(): Validator[] {
  return [...API_VALIDATORS];
}
