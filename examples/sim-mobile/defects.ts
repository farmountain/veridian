/**
 * The four defects the `sim-mobile` demo injects, and the one implementation of undoing each.
 *
 * ## Why this table is a list of defects and not a list of (file, defect) pairs
 *
 * Every defect lives in the same file - `app/provision.mjs` - because that file is the *input* to this
 * world rather than an artifact of it. The substitute device holds a bundle that the application
 * installs on every run: the entry point, the cart module, the checkout module, a README and the
 * manifest are all composed from constants in this one program, staged under `app/context/` and handed
 * to the world as `SOURCES`. So a defect written anywhere else would be erased by the next iteration's
 * own provisioning, and the demo would report a repair the world never had a chance to observe.
 * `examples/sim-container/source.ts` records the same rule for the same reason, one world over.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * Three of them are **controls** and one moves a second reading. A control is a defect read by
 * **exactly one** criterion, which is what lets a reader watch one edit move one reading before watching
 * one edit move the next one along - and therefore see that the readings follow the edits rather than a
 * world that is flaky. `D2` is the one that moves more than one, and being exact about which is the
 * point rather than the drama: it moves **two**, and the second one is a surface nobody thinks of as
 * carrying a release number.
 *
 * ```
 *   D1 -> AC-005   const ORIENTATION   landscape -> portrait    moves AC-005          1 reading
 *   D2 -> AC-007   const RELEASE       1.4.0     -> 1.5.0       moves AC-007, AC-016  2 readings
 *   D3 -> AC-013   const CAMERA_KEY    camera    -> camer       moves AC-013          1 reading
 *   D4 -> AC-015   the notification title                       moves AC-015          1 reading
 * ```
 *
 * That reach is **measured, not asserted**, and the run's own `iterations` carry it: the failing criteria
 * are `[AC-005, AC-007, AC-013, AC-015, AC-016]` on iteration one, then `[AC-007, AC-013, AC-015,
 * AC-016]`, then `[AC-013, AC-015]`, then `[AC-015]`, then none - five iterations of a failing count
 * descending `5 -> 4 -> 2 -> 1 -> 0`. The two counts a reader might confuse are both here and both true:
 * the defect count descends `4 -> 3 -> 2 -> 1 -> 0` while the criterion count descends
 * `5 -> 4 -> 2 -> 1 -> 0`, and the difference between them is `D2` alone.
 *
 * `D2`'s second reading is worth naming. The release string appears in the manifest (`"version":
 * "1.4.0"`) and in the notification body the application composes (`ready on Cart 1.4.0`), so `AC-007`
 * and `AC-016` both read it - and `AC-016`'s own description in the contract says exactly this, calling a
 * wrong version in a notification body "the release constant reaching a surface nobody thinks of as
 * carrying it". Measured to stay put, by contrast: `AC-018` and `AC-019` do **not** move, because
 * `1.5.0` is the same length as `1.4.0` and both of those pin byte counts of streams the application
 * composes; `AC-009` does not move, because the manifest is the same number of bytes and `AC-009` counts
 * files; and `AC-010` does not move, because it pins the *shape* of the digest
 * (`digest sha256:[0-9a-f]{12}`) rather than its value - deliberately, so a criterion exists that proves a
 * digest was computed at all without becoming a second statement about the five files' contents.
 *
 * `D1`, `D3` and `D4` are the controls. Each is read by exactly one criterion:
 *
 *   - `D1` asks the device for the other orientation, so `AC-005` reads `portrait (rotation 0, unlocked)`
 *     where the application asked for landscape. `AC-023` rotates the device itself as a *criterion*
 *     step and asks for portrait, so it is unaffected - a criterion acting in the world is not the same
 *     event as the application acting in it.
 *   - `D3` swaps the permission key the grant names for one the bundle never declared, so the record
 *     `AC-013` reads stays `not-determined (declared by the bundle, never prompted for)` - the observed
 *     reading, quoted from the run. What makes it a control is measured rather than argued: iteration
 *     three to four removes `AC-013` from the failing set and removes nothing else, so one edit moved
 *     one reading. Note also which criteria could not have moved: the contract has no criterion reading
 *     the `permission.grant` request at all - its three `mobile.call` criteria name `bundle.install`,
 *     `bundle.launch` and `device factoryReset` - so a swap that leaves the command well formed has
 *     nothing else in the contract to disturb.
 *
 *     `D3` carries a trap worth stating at the table rather than only in the suite: its defective form
 *     `camer` is a **prefix** of its correct form `camera`. Any scan for a defect's reach that keyed on
 *     the *defective* spelling would therefore have found `AC-013` too - by substring accident, and for
 *     a reason that has nothing to do with the criterion. So the derivation in
 *     `tests/sim-mobile-demo.test.ts` reads the last quoted literal of each defect's **correct** form and
 *     compares it **typed** against the value the engine parsed, never against a serialization of it.
 *     The general rule this is one instance of: *a defect table and the criteria its entries name are two
 *     lists of the same thing, and only one of them can be executed.*
 *   - `D4` changes one word of the notification's title, and no validator in this family reads a
 *     notification's title except the one criterion that names it.
 *
 * ## Ordering
 *
 * The table is in **criterion order** - AC-005, AC-007, AC-013, AC-015 - and not in the order the
 * defects were thought of, because the repair agent walks the table and takes the first still-injected
 * defect whose criterion is failing. That is what makes the failing count descend monotonically, and it
 * means the table's order *is* the demo's progression rather than a comment about it. `D2` moving two
 * criteria is why the count of failing criteria is `5 -> 4 -> 2 -> 1 -> 0` while the count of defects is
 * the tidier `4 -> 3 -> 2 -> 1 -> 0`: repairing `D2` repairs two readings, and both counts are true.
 *
 * ## Line endings
 *
 * `examples/defect-text.ts` re-expresses each block in the file's own ending before matching, because
 * this repository has paid for that rule twice. It does not help a table whose blocks are all single
 * lines, though - a one-line block contains no newline, so the conversion is never reached and a broken
 * implementation would look correct. `D4`'s block is therefore **two lines** on purpose, so that the
 * conversion between this file's spelling and the checkout's is exercised by the demo's own table rather
 * than only by the synthetic blocks in `tests/defect-text.test.ts`.
 *
 * ## Why `D3` is a key that does not exist and not a missing vector
 *
 * The obvious way to make the permission ungranted is to delete the `permission grant` vector. It is the
 * wrong way: a deleted vector changes the count of commands the application sent, so the completeness
 * line the readiness pattern waits for would announce a different figure, and `mobile.call` criteria
 * would move with it. A control has to move one reading, and swapping a value moves one.
 */

import {
  defectStates,
  injectDefects,
  repairDefect,
  type Defect,
  type DefectState,
  type DefectStatus,
  type InjectResult,
  type RepairResult,
} from "../defect-text.ts";

/** The one file the defects live in. Named once, so `source.ts` and the repair agent resolve the same path. */
export const PROVISION_FILE = "provision.mjs";

/**
 * The four defects, in criterion order.
 *
 * `criterionId` names the criterion that reads **the defect itself** and not one of its consequences.
 * For `D2` that distinction is load-bearing: the release constant reaches `AC-016`'s notification body
 * as well as `AC-007`'s bundle record, and the criterion filed here is the one whose subject *is* the
 * version string - a defect filed against the criterion it also moves would leave a reader unable to tell
 * the repair's target from its side effect.
 *
 * Every `correct` block must appear in `provision.mjs` **exactly once**, and no block may be a substring
 * of another; `defect-text.ts` refuses the ambiguous state rather than guessing, and
 * `tests/sim-mobile-demo.test.ts` holds both halves against the application's own text.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-005",
    summary: "the orientation the application asks the device for",
    correct: 'const ORIENTATION = "landscape";',
    defective: 'const ORIENTATION = "portrait";',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-007",
    summary: "the release the manifest and the notification body both carry",
    correct: 'const RELEASE = "1.4.0";',
    defective: 'const RELEASE = "1.5.0";',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-013",
    summary: "the permission key the grant names",
    correct: 'const CAMERA_KEY = "camera";',
    defective: 'const CAMERA_KEY = "camer";',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-015",
    summary: "the notification title",
    correct: '    "--channel", CHANNEL,\n    "--title", "Order ready",',
    defective: '    "--channel", CHANNEL,\n    "--title", "Order redy",',
  }),
]);

/** One defect and what the file currently holds for it. */
export interface DemoStatus {
  readonly defect: Defect;
  readonly state: DefectState;
}

/** The result of injecting every defect in the table. */
export interface InjectOutcome {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

/** The result of repairing one defect. `repaired` is `null` when nothing was left to repair. */
export interface RepairOutcome {
  readonly text: string;
  readonly repaired: Defect | null;
}

/** What the file holds for each defect, in table order. */
export function status(text: string): readonly DemoStatus[] {
  return defectStates(DEFECTS, text).map((entry) => ({ defect: entry.defect, state: entry.state }));
}

/** Inject every defect that is not already in the file, and report which ones that was. */
export function inject(text: string): InjectOutcome {
  return injectDefects(DEFECTS, PROVISION_FILE, text);
}

/** Undo the first still-injected defect in criterion order. The one implementation of undoing a defect. */
export function repairOne(text: string): RepairOutcome {
  return repairDefect(DEFECTS, PROVISION_FILE, text);
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
