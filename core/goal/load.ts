import { parse as parseYaml } from "yaml";

import type { ReadonlyIoPort } from "../io.ts";
import { SCHEMA_URIS, type SchemaError, type SchemaSet } from "../schema/index.ts";
import type { Goal, GoalDocument, GoalLimits, SourceRef } from "./types.ts";

/** Raised when a definition is *wrong*, as opposed to merely incomplete. */
export class DefinitionError extends Error {
  readonly uri: string;
  readonly errors: readonly SchemaError[];

  constructor(uri: string, errors: readonly SchemaError[]) {
    super(
      `${uri} is not a valid definition:\n` + errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n"),
    );
    this.name = "DefinitionError";
    this.uri = uri;
    this.errors = errors;
  }
}

/** Directory portion of a POSIX-style relative path, `"."` when there is none. */
export function dirOf(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  const index = normalised.lastIndexOf("/");
  return index === -1 ? "." : normalised.slice(0, index);
}

/** Join a relative reference onto a source's directory, collapsing `.` and `..`. */
export function resolveSibling(source: SourceRef, relative: string): string {
  const dir = source.dir.replace(/\\/g, "/");
  const reference = relative.replace(/\\/g, "/");
  /**
   * A reference is joined to its directory only when there is a directory to join it to.
   *
   * An empty directory means the current directory, so inserting one in front of the reference would
   * invent a leading separator that nothing asked for. That is not a cosmetic difference, because the
   * collapse below reads a leading separator as a root marker. Measured: a document one directory
   * below the repository that declares `app: ..` collapses to the empty directory, and
   * `${""}/${"sandbox"}` is `/sandbox`, so the run looked for `D:/sandbox` - two levels above the
   * sandbox the document describes - and the one field whose whole job is to let a reader compare the
   * reading against their own document reported it as `(root ../../sandbox)`.
   *
   * The clause is reachable only through this function's own entry, since the collapse at the end
   * never returns `""` and `dirOf` spells "no directory" as `"."` - which this test removes the need
   * to special-case, because `./sandbox` and `sandbox` collapse alike where `/sandbox` does not.
   */
  const combined = reference.startsWith("/") || dir === "" ? reference : `${dir}/${reference}`;
  /**
   * Whether the result is rooted decides whether the root survives the collapse below.
   *
   * An absolute POSIX path splits into an empty first segment, and skipping empty segments - which
   * is what collapses `//`, `./` and a trailing `/` - would delete the root along with them, turning
   * `/home/x/acceptance.yaml` into the relative `home/x/acceptance.yaml`. That path is then resolved
   * against the process cwd, so the file is reported missing while it sits in plain sight, and the
   * reader is sent to inspect the one thing that is not broken.
   *
   * Windows never had the problem: `D:/x/acceptance.yaml` has no empty first segment, so the root
   * is a drive letter and survives. That asymmetry is why this lasted - the tree was developed on
   * one platform, where the shape of a path hides the difference between the two.
   */
  const rooted = combined.startsWith("/");
  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const collapsed = rooted ? `/${parts.join("/")}` : parts.join("/");
  /**
   * A reference that collapses to nothing names the directory it was resolved against, and the empty
   * string is not a directory.
   *
   * It is the second half of the defect above rather than a tidiness: every caller that uses this
   * result as a base builds `${base}/${child}` with it, which is how the leading separator gets back
   * in. Returning `"."` keeps the answer a directory at every stage, so no caller has to know that
   * one spelling of "here" is safe and the other is not. The POSIX root is unaffected - it collapses
   * to `"/"`, which is not empty.
   */
  return collapsed === "" ? "." : collapsed;
}

/**
 * Parse YAML or JSON.
 *
 * One parser for both, because YAML is a superset of JSON — having two code paths would mean two
 * chances to differ on something as basic as how a number is read.
 */
export function parseDocument(text: string, path: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} could not be parsed: ${detail}`);
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface LoadOptions {
  /** Human-readable description used in error messages, e.g. "goal". */
  readonly what: string;
  /** Schema uri to inspect against. */
  readonly schemaUri: string;
}

/**
 * Read and inspect a definition document.
 *
 * Inspection is deliberately *partial*: everything except absence is enforced here. A misspelled
 * key, a wrong type or an out-of-range value is a defect with no question to ask; an absent value is
 * a question, and the ambiguity protocol owns it. Conflating the two would either make the protocol
 * unreachable or let genuine defects through.
 */
export async function loadDocument(
  io: ReadonlyIoPort,
  path: string,
  schemas: SchemaSet,
  options: LoadOptions,
): Promise<GoalDocument & { readonly schemaUri: string }> {
  const text = await io.readTextFile(path);
  if (text === null) {
    throw new DefinitionError(`<missing>`, [
      { path, keyword: "required", message: `${options.what} file "${path}" does not exist` },
    ]);
  }
  if (text.trim() === "") {
    throw new DefinitionError(path, [
      { path: "$", keyword: "required", message: `${options.what} file "${path}" is empty` },
    ]);
  }

  const parsed = parseDocument(text, path);
  if (!isPlainObject(parsed)) {
    throw new DefinitionError(path, [
      {
        path: "$",
        keyword: "type",
        message: `${options.what} must be a mapping, received ${Array.isArray(parsed) ? "a sequence" : typeof parsed}`,
      },
    ]);
  }

  const errors = schemas.get(options.schemaUri).validatePartial(parsed);
  if (errors.length > 0) throw new DefinitionError(path, errors);

  return { raw: parsed, source: { path, dir: dirOf(path), text }, schemaUri: options.schemaUri };
}

export async function loadGoalDocument(
  io: ReadonlyIoPort,
  path: string,
  schemas: SchemaSet,
): Promise<GoalDocument & { readonly schemaUri: string }> {
  return loadDocument(io, path, schemas, { what: "goal", schemaUri: SCHEMA_URIS.goal });
}

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0): number => (typeof value === "number" ? value : fallback);
/**
 * Read a list of strings, dropping anything that is not one.
 *
 * A non-string entry is dropped rather than stringified: `allow-list: [443]` is a goal that has not
 * decided what an origin looks like, and coercing it to `"443"` would invent a host that could then
 * be permitted. An unrecognised entry must never be able to widen a boundary.
 */
const asStringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

function readLimits(raw: Readonly<Record<string, unknown>>): GoalLimits {
  const limits = isPlainObject(raw["limits"]) ? raw["limits"] : {};
  return {
    maxIterations: asNumber(limits["maxIterations"]),
    maxRuntimeMs: asNumber(limits["maxRuntimeMs"]),
    maxCriterionMs: asNumber(limits["maxCriterionMs"]),
    networkPolicy: asString(limits["networkPolicy"], "deny") as GoalLimits["networkPolicy"],
    networkAllowList: asStringList(limits["networkAllowList"]),
    filesystemWrite: asString(limits["filesystemWrite"], "sandbox") as GoalLimits["filesystemWrite"],
  };
}

/**
 * Turn a resolved document into a {@link Goal}.
 *
 * Called *after* the ambiguity protocol. A failure here is therefore not a user error to report and
 * move past: it means a blocking gap survived resolution, which must abort the run rather than let
 * it produce a verdict from a contract nobody finished writing.
 */
export function finalizeGoal(
  raw: Readonly<Record<string, unknown>>,
  schemas: SchemaSet,
): Goal {
  const schema = schemas.get(SCHEMA_URIS.goal);
  schema.assert(raw);

  const context = raw["context"];
  const tags = raw["tags"];
  return {
    version: asNumber(raw["version"], 1),
    id: asString(raw["id"]),
    statement: asString(raw["statement"]),
    context: typeof context === "string" ? context : null,
    acceptance: asString(raw["acceptance"], "acceptance.yaml"),
    environment: asString(raw["environment"], "environment.yaml"),
    limits: readLimits(raw),
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
  };
}
