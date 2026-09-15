/**
 * The vocabulary an API adapter and an API validator share.
 *
 * It lives here, beside `web-observation.ts`, `db-observation.ts` and the rest, for exactly the
 * reason that file gives: `validators/*` may not import `adapters/*`, so the document a validator
 * reads has to be declared in a layer neither of them owns. A validator that read the adapter's own
 * types would be untestable without a server running and would have to be rewritten the day the
 * client changed.
 *
 * ## Why this is not `web-observation.ts` with a different name
 *
 * A web reading describes *a page*: a document, a title, a set of located elements, a console. An API
 * reading describes *an exchange*: a method put to a service, the status it answered with, the
 * headers it returned and the bytes it sent back. The two are not the same shape and cannot be
 * judged by the same rules - `web.element` asks whether a selector matched something on a page, and
 * there is no page here to match against. Sharing one document would force every validator to
 * acknowledge fields its world cannot produce, which is how a vocabulary starts lying about what was
 * observed.
 *
 * ## What this file deliberately does not contain
 *
 * No client, no socket, no URL to construct. It is a *reading*: what the service answered when the
 * world put a request to it. Which client sent it and how the connection was opened are the
 * adapter's business, and a reader of a bundle a year later must be able to judge the exchange
 * without either.
 *
 * ## `status: null` is a fact, not a gap
 *
 * A request that never reached a server has no status code. Recording `0` - the habit from a
 * different ecosystem - would make "the connection was refused" indistinguishable from "the service
 * answered with a code we do not recognize", and those are different repairs: one is an environment
 * or startup defect, the other is a behaviour the application chose. `null` says "no response
 * arrived", and `error` says why the world believes so.
 */

/** Adapter-defined observation kind. Validators declare the kind they understand. */
export const API_OBSERVATION_KIND = "api.http";

/**
 * One request and its answer.
 *
 * The request is recorded beside the response on purpose. A reading that kept only the answer would
 * make "the endpoint returned 404" unreadable, because the first question a reader asks of a 404 is
 * *which* address had nothing there - and `path` as the criterion wrote it may differ from `url` as
 * the world resolved it, which is the difference between a typo in a contract and a defect in a
 * router.
 */
export interface ApiExchange {
  /** Upper case, one spelling, whatever case the document used - so a comparison is not case-typed. */
  readonly method: string;
  /** The path exactly as the criterion stated it, before resolution. */
  readonly path: string;
  /** The absolute address the request was actually sent to. */
  readonly url: string;
  /** The request body the criterion supplied, or `null` when it supplied none. */
  readonly requestBody: string | null;
  /** The status the service answered with, or `null` when no response arrived at all. */
  readonly status: number | null;
  /**
   * Response headers, lower-cased.
   *
   * Lower-cased because HTTP header names are case-insensitive and a reading that preserved the
   * wire's casing would make `content-type` and `Content-Type` two different questions with two
   * different answers about one header.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** The response body as text. `""` when the service sent none - which is not the same as absent. */
  readonly body: string;
  /** The body's length in bytes, recorded because a criterion may ask about size without reading it. */
  readonly bodyBytes: number;
  /** Why no response arrived, when none did. `null` when a response did. */
  readonly error: string | null;
}

/** The application's own process, so a failed request can be read against what the service said. */
export interface ApiProcessReading {
  /** Whether the process had exited by the moment of reading. */
  readonly exited: boolean;
  /** The exit code, when it exited. `null` while running, or when a signal ended it. */
  readonly code: number | null;
  /** Everything the process has written to stdout so far, bounded - a server log, not a transcript. */
  readonly stdout: string;
  /** Everything the process has written to stderr so far, bounded. */
  readonly stderr: string;
}

export interface ApiObservationData {
  /**
   * The service identity the readings name.
   *
   * A verdict from an API world is a claim about a *service*, and a bundle that could not say which
   * one it judged would be unable to tell two services apart. Free text rather than an enumeration:
   * a service name decides nothing a criterion can observe.
   */
  readonly service: string;
  /**
   * The base address every path in this reading was resolved against.
   *
   * Recorded rather than left implicit, because a path-only reading cannot be reproduced: the first
   * question asked of an API result is which host answered, and a bundle that omitted it would make
   * two services on two ports look like one.
   */
  readonly baseUrl: string;
  /** Every request this criterion made, in the order it made them. */
  readonly exchanges: readonly ApiExchange[];
  /** The application's process at the moment of reading, so a 500 can be read beside a stack trace. */
  readonly application: ApiProcessReading;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isExchange = (value: unknown): value is ApiExchange =>
  isRecord(value) &&
  typeof value["method"] === "string" &&
  typeof value["path"] === "string" &&
  typeof value["url"] === "string" &&
  (value["requestBody"] === null || typeof value["requestBody"] === "string") &&
  (value["status"] === null || typeof value["status"] === "number") &&
  isStringMap(value["headers"]) &&
  typeof value["body"] === "string" &&
  typeof value["bodyBytes"] === "number" &&
  (value["error"] === null || typeof value["error"] === "string");

const isProcess = (value: unknown): value is ApiProcessReading =>
  isRecord(value) &&
  typeof value["exited"] === "boolean" &&
  (value["code"] === null || typeof value["code"] === "number") &&
  typeof value["stdout"] === "string" &&
  typeof value["stderr"] === "string";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as an API document", and the answer is what decides between a
 * validator judging a world and a validator reporting that the world arrived unreadable. Those are
 * different verdicts with different repairs, so the question has to be asked structurally rather
 * than assumed from the observation's `kind`.
 */
export function isApiObservationData(value: unknown): value is ApiObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["service"] !== "string") return false;
  if (typeof value["baseUrl"] !== "string") return false;
  if (!Array.isArray(value["exchanges"]) || !value["exchanges"].every(isExchange)) return false;
  return isProcess(value["application"]);
}

/**
 * The exchange at an index, or `null` when the criterion made fewer requests than that.
 *
 * Index-based rather than matched on method and path, and that is the decision: an application that
 * answers `GET /orders` twice with different results - which a stateful service does routinely - has
 * two answers, and a validator that searched by path would compare against whichever it found first
 * and report a fact about neither. A criterion that made two requests says which one it means by
 * position, and the failure report quotes the position it read.
 */
export function exchangeAt(data: ApiObservationData, index: number): ApiExchange | null {
  return data.exchanges[index] ?? null;
}

/**
 * The body parsed as JSON, with "not JSON" told apart from "a JSON null".
 *
 * **The parse is derived here, from `body`, and is not a field of the reading.** The first version
 * of `ApiExchange` carried a `json: unknown` beside the body, and the adapter filled both - which
 * made the reading two representations of one fact, and nothing read the parsed one. A reading that
 * can disagree with itself is a wrong reading, and the disagreement is not hypothetical: the
 * validator family's own test fixtures set `json` without touching `body`, and every `api.json`
 * criterion in them was judged against a body that said something else. Removing the field costs a
 * bundle reader nothing - the body is right there in the artifact, verbatim, and this function
 * reproduces the parse exactly.
 *
 * `JSON.parse("null")` returns `null`, which is the same value a failed parse would have to return -
 * so the failing case carries a thrown error to distinguish them, and this function converts that
 * into a phrase a validator can put in a message rather than into a second `null` nobody can read.
 */
export function jsonOf(exchange: ApiExchange): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  const text = exchange.body.trim();
  if (text === "") return { ok: false, message: "the response body is empty, so it is not JSON" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: `the response body is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/**
 * The value at a slash-separated pointer inside a parsed JSON document.
 *
 * Written here rather than shared with `core/clarification`'s pointer helpers on purpose: those
 * escape a pointer for a *document index*, where `~1` stands for a literal `/` in a key and an
 * operator's answer is written to the path. This walks a response body, where a key may contain any
 * character at all and nothing is ever written back. Reusing the escaping would make `a/b` and `a~1b`
 * the same key in one of the two places, and the two are different keys in JSON.
 *
 * Each step returns the value it reached, so `0` and `false` and `""` are all found rather than read
 * as absent - the trap a truthiness check would set.
 */
export function pointerIn(
  document: unknown,
  pointer: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  const tokens = pointer
    .split("/")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { ok: false, message: `the pointer \`${pointer}\` names no key, so it selects the whole document` };
  }

  let cursor: unknown = document;
  const walked: string[] = [];
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return {
          ok: false,
          message: `\`${pointer}\` walks into an array of ${String(cursor.length)} at \`${walked.join("/")}\`, and \`${token}\` is not one of its indexes`,
        };
      }
      cursor = cursor[index];
    } else if (isRecord(cursor)) {
      if (!Object.hasOwn(cursor, token)) {
        return {
          ok: false,
          message: `\`${pointer}\` names \`${token}\`, and the document has no such key at \`${walked.length === 0 ? "<root>" : walked.join("/")}\``,
        };
      }
      cursor = cursor[token];
    } else {
      return {
        ok: false,
        message: `\`${pointer}\` walks into \`${walked.join("/")}\`, which holds ${describeJson(cursor)} rather than an object or an array`,
      };
    }
    walked.push(token);
  }
  return { ok: true, value: cursor };
}

/** A JSON value as a short phrase, for a message that quotes a key's neighbour. */
export function describeJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${String(value.length)}`;
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return `the string \`${value.length > 60 ? `${value.slice(0, 60)}...` : value}\``;
  return String(value);
}
