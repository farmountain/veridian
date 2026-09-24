/**
 * The twin surface: the ELI, read from the bundles on disk and rendered as text.
 *
 * ## What this is, and what it deliberately is not
 *
 * `docs/DIGITAL-TWIN-PLAN.md` W1 defines the **ELI** as a join: one row per run on disk, grouped by
 * subject, where the subject is `<goal-id>@<adapter>`. `docs/phases/05-the-cockpit-twin-surface.md`
 * asks the Cockpit to *read that join and render it*, and the phase's acceptance criterion states the
 * hard half of the requirement in one clause: **the extension gains no validation logic.**
 *
 * This module therefore does three things and nothing else:
 *
 * 1. it reads the run directory and the two files each row comes from;
 * 2. it groups the rows on the subject the row itself carries;
 * 3. it renders those rows as lines of text.
 *
 * It has no threshold, no comparison between runs, no notion of which verdict follows from what, and
 * it never spells a verdict of its own - the verdict printed on a row is the one the bundle recorded,
 * passed through. `twin.test.ts` holds that as an executable rule by reading this file's source: a
 * module that cannot write the literal `PASS` cannot be deciding anything about one.
 *
 * ## The one thing this file cannot share, and how the drift is bounded instead
 *
 * `core/metrics/eli.ts` computes the same join, and the right answer would be to call it. The Cockpit
 * may not: `extension/vscode/package.json` ships `files: ["out", "icon.png", "LICENSE"]`, and
 * `./cli.ts` records the three reasons the extension links nothing from `core/` - the last of which
 * is decisive, because this extension is installed into workspaces where there is no source tree to
 * import from at all.
 *
 * So the join is **re-taken** in the client, and the honest consequence is stated rather than hidden:
 * a second reader of a document can drift from the document. Three of the four inputs are fields in
 * `result.json`, one is a block in `environment.json`, and **`twin.test.ts` pins all five spellings
 * against the files that own them** - `schemas/result.schema.json`, `core/metrics/metrics.ts`'s
 * `subjectOf`, and `core/evidence/types.ts`'s `BUNDLE_FILES`. A rename in any of them fails that
 * guard by name. What is *not* pinned is behavioural equivalence with `eli.ts`'s grouping order,
 * which is why this module's grouping rule is stated in one line and tested directly.
 *
 * ## Nothing here throws
 *
 * The Cockpit activates in workspaces where Veridian has never run, so "there is no history yet" is
 * the ordinary case. A bundle that *exists* and cannot be read is different, and is reported: the
 * unreadable list is returned rather than swallowed, because a history that silently holds fewer
 * runs than the disk does is a reading that lies about its own coverage.
 */

import { join } from "node:path";

import {
  readJson,
  summariseResult,
  type BundlePaths,
  type Verdict,
} from "./bundle.ts";

/** The two files a row is read from. Pinned against `core/evidence/types.ts` by the test. */
export const ROW_FILES = { result: "result.json", environment: "environment.json" } as const;

/**
 * The world a run was a reading of, as `environment.json` declares it.
 *
 * Both members are `string | null` rather than `string`, because `core/evidence/world-identity.ts`
 * derives them from the run's plan and a bundle written before that derivation landed carries no
 * `world` block at all - which is a fact about the history on this machine, not a hypothesis.
 */
export interface TwinWorld {
  readonly kind: string;
  readonly name: string | null;
}

/** One run on disk. Every field is read; none is computed. */
export interface TwinRow {
  readonly runId: string;
  /** `result.json`'s `goal_id`, or `null` when the bundle does not name its goal. */
  readonly goal: string | null;
  /** `result.json`'s `environment.adapter`, or `null`. Not a world name: see `world`. */
  readonly adapter: string | null;
  readonly world: TwinWorld | null;
  readonly verdict: Verdict;
  readonly state: string;
  readonly iteration: number;
}

/** Runs of one subject, in the order they were first seen. */
export interface TwinGroup {
  readonly subject: string;
  readonly rows: readonly TwinRow[];
}

export interface TwinReading {
  readonly groups: readonly TwinGroup[];
  /** Bundles that exist and could not be read, with the reason. Reported, never dropped. */
  readonly unreadable: readonly string[];
}

/** What this module needs from the filesystem, injected so the join is testable without one. */
export interface TwinIo {
  readonly readJson: (path: string) => Promise<unknown>;
  readonly listRunIds: () => Promise<readonly string[]>;
  readonly runDir: (runId: string) => string;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string, or `null`. The empty string is treated as absent on purpose: a field that is
 * present and says nothing is not a field that named something. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * `environment.json`'s `world` block, as far as the surface needs it.
 *
 * `kind` is required for the block to be a world identity at all; `name` may be absent, and in ten of
 * the twelve worlds it legitimately is (`core/evidence/world-identity.ts`). A block with no `kind` is
 * treated as no block rather than as a world called `undefined`.
 */
export function declaredWorld(environment: unknown): TwinWorld | null {
  if (!isRecord(environment)) return null;
  const world = environment["world"];
  if (!isRecord(world)) return null;
  const kind = text(world["kind"]);
  if (kind === null) return null;
  return { kind, name: text(world["name"]) };
}

/**
 * One row, or `null` when the bundle does not carry a run this surface can name.
 *
 * The verdict, the state and the iteration come from `summariseResult`, which is the Cockpit's
 * existing reader of `result.json` - **not** a second reading of those three fields. That is the one
 * place where the reuse is free: the summariser already refuses to invent a verdict, and a row that
 * borrowed a different reader's rules for the same field would be the second copy this file's header
 * is about.
 *
 * `null` is returned for a document with no readable verdict, and the caller reports which run it
 * was. Dropping it silently would make the group counts describe a history the disk does not have.
 */
export function twinRow(result: unknown, environment: unknown): TwinRow | null {
  const summary = summariseResult(result);
  if (summary === null) return null;

  const goal = isRecord(result) ? text(result["goal_id"]) : null;
  const env = isRecord(result) ? result["environment"] : null;
  const adapter = isRecord(env) ? text(env["adapter"]) : null;

  return {
    runId: summary.runId,
    goal,
    adapter,
    world: declaredWorld(environment),
    verdict: summary.verdict,
    state: summary.state,
    iteration: summary.iteration,
  };
}

/**
 * The subject a row belongs to.
 *
 * This is `core/metrics/metrics.ts`'s `subjectOf` spelled a second time, and the second spelling is
 * the price of the import the Cockpit may not make. `?` for a missing half is that function's own
 * choice rather than this file's, so two runs that both fail to name their goal still join - which
 * is the property that makes the reader honest about a bundle whose goal is unknown, instead of
 * inventing a group per run.
 */
export const subjectOf = (row: TwinRow): string => `${row.goal ?? "?"}@${row.adapter ?? "?"}`;

/**
 * Group rows by subject, in first-seen order.
 *
 * A `Map` and not an object literal: a subject is a string built from two document fields, so a
 * history holding a run whose adapter is spelled `constructor` would collide with `Object.prototype`
 * under an object keyed by subject. The linear rebuild below is what makes the order the history's
 * order rather than the engines.
 */
export function groupTwinRows(rows: readonly TwinRow[]): readonly TwinGroup[] {
  const groups = new Map<string, TwinRow[]>();
  for (const row of rows) {
    const key = subjectOf(row);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }
  return [...groups].map(([subject, members]) => ({ subject, rows: members }));
}

/** Read every run on disk, join it, and report what could not be read. */
export async function listTwin(io: TwinIo, paths: BundlePaths): Promise<TwinReading> {
  const rows: TwinRow[] = [];
  const unreadable: string[] = [];

  for (const runId of await io.listRunIds()) {
    const dir = io.runDir(runId);
    const result = await io.readJson(join(dir, ROW_FILES.result));
    const environment = await io.readJson(join(dir, ROW_FILES.environment));
    const row = twinRow(result, environment);
    if (row === null) {
      unreadable.push(`${runId}: ${ROW_FILES.result} is absent, is not JSON, or names no verdict`);
      continue;
    }
    rows.push(row);
  }

  return { groups: groupTwinRows(rows), unreadable };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/** `kind` alone, or `kind/name` when the bundle named one. ASCII only: see `AGENTS.md`. */
function describeWorld(world: TwinWorld | null): string {
  if (world === null) return "unknown world";
  return world.name === null ? world.kind : `${world.kind}/${world.name}`;
}

/**
 * The lines the panel shows.
 *
 * The counts are printed beside the verdicts rather than instead of them, for the reason
 * `describeVerdict` gives: `3 PASS, 1 FAIL` is what a group reports whether the same defect survived
 * all four runs or a different one broke each time. The verdicts are the verdicts; the counts are
 * orientation. Nothing here sums them into a judgement, and there is no "latest verdict" line - the
 * rows are the reading, and a summary of a reading is the thing this surface exists to avoid.
 */
export function renderTwin(reading: TwinReading): readonly string[] {
  const lines: string[] = [];

  if (reading.groups.length === 0) {
    lines.push("No runs on disk. Run a validation first, then ask for the twin again.");
    return lines;
  }

  const runs = reading.groups.reduce((total, group) => total + group.rows.length, 0);
  lines.push(
    `${String(reading.groups.length)} subject(s), ${String(runs)} run(s)`,
  );

  for (const group of reading.groups) {
    lines.push("");
    lines.push(`${group.subject}  (${String(group.rows.length)} run(s))`);
    for (const row of group.rows) {
      lines.push(
        `  ${row.runId}  ${row.verdict}  ${row.state}  ` +
          `iteration ${String(row.iteration)}  ${describeWorld(row.world)}`,
      );
    }
  }

  if (reading.unreadable.length > 0) {
    lines.push("");
    lines.push("bundles that could not be read:");
    for (const entry of reading.unreadable) lines.push(`  ${entry}`);
  }

  return lines;
}
