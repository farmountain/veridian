/**
 * The network guard's decision, proven without a browser.
 *
 * `refusalSubject` is the half of the guard that can be tested offline: given a request URL and the
 * origins the plan permits, does the request proceed or is it refused? The other half - attaching a
 * route and aborting what the decision refuses - needs Chromium, which `npm run e2e` covers.
 *
 * Why this file exists at all, rather than a passing mention in the adapter's suite: the claim a
 * `networkPolicy: deny` run rests on is *"nothing this world served reached outside it"*. Before the
 * guard existed, that claim was made by a `PASS` whose third clause could not be false - the policy
 * was parsed, defaulted and recorded, and never applied. A guard whose decision is untested would
 * leave the claim in the same condition one layer down, so the decision gets its own tests.
 *
 * The cases below are chosen as the boundary's *edges*, not as a tour of the function:
 *
 *  - the application's own origin, which `deny` must permit or every run would fail;
 *  - a foreign origin, which `deny` must refuse;
 *  - a foreign origin that the *allow list* names, which must therefore proceed;
 *  - a URL that cannot be parsed, which must be refused rather than waved through;
 *  - the schemes a page sits on before it has loaded anything, which cannot reach the world and so
 *    must not be refused.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusalSubject } from "../adapters/local-web/playwright-browser.ts";

/** What `deny` resolves to for an app served from `127.0.0.1:4173`: its own origin, and nothing else. */
const deny = (): ReadonlySet<string> => new Set(["http://127.0.0.1:4173"]);

describe("the network guard decides per request, not once per page", () => {
  it("lets the application talk to itself, because a boundary is not a boundary against the app", () => {
    assert.equal(refusalSubject("http://127.0.0.1:4173/index.html", "GET", deny()), null);
    assert.equal(refusalSubject("http://127.0.0.1:4173/cart.js", "GET", deny()), null);
    assert.equal(refusalSubject("http://127.0.0.1:4173/", "POST", deny()), null);
  });

  it("refuses a foreign origin, and names the request rather than the page", () => {
    assert.equal(
      refusalSubject("https://cdn.example.com/jquery.js", "GET", deny()),
      "GET https://cdn.example.com/jquery.js",
    );
  });

  it("refuses a request that differs only by port or scheme", () => {
    // The comparison is on the origin, not the host. `127.0.0.1:4173` is the application;
    // `127.0.0.1:4174` is a different world that happens to be on the same machine.
    assert.notEqual(refusalSubject("http://127.0.0.1:4174/", "GET", deny()), null);
    assert.notEqual(refusalSubject("https://127.0.0.1:4173/", "GET", deny()), null);
  });

  it("lets through an origin the goal's allow list names", () => {
    const allowed = new Set(["http://127.0.0.1:4173", "https://api.example.com"]);
    assert.equal(refusalSubject("https://api.example.com/v1/items", "GET", allowed), null);
    // The list is not a prefix match: naming the host does not open every port on it.
    assert.notEqual(refusalSubject("https://api.example.com:8443/v1/items", "GET", allowed), null);
  });

  it("refuses what it cannot classify, because an unreadable request is not a local one", () => {
    // A relative URL reaches the guard unparsed only if something upstream failed to resolve it. The
    // safe reading is to keep it inside, not to assume it was local.
    assert.equal(refusalSubject("/cart.js", "GET", deny()), "GET /cart.js");
    assert.equal(refusalSubject("", "GET", deny()), "GET ");
  });

  it("lets the page sit on a scheme that cannot reach anything", () => {
    // A freshly opened page is on `about:blank`, and a `blob:`/`data:` URL carries its own bytes.
    // Refusing these would break the page without protecting anything: they have no origin to leave.
    for (const url of ["about:blank", "data:text/html,<p>x</p>", "blob:http://127.0.0.1:4173/abc"]) {
      assert.equal(refusalSubject(url, "GET", deny()), null, `${url} should not be refused`);
    }
  });

  it("refuses everything when the permitted set is empty", () => {
    // Not a reachable plan - `deny` always carries the app's own origin - but it is the degenerate
    // case, and it has to fail closed rather than open.
    assert.notEqual(refusalSubject("http://127.0.0.1:4173/", "GET", new Set()), null);
  });
});
