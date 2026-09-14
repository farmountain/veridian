export { SchemaValidator, SchemaViolationError, resolveUri, validateAgainst } from "./validate.ts";
export type { JsonSchema, SchemaError, SchemaLoader } from "./validate.ts";

export {
  ALL_SCHEMA_URIS,
  SCHEMA_URIS,
  SchemaSet,
  loadSchemaSet,
  relaxSchema,
} from "./registry.ts";
export type { LoadedSchema } from "./registry.ts";
