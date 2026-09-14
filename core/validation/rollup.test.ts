import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROLLUP_GUARDS, rollup, type RollupInput } from "./rollup.ts";
import { CRITERION_STATUSES, type CriterionResult, type CriterionStatus } from "./types.ts";

const criterion = (
  id: string,
  status: CriterionStatus,
  over: Partial<CriterionResult> = {},
): CriterionResult => ({
  criterionId: id,
  description: `${id} description`,
  mandatory: true,
  status,
  actual: null,
  expected: null,
  timestamp: "2026-01-01T00:00:00.000Z",
  message: null,
  missingEvidence: [],
  evidence: [],
  environmentId: "env-1",
  runId: "run-20260101-000000-abcdef",
  assertions: [],
  ...over,
});

const input = (over: Partial<RollupInput> = {}): RollupInput => ({
  criteria: [criterion("AC-001", "PASS"), criterion("AC-002", "PASS")],
  environmentValid: true,
  safetyViolation: null,
  insufficientInformation: false,
  ...over,
});

describe("rollup verdict", () => {
  it("passes only when every guard holds", () => {
    const outcome = rollup(input());
    assert.equal(outcome.verdict, "PASS");
    assert.equal(outcome.failure, null);
    assert.equal(outcome.mandatoryTotal, 2);
    assert.equal(outcome.mandatoryPassed, 2);
    assert.deepEqual(
      Object.values(outcome.guards),
      ROLLUP_GUARDS.map(() => true),
    );
  });

  it("reports every guard explicitly so a missing guard cannot hide", () => {
    const outcome = rollup(input());
    assert.deepEqual(Object.keys(outcome.guards).sort(), [...ROLLUP_GUARDS].sort());
  });

  it("fails the run on a safety violation, even with every criterion passing", () => {
    const outcome = rollup(input({ safetyViolation: "outbound request to api.example.com" }));
    assert.equal(outcome.verdict, "FAIL");
    assert.equal(outcome.failure?.kind, "SECURITY_VIOLATION");
  });

  it("makes an invalid environment inconclusive, never PASS", () => {
    const outcome = rollup(input({ environmentValid: false }));
    assert.equal(outcome.verdict, "INCONCLUSIVE");
    assert.equal(outcome.failure?.kind, "ENVIRONMENT_FAILURE");
  });

  it("refuses a vacuous PASS when no criterion is mandatory", () => {
    const outcome = rollup(input({ criteria: [criterion("AC-001", "PASS", { mandatory: false })] }));
    assert.equal(outcome.verdict, "INCONCLUSIVE");
    assert.match(outcome.failure?.message ?? "", /nothing that could have been proven/);
  });

  it("fails the run when a mandatory criterion fails", () => {
    const outcome = rollup(input({ criteria: [criterion("AC-001", "PASS"), criterion("AC-002", "FAIL")] }));
    assert.equal(outcome.verdict, "FAIL");
    assert.equal(outcome.failure?.criterionId, "AC-002");
    assert.equal(outcome.mandatoryPassed, 1);
  });

  it("carries the declared failure kind of the failing criterion instead of a generic failure", () => {
    const outcome = rollup(
      input({
        criteria: [
          criterion("AC-001", "FAIL", {
            assertions: [
              { validator: "text", target: "#t", status: "FAIL", actual: "0", expected: "1", message: null, failureKind: "APPLICATION_ERROR" },
            ],
          }),
        ],
      }),
    );
    assert.equal(outcome.failure?.kind, "APPLICATION_ERROR");
  });

  it("is inconclusive when a mandatory criterion is UNDECIDED, whatever the others say", () => {
    for (const status of ["ERROR", "INCONCLUSIVE", "SKIPPED"] as const) {
      const outcome = rollup(input({ criteria: [criterion("AC-001", "PASS"), criterion("AC-002", status)] }));
      assert.equal(outcome.verdict, "INCONCLUSIVE", `${status} must not become PASS`);
      assert.equal(outcome.guards.allMandatoryDecided, false);
    }
  });

  it("is inconclusive when a blocking ambiguity forced the contract to be deferred", () => {
    const outcome = rollup(input({ insufficientInformation: true }));
    assert.equal(outcome.verdict, "INCONCLUSIVE");
    assert.equal(outcome.guards.informationSufficient, false);
  });

  it("is inconclusive - with an infrastructure failure - when required evidence is missing", () => {
    const outcome = rollup(
      input({
        criteria: [
          criterion("AC-001", "PASS"),
          criterion("AC-002", "INCONCLUSIVE", { missingEvidence: ["trace"] }),
        ],
      }),
    );
    assert.equal(outcome.verdict, "INCONCLUSIVE");
    assert.equal(outcome.failure?.kind, "INFRASTRUCTURE_FAILURE");
    assert.equal(outcome.guards.requiredEvidencePresent, false);
  });

  it("ignores an optional criterion's failure", () => {
    const outcome = rollup(
      input({ criteria: [criterion("AC-001", "PASS"), criterion("AC-099", "FAIL", { mandatory: false })] }),
    );
    assert.equal(outcome.verdict, "PASS");
  });

  it("rarer precedence: a safety violation outranks a broken environment", () => {
    const outcome = rollup(input({ safetyViolation: "wrote outside the sandbox", environmentValid: false }));
    assert.equal(outcome.verdict, "FAIL");
    assert.equal(outcome.failure?.kind, "SECURITY_VIOLATION");
  });

  it("rarer precedence: a broken environment outranks a criterion failure", () => {
    const outcome = rollup(input({ environmentValid: false, criteria: [criterion("AC-001", "FAIL")] }));
    assert.equal(outcome.verdict, "INCONCLUSIVE");
    assert.equal(outcome.failure?.kind, "ENVIRONMENT_FAILURE");
  });

  it("never reports PASS while any guard is false, across the whole status matrix", () => {
    let combinations = 0;
    for (const first of CRITERION_STATUSES) {
      for (const second of CRITERION_STATUSES) {
        for (const environmentValid of [true, false]) {
          for (const safetyViolation of [null, "crossed a boundary"]) {
            for (const insufficientInformation of [true, false]) {
              combinations += 1;
              const outcome = rollup({
                criteria: [criterion("AC-001", first), criterion("AC-002", second)],
                environmentValid,
                safetyViolation,
                insufficientInformation,
              });
              if (outcome.verdict === "PASS") {
                assert.ok(
                  Object.values(outcome.guards).every(Boolean),
                  `PASS with a violated guard: ${JSON.stringify(outcome.guards)}`,
                );
                assert.equal(first, "PASS");
                assert.equal(second, "PASS");
              }
            }
          }
        }
      }
    }
    assert.equal(combinations, CRITERION_STATUSES.length ** 2 * 2 * 2 * 2);
  });

  it("always produces a reason list, so a failing run is never unexplained", () => {
    const outcomes = [
      rollup(input()),
      rollup(input({ environmentValid: false })),
      rollup(input({ criteria: [criterion("AC-001", "FAIL")] })),
    ];
    for (const outcome of outcomes) {
      assert.ok(outcome.reasons.length > 0);
    }
  });
});
