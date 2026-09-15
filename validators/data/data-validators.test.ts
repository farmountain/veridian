/**
 * The broker family, judged.
 *
 * A validator in this family never opens a socket and never reaches the substitute: it reads a
 * `DataObservationData` and answers a question about it. So the only way to reach the branches that
 * matter - a document that arrived unreadable, a target the grammar refuses, a resource the world
 * does not hold, a request that came through the other door - is to hand one in, written by hand,
 * exactly as the database family's suite does.
 *
 * Three properties are what this suite is for:
 *
 * 1. **Zero false `PASS` (M3).** An unreadable document, an unmet step, a target this grammar cannot
 *    express and a meter this world does not keep are each `ERROR` or `INCONCLUSIVE` and never a
 *    `PASS`. That is asserted against *every* name in the family rather than against a sample,
 *    because a family-wide guarantee held by four examples is not held.
 * 2. **A defect is a `FAIL`, with a sentence a reader can act on.** Each block below therefore
 *    asserts the status *and* the wording, and the wording is where the difference between two
 *    repairs lives: an absent topic and a topic of the wrong shape send a reader to two different
 *    places.
 * 3. **The two doors stay two questions.** `data.call` reads the application's traffic and
 *    `data.probe` reads the criterion's own command, and each refuses the other's records by name.
 *    A criterion that could satisfy its own question is the false `PASS` this product exists to make
 *    impossible, so the refusal is asserted rather than assumed.
 *
 * Every string asserted here is read out of the family and the reading vocabulary rather than
 * recalled: a test that asserts a message's shape is asserting a property of the code's wording, and
 * the only honest source for that is the code.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DATA_METER_KEYS,
  DATA_OBSERVATION_KIND,
  DATA_SIMULATED_SURFACES,
  renderGroup,
  renderNode,
} from "../../core/environment/data-observation.ts";
import type {
  DataCommittedOffsetReading,
  DataGroupMemberReading,
  DataGroupReading,
  DataHeaderReading,
  DataObservationData,
  DataPartitionReading,
  DataRecordReading,
  DataRequestRecord,
  DataTopicReading,
} from "../../core/environment/data-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";
import type { AssertionResult } from "../../core/validation/types.ts";
import { DATA_VALIDATORS, DATA_VALIDATOR_NAMES, dataValidators } from "./data-validators.ts";

const registry = new ValidatorRegistry(dataValidators());

// ---- the world these questions are asked of, written by hand --------------------------------------

const header = (name: string, value: string | null): DataHeaderReading => ({ name, value });

/** A record, with the hex spelling derived from the text exactly as the adapter derives it. */
const recordAt = (
  offset: number,
  key: string | null,
  value: string | null,
  headers: readonly DataHeaderReading[] = [],
): DataRecordReading => ({
  offset,
  timestamp: 1_700_000_000_000 + offset,
  key,
  value,
  keyHex: key === null ? null : Buffer.from(key, "utf8").toString("hex"),
  valueHex: value === null ? null : Buffer.from(value, "utf8").toString("hex"),
  headers,
});

const first = recordAt(0, "cart-1", '{"sku":"A-1","qty":2}');
const second = recordAt(1, "cart-2", '{"sku":"B-7","qty":1}', [header("content-type", "application/json")]);
const tombstone = recordAt(2, "cart-3", null);
const emptyPayload = recordAt(3, "cart-4", "");

const cartPartition: DataPartitionReading = {
  index: 0,
  leaderId: 1,
  replicas: [1, 2, 3],
  isr: [1],
  lowWatermark: 0,
  highWatermark: 2,
  records: [first, second],
};

const emptyPartition: DataPartitionReading = {
  index: 0,
  leaderId: 1,
  replicas: [1],
  isr: [1],
  lowWatermark: 0,
  highWatermark: 0,
  records: [],
};

/** The second partition of the interesting topic, so an absent offset has a range to be absent from. */
const sparePartition: DataPartitionReading = {
  index: 1,
  leaderId: 1,
  replicas: [1, 2, 3],
  isr: [1],
  lowWatermark: 0,
  highWatermark: 0,
  records: [],
};

const events: DataTopicReading = {
  name: "cart-events",
  partitions: [cartPartition, sparePartition],
  replicationFactor: 3,
  configs: [header("cleanup.policy", "delete"), header("min.insync.replicas", "2")],
};

/** A topic with no `cleanup.policy`, so the rendering's documented fallback is what a criterion sees. */
const audit: DataTopicReading = {
  name: "cart-audit",
  partitions: [emptyPartition],
  replicationFactor: 1,
  configs: [],
};

const membership: DataGroupMemberReading = {
  memberId: "cart-indexer-1",
  clientId: "cart-web",
  protocol: "range",
  assignmentBytes: 24,
};

const commitment: DataCommittedOffsetReading = {
  topic: "cart-events",
  partition: 0,
  offset: 2,
  metadata: null,
};

const indexer: DataGroupReading = {
  groupId: "cart-indexer",
  generationId: 4,
  protocolType: "consumer",
  state: "stable",
  members: [membership],
  committed: [commitment],
};

/** A request that arrived on the socket and was answered. */
const produce: DataRequestRecord = {
  api: "Produce(0) v0, v2",
  apiKey: 0,
  apiVersion: 2,
  correlationId: 7,
  clientId: "cart-web",
  source: "application",
  result: "ok",
  errorCode: 0,
  reason: null,
  bytesIn: 128,
  bytesOut: 64,
};

/** A request the criterion made through a `run` step. It crossed no socket, so there are no bytes in. */
const metadata: DataRequestRecord = {
  api: "Metadata(3) v0",
  apiKey: 3,
  apiVersion: 0,
  correlationId: null,
  clientId: null,
  source: "criterion",
  result: "ok",
  errorCode: 0,
  reason: null,
  bytesIn: 0,
  bytesOut: 96,
};

/** A request the broker refused, which is the shape a criterion about a refusal is judged on. */
const refusedTopics: DataRequestRecord = {
  api: "CreateTopics(19) v0",
  apiKey: 19,
  apiVersion: 0,
  correlationId: 9,
  clientId: "cart-web",
  source: "application",
  result: "refused",
  errorCode: 36,
  reason: "topic 'cart-events' already exists",
  bytesIn: 64,
  bytesOut: 32,
};

/**
 * A command the world could not read at all, as the port records one.
 *
 * `apiKey` and `apiVersion` are `-1` because no version was ever agreed, and the `api` field carries
 * the whole spelling - which is why a criterion must name that spelling and not the bare word.
 */
const refusedCommand: DataRequestRecord = {
  api: "refused command 'fetch'",
  apiKey: -1,
  apiVersion: -1,
  correlationId: null,
  clientId: null,
  source: "criterion",
  result: "invalid-request",
  errorCode: 0,
  reason: "fetch needs a topic and a partition",
  bytesIn: 0,
  bytesOut: 0,
};

const meter = { requests: 3, bytesIn: 288, bytesOut: 192, recordsProduced: 2, recordsFetched: 2 };

const document = (overrides: Partial<DataObservationData> = {}): DataObservationData => ({
  cluster: "cart-cluster",
  node: { id: 1, host: "127.0.0.1", port: 46321 },
  simulated: DATA_SIMULATED_SURFACES,
  topics: [events, audit],
  groups: [indexer],
  requests: [produce, metadata, refusedTopics],
  meter,
  ...overrides,
});

/** The document the family is expected to answer with, as the validator itself composes it. */
const identity = "cart-cluster (node 1 at 127.0.0.1:46321)";

const observed = (data: unknown, kind: string = DATA_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-data:examples/sim-data",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.json", kind: "json" }],
  error: null,
});

const expectation = (validator: string, fields: Readonly<Record<string, unknown>> = {}) => ({
  validator,
  ...fields,
});

const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const expect = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: string,
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

// ---- 1. the family describes itself honestly -------------------------------------------------------

describe("the broker family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the thirteen it has", () => {
    assert.deepEqual(
      registry.names(),
      DATA_VALIDATORS.map((validator) => validator.name).sort(),
    );
    /*
     * Spelled out as well as derived, because the derived half cannot see a name that was never
     * declared. A register whose members the register itself reports is a list that agrees with
     * itself; this half is the claim about which names exist.
     */
    assert.deepEqual(registry.names(), [
      "data.call",
      "data.commit",
      "data.group",
      "data.key",
      "data.layout",
      "data.member",
      "data.meter",
      "data.node",
      "data.partition",
      "data.probe",
      "data.record",
      "data.topic",
      "data.value",
    ]);
  });

  it("names each validator in a shape the acceptance schema accepts", () => {
    for (const validator of DATA_VALIDATORS) {
      /*
       * The schema's own pattern. A name with an upper-case letter is not a lint warning: it is an
       * acceptance contract that cannot be written at all, which is a defect this repository has
       * already paid for once.
       */
      assert.match(validator.name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, validator.name);
      assert.equal(validator.name.startsWith("data."), true, validator.name);
    }
    assert.equal(DATA_VALIDATOR_NAMES.node, "data.node");
    assert.equal(DATA_VALIDATOR_NAMES.member, "data.member");
    assert.equal(DATA_VALIDATOR_NAMES.meter, "data.meter");
  });

  it("reads the broker observation kind, and never another family's", () => {
    for (const validator of DATA_VALIDATORS) {
      assert.equal(validator.observationKind, DATA_OBSERVATION_KIND, validator.name);
      assert.notEqual(validator.observationKind, "web.page", validator.name);
      assert.notEqual(validator.observationKind, "db.database", validator.name);
    }
  });

  it("declares exactly the comparisons it can answer", () => {
    const declared: Record<string, readonly string[]> = {
      [DATA_VALIDATOR_NAMES.node]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.topic]: ["equals"],
      [DATA_VALIDATOR_NAMES.layout]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.partition]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.record]: ["equals"],
      [DATA_VALIDATOR_NAMES.key]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.value]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.group]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.member]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.commit]: ["equals", "contains", "matches"],
      [DATA_VALIDATOR_NAMES.call]: ["equals"],
      [DATA_VALIDATOR_NAMES.probe]: ["equals"],
      [DATA_VALIDATOR_NAMES.meter]: ["equals", "atLeast", "atMost"],
    };
    for (const validator of DATA_VALIDATORS) {
      assert.deepEqual([...validator.comparisons], declared[validator.name], validator.name);
    }
    assert.deepEqual([...registry.require(DATA_VALIDATOR_NAMES.meter).comparisons], [
      "equals",
      "atLeast",
      "atMost",
    ]);
  });

  it("declares no comparison key the acceptance vocabulary does not have", () => {
    for (const validator of DATA_VALIDATORS) {
      for (const comparison of validator.comparisons) {
        assert.ok(
          ["equals", "contains", "matches", "atLeast", "atMost"].includes(comparison),
          `${validator.name} declares ${comparison}, which is not a comparison key`,
        );
      }
    }
  });

  it("says which noun its target names, so the ladder asks a question with an answer", () => {
    const nouns: Record<string, string | undefined> = {
      [DATA_VALIDATOR_NAMES.node]: undefined,
      [DATA_VALIDATOR_NAMES.topic]: "topic name (`cart-events`)",
      [DATA_VALIDATOR_NAMES.layout]: "topic name (`cart-events`)",
      [DATA_VALIDATOR_NAMES.partition]: "partition reference (`cart-events/0`)",
      [DATA_VALIDATOR_NAMES.record]: "record reference (`cart-events/0/2`)",
      [DATA_VALIDATOR_NAMES.key]: "record reference (`cart-events/0/2`)",
      [DATA_VALIDATOR_NAMES.value]: "record reference (`cart-events/0/2`)",
      [DATA_VALIDATOR_NAMES.group]: "consumer group id (`cart-indexer`)",
      [DATA_VALIDATOR_NAMES.member]: "member reference (`cart-indexer/cart-indexer-1`)",
      [DATA_VALIDATOR_NAMES.commit]: "committed-offset reference (`cart-indexer/cart-events/0`)",
      [DATA_VALIDATOR_NAMES.call]: "API name as the register spells it (`Produce`, `CreateTopics`)",
      [DATA_VALIDATOR_NAMES.probe]:
        "API name as the register spells it, or the command word the world refused",
      [DATA_VALIDATOR_NAMES.meter]: `meter name (${DATA_METER_KEYS.map((name) => `\`${name}\``).join(", ")})`,
    };
    for (const validator of DATA_VALIDATORS) {
      assert.equal(validator.targetNoun, nouns[validator.name], validator.name);
      assert.notEqual(validator.targetNoun, "element", validator.name);
    }
    assert.deepEqual(
      registry.descriptors().map((descriptor) => descriptor.name),
      registry.names(),
    );
    for (const descriptor of registry.descriptors()) {
      if (descriptor.name === DATA_VALIDATOR_NAMES.node) {
        /*
         * The targetless validator carries no `targetNoun` key at all, and the registry says why at
         * the spread that builds it: an explicit `undefined` would make every descriptor a different
         * object shape than the ones fixtures compare with `deepEqual`. Asserting the key is
         * *absent* is therefore the honest statement of what the registry does.
         */
        assert.equal("targetNoun" in descriptor, false, descriptor.name);
        continue;
      }
      assert.equal(typeof descriptor.targetNoun, "string", descriptor.name);
    }
  });

  it("only asks for a target where a target is the question", () => {
    for (const validator of DATA_VALIDATORS) {
      const targetless = validator.name === DATA_VALIDATOR_NAMES.node;
      assert.equal(validator.needsTarget, !targetless, validator.name);
    }
  });

  it("hands out a fresh array so a registry cannot reorder the family", () => {
    const fresh = dataValidators();
    assert.notEqual(fresh, DATA_VALIDATORS);
    assert.notEqual(dataValidators(), fresh);
    assert.deepEqual(
      fresh.map((validator) => validator.name),
      DATA_VALIDATORS.map((validator) => validator.name),
    );
    assert.ok(Object.isFrozen(DATA_VALIDATORS));
  });
});

// ---- 2. an unreadable observation is never a judgement ----------------------------------------------

/** The document with one field removed, so exactly one thing is wrong with it. */
const without = (field: keyof DataObservationData): unknown => {
  const copy: Partial<DataObservationData> = { ...document() };
  Reflect.deleteProperty(copy, field);
  return copy;
};

/** The document with one field replaced by something that is not what the reading declares. */
const broken = (patch: Readonly<Record<string, unknown>>): unknown => ({ ...document(), ...patch });

describe("an unreadable observation is never a judgement", () => {
  const unreadable: readonly (readonly [string, unknown])[] = [
    ["a null document", null],
    ["a number where a document belongs", 42],
    ["a bare kind name", DATA_OBSERVATION_KIND],
    ["an array", []],
    ["a document with no cluster", without("cluster")],
    ["a cluster that is not text", broken({ cluster: 7 })],
    ["a node with no port", broken({ node: { id: 1, host: "127.0.0.1" } })],
    ["a node that is null", broken({ node: null })],
    ["no simulated-surface list", without("simulated")],
    ["a simulated list holding a number", broken({ simulated: ["broker", 7] })],
    ["no topic list", without("topics")],
    ["a topic whose partition list is a string", broken({ topics: [{ ...events, partitions: "none" }] })],
    [
      "a topic config with no value",
      broken({ topics: [{ ...events, configs: [{ name: "cleanup.policy" }] }] }),
    ],
    [
      "a partition whose record list is null",
      broken({ topics: [{ ...events, partitions: [{ ...cartPartition, records: null }] }] }),
    ],
    [
      "a record whose header list holds a number",
      broken({
        topics: [{ ...events, partitions: [{ ...cartPartition, records: [{ ...first, headers: [1] }] }] }],
      }),
    ],
    ["a group whose member list is a string", broken({ groups: [{ ...indexer, members: "one" }] })],
    [
      "a group member with no protocol",
      broken({
        groups: [
          { ...indexer, members: [{ memberId: "cart-indexer-1", clientId: null, assignmentBytes: 0 }] },
        ],
      }),
    ],
    ["a request list that is null", broken({ requests: null })],
    ["a request from an unknown door", broken({ requests: [{ ...produce, source: "somebody" }] })],
    ["a request with no result", broken({ requests: [{ ...produce, result: undefined }] })],
    ["a meter that is null", broken({ meter: null })],
    [
      "a meter missing one counter",
      broken({ meter: { requests: 1, bytesIn: 1, bytesOut: 1, recordsProduced: 1 } }),
    ],
  ];

  for (const [label, data] of unreadable) {
    it(`reports every validator unusable for ${label}`, () => {
      for (const name of registry.names()) {
        const raw = expectation(name, { target: "cart-events", equals: "whatever" });
        const result = judge(raw, observed(data));
        assert.equal(result.status, "ERROR", `${name} on ${label}`);
        assert.equal(result.failureKind, "ENVIRONMENT_FAILURE", `${name} on ${label}`);
        assert.match(String(result.message), /does not carry a broker document/, name);
      }
    });
  }

  it("reads a well-formed document without complaint, so the checks above are not vacuous", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", equals: true }),
      observed(document()),
      "PASS",
    );
    assert.equal(result.failureKind, null);
    assert.equal(result.message, null);
  });

  it("judges a broker document whatever kind name the observation carries", () => {
    /*
     * The guard is structural rather than a test of the `kind` string, and that is on purpose: the
     * reading's shape is the thing that decides whether there is something to judge. A guard that
     * trusted the kind name would report a well-formed document unreadable because a world spelled
     * its kind differently, which is the environment claiming it did not do what it did.
     */
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", equals: true }),
      observed(document(), "web.page"),
      "PASS",
    );
  });

  it("does not mistake another family's reading for its own", () => {
    const webShaped = { url: "http://127.0.0.1:4173/", title: "Cart", console: [], network: [] };
    for (const name of registry.names()) {
      const raw = expectation(name, { target: "cart-events", equals: "whatever" });
      const result = judge(raw, observed(webShaped, "web.page"));
      assert.equal(result.status, "ERROR", name);
      assert.equal(result.failureKind, "ENVIRONMENT_FAILURE", name);
    }
  });
});

// ---- 3. `data.node` --------------------------------------------------------------------------------

describe("data.node asks whether the run reached the broker it meant to", () => {
  it("passes against the endpoint the world declared", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { equals: identity }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a different cluster, naming the whole identity a reader needs", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.node, { equals: `other-cluster (node 1 at 127.0.0.1:46321)` }),
      observed(document()),
      "FAIL",
    );
    assert.equal(result.actual, identity);
    assert.match(String(result.message), /Expected the broker the run reached/);
  });

  it("compares the endpoint rather than a description of the world", () => {
    const before = document();
    const after = document({ topics: [], groups: [] });
    const expected = expectation(DATA_VALIDATOR_NAMES.node, { equals: identity });
    expect(expected, observed(before), "PASS");
    expect(expected, observed(after), "PASS");
    /*
     * The positive control: the two documents must describe different worlds, or the two passes
     * above would say nothing about what this validator compares.
     */
    assert.notEqual(renderNode(before), renderNode(after));
    /*
     * And the reason it is written this way. `renderNode` prints how many topics the world holds, so
     * a criterion comparing it would move whenever the application created one - and an assertion
     * that moves when the application does something correct is a flake wearing an assertion's
     * clothes.
     */
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { equals: renderNode(before) }),
      observed(before),
      "FAIL",
    );
  });

  it("accepts a fragment, so a criterion need not pin the port the operating system chose", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { contains: "node 1 at 127.0.0.1" }),
      observed(document()),
      "PASS",
    );
  });

  it("accepts a regular expression against the identity", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { matches: "^cart-cluster \\(node 1" }),
      observed(document()),
      "PASS",
    );
  });

  it("ignores a target, because the question is about the world and not about anything in it", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { target: "cart-events", equals: identity }),
      observed(document()),
      "PASS",
    );
  });

  it("errors when a comparison cannot be turned into a question", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { equals: 3 }),
      observed(document()),
      "ERROR",
      /"equals" compares text with a string/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.node, { matches: "[unclosed" }),
      observed(document()),
      "ERROR",
      /does not compile/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.node),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 4. `data.topic` -------------------------------------------------------------------------------

describe("data.topic answers whether the world holds a topic, and can answer no", () => {
  it("passes for a topic the application created", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", equals: true }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", equals: "present" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails for a topic that is not there, in words rather than as a bare false", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-order", equals: true }),
      observed(document()),
      "FAIL",
    );
    assert.match(
      String(result.message),
      /Expected whether the world holds a topic named `cart-order` to be present, but it is false\./,
    );
    assert.equal(result.actual, false);
  });

  it("passes when the criterion expects the topic to be absent", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-order", equals: "absent" }),
      observed(document()),
      "PASS",
    );
  });

  it("passes for a topic that holds no partitions, because empty is not absent", () => {
    const bare = document({ topics: [{ name: "cart-audit", partitions: [], replicationFactor: 1, configs: [] }] });
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-audit", equals: true }),
      observed(bare),
      "PASS",
    );
  });

  it("refuses a name as a comparison, because existence is a boolean question", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", equals: "cart-events" }),
      observed(document()),
      "ERROR",
      /wants true, false, "present" or "absent"/,
    );
  });

  it("refuses a comparison it does not declare, rather than quietly ignoring it", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events", contains: "cart" }),
      observed(document()),
      "ERROR",
      /is not declared by this validator; it compares with equals/,
    );
  });

  it("errors when the target spells a different noun", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events/0", equals: true }),
      observed(document()),
      "ERROR",
      /is not a topic name/,
    );
  });

  it("errors when the target is an empty string, because a spelling nothing can name is not a name", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "", equals: true }),
      observed(document()),
      "ERROR",
      /an empty segment refuses the whole spelling/,
    );
  });

  it("errors rather than guessing when the criterion names no topic", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { equals: true }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
  });

  it("errors when the expectation states no comparison at all", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.topic, { target: "cart-events" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 5. `data.layout` ------------------------------------------------------------------------------

describe("data.layout compares the shape the world recorded, limits and all", () => {
  it("passes against the rendering the reading vocabulary produces", () => {
    const shape = "topic 'cart-events' (2 partition(s), replication 3 recorded, isr [1], cleanup delete)";
    expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events", equals: shape }),
      observed(document()),
      "PASS",
    );
  });

  it("passes on a fragment, so a criterion may pin the factor alone", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events", contains: "replication 3 recorded" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a factor nothing could honour, because the declared factor and the in-sync set are one sentence", () => {
    /*
     * This is the honest statement of a limit, asserted rather than described: the factor is what the
     * topic *recorded* and `isr` is what actually stands behind it. A criterion that could compare
     * the factor alone could read a `PASS` on `replication 3` as three copies.
     */
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events", contains: "isr [3]" }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /isr \[1\], cleanup delete\)/);
  });

  it("prints the fallback cleanup policy for a topic that records none", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.layout, {
        target: "cart-audit",
        equals: "topic 'cart-audit' (1 partition(s), replication 1 recorded, isr [1], cleanup delete)",
      }),
      observed(document()),
      "PASS",
    );
    assert.equal(result.status, "PASS");
  });

  it("accepts a regular expression over the rendering", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events", matches: "^topic 'cart-events'" }),
      observed(document()),
      "PASS",
    );
  });

  it("reports an absent topic as inconclusive, naming the topics the world does hold", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-order", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no topic named `cart-order`/,
    );
    assert.match(String(result.message), /it holds `cart-events`, `cart-audit`/);
  });

  it("errors when the target is a reference rather than a name", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events/0", contains: "anything" }),
      observed(document()),
      "ERROR",
      /is not a topic name/,
    );
  });

  it("errors when the expectation states a comparison over a number", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.layout, { target: "cart-events", equals: 3 }),
      observed(document()),
      "ERROR",
      /"equals" compares text with a string/,
    );
  });
});

// ---- 6. `data.partition` ---------------------------------------------------------------------------

describe("data.partition reads the log a partition holds", () => {
  it("passes against the range, the watermark and the in-sync set", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, {
        target: "cart-events/0",
        equals: "partition 0: 2 record(s), offsets 0..1, hw 2, isr [1]",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("reads an empty partition as empty rather than as a range", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, {
        target: "cart-events/1",
        equals: "partition 1: 0 record(s), empty, hw 0, isr [1]",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a watermark that moved, because the watermark is one of the facts printed", () => {
    const moved = document({
      topics: [{ ...events, partitions: [{ ...cartPartition, highWatermark: 5 }, sparePartition] }],
    });
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, {
        target: "cart-events/0",
        contains: "hw 2",
      }),
      observed(moved),
      "FAIL",
    );
  });

  it("fails on a range that does not match, naming the range it found", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.partition, {
        target: "cart-events/0",
        equals: "partition 0: 1 record(s), offsets 0..0, hw 1, isr [1]",
      }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /offsets 0\.\.1, hw 2/);
    assert.equal(result.actual, "partition 0: 2 record(s), offsets 0..1, hw 2, isr [1]");
  });

  it("reports a partition the topic does not have as inconclusive, listing the ones it has", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.partition, { target: "cart-events/9", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no partition named `cart-events\/9`/,
    );
    assert.match(String(result.message), /topic `cart-events` holds `cart-events\/0`, `cart-events\/1`/);
  });

  it("reports a partition of an absent topic as inconclusive, naming the missing topic", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, { target: "cart-order/0", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /it holds no topic named `cart-order`/,
    );
  });

  it("errors on every spelling of the two-segment grammar that cannot name a partition", () => {
    const spellings = ["cart-events", "cart-events/x", "cart-events/1.5", "cart-events/-1", "cart-events//0"];
    for (const target of spellings) {
      expect(
        expectation(DATA_VALIDATOR_NAMES.partition, { target, equals: "anything" }),
        observed(document()),
        "ERROR",
        /is not a partition reference/,
      );
    }
  });

  it("errors when the criterion names no target and when it states no comparison", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, { equals: "anything" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.partition, { target: "cart-events/0" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 7. `data.record` ------------------------------------------------------------------------------

describe("data.record answers whether a record is at an offset, and can answer no", () => {
  it("passes for a record the broker holds", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.record, { target: "cart-events/0/1", equals: "present" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails for an offset the partition does not hold, and can be asked to expect absence", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.record, { target: "cart-events/0/9", equals: true }),
      observed(document()),
      "FAIL",
    );
    assert.match(
      String(result.message),
      /Expected whether the world holds a record at `cart-events\/0\/9` to be present, but it is false\./,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.record, { target: "cart-events/0/9", equals: false }),
      observed(document()),
      "PASS",
    );
  });

  it("errors when the target spells a partition rather than a record", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.record, { target: "cart-events/0", equals: true }),
      observed(document()),
      "ERROR",
      /is not a record reference/,
    );
  });

  it("refuses a count comparison, because presence is a boolean question", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.record, { target: "cart-events/0/1", atLeast: 1 }),
      observed(document()),
      "ERROR",
      /is not declared by this validator; it compares with equals/,
    );
  });
});

// ---- 8. `data.key` and `data.value` -----------------------------------------------------------------

describe("data.key and data.value read one record's payload as text", () => {
  it("passes for the key the application produced", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.key, { target: "cart-events/0/0", equals: "cart-1" }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.key, { target: "cart-events/0/1", matches: "^cart-[0-9]$" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a different key, quoting the whole record so the wrong one is visible", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.key, { target: "cart-events/0/1", equals: "cart-9" }),
      observed(document()),
      "FAIL",
    );
    const message = String(result.message);
    assert.ok(message.includes("the key of the record at `cart-events/0/1`"), message);
    assert.ok(message.includes("offset 1 key 'cart-2' value '{\"sku\":\"B-7\",\"qty\":1}' (1 header(s))"), message);
  });

  it("passes for the value the application produced, and on a fragment of it", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.value, {
        target: "cart-events/0/0",
        equals: '{"sku":"A-1","qty":2}',
      }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/0", contains: "A-1" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a different value, in the record's own words", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/0", contains: "A-2" }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /Expected the value of the record at `cart-events\/0\/0`/);
  });

  it("reports a record the partition does not hold as inconclusive, listing the offsets it holds", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.key, { target: "cart-events/0/9", equals: "cart-1" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no record named `cart-events\/0\/9`/,
    );
    assert.match(String(result.message), /holds `0`, `1` as offsets/);
  });

  it("reports a record of an absent partition as inconclusive, naming the partition", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/9/0", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /topic `cart-events` holds no partition 9; it holds `cart-events\/0`, `cart-events\/1`/,
    );
  });

  it("reads a tombstone and an empty payload as one string, which is the stated limit of a text comparison", () => {
    /*
     * The two records below are different: one has no value at all and one has an empty value. A
     * comparison over text cannot tell them apart, and this test is that limit written as an
     * assertion rather than left as a paragraph - both pass the same expectation, and the subject
     * line is where a reader of the failure report learns which one they are looking at.
     */
    const withTombstone = document({
      topics: [
        {
          ...events,
          partitions: [{ ...cartPartition, records: [first, second, tombstone, emptyPayload] }, sparePartition],
        },
      ],
    });
    expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/2", equals: "" }),
      observed(withTombstone),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/3", equals: "" }),
      observed(withTombstone),
      "PASS",
    );
    const absent = expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/2", equals: "x" }),
      observed(withTombstone),
      "FAIL",
    );
    assert.match(String(absent.message), /value null/);
    const empty = expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/3", equals: "x" }),
      observed(withTombstone),
      "FAIL",
    );
    assert.match(String(empty.message), /value ''/);
  });

  it("cannot compare the bytes of a payload that is not text, because it compares the decoding", () => {
    /*
     * A value that is not UTF-8 decodes with replacement characters, and the reading carries the
     * bytes beside the text. The comparison sees the decoding, so a criterion asking for the byte
     * string fails - the honest consequence of a text comparison, and the reason the adapter keeps
     * `valueHex` for whoever needs the bytes.
     */
    const binary = recordAt(4, "cart-5", "\uFFFD\uFFFD");
    const withBinary = document({
      topics: [{ ...events, partitions: [{ ...cartPartition, records: [first, binary] }, sparePartition] }],
    });
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.value, { target: "cart-events/0/4", equals: "\u0000\u00FF" }),
      observed(withBinary),
      "FAIL",
    );
    assert.match(String(result.message), /\uFFFD\uFFFD/);
  });

  it("errors on a target that is a two-segment partition reference", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.key, { target: "cart-events/0", equals: "cart-1" }),
      observed(document()),
      "ERROR",
      /is not a record reference/,
    );
  });
});

// ---- 9. `data.group` and `data.member` ---------------------------------------------------------------

describe("data.group reads the coordinator's view of a consumer group", () => {
  it("passes against the generation, the state, the member count and how far it committed", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.group, {
        target: "cart-indexer",
        equals: "group 'cart-indexer' generation 4, stable, 1 member(s), 1 committed offset(s)",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a group that has not stabilised, naming the state it found", () => {
    const settling = document({
      groups: [{ ...indexer, state: "empty", members: [] }],
    });
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.group, { target: "cart-indexer", contains: "stable" }),
      observed(settling),
      "FAIL",
    );
    assert.match(String(result.message), /empty, 0 member\(s\)/);
  });

  it("counts members rather than naming them, so who joined is a question for data.member", () => {
    /*
     * The coordinator's view is compared as one sentence and that sentence prints how many members a
     * group has - not who they are. Two groups that differ only in member identity therefore render
     * identically, and this test pins that rather than leaving it to be discovered: the criterion
     * that asks who is in the group is `data.member`, whose target names one.
     */
    const otherMembership: DataGroupMemberReading = {
      memberId: "cart-indexer-7",
      clientId: "other",
      protocol: "range",
      assignmentBytes: 24,
    };
    const otherGroup: DataGroupReading = { ...indexer, members: [otherMembership] };
    const other = document({ groups: [otherGroup] });
    assert.equal(renderGroup(indexer), renderGroup(otherGroup));
    expect(
      expectation(DATA_VALIDATOR_NAMES.group, { target: "cart-indexer", contains: "1 member(s)" }),
      observed(other),
      "PASS",
    );
  });

  it("reports an absent group as inconclusive, naming the groups the world does hold", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.group, { target: "cart-other", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no group named `cart-other`/,
    );
    assert.match(String(result.message), /it holds `cart-indexer`/);
  });

  it("errors when the target is a reference rather than an id", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.group, { target: "cart-indexer/1", equals: "anything" }),
      observed(document()),
      "ERROR",
      /is not a consumer group id/,
    );
  });
});

describe("data.member reads one member as the coordinator recorded it", () => {
  it("passes against the id, the protocol and the size of the assignment", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, {
        target: "cart-indexer/cart-indexer-1",
        equals: "cart-indexer-1 (range) handed 24 byte(s)",
      }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, {
        target: "cart-indexer/cart-indexer-1",
        contains: "24 byte(s)",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("reads a member handed nothing as `no bytes` rather than as `0 byte(s)`", () => {
    const idle = document({
      groups: [{ ...indexer, members: [{ ...membership, assignmentBytes: 0 }] }],
    });
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, {
        target: "cart-indexer/cart-indexer-1",
        equals: "cart-indexer-1 (range) handed no bytes",
      }),
      observed(idle),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, {
        target: "cart-indexer/cart-indexer-1",
        contains: "24 byte(s)",
      }),
      observed(idle),
      "FAIL",
    );
  });

  it("reports a member the group does not hold as inconclusive, naming the members it holds", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.member, { target: "cart-indexer/ghost", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no member named `cart-indexer\/ghost`/,
    );
    assert.match(String(result.message), /holds `cart-indexer-1` as members/);
  });

  it("reports a member of an absent group as inconclusive, naming the missing group", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, { target: "cart-other/m1", equals: "anything" }),
      observed(document()),
      "INCONCLUSIVE",
      /it holds no group named `cart-other`/,
    );
  });

  it("errors when the target names a group and no member", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, { target: "cart-indexer", equals: "anything" }),
      observed(document()),
      "ERROR",
      /is not a member reference/,
    );
  });

  it("errors when the criterion names no target and when it states no comparison", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, { equals: "anything" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.member, { target: "cart-indexer/cart-indexer-1" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 10. `data.commit` -------------------------------------------------------------------------------

describe("data.commit reads how far a group has read one partition", () => {
  it("passes against the committed offset and the absence of metadata", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-indexer/cart-events/0",
        equals: "cart-events/0 committed 2 (no metadata)",
      }),
      observed(document()),
      "PASS",
    );
  });

  it("quotes metadata when the group committed some, because metadata is not state", () => {
    const annotated = document({
      groups: [{ ...indexer, committed: [{ ...commitment, metadata: "rebalanced" }] }],
    });
    expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-indexer/cart-events/0",
        equals: "cart-events/0 committed 2 (metadata 'rebalanced')",
      }),
      observed(annotated),
      "PASS",
    );
  });

  it("fails on an offset that disagrees, naming the one the group recorded", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-indexer/cart-events/0",
        contains: "committed 3",
      }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /committed 2 \(no metadata\)/);
  });

  it("reports a partition the group has not committed as inconclusive, naming the pairs it has", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-indexer/cart-events/9",
        equals: "anything",
      }),
      observed(document()),
      "INCONCLUSIVE",
      /The world holds no committed offset named `cart-indexer\/cart-events\/9`/,
    );
    assert.match(String(result.message), /holds `cart-events\/0` as committed offsets/);
  });

  it("says the group has committed nothing when that is the case, rather than listing an empty set", () => {
    const fresh = document({ groups: [{ ...indexer, committed: [] }] });
    expect(
      expectation(DATA_VALIDATOR_NAMES.commit, { target: "cart-indexer/cart-events/0", equals: "anything" }),
      observed(fresh),
      "INCONCLUSIVE",
      /holds nothing by that name as committed offsets/,
    );
  });

  it("names the missing group when the target names one the world does not hold", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-other/cart-events/0",
        equals: "anything",
      }),
      observed(document()),
      "INCONCLUSIVE",
      /it holds no group named `cart-other`/,
    );
  });

  it("errors when the target omits the partition index", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.commit, {
        target: "cart-indexer/cart-events",
        equals: "anything",
      }),
      observed(document()),
      "ERROR",
      /is not a committed-offset reference/,
    );
  });
});

// ---- 11. the two doors --------------------------------------------------------------------------------

describe("data.call reads the application's traffic and refuses the criterion's own", () => {
  it("passes for the API the application called successfully", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Produce", equals: "ok" }),
      observed(document()),
      "PASS",
    );
  });

  it("accepts the register's whole spelling as the target, and fails nothing by doing so", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Produce(0) v0, v2", equals: "ok" }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a result that disagrees, quoting the door, the correlation id and the reason", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "CreateTopics", equals: "ok" }),
      observed(document()),
      "FAIL",
    );
    const message = String(result.message);
    assert.ok(message.includes("application CreateTopics(19) v0 corr 9 -> refused"), message);
    assert.ok(message.includes("topic 'cart-events' already exists"), message);
  });

  it("judges the newest request for the API, not the first, because a retry is the interesting one", () => {
    const retried: DataRequestRecord = { ...refusedTopics, result: "ok", errorCode: 0, reason: null };
    const after = document({ requests: [...document().requests, retried] });
    expect(expectation(DATA_VALIDATOR_NAMES.call, { target: "CreateTopics", equals: "ok" }), observed(after), "PASS");
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "CreateTopics", equals: "refused" }),
      observed(after),
      "FAIL",
    );
  });

  it("reports a request nobody made as inconclusive, listing the APIs the world did answer", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "OffsetCommit", equals: "ok" }),
      observed(document()),
      "INCONCLUSIVE",
      /The world recorded no request for `OffsetCommit` at all/,
    );
    const message = String(result.message);
    assert.ok(message.includes("`Produce(0) v0, v2`"), message);
    assert.ok(message.includes("`Metadata(3) v0`"), message);
  });

  it("says the run made no requests at all rather than listing an empty set", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Produce", equals: "ok" }),
      observed(document({ requests: [] })),
      "INCONCLUSIVE",
      /The world answered no requests in this run\./,
    );
  });

  it("refuses the criterion's own command by name, because that is its own question", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Metadata", equals: "ok" }),
      observed(document()),
      "INCONCLUSIVE",
    );
    const message = String(result.message);
    assert.ok(message.includes("came through criterion"), message);
    assert.ok(message.includes("`data.probe` is the one that reads the criterion's own commands"), message);
    assert.ok(message.includes("a criterion's own command is not evidence about the application"), message);
  });

  it("reports a refusal as a result, so a criterion may pin the world's own reason", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "CreateTopics", equals: "refused" }),
      observed(document()),
      "PASS",
    );
  });

  it("refuses a result word this world does not have, rather than reporting a false failure", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Produce", equals: "fine" }),
      observed(document()),
      "ERROR",
      /wants one of ok, unknown-api, unsupported-version, unreadable, invalid-request, corrupt-message, refused/,
    );
  });

  it("errors when the criterion names no API and when it states no comparison", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { equals: "ok" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.call, { target: "Produce" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

describe("data.probe reads the criterion's own command and refuses the application's", () => {
  it("passes for the request the criterion made", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { target: "Metadata", equals: "ok" }),
      observed(document()),
      "PASS",
    );
  });

  it("refuses the application's traffic by name, which is the mirror of data.call", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { target: "Produce", equals: "ok" }),
      observed(document()),
      "INCONCLUSIVE",
    );
    const message = String(result.message);
    assert.ok(message.includes("came through application"), message);
    assert.ok(message.includes("`data.call` is the one that reads the application's requests"), message);
  });

  it("reads a command the world could not parse, as the port records one", () => {
    /*
     * A command crosses no socket, so `bytesIn` is zero and there is no correlation id - the world
     * records the whole spelling of the `api` for exactly this case, and the criterion has to name it
     * as recorded. That is deliberate: the bare word is a spelling the world never used.
     */
    const refusalJudo = document({ requests: [produce, refusedCommand] });
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, {
        target: "refused command 'fetch'",
        equals: "invalid-request",
      }),
      observed(refusalJudo),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { target: "fetch", equals: "invalid-request" }),
      observed(refusalJudo),
      "INCONCLUSIVE",
      /The world recorded no request for `fetch` at all/,
    );
  });

  it("reads the world's own spelling of a command whose word was empty", () => {
    const blank: DataRequestRecord = { ...refusedCommand, api: "no command" };
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { target: "no command", equals: "invalid-request" }),
      observed(document({ requests: [blank] })),
      "PASS",
    );
  });

  it("errors when the criterion names no API and when it states no comparison", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { equals: "ok" }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.probe, { target: "Metadata" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});

// ---- 12. `data.meter` --------------------------------------------------------------------------------

describe("data.meter reads one counter the world keeps", () => {
  it("passes for a counter that equals, and for one inside a bound", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests", equals: 3 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "recordsProduced", atLeast: 2 }),
      observed(document()),
      "PASS",
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "bytesOut", atMost: 192 }),
      observed(document()),
      "PASS",
    );
  });

  it("fails on a counter that disagrees, quoting the whole meter so the neighbours are visible", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests", equals: 4 }),
      observed(document()),
      "FAIL",
    );
    assert.match(
      String(result.message),
      /3 request\(s\), 288 byte\(s\) in, 192 byte\(s\) out, 2 produced, 2 fetched/,
    );
    assert.equal(result.actual, 3);
  });

  it("distinguishes a bound from an equality", () => {
    const result = expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests", atMost: 2 }),
      observed(document()),
      "FAIL",
    );
    assert.match(String(result.message), /to be at most 2, but it is 3/);
  });

  it("reads zero as a count of something that did not happen", () => {
    const quiet = document({
      meter: { requests: 0, bytesIn: 0, bytesOut: 0, recordsProduced: 0, recordsFetched: 0 },
    });
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "recordsProduced", equals: 0 }),
      observed(quiet),
      "PASS",
    );
  });

  it("reads every member of the meter vocabulary, so the list and the interface cannot disagree", () => {
    /*
     * The vocabulary is a list beside an interface, and a key in the list that the interface does not
     * carry would make every document unreadable - the worst failure shape there is, because the
     * symptom appears in the guard rather than at the counter. This loop is the guard on that pair.
     */
    assert.ok(DATA_METER_KEYS.length > 0);
    for (const name of DATA_METER_KEYS) {
      expect(
        expectation(DATA_VALIDATOR_NAMES.meter, { target: name, atLeast: 0 }),
        observed(document()),
        "PASS",
      );
    }
  });

  it("refuses a counter this world does not keep, rather than answering zero", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "latency", equals: 0 }),
      observed(document()),
      "ERROR",
      /is not a meter this world keeps; it records `requests`, `bytesIn`, `bytesOut`, `recordsProduced`, `recordsFetched`/,
    );
  });

  it("refuses a comparison over something that is not a number", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests", equals: "five" }),
      observed(document()),
      "ERROR",
      /"equals" compares a count with a number/,
    );
  });

  it("refuses a text comparison, because a count is not text", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests", contains: "3" }),
      observed(document()),
      "ERROR",
      /is not declared by this validator; it compares with equals, atLeast and atMost/,
    );
  });

  it("errors when the criterion names no counter and when it states no comparison", () => {
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { equals: 3 }),
      observed(document()),
      "ERROR",
      /named no target/,
    );
    expect(
      expectation(DATA_VALIDATOR_NAMES.meter, { target: "requests" }),
      observed(document()),
      "ERROR",
      /states no comparison/,
    );
  });
});
