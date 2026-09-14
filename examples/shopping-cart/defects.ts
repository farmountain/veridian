/**
 * The three deliberate defects of the canonical demo, as *textual* overlays on a correct app.
 *
 * One table, two consumers. `demo.ts` injects every defect before a run so the demo is repeatable
 * from a clean checkout; `repair.ts` removes exactly one defect per iteration so the run shows a
 * progression (three failures, then two, then one, then none) rather than jumping straight to
 * `PASS`. If the injector and the repairer each carried their own copy of the edits, the two copies
 * would drift, and the drift would present as a demo whose repair "worked" because it patched a
 * string the app no longer contained.
 *
 * Each defect names the acceptance criterion it is the cause of. That mapping is the demo's whole
 * point: a defect exists so that a criterion can be seen to detect it, and a criterion exists so
 * that a defect can be seen to be caught. A defect with no criterion is untested; a criterion with
 * no defect is a criterion nobody has watched fail (M2, "canonical defects detected").
 *
 * TypeScript rather than JavaScript because this file is the demo's source of truth and the one
 * place where a typo in a multi-line `correct` block would silently stop matching. It is checked by
 * `tsc` through `tests/shopping-cart-demo.test.ts`, which is what makes the string equality between
 * a defect and the app a compile-time-adjacent fact rather than a hope.
 *
 * The *mechanics* - how a block written with `\n` is matched against a file a checkout wrote with
 * CRLF, how a state of `unknown` is refused rather than guessed at - live in `../defect-text.ts` and
 * are shared with the other examples. This file owns only the three edits, because only this demo
 * knows them.
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
const APP = "cart.js";

/** In criterion order, which is also repair order. */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1-quantity-ignored",
    criterionId: "AC-001",
    summary: "the cart subtotal counts each line once, ignoring the quantity on it",
    correct: "  return state.lines.reduce((sum, line) => sum + lineTotal(line), 0);",
    defective: "  return state.lines.reduce((sum, line) => sum + priceOf(line.id), 0);",
  }),
  Object.freeze({
    id: "D2-wrong-tax-rate",
    criterionId: "AC-002",
    summary: "sales tax is charged at 10% and the jurisdiction charges 8%",
    correct: "const TAX_RATE = 0.08;",
    defective: "const TAX_RATE = 0.1;",
  }),
  Object.freeze({
    id: "D3-removal-no-render",
    criterionId: "AC-003",
    summary: "removing a line mutates the cart but never re-renders, so the totals go stale",
    correct: [
      "function removeLine(id) {",
      "  state.lines = state.lines.filter((line) => line.id !== id);",
      "  render();",
      "}",
    ].join("\n"),
    defective: [
      "function removeLine(id) {",
      "  state.lines = state.lines.filter((line) => line.id !== id);",
      "}",
    ].join("\n"),
  }),
]);

/** Classify each defect against `text`. See `defectStates` for why `unknown` is not an error. */
export function status(text: string): readonly DefectStatus[] {
  return defectStates(DEFECTS, text);
}

/** Replace every intact defect with its defective form. Throws on `unknown` rather than guessing. */
export function inject(text: string): InjectResult {
  return injectDefects(DEFECTS, APP, text);
}

/** Repair the first still-injected defect, in criterion order. One per call, on purpose. */
export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, APP, text);
}
