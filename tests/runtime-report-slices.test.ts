/**
 * A bundle's clarification counters must agree with the clarification records printed beside them.
 *
 * `core/evidence/writer.ts` derives both numbers from one array of reports - `byVia` by summing each
 * report's own counts, `records` by flattening the records - so `sum(byVia) === records.length` is
 * true *by construction of that function*. It was nevertheless false in a real bundle, and this file
 * is the regression test for the reason: `core/execution/loop.ts` splits one runtime pass into one
 * report per origin, and the split copied the parent's `byVia` onto each slice while keeping only
 * that slice's records. Measured on the ladder fixture before the fix, `latest-result.json` carried
 * `byVia.defaulted: 5` beside three `defaulted` records and a `byVia` total of 19 beside 17 records.
 *
 * The property asserted here is the one a slice can support: **a slice's `byVia` counts the rungs
 * that produced the records it holds.** A parent may legitimately count more arrivals than it holds
 * records - `#askInRounds` increments `answered` and `deferred` for gaps whose own rung produced no
 * record - which is exactly why the slice recomputes rather than copies, and why the second test
 * gives its parent an arrival with no record to prove the two numbers are not assumed equal.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { restrictTo } from "../core/execution/loop.ts";
import type {
  Ambiguity,
  AmbiguityOrigin,
  ClarificationRecord,
  ClarificationReport,
  Rung,
} from "../core/clarification/types.ts";
import { RUNGS } from "../core/clarification/types.ts";

/** Summed by walking the register rather than by restating its six members here. */
function arrivals(report: ClarificationReport): number {
  return RUNGS.reduce((total, rung) => total + report.byVia[rung], 0);
}

function gap(id: string, origin: AmbiguityOrigin, path: string): Ambiguity {
  return { id, origin, path, kind: "missing_value", question: `What does ${path} hold?`, blocking: false };
}

function defaulted(id: string, origin: AmbiguityOrigin, path: string): ClarificationRecord {
  return {
    ambiguity: gap(id, origin, path),
    resolution: {
      via: "defaulted",
      value: "stop",
      assumption: "resolved without asking: a question asked mid-run would put the verdict behind a prompt",
    },
    rungsAttempted: ["derived", "defaulted"],
  };
}

function report(
  records: readonly ClarificationRecord[],
  byVia: Record<Rung, number>,
): ClarificationReport {
  return {
    records,
    questionsAsked: 0,
    rounds: 0,
    selfPromptRounds: 0,
    elapsedMs: 0,
    budgetExhausted: false,
    unresolvedBlocking: 0,
    byVia,
  };
}

test("gives each slice a byVia that counts only the records it keeps", () => {
  const parent = report([defaulted("a", "execution", "/a"), defaulted("b", "evidence", "/b")], {
    derived: 0,
    inferred: 0,
    defaulted: 2,
    self_prompted: 0,
    answered: 0,
    deferred: 0,
  });

  const slices = ["execution", "evidence"].map((origin) => restrictTo(parent, origin));

  for (const slice of slices) {
    assert.equal(slice.records.length, 1, "one origin contributes one record");
    assert.equal(slice.byVia.defaulted, 1, "and that slice counts one resolution, not the parent's two");
    assert.equal(arrivals(slice), slice.records.length, "a slice's arrivals are the rungs of the records it holds");
  }
});

test("makes the slices add up to the parent's records rather than to its arrivals", () => {
  const parent = report([defaulted("a", "execution", "/a"), defaulted("b", "evidence", "/b")], {
    derived: 0,
    inferred: 0,
    defaulted: 2,
    self_prompted: 0,
    // An arrival with no record beside it: `#askInRounds` counts a rung that resolved a gap whose
    // own branch then produced no record, so a parent's two counters are allowed to differ.
    answered: 1,
    deferred: 0,
  });

  const slices = ["execution", "evidence"].map((origin) => restrictTo(parent, origin));

  assert.equal(arrivals(parent), 3, "the parent counts three arrivals over two records");
  assert.equal(
    slices.reduce((total, slice) => total + arrivals(slice), 0),
    parent.records.length,
    "the slices together account for the parent's records, which is what the bundle's own two fields require",
  );
});

test("leaves a slice with nothing to hold claiming nothing", () => {
  const parent = report([defaulted("a", "execution", "/a")], {
    derived: 0,
    inferred: 0,
    defaulted: 1,
    self_prompted: 0,
    answered: 0,
    deferred: 0,
  });

  const slice = restrictTo(parent, "iteration");

  assert.equal(slice.records.length, 0, "an origin this pass did not resolve keeps no records");
  assert.equal(arrivals(slice), 0, "and therefore claims no resolutions");
});

test("does not mutate the report it reads", () => {
  const parent = report([defaulted("a", "execution", "/a"), defaulted("b", "evidence", "/b")], {
    derived: 0,
    inferred: 0,
    defaulted: 2,
    self_prompted: 0,
    answered: 0,
    deferred: 0,
  });

  restrictTo(parent, "execution");
  restrictTo(parent, "evidence");

  assert.equal(parent.records.length, 2, "the parent still holds both records");
  assert.equal(parent.byVia.defaulted, 2, "and still counts both resolutions");
});
