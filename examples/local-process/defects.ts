/**
 * The four deliberate defects of the process demo, as *textual* overlays on a correct program.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, a
 * state of `unknown` refused rather than guessed at, and the rule that blocks must not nest - live in
 * `../defect-text.ts` and are shared with the other examples. This file owns only the four edits, and
 * all four are overlays on one program because that is where the behaviour is: a defect table that
 * patched two files would need two tables and two injections, and the demo would no longer be able to
 * say "the application is in a recognised state" about one artifact.
 *
 * ## What makes this world's defects different in kind
 *
 * The browser demo's defects are page readings, the database demo's are rows, and the six simulated
 * families' are records held by a substitute. These four are none of those. They are the wrong *exit
 * code*, the wrong *stream* and the wrong *byte* - read from a process this kernel reaped, not from
 * anything standing in for one. That is why there is no substitute in this world at all: an exit code
 * is the one reading a stand-in is tempted to lie about, because a fake runtime can always print
 * "done" and return zero. Nothing here can. The number in the bundle came from `process.exitCode`, and
 * the bytes came off the disk.
 *
 * ## One defect is the headline and three are clean controls
 *
 * D1 edits the single constant that names the release version, and that constant is printed by the
 * build, quoted back by the verifier from the manifest, and written into the manifest itself - so one
 * edit moves **three** criteria (AC-003, AC-004, AC-008). Nothing arranged that; it is what a shared
 * surface does, and the demo shows it rather than avoiding it.
 *
 * D2, D3 and D4 each move **exactly one** criterion, so each is a control in the strict sense: D2
 * empties the verifier's stray list (AC-005), D3 misspells one word in the daemon's banner (AC-001),
 * and D4 moves one success line to the error stream (AC-006). This paragraph used to claim otherwise
 * in both directions - that D4's reach equalled D1's ("the build line and the add line are both
 * narrated through one helper, so moving that helper's stream moves AC-003, AC-004 and AC-006") and
 * that D2 moved two criteria - and a run is what corrected it. The measured reach is D1 -> AC-003,
 * AC-004, AC-008; D2 -> AC-005; D3 -> AC-001; D4 -> AC-006, with AC-002, AC-007 and AC-009 never
 * moving at all. **A reach table is a claim about every expectation in the contract, so it has to be
 * read off a run rather than reasoned from the defect's name** - and the count is the part a reader
 * checks first, which is why it is the part that was wrong.
 *
 * The first version of D3 was wrong, and this note is what the run cost. It misspelled `ready` - which
 * is *also the world's readiness line*: the environment document's `start.readyPattern` waits for
 * `/cart-build audit daemon ready/`, so the application never announced readiness, `start` timed out
 * after 30 s, the environment came back `valid: false`, and the run ended `INCONCLUSIVE` at exit 2
 * **before any criterion was observed and before the repair gate was reached**. A defect that takes
 * down the world cannot be repaired by the loop, because the loop is what runs once the world is up.
 * The comment beside this table claimed "nothing else in the world consults it", which was false: the
 * world's own readiness check consulted it, and a comment is not a guard. D3 now misspells the
 * `channel` label instead - one field to the right of the readiness prefix, still cosmetic, still read
 * by AC-001 alone, and the world still comes up. Found by running the demo, not by reading it.
 * `tests/local-process-demo.test.ts` now holds the rule by applying every defect in this table to the
 * source and requiring the readiness phrase to survive the edit, which is the only form of the check
 * that works for all four: three of them do not touch the banner at all, and the one that does edits a
 * word on it rather than the line.
 *
 * A reader therefore watches the headline first - D1 moving three readings with a one-character edit,
 * which is why the failing count drops from six to three in one repair - and then watches D2, D3 and
 * D4 clear exactly one each. A table whose every entry moved several criteria would have no control
 * in it, and a demo with no control cannot show that its readings are caused by the edit rather than
 * by the world being flaky. This is the same argument the container demo makes, arrived at
 * independently because this world's shared surfaces happen to be a version string and a line of
 * narration.
 *
 * Those reach counts are read off a run rather than recalled: every expectation in `acceptance.yaml`
 * was walked against each defect's isolated effect, and the descent the demo prints is that
 * measurement. Three criteria never move for any of the four, and each is a stabiliser of a different
 * kind: AC-002 reads the verifier against a tree that holds no release to verify, and AC-007 reads
 * the two refusal paths, so neither is about the surfaces the defects edit; AC-009 measures the
 * release's other two files and the manifest's own size, which is why it is the reading that says the
 * world itself is stable while the four edits happen around it.
 *
 * ## Why D4 is the most instructive of the four
 *
 * D4 sends one narration line to stderr instead of stdout. The command still succeeds, the file is
 * still written, and its contents and size are still exactly right - so every reading that a run of
 * this world could take *about the outcome* is unchanged, and the exit code is still zero. What
 * failed is where the answer was said. A contract that only looked at exit codes would call this a
 * pass, and that is precisely the class of false confidence this product exists to refuse. It is also
 * why the criterion is filed against AC-006: that is the criterion that reads the stream.
 *
 * That paragraph was written after the defect had been moved, and the move is worth recording because
 * the first version of it was unfalsifiable in the quietest possible way. D4 was originally written
 * against `build()`'s narration - the line whose *shape* matches the defect's name, `cart-build: wrote
 * N files into dist at version V` - and nothing was wrong with the edit itself: it injected cleanly,
 * repaired cleanly, and `status()` reported it intact. What was wrong was the claim in its
 * `criterionId`. AC-006 is the criterion that runs `add notes/todo.txt`, and that command returns
 * before `build()` is ever called, so the line D4 edited sat on no code path AC-006 executes. The
 * defect could be injected, repaired and re-injected with AC-006 never moving - a demo built on it
 * would have printed a descent ending `6 -> 3 -> 2 -> 1 -> 1` and gone on iterating until it hit the
 * iteration ceiling. **A defect's `criterionId` is a claim that its block sits on that criterion's
 * code path**, and the cheapest way to hold the claim is to inject the defect, run the program and
 * watch the value the criterion compares move. `tests/local-process-demo.test.ts` does exactly that
 * for all four rows, so the claim is a measurement now rather than a table entry. This is the same
 * rule the readiness failure above teaches from the other end: there it was the *world* that a defect
 * had to leave standing, here it is the *criterion* that a defect has to be able to reach.
 *
 * ## All four blocks are single-line, and the demo says so
 *
 * Every `correct` block below is one line of `cart-build.mjs`, so `newlineOf`/`inStyle` never touch
 * them and the table is ending-insensitive **by construction** - the line-ending rule cannot be
 * exercised here whether or not a checkout wrote the file with CRLF. That rule is therefore held
 * where it can be: `tests/defect-text.test.ts` drives the shared implementation with synthetic
 * multi-line blocks and both endings supplied by the test. This paragraph exists so that a later
 * reader does not mistake the pair of facts - "this table is single-line" and "the rule is tested" -
 * for one fact.
 */

import {
  defectStates,
  injectDefects,
  repairDefect,
  type Defect,
  type DefectStatus,
  type InjectResult,
  type RepairResult,
} from "../defect-text.ts";

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";

/**
 * The single file every defect in this table is an overlay on.
 *
 * The program is the whole world here: there is no document to patch beside it and no fixture, because
 * the thing a criterion judges is what a process did. So the table owns one file and the demo's
 * "recognised state" claim is a claim about one artifact.
 */
const SERVICE = "cart-build.mjs";

/**
 * The table, in the order the repair agent will walk it.
 *
 * Read this order against `criterionId` before assuming they agree: the agent repairs the first
 * *injected* defect in **array** order, so this list is repair order, and each entry's
 * `criterionId` is the criterion the defect is **filed against** - its own subject. Exactly one of
 * the four (D1) moves more than the criterion it is filed against, so reading this list as a
 * criterion-ordered roster would be wrong about the order rather than about the count: D3 is filed
 * against AC-001 and sits third. The demo's descending figures (`6 -> 3 -> 2 -> 1 -> 0`) follow from
 * the array order - the first repair clears three criteria at once because that is D1's reach, and
 * the three controls after it clear one each - which is why the order is stated here rather than left
 * to be inferred.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1-release-version-drifts",
    criterionId: "AC-003",
    summary:
      "the release version is stated as 1.4.1 where the release is 1.4.0, so the build announces it, the verifier quotes it back and the manifest records it - three criteria from one constant",
    correct: 'const RELEASE_VERSION = "1.4.0";',
    defective: 'const RELEASE_VERSION = "1.4.1";',
  }),
  Object.freeze({
    id: "D2-stray-list-emptied",
    criterionId: "AC-005",
    summary:
      "the list of names the manifest does not declare is emptied, so the verifier reports a tree as consistent with its manifest when the tree holds a file the manifest never named",
    correct: "  const stray = present.filter((name) => !expected.includes(name));",
    defective: "  const stray = [];",
  }),
  Object.freeze({
    id: "D3-banner-misspelt",
    criterionId: "AC-001",
    summary:
      "the daemon's banner says `chanel` instead of `channel`, so the label a reader sees once the world is up is misspelt - the readiness line above it is untouched and nothing else in the world changes",
    correct:
      '  say("out", `cart-build audit daemon ready (channel ${CHANNEL}, root ${ROOT}, version ${RELEASE_VERSION})`);',
    defective:
      '  say("out", `cart-build audit daemon ready (chanel ${CHANNEL}, root ${ROOT}, version ${RELEASE_VERSION})`);',
  }),
  Object.freeze({
    id: "D4-narration-on-stderr",
    criterionId: "AC-006",
    summary:
      "the line announcing a written file is sent to stderr instead of stdout, so the command succeeds, the file is right and the answer arrives on the error stream",
    correct: '  say("out", `cart-build: added ${relative}`);',
    defective: '  say("err", `cart-build: added ${relative}`);',
  }),
]);

/** Classify each defect against `text`. See `defectStates` for why `unknown` is not an error. */
export function status(text: string): readonly DefectStatus[] {
  return defectStates(DEFECTS, text);
}

/** Replace every intact defect with its defective form. Throws on `unknown` rather than guessing. */
export function inject(text: string): InjectResult {
  return injectDefects(DEFECTS, SERVICE, text);
}

/** Repair the first still-injected defect, in table order. One per call, on purpose. */
export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, SERVICE, text);
}
