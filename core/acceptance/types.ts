/**
 * The acceptance contract: the only place a verdict can come from.
 *
 * A criterion is a *deterministic* action sequence plus one or more *declarative* expectations over
 * the resulting observation. Both halves matter: steps without expectations observe nothing, and
 * expectations without steps can only describe a landing page.
 */

/** Artifact kinds a criterion may require (`acceptance.schema.json` → `Criterion.evidence`). */
export const EVIDENCE_KINDS = ["screenshot", "trace", "dom", "console", "network"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * A criterion as it leaves the loader.
 *
 * `steps` and `expect` stay in their **wire shape** on purpose. The wire shape is the schema's
 * business — one action key per step, enforced by `oneOf` — and the typed, switchable form is an
 * execution concern that `plan.ts` produces. Keeping only one of the two would either duplicate the
 * schema or force the executor to decode untyped input.
 */
export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly mandatory: boolean;
  readonly steps: readonly Readonly<Record<string, unknown>>[];
  readonly expect: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly EvidenceKind[];
}

export interface AcceptanceContract {
  readonly version: number;
  /** Optional back-reference to the goal. When present and mismatched, the contract is for another goal. */
  readonly goalId: string | null;
  readonly criteria: readonly AcceptanceCriterion[];
}

export interface AcceptanceDocument {
  readonly raw: Record<string, unknown>;
  readonly source: import("../goal/types.ts").SourceRef;
}
