/**
 * The ELI: one row per run, joined from the bundles already on disk.
 *
 * The runs directory is already a ledger. `.veridian/runs/<run-id>/` holds `environment.json`,
 * `result.json`, the per-criterion observations and the execution log, and two readers already walk
 * it - `./history.ts` reads the result of every run, and this file reads the *world* beside it. What
 * was missing is a single view a reader can ask a question of: "every run of this goal against this
 * world, with what each one concluded", without writing the join by hand each time.
 *
 * Two decisions here are load-bearing, and both are refusals of something more interesting:
 *
 *  - **It is a join and a name, not a layer.** No fidelity score, no confidence number, no second
 *    store. The verdict and the evidence are the reading, and a score computed over them would be a
 *    second answer to a question the bundle already answers - one that could disagree with the bundle
 *    the first time a run is deleted, because a cache is a second source of truth.
 *  - **The subject is `subjectOf` from `./metrics.ts`, not a second spelling of it.** M1 groups runs
 *    by that string; so does the join here; and so does the instrument's ground-truth scoping. Three
 *    readers agreeing because they call one function is a property that cannot drift, and the
 *    alternative - each computing `\`${goalId}@${adapter}\`` for itself - agrees right up until a
 *    bundle arrives whose fields need a rule only one of them was written with.
 *
 * A bundle that cannot name its world is still a row. `world: null` is a **reading** - "this run's
 * plan declared no world, or its `environment.json` predates the field" - and writing `unknown` there
 * would be inventing a rendering for "not declared", which is the parallel vocabulary
 * `core/evidence/world-identity.ts` refuses in as many words. A row that is dropped is worse still:
 * a reader asking "how many runs of this goal" would then be answered by the subset that happened to
 * be legible, which is the same shape as M1 calling an unreadable bundle a clean run.
 */

import { BUNDLE_FILES, bundleLayout, worldLabel } from "../evidence/index.ts";
import type { WorldIdentity } from "../evidence/index.ts";
import type { IoPort } from "../io.ts";
import { listRuns, readRunHistory } from "./history.ts";
import { subjectOf } from "./metrics.ts";
import type { MetricVerdict } from "./metrics.ts";

/**
 * One run, as a single row.
 *
 * Every field comes off a bundle already on disk and none of them is computed. `subject` and the two
 * fields it is built from are all present on purpose: the pair is what a reader recognises a run by,
 * and the subject is what a *group* is keyed on, so a reader comparing two groups can see the key
 * rather than re-deriving it.
 */
export interface EliRow {
  readonly runId: string;
  /** The goal this run judged. `null` when the bundle did not carry it. */
  readonly goalId: string | null;
  /** The adapter that constructed the world. Not a world name: see `world`. */
  readonly adapter: string | null;
  /**
   * The world this run measured, as `worldLabel()` renders it - `cloud:acct-cart`, `cluster:cart-dev`.
   *
   * Or `null`, which is the reading for a bundle that declares no world. `null` is deliberately not
   * `"unknown"`: a string would be a rendering a reader could mistake for a kind, and the world's own
   * vocabulary has no member for "not declared".
   */
  readonly world: string | null;
  readonly verdict: MetricVerdict;
  readonly state: string;
  /**
   * How many times the loop went round, as a **count** - not the iterations themselves.
   *
   * Named `iterationCount` rather than `iterations` because `RunSnapshot.iterations` is the array of
   * trips, and one name for two types is how a reader ends up comparing a number against a list.
   */
  readonly iterationCount: number;
  /** The string M1 groups this run's population by, from the one implementation of that rule. */
  readonly subject: string;
}

/** Runs of one subject, in the order they were first seen. */
export interface EliGroup {
  readonly subject: string;
  readonly rows: readonly EliRow[];
}

export interface EliReport {
  readonly rows: readonly EliRow[];
  readonly groups: readonly EliGroup[];
  /**
   * Bundles that exist and could not be read, with the reason - reported, never dropped.
   *
   * An unreadable run is not a row with a `null` world. It is a run whose *result* could not be
   * parsed, so there is no verdict to report at all; folding it into the rows would let a join
   * answer "how many runs of this goal" with a number that includes one it could not read.
   */
  readonly unreadable: readonly string[];
}

/**
 * Group rows by their subject, in first-seen order.
 *
 * The grouping key is the whole point of the phase, and grouping on the adapter alone is the
 * plausible mistake: it merges every goal run against the same world, so two goals judged in a
 * browser become one group and the group count stops being the goal count. See the falsification
 * probe in `docs/phases/02-the-eli-join.md`.
 */
export function groupEliRows(rows: readonly EliRow[]): readonly EliGroup[] {
  const groups = new Map<string, EliRow[]>();
  for (const row of rows) {
    // The key is computed once, on purpose. Written out three times - as it was first - the grouping
    // key is a value a later edit can change at the read and leave alone at the write, and the result
    // is a map that still answers the subject's name while holding a bucket that was overwritten
    // rather than appended to. That is not a hypothetical: the phase's own falsification probe was
    // written that way first, patched `get` alone, and reported `MISSED` against a working join
    // because the surviving `set` kept the key right. One expression, one place to break.
    const key = row.subject;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  return [...groups].map(([subject, members]) => ({ subject, rows: members }));
}

/** The two fields a label needs, read off `environment.json` - or `null` when it declares neither. */
const declaredWorld = (value: unknown): Pick<WorldIdentity, "kind" | "name"> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const world = (value as Record<string, unknown>)["world"];
  if (typeof world !== "object" || world === null || Array.isArray(world)) return null;
  const record = world as Record<string, unknown>;
  const kind = record["kind"];
  const name = record["name"];
  if (typeof kind !== "string" || typeof name !== "string") return null;
  return { kind, name };
};

/**
 * The world one run measured, labelled - or `null`.
 *
 * `Pick<WorldIdentity, "kind" | "name">` rather than a whole `WorldIdentity`, because the join reads
 * a label and nothing else: reconstructing a full identity here would mean deciding what to write
 * for `detail`, which is a field this row does not report. A missing file, unparseable JSON and a
 * record with no `world` all answer the same way, because they are the same fact about the bundle -
 * it does not name a world - and three different return values would be three vocabularies for it.
 */
const worldOf = async (io: IoPort, stateDir: string, runId: string): Promise<string | null> => {
  const path = `${bundleLayout(stateDir, runId).runDir}/${BUNDLE_FILES.environment}`;
  const raw = await io.readTextFile(path);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const world = declaredWorld(parsed);
  return world === null ? null : worldLabel(world);
};

/**
 * The join: every run on disk, as one row, grouped by subject.
 *
 * This is the single call AC-3 asks for. It reads through the same two functions the instrument
 * uses - `listRuns` for the population and `readRunHistory` for the readings - so a run the metrics
 * refuse is a run this refuses, and neither reader can be shown a bundle the other cannot see.
 */
export async function listEliRows(io: IoPort, stateDir: string): Promise<EliReport> {
  const runIds = await listRuns(io, stateDir);
  const history = await readRunHistory(io, stateDir, runIds);

  // Read in parallel but assembled in `history.snapshots` order, which is the run-name order the
  // history was built in - a join whose rows came back in filesystem order would be a ledger a reader
  // cannot diff against the last one.
  const rows = await Promise.all(
    history.snapshots.map(async (snapshot): Promise<EliRow> => ({
      runId: snapshot.runId,
      goalId: snapshot.goalId,
      adapter: snapshot.adapter,
      world: await worldOf(io, stateDir, snapshot.runId),
      verdict: snapshot.verdict,
      state: snapshot.state,
      iterationCount: snapshot.iterations.length,
      subject: subjectOf(snapshot),
    })),
  );

  return { rows, groups: groupEliRows(rows), unreadable: history.unreadable };
}
