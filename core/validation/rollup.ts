import { failure, type Failure, type FailureKind } from "../failure.ts";
import type { CriterionResult } from "./types.ts";

/**
 * The guard set. Each name is a condition that must hold for a run to be reported as `PASS`.
 *
 * Naming them makes the M3 claim reviewable: "zero false PASS" is not a property of a code path,
 * it is the statement that every one of these is true. A missing guard would be invisible in a
 * chain of `if` statements; here it shows up as a hole in the record.
 */
export const ROLLUP_GUARDS = [
  "noSafetyViolation",
  "environmentValid",
  "hasMandatoryCriteria",
  "noMandatoryFailure",
  "informationSufficient",
  "requiredEvidencePresent",
  "allMandatoryDecided",
] as const;
export type RollupGuard = (typeof ROLLUP_GUARDS)[number];

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface RollupInput {
  readonly criteria: readonly CriterionResult[];
  readonly environmentValid: boolean;
  readonly environmentMessage?: string | null;
  /** Non-null when an action crossed a declared boundary. Never merely reported — it fails the run. */
  readonly safetyViolation: string | null;
  /** True when a blocking ambiguity had to be deferred, so the contract was never fully executable. */
  readonly insufficientInformation: boolean;
  readonly insufficientInformationDetail?: string | null;
}

export interface RollupOutcome {
  readonly verdict: Verdict;
  readonly failure: Failure | null;
  readonly reasons: readonly string[];
  readonly guards: Readonly<Record<RollupGuard, boolean>>;
  readonly mandatoryTotal: number;
  readonly mandatoryPassed: number;
}

const kindForUnresolved = (criterion: CriterionResult): FailureKind => {
  const declared = criterion.assertions.find((a) => a.failureKind)?.failureKind;
  if (declared) return declared;
  if (criterion.status === "FAIL") return "TEST_FAILURE";
  if (criterion.status === "ERROR") return "VALIDATOR_ERROR";
  return "UNKNOWN";
};

/**
 * Decide a run's verdict.
 *
 * The precedence is fixed and intentionally pessimistic: a safety violation outranks everything, a
 * broken environment outranks a criterion failure (a criterion measured in an invalid world proves
 * nothing), and any residual uncertainty outranks success. The function returns early at the first
 * violated guard, so reaching `PASS` requires passing *all* of them in order.
 */
export function rollup(input: RollupInput): RollupOutcome {
  const mandatory = input.criteria.filter((c) => c.mandatory);
  const passed = mandatory.filter((c) => c.status === "PASS");
  const failed = mandatory.filter((c) => c.status === "FAIL");
  const undecided = mandatory.filter((c) => c.status !== "PASS" && c.status !== "FAIL");

  const guards: Record<RollupGuard, boolean> = {
    noSafetyViolation: input.safetyViolation === null,
    environmentValid: input.environmentValid,
    hasMandatoryCriteria: mandatory.length > 0,
    noMandatoryFailure: failed.length === 0,
    informationSufficient: !input.insufficientInformation,
    requiredEvidencePresent: !input.criteria.some(
      (c) => c.mandatory && c.missingEvidence.length > 0,
    ),
    allMandatoryDecided: undecided.length === 0,
  };

  const denom = { mandatoryTotal: mandatory.length, mandatoryPassed: passed.length };
  const done = (verdict: Verdict, fail: Failure | null, reasons: readonly string[]): RollupOutcome => ({
    verdict,
    failure: fail,
    reasons,
    guards,
    ...denom,
  });

  if (!guards.noSafetyViolation) {
    return done("FAIL", failure("SECURITY_VIOLATION", input.safetyViolation ?? "Safety violation"), [
      `A declared boundary was crossed: ${input.safetyViolation}`,
    ]);
  }

  if (!guards.environmentValid) {
    return done(
      "INCONCLUSIVE",
      failure(
        "ENVIRONMENT_FAILURE",
        input.environmentMessage ?? "The environment was not valid, so nothing measured in it counts.",
      ),
      ["Environment invalid; criterion results are not decidable evidence."],
    );
  }

  if (!guards.hasMandatoryCriteria) {
    return done(
      "INCONCLUSIVE",
      failure(
        "UNKNOWN",
        "No mandatory criteria were declared, so there is nothing that could have been proven.",
      ),
      ["A run with zero mandatory criteria can never be a PASS."],
    );
  }

  if (!guards.noMandatoryFailure) {
    const first = failed[0];
    const kind = first ? kindForUnresolved(first) : "TEST_FAILURE";
    return done(
      "FAIL",
      failure(kind, `${failed.length} mandatory criterion/criteria failed.`, {
        criterionId: first?.criterionId ?? null,
        detail: failed.map((c) => `${c.criterionId}: ${c.message ?? c.status}`).join("; "),
      }),
      failed.map((c) => `${c.criterionId} FAIL - ${c.message ?? "no message"}`),
    );
  }

  if (!guards.informationSufficient) {
    return done(
      "INCONCLUSIVE",
      failure(
        "UNKNOWN",
        input.insufficientInformationDetail ??
          "A blocking ambiguity was deferred, so the acceptance contract was never fully executable.",
      ),
      ["Insufficient information to reach a verdict."],
    );
  }

  if (!guards.requiredEvidencePresent) {
    const offender = input.criteria.find((c) => c.mandatory && c.missingEvidence.length > 0);
    return done(
      "INCONCLUSIVE",
      failure("INFRASTRUCTURE_FAILURE", offender?.message ?? "Required evidence is missing.", {
        criterionId: offender?.criterionId ?? null,
      }),
      [`${offender?.criterionId ?? "a criterion"} passed its assertions but not its evidence requirement.`],
    );
  }

  if (!guards.allMandatoryDecided) {
    const first = undecided[0];
    const kind = first ? kindForUnresolved(first) : "UNKNOWN";
    return done(
      "INCONCLUSIVE",
      failure(
        kind,
        `${undecided.length} mandatory criterion/criteria produced no decision (${undecided
          .map((c) => c.status)
          .join(", ")}).`,
        {
          criterionId: first?.criterionId ?? null,
          detail: undecided.map((c) => `${c.criterionId}: ${c.status}`).join("; "),
        },
      ),
      undecided.map((c) => `${c.criterionId} ${c.status} - ${c.message ?? "no message"}`),
    );
  }

  return done("PASS", null, [
    `${passed.length}/${mandatory.length} mandatory criteria passed, environment valid, no safety violation, evidence complete.`,
  ]);
}
