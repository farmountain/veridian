/**
 * `cart-api`: a real HTTP service, in one file, on `node:http`.
 *
 * This is the ninth world's subject, and the reason it exists is that it is *not* a substitute. There
 * is no control plane standing in for a cluster, no register standing in for a runtime, no shim
 * standing in for an editor's API. A real Node process really listens on a real loopback port and
 * really answers the requests a criterion really makes. What is substituted is nothing at all; what
 * is *withheld* is the browser, because an API's contract is its routes and a page can only ever show
 * what one route chose to render.
 *
 * That is the whole argument for this world: the web adapter judges an application through a page,
 * and a page is a *rendering* of the application. Here the application is judged through its own
 * interface, with no renderer in between - which is why `api.json` reads a JSON pointer into a
 * response body rather than a DOM selector, and why a criterion can assert a status code that no page
 * ever showed.
 *
 * ## Routes
 *
 *   GET  /health        the service identifies itself
 *   GET  /items         every item, keyed by sku
 *   GET  /items/:sku    one item, or a 404 naming the sku that is absent
 *   POST /items         create an item, answered 201
 *   GET  /cart/total    the cart's total in whole cents
 *
 * ## The state a restart erases
 *
 * `items` is an in-memory map. `POST` adds to it. Restarting the process discards it and re-seeds
 * from the frozen catalog, so a criterion that created an item cannot leak into the next iteration -
 * which is what the reset contract promises and what `reset.strategy: restart` delivers here.
 *
 * ## Reading this next to the demo's defect table
 *
 * Four lines in this tree are the four defects, and each was chosen to be readable by exactly the
 * criteria the table says it moves - one of them by two, because a shared response helper is a shared
 * surface and editing it is genuinely more than one fact. The comments below mark the three that live
 * in this file; the fourth is in `catalog.mjs`.
 */

import { createServer } from "node:http";

import { CART, CATALOG } from "./catalog.mjs";

const PORT = Number(process.env["PORT"] ?? "4327");
const HOST = "127.0.0.1";

/**
 * Dollars as the catalog writes them, to whole cents as this API states them.
 *
 * `Math.round` rather than truncation, because a catalog price with a third decimal place must not
 * silently lose a cent - and because rounding is what every invoice in the world does.
 *
 * It is a named function rather than an expression inlined at three call sites because it is one
 * decision, and one decision deserves one place to get wrong.
 */
function toCents(amount) {
  return Math.round(Number.parseFloat(amount) * 100);
}

/**
 * The one version every response carries.
 *
 * A constant rather than a literal at each call site, because a service that stated its version in
 * five places would be a service that could state five versions. It travels in a header rather than
 * in every body so that a client can read it without parsing anything.
 */
const CART_API_VERSION = "2";

/** Every item, by sku. Mutable: `POST /items` is what makes it so. */
const items = new Map(CATALOG.map((entry) => [entry.sku, entry]));

/** One item as the API states it - money in cents, never as the catalog's dollar string. */
function renderItem(entry) {
  return {
    sku: entry.sku,
    name: entry.name,
    unitPriceCents: toCents(entry.price),
    quantityOnHand: entry.quantityOnHand,
    reorderLevel: entry.reorderLevel,
  };
}

/**
 * The single place a response is written.
 *
 * Every route goes through it, which is what makes the version header a property of the *service*
 * rather than of a route - and it is why one edit here is read by every criterion that asks for the
 * header, on whichever route it asked.
 */
function sendJson(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "x-cart-version": CART_API_VERSION,
  });
  res.end(body);
}

/** Read a request body, bounded. An API that accepted an unbounded body would be a denial of service. */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("request body is larger than 64 KiB");
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Where the cart's total comes from: the quantities it holds and the prices the catalog states. */
function cartTotalCents() {
  return CART.reduce((sum, line) => {
    const entry = items.get(line.sku);
    if (entry === undefined) throw new Error(`the cart names ${line.sku} and the catalog does not hold it`);
    return sum + line.quantity * toCents(entry.price);
  }, 0);
}

async function route(req, res, pathname) {
  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok", service: "cart-api" });
  }

  if (req.method === "GET" && pathname === "/items") {
    const all = {};
    for (const [sku, entry] of items) all[sku] = renderItem(entry);
    return sendJson(res, 200, all);
  }

  if (req.method === "GET" && pathname === "/cart/total") {
    return sendJson(res, 200, { totalCents: cartTotalCents(), currency: "USD" });
  }

  if (req.method === "POST" && pathname === "/items") {
    const raw = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(raw === "" ? "null" : raw);
    } catch (error) {
      return sendJson(res, 400, { error: `the body is not JSON: ${error.message}` });
    }
    if (parsed === null || typeof parsed !== "object" || typeof parsed["sku"] !== "string") {
      return sendJson(res, 400, { error: "the body must be an object with a string `sku`" });
    }
    const created = {
      sku: parsed["sku"],
      name: typeof parsed["name"] === "string" ? parsed["name"] : parsed["sku"],
      price: String(parsed["unitPriceCents"] === undefined ? "0.00" : Number(parsed["unitPriceCents"]) / 100),
      quantityOnHand: Number(parsed["quantityOnHand"] ?? 0),
      reorderLevel: Number(parsed["reorderLevel"] ?? 0),
    };
    items.set(created.sku, created);
    return sendJson(res, 201, renderItem(created));
  }

  const match = /^\/items\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && match !== null) {
    const sku = decodeURIComponent(match[1] ?? "");
    const entry = items.get(sku);
    if (entry === undefined) {
      return sendJson(res, 404, { error: `no item with sku ${sku}` });
    }
    return sendJson(res, 200, renderItem(entry));
  }

  return sendJson(res, 404, { error: `no route for ${req.method} ${pathname}` });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${String(PORT)}`);
  // One line per request, on stdout, beside the readiness line. This is the service's own account of
  // what it was asked, and it is the evidence a status alone cannot carry: a 500 diagnoses itself
  // through whatever the service logged while it failed.
  process.stdout.write(`cart-api request: ${req.method ?? "?"} ${url.pathname}\n`);
  route(req, res, url.pathname).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`cart-api request failed: ${message}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: message });
  });
});

server.listen(PORT, HOST, () => {
  // The readiness fact. The adapter waits for this pattern rather than for a sleep, because a sleep
  // is a race and a race is how run-to-run consistency is lost.
  process.stdout.write(`cart-api listening on http://${HOST}:${String(PORT)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
