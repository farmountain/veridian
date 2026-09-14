/**
 * The substitute provider account, driven in process and over a real socket.
 *
 * `cloud-port.ts` is the whole substance of the `sim-cloud` world: every cloud criterion's reading is
 * derived here, and every refusal a provisioning program sees comes from here. Until this file
 * existed the port had **no test at all**, so its behaviour was reachable only through the demo - the
 * same defect this repository already paid for when the four database validators that decide every
 * verdict in their world were held by a single end-to-end example.
 *
 * ## What is asserted here, and why these properties
 *
 * Not "the helper functions return the right values". Each group below pins a property the world
 * either has or does not, and each is a property a reader of a bundle would otherwise have to take on
 * faith:
 *
 * - **The route table and the action vocabulary are one list.** {@link servedActions} walks the
 *   routes and {@link CLOUD_ACTION_NAMES} is the closed vocabulary a contract may name. An action in
 *   the vocabulary with no route behind it is a criterion no request can ever satisfy, and the two
 *   are compared here rather than in prose.
 * - **A read does not mutate what it reads.** Two snapshots of an unchanged account are deep-equal,
 *   which is what M1 needs to be able to call two runs the same run.
 * - **404, 405 and 501 are three different observations.** A resource that is absent, a method on a
 *   known resource that is not served, and a sub-resource this world does not hold each answer with
 *   their own status and their own vocabulary member.
 * - **Every request is recorded, refusals included.** A contract that only ever checked state could
 *   pass on a run whose provisioner never ran at all.
 * - **A secret's value is the one thing no reading carries.**
 * - **A reset restores the account; it does not restore the record.**
 *
 * ## Why the wire group exists as well as the in-process group
 *
 * The in-process group pins the world's semantics cheaply and is where most of the detail lives. The
 * wire group exists because the property this world claims is not only "the port's functions return
 * the right values" but "**a real HTTP client reaches a real server on a real socket and gets the
 * provider API's answer**" - that is what makes the substitution honest, and a test that only called
 * `call()` would verify an object rather than a claim. It binds a port, which is why
 * `listen({ port: 0 })` exists.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  CLOUD_ACTION_NAMES,
  CLOUD_PLACEHOLDER_VALUES,
  CLOUD_SIMULATED_SURFACES,
} from "../../core/environment/cloud-observation.ts";
import type {
  CloudBucketReading,
  CloudMeterReading,
  CloudObjectReading,
  CloudPrincipalReading,
  CloudQueueReading,
  CloudSecretReading,
} from "../../core/environment/cloud-observation.ts";
import {
  COST_UNITS,
  HEADER_ENCRYPTION,
  HEADER_PRINCIPAL,
  covers,
  coversAction,
  httpCloud,
  servedActions,
} from "./cloud-port.ts";
import type { CloudCallOutcome, CloudIdentity, CloudPort, CloudRequest } from "./cloud-port.ts";

/** The account every test works in, unless it says otherwise. */
const identity = (overrides: Partial<CloudIdentity> = {}): CloudIdentity => ({
  provider: "veridian-cloud",
  region: "eu-west-1",
  account: "acct-cart",
  principal: "cart-provisioner",
  ...overrides,
});

/** Bytes put into the store, sized so the cost model's ceiling is exercised (2000 / 1024 -> 2). */
const ANCHOR = "x".repeat(2000);
/** A value that is deliberately not on the world's closed list of known placeholders. */
const VALUE = "hunter2-not-a-placeholder";

const ports: CloudPort[] = [];
const fresh = (overrides: Partial<CloudIdentity> = {}): CloudPort => {
  const port = httpCloud(identity(overrides));
  ports.push(port);
  return port;
};

after(async () => {
  for (const port of ports) await port.close();
});

/** One request, in process. The port's own path, not a function call, so a route is exercised. */
const call = (
  port: CloudPort,
  method: string,
  path: string,
  extra: Partial<CloudRequest> = {},
  source: "application" | "criterion" | "world" = "application",
): CloudCallOutcome => port.call({ method, path, ...extra }, source);

/** A JSON body, for the cases where the answer's content is the point. */
const bodyOf = <T>(outcome: CloudCallOutcome): T => JSON.parse(outcome.body) as T;

const json = (value: unknown): string => JSON.stringify(value);

const makeBucket = (port: CloudPort, name = "cart-assets", extra: Record<string, unknown> = {}): void => {
  const outcome = call(port, "PUT", `/v1/storage/buckets/${name}`, {
    body: json({ name, ...extra }),
  });
  assert.equal(outcome.status, 201, `creating ${name} answered ${String(outcome.status)}: ${outcome.reason ?? ""}`);
};

const makeQueue = (port: CloudPort, name = "cart-jobs", extra: Record<string, unknown> = {}): void => {
  const outcome = call(port, "POST", "/v1/queues", { body: json({ name, ...extra }) });
  assert.equal(outcome.status, 201, `creating ${name} answered ${String(outcome.status)}: ${outcome.reason ?? ""}`);
};

const makeSecret = (port: CloudPort, name = "cart-token", value?: string): void => {
  const outcome = call(port, "POST", "/v1/secrets", {
    body: json(value === undefined ? { name } : { name, value }),
  });
  assert.equal(outcome.status, 201, `creating ${name} answered ${String(outcome.status)}: ${outcome.reason ?? ""}`);
};

const readingOf = <T>(found: T | undefined, what: string): T => {
  assert.ok(found !== undefined, `the account holds ${what}`);
  return found;
};

const bucketOf = (port: CloudPort, name: string): CloudBucketReading =>
  readingOf(
    port.snapshot().buckets.find((bucket) => bucket.name === name),
    `a bucket named ${name}`,
  );

const objectOf = (port: CloudPort, bucket: string, key: string): CloudObjectReading =>
  readingOf(
    port.snapshot().objects.find((object) => object.bucket === bucket && object.key === key),
    `${bucket}/${key}`,
  );

const queueOf = (port: CloudPort, name: string): CloudQueueReading =>
  readingOf(
    port.snapshot().queues.find((queue) => queue.name === name),
    `a queue named ${name}`,
  );

const secretOf = (port: CloudPort, name: string): CloudSecretReading =>
  readingOf(
    port.snapshot().secrets.find((secret) => secret.name === name),
    `a secret named ${name}`,
  );

const principalOf = (port: CloudPort, name: string): CloudPrincipalReading =>
  readingOf(
    port.snapshot().principals.find((principal) => principal.name === name),
    `a principal named ${name}`,
  );

// -----------------------------------------------------------------------------------------------
// The two grammars. A pattern covers by its own wildcard; a grant covers by the action's.
// -----------------------------------------------------------------------------------------------

describe("the two coverage grammars", () => {
  it("treats the bare wildcard as covering every resource", () => {
    assert.equal(covers("*", "object/cart-assets/logo.png"), true);
    assert.equal(covers("*", "bucket/cart-assets"), true);
  });

  it("matches a trailing member wildcard by prefix, and keeps the separator", () => {
    assert.equal(covers("object/cart-assets/*", "object/cart-assets/logo.png"), true);
    assert.equal(covers("object/cart-assets/*", "object/cart-assets/deep/logo.png"), true);
    // The property the kept "/" exists for: a bucket whose name merely starts the same is not covered.
    assert.equal(covers("object/cart-assets/*", "object/cart-assets-private/logo.png"), false);
  });

  it("matches an exact resource only exactly", () => {
    assert.equal(covers("bucket/cart-assets", "bucket/cart-assets"), true);
    assert.equal(covers("bucket/cart-assets", "bucket/cart-assets-2"), false);
  });

  it("gives the action grammar its own wildcard, with a dot boundary", () => {
    assert.equal(coversAction("*", "s3.putObject"), true);
    assert.equal(coversAction("s3.putObject", "s3.putObject"), true);
    assert.equal(coversAction("s3.*", "s3.putObject"), true);
    assert.equal(coversAction("s3.*", "sqs.sendMessage"), false);
    // A shared-brace wildcard would let this through, which is why the two grammars are two functions.
    assert.equal(coversAction("s3.*", "s3x.putObject"), false);
  });
});

// -----------------------------------------------------------------------------------------------
// The route table and the vocabulary are one list.
// -----------------------------------------------------------------------------------------------

describe("the route table against the action vocabulary", () => {
  it("serves every action the vocabulary names, and no action it does not", () => {
    const served = [...servedActions()].sort((a, b) => a.localeCompare(b));
    const declared = [...CLOUD_ACTION_NAMES].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      served,
      declared,
      "an action in the vocabulary with no route behind it is a criterion no request can satisfy, " +
        "and a route serving an action the vocabulary does not name is a request no contract can make",
    );
  });

  it("lists each action once", () => {
    const served = servedActions();
    assert.equal(new Set(served).size, served.length, "the route table names one action twice");
  });
});

// -----------------------------------------------------------------------------------------------
// Identity, and the first thing the world refuses.
// -----------------------------------------------------------------------------------------------

describe("the declared identity", () => {
  it("answers with what the account is, and says it is a substitute", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/v1/version");
    assert.equal(outcome.status, 200);
    const body = bodyOf<{ provider: string; region: string; account: string; simulated: readonly string[] }>(
      outcome,
    );
    assert.equal(body.provider, "veridian-cloud");
    assert.equal(body.region, "eu-west-1");
    assert.equal(body.account, "acct-cart");
    assert.deepEqual(body.simulated, CLOUD_SIMULATED_SURFACES);
  });

  it("resolves the caller without a policy, because who you are is not a permission", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/v1/identity");
    assert.equal(outcome.status, 200);
    assert.equal(bodyOf<{ principal: string }>(outcome).principal, "cart-provisioner");
  });

  it("refuses a blank identity field by naming the field", () => {
    for (const field of ["provider", "region", "account", "principal"] as const) {
      assert.throws(
        () => httpCloud(identity({ [field]: "   " })),
        (error: unknown) => error instanceof Error && error.message.includes(field),
        `a blank ${field} must be refused by name`,
      );
    }
  });

  it("refuses a decided principal, because an account-root reading is not a judgement", () => {
    assert.throws(
      () => httpCloud(identity({ principal: "root" })),
      (error: unknown) => error instanceof Error && error.message.includes("root"),
    );
  });

  it("reports its own identity through identity()", () => {
    const port = fresh();
    assert.deepEqual(port.identity(), identity());
  });
});

// -----------------------------------------------------------------------------------------------
// Three statuses for three different observations.
// -----------------------------------------------------------------------------------------------

describe("a request this world cannot answer", () => {
  it("answers a path no route matches with 404 and the unsupported member", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/nope/at/all");
    assert.equal(outcome.status, 404);
    assert.equal(outcome.result, "unsupported");
    assert.equal(outcome.action, "");
    assert.equal(outcome.resource, null);
  });

  it("answers an absent resource with 404 and the missing member", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/v1/storage/buckets/never-made");
    assert.equal(outcome.status, 404);
    assert.equal(outcome.result, "missing");
    assert.equal(outcome.action, "s3.headBucket");
    assert.equal(outcome.resource, "bucket/never-made");
  });

  it("answers an unserved method on a known resource with 405", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "DELETE", "/v1/storage/buckets");
    assert.equal(outcome.status, 405);
    assert.equal(outcome.result, "unsupported");
  });

  it("answers an unserved method on a known sub-resource with 405", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "POST", "/v1/storage/buckets/cart-assets?versioning");
    assert.equal(outcome.status, 405);
    assert.equal(outcome.result, "unsupported");
  });

  it("answers a sub-resource the route does not hold with 501, not 404 and not 405", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "GET", "/v1/storage/buckets/cart-assets?nonsense");
    assert.equal(outcome.status, 501);
    assert.equal(outcome.result, "unsupported");
  });

  it("answers a route holding no sub-resource at all with 501 rather than ignoring the question", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/v1/secrets?nonsense");
    assert.equal(outcome.status, 501);
    assert.equal(outcome.result, "unsupported");
  });

  it("answers a request naming two sub-resources with 501 rather than reading the first", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "GET", "/v1/storage/buckets/cart-assets?tagging&versioning");
    assert.equal(outcome.status, 501);
    assert.equal(outcome.result, "unsupported");
  });

  it("refuses a name this world cannot express as a resource", () => {
    const port = fresh();
    const outcome = call(port, "PUT", "/v1/storage/buckets/Not-A-Name", {
      body: json({ name: "Not-A-Name" }),
    });
    assert.equal(outcome.status, 422);
    assert.equal(outcome.result, "invalid");
  });

  it("refuses a body that is not JSON with 400 rather than 422", () => {
    const port = fresh();
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets", { body: "not json" });
    assert.equal(outcome.status, 400);
    assert.equal(outcome.result, "invalid");
  });
});

// -----------------------------------------------------------------------------------------------
// The action record. Every request, including every refusal.
// -----------------------------------------------------------------------------------------------

describe("the action record", () => {
  it("records a refusal as well as an answer", () => {
    const port = fresh();
    call(port, "GET", "/v1/storage/buckets/never-made");
    const records = port.calls();
    assert.equal(records.length, 1);
    const first = readingOf(records[0], "one record");
    assert.equal(first.action, "s3.headBucket");
    assert.equal(first.result, "missing");
    assert.equal(first.status, 404);
    assert.equal(first.source, "application");
  });

  it("records who asked, and which of the three kinds of asker it was", () => {
    const port = fresh();
    call(port, "GET", "/v1/version", {}, "application");
    call(port, "GET", "/v1/version", {}, "criterion");
    call(port, "GET", "/v1/version", {}, "world");
    assert.deepEqual(
      port.calls().map((record) => record.source),
      ["application", "criterion", "world"],
    );
  });

  it("records every request in request order, refusals and answers interleaved", () => {
    const port = fresh();
    call(port, "GET", "/v1/version");
    call(port, "GET", "/nope");
    call(port, "GET", "/v1/identity");
    assert.deepEqual(
      port.calls().map((record) => record.status),
      [200, 404, 200],
    );
  });

  it("reports no duration at all, because this world measures nothing about time", () => {
    const port = fresh();
    call(port, "GET", "/v1/version");
    call(port, "GET", "/v1/storage/buckets/never-made");
    for (const record of port.calls()) assert.equal(record.durationMs, 0);
  });

  it("hands out the record rather than its own array", () => {
    const port = fresh();
    call(port, "GET", "/v1/version");
    const handed = port.calls() as unknown as unknown[];
    handed.length = 0;
    assert.equal(port.calls().length, 1, "a caller emptied the run's action record by mutating what it was given");
  });
});

// -----------------------------------------------------------------------------------------------
// A read must not mutate the record it reads.
// -----------------------------------------------------------------------------------------------

describe("the state reading", () => {
  it("answers two consecutive reads of an unchanged account identically", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    makeQueue(port);
    makeSecret(port, "cart-token", VALUE);
    assert.deepEqual(port.snapshot(), port.snapshot());
  });

  it("does not grow the account when it is read", () => {
    const port = fresh();
    makeQueue(port);
    call(port, "POST", "/v1/queues/cart-jobs/messages", { body: json({ body: "one" }) });
    const before = queueOf(port, "cart-jobs");
    for (let index = 0; index < 3; index += 1) call(port, "GET", "/v1/queues/cart-jobs");
    const after = queueOf(port, "cart-jobs");
    assert.deepEqual(after, before);
    assert.equal(after.messages, 1);
    assert.equal(after.inFlight, 0);
  });

  it("does not grow the action record when the state is read", () => {
    const port = fresh();
    makeBucket(port);
    const before = port.calls().length;
    port.snapshot();
    port.snapshot();
    assert.equal(port.calls().length, before, "reading the account is not a request to it");
  });

  it("lists keys and names in a stable order rather than in insertion order", () => {
    const port = fresh();
    makeBucket(port);
    for (const key of ["zeta", "alpha", "mu"]) {
      call(port, "PUT", `/v1/storage/buckets/cart-assets/objects/${key}`, { body: "x" });
    }
    const listing = bodyOf<{ keys: readonly string[] }>(
      call(port, "GET", "/v1/storage/buckets/cart-assets/objects"),
    );
    assert.deepEqual(listing.keys, ["alpha", "mu", "zeta"]);
  });
});

// -----------------------------------------------------------------------------------------------
// Buckets.
// -----------------------------------------------------------------------------------------------

describe("buckets", () => {
  it("starts with nothing said about versioning, encryption or public access", () => {
    const port = fresh();
    makeBucket(port);
    const reading = bucketOf(port, "cart-assets");
    assert.equal(reading.versioning, "never");
    assert.equal(reading.encryption, "none");
    assert.equal(reading.publicAccessBlocked, null);
    assert.deepEqual(reading.policy, []);
    assert.equal(reading.objects, 0);
    assert.equal(reading.region, "eu-west-1");
  });

  it("refuses a bucket in a region the account does not hold rather than placing it elsewhere", () => {
    const port = fresh();
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets", {
      body: json({ name: "cart-assets", region: "us-east-1" }),
    });
    assert.equal(outcome.status, 422);
    assert.equal(port.snapshot().buckets.length, 0);
  });

  it("refuses a second bucket under a name it already holds", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets", {
      body: json({ name: "cart-assets" }),
    });
    assert.equal(outcome.status, 409);
    assert.equal(outcome.result, "conflict");
  });

  it("keeps nothing said about public access distinct from a decision to block it", () => {
    const port = fresh();
    makeBucket(port, "cart-assets");
    makeBucket(port, "cart-public", { publicAccessBlocked: false });
    assert.equal(bucketOf(port, "cart-assets").publicAccessBlocked, null);
    assert.equal(bucketOf(port, "cart-public").publicAccessBlocked, false);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets?publicAccessBlock", {
      body: json({}),
    });
    assert.equal(outcome.status, 200);
    assert.equal(bucketOf(port, "cart-assets").publicAccessBlocked, true);
  });

  it("distinguishes versioning never said from versioning suspended", () => {
    const port = fresh();
    makeBucket(port);
    assert.equal(bucketOf(port, "cart-assets").versioning, "never");
    call(port, "PUT", "/v1/storage/buckets/cart-assets?versioning", { body: json({ state: "suspended" }) });
    assert.equal(bucketOf(port, "cart-assets").versioning, "suspended");
    call(port, "PUT", "/v1/storage/buckets/cart-assets?versioning", { body: json({ state: "enabled" }) });
    assert.equal(bucketOf(port, "cart-assets").versioning, "enabled");
    const bad = call(port, "PUT", "/v1/storage/buckets/cart-assets?versioning", {
      body: json({ state: "on" }),
    });
    assert.equal(bad.status, 422);
    assert.equal(bucketOf(port, "cart-assets").versioning, "enabled", "a refused write must change nothing");
  });

  it("refuses bucket encryption the world does not hold, and holds it when it does", () => {
    const port = fresh();
    makeBucket(port);
    const bad = call(port, "PUT", "/v1/storage/buckets/cart-assets?encryption", {
      body: json({ algorithm: "rot13" }),
    });
    assert.equal(bad.status, 422);
    assert.equal(bucketOf(port, "cart-assets").encryption, "none");
    const good = call(port, "PUT", "/v1/storage/buckets/cart-assets?encryption", {
      body: json({ algorithm: "AES256" }),
    });
    assert.equal(good.status, 200);
    assert.equal(bucketOf(port, "cart-assets").encryption, "AES256");
  });

  it("refuses to delete a bucket that holds anything", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const outcome = call(port, "DELETE", "/v1/storage/buckets/cart-assets");
    assert.equal(outcome.status, 409);
    assert.equal(port.snapshot().buckets.length, 1);
  });

  it("deletes an empty bucket", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "DELETE", "/v1/storage/buckets/cart-assets");
    assert.equal(outcome.status, 200);
    assert.equal(port.snapshot().buckets.length, 0);
  });

  it("distinguishes a bucket with no policy from a bucket with an empty one", () => {
    const port = fresh();
    makeBucket(port);
    const none = call(port, "GET", "/v1/storage/buckets/cart-assets?policy");
    assert.equal(none.status, 404);
    assert.equal(none.result, "missing");
    const put = call(port, "PUT", "/v1/storage/buckets/cart-assets?policy", {
      body: json({
        statements: [
          {
            effect: "allow",
            principal: "cart-provisioner",
            action: "s3.putObject",
            resource: "object/cart-assets/*",
          },
        ],
      }),
    });
    assert.equal(put.status, 200);
    assert.equal(bucketOf(port, "cart-assets").policy.length, 1);
  });

  it("refuses a policy statement that could never decide anything", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets?policy", {
      body: json({
        statements: [
          {
            effect: "allow",
            principal: "cart-provisioner",
            action: "s3:GetObject",
            resource: "object/cart-assets/*",
          },
        ],
      }),
    });
    assert.equal(outcome.status, 422);
    assert.deepEqual(bucketOf(port, "cart-assets").policy, []);
  });

  it("refuses a resource pattern with no reference family behind it", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets?policy", {
      body: json({
        statements: [
          {
            effect: "allow",
            principal: "*",
            action: "sqs.sendMessage",
            resource: "queue/cart-jobs/*",
          },
        ],
      }),
    });
    assert.equal(outcome.status, 422, "no queue has members, so the pattern can never match anything");
  });
});

// -----------------------------------------------------------------------------------------------
// Objects: the effective label, the version counter, and the bytes that really arrived.
// -----------------------------------------------------------------------------------------------

describe("objects", () => {
  it("records the effective encryption, which is the bucket's default when the request names none", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets?encryption", { body: json({ algorithm: "AES256" }) });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    assert.equal(objectOf(port, "cart-assets", "logo.png").encryption, "AES256");
  });

  it("records the requested label over the default, and leaves the default alone", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets?encryption", { body: json({ algorithm: "AES256" }) });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", {
      body: ANCHOR,
      headers: { [HEADER_ENCRYPTION]: "aws:kms" },
    });
    assert.equal(objectOf(port, "cart-assets", "logo.png").encryption, "aws:kms");
    assert.equal(bucketOf(port, "cart-assets").encryption, "AES256");
  });

  it("refuses an encryption label this world does not hold, and stores nothing", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", {
      body: ANCHOR,
      headers: { [HEADER_ENCRYPTION]: "rot13" },
    });
    assert.equal(outcome.status, 422);
    assert.equal(port.snapshot().objects.length, 0);
  });

  it("reads the header whatever case it arrives in", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", {
      body: ANCHOR,
      headers: { "X-Veridian-Encryption": "AES256" },
    });
    assert.equal(objectOf(port, "cart-assets", "logo.png").encryption, "AES256");
  });

  it("digests the bytes that really arrived rather than a claim about them", () => {
    const port = fresh();
    makeBucket(port);
    const outcome = call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const answeredReading = bodyOf<{ bytes: number; sha256: string }>(outcome);
    assert.equal(answeredReading.bytes, 2000);
    assert.match(answeredReading.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(answeredReading, {
      bytes: 2000,
      sha256: answeredReading.sha256,
      bucket: "cart-assets",
      key: "logo.png",
      contentType: "application/octet-stream",
      encryption: "none",
      versionId: "v1",
      versions: 1,
      tags: {},
    } as unknown as { bytes: number; sha256: string });
  });

  it("counts one version per key while versioning was never enabled", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "one" });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "two" });
    const reading = objectOf(port, "cart-assets", "logo.png");
    assert.equal(reading.versionId, "v2");
    assert.equal(reading.versions, 1, "a bucket that never enabled versioning replaced the object");
  });

  it("stacks versions once versioning is enabled, newest first", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "one" });
    call(port, "PUT", "/v1/storage/buckets/cart-assets?versioning", { body: json({ state: "enabled" }) });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "two" });
    const reading = objectOf(port, "cart-assets", "logo.png");
    assert.equal(reading.versionId, "v2");
    assert.equal(reading.versions, 2);
    assert.equal(bodyOf<{ body: string }>(call(port, "GET", "/v1/storage/buckets/cart-assets/objects/logo.png")).body, "two");
  });

  it("answers a missing key with 404 rather than an empty object", () => {
    const port = fresh();
    makeBucket(port);
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const outcome = call(port, method, "/v1/storage/buckets/cart-assets/objects/never-written");
      assert.equal(outcome.status, 404, `${method} answered ${String(outcome.status)}`);
      assert.equal(outcome.result, "missing");
    }
  });

  it("keeps object tags per key and survives a rewrite of the bytes", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "one" });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png?tagging", {
      body: json({ tags: { owner: "cart" } }),
    });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "two" });
    assert.deepEqual(objectOf(port, "cart-assets", "logo.png").tags, { owner: "cart" });
  });
});

// -----------------------------------------------------------------------------------------------
// Meters, and the numbers that must survive the state they were read from.
// -----------------------------------------------------------------------------------------------

describe("the meters", () => {
  it("counts a request, an object and the bytes over the whole record", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const meters = port.meters();
    // Creating the bucket answered 201, so it is counted: this is requests over the record, not writes.
    assert.equal(meters.requests, 2);
    assert.equal(meters.objects, 1);
    assert.equal(meters.bytes, 2000);
    assert.equal(
      meters.costUnits,
      meters.requests * COST_UNITS.perRequest +
        meters.objects * COST_UNITS.perObject +
        Math.ceil(meters.bytes / COST_UNITS.bytesPerUnit),
    );
  });

  it("keeps the bytes after the object that held them is deleted", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const before = port.meters().bytes;
    call(port, "DELETE", "/v1/storage/buckets/cart-assets/objects/logo.png");
    assert.equal(port.snapshot().objects.length, 0, "the object really is gone");
    assert.equal(
      port.meters().bytes,
      before,
      "the bytes were read off the state that still held them, so a delete erased the record of a " +
        "cost the run really incurred",
    );
  });

  it("charges a request and nothing else for a refusal", () => {
    const port = fresh();
    const outcome = call(port, "PUT", "/v1/storage/buckets/never-made/objects/logo.png", { body: ANCHOR });
    assert.equal(outcome.status, 404);
    const meters = port.meters();
    assert.equal(meters.requests, 1);
    assert.equal(meters.objects, 0);
    assert.equal(meters.bytes, 0);
  });

  it("answers GET /v1/metering with the same numbers meters() reports", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const overTheRoute = bodyOf<CloudMeterReading>(call(port, "GET", "/v1/metering"));
    assert.deepEqual(overTheRoute, port.meters());
  });

  it("answers the same numbers however many times the meter is asked", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    const readings = [
      bodyOf<CloudMeterReading>(call(port, "GET", "/v1/metering")),
      bodyOf<CloudMeterReading>(call(port, "GET", "/v1/metering")),
      bodyOf<CloudMeterReading>(call(port, "GET", "/v1/metering")),
    ];
    assert.deepEqual(
      readings[1],
      readings[0],
      "a meter read off the request record and then appended to it reported a different cost every " +
        "time it was taken, so a criterion asking about it was judged by how often it had been asked",
    );
    assert.deepEqual(readings[2], readings[0]);
    assert.equal(
      port.calls().length,
      5,
      "the record still holds every request, because a bundle a reader audits must not be short of " +
        "the requests that asked",
    );
  });

  it("counts one object per successful write, not one per key", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "one" });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "two" });
    assert.equal(port.meters().objects, 2);
    assert.equal(port.snapshot().objects.length, 1);
  });
});

// -----------------------------------------------------------------------------------------------
// Secrets. The one thing this world refuses to record.
// -----------------------------------------------------------------------------------------------

describe("secrets", () => {
  it("never carries a secret's value in any reading", () => {
    const port = fresh();
    makeSecret(port, "cart-token", VALUE);
    const rendered = json(port.snapshot());
    assert.equal(rendered.includes(VALUE), false, "a value reached the state reading");
    assert.equal(json(port.calls()).includes(VALUE), false, "a value reached the action record");
  });

  it("serves the value it holds, so the refusal to record it is about readings and not about the route", () => {
    const port = fresh();
    makeSecret(port, "cart-token", VALUE);
    const outcome = call(port, "GET", "/v1/secrets/cart-token?value");
    assert.equal(outcome.status, 200);
    assert.equal(bodyOf<{ value: string }>(outcome).value, VALUE);
  });

  it("records a value's length and digest instead", () => {
    const port = fresh();
    makeSecret(port, "cart-token", VALUE);
    const reading = secretOf(port, "cart-token");
    assert.equal(reading.currentVersion, "v1");
    assert.equal(reading.versions.length, 1);
    const only = readingOf(reading.versions[0], "one version");
    assert.equal(only.version, "v1");
    assert.equal(only.bytes, VALUE.length);
    assert.match(only.sha256, /^[0-9a-f]{64}$/);
  });

  it("recognises every value on its closed list of known placeholders", () => {
    for (const placeholder of CLOUD_PLACEHOLDER_VALUES) {
      const port = fresh();
      makeSecret(port, "cart-token", placeholder);
      assert.equal(
        secretOf(port, "cart-token").matchesKnownPlaceholder,
        true,
        `${placeholder} is on the world's own list and was not recognised`,
      );
    }
  });

  it("folds case and surrounding space before comparing, because neither is part of a value", () => {
    const port = fresh();
    makeSecret(port, "cart-token", `  ${VALUE.toUpperCase()}  `);
    assert.equal(secretOf(port, "cart-token").matchesKnownPlaceholder, false);
    makeSecret(port, "cart-other", "  ChAnGeMe  ");
    assert.equal(secretOf(port, "cart-other").matchesKnownPlaceholder, true);
  });

  it("distinguishes a secret holding nothing from a secret that is not there", () => {
    const port = fresh();
    makeSecret(port);
    const described = call(port, "GET", "/v1/secrets/cart-token");
    assert.equal(described.status, 200, "the secret exists, so describing it is an answer");
    assert.equal(bodyOf<{ currentVersion: string }>(described).currentVersion, "");
    const value = call(port, "GET", "/v1/secrets/cart-token?value");
    assert.equal(value.status, 409, "the secret exists and holds nothing: a conflict, not a missing resource");
    assert.equal(value.result, "conflict");
    const absent = call(port, "GET", "/v1/secrets/never-made?value");
    assert.equal(absent.status, 404);
    assert.equal(absent.result, "missing");
  });

  it("stacks versions newest first as values are put", () => {
    const port = fresh();
    makeSecret(port);
    call(port, "PUT", "/v1/secrets/cart-token", { body: json({ value: "one" }) });
    call(port, "PUT", "/v1/secrets/cart-token", { body: json({ value: "two" }) });
    const reading = secretOf(port, "cart-token");
    assert.equal(reading.currentVersion, "v2");
    assert.deepEqual(
      reading.versions.map((version) => version.version),
      ["v2", "v1"],
    );
  });

  it("records rotation and encryption as decisions the secret holds", () => {
    const port = fresh();
    makeSecret(port, "cart-token", VALUE);
    assert.equal(secretOf(port, "cart-token").rotationEnabled, false);
    assert.equal(secretOf(port, "cart-token").encrypted, true);
    call(port, "PUT", "/v1/secrets/cart-token?rotation", { body: json({ enabled: true }) });
    assert.equal(secretOf(port, "cart-token").rotationEnabled, true);
  });
});

// -----------------------------------------------------------------------------------------------
// Queues.
// -----------------------------------------------------------------------------------------------

describe("queues", () => {
  it("starts with the defaults a queue is created with", () => {
    const port = fresh();
    makeQueue(port);
    const reading = queueOf(port, "cart-jobs");
    assert.equal(reading.messages, 0);
    assert.equal(reading.inFlight, 0);
    assert.equal(reading.deadLetterQueue, null);
    assert.equal(reading.encryption, "none");
    assert.equal(reading.visibilityTimeoutSeconds, 30);
  });

  it("holds a dead-letter queue by name and refuses a name it cannot express", () => {
    const port = fresh();
    makeQueue(port, "cart-jobs", { deadLetterQueue: "cart-jobs-dead" });
    makeQueue(port, "cart-jobs-dead");
    assert.equal(queueOf(port, "cart-jobs").deadLetterQueue, "cart-jobs-dead");
    const bad = call(port, "POST", "/v1/queues", {
      body: json({ name: "cart-other", deadLetterQueue: "Not-A-Name" }),
    });
    assert.equal(bad.status, 422);
  });

  it("answers an empty queue with an empty message rather than a refusal", () => {
    const port = fresh();
    makeQueue(port);
    const outcome = call(port, "GET", "/v1/queues/cart-jobs/messages");
    assert.equal(outcome.status, 200, "an empty queue is an answer, not a gap in the world");
    assert.equal(bodyOf<{ message: string | null }>(outcome).message, null);
  });

  it("moves a message into flight and out of the queue", () => {
    const port = fresh();
    makeQueue(port);
    call(port, "POST", "/v1/queues/cart-jobs/messages", { body: json({ body: "job-1" }) });
    assert.equal(queueOf(port, "cart-jobs").messages, 1);
    const received = call(port, "GET", "/v1/queues/cart-jobs/messages");
    assert.equal(bodyOf<{ message: string | null }>(received).message, "job-1");
    const reading = queueOf(port, "cart-jobs");
    assert.equal(reading.messages, 0);
    assert.equal(reading.inFlight, 1);
  });

  it("spends a receipt, and refuses a receipt it did not issue", () => {
    const port = fresh();
    makeQueue(port);
    call(port, "POST", "/v1/queues/cart-jobs/messages", { body: json({ body: "job-1" }) });
    const receipt = bodyOf<{ receipt: string }>(call(port, "GET", "/v1/queues/cart-jobs/messages")).receipt;
    const spent = call(port, "DELETE", `/v1/queues/cart-jobs/messages/${receipt}`);
    assert.equal(spent.status, 200);
    assert.equal(queueOf(port, "cart-jobs").inFlight, 0);
    const again = call(port, "DELETE", `/v1/queues/cart-jobs/messages/${receipt}`);
    assert.equal(again.status, 404);
    assert.equal(again.result, "missing");
  });

  it("refuses a queue name it already holds", () => {
    const port = fresh();
    makeQueue(port);
    const outcome = call(port, "POST", "/v1/queues", { body: json({ name: "cart-jobs" }) });
    assert.equal(outcome.status, 409);
  });
});

// -----------------------------------------------------------------------------------------------
// Principals and the access decision. `deny` beats `allow`, and nothing else decides.
// -----------------------------------------------------------------------------------------------

describe("principals and access", () => {
  const policy = (statements: readonly Record<string, unknown>[]): string => json({ name: "cart-access", statements });

  const attach = (port: CloudPort, principal: string, statements: readonly Record<string, unknown>[]): CloudCallOutcome =>
    call(port, "PUT", `/v1/identity/principals/${principal}?policy`, { body: policy(statements) });

  const decide = (
    port: CloudPort,
    action: string,
    resource: string,
    principal = "cart-deployer",
  ): { allowed: boolean; entry: string; account: string } =>
    bodyOf<{ allowed: boolean; entry: string; account: string }>(
      call(port, "POST", "/v1/identity/authorize", { body: json({ principal, action, resource }) }),
    );

  const grant = (effect: string, action: string, resource: string): Record<string, unknown> => ({
    effect,
    principal: "cart-deployer",
    action,
    resource,
  });

  it("holds the declared identity as a principal from the start", () => {
    const port = fresh();
    assert.deepEqual(
      port.snapshot().principals.map((principal) => principal.name),
      ["cart-provisioner"],
    );
  });

  it("creates and deletes a principal, and refuses to delete the declared identity", () => {
    const port = fresh();
    const created = call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    assert.equal(created.status, 201);
    assert.equal(principalOf(port, "cart-deployer").attachedPolicies.length, 0);
    const refused = call(port, "DELETE", "/v1/identity/principals/cart-provisioner");
    assert.equal(refused.status, 409, "an account that deleted its own identity has no reader left");
    const deleted = call(port, "DELETE", "/v1/identity/principals/cart-deployer");
    assert.equal(deleted.status, 200);
    assert.equal(port.snapshot().principals.length, 1);
  });

  it("refuses a principal name it already holds and one it cannot express", () => {
    const port = fresh();
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    assert.equal(call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) }).status, 409);
    assert.equal(call(port, "POST", "/v1/identity/principals", { body: json({ name: "Cart-Deployer" }) }).status, 422);
  });

  it("records a decision the world made, including one nothing covered", () => {
    const port = fresh();
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    const decision = decide(port, "s3.putObject", "object/cart-assets/logo.png");
    assert.equal(decision.allowed, false, "a world that allowed by default would grant every permission");
    assert.equal(decision.entry, "none");
    assert.equal(decision.account, "acct-cart");
    const recorded = readingOf(port.decisions()[0], "one recorded decision");
    assert.equal(recorded.principal, "cart-deployer");
    assert.equal(recorded.action, "s3.putObject");
    assert.equal(recorded.allowed, false);
  });

  it("lets a deny beat an allow whether it is written before or after", () => {
    const port = fresh();
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    const allow = grant("allow", "s3.*", "object/cart-assets/*");
    const deny = grant("deny", "s3.deleteObject", "object/cart-assets/*");
    attach(port, "cart-deployer", [deny, allow]);
    assert.equal(decide(port, "s3.putObject", "object/cart-assets/logo.png").allowed, true);
    assert.equal(decide(port, "s3.deleteObject", "object/cart-assets/logo.png").allowed, false);
    attach(port, "cart-deployer", [allow, deny]);
    assert.equal(decide(port, "s3.deleteObject", "object/cart-assets/logo.png").allowed, false);
  });

  it("names the deciding entry, which is the one that covers the action and the resource", () => {
    const port = fresh();
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    attach(port, "cart-deployer", [grant("allow", "s3.*", "object/cart-assets/*")]);
    const decision = decide(port, "s3.putObject", "object/cart-assets/logo.png");
    assert.equal(decision.allowed, true);
    assert.notEqual(decision.entry, "none");
    assert.equal(
      json(decision.entry).includes("s3.*"),
      true,
      `the entry a criterion is judged on must name the statement that fired, and it said ${decision.entry}`,
    );
  });

  it("lets a bucket policy decide for a principal that holds no policy of its own", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    call(port, "PUT", "/v1/storage/buckets/cart-assets?policy", {
      body: policy([grant("allow", "s3.putObject", "object/cart-assets/*")]),
    });
    assert.equal(decide(port, "s3.putObject", "object/cart-assets/logo.png").allowed, true);
    assert.equal(
      decide(port, "s3.putObject", "object/cart-other/logo.png").allowed,
      false,
      "a grant naming one bucket's members must not cover another bucket",
    );
  });

  it("refuses authorize a body it cannot read as a question", () => {
    const port = fresh();
    for (const body of [json({ action: "s3.putObject", resource: "*" }), json({ principal: "cart-provisioner", resource: "*" })]) {
      const outcome = call(port, "POST", "/v1/identity/authorize", { body });
      assert.equal(outcome.status, 422, `answered ${String(outcome.status)}`);
    }
  });

  it("refuses a request from an identity the account does not hold", () => {
    const port = fresh();
    const outcome = call(port, "GET", "/v1/version", { principal: "who-is-this" });
    assert.equal(outcome.status, 400);
    assert.equal(outcome.result, "invalid");
  });

  it("gates a real request, exempts the three questions a stranger may ask, and records the refusal", () => {
    const port = fresh();
    makeBucket(port);
    call(port, "POST", "/v1/identity/principals", { body: json({ name: "cart-deployer" }) });
    const gated = call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", {
      body: ANCHOR,
      principal: "cart-deployer",
    });
    assert.equal(gated.status, 403);
    assert.equal(gated.result, "refused");
    assert.equal(port.snapshot().objects.length, 0, "a refused write must store nothing");
    for (const path of ["/v1/version", "/v1/identity", "/v1/identity/authorize"]) {
      const open = call(port, path === "/v1/identity/authorize" ? "POST" : "GET", path, {
        principal: "cart-deployer",
        ...(path.endsWith("authorize")
          ? { body: json({ principal: "cart-deployer", action: "s3.putObject", resource: "*" }) }
          : {}),
      });
      assert.notEqual(open.status, 403, `${path} must be answerable without a grant`);
    }
  });
});

// -----------------------------------------------------------------------------------------------
// The state document and the one operation that is a reset.
// -----------------------------------------------------------------------------------------------

describe("the state document", () => {
  const populated = (): CloudPort => {
    const port = fresh();
    makeBucket(port);
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: ANCHOR });
    call(port, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "two" });
    makeQueue(port);
    call(port, "POST", "/v1/queues/cart-jobs/messages", { body: json({ body: "job-1" }) });
    makeSecret(port, "cart-token", VALUE);
    return port;
  };

  it("writes the account and neither record", () => {
    const port = populated();
    const document = port.dump();
    const parsed = JSON.parse(document) as Record<string, unknown>;
    assert.equal(parsed["kind"], "CloudState");
    assert.equal(Object.hasOwn(parsed, "calls"), false, "the state document must not carry the action record");
    assert.equal(Object.hasOwn(parsed, "decisions"), false);
  });

  it("carries the stored values, because a restore that could not serve them is a different account", () => {
    // The line this world draws is around *readings*, not around state: `snapshot()` describes a
    // secret by its length, its digest and whether it is a known placeholder, and never by its value -
    // which is the property that makes `cloud.secret` a criterion about a value that cannot be
    // asserted. The state document is the account's own state rather than a reading of it, and it has
    // to carry the value or `load()` would leave a secret this world can describe but never serve.
    const port = populated();
    assert.equal(port.dump().includes(VALUE), true);
    assert.equal(json(port.snapshot()).includes(VALUE), false, "a value reached the state reading");
    assert.equal(json(port.calls()).includes(VALUE), false, "a value reached the action record");
    const restored = fresh();
    restored.load(port.dump());
    assert.equal(
      bodyOf<{ value: string }>(call(restored, "GET", "/v1/secrets/cart-token?value")).value,
      VALUE,
    );
  });

  it("round-trips the whole account through the document", () => {
    const port = populated();
    const document = port.dump();
    const before = port.snapshot();
    const restored = fresh();
    restored.load(document);
    assert.deepEqual(restored.snapshot(), before);
  });

  it("continues the version counter from the document rather than restarting it", () => {
    const port = populated();
    const restored = fresh();
    restored.load(port.dump());
    call(restored, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", { body: "three" });
    assert.equal(
      objectOf(restored, "cart-assets", "logo.png").versionId,
      "v3",
      "a document that lost the write counter would issue a version identifier the account had used",
    );
  });

  it("refuses a document that is not a state document", () => {
    const port = fresh();
    assert.throws(() => port.load(json({ kind: "SomethingElse" })), /cloud state document/);
  });

  it("refuses a state document missing a collection rather than half-loading it", () => {
    const port = fresh();
    assert.throws(
      () => port.load(json({ kind: "CloudState", version: 1, buckets: [], queues: [] })),
      /cloud state document/,
    );
  });

  it("empties the account on clear, keeping the declared identity", () => {
    const port = populated();
    port.clear();
    const after = port.snapshot();
    assert.deepEqual(after.buckets, []);
    assert.deepEqual(after.objects, []);
    assert.deepEqual(after.queues, []);
    assert.deepEqual(after.secrets, []);
    assert.deepEqual(
      after.principals.map((principal) => principal.name),
      ["cart-provisioner"],
    );
  });

  it("keeps both records across a reset, because a reset restores the world and not the record", () => {
    const port = populated();
    call(port, "GET", "/v1/storage/buckets/never-made");
    const calls = port.calls().length;
    const decisions = port.decisions().length;
    assert.ok(calls > 0);
    port.clear();
    assert.equal(
      port.calls().length,
      calls,
      "an iteration that crossed the boundary would be erased by the very act of repairing it",
    );
    assert.equal(port.decisions().length, decisions);
  });

  it("keeps both records across a load, because the document is the state and not the run", () => {
    const port = populated();
    const calls = port.calls().length;
    port.load(port.dump());
    assert.equal(port.calls().length, calls);
  });
});

// -----------------------------------------------------------------------------------------------
// The wire. A real client, a real socket, the provider API's answer.
// -----------------------------------------------------------------------------------------------

describe("over a real socket", () => {
  interface Wire {
    readonly port: CloudPort;
    readonly url: string;
  }

  const bound = async (): Promise<Wire> => {
    const port = fresh();
    const url = await port.listen({ host: "127.0.0.1", port: 0 });
    return { port, url };
  };

  const send = async (
    wire: Wire,
    method: string,
    path: string,
    body?: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<{ status: number; parsed: unknown; text: string }> => {
    const response = await fetch(`${wire.url}${path}`, {
      method,
      ...(body === undefined ? {} : { body }),
      headers,
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, parsed, text };
  };

  it("answers the version route with the account and the surfaces it substitutes", async () => {
    const wire = await bound();
    const answer = await send(wire, "GET", "/v1/version");
    assert.equal(answer.status, 200);
    const parsed = answer.parsed as { simulated: readonly string[]; region: string };
    assert.deepEqual(parsed.simulated, CLOUD_SIMULATED_SURFACES);
    assert.equal(parsed.region, "eu-west-1");
  });

  it("stores what a real client really sent, and digests the bytes that arrived", async () => {
    const wire = await bound();
    await send(wire, "PUT", "/v1/storage/buckets/cart-assets", json({ name: "cart-assets" }));
    const put = await send(wire, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", ANCHOR, {
      "content-type": "application/octet-stream",
    });
    assert.equal(put.status, 200);
    const reading = objectOf(wire.port, "cart-assets", "logo.png");
    assert.equal(reading.bytes, 2000);
    assert.equal(reading.sha256, (put.parsed as { sha256: string }).sha256);
    assert.equal(
      wire.port.calls().at(-1)?.source,
      "application",
      "a request that arrived over the socket is the application's, never a criterion's",
    );
  });

  it("tells the three refusals apart over the wire as well", async () => {
    const wire = await bound();
    await send(wire, "PUT", "/v1/storage/buckets/cart-assets", json({ name: "cart-assets" }));
    assert.equal((await send(wire, "GET", "/nope")).status, 404);
    assert.equal((await send(wire, "GET", "/v1/storage/buckets/never-made")).status, 404);
    assert.equal((await send(wire, "POST", "/v1/storage/buckets/cart-assets")).status, 405);
    assert.equal((await send(wire, "GET", "/v1/storage/buckets/cart-assets?nonsense")).status, 501);
  });

  it("reads the caller out of the transport's own header, and gates the request", async () => {
    const wire = await bound();
    await send(wire, "PUT", "/v1/storage/buckets/cart-assets", json({ name: "cart-assets" }));
    await send(wire, "POST", "/v1/identity/principals", json({ name: "cart-deployer" }));
    const refused = await send(wire, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", ANCHOR, {
      [HEADER_PRINCIPAL]: "cart-deployer",
    });
    assert.equal(refused.status, 403);
    assert.equal(wire.port.snapshot().objects.length, 0);
  });

  it("answers HEAD with a reading, no body, and no length for a body it did not send", async () => {
    const wire = await bound();
    await send(wire, "PUT", "/v1/storage/buckets/cart-assets", json({ name: "cart-assets" }));
    await send(wire, "PUT", "/v1/storage/buckets/cart-assets/objects/logo.png", ANCHOR);
    const got = await send(wire, "GET", "/v1/storage/buckets/cart-assets/objects/logo.png");
    const response = await fetch(`${wire.url}/v1/storage/buckets/cart-assets/objects/logo.png`, {
      method: "HEAD",
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    // A `content-length` on a HEAD describes the body the GET at that address would send. This route's
    // GET answers a JSON envelope whose body is the object's contents, so a HEAD that reported the
    // length of the *reading* it built (231) instead of the message it stands for (2241) told a real
    // client the wrong size. The honest statement is no length at all for a body that was not sent.
    const length = response.headers.get("content-length");
    assert.ok(
      length === null || length === "0",
      `a HEAD reported content-length ${String(length)}, which is neither the empty body it sent nor ` +
        `the ${String(got.text.length)}-byte GET body it stands for`,
    );
  });

  it("describes the address it really bound, so a client can be pointed at it", async () => {
    const wire = await bound();
    assert.match(wire.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const answer = await send(wire, "GET", "/v1/identity");
    assert.equal(answer.status, 200);
  });

  it("records an in-process request and a wire request in one order", async () => {
    const wire = await bound();
    call(wire.port, "GET", "/v1/version", {}, "world");
    await send(wire, "GET", "/v1/identity");
    assert.deepEqual(
      wire.port.calls().map((record) => record.source),
      ["world", "application"],
      "the record is the run's, whichever transport a request used",
    );
  });
});
