import type { ReadonlyIoPort } from "../io.ts";
import { DefinitionError, loadDocument } from "../goal/load.ts";
import type { Goal, GoalDocument } from "../goal/types.ts";
import { SCHEMA_URIS, type SchemaSet } from "../schema/index.ts";
import { EVIDENCE_KINDS, type AcceptanceContract, type AcceptanceCriterion, type EvidenceKind } from "./types.ts";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function loadAcceptanceDocument(
  io: ReadonlyIoPort,
  path: string,
  schemas: SchemaSet,
): Promise<GoalDocument & { readonly schemaUri: string }> {
  return loadDocument(io, path, schemas, { what: "acceptance", schemaUri: SCHEMA_URIS.acceptance });
}

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function readCriterion(raw: Readonly<Record<string, unknown>>, index: number): AcceptanceCriterion {
  const evidence = raw["evidence"];
  const steps = raw["steps"];
  const expect = raw["expect"];
  const mandatory = raw["mandatory"];

  if (!Array.isArray(expect) || expect.length === 0) {
    // The schema requires this, so reaching here means the pipeline skipped validation.
    throw new DefinitionError(`criteria[${index}]`, [
      {
        path: `$.criteria[${index}].expect`,
        keyword: "required",
        message: "a criterion with no expectations can only ever pass, which is a false PASS waiting to happen",
      },
    ]);
  }

  return {
    id: asString(raw["id"], `criteria[${index}]`),
    description: asString(raw["description"]),
    // Defaulted to `true`, matching the schema. A criterion is mandatory unless its author said
    // otherwise: the failure that matters is the one nobody thought to make optional.
    mandatory: mandatory === undefined ? true : mandatory === true,
    steps: Array.isArray(steps) ? steps.filter(isPlainObject) : [],
    expect: expect.filter(isPlainObject),
    evidence: Array.isArray(evidence)
      ? (evidence.filter((kind): kind is EvidenceKind =>
          typeof kind === "string" && (EVIDENCE_KINDS as readonly string[]).includes(kind),
        ) as EvidenceKind[])
      : [],
  };
}

/**
 * Turn a resolved acceptance document into a contract.
 *
 * Called after the ambiguity protocol, like {@link import("../goal/load.ts").finalizeGoal}, so a
 * validation failure here means a blocking gap survived resolution.
 */
export function finalizeAcceptance(
  raw: Readonly<Record<string, unknown>>,
  schemas: SchemaSet,
): AcceptanceContract {
  schemas.get(SCHEMA_URIS.acceptance).assert(raw);

  const criteria = Array.isArray(raw["criteria"]) ? raw["criteria"] : [];
  const goalId = raw["goal_id"];

  return {
    version: typeof raw["version"] === "number" ? raw["version"] : 1,
    goalId: typeof goalId === "string" ? goalId : null,
    criteria: criteria.filter(isPlainObject).map(readCriterion),
  };
}

/**
 * Refuse a contract that names a different goal.
 *
 * This is a contradiction, not a question. Either the contract or the goal is wrong, and there is no
 * answer a user could give that would make the pair coherent — so Veridian stops rather than pick
 * one and proceed with a contract nobody validated.
 */
export function linkAcceptance(goal: Goal, contract: AcceptanceContract): void {
  if (contract.goalId !== null && contract.goalId !== goal.id) {
    throw new DefinitionError(goal.id, [
      {
        path: "$.goal_id",
        keyword: "const",
        message:
          `the acceptance contract declares goal_id "${contract.goalId}" but it is being evaluated ` +
          `against goal "${goal.id}". Evaluating one goal's criteria against another's environment ` +
          "produces a verdict that means nothing.",
      },
    ]);
  }
}
