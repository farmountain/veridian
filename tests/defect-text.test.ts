import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defectStates,
  injectDefects,
  inStyle,
  newlineOf,
  occurrences,
  repairDefect,
  type Defect,
} from "../examples/defect-text.ts";

/**
 * The one implementation of the line-ending rule, tested where the rule actually lives.
 *
 * ## Why this file exists
 *
 * The rule - *a textual overlay must be re-expressed in the file's own line ending* - is the rule
 * this repository has paid for twice. It was held by a test in `tests/inventory-db-demo.test.ts`
 * that read the demo's build script off disk and asserted it contained `\r\n`. That assertion failed
 * on `ubuntu-latest` the first time CI ran, and it was wrong in a second way that took longer to see:
 * **every block in that demo's table is a single line**, so the rule was never reached and a
 * deliberately broken `newlineOf` left the whole suite green. A test that passes whether or not the
 * rule holds is not a test; it is a comment with a budget.
 *
 * So the rule is held here, against the shared implementation, with the shape that makes a mismatch
 * *possible* - a multi-line block - and with **both** line endings supplied by the test rather than
 * inherited from whatever the checkout happens to have. `core.autocrlf` is `true` on Windows and
 * `false` on Linux, and this repository has no `.gitattributes`, so a test that reads a file and
 * names an ending is a statement about the developer's git configuration.
 *
 * ## What a defect is here
 *
 * Single-line defects are the ordinary case and are kept, because they must keep working: a
 * single-line block has no newline to get wrong, and a change that broke them while fixing the
 * multi-line path would be a regression this file is now also holding.
 */

/** A defect whose block spans lines, which is the only shape that can exhibit the rule. */
const MULTI_LINE: Defect = Object.freeze({
  id: "D-multiline",
  criterionId: "AC-900",
  summary: "a three-line block is replaced by a longer one",
  correct: ["function total(items) {", "  return sum(items);", "}"].join("\n"),
  defective: ["function total(items) {", "  return sum(items) + 1;", "  // off by one", "}"].join("\n"),
});

const SINGLE_LINE: Defect = Object.freeze({
  id: "D-single",
  criterionId: "AC-901",
  summary: "one line becomes another",
  correct: "  return Math.round(dollars * 100);",
  defective: "  return Math.round(dollars * 10);",
});

/** Re-express a `\n`-authored body in `eol`, which is how each platform's checkout looks. */
const asEol = (body: string, eol: string): string => body.replace(/\r\n|\n/g, eol);

describe("defect-text: the line ending a buffer actually uses", () => {
  it("reads the ending, and defaults to LF when there is no newline at all", () => {
    assert.equal(newlineOf("a\r\nb"), "\r\n");
    assert.equal(newlineOf("a\nb"), "\n");
    assert.equal(newlineOf("no newline here"), "\n", "an empty or single-line buffer has no ending to read");
    assert.equal(newlineOf(""), "\n");
    // Mixed: the *first* ending decides, and that is a deliberate choice rather than an accident of
    // `search`. A file whose first line ends CRLF and whose later lines end LF is a file something
    // else wrote badly; picking the first ending and matching consistently is what lets the injected
    // block at least be uniform, and the mismatch is reported as `unknown` rather than smoothed over.
    assert.equal(newlineOf("a\r\nb\nc"), "\r\n");
    assert.equal(newlineOf("a\nb\r\nc"), "\n");
  });

  it("re-expresses a block without touching its content", () => {
    const block = "a\nb\nc";
    assert.equal(inStyle(block, "\n"), block, "an LF block in an LF file needs no conversion");
    assert.equal(inStyle(block, "\r\n"), "a\r\nb\r\nc");
    assert.equal(inStyle(block, "\n").split("\n").length, 3);
    // A block that is already CRLF must survive an LF conversion unchanged rather than being split
    // into `\r`-terminated lines: converting to LF is a no-op, not a normalisation.
    assert.equal(inStyle("a\r\nb", "\n"), "a\r\nb");
  });

  it("counts occurrences, because a block that matches twice is an ambiguous block", () => {
    assert.equal(occurrences("aaa", "a"), 3);
    assert.equal(occurrences("aaa", "aa"), 1);
    assert.equal(occurrences("abc", "z"), 0);
    assert.equal(occurrences("", "a"), 0);
  });
});

describe("defect-text: injecting and repairing is ending-agnostic", () => {
  const table = [MULTI_LINE, SINGLE_LINE] as const;
  const correct = ["function total(items) {", "  return sum(items);", "}", "", SINGLE_LINE.correct, ""].join("\n");

  for (const eol of ["\n", "\r\n"] as const) {
    const name = eol === "\n" ? "LF" : "CRLF";

    it(`injects a multi-line block into a ${name} body using that body's own ending`, () => {
      const body = asEol(correct, eol);
      const result = injectDefects(table, "fixture.txt", body);

      assert.equal(result.injected.length, table.length, `both defects must land in a ${name} body`);
      assert.deepEqual(result.alreadyInjected, []);
      assert.notEqual(result.text, body, "the injection changed nothing, which is what a mismatch looks like");

      // The property the rule exists for: the injected block carries the *body's* ending. Asserting
      // `includes("\r\n")` here would be the platform-dependent mistake; asserting the count of the
      // body's own ending is the fact.
      const block = asEol(MULTI_LINE.defective, eol);
      assert.ok(result.text.includes(block), `the injected block is not expressed in ${name}`);

      // A three-line block replaced by a four-line block adds exactly one line. Checked against the
      // body's own ending so the arithmetic is the same on both platforms.
      assert.equal(
        result.text.split(eol).length - body.split(eol).length,
        1,
        `the ${name} injection must add exactly the one line the replacement adds`,
      );
      // The failure mode that produced the false PASS: a block re-expressed by replacing `\n` with
      // `\r\n` over text that already held `\r\n` leaves a doubled carriage return behind.
      assert.ok(!result.text.includes("\r\r"), `the ${name} injection doubled a carriage return`);
    });

    it(`restores a ${name} body to exactly the bytes it started with`, () => {
      const body = asEol(correct, eol);
      let text = injectDefects(table, "fixture.txt", body).text;
      let repaired = 0;
      for (let i = 0; i < table.length; i += 1) {
        const step = repairDefect(table, "fixture.txt", text);
        assert.notEqual(step.repaired, null, `repair ${String(i + 1)} found nothing to fix in a ${name} body`);
        text = step.text;
        repaired += 1;
      }
      assert.equal(repaired, table.length);
      assert.equal(text, body, `the ${name} round trip must return the original bytes, not a normalised version`);
    });
  }

  it("produces the same edit in both endings, differing only by the ending itself", () => {
    const lf = injectDefects(table, "fixture.txt", asEol(correct, "\n")).text;
    const crlf = injectDefects(table, "fixture.txt", asEol(correct, "\r\n")).text;
    assert.equal(
      crlf.replace(/\r\n/g, "\n"),
      lf,
      "the two endings must differ by the line ending and nothing else, or the block itself is wrong",
    );
  });

  it("finds nothing when the block is written for the other ending", () => {
    // The negative half, and the actual defect this rule exists to prevent. A CRLF-authored block
    // searched for in an LF body matches no line, so the edit lands nowhere and the demo would go on
    // to report a PASS it never earned. Expressed as the state machine sees it: `unknown`, not
    // `injected` and not an exception - the artifact is not the artifact the table describes.
    const crlfAuthored: Defect = Object.freeze({
      id: "D-crlf-authored",
      criterionId: "AC-902",
      summary: "the same block, authored with CRLF instead of LF",
      correct: asEol(MULTI_LINE.correct, "\r\n"),
      defective: asEol(MULTI_LINE.defective, "\r\n"),
    });
    const lfBody = asEol(correct, "\n");

    const [state] = defectStates([crlfAuthored], lfBody);
    assert.equal(state?.state, "unknown", "a CRLF block in an LF body must be unknown, not injected");

    // And the implementation refuses to guess rather than silently injecting nothing.
    assert.throws(
      () => injectDefects([crlfAuthored], "fixture.txt", lfBody),
      /neither the correct nor the defective/,
      "injecting from an unknown state must throw, because a demo that injects nothing proves nothing",
    );
  });

  it("holds single-line defects too, so the multi-line path is not the only one that works", () => {
    const body = asEol(correct, "\n");
    const result = injectDefects([SINGLE_LINE], "fixture.txt", body);
    assert.equal(result.injected.length, 1);
    assert.equal(result.text.split("\n").length, body.split("\n").length, "a single-line edit adds no line");

    const repaired = repairDefect([SINGLE_LINE], "fixture.txt", result.text);
    assert.equal(repaired.repaired?.id, SINGLE_LINE.id);
    assert.equal(repaired.text, body);
  });
});
