/**
 * The three deliberate defects of the database demo, as *textual* overlays on a correct build script.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, and a
 * state of `unknown` refused rather than guessed at - live in `../defect-text.ts` and are shared with
 * the other examples. This file owns only the three edits.
 *
 * ## Why a *build script* is the thing being broken
 *
 * In the browser demo, a defect is a bug in the application's behaviour: the cart computes the wrong
 * subtotal. Here there is no behaviour to be wrong in - the whole application is a script that writes
 * rows - so the defect is necessarily a wrong *row*. This is not a weaker kind of defect; it is the
 * kind a database world can have, and the criterion that catches it is identical in shape to AC-001
 * of the cart demo. What changes is only which observable carries the mistake.
 *
 * ## Each defect is the cause of exactly one criterion
 *
 * That is a property worth defending, not a coincidence, and it is why each replacement was chosen to
 * touch only the observable its criterion reads:
 *
 *   D1 changes a quantity, which AC-001 reads directly. The widget is seeded far *above* its reorder
 *      level either way, so the reorder report is unchanged - which is what keeps D1 from being the
 *      cause of AC-003's failure as well.
 *   D2 changes a price, which only AC-002 reads. Quantities, and therefore the reorder report, are
 *      untouched.
 *   D3 changes a WHERE clause, which only the reorder report reads. No price or single quantity moves.
 *
 * The alternative - three defects that overlap - produces the same verdicts while making the demo
 * unable to show *which* criterion caught *what*. A repair that removes a failure somebody else
 * caused looks like a repair that worked, and that is the class of claim this project refuses.
 *
 * ## Note the trailing punctuation in D1
 *
 * `quantityOnHand: 30,` and not `quantityOnHand: 30`. The bare form is a *prefix* of the defective
 * form, so in the injected state both blocks would be found exactly once and the state would be
 * `unknown` - the demo would refuse to run rather than silently injecting nothing. That refusal is
 * the safety net; writing the blocks so they cannot overlap is the fix.
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

/** The single file every defect in this table is an overlay on. */
const BUILD = "build.mjs";

/** In criterion order, which is also repair order. */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1-quantity-mis-scaled",
    criterionId: "AC-001",
    summary: "a widget is seeded with 300 on hand where the catalog says 30",
    correct: "quantityOnHand: 30,",
    defective: "quantityOnHand: 300,",
  }),
  Object.freeze({
    id: "D2-cents-are-dimes",
    criterionId: "AC-002",
    summary: "dollars are converted to tenths of a cent, so every price is a tenth of what it should be",
    correct: "  return Math.round(dollars * 100);",
    defective: "  return Math.round(dollars * 10);",
  }),
  Object.freeze({
    id: "D3-reorder-boundary-off-by-one",
    criterionId: "AC-003",
    summary: "the reorder report includes products exactly at their reorder level instead of below it",
    correct: "    WHERE quantity_on_hand < reorder_level",
    defective: "    WHERE quantity_on_hand <= reorder_level",
  }),
]);

/** Classify each defect against `text`. See `defectStates` for why `unknown` is not an error. */
export function status(text: string): readonly DefectStatus[] {
  return defectStates(DEFECTS, text);
}

/** Replace every intact defect with its defective form. Throws on `unknown` rather than guessing. */
export function inject(text: string): InjectResult {
  return injectDefects(DEFECTS, BUILD, text);
}

/** Repair the first still-injected defect, in criterion order. One per call, on purpose. */
export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, BUILD, text);
}
