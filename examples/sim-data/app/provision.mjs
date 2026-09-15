/**
 * cart-broker - the application this world judges.
 *
 * It is a **real client**. It opens one TCP connection to the broker the world handed it in
 * `VERIDIAN_DATA_HOST` and `VERIDIAN_DATA_PORT`, writes real Kafka protocol frames - request header,
 * request body, and an `INT32` length prefix in front of the two - and reads the `INT32`
 * length-prefixed answers back. Nothing here knows the broker on the other end is a substitute, and
 * that is the point: the world is judged on what it holds after a program that speaks nothing but the
 * protocol has finished with it.
 *
 * ## What it provisions
 *
 *   - two topics, `cart-events` with three partitions and `cart-index` with one, both created with the
 *     default cleanup policy;
 *   - four order events, three routed to the first partition of the order log and one to the third, so
 *     the second is left empty on purpose - an empty partition is a reading, and a topic with one
 *     partition would not produce one;
 *   - the indexer's own checkpoint record in `cart-index`;
 *   - a consumer group, `cart-indexer`, joined at its first generation by one member that is handed the
 *     order log's three partitions;
 *   - the pipeline's position committed as the offset of the next record to deliver.
 *
 * ## What is fatal and what is only reported
 *
 * Creating a topic, producing a record and joining the group are fatal: a pipeline that cannot do
 * those has nothing to report, and it exits non-zero so the world records an application failure
 * rather than a set of criteria that failed for want of anything to judge. Everything else - the
 * inventory pass, the coordinator lookup, the heartbeat, the commit and the position read-back - is
 * *reported* and never fatal, and the line this program prints for each one says whether the broker
 * accepted it. That is a deliberate engineering choice and not a convenience: a client that exited
 * over a refused heartbeat would leave a half-provisioned world behind, and a criterion could then not
 * tell a refused heartbeat from a world that never started.
 *
 * ## It never reads its standard input
 *
 * The world starts this program with its input closed, so a prompt gets an immediate end-of-file
 * rather than a wait. Nothing here asks a question.
 *
 * ## The one line where an off-by-one lives
 *
 * A consumer commits the offset of the *next* record to deliver, so the position after reading three
 * records from the start of a log is `3` and not `2`. It is invisible from the log itself - every
 * record is there either way - and only the committed position says whether the pipeline will
 * re-deliver its third record on every restart.
 */

import { connect } from "node:net";

const RELEASE = "1.0.0";
const CLIENT_ID = "cart-broker";

/** Every record in this run carries the moment the run started. The world keeps whatever it is handed. */
const STARTED_AT = Date.now();

const REQUEST_TIMEOUT_MS = 30000;
const SESSION_TIMEOUT_MS = 10000;

/** The byte ceiling this client asks of one partition in the inventory pass. */
const READ_LIMIT_BYTES = 65536;

const GROUP_ID = "cart-indexer";
const PROTOCOL = "range";

/** The log this pipeline consumes, and the partition whose position it commits. */
const PIPELINE_LOG = "cart-events";
const PIPELINE_PARTITION = 0;

/** Where the checkpoint record goes, and what it is keyed by. */
const CHECKPOINT_LOG = "cart-index";
const CHECKPOINT_KEY = "index-cart-events";

/** The topics this pipeline needs, with the layout and the lifecycle it needs them to have. */
const TOPICS = [
  { name: "cart-events", partitions: 3, replication: 1, cleanup: "delete" },
  { name: "cart-index", partitions: 1, replication: 1, cleanup: "delete" },
];

/** Every order event, with the partition the partitioner routed it to. */
const ORDERS = [
  { partition: 0, key: "ord-1001" },
  { partition: 0, key: "ord-1002" },
  { partition: 0, key: "ord-1003" },
  { partition: 2, key: "ord-1004" },
];

/** The partitions the order table actually writes to, in order. Derived, so the two cannot disagree. */
const WRITTEN_PARTITIONS = [...new Set(ORDERS.map((order) => order.partition))].sort(
  (left, right) => left - right,
);

const ORDERS_IN_PIPELINE = ORDERS.filter((order) => order.partition === PIPELINE_PARTITION).length;

// The position this pipeline commits is the offset of the next record to deliver, which is the count
// of records that were delivered rather than the index of the last one.
const NEXT_OFFSET = ORDERS_IN_PIPELINE;

/** The assignment this member hands itself: the order log's partitions, in order. */
const ASSIGNED_PARTITIONS = [0, 1, 2];

/** The inventory pass: one fetch request per topic, each naming the partitions it wants to read. */
const FETCHES = [
  { topic: "cart-events", partitions: [0, 1, 2] },
  { topic: "cart-index", partitions: [0] },
];

/** The names of the error codes this client can meet, so a refusal is printed as a word. */
const ERROR_NAMES = new Map([
  [1, "OFFSET_OUT_OF_RANGE"],
  [2, "CORRUPT_MESSAGE"],
  [3, "UNKNOWN_TOPIC_OR_PARTITION"],
  [10, "MESSAGE_TOO_LARGE"],
  [16, "NOT_COORDINATOR"],
  [17, "INVALID_TOPIC_EXCEPTION"],
  [19, "NOT_ENOUGH_REPLICAS"],
  [21, "INVALID_REQUIRED_ACKS"],
  [22, "ILLEGAL_GENERATION"],
  [23, "INCONSISTENT_GROUP_PROTOCOL"],
  [24, "INVALID_GROUP_ID"],
  [25, "UNKNOWN_MEMBER_ID"],
  [26, "INVALID_SESSION_TIMEOUT"],
  [27, "REBALANCE_IN_PROGRESS"],
  [35, "UNSUPPORTED_VERSION"],
  [36, "TOPIC_ALREADY_EXISTS"],
  [37, "INVALID_PARTITIONS"],
  [38, "INVALID_REPLICATION_FACTOR"],
  [42, "INVALID_REQUEST"],
]);

let requests = 0;
let produced = 0;

function say(line) {
  process.stdout.write(`cart-broker: ${line}\n`);
}

function nonZero(codes) {
  return codes.filter((code) => code !== 0);
}

// ---------------------------------------------------------------------------------------------
// The wire grammar
//
// Every field is written big-endian, because that is what the protocol specifies and what the world
// reads. The varint is the zig-zag form the record grammar uses for lengths and deltas: a
// little-endian run of seven-bit groups, each carrying a continuation bit in its high bit.
// ---------------------------------------------------------------------------------------------

class Writer {
  #parts = [];
  #length = 0;

  #push(bytes) {
    this.#parts.push(bytes);
    this.#length += bytes.length;
    return this;
  }

  int8(value) {
    const one = Buffer.allocUnsafe(1);
    one.writeInt8(value, 0);
    return this.#push(one);
  }

  uint8(value) {
    const one = Buffer.allocUnsafe(1);
    one.writeUInt8(value & 0xff, 0);
    return this.#push(one);
  }

  int16(value) {
    const two = Buffer.allocUnsafe(2);
    two.writeInt16BE(value, 0);
    return this.#push(two);
  }

  int32(value) {
    const four = Buffer.allocUnsafe(4);
    four.writeInt32BE(value, 0);
    return this.#push(four);
  }

  uint32(value) {
    const four = Buffer.allocUnsafe(4);
    four.writeUInt32BE(value >>> 0, 0);
    return this.#push(four);
  }

  int64(value) {
    const eight = Buffer.allocUnsafe(8);
    eight.writeBigInt64BE(BigInt(value), 0);
    return this.#push(eight);
  }

  string(value) {
    const bytes = Buffer.from(value, "utf8");
    this.int16(bytes.length);
    return this.#push(bytes);
  }

  nullableString(value) {
    return value === null ? this.int16(-1) : this.string(value);
  }

  bytes(value) {
    if (value === null) return this.int32(-1);
    this.int32(value.length);
    return this.#push(value);
  }

  raw(value) {
    return this.#push(value);
  }

  varint(value) {
    let encoded = BigInt.asUintN(64, (BigInt(value) << 1n) ^ (BigInt(value) >> 63n));
    for (;;) {
      const byte = Number(encoded & 0x7fn);
      encoded >>= 7n;
      if (encoded === 0n) return this.uint8(byte);
      this.uint8(byte | 0x80);
    }
  }

  done() {
    return Buffer.concat(this.#parts, this.#length);
  }
}

class Reader {
  #bytes;
  #at = 0;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  get position() {
    return this.#at;
  }

  #need(count) {
    if (this.#at + count > this.#bytes.length) {
      throw new Error(
        `the broker's answer ended early: ${String(count)} byte(s) wanted at ${String(this.#at)}, ${String(this.#bytes.length)} present`,
      );
    }
    const at = this.#at;
    this.#at += count;
    return at;
  }

  int8() {
    return this.#bytes.readInt8(this.#need(1));
  }

  int16() {
    return this.#bytes.readInt16BE(this.#need(2));
  }

  int32() {
    return this.#bytes.readInt32BE(this.#need(4));
  }

  int64() {
    return Number(this.#bytes.readBigInt64BE(this.#need(8)));
  }

  string() {
    const length = this.int16();
    if (length < 0) return null;
    const at = this.#need(length);
    return this.#bytes.toString("utf8", at, at + length);
  }

  skip(count) {
    if (count > 0) this.#need(count);
    return count;
  }

  /** A `BYTES` field: an `INT32` length and then that many bytes. */
  skipBytes() {
    return this.skip(this.int32());
  }

  /** The bytes of an `INT32`-length-prefixed field, without a copy. */
  takeBytes() {
    const length = this.int32();
    if (length < 0) return Buffer.alloc(0);
    const at = this.#need(length);
    return this.#bytes.subarray(at, at + length);
  }
}

// ---------------------------------------------------------------------------------------------
// The record batch
// ---------------------------------------------------------------------------------------------

/** The reflected Castagnoli polynomial, which is the one the batch's `crc` field is computed with. */
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32C_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encode one record batch, uncompressed, magic 2.
 *
 * The head carries a base offset of `0` because the *broker* assigns offsets: a client says "here are
 * n records starting at my own zero" and the world rewrites the base on ingest. The `crc` covers
 * everything after itself, and the world verifies it - so a batch whose fields were written in the
 * wrong order is refused by name rather than silently mis-read.
 */
function encodeRecordBatch(records) {
  const body = new Writer();
  records.forEach((record, index) => {
    const payload = new Writer();
    payload.int8(0);
    payload.varint(0);
    payload.varint(index);
    const key = Buffer.from(record.key, "utf8");
    payload.varint(key.length);
    payload.raw(key);
    const value = Buffer.from(record.value, "utf8");
    payload.varint(value.length);
    payload.raw(value);
    payload.varint(0);
    const bytes = payload.done();
    body.varint(bytes.length);
    body.raw(bytes);
  });

  const tail = new Writer()
    .int16(0)
    .int32(records.length - 1)
    .int64(STARTED_AT)
    .int64(STARTED_AT)
    .int64(-1)
    .int16(-1)
    .int32(-1)
    .int32(records.length)
    .raw(body.done())
    .done();

  return new Writer()
    .int64(0)
    .int32(9 + tail.length)
    .int32(-1)
    .int8(2)
    .uint32(crc32c(tail))
    .raw(tail)
    .done();
}

/**
 * How many records a fetched batch says it holds.
 *
 * The count is the last field of the batch header, 57 bytes in: base offset, batch length, leader
 * epoch, magic, crc, attributes, last offset delta, first timestamp, max timestamp, producer id,
 * producer epoch and base sequence - then the count. Reading that one field is enough for an inventory
 * pass, which is asking whether the log came back rather than what each record says.
 */
function countInBatch(bytes) {
  return bytes.length < 61 ? 0 : bytes.readInt32BE(57);
}

/**
 * Encode a consumer group's assignment.
 *
 * The broker stores these bytes verbatim, hands them back verbatim and never parses them, so the only
 * thing anything in this world can say about an assignment is what this encoder made of this list.
 */
function encodeAssignment(entries) {
  const writer = new Writer();
  writer.int32(entries.length);
  for (const entry of entries) {
    writer.string(entry.topic);
    writer.int32(entry.partitions.length);
    for (const partition of entry.partitions) writer.int32(partition);
  }
  return writer.done();
}

// ---------------------------------------------------------------------------------------------
// The records this pipeline writes
// ---------------------------------------------------------------------------------------------

function orderRecord(order) {
  return { key: order.key, value: JSON.stringify({ order: order.key, release: RELEASE }) };
}

function checkpointRecord() {
  return {
    key: CHECKPOINT_KEY,
    value: JSON.stringify({
      checkpoint: PIPELINE_LOG,
      partition: PIPELINE_PARTITION,
      release: RELEASE,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The request bodies
// ---------------------------------------------------------------------------------------------

function createTopicsBody() {
  const writer = new Writer();
  writer.int32(TOPICS.length);
  for (const topic of TOPICS) {
    writer.string(topic.name);
    writer.int32(topic.partitions);
    writer.int16(topic.replication);
    writer.int32(0);
    writer.int32(1);
    writer.string("cleanup.policy");
    writer.nullableString(topic.cleanup);
  }
  writer.int32(REQUEST_TIMEOUT_MS);
  return writer.done();
}

function metadataBody(names) {
  const writer = new Writer();
  writer.int32(names.length);
  for (const name of names) writer.string(name);
  return writer.done();
}

function produceBody(topic, partition, records) {
  const writer = new Writer();
  writer.int16(1);
  writer.int32(REQUEST_TIMEOUT_MS);
  writer.int32(1);
  writer.string(topic);
  writer.int32(1);
  writer.int32(partition);
  writer.bytes(encodeRecordBatch(records));
  return writer.done();
}

function fetchBody(entry) {
  const writer = new Writer();
  writer.int32(-1);
  writer.int32(REQUEST_TIMEOUT_MS);
  writer.int32(1);
  writer.int32(1);
  writer.string(entry.topic);
  writer.int32(entry.partitions.length);
  for (const partition of entry.partitions) {
    writer.int32(partition);
    writer.int64(0);
    writer.int32(READ_LIMIT_BYTES);
  }
  return writer.done();
}

function joinBody() {
  const writer = new Writer();
  writer.string(GROUP_ID);
  writer.int32(SESSION_TIMEOUT_MS);
  writer.string("");
  writer.string(PROTOCOL);
  writer.int32(1);
  writer.string(PROTOCOL);
  writer.bytes(Buffer.from(`${GROUP_ID}/${RELEASE}`, "utf8"));
  return writer.done();
}

function syncBody(generationId, memberId) {
  const writer = new Writer();
  writer.string(GROUP_ID);
  writer.int32(generationId);
  writer.string(memberId);
  writer.int32(1);
  writer.string(memberId);
  writer.bytes(encodeAssignment([{ topic: PIPELINE_LOG, partitions: ASSIGNED_PARTITIONS }]));
  return writer.done();
}

function heartbeatBody(generationId, memberId) {
  const writer = new Writer();
  writer.string(GROUP_ID);
  writer.int32(generationId);
  writer.string(memberId);
  return writer.done();
}

function commitBody(generationId, memberId, offset) {
  const writer = new Writer();
  writer.string(GROUP_ID);
  writer.int32(generationId);
  writer.string(memberId);
  writer.int64(-1);
  writer.int32(1);
  writer.string(PIPELINE_LOG);
  writer.int32(1);
  writer.int32(PIPELINE_PARTITION);
  writer.int64(offset);
  writer.nullableString(null);
  return writer.done();
}

function offsetFetchBody() {
  const writer = new Writer();
  writer.string(GROUP_ID);
  writer.int32(1);
  writer.string(PIPELINE_LOG);
  writer.int32(1);
  writer.int32(PIPELINE_PARTITION);
  return writer.done();
}

// ---------------------------------------------------------------------------------------------
// The answers
//
// Each decoder reads exactly the fields the version it asked for carries, and returns the non-zero
// error codes it found. A reply with no codes at all is the broker saying yes.
// ---------------------------------------------------------------------------------------------

function decodeApiVersions(reader) {
  const errorCode = reader.int16();
  const count = reader.int32();
  for (let index = 0; index < count; index += 1) {
    reader.int16();
    reader.int16();
    reader.int16();
  }
  return { codes: nonZero([errorCode]), extra: { apis: count } };
}

function decodeCreateTopics(reader) {
  const codes = [];
  const count = reader.int32();
  for (let index = 0; index < count; index += 1) {
    reader.string();
    codes.push(reader.int16());
  }
  return { codes: nonZero(codes), extra: { topics: count } };
}

function decodeMetadata(reader) {
  const codes = [];
  const brokers = reader.int32();
  for (let index = 0; index < brokers; index += 1) {
    reader.int32();
    reader.string();
    reader.int32();
  }
  const topics = reader.int32();
  for (let index = 0; index < topics; index += 1) {
    codes.push(reader.int16());
    reader.string();
    const partitions = reader.int32();
    for (let at = 0; at < partitions; at += 1) {
      codes.push(reader.int16());
      reader.int32();
      reader.int32();
      const replicas = reader.int32();
      for (let one = 0; one < replicas; one += 1) reader.int32();
      const isr = reader.int32();
      for (let one = 0; one < isr; one += 1) reader.int32();
    }
  }
  return { codes: nonZero(codes), extra: { brokers, topics } };
}

function decodeProduce(reader) {
  const codes = [];
  const bases = [];
  const topics = reader.int32();
  for (let index = 0; index < topics; index += 1) {
    reader.string();
    const partitions = reader.int32();
    for (let at = 0; at < partitions; at += 1) {
      reader.int32();
      codes.push(reader.int16());
      bases.push(reader.int64());
    }
  }
  return { codes: nonZero(codes), extra: { baseOffset: bases[0] ?? 0 } };
}

function decodeFetch(reader) {
  const codes = [];
  let bytes = 0;
  let records = 0;
  // No throttle field, because this client asks for version 0 and version 0 has none. Reading one
  // would consume the topic count and report every following field one slot early.
  const topics = reader.int32();
  for (let index = 0; index < topics; index += 1) {
    reader.string();
    const partitions = reader.int32();
    for (let at = 0; at < partitions; at += 1) {
      reader.int32();
      codes.push(reader.int16());
      reader.int64();
      const batch = reader.takeBytes();
      bytes += batch.length;
      records += countInBatch(batch);
    }
  }
  return { codes: nonZero(codes), extra: { bytes, records } };
}

function decodeFindCoordinator(reader) {
  const errorCode = reader.int16();
  reader.int32();
  reader.string();
  reader.int32();
  return { codes: nonZero([errorCode]), extra: {} };
}

function decodeJoinGroup(reader) {
  const errorCode = reader.int16();
  const generationId = reader.int32();
  reader.string();
  reader.string();
  const memberId = reader.string();
  const members = reader.int32();
  for (let index = 0; index < members; index += 1) {
    reader.string();
    reader.skipBytes();
  }
  return { codes: nonZero([errorCode]), extra: { generationId, memberId, members } };
}

function decodeSyncGroup(reader) {
  const errorCode = reader.int16();
  const assignmentBytes = reader.skipBytes();
  return { codes: nonZero([errorCode]), extra: { assignmentBytes } };
}

function decodeHeartbeat(reader) {
  return { codes: nonZero([reader.int16()]), extra: {} };
}

function decodeOffsetCommit(reader) {
  const codes = [];
  const topics = reader.int32();
  for (let index = 0; index < topics; index += 1) {
    reader.string();
    const partitions = reader.int32();
    for (let at = 0; at < partitions; at += 1) {
      reader.int32();
      codes.push(reader.int16());
    }
  }
  return { codes: nonZero(codes), extra: {} };
}

function decodeOffsetFetch(reader) {
  const codes = [];
  const positions = [];
  const topics = reader.int32();
  for (let index = 0; index < topics; index += 1) {
    reader.string();
    const partitions = reader.int32();
    for (let at = 0; at < partitions; at += 1) {
      reader.int32();
      positions.push(reader.int64());
      reader.string();
      codes.push(reader.int16());
    }
  }
  return { codes: nonZero(codes), extra: { positions } };
}

// ---------------------------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------------------------

/**
 * Read one length-prefixed frame off a socket, in order.
 *
 * The length prefix is why a client can tell where one answer ends: the world writes an `INT32` count
 * of the bytes that follow, and a reader that ignored it would read two answers as one. Frames are
 * handed out in the order the socket delivered them, which is the order the broker answered in, and a
 * close or an error before a pending read rejects it rather than leaving it waiting.
 */
function frameReader(socket) {
  let buffer = Buffer.alloc(0);
  let failure = null;
  const waiting = [];

  const pump = () => {
    while (waiting.length > 0) {
      const waiter = waiting[0];
      if (failure !== null) {
        waiting.shift();
        waiter.reject(failure);
        continue;
      }
      if (buffer.length < 4) return;
      const length = buffer.readInt32BE(0);
      if (length < 0 || buffer.length < 4 + length) return;
      const frame = Buffer.from(buffer.subarray(4, 4 + length));
      buffer = buffer.subarray(4 + length);
      waiting.shift();
      waiter.resolve(frame);
    }
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  socket.on("error", (error) => {
    failure = error;
    pump();
  });
  socket.on("close", () => {
    failure = failure ?? new Error("the broker closed the connection");
    pump();
  });

  return () =>
    new Promise((resolve, reject) => {
      if (failure !== null) {
        reject(failure);
        return;
      }
      waiting.push({ resolve, reject });
      pump();
    });
}

async function main() {
  const host = process.env.VERIDIAN_DATA_HOST ?? "127.0.0.1";
  const port = Number(process.env.VERIDIAN_DATA_PORT ?? "0");

  let correlation = 0;
  const nextFrame = await new Promise((resolve, reject) => {
    const socket = connect({ host, port }, () => {
      resolve({ socket, read: frameReader(socket) });
    });
    socket.on("error", reject);
  });
  const { socket, read } = nextFrame;

  say(`connected to ${host}:${String(port)} as ${CLIENT_ID}`);

  async function send(apiKey, apiVersion, body, decode) {
    correlation += 1;
    const header = new Writer()
      .int16(apiKey)
      .int16(apiVersion)
      .int32(correlation)
      .nullableString(CLIENT_ID);
    const frame = Buffer.concat([header.done(), body]);
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeInt32BE(frame.length, 0);
    requests += 1;
    socket.write(Buffer.concat([prefix, frame]));
    const answer = new Reader(await read());
    const seen = answer.int32();
    if (seen !== correlation) {
      throw new Error(`the broker answered correlation id ${String(seen)} to request ${String(correlation)}`);
    }
    return decode(answer);
  }

  function note(step, codes) {
    if (codes.length === 0) {
      say(`${step} -> ok`);
      return;
    }
    const named = codes.map((code) => ERROR_NAMES.get(code) ?? `code ${String(code)}`);
    say(`${step} -> refused (${named.join(", ")})`);
  }

  // 1. The version negotiation every conforming client opens with.
  note("ApiVersions", (await send(18, 0, Buffer.alloc(0), decodeApiVersions)).codes);

  // 2. The topics, and this is fatal: without them there is nothing to write to.
  const created = await send(19, 0, createTopicsBody(), decodeCreateTopics);
  note("CreateTopics", created.codes);
  if (created.codes.length > 0) {
    throw new Error(`the broker refused one of the topics this pipeline needs: ${created.codes.join(", ")}`);
  }
  say(`  created ${String(TOPICS.length)} topic(s): ${TOPICS.map((topic) => topic.name).join(", ")}`);

  // 3. The layout the broker holds, asked for rather than assumed.
  const metadata = await send(
    3,
    0,
    metadataBody(TOPICS.map((topic) => topic.name)),
    decodeMetadata,
  );
  note("Metadata", metadata.codes);
  say(`  the broker reports ${String(metadata.extra.brokers)} broker(s) and ${String(metadata.extra.topics)} topic(s)`);

  // 4. The order events, one produce request per partition that has any.
  for (const partition of WRITTEN_PARTITIONS) {
    const records = ORDERS.filter((order) => order.partition === partition).map(orderRecord);
    const answer = await send(0, 0, produceBody(PIPELINE_LOG, partition, records), decodeProduce);
    note(`Produce ${PIPELINE_LOG}/${String(partition)}`, answer.codes);
    say(`  ${String(records.length)} record(s) from offset ${String(answer.extra.baseOffset)}`);
    produced += records.length;
  }

  // 5. The indexer's checkpoint, in the topic the index is kept in.
  const checkpoint = await send(
    0,
    0,
    produceBody(CHECKPOINT_LOG, 0, [checkpointRecord()]),
    decodeProduce,
  );
  note(`Produce ${CHECKPOINT_LOG}/0`, checkpoint.codes);
  produced += 1;

  // 6. The inventory pass: read every log back and say how much came out.
  for (const entry of FETCHES) {
    // Fetch is asked at version 0 for the same reason every other request is asked at the lowest
    // version its API declares: this broker answers the lowest version it holds, and a request at a
    // version it does not hold comes back as a refusal rather than as a body. Version 1 is not one
    // of the two it holds, which is the whole reason this line says 0.
    const answer = await send(1, 0, fetchBody(entry), decodeFetch);
    note(`Fetch ${entry.topic}`, answer.codes);
    say(
      `  ${entry.topic}: ${String(answer.extra.records)} record(s) in ${String(answer.extra.bytes)} byte(s) of batch`,
    );
  }

  // 7. The group. Joining is fatal, because everything after it needs the member id and the generation.
  note("FindCoordinator", (await send(10, 0, new Writer().string(GROUP_ID).done(), decodeFindCoordinator)).codes);

  const joined = await send(11, 0, joinBody(), decodeJoinGroup);
  note("JoinGroup", joined.codes);
  if (joined.codes.length > 0 || joined.extra.memberId === null) {
    throw new Error(`the broker did not admit this member to ${GROUP_ID}`);
  }
  say(
    `  member '${joined.extra.memberId}' joined ${GROUP_ID} at generation ${String(joined.extra.generationId)}`,
  );

  const synced = await send(14, 0, syncBody(joined.extra.generationId, joined.extra.memberId), decodeSyncGroup);
  note("SyncGroup", synced.codes);
  say(`  assigned ${String(synced.extra.assignmentBytes)} byte(s) of assignment`);

  // A heartbeat carries the generation the broker handed this member at the join. A broker refuses one
  // whose generation has moved on, which is how a client learns its membership is gone before it goes
  // on reading a log nobody is coordinating.
  const heartbeat = await send(12, 0, heartbeatBody(joined.extra.generationId, joined.extra.memberId), decodeHeartbeat);
  note("Heartbeat", heartbeat.codes);

  const committed = await send(
    8,
    2,
    commitBody(joined.extra.generationId, joined.extra.memberId, NEXT_OFFSET),
    decodeOffsetCommit,
  );
  note("OffsetCommit", committed.codes);

  const position = await send(9, 1, offsetFetchBody(), decodeOffsetFetch);
  note("OffsetFetch", position.codes);
  say(`  the group's position for ${PIPELINE_LOG}/${String(PIPELINE_PARTITION)} reads ${String(position.extra.positions[0] ?? -1)}`);

  socket.end();

  say(`cart-broker provisioned: ${String(requests)} requests, ${String(TOPICS.length)} topics, ${String(produced)} records`);
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    process.stderr.write(`cart-broker: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
