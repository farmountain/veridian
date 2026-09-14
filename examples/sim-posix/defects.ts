/**
 * The four defects the `sim-posix` demo injects, and the one file they all live in.
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
 * ## What the four defects are for
 *
 * `D1` creates the service account under a name the unit does not use. One criterion moves -
 * `posix.user` - and it moves decisively, because a world that holds no account named `cart` holds no
 * account named `cart`. The unit's own `User=` line changes with it, and nothing notices: there is no
 * criterion in this contract that reads that line, which is stated here rather than left for a reader
 * to discover, because a defect that no criterion can see is a defect a contract should be honest
 * about having chosen not to see.
 *
 * `D2` moves the hardening baseline to a neighbouring path. Two criteria move and they move
 * *differently*: `posix.file` reads the state record and answers `FAIL`, because the sandbox genuinely
 * holds no file at the path the policy names; `posix.contents` cannot do anything with a file that is
 * not in its reading and answers `INCONCLUSIVE`, naming the criterion that owns the question. The pair
 * is the clearest evidence this project has that `INCONCLUSIVE` is not a softer `FAIL` - one reading is
 * decisive and the other is honest about being unable to be.
 *
 * `D3` installs the secrets file world-readable. Three criteria move, and they are three different
 * kinds of reading of one fact: `posix.permission` compares the mode the world recorded,
 * `posix.owner` is unaffected and stays green - which is the point, because it proves the two criteria
 * are genuinely asking different questions rather than the same one twice - and `posix.probe` reads
 * what the *world* did when the criterion itself tried to read the file as the account it acts as. That
 * third one is the verdict that matters: a contract that asserted the mode alone would be asserting a
 * spelling, and the thing being hardened is whether an ordinary account can reach the bytes.
 *
 * `D4` enables the unit and then asks whether it is active instead of starting it. Two criteria move,
 * and both are *consequences* rather than the defect: `posix.running` finds no service the world ever
 * brought up, and `posix.port` finds no socket to connect to. This is the shape the whole world was
 * built around - a unit that is present and a service that is not running are two different readings -
 * and it is the reason `posix.service` (presence) and `posix.running` (state) are separate validators.
 *
 * ## One criterion, or several
 *
 * A defect may be visible through several criteria and this file names one. The rule is that
 * `criterionId` is the criterion that reads the *defect itself* rather than its consequence - the
 * account, the path, the mode, the state - so that a reader who follows the id lands on the criterion
 * that would have caught it even if every derived reading had happened to be right.
 *
 * ## Line endings
 *
 * `D4` is a two-line block and `D1`-`D3` are single lines, which matters more than it looks. A
 * single-line block never reaches the newline conversion in `defect-text.ts`, so it cannot tell a
 * correct implementation of the CRLF rule from a broken one: this project already shipped a demo whose
 * defect table was entirely single-line while its comment claimed the opposite, and measured that
 * breaking the rule left its test green. `D4`'s block is multi-line so that a checkout storing this
 * file in CRLF reaches that conversion, and `tests/defect-text.test.ts` is where the rule is held
 * against synthetic blocks with both endings supplied by the test.
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
 * In **criterion order**, which is the order the repair agent walks: `posix.user` (AC-003) reads the
 * account, `posix.file` (AC-006) reads the baseline's path, `posix.permission` (AC-008) reads the
 * secret's mode and `posix.running` (AC-010) reads the unit's state. Ordering matters because
 * `repairOne` repairs exactly one defect per call - one defect per iteration is what makes the demo's
 * progression a diagnosis rather than a batch edit.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-003",
    summary: "the service account is created under a name the unit does not run as",
    correct: 'export const SERVICE_ACCOUNT = "cart";',
    defective: 'export const SERVICE_ACCOUNT = "cart-api";',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-006",
    summary: "the hardening baseline is installed at a path the policy does not name",
    correct: 'export const BASELINE_PATH = "/etc/veridian/policy.conf";',
    defective: 'export const BASELINE_PATH = "/etc/veridian/policy.cfg";',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-008",
    summary: "the secrets file is installed world-readable",
    correct: 'export const SECRETS_MODE = "0600";',
    defective: 'export const SECRETS_MODE = "0644";',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-010",
    summary: "the unit is enabled and then inspected, never started",
    correct: '  ["systemctl", "enable", SERVICE],\n  ["systemctl", "start", SERVICE],',
    defective: '  ["systemctl", "enable", SERVICE],\n  ["systemctl", "status", SERVICE],',
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
