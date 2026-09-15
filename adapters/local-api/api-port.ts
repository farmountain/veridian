/**
 * The seam through which an `local-api` world sends a request.
 *
 * ## Why this is a port and not a call to `fetch`
 *
 * The web adapter takes its `fetch` as an injectable option for one reason: so that the adapter's
 * own decisions - which URL a path resolves to, what a refused crossing looks like, what an evidence
 * bundle holds when the service never answered - can be exercised by a test without a server, a
 * socket or a port. This world has the same need, doubled, because a request here is not an
 * implementation detail of an observation; it *is* the observation. Every criterion in this world is
 * judged on what came back from a request this file sent, so the shape of that request and the shape
 * of that answer are the two things a test has to be able to control.
 *
 * ## Why there is no `core/` port for this
 *
 * `core/` owns the *reading* (`core/environment/api-observation.ts`) and nothing else, deliberately.
 * Two of the simulated worlds already open HTTP servers of their own (`sim-k8s`, `sim-cloud`) and
 * both build them on `node:http` directly, because a substitute server's lifecycle is that world's
 * business and no other world's. A shared client port in `core/` would be a third place that decides
 * what a request is, and this repository has already paid for that shape: *two implementations of one
 * rule disagree the first time a world arrives that only one of them was written for*.
 *
 * ## `status: null` rather than a synthesised `0`
 *
 * A transport failure is not a status code. `0` is a convention from a different ecosystem and it
 * reads as a code the server chose; the honest reading is that no response arrived, with `error`
 * saying what the client saw. The validator that judges a status then answers `INCONCLUSIVE` for such
 * an exchange rather than `FAIL`, because the criterion asked what status the service returned and
 * the service was never asked - two different repairs.
 */

import type { CallMethod } from "../../core/acceptance/steps.ts";

/** One request to put to the world. */
export interface ApiRequest {
  /** One of the five methods the acceptance contract admits for a `call` step. */
  readonly method: CallMethod;
  /** The absolute address, already resolved by the adapter. Never a path. */
  readonly url: string;
  /** The body to send, or `null` for none. Sent as `text/plain` unless the caller sets a header. */
  readonly body: string | null;
  /** Extra request headers, lower-cased. Empty for a criterion that named none. */
  readonly headers: Readonly<Record<string, string>>;
  /** How long the whole exchange may take. */
  readonly timeoutMs: number;
}

/** What came back, or why nothing did. */
export interface ApiAnswer {
  /** The status the service answered with, or `null` when no response arrived. */
  readonly status: number | null;
  /** Response headers, lower-cased. Empty when there was no response. */
  readonly headers: Readonly<Record<string, string>>;
  /** The response body as text. `""` when there was none. */
  readonly body: string;
  /** Why no response arrived, when none did. `null` when a response did. */
  readonly error: string | null;
}

/** The one method a world needs: put a request, get an answer, and never throw. */
export interface ApiClient {
  send(request: ApiRequest): Promise<ApiAnswer>;
}

/**
 * The real client.
 *
 * Global `fetch` rather than a dependency, for the same reason `local-web` uses it: Node 22 has it,
 * adding a package for it would be a runtime dependency in a project that has exactly one (`yaml`),
 * and the platform's own client is the one a service is expected to answer.
 *
 * It never throws. A refused connection, a timeout and a malformed response are all answers of the
 * form "no status, here is why" - because the alternative is an exception travelling up through the
 * loop, where it would be classified by whoever caught it rather than by the world that observed it.
 */
export const nodeApiClient = (): ApiClient => ({
  async send(request: ApiRequest): Promise<ApiAnswer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(request.url, {
        method: request.method,
        body: request.body === null ? undefined : request.body,
        headers: { "content-type": "text/plain; charset=utf-8", ...request.headers },
        signal: controller.signal,
        redirect: "manual",
      });
      const body = await response.text();
      return {
        status: response.status,
        headers: headerRecord(response.headers),
        body,
        error: null,
      };
    } catch (error) {
      return { status: null, headers: {}, body: "", error: describeError(error) };
    } finally {
      clearTimeout(timer);
    }
  },
});

/**
 * Headers as a lower-cased plain record.
 *
 * A `Headers` object cannot be spread into a record and cannot be serialised into a bundle, so the
 * reading has to be flattened here rather than at the point it is written. The conversion happens
 * once, in the client, so no two code paths can disagree about the casing.
 */
function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

/**
 * An error as a phrase.
 *
 * `AbortError` is named as a timeout rather than by its class name, because "This operation was
 * aborted" does not tell a reader that the world's own deadline elapsed - and that is the one thing
 * a reader of a failed exchange needs to know to tell a slow service from a broken one.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return `the request did not complete before its deadline (${error.message})`;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== error.message) {
      return `${error.message}: ${cause.message}`;
    }
    return error.message;
  }
  return String(error);
}
