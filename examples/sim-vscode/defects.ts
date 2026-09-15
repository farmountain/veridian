/**
 * The four defects the `sim-vscode` demo injects, and the one file they all live in.
 *
 * ## Why the file is the extension and not the provisioner
 *
 * Every artifact this world judges is derived, on every run, from two inputs the application ships:
 * `app/provision.mjs`, which installs and drives the extension, and `app/extension/extension.js`,
 * which is the code under test. The defects live in the **extension**, because that is the artifact
 * whose behaviour every reading in `acceptance.yaml` describes: the world's subject is an extension
 * host, so the interesting edits are edits to an extension. `provision.mjs` is left alone, which also
 * keeps the two parties apart - the program that installs the extension is not the program being
 * judged, and a defect there would move readings the extension has no part in.
 *
 * ## Why the table is flat, and not a list of (file, defect) pairs
 *
 * `examples/sim-k8s/defects.ts` needed the pair because that application ships two manifest files, and
 * a defect that reported itself as fixed after matching something in a different file would be exactly
 * the failure it exists to catch. This application's defects all live in one file, so the table is flat
 * and `source.ts` reads and writes that one file - which keeps `defect-text.ts`'s single-text contract
 * honest: it takes one artifact's text and answers questions about it, and nothing here asks it to
 * span two.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * `criterionId` is the criterion filed against the defect - the criterion that reads the *defect
 * itself* rather than one of its consequences - and the set of criteria each defect actually moves is a
 * measurement, not an intention. `tests/sim-vscode-demo.test.ts` asserts the moved set per iteration,
 * so a criterion that starts moving for a reason nobody wrote down fails a test rather than quietly
 * changing what the demo means.
 *
 *   - `D1` writes the item back to the durable store instead of the list. It is filed against
 *     `vscode.state` (AC-014) and it has the widest consequence set of the four, which is why it is
 *     first in criterion order and therefore repaired first. Its consequences are all real and all
 *     separate: the store holds a bare string rather than a list, so the next host process reads it as
 *     an empty cart, so the status text never reaches two, and so does the channel's running count.
 *     This is the defect that has no analogue in the other worlds: with one host process per action,
 *     the durable store is the *only* thing one invocation can hand to the next, and a defect in it
 *     makes every count downstream wrong at once.
 *   - `D2` says "added item 2" where the contract reads "added 2". One criterion is filed
 *     (`vscode.output`, AC-015) and one moves: the channel is a cumulative transcript, and the count
 *     in the sentence is the extension's own running total rather than anything the world derives.
 *   - `D3` moves the extension's own readiness banner from "cart-web ready" to "cart ready". One
 *     criterion is filed (`vscode.message`, AC-016) and one moves. Like `sim-container`'s third
 *     defect this is a self-declaration: nothing in this world reads that sentence, so no derived
 *     reading can move - the only thing that can see it is a criterion that quotes it.
 *   - `D4` replaces the status bar text's cart glyph with a plain word. One criterion is filed
 *     (`vscode.status`, AC-017) and one moves. The status text is written twice per activation - once
 *     from the durable store and once after each add - so the reading the contract compares is the
 *     newest write, which is the handler's.
 *
 * The criteria no defect moves are not dead weight: they are the control. A run in which every
 * criterion moved would be a run whose readings are not independent - and here that control is
 * stronger than usual, because `AC-001` through `AC-013` describe what the application asked for and
 * what the extension registered, and none of them moves for any of the four edits.
 *
 * ## Ordering
 *
 * The table is in **criterion order** - AC-014, AC-015, AC-016, AC-017 - which is the order the repair
 * agent walks. That order is also what makes the demo's progression monotone: `D1`'s consequences
 * include two of the criteria the other defects are filed against, so repairing it first is what lets
 * the remaining failures shrink one at a time instead of all at once. One defect per iteration is what
 * makes the progression a diagnosis rather than a batch edit: iteration three's report is what
 * iteration two's repair left behind.
 *
 * ## Line endings
 *
 * `D1`, `D3` and `D4` are single-line blocks and `D2` is multi-line, which matters more than it looks.
 * A single-line block never reaches the newline conversion in `defect-text.ts`, so it cannot tell a
 * correct implementation of the CRLF rule from a broken one: this project has already shipped a demo
 * whose defect table was entirely single-line while its comment claimed the opposite, and measured
 * that breaking the rule left its test green. `D2`'s block therefore spans two lines so that a
 * checkout storing this file in CRLF reaches that conversion - and `tests/defect-text.test.ts` is
 * where the rule is held against synthetic blocks with both endings supplied by the test, because the
 * one thing a test over this table cannot do is supply the ending.
 *
 * `D2`'s block carries the `const limit` line below the channel line, and it carries it *unchanged* in
 * both forms, which is what makes it name one write. The line above it is `D4`'s, so including that
 * one instead would make `D4`'s injection break `D2`'s block and report the ambiguous `unknown` state.
 * Neither block is a substring of the other, and the defective form of neither contains the correct
 * form: `defect-text.ts` refuses that ambiguity by design.
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
export const EXTENSION_FILE = "extension/extension.js";

/**
 * In **criterion order**, which is the order the repair agent walks: `vscode.state` (AC-014) reads the
 * durable cart, `vscode.output` (AC-015) reads the channel's running count, `vscode.message` (AC-016)
 * reads the extension's own readiness banner and `vscode.status` (AC-017) reads the status bar text.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-014",
    summary: "the item is written to the durable store instead of the list it belongs to",
    correct: '      await context.globalState.update(ITEMS_KEY, JSON.stringify(items));',
    defective: '      await context.globalState.update(ITEMS_KEY, String(label));',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-015",
    summary: "the channel reports the add in words the contract does not read",
    correct:
      '      channel.appendLine("added " + String(items.length));\n' +
      '      const limit = vscode.workspace.getConfiguration("cart-web").get(LIMIT_KEY, LIMIT_FALLBACK);',
    defective:
      '      channel.appendLine("added item " + String(items.length));\n' +
      '      const limit = vscode.workspace.getConfiguration("cart-web").get(LIMIT_KEY, LIMIT_FALLBACK);',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-016",
    summary: "the extension declares itself ready under a name the contract does not read",
    correct: '  vscode.window.showInformationMessage("cart-web ready");',
    defective: '  vscode.window.showInformationMessage("cart ready");',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-017",
    summary: "the status bar shows the count in words instead of the cart glyph",
    correct: '      status.text = "$(cart) " + String(items.length);',
    defective: '      status.text = String(items.length) + " items";',
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
  const result: InjectResult = injectDefects(DEFECTS, EXTENSION_FILE, text);
  return { text: result.text, injected: result.injected, alreadyInjected: result.alreadyInjected };
}

/**
 * Repair the **first still-injected** defect, in criterion order, and report which one it was.
 *
 * The repaired defect is returned so the caller can verify the change rather than describe it: a
 * function that edits a file must not announce a repair it has not confirmed.
 */
export function repairOne(text: string): RepairOutcome {
  const result: RepairResult = repairDefect(DEFECTS, EXTENSION_FILE, text);
  return { text: result.text, repaired: result.repaired };
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
