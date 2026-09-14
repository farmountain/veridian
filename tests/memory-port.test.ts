import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Logger } from "../core/clarification/index.ts";
import { HttpMemory, NullMemory } from "../core/memory/index.ts";

/**
 * The memory port is optional, and these tests hold the two halves of what "optional" has to mean.
 *
 * The first half is that its absence is silent - no caller branches, no warning, no failure. The
 * second is that its *failure* is reported honestly. Those pull in opposite directions, and the
 * second one was wrong in a way that cost a real diagnosis: the substrate answers a rejected write
 * with a 403 whose body names its own precondition, and the client threw the body away and then
 * logged that the substrate was **unreachable**. Every later reader of that line - including the
 * agent who wrote it - went looking for a network, a host or a credential, none of which were at
 * fault. *An error message may only name a cause the reporter observed*, and the reporter had the
 * cause in its hands when it discarded it.
 *
 * The assertions below read what was handed to an injected logger rather than capturing stdout.
 * That is not the "assert on log output" smell: the logger is a port this class is given, so its
 * arguments are a return value. No network is touched - `fetchImpl` is a double, which is also the
 * reason these can run in the default suite.
 */

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** A response shaped exactly as far as `HttpMemory` inspects one: a status and a way to read it. */
function respondWith(body: unknown, status = 200): FakeResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/** A `fetch` that answers everything with `response`, recording the URLs it was asked for. */
function fetchReturning(response: FakeResponse, calls: string[] = []): typeof fetch {
  const impl = async (...args: unknown[]): Promise<unknown> => {
    calls.push(String(args[0]));
    return response;
  };
  return impl as unknown as typeof fetch;
}

interface Warned {
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

function warnSpy(): { readonly logger: Logger; readonly warnings: Warned[] } {
  const warnings: Warned[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      warnings.push({ message, fields: fields ?? {} });
    },
  };
  return { logger, warnings };
}

const client = (fetchImpl: typeof fetch, logger?: Logger): HttpMemory =>
  new HttpMemory({
    baseUrl: "http://127.0.0.1:3030",
    actor: "Veridian",
    fetchImpl,
    ...(logger === undefined ? {} : { logger }),
  });

describe("the memory port", () => {
  it("is silently absent when no substrate is configured", async () => {
    const memory = new NullMemory();

    assert.equal(memory.available, false);
    assert.deepEqual(await memory.recall({ query: "anything at all" }), []);
    assert.equal(await memory.remember({ content: "a note", source: "test" }), undefined);
  });

  it("reports the reason a refused write gave, not an unreachability it never observed", async () => {
    const { logger, warnings } = warnSpy();
    const detail = 'precondition blocked: PII risk=0.90 patterns=["PII:5935040887"]';
    const memory = client(fetchReturning(respondWith({ success: false, error: detail }, 403)), logger);

    await memory.remember({ content: "a note", source: "test" });

    assert.equal(memory.available, false);
    assert.equal(warnings.length, 1);
    const [warning] = warnings;
    assert.ok(warning);
    assert.match(String(warning.fields["error"]), /HTTP 403/);
    assert.match(String(warning.fields["error"]), /precondition blocked/);
    assert.match(String(warning.fields["error"]), /PII/);
    assert.doesNotMatch(warning.message, /unreachable/);
  });

  it("carries the raw body of a refusal that declined to explain itself in JSON", async () => {
    const { logger, warnings } = warnSpy();
    const memory = client(fetchReturning(respondWith("Forbidden by policy", 403)), logger);

    await memory.recall({ query: "anything at all" });

    assert.match(String(warnings[0]?.fields["error"]), /HTTP 403: Forbidden by policy/);
  });

  it("still reports the transport error when the substrate really is unreachable", async () => {
    const { logger, warnings } = warnSpy();
    const refused = (() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:3030"))) as unknown as typeof fetch;
    const memory = client(refused, logger);

    await memory.remember({ content: "a note", source: "test" });

    assert.equal(memory.available, false);
    assert.match(String(warnings[0]?.fields["error"]), /ECONNREFUSED/);
  });

  it("stops asking, and stops warning, once it has become unusable", async () => {
    const { logger, warnings } = warnSpy();
    const calls: string[] = [];
    const memory = client(fetchReturning(respondWith({ error: "boom" }, 500), calls), logger);

    await memory.recall({ query: "one" });
    await memory.recall({ query: "two" });
    await memory.remember({ content: "a note", source: "test" });

    assert.equal(calls.length, 1);
    assert.equal(warnings.length, 1);
  });

  it("treats a body it cannot read as no notes rather than as an error", async () => {
    const memory = client(fetchReturning(respondWith("<html>not json</html>")));

    assert.deepEqual(await memory.recall({ query: "anything at all" }), []);
    assert.equal(memory.available, false);
  });
});
