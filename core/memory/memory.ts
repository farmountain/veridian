import type { Ambiguity, InferPort, InferResult, Logger } from "../clarification/types.ts";
import type { MemoryNote, MemoryPort, RecallQuery } from "./types.ts";

/**
 * The substrate is optional, and "optional" has to mean something.
 *
 * `NullMemory` is not a stub for tests. It is the correct configuration for a run that has no
 * substrate, and it is deliberately *silent*: nothing checks for it, nothing logs a warning, and no
 * caller needs a branch. If a caller had to ask whether memory existed, the port would have failed
 * at its one job.
 */
export class NullMemory implements MemoryPort {
  readonly available = false;
  readonly kind = "none";

  async recall(_query: RecallQuery): Promise<readonly MemoryNote[]> {
    return [];
  }

  async remember(_note: MemoryNote): Promise<void> {
    return;
  }
}

export interface HttpMemoryOptions {
  readonly baseUrl: string;
  readonly actor: string;
  readonly logger?: Logger;
  /** Milliseconds before the substrate is treated as absent. Small on purpose: recall is a rung, not a gate. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * HipCortex over HTTP.
 *
 * Two rules shape this class, and both of them are about not becoming a liability:
 *
 *  1. **A failure anywhere makes it unavailable, not broken.** A refused connection, a 500, a
 *     malformed body, a hang past the timeout - each is the same *outcome*: `available` flips to
 *     `false` and every subsequent call returns empty. Rung 2 of the resolution ladder degrades to a
 *     skip, which the protocol already knows how to record.
 *  2. **It never throws.** An exception escaping a *memory* call would turn an optional convenience
 *     into a run failure, which inverts the whole point of the port.
 *  3. **The log names what was observed, not what was assumed.** Those outcomes are not the same
 *     *event*, and conflating them cost a real diagnosis: a healthy substrate that refuses a write
 *     with a 403 whose body says `precondition blocked: PII risk=0.90 ...` is not unreachable, and a
 *     reader told it is will go and inspect a network, a host and a credential that were never at
 *     fault. The status *and* the substrate's own stated reason both travel into the error, and the
 *     warning claims only that the substrate stopped being usable.
 */
export class HttpMemory implements MemoryPort {
  readonly kind = "hipcortex";
  readonly #options: HttpMemoryOptions;
  readonly #fetch: typeof fetch;
  #available: boolean;

  constructor(options: HttpMemoryOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    // Optimistic until contradicted: the first failure is what flips this, so a healthy substrate
    // costs no extra probe round-trip.
    this.#available = typeof this.#fetch === "function";
  }

  get available(): boolean {
    return this.#available;
  }

  async recall(query: RecallQuery): Promise<readonly MemoryNote[]> {
    if (!this.#available) return [];
    try {
      const body = await this.#post("/memory/search", {
        query: query.query,
        limit: query.limit ?? 5,
        ...(query.scope === undefined ? {} : { actor: query.scope }),
      });
      return notesFrom(body);
    } catch (error) {
      this.#degrade("recall", error);
      return [];
    }
  }

  async remember(note: MemoryNote): Promise<void> {
    if (!this.#available) return;
    try {
      await this.#post("/memory/add", {
        actor: this.#options.actor,
        action: "noted",
        target: note.content,
        record_type: "Temporal",
      });
    } catch (error) {
      this.#degrade("remember", error);
    }
  }

  async #post(path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs ?? 1_500);
    timer.unref?.();
    try {
      const response = await this.#fetch(`${this.#options.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await describeFailure(response));
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  #degrade(operation: string, error: unknown): void {
    if (!this.#available) return;
    this.#available = false;
    this.#options.logger?.warn(
      "memory substrate is unusable for the rest of this run; inference degrades to a skip",
      { operation, baseUrl: this.#options.baseUrl, error: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * Turn a non-2xx into an error that carries the reason, not only the status.
 *
 * Prefer the substrate's own `error` field over the raw body, because that is its statement of why,
 * and bound both: a diagnostic must never be able to grow without limit. When the body says nothing,
 * the status alone is the whole observation and the whole message.
 */
async function describeFailure(response: { readonly status: number; text(): Promise<string> }): Promise<string> {
  const status = `HTTP ${response.status}`;
  let body: string;
  try {
    body = await response.text();
  } catch {
    return status;
  }
  const detail = (readReason(body) ?? body).trim().replace(/\s+/g, " ").slice(0, 300);
  return detail.length === 0 ? status : `${status}: ${detail}`;
}

/** The substrate's own statement of why, when it offered one in JSON. */
function readReason(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "string" && error.length > 0) return error;
    }
  } catch {
    // Not JSON. The raw body is then the best available statement of the failure.
  }
  return null;
}

/** Accept the several shapes a substrate may return, and reject anything that is not a note. */
function notesFrom(body: unknown): readonly MemoryNote[] {
  const rows = Array.isArray(body)
    ? body
    : body !== null && typeof body === "object"
      ? ((body as { results?: unknown; memories?: unknown; records?: unknown }).results ??
        (body as { memories?: unknown }).memories ??
        (body as { records?: unknown }).records)
      : null;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): MemoryNote[] => {
    if (row === null || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const content = record["content"] ?? record["target"] ?? record["text"];
    if (typeof content !== "string" || content.length === 0) return [];
    const source = record["source"] ?? record["origin"] ?? record["action"] ?? "memory";
    const confidence = record["confidence"];
    return [
      {
        content,
        source: typeof source === "string" ? source : "memory",
        ...(typeof confidence === "number" ? { confidence } : {}),
        ...(typeof record["id"] === "string" ? { id: record["id"] } : {}),
      },
    ];
  });
}

/**
 * Rung 2 of the resolution ladder, backed by the substrate.
 *
 * The confidence model is the whole content of this class, and it is deliberately conservative: a
 * remembered answer is only offered at `inferThreshold` or above when the note is *about the same
 * question*. A substrate that answers every question with its nearest neighbour would be worse than
 * no substrate at all, because it would make an unresolvable definition look resolved.
 */
export class MemoryInferrer implements InferPort {
  readonly #memory: MemoryPort;

  constructor(memory: MemoryPort) {
    this.#memory = memory;
  }

  async infer(ambiguity: Ambiguity): Promise<InferResult | null> {
    if (!this.#memory.available) return null;
    const notes = await this.#memory.recall({
      query: `${ambiguity.origin} ${ambiguity.path} ${ambiguity.question}`,
      limit: 5,
    });
    // Only a note that carries an explicit confidence is usable, and the value has to be one the
    // ambiguity can actually accept. A free-text recollection is context, not an answer, and this
    // rung must never turn context into a value.
    const usable = notes.filter(
      (note) => typeof note.confidence === "number" && note.confidence > 0 && note.content.length > 0,
    );
    const best = usable[0];
    if (!best || best.confidence === undefined) return null;
    return { value: best.content, confidence: best.confidence, source: `memory:${best.source}` };
  }
}
