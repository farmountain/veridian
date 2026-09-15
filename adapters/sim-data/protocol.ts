/**
 * The request and response framing of the protocol the eleventh world's substitute speaks.
 *
 * `wire.ts` beside this file owns the *record* grammar - a record batch and the varints inside it.
 * This file owns the *frame* grammar around it, which is what makes this world different from every
 * world before it: the application does not send command vectors on its stdout and it does not send
 * JSON over HTTP. It opens a socket and writes bytes in a protocol's own layout, and this module is
 * the layer that reads them.
 *
 * Two headers, both non-flexible:
 *
 * ```
 * request   apiKey INT16, apiVersion INT16, correlationId INT32, clientId NULLABLE_STRING
 * response  correlationId INT32
 * ```
 *
 * and every frame on the wire is that header and its body behind an `INT32` length:
 *
 * ```
 * frame     length INT32, <header>, <body>
 * ```
 *
 * **Two deliberate refusals, and both are stated rather than hidden.**
 *
 * The first is **flexible encodings**. From a version onward each of these APIs switches its header
 * to a tagged-field layout - request header v2, response header v1, compact strings and tagged
 * fields throughout the body. This world implements the pre-flexible grammar only, so it carries the
 * version each API switches at (`flexibleFrom`) and says so *by name* when a client asks for one,
 * rather than misreading a tagged frame as a legacy one. A client that negotiates through
 * `ApiVersions` will never hit it, because `ApiVersions` advertises exactly the versions below and
 * nothing else - which is the whole reason the register is the single place a version is declared.
 *
 * The second is **compression**, which belongs to `wire.ts` and is refused there.
 *
 * A third refusal is structural: **a frame whose own header cannot be read is not answered**, because
 * a request that does not carry a correlation id cannot be replied to - a response with a guessed one
 * would be a reply to a different request. The port closes the connection and records why.
 */
import { MAX_FRAME_BYTES, WireError, WireReader, WireWriter } from "./wire.ts";

/**
 * The largest request frame this world will read.
 *
 * `MAX_FRAME_BYTES` is the bound `wire.ts` applies to a batch it assembles; a request frame can hold
 * a batch plus its envelope, so this is the same ceiling and the whole frame is bounded by it rather
 * than only the batch inside it.
 */
export const DATA_MAX_REQUEST_BYTES = MAX_FRAME_BYTES;

/** The request header version this world reads. Request header v2 is flexible and is refused by name. */
export const DATA_REQUEST_HEADER_VERSION = 1;

/** The response header version this world writes. Response header v1 is flexible and is never written. */
export const DATA_RESPONSE_HEADER_VERSION = 0;

/**
 * The protocol error codes this world can return, by the names a reading quotes.
 *
 * Deliberately the codes this world actually reaches. A register that carried all eighty of Kafka's
 * codes would be a list nothing produces, and the reading's whole job is to name *which* refusal
 * happened rather than to enumerate the vocabulary it came from.
 */
export const DATA_ERROR_CODES = Object.freeze({
  NONE: 0,
  OFFSET_OUT_OF_RANGE: 1,
  CORRUPT_MESSAGE: 2,
  UNKNOWN_TOPIC_OR_PARTITION: 3,
  MESSAGE_TOO_LARGE: 10,
  GROUP_LOAD_IN_PROGRESS: 14,
  NOT_COORDINATOR: 16,
  INVALID_TOPIC_EXCEPTION: 17,
  NOT_ENOUGH_REPLICAS: 19,
  INVALID_REQUIRED_ACKS: 21,
  ILLEGAL_GENERATION: 22,
  INCONSISTENT_GROUP_PROTOCOL: 23,
  INVALID_GROUP_ID: 24,
  UNKNOWN_MEMBER_ID: 25,
  INVALID_SESSION_TIMEOUT: 26,
  REBALANCE_IN_PROGRESS: 27,
  INVALID_TIMESTAMP: 32,
  UNSUPPORTED_VERSION: 35,
  TOPIC_ALREADY_EXISTS: 36,
  INVALID_PARTITIONS: 37,
  INVALID_REPLICATION_FACTOR: 38,
  INVALID_REQUEST: 42,
  UNKNOWN_SERVER_ERROR: -1,
} as const);

/** One protocol error code's name, or `null` for a code this world does not produce. */
export function dataErrorName(code: number): string | null {
  for (const [name, value] of Object.entries(DATA_ERROR_CODES)) {
    if (value === code) return name;
  }
  return null;
}

/** One API this world implements: its key, its name, and exactly the versions it speaks. */
export interface DataApi {
  readonly key: number;
  readonly name: string;
  /** The versions implemented, ascending. `ApiVersions` advertises these and refuses every other. */
  readonly versions: readonly number[];
  /**
   * The first version whose encoding is flexible.
   *
   * Carried so a refusal can say *why* a version is unsupported rather than only *that* it is: a
   * client asking for `Metadata` v9 is asking for a tagged-frame encoding this world does not
   * implement, and a client asking for v1 is asking for a version this world simply did not build.
   * Those are two different sentences and the reader needs the right one.
   */
  readonly flexibleFrom: number;
}

/**
 * The APIs this world implements, by key.
 *
 * The versions are the ones actually implemented and nothing else, because `ApiVersions` reads this
 * register - so a version named here that no decoder handles would be a promise made on the wire and
 * broken on the first request that used it.
 */
export const DATA_APIS: readonly DataApi[] = Object.freeze([
  Object.freeze({ key: 0, name: "Produce", versions: Object.freeze([0, 2]), flexibleFrom: 9 }),
  Object.freeze({ key: 1, name: "Fetch", versions: Object.freeze([0, 2]), flexibleFrom: 12 }),
  Object.freeze({ key: 2, name: "ListOffsets", versions: Object.freeze([0, 1]), flexibleFrom: 6 }),
  Object.freeze({ key: 3, name: "Metadata", versions: Object.freeze([0]), flexibleFrom: 9 }),
  Object.freeze({ key: 8, name: "OffsetCommit", versions: Object.freeze([2]), flexibleFrom: 8 }),
  Object.freeze({ key: 9, name: "OffsetFetch", versions: Object.freeze([1]), flexibleFrom: 6 }),
  Object.freeze({ key: 10, name: "FindCoordinator", versions: Object.freeze([0]), flexibleFrom: 3 }),
  Object.freeze({ key: 11, name: "JoinGroup", versions: Object.freeze([0]), flexibleFrom: 6 }),
  Object.freeze({ key: 12, name: "Heartbeat", versions: Object.freeze([0]), flexibleFrom: 4 }),
  Object.freeze({ key: 14, name: "SyncGroup", versions: Object.freeze([0]), flexibleFrom: 4 }),
  Object.freeze({ key: 18, name: "ApiVersions", versions: Object.freeze([0]), flexibleFrom: 3 }),
  Object.freeze({ key: 19, name: "CreateTopics", versions: Object.freeze([0]), flexibleFrom: 5 }),
]);

/** The API a key names, or `null`. The one lookup the register exists for. */
export function dataApiOf(key: number): DataApi | null {
  for (const api of DATA_APIS) {
    if (api.key === key) return api;
  }
  return null;
}

/** The version list as `ApiVersions` renders it, for a reading to quote. */
export function dataApiSpelling(api: DataApi): string {
  return `${api.name}(${api.key}) v${api.versions.join(", v")}`;
}

// ---------------------------------------------------------------------------------------------
// The request bodies, one interface per API
// ---------------------------------------------------------------------------------------------

/** One topic's partition assignment in a `CreateTopics` request. */
export interface DataReplicaAssignment {
  readonly partitionIndex: number;
  readonly brokerIds: readonly number[];
}

/** One topic as `CreateTopics` is asked to make it. */
export interface DataNewTopic {
  readonly name: string;
  readonly numPartitions: number;
  readonly replicationFactor: number;
  readonly assignments: readonly DataReplicaAssignment[];
  readonly configs: readonly { readonly name: string; readonly value: string | null }[];
}

/** One partition of one topic as `Produce` carries it. `records` is the raw batch, or null. */
export interface DataProducePartition {
  readonly index: number;
  readonly records: Buffer | null;
}

/** One topic of a `Produce` request. */
export interface DataProduceTopic {
  readonly name: string;
  readonly partitions: readonly DataProducePartition[];
}

/** One partition of a `Fetch` request. */
export interface DataFetchPartition {
  readonly partition: number;
  readonly fetchOffset: number;
  readonly partitionMaxBytes: number;
}

/** One topic of a `Fetch` request. */
export interface DataFetchTopic {
  readonly name: string;
  readonly partitions: readonly DataFetchPartition[];
}

/** One partition of a `ListOffsets` request. */
export interface DataListOffsetsPartition {
  readonly partitionIndex: number;
  readonly timestamp: number;
  /** Present in v0 and absent from v1, which is the one difference between the two. */
  readonly maxNumOffsets: number | null;
}

/** One topic of a `ListOffsets` request. */
export interface DataListOffsetsTopic {
  readonly name: string;
  readonly partitions: readonly DataListOffsetsPartition[];
}

/** One member's protocol metadata in a `JoinGroup` request. */
export interface DataGroupProtocol {
  readonly name: string;
  readonly metadata: Buffer;
}

/** One member's assignment in a `SyncGroup` request. */
export interface DataMemberAssignment {
  readonly memberId: string;
  readonly assignment: Buffer;
}

/** One partition of an `OffsetCommit` request. */
export interface DataCommitPartition {
  readonly partitionIndex: number;
  readonly offset: number;
  readonly metadata: string | null;
}

/** One topic of an `OffsetCommit` request. */
export interface DataCommitTopic {
  readonly name: string;
  readonly partitions: readonly DataCommitPartition[];
}

/** One topic of an `OffsetFetch` request. */
export interface DataFetchOffsetsTopic {
  readonly name: string;
  readonly partitionIndexes: readonly number[];
}

/** A decoded request body. The `kind` is the API, and the union is exhaustive by construction. */
export type DataRequestBody =
  | { readonly kind: "api-versions" }
  | { readonly kind: "metadata"; readonly topics: readonly string[] | null }
  | { readonly kind: "create-topics"; readonly topics: readonly DataNewTopic[]; readonly timeoutMs: number }
  | {
      readonly kind: "produce";
      readonly acks: number;
      readonly timeoutMs: number;
      readonly topics: readonly DataProduceTopic[];
    }
  | {
      readonly kind: "fetch";
      readonly replicaId: number;
      readonly maxWaitMs: number;
      readonly minBytes: number;
      readonly topics: readonly DataFetchTopic[];
    }
  | {
      readonly kind: "list-offsets";
      readonly replicaId: number;
      readonly topics: readonly DataListOffsetsTopic[];
    }
  | { readonly kind: "find-coordinator"; readonly key: string }
  | {
      readonly kind: "join-group";
      readonly groupId: string;
      readonly sessionTimeoutMs: number;
      readonly memberId: string;
      readonly protocolType: string;
      readonly protocols: readonly DataGroupProtocol[];
    }
  | {
      readonly kind: "sync-group";
      readonly groupId: string;
      readonly generationId: number;
      readonly memberId: string;
      readonly assignments: readonly DataMemberAssignment[];
    }
  | { readonly kind: "heartbeat"; readonly groupId: string; readonly generationId: number; readonly memberId: string }
  | {
      readonly kind: "offset-commit";
      readonly groupId: string;
      readonly generationId: number;
      readonly memberId: string;
      readonly retentionTimeMs: number;
      readonly topics: readonly DataCommitTopic[];
    }
  | { readonly kind: "offset-fetch"; readonly groupId: string; readonly topics: readonly DataFetchOffsetsTopic[] };

/** A request this world can read. */
export interface DataRequest {
  readonly kind: "request";
  readonly api: DataApi;
  readonly apiVersion: number;
  readonly correlationId: number;
  readonly clientId: string | null;
  readonly body: DataRequestBody;
}

/**
 * A request this world will not read, with the reason spelled out.
 *
 * Kept as its own variant rather than as a thrown error because it is an *answerable* condition: the
 * correlation id was read before the refusal happened, so the client can be told. A thrown error
 * would make it a connection failure, and "your version is not supported" and "the broker is down"
 * are two different things a reader must be able to tell apart.
 */
export interface DataUnsupportedRequest {
  readonly kind: "unsupported";
  readonly correlationId: number;
  readonly clientId: string | null;
  readonly apiKey: number;
  readonly apiVersion: number;
  readonly api: DataApi | null;
  readonly code: number;
  readonly reason: string;
}

/** A frame whose own header could not be read. It carries no correlation id, so it is not answered. */
export interface DataUnreadableRequest {
  readonly kind: "unreadable";
  readonly reason: string;
}

/** What `decodeRequestFrame` decided about one frame. */
export type DataDecodedFrame = DataRequest | DataUnsupportedRequest | DataUnreadableRequest;

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

function unsupportedVersionReason(api: DataApi, apiVersion: number): string {
  const spelling = dataApiSpelling(api);
  if (apiVersion >= api.flexibleFrom) {
    return `${spelling} asked for version ${apiVersion}, which is flexible; this world speaks the pre-flexible encoding only`;
  }
  return `${spelling} asked for version ${apiVersion}, which this world does not implement`;
}

/**
 * Read one request frame.
 *
 * The frame's own length prefix is consumed and checked against the bytes present, so a truncated
 * frame is refused *here* rather than one field later - a decoder that started reading a body whose
 * length the socket had not delivered would report a missing field at an offset that has no
 * relationship to the truncation.
 */
export function decodeRequestFrame(bytes: Buffer): DataDecodedFrame {
  let length: number;
  let header: WireReader;
  try {
    if (bytes.length < 4) {
      return { kind: "unreadable", reason: `a request frame is ${bytes.length} byte(s), too short to hold its own length` };
    }
    length = bytes.readInt32BE(0);
    if (length < 0) {
      return { kind: "unreadable", reason: `a request frame declared ${length} byte(s)` };
    }
    if (length > DATA_MAX_REQUEST_BYTES) {
      return {
        kind: "unreadable",
        reason: `a request frame declared ${length} byte(s), past the ${DATA_MAX_REQUEST_BYTES} byte ceiling`,
      };
    }
    if (bytes.length - 4 !== length) {
      return {
        kind: "unreadable",
        reason: `a request frame declared ${length} byte(s) and ${bytes.length - 4} follow its length field`,
      };
    }
    header = new WireReader(bytes.subarray(4));
  } catch (error) {
    return { kind: "unreadable", reason: reasonOf(error) };
  }

  let apiKey: number;
  let apiVersion: number;
  let correlationId: number;
  let clientId: string | null;
  try {
    apiKey = header.readInt16();
    apiVersion = header.readInt16();
    correlationId = header.readInt32();
    clientId = header.readNullableString();
  } catch (error) {
    return { kind: "unreadable", reason: reasonOf(error) };
  }

  const api = dataApiOf(apiKey);
  if (api === null) {
    return {
      kind: "unsupported",
      correlationId,
      clientId,
      apiKey,
      apiVersion,
      api: null,
      code: DATA_ERROR_CODES.UNSUPPORTED_VERSION,
      reason: `this world implements ${DATA_APIS.length} API(s) and API key ${apiKey} is not one of them`,
    };
  }
  if (!api.versions.includes(apiVersion)) {
    return {
      kind: "unsupported",
      correlationId,
      clientId,
      apiKey,
      apiVersion,
      api,
      code: DATA_ERROR_CODES.UNSUPPORTED_VERSION,
      reason: unsupportedVersionReason(api, apiVersion),
    };
  }

  const body = new WireReader(header.rest);
  let decoded: DataRequestBody;
  try {
    decoded = decodeBody(api, apiVersion, body);
  } catch (error) {
    return {
      kind: "unsupported",
      correlationId,
      clientId,
      apiKey,
      apiVersion,
      api,
      code: DATA_ERROR_CODES.CORRUPT_MESSAGE,
      reason: `${api.name} v${apiVersion} could not be read: ${reasonOf(error)}`,
    };
  }
  if (body.remaining !== 0) {
    return {
      kind: "unsupported",
      correlationId,
      clientId,
      apiKey,
      apiVersion,
      api,
      code: DATA_ERROR_CODES.INVALID_REQUEST,
      reason: `${api.name} v${apiVersion} carries ${body.remaining} byte(s) past the fields it declares`,
    };
  }
  return { kind: "request", api, apiVersion, correlationId, clientId, body: decoded };
}

function reasonOf(error: unknown): string {
  return error instanceof WireError ? error.message : String(error);
}

function readStringArray(reader: WireReader): readonly string[] | null {
  const count = reader.readArrayLength();
  if (count === -1) return null;
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(reader.readString());
  }
  return values;
}

function decodeBody(api: DataApi, apiVersion: number, reader: WireReader): DataRequestBody {
  switch (api.key) {
    case 0:
      return decodeProduce(reader);
    case 1:
      return decodeFetch(reader);
    case 2:
      return decodeListOffsets(apiVersion, reader);
    case 3:
      return { kind: "metadata", topics: readStringArray(reader) };
    case 8:
      return decodeOffsetCommit(reader);
    case 9:
      return decodeOffsetFetch(reader);
    case 10:
      return { kind: "find-coordinator", key: reader.readString() };
    case 11:
      return decodeJoinGroup(reader);
    case 12:
      return { kind: "heartbeat", groupId: reader.readString(), generationId: reader.readInt32(), memberId: reader.readString() };
    case 14:
      return decodeSyncGroup(reader);
    case 18:
      return { kind: "api-versions" };
    case 19:
      return decodeCreateTopics(reader);
    default:
      throw new WireError(`${dataApiSpelling(api)} has a register entry and no decoder`, reader.position);
  }
}

function decodeProduce(reader: WireReader): DataRequestBody {
  const acks = reader.readInt16();
  const timeoutMs = reader.readInt32();
  const topicCount = reader.readArrayLength();
  const topics: DataProduceTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const partitionCount = reader.readArrayLength();
    const partitions: DataProducePartition[] = [];
    for (let p = 0; p < partitionCount; p += 1) {
      partitions.push({ index: reader.readInt32(), records: reader.readNullableBytes() });
    }
    topics.push({ name, partitions });
  }
  return { kind: "produce", acks, timeoutMs, topics };
}

function decodeFetch(reader: WireReader): DataRequestBody {
  const replicaId = reader.readInt32();
  const maxWaitMs = reader.readInt32();
  const minBytes = reader.readInt32();
  const topicCount = reader.readArrayLength();
  const topics: DataFetchTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const partitionCount = reader.readArrayLength();
    const partitions: DataFetchPartition[] = [];
    for (let p = 0; p < partitionCount; p += 1) {
      partitions.push({ partition: reader.readInt32(), fetchOffset: reader.readInt64(), partitionMaxBytes: reader.readInt32() });
    }
    topics.push({ name, partitions });
  }
  return { kind: "fetch", replicaId, maxWaitMs, minBytes, topics };
}

function decodeListOffsets(apiVersion: number, reader: WireReader): DataRequestBody {
  const replicaId = reader.readInt32();
  const topicCount = reader.readArrayLength();
  const topics: DataListOffsetsTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const partitionCount = reader.readArrayLength();
    const partitions: DataListOffsetsPartition[] = [];
    for (let p = 0; p < partitionCount; p += 1) {
      const partitionIndex = reader.readInt32();
      const timestamp = reader.readInt64();
      const maxNumOffsets = apiVersion === 0 ? reader.readInt32() : null;
      partitions.push({ partitionIndex, timestamp, maxNumOffsets });
    }
    topics.push({ name, partitions });
  }
  return { kind: "list-offsets", replicaId, topics };
}

function decodeCreateTopics(reader: WireReader): DataRequestBody {
  const topicCount = reader.readArrayLength();
  const topics: DataNewTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const numPartitions = reader.readInt32();
    const replicationFactor = reader.readInt16();
    const assignmentCount = reader.readArrayLength();
    const assignments: DataReplicaAssignment[] = [];
    for (let a = 0; a < assignmentCount; a += 1) {
      const partitionIndex = reader.readInt32();
      const brokerCount = reader.readArrayLength();
      const brokerIds: number[] = [];
      for (let b = 0; b < brokerCount; b += 1) {
        brokerIds.push(reader.readInt32());
      }
      assignments.push({ partitionIndex, brokerIds });
    }
    const configCount = reader.readArrayLength();
    const configs: { name: string; value: string | null }[] = [];
    for (let c = 0; c < configCount; c += 1) {
      configs.push({ name: reader.readString(), value: reader.readNullableString() });
    }
    topics.push({ name, numPartitions, replicationFactor, assignments, configs });
  }
  return { kind: "create-topics", topics, timeoutMs: reader.readInt32() };
}

function decodeJoinGroup(reader: WireReader): DataRequestBody {
  const groupId = reader.readString();
  const sessionTimeoutMs = reader.readInt32();
  const memberId = reader.readString();
  const protocolType = reader.readString();
  const protocolCount = reader.readArrayLength();
  const protocols: DataGroupProtocol[] = [];
  for (let index = 0; index < protocolCount; index += 1) {
    protocols.push({ name: reader.readString(), metadata: reader.readNullableBytes() ?? Buffer.alloc(0) });
  }
  return { kind: "join-group", groupId, sessionTimeoutMs, memberId, protocolType, protocols };
}

function decodeSyncGroup(reader: WireReader): DataRequestBody {
  const groupId = reader.readString();
  const generationId = reader.readInt32();
  const memberId = reader.readString();
  const assignmentCount = reader.readArrayLength();
  const assignments: DataMemberAssignment[] = [];
  for (let index = 0; index < assignmentCount; index += 1) {
    assignments.push({ memberId: reader.readString(), assignment: reader.readNullableBytes() ?? Buffer.alloc(0) });
  }
  return { kind: "sync-group", groupId, generationId, memberId, assignments };
}

function decodeOffsetCommit(reader: WireReader): DataRequestBody {
  const groupId = reader.readString();
  const generationId = reader.readInt32();
  const memberId = reader.readString();
  const retentionTimeMs = reader.readInt64();
  const topicCount = reader.readArrayLength();
  const topics: DataCommitTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const partitionCount = reader.readArrayLength();
    const partitions: DataCommitPartition[] = [];
    for (let p = 0; p < partitionCount; p += 1) {
      partitions.push({ partitionIndex: reader.readInt32(), offset: reader.readInt64(), metadata: reader.readNullableString() });
    }
    topics.push({ name, partitions });
  }
  return { kind: "offset-commit", groupId, generationId, memberId, retentionTimeMs, topics };
}

function decodeOffsetFetch(reader: WireReader): DataRequestBody {
  const groupId = reader.readString();
  const topicCount = reader.readArrayLength();
  const topics: DataFetchOffsetsTopic[] = [];
  for (let t = 0; t < topicCount; t += 1) {
    const name = reader.readString();
    const partitionCount = reader.readArrayLength();
    const partitionIndexes: number[] = [];
    for (let p = 0; p < partitionCount; p += 1) {
      partitionIndexes.push(reader.readInt32());
    }
    topics.push({ name, partitionIndexes });
  }
  return { kind: "offset-fetch", groupId, topics };
}

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

/** Wrap a response body in this world's own response header and the frame's length prefix. */
export function encodeResponseFrame(correlationId: number, body: Buffer): Buffer {
  const writer = new WireWriter();
  writer.writeInt32(correlationId);
  writer.writeRaw(body);
  const framed = writer.toBuffer();

  const length = Buffer.allocUnsafe(4);
  length.writeInt32BE(framed.length, 0);
  return Buffer.concat([length, framed], framed.length + 4);
}

/** One partition's result in a `Produce` response. */
export interface DataProduceResult {
  readonly index: number;
  readonly errorCode: number;
  readonly baseOffset: number;
  readonly logAppendTime: number;
}

/** `Produce`'s response, in the version's own shape. */
export function encodeProduceResponse(
  apiVersion: number,
  topics: readonly { readonly name: string; readonly partitions: readonly DataProduceResult[] }[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt32(partition.index);
      writer.writeInt16(partition.errorCode);
      writer.writeInt64(partition.baseOffset);
      if (apiVersion >= 2) {
        writer.writeInt64(partition.logAppendTime);
      }
    }
  }
  return writer.toBuffer();
}

/** One partition's result in a `Fetch` response. */
export interface DataFetchResult {
  readonly partitionIndex: number;
  readonly errorCode: number;
  readonly highWatermark: number;
  readonly records: Buffer;
}

/** `Fetch`'s response, in the version's own shape. */
export function encodeFetchResponse(
  apiVersion: number,
  topics: readonly { readonly name: string; readonly partitions: readonly DataFetchResult[] }[],
  throttleTimeMs = 0,
): Buffer {
  const writer = new WireWriter();
  if (apiVersion >= 1) {
    writer.writeInt32(throttleTimeMs);
  }
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt32(partition.partitionIndex);
      writer.writeInt16(partition.errorCode);
      writer.writeInt64(partition.highWatermark);
      writer.writeBytes(partition.records);
    }
  }
  return writer.toBuffer();
}

/** One partition's result in a `ListOffsets` response. */
export interface DataListOffsetsResult {
  readonly partitionIndex: number;
  readonly errorCode: number;
  /** v0 carries a list and v1 a single `(timestamp, offset)` pair, so both shapes are supplied. */
  readonly offsets: readonly number[];
  readonly timestamp: number;
  readonly offset: number;
}

/** `ListOffsets`'s response, in the version's own shape. */
export function encodeListOffsetsResponse(
  apiVersion: number,
  topics: readonly { readonly name: string; readonly partitions: readonly DataListOffsetsResult[] }[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt32(partition.partitionIndex);
      writer.writeInt16(partition.errorCode);
      if (apiVersion === 0) {
        writer.writeArrayLength(partition.offsets.length);
        for (const offset of partition.offsets) {
          writer.writeInt64(offset);
        }
      } else {
        writer.writeInt64(partition.timestamp);
        writer.writeInt64(partition.offset);
      }
    }
  }
  return writer.toBuffer();
}

/** One partition in a `Metadata` response. */
export interface DataMetadataPartition {
  readonly errorCode: number;
  readonly partitionIndex: number;
  readonly leaderId: number;
  readonly replicas: readonly number[];
  readonly isr: readonly number[];
}

/** One topic in a `Metadata` response. */
export interface DataMetadataTopic {
  readonly errorCode: number;
  readonly name: string;
  readonly partitions: readonly DataMetadataPartition[];
}

/** `Metadata`'s response, in its one implemented version's shape. */
export function encodeMetadataResponse(
  brokers: readonly { readonly nodeId: number; readonly host: string; readonly port: number }[],
  topics: readonly DataMetadataTopic[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(brokers.length);
  for (const broker of brokers) {
    writer.writeInt32(broker.nodeId);
    writer.writeString(broker.host);
    writer.writeInt32(broker.port);
  }
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeInt16(topic.errorCode);
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt16(partition.errorCode);
      writer.writeInt32(partition.partitionIndex);
      writer.writeInt32(partition.leaderId);
      writer.writeArrayLength(partition.replicas.length);
      for (const replica of partition.replicas) {
        writer.writeInt32(replica);
      }
      writer.writeArrayLength(partition.isr.length);
      for (const replica of partition.isr) {
        writer.writeInt32(replica);
      }
    }
  }
  return writer.toBuffer();
}

/** `ApiVersions`'s response. The version list comes from the register, never from a literal. */
export function encodeApiVersionsResponse(errorCode: number, apis: readonly DataApi[] = DATA_APIS): Buffer {
  const writer = new WireWriter();
  writer.writeInt16(errorCode);
  writer.writeArrayLength(apis.length);
  for (const api of apis) {
    writer.writeInt16(api.key);
    writer.writeInt16(api.versions[0] ?? 0);
    writer.writeInt16(api.versions[api.versions.length - 1] ?? 0);
  }
  return writer.toBuffer();
}

/** `FindCoordinator`'s response. */
export function encodeFindCoordinatorResponse(
  errorCode: number,
  nodeId: number,
  host: string,
  port: number,
): Buffer {
  const writer = new WireWriter();
  writer.writeInt16(errorCode);
  writer.writeInt32(nodeId);
  writer.writeString(host);
  writer.writeInt32(port);
  return writer.toBuffer();
}

/** `JoinGroup`'s response. */
export function encodeJoinGroupResponse(input: {
  readonly errorCode: number;
  readonly generationId: number;
  readonly groupProtocol: string;
  readonly leaderId: string;
  readonly memberId: string;
  readonly members: readonly { readonly memberId: string; readonly metadata: Buffer }[];
}): Buffer {
  const writer = new WireWriter();
  writer.writeInt16(input.errorCode);
  writer.writeInt32(input.generationId);
  writer.writeString(input.groupProtocol);
  writer.writeString(input.leaderId);
  writer.writeString(input.memberId);
  writer.writeArrayLength(input.members.length);
  for (const member of input.members) {
    writer.writeString(member.memberId);
    writer.writeBytes(member.metadata);
  }
  return writer.toBuffer();
}

/** `SyncGroup`'s response. */
export function encodeSyncGroupResponse(errorCode: number, assignment: Buffer): Buffer {
  const writer = new WireWriter();
  writer.writeInt16(errorCode);
  writer.writeBytes(assignment);
  return writer.toBuffer();
}

/** `Heartbeat`'s response. */
export function encodeHeartbeatResponse(errorCode: number): Buffer {
  const writer = new WireWriter();
  writer.writeInt16(errorCode);
  return writer.toBuffer();
}

/** `CreateTopics`'s response. */
export function encodeCreateTopicsResponse(
  topics: readonly { readonly name: string; readonly errorCode: number }[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeInt16(topic.errorCode);
  }
  return writer.toBuffer();
}

/** `OffsetCommit`'s response. */
export function encodeOffsetCommitResponse(
  topics: readonly {
    readonly name: string;
    readonly partitions: readonly { readonly partitionIndex: number; readonly errorCode: number }[];
  }[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt32(partition.partitionIndex);
      writer.writeInt16(partition.errorCode);
    }
  }
  return writer.toBuffer();
}

/** One committed offset as `OffsetFetch` returns it. */
export interface DataFetchedOffset {
  readonly partitionIndex: number;
  readonly offset: number;
  readonly metadata: string | null;
  readonly errorCode: number;
}

/** `OffsetFetch`'s response. */
export function encodeOffsetFetchResponse(
  topics: readonly { readonly name: string; readonly partitions: readonly DataFetchedOffset[] }[],
): Buffer {
  const writer = new WireWriter();
  writer.writeArrayLength(topics.length);
  for (const topic of topics) {
    writer.writeString(topic.name);
    writer.writeArrayLength(topic.partitions.length);
    for (const partition of topic.partitions) {
      writer.writeInt32(partition.partitionIndex);
      writer.writeInt64(partition.offset);
      writer.writeNullableString(partition.metadata);
      writer.writeInt16(partition.errorCode);
    }
  }
  return writer.toBuffer();
}

/**
 * The response an unsupported or unreadable request is answered with.
 *
 * Built from the API's **lowest implemented version** shape and holding **zero** elements, because a
 * client refused before its body was read cannot be told which topics it asked about - the body was
 * never decoded, and inventing elements it did not send would be a response about a different
 * request. Where the shape has a top-level error slot, the code goes there; where it does not, the
 * zero-element body is the whole answer and the *refusal itself* is recorded in the world's own
 * action record so a criterion can read what the wire could not carry.
 */
export function encodeRefusalResponse(api: DataApi | null, code: number): Buffer {
  const lowest = api?.versions[0];
  switch (api?.key) {
    case 0:
      return encodeProduceResponse(lowest ?? 0, []);
    case 1:
      return encodeFetchResponse(lowest ?? 0, []);
    case 2:
      return encodeListOffsetsResponse(lowest ?? 0, []);
    case 3:
      return encodeMetadataResponse([], []);
    case 8:
      return encodeOffsetCommitResponse([]);
    case 9:
      return encodeOffsetFetchResponse([]);
    case 10:
      return encodeFindCoordinatorResponse(code, -1, "", -1);
    case 11:
      return encodeJoinGroupResponse({
        errorCode: code,
        generationId: -1,
        groupProtocol: "",
        leaderId: "",
        memberId: "",
        members: [],
      });
    case 12:
      return encodeHeartbeatResponse(code);
    case 14:
      return encodeSyncGroupResponse(code, Buffer.alloc(0));
    case 18:
      return encodeApiVersionsResponse(code);
    case 19:
      return encodeCreateTopicsResponse([]);
    default:
      return Buffer.alloc(0);
  }
}
