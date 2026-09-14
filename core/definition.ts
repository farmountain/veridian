import {
  buildValidationPlan,
  finalizeAcceptance,
  linkAcceptance,
  loadAcceptanceDocument,
  type AcceptanceContract,
  type ValidationPlan,
} from "./acceptance/index.ts";
import type { ClarificationEngine } from "./clarification/engine.ts";
import {
  detectAcceptanceAmbiguities,
  detectEnvironmentAmbiguities,
  detectGoalAmbiguities,
  detectValidationAmbiguities,
  type DetectorContext,
  type EnvironmentLike,
} from "./clarification/detect.ts";
import type { Ambiguity, ClarificationReport } from "./clarification/types.ts";
import {
  finalizeEnvironment,
  loadEnvironmentDocument,
  type EnvironmentPlan,
} from "./environment/index.ts";
import { dirOf, finalizeGoal, loadGoalDocument, resolveSibling } from "./goal/index.ts";
import type { Goal, SourceRef } from "./goal/types.ts";
import type { ReadonlyIoPort } from "./io.ts";
import type { SchemaSet } from "./schema/registry.ts";
import type { ValidatorRegistry } from "./validation/registry.ts";

/**
 * DEFINE — the first stage of the universal lifecycle.
 *
 * Everything here exists to make one guarantee reachable: *no stage can proceed past a gap.* The
 * goal document, the acceptance contract and the validator set are three separate sources of
 * ambiguity, and they are resolved by **one** clarifier instance so that the human-question budget
 * is a property of the run rather than of each file. Three files, one conversation.
 *
 * The outcome is deliberately a discriminated union rather than a nullable plan. An unresolved
 * definition is a legitimate, expected result — it is what happens when a contract is genuinely
 * underspecified — and a shape that cannot express it would push the caller toward a default that
 * reports a verdict nobody earned.
 */

export interface DefinitionRequest {
  /** Path to `goal.yaml`, relative to the io port's root. */
  readonly goalPath: string;
  /** Validators that exist. An expectation naming anything else is unresolvable, and is reported. */
  readonly registry: ValidatorRegistry;
  /** Registered environment adapter kinds, e.g. `["local-web"]`. */
  readonly registeredAdapters: readonly string[];
  /**
   * Directory of the application under test, when the caller knows better than the definition does.
   *
   * Usually omitted: `app` in the environment file is relative to *that file*, so the file's own
   * directory is the right answer and the definition already states it. This exists for the case
   * where a caller drives many goals against one application checkout.
   */
  readonly appDir?: string;
}

export interface DefinitionReports {
  readonly goal: ClarificationReport;
  readonly acceptance: ClarificationReport;
  readonly environment: ClarificationReport;
}

export interface ResolvedDefinition {
  readonly kind: "resolved";
  readonly goal: Goal;
  readonly contract: AcceptanceContract;
  readonly plan: ValidationPlan;
  readonly environment: EnvironmentPlan;
  readonly goalSource: SourceRef;
  readonly acceptanceSource: SourceRef;
  readonly environmentSource: SourceRef;
  readonly acceptancePath: string;
  readonly environmentPath: string;
  readonly reports: DefinitionReports;
}

export interface IncompleteDefinition {
  readonly kind: "incomplete";
  /** Human-readable summary of what could not be settled. */
  readonly reason: string;
  /** The blocking ambiguities that reached DEFER. Never empty. */
  readonly unresolved: readonly Ambiguity[];
  /** Everything that was missing, including the non-blocking entries that were left alone. */
  readonly deferred: readonly Ambiguity[];
  readonly reports: DefinitionReports;
}

export type DefinitionOutcome = ResolvedDefinition | IncompleteDefinition;

const describe = (ambiguities: readonly Ambiguity[]): string =>
  ambiguities.map((entry) => `${entry.path}: ${entry.question}`).join(" | ");

/**
 * The detector context, constructed in one place.
 *
 * Exported because the *runtime* detectors need the same context the definition detectors were given,
 * and they are raised from a different layer entirely. Two constructors for one context is two
 * chances for `appDir` to be wrong — and `appDir` is precisely the field the environment detectors
 * use to decide whether they can see the application's manifest at all. A runtime question built
 * without it would be a question about an application nobody looked at.
 */
export function detectorContextFor(
  request: Pick<DefinitionRequest, "registry" | "registeredAdapters">,
  sourceLabel: string,
  appDir?: string,
): DetectorContext {
  return {
    registeredValidators: request.registry.names(),
    validatorDescriptors: request.registry.descriptors(),
    registeredAdapters: request.registeredAdapters,
    sourceLabel,
    ...(appDir === undefined ? {} : { appDir }),
  };
}

export async function resolveDefinition(
  io: ReadonlyIoPort,
  schemas: SchemaSet,
  request: DefinitionRequest,
  clarifier: ClarificationEngine,
): Promise<DefinitionOutcome> {
  const detectorContext = (sourceLabel: string, appDir?: string): DetectorContext =>
    detectorContextFor(request, sourceLabel, appDir);

  // ---- goal ---------------------------------------------------------------------------------
  const goalDocument = await loadGoalDocument(io, request.goalPath, schemas);
  const goalOutcome = await clarifier.resolve(
    goalDocument.raw,
    detectGoalAmbiguities(goalDocument.raw, detectorContext(request.goalPath, request.appDir)),
  );

  // The turnstile, and the reason it is checked here rather than after validation.
  //
  // The tempting version of this check is "refuse only if the resolved document fails its schema",
  // which lets a *semantically* unresolved gap through whenever the document happens to stay
  // schema-valid. A contract whose two criteria demand different values for the same observable is
  // perfectly valid and completely unsatisfiable — the run would iterate to MAX_ITERATIONS and
  // report nothing useful. Trusting the protocol's own verdict instead of a downstream side effect
  // closes that whole class of silent progression in one line.
  const goalUnresolved = goalOutcome.deferred.filter((entry) => entry.blocking);
  if (goalUnresolved.length > 0) {
    return {
      kind: "incomplete",
      reason: `the goal cannot be executed as written - ${describe(goalUnresolved)}`,
      unresolved: goalUnresolved,
      deferred: goalOutcome.deferred,
      reports: reportsOf(goalOutcome.report),
    };
  }

  const goal = finalizeGoal(goalOutcome.artifact, schemas);

  // ---- acceptance + validators --------------------------------------------------------------
  const acceptancePath = resolveSibling(goalDocument.source, goal.acceptance);
  const acceptanceDocument = await loadAcceptanceDocument(io, acceptancePath, schemas);
  const acceptanceOutcome = await clarifier.resolve(acceptanceDocument.raw, [
    ...detectAcceptanceAmbiguities(acceptanceDocument.raw, detectorContext(acceptancePath)),
    ...detectValidationAmbiguities(acceptanceDocument.raw, detectorContext(acceptancePath)),
  ]);

  const acceptanceUnresolved = acceptanceOutcome.deferred.filter((entry) => entry.blocking);
  if (acceptanceUnresolved.length > 0) {
    return {
      kind: "incomplete",
      reason: `the acceptance contract cannot be executed as written - ${describe(acceptanceUnresolved)}`,
      unresolved: acceptanceUnresolved,
      deferred: [...goalOutcome.deferred, ...acceptanceOutcome.deferred],
      reports: { ...emptyReports(), goal: goalOutcome.report, acceptance: acceptanceOutcome.report },
    };
  }

  const contract = finalizeAcceptance(acceptanceOutcome.artifact, schemas);
  linkAcceptance(goal, contract);
  const plan = buildValidationPlan(contract, {
    registry: request.registry,
    maxCriterionMs: goal.limits.maxCriterionMs,
  });

  // ---- environment --------------------------------------------------------------------------
  //
  // Last, because the environment file's location is a *derived* value: the goal's `environment`
  // field has already been resolved by the protocol, and the default points at a sibling of the goal
  // file. Attempting this before the goal settles would mean guessing the path, and a guessed path
  // that happens to exist is worse than a missing one.
  const environmentPath = resolveSibling(goalDocument.source, goal.environment);
  const environmentDocument = await loadEnvironmentDocument(io, environmentPath, schemas);
  const environmentOutcome = await clarifier.resolve(
    environmentDocument.raw,
    detectEnvironmentAmbiguities(
      environmentDocument.raw as EnvironmentLike,
      // `app` is relative to the environment file, so that file's own directory is the only correct
      // `appDir`. This is what lets the manifest derivation read the right `package.json`.
      detectorContext(environmentPath, dirOf(environmentPath)),
    ),
  );

  const environmentUnresolved = environmentOutcome.deferred.filter((entry) => entry.blocking);
  if (environmentUnresolved.length > 0) {
    return {
      kind: "incomplete",
      reason: `the environment cannot be built as written - ${describe(environmentUnresolved)}`,
      unresolved: environmentUnresolved,
      deferred: [
        ...goalOutcome.deferred,
        ...acceptanceOutcome.deferred,
        ...environmentOutcome.deferred,
      ],
      reports: {
        ...emptyReports(),
        goal: goalOutcome.report,
        acceptance: acceptanceOutcome.report,
        environment: environmentOutcome.report,
      },
    };
  }

  const environment = finalizeEnvironment(environmentOutcome.artifact, schemas, environmentDocument.source);

  return {
    kind: "resolved",
    goal,
    contract,
    plan,
    environment,
    goalSource: goalDocument.source,
    acceptanceSource: acceptanceDocument.source,
    environmentSource: environmentDocument.source,
    acceptancePath,
    environmentPath,
    reports: {
      goal: goalOutcome.report,
      acceptance: acceptanceOutcome.report,
      environment: environmentOutcome.report,
    },
  };
}

const emptyReport = (): ClarificationReport => ({
  records: [],
  questionsAsked: 0,
  rounds: 0,
  elapsedMs: 0,
  budgetExhausted: false,
  unresolvedBlocking: 0,
  byVia: { derived: 0, inferred: 0, defaulted: 0, answered: 0, deferred: 0 },
});

const emptyReports = (): DefinitionReports => ({
  goal: emptyReport(),
  acceptance: emptyReport(),
  environment: emptyReport(),
});

/** A report set for a stage that never ran, so the shape is total and the empty entries are visible. */
const reportsOf = (goal: ClarificationReport): DefinitionReports => ({ ...emptyReports(), goal });
