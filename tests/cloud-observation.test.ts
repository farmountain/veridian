import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLOUD_ACTION_NAMES,
  CLOUD_ACTIONS,
  CLOUD_METER_KEYS,
  CLOUD_REF_KINDS,
  CLOUD_SIMULATED_SURFACES,
  bucketNamed,
  cloudCallsOf,
  cloudRefSpelling,
  decisionFor,
  meterValue,
  objectAt,
  principalNamed,
  principalProblem,
  queueNamed,
  renderBucket,
  renderDecision,
  renderObject,
  renderPolicy,
  renderPrincipal,
  renderQueue,
  renderCloudRef,
  renderSecret,
  resolveCloudAccessRef,
  resolveCloudRef,
  secretNamed,
  statementSpelling,
  type CloudObservationData,
  type CloudPolicyStatement,
  type CloudRef,
} from "../core/environment/cloud-observation.ts";

/**
 * The cloud family's reading vocabulary, held directly rather than through one contract.
 *
 * This file exists because the vocabulary is the *contract* and nothing else states it. A `contains` in
 * `acceptance.yaml` is a sentence about a rendering, so the key set of that rendering - and the order
 * the lines arrive in - is what a criterion author writes against, and the demo's own contract has
 * already been wrong about it once: `AC-012` asserted `equals` against two lines of a queue rendering
 * that ten lines long, and no test could see it because every assertion about a rendering lived inside
 * one demo's happy path.
 *
 * Three rules are declared by the module header and held here, because each is a claim about behaviour
 * rather than a comment:
 *
 * - **A rendering is `<key>=<value>` lines sorted by key**, so a `contains` is a stable sentence across
 *   runs. A rendering that reordered itself would make a criterion's answer depend on insertion order.
 * - **A tag and an attribute carry their own prefixes**, so a tag named `owner` and a field named
 *   `owner` cannot be confused for one another.
 * - **`null` renders as `none`**, and that is not the same fact as `false` or as an empty string. The
 *   bucket's `publicAccessBlocked` is the case that matters: `null` is "the bucket was created and
 *   nothing was ever said about public access", `false` is "somebody asked for public access and got
 *   it". Both repair differently, which is why neither may be rendered as the other.
 *
 * What is deliberately **not** here: which status each validator returns for each comparison. That is
 * `validators/cloud/cloud-validators.test.ts`, the layer that decides verdicts. This file is the layer
 * beneath it, and the boundary is the same one `core/environment/db-observation.ts` draws for the
 * database family - which is what keeps a validator from having to import an adapter to be tested.
 */

const denyDelete: CloudPolicyStatement = {
  effect: "deny",
  principal: "svc-cart",
  action: "s3.deleteBucket",
  resource: "bucket/cart-assets",
};

const allowPut: CloudPolicyStatement = {
  effect: "allow",
  principal: "svc-cart",
  action: "s3.putObject",
  resource: "object/cart-assets/*",
};

/** One account, in every state these functions can be asked about. */
function account(over: Partial<CloudObservationData> = {}): CloudObservationData {
  return {
    api: "http://127.0.0.1:34567",
    provider: "sim-cloud",
    region: "sim-region-1",
    account: "cart-account",
    principal: "svc-cart",
    simulated: [...CLOUD_SIMULATED_SURFACES],
    costModel: "requests*1 + objects*5 + ceil(bytes/1024)",

    calls: [
      {
        source: "application",
        action: "s3.putObject",
        method: "PUT",
        path: "/v1/storage/buckets/cart-assets/objects/logo.png",
        principal: "svc-cart",
        resource: "object/cart-assets/logo.png",
        result: "ok",
        status: 200,
        reason: null,
        durationMs: 0,
      },
      {
        source: "criterion",
        action: "s3.putObject",
        method: "PUT",
        path: "/v1/storage/buckets/cart-assets/objects/logo.png",
        principal: "svc-cart",
        resource: "object/cart-assets/logo.png",
        result: "refused",
        status: 403,
        reason: "no statement grants it",
        durationMs: 0,
      },
      {
        source: "application",
        action: "ce.getMetering",
        method: "GET",
        path: "/v1/metering",
        principal: "svc-cart",
        resource: null,
        result: "ok",
        status: 200,
        reason: null,
        durationMs: 0,
      },
    ],

    buckets: [
      {
        name: "cart-assets",
        region: "sim-region-1",
        versioning: "enabled",
        encryption: "AES256",
        publicAccessBlocked: true,
        policy: [denyDelete],
        objects: 1,
        tags: { owner: "cart-team" },
      },
    ],

    objects: [
      {
        bucket: "cart-assets",
        key: "assets/cart-web.js",
        bytes: 26,
        sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
        contentType: "text/javascript",
        encryption: "AES256",
        versionId: "v1",
        versions: 1,
        tags: { cacheControl: "max-age=3600" },
      },
    ],

    queues: [
      {
        name: "cart-events",
        messages: 1,
        inFlight: 0,
        deadLetterQueue: "cart-events-dead",
        encryption: "AES256",
        visibilityTimeoutSeconds: 30,
        attributes: { maxReceiveCount: "5" },
        tags: {},
      },
    ],

    secrets: [
      {
        name: "cart-api-key",
        currentVersion: "v2",
        versions: [
          { version: "v1", bytes: 7, sha256: "aaaa" },
          { version: "v2", bytes: 11, sha256: "bbbb" },
        ],
        rotationEnabled: true,
        encrypted: true,
        matchesKnownPlaceholder: false,
        tags: {},
      },
    ],

    principals: [
      {
        name: "svc-cart",
        attachedPolicies: ["provision"],
        statements: [allowPut, denyDelete],
        tags: {},
      },
    ],

    decisions: [
      {
        principal: "svc-cart",
        action: "s3.getObject",
        resource: "object/cart-assets/logo.png",
        allowed: true,
        entry: "none",
        account: "cart-account",
      },
      {
        principal: "svc-cart",
        action: "s3.deleteBucket",
        resource: "bucket/cart-assets",
        allowed: false,
        entry: statementSpelling(denyDelete),
        account: "cart-account",
      },
    ],

    meters: { requests: 12, objects: 1, bytes: 128, costUnits: 17 },
    ...over,
  };
}

/** The key of each line of a rendering, in the order the lines arrive. */
const keysOf = (rendering: string): readonly string[] =>
  rendering.split("\n").map((line) => line.slice(0, line.indexOf("=")));

/**
 * Every property a rendering has to have for a `contains` written against it to be a stable sentence.
 *
 * Asserted as one helper rather than once per rendering, because a rendering added later and checked
 * by hand is exactly how `AC-012` came to name two lines of a ten-line document.
 */
function assertRendering(rendering: string, expectedKeys: readonly string[]): void {
  const lines = rendering.split("\n");
  assert.equal(lines.length, expectedKeys.length, `expected ${String(expectedKeys.length)} line(s)`);

  for (const line of lines) {
    assert.match(
      line,
      /^[A-Za-z][A-Za-z0-9.]*=.+$|^[A-Za-z][A-Za-z0-9.]*=$/,
      `\`${line}\` is not a \`<key>=<value>\` line, so no \`contains\` can target it`,
    );
  }

  assert.deepEqual(
    [...keysOf(rendering)].sort(),
    [...expectedKeys].sort(),
    "the rendering's key set is the contract a criterion is written against",
  );

  // Sorted, so that the same account observed twice renders identically. A rendering that followed
  // insertion order would make two readings of one unchanged world differ, which is the property every
  // metric comparing two runs of the same code depends on.
  const keys = keysOf(rendering);
  assert.deepEqual(keys, [...keys].sort((left, right) => left.localeCompare(right)));
}

// ---- a rendering is the contract a `contains` is written against ---------------------------------

describe("a rendering is the contract a `contains` is written against", () => {
  it("renders a bucket's own fields under their own names, with its tags prefixed", () => {
    const bucket = bucketNamed(account(), "cart-assets");
    assert.ok(bucket !== null, "the fixture must hold the bucket, or this proves nothing");

    assertRendering(renderBucket(bucket), [
      "encryption",
      "name",
      "objects",
      "publicAccessBlocked",
      "region",
      "tag.owner",
      "versioning",
    ]);
    assert.equal(
      renderBucket(bucket),
      [
        "encryption=AES256",
        "name=cart-assets",
        "objects=1",
        "publicAccessBlocked=true",
        "region=sim-region-1",
        "tag.owner=cart-team",
        "versioning=enabled",
      ].join("\n"),
    );
  });

  it("renders an object's own fields, and its tag under `tag.` rather than as a field", () => {
    const object = objectAt(account(), "cart-assets", "assets/cart-web.js");
    assert.ok(object !== null);

    assertRendering(renderObject(object), [
      "bucket",
      "bytes",
      "contentType",
      "encryption",
      "key",
      "sha256",
      "tag.cacheControl",
      "versionId",
      "versions",
    ]);
  });

  it("renders a queue's attributes under `attribute.`, which is why `cloud.setting` needs no name", () => {
    const queue = queueNamed(account(), "cart-events");
    assert.ok(queue !== null);

    assertRendering(renderQueue(queue), [
      "attribute.maxReceiveCount",
      "deadLetterQueue",
      "encryption",
      "inFlight",
      "messages",
      "name",
      "visibilityTimeoutSeconds",
    ]);
    // The fact `AC-012` was written against and got wrong: the whole document, so an `equals` here
    // would be asserting the exact spelling of a rendering the criterion does not own.
    assert.equal(
      renderQueue(queue).split("\n").length,
      7,
      "a criterion with `equals` is asserting every one of these keys, so the count is not decoration",
    );
  });

  it("renders a secret's newest version's size and digest, not its first", () => {
    const secret = secretNamed(account(), "cart-api-key");
    assert.ok(secret !== null);

    assertRendering(renderSecret(secret), [
      "bytes",
      "currentVersion",
      "encrypted",
      "matchesKnownPlaceholder",
      "name",
      "rotationEnabled",
      "sha256",
      "versions",
    ]);
    // Three facts about the versions, and they are three different questions: how many there are, which
    // one is current, and what the current one weighs. A rendering that reported the *first* version's
    // digest would pass a criterion asking whether the application rotated the secret.
    assert.match(renderSecret(secret), /^bytes=11$/m);
    assert.match(renderSecret(secret), /^sha256=bbbb$/m);
    assert.match(renderSecret(secret), /^versions=2$/m);
    assert.match(renderSecret(secret), /^currentVersion=v2$/m);
  });

  it("renders a secret with no value at all as an empty digest rather than as absent", () => {
    // The state the world records when a secret was created and no value was ever written. It is a
    // real state, and a rendering that omitted the line would make "nothing was written" and "the
    // field does not exist" indistinguishable to a `contains`.
    const empty = renderSecret({
      name: "cart-api-key",
      currentVersion: "",
      versions: [],
      rotationEnabled: false,
      encrypted: false,
      matchesKnownPlaceholder: false,
      tags: {},
    });

    assert.match(empty, /^bytes=0$/m);
    assert.match(empty, /^sha256=$/m);
    assert.match(empty, /^currentVersion=$/m);
  });

  it("renders a principal's statements under `statement.<index>`, in attachment order", () => {
    const principal = principalNamed(account(), "svc-cart");
    assert.ok(principal !== null);

    assertRendering(renderPrincipal(principal), [
      "attachedPolicies",
      "created",
      "name",
      "statement.0",
      "statement.1",
    ]);
    assert.match(renderPrincipal(principal), /^statement\.0=allow s3\.putObject object\/cart-assets\/\*$/m);
    assert.match(renderPrincipal(principal), /^statement\.1=deny s3\.deleteBucket bucket\/cart-assets$/m);
  });

  it("renders a decision with the entry that decided it, so a criterion can ask why as well as what", () => {
    assertRendering(
      renderDecision({
        principal: "svc-cart",
        action: "s3.deleteBucket",
        resource: "bucket/cart-assets",
        allowed: false,
        entry: statementSpelling(denyDelete),
        account: "cart-account",
      }),
      ["action", "allowed", "entry", "principal", "resource"],
    );
    // `entry` is the statement, or `none` for the world's own default - and the difference is the one
    // `os.acl` draws between an explicit entry and an inherited one. A decision nobody wrote down
    // repairs differently from one somebody wrote down wrongly.
    assert.match(
      renderDecision({
        principal: "svc-cart",
        action: "s3.getObject",
        resource: "object/cart-assets/logo.png",
        allowed: true,
        entry: "none",
        account: "cart-account",
      }),
      /^entry=none$/m,
    );
  });

  it("renders an absent value as `none`, which is not the same fact as `false`", () => {
    // The distinction the module header makes and the one a hardening contract turns on: a bucket that
    // was *asked* to stop blocking public access and did (`false`) has made a decision, and a bucket
    // nobody ever told anything about public access (`null`) has not. `null` rendered as `false` would
    // report a bucket with no decision as one that decided the wrong way, and a criterion could not
    // tell them apart.
    const quiet = bucketNamed(
      account({
        buckets: [
          {
            name: "cart-assets",
            region: "sim-region-1",
            versioning: "never",
            encryption: "none",
            publicAccessBlocked: null,
            policy: [],
            objects: 0,
            tags: {},
          },
        ],
      }),
      "cart-assets",
    );
    assert.ok(quiet !== null);
    assert.match(renderBucket(quiet), /^publicAccessBlocked=none$/m);

    const asked = renderQueue({
      name: "cart-events-dead",
      messages: 0,
      inFlight: 0,
      deadLetterQueue: null,
      encryption: "none",
      visibilityTimeoutSeconds: 30,
      attributes: {},
      tags: {},
    });
    assert.match(asked, /^deadLetterQueue=none$/m);

    // And `false` is still `false`, because a rendering that folded it into `none` would lose the one
    // state the defect under test produces.
    const blocked = bucketNamed(account(), "cart-assets");
    assert.ok(blocked !== null);
    const askedAndGot = renderBucket({ ...blocked, publicAccessBlocked: false });
    assert.match(askedAndGot, /^publicAccessBlocked=false$/m);
    assert.notEqual(askedAndGot, renderBucket({ ...blocked, publicAccessBlocked: null }));
  });
});

// ---- a policy is a document, and it is the one rendering in declaration order --------------------

describe("a policy is a document, in the order it was written", () => {
  it("renders one statement per line, in declaration order rather than sorted", () => {
    // Every other rendering in this family is sorted by key, so a `contains` is a sentence that does not
    // move. A policy is deliberately not: it is a document a reader reads top to bottom, and sorting it
    // would render two different policies identically - a distinction this world's evaluator does not
    // make and a reader of the bundle might reasonably want.
    const rendered = renderPolicy([denyDelete, allowPut]);
    assert.equal(rendered, [statementSpelling(denyDelete), statementSpelling(allowPut)].join("\n"));
    assert.ok(
      rendered.startsWith("deny "),
      "the policy was sorted, so the order it was written in is no longer readable from the bundle",
    );
  });

  it("renders an empty policy as nothing rather than as one blank line", () => {
    // `[""]` and `[]` are two different documents, and a criterion whose `equals` is the empty string
    // has to be able to mean "no statements" rather than "one empty statement".
    assert.equal(renderPolicy([]), "");
    assert.equal(renderPolicy([]).split("\n").length, 1);
    assert.notEqual(renderPolicy([]).split("\n").length, 0);
  });

  it("renders a statement as the three fields that decide the request, and not the principal", () => {
    // The comment on this function said `effect principal action resource` while the body rendered
    // three fields. A comment that describes a rendering the code does not perform is worse than no
    // comment: a contract author writes the `contains` the comment describes, it never matches, and the
    // report says the application's policy is wrong. Pinned here so the two cannot drift again.
    const spelled = statementSpelling({
      effect: "deny",
      principal: "svc-cart",
      action: "s3.deleteBucket",
      resource: "bucket/cart-assets",
    });

    assert.equal(spelled, "deny s3.deleteBucket bucket/cart-assets");
    assert.ok(
      !spelled.includes("svc-cart"),
      "the statement rendering names its principal, and the reading of a principal is already " +
        "headed by that name - a `contains` written from the comment would never match",
    );
    assert.equal(spelled.split(" ").length, 3, "the rendering is `effect action resource`, three fields");
  });
});

// ---- a reference is a target and a rendering at once ---------------------------------------------

describe("a reference is a target and a rendering at once", () => {
  it("round-trips every kind through its own spelling", () => {
    const refs: readonly CloudRef[] = [
      { kind: "bucket", name: "cart-assets" },
      { kind: "object", bucket: "cart-assets", key: "assets/cart-web.js" },
      { kind: "queue", name: "cart-events" },
      { kind: "secret", name: "cart-api-key" },
      { kind: "principal", name: "svc-cart" },
    ];

    for (const ref of refs) {
      const target = cloudRefSpelling(ref);
      const back = resolveCloudRef(target);
      assert.equal(back.kind, "target", `${target} did not resolve: ${target}`);
      if (back.kind !== "target") continue;
      assert.deepEqual(
        back.value,
        ref,
        "a reference written out and read back is a different thing, so a policy statement and the " +
          "criterion asking about it would not be the same string",
      );
    }
  });

  it("takes an object's key as everything after the bucket, because a key is a path", () => {
    const resolved = resolveCloudRef("object/cart-assets/assets/img/logo.png");
    assert.equal(resolved.kind, "target");
    if (resolved.kind !== "target") return;
    assert.deepEqual(resolved.value, {
      kind: "object",
      bucket: "cart-assets",
      key: "assets/img/logo.png",
    });
  });

  it("refuses a key carrying the separator the access reference uses, rather than repairing it", () => {
    // `:` separates the three parts of `principal/<name>:<action>:<resource>`. A key carrying one could
    // not be written in an access reference at all, so it is refused here - where the reason can name
    // the collision - instead of producing a target that resolves to the wrong triple.
    const refused = resolveCloudRef("object/cart-assets/a:b.txt");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /access reference/);
  });

  it("refuses a bucket named with a slash, because only a key is a path", () => {
    const refused = resolveCloudRef("bucket/cart/assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /does not contain "\/"/);
  });

  it("refuses an object reference that names a bucket and no key", () => {
    const refused = resolveCloudRef("object/cart-assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /names a bucket and no key/);
  });

  it("refuses surrounding whitespace, and says so rather than trimming it", () => {
    // A target is a document, and a space in it is a defect in the document. Trimming would make the
    // contract that was written and the contract that was judged two different documents.
    const refused = resolveCloudRef(" bucket/cart-assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /surrounding whitespace/);
  });

  it("refuses a kind this world does not hold, and names the five it does", () => {
    const refused = resolveCloudRef("database/cart-assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    for (const kind of CLOUD_REF_KINDS) {
      assert.ok(refused.reason.includes(kind), `the refusal does not name ${kind}`);
    }
  });

  it("refuses an upper-case name, because a name is a spelling and not a label", () => {
    const refused = resolveCloudRef("bucket/Cart-Assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /lower case/);
  });
});

// ---- an access reference is the triple a decision is about ---------------------------------------

describe("an access reference is the triple a decision is about", () => {
  it("splits into three parts and resolves the resource the same way a policy does", () => {
    const resolved = resolveCloudAccessRef(
      "principal/svc-cart:s3.deleteBucket:bucket/cart-assets",
    );
    assert.equal(resolved.kind, "target");
    if (resolved.kind !== "target") return;
    assert.deepEqual(resolved.value, {
      principal: "svc-cart",
      action: "s3.deleteBucket",
      resource: { kind: "bucket", name: "cart-assets" },
    });
  });

  it("refuses a reference whose first part is not a principal", () => {
    const refused = resolveCloudAccessRef("bucket/cart-assets:s3.getObject:bucket/cart-assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /names a principal/);
  });

  it("refuses an action this world does not serve, and explains why the separator is a dot", () => {
    // The refusal a contract author needs most: a misspelled action would otherwise be reported as an
    // application that never made the request, which is indistinguishable from a real defect.
    const refused = resolveCloudAccessRef("principal/svc-cart:s3.delete:bucket/cart-assets");
    assert.equal(refused.kind, "refused");
    if (refused.kind !== "refused") return;
    assert.match(refused.reason, /is not an action this world serves/);
    assert.ok(
      refused.reason.includes(CLOUD_ACTIONS.deleteBucket),
      "the refusal must name the action that would have been served",
    );
  });

  it("refuses a reference that does not split into exactly three parts, and names the count", () => {
    for (const target of ["principal/svc-cart", "a:b:c:d"]) {
      const refused = resolveCloudAccessRef(target);
      assert.equal(refused.kind, "refused");
      if (refused.kind !== "refused") continue;
      assert.match(refused.reason, /splits into \d+ part/);
      assert.ok(refused.reason.includes(target));
    }
  });
});

// ---- the actions are a closed vocabulary ----------------------------------------------------------

describe("the actions are a closed vocabulary a contract can be judged readable against", () => {
  it("spells every action `<service>.<verb>`, lower case", () => {
    for (const action of CLOUD_ACTION_NAMES) {
      // The service is lower case and may carry a digit (`s3`, `sqs`, `iam`); the verb starts lower case
      // and is camel case, because it is the provider's own verb (`putBucketVersioning`). This is the
      // *action* vocabulary and not the validator-name rule - a validator name is
      // `^[a-z0-9]+(\.[a-z0-9]+)+$` and could not express a verb at all.
      assert.match(
        action,
        /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
        `${action} is not a \`<service>.<verb>\` name, and a criterion naming it would be reported ` +
          "as an application that never made the request",
      );
    }
  });

  it("carries no colon in any action, which is what makes an access reference writable", () => {
    for (const action of CLOUD_ACTION_NAMES) {
      assert.ok(
        !action.includes(":"),
        `${action} carries a colon, and an access reference is separated on one - so a criterion ` +
          "about this action could not be written down at all",
      );
    }
  });

  it("names each action once, and exposes the same list under both spellings", () => {
    const names = Object.values(CLOUD_ACTIONS);
    assert.equal(new Set(names).size, names.length, "two routes stand for one action name");
    assert.deepEqual(
      [...CLOUD_ACTION_NAMES],
      [...names],
      "the register and the list a validator quotes have drifted apart",
    );
    assert.ok(CLOUD_ACTION_NAMES.length > 0);
  });

  it("names every surface it substitutes, and none that is real", () => {
    // The obligation a simulated world has to meet. The list is only informative because it is partial:
    // a list that named everything would say nothing, so the three things that *are* real - the HTTP
    // transport, the application process and the digest of a stored byte - must not be on it.
    const surfaces = [...CLOUD_SIMULATED_SURFACES];
    assert.equal(new Set(surfaces).size, surfaces.length, "a surface is named twice");
    assert.ok(surfaces.includes("object-store"), "the object store is the surface most of this world is");

    for (const real of ["http", "transport", "process", "digest", "sha256"]) {
      assert.ok(
        !(surfaces as readonly string[]).includes(real),
        `${real} is real and is on the list of substituted surfaces, so a reader cannot tell which ` +
          "parts of the account were stood in for",
      );
    }
  });
});

// ---- the questions a criterion asks of a reading --------------------------------------------------

describe("the questions a criterion asks of a reading", () => {
  it("finds every call by action, including the ones the world refused", () => {
    // Two, not one: the application's write and the criterion's own attempt to write outside its
    // policy. A criterion asking whether the *application* made a request has to be able to tell them
    // apart by `source`, which is why the record carries it - and the count is what a contract about
    // "the application asked once" is written against.
    const calls = cloudCallsOf(account(), CLOUD_ACTIONS.putObject);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.source),
      ["application", "criterion"],
    );
    assert.deepEqual(
      cloudCallsOf(account(), "s3.teleport").length,
      0,
      "an action nothing served must come back empty rather than as the whole record",
    );
  });

  it("answers with the newest decision for a triple that was asked twice", () => {
    const twice = account({
      decisions: [
        {
          principal: "svc-cart",
          action: "s3.deleteBucket",
          resource: "bucket/cart-assets",
          allowed: true,
          entry: "none",
          account: "cart-account",
        },
        {
          principal: "svc-cart",
          action: "s3.deleteBucket",
          resource: "bucket/cart-assets",
          allowed: false,
          entry: statementSpelling(denyDelete),
          account: "cart-account",
        },
      ],
    });

    // The last answer is the account's state: a policy attached between the two questions changed it,
    // and a reading that took the first would report the world as it was before the application acted.
    assert.equal(decisionFor(twice, "svc-cart", "s3.deleteBucket", "bucket/cart-assets")?.allowed, false);
    assert.equal(decisionFor(twice, "svc-cart", "s3.getObject", "bucket/cart-assets"), null);
  });

  it("answers a meter key this world does not keep with `null`, never with zero", () => {
    // The dangerous shape, and the header says why: `0` is a number a criterion can compare against, so
    // a misspelled key would be reported as an application that provisioned nothing - a real defect's
    // shape rather than a contract that cannot be read.
    assert.equal(meterValue(account(), "spend"), null);
    assert.equal(meterValue(account(), "requests"), 12);
    for (const key of CLOUD_METER_KEYS) {
      assert.equal(typeof meterValue(account(), key), "number", `${key} is not readable`);
    }
  });

  it("answers a rendering of a resource the world does not hold with `null`", () => {
    // An account that holds no receipts bucket is a fact a criterion may assert, so the reading has to
    // distinguish "the world holds nothing under that name" from "here is an empty document".
    assert.equal(renderCloudRef(account(), { kind: "bucket", name: "cart-receipts" }), null);
    assert.equal(renderCloudRef(account(), { kind: "object", bucket: "cart-assets", key: "gone.js" }), null);
    assert.equal(renderCloudRef(account(), { kind: "queue", name: "nope" }), null);
    assert.equal(renderCloudRef(account(), { kind: "secret", name: "nope" }), null);
    assert.equal(renderCloudRef(account(), { kind: "principal", name: "nope" }), null);
    assert.ok(renderCloudRef(account(), { kind: "bucket", name: "cart-assets" }) !== null);
  });

  it("refuses to judge a hardening contract as an account root", () => {
    // `principalProblem` is read by the loader, and the reason is a false pass rather than a
    // preference: every policy in an account yields to its root, so a contract about least privilege
    // judged as one reports a pass for permissions no workload gets. An ordinary service account is the
    // only subject such a contract can be decided against.
    for (const privileged of ["root", "account-root", "owner", "administrator", "admin"]) {
      const problem = principalProblem(privileged);
      assert.ok(problem !== null, `${privileged} must be refused as a subject`);
      assert.match(problem ?? "", /account root/);
    }
    assert.equal(principalProblem("svc-cart"), null);
    assert.equal(principalProblem("svc-audit"), null);

    // And this account is not judged as one, which is the half that would make the demo's own criteria
    // vacuous if it were missing.
    assert.equal(principalProblem(account().principal), null);
  });
});
