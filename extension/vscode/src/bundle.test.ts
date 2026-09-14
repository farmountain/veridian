/**
 * Tests for reading a run bundle.
 *
 * Two jobs. The first is the ordinary one: a summary is produced for a real result document, and
 * `null` - never an exception - for anything that is not one. The second is the reason this file is
 * worth more than its size: the Cockpit reads a document that another layer writes, and **a second
 * reader of a document can drift from it**. `schemas/result.schema.json` is the file both readers are
 * supposed to obey, so the test reads it and pins the two vocabularies the summariser keys on. A
 * status the engine adds and the Cockpit does not know about would otherwise be a criterion that
 * silently stops gating the dashboard - the exact shape of every drift defect this repository has
 * already paid for.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { describeVerdict, summariseResult } from "./bundle.ts";

const SCHEMA_PATH = fileURLToPath(new URL("../../../schemas/result.schema.json", import.meta.url));

function readSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// The schema pin
// ---------------------------------------------------------------------------------------------

test("the schema requires the one field the summariser refuses to invent", () => {
  const schema = readSchema();
  const required = schema["required"];
  assert.ok(Array.isArray(required), "result.schema.json must declare a required list");
  // `verdict` is the only field whose absence makes `summariseResult` return null. If the schema
  // stopped requiring it, a bundle with no verdict would be *valid*, and the Cockpit's null would
  // start meaning "unreadable file" as well as "not a result" - two causes, one answer.
  assert.ok(
    required.includes("verdict"),
    "result.schema.json must keep `verdict` required, or a valid bundle may have no verdict",
  );
});

test("every criterion status the vocabulary defines is classified as gating or not", () => {
  const schema = readSchema();
  const defs = schema["$defs"];
  assert.ok(typeof defs === "object" && defs !== null, "result.schema.json must declare $defs");
  const status = (defs as Record<string, unknown>)["Status"];
  assert.ok(typeof status === "object" && status !== null, "a Status definition must exist");
  const vocabulary = (status as Record<string, unknown>)["enum"];
  assert.ok(Array.isArray(vocabulary), "Status must be an enum");

  // Read out of the source, because the lists are module-private and exporting them would invite a
  // caller to build a third one. The assertion is that the two lists *between them* cover the
  // vocabulary: a new status is either gating or it is named as not gating, and there is no third
  // possibility - an unlisted status is one the dashboard would silently ignore.
  const source = readFileSync(fileURLToPath(new URL("./bundle.ts", import.meta.url)), "utf8");
  const classified = new Set<string>();
  for (const match of source.matchAll(/"([A-Z_]+)"/g)) {
    const value = match[1];
    if (value !== undefined && /^(PASS|FAIL|ERROR|SKIPPED|INCONCLUSIVE)$/.test(value)) {
      classified.add(value);
    }
  }
  // `SKIPPED` is deliberately in the "not gating" sentence rather than in a list, so it is asserted
  // by name as well: the point is that the decision was *made*, not that it was made in a constant.
  assert.ok(source.includes("SKIPPED"), "the file must name SKIPPED and say why it does not gate");

  for (const value of vocabulary) {
    assert.ok(
      classified.has(String(value)) || String(value) === "SKIPPED",
      `the Cockpit does not classify the status "${String(value)}"`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

test("a result document becomes a summary", () => {
  const summary = summariseResult({
    run_id: "run-2024-01-01T00-00-00",
    goal_id: "shopping-cart",
    verdict: "FAIL",
    state: "FAILED",
    iteration: 2,
    criteria: [
      { criterion_id: "AC-001", status: "PASS", mandatory: true },
      { criterion_id: "AC-002", status: "FAIL", mandatory: true, message: "expected 3 rows" },
      { criterion_id: "AC-003", status: "INCONCLUSIVE", mandatory: true },
      { criterion_id: "AC-004", status: "SKIPPED", mandatory: false },
    ],
    reasons: ["AC-002 failed"],
    evidence: { complete: true },
    iterations: [
      { iteration: 1, verdict: "FAIL", passed: 1, failed: 2, undecided: 1, note: "first" },
      { iteration: 2, verdict: "FAIL", passed: 2, failed: 1, undecided: 1, note: "second" },
    ],
  });

  assert.ok(summary !== null);
  assert.equal(summary.runId, "run-2024-01-01T00-00-00");
  assert.equal(summary.verdict, "FAIL");
  assert.equal(summary.state, "FAILED");
  assert.equal(summary.iteration, 2);
  assert.equal(summary.criteria.length, 4);
  assert.equal(summary.evidenceComplete, true);
  assert.deepEqual(summary.reasons, ["AC-002 failed"]);
  assert.equal(summary.iterations.length, 2);
  assert.equal(summary.iterations[1]?.note, "second");
});

test("the blocking list holds the failures, worst status first, and never SKIPPED", () => {
  const summary = summariseResult({
    verdict: "FAIL",
    criteria: [
      { criterion_id: "AC-003", status: "INCONCLUSIVE", mandatory: true },
      { criterion_id: "AC-001", status: "PASS", mandatory: true },
      { criterion_id: "AC-004", status: "SKIPPED", mandatory: false },
      { criterion_id: "AC-002", status: "FAIL", mandatory: true },
      { criterion_id: "AC-005", status: "ERROR", mandatory: true },
    ],
  });
  assert.ok(summary !== null);
  // SKIPPED is absent: the schema says it "never gates the verdict", so lifting it into a list called
  // "blocking" would have the dashboard report a failure the run did not.
  assert.deepEqual(
    summary.blocking.map((line) => line.criterionId),
    ["AC-002", "AC-005", "AC-003"],
  );
});

test("a criterion that says nothing about being mandatory is not treated as gating", () => {
  const summary = summariseResult({
    verdict: "FAIL",
    criteria: [{ criterion_id: "AC-001", status: "FAIL" }],
  });
  assert.ok(summary !== null);
  // Read as optional rather than mandatory, because the alternative invents a requirement the
  // document never stated. The run-level verdict is what decides, and it is not this flag.
  assert.equal(summary.criteria[0]?.mandatory, false);
  assert.equal(summary.criteria[0]?.message, null);
});

test("anything that is not a run result reads as null rather than as a guess", () => {
  for (const value of [
    null,
    undefined,
    42,
    "PASS",
    [],
    {},
    { verdict: "pass" },
    { verdict: "UNKNOWN" },
    { verdict: 7 },
  ]) {
    assert.equal(summariseResult(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

test("a malformed criterion is skipped without discarding the run", () => {
  const summary = summariseResult({
    verdict: "FAIL",
    criteria: [
      { criterion_id: "AC-001", status: "FAIL" },
      { status: "FAIL" },
      { criterion_id: "AC-003" },
      null,
      "AC-004",
    ],
  });
  assert.ok(summary !== null);
  assert.deepEqual(summary.blocking.map((line) => line.criterionId), ["AC-001"]);
});

test("missing optional sections read as empty, not as absent", () => {
  const summary = summariseResult({ verdict: "INCONCLUSIVE" });
  assert.ok(summary !== null);
  assert.equal(summary.runId, "(unrecorded)");
  assert.equal(summary.state, "(unrecorded)");
  assert.equal(summary.iteration, 0);
  assert.deepEqual(summary.reasons, []);
  assert.deepEqual(summary.iterations, []);
  assert.equal(summary.evidenceComplete, null);
});

// ---------------------------------------------------------------------------------------------
// The dashboard line
// ---------------------------------------------------------------------------------------------

test("a pass says pass and counts the criteria, not the failures", () => {
  const summary = summariseResult({ verdict: "PASS", iteration: 4, criteria: [{ criterion_id: "AC-001", status: "PASS" }] });
  assert.ok(summary !== null);
  assert.equal(describeVerdict(summary), "Veridian: PASS (1 criteria, iteration 4)");
});

test("a failure counts the failed and the undecided separately, because they are not the same", () => {
  const summary = summariseResult({
    verdict: "FAIL",
    iteration: 2,
    criteria: [
      { criterion_id: "AC-001", status: "FAIL" },
      { criterion_id: "AC-002", status: "FAIL" },
      { criterion_id: "AC-003", status: "INCONCLUSIVE" },
    ],
  });
  assert.ok(summary !== null);
  // Collapsing the two would be the `passed/failed` collapse this project already paid for: an
  // undecided criterion is not a failing one, and an operator acts differently on each.
  assert.equal(describeVerdict(summary), "Veridian: FAIL (2 failed, 1 undecided, iteration 2)");
});

test("an INCONCLUSIVE verdict is worded so it cannot be read as a pass", () => {
  const summary = summariseResult({ verdict: "INCONCLUSIVE", iteration: 1, criteria: [] });
  assert.ok(summary !== null);
  assert.equal(describeVerdict(summary), "Veridian: INCONCLUSIVE (no criteria recorded, iteration 1)");
  assert.ok(!describeVerdict(summary).includes("PASS"));
});
