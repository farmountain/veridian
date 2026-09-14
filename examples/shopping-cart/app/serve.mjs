/**
 * A zero-dependency static file server for the shopping-cart app.
 *
 * The demo deliberately does not reach for a framework or a bundler. Veridian's job is to validate
 * an application, not to have opinions about how one is built, and an example that needed a build
 * step would put the toolchain between the reader and the thing being demonstrated.
 *
 * It prints its own ready line rather than relying on the caller to sleep: `environment.yaml`'s
 * `start.readyPattern` waits for that line. "Wait until it says it is listening" is a fact; "wait
 * two seconds and hope" is a race, and a race is how M1 (result consistency on repeat runs) dies.
 *
 * `cache-control: no-store` is not decoration. The loop repairs the application and then re-runs it
 * from a clean world; a browser serving the repaired `cart.js` out of its cache would let a stale
 * build decide the verdict.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env["PORT"] ?? "4317");

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
});

/**
 * Resolve a request path to a file inside `root`, or `null` if it escapes.
 *
 * The check is on the *resolved* path rather than on the raw string, because `..%2f` and friends
 * decode into the same traversal as `../`. The adapter model already treats the app as untrusted —
 * this keeps the example honest about that rather than relying on the demo's own good manners.
 */
function resolveTarget(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = resolve(join(root, normalize(relative)));
  return target === root || target.startsWith(root + sep) ? target : null;
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}:${port}`).pathname);
  const target = resolveTarget(pathname);

  if (target === null) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("forbidden\n");
    return;
  }

  readFile(target).then(
    (body) => {
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    },
    () => {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
    },
  );
});

server.listen(port, host, () => {
  // The exact string `environment.yaml` waits for. Changing it here without changing the contract
  // is a change that would leave the environment permanently "not ready".
  process.stdout.write(`shopping-cart listening on http://${host}:${port}\n`);
});
