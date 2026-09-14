/**
 * The mechanics of textual defect overlays, shared by every example under `examples/`.
 *
 * A defect is a *textual* overlay on a correct artifact: the correct text it replaces, and the text
 * that replaces it. That is deliberately dumb. Veridian's job is to judge an application, not to
 * understand one, and a demo's defects must be expressed in the only language Veridian is allowed to
 * speak about the application - the observable state it produces. Injecting them by editing the
 * source is how the *demo* creates a broken application; it is not something Veridian does.
 *
 * ## Why this file exists
 *
 * Two examples now need the same three operations over such a table, and one of them encoded a bug
 * this repository has already paid for twice: **a multi-line block written with `\n` does not match
 * a file the checkout wrote with CRLF**, so the edit lands nowhere and the demo reports a `PASS` the
 * application never earned. Two copies of `newlineOf` is two chances to get that wrong and one
 * chance for a fix to reach only one of them. The table stays per-demo - only the demo knows its own
 * defects - but the comparison is here, once.
 *
 * A defect table that carries its own copy of this logic is therefore not merely redundant: it is a
 * second implementation of the one thing the canonical demo learned the hard way.
 */

export interface Defect {
  /** Stable short name, used in log lines and in the demo's narration. */
  readonly id: string;
  /** The acceptance criterion this defect causes to fail. */
  readonly criterionId: string;
  /** One line, in the words of the failure a reader will see. */
  readonly summary: string;
  /** The exact text the correct artifact contains, exactly once. */
  readonly correct: string;
  /** The exact text that replaces it, exactly once. */
  readonly defective: string;
}

export type DefectState = "injected" | "intact" | "unknown";

export interface DefectStatus {
  readonly defect: Defect;
  readonly state: DefectState;
}

export interface InjectResult {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

export interface RepairResult {
  readonly text: string;
  readonly repaired: Defect | null;
}

/** How many times `needle` occurs in `haystack`. */
export function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The line ending a buffer actually uses. Mixed endings resolve to whichever appears first. */
export function newlineOf(text: string): string {
  const firstNewline = text.search(/\r?\n/);
  return firstNewline !== -1 && text[firstNewline] === "\r" ? "\r\n" : "\n";
}

/** Re-express a block written with `\n` in the file's own line ending. */
export function inStyle(block: string, newline: string): string {
  return newline === "\n" ? block : block.split("\n").join(newline);
}

/**
 * Classify each defect against `text`.
 *
 * `unknown` is a first-class outcome, not an error to be smoothed over. It means the file contains
 * neither the correct nor the defective form of an edit this table believes it owns, so the artifact
 * is not the artifact the demo was written against. Injecting or repairing from that state would be
 * guessing, and a guess here produces a demo that proves nothing while reporting success.
 *
 * A defect whose `correct` block is a *prefix* of its `defective` block reports `unknown` rather than
 * `injected`, which is the desired outcome: both counts are one, and the situation is genuinely
 * ambiguous. Write blocks that differ, and include the punctuation that makes them differ.
 */
export function defectStates(defects: readonly Defect[], text: string): readonly DefectStatus[] {
  const newline = newlineOf(text);
  return defects.map((defect) => {
    const hasCorrect = occurrences(text, inStyle(defect.correct, newline)) === 1;
    const hasDefective = occurrences(text, inStyle(defect.defective, newline)) === 1;
    if (hasDefective && !hasCorrect) return { defect, state: "injected" as const };
    if (hasCorrect && !hasDefective) return { defect, state: "intact" as const };
    return { defect, state: "unknown" as const };
  });
}

/**
 * Replace every intact defect with its defective form.
 *
 * Idempotent: running it twice is the same as running it once, because a defect already in its
 * defective form is left alone. Throws on `unknown` rather than reporting a partial success, because
 * a partial success here is a demo that is broken in a way nobody will notice until the verdict is
 * wrong.
 *
 * `fileName` is only ever used to name the artifact in that message. A refusal that did not say
 * *which* file was not the file the demo was written against would send the reader to inspect the
 * one thing that is not broken - a lesson this repository has paid for more than once.
 */
export function injectDefects(defects: readonly Defect[], fileName: string, text: string): InjectResult {
  let next = text;
  const injected: string[] = [];
  const alreadyInjected: string[] = [];
  const newline = newlineOf(text);

  for (const { defect, state } of defectStates(defects, text)) {
    if (state === "unknown") {
      throw new Error(
        `cannot inject ${defect.id}: ${fileName} contains neither the correct nor the defective form of ` +
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

/**
 * Repair exactly the first defect that is still injected, in the table's order - which is criterion
 * order.
 *
 * One per call, on purpose. A repair script that fixed every defect at once would take the run from
 * three failures straight to `PASS`, and the intermediate observation - the repaired sub-set that
 * still fails, which is the evidence that a criterion is judged independently of its neighbours -
 * would never be produced.
 *
 * It returns the defect it repaired rather than only the text, so a caller can *verify* that what it
 * removed is what it claimed to remove. A function that changes a file must not announce a change it
 * has not checked.
 */
export function repairDefect(defects: readonly Defect[], fileName: string, text: string): RepairResult {
  const newline = newlineOf(text);
  for (const { defect, state } of defectStates(defects, text)) {
    if (state === "unknown") {
      throw new Error(
        `cannot repair ${defect.id}: ${fileName} contains neither the correct nor the defective form of ` +
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
