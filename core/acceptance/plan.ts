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

export const STEP_KINDS = ["goto", "click", "reload", "fill", "select", "press", "waitFor"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const WAIT_STATES = ["attached", "detached", "visible", "hidden"] as const;
export type WaitState = (typeof WAIT_STATES)[number];

/** A step decoded from its wire shape. The contract has one action key; this has one discriminant. */
export type ValidationStep =
  | { readonly kind: "goto"; readonly url: string }
  | { readonly kind: "click"; readonly target: string }
  | { readonly kind: "reload" }
  | { readonly kind: "fill"; readonly target: string; readonly value: string }
  | { readonly kind: "select"; readonly target: string; readonly value: string }
  | { readonly kind: "press"; readonly target: string; readonly key: string }
  | { readonly kind: "waitFor"; readonly target: string; readonly state: WaitState };

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

const stepPath = (criterionId: string, index: number, key?: string): string =>
  `${criterionId}.steps[${index}]${key ? `.${key}` : ""}`;

/** Decode one wire step into a discriminated step. */
export function decodeStep(
  raw: Readonly<Record<string, unknown>>,
  criterionId: string,
  index: number,
): ValidationStep {
  const present = STEP_KINDS.filter((kind) => raw[kind] !== undefined);
  if (present.length !== 1) {
    throw defect(
      stepPath(criterionId, index),
      `a step must name exactly one action; found ${present.length === 0 ? "none" : present.join(", ")}`,
    );
  }
  const kind = present[0] as StepKind;
  const body = raw[kind];
  const path = stepPath(criterionId, index, kind);

  switch (kind) {
    case "goto":
      return { kind, url: requireString(body, path, "goto") };
    case "click":
      return { kind, target: requireString(body, path, "click") };
    case "reload":
      return { kind };
    case "fill":
    case "select": {
      if (!isPlainObject(body)) throw defect(path, `${kind} must be an object with target and value`);
      return {
        kind,
        target: requireString(body["target"], `${path}.target`, `${kind}.target`),
        value: requireString(body["value"], `${path}.value`, `${kind}.value`),
      };
    }
    case "press": {
      if (!isPlainObject(body)) throw defect(path, "press must be an object with target and key");
      return {
        kind,
        target: requireString(body["target"], `${path}.target`, "press.target"),
        key: requireString(body["key"], `${path}.key`, "press.key"),
      };
    }
    case "waitFor": {
      if (!isPlainObject(body)) throw defect(path, "waitFor must be an object with a target");
      // Defaulted here rather than through the protocol: `waitFor.state` is applied during decode,
      // where its meaning is local and its default is fail-safe in the only direction that matters.
      // Waiting for `visible` is *stricter* than `attached`, so the default cannot let a step pass
      // that would have failed — it can only fail a step that a laxer reading would have allowed.
      const state = body["state"] ?? "visible";
      if (typeof state !== "string" || !(WAIT_STATES as readonly string[]).includes(state)) {
        throw defect(`${path}.state`, `waitFor.state must be one of ${WAIT_STATES.join(", ")}`);
      }
      return {
        kind,
        target: requireString(body["target"], `${path}.target`, "waitFor.target"),
        state: state as WaitState,
      };
    }
  }
}

/**
 * Encode a decoded step back into the wire record an adapter receives.
 *
 * The encoder sits beside {@link decodeStep} on purpose. A round-trip pair split across two files
 * drifts, and the drift is silent: the decoder keeps accepting documents the encoder no longer
 * produces, and the adapter is handed a shape only one of the two knows about.
 *
 * `waitFor.state` is written out even when it was defaulted, because what the adapter receives must
 * be what was actually decided — not what the author happened to type.
 */
export function encodeStep(step: ValidationStep): Readonly<Record<string, unknown>> {
  switch (step.kind) {
    case "goto":
      return { goto: step.url };
    case "click":
      return { click: step.target };
    case "reload":
      return { reload: {} };
    case "fill":
      return { fill: { target: step.target, value: step.value } };
    case "select":
      return { select: { target: step.target, value: step.value } };
    case "press":
      return { press: { target: step.target, key: step.key } };
    case "waitFor":
      return { waitFor: { target: step.target, state: step.state } };
  }
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
