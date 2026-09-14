import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArtifactKind, Observation } from "../../core/environment/types.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type {
  WebObservationData,
  WebTargetObservation,
} from "../../core/environment/web-observation.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";
import type { AssertionResult } from "../../core/validation/types.ts";
import { WEB_UI_VALIDATORS, WEB_UI_VALIDATOR_NAMES, webUiValidators } from "./web-ui-validators.ts";

/**
 * The judging layer, proven offline against literal documents.
 *
 * §6.1 of the implementation plan puts this suite "against a fake `BrowserPort`". It is deliberately
 * one layer below that: a validator is handed an `Observation` and nothing else, so the seam worth
 * testing is the *document* — a `WebObservationData` written out by hand. Reaching for a port here
 * would re-test the adapter's reading code, which `tests/local-web-environment.test.ts` already
 * owns, and would make the status discipline below depend on a browser being mocked correctly.
 *
 * The properties under test are the ones this product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass — an unreadable document,
 *    a selector nobody looked at, a console nobody captured — is asserted to be `INCONCLUSIVE` or
 *    `ERROR`, never `PASS`.
 *  - **Defects are detected.** Every shape of "the application is wrong" is asserted to be `FAIL`,
 *    which is what the canonical demo's three deliberate defects have to surface as.
 *  - **The taxonomy survives.** A criterion defect is a `VALIDATOR_ERROR` and a broken world is an
 *    `ENVIRONMENT_FAILURE`; neither is ever reported as a defect in the application.
 */

const registry = new ValidatorRegistry(webUiValidators());

const target = (overrides: Partial<WebTargetObservation> = {}): WebTargetObservation => ({
  found: true,
  count: 1,
  text: "",
  value: null,
  visible: true,
  error: null,
  ...overrides,
});

/**
 * An element the adapter looked for and did not find.
 *
 * Distinct from omitting the key from `targets`, which means the selector was never read at all —
 * the difference this whole family is careful to preserve, and the difference a fixture is most
 * likely to erase by accident.
 */
const absent: Partial<WebTargetObservation> = { found: false, count: 0, text: null, visible: false };

const page = (
  targets: Readonly<Record<string, Partial<WebTargetObservation>>> = {},
  extra: Partial<WebObservationData> = {},
): WebObservationData => ({
  url: "http://127.0.0.1:4173/",
  title: "Shopping Cart",
  targets: Object.fromEntries(
    Object.entries(targets).map(([selector, reading]) => [selector, target(reading)]),
  ),
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
  ...extra,
});

const observed = (
  data: unknown,
  artifacts: readonly ArtifactKind[] = ["screenshot", "console", "network", "dom"],
): Observation => ({
  kind: WEB_OBSERVATION_KIND,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "local-web:examples/shopping-cart",
  runId: "run-1",
  data,
  artifacts: artifacts.map((kind) => ({ path: `artifacts/AC-001.${kind}`, kind })),
  error: null,
});

/** Judge through the registry, so a test can never pass against a name the product does not have. */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

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

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> => ({ validator, ...fields });

// ---- the family ---------------------------------------------------------------------------------

describe("the web validator family describes itself honestly", () => {
  it("registers every validator it exports", () => {
    assert.deepEqual(
      registry.names(),
      WEB_UI_VALIDATORS.map((validator) => validator.name).sort(),
    );
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    // `acceptance.schema.json` pins `Expectation.validator` to this pattern. A validator whose name
    // failed it could never appear in a valid contract, so it would be reachable only by bypassing
    // the schema — which is to say, by nobody.
    for (const validator of WEB_UI_VALIDATORS) {
      assert.match(validator.name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, validator.name);
    }
  });

  it("declares the one observation kind it can read", () => {
    for (const validator of WEB_UI_VALIDATORS) {
      assert.equal(validator.observationKind, WEB_OBSERVATION_KIND, validator.name);
    }
  });

  it("reads only comparisons that exist in the contract", () => {
    for (const validator of WEB_UI_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, validator.name);
      for (const comparison of validator.comparisons) {
        assert.ok(
          ["equals", "contains", "matches", "atLeast", "atMost"].includes(comparison),
          `${validator.name} declares unknown comparison "${comparison}"`,
        );
      }
    }
  });

  it("only asks for a selector where a selector is the question", () => {
    const needsTarget = Object.fromEntries(
      WEB_UI_VALIDATORS.map((validator) => [validator.name, validator.needsTarget]),
    );
    assert.deepEqual(needsTarget, {
      [WEB_UI_VALIDATOR_NAMES.element]: true,
      [WEB_UI_VALIDATOR_NAMES.visible]: true,
      [WEB_UI_VALIDATOR_NAMES.text]: true,
      [WEB_UI_VALIDATOR_NAMES.value]: true,
      [WEB_UI_VALIDATOR_NAMES.count]: true,
      [WEB_UI_VALIDATOR_NAMES.url]: false,
      [WEB_UI_VALIDATOR_NAMES.console]: false,
      [WEB_UI_VALIDATOR_NAMES.network]: false,
    });
  });

  it("hands out a fresh array so a registry cannot reorder the family", () => {
    const first = webUiValidators();
    const second = webUiValidators();
    assert.notEqual(first, second);
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
  });
});

// ---- a document nobody can read ------------------------------------------------------------------

describe("an unreadable observation is never a judgement", () => {
  const unreadable = observed({ url: 12 });

  it("reports the environment as broken rather than the application as failing", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.url, { contains: "/cart" }),
      unreadable,
      "ERROR",
      /does not carry a web document/,
    );
    // The adapter produced the measurement, so a document that cannot be read is the environment's
    // defect. `VALIDATOR_ERROR` here would send a reader to audit validators, the one place it is not.
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });

  it("refuses a document that is not an object at all", () => {
    expect(expectation(WEB_UI_VALIDATOR_NAMES.url, { contains: "/cart" }), observed("total"), "ERROR");
  });
});

// ---- presence ------------------------------------------------------------------------------------

describe("web.element judges whether the page contains a thing", () => {
  it("passes when the element is there", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: true }),
      observed(page({ "#total": { text: "$25.00" } })),
      "PASS",
    );
    assert.equal(result.actual, true);
  });

  it("fails when the element is not there, naming the selector", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: true }),
      observed(page({ "#total": absent })),
      "FAIL",
      /Expected the element `#total` to be present, but it is false\./,
    );
  });

  it("passes an expectation of absence", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#error", equals: false }),
      observed(page({ "#error": absent })),
      "PASS",
    );
  });

  it('reads "present" and "absent" as the words they are', () => {
    const there = observed(page({ "#total": {} }));
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: "present" }), there)
        .status,
      "PASS",
    );
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: "absent" }),
      there,
      "FAIL",
      /to be absent/,
    );
  });

  it("refuses a comparison word it cannot interpret", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: "maybe" }),
      observed(page({ "#total": {} })),
      "ERROR",
      /wants true, false, "present" or "absent"/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("is inconclusive about a selector the observation never reported", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#total", equals: true }),
      observed(page({ "#subtotal": {} })),
      "INCONCLUSIVE",
      /reports nothing about `#total`/,
    );
  });

  it("is inconclusive, not failing, when the selector could not be evaluated", () => {
    // A malformed selector is a defect in the criterion. Reporting it as `FAIL` would send an agent
    // to repair an application that was never asked a question it could answer.
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { target: "#1-bad", equals: true }),
      observed(page({ "#1-bad": { found: false, count: 0, error: "Unexpected token '#'" } })),
      "INCONCLUSIVE",
      /Unexpected token/,
    );
  });

  it("reports a criterion that names no selector as unusable", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.element, { equals: true }),
      observed(page({})),
      "ERROR",
      /reads exactly one selector/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });
});

describe("web.visible judges whether a user could see it", () => {
  it("passes for a visible element", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.visible, { target: "#total", equals: true }),
      observed(page({ "#total": { visible: true } })),
      "PASS",
    );
  });

  it("fails for an element that is present but hidden", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.visible, { target: "#total", equals: true }),
      observed(page({ "#total": { visible: false } })),
      "FAIL",
      /but it is false/,
    );
  });

  it("fails for an absent element, because an element that is not there cannot be seen", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.visible, { target: "#total", equals: true }),
      observed(page({ "#total": absent })),
      "FAIL",
    );
  });

  it("refuses a count comparison", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.visible, { target: "#total", atLeast: 1 }),
      observed(page({ "#total": {} })),
      "ERROR",
      /not declared by this validator/,
    );
  });
});

// ---- text and value ------------------------------------------------------------------------------

describe("web.text judges what the page says", () => {
  const shown = observed(page({ "#total": { text: "$25.00" } }));

  it("passes an exact match", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", equals: "$25.00" }), shown)
        .status,
      "PASS",
    );
  });

  it("fails an exact mismatch and quotes both sides", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", equals: "$30.00" }),
      shown,
      "FAIL",
      /Expected the text of `#total` to equal "\$30\.00", but it is "\$25\.00"\./,
    );
  });

  it("passes a containment check", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", contains: "25" }), shown)
        .status,
      "PASS",
    );
  });

  it("passes a regular expression", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", matches: "^\\$\\d" }), shown)
        .status,
      "PASS",
    );
  });

  it("fails an absent element, because the text it wants is not on the page", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", equals: "$25.00" }),
      observed(page({ "#total": absent })),
      "FAIL",
    );
    // The absent element has no text at all, which is a fact about the application and not a gap in
    // the observation — the observation looked, and found nothing.
    assert.equal(result.actual, "");
  });

  it("treats every stated comparison as binding", () => {
    // `{ equals: "$25.00", contains: "5" }` is one claim with two conditions. Reporting the pass and
    // dropping the fail would be a false PASS assembled out of a correct half.
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, {
        target: "#total",
        equals: "$25.00",
        contains: "99",
      }),
      shown,
      "FAIL",
      /to contain "99"/,
    );
  });

  it("refuses a pattern that does not compile", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", matches: "[" }),
      shown,
      "ERROR",
      /does not compile/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("refuses to compare text against a number", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total", equals: 25 }),
      shown,
      "ERROR",
      /compares text with a string; it received 25/,
    );
  });

  it("refuses an expectation with nothing to compare", () => {
    // Unreachable through `buildValidationPlan`, which requires a comparison — and asserted anyway,
    // because the alternative is an expectation that cannot fail, which is a false PASS by
    // construction.
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.text, { target: "#total" }),
      shown,
      "ERROR",
      /states no comparison/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });
});

describe("web.value judges what a control holds", () => {
  it("passes an exact match on a form control", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.value, { target: "#qty", equals: "3" }),
      observed(page({ "#qty": { value: "3" } })),
      "PASS",
    );
  });

  it("is inconclusive about an element that has no value at all", () => {
    // A `<div>` has no `value`. The criterion is aimed at the wrong kind of element, so nobody can
    // answer it — and inventing an answer would be a guess dressed up as a measurement.
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.value, { target: "#total", equals: "3" }),
      observed(page({ "#total": { text: "$25.00", value: null } })),
      "INCONCLUSIVE",
      /carries no value/,
    );
  });

  it("fails an absent control", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.value, { target: "#qty", equals: "3" }),
      observed(page({ "#qty": absent })),
      "FAIL",
    );
  });
});

// ---- counts --------------------------------------------------------------------------------------

describe("web.count judges how many things matched", () => {
  const items = observed(page({ "#cart li": { count: 3, text: "x" } }));

  it("passes at least and equals and at most", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", atLeast: 3 }), items).status,
      "PASS",
    );
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", equals: 3 }), items).status,
      "PASS",
    );
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", atMost: 3 }), items).status,
      "PASS",
    );
  });

  it("fails a count that is too small, quoting the real number", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", atLeast: 4 }),
      items,
      "FAIL",
      /to be at least 4, but it is 3/,
    );
  });

  it("fails an empty list against an expectation of one", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", equals: 1 }),
      observed(page({ "#cart li": absent })),
      "FAIL",
    );
  });

  it("refuses a count comparison against a word", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", atLeast: "three" }),
      items,
      "ERROR",
      /compares a count with a number/,
    );
  });

  it("refuses a comparison it does not declare", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.count, { target: "#cart li", contains: "3" }),
      items,
      "ERROR",
      /not declared by this validator/,
    );
  });
});

// ---- the page itself -----------------------------------------------------------------------------

describe("web.url judges where the page ended up", () => {
  it("passes without asking for a selector", () => {
    assert.equal(
      judge(
        expectation(WEB_UI_VALIDATOR_NAMES.url, { contains: "/cart" }),
        observed(page({}, { url: "http://127.0.0.1:4173/cart" })),
      ).status,
      "PASS",
    );
  });

  it("fails a URL that went somewhere else", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.url, { matches: "/checkout$" }),
      observed(page()),
      "FAIL",
      /the page URL to match \/\/checkout\$\//,
    );
  });
});

// ---- the console and the wire ---------------------------------------------------------------------

describe("web.console.clean judges what the browser complained about", () => {
  const quiet = observed(page({}, { console: [{ level: "log", text: "cart ready", at: "t0" }] }));
  const noisy = observed(
    page({}, { console: [
      { level: "log", text: "cart ready", at: "t0" },
      { level: "error", text: "Uncaught TypeError: cannot read 'value'", at: "t1" },
    ] }),
  );

  it("passes a console with no errors in it", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.console, { equals: true }), quiet).status,
      "PASS",
    );
  });

  it("does not treat a warning as an error", () => {
    assert.equal(
      judge(
        expectation(WEB_UI_VALIDATOR_NAMES.console, { equals: true }),
        observed(page({}, { console: [{ level: "warning", text: "deprecated", at: "t0" }] })),
      ).status,
      "PASS",
    );
  });

  it("fails and quotes the error, so a repair agent has something to read", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.console, { equals: true }),
      noisy,
      "FAIL",
      /Uncaught TypeError: cannot read 'value'/,
    );
    assert.deepEqual(result.actual, ['"Uncaught TypeError: cannot read \'value\'"']);
  });

  it("honours a tolerated count", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.console, { atMost: 1 }), noisy).status,
      "PASS",
    );
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.console, { atMost: 0 }),
      noisy,
      "FAIL",
      /at most 0 console errors/,
    );
  });

  it("refuses to claim the console must be dirty", () => {
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.console, { equals: false }),
      noisy,
      "ERROR",
      /wants true \(none\)/,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
  });

  it("is inconclusive when no console artifact was captured", () => {
    // An empty console and an unwatched console produce the same array. Without the artifact there is
    // no way to tell them apart, and believing the empty one is a false PASS.
    const result = expect(
      expectation(WEB_UI_VALIDATOR_NAMES.console, { equals: true }),
      observed(page(), ["screenshot"]),
      "INCONCLUSIVE",
      /carries no `console` artifact/,
    );
    assert.equal(result.failureKind, null);
  });
});

describe("web.network.ok judges what the wire did", () => {
  const clean = observed(
    page({}, { network: [{ method: "GET", url: "/api/cart", status: 200, ok: true, at: "t0" }] }),
  );
  const broken = observed(
    page({}, { network: [
      { method: "GET", url: "/api/cart", status: 200, ok: true, at: "t0" },
      { method: "POST", url: "/api/cart/items", status: 404, ok: false, at: "t1" },
      { method: "GET", url: "/api/totals", status: null, ok: false, at: "t2" },
    ] }),
  );

  it("passes when every recorded response was a success", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.network, { equals: true }), clean).status,
      "PASS",
    );
  });

  it("fails and names each failed request with its status", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.network, { equals: true }),
      broken,
      "FAIL",
      /POST \/api\/cart\/items answered 404/,
    );
  });

  it("distinguishes a request that got no response from one that got the wrong one", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.network, { equals: true }),
      broken,
      "FAIL",
      /GET \/api\/totals got no response/,
    );
  });

  it("honours a tolerated number of failures", () => {
    assert.equal(
      judge(expectation(WEB_UI_VALIDATOR_NAMES.network, { atMost: 2 }), broken).status,
      "PASS",
    );
  });

  it("is inconclusive when no network artifact was captured", () => {
    expect(
      expectation(WEB_UI_VALIDATOR_NAMES.network, { equals: true }),
      observed(page(), ["screenshot"]),
      "INCONCLUSIVE",
      /carries no `network` artifact/,
    );
  });
});

// ---- the discipline that holds the whole product up -----------------------------------------------

describe("no branch of this family can produce a wrong answer", () => {
  const documents = [
    page({}),
    page({ "#total": { text: "$25.00" } }),
    page({ "#total": { found: false, count: 0 } }),
    page({ "#total": { error: "the page navigated away" } }),
    page({ "#cart li": { count: 3, text: "x" } }),
  ];
  const names = Object.values(WEB_UI_VALIDATOR_NAMES);
  const comparisons: Readonly<Record<string, unknown>> = {
    equals: true,
    contains: "x",
    matches: ".",
    atLeast: 1,
    atMost: 1,
  };

  it("attaches a failure kind to everything it calls an ERROR", () => {
    let errors = 0;
    for (const name of names) {
      for (const [key, value] of Object.entries(comparisons)) {
        for (const document of documents) {
          const result = judge(expectation(name, { target: "#total", [key]: value }), observed(document));
          if (result.status !== "ERROR") continue;
          errors += 1;
          assert.equal(result.failureKind, "VALIDATOR_ERROR", `${name}.${key}: ${String(result.message)}`);
          assert.ok(result.message !== null && result.message.length > 0, `${name}.${key} errored silently`);
        }
      }
    }
    assert.ok(errors > 0, "the sweep found no ERROR branches, so it proved nothing");
  });

  it("explains every INCONCLUSIVE instead of leaving a bare status", () => {
    for (const name of names) {
      for (const document of documents) {
        const result = judge(expectation(name, { target: "#total", equals: true }), observed(document));
        if (result.status !== "INCONCLUSIVE") continue;
        assert.ok(
          result.message !== null && result.message.length > 0,
          `${name} returned INCONCLUSIVE with no reason, which is indistinguishable from a shrug`,
        );
      }
    }
  });

  it("never answers PASS without a message-free assertion", () => {
    // The registry lifts the first message it finds onto the criterion. A cheerful sentence from a
    // passing assertion sitting above a failing one is the artefact an agent skims and believes.
    for (const name of names) {
      const document = page({ "#total": { text: "$25.00", value: "3", count: 1 } }, {
        url: "http://127.0.0.1:4173/cart",
        console: [],
        network: [],
      });
      const result = judge(expectation(name, { target: "#total", equals: true }), observed(document));
      if (result.status !== "PASS") continue;
      assert.equal(result.message, null, `${name} passed with a message: ${String(result.message)}`);
    }
  });

  it("never reports an application failure for a criterion that cannot be read", () => {
    for (const name of names) {
      const result = judge(expectation(name, { target: "#total" }), observed(page({ "#total": {} })));
      assert.notEqual(result.status, "FAIL", `${name} failed an application over a criterion defect`);
    }
  });
});
