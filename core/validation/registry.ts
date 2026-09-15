import { ValidatorError, statusForObservationFailure } from "../failure.ts";
import type { FailureKind } from "../failure.ts";
import { COMPARISON_KEYS } from "../acceptance/plan.ts";
import type { Observation } from "../environment/types.ts";
import { statedComparisons } from "./assertions.ts";
import type {
  AssertionResult,
  CriterionResult,
  CriterionSpec,
  CriterionStatus,
  Validator,
  ValidatorDescriptor,
} from "./types.ts";

export class ValidatorRegistry {
  readonly #validators = new Map<string, Validator>();

  constructor(validators: readonly Validator[] = []) {
    for (const validator of validators) this.register(validator);
  }

  register(validator: Validator): this {
    if (this.#validators.has(validator.name)) {
      throw new ValidatorError(`Validator "${validator.name}" is already registered.`);
    }
    if (validator.comparisons.length === 0) {
      throw new ValidatorError(
        `Validator "${validator.name}" declares no comparisons. An expectation that cannot ` +
          "express a comparison can only ever pass, which is a false PASS waiting to happen.",
      );
    }
    // The other half of the same guard, and the one that is silent. A comparison outside the
    // acceptance vocabulary is a *typo the registry would have kept*: `containts` would be declared,
    // no criterion could ever state it, and every correct criterion naming the validator would then
    // be refused at judgment time with no way for an operator to close the gap - a question the
    // answer cannot close. Reading the vocabulary from one place is the same reason the refusal at
    // judgment time lives in this loop rather than in whichever family happened to be open.
    const unknown = validator.comparisons.filter(
      (key) => !(COMPARISON_KEYS as readonly string[]).includes(key),
    );
    if (unknown.length > 0) {
      const spell = (keys: readonly string[]): string => keys.map((key) => `\`${key}\``).join(", ");
      throw new ValidatorError(
        `Validator "${validator.name}" declares ${spell(unknown)}, which ${
          unknown.length === 1 ? "is" : "are"
        } not an acceptance comparison. A validator may only publish a question a criterion can ` +
          `state, and the vocabulary is ${spell(COMPARISON_KEYS as readonly string[])}.`,
      );
    }
    this.#validators.set(validator.name, validator);
    return this;
  }

  get(name: string): Validator | undefined {
    return this.#validators.get(name);
  }

  has(name: string): boolean {
    return this.#validators.has(name);
  }

  /**
   * Fetch a validator, failing loudly when it is absent.
   *
   * Callers that have already produced a helpful message for a missing validator use this to get a
   * type the compiler can trust, instead of threading an `undefined` check through the rest of the
   * function and hoping it is the same one.
   */
  require(name: string): Validator {
    const found = this.#validators.get(name);
    if (!found) {
      throw new ValidatorError(
        `Validator "${name}" is not registered. Registered: ${this.names().join(", ") || "(none)"}`,
      );
    }
    return found;
  }

  names(): string[] {
    return [...this.#validators.keys()].sort();
  }

  descriptors(): ValidatorDescriptor[] {
    return this.names().map((name) => {
      const validator = this.#validators.get(name);
      if (!validator) throw new ValidatorError(`Validator "${name}" vanished from the registry.`);
      return {
        name: validator.name,
        needsTarget: validator.needsTarget,
        comparisons: validator.comparisons,
        observationKind: validator.observationKind,
        // Spread rather than assigned, so a validator that declares nothing carries no key at all.
        // An explicit `targetNoun: undefined` would make every descriptor a different object shape
        // than the ones tests and fixtures already compare with `deepEqual`.
        ...(validator.targetNoun === undefined ? {} : { targetNoun: validator.targetNoun }),
      };
    });
  }
}

/**
 * The assertion that stands in for the checks that never ran.
 *
 * `kind` is carried through unchanged rather than projected onto `VALIDATOR_ERROR`. The projection
 * looked harmless and was not: it reported `VALIDATOR_ERROR` for a timeout, for a test failure and
 * for a broken browser alike — and no validator had run at all, so the assertion's own `validator`
 * field reads `"observation"`. A reader that saw `VALIDATOR_ERROR` would go and audit the
 * validators, which is the one place the defect was not.
 */
const errorAssertion = (
  validator: string,
  target: string | null,
  message: string,
  kind: FailureKind,
): AssertionResult => ({
  validator,
  target,
  status: "ERROR",
  actual: null,
  expected: null,
  message,
  failureKind: kind,
});

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The status of a criterion given its assertions.
 *
 * Ordered by severity of *uncertainty*, not of badness: an ERROR or an INCONCLUSIVE anywhere
 * dominates a FAIL, because "we could not tell" must not be reported as "we found out". The
 * fallthrough for zero assertions is `INCONCLUSIVE` — a criterion with nothing to check has not
 * been checked.
 */
export function rollupCriterionStatus(assertions: readonly AssertionResult[]): CriterionStatus {
  if (assertions.length === 0) return "INCONCLUSIVE";
  if (assertions.some((a) => a.status === "ERROR")) return "ERROR";
  if (assertions.some((a) => a.status === "INCONCLUSIVE")) return "INCONCLUSIVE";
  if (assertions.some((a) => a.status === "SKIPPED")) return "SKIPPED";
  if (assertions.some((a) => a.status === "FAIL")) return "FAIL";
  return "PASS";
}

export interface EvaluateOptions {
  readonly registry: ValidatorRegistry;
  readonly runId: string;
  readonly environmentId: string | null;
  readonly timestamp: string;
}

/**
 * Turn a criterion plus an observation into a {@link CriterionResult}.
 *
 * Three rules are load-bearing:
 *  1. A criterion whose observation failed is never passed to a validator.
 *  2. Any throw from a validator becomes `VALIDATOR_ERROR`, never a test failure.
 *  3. Missing required evidence forces `INCONCLUSIVE`, even when every assertion passed. Evidence
 *     is not decoration; an unproven pass is not a pass (metric M5).
 */
export function evaluateCriterion(
  spec: CriterionSpec,
  observation: Observation,
  options: EvaluateOptions,
): CriterionResult {
  const base = {
    criterionId: spec.id,
    description: spec.description,
    mandatory: spec.mandatory,
    timestamp: options.timestamp,
    environmentId: options.environmentId,
    runId: options.runId,
  } as const;

  if (observation.error) {
    // One source for the mapping, so the status and the recorded kind cannot drift apart. The inline
    // ternary this replaced agreed with `statusForObservationFailure` for today's taxonomy, which is
    // exactly the kind of agreement that stops holding when a tenth failure kind is added.
    const status = statusForObservationFailure(observation.error.kind);
    return {
      ...base,
      status,
      actual: null,
      expected: spec.expect.length === 1 ? spec.expect[0] : spec.expect,
      message: observation.error.message,
      missingEvidence: [],
      evidence: observation.artifacts.map((a) => a.path),
      assertions: [
        errorAssertion("observation", null, observation.error.message, observation.error.kind),
      ],
    };
  }

  const present = new Set<string>(observation.artifacts.map((a) => a.kind));
  const missingEvidence = spec.evidence.filter((kind) => !present.has(kind));

  const assertions: AssertionResult[] = [];
  for (const expectation of spec.expect) {
    const name = asString(expectation["validator"]) ?? "<missing>";
    const target = asString(expectation["target"]);

    const validator = options.registry.get(name);
    if (!validator) {
      assertions.push(
        errorAssertion(
          name,
          target,
          `No validator registered under the name "${name}".`,
          "VALIDATOR_ERROR",
        ),
      );
      continue;
    }
    if (validator.observationKind !== observation.kind) {
      assertions.push(
        errorAssertion(
          name,
          target,
          `Validator "${name}" reads "${validator.observationKind}" observations but received ` +
            `"${observation.kind}". A validator must never be asked to judge a world it cannot see.`,
          "VALIDATOR_ERROR",
        ),
      );
      continue;
    }

    // **A declared comparison is an enforced one.** `Validator.comparisons` is published through
    // `descriptors()`, so a contract author and the clarification ladder both read it as the list of
    // questions a validator answers - and until this check existed nothing consulted it at judgment
    // time. The hole that opened is the shape this product exists to refuse: `api.service` declares
    // `["equals"]`, and a criterion writing `contains: "cart"` was answered by the text comparator's
    // substring test and would have **passed** on the name of a service nobody asked to search.
    //
    // It lives here, in the loop that already refuses an unregistered name and a mismatched
    // observation kind, because this is the one seam every family passes through. The first version
    // was written into the API family alone, which would have left the other eight families - and the
    // database family, which has the same hole - unguarded; and a guard copied into the family that
    // happened to be open is a rule written twice, which is the defect this repository has paid for
    // at a validator name, a step kind, a simulated surface and a requirement's dot-path.
    //
    // It is checked **before** the validator runs, on purpose. A criterion stating an unanswerable
    // comparison is a defect in the criterion, and the world has nothing to say about it.
    const stray = statedComparisons(expectation).filter((key) => !validator.comparisons.includes(key));
    if (stray.length > 0) {
      const spell = (keys: readonly string[]): string => keys.map((key) => `\`${key}\``).join(", ");
      assertions.push(
        errorAssertion(
          name,
          target,
          `Validator "${name}" answers ${spell(validator.comparisons)} and this criterion also ` +
            `states ${spell(stray)}, which it does not answer. \`comparisons\` is what a validator ` +
            "publishes as the questions it answers, so anything outside it is a question the " +
            "validator was never written for - and answering one anyway, from whatever the reading " +
            "happens to be, is how a false PASS is manufactured.",
          "VALIDATOR_ERROR",
        ),
      );
      continue;
    }

    try {
      assertions.push(validator.validate(expectation, observation));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assertions.push(
        errorAssertion(name, target, `Validator "${name}" threw: ${message}`, "VALIDATOR_ERROR"),
      );
    }
  }

  const status = rollupCriterionStatus(assertions);
  const effective: CriterionStatus = missingEvidence.length > 0 ? "INCONCLUSIVE" : status;

  return {
    ...base,
    status: effective,
    actual: assertions.map((a) => a.actual),
    expected: assertions.map((a) => a.expected),
    message:
      missingEvidence.length > 0
        ? `Missing required evidence (${missingEvidence.join(", ")}); assertions reported ` +
          `${status}. An unproven pass is not a pass.`
        : (assertions.find((a) => a.message)?.message ?? null),
    missingEvidence,
    evidence: observation.artifacts.map((a) => a.path),
    assertions,
  };
}
