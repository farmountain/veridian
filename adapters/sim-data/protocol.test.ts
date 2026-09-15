/**
 * The frame grammar, held by test.
 *
 * There is no request *encoder* in this module on purpose - the world only ever reads a request - so
 * every request frame below is composed by hand out of `WireWriter` primitives. That is the same
 * reason `wire.test.ts` assembles a batch by hand: a frame built by a sibling function that shares a
 * bug with the decoder would agree with it, and the agreement would be the defect.
 *
 * The response encoders *are* in this module, so the check on them is not a round trip either. It is
 * **the version-specific field**: `Fetch` v0 has no `throttleTimeMs` and v2 does, `Produce` v0 has no
 * `logAppendTime` and v2 does, `ListOffsets` v0 writes an array of offsets and v1 a single pair, and
 * `ListOffsets` v0's *request* carries a `maxNumOffsets` that v1's does not. Each of those is
 * asserted as a difference between two frames rather than as a fixed length, so an encoder that
 * emitted the same shape for both would fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATA_APIS,
  DATA_ERROR_CODES,
  DATA_MAX_REQUEST_BYTES,
  DATA_REQUEST_HEADER_VERSION,
  DATA_RESPONSE_HEADER_VERSION,
  dataApiOf,
  dataApiSpelling,
  dataErrorName,
  decodeRequestFrame,
  encodeApiVersionsResponse,
  encodeCreateTopicsResponse,
  encodeFetchResponse,
  encodeFindCoordinatorResponse,
  encodeHeartbeatResponse,
  encodeJoinGroupResponse,
  encodeListOffsetsResponse,
  encodeMetadataResponse,
  encodeOffsetCommitResponse,
  encodeOffsetFetchResponse,
  encodeProduceResponse,
  encodeRefusalResponse,
  encodeResponseFrame,
  encodeSyncGroupResponse,
} from "./protocol.ts";
import { WireReader, WireWriter } from "./wire.ts";
import type { DataRequestBody } from "./protocol.ts";

/** One request frame, composed from primitives: length, then the header, then the body. */
function frame(
  apiKey: number,
  apiVersion: number,
  correlationId: number,
  clientId: string | null,
  body: Buffer,
): Buffer {
  const header = new WireWriter();
  header.writeInt16(apiKey);
  header.writeInt16(apiVersion);
  header.writeInt32(correlationId);
  header.writeNullableString(clientId);
  header.writeRaw(body);
  const framed = header.toBuffer();
  const length = Buffer.allocUnsafe(4);
  length.writeInt32BE(framed.length, 0);
  return Buffer.concat([length, framed], framed.length + 4);
}

/** A `Producer`/consumer request body that asks for everything, for the APIs that take no fields. */
function emptyBody(): Buffer {
  return Buffer.alloc(0);
}

function readBack(bytes: Buffer): WireReader {
  return new WireReader(bytes);
}

describe("the API register", () => {
  it("names each API once, and every version it advertises is sorted and distinct", () => {
    const keys = new Set<number>();
    for (const api of DATA_APIS) {
      assert.equal(keys.has(api.key), false, `${api.name} repeats API key ${api.key}`);
      keys.add(api.key);
      assert.ok(api.versions.length > 0, `${api.name} advertises no version at all`);
      const sorted = [...api.versions].sort((left, right) => left - right);
      assert.deepEqual([...api.versions], sorted, `${api.name}'s versions are not ascending`);
      assert.equal(new Set(api.versions).size, api.versions.length, `${api.name} repeats a version`);
    }
  });

  it("declares a flexible version above every version it implements", () => {
    for (const api of DATA_APIS) {
      const highest = api.versions[api.versions.length - 1] ?? 0;
      assert.ok(
        api.flexibleFrom > highest,
        `${api.name} implements v${highest} but says it is flexible from v${api.flexibleFrom}`,
      );
    }
  });

  it("renders a spelling that names the key and every version", () => {
    const api = dataApiOf(0);
    assert.notEqual(api, null);
    assert.equal(dataApiSpelling(api!), "Produce(0) v0, v2");
  });

  it("tells a code's name from its number, and answers null for a code it does not produce", () => {
    assert.equal(dataErrorName(0), "NONE");
    assert.equal(dataErrorName(35), "UNSUPPORTED_VERSION");
    assert.equal(dataErrorName(3), "UNKNOWN_TOPIC_OR_PARTITION");
    assert.equal(dataErrorName(9999), null);
  });

  it("advertises exactly the register and nothing else", () => {
    const body = encodeApiVersionsResponse(DATA_ERROR_CODES.NONE);
    const reader = readBack(body);
    assert.equal(reader.readInt16(), 0);
    const count = reader.readArrayLength();
    assert.equal(count, DATA_APIS.length);
    const advertised: { key: number; lowest: number; highest: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      advertised.push({ key: reader.readInt16(), lowest: reader.readInt16(), highest: reader.readInt16() });
    }
    assert.equal(reader.remaining, 0);
    // Derived from the register rather than restated, so a version added to one and not the other
    // fails here instead of being described twice and disagreeing.
    assert.deepEqual(
      advertised,
      DATA_APIS.map((api) => ({
        key: api.key,
        lowest: api.versions[0] ?? 0,
        highest: api.versions[api.versions.length - 1] ?? 0,
      })),
    );
  });
});

describe("the request frame", () => {
  it("reads the header, and hands the body on with the header consumed", () => {
    const decoded = decodeRequestFrame(frame(18, 0, 4242, "cart-producer", emptyBody()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return;
    assert.equal(decoded.api.name, "ApiVersions");
    assert.equal(decoded.apiVersion, 0);
    assert.equal(decoded.correlationId, 4242);
    assert.equal(decoded.clientId, "cart-producer");
    assert.deepEqual(decoded.body, { kind: "api-versions" });
  });

  it("tells a null clientId from an empty one", () => {
    const absent = decodeRequestFrame(frame(18, 0, 1, null, emptyBody()));
    const blank = decodeRequestFrame(frame(18, 0, 1, "", emptyBody()));
    assert.equal(absent.kind === "request" ? absent.clientId : "unreachable", null);
    assert.equal(blank.kind === "request" ? blank.clientId : "unreachable", "");
  });

  it("declares the header version this world reads rather than assuming it", () => {
    // Request header v1 is the last non-flexible one - it is the version that added `clientId`. A
    // frame written with v0's header would put the first body byte where `clientId`'s length goes,
    // which is why the constant exists and why the test names it.
    assert.equal(DATA_REQUEST_HEADER_VERSION, 1);
    assert.equal(DATA_RESPONSE_HEADER_VERSION, 0);
  });

  it("refuses a frame shorter than its own length field", () => {
    const decoded = decodeRequestFrame(Buffer.from([0, 0, 1]));
    assert.equal(decoded.kind, "unreadable");
    if (decoded.kind !== "unreadable") return;
    assert.match(decoded.reason, /is 3 byte\(s\), too short to hold its own length/);
  });

  it("refuses a frame whose declared length disagrees with the bytes that follow", () => {
    const good = frame(18, 0, 1, null, emptyBody());
    const short = good.subarray(0, good.length - 1);
    const decoded = decodeRequestFrame(short);
    assert.equal(decoded.kind, "unreadable");
    if (decoded.kind !== "unreadable") return;
    assert.match(decoded.reason, /declared \d+ byte\(s\) and \d+ follow its length field/);
  });

  it("refuses a declared length past the ceiling this world reads", () => {
    const length = Buffer.allocUnsafe(4);
    length.writeInt32BE(DATA_MAX_REQUEST_BYTES + 1, 0);
    const decoded = decodeRequestFrame(length);
    assert.equal(decoded.kind, "unreadable");
    if (decoded.kind !== "unreadable") return;
    assert.match(decoded.reason, new RegExp(`past the ${DATA_MAX_REQUEST_BYTES} byte ceiling`));
  });

  it("refuses a frame whose header runs off the end, without guessing a correlation id", () => {
    // A frame that sends seven bytes of a header needing eight: `apiKey` and `apiVersion` read,
    // and the *correlation id* is the field the frame ends inside. The refusal must be `unreadable`
    // rather than a request with a fabricated client, because nothing here knows the id either.
    const header = new WireWriter();
    header.writeInt16(18);
    header.writeInt16(0);
    header.writeInt32(9);
    const partial = header.toBuffer().subarray(0, 7);
    const length = Buffer.allocUnsafe(4);
    length.writeInt32BE(partial.length, 0);
    const decoded = decodeRequestFrame(Buffer.concat([length, partial], partial.length + 4));
    assert.equal(decoded.kind, "unreadable");
    if (decoded.kind !== "unreadable") return;
    assert.match(decoded.reason, /ends before 4 byte\(s\) could be read; 3 remained/);
    // And it names the byte it stopped at, which is the offset a reader needs to find the field.
    assert.match(decoded.reason, /\(at byte 4\)/);
  });

  it("names an API key this world does not implement, and still answers with the correlation id", () => {
    const decoded = decodeRequestFrame(frame(7, 0, 31337, "cart", emptyBody()));
    assert.equal(decoded.kind, "unsupported");
    if (decoded.kind !== "unsupported") return;
    assert.equal(decoded.correlationId, 31337);
    assert.equal(decoded.api, null);
    assert.equal(decoded.code, DATA_ERROR_CODES.UNSUPPORTED_VERSION);
    assert.match(decoded.reason, new RegExp(`API key 7 is not one of them`));
    assert.match(decoded.reason, new RegExp(`implements ${DATA_APIS.length} API\\(s\\)`));
  });

  it("names a flexible version as flexible rather than as merely unimplemented", () => {
    const decoded = decodeRequestFrame(frame(3, 9, 5, null, emptyBody()));
    assert.equal(decoded.kind, "unsupported");
    if (decoded.kind !== "unsupported") return;
    assert.equal(decoded.code, DATA_ERROR_CODES.UNSUPPORTED_VERSION);
    assert.match(decoded.reason, /Metadata\(3\) v0 asked for version 9, which is flexible/);
    assert.match(decoded.reason, /pre-flexible encoding only/);
  });

  it("names a version this world simply did not build as unimplemented", () => {
    const decoded = decodeRequestFrame(frame(3, 1, 5, null, emptyBody()));
    assert.equal(decoded.kind, "unsupported");
    if (decoded.kind !== "unsupported") return;
    assert.match(decoded.reason, /asked for version 1, which this world does not implement/);
    // The two reasons must be different sentences: one sends the reader to the version they asked
    // for, the other to the encoding. A single message for both would name a cause it did not see.
    assert.doesNotMatch(decoded.reason, /flexible/);
  });

  it("refuses a body that carries bytes past the fields it declares", () => {
    const body = new WireWriter();
    body.writeArrayLength(0);
    body.writeInt32(0);
    body.writeInt32(0);
    const decoded = decodeRequestFrame(frame(3, 0, 5, null, body.toBuffer()));
    assert.equal(decoded.kind, "unsupported");
    if (decoded.kind !== "unsupported") return;
    assert.equal(decoded.code, DATA_ERROR_CODES.INVALID_REQUEST);
    assert.match(decoded.reason, /Metadata v0 carries 8 byte\(s\) past the fields it declares/);
  });

  it("refuses a body it cannot read, naming the API and version rather than the byte", () => {
    const body = new WireWriter();
    body.writeArrayLength(2);
    body.writeString("orders");
    const decoded = decodeRequestFrame(frame(3, 0, 5, null, body.toBuffer()));
    assert.equal(decoded.kind, "unsupported");
    if (decoded.kind !== "unsupported") return;
    assert.equal(decoded.code, DATA_ERROR_CODES.CORRUPT_MESSAGE);
    assert.match(decoded.reason, /Metadata v0 could not be read: .*ends before 2 byte\(s\) could be read/);
  });

  it("keeps a null topic list distinct from an empty one, which two requests mean differently", () => {
    const all = new WireWriter();
    all.writeArrayLength(-1);
    const none = new WireWriter();
    none.writeArrayLength(0);
    const some = new WireWriter();
    some.writeArrayLength(1);
    some.writeString("cart-events");
    const everyTopic = decodeRequestFrame(frame(3, 0, 1, null, all.toBuffer()));
    const noTopic = decodeRequestFrame(frame(3, 0, 2, null, none.toBuffer()));
    const oneTopic = decodeRequestFrame(frame(3, 0, 3, null, some.toBuffer()));
    assert.equal(everyTopic.kind === "request" ? much(everyTopic.body) : "unreachable", "null");
    assert.equal(noTopic.kind === "request" ? much(noTopic.body) : "unreachable", "empty");
    assert.equal(oneTopic.kind === "request" ? much(oneTopic.body) : "unreachable", "cart-events");
  });
});

/**
 * Dispatches a `Metadata` body's topic list into a word, so the three cases can be told apart.
 *
 * The parameter is the request-body union rather than a structural shape, so narrowing on `kind`
 * gives the topic list the type the body actually declares - a structural parameter would have had
 * to describe the topic lists of all twelve kinds at once, which is how a helper ends up with a
 * branch nothing can reach. The word for "a list this test never built" is the fourth outcome, and
 * it is what keeps a two-valued answer from standing for a three-valued question: a count alone
 * would report `0` for an empty list and an absent one, which is the distinction being read for.
 */
function much(body: DataRequestBody): string {
  if (body.kind !== "metadata") return "not-metadata";
  const topics = body.topics;
  if (topics === null) return "null";
  return topics.length === 0 ? "empty" : topics.join(",");
}

describe("each API's request body", () => {
  it("reads a Produce request's acks, timeout and per-partition record batches", () => {
    const records = Buffer.from([9, 9, 9]);
    const body = new WireWriter();
    body.writeInt16(-1);
    body.writeInt32(30000);
    body.writeArrayLength(1);
    body.writeString("cart-events");
    body.writeArrayLength(2);
    body.writeInt32(0);
    body.writeBytes(records);
    body.writeInt32(1);
    body.writeBytes(null);
    const decoded = decodeRequestFrame(frame(0, 2, 77, "cart", body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "produce") return assert.fail("not a produce body");
    assert.equal(decoded.body.acks, -1);
    assert.equal(decoded.body.timeoutMs, 30000);
    assert.equal(decoded.body.topics.length, 1);
    const topic = decoded.body.topics[0]!;
    assert.equal(topic.name, "cart-events");
    assert.equal(topic.partitions.length, 2);
    assert.deepEqual(topic.partitions[0]!.records, records);
    assert.equal(topic.partitions[0]!.index, 0);
    assert.equal(topic.partitions[1]!.index, 1);
    assert.equal(topic.partitions[1]!.records, null);
  });

  it("reads a Fetch request's wait, byte floor and per-partition offsets", () => {
    const body = new WireWriter();
    body.writeInt32(-1);
    body.writeInt32(500);
    body.writeInt32(1);
    body.writeArrayLength(1);
    body.writeString("cart-events");
    body.writeArrayLength(1);
    body.writeInt32(0);
    body.writeInt64(41);
    body.writeInt32(1048576);
    const decoded = decodeRequestFrame(frame(1, 2, 78, "cart", body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "fetch") return assert.fail("not a fetch body");
    assert.equal(decoded.body.replicaId, -1);
    assert.equal(decoded.body.maxWaitMs, 500);
    assert.equal(decoded.body.minBytes, 1);
    assert.deepEqual(decoded.body.topics[0]!.partitions[0], {
      partition: 0,
      fetchOffset: 41,
      partitionMaxBytes: 1048576,
    });
  });

  it("reads ListOffsets v0's maxNumOffsets and refuses it in v1, which has no such field", () => {
    const v0 = new WireWriter();
    v0.writeInt32(-1);
    v0.writeArrayLength(1);
    v0.writeString("cart-events");
    v0.writeArrayLength(1);
    v0.writeInt32(0);
    v0.writeInt64(-1);
    v0.writeInt32(1);
    const readV0 = decodeRequestFrame(frame(2, 0, 1, null, v0.toBuffer()));
    assert.equal(readV0.kind, "request");
    if (readV0.kind !== "request") return assert.fail("not a request");
    if (readV0.body.kind !== "list-offsets") return assert.fail("not a list-offsets body");
    assert.equal(readV0.body.replicaId, -1);
    assert.deepEqual(readV0.body.topics[0]!.partitions[0], {
      partitionIndex: 0,
      timestamp: -1,
      maxNumOffsets: 1,
    });

    // The same bytes read as v1 leave the four bytes of `maxNumOffsets` over, which the decoder
    // reports as a body carrying bytes past its own fields rather than silently ignoring them.
    const readV1 = decodeRequestFrame(frame(2, 1, 1, null, v0.toBuffer()));
    assert.equal(readV1.kind, "unsupported");
    if (readV1.kind !== "unsupported") return;
    assert.match(readV1.reason, /ListOffsets v1 carries 4 byte\(s\) past the fields it declares/);
  });

  it("reads ListOffsets v1's pair with no maxNumOffsets, which is the field v1 removed", () => {
    const v1 = new WireWriter();
    v1.writeInt32(-1);
    v1.writeArrayLength(1);
    v1.writeString("cart-events");
    v1.writeArrayLength(1);
    v1.writeInt32(0);
    v1.writeInt64(-1);
    const decoded = decodeRequestFrame(frame(2, 1, 1, null, v1.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "list-offsets") return assert.fail("not a list-offsets body");
    assert.deepEqual(decoded.body.topics[0]!.partitions[0], {
      partitionIndex: 0,
      timestamp: -1,
      maxNumOffsets: null,
    });
  });

  it("reads a CreateTopics request's assignment count and its configs, and its timeout after them", () => {
    const body = new WireWriter();
    body.writeArrayLength(1);
    body.writeString("cart-events");
    body.writeInt32(3);
    body.writeInt16(1);
    body.writeArrayLength(1);
    body.writeInt32(0);
    body.writeArrayLength(1);
    body.writeInt32(1);
    body.writeArrayLength(1);
    body.writeString("retention.ms");
    body.writeNullableString("86400000");
    // `CreateTopics` v0 puts the timeout *after* the topic array rather than before it, which is
    // the one field in this grammar whose position is not where a document would put it.
    body.writeInt32(5000);
    const decoded = decodeRequestFrame(frame(19, 0, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "create-topics") return assert.fail("not a create-topics body");
    assert.equal(decoded.body.timeoutMs, 5000);
    assert.deepEqual(
      decoded.body.topics.map((topic) => topic.name),
      ["cart-events"],
    );
    const topic = decoded.body.topics[0]!;
    assert.equal(topic.numPartitions, 3);
    assert.equal(topic.replicationFactor, 1);
    assert.deepEqual(topic.assignments, [{ partitionIndex: 0, brokerIds: [1] }]);
    assert.deepEqual(topic.configs, [{ name: "retention.ms", value: "86400000" }]);
  });

  it("reads a FindCoordinator request's key", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    const decoded = decodeRequestFrame(frame(10, 0, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "find-coordinator") return assert.fail("not a find-coordinator body");
    assert.equal(decoded.body.key, "cart-consumers");
  });

  it("reads a JoinGroup request's protocol list", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    body.writeInt32(10000);
    body.writeString("");
    body.writeString("consumer");
    body.writeArrayLength(1);
    body.writeString("range");
    body.writeBytes(Buffer.from([1, 2]));
    const decoded = decodeRequestFrame(frame(11, 0, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "join-group") return assert.fail("not a join-group body");
    assert.equal(decoded.body.groupId, "cart-consumers");
    assert.equal(decoded.body.sessionTimeoutMs, 10000);
    assert.equal(decoded.body.memberId, "");
    assert.equal(decoded.body.protocolType, "consumer");
    assert.deepEqual(decoded.body.protocols.map((protocol) => protocol.name), ["range"]);
    assert.deepEqual(decoded.body.protocols[0]!.metadata, Buffer.from([1, 2]));
  });

  it("reads a SyncGroup request's per-member assignments", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    body.writeInt32(7);
    body.writeString("member-1");
    body.writeArrayLength(1);
    body.writeString("member-1");
    body.writeBytes(Buffer.from([3]));
    const decoded = decodeRequestFrame(frame(14, 0, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "sync-group") return assert.fail("not a sync-group body");
    assert.equal(decoded.body.generationId, 7);
    assert.deepEqual(decoded.body.assignments, [{ memberId: "member-1", assignment: Buffer.from([3]) }]);
  });

  it("reads a Heartbeat request's group generation and member", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    body.writeInt32(7);
    body.writeString("member-1");
    const decoded = decodeRequestFrame(frame(12, 0, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "heartbeat") return assert.fail("not a heartbeat body");
    assert.deepEqual(decoded.body, {
      kind: "heartbeat",
      groupId: "cart-consumers",
      generationId: 7,
      memberId: "member-1",
    });
  });

  it("reads an OffsetCommit v2 request's retention and per-partition offsets", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    body.writeInt32(7);
    body.writeString("member-1");
    body.writeInt64(-1);
    body.writeArrayLength(1);
    body.writeString("cart-events");
    body.writeArrayLength(1);
    body.writeInt32(0);
    body.writeInt64(12);
    body.writeNullableString(null);
    const decoded = decodeRequestFrame(frame(8, 2, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "offset-commit") return assert.fail("not an offset-commit body");
    assert.equal(decoded.body.retentionTimeMs, -1);
    assert.deepEqual(decoded.body.topics[0]!.partitions[0], { partitionIndex: 0, offset: 12, metadata: null });
  });

  it("reads an OffsetFetch v1 request's partition index list", () => {
    const body = new WireWriter();
    body.writeString("cart-consumers");
    body.writeArrayLength(1);
    body.writeString("cart-events");
    body.writeArrayLength(2);
    body.writeInt32(0);
    body.writeInt32(1);
    const decoded = decodeRequestFrame(frame(9, 1, 1, null, body.toBuffer()));
    assert.equal(decoded.kind, "request");
    if (decoded.kind !== "request") return assert.fail("not a request");
    if (decoded.body.kind !== "offset-fetch") return assert.fail("not an offset-fetch body");
    assert.deepEqual(decoded.body.topics, [{ name: "cart-events", partitionIndexes: [0, 1] }]);
  });
});

describe("each API's response body", () => {
  it("puts the correlation id first and the frame length before it", () => {
    const body = encodeHeartbeatResponse(DATA_ERROR_CODES.NONE);
    const framed = encodeResponseFrame(4242, body);
    assert.equal(framed.length, body.length + 8);
    assert.equal(framed.readInt32BE(0), body.length + 4);
    assert.equal(framed.readInt32BE(4), 4242);
    assert.equal(framed.readInt16BE(8), 0);
    assert.equal(framed.length, 10);
  });

  it("writes the batch's own bytes as a nullable byte field, not as a bare length", () => {
    const records = Buffer.from([1, 2, 3, 4, 5]);
    const body = encodeFetchResponse(1, [
      { name: "cart-events", partitions: [{ partitionIndex: 0, errorCode: 0, highWatermark: 5, records }] },
    ]);
    const reader = readBack(body);
    assert.equal(reader.readInt32(), 0); // throttleTimeMs, which v1 has and v0 does not
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readString(), "cart-events");
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 0);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.readInt64(), 5);
    assert.equal(reader.readNullableBytes()?.toString("hex"), records.toString("hex"));
    assert.equal(reader.remaining, 0);
  });

  it("omits the throttle time in Fetch v0 and carries it in v2, so the two differ by four bytes", () => {
    const partitions = [{ partitionIndex: 0, errorCode: 0, highWatermark: 0, records: Buffer.alloc(0) }];
    const v0 = encodeFetchResponse(0, [{ name: "t", partitions }]);
    const v2 = encodeFetchResponse(2, [{ name: "t", partitions }]);
    assert.equal(v2.length - v0.length, 4);
    // The field that differs is the *first* one, so the two bodies disagree about what their own
    // opening four bytes mean - a client reading v0's shape from a v2 body would take the throttle
    // time for a topic count.
    assert.equal(readBack(v0).readInt32(), 1);
    assert.equal(readBack(v2).readInt32(), 0);
  });

  it("omits logAppendTime in Produce v0 and carries it in v2, so the two differ by eight bytes", () => {
    const partitions = [{ index: 0, errorCode: 0, baseOffset: 3, logAppendTime: 1700000000000 }];
    const v0 = encodeProduceResponse(0, [{ name: "t", partitions }]);
    const v2 = encodeProduceResponse(2, [{ name: "t", partitions }]);
    assert.equal(v2.length - v0.length, 8);
  });

  it("writes ListOffsets v0's offset list and v1's timestamp-and-offset pair", () => {
    const partitions = [{ partitionIndex: 0, errorCode: 0, offsets: [4], timestamp: -1, offset: 4 }];
    const v0 = encodeListOffsetsResponse(0, [{ name: "t", partitions }]);
    const v1 = encodeListOffsetsResponse(1, [{ name: "t", partitions }]);
    const v0Reader = readBack(v0);
    assert.equal(v0Reader.readArrayLength(), 1);
    assert.equal(v0Reader.readString(), "t");
    assert.equal(v0Reader.readArrayLength(), 1);
    assert.equal(v0Reader.readInt32(), 0);
    assert.equal(v0Reader.readInt16(), 0);
    assert.equal(v0Reader.readArrayLength(), 1);
    assert.equal(v0Reader.readInt64(), 4);
    assert.equal(v0Reader.remaining, 0);

    const v1Reader = readBack(v1);
    assert.equal(v1Reader.readArrayLength(), 1);
    assert.equal(v1Reader.readString(), "t");
    assert.equal(v1Reader.readArrayLength(), 1);
    assert.equal(v1Reader.readInt32(), 0);
    assert.equal(v1Reader.readInt16(), 0);
    assert.equal(v1Reader.readInt64(), -1);
    assert.equal(v1Reader.readInt64(), 4);
    assert.equal(v1Reader.remaining, 0);
    // The two bodies differ in one place and it is the offset *list*: v0 spends a four-byte count
    // plus eight bytes per offset, v1 spends sixteen for its pair - so with one offset v1 is four
    // bytes longer, and an encoder that wrote one shape for both versions would fail here.
    assert.equal(v1.length - v0.length, 4);
  });

  it("writes a Metadata response's brokers and per-partition replicas", () => {
    const body = encodeMetadataResponse([{ nodeId: 1, host: "127.0.0.1", port: 9092 }], [
      {
        errorCode: 0,
        name: "cart-events",
        partitions: [{ errorCode: 0, partitionIndex: 0, leaderId: 1, replicas: [1], isr: [1] }],
      },
    ]);
    const reader = readBack(body);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 1);
    assert.equal(reader.readString(), "127.0.0.1");
    assert.equal(reader.readInt32(), 9092);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.readString(), "cart-events");
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.readInt32(), 0);
    assert.equal(reader.readInt32(), 1);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 1);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 1);
    assert.equal(reader.remaining, 0);
  });

  it("writes a JoinGroup refusal with no members rather than a fabricated one", () => {
    const body = encodeJoinGroupResponse({
      errorCode: DATA_ERROR_CODES.UNSUPPORTED_VERSION,
      generationId: -1,
      groupProtocol: "",
      leaderId: "",
      memberId: "",
      members: [],
    });
    const reader = readBack(body);
    assert.equal(reader.readInt16(), 35);
    assert.equal(reader.readInt32(), -1);
    assert.equal(reader.readString(), "");
    assert.equal(reader.readString(), "");
    assert.equal(reader.readString(), "");
    assert.equal(reader.readArrayLength(), 0);
    assert.equal(reader.remaining, 0);
  });

  it("writes an OffsetFetch response's offset, metadata and error in that order", () => {
    const body = encodeOffsetFetchResponse([
      { name: "cart-events", partitions: [{ partitionIndex: 0, offset: 12, metadata: null, errorCode: 0 }] },
    ]);
    const reader = readBack(body);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readString(), "cart-events");
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 0);
    assert.equal(reader.readInt64(), 12);
    assert.equal(reader.readNullableString(), null);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.remaining, 0);
  });

  it("writes a CreateTopics response as name and error alone", () => {
    const body = encodeCreateTopicsResponse([{ name: "cart-events", errorCode: 36 }]);
    const reader = readBack(body);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readString(), "cart-events");
    assert.equal(reader.readInt16(), 36);
    assert.equal(reader.remaining, 0);
  });

  it("writes an OffsetCommit response as topic, partition and error alone", () => {
    const body = encodeOffsetCommitResponse([
      { name: "cart-events", partitions: [{ partitionIndex: 0, errorCode: 0 }] },
    ]);
    const reader = readBack(body);
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readString(), "cart-events");
    assert.equal(reader.readArrayLength(), 1);
    assert.equal(reader.readInt32(), 0);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.remaining, 0);
  });

  it("writes a SyncGroup response's error then its assignment bytes", () => {
    const body = encodeSyncGroupResponse(0, Buffer.from([7]));
    const reader = readBack(body);
    assert.equal(reader.readInt16(), 0);
    assert.deepEqual(reader.readNullableBytes(), Buffer.from([7]));
    assert.equal(reader.remaining, 0);
  });

  it("writes a FindCoordinator response's error, node, host and port", () => {
    const body = encodeFindCoordinatorResponse(0, 1, "127.0.0.1", 9092);
    const reader = readBack(body);
    assert.equal(reader.readInt16(), 0);
    assert.equal(reader.readInt32(), 1);
    assert.equal(reader.readString(), "127.0.0.1");
    assert.equal(reader.readInt32(), 9092);
    assert.equal(reader.remaining, 0);
  });
});

describe("the body a refusal is answered with", () => {
  it("is a shape the refused API's own lowest version consumes exactly", () => {
    // Derived from the register rather than listed, so an API added to it without a refusal body
    // fails here instead of being answered with the empty buffer the default branch returns.
    for (const api of DATA_APIS) {
      const body = encodeRefusalResponse(api, DATA_ERROR_CODES.UNSUPPORTED_VERSION);
      const reader = new WireReader(body);
      switch (api.key) {
        case 0:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 1:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 2:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 3:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 8:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 9:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 10:
          assert.equal(reader.readInt16(), DATA_ERROR_CODES.UNSUPPORTED_VERSION, `${api.name} refusal`);
          reader.readInt32();
          reader.readString();
          reader.readInt32();
          break;
        case 11:
          assert.equal(reader.readInt16(), DATA_ERROR_CODES.UNSUPPORTED_VERSION, `${api.name} refusal`);
          reader.readInt32();
          reader.readString();
          reader.readString();
          reader.readString();
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        case 12:
          assert.equal(reader.readInt16(), DATA_ERROR_CODES.UNSUPPORTED_VERSION, `${api.name} refusal`);
          break;
        case 14:
          assert.equal(reader.readInt16(), DATA_ERROR_CODES.UNSUPPORTED_VERSION, `${api.name} refusal`);
          reader.readNullableBytes();
          break;
        case 18: {
          assert.equal(reader.readInt16(), DATA_ERROR_CODES.UNSUPPORTED_VERSION, `${api.name} refusal`);
          const advertised = reader.readArrayLength();
          assert.equal(advertised, DATA_APIS.length, `${api.name} refusal`);
          // The register, in full - so a refusal is a *negotiable* answer rather than one that
          // leaves the client with nothing to ask again with.
          for (let index = 0; index < advertised; index += 1) {
            reader.readInt16();
            reader.readInt16();
            reader.readInt16();
          }
          break;
        }
        case 19:
          assert.equal(reader.readArrayLength(), 0, `${api.name} refusal`);
          break;
        default:
          assert.fail(`${api.name} has a register entry and no refusal body`);
      }
      assert.equal(reader.remaining, 0, `${api.name}'s refusal body is not the shape it claims`);
    }
  });

  it("answers an API it does not know with no body at all, because there is no shape to fill", () => {
    assert.equal(encodeRefusalResponse(null, DATA_ERROR_CODES.UNSUPPORTED_VERSION).length, 0);
  });
});
