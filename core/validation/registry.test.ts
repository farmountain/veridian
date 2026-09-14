import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidatorError } from "../failure.ts";
import type { Observation } from "../environment/types.ts";
import { ValidatorRegistry, evaluateCriterion, rollupCriterionStatus } from "./registry.ts";
import type { AssertionResult, CriterionSpec, Validator } from "./types.ts";

const observation = (over: Partial<Observation> = {}): Observation => ({
  kind: "web.page",
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "env-1",
  runId: "run-20260101-000000-abcdef",
  data: {},
  artifacts: [],
  error: null,
  ...over,
});

const spec = (over: Partial<CriterionSpec> = {}): CriterionSpec => ({
  id: "AC-001",
  description: "the cart count is 1",
  mandatory: true,
  evidence: [],
  steps: [],
  expect: [{ validator: "stub", target: "#count", equals: 1 }],
  ...over,
});

const passing = (name = "stub", observationKind = "web.page"): Validator => ({
  name,
  needsTarget: true,
  comparisons: ["equals"],
  observationKind,
  validate(expectation) {
    return {
      validator: name,
      target: typeof expectation["target"] === "string" ? expectation["target"] : null,
      status: "PASS",
      actual: 1,
      expected: expectation["equals"] ?? null,
      message: null,
    };
  },
});

const options = () => ({
  registry: new ValidatorRegistry([passing()]),
  runId: "run-20260101-000000-abcdef",
  environmentId: "env-1",
  timestamp: "2026-01-01T00:00:00.000Z",
});

describe("validator registry", () => {
  it("rejects a duplicate registration instead of silently replacing a validator", () => {
    const registry = new ValidatorRegistry([passing()]);
    assert.throws(() => registry.register(passing()), ValidatorError);
  });

  it("rejects a validator that declares no comparisons", () => {
    const vacuous: Validator = { ...passing("vacuous"), comparisons: [] };
    assert.throws(() => new ValidatorRegistry([vacuous]), ValidatorError);
  });

  it("lists descriptors so the clarification layer can detect an unregistered name", () => {
    const registry = new ValidatorRegistry([passing("alpha"), passing("beta")]);
    assert.deepEqual(registry.names(), ["alpha", "beta"]);
    assert.deepEqual(
      registry.descriptors().map((d) => d.name),
      ["alpha", "beta"],
    );
    assert.equal(registry.has("gamma"), false);
  });
});

describe("evaluateCriterion", () => {
  it("passes a criterion whose single expectation passes", () => {
    const result = evaluateCriterion(spec(), observation(), options());
    assert.equal(result.status, "PASS");
    assert.equal(result.criterionId, "AC-001");
    assert.equal(result.mandatory, true);
  });

  it("reports an unregistered validator as VALIDATOR_ERROR, never as a test failure", () => {
    const result = evaluateCriterion(spec(), observation(), options());
    assert.equal(result.status, "PASS");
    const missing = evaluateCriterion(
      spec({ expect: [{ validator: "nope", target: "#count", equals: 1 }] }),
      observation(),
      options(),
    );
    assert.equal(missing.status, "ERROR");
    assert.equal(missing.assertions[0]?.failureKind, "VALIDATOR_ERROR");
  });

  it("refuses to let a validator judge an observation kind it cannot read", () => {
    const result = evaluateCriterion(
      spec(),
      observation({ kind: "kubernetes.pod" }),
      options(),
    );
    assert.equal(result.status, "ERROR");
    assert.match(result.assertions[0]?.message ?? "", /kubernetes\.pod/);
  });

  it("turns a validator crash into VALIDATOR_ERROR, not an application failure", () => {
    const exploding: Validator = {
      ...passing("boom"),
      validate() {
        throw new Error("bad selector syntax");
      },
    };
    const result = evaluateCriterion(spec({ expect: [{ validator: "boom" }] }), observation(), {
      ...options(),
      registry: new ValidatorRegistry([exploding]),
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.assertions[0]?.failureKind, "VALIDATOR_ERROR");
    assert.match(result.assertions[0]?.message ?? "", /bad selector syntax/);
  });

  it("never runs a validator when the observation itself failed", () => {
    const result = evaluateCriterion(
      spec(),
      observation({ error: { message: "no browser", kind: "ENVIRONMENT_FAILURE" } }),
      options(),
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0]?.validator, "observation");
  });

  it("treats an application error during observation as a definite FAIL", () => {
    const result = evaluateCriterion(
      spec(),
      observation({ error: { message: "page threw", kind: "APPLICATION_ERROR" } }),
      options(),
    );
    assert.equal(result.status, "FAIL");
  });

  it("treats an infrastructure error during observation as ERROR", () => {
    const result = evaluateCriterion(
      spec(),
      observation({ error: { message: "disk full", kind: "INFRASTRUCTURE_FAILURE" } }),
      options(),
    );
    assert.equal(result.status, "ERROR");
  });

  it("downgrades an otherwise passing criterion when required evidence is missing", () => {
    const result = evaluateCriterion(
      spec({ evidence: ["screenshot"] }),
      observation({ artifacts: [] }),
      options(),
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.deepEqual(result.missingEvidence, ["screenshot"]);
    assert.match(result.message ?? "", /unproven pass is not a pass/i);
  });

  it("accepts a criterion whose required evidence was produced", () => {
    const result = evaluateCriterion(
      spec({ evidence: ["screenshot"] }),
      observation({ artifacts: [{ path: "screenshots/AC-001.png", kind: "screenshot" }] }),
      options(),
    );
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.missingEvidence, []);
    assert.deepEqual(result.evidence, ["screenshots/AC-001.png"]);
  });

  it("returns INCONCLUSIVE for a criterion with nothing to check", () => {
    const result = evaluateCriterion(spec({ expect: [] }), observation(), options());
    assert.equal(result.status, "INCONCLUSIVE");
  });
});

describe("criterion status rollup", () => {
  const assertion = (status: AssertionResult["status"]): AssertionResult => ({
    validator: "v",
    target: null,
    status,
    actual: null,
    expected: null,
    message: null,
  });

  it("lets uncertainty dominate badness", () => {
    assert.equal(rollupCriterionStatus([assertion("PASS"), assertion("FAIL"), assertion("ERROR")]), "ERROR");
    assert.equal(
      rollupCriterionStatus([assertion("PASS"), assertion("FAIL"), assertion("INCONCLUSIVE")]),
      "INCONCLUSIVE",
    );
    assert.equal(rollupCriterionStatus([assertion("PASS"), assertion("FAIL")]), "FAIL");
    assert.equal(rollupCriterionStatus([assertion("PASS")]), "PASS");
  });

  it("does not pass a criterion with zero assertions", () => {
    assert.equal(rollupCriterionStatus([]), "INCONCLUSIVE");
  });
});
