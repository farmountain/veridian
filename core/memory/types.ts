/**
 * The memory substrate.
 *
 * Veridian is useful across runs only if a run can consult what earlier runs learned. That is a
 * *substrate*, not a dependency: the port's contract is that an unreachable substrate degrades to a
 * skip and never fails a run. A validation system whose verdict depends on whether a side-car
 * process happens to be listening is not a validation system.
 */

/** A remembered note, with the context that produced it. */
export interface MemoryNote {
  /** Free-text content. Self-contained on purpose: a note whose meaning depends on its neighbours is not recall. */
  readonly content: string;
  /** Where it came from, e.g. `"run:2026-01-01T00:00:00Z"` or `"reflexion"`. */
  readonly source: string;
  /** 0..1. Never invented by a transport; an absent score stays absent. */
  readonly confidence?: number;
  readonly id?: string;
}

export interface RecallQuery {
  /** What to look for. Free text: the substrate's own indexing decides how to match it. */
  readonly query: string;
  readonly limit?: number;
  /** Narrow to one scope, e.g. the goal id. Absent means "anything". */
  readonly scope?: string;
}

export interface MemoryPort {
  /** `false` after a failed probe. A caller must be able to skip recall without a try/catch. */
  readonly available: boolean;
  readonly kind: string;
  recall(query: RecallQuery): Promise<readonly MemoryNote[]>;
  /** Failure to record is logged and swallowed. Knowledge loss must not become a run failure. */
  remember(note: MemoryNote): Promise<void>;
}
