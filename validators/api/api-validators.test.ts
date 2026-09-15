import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_OBSERVATION_KIND } from "../../core/environment/api-observation.ts";
import type {
  ApiExchange,
  ApiObservationData,
} from "../../core/environment/api-observation.ts";
import { DB_OBSERVATION_KIND } from "../../core/environment/db-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry, evaluateCriterion } from "../../core/validation/registry.ts";
import type { AssertionResult, CriterionSpec } from "../../core/validation/types.ts";
import { API_VALIDATORS, API_VALIDATOR_NAMES, apiValidators } from "./api-validators.ts";

/**
 * The `api.*` family, proven offline against literal documents.
 *
 * A validator here never opens a socket - it reads an `ApiObservationData` - so handing it one
 * written by hand is the *only* way to reach the branches that matter without a server, a port or a
 * client. The `local-api` demo proves the adapter produces such a document; nothing else proves the
 * family judges one correctly, which is why this file exists at all.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - an unreadable document,
 *    a position the criterion never reached, a header the service never sent, a key the body does
 *    not have, a body that is not JSON - is asserted to be `INCONCLUSIVE` or `ERROR`, never `PASS`.
 *  - **A defect is a `FAIL`.** A `404` on the wrong route, a body that lost a field, a header set to
 *    the wrong value, and a response that never arrived are the shapes a broken service actually
 *    takes.
 *  - **The distinction that makes the repairs different.** "The exchange was never made" and "the
 *    response had no such header" and "the value is wrong" are three facts with three repairs, and a
 *    validator that collapsed any two of them would send an agent at the wrong file.
 */

const registry = new ValidatorRegistry(apiValidators());

const exchange = (overrides: Partial<ApiExchange> = {}): ApiExchange => ({
  method: "GET",
  path: "/orders",
  url: "http://127.0.0.1:4180/orders",
  requestBody: null,
  status: 200,
  headers: { "content-type": "application/json" },
  body: '{"items":[{"name":"widget","qty":2}],"total":3}',
  bodyBytes: 44,
  error: null,
  ...overrides,
});

const document = (overrides: Partial<ApiObservationData> = {}): ApiObservationData => ({
  service: "cart-api",
  baseUrl: "http://127.0.0.1:4180/",
  exchanges: [exchange()],
  application: {
    exited: false,
    code: null,
    stdout: "cart-api listening on 4180\n",
    stderr: "",
  },
  ...overrides,
});

const observed = (data: unknown, kind: string = API_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "local-api:examples/local-api",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/**
 * A document from the *other* world, typed as that world's to keep it honest.
 *
 * Annotated rather than written inline so that a change to `WebObservationData` breaks this file
 * instead of quietly turning the fixture into something no adapter would ever emit - at which point
 * the test would be asserting that a nonsense object is not an API document, which nothing needed
 * proving.
 */
const webDocument: WebObservationData = {
  url: "http://127.0.0.1:4173/",
  title: "Shopping Cart",
  targets: {},
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
};

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point, not the criterion's: it deliberately bypasses the
 * observation-kind check so that the family's own status discipline is what is under test.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

/**
 * The assertion one expectation earns **through the criterion seam**, which is the path the product
 * actually takes.
 *
 * `judge` above bypasses the registry's per-expectation guards on purpose - it exists to test the
 * family's own status discipline in isolation, with nothing between it and the validator. That makes
 * it the wrong entry point for a question about a *guard*: the declared-comparison check lives in
 * `evaluateCriterion`, beside the check for an unregistered name, because that loop is the one seam
 * every family passes through. A test calling `validate` directly would then be asserting the
 * absence of a verdict the product never reaches that way.
 */
const refused = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
): AssertionResult => {
  const first = evaluate([raw], observation).assertions[0];
  assert.ok(first, "the criterion produced no assertion at all");
  return first;
};

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...fields });

/**
 * The descriptor for one validator, read through the registry rather than off the frozen array.
 *
 * The registry is the thing the product consults, so a fact asserted about a descriptor here is a
 * fact asserted about the vocabulary a contract is judged against - not about an object a test
 * built.
 */
const described = (name: string) => {
  const found = registry.descriptors().find((descriptor) => descriptor.name === name);
  assert.ok(found, `${name} is not registered at all`);
  return found;
};

const expect = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = judge(raw, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${String(raw["validator"])}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

const spec = (
  expect_: readonly Readonly<Record<string, unknown>>[],
  evidence: readonly string[] = [],
): CriterionSpec => ({
  id: "AC-001",
  description: "the service answers its own readiness route",
  mandatory: true,
  evidence,
  steps: [],
  expect: expect_,
});

const evaluate = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  observation: Observation,
  evidence: readonly string[] = [],
) =>
  evaluateCriterion(spec(expectations, evidence), observation, {
    registry,
    runId: observation.runId,
    environmentId: observation.environmentId,
    timestamp: observation.capturedAt,
  });

// ---- the family describes itself ------------------------------------------------------------------

describe("the API validator family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the eight it has", () => {
    assert.deepEqual(registry.names(), Object.values(API_VALIDATOR_NAMES).sort());
    // Spelled out as well as derived, because a list built only from the thing it checks can never
    // disagree with it - and the eight are the vocabulary a contract author reads.
    assert.deepEqual(registry.names(), [
      "api.body",
      "api.bytes",
      "api.exchange",
      "api.header",
      "api.json",
      "api.log",
      "api.service",
      "api.status",
    ]);
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    for (const name of registry.names()) {
      assert.match(
        name,
        /^[a-z0-9]+(\.[a-z0-9]+)+$/,
        `${name} cannot be written in an acceptance contract at all - the schema matches validator names against this pattern`,
      );
    }
  });

  it("reads the API observation kind, and never the web or database one", () => {
    for (const name of registry.names()) {
      assert.equal(described(name).observationKind, API_OBSERVATION_KIND);
    }
    assert.notEqual(API_OBSERVATION_KIND, WEB_OBSERVATION_KIND);
    assert.notEqual(API_OBSERVATION_KIND, DB_OBSERVATION_KIND);
  });

  it("declares no comparison key the acceptance vocabulary does not have", () => {
    const declared = new Set(["equals", "contains", "matches", "atLeast", "atMost"]);
    for (const name of registry.names()) {
      for (const key of described(name).comparisons) {
        assert.ok(declared.has(key), `${name} declares \`${key}\`, which no plan can carry`);
      }
    }
  });

  it("says which noun its target names, so the ladder asks a question with an answer", () => {
    for (const descriptor of registry.descriptors()) {
      if (!descriptor.needsTarget) continue;
      assert.equal(
        typeof descriptor.targetNoun,
        "string",
        `${descriptor.name} needs a target and names no noun, so the ladder would ask "which element"`,
      );
      assert.ok(
        String(descriptor.targetNoun).length > 0,
        `${descriptor.name} names an empty noun`,
      );
    }
  });

  it("only asks for a target where a target is the question", () => {
    // `api.service` asks about the reading itself, so there is no second subject for it to name. A
    // target on it would be a value the criterion supplies and the validator ignores.
    assert.equal(described(API_VALIDATOR_NAMES.service).needsTarget, false);
    for (const name of registry.names()) {
      if (name === API_VALIDATOR_NAMES.service) continue;
      assert.equal(described(name).needsTarget, true, `${name} names its subject and says it does not`);
    }
  });

  it("hands out a fresh array so a registry cannot reorder the family", () => {
    const first = apiValidators();
    first.reverse();
    assert.deepEqual(
      apiValidators().map((validator) => validator.name),
      API_VALIDATORS.map((validator) => validator.name),
    );
  });
});

// ---- an unreadable observation is never a judgement -----------------------------------------------

describe("an unreadable observation is never a judgement", () => {
  it("errors, naming the environment rather than the service, for a document it cannot read", () => {
    for (const name of registry.names()) {
      const result = judge(
        expectation(name, { target: "1", equals: 1 }),
        observed({ service: "cart-api" }),
      );
      assert.equal(result.status, "ERROR", `${name} judged a document it could not read`);
      assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
      assert.match(String(result.message), /does not carry an HTTP document/);
    }
  });

  it("reads a well-formed document without complaint, so the check above is not vacuous", () => {
    const result = judge(
      expectation(API_VALIDATOR_NAMES.service, { equals: "cart-api" }),
      observed(document()),
    );
    assert.equal(result.status, "PASS");
  });

  it("does not mistake the other families' documents for its own", () => {
    for (const name of registry.names()) {
      const result = judge(
        expectation(name, { target: "1", equals: 1 }),
        observed(webDocument, WEB_OBSERVATION_KIND),
      );
      assert.equal(result.status, "ERROR", `${name} claimed a web document`);
    }
  });
});

// ---- 1. which service ---------------------------------------------------------------------------

describe("api.service asks whether this reading is about the service the criterion meant", () => {
  it("passes when the reading names the service the criterion expects", () => {
    expect(expectation(API_VALIDATOR_NAMES.service, { equals: "cart-api" }), observed(document()), "PASS");
  });

  it("fails, naming both services, when a bundle describes a different one", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.service, { equals: "orders-api" }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /cart-api/);
  });

  it("refuses a comparison other than equals, because an identity is not searched", () => {
    const result = refused(expectation(API_VALIDATOR_NAMES.service, { atLeast: 1 }), observed(document()));
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /does not answer/);
    assert.match(String(result.message), /`equals`/);
    assert.match(String(result.message), /`atLeast`/);
  });

  it("declares only `equals`, so a contract cannot search an identity either way", () => {
    assert.deepEqual([...described(API_VALIDATOR_NAMES.service).comparisons], ["equals"]);
  });
});

// ---- 2. what was asked, and what came back --------------------------------------------------------

describe("api.exchange renders the request and its answer the way an operator reads it", () => {
  it("passes for a rendering that contains the status line", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "1", contains: "status 200" }),
      observed(document()),
      "PASS",
    );
  });

  it("quotes the address as well as the path, because the two can differ", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "1", contains: "http://127.0.0.1:4180/orders" }),
      observed(document()),
      "PASS",
    );
    assert.equal(
      result.actual,
      [
        "GET /orders -> http://127.0.0.1:4180/orders",
        "  status 200",
        "  bytes 44",
      ].join("\n"),
      "the rendering is one string an operator reads top to bottom, not a list of lines",
    );
  });

  it("renders a request that was never answered as a fact rather than as a status of zero", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "1", contains: "no response (ECONNREFUSED)" }),
      observed(
        document({
          exchanges: [exchange({ status: null, headers: {}, body: "", bodyBytes: 0, error: "ECONNREFUSED" })],
        }),
      ),
      "PASS",
    );
    assert.match(String(result.actual), /no response \(ECONNREFUSED\)/);
    assert.doesNotMatch(String(result.actual), /status 0/);
  });

  it("reports the requests it did make when the position is past the last one", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "3", contains: "status" }),
      observed(document()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /GET \/orders/);
  });

  it("says there were no exchanges at all when the criterion made no call", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "1", contains: "status" }),
      observed(document({ exchanges: [] })),
      "INCONCLUSIVE",
      /carries no exchanges|`call` step/,
    );
  });

  it("refuses a position that is not a whole number", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "second", contains: "status" }),
      observed(document()),
      "ERROR",
      /not a whole number/,
    );
  });

  it("refuses a position counted from zero, because a report is read by a person counting from one", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.exchange, { target: "0", contains: "status" }),
      observed(document()),
      "ERROR",
      /not a whole number/,
    );
  });

  it("errors when the criterion names no request at all", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.exchange, { contains: "status" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
  });
});

// ---- 3. the status ------------------------------------------------------------------------------

describe("api.status reads the status code and nothing else", () => {
  it("passes on the expected code and fails on any other", () => {
    expect(expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }), observed(document()), "PASS");
    const failed = expect(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 201 }),
      observed(document()),
      "FAIL",
    );
    assert.equal(failed.actual, 200);
    assert.equal(failed.expected, 201);
  });

  it("orders a code with atLeast and atMost", () => {
    expect(expectation(API_VALIDATOR_NAMES.status, { target: "1", atLeast: 200 }), observed(document()), "PASS");
    expect(expectation(API_VALIDATOR_NAMES.status, { target: "1", atMost: 299 }), observed(document()), "PASS");
    expect(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", atLeast: 300 }),
      observed(document()),
      "FAIL",
    );
  });

  it("fails, quoting the transport's own words, when no response arrived", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }),
      observed(
        document({
          exchanges: [exchange({ status: null, headers: {}, body: "", bodyBytes: 0, error: "connect ECONNREFUSED 127.0.0.1:4180" })],
        }),
      ),
      "FAIL",
      /ECONNREFUSED/,
    );
    // Not INCONCLUSIVE: the criterion put a request and nothing answered it, which is a fact about
    // the service rather than a question the world declined to ask.
    assert.equal(result.actual, null);
  });

  it("says so plainly when the world recorded no reason for the silence", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }),
      observed(document({ exchanges: [exchange({ status: null, error: null })] })),
      "FAIL",
      /recorded no reason/,
    );
  });

  it("refuses a status written as a string, which is a criterion defect and not a defect in the service", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: "200" }),
      observed(document()),
      "ERROR",
    );
  });

  it("refuses a text comparison, because a status is a number", () => {
    const result = refused(
      expectation(API_VALIDATOR_NAMES.status, { target: "1", contains: "20" }),
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /does not answer/);
    assert.match(String(result.message), /`contains`/);
  });
});

// ---- 4. one header ------------------------------------------------------------------------------

describe("api.header reads one response header of one request", () => {
  it("passes for a header the service sent", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "1:content-type", contains: "application/json" }),
      observed(document()),
      "PASS",
    );
  });

  it("finds a header whatever case the criterion wrote, because HTTP header names are case-insensitive", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "1:Content-Type", equals: "application/json" }),
      observed(document()),
      "PASS",
    );
  });

  it("reports a header the service never sent as unanswered, naming the ones it did", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "1:cache-control", contains: "max-age" }),
      observed(document()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /content-type/);
  });

  it("says `none at all` rather than listing nothing when the response carried no headers", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "1:content-type", contains: "json" }),
      observed(document({ exchanges: [exchange({ headers: {} })] })),
      "INCONCLUSIVE",
      /none at all/,
    );
  });

  it("refuses a bare header name, because which response is then unanswerable", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "content-type", contains: "json" }),
      observed(document()),
      "ERROR",
      /<request>:<header-name>/,
    );
  });

  it("refuses a name with no request in front of it", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: ":content-type", contains: "json" }),
      observed(document()),
      "ERROR",
      /<request>:<header-name>/,
    );
  });

  it("reads the header of the request the criterion names, not of the first one", () => {
    const second = exchange({
      method: "POST",
      path: "/orders",
      headers: { "content-type": "text/plain" },
    });
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "2:content-type", equals: "text/plain" }),
      observed(document({ exchanges: [exchange(), second] })),
      "PASS",
    );
    expect(
      expectation(API_VALIDATOR_NAMES.header, { target: "1:content-type", equals: "text/plain" }),
      observed(document({ exchanges: [exchange(), second] })),
      "FAIL",
    );
  });
});

// ---- 5. the body --------------------------------------------------------------------------------

describe("api.body reads the answer as text", () => {
  it("searches the body for a substring", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.body, { target: "1", contains: "\"total\":3" }),
      observed(document()),
      "PASS",
    );
  });

  it("matches the body against a pattern", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.body, { target: "1", matches: "^\\{\"items\"" }),
      observed(document()),
      "PASS",
    );
  });

  it("treats an empty body as a body that holds nothing, not as a body that was not read", () => {
    const empty = observed(document({ exchanges: [exchange({ body: "", bodyBytes: 0 })] }));
    expect(expectation(API_VALIDATOR_NAMES.body, { target: "1", equals: "" }), empty, "PASS");
    expect(expectation(API_VALIDATOR_NAMES.body, { target: "1", contains: "items" }), empty, "FAIL");
  });

  it("reports a body that lost a field as a failure about the body", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.body, { target: "1", contains: "discount" }),
      observed(document()),
      "FAIL",
    );
  });
});

// ---- 6. the size --------------------------------------------------------------------------------

describe("api.bytes reads the size without reading the body", () => {
  it("passes on the recorded size", () => {
    expect(expectation(API_VALIDATOR_NAMES.bytes, { target: "1", equals: 44 }), observed(document()), "PASS");
  });

  it("orders a size with atLeast and atMost", () => {
    expect(expectation(API_VALIDATOR_NAMES.bytes, { target: "1", atLeast: 1 }), observed(document()), "PASS");
    expect(expectation(API_VALIDATOR_NAMES.bytes, { target: "1", atMost: 44 }), observed(document()), "PASS");
    expect(expectation(API_VALIDATOR_NAMES.bytes, { target: "1", atLeast: 45 }), observed(document()), "FAIL");
  });

  it("refuses a text comparison, because a size is a number", () => {
    const result = refused(
      expectation(API_VALIDATOR_NAMES.bytes, { target: "1", contains: "4" }),
      observed(document()),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /does not answer/);
    assert.match(String(result.message), /`contains`/);
  });
});

// ---- 7. one value inside a JSON body --------------------------------------------------------------

describe("api.json walks a pointer into the parsed body", () => {
  it("passes for a value the pointer reaches", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: 3 }),
      observed(document()),
      "PASS",
    );
  });

  it("walks into an array by index", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items/0/name", equals: "widget" }),
      observed(document()),
      "PASS",
    );
  });

  it("orders a value that is a number", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items/0/qty", atLeast: 2 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items/0/qty", atMost: 1 }),
      observed(document()),
      "FAIL",
    );
  });

  it("searches a value that is text", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items/0/name", contains: "wid" }),
      observed(document()),
      "PASS",
    );
  });

  it("compares a value that is a boolean, and refuses to search one", () => {
    const withFlag = observed(
      document({ exchanges: [exchange({ body: '{"shipped":false}', bodyBytes: 16 })] }),
    );
    expect(expectation(API_VALIDATOR_NAMES.json, { target: "1/shipped", equals: false }), withFlag, "PASS");
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/shipped", contains: "fal" }),
      withFlag,
      "ERROR",
      /boolean/,
    );
  });

  it("reads a JSON null as the value it is, which `equals: null` can ask about and nothing else can", () => {
    const withNull = observed(document({ exchanges: [exchange({ body: '{"coupon":null}', bodyBytes: 15 })] }));
    expect(expectation(API_VALIDATOR_NAMES.json, { target: "1/coupon", equals: null }), withNull, "PASS");
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/coupon", atLeast: null }),
      withNull,
      "ERROR",
      /Only "equals"/,
    );
  });

  it("fails an ordered question about a key that holds null, because the service answered null", () => {
    // Not `ERROR`. The *value* is null and the *question* is `at least 1`: `null >= 1` has a definite
    // answer, and it is false, so this is a defect in the service rather than an unusable criterion.
    // Only a null on the *right-hand side* makes a question unanswerable - there is no `atLeast null`.
    const withNull = observed(document({ exchanges: [exchange({ body: '{"coupon":null}', bodyBytes: 15 })] }));
    const result = expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/coupon", atLeast: 1 }),
      withNull,
      "FAIL",
    );
    assert.match(String(result.message), /but it is null/);
  });

  it("fails an `equals: null` against a key that holds a value", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: null }),
      observed(document()),
      "FAIL",
      /JSON null/,
    );
  });

  it("compares a whole subtree as JSON rather than as a substring over a rendering", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items", equals: [{ name: "widget", qty: 2 }] }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items", contains: "widget" }),
      observed(document()),
      "ERROR",
      /nothing to search/,
    );
  });

  it("judges the whole body when the target names only a request", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1", equals: { items: [{ name: "widget", qty: 2 }], total: 3 } }),
      observed(document()),
      "PASS",
    );
  });

  it("reports a key the body does not have as unanswered, naming the key it looked for", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/discount", equals: 0 }),
      observed(document()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /discount/);
  });

  it("reports a walk into an array index that is not there, naming the array's length", () => {
    const result = expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/items/7/name", equals: "widget" }),
      observed(document()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /array of 1/);
  });

  it("reports a body that is not JSON as unanswered, quoting the parse", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: 3 }),
      observed(document({ exchanges: [exchange({ body: "<html>oops</html>", bodyBytes: 17 })] })),
      "INCONCLUSIVE",
      /not JSON/,
    );
  });

  it("reports an empty body as unanswered rather than as a missing key", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: 3 }),
      observed(document({ exchanges: [exchange({ body: "", bodyBytes: 0 })] })),
      "INCONCLUSIVE",
      /is empty/,
    );
  });

  it("refuses a target with no request position in front of the pointer", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "total", equals: 3 }),
      observed(document()),
      "ERROR",
      /not the position of a request/,
    );
  });

  it("requires every stated comparison to hold", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", atLeast: 1, atMost: 2 }),
      observed(document()),
      "FAIL",
    );
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total", atLeast: 1, atMost: 9 }),
      observed(document()),
      "PASS",
    );
  });

  it("errors when the expectation states no comparison", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.json, { target: "1/total" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 8. what the service said --------------------------------------------------------------------

describe("api.log reads the line the service wrote beside a wrong answer", () => {
  it("reads stdout and stderr as two different questions", () => {
    const withBoth = observed(
      document({
        application: { exited: false, code: null, stdout: "listening\n", stderr: "cache miss\n" },
      }),
    );
    expect(expectation(API_VALIDATOR_NAMES.log, { target: "stdout", contains: "listening" }), withBoth, "PASS");
    expect(expectation(API_VALIDATOR_NAMES.log, { target: "stderr", contains: "cache miss" }), withBoth, "PASS");
    expect(expectation(API_VALIDATOR_NAMES.log, { target: "stdout", contains: "cache miss" }), withBoth, "FAIL");
  });

  it("refuses a stream this reading does not record, rather than reporting a service that said nothing", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.log, { target: "syslog", contains: "cart" }),
      observed(document()),
      "ERROR",
      /not a stream this reading records/,
    );
  });

  it("errors when the criterion names no stream", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.log, { contains: "listening" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
  });

  it("fails for a service that never started, because the log is the evidence of why", () => {
    expect(
      expectation(API_VALIDATOR_NAMES.log, { target: "stderr", contains: "EADDRINUSE" }),
      observed(
        document({
          application: { exited: true, code: 1, stdout: "", stderr: "Error: listen EADDRINUSE\n" },
        }),
      ),
      "PASS",
    );
  });
});

// ---- the statuses stay apart ---------------------------------------------------------------------

describe("the statuses stay apart, because the repairs differ", () => {
  const traffic = (overrides: Partial<ApiExchange> = {}): Observation =>
    observed(document({ exchanges: [exchange(overrides)] }));

  it("fails a wrong value while reporting that the things never sent could not be read", () => {
    const wrongRoute = observed(
      document({
        exchanges: [exchange({ status: 404, body: "not found", bodyBytes: 9, headers: {} })],
      }),
    );
    assert.equal(judge(expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }), wrongRoute).status, "FAIL");
    assert.equal(
      judge(expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: 3 }), wrongRoute).status,
      "INCONCLUSIVE",
    );
  });

  it("distinguishes a missing header from a header with the wrong value", () => {
    assert.equal(
      judge(expectation(API_VALIDATOR_NAMES.header, { target: "1:cache-control", contains: "x" }), traffic()).status,
      "INCONCLUSIVE",
    );
    assert.equal(
      judge(expectation(API_VALIDATOR_NAMES.header, { target: "1:content-type", equals: "text/plain" }), traffic()).status,
      "FAIL",
    );
  });

  it("distinguishes an exchange that was never made from an exchange that went wrong", () => {
    assert.equal(
      judge(expectation(API_VALIDATOR_NAMES.status, { target: "2", equals: 200 }), traffic()).status,
      "INCONCLUSIVE",
    );
    assert.equal(
      judge(expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }), traffic({ status: 500 })).status,
      "FAIL",
    );
  });
});

// ---- M3: nothing that was not observed is reported as a pass --------------------------------------

describe("M3: nothing that was not observed is reported as a pass", () => {
  it("never passes a criterion whose required evidence is missing, even when the assertions passed", () => {
    const criterion = evaluate(
      [expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 })],
      observed(document()),
      ["screenshot"],
    );
    assert.notEqual(criterion.status, "PASS");
    assert.deepEqual(criterion.missingEvidence, ["screenshot"]);
  });

  it("passes through the same entry point when the evidence is the artifact the adapter writes", () => {
    const criterion = evaluate(
      [expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 })],
      observed(document()),
      ["json"],
    );
    assert.equal(criterion.status, "PASS");
  });

  it("never reports `PASS` for any of the shapes that could be mistaken for one", () => {
    const shapes: readonly (readonly [Readonly<Record<string, unknown>>, Observation])[] = [
      [expectation(API_VALIDATOR_NAMES.status, { target: "1", equals: 200 }), observed(document({ exchanges: [] }))],
      [expectation(API_VALIDATOR_NAMES.json, { target: "1/absent", equals: 1 }), observed(document())],
      [expectation(API_VALIDATOR_NAMES.json, { target: "1/total", equals: 3 }), observed(document({ exchanges: [exchange({ body: "nope", bodyBytes: 4 })] }))],
      [expectation(API_VALIDATOR_NAMES.header, { target: "1:x", equals: "1" }), observed(document())],
      [expectation(API_VALIDATOR_NAMES.service, { equals: "cart-api" }), observed({})],
      [expectation(API_VALIDATOR_NAMES.log, { target: "stdout", contains: "x" }), observed(document({ exchanges: [exchange({ status: null, error: "boom" })] }))],
    ];
    for (const [raw, observation] of shapes) {
      const name = String(raw["validator"]);
      const result = judge(raw, observation);
      assert.notEqual(result.status, "PASS", `${name} passed on a shape it did not observe`);
    }
  });
});
