import type { ReadonlyIoPort } from "../io.ts";
import { SchemaValidator, type JsonSchema, type SchemaError } from "./validate.ts";

/**
 * A schema and the relaxed variant used to inspect a *partially built* artifact.
 *
 * The two-phase rule this enables is the heart of the ambiguity protocol:
 *
 *  - `validatePartial` drops only the root `required` constraint. Everything else still applies, so
 *    a misspelled key or a wrongly-typed value is still a defect. A typo is not a question worth
 *    asking — there is no answer that would make an unrecognised key meaningful.
 *  - `validate` is the full contract, used after the ambiguity protocol has had its turn. A
 *    `required` failure at that point means a blocking gap was left unresolved, which is exactly
 *    the condition that must abort a run instead of producing a verdict.
 *
 * Keeping both in one object means the relaxed view cannot drift from the strict one.
 */
export interface LoadedSchema {
  readonly uri: string;
  readonly strict: JsonSchema;
  readonly relaxed: JsonSchema;
  validate(value: unknown): readonly SchemaError[];
  validatePartial(value: unknown): readonly SchemaError[];
  /** Validate strictly, throwing {@link import("./validate.ts").SchemaViolationError}. */
  assert(value: unknown): void;
  /** The declared `default` for a property, if the schema states one. */
  defaultOf(path: readonly string[]): unknown;
}

/**
 * Remove every `required` list, at any depth.
 *
 * Partial mode exists to answer one question: *is anything here wrong?* Whether something is
 * **absent** is the ambiguity protocol's business, and it fills absent values from declared defaults,
 * sibling files and the manifest. A nested `required` left in place would reject `limits: {}` before
 * the protocol ever saw it — turning a fillable gap into a hard failure and making the resolution
 * ladder unreachable for exactly the case it was built for.
 */
export function relaxSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "required" && Array.isArray(value)) continue;
      out[key] = walk(value);
    }
    return out;
  };
  return walk(schema) as JsonSchema;
}

const readPath = (schema: JsonSchema, path: readonly string[]): unknown => {
  let current: unknown = schema;
  for (const token of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
};

/**
 * The schemas Veridian enforces, loaded once and shared.
 *
 * Cross-file `$ref` resolution needs every document present before validation starts, so this is
 * loaded up front rather than lazily — a `$ref` that resolves only sometimes would be worse than
 * one that never does.
 */
export class SchemaSet {
  readonly #schemas = new Map<string, LoadedSchema>();
  readonly #loader: { load(uri: string): unknown };

  private constructor(loader: { load(uri: string): unknown }) {
    this.#loader = loader;
  }

  static async load(io: ReadonlyIoPort, uris: readonly string[]): Promise<SchemaSet> {
    const documents = new Map<string, JsonSchema>();
    for (const uri of uris) {
      const text = await io.readTextFile(uri);
      if (text === null) {
        throw new Error(
          `schema "${uri}" could not be read. Veridian's contracts live in the repository; a missing ` +
            "schema means no artifact of that kind can be trusted.",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`schema "${uri}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`schema "${uri}" must be a JSON object`);
      }
      documents.set(uri, parsed as JsonSchema);
    }

    const set = new SchemaSet({
      load(uri) {
        const found = documents.get(uri);
        if (found === undefined) {
          throw new Error(`schema "${uri}" was not loaded; add it to the SchemaSet's uri list`);
        }
        return found;
      },
    });

    for (const [uri, document] of documents) {
      set.#schemas.set(uri, set.#build(uri, document));
    }
    return set;
  }

  #build(uri: string, strict: JsonSchema): LoadedSchema {
    const relaxed = relaxSchema(strict);
    const strictValidator = new SchemaValidator(uri, strict, this.#loader);
    const relaxedValidator = new SchemaValidator(uri, relaxed, this.#loader);
    return {
      uri,
      strict,
      relaxed,
      validate: (value) => strictValidator.validate(value),
      validatePartial: (value) => relaxedValidator.validate(value),
      assert: (value) => strictValidator.assert(value),
      defaultOf: (path) => {
        const property = readPath(strict, path);
        return typeof property === "object" && property !== null
          ? (property as Record<string, unknown>)["default"]
          : undefined;
      },
    };
  }

  uris(): string[] {
    return [...this.#schemas.keys()].sort();
  }

  has(uri: string): boolean {
    return this.#schemas.has(uri);
  }

  get(uri: string): LoadedSchema {
    const found = this.#schemas.get(uri);
    if (!found) {
      throw new Error(
        `schema "${uri}" is not loaded. Loaded: ${this.uris().join(", ") || "(none)"}`,
      );
    }
    return found;
  }
}

/** The canonical locations of Veridian's contracts. */
export const SCHEMA_URIS = {
  goal: "schemas/goal.schema.json",
  acceptance: "schemas/acceptance.schema.json",
  environment: "schemas/environment.schema.json",
  run: "schemas/run.schema.json",
  result: "schemas/result.schema.json",
  ambiguity: "schemas/ambiguity.schema.json",
} as const;

export const ALL_SCHEMA_URIS: readonly string[] = Object.values(SCHEMA_URIS);

export async function loadSchemaSet(io: ReadonlyIoPort): Promise<SchemaSet> {
  return SchemaSet.load(io, ALL_SCHEMA_URIS);
}
