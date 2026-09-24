/**
 * dENV: which keys of an environment document may leave the process, and which of them are the
 * world's resources rather than the run's own facts.
 *
 * An ELI row is a reading of a run, and a run's bundle is written for the operator who ran it. Some
 * of what it holds is the *world* - its adapter, its app, its declared root, its measured boundaries -
 * and some of it is the *operator*: the command line that was issued, the environment that was
 * inherited, the times this run moved through its states. An export that carried the second kind
 * would not be a twin of the world; it would be a copy of somebody's shell.
 *
 * Two questions are asked here, and they are asked of one key set on purpose:
 *
 *  - **May this key leave?** (`decision`) - `kept` as declared, `rendered` into a form that keeps the
 *    world's own spelling without the operator's prefix, or `refused`.
 *  - **Is this key the world's, or this run's?** (`resource`) - and that is what makes **dENV**
 *    computable: the delta between two runs of one subject is taken over the resource keys only, so
 *    two runs of a world that came back to the same resources report an empty delta even though their
 *    timestamps, attempt counts and command lines all differ.
 *
 * One table answers both, for the reason `docs/DIGITAL-TWIN-PLAN.md` S4's Q6 gives: a second
 * vocabulary answering a question this one answers would be two spellings of one fact, and this tree
 * has already paid for that shape. The **shape** is `BOUNDARY_ENFORCEMENTS`': a `const` tuple of value
 * words with a type derived from it, carried as a *value* a key holds rather than as a field per
 * member - so a key added to the serialiser does not widen a type, it lands in `ruleFor`'s default
 * branch.
 *
 * The predicate is **total**, and that is the whole of its design. A predicate that refuses a named
 * list of keys is not a predicate: it is a list, and it is right up until a bundle carries a key
 * nobody thought of. `ruleFor` answers for every string, and a key it has no rule for is **refused**
 * rather than kept - so the failure mode of a field added after this was written is an export that is
 * missing a field, which a reader can see, rather than an export that leaks one, which a reader
 * cannot. `tests/denv-export.test.ts` holds both halves: that every key the serialiser produces has a
 * rule of its own (so the default branch is never silently doing the work), and that the default
 * branch is reached by a key invented after the table (so it is a branch and not a decoration).
 */

import { serializeEnvironment } from "../evidence/index.ts";
import type { EnvironmentRecord } from "../evidence/index.ts";

/**
 * What may happen to one key of an environment document.
 *
 * Three values rather than a boolean, because `refused` and `rendered` are not two degrees of one
 * decision: a refused key never appears in the document at all, while a rendered one appears under
 * the same name holding a different value - and a reader who took the two for one would look for a
 * missing key and not find a changed one. The names are this vocabulary's, and `kept` is deliberately
 * not `allowed`: what is kept is the *declaration*, unchanged, which is the specific promise the
 * refusals below make.
 */
export const EXPORT_DECISIONS = ["kept", "rendered", "refused"] as const;
export type ExportDecision = (typeof EXPORT_DECISIONS)[number];

/**
 * One key's rule.
 *
 * `reason` is required rather than optional, and it is a sentence rather than a tag: a refusal without
 * a reason is the empty refusal body this tree already rejected once - `sim-cloud`'s `refusalBody`
 * renders `{ kind, reason, status, message }` at every refusal site, and `docs/RULES-PAID-FOR.md`
 * records the rule it cost. A *reader* of an export needs to know why a key they expected is absent.
 */
export interface ExportRule {
  readonly decision: ExportDecision;
  /** Whether this key is part of the world's resource identity, and so comparable across two runs. */
  readonly resource: boolean;
  readonly reason: string;
}

/**
 * The table: every key `serializeEnvironment` writes, with the decision it gets.
 *
 * The keys are the **document's** spellings (`app_path`, `health_report`) and not the record's
 * (`appPath`, `healthReport`), because the document is what leaves. A predicate written over the
 * record's names would answer for keys that no artifact carries.
 */
export const EXPORT_RULES: Readonly<Record<string, ExportRule>> = Object.freeze({
  adapter: {
    decision: "kept",
    resource: true,
    reason: "the adapter that constructed the world is what the world is",
  },
  app: {
    decision: "kept",
    resource: true,
    reason: "the app is the subject of the run, not a property of the operator",
  },
  app_path: {
    decision: "rendered",
    resource: true,
    reason:
      "kept as the declaration, rendered to its last segment: the world's own spelling of where it " +
      "lives is its name, and the absolute prefix is the operator's checkout",
  },
  url: {
    decision: "kept",
    resource: true,
    reason: "a loopback url is the world's own address and names no host of the operator's",
  },
  database_path: {
    decision: "rendered",
    resource: true,
    reason: "as app_path: the declaration is kept, the absolute prefix is the operator's",
  },
  world: {
    decision: "rendered",
    resource: true,
    reason:
      "the identity block is the field phase 01 added for exactly this export, and it is walked " +
      "rather than copied: a `database` world is *named* after its file, and `detail` can hold a " +
      "root, an images directory or the application's command line",
  },
  command: {
    decision: "refused",
    resource: false,
    reason:
      "the command line that started the run is the operator's, and it is a field that is both an " +
      "input to the agent and an output of the recording",
  },
  args: {
    decision: "refused",
    resource: false,
    reason: "as command: the arguments carry whatever the contract author put on their own command line",
  },
  env: {
    decision: "refused",
    resource: false,
    reason: "the environment a repair agent inherited is the operator's, and it is where a token would be",
  },
  health: {
    decision: "kept",
    resource: true,
    reason: "the declared readiness check is part of how the world is asked to come up",
  },
  reset: {
    decision: "rendered",
    resource: true,
    reason:
      "the declared reset strategy is what M4 reproducibly replays; the command beside it is a " +
      "command line and is refused, on the same argument the top-level `command` is",
  },
  browser: {
    decision: "kept",
    resource: true,
    reason: "the declared browser is part of the world's shape, and it is a version string rather than a path",
  },
  valid: {
    decision: "kept",
    resource: true,
    reason:
      "a reading of the world rather than a fact about the run: two runs of one subject that disagree " +
      "about validity are two runs whose world did not come back the same",
  },
  health_report: {
    decision: "kept",
    resource: false,
    reason:
      "the measured probe is this run's - it carries `attempts` and `elapsedMs`, which are how long " +
      "this run waited rather than what the world is",
  },
  boundary: {
    decision: "rendered",
    resource: true,
    reason:
      "declared policy beside measured enforcement is the pair the whole boundary spine reports, " +
      "and a crossing's `subject` is the path that was refused - a location, rendered like the rest",
  },
  transitions: {
    decision: "kept",
    resource: false,
    reason:
      "the times this run moved through its states are the run's; the states are named in it, but " +
      "two runs of one world reach READY at two different instants",
  },
});

/**
 * A key the table has no rule for, which is refused by name.
 *
 * Built once and returned by reference so a caller comparing two rulings on unknown keys can see
 * that they are the same ruling rather than two reasons that happen to read alike.
 */
const UNRULED: ExportRule = Object.freeze({
  decision: "refused" as const,
  resource: false,
  reason: "no rule for this key: a field added after this table was written is refused rather than exported",
});

/**
 * The rule for one key - **total**, in that it answers for every string.
 *
 * The default is `refused` and not `kept`, and the direction is the point: a new field of the
 * environment record is a field nobody has decided about, and the two ways to be wrong are not
 * symmetric. Refusing it by default produces an export missing a field, which a reader notices;
 * keeping it by default produces an export carrying whatever the new field holds, which nobody
 * notices until it matters.
 */
export const ruleFor = (key: string): ExportRule => EXPORT_RULES[key] ?? UNRULED;

/** A key the export refused, with the reason it was refused. */
export interface RefusedKey {
  readonly key: string;
  readonly reason: string;
}

/** A key whose value was **rendered** into a form that keeps the declaration without the operator. */
export interface RenderedKey {
  /** The document's own spelling of where the value sat, dotted - `world.detail.root`. */
  readonly path: string;
  readonly reason: string;
}

export interface EnvExport {
  /** The document that may leave. Never carries a refused key under any name. */
  readonly document: Readonly<Record<string, unknown>>;
  /**
   * What was refused, with the reason - recorded rather than silent.
   *
   * A refusal is an observation, on the same argument that gives `sim-cloud` a `refusalBody`: a
   * status code is a verdict and the body is the evidence. An export that dropped `env` and said
   * nothing would be indistinguishable from a record that never had one.
   */
  readonly refused: readonly RefusedKey[];
  /**
   * What was **rendered**, with the reason, for the same argument - and this half is the one that
   * `refused` cannot make.
   *
   * A rendered value is still *present*; only its prefix is gone. A reader who compared the export
   * against the bundle and found `app_path: shopping-cart` where the bundle said
   * `D:\...\examples\shopping-cart` has found a difference, not a loss, and the difference is
   * deliberate. Without this list that difference is indistinguishable from a value the exporter
   * silently rewrote, which is the failure mode a sanitizer has.
   */
  readonly rendered: readonly RenderedKey[];
}

/** The last segment of a path, under either separator - the world's own spelling of what it names. */
const lastSegment = (path: string): string => {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.length === 0 ? path : (parts[parts.length - 1] as string);
};

/** Render a declared path as the world's own spelling: its name, without the operator's prefix. */
const renderPath = (value: unknown): unknown => (typeof value === "string" ? lastSegment(value) : value);

/** Where a render was recorded, and why. Threaded through the walk rather than rebuilt per branch. */
interface ExportRecord {
  readonly refused: RefusedKey[];
  readonly rendered: RenderedKey[];
}

/** Render a path **and record it**, but only when the rendering actually changed the value. */
const renderPathAt = (value: unknown, path: string, reason: string, record: ExportRecord): unknown => {
  const renderedValue = renderPath(value);
  if (renderedValue !== value) record.rendered.push({ path, reason });
  return renderedValue;
};

/**
 * Keys inside `world.detail` that name a location the world's own spelling is the last segment of.
 *
 * They are enumerated rather than recognised by shape, and the reason is a counter-example already in
 * this document: `health.path` holds `/health`, a *route*, and a shape test for "starts with a
 * separator" cannot tell it from `/usr/bin`. A reader who reached for the shape would render every
 * health check in the tree to `health`.
 */
const IDENTITY_PATHS: readonly string[] = ["root", "images", "path"];

/**
 * Keys inside `world.detail` that carry a command line, refused for the reason `command` is refused.
 *
 * `command` is here because `worldIdentity()` writes `child.application.command` into it, and `args`
 * because it writes `child.application.args.join(" ")` - which is the operator's own command line
 * reaching the export through the identity block rather than through the top-level fields that
 * already refuse it. Same value class, one level down.
 */
const IDENTITY_COMMANDS: readonly string[] = ["command", "args"];

/**
 * The identity block, exported - and it is the one key whose ruling **depends on its own contents**.
 *
 * `kind` is kept exactly as declared, because a reader needs it to interpret `name`: **`name` is a
 * location for one kind and an account for another.** `worldIdentity()` names a `database` world
 * after `plan.databasePath` - measured on this repository's own bundle `run-20260915-225605-a3a48e`
 * as `D:/all_projects/Veridian/examples/inventory-db/app/data.db` - and names a `cloud` world after
 * `cloud.account`. So the same key is a leak for one kind and the whole point of the export for
 * another, and no rule written per *key* can express that. The rule is written here, where `kind` is
 * in hand, which is why this key is `rendered` rather than `kept`.
 *
 * The alternative was to leave `world` as `kept` and accept that one kind's `name` and `detail.path`
 * carry the operator's checkout. It was rejected because `database_path` - the *same resolved value*,
 * one key over - is already ruled `rendered`: keeping it in one slot while rendering it in another is
 * one value with two rulings, and the second ruling is the one a reader would not think to check.
 */
const renderWorldIdentity = (value: unknown, record: ExportRecord): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const block = value as Record<string, unknown>;
  const kind = typeof block["kind"] === "string" ? block["kind"] : "";

  // A `database` world is named after its file, so its name is the one world name that is a location.
  const name =
    kind === "database"
      ? renderPathAt(block["name"], "world.name", `a \`${kind}\` world is named after its file`, record)
      : block["name"];

  const detail = block["detail"];
  let renderedDetail = detail;
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(detail as Record<string, unknown>)) {
      if (IDENTITY_COMMANDS.includes(key)) {
        record.refused.push({
          key: `world.detail.${key}`,
          reason: "the application's command line, reached through the identity block",
        });
        continue;
      }
      out[key] = IDENTITY_PATHS.includes(key)
        ? renderPathAt(entry, `world.detail.${key}`, "a location the world's own spelling names", record)
        : entry;
    }
    renderedDetail = out;
  }

  return { kind: block["kind"], name, detail: renderedDetail };
};

/**
 * The boundary report, exported - walked for one field.
 *
 * `crossings[].subject` is the path a request was refused at, so it is a location on the filesystem
 * the world confined. It is the one nested value in this block that carries an operator prefix; the
 * policies and the enforcement words are a vocabulary, and a vocabulary has no prefix to lose.
 */
const renderBoundary = (value: unknown, record: ExportRecord): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const block = value as Record<string, unknown>;
  const crossings = block["crossings"];
  if (!Array.isArray(crossings)) return value;

  return {
    ...block,
    crossings: crossings.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
      const crossing = { ...(entry as Record<string, unknown>) };
      if (Object.hasOwn(crossing, "subject")) {
        crossing["subject"] = renderPathAt(
          crossing["subject"],
          "boundary.crossings.subject",
          "the path the crossing was refused at",
          record,
        );
      }
      return crossing;
    }),
  };
};

/**
 * The reset block, exported - the strategy is kept and the command is refused.
 *
 * A `null` command is **not** a refusal: it declares that this world resets with no command, which
 * is a fact the strategy already carries, and recording a refusal about it would be a refusal about
 * nothing. The same rule the identity block's absent `command` follows.
 */
const renderReset = (value: unknown, record: ExportRecord): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "command" && entry !== null) {
      record.refused.push({
        key: "reset.command",
        reason: "the command that replays the reset is a command line, as the top-level `command` is",
      });
      continue;
    }
    out[key] = entry;
  }
  return out;
};

/** The renderer a `rendered` key gets. A key with no entry here is copied through unchanged. */
const RENDERERS: Readonly<Record<string, (value: unknown, record: ExportRecord) => unknown>> = {
  app_path: (value, record) =>
    renderPathAt(value, "app_path", "the declaration is kept, the operator's prefix is not", record),
  database_path: (value, record) =>
    renderPathAt(value, "database_path", "the declaration is kept, the operator's prefix is not", record),
  world: renderWorldIdentity,
  boundary: renderBoundary,
  reset: renderReset,
};

/**
 * The export: the document that leaves, the refusals that produced it, and what was rendered.
 *
 * It reads the record through `serializeEnvironment` rather than walking `EnvironmentRecord` itself,
 * so the key set this predicate decides is **the same key set the bundle writes** - one serialiser,
 * one predicate, and no way for the two to hold different opinions about what an environment document
 * contains. A predicate over the record's own fields would be a second description of the document,
 * and the first field added to one and not the other is the whole of the defect.
 *
 * Three keys are `rendered` rather than `kept` because their values are **structures**, and the leak
 * this predicate exists to close is not always at the top level: a `database` world's *name* is its
 * file, `world.detail` can hold a root or the application's command line, and a boundary crossing's
 * `subject` is the path that was refused. Keeping the block as a unit would have kept all three.
 * `RENDERERS` is where each one's rule lives, and a key ruled `rendered` with no entry there is
 * copied through - which is a branch `tests/denv-export.test.ts` holds, because a renderer registry
 * with an unreachable default is a registry nothing is checking.
 */
export function exportEnvironment(record: EnvironmentRecord): EnvExport {
  return exportDocument(serializeEnvironment(record));
}

/**
 * The export over a document that is already serialized - which is the shape a reader has when the
 * document came off disk.
 *
 * It exists because an export path has two callers and only one of them holds an `EnvironmentRecord`.
 * A bundle's `environment.json` is a document, and the interchange writer reads documents; a test
 * holds a record. Routing the second through the first is what keeps them from being two predicates:
 * `exportEnvironment` is now one line, and there is nowhere for the two to disagree.
 */
export function exportDocument(serialized: Readonly<Record<string, unknown>>): EnvExport {
  const document: Record<string, unknown> = {};
  const log: ExportRecord = { refused: [], rendered: [] };

  for (const [key, value] of Object.entries(serialized)) {
    const rule = ruleFor(key);
    if (rule.decision === "refused") {
      log.refused.push({ key, reason: rule.reason });
      continue;
    }
    if (rule.decision === "rendered") {
      const render = RENDERERS[key];
      document[key] = render === undefined ? value : render(value, log);
      continue;
    }
    document[key] = value;
  }

  return { document, refused: log.refused, rendered: log.rendered };
}

/** One key whose value differs between two readings of the same subject. */
export interface EnvDifference {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * Canonical JSON, so two readings that differ only in key order compare equal.
 *
 * `JSON.stringify` alone is not enough: it preserves insertion order, so a document written by a
 * future serialiser that built its object in a different order would report a delta on every key at
 * once. That failure would read as a world that did not come back, which is the one reading this
 * function exists to make trustworthy.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
};

/**
 * **dENV** - the delta between two readings of one subject, over the resource keys only.
 *
 * `AC-5` states the property as "ΔENV over two runs of one subject is **empty** (the world came back
 * to the same resources)", and the second clause is the load-bearing one: *empty* alone is satisfied
 * by a function that returns nothing, so the resource/authored split above is what gives the empty
 * answer its meaning. A comparison taken over every key would be non-empty between any two runs of
 * any world, because every run happens at a different time.
 *
 * The union of both key sets is walked rather than either one alone, so a key that was **added** or
 * **removed** between two readings is a difference. A walk over the intersection would report a world
 * that came back with one resource fewer as having come back the same, which is the failure mode of a
 * delta computed from the wrong side.
 *
 * A key with no rule, and a key whose rule refuses it, are both skipped: neither is comparable, and
 * reporting a refused key's change would be reporting a value that no export may carry.
 */
export function envDelta(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly EnvDifference[] {
  const differences: EnvDifference[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!ruleFor(key).resource) continue;
    const was = before[key];
    const now = after[key];
    if (canonicalJson(was) !== canonicalJson(now)) differences.push({ key, before: was, after: now });
  }
  return differences;
}
