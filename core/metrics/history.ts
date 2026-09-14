/**
 * Reading a run history off disk.
 *
 * The metrics are measurements over runs, so something has to turn `.veridian/runs/*` into readings.
 * This is that something, and it is deliberately dumb: it lists the runs directory, reads each
 * `result.json`, and hands the parsed value to `parseRunSnapshot`. It never repairs a bundle, never
 * falls back to `latest-result.json` for a run whose own result is missing, and never treats a file
 * it could not read as an absent one - each of those would let the metrics describe a history that is
 * not the history on disk.
 */

import { BUNDLE_FILES, bundleLayout } from "../evidence/index.ts";
import type { IoPort } from "../io.ts";
import type { RunSnapshot, SuccessMetrics } from "./metrics.ts";
import { parseRunSnapshot, successMetrics } from "./metrics.ts";

export interface RunHistory {
  readonly snapshots: readonly RunSnapshot[];
  /** Bundles that exist but could not be measured, with the reason. Reported, never dropped. */
  readonly unreadable: readonly string[];
}

/** `result.json` for one run directory, using the layout that wrote it rather than a literal path. */
const resultPath = (stateDir: string, runId: string): string => {
  const layout = bundleLayout(stateDir, runId);
  return `${layout.runDir}/${BUNDLE_FILES.result}`;
};

export async function readRunHistory(io: IoPort, stateDir: string, runIds: readonly string[]): Promise<RunHistory> {
  const snapshots: RunSnapshot[] = [];
  const unreadable: string[] = [];

  for (const runId of runIds) {
    const path = resultPath(stateDir, runId);
    const raw = await io.readTextFile(path);
    if (raw === null) {
      unreadable.push(`${runId}: ${BUNDLE_FILES.result} is not there`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      unreadable.push(`${runId}: ${BUNDLE_FILES.result} is not JSON`);
      continue;
    }
    const snapshot = parseRunSnapshot(parsed);
    if (snapshot === null) {
      unreadable.push(`${runId}: ${BUNDLE_FILES.result} does not carry the per-iteration criteria M1 compares`);
      continue;
    }
    snapshots.push(snapshot);
  }
  return { snapshots, unreadable };
}

/**
 * The run directories under `stateDir/runs`, oldest first by name.
 *
 * Run ids are timestamps with a suffix (`run-20260914-071916-b92031`), so the name ordering *is* the
 * chronological ordering, and sorting by name avoids reading every bundle's mtime to learn what the
 * directory already says. A missing `runs/` directory is an empty history, not an error: a machine
 * that has never run the product has nothing to measure, and saying so is the honest report.
 */
export async function listRuns(io: IoPort, stateDir: string): Promise<readonly string[]> {
  const runsDir = `${stateDir}/runs`;
  if (!(await io.exists(runsDir))) return [];
  const entries = await io.readDir(runsDir);
  return entries.filter((entry) => entry.startsWith("run-")).sort();
}

export interface HistoryMetrics {
  readonly history: RunHistory;
  readonly metrics: SuccessMetrics;
}

/** The two steps the CLI performs, so the pairing is testable without a command line. */
export async function measureRunHistory(
  io: IoPort,
  stateDir: string,
  options: { readonly expectedDefects?: readonly string[]; readonly runIds?: readonly string[] } = {},
): Promise<HistoryMetrics> {
  const runIds = options.runIds ?? (await listRuns(io, stateDir));
  const history = await readRunHistory(io, stateDir, runIds);
  return {
    history,
    metrics: successMetrics(history.snapshots, {
      expectedDefects: options.expectedDefects ?? [],
      unreadable: history.unreadable,
    }),
  };
}
