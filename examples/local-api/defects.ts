/**
 * The four deliberate defects of the API demo, as *textual* overlays on a correct service.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, a
 * state of `unknown` refused rather than guessed at, and the rule that blocks must not nest - live in
 * `../defect-text.ts` and are shared with the other examples. This file owns only the four edits, and
 * all four are overlays on one file because that is where the service is: a defect table that patched
 * two files would need two tables and two injections, and the demo would no longer be able to say
 * "the application is in a recognised state" about one artifact.
 *
 * ## What makes this world's defects different in kind
 *
 * The cart demo's defects are a browser's observations, the database demo's are rows, and the three
 * simulated families' are records held by a substitute. These four are none of those: they are the
 * wrong *answer* to a real HTTP request. Nothing between the criterion and the service decides
 * anything, so a failure here is the application's and can be nobody else's - which is the whole
 * reason this world exists beside the eight that came before it.
 *
 * ## Two of the four are read twice, and that is the point
 *
 * D1 edits the one function every price passes through, so it moves the item's price (AC-002) and the
 * cart's total (AC-003). D4 edits the constant every response carries, so it moves the header on a
 * read (AC-006) and on a creation (AC-007). Neither is an arrangement: it is what a *shared* surface
 * does, and a demo where every edit moved exactly one reading would be teaching that one edit is
 * always one fact - which is false about every program that has ever had a helper function.
 *
 * D2 and D3 are the controls, and they are what make the other two measurable: each is read by exactly
 * one criterion, so a reader watches one edit produce one reading before watching one edit produce
 * two. A table whose every entry moved several criteria would have no control in it, and a demo with
 * no control cannot show that its readings are caused by the edit rather than by the world being
 * flaky. This is the same argument the container demo makes with its three single-criterion defects,
 * arrived at independently because this world's shared surfaces happen to be money and a header.
 *
 * ## Why D3 reads the body as well as the status, and still moves one criterion
 *
 * AC-005 asserts both the 404 and the sentence in the body, and D3 changes only the status - so the
 * body expectation keeps passing while the status expectation fails, and the criterion's own evidence
 * shows a refusal that is still honest about what is absent but no longer returns the code for it.
 * That is a more useful failure than both expectations collapsing: it says exactly what changed.
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
const SERVICE = "server.mjs";

/** In criterion order, which is also repair order. */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1-cents-forgotten",
    criterionId: "AC-002",
    summary:
      "dollars are read as whole units, so $10.00 becomes 10 cents instead of 1000 and every price and total is a hundredth of what the catalog says",
    correct: "  return Math.round(Number.parseFloat(amount) * 100);",
    defective: "  return Math.round(Number.parseFloat(amount));",
  }),
  Object.freeze({
    id: "D2-creation-answered-ok",
    criterionId: "AC-004",
    summary: "a creation is answered 200, so a client cannot tell that it created anything",
    correct: "    return sendJson(res, 201, renderItem(created));",
    defective: "    return sendJson(res, 200, renderItem(created));",
  }),
  Object.freeze({
    id: "D3-absence-answered-ok",
    criterionId: "AC-005",
    summary: "an absent sku is answered 200, so an error is indistinguishable from a resource",
    correct: "      return sendJson(res, 404, { error: `no item with sku ${sku}` });",
    defective: "      return sendJson(res, 200, { error: `no item with sku ${sku}` });",
  }),
  Object.freeze({
    id: "D4-version-drifts",
    criterionId: "AC-006",
    summary: "the one version every response carries is stated as 3 where the service declares 2",
    correct: 'const CART_API_VERSION = "2";',
    defective: 'const CART_API_VERSION = "3";',
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

/** Repair the first still-injected defect, in criterion order. One per call, on purpose. */
export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, SERVICE, text);
}
