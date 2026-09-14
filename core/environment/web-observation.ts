/**
 * The vocabulary of a web observation.
 *
 * ## Why this lives in the Core
 *
 * Two layers have to agree on it and neither may depend on the other: the adapter that *produces* a
 * web observation and the validators that *read* it. `core/*` may not import `adapters/*` or
 * `validators/*`, and `validators/*` must not import `adapters/*` either — a validator that knows how
 * a page was driven is a validator that cannot be tested without a browser, and the whole point of
 * this split is that it can be.
 *
 * The Core is therefore the only place both sides can reach, and the Core is not being asked to learn
 * anything new by holding it: `acceptance.schema.json` already fixes the evidence vocabulary to
 * `screenshot | trace | dom | console | network`, and `ArtifactKind` already contains those. A web
 * observation *is* this product's first domain, and pretending otherwise would mean an interface
 * reduction that hides the one thing both sides must be explicit about.
 *
 * A future adapter for another domain adds its own vocabulary file alongside this one and registers
 * validators that declare its `kind`. Nothing here is required to change.
 */

/** The `Observation.kind` a web adapter emits and every `web.*`-reading validator declares. */
export const WEB_OBSERVATION_KIND = "web.page";

/**
 * Everything Veridian learned about one selector in one look.
 *
 * One shape per selector rather than one field per question, because a criterion is decided from
 * several of these at once and a reader comparing two runs needs them side by side. `count` is
 * separate from `found` so that "no element matched" and "three elements matched" cannot share a
 * representation — `found` collapses the first case into a boolean and loses the third.
 */
export interface WebTargetObservation {
  /** True when at least one element matched. */
  readonly found: boolean;
  /** How many elements matched. `0` when `found` is false, never `null` — zero is a measurement. */
  readonly count: number;
  /** `textContent`, trimmed. `null` when nothing matched, so "no text" is not read as an empty string. */
  readonly text: string | null;
  /** The form control's `value`. `null` when nothing matched or the element has no value. */
  readonly value: string | null;
  /** Whether the first match is visible to a user. `false` when nothing matched. */
  readonly visible: boolean;
  /**
   * Set when the selector itself could not be evaluated — a malformed selector, or a page that
   * navigated out from under the query.
   *
   * This must not be confused with a selector that matched nothing: one is a defect in the criterion,
   * the other is a fact about the application. Reporting both as `found: false` would send an
   * external agent to repair an application that was never asked a question it could answer.
   */
  readonly error: string | null;
}

export interface WebConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly at: string;
}

export interface WebNetworkEntry {
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly ok: boolean;
  readonly at: string;
}

/**
 * *What the world looked like*, not what happened to it.
 *
 * The `steps` that produced this state are recorded in the acceptance contract and the run bundle;
 * repeating them here would create a second, drifting copy of the plan. Repeatability comes from
 * replaying the plan, not from remembering it.
 */
export interface WebObservationData {
  readonly url: string;
  readonly title: string | null;
  /** Keyed by the selector as written in the criterion, so a result cites the question it answers. */
  readonly targets: Readonly<Record<string, WebTargetObservation>>;
  readonly console: readonly WebConsoleEntry[];
  readonly network: readonly WebNetworkEntry[];
  readonly viewport: { readonly width: number; readonly height: number } | null;
}

/**
 * A structural check, used by validators rather than by the adapter.
 *
 * Validators are handed `Observation.data` typed as `unknown`, so without this every one of them
 * would need its own defensive cast, and the first one to get it wrong would report a clean pass on
 * a document it could not read. One check, one place to fix.
 */
export function isWebObservationData(value: unknown): value is WebObservationData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WebObservationData>;
  return typeof candidate.url === "string" && typeof candidate.targets === "object" && candidate.targets !== null;
}

/** Read one selector's observation. `null` when the criterion never asked about it. */
export function targetOf(
  data: WebObservationData,
  selector: string | null,
): WebTargetObservation | null {
  if (selector === null) return null;
  return data.targets[selector] ?? null;
}
