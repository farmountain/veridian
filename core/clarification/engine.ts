import { setPointer } from "./pointer.ts";
import {
  DEFAULT_CLARIFICATION_POLICY,
  type Ambiguity,
  type ClarificationOutcome,
  type ClarificationPolicy,
  type ClarificationRecord,
  type ClarificationReport,
  type Clock,
  type DeferReason,
  type DerivePort,
  type InferPort,
  type Logger,
  type Resolution,
  type Rung,
  type UserPromptPort,
} from "./types.ts";

export interface ClarificationEngineDeps {
  /** Rung 1. Absent means "nothing can be derived", which is a legitimate configuration. */
  readonly derive?: DerivePort;
  /** Rung 2. Absent means the memory substrate is not wired up; inference degrades to a skip. */
  readonly infer?: InferPort;
  /** Rung 4. Required. Use `NullPromptPort` to forbid asking without forbidding resolution. */
  readonly user: UserPromptPort;
  readonly clock: Clock;
  readonly logger?: Logger;
  readonly policy?: Partial<ClarificationPolicy>;
}

/** Coerce a free-text answer into the shape the ambiguity expects. */
function coerceAnswer(ambiguity: Ambiguity, text: string): unknown {
  const trimmed = text.trim();
  const candidates = ambiguity.candidates;
  if (candidates && candidates.length > 0) {
    const lower = trimmed.toLowerCase();
    const hit = candidates.find(
      (candidate) =>
        String(candidate).toLowerCase() === lower ||
        (candidate !== null &&
          typeof candidate === "object" &&
          "value" in (candidate as object) &&
          String((candidate as { value: unknown }).value).toLowerCase() === lower),
    );
    if (hit !== undefined) {
      // A candidate object with a `value` field is a labelled choice; the label is for humans.
      if (hit !== null && typeof hit === "object" && "value" in (hit as object)) {
        return (hit as { value: unknown }).value;
      }
      return hit;
    }
    if (candidates.every((candidate) => typeof candidate === "number")) {
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) return asNumber;
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

/**
 * Resolve a batch of ambiguities against one artifact.
 *
 * The ladder is a straight line — each rung is attempted at most once — so termination is a
 * property of the structure rather than of any budget. The budgets exist to bound the *cost*
 * (human interruptions, wall clock), not to make the loop terminate.
 */
export class ClarificationEngine {
  readonly #derive: DerivePort | undefined;
  readonly #infer: InferPort | undefined;
  readonly #user: UserPromptPort;
  readonly #clock: Clock;
  readonly #logger: Logger | undefined;
  readonly #policy: ClarificationPolicy;

  #questionsAsked = 0;

  constructor(deps: ClarificationEngineDeps) {
    this.#derive = deps.derive;
    this.#infer = deps.infer;
    this.#user = deps.user;
    this.#clock = deps.clock;
    this.#logger = deps.logger;
    this.#policy = { ...DEFAULT_CLARIFICATION_POLICY, ...deps.policy };
  }

  get questionsAsked(): number {
    return this.#questionsAsked;
  }

  async resolve<T>(
    artifact: T,
    ambiguities: readonly Ambiguity[],
  ): Promise<ClarificationOutcome<T>> {
    const startedAt = this.#clock.now();
    const records: ClarificationRecord[] = [];
    const pending: { ambiguity: Ambiguity; rungs: Rung[]; lowConfidence: boolean }[] = [];
    const byVia: Record<Rung, number> = {
      derived: 0,
      inferred: 0,
      defaulted: 0,
      answered: 0,
      deferred: 0,
    };

    // Deterministic order: two runs over the same artifact ask the same questions in the same
    // order, which is what makes a recorded resolution replayable (metric M1).
    const ordered = [...ambiguities].sort((a, b) => a.id.localeCompare(b.id));

    for (const item of ordered) {
      const rungs: Rung[] = [];
      let lowConfidence = false;

      // ---- Rung 1: DERIVE ---------------------------------------------------------------
      if (this.#derive) {
        rungs.push("derived");
        const derived = await this.#safe(() => this.#derive!.derive(item));
        if (derived) {
          records.push({
            ambiguity: item,
            resolution: { via: "derived", value: derived.value, evidence: derived.evidence },
            rungsAttempted: rungs,
          });
          byVia.derived += 1;
          continue;
        }
      }

      // ---- Rung 2: INFER (blocking only) ------------------------------------------------
      // Inference costs an external call, so it is spent only where the answer changes a verdict.
      if (item.blocking && this.#infer) {
        rungs.push("inferred");
        const inferred = await this.#safe(() => this.#infer!.infer(item));
        if (inferred && inferred.confidence >= this.#policy.inferThreshold) {
          records.push({
            ambiguity: item,
            resolution: {
              via: "inferred",
              value: inferred.value,
              confidence: inferred.confidence,
              source: inferred.source,
            },
            rungsAttempted: rungs,
          });
          byVia.inferred += 1;
          continue;
        }
        lowConfidence = inferred !== null && inferred !== undefined;
      }

      // ---- Rung 3: DEFAULT -------------------------------------------------------------
      // A default is usable only when it carries a rationale. That single condition is the
      // enforcement of the fail-safe rule: a value may not be applied unless its author has
      // argued that selecting it cannot make the run report PASS more readily than the truth.
      if (item.defaultValue !== undefined && item.defaultRationale) {
        rungs.push("defaulted");
        records.push({
          ambiguity: item,
          resolution: {
            via: "defaulted",
            value: item.defaultValue,
            assumption: item.defaultRationale,
          },
          rungsAttempted: rungs,
        });
        byVia.defaulted += 1;
        continue;
      }

      // ---- Rung 4: ASK ------------------------------------------------------------------
      // A non-blocking gap never reaches a human. This is structural, not budgeted.
      if (item.blocking && this.#user.available) {
        pending.push({ ambiguity: item, rungs, lowConfidence });
        continue;
      }

      // ---- Rung 5: DEFER ----------------------------------------------------------------
      const reason = this.#deferReason(item, {
        lowConfidence,
        timeExhausted: this.#clock.now() - startedAt >= this.#policy.budgetMs,
      });
      rungs.push("deferred");
      records.push({ ambiguity: item, resolution: { via: "deferred", reason }, rungsAttempted: rungs });
      byVia.deferred += 1;
    }

    const asked = await this.#askInRounds(pending, records, byVia, startedAt);
    const unasked = asked.unasked;

    const resolved = this.#applyResolutions(artifact, records, ambiguities);

    const elapsedMs = this.#clock.now() - startedAt;
    const deferred = records
      .filter((record) => record.resolution.via === "deferred")
      .map((record) => record.ambiguity);

    const report: ClarificationReport = {
      records,
      questionsAsked: asked.count,
      rounds: asked.rounds,
      elapsedMs,
      budgetExhausted: asked.budgetExhausted,
      unresolvedBlocking: deferred.filter((ambiguity) => ambiguity.blocking).length,
      byVia,
    };

    this.#logger?.debug("clarification resolved", {
      total: ambiguities.length,
      ...byVia,
      questionsAsked: report.questionsAsked,
      unresolvedBlocking: report.unresolvedBlocking,
    });

    return { artifact: resolved, report, deferred, unasked };
  }

  /**
   * Ask outstanding questions in rounds of at most `maxQuestionsPerRound`, respecting the
   * per-run cap and the wall-clock ceiling. Anything left over is returned as `unasked` and
   * becomes a `question_budget_exhausted` deferral — never a guess.
   */
  async #askInRounds(
    pending: { ambiguity: Ambiguity; rungs: Rung[]; lowConfidence: boolean }[],
    records: ClarificationRecord[],
    byVia: Record<Rung, number>,
    startedAt: number,
  ): Promise<{ count: number; rounds: number; budgetExhausted: boolean; unasked: Ambiguity[] }> {
    let count = 0;
    let rounds = 0;
    let budgetExhausted = false;
    // The reason the budget ran out is part of the record: "we ran out of questions" and "we ran
    // out of time" are different operational problems.
    let stopReason: DeferReason = "question_budget_exhausted";
    const queue = [...pending];

    while (queue.length > 0) {
      const remainingRun = this.#policy.maxQuestionsPerRun - this.#questionsAsked;
      const timeExhausted = this.#clock.now() - startedAt >= this.#policy.budgetMs;
      if (remainingRun <= 0 || timeExhausted) {
        budgetExhausted = true;
        stopReason = timeExhausted ? "time_budget_exhausted" : "question_budget_exhausted";
        break;
      }

      const size = Math.min(this.#policy.maxQuestionsPerRound, remainingRun, queue.length);
      const batch = queue.splice(0, size);

      let answers: ReadonlyMap<string, string> = new Map();
      try {
        answers = await this.#user.ask(batch.map((entry) => entry.ambiguity));
      } catch (error) {
        this.#logger?.warn("user prompt failed; treating the round as unanswered", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.#questionsAsked += batch.length;
      count += batch.length;
      rounds += 1;

      for (const entry of batch) {
        const answer = answers.get(entry.ambiguity.id);
        if (answer !== undefined && answer.trim() !== "") {
          records.push({
            ambiguity: entry.ambiguity,
            resolution: {
              via: "answered",
              value: coerceAnswer(entry.ambiguity, answer),
              answer,
            },
            rungsAttempted: [...entry.rungs, "answered"],
          });
          byVia.answered += 1;
          continue;
        }
        const reason = this.#deferReason(entry.ambiguity, {
          lowConfidence: entry.lowConfidence,
          timeExhausted: false,
        });
        records.push({
          ambiguity: entry.ambiguity,
          resolution: { via: "deferred", reason: reason === "non_blocking" ? "no_user_available" : reason },
          rungsAttempted: [...entry.rungs, "deferred"],
        });
        byVia.deferred += 1;
      }
    }

    // Anything the budget never reached is deferred explicitly, so it appears in the record
    // rather than silently vanishing.
    for (const entry of queue) {
      records.push({
        ambiguity: entry.ambiguity,
        resolution: { via: "deferred", reason: stopReason },
        rungsAttempted: [...entry.rungs, "deferred"],
      });
      byVia.deferred += 1;
    }

    return { count, rounds, budgetExhausted, unasked: queue.map((entry) => entry.ambiguity) };
  }

  #deferReason(
    ambiguity: Ambiguity,
    state: { lowConfidence: boolean; timeExhausted: boolean },
  ): DeferReason {
    if (!ambiguity.blocking) return "non_blocking";
    if (state.timeExhausted) return "time_budget_exhausted";
    if (!this.#user.available) return "no_user_available";
    if (state.lowConfidence) return "low_confidence";
    if (ambiguity.defaultValue === undefined) return "no_default";
    return "not_derivable";
  }

  /** Patch every resolved value back into the artifact by pointer. */
  #applyResolutions<T>(
    artifact: T,
    records: readonly ClarificationRecord[],
    ambiguities: readonly Ambiguity[],
  ): T {
    const byId = new Map(ambiguities.map((ambiguity) => [ambiguity.id, ambiguity]));
    let result = artifact;
    for (const record of records) {
      const resolution = record.resolution;
      if (resolution.via === "deferred") continue;
      const ambiguity = byId.get(record.ambiguity.id);
      if (!ambiguity) continue;
      result = setPointer(result, ambiguity.path, resolution.value);
    }
    return result;
  }

  /**
   * A misbehaving port must not take the run down. A derivator that throws is equivalent to a
   * derivator that found nothing; the ladder simply moves on.
   */
  async #safe<U>(operation: () => U | Promise<U>): Promise<U | null> {
    try {
      return await operation();
    } catch (error) {
      this.#logger?.debug("derivation failed; continuing down the ladder", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** The honest "cannot ask" port. Used by headless runs so they defer instead of blocking. */
export const NullPromptPort: UserPromptPort = {
  available: false,
  ask: () => Promise.resolve(new Map<string, string>()),
};

/** Deterministic answers keyed by ambiguity id — the basis of reproducible repeat runs (M1). */
export function scriptedPromptPort(
  answers: Readonly<Record<string, string>>,
): UserPromptPort & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    available: true,
    asked,
    ask(questions) {
      const result = new Map<string, string>();
      for (const question of questions) {
        asked.push(question.id);
        const answer = answers[question.id];
        if (answer !== undefined) result.set(question.id, answer);
      }
      return Promise.resolve(result);
    },
  };
}
