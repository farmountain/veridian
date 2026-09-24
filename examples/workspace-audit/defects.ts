/**
 * The three deliberate defects of the workspace-audit demo, as *textual* overlays on a correct probe.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, a state
 * of `unknown` refused rather than guessed at, and the rule that blocks must not nest - live in
 * `../defect-text.ts` and are shared with every other example. This file owns only the three edits, and
 * all three are overlays on one program because that is where the behaviour is.
 *
 * ## What makes this table different from its neighbour's
 *
 * `environment-twin`'s three defects are defects in an **instrument**: they make the probe report the
 * machine wrongly. This table's are defects in **a subject that is not the application either** - they
 * make the program report a *tree* wrongly, and there are exactly three ways it can do that:
 *
 *   D1  it does not put the read-only boundary to the test, and reports the boundary it never measured
 *   D2  it describes a tree it did not look at
 *   D3  it invents its own baseline when the document it should compare against is missing
 *
 * The first is the one to watch, and it is the sharpest defect in the repository for a reason that is
 * particular to this goal. **Every other world's safety property is about what the application may
 * touch; this one's is about what the run may touch while judging.** A probe that skips the write
 * attempt still prints a full report, still exits zero, and still says nothing whatever about whether
 * an audit could have modified the tree it was auditing - and the whole point of `process.observe` is
 * that the answer to that question is enforced rather than promised.
 *
 * D3 is the same shape one level out and is worth reading twice. A verify whose subject is missing
 * cannot distinguish "the report is gone" from "the report agrees with the tree" if it measures the
 * tree anyway - and the second of those is a *PASS* over an absent document, which is the one verdict
 * this project's rules forbid outright.
 *
 * ## The reach table, read off the run rather than reasoned from the defect names
 *
 *   D1 -> AC-003, AC-004   the boundary is not put to the test. The outcome line becomes
 *                          `not-put-to-the-test`, so AC-003 loses both of its readings at once - and
 *                          because the program derives `audit:refusal-earned` from the outcome, AC-004
 *                          fails beside it. One edit, two criteria, which is what a shared surface does.
 *   D2 -> AC-002           the census is not taken, so the tree yields zero entries. Single reach, and
 *                          it is the control: a table whose every entry moved several criteria would
 *                          have nothing in it that shows a reading was caused by its edit.
 *   D3 -> AC-008           a verify with no report measures the tree and calls that the baseline, so it
 *                          exits 0 where the contract requires 2 and does not name what it could not
 *                          read. Single reach.
 *
 * The measured descent is therefore **4 -> 2 -> 1 -> 0**, and the first number is four because D1
 * reaches two criteria. That is the arithmetic `environment-twin` wrote down after its own first draft
 * claimed one defect per criterion and the run disagreed: **a reach table is a claim about every
 * expectation in the contract, so it has to be read off a run rather than reasoned from a defect's
 * name.** Here the arithmetic is stated before the run is taken, so that the run can contradict it.
 *
 * ## What no defect here may touch
 *
 * The readiness line. `local-process` paid for this rule: a defect that misspelt the readiness word took
 * the *world* down, so the run ended `INCONCLUSIVE` at exit 2 before any criterion was observed and
 * before the repair gate was reached - and a defect that takes down the world cannot be repaired by a
 * loop that only starts once the world is up. `environment.yaml`'s `readyPattern` waits for
 * `workspace-audit daemon ready`, and none of the three edits below goes near it.
 *
 * Nothing here touches the `observe` declaration either, and that is not a coincidence: destroying it
 * would take the *contract* down rather than make the program wrong, so the defect would be invisible
 * as a criterion failure and would present as a run that could not be set up.
 */

import type { Defect, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
import { defectStates, injectDefects, repairDefect } from "../defect-text.ts";

/** The program these defects overlay. Named once so every function agrees about which file it edits. */
const PROGRAM = "app/audit-probe.mjs";

export const DEFECTS: readonly Defect[] = [
  {
    id: "D1",
    criterionId: "AC-003",
    summary:
      "the boundary is not put to the test, so the report describes a read-only guarantee it never measured",
    // The write attempt is removed and the outcome is *stated* instead. This is the exact move a
    // well-meaning implementation makes when the boundary feels obviously true: the probe still
    // reports the tree, still exits zero, and its report contains a line about the boundary that was
    // never produced by trying anything. AC-004's control still passes - the sandbox is still written
    // to - which is what makes this defect subtle rather than broken.
    correct: `  try {
    await writeFile(target, "an audit must never be able to write this\\n", "utf8");
    outcome = "breached";
  } catch (error) {
    outcome = "refused";
    code = String(error instanceof Error && "code" in error ? error.code : "unknown");
  }`,
    defective: `  // D1: the boundary is declared rather than put to the test.
  outcome = "not-put-to-the-test";`,
  },
  {
    id: "D2",
    criterionId: "AC-002",
    summary: "the census is not taken, so the audit describes a tree whose top level it never read",
    // A shape rather than an absence. The reading still has every field the correct one has, still
    // says `present`, and differs only in being empty - so nothing downstream fails for a missing key,
    // and only a criterion that asserts a *non-empty* census can tell. That assertion is
    // `surface:entries [1-9][0-9]* of`, and the leading character class is the whole of the defence.
    correct: `      census: await census(observed),`,
    defective: `      // D2: the top level is not read, so the audit describes a tree it did not look at.
      census: { status: "present", entries: 0, total: 0, truncated: false, names: [] },`,
  },
  {
    id: "D3",
    criterionId: "AC-008",
    summary:
      "a verify with no report measures the tree and calls that the baseline, so an absent document reads as agreement",
    // The fallback is the defect and it looks like robustness. A verify that cannot find its subject
    // and proceeds anyway is not verifying anything - it is taking a fresh reading and agreeing with
    // it, which is a *PASS* over a document that does not exist. Asserting a reading is not the
    // mechanism by which a criterion may pass; having one is, and this defect removes the having.
    correct: `  let onDisk;
  try {
    onDisk = JSON.parse(await readFile(REPORT_FILE, "utf8"));
  } catch (error) {
    warn(
      \`verify: the report could not be read from \${REPORT_FILE}: \` +
        \`\${error instanceof Error ? error.message : "an unknown value"}\`,
    );
    return 2;
  }`,
    defective: `  // D3: with no report to read, the verify measures the tree and calls that the baseline.
  let onDisk = null;
  try {
    onDisk = JSON.parse(await readFile(REPORT_FILE, "utf8"));
  } catch {
    onDisk = { declared: [...OBSERVED] };
  }`,
  },
];

export function status(text: string): readonly DefectStatus[] {
  return defectStates(DEFECTS, text);
}

export function inject(text: string): InjectResult {
  return injectDefects(DEFECTS, PROGRAM, text);
}

export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, PROGRAM, text);
}
