import { isAbsolute, join } from "node:path";

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

/**
 * Whether a reference is rooted in its own right, so it replaces the base instead of joining it.
 *
 * **Two predicates, not one.** This is the join's question - "does this reference stand on its own?"
 * - and it is not the same question as the collapse's `rooted` flag further down, which asks "was
 * there a leading separator that the collapse must not eat?". A drive-letter path answers *yes* to
 * the first and *no* to the second, because `D:/x` has no empty first segment to preserve. Treating
 * them as one predicate is what cost this defect: the comment below reasoned carefully about Windows
 * drive letters while only the collapse was reading it, and the join was left testing
 * `startsWith("/")` - a POSIX-only spelling of "absolute".
 *
 * The consequence was measurable and looked nothing like a path bug. An environment document naming
 * `app: D:/repo/examples/shopping-cart/app` - the natural way to write an absolute path here - had
 * that reference *joined* onto the document's own directory, producing
 * `D:/all_projects/Veridian/.scratch/vgap/D:/all_projects/Veridian/examples/shopping-cart/app`. The
 * child was then started in a directory that does not exist, so `node serve.mjs` could not find its
 * script, exited without printing, and the run reported
 * `the application exited with code null before printing /shopping-cart listening on .../` with
 * `stderr:` empty - a message that names the application for a fault in the join, which is the same
 * shape as the relative-directory defect this function's caller was repaired for one pass earlier.
 *
 * A UNC path needs no case of its own: `\\server\share` is normalised to `//server/share` before
 * this is called, so it starts with `/` and is already answered by the first clause.
 */
const standsAlone = (reference: string): boolean =>
  reference.startsWith("/") || /^[A-Za-z]:\//.test(reference);

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
  const combined = standsAlone(reference) || dir === "" ? reference : `${dir}/${reference}`;
  /**
   * Whether the result carries a leading separator the collapse must not eat.
   *
   * Deliberately *not* {@link standsAlone}: this is the second of the two questions above. An
   * absolute POSIX path splits into an empty first segment, and skipping empty segments - which is
   * what collapses `//`, `./` and a trailing `/` - would delete the root along with them, turning
   * `/home/x/acceptance.yaml` into the relative `home/x/acceptance.yaml`. That path is then resolved
   * against the process cwd, so the file is reported missing while it sits in plain sight, and the
   * reader is sent to inspect the one thing that is not broken.
   *
   * A drive-letter path needs nothing here: `D:/x/acceptance.yaml` has no empty first segment, so its
   * drive letter is an ordinary part and survives the join below untouched - and folding it into this
   * test would prefix it into `/D:/x/acceptance.yaml`, which is the opposite of the repair.
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

  /**
   * The directory is the port's own root joined onto the caller's spelling, so a document named
   * relatively still yields an **absolute** directory - and everything resolved against it is
   * absolute too.
   *
   * Joining the two spellings without this was a defect that produced a pass-shaped failure, and it
   * was measured in both directions before it was fixed. `appPath` is `resolveSibling(source, app)`,
   * a string join, so `--goal examples/shopping-cart/goal.yaml` - which is the *documented default*
   * spelling, since `--goal` defaults to a bare `goal.yaml` - produced the relative
   * `examples/shopping-cart/app`. Two consumers take that path and only one of them tolerates it:
   * `spawn`'s `cwd` resolves a relative value against the process working directory and landed in the
   * right place, while `--permission`'s `readRoots` compares **absolute real paths**, so the child's
   * every read was refused `ERR_ACCESS_DENIED`, the server answered 404 for every path, and the run
   * ended `ENVIRONMENT_FAILURE - expected 200 from http://127.0.0.1:4317/, received 404`. The same
   * command with an absolute goal path passed. So the relative spelling named a directory that
   * genuinely existed and could not be read, and the failure line blamed the application.
   *
   * Fixed here rather than in the adapter, because this is the one place that decides which directory
   * a document is in, and because every caller - the command line, the extension, the metrics reader
   * and each other surface - reaches its paths through this function. An adapter-level repair would
   * have left `cwd` correct only by the accident of where the process happened to be started, which is
   * the outcome the loader's own comment beside `appPath` already says it exists to prevent.
   *
   * `path` is deliberately left as the caller spelled it: it is what the operator typed, so an error
   * or a report quoting it sends the reader back to their own command line. `dir` is the resolved
   * one, because a directory is a thing to be joined onto rather than a thing to be shown.
   */
  const dir = dirOf(isAbsolute(path) ? path : join(io.cwd, path));

  return { raw: parsed, source: { path, dir, text }, schemaUri: options.schemaUri };
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
