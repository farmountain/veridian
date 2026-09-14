import { DefinitionError } from "../goal/load.ts";
import type { ValidatorRegistry } from "../validation/registry.ts";
import type { CriterionSpec, Validator } from "../validation/types.ts";
import type { AcceptanceContract, AcceptanceCriterion, EvidenceKind } from "./types.ts";

/**
 * The engine that turns a contract into an executable validation sequence.
 *
 * It runs *after* the ambiguity protocol and it is deliberately strict: every check here is a
 * postcondition the protocol is responsible for establishing. A failure is therefore not a user
 * error to report and continue past — it means the pipeline was invoked out of order, or a blocking
 * gap survived resolution. Both must abort.
 *
 * The valuable half of that bargain is what the executor receives: validator *objects*, not names.
 * There is no lookup left to do at observation time, so an unregistered validator cannot reach
 * execution by any path.
 */

/**
 * The step vocabulary moved to `steps.ts`, and this line is the whole of what is left of it here.
 *
 * What stood above was a comment promising a register and a nine-string list that kept it from
 * existing: *the right shape is a register each adapter contributes to, ... the change a second
 * non-web adapter should force*. Two non-web adapters have since arrived, and a third is arriving,
 * so the register is written - `core/acceptance/steps.ts` - and these are re-exports rather than a
 * second copy. Every import path in the tree still resolves, and there is no longer a place where a
 * new action can be half-added.
 */
export {
  STEP_CODEC_COVERAGE,
  STEP_KINDS,
  WAIT_STATES,
  decodeStep,
  describeStepKinds,
  encodeStep,
  type StepCodec,
  type StepKind,
  type ValidationStep,
  type WaitState,
} from "./steps.ts";

// Re-exported for callers, and imported for use here: a re-export is not a binding, so the union and
// the decoder have to be named twice for one of them to be in scope. Two lines, one source.
import { decodeStep } from "./steps.ts";
import type { ValidationStep } from "./steps.ts";

/** A step decoded from its wire shape. Declared once, in `steps.ts`, beside the codecs that produce
 * it - a union declared twice is the same class of duplication the register above removed. */


export const COMPARISON_KEYS = ["equals", "contains", "matches", "atLeast", "atMost"] as const;
export type ComparisonKey = (typeof COMPARISON_KEYS)[number];

export interface Expectation {
  /** The resolved validator. Resolved at plan time so observation time cannot fail a lookup. */
  readonly validator: Validator;
  /** Exactly what the validator is handed — the plan does not rewrite the author's record. */
  readonly raw: Readonly<Record<string, unknown>>;
  readonly target: string | null;
  readonly comparisons: readonly ComparisonKey[];
  readonly message: string | null;
}

export interface CriterionPlan {
  readonly criterion: AcceptanceCriterion;
  readonly steps: readonly ValidationStep[];
  readonly expectations: readonly Expectation[];
  readonly evidence: readonly EvidenceKind[];
  /** Per-criterion wall-clock cap, from the goal's safety limits. */
  readonly maxCriterionMs: number;
  /** Structural view for `core/validation`. */
  readonly spec: CriterionSpec;
}

export interface ValidationPlan {
  readonly version: number;
  readonly goalId: string | null;
  /** In declared order. Author order is intent; sorting it would hide a dependency the author wrote. */
  readonly criteria: readonly CriterionPlan[];
  readonly mandatory: readonly CriterionPlan[];
  readonly optional: readonly CriterionPlan[];
}

export interface PlanContext {
  readonly registry: ValidatorRegistry;
  readonly maxCriterionMs: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function defect(path: string, message: string): DefinitionError {
  return new DefinitionError(path, [{ path, keyword: "definition", message }]);
}

function requireString(value: unknown, path: string, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw defect(path, `${what} must be a non-empty string`);
  }
  return value;
}

function decodeExpectation(
  raw: Readonly<Record<string, unknown>>,
  criterionId: string,
  index: number,
  registry: ValidatorRegistry,
): Expectation {
  const path = `${criterionId}.expect[${index}]`;
  const name = requireString(raw["validator"], `${path}.validator`, "validator");

  if (!registry.has(name)) {
    throw defect(
      `${path}.validator`,
      `"${name}" is not a registered validator. Registered: ${registry.names().join(", ") || "(none)"}. ` +
        "An expectation no validator can evaluate is not a failure of the application - it is a " +
        "question nobody answered, and it must be resolved before execution, never during.",
    );
  }
  const validator = registry.require(name);
  const target = typeof raw["target"] === "string" ? raw["target"] : null;

  if (validator.needsTarget && target === null) {
    throw defect(`${path}.target`, `validator "${name}" cannot observe anything without a target selector`);
  }

  const comparisons = COMPARISON_KEYS.filter((key) => raw[key] !== undefined);
  if (comparisons.length === 0) {
    throw defect(
      path,
      `expectation on "${name}" states no comparison (${COMPARISON_KEYS.join(", ")}). An expectation ` +
        "with nothing to compare against can only ever pass.",
    );
  }
  const unsupported = comparisons.filter((key) => !validator.comparisons.includes(key));
  if (unsupported.length > 0) {
    throw defect(
      `${path}.${unsupported[0]}`,
      `validator "${name}" cannot evaluate ${unsupported.join(", ")}; it understands ` +
        `${validator.comparisons.join(", ") || "(nothing)"}`,
    );
  }

  return {
    validator,
    raw,
    target,
    comparisons,
    message: typeof raw["message"] === "string" ? raw["message"] : null,
  };
}

/**
 * Build the plan.
 *
 * Duplicate criterion ids are rejected: the run bundle keys results by criterion id, so two criteria
 * sharing one would make a result silently overwrite its sibling — the kind of defect that turns two
 * failures into one failure and hides the second.
 */
export function buildValidationPlan(contract: AcceptanceContract, ctx: PlanContext): ValidationPlan {
  const seen = new Set<string>();
  const plans: CriterionPlan[] = contract.criteria.map((criterion) => {
    if (seen.has(criterion.id)) {
      throw defect(
        `${criterion.id}`,
        `two criteria declare the id "${criterion.id}". Results are keyed by criterion id, so one ` +
          "would overwrite the other and a failure would disappear.",
      );
    }
    seen.add(criterion.id);

    return {
      criterion,
      steps: criterion.steps.map((step, index) => decodeStep(step, criterion.id, index)),
      expectations: criterion.expect.map((expectation, index) =>
        decodeExpectation(expectation, criterion.id, index, ctx.registry),
      ),
      evidence: criterion.evidence,
      maxCriterionMs: ctx.maxCriterionMs,
      spec: {
        id: criterion.id,
        description: criterion.description,
        mandatory: criterion.mandatory,
        evidence: criterion.evidence,
        steps: criterion.steps,
        expect: criterion.expect,
      },
    };
  });

  return {
    version: contract.version,
    goalId: contract.goalId,
    criteria: plans,
    mandatory: plans.filter((plan) => plan.criterion.mandatory),
    optional: plans.filter((plan) => !plan.criterion.mandatory),
  };
}
