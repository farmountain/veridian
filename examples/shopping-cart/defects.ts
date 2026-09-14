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
 * The blocks here are written with `\n`, and are re-expressed in the line ending the file on disk
 * actually uses before they are searched for. That is not defensive padding: a Windows checkout with
 * Git's default `core.autocrlf=true` rewrites `cart.js` to CRLF, and a multi-line edit that had been
 * written with `\n` would then match nothing, so the demo would inject nothing and report a PASS the
 * application never earned. The defect is a change of text, not a change of encoding, so the table
 * states it in one and the file's own convention is applied at the point of use.
 */

export interface Defect {
  /** Stable short name, used in log lines and in the demo README. */
  readonly id: string;
  /** The criterion this defect causes to fail. */
  readonly criterionId: string;
  /** One line, in the words of the failure a reader will see. */
  readonly summary: string;
  /** The exact text the correct app contains, exactly once. */
  readonly correct: string;
  /** The exact text that replaces it, exactly once. */
  readonly defective: string;
}

export type DefectState = "injected" | "intact" | "unknown";

export interface DefectStatus {
  readonly defect: Defect;
  readonly state: DefectState;
}

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

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The line ending a buffer actually uses. Mixed endings resolve to whichever appears first. */
function newlineOf(text: string): string {
  const firstNewline = text.search(/\r?\n/);
  return firstNewline !== -1 && text[firstNewline] === "\r" ? "\r\n" : "\n";
}

/** Re-express a block written with `\n` in the file's own line ending. */
function inStyle(block: string, newline: string): string {
  return newline === "\n" ? block : block.split("\n").join(newline);
}

/**
 * Classify each defect against `text`.
 *
 * `unknown` is a first-class outcome, not an error to be smoothed over. It means the file contains
 * neither the correct nor the defective form of an edit this module believes it owns, so the app is
 * not the app this module was written against. Injecting or repairing from that state would be
 * guessing, and a guess here produces a demo that proves nothing while reporting success.
 */
export function status(text: string): readonly DefectStatus[] {
  const newline = newlineOf(text);
  return DEFECTS.map((defect) => {
    const hasCorrect = occurrences(text, inStyle(defect.correct, newline)) === 1;
    const hasDefective = occurrences(text, inStyle(defect.defective, newline)) === 1;
    if (hasDefective && !hasCorrect) return { defect, state: "injected" as const };
    if (hasCorrect && !hasDefective) return { defect, state: "intact" as const };
    return { defect, state: "unknown" as const };
  });
}

export interface InjectResult {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

/**
 * Replace every intact defect with its defective form.
 *
 * Idempotent: running it twice is the same as running it once, because a defect already in its
 * defective form is left alone. Throws on `unknown` rather than reporting a partial success, because
 * a partial success here is a demo that is broken in a way nobody will notice until the verdict is
 * wrong.
 */
export function inject(text: string): InjectResult {
  let next = text;
  const injected: string[] = [];
  const alreadyInjected: string[] = [];
  const newline = newlineOf(text);

  for (const { defect, state } of status(text)) {
    if (state === "unknown") {
      throw new Error(
        `cannot inject ${defect.id}: cart.js contains neither the correct nor the defective form of ` +
          `this edit, so it is not the file this demo was written against`,
      );
    }
    if (state === "injected") {
      alreadyInjected.push(defect.id);
      continue;
    }
    next = next.replace(inStyle(defect.correct, newline), inStyle(defect.defective, newline));
    injected.push(defect.id);
  }

  return { text: next, injected, alreadyInjected };
}

export interface RepairResult {
  readonly text: string;
  readonly repaired: Defect | null;
}

/**
 * Repair exactly the first defect that is still injected, in criterion order.
 *
 * One per call, on purpose. A repair script that fixed all three at once would take the run from
 * three failures straight to `PASS`, and the intermediate observation - the repaired sub-set that
 * still fails, which is the evidence that a criterion is judged independently of its neighbours -
 * would never be produced.
 */
export function repairOne(text: string): RepairResult {
  const newline = newlineOf(text);
  for (const { defect, state } of status(text)) {
    if (state === "unknown") {
      throw new Error(
        `cannot repair ${defect.id}: cart.js contains neither the correct nor the defective form of ` +
          `this edit, so a repair would be a guess`,
      );
    }
    if (state === "injected") {
      return {
        text: text.replace(inStyle(defect.defective, newline), inStyle(defect.correct, newline)),
        repaired: defect,
      };
    }
  }
  return { text, repaired: null };
}
