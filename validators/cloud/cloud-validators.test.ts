/**
 * The `cloud.*` family's own suite, and the reason it exists rather than being covered by the demo.
 *
 * A validator never opens a socket and never calls the provider, so the only way to reach its branches
 * is to hand it a document. That is what this file does, and it is why every status, every comparison
 * and every refusal below is exercised against a fixture rather than through a run: `adapters/
 * sim-cloud/cloud-port.test.ts` proves the *world* holds what it says it holds, and this file proves
 * the *judging* is right.
 *
 * That distinction is not academic here. `AGENTS.md` records that `validators/database/` shipped with
 * **no** unit coverage while `validators/playwright/` had 26 kB of it, so the four functions that
 * decide every database criterion's status were held by one happy-path demo - and a verdict path
 * reachable only through one example is a path whose failure modes are untested. The same rule is why
 * the two refusals this family turns on (a reference whose kind is wrong, and a request issued by
 * somebody other than the application) have their own tests rather than being left to the demo to
 * notice.
 *
 * Three properties are what the suite is *for*:
 *
 *  1. **M3, zero false PASS.** Every near-pass is `INCONCLUSIVE` or `ERROR`. An absent resource, an
 *     absent decision, an absent action record, an unread `boolean | null` field, and a comparison
 *     against a word outside a closed vocabulary are all one test away from a `PASS` that was never
 *     earned.
 *  2. **A defect is a `FAIL`, and only when a fact was read.** The bucket that is not there, the tag
 *     set that does not match, the request that was refused, the meter over its ceiling - each of these
 *     is a `FAIL` carrying the value the world produced, and each is separated from the gap beside it.
 *  3. **The distinctions that make the repairs different are not collapsed.** Presence and absence,
 *     `refused` and `missing`, `none` and `false`, the application's request and the criterion's, a
 *     decision the world reached and the policy it was derived from. A validator that merged any two of
 *     those would send an agent to the wrong file, and the demo would still be green.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { COMPARISON_KEYS } from "../../core/acceptance/plan.ts";
import {
  CLOUD_ACTION_NAMES,
  CLOUD_CALL_RESULTS,
  CLOUD_METER_KEYS,
  CLOUD_OBSERVATION_KIND,
  CLOUD_SIMULATED_SURFACES,
  renderBucket,
  renderSecret,
} from "../../core/environment/cloud-observation.ts";
import type {
  CloudBucketReading,
  CloudCallRecord,
  CloudDecisionReading,
  CloudObjectReading,
  CloudObservationData,
  CloudPrincipalReading,
  CloudQueueReading,
  CloudSecretReading,
} from "../../core/environment/cloud-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";
import type { AssertionResult } from "../../core/validation/types.ts";

import { CLOUD_VALIDATORS, CLOUD_VALIDATOR_NAMES, cloudValidators } from "./cloud-validators.ts";

// ---- the account the fixture describes -------------------------------------------------------------

const IDENTITY = {
  api: "http://127.0.0.1:41234",
  provider: "simulated-cloud",
  region: "eu-west-1",
  account: "acct-cart",
  principal: "cart-provisioner",
} as const;

const bucketReading = (overrides: Partial<CloudBucketReading> = {}): CloudBucketReading => ({
  name: "cart-assets",
  region: "eu-west-1",
  versioning: "enabled",
  encryption: "AES256",
  publicAccessBlocked: true,
  policy: [
    { effect: "allow", principal: "svc-cart", action: "s3.getObject", resource: "bucket/cart-assets/*" },
    { effect: "deny", principal: "*", action: "*", resource: "*" },
  ],
  objects: 1,
  tags: { env: "prod", owner: "cart" },
  ...overrides,
});

const objectReading = (overrides: Partial<CloudObjectReading> = {}): CloudObjectReading => ({
  bucket: "cart-assets",
  key: "index.html",
  bytes: 512,
  sha256: "3a7f1c0d9e4b2f8a6c5d3e1f0a9b8c7d",
  contentType: "text/html",
  encryption: "AES256",
  versionId: "v2",
  versions: 2,
  tags: { cache: "max-age=60" },
  ...overrides,
});

const queueReading = (overrides: Partial<CloudQueueReading> = {}): CloudQueueReading => ({
  name: "cart-events",
  messages: 0,
  inFlight: 0,
  deadLetterQueue: "cart-events-dlq",
  encryption: "aws:kms",
  visibilityTimeoutSeconds: 30,
  attributes: { retention: "60" },
  tags: { env: "prod" },
  ...overrides,
});

const secretReading = (overrides: Partial<CloudSecretReading> = {}): CloudSecretReading => ({
  name: "cart-api-key",
  currentVersion: "v2",
  versions: [
    { version: "v1", bytes: 32, sha256: "11111111111111111111111111111111" },
    { version: "v2", bytes: 32, sha256: "22222222222222222222222222222222" },
  ],
  rotationEnabled: true,
  encrypted: true,
  matchesKnownPlaceholder: true,
  tags: { owner: "cart" },
  ...overrides,
});

const principalReading = (overrides: Partial<CloudPrincipalReading> = {}): CloudPrincipalReading => ({
  name: "svc-cart",
  attachedPolicies: ["cart-read"],
  statements: [
    { effect: "allow", principal: "svc-cart", action: "s3.getObject", resource: "bucket/cart-assets/*" },
  ],
  tags: { env: "prod" },
  ...overrides,
});

const decisionReading = (overrides: Partial<CloudDecisionReading> = {}): CloudDecisionReading => ({
  principal: "svc-cart",
  action: "s3.getObject",
  resource: "object/cart-assets/index.html",
  allowed: true,
  entry: "allow s3.getObject bucket/cart-assets/*",
  account: "acct-cart",
  ...overrides,
});

const callReading = (overrides: Partial<CloudCallRecord> = {}): CloudCallRecord => ({
  source: "application",
  action: "s3.putObject",
  method: "PUT",
  path: "/v1/objects/cart-assets/index.html",
  principal: "svc-cart",
  resource: "object/cart-assets/index.html",
  result: "ok",
  status: 200,
  reason: null,
  durationMs: 0,
  ...overrides,
});

const cloudDocument = (overrides: Partial<CloudObservationData> = {}): CloudObservationData => ({
  ...IDENTITY,
  simulated: [...CLOUD_SIMULATED_SURFACES],
  costModel: "costUnits = requests + objects + bytes / 1024",
  calls: [
    callReading(),
    callReading({ action: "s3.getObject", method: "GET", result: "ok", status: 200 }),
    callReading({
      source: "criterion",
      action: "s3.headBucket",
      method: "HEAD",
      resource: "bucket/cart-assets",
      result: "ok",
      status: 200,
    }),
  ],
  buckets: [bucketReading()],
  objects: [objectReading()],
  queues: [queueReading()],
  secrets: [secretReading()],
  principals: [principalReading()],
  decisions: [
    decisionReading(),
    decisionReading({
      principal: "svc-incident",
      action: "s3.putObject",
      allowed: false,
      entry: "none",
    }),
  ],
  meters: { requests: 7, objects: 1, bytes: 512, costUnits: 12 },
  ...overrides,
});

const observed = (data: unknown, kind: string = CLOUD_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-cloud:acct-cart",
  runId: "run-1",
  data,
  artifacts: [
    { path: "artifacts/AC-001.observation.json", kind: "json" },
    { path: "artifacts/AC-001.decisions.json", kind: "json" },
  ],
  error: null,
});

/** A document from the *other* world, typed as that world's to keep the fixture honest. */
const webDocument: WebObservationData = {
  url: "http://127.0.0.1:4173/",
  title: "Cart",
  targets: {},
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
};

const account = observed(cloudDocument());

const registry = new ValidatorRegistry(cloudValidators());

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point and not the criterion's: it bypasses the observation-kind check
 * deliberately, so that the family's own status discipline is what is under test rather than
 * `evaluateCriterion`'s evidence rules - which have their own suite.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const field = (
  validator: string,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...values });

const expect = (
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

// ---- the roster ------------------------------------------------------------------------------------

describe("the roster is the code, and every name in it is writable", () => {
  it("names exactly the eleven validators the family exports, in both directions", () => {
    assert.equal(Object.values(CLOUD_VALIDATOR_NAMES).length, 11);
    assert.deepEqual(
      CLOUD_VALIDATORS.map((validator) => validator.name).sort(),
      [...Object.values(CLOUD_VALIDATOR_NAMES)].sort(),
      "the registry of validators and the record of names are the same vocabulary written twice, and " +
        "a name in one and not the other is either unreachable or unfindable",
    );
    assert.ok(
      Object.isFrozen(CLOUD_VALIDATORS),
      "the roster is a global a caller could edit in place, which would make one criterion's verdict " +
        "depend on whether another criterion ran first",
    );
  });

  it("spells every name so that an acceptance contract can be written at all", () => {
    // The schema's own pattern, and the reason it is asserted here rather than trusted: a name with a
    // capital in it is a validator no `acceptance.yaml` can express, so it would be implemented,
    // exported, tested and unreachable.
    for (const name of Object.values(CLOUD_VALIDATOR_NAMES)) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, `${name} is not writable in a contract`);
      assert.match(name, /^cloud\./, `${name} is outside the prefix this family owns`);
    }
  });

  it("declares the world it reads and the target it needs, on every member", () => {
    for (const validator of CLOUD_VALIDATORS) {
      assert.equal(
        validator.observationKind,
        CLOUD_OBSERVATION_KIND,
        `${validator.name} reads a different world than this family does`,
      );
      assert.equal(validator.needsTarget, true, `${validator.name} judges nothing without a target`);
      assert.ok(
        (validator.targetNoun ?? "").length > 0,
        `${validator.name} declares no target noun, so the clarification ladder cannot ask for one`,
      );
    }
  });

  it("declares only comparisons the acceptance layer can decode", () => {
    // `validator.comparisons` is read twice: by the clarification report, and by `decodeExpectation`'s
    // "cannot evaluate" branch. A comparison named here that `COMPARISON_KEYS` does not hold would be a
    // validator advertising an operation no criterion can state.
    for (const validator of CLOUD_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, `${validator.name} declares no comparison`);
      for (const key of validator.comparisons) {
        assert.ok(
          (COMPARISON_KEYS as readonly string[]).includes(key),
          `${validator.name} declares \`${key}\`, which is not one of ${COMPARISON_KEYS.join(", ")}`,
        );
      }
    }
  });

  it("returns a fresh roster each time, so a registry cannot be reached through the family", () => {
    const first = cloudValidators();
    const second = cloudValidators();
    assert.notEqual(first, second);
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
  });

  it("keeps the substitute out of the vocabulary that judges it", () => {
    // The rule is `AGENTS.md`'s: a validator family that could reach the world through `adapters/*`
    // could report on the substitute rather than on the application. Held as an executable rule over
    // this file's own text, because the import list is the only place the rule can be broken.
    const source = readFileSync(new URL("./cloud-validators.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.ok(specifiers.length >= 3, "the import scan found almost nothing, so it is not reading the file");
    assert.deepEqual(
      specifiers.filter((specifier) => specifier.includes("adapters/")),
      [],
      "a validator family that imports an adapter can judge the substitute instead of the world",
    );
  });
});

// ---- documents from other worlds -------------------------------------------------------------------

describe("a document from another world is an environment defect, not a judgment", () => {
  it("reports ERROR naming the environment when the reading is another world's", () => {
    const result = expect(
      field("cloud.bucket", { target: "bucket/cart-assets", equals: true }),
      observed(webDocument, WEB_OBSERVATION_KIND),
      "ERROR",
      /does not carry a provider document/,
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    // `actual` carries the payload that arrived rather than `null`, which is deliberate: the message
    // says a provider document was not found, and a reader diagnosing the adapter needs to see what
    // arrived in its place.
    assert.equal(result.actual, webDocument);
  });

  it("reports ERROR and blames the environment rather than the application when the reading is absent", () => {
    const result = expect(
      field("cloud.meter", { target: "requests", atMost: 1 }),
      observed(null),
      "ERROR",
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });
});

// ---- targets, and the resolver's own reason --------------------------------------------------------

describe("a target is validated by the family's own resolver, and its refusal is quoted", () => {
  it("refuses a target that names no kind, in the resolver's words", () => {
    // A leading slash is the realistic spelling of this mistake, and it is the branch that fires: a
    // target with no separator at all is *a kind this world does not hold*, which is a different
    // sentence and has its own assertion below.
    expect(
      field("cloud.bucket", { target: "/cart-assets", equals: true }),
      account,
      "ERROR",
      /names no kind/,
    );
  });

  it("refuses surrounding whitespace rather than trimming it away", () => {
    // A target is a spelling, and a spelling that differs from the one the world would record is a
    // criterion that could never match - so it is refused rather than quietly repaired.
    expect(
      field("cloud.bucket", { target: " bucket/cart-assets", equals: true }),
      account,
      "ERROR",
      /without surrounding whitespace/,
    );
  });

  it("refuses a kind this world does not hold, and names the five it does", () => {
    // No separator, so the whole target reads as a kind - and this is the branch, not "names no kind".
    const result = expect(
      field("cloud.bucket", { target: "cart-assets", equals: true }),
      account,
      "ERROR",
      /is not a kind of thing this world holds/,
    );
    assert.match(String(result.message), /bucket, object, queue, secret, principal/);
  });

  it("refuses an object reference with no key, and a key carrying the access separator", () => {
    expect(
      field("cloud.object", { target: "object/cart-assets", equals: true }),
      account,
      "ERROR",
      /names a bucket and no key/,
    );
    expect(
      field("cloud.object", { target: "object/cart-assets/a:b", equals: true }),
      account,
      "ERROR",
      /may not contain ":"/,
    );
  });

  it("refuses a name that is not the lower-case spelling this world records", () => {
    expect(
      field("cloud.bucket", { target: "bucket/Cart-Assets", equals: true }),
      account,
      "ERROR",
      /lower case and starts with a letter or a digit/,
    );
  });

  it("refuses a slash in a name, because only an object's key is a path", () => {
    expect(
      field("cloud.queue", { target: "queue/a/b", equals: true }),
      account,
      "ERROR",
      /does not contain "\/"/,
    );
  });

  it("refuses a reference of the wrong kind, and says which kind it read", () => {
    // Distinct from the resolver's refusals on purpose. The grammar was satisfied; this validator
    // simply does not read queues, and folding the two messages into one would make the second a cause
    // the resolver could not have observed.
    const result = expect(
      field("cloud.bucket", { target: "queue/cart-events", equals: true }),
      account,
      "ERROR",
      /names a queue/,
    );
    assert.match(String(result.message), /This validator reads bucket/);
  });

  it("refuses a validator that was given no target, naming what it reads", () => {
    const result = expect(field("cloud.secret", { equals: true }), account, "ERROR", /named no target/);
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
    assert.match(String(result.message), /This validator reads a secret reference/);
  });

  it("resolves a correct reference, so the refusal tests above are not a resolver that refuses everything", () => {
    // Without this the suite would hold five refusals and call it the rule: a resolver that returned
    // `refused` for every input would satisfy all of them.
    expect(field("cloud.bucket", { target: "bucket/cart-assets", equals: true }), account, "PASS");
    expect(field("cloud.object", { target: "object/cart-assets/index.html", equals: true }), account, "PASS");
    expect(field("cloud.queue", { target: "queue/cart-events", equals: true }), account, "PASS");
    expect(field("cloud.secret", { target: "secret/cart-api-key", equals: true }), account, "PASS");
  });

  it("validates an access reference into exactly three parts, and names the shape when it is not", () => {
    expect(
      field("cloud.access", {
        target: "principal/svc-cart:s3.getObject:object/cart-assets/index.html",
        contains: "allowed=true",
      }),
      account,
      "PASS",
    );
    expect(
      field("cloud.access", { target: "principal/svc-cart:s3.getObject", contains: "allowed=true" }),
      account,
      "ERROR",
      /needs 3/,
    );
    expect(
      field("cloud.access", {
        target: "bucket/cart-assets:s3.getObject:bucket/cart-assets",
        contains: "x",
      }),
      account,
      "ERROR",
      /names a bucket/,
    );
  });

  it("refuses an action this world does not serve, and explains why the separator is not a colon", () => {
    const result = expect(
      field("cloud.access", { target: "principal/svc-cart:s3.readObject:bucket/cart-assets", contains: "x" }),
      account,
      "ERROR",
      /is not an action this world serves/,
    );
    assert.match(String(result.message), /separates the three parts of an access reference/);
  });
});

// ---- presence, one kind at a time ------------------------------------------------------------------

describe("presence is a question with its own repair, asked once per kind", () => {
  it("passes for something the reading holds and fails for something it does not", () => {
    expect(field("cloud.bucket", { target: "bucket/cart-assets", equals: true }), account, "PASS");
    const absent = expect(
      field("cloud.bucket", { target: "bucket/cart-nowhere", equals: true }),
      account,
      "FAIL",
    );
    assert.equal(absent.actual, false, "the world was asked and answered; that is a FAIL, not a gap");
  });

  it("accepts the words `present` and `absent` as well as the booleans", () => {
    expect(field("cloud.object", { target: "object/cart-assets/index.html", equals: "present" }), account, "PASS");
    expect(field("cloud.object", { target: "object/cart-assets/missing.html", equals: "absent" }), account, "PASS");
  });

  it("asks each kind its own question, so a bucket is not a queue", () => {
    // The reading holds a queue named `cart-events` and no bucket of that name. A family that keyed on
    // the *name* alone would answer the bucket question from the queue's existence.
    assert.ok(cloudDocument().buckets.every((bucket) => bucket.name !== "cart-events"));
    expect(field("cloud.bucket", { target: "bucket/cart-events", equals: true }), account, "FAIL");
    expect(field("cloud.queue", { target: "queue/cart-events", equals: true }), account, "PASS");
  });

  it("answers a question about an absent resource with a gap, naming the validator that owns presence", () => {
    const result = expect(
      field("cloud.setting", { target: "bucket/cart-nowhere", contains: "name=" }),
      account,
      "INCONCLUSIVE",
      /holds no bucket\/cart-nowhere/,
    );
    assert.match(String(result.message), /`cloud\.bucket`/);
  });

  it("names the question nobody owns when the absent thing is a principal", () => {
    // A principal has no presence validator - the family reads what is attached to it - so the message
    // has to say that rather than name a sixth validator that does not exist.
    const result = expect(
      field("cloud.policy", { target: "principal/svc-ghost", contains: "allow" }),
      account,
      "INCONCLUSIVE",
      /holds no principal\/svc-ghost/,
    );
    assert.match(String(result.message), /no validator for/);
  });

  it("tells `absent` from `denied` on the one kind whose reading is secret-bearing", () => {
    // A secret the account does not hold answers `equals: "absent"`, and that is a PASS. The test is
    // here because the natural mistake is to special-case secrets: their *contents* are withheld, which
    // is a gap, but their *existence* is a fact this world reads like any other.
    expect(field("cloud.secret", { target: "secret/cart-nowhere", equals: "absent" }), account, "PASS");
    expect(field("cloud.secret", { target: "secret/cart-api-key", equals: true }), account, "PASS");
  });
});

// ---- what the world holds about a resource ---------------------------------------------------------

describe("the reading of a resource is a document, and its tags are a document of their own", () => {
  it("renders the fields a criterion can assert, in a stable order", () => {
    expect(field("cloud.setting", { target: "bucket/cart-assets", contains: "versioning=enabled" }), account, "PASS");
    expect(field("cloud.setting", { target: "bucket/cart-assets", contains: "region=eu-west-1" }), account, "PASS");
    expect(
      field("cloud.setting", { target: "bucket/cart-assets", equals: renderBucket(bucketReading()) }),
      account,
      "PASS",
    );
  });

  it("restricts cloud.tag to the tag lines, which is the whole difference from cloud.setting", () => {
    expect(
      field("cloud.tag", { target: "bucket/cart-assets", equals: "tag.env=prod\ntag.owner=cart" }),
      account,
      "PASS",
    );
    // The same resource, the same predicate, and a line that exists in `cloud.setting`'s rendering but
    // not in `cloud.tag`'s - which is what makes the two validators different rather than duplicated.
    expect(field("cloud.tag", { target: "bucket/cart-assets", contains: "versioning" }), account, "FAIL");
    expect(field("cloud.setting", { target: "bucket/cart-assets", contains: "versioning" }), account, "PASS");
  });

  it("reads only the tag lines, and `matches` is how a contract anchors exactly one of them", () => {
    const document = observed(
      cloudDocument({ buckets: [bucketReading({ tags: { env: "production" } })] }),
    );
    // `contains` is a substring test, so a shorter spelling is satisfied by a longer tag. That is the
    // ordinary meaning of the word and the reason `matches` exists beside it, so the two are asserted
    // together rather than the first being written as if it were anchored.
    expect(field("cloud.tag", { target: "bucket/cart-assets", contains: "tag.env=prod" }), document, "PASS");
    expect(
      field("cloud.tag", { target: "bucket/cart-assets", matches: "^tag\\.env=prod$" }),
      document,
      "FAIL",
    );
    expect(
      field("cloud.tag", { target: "bucket/cart-assets", matches: "^tag\\.env=production$" }),
      document,
      "PASS",
    );
    // And a resource field is not in this rendering at all, so no tag criterion can be satisfied by one.
    expect(field("cloud.tag", { target: "bucket/cart-assets", contains: "versioning" }), document, "FAIL");
  });

  it("renders an object by its bucket and key, and a queue by its attributes beside its tags", () => {
    expect(
      field("cloud.setting", { target: "object/cart-assets/index.html", contains: "contentType=text/html" }),
      account,
      "PASS",
    );
    expect(
      field("cloud.setting", { target: "object/cart-assets/index.html", contains: "versions=2" }),
      account,
      "PASS",
    );
    expect(
      field("cloud.setting", { target: "queue/cart-events", contains: "attribute.retention=60" }),
      account,
      "PASS",
    );
    // An attribute and a tag with the same name must not collide, which is why one of them carries a
    // prefix at all.
    expect(field("cloud.setting", { target: "queue/cart-events", contains: "tag.env=prod" }), account, "PASS");
  });

  it("spells a real absence as `none`, and never spells an unread flag as `false`", () => {
    // `publicAccessBlocked` is `boolean | null`. A world that did not read it renders `none`, and a
    // world that read it as `false` renders `false`, so a criterion asking whether public access is
    // blocked cannot read the gap as "not blocked" - which is the false PASS this test exists to
    // prevent. Asserted on the rendering *and* through the validator, so neither half can drift.
    const unread = bucketReading({ name: "cart-uploads", publicAccessBlocked: null, policy: [] });
    const rendering = renderBucket(unread);
    assert.match(rendering, /publicAccessBlocked=none/);
    assert.doesNotMatch(rendering, /publicAccessBlocked=false/);

    const document = observed(cloudDocument({ buckets: [unread] }));
    expect(
      field("cloud.setting", { target: "bucket/cart-uploads", contains: "publicAccessBlocked=none" }),
      document,
      "PASS",
    );
    expect(
      field("cloud.setting", { target: "bucket/cart-uploads", contains: "publicAccessBlocked=false" }),
      document,
      "FAIL",
      /but it is /,
    );
  });

  it("spells a genuinely absent queue setting as `none`, and that is a value rather than a gap", () => {
    // No dead-letter queue configured is a decision with a consequence, and it is spelled the same way
    // an unread flag is - which is deliberate, because both mean this document does not state a value.
    const document = observed(cloudDocument({ queues: [queueReading({ deadLetterQueue: null })] }));
    expect(
      field("cloud.setting", { target: "queue/cart-events", contains: "deadLetterQueue=none" }),
      document,
      "PASS",
    );
    expect(field("cloud.setting", { target: "queue/cart-events", contains: "deadLetterQueue=null" }), document, "FAIL");
  });

  it("cannot be asked for a secret's value, because the reading does not carry one", () => {
    // The property is a property of the world: `CloudSecretVersion` holds `bytes` and `sha256` and never
    // the value. Asserted as the *set of keys* the rendering exposes, so adding a value-shaped key
    // later fails here rather than quietly making every secret assertable.
    const secret = secretReading();
    assert.equal(Object.hasOwn(secret, "value"), false);
    assert.equal(Object.hasOwn(secret.versions[0] ?? {}, "value"), false);
    const keys = renderSecret(secret)
      .split("\n")
      .map((line) => line.split("=")[0] ?? "");
    assert.deepEqual(
      [...keys].sort(),
      [
        "bytes",
        "currentVersion",
        "encrypted",
        "matchesKnownPlaceholder",
        "name",
        "rotationEnabled",
        "sha256",
        "tag.owner",
        "versions",
      ],
      "the rendering of a secret gained a key, and every key is a question a criterion may ask",
    );
    expect(
      field("cloud.setting", { target: "secret/cart-api-key", contains: "matchesKnownPlaceholder=true" }),
      account,
      "PASS",
    );
  });
});

// ---- policies and decisions ------------------------------------------------------------------------

describe("a policy is what was written down, and a decision is what the world did with it", () => {
  it("reads the statements attached to a bucket, in declaration order", () => {
    const result = expect(
      field("cloud.policy", { target: "bucket/cart-assets", contains: "deny * *" }),
      account,
      "PASS",
    );
    assert.equal(
      result.actual,
      "allow s3.getObject bucket/cart-assets/*\ndeny * *",
      "the statements render in the order they were written, because a policy is a document a reader " +
        "reads top to bottom",
    );
  });

  it("reads a principal's statements from the principal, not from the bucket", () => {
    // The same text, held in two places: a bucket's policy grants the *bucket* to whoever is named, and
    // a principal's statements say what it may do. A validator that read one and answered for the other
    // would report a grant that exists and a grant that does not as the same thing.
    const document = observed(
      cloudDocument({
        principals: [principalReading({ statements: [], attachedPolicies: [] })],
      }),
    );
    expect(field("cloud.policy", { target: "principal/svc-cart", equals: "" }), document, "PASS");
    expect(field("cloud.policy", { target: "bucket/cart-assets", contains: "allow" }), document, "PASS");
  });

  it("spells a resource that exists with nothing attached as the empty string", () => {
    // A different fact from a resource that does not exist: this one is `PASS` on `equals: ""`, and the
    // absent bucket below is a gap. Collapsing them would make "nothing is attached" unfalsifiable.
    const document = observed(cloudDocument({ buckets: [bucketReading({ policy: [] })] }));
    expect(field("cloud.policy", { target: "bucket/cart-assets", equals: "" }), document, "PASS");
    expect(field("cloud.policy", { target: "bucket/cart-nowhere", equals: "" }), document, "INCONCLUSIVE");
  });

  it("refuses a resource kind that carries no statements at all", () => {
    expect(
      field("cloud.policy", { target: "queue/cart-events", contains: "allow" }),
      account,
      "ERROR",
      /names a queue/,
    );
  });

  it("judges the decision the world recorded, never a policy it re-derives", () => {
    // The decisive test of this family. The bucket's policy grants `s3.getObject` to `svc-cart`, and the
    // world recorded a *deny* for exactly that triple - a contradiction no correct evaluator would
    // produce, kept in the fixture because the two facts must be judgeable independently. A validator
    // that re-derived the answer from the policy (a second implementation of the provider's own
    // authorization rule) would report `allowed=true` here and a verdict the world never reached.
    const document = observed(
      cloudDocument({
        decisions: [
          decisionReading({ allowed: false, entry: "explicit-deny-from-world" }),
        ],
      }),
    );
    expect(field("cloud.policy", { target: "bucket/cart-assets", contains: "allow s3.getObject" }), document, "PASS");
    expect(
      field("cloud.access", {
        target: "principal/svc-cart:s3.getObject:object/cart-assets/index.html",
        contains: "allowed=false",
      }),
      document,
      "PASS",
    );
    expect(field("cloud.access", {
      target: "principal/svc-cart:s3.getObject:object/cart-assets/index.html",
      contains: "allowed=true",
    }), document, "FAIL");
  });

  it("reports the entry that fired, so a denial says whether it was refused or merely ungranted", () => {
    expect(
      field("cloud.access", {
        target: "principal/svc-cart:s3.getObject:object/cart-assets/index.html",
        contains: "entry=allow s3.getObject bucket/cart-assets/*",
      }),
      account,
      "PASS",
    );
    // The world's own default, spelled `none` rather than left blank: "denied because nothing granted
    // it" is a different repair from "denied by a statement that names you".
    expect(
      field("cloud.access", {
        target: "principal/svc-incident:s3.putObject:object/cart-assets/index.html",
        contains: "entry=none",
      }),
      account,
      "PASS",
    );
  });

  it("takes the newest decision when the world was asked the same triple twice", () => {
    const document = observed(
      cloudDocument({
        decisions: [
          decisionReading({ allowed: false, entry: "none" }),
          decisionReading({ allowed: true, entry: "allow s3.getObject bucket/cart-assets/*" }),
        ],
      }),
    );
    expect(
      field("cloud.access", {
        target: "principal/svc-cart:s3.getObject:object/cart-assets/index.html",
        contains: "allowed=true",
      }),
      document,
      "PASS",
    );
  });

  it("answers a triple nobody asked about with a gap, naming what puts the question to the world", () => {
    const result = expect(
      field("cloud.access", {
        target: "principal/svc-cart:s3.deleteObject:object/cart-assets/index.html",
        contains: "allowed=true",
      }),
      account,
      "INCONCLUSIVE",
      /recorded no decision for/,
    );
    assert.match(String(result.message), /`cloud\.call`/);
    assert.match(String(result.message), /`cloud\.probe`/);
  });
});

// ---- the action record, split by who asked ---------------------------------------------------------

describe("the action record is split by who asked, and the newest answer is judged", () => {
  it("judges the newest request by the application, not the first", () => {
    // The record is a chronological log: a request this world refused early and served after a repair
    // is a request that works now. The reverse document is the one that matters - a run that regressed
    // must read as broken, or the loop would report progress from its own intentions.
    const repaired = observed(
      cloudDocument({
        calls: [
          callReading({ result: "invalid", status: 400, reason: "the body is not JSON" }),
          callReading({ result: "ok", status: 200 }),
        ],
      }),
    );
    expect(field("cloud.call", { target: "s3.putObject", equals: "ok" }), repaired, "PASS");

    const regressed = observed(
      cloudDocument({ calls: [callReading({ result: "ok" }), callReading({ result: "refused", status: 403 })] }),
    );
    expect(
      field("cloud.call", { target: "s3.putObject", equals: "ok" }),
      regressed,
      "FAIL",
      /but it is "refused"/,
    );
  });

  it("judges a refusal as a decision rather than as a gap", () => {
    // The whole point of the seven-word result vocabulary: a request the provider said no to is a fact
    // about the world. A family that treated every non-`ok` result as "nothing to look at" could never
    // express "the application was denied", which is the most important thing a hardening contract
    // states.
    const document = observed(cloudDocument({ calls: [callReading({ result: "refused", status: 403 })] }));
    expect(field("cloud.call", { target: "s3.putObject", equals: "refused" }), document, "PASS");
  });

  it("keeps `refused` apart from `missing`, which are two different observations", () => {
    const refused = observed(cloudDocument({ calls: [callReading({ result: "refused", status: 403 })] }));
    expect(field("cloud.call", { target: "s3.putObject", equals: "missing" }), refused, "FAIL");
    const missing = observed(cloudDocument({ calls: [callReading({ result: "missing", status: 404 })] }));
    expect(field("cloud.call", { target: "s3.putObject", equals: "missing" }), missing, "PASS");
    expect(field("cloud.call", { target: "s3.putObject", equals: "refused" }), missing, "FAIL");
  });

  it("judges the criterion's own request separately from the application's", () => {
    // The containment contract: a criterion that asks the account a question and asserts the answer is
    // stating what the world holds. Judging it through `cloud.call` would let a run pass on the strength
    // of the run's own questions, which is the false pass this product exists to refuse.
    expect(field("cloud.probe", { target: "s3.headBucket", equals: "ok" }), account, "PASS");
    const crossed = expect(
      field("cloud.call", { target: "s3.headBucket", equals: "ok" }),
      account,
      "INCONCLUSIVE",
      /issued by criterion/,
    );
    assert.match(String(crossed.message), /`cloud\.probe`/);
  });

  it("tells an absent record apart from a record that belongs to somebody else", () => {
    // Two different facts with two different readers: nobody made the request, or somebody who is not
    // the application made it. A single message covering both would send half its readers to the wrong
    // file.
    const never = expect(
      field("cloud.call", { target: "s3.deleteObject", equals: "ok" }),
      account,
      "INCONCLUSIVE",
      /recorded no request for `s3\.deleteObject` at all/,
    );
    const elsewhere = expect(
      field("cloud.call", { target: "s3.headBucket", equals: "ok" }),
      observed(cloudDocument({ calls: [callReading({ source: "criterion", action: "s3.headBucket" })] })),
      "INCONCLUSIVE",
      /issued by criterion/,
    );
    assert.notEqual(never.message, elsewhere.message);
  });

  it("refuses an action this world does not serve before consulting any record", () => {
    // `callsOf` answers `[]` for an unknown action, which would be reported as "the application never
    // made that request" - a sentence naming a cause the reporter did not observe, and the shape of a
    // real defect rather than of a contract that cannot be read.
    const result = expect(
      field("cloud.call", { target: "s3.teleport", equals: "ok" }),
      account,
      "ERROR",
      /is not an action this world serves/,
    );
    const message = String(result.message);
    assert.ok(
      CLOUD_ACTION_NAMES.some((action) => message.includes(action)),
      "the message names at least one action this world does serve, so a reader sees the vocabulary " +
        "rather than only the mistake",
    );
  });

  it("rejects a result outside the reading's vocabulary, listing all seven", () => {
    // Reached only once a record exists, because an absent record is answered first and that answer is
    // a gap rather than a rejection. Written this way round deliberately: the obvious version compares
    // against a fixture holding no calls at all, which asserts the wrong branch.
    const result = expect(
      field("cloud.call", { target: "s3.putObject", equals: "denied" }),
      account,
      "ERROR",
      /wants one of ok/,
    );
    assert.match(
      String(result.message),
      new RegExp(CLOUD_CALL_RESULTS.join(", ")),
      "the refusal lists the vocabulary it wants, read from the vocabulary rather than recalled",
    );
  });

  it("refuses a validator that was given no target", () => {
    expect(field("cloud.call", { equals: "ok" }), account, "ERROR", /named no target/);
    expect(field("cloud.probe", { equals: "ok" }), account, "ERROR", /named no target/);
  });
});

// ---- the meters ------------------------------------------------------------------------------------

describe("the meters are counts, and a counter this account does not keep is not zero", () => {
  it("compares a meter with equals, atLeast and atMost", () => {
    expect(field("cloud.meter", { target: "requests", equals: 7 }), account, "PASS");
    expect(field("cloud.meter", { target: "requests", atLeast: 1 }), account, "PASS");
    expect(field("cloud.meter", { target: "requests", atMost: 7 }), account, "PASS");
  });

  it("fails a ceiling that was exceeded, carrying the count the world produced", () => {
    const over = expect(
      field("cloud.meter", { target: "requests", atMost: 6 }),
      account,
      "FAIL",
      /but it is 7/,
    );
    assert.equal(over.actual, 7);
  });

  it("refuses a counter this account does not keep rather than reading it as zero", () => {
    // `meterValue` answers `null` for exactly one cause, and a `null` read as `0` would make any ceiling
    // pass and any floor fail - both of which are verdicts about a number the world never measured.
    const result = expect(
      field("cloud.meter", { target: "bytesSent", atMost: 1000 }),
      account,
      "ERROR",
      /is not a meter this account keeps/,
    );
    for (const key of CLOUD_METER_KEYS) {
      assert.match(String(result.message), new RegExp(`\`${key}\``));
    }
  });

  it("refuses a validator that was given no target, naming the meters by name", () => {
    const result = expect(field("cloud.meter", { atMost: 1 }), account, "ERROR", /named no target/);
    assert.match(String(result.message), /`costUnits`/);
  });
});

// ---- expectations that cannot fail -----------------------------------------------------------------

describe("an expectation that cannot fail is not a judgment", () => {
  it("refuses an expectation that states no comparison", () => {
    expect(field("cloud.bucket", { target: "bucket/cart-assets" }), account, "ERROR", /states no comparison/);
  });

  it("refuses a presence comparison against a word that is not a presence", () => {
    expect(
      field("cloud.queue", { target: "queue/cart-events", equals: "yes" }),
      account,
      "ERROR",
      /wants true, false/,
    );
  });

  it("refuses a text comparison against a number", () => {
    expect(
      field("cloud.setting", { target: "bucket/cart-assets", equals: 3 }),
      account,
      "ERROR",
      /compares text with a string/,
    );
  });

  it("refuses a count comparison against a string", () => {
    expect(
      field("cloud.meter", { target: "requests", atLeast: "many" }),
      account,
      "ERROR",
      /compares a count with a number/,
    );
  });

  it("leaves a passing assertion without a message, so a skim cannot read one as the failure", () => {
    const passed = judge(field("cloud.bucket", { target: "bucket/cart-assets", equals: true }), account);
    assert.equal(passed.status, "PASS");
    assert.equal(passed.message, null);
    assert.equal(passed.expected, true, "a passing assertion still records what it expected");
  });
});

// ---- the registry the product actually builds ------------------------------------------------------

describe("the family is what the product's registry will hand out", () => {
  it("is reachable by every name a contract can write, through a real registry", () => {
    const built = new ValidatorRegistry(cloudValidators());
    for (const name of Object.values(CLOUD_VALIDATOR_NAMES)) {
      assert.ok(built.has(name), `${name} is not in the registry the CLI builds`);
      assert.equal(built.require(name).name, name);
    }
    assert.equal(built.names().length, Object.values(CLOUD_VALIDATOR_NAMES).length);
  });

  it("is exactly the roster the demo's contract names, read out of the contract itself", () => {
    // A roster in prose and a roster in a register are two lists of the same thing, and only one of them
    // is executable - so this reads the *contract*, which is the document an operator writes, rather than
    // a list recalled here. `AC-023` is why the count is not the interesting part: it names two validators
    // in one criterion, one judging the criterion's own request and one judging the application's, and a
    // set difference would be silent about a name spelled twice.
    const contract = readFileSync(new URL("../../examples/sim-cloud/acceptance.yaml", import.meta.url), "utf8");
    const named = new Set((contract.match(/validator:\s*([a-z0-9.]+)/g) ?? []).map((line) => line.split(":")[1]?.trim() ?? ""));
    const exported = new Set<string>(Object.values(CLOUD_VALIDATOR_NAMES));

    assert.ok(named.size > 0, "the contract names no validator, so nothing was compared");
    assert.deepEqual(
      [...named].filter((name) => !exported.has(name)),
      [],
      "the contract names a validator this family does not export - the run would report an environment defect",
    );
    assert.deepEqual(
      [...exported].filter((name) => !named.has(name)).sort(),
      [],
      "this family exports a validator the demo's contract never exercises, so its behavior is held by unit tests only",
    );
  });
});
