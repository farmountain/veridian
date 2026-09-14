import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DB_OBSERVATION_KIND } from "../../core/environment/db-observation.ts";
import type { DbObservationData } from "../../core/environment/db-observation.ts";
import {
  K8S_OBSERVATION_KIND,
  K8S_SIMULATED_SURFACES,
} from "../../core/environment/k8s-observation.ts";
import type {
  K8sApplyRecord,
  K8sDeploymentReading,
  K8sEventReading,
  K8sObservationData,
  K8sPodReading,
  K8sServiceReading,
} from "../../core/environment/k8s-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry, evaluateCriterion } from "../../core/validation/registry.ts";
import type { AssertionResult, CriterionSpec } from "../../core/validation/types.ts";
import { K8S_VALIDATORS, K8S_VALIDATOR_NAMES, k8sValidators } from "./k8s-validators.ts";

/**
 * The `k8s.*` family, proven offline against literal documents.
 *
 * The case for this file is stronger here than for either other family. A `k8s.*` validator reads a
 * `K8sObservationData` and never opens a socket, so a document written by hand is the *only* way to
 * reach the branches that matter - and those branches are almost all about the difference between
 * "the cluster holds the wrong thing" and "nobody looked", which needs a document that says one and
 * not the other. The `sim-k8s` demo proves the adapter produces such a document; nothing else proves
 * the family judges one correctly.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - an unreadable document, a
 *    selector that matched nothing, a namespace nobody read, a submission that was never made, an
 *    expectation with no comparison - is asserted to be `INCONCLUSIVE` or `ERROR`, never `PASS`.
 *  - **A defect is a `FAIL`.** A deployment that was never created, an image tag nothing built, zero
 *    ready replicas, a `Warning/Failed` event: the shapes a broken manifest actually takes.
 *  - **The distinctions a repair depends on.** "The deployment is absent" and "the deployment is there
 *    and nothing is ready" and "the manifest named the wrong tag" are three facts with three different
 *    repairs, and the family keeps them apart.
 *  - **A simulated world declares itself.** The reading carries the substituted surfaces, and every
 *    fixture here is built from the same vocabulary the adapter writes, so a test cannot pass against
 *    a document no world would ever emit.
 */

const registry = new ValidatorRegistry(k8sValidators());

const NAMESPACE = "dev";

const deployment = (overrides: Partial<K8sDeploymentReading> = {}): K8sDeploymentReading => ({
  namespace: NAMESPACE,
  name: "cart-web",
  image: "registry.local/cart-web:1.4.0",
  replicas: 3,
  readyReplicas: 3,
  availableReplicas: 3,
  generation: 1,
  observedGeneration: 1,
  revision: 1,
  labels: { app: "cart-web" },
  conditions: [{ type: "Available", status: "True", reason: "MinimumReplicasAvailable", message: "ready" }],
  ...overrides,
});

const pod = (index: number, overrides: Partial<K8sPodReading> = {}): K8sPodReading => ({
  namespace: NAMESPACE,
  name: `cart-web-7d9f8b6c4-${index}`,
  deployment: "cart-web",
  node: "sim-node-01",
  phase: "Running",
  ready: true,
  restarts: 0,
  image: "registry.local/cart-web:1.4.0",
  labels: { app: "cart-web" },
  reason: null,
  ...overrides,
});

const service = (overrides: Partial<K8sServiceReading> = {}): K8sServiceReading => ({
  namespace: NAMESPACE,
  name: "cart-web",
  type: "ClusterIP",
  clusterIP: "10.96.0.14",
  ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP" }],
  selector: { app: "cart-web" },
  ...overrides,
});

const event = (overrides: Partial<K8sEventReading> = {}): K8sEventReading => ({
  namespace: NAMESPACE,
  type: "Normal",
  reason: "Scheduled",
  message: "Successfully assigned dev/cart-web-7d9f8b6c4-0 to sim-node-01",
  objectKind: "Pod",
  objectName: "cart-web-7d9f8b6c4-0",
  count: 1,
  ...overrides,
});

const applied = (overrides: Partial<K8sApplyRecord> = {}): K8sApplyRecord => ({
  source: "POST /apis/apps/v1/namespaces/dev/deployments",
  kind: "Deployment",
  name: "cart-web",
  namespace: NAMESPACE,
  result: "configured",
  reason: null,
  ...overrides,
});

const document_ = (overrides: Partial<K8sObservationData> = {}): K8sObservationData => ({
  apiServer: "http://127.0.0.1:51601",
  cluster: "sim-local",
  namespace: NAMESPACE,
  simulated: K8S_SIMULATED_SURFACES,
  applied: [applied()],
  deployments: [deployment()],
  pods: [pod(0), pod(1), pod(2)],
  services: [service()],
  events: [
    event(),
    event({ reason: "ScalingReplicaSet", objectKind: "Deployment", objectName: "cart-web", message: "Scaled up replica set cart-web-7d9f8b6c4 to 3" }),
  ],
  ...overrides,
});

/**
 * The same cluster with one deliberate defect: a manifest that names a tag nothing built.
 *
 * This is the canonical cluster failure and the reason the `cri` surface is substituted at all. It is
 * written as a *whole reading* rather than as a patched field, because the defect's signature is the
 * agreement between four records - the deployment asks for the image, no pod became ready, the
 * replicas never converged and the cluster said so - and a test built from one changed field would
 * not hold that agreement.
 */
const pullFailure = (): K8sObservationData =>
  document_({
    deployments: [deployment({ image: "registry.local/cart-web:9.9.9", readyReplicas: 0, availableReplicas: 0 })],
    pods: [
      pod(0, { phase: "Pending", ready: false, node: null, reason: "ImagePullBackOff", image: "registry.local/cart-web:9.9.9" }),
      pod(1, { phase: "Pending", ready: false, node: null, reason: "ImagePullBackOff", image: "registry.local/cart-web:9.9.9" }),
      pod(2, { phase: "Pending", ready: false, node: null, reason: "ImagePullBackOff", image: "registry.local/cart-web:9.9.9" }),
    ],
    events: [
      event({
        type: "Warning",
        reason: "Failed",
        message: 'Failed to pull image "registry.local/cart-web:9.9.9": no such image in the registry this world\'s build produced',
        objectKind: "Pod",
        objectName: "cart-web-7d9f8b6c4-0",
        count: 3,
      }),
    ],
  });

/** An empty cluster: the world came up and the application's deploy program put nothing in it. */
const empty = (): K8sObservationData =>
  document_({ applied: [], deployments: [], pods: [], services: [], events: [] });

const observed = (data: unknown, kind: string = K8S_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-k8s:dev",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/**
 * A document from another world, typed as that world's so a change to it breaks this file rather than
 * quietly turning the fixture into something no adapter would emit.
 */
const dbDocument: DbObservationData = {
  engine: "sqlite",
  database: ".veridian/environments/inventory.db",
  tables: [],
  query: null,
};

const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...fields });

const expect_ = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = judge(raw, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${String(raw["validator"])}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

const spec = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  evidence: readonly string[] = [],
): CriterionSpec => ({
  id: "AC-001",
  description: "the cart web deployment is serving what it was built with",
  mandatory: true,
  evidence,
  steps: [{ apply: "manifests/deployment.yaml" }],
  expect: expectations,
});

const evaluate = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  observation: Observation,
  evidence: readonly string[] = [],
) =>
  evaluateCriterion(spec(expectations, evidence), observation, {
    registry,
    runId: observation.runId,
    environmentId: observation.environmentId,
    timestamp: observation.capturedAt,
  });

// ---- the family describes itself ------------------------------------------------------------------

describe("the k8s validator family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the seven it has", () => {
    assert.deepEqual(
      registry.names(),
      K8S_VALIDATORS.map((validator) => validator.name).sort(),
    );
    assert.deepEqual(registry.names(), [
      "k8s.applied",
      "k8s.deployment",
      "k8s.event",
      "k8s.image",
      "k8s.pod",
      "k8s.ready",
      "k8s.service",
    ]);
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    // `acceptance.schema.json` pins `Expectation.validator` to this pattern, so `k8s.readyReplicas`
    // is not merely unconventional - it is an acceptance contract that cannot be written at all. The
    // database family paid for this rule by writing its example; this assertion is what makes the
    // payment cover a second family.
    for (const validator of K8S_VALIDATORS) {
      assert.match(validator.name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, validator.name);
    }
    assert.equal(K8S_VALIDATOR_NAMES.ready, "k8s.ready");
  });

  it("reads the cluster observation kind, and never another world's", () => {
    for (const validator of K8S_VALIDATORS) {
      assert.equal(validator.observationKind, K8S_OBSERVATION_KIND, validator.name);
      assert.notEqual(validator.observationKind, WEB_OBSERVATION_KIND, validator.name);
      assert.notEqual(validator.observationKind, DB_OBSERVATION_KIND, validator.name);
    }
  });

  it("declares exactly the comparisons it can answer", () => {
    const declared = Object.fromEntries(
      K8S_VALIDATORS.map((validator) => [validator.name, [...validator.comparisons]]),
    );
    assert.deepEqual(declared, {
      [K8S_VALIDATOR_NAMES.applied]: ["equals"],
      [K8S_VALIDATOR_NAMES.deployment]: ["equals"],
      [K8S_VALIDATOR_NAMES.image]: ["equals", "contains", "matches"],
      [K8S_VALIDATOR_NAMES.ready]: ["equals", "atLeast", "atMost"],
      [K8S_VALIDATOR_NAMES.pod]: ["equals", "atLeast", "atMost"],
      [K8S_VALIDATOR_NAMES.service]: ["equals"],
      [K8S_VALIDATOR_NAMES.event]: ["equals"],
    });
  });

  it("declares no comparison key the acceptance vocabulary does not have", () => {
    for (const validator of K8S_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, validator.name);
      for (const comparison of validator.comparisons) {
        assert.ok(
          ["equals", "contains", "matches", "atLeast", "atMost"].includes(comparison),
          `${validator.name} declares unknown comparison "${comparison}"`,
        );
      }
    }
  });

  it("says which noun its target names, and never falls back to the browser family's", () => {
    const nouns = Object.fromEntries(K8S_VALIDATORS.map((v) => [v.name, v.targetNoun]));
    assert.deepEqual(nouns, {
      [K8S_VALIDATOR_NAMES.applied]: "submitted object, written `Kind/name`",
      [K8S_VALIDATOR_NAMES.deployment]: "deployment, written `namespace/name`",
      [K8S_VALIDATOR_NAMES.image]: "deployment, written `namespace/name`",
      [K8S_VALIDATOR_NAMES.ready]: "deployment, written `namespace/name`",
      [K8S_VALIDATOR_NAMES.pod]: "label selector, written `key=value`",
      [K8S_VALIDATOR_NAMES.service]: "service, written `namespace/name`",
      [K8S_VALIDATOR_NAMES.event]: "event reason",
    });
    // "element" is what the field means when it is *absent* - the browser family's default - so a
    // cluster validator that left it undefined would make the ladder ask which element to inspect,
    // in a contract with no page anywhere in it.
    for (const validator of K8S_VALIDATORS) {
      assert.notEqual(validator.targetNoun, "element", validator.name);
    }
  });

  it("only asks for a target where a target is the question", () => {
    for (const validator of K8S_VALIDATORS) assert.equal(validator.needsTarget, true, validator.name);
  });

  it("hands out a fresh array so a registry cannot reorder the family", () => {
    const first = k8sValidators();
    const second = k8sValidators();
    assert.notEqual(first, second);
    assert.notEqual(first, K8S_VALIDATORS);
    assert.ok(Object.isFrozen(K8S_VALIDATORS), "the exported family must be frozen");
  });
});

// ---- a document nobody can read -------------------------------------------------------------------

describe("an unreadable observation is never a judgement", () => {
  const unreadable: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["a number", 42],
    ["a bare string", K8S_OBSERVATION_KIND],
    ["an array", []],
    ["a missing apiServer", { cluster: "c", namespace: "dev", simulated: [], applied: [], deployments: [], pods: [], services: [], events: [] }],
    ["a missing namespace", { apiServer: "http://x", cluster: "c", simulated: [], applied: [], deployments: [], pods: [], services: [], events: [] }],
    ["simulated that is not a list of names", { apiServer: "http://x", cluster: "c", namespace: "dev", simulated: "cri", applied: [], deployments: [], pods: [], services: [], events: [] }],
    ["an applied record missing its source", { apiServer: "http://x", cluster: "c", namespace: "dev", simulated: [], applied: [{ kind: "Deployment" }], deployments: [], pods: [], services: [], events: [] }],
    [
      "a deployment missing its replica counts",
      {
        apiServer: "http://x",
        cluster: "c",
        namespace: "dev",
        simulated: [],
        applied: [],
        deployments: [{ namespace: "dev", name: "cart-web", image: "i" }],
        pods: [],
        services: [],
        events: [],
      },
    ],
    [
      "a pod whose `ready` is not a boolean",
      {
        apiServer: "http://x",
        cluster: "c",
        namespace: "dev",
        simulated: [],
        applied: [],
        deployments: [],
        pods: [{ namespace: "dev", name: "p", deployment: null, node: null, phase: "Running", ready: "yes", restarts: 0, image: "i", labels: {}, reason: null }],
        services: [],
        events: [],
      },
    ],
  ];

  for (const [label, data] of unreadable) {
    it(`reports ENVIRONMENT_FAILURE for ${label}, under every validator`, () => {
      for (const name of registry.names()) {
        const result = judge(expectation(name, { target: "dev/cart-web", equals: true }), observed(data));
        assert.equal(result.status, "ERROR", `${name} on ${label} gave ${result.status}`);
        assert.equal(result.failureKind, "ENVIRONMENT_FAILURE", `${name} on ${label}`);
        assert.match(String(result.message), /does not carry a cluster document/, `${name} on ${label}`);
      }
    });
  }

  it("reads a well-formed document without complaint, so the check above is not vacuous", () => {
    const result = judge(
      expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }),
      observed(document_()),
    );
    assert.equal(result.status, "PASS");
    assert.equal(result.failureKind, null);
    assert.equal(result.message, null, "a passing assertion carries no message for a reader to skim");
  });

  it("does not mistake another family's document for its own", () => {
    for (const name of registry.names()) {
      const result = judge(
        expectation(name, { target: "dev/cart-web", equals: true }),
        observed(dbDocument, DB_OBSERVATION_KIND),
      );
      assert.equal(result.status, "ERROR", name);
      assert.match(String(result.message), /does not carry a cluster document/, name);
    }
  });
});

// ---- `k8s.applied`: the action record --------------------------------------------------------------

describe("k8s.applied reads what was asked for, not what happens to be there", () => {
  it("passes when the server accepted the submission", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }),
      observed(document_()),
      "PASS",
    );
  });

  it("fails when the server refused it, and can fail while the rest of the cluster looks fine", () => {
    const refused = document_({
      applied: [applied({ result: "rejected", reason: "Invalid: metadata.name is required" })],
    });
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }),
      observed(refused),
      "FAIL",
    );
    assert.match(String(result.message), /Expected the submission of `Deployment\/cart-web` to be configured, but it is "rejected"\./);
    // The state record is untouched, which is the whole reason this validator exists: a resource that
    // was already in the cluster is not evidence that this run deployed anything.
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }), observed(refused)).status,
      "PASS",
    );
  });

  it("distinguishes a rejection from a submission that never happened", () => {
    const never = expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }),
      observed(empty()),
      "INCONCLUSIVE",
    );
    assert.match(String(never.message), /No submission of `Deployment\/cart-web` appears/);
    assert.match(String(never.message), /this is the first/);
  });

  it("judges the newest submission when the same object was submitted more than once", () => {
    const twice = document_({
      applied: [
        applied({ result: "rejected", reason: "Invalid: spec.replicas must be a number" }),
        applied({ source: "manifests/deployment.yaml", result: "created", reason: null }),
      ],
    });
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "created" }),
      observed(twice),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "rejected" }),
      observed(twice),
      "FAIL",
    );
  });

  it("keeps a Deployment and a Service of the same name apart", () => {
    const both = document_({
      applied: [applied(), applied({ kind: "Service", result: "created" })],
    });
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Service/cart-web", equals: "created" }),
      observed(both),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }),
      observed(both),
      "PASS",
    );
  });

  it("refuses a target without a kind, because a kind is part of an object's identity", () => {
    for (const target of ["cart-web", "/cart-web", "Deployment/"]) {
      expect_(
        expectation(K8S_VALIDATOR_NAMES.applied, { target, equals: "configured" }),
        observed(document_()),
        "ERROR",
        /A submitted object is written/,
      );
    }
  });

  it("refuses a result word the vocabulary does not have, instead of judging an always-false comparison", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "succeeded" }),
      observed(document_()),
      "ERROR",
      /wants one of created, configured, unchanged, rejected/,
    );
  });
});

// ---- presence ---------------------------------------------------------------------------------------

describe("k8s.deployment and k8s.service answer whether an object exists, and can answer no", () => {
  it("passes for the deployment and service the cluster holds", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }),
      observed(document_()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.service, { target: "dev/cart-web", equals: "present" }),
      observed(document_()),
      "PASS",
    );
  });

  it("fails for an object that was never created, and names the namespace it looked in", () => {
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-api", equals: true }),
      observed(document_()),
      "FAIL",
    );
    assert.match(String(result.message), /the deployment `cart-api` in namespace `dev` to be present, but it is false/);
    expect_(
      expectation(K8S_VALIDATOR_NAMES.service, { target: "dev/cart-web", equals: "absent" }),
      observed(empty()),
      "PASS",
    );
  });

  it("demands `namespace/name`, because a bare name has no single answer", () => {
    for (const target of ["cart-web", "/cart-web", "dev/"]) {
      expect_(
        expectation(K8S_VALIDATOR_NAMES.deployment, { target, equals: true }),
        observed(document_()),
        "ERROR",
        /A deployment is named as/,
      );
    }
  });

  it("refuses to report absence for a namespace it never read", () => {
    // The failure this guards against is the worst kind: "the deployment does not exist" is a
    // plausible sentence about a perfectly healthy cluster, and the repair it invites rewrites a
    // manifest that was never wrong.
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.deployment, { target: "prod/cart-web", equals: true }),
      observed(document_()),
      "ERROR",
    );
    assert.match(String(result.message), /names namespace `prod`, and this reading is scoped to `dev`/);
    assert.match(String(result.message), /a fact about the reading rather than about the cluster/);
  });

  it("errors rather than guessing when no target is named", () => {
    for (const name of [K8S_VALIDATOR_NAMES.deployment, K8S_VALIDATOR_NAMES.service]) {
      expect_(expectation(name, { equals: true }), observed(document_()), "ERROR", /named no target/);
    }
  });
});

// ---- the deployment's own facts ---------------------------------------------------------------------

describe("k8s.image and k8s.ready read the deployment, not the pods", () => {
  it("compares the requested image as text, so a prefix-shaped defect is visible", () => {
    const reading = observed(document_());
    expect_(
      expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", equals: "registry.local/cart-web:1.4.0" }),
      reading,
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", contains: ":1.4.0" }),
      reading,
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", matches: "^registry\\.local/.*:1\\.[0-9]+\\.[0-9]+$" }),
      reading,
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", equals: "registry.local/cart-web:latest" }),
      observed(pullFailure()),
      "FAIL",
    );
  });

  it("passes while the rollout is failing, because the manifest asked for the right image", () => {
    // The pair of statuses is the finding: the manifest is right and nothing built what it named.
    // Collapsing the two into one "the deployment is broken" would send the repair at the YAML.
    expect_(
      expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", contains: "9.9.9" }),
      observed(pullFailure()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", atLeast: 1 }),
      observed(pullFailure()),
      "FAIL",
    );
  });

  it("counts ready replicas, not requested ones", () => {
    const asking = document_({ deployments: [deployment({ replicas: 3, readyReplicas: 0, availableReplicas: 0 })] });
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", equals: 3 }),
      observed(asking),
      "FAIL",
    );
    assert.match(String(result.message), /the number of ready replicas of `cart-web` to equal 3, but it is 0/);
    expect_(
      expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", atLeast: 3 }),
      observed(document_()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", atMost: 2 }),
      observed(document_()),
      "FAIL",
    );
  });

  it("reports that it could not look when the deployment itself is absent", () => {
    for (const name of [K8S_VALIDATOR_NAMES.image, K8S_VALIDATOR_NAMES.ready]) {
      const result = expect_(
        expectation(name, { target: "dev/cart-api", equals: true }),
        observed(document_()),
        "INCONCLUSIVE",
      );
      assert.match(String(result.message), /holds no deployment `cart-api` in namespace `dev`/);
    }
  });

  it("refuses a count written as a string, which is a criterion defect and not a defect in the cluster", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", equals: "3" }),
      observed(document_()),
      "ERROR",
      /compares a count with a number/,
    );
  });
});

// ---- pods, by selector ------------------------------------------------------------------------------

describe("k8s.pod counts ready pods by label selector", () => {
  it("passes for the pods a selector matches", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", equals: 3 }),
      observed(document_()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", atLeast: 1 }),
      observed(document_()),
      "PASS",
    );
  });

  it("counts readiness rather than existence", () => {
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", equals: 3 }),
      observed(pullFailure()),
      "FAIL",
    );
    assert.match(String(result.message), /the number of ready pods matching `app=cart-web` to equal 3, but it is 0/);
  });

  it("matches on every pair of a multi-pair selector", () => {
    const two = document_({
      pods: [pod(0, { labels: { app: "cart-web", tier: "web" } }), pod(1)],
    });
    expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web,tier=web", equals: 1 }),
      observed(two),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web,tier=db", equals: 1 }),
      observed(two),
      "INCONCLUSIVE",
    );
  });

  it("abstains when a selector matched nothing, rather than passing vacuously", () => {
    const result = expect_(
      expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-api", equals: 0 }),
      observed(document_()),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /No pod in namespace `dev` carries `app=cart-api`/);
    assert.match(String(result.message), /reading the wrong labels/);
  });

  it("refuses a selector that does not parse, because zero pods and a typo look identical", () => {
    for (const target of ["cart-web", "app=", "=cart-web", "app:cart-web"]) {
      expect_(
        expectation(K8S_VALIDATOR_NAMES.pod, { target, atLeast: 1 }),
        observed(document_()),
        "ERROR",
        /A label selector is written/,
      );
    }
  });
});

// ---- events -----------------------------------------------------------------------------------------

describe("k8s.event reads the cluster's own narrative", () => {
  it("reports the warning a failed rollout produced", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "Failed", equals: "present" }),
      observed(pullFailure()),
      "PASS",
    );
  });

  it("reports the warning's absence once the manifest is repaired, which is the evidence that it worked", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "Failed", equals: "absent" }),
      observed(document_()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "Failed", equals: true }),
      observed(document_()),
      "FAIL",
    );
  });

  it("reads a Normal reason too, because half the vocabulary is a Narrative rather than a complaint", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "ScalingReplicaSet", equals: "present" }),
      observed(document_()),
      "PASS",
    );
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "Scheduled", equals: "present" }),
      observed(document_()),
      "PASS",
    );
  });

  it("fails a reason the cluster never used, and that is a finding rather than an abstention", () => {
    expect_(
      expectation(K8S_VALIDATOR_NAMES.event, { target: "BackOff", equals: "present" }),
      observed(document_()),
      "FAIL",
    );
  });

  it("errors rather than guessing when the criterion names no reason", () => {
    expect_(expectation(K8S_VALIDATOR_NAMES.event, { equals: "present" }), observed(document_()), "ERROR", /named no target/);
  });
});

// ---- the distinctions a repair depends on -----------------------------------------------------------

describe("the statuses stay apart, because the repairs differ", () => {
  it("fails an absent deployment while abstaining on the facts that live inside it", () => {
    const missing = document_({ deployments: [], pods: [], services: [], events: [] });
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }), observed(missing)).status,
      "FAIL",
      "a deployment that is not there is a defect in the application",
    );
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", atLeast: 1 }), observed(missing)).status,
      "INCONCLUSIVE",
      "a replica count of a deployment nobody could find is not a finding",
    );
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", contains: "cart-web" }), observed(missing)).status,
      "INCONCLUSIVE",
      "nor is an image check",
    );
  });

  it("distinguishes a wrong image tag from a rollout that never converged, in the same reading", () => {
    const reading = observed(pullFailure());
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", equals: "registry.local/cart-web:1.4.0" }), reading).status,
      "FAIL",
      "the manifest names a tag the build did not produce - repair the manifest",
    );
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.event, { target: "Failed", equals: "present" }), reading).status,
      "PASS",
      "the cluster said why - the message names the image",
    );
    assert.equal(
      judge(expectation(K8S_VALIDATOR_NAMES.service, { target: "dev/cart-web", equals: true }), reading).status,
      "PASS",
      "the Service was submitted and accepted; it is not the thing that is broken",
    );
  });
});

// ---- M3: nothing unobserved is a pass ----------------------------------------------------------------

describe("M3: nothing that was not observed is reported as a pass", () => {
  const notPassable: readonly (readonly [string, Record<string, unknown>, Observation])[] = [
    ["a submission that was never made", expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }), observed(empty())],
    ["a deployment nobody could find", expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", atLeast: 1 }), observed(empty())],
    ["an image of a deployment nobody could find", expectation(K8S_VALIDATOR_NAMES.image, { target: "dev/cart-web", contains: "x" }), observed(empty())],
    ["a selector that matched nothing", expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", equals: 0 }), observed(empty())],
    ["a namespace the reading never held", expectation(K8S_VALIDATOR_NAMES.deployment, { target: "prod/cart-web", equals: false }), observed(document_())],
    ["an expectation with no comparison", expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web" }), observed(document_())],
    ["a criterion that named no target", expectation(K8S_VALIDATOR_NAMES.event, { equals: "present" }), observed(document_())],
    ["a document from another world", expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }), observed(dbDocument, DB_OBSERVATION_KIND)],
    ["a document nobody can read", expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true }), observed({ apiServer: "http://x" })],
    ["a selector that does not parse", expectation(K8S_VALIDATOR_NAMES.pod, { target: "cart-web", atLeast: 0 }), observed(document_())],
  ];

  for (const [label, raw, observation] of notPassable) {
    it(`is not a PASS: ${label}`, () => {
      const result = judge(raw, observation);
      assert.notEqual(result.status, "PASS", `${label} produced ${result.status}`);
      assert.ok(
        result.status === "INCONCLUSIVE" || result.status === "ERROR",
        `${label} produced ${result.status}, which is neither a finding nor an abstention`,
      );
    });
  }
});

// ---- the criterion-level entry point ------------------------------------------------------------------

describe("a validator is never asked to judge a world it cannot see", () => {
  it("refuses another world's observation for a cluster criterion", () => {
    const result = evaluate(
      [expectation(K8S_VALIDATOR_NAMES.deployment, { target: "dev/cart-web", equals: true })],
      observed(dbDocument, DB_OBSERVATION_KIND),
    );
    assert.equal(result.status, "ERROR");
    assert.match(String(result.message), /reads "k8s\.cluster" observations but received "db\.database"/);
    assert.match(String(result.message), /A validator must never be asked to judge a world it cannot see/);
  });

  it("judges a cluster observation through the same entry point", () => {
    const result = evaluate(
      [
        expectation(K8S_VALIDATOR_NAMES.applied, { target: "Deployment/cart-web", equals: "configured" }),
        expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", equals: 3 }),
        expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", equals: 3 }),
        expectation(K8S_VALIDATOR_NAMES.service, { target: "dev/cart-web", equals: "present" }),
      ],
      observed(document_()),
    );
    assert.equal(result.status, "PASS");
  });

  it("fails the whole criterion when the rollout never converged", () => {
    const result = evaluate(
      [
        expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", equals: 3 }),
        expectation(K8S_VALIDATOR_NAMES.pod, { target: "app=cart-web", equals: 3 }),
      ],
      observed(pullFailure()),
    );
    assert.equal(result.status, "FAIL");
    assert.notEqual(result.status, "PASS");
  });

  it("will not pass a criterion whose required evidence is missing, even when the assertions passed", () => {
    const result = evaluate(
      [expectation(K8S_VALIDATOR_NAMES.ready, { target: "dev/cart-web", equals: 3 })],
      observed(document_()),
      ["screenshot"],
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.deepEqual(result.missingEvidence, ["screenshot"]);
    assert.match(String(result.message), /An unproven pass is not a pass/);
  });
});
