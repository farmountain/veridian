/**
 * The four defects the `sim-os` demo injects, and the one file they all live in.
 *
 * ## Why this table is a list of defects and not a list of (file, defect) pairs
 *
 * `examples/sim-k8s/defects.ts` needed the pair because that application ships two manifest files, and
 * a defect that reported itself as fixed after matching something in a different file would be exactly
 * the failure it exists to catch. This application ships one file, so the table is flat - and
 * `source.ts` reads and writes that one file, which keeps `defect-text.ts`'s single-text contract
 * honest: it takes one artifact's text and answers questions about it, and nothing here asks it to
 * span two.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * The sets below are measured, not intended. `tests/sim-os-demo.test.ts` asserts them per iteration, so
 * a criterion that starts moving for a reason nobody wrote down fails a test rather than quietly
 * changing what the demo means.
 *
 *   - `D1` creates the service account under a name the service definition does not use. Three
 *     criteria move and they move *differently*: `os.account` (AC-001) answers `FAIL`, because the world
 *     genuinely holds no account named `svc-cart`; `os.principal` (AC-010) answers `FAIL` too, from the
 *     other side, because the service really is defined to run as `cart-api`; and `os.access` (AC-012)
 *     answers `INCONCLUSIVE`, because `permissionsOf` returns `null` when the reading holds no decision
 *     **for an account the world does not have**. AC-001 and AC-012 are the clearest evidence this
 *     project has that `INCONCLUSIVE` is not a softer `FAIL`: one reading is decisive and the other is
 *     honest about being unable to be. `os.acl` (AC-013) moves a fourth time, because the entry list
 *     now names the wrong account - which is why the account defect and the entry-list defect are
 *     separable at all.
 *   - `D2` writes the store values one key up, under `HKLM\SOFTWARE\Veridian` instead of
 *     `HKLM\SOFTWARE\Veridian\Policy`. Two criteria move (AC-006, AC-007) and they move *decisively*:
 *     the container the contract names holds no settings, so `settingValues` renders the empty string,
 *     and an empty string is a reading a `contains` can be judged against rather than a gap. The
 *     baseline file's contents (AC-005) do not move, and that is the point - a defect in what the
 *     system was told must not be readable as a defect in what the application wrote down.
 *   - `D3` asks the service manager what it thinks instead of starting the service. One criterion moves
 *     (AC-009) and it moves alone, which is worth a defect by itself: a single criterion changing while
 *     the other sixteen hold is the evidence that criteria are judged independently of their
 *     neighbours rather than rolling up from one another. The account still exists, the service is
 *     still defined, its principal is still right, its image still declares the port - and nothing is
 *     listening.
 *   - `D4` removes the auditing account from the secrets file's read permission but leaves its *write*
 *     permission in place. Two criteria move and this is the pair the world was built around: `os.acl`
 *     (AC-013) renders the whole entry list and fails because a second entry survives, while
 *     `os.access` (AC-014) asks the world's own rule what the auditing account may do and answers
 *     `write`. A hardening step that removed one of two permissions is exactly the kind of change an
 *     entry-list comparison alone would call clean.
 *
 * The nine criteria no defect moves are not dead weight: they are the control. A run in which every
 * criterion moved would be a run whose readings are not independent.
 *
 * ## One criterion, or several
 *
 * A defect may be visible through several criteria and this file names one. The rule is that
 * `criterionId` is the criterion that reads the *defect itself* rather than its consequence - the
 * account, the store key, the service state, the entry list - so that a reader who follows the id lands
 * on the criterion that would have caught it even if every derived reading had happened to be right.
 *
 * ## Line endings
 *
 * `D1`-`D3` are single-line blocks and `D4` is multi-line, which matters more than it looks. A
 * single-line block never reaches the newline conversion in `defect-text.ts`, so it cannot tell a
 * correct implementation of the CRLF rule from a broken one: this project already shipped a demo whose
 * defect table was entirely single-line while its comment claimed the opposite, and measured that
 * breaking the rule left its test green. `D4`'s block is multi-line so that a checkout storing this
 * file in CRLF reaches that conversion - and `tests/defect-text.test.ts` is where the rule is held
 * against synthetic blocks with both endings supplied by the test, because the one thing a test over
 * this table cannot do is supply the ending.
 *
 * `D4`'s two blocks are also deliberately **not** nested. The obvious shape - a two-line correct block
 * and a one-line defective block that is its first line - reads `unknown`, because the defective form
 * is then present inside the correct one and both counts are one. `defect-text.ts` refuses that
 * ambiguity by design, so both blocks carry the `"/grant",` line that follows them and neither is a
 * substring of the other.
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

/** The one file every defect in this table lives in, relative to the application directory. */
export const PROVISION_FILE = "provision.mjs";

/**
 * In **criterion order**, which is the order the repair agent walks: `os.account` (AC-001) reads the
 * account, `os.setting` (AC-006) reads the store key, `os.running` (AC-009) reads the service state and
 * `os.acl` (AC-013) reads the secrets entry list. Ordering matters because `repairOne` repairs exactly
 * one defect per call - one defect per iteration is what makes the demo's progression a diagnosis
 * rather than a batch edit.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-001",
    summary: "the service account is created under a name the service does not run as",
    correct: 'export const SERVICE_ACCOUNT = "svc-cart";',
    defective: 'export const SERVICE_ACCOUNT = "cart-api";',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-006",
    summary: "the store values are written one key above the policy key",
    correct: 'export const POLICY_KEY = ["HKLM", "SOFTWARE", "Veridian", "Policy"].join(SEP);',
    defective: 'export const POLICY_KEY = ["HKLM", "SOFTWARE", "Veridian"].join(SEP);',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-009",
    summary: "the service is defined and then inspected, never started",
    correct: '  ["sc", "start", SERVICE],',
    defective: '  ["sc", "query", SERVICE],',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-013",
    summary: "the auditing account keeps write access to the secrets file",
    correct:
      '    "/remove", AUDIT_ACCOUNT + ":(R)",\n' +
      '    "/remove", AUDIT_ACCOUNT + ":(W)",\n' +
      '    "/grant",',
    defective: '    "/remove", AUDIT_ACCOUNT + ":(R)",\n    "/grant",',
  }),
]);

/** What one defect's block says about one file's text. */
export interface DemoStatus {
  readonly defect: Defect;
  readonly state: DefectState;
}

/** The outcome of injecting every defect this file holds. */
export interface InjectOutcome {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

/** The outcome of repairing at most one defect. */
export interface RepairOutcome {
  readonly text: string;
  readonly repaired: Defect | null;
}

/**
 * What each defect's block says about the text it is given.
 *
 * Every defect is answered, including the ones whose block is in a file that could not be read, which
 * is why the caller reads the file rather than this function doing it: a demo that needed a file it
 * could not find should say so once, at the read, rather than have each defect report itself as
 * `unknown`.
 */
export function status(text: string): readonly DemoStatus[] {
  return defectStates(DEFECTS, text).map((entry: DefectStatus) =>
    Object.freeze({ defect: entry.defect, state: entry.state }),
  );
}

/**
 * Inject every defect that is not already in.
 *
 * `injectDefects` refuses a file whose blocks are ambiguous - neither form present, or both - so an
 * already-injected defect is reported as such rather than injected twice, and a file that has drifted
 * raises here rather than being edited into a third state.
 */
export function inject(text: string): InjectOutcome {
  const result: InjectResult = injectDefects(DEFECTS, PROVISION_FILE, text);
  return { text: result.text, injected: result.injected, alreadyInjected: result.alreadyInjected };
}

/**
 * Repair the **first still-injected** defect, in criterion order, and report which one it was.
 *
 * The repaired defect is returned so the caller can verify the change rather than describe it: a
 * function that edits a file must not announce a repair it has not confirmed.
 */
export function repairOne(text: string): RepairOutcome {
  const result: RepairResult = repairDefect(DEFECTS, PROVISION_FILE, text);
  return { text: result.text, repaired: result.repaired };
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
