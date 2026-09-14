/**
 * PLAN.md §51 — the failure taxonomy.
 *
 * The rule this file exists to enforce: **never report every failure as "test failed."** A
 * criterion that failed because the browser could not launch is not the same event as a criterion
 * that failed because the application produced the wrong number, and collapsing them destroys the
 * only information an external agent needs in order to repair anything.
 */

export const FAILURE_TAXONOMY = [
  "TEST_FAILURE",
  "ENVIRONMENT_FAILURE",
  "VALIDATOR_ERROR",
  "APPLICATION_ERROR",
  "TIMEOUT",
  "SECURITY_VIOLATION",
  "INFRASTRUCTURE_FAILURE",
  "RESET_FAILURE",
  "UNKNOWN",
] as const;
export type FailureKind = (typeof FAILURE_TAXONOMY)[number];

export interface Failure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly criterionId?: string | null;
  readonly detail?: string | null;
}

export function failure(
  kind: FailureKind,
  message: string,
  extra: { criterionId?: string | null; detail?: string | null } = {},
): Failure {
  return {
    kind,
    message,
    criterionId: extra.criterionId ?? null,
    detail: extra.detail ?? null,
  };
}

/** Raised by Veridian's own timeouts, so they classify as `TIMEOUT` rather than `UNKNOWN`. */
export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Raised when an environment operation fails, so it classifies as `ENVIRONMENT_FAILURE`. */
export class EnvironmentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EnvironmentError";
  }
}

/** Raised when a validator cannot perform its check, so it classifies as `VALIDATOR_ERROR`. */
export class ValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidatorError";
  }
}

const codeOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Map an arbitrary thrown value onto the taxonomy.
 *
 * `fallback` is required rather than defaulted on purpose: the caller knows which layer the
 * throw came from, and a plausible-looking default would be worse than being forced to say.
 */
export function classifyError(error: unknown, fallback: FailureKind): Failure {
  const message = messageOf(error);

  if (error instanceof TimeoutError) return failure("TIMEOUT", message);
  if (error instanceof EnvironmentError) return failure("ENVIRONMENT_FAILURE", message);
  if (error instanceof ValidatorError) return failure("VALIDATOR_ERROR", message);
  if (error instanceof Error && error.name === "AbortError") return failure("TIMEOUT", message);

  const code = codeOf(error);
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return failure("TIMEOUT", message);
  if (code === "ECONNREFUSED" || code === "EADDRINUSE" || code === "EADDRNOTAVAIL") {
    return failure("ENVIRONMENT_FAILURE", message);
  }
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
    return failure("INFRASTRUCTURE_FAILURE", message);
  }

  return failure(fallback, message, { detail: code ? `code=${code}` : null });
}

/**
 * The status a criterion takes when the *observation itself* failed, before any validator ran.
 *
 * The asymmetry is deliberate. A failure that means "the world was not as required" is a `FAIL`.
 * A failure that means "we could not look" is `INCONCLUSIVE`. Keeping those apart is the same
 * distinction as `INCONCLUSIVE ≠ PASS`, applied to the input side.
 */
export function statusForObservationFailure(
  kind: FailureKind,
): "FAIL" | "ERROR" | "INCONCLUSIVE" {
  switch (kind) {
    case "APPLICATION_ERROR":
    case "TEST_FAILURE":
    case "SECURITY_VIOLATION":
    case "TIMEOUT":
      return "FAIL";
    case "ENVIRONMENT_FAILURE":
      return "INCONCLUSIVE";
    case "VALIDATOR_ERROR":
    case "INFRASTRUCTURE_FAILURE":
    case "RESET_FAILURE":
    case "UNKNOWN":
      return "ERROR";
  }
}
