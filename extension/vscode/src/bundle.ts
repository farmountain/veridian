/**
 * Reading a run bundle off disk.
 *
 * ## What the Cockpit is allowed to depend on
 *
 * Two interfaces, and this file is one of them: the **CLI** (`./cli.ts`) and the **bundle**, whose
 * layout `AGENTS.md` fixes as `.veridian/runs/<run-id>/result.json`, with `.veridian/latest-result.json`
 * and `.veridian/latest-failure.md` standing beside it as the Level-2 agent feedback artifacts.
 *
 * The Cockpit does not import `core/`. That is the whole point of a thin client: `core/` is free to
 * change its internals, and the extension keeps working because it reads the artifact the run wrote
 * rather than the machinery that wrote it. The same property is what will let MCP drive this engine
 * later (`AGENTS.md`: *"MCP is the door. Veridian is the building."*).
 *
 * ## The cost of that choice, and how it is paid
 *
 * A second reader of a document can drift from the document. `summariseResult` below therefore reads
 * a *named subset* and treats every field as optional at runtime, and `bundle.test.ts` pins that
 * subset against `schemas/result.schema.json` - the one file both readers are supposed to obey. A
 * field this file needs but the schema does not require would be a field that can be absent from a
 * valid bundle, which is the failure a test can see and prose cannot.
 *
 * ## Nothing here throws
 *
 * The Cockpit is activated in workspaces where Veridian has never run, so "there is no result yet" is
 * the ordinary case rather than an error. Every function returns `null` or an empty reading instead
 * of raising, and the caller decides what to say.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The three run-level verdicts. `INCONCLUSIVE` is never a synonym for `PASS`. */
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

/** One criterion as the bundle recorded it. */
export interface CriterionLine {
  readonly criterionId: string;
  readonly status: string;
  readonly mandatory: boolean;
  readonly message: string | null;
}

/** One iteration, with each criterion's status *as that iteration observed it*. */
export interface IterationLine {
  readonly iteration: number;
  readonly verdict: string;
  readonly passed: number;
  readonly failed: number;
  readonly undecided: number;
  readonly note: string;
}

/** What the dashboard, the output channel and the status bar all render. */
export interface RunSummary {
  readonly runId: string;
  readonly verdict: Verdict;
  readonly state: string;
  readonly iteration: number;
  readonly criteria: readonly CriterionLine[];
  /** Mandatory criteria that did not pass, worst first: `FAIL`/`ERROR` then undecided. */
  readonly blocking: readonly CriterionLine[];
  readonly reasons: readonly string[];
  readonly iterations: readonly IterationLine[];
  readonly evidenceComplete: boolean | null;
}

// ---------------------------------------------------------------------------------------------
// Pure reading
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The statuses that mean *this criterion did not pass*, in the order a reader should meet them.
 *
 * `SKIPPED` is absent on purpose: the schema says it "never gates the verdict", so a skipped
 * optional criterion lifted into this list would have the dashboard report a failure the run did
 * not. `INCONCLUSIVE` is present because it *does* gate - it is the status a criterion takes when
 * nothing could decide it, and the one this project refuses to fold into a pass.
 */
const BLOCKING_STATUSES: readonly string[] = ["FAIL", "ERROR", "INCONCLUSIVE"];

function ordering(status: string): number {
  const index = BLOCKING_STATUSES.indexOf(status);
  return index === -1 ? BLOCKING_STATUSES.length : index;
}

/**
 * Turn a `result.json` document into what the Cockpit renders.
 *
 * Returns `null` for anything that is not a run result. The one field required to be present is
 * `verdict`, because a summary of a run whose verdict could not be read is not a summary of
 * anything - and inventing one is precisely the shape this project refuses.
 */
export function summariseResult(document: unknown): RunSummary | null {
  if (!isRecord(document)) return null;

  const verdict = text(document["verdict"]);
  if (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "INCONCLUSIVE") return null;

  const criteria: CriterionLine[] = [];
  const rawCriteria = document["criteria"];
  if (Array.isArray(rawCriteria)) {
    for (const entry of rawCriteria) {
      if (!isRecord(entry)) continue;
      const criterionId = text(entry["criterion_id"]);
      const status = text(entry["status"]);
      if (criterionId === null || status === null) continue;
      criteria.push({
        criterionId,
        status,
        // Absent means "the criterion said nothing about whether it was mandatory". Read as
        // *not* mandatory, because treating an unknown as gating would invent a failure, and
        // treating it as non-gating cannot invent a pass: the run-level verdict is what decides.
        mandatory: entry["mandatory"] === true,
        message: text(entry["message"]),
      });
    }
  }

  const blocking = criteria
    .filter((line) => BLOCKING_STATUSES.includes(line.status))
    .sort((a, b) => ordering(a.status) - ordering(b.status));

  const reasons: string[] = [];
  const rawReasons = document["reasons"];
  if (Array.isArray(rawReasons)) {
    for (const reason of rawReasons) {
      const line = text(reason);
      if (line !== null) reasons.push(line);
    }
  }

  const iterations: IterationLine[] = [];
  const rawIterations = document["iterations"];
  if (Array.isArray(rawIterations)) {
    for (const entry of rawIterations) {
      if (!isRecord(entry)) continue;
      iterations.push({
        iteration: count(entry["iteration"]),
        verdict: text(entry["verdict"]) ?? "UNKNOWN",
        passed: count(entry["passed"]),
        failed: count(entry["failed"]),
        undecided: count(entry["undecided"]),
        note: text(entry["note"]) ?? "",
      });
    }
  }

  const evidence = document["evidence"];
  const evidenceComplete = isRecord(evidence) ? evidence["complete"] === true : null;

  return {
    runId: text(document["run_id"]) ?? "(unrecorded)",
    verdict,
    state: text(document["state"]) ?? "(unrecorded)",
    iteration: count(document["iteration"]),
    criteria,
    blocking,
    reasons,
    iterations,
    evidenceComplete,
  };
}

// ---------------------------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------------------------

/** The paths the Cockpit reads, given a state directory. One place, so a caller cannot get half. */
export interface BundlePaths {
  readonly stateDir: string;
  readonly lastResult: string;
  readonly lastFailure: string;
  readonly runsDir: string;
}

export function bundlePaths(stateDir: string): BundlePaths {
  return {
    stateDir,
    lastResult: join(stateDir, "latest-result.json"),
    lastFailure: join(stateDir, "latest-failure.md"),
    runsDir: join(stateDir, "runs"),
  };
}

/** Read and parse a JSON file, or `null` if it is absent or is not JSON. */
export async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Absent is the ordinary case before the first run. A permission error reads the same way on
    // purpose: the Cockpit cannot do anything different about it, and `showResult` says which file
    // it looked for, so the operator has what they need without a stack trace in their editor.
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Read a text file, or `null` if it is absent. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** The summary of the most recent run, or `null` when there has not been one. */
export async function readLastSummary(paths: BundlePaths): Promise<RunSummary | null> {
  return summariseResult(await readJson(paths.lastResult));
}

/**
 * One line for the dashboard.
 *
 * The counts are printed beside the verdict rather than instead of it, because `passed: 3, failed: 1`
 * is what a run reports whether AC-001 broke or AC-003 broke - the same collapse `IterationSummary`
 * was given per-criterion statuses to avoid. The verdict is the verdict; the counts are orientation.
 */
export function describeVerdict(summary: RunSummary): string {
  if (summary.verdict === "PASS") {
    return `Veridian: PASS (${String(summary.criteria.length)} criteria, iteration ${String(summary.iteration)})`;
  }
  const undecided = summary.blocking.filter((line) => line.status === "INCONCLUSIVE").length;
  const failed = summary.blocking.length - undecided;
  const parts: string[] = [];
  if (failed > 0) parts.push(`${String(failed)} failed`);
  if (undecided > 0) parts.push(`${String(undecided)} undecided`);
  const detail = parts.length === 0 ? "no criteria recorded" : parts.join(", ");
  return `Veridian: ${summary.verdict} (${detail}, iteration ${String(summary.iteration)})`;
}
