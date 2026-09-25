/**
 * The three deliberate defects of the env-reality demo, as *textual* overlays on a correct probe.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, a state
 * of `unknown` refused rather than guessed at, and the rule that blocks must not nest - live in
 * `../defect-text.ts` and are shared with every other example. This file owns only the three edits.
 *
 * ## Why all three are in one function
 *
 * Every other example's defects are spread across the decisions its program makes. These three are all
 * inside `census()`, and that is not a shortage of ideas - it is what the subject is. The world's half
 * of this contract is the crawl, and a defect cannot reach it from the program at all: `process.environment`
 * is read from the map `core/process.ts` built before the child existed. So a program defect can only
 * move the *second* instrument, and the second instrument is one function whose output is read three
 * ways - as stdout, as a count, and as a document.
 *
 * That shape has a consequence worth stating, because it is the thing a reader will notice first: the
 * three defects cannot be made to reach one criterion each. Two of them leave their mark on the journal
 * that AC-007 reads, precisely because the journal *is* the census. **A reach table is a claim about
 * every expectation in the contract, so it is read off a run rather than reasoned from a defect's
 * name** - and a table whose entries all happened to be disjoint would be a table shaped by the wish
 * rather than by the program.
 *
 * ## The three ways a census can be wrong, and each is a real mistake rather than a sabotage
 *
 *   D1  the environment is not read, and the census reports an empty world
 *   D2  the declared channel's presence is stated rather than checked
 *   D3  the reading is written before it is taken, so the document describes a world that never was
 *
 * D1 is the one to watch, and it is the defect this whole example is built to expose in its *other*
 * half. A program that reports `probe:visible 0` has produced a perfect environment: no credential, no
 * undeclared credential, no contradiction with a world that declared two innocuous names. Every
 * security-shaped assertion in the contract returns its best value. Only AC-005's `[1-9][0-9]*` and
 * AC-002's `visible` pattern on the world's side can tell that apart from a real measurement - **an absent
 * measurement must not read as a clean one**, and this defect is the cheapest possible way to
 * demonstrate how far that rule reaches.
 *
 * D2 is the same mistake one level down and is subtler. `channel: "present"` would be a program
 * asserting a fact it did not look up, and it would pass - which is why the defect writes `"absent"`
 * instead: the reading has to be *wrong* to be observable, and the honest way to make it wrong is for
 * the program to stop asking. A defect that hardcoded the correct answer would be undetectable and
 * would therefore teach nothing.
 *
 * D3 is the pair `workspace-audit`'s D3 makes one world over, applied to a file rather than to a report:
 * a document that is present and wrong. **It is written this way because of a measurement**, and the
 * first draft of it was not.
 *
 * That draft made the probe take the reading and then not write it. The result was not the FAIL the
 * table predicted - it was `INCONCLUSIVE`, and the run **stopped at iteration 3 with the loop refusing
 * to continue**: *"a verdict of INCONCLUSIVE is not something a repair can change."* Which is correct,
 * and which is why the draft was wrong rather than the loop. `process.contents` reports an absent file
 * as `unusable` on purpose - comparing against an empty string would report a defect in an application
 * nobody read - and the criterion's four expectations then composed to `INCONCLUSIVE` despite
 * `process.file` failing outright in the same breath.
 *
 * So the reach of a defect is not just how many criteria it moves; it is **which verdict it produces**,
 * and `INCONCLUSIVE` is a statement about the world rather than about the application. A missing
 * artifact is indistinguishable from a world that never ran the step that should have made it, and a
 * loop that repairs that is guessing. The honest way to make a *program* fail this criterion is for the
 * program to write a document that is wrong, which is what this defect now does: the file is there, it
 * is readable, and it describes an empty environment.
 *
 * ## The reach table, predicted before the run so the run can contradict it
 *
 *   D1 -> AC-005, AC-007   the census is taken over nothing. AC-005 loses `probe:visible [1-9][0-9]*`
 *                          and `probe:populated [1-9][0-9]*`; AC-007 loses its `"visible"` pattern and
 *                          its `"channel"` string, because the document it reads back is the census.
 *   D2 -> AC-006, AC-007   the channel is reported absent, so AC-006's cross-instrument clause fails -
 *                          and AC-007 fails beside it, because the document says `"channel": "absent"`.
 *   D3 -> AC-007           the reading is written before it is taken. Stdout is untouched, so this is
 *                          the single-reach entry and the table's control: without it there would be
 *                          nothing showing a criterion that failed *because of* one edit rather than
 *                          beside it.
 *
 * Predicted descent, in table order: **3 -> 2 -> 1 -> 0.**
 *
 * ## What no defect here may touch
 *
 * The readiness line. `local-process` paid for this rule: a defect that misspelt the readiness word took
 * the *world* down, so the run ended `INCONCLUSIVE` at exit 2 before any criterion was observed and
 * before the repair gate was reached - and a defect that takes the world down cannot be repaired by a
 * loop that only starts once the world is up. `environment.yaml`'s `readyPattern` waits for
 * `env-reality daemon ready`, and none of the three edits goes near it.
 *
 * The `environment: declared` line either - and that one is not care but **impossibility**. These
 * defects overlay a program, and `process.environment` is read from a map the runner built before the
 * program existed. No edit to `env-probe.mjs` can move AC-002, AC-003 or AC-004, which is what makes
 * the world's half of this contract a property of the *world* rather than of the software it judges.
 */

import type { Defect, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
import { defectStates, injectDefects, repairDefect } from "../defect-text.ts";

/** The program these defects overlay. Named once so every function agrees about which file it edits. */
const PROGRAM = "app/env-probe.mjs";

export const DEFECTS: readonly Defect[] = [
  {
    id: "D1",
    criterionId: "AC-005",
    summary:
      "the environment is not read, so the census describes an empty world and reports a perfect one",
    // `Object.keys(process.env)` becomes `[]`. Nothing throws, nothing warns, every line still prints,
    // and the program's counts are the best values a boundary reading can produce: zero credentials,
    // zero undeclared credentials, and no contradiction with a world that declared two innocuous names.
    // Only the character classes in AC-005 and AC-007 and AC-002's `visible` pattern can tell this from a
    // measurement - which is the entire reason those assertions are written as ranges and not as counts.
    correct: `  const names = Object.keys(process.env).sort();`,
    defective: `  // D1: the environment is described rather than read, so the census is of nothing.
  const names = [];`,
  },
  {
    id: "D2",
    criterionId: "AC-006",
    summary:
      "the declared channel's presence is stated rather than checked, so the two instruments disagree",
    // This is the cross-instrument criterion's whole purpose made into a defect. AC-003 proves
    // `ENV_REALITY_CHANNEL` is in the map the world handed over - it still is, because nothing a
    // program does can change the map. AC-006 asks whether the program that map was handed to *found*
    // it, and the answer here is a program that never looked.
    //
    // The defective block writes `"absent"` rather than `"present"`. A defect hardcoding the correct
    // answer would be undetectable and would teach nothing; the honest way to make a stated reading
    // wrong is to stop asking the question.
    correct: `    channel: process.env[CHANNEL] === undefined ? "absent" : "present",`,
    defective: `    // D2: the channel's presence is stated rather than looked up.
    channel: "absent",`,
  },
  {
    id: "D3",
    criterionId: "AC-007",
    summary:
      "the reading is written before it is taken, so the document describes an environment nobody measured",
    // The single-reach entry, and the table's control. Stdout is byte-identical to the correct
    // program's, so AC-005 and AC-006 both pass and the only criterion that fails is the one that asks
    // the *world* for the document - which is what a third instrument is for: a fact measured by a
    // subsystem sharing no code with either the crawl or the program's stdout.
    //
    // The first draft of this defect removed the write entirely. That produced `INCONCLUSIVE` rather
    // than FAIL, and the loop refuses to repair `INCONCLUSIVE` - correctly, because a missing artifact
    // is a statement about the world. A present-but-wrong document is the shape that is unambiguously
    // about the program, and it is also the shape a passing run can hide: a bundle whose every
    // criterion passed while an artifact the contract promised described a world that never existed.
    correct: `  await record(reading);`,
    defective: `  // D3: the reading is written before it is taken, so the document describes an environment nobody
  // measured. The file exists, it is readable, and every count in it is zero.
  await record({ visible: 0, credential: 0, populated: 0, channel: "absent" });`,
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
