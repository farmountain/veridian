/**
 * A minimal JSON Schema validator.
 *
 * Veridian's whole claim rests on explicit, machine-readable contracts, and a contract that is
 * never evaluated is documentation. This module exists so `schemas/*.schema.json` are *enforced*:
 * a malformed `goal.yaml` fails at the boundary with a path and a reason, instead of becoming a
 * confusing failure three layers later inside a validator.
 *
 * Deliberately not `ajv`: the supported subset is small, closed, and auditable, which is a better
 * fit than a large general-purpose engine with its own resolution semantics. Unsupported keywords
 * are ignored rather than silently misapplied.
 */

export interface SchemaError {
  /** Accessor-style location, e.g. `$.criteria[2].id`. */
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

export type JsonSchema = Record<string, unknown>;

/** Loads a sibling schema document. Only needed when a `$ref` crosses files. */
export interface SchemaLoader {
  /** `uri` is a normalised, `/`-separated path such as `schemas/result.schema.json`. */
  load(uri: string): unknown;
}

export class SchemaViolationError extends Error {
  readonly uri: string;
  readonly errors: readonly SchemaError[];

  constructor(uri: string, errors: readonly SchemaError[]) {
    super(
      `${uri} does not satisfy its schema:\n` +
        errors.map((e) => `  - ${e.path}: ${e.message} (${e.keyword})`).join("\n"),
    );
    this.name = "SchemaViolationError";
    this.uri = uri;
    this.errors = errors;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const typeName = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const matchesType = (value: unknown, type: string): boolean => {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true; // An unknown type name cannot be meaningfully checked; the keyword is ignored.
  }
};

const joinPath = (path: string, token: string | number): string =>
  typeof token === "number" ? `${path}[${token}]` : `${path}.${token}`;

const brief = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}...` : value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (isPlainObject(value)) return `object(${Object.keys(value).length} keys)`;
  return typeName(value);
};

/** Normalise `dir/a.json` + `../b.json` into a repo-relative `/`-separated uri. */
export function resolveUri(baseUri: string, reference: string): string {
  const baseParts = baseUri.split("/");
  baseParts.pop();
  for (const part of reference.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

export class SchemaValidator {
  readonly #uri: string;
  readonly #root: JsonSchema;
  readonly #loader: SchemaLoader | undefined;
  /** Guards against schema-level `$ref` cycles, which would otherwise never terminate. */
  readonly #refStack = new Set<string>();

  constructor(uri: string, schema: JsonSchema, loader?: SchemaLoader) {
    this.#uri = uri;
    this.#root = schema;
    this.#loader = loader;
  }

  validate(value: unknown): readonly SchemaError[] {
    const errors: SchemaError[] = [];
    this.#check(this.#root, value, "$", this.#uri, errors);
    return errors;
  }

  /** Throws {@link SchemaViolationError} if the value does not conform. Convenience for boundaries. */
  assert(value: unknown): void {
    const errors = this.validate(value);
    if (errors.length > 0) throw new SchemaViolationError(this.#uri, errors);
  }

  #fail(errors: SchemaError[], path: string, keyword: string, message: string): void {
    errors.push({ path, keyword, message });
  }

  /**
   * One canonical form for a resolution target, used both to detect cycles and to key the stack.
   * Having two spellings of the same target — `uri#/a/b` versus `uri##/a/b` — would make the cycle
   * guard a decoration that never fires.
   */
  #refKey(uri: string, pointer: string): string {
    const normalised = pointer === "" || pointer === "/" ? "" : pointer.startsWith("/") ? pointer : `/${pointer}`;
    return `${uri}#${normalised}`;
  }

  /**
   * Resolve a `$ref`, which may name a sibling document (`result.schema.json#/$defs/X`).
   * Returns `null` when the target cannot be loaded, after recording why.
   */
  #resolve(
    ref: string,
    baseUri: string,
    path: string,
    errors: SchemaError[],
  ): { schema: JsonSchema; uri: string; key: string } | null {
    const hash = ref.indexOf("#");
    const file = hash === -1 ? ref : ref.slice(0, hash);
    const pointer = hash === -1 ? "" : ref.slice(hash + 1);
    const uri = file === "" ? baseUri : resolveUri(baseUri, file);

    let document: unknown;
    if (uri === this.#uri) {
      document = this.#root;
    } else if (this.#loader) {
      try {
        document = this.#loader.load(uri);
      } catch (error) {
        this.#fail(
          errors,
          path,
          "$ref",
          `cannot load referenced schema "${uri}": ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    } else {
      this.#fail(errors, path, "$ref", `external schema "${uri}" referenced but no loader was provided`);
      return null;
    }

    const key = this.#refKey(uri, pointer);
    if (this.#refStack.has(key)) {
      this.#fail(errors, path, "$ref", `cyclical schema reference "${key}"`);
      return null;
    }

    let target: unknown = document;
    if (pointer !== "" && pointer !== "/") {
      for (const raw of pointer.replace(/^\//, "").split("/")) {
        const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        if (!isPlainObject(target) || !(token in target)) {
          this.#fail(errors, path, "$ref", `reference "${ref}" does not resolve`);
          return null;
        }
        target = target[token];
      }
    }

    if (!isPlainObject(target)) {
      this.#fail(errors, path, "$ref", `reference "${ref}" resolves to a non-schema value`);
      return null;
    }
    return { schema: target, uri, key };
  }

  #check(
    schema: JsonSchema,
    value: unknown,
    path: string,
    uri: string,
    errors: SchemaError[],
  ): void {
    const ref = schema["$ref"];
    if (typeof ref === "string") {
      const resolved = this.#resolve(ref, uri, path, errors);
      if (!resolved) return;
      this.#refStack.add(resolved.key);
      try {
        this.#check(resolved.schema, value, path, resolved.uri, errors);
      } finally {
        this.#refStack.delete(resolved.key);
      }
      return;
    }

    const declaredType = schema["type"];
    if (declaredType !== undefined) {
      const types = Array.isArray(declaredType) ? declaredType : [declaredType];
      const ok = types.some((t) => typeof t === "string" && matchesType(value, t));
      if (!ok) {
        this.#fail(
          errors,
          path,
          "type",
          `expected ${types.map(String).join(" | ")}, received ${typeName(value)}`,
        );
        return; // Every further keyword is meaningless once the type is wrong.
      }
    }

    if (Array.isArray(schema["enum"])) {
      const allowed = schema["enum"] as unknown[];
      if (!allowed.some((candidate) => Object.is(candidate, value))) {
        this.#fail(errors, path, "enum", `${brief(value)} is not one of ${allowed.map(brief).join(", ")}`);
      }
    }

    if ("const" in schema && !Object.is(schema["const"], value)) {
      this.#fail(errors, path, "const", `expected ${brief(schema["const"])}, received ${brief(value)}`);
    }

    if (typeof value === "string") this.#checkString(schema, value, path, errors);
    if (typeof value === "number") this.#checkNumber(schema, value, path, errors);
    if (Array.isArray(value)) this.#checkArray(schema, value, path, uri, errors);
    if (isPlainObject(value)) this.#checkObject(schema, value, path, uri, errors);

    this.#checkCombinators(schema, value, path, uri, errors);
  }

  #checkString(schema: JsonSchema, value: string, path: string, errors: SchemaError[]): void {
    const minLength = schema["minLength"];
    if (typeof minLength === "number" && value.length < minLength) {
      this.#fail(errors, path, "minLength", `must be at least ${minLength} characters`);
    }
    const maxLength = schema["maxLength"];
    if (typeof maxLength === "number" && value.length > maxLength) {
      this.#fail(errors, path, "maxLength", `must be at most ${maxLength} characters`);
    }
    const pattern = schema["pattern"];
    if (typeof pattern === "string") {
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        this.#fail(errors, path, "pattern", `schema declares an invalid pattern: ${pattern}`);
        return;
      }
      if (!re.test(value)) {
        this.#fail(errors, path, "pattern", `${brief(value)} does not match /${pattern}/`);
      }
    }
  }

  #checkNumber(schema: JsonSchema, value: number, path: string, errors: SchemaError[]): void {
    const minimum = schema["minimum"];
    if (typeof minimum === "number" && value < minimum) {
      this.#fail(errors, path, "minimum", `${value} is less than the minimum ${minimum}`);
    }
    const maximum = schema["maximum"];
    if (typeof maximum === "number" && value > maximum) {
      this.#fail(errors, path, "maximum", `${value} exceeds the maximum ${maximum}`);
    }
    const exclusiveMinimum = schema["exclusiveMinimum"];
    if (typeof exclusiveMinimum === "number" && value <= exclusiveMinimum) {
      this.#fail(errors, path, "exclusiveMinimum", `${value} must be greater than ${exclusiveMinimum}`);
    }
    const exclusiveMaximum = schema["exclusiveMaximum"];
    if (typeof exclusiveMaximum === "number" && value >= exclusiveMaximum) {
      this.#fail(errors, path, "exclusiveMaximum", `${value} must be less than ${exclusiveMaximum}`);
    }
    const multipleOf = schema["multipleOf"];
    if (typeof multipleOf === "number" && multipleOf > 0 && Math.abs(value / multipleOf - Math.round(value / multipleOf)) > 1e-9) {
      this.#fail(errors, path, "multipleOf", `${value} is not a multiple of ${multipleOf}`);
    }
  }

  #checkArray(
    schema: JsonSchema,
    value: readonly unknown[],
    path: string,
    uri: string,
    errors: SchemaError[],
  ): void {
    const minItems = schema["minItems"];
    if (typeof minItems === "number" && value.length < minItems) {
      this.#fail(errors, path, "minItems", `needs at least ${minItems} item(s), has ${value.length}`);
    }
    const maxItems = schema["maxItems"];
    if (typeof maxItems === "number" && value.length > maxItems) {
      this.#fail(errors, path, "maxItems", `allows at most ${maxItems} item(s), has ${value.length}`);
    }
    const items = schema["items"];
    if (isPlainObject(items)) {
      value.forEach((item, index) => this.#check(items, item, joinPath(path, index), uri, errors));
    }
  }

  #checkObject(
    schema: JsonSchema,
    value: Record<string, unknown>,
    path: string,
    uri: string,
    errors: SchemaError[],
  ): void {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          this.#fail(errors, path, "required", `missing required property "${key}"`);
        }
      }
    }

    const properties = schema["properties"];
    if (isPlainObject(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        if (key in value && isPlainObject(child)) {
          this.#check(child, value[key], joinPath(path, key), uri, errors);
        }
      }
    }

    if (schema["additionalProperties"] === false && isPlainObject(properties)) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          this.#fail(
            errors,
            joinPath(path, key),
            "additionalProperties",
            `unknown property "${key}". Veridian rejects unknown keys: a silently ignored field is a ` +
              "requirement the author believed was in force.",
          );
        }
      }
    }
  }

  #checkCombinators(
    schema: JsonSchema,
    value: unknown,
    path: string,
    uri: string,
    errors: SchemaError[],
  ): void {
    const anyOf = schema["anyOf"];
    if (Array.isArray(anyOf)) {
      const ok = anyOf.some((branch) => isPlainObject(branch) && this.#isValid(branch, value, uri));
      if (!ok) this.#fail(errors, path, "anyOf", "does not match any of the permitted forms");
    }

    const oneOf = schema["oneOf"];
    if (Array.isArray(oneOf)) {
      const matches = oneOf.filter(
        (branch) => isPlainObject(branch) && this.#isValid(branch, value, uri),
      ).length;
      if (matches === 0) {
        this.#fail(errors, path, "oneOf", "does not match any of the permitted forms");
      } else if (matches > 1) {
        // Ambiguity is a defect, not a convenience: two matching forms mean the contract does not
        // say which one this is, and downstream code would have to guess.
        this.#fail(
          errors,
          path,
          "oneOf",
          `matches ${matches} permitted forms; exactly one is required`,
        );
      }
    }

    const allOf = schema["allOf"];
    if (Array.isArray(allOf)) {
      for (const branch of allOf) {
        if (isPlainObject(branch)) this.#check(branch, value, path, uri, errors);
      }
    }

    const not = schema["not"];
    if (isPlainObject(not) && this.#isValid(not, value, uri)) {
      this.#fail(errors, path, "not", "matches a form the schema forbids");
    }
  }

  #isValid(schema: JsonSchema, value: unknown, uri: string): boolean {
    const probe: SchemaError[] = [];
    this.#check(schema, value, "$", uri, probe);
    return probe.length === 0;
  }
}

export function validateAgainst(
  schema: JsonSchema,
  value: unknown,
  uri = "<inline>",
  loader?: SchemaLoader,
): readonly SchemaError[] {
  return new SchemaValidator(uri, schema, loader).validate(value);
}
