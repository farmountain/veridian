/**
 * The substitute broker's two doors.
 *
 * `protocol.test.ts` holds the decoder and the encoders as pure functions. This file holds the
 * world around them: a real TCP listener, the reassembly that turns a byte stream back into frames,
 * the register of commands a criterion may issue, and the state a snapshot reads.
 *
 * There is no request encoder anywhere in this file, for the reason `wire.test.ts` assembles a
 * batch by hand and `protocol.test.ts` composes every frame by hand: a frame built by a sibling
 * function that shares a bug with the decoder would agree with it, and the agreement would be the
 * defect. The bodies below are written out of `WireWriter` primitives in the order the *decoders*
 * read them, which is why the order is asserted rather than assumed.
 *
 * The one thing the tests do reuse is `encodeRecordBatch`, because the subject here is the broker
 * and not the batch layout: `wire.test.ts` holds that encoder against a hand-assembled byte string,
 * so a batch reaching this suite has already been independently checked.
 *
 * Every wait is keyed on a condition - a frame having arrived, or the socket having closed - and
 * never on a turn of the event loop. A wait on a schedule reports the machine's timing rather than
 * the broker's behaviour, which is the defect the Cockpit's smoke test paid for. The bound in
 * `BrokerClient` exists only so that a broker which answers nothing fails a test instead of
 * stalling the suite, and it never decides what the answer was.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DATA_COMMAND_WORDS,
  DATA_SIMULATED_SURFACES,
  dataCommandUsage,
  tcpData,
  type DataPort,
} from "./data-port.ts";
import {
  DATA_APIS,
  DATA_ERROR_CODES,
  DATA_MAX_REQUEST_BYTES,
  dataApiSpelling,
  decodeRequestFrame,
} from "./protocol.ts";
import { WireReader, WireWriter, encodeRecordBatch } from "./wire.ts";
import { DATA_SIMULATED_SURFACES as DECLARED_SURFACES } from "../../core/environment/data-observation.ts";

const HOST = "127.0.0.1";

/** How long a test will wait for the world before calling the world wrong. */
const PATIENCE_MS = 5000;

// ---------------------------------------------------------------------------------------------
// Request frames, composed by hand
// ---------------------------------------------------------------------------------------------

/**
 * One request frame: the world's own header, then the caller's body, then the length prefix.
 *
 * The prefix is `INT32` **big endian** and so is every field inside it, which is this world's own
 * format rather than Kafka's - and it is the reason a response is read back through
 * `responseBody()` rather than from byte zero.
 */
function requestFrame(
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

/** The body of a response frame, past the length prefix. Its first field is the correlation id. */
function responseBody(frame: Buffer): WireReader {
  return new WireReader(frame.subarray(4));
}

function emptyBody(): Buffer {
  return Buffer.alloc(0);
}

/** A `Metadata` body. `null` is "every topic" and an empty array is "no topic at all". */
function metadataBody(topics: readonly string[] | null): Buffer {
  const body = new WireWriter();
  if (topics === null) {
    body.writeInt32(-1);
    return body.toBuffer();
  }
  body.writeArrayLength(topics.length);
  for (const name of topics) body.writeString(name);
  return body.toBuffer();
}

function createTopicsBody(name: string, numPartitions: number, replicationFactor: number): Buffer {
  const body = new WireWriter();
  body.writeArrayLength(1);
  body.writeString(name);
  body.writeInt32(numPartitions);
  body.writeInt16(replicationFactor);
  body.writeArrayLength(0); // replica assignments
  body.writeArrayLength(0); // topic configs
  body.writeInt32(1000);
  return body.toBuffer();
}

function produceBody(
  name: string,
  partition: number,
  records: Buffer | null,
  acks: number,
): Buffer {
  const body = new WireWriter();
  body.writeInt16(acks);
  body.writeInt32(1000);
  body.writeArrayLength(1);
  body.writeString(name);
  body.writeArrayLength(1);
  body.writeInt32(partition);
  body.writeBytes(records);
  return body.toBuffer();
}

/** One record's worth of a batch, by the `Produce` body above or by a criterion's own command. */
function oneRecord(key: string, value: string): Buffer {
  return encodeRecordBatch({
    baseOffset: 0,
    records: [
      {
        offset: null,
        timestamp: null,
        key: Buffer.from(key, "utf8"),
        value: Buffer.from(value, "utf8"),
        headers: [],
      },
    ],
    firstTimestamp: 0,
    maxTimestamp: 0,
  });
}

function fetchBody(
  name: string,
  partition: number,
  fetchOffset: number,
  partitionMaxBytes: number,
): Buffer {
  const body = new WireWriter();
  body.writeInt32(-1); // replica id
  body.writeInt32(0); // max wait
  body.writeInt32(1); // min bytes
  body.writeArrayLength(1);
  body.writeString(name);
  body.writeArrayLength(1);
  body.writeInt32(partition);
  body.writeInt64(fetchOffset);
  body.writeInt32(partitionMaxBytes);
  return body.toBuffer();
}

/** A `ListOffsets` body. `maxNumOffsets` exists in v0's body and not in v1's, so it is optional. */
function listOffsetsBody(name: string, partition: number, maxNumOffsets: number | null): Buffer {
  const body = new WireWriter();
  body.writeInt32(-1);
  body.writeArrayLength(1);
  body.writeString(name);
  body.writeArrayLength(1);
  body.writeInt32(partition);
  body.writeInt64(-1); // log end
  if (maxNumOffsets !== null) body.writeInt32(maxNumOffsets);
  return body.toBuffer();
}

function joinGroupBody(
  groupId: string,
  memberId: string,
  sessionTimeoutMs: number,
  protocolType = "consumer",
): Buffer {
  const body = new WireWriter();
  body.writeString(groupId);
  body.writeInt32(sessionTimeoutMs);
  body.writeString(memberId);
  body.writeString(protocolType);
  body.writeArrayLength(1);
  body.writeString("range");
  body.writeBytes(Buffer.from("meta", "utf8"));
  return body.toBuffer();
}

function commitBody(
  groupId: string,
  generationId: number,
  memberId: string,
  name: string,
  partition: number,
  offset: number,
): Buffer {
  const body = new WireWriter();
  body.writeString(groupId);
  body.writeInt32(generationId);
  body.writeString(memberId);
  body.writeInt64(-1); // retention time
  body.writeArrayLength(1);
  body.writeString(name);
  body.writeArrayLength(1);
  body.writeInt32(partition);
  body.writeInt64(offset);
  body.writeNullableString(null);
  return body.toBuffer();
}

// ---------------------------------------------------------------------------------------------
// One connection, scripted
// ---------------------------------------------------------------------------------------------

interface Waiter {
  readonly check: () => boolean;
  readonly settle: () => void;
  readonly fail: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * One connection to the broker, with waits that are keyed on a condition.
 *
 * `frames()` returns each frame **as it arrived**: whole, in arrival order, and with its 4-byte
 * length prefix included - a trailing partial frame is not one of them, so a test that writes half.
 */
class BrokerClient {
  readonly #socket: Socket;
  #received: Buffer = Buffer.alloc(0);
  #closed = false;
  #failure: Error | null = null;
  #waiters: Waiter[] = [];

  constructor(port: number) {
    this.#socket = createConnection({ host: HOST, port });
    this.#socket.setNoDelay(true);
    this.#socket.on("data", (chunk: Buffer) => {
      this.#received = Buffer.concat([this.#received, chunk]);
      this.#wake();
    });
    this.#socket.on("close", () => {
      this.#closed = true;
      this.#wake();
    });
    this.#socket.on("error", (error: Error) => {
      this.#failure = error;
      this.#wake();
    });
  }

  write(bytes: Buffer): void {
    this.#socket.write(bytes);
  }

  /** The bytes that arrived, whole frames and partial ones alike. */
  received(): Buffer {
    return this.#received;
  }

  /** The response frames that arrived whole, in the order the world wrote them. */
  frames(): readonly Buffer[] {
    const frames: Buffer[] = [];
    let at = 0;
    while (this.#received.length - at >= 4) {
      const length = this.#received.readInt32BE(at);
      if (length < 0 || this.#received.length - at - 4 < length) break;
      frames.push(this.#received.subarray(at, at + 4 + length));
      at += length + 4;
    }
    return frames;
  }

  async frameAt(index: number): Promise<Buffer> {
    await this.#wait(() => this.frames().length > index, `answered frame ${String(index)}`);
    const frame = this.frames()[index];
    if (frame === undefined) throw new Error("a frame was awaited and is not there");
    return frame;
  }

  /** The correlation id of the `index`th answer, which is the field the header was built around. */
  async answerTo(index: number): Promise<number> {
    return responseBody(await this.frameAt(index)).readInt32();
  }

  async closed(): Promise<void> {
    await this.#wait(() => this.#closed || this.#failure !== null, "closed the connection");
    assert.equal(this.#closed, true, `the connection did not close: ${String(this.#failure)}`);
  }

  close(): void {
    this.#socket.destroy();
  }

  #wait(check: () => boolean, what: string): Promise<void> {
    if (check()) return Promise.resolve();
    if (this.#failure !== null) return Promise.reject(this.#failure);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((held) => held.timer !== timer);
        reject(new Error(`the broker never ${what}`));
      }, PATIENCE_MS);
      this.#waiters.push({ check, settle: resolve, fail: reject, timer });
    });
  }

  #wake(): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.#waiters) {
      // The condition is asked first: a socket that closes after a refusal is both `closed` and
      // `errored`, and the wait that was promised a close has been answered either way.
      if (waiter.check()) {
        clearTimeout(waiter.timer);
        waiter.settle();
        continue;
      }
      if (this.#failure !== null) {
        clearTimeout(waiter.timer);
        waiter.fail(this.#failure);
        continue;
      }
      remaining.push(waiter);
    }
    this.#waiters = remaining;
  }
}

// ---------------------------------------------------------------------------------------------
// A broker, opened and closed around a test
// ---------------------------------------------------------------------------------------------

interface Held {
  readonly port: DataPort;
  readonly endpoint: number;
  readonly address: string;
}

async function withBroker(
  body: (held: Held) => Promise<void> | void,
  fields: { readonly cluster?: string; readonly nodeId?: number } = {},
): Promise<void> {
  const port = tcpData({
    cluster: fields.cluster ?? "cart",
    nodeId: fields.nodeId ?? 1,
    host: HOST,
    port: 0,
  });
  try {
    const address = await port.listen({ host: HOST, port: 0 });
    await body({ port, endpoint: port.snapshot().node.port, address });
  } finally {
    await port.close();
  }
}

/** An element the test has already established is there. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`nothing at index ${String(index)}`);
  return value;
}


// ---------------------------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------------------------

describe("the transport", () => {
  it("answers two frames that arrived in one chunk, in the order they arrived", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const first = requestFrame(18, 0, 7, "cart-web", emptyBody());
      const second = requestFrame(18, 0, 8, null, emptyBody());
      try {
        client.write(Buffer.concat([first, second]));

        assert.equal(await client.answerTo(0), 7);
        assert.equal(await client.answerTo(1), 8);

        // A frame is its prefix and its body: the prefix declares how long the body is, and a test
        // can hold the two against each other rather than trusting the split that produced them.
        const firstAnswer = at(client.frames(), 0);
        assert.equal(firstAnswer.readInt32BE(0), firstAnswer.length - 4);

        const records = port.requests();
        assert.equal(records.length, 2);
        assert.deepEqual(
          records.map((record) => record.correlationId),
          [7, 8],
        );
        // The bytes counted are the frames, length prefix included: a request is what arrived.
        assert.deepEqual(
          records.map((record) => record.bytesIn),
          [first.length, second.length],
        );
        assert.deepEqual(
          records.map((record) => record.source),
          ["application", "application"],
        );
      } finally {
        client.close();
      }
    });
  });

  it("holds half a request until the rest of it arrives", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const first = requestFrame(18, 0, 1, null, emptyBody());
      const second = requestFrame(18, 0, 2, null, emptyBody());
      const split = 5;
      try {
        client.write(Buffer.concat([first, second.subarray(0, split)]));
        assert.equal(await client.answerTo(0), 1);
        // A partial frame is not a request, so the world has answered once and once only.
        assert.equal(port.requests().length, 1);
        assert.equal(client.frames().length, 1);

        client.write(second.subarray(split));
        assert.equal(await client.answerTo(1), 2);
        assert.equal(port.requests().length, 2);
        assert.equal(at(port.requests(), 1).bytesIn, second.length);
      } finally {
        client.close();
      }
    });
  });

  it("reads the client id from the header, because a JoinGroup body has no such field", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(11, 0, 4, "cart-web", joinGroupBody("cart-group", "", 30000)));
        assert.equal(await client.answerTo(0), 4);

        const record = at(port.requests(), 0);
        assert.equal(record.clientId, "cart-web");
        const member = at(at(port.snapshot().groups, 0).members, 0);
        assert.equal(member.clientId, "cart-web");
      } finally {
        client.close();
      }
    });
  });

  it("records a header with no client id as null while the member it mints is an empty string", async () => {
    // These are two different readings of one absence: the *request* carried no client id, and the
    // *member* holds the empty string because a member's client id is a string field. Collapsing
    // them would make a criterion that asks about the header answer a question about the group.
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(11, 0, 5, null, joinGroupBody("cart-group", "", 30000)));
        assert.equal(await client.answerTo(0), 5);

        assert.equal(at(port.requests(), 0).clientId, null);
        assert.equal(at(at(port.snapshot().groups, 0).members, 0).clientId, "");
      } finally {
        client.close();
      }
    });
  });

  it("refuses a negative declared length without buffering what follows it", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const prefix = Buffer.allocUnsafe(4);
      prefix.writeInt32BE(-1, 0);
      try {
        // A well-formed frame follows the bad prefix, and the point is that it is never read.
        client.write(Buffer.concat([prefix, requestFrame(18, 0, 1, null, emptyBody())]));
        await client.closed();

        assert.equal(client.frames().length, 0);
        const records = port.requests();
        assert.equal(records.length, 1);
        assert.equal(at(records, 0).result, "unreadable");
        assert.equal(at(records, 0).bytesIn, 4);
        assert.equal(at(records, 0).correlationId, null);
        assert.match(at(records, 0).reason ?? "", /-1 byte\(s\)/);
      } finally {
        client.close();
      }
    });
  });

  it("refuses a declared length past the ceiling, naming the ceiling", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const prefix = Buffer.allocUnsafe(4);
      const declared = DATA_MAX_REQUEST_BYTES + 1;
      prefix.writeInt32BE(declared, 0);
      try {
        client.write(prefix);
        await client.closed();

        assert.equal(client.frames().length, 0);
        const record = at(port.requests(), 0);
        assert.equal(record.result, "unreadable");
        assert.equal(record.bytesIn, 4);
        assert.match(record.reason ?? "", new RegExp(`${String(declared)} byte\\(s\\), past the ${String(DATA_MAX_REQUEST_BYTES)}`));
      } finally {
        client.close();
      }
    });
  });

  it("tells the transport's refusal of a bad length in the decoder's own words", async () => {
    // Two implementations of one rule, and nothing but this assertion reconciles them: the
    // transport guards *before* buffering and `decodeRequestFrame` guards when it is handed a
    // frame, so the two messages are written twice and can drift apart in silence.
    for (const declared of [-1, DATA_MAX_REQUEST_BYTES + 1]) {
      await withBroker(async ({ port, endpoint }) => {
        const client = new BrokerClient(endpoint);
        const prefix = Buffer.allocUnsafe(4);
        prefix.writeInt32BE(declared, 0);
        try {
          client.write(prefix);
          await client.closed();
          const record = at(port.requests(), 0);
          const decoded = decodeRequestFrame(prefix);
          assert.equal(decoded.kind, "unreadable");
          assert.equal(
            record.reason,
            decoded.kind === "unreadable" ? decoded.reason : "",
            `the transport and the decoder disagree about a frame declaring ${String(declared)}`,
          );
        } finally {
          client.close();
        }
      });
    }
  });

  it("refuses a frame too short to hold its own header, and writes nothing back", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const prefix = Buffer.allocUnsafe(4);
      prefix.writeInt32BE(0, 0);
      try {
        client.write(prefix);
        await client.closed();

        assert.equal(client.frames().length, 0);
        const record = at(port.requests(), 0);
        assert.equal(record.result, "unreadable");
        assert.equal(record.api, "unreadable frame");
        assert.equal(record.apiKey, -1);
        assert.equal(record.apiVersion, -1);
        assert.equal(record.errorCode, DATA_ERROR_CODES.INVALID_REQUEST);
        assert.match(record.reason ?? "", /the frame ends before/);
      } finally {
        client.close();
      }
    });
  });

  it("answers an unknown API key instead of dropping the connection", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(99, 0, 3, null, emptyBody()));
        assert.equal(await client.answerTo(0), 3);

        const record = at(port.requests(), 0);
        assert.equal(record.result, "unknown-api");
        assert.equal(record.errorCode, DATA_ERROR_CODES.UNSUPPORTED_VERSION);
        assert.equal(record.api, "API key 99");
        assert.equal(record.apiKey, 99);
        assert.match(record.reason ?? "", /99/);
        assert.ok(record.bytesOut > 0, "a refusal is an answer and an answer is bytes");

        // The connection is still up, which is the difference between this and an unreadable
        // frame: the correlation id was read, so there is somebody to answer.
        client.write(requestFrame(18, 0, 4, null, emptyBody()));
        assert.equal(await client.answerTo(1), 4);
        assert.equal(port.requests().length, 2);
      } finally {
        client.close();
      }
    });
  });

  it("answers an unsupported version of a known API, and records which one was asked for", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      const asked = requestFrame(0, 7, 11, null, produceBody("widgets", 0, null, 1));
      try {
        client.write(asked);
        assert.equal(await client.answerTo(0), 11);

        const record = at(port.requests(), 0);
        assert.equal(record.result, "unsupported-version");
        assert.equal(record.errorCode, DATA_ERROR_CODES.UNSUPPORTED_VERSION);
        assert.equal(record.apiVersion, 7);
        assert.equal(record.bytesIn, asked.length);
      } finally {
        client.close();
      }
    });
  });

  it("answers a body it cannot read, naming the API and the version", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      // A `Produce` v2 body with nothing in it: the acks field is not there to be read.
      try {
        client.write(requestFrame(0, 2, 12, null, emptyBody()));
        assert.equal(await client.answerTo(0), 12);

        const record = at(port.requests(), 0);
        assert.equal(record.result, "corrupt-message");
        assert.equal(record.errorCode, DATA_ERROR_CODES.CORRUPT_MESSAGE);
        assert.match(record.reason ?? "", /Produce/);
        assert.match(record.reason ?? "", /v2/);
      } finally {
        client.close();
      }
    });
  });

  it("answers a request whose body ran past its own fields with the leftover count", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      // `ApiVersions` v0 has no body at all, so one byte of body is one byte past the fields.
      try {
        client.write(requestFrame(18, 0, 13, null, Buffer.from([0])));
        assert.equal(await client.answerTo(0), 13);

        const record = at(port.requests(), 0);
        assert.equal(record.result, "invalid-request");
        assert.equal(record.errorCode, DATA_ERROR_CODES.INVALID_REQUEST);
        assert.match(record.reason ?? "", /1 byte\(s\) past the fields it declares/);
      } finally {
        client.close();
      }
    });
  });

  it("writes nothing when the client asked for no answer, and records that it was accepted", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(19, 0, 20, null, createTopicsBody("widgets", 1, 1)));
        assert.equal(await client.answerTo(0), 20);

        client.write(requestFrame(0, 2, 21, null, produceBody("widgets", 0, oneRecord("k", "v"), 0)));
        // A second request proves the silence was chosen and not a server that stopped reading.
        client.write(requestFrame(18, 0, 22, null, emptyBody()));
        assert.equal(await client.answerTo(1), 22);

        const records = port.requests();
        assert.equal(records.length, 3);
        assert.equal(at(records, 1).result, "ok");
        assert.equal(at(records, 1).bytesOut, 0);
        assert.match(at(records, 1).reason ?? "", /acks=0/);
        assert.equal(at(records, 1).errorCode, DATA_ERROR_CODES.NONE);
        // The record is the only place the acceptance is visible, and the next frame is proof the
        // world did not answer it out of order.
        assert.equal(at(port.snapshot().topics, 0).partitions[0]?.highWatermark, 1);
      } finally {
        client.close();
      }
    });
  });

  it("reads a version-specific field, so one body is complete on v0 and a leftover on v1", async () => {
    // `maxNumOffsets` is a field v0 declares and v1 deleted, so the **same bytes** are a complete
    // body on one version and four bytes past the fields on the other. That is the version-specific
    // difference this world has to honour, and it is a fact about the request rather than about the
    // shape of a response - which is why it cannot be held by a round trip of any kind.
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(19, 0, 30, null, createTopicsBody("widgets", 1, 1)));
        assert.equal(await client.answerTo(0), 30);

        client.write(requestFrame(2, 0, 31, null, listOffsetsBody("widgets", 0, 1)));
        assert.equal(await client.answerTo(1), 31);
        assert.equal(at(port.requests(), 1).result, "ok");

        // The identical body on v1 leaves the v0-only field unread, and the world counts it.
        client.write(requestFrame(2, 1, 32, null, listOffsetsBody("widgets", 0, 1)));
        assert.equal(await client.answerTo(2), 32);
        assert.equal(at(port.requests(), 2).result, "invalid-request");
        assert.equal(at(port.requests(), 2).errorCode, DATA_ERROR_CODES.INVALID_REQUEST);
        assert.match(at(port.requests(), 2).reason ?? "", /4 byte\(s\) past the fields it declares/);

        // And the same request with the field left out is a v1 body, so it is answered.
        client.write(requestFrame(2, 1, 33, null, listOffsetsBody("widgets", 0, null)));
        assert.equal(await client.answerTo(3), 33);
        assert.equal(at(port.requests(), 3).result, "ok");
      } finally {
        client.close();
      }
    });
  });

  it("closes a connection that is still open when the world stops", async () => {
    const port = tcpData({ cluster: "cart", nodeId: 1, host: HOST, port: 0 });
    const address = await port.listen({ host: HOST, port: 0 });
    const endpoint = port.snapshot().node.port;
    const client = new BrokerClient(endpoint);
    try {
      // The connection is established and has been answered, so it is a live socket rather than a
      // pending one - which is the state `close()` has to be able to tear down.
      client.write(requestFrame(18, 0, 1, null, emptyBody()));
      assert.equal(await client.answerTo(0), 1);
      assert.match(address, new RegExp(`:${String(endpoint)}$`));

      await port.close();
      await client.closed();
    } finally {
      client.close();
      await port.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The reading the transport fills
// ---------------------------------------------------------------------------------------------

describe("the record a request leaves", () => {
  it("files every socket request as the application's and every command as the criterion's", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(19, 0, 40, null, createTopicsBody("widgets", 1, 1)));
        assert.equal(await client.answerTo(0), 40);
        const commanded = port.run(["metadata"]);
        const asked = port.run(["produce", "widgets", "0", "k", "v"]);
        client.close();

        const records = port.requests();
        assert.equal(records.length, 3);
        assert.equal(at(records, 0).source, "application");
        // Without this field a criterion's own command would satisfy a criterion about the
        // application, and the run would report a PASS the application never earned.
        assert.equal(commanded.source, "criterion");
        assert.equal(asked.source, "criterion");
        assert.equal(commanded.bytesIn, 0, "a command crosses no socket, so nothing arrived");
        assert.ok(at(records, 0).bytesIn > 0);
      } finally {
        client.close();
      }
    });
  });

  it("records the body length this world really produced, for both doors", async () => {
    await withBroker(async ({ port }) => {
      const created = port.run(["create-topic", "widgets", "1", "1"]);
      const metadata = port.run(["metadata"]);
      const refused = port.run(["fetch", "nothing-here", "0"]);
      // A request that never became one is the contrast that shows `bytesOut` is a measurement:
      // a refusal the world *answered* carries a body, and a refusal to read the command does not.
      const unreadable = port.run(["fetch"]);

      assert.ok(created.bytesOut > 0);
      assert.ok(metadata.bytesOut > 0);
      assert.ok(refused.bytesOut > 0);
      assert.equal(refused.result, "refused");
      assert.equal(refused.errorCode, DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);

      assert.equal(unreadable.bytesOut, 0);
      assert.equal(unreadable.result, "invalid-request");
      assert.equal(unreadable.apiKey, -1);
      // `run` hands back the very record it filed rather than a copy of it, which is the property
      // that makes a criterion's own reading and the register the same account of one request.
      assert.equal(at(port.requests(), 2), refused);
      assert.equal(port.requests().length, 4);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The command register
// ---------------------------------------------------------------------------------------------

describe("the command register", () => {
  it("is five words, each lower case and hyphenated, each with a usage line in the same order", () => {
    assert.equal(Object.isFrozen(DATA_COMMAND_WORDS), true);
    assert.deepEqual([...DATA_COMMAND_WORDS], ["create-topic", "produce", "fetch", "metadata", "commit"]);
    const usage = dataCommandUsage();
    assert.equal(usage.length, DATA_COMMAND_WORDS.length);
    for (const word of DATA_COMMAND_WORDS) {
      assert.match(word, /^[a-z]+(-[a-z]+)*$/, `${word} is not a word this register would hold`);
    }
    for (const [index, word] of DATA_COMMAND_WORDS.entries()) {
      assert.match(at(usage, index), new RegExp(`^${word} `), "the usage line names its own word");
    }
  });

  it("performs each word and answers the API the word belongs to", async () => {
    await withBroker(async ({ port }) => {
      const answers = [
        port.run(["create-topic", "widgets", "2", "1"]),
        port.run(["produce", "widgets", "0", "k", "v"]),
        port.run(["fetch", "widgets", "0"]),
        port.run(["metadata"]),
        port.run(["commit", "cart-group", "widgets", "0", "1"]),
      ];
      for (const [index, record] of answers.entries()) {
        assert.equal(record.result, "ok", `word ${at([...DATA_COMMAND_WORDS], index)} did not answer ok`);
        assert.equal(record.errorCode, DATA_ERROR_CODES.NONE);
        assert.equal(record.source, "criterion");
        assert.equal(record.bytesIn, 0);
        // The spelling is held against the register row the record's own key names, and the
        // version is required to be one that row declares - so a register naming one API's
        // versions beside another API's key fails here rather than in a document. A spelling is
        // every version an API implements rather than the one a request used (`Produce(0) v0, v2`),
        // which is a fact about the register and not about this request, so the row is the only
        // thing the comparison may rest on.
        const row = DATA_APIS.find((api) => api.key === record.apiKey);
        assert.ok(row !== undefined, `the register answered API key ${String(record.apiKey)}, which no row names`);
        assert.equal(record.api, dataApiSpelling(row));
        assert.ok(row.versions.includes(record.apiVersion), `${row.name} declares no version ${String(record.apiVersion)}`);
      }
    });
  });

  it("reads no flags: a word that looks like one is the value it is written beside", async () => {
    await withBroker(async ({ port }) => {
      const produced = port.run(["produce", "widgets", "0", "--key", "--value"]);
      assert.equal(produced.result, "refused", "the topic does not exist yet");
      port.run(["create-topic", "widgets", "1", "1"]);
      assert.equal(port.run(["produce", "widgets", "0", "--key", "--value"]).result, "ok");

      const record = at(at(port.snapshot().topics, 0).partitions, 0).records[0];
      // The world has no flag grammar, so a `--` spelling is data. A world that read operands as
      // "the words that do not start with a dash" has already cost this repository a defect.
      assert.equal(record?.key, "--key");
      assert.equal(record?.value, "--value");
    });
  });

  it("asks about every topic when metadata is given no name, and about one when it is", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "one", "1", "1"]);
      const oneTopic = port.run(["metadata"]);
      port.run(["create-topic", "two", "1", "1"]);
      const twoTopics = port.run(["metadata"]);
      const named = port.run(["metadata", "one"]);

      assert.ok(oneTopic.bytesOut > 0);
      assert.ok(
        twoTopics.bytesOut > oneTopic.bytesOut,
        "a command with no topic name asks about everything, so its answer grows with the world",
      );
      assert.ok(named.bytesOut < twoTopics.bytesOut);
      assert.ok(named.bytesOut > 0);
    });
  });

  it("sends a null topic list with no argument and an empty one when a socket asks for none", async () => {
    await withBroker(async ({ port, endpoint }) => {
      port.run(["create-topic", "widgets", "1", "1"]);
      const everything = port.run(["metadata"]);

      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(3, 0, 50, null, metadataBody([])));
        const answer = await client.frameAt(0);
        // Null means "everything" and empty means "nothing at all". Collapsing the two would give
        // one request two meanings, and the sizes are the proof that they mean two things. The
        // frame is compared past its prefix, because a body is what `bytesOut` counts.
        assert.ok(
          everything.bytesOut > answer.length - 4,
          "an empty topic list must ask about fewer topics than no list at all",
        );
      } finally {
        client.close();
      }
    });
  });

  it("refuses a word it does not perform without naming an API", async () => {
    await withBroker(async ({ port }) => {
      const record = port.run(["snapshot"]);
      assert.equal(record.result, "invalid-request");
      assert.equal(record.errorCode, DATA_ERROR_CODES.INVALID_REQUEST);
      assert.equal(record.apiKey, -1, "nothing about a request that was never formed can be filled in");
      assert.equal(record.apiVersion, -1);
      assert.match(record.api, /snapshot/);
      assert.match(record.reason ?? "", /is not a command this world performs/);
      for (const word of DATA_COMMAND_WORDS) {
        assert.match(record.reason ?? "", new RegExp(word), "the refusal prints every word it does perform");
      }
    });
  });

  it("files a blank command under the absence of a word", async () => {
    await withBroker(async ({ port }) => {
      const empty = port.run([]);
      const blank = port.run(["   "]);
      assert.equal(empty.api, "no command");
      assert.equal(blank.api, "no command");
      assert.equal(empty.result, "invalid-request");
      assert.equal(blank.apiKey, -1);
    });
  });

  it("refuses an argument that is not a whole number, naming the spelling", async () => {
    await withBroker(async ({ port }) => {
      for (const partition of ["2.5", "0x10", "1e3", "two"]) {
        const record = port.run(["create-topic", "widgets", partition, "1"]);
        assert.equal(record.result, "invalid-request");
        assert.equal(record.apiKey, -1);
        assert.match(record.reason ?? "", /is not a whole number/);
        assert.match(record.reason ?? "", new RegExp(partition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      const blank = port.run(["create-topic", "widgets", "", "1"]);
      assert.equal(blank.result, "invalid-request");
      assert.match(blank.reason ?? "", /is not a whole number/);
    });
  });

  it("refuses the wrong number of arguments, naming both the count and the usage", async () => {
    await withBroker(async ({ port }) => {
      const record = port.run(["produce", "widgets", "0", "k"]);
      assert.equal(record.result, "invalid-request");
      assert.match(record.reason ?? "", /received 3/);
      assert.match(record.reason ?? "", /produce <topic> <partition> <key> <value>/);
      const tooMany = port.run(["fetch", "widgets", "0", "extra"]);
      assert.match(tooMany.reason ?? "", /received 3/, "a four-argument form is still the wrong count");
    });
  });

  it("refuses a well-formed command that names a value the world does not hold", async () => {
    await withBroker(async ({ port }) => {
      // These are *not* parse failures: the command was read, formed into a request, and refused
      // by the world. A parse failure is filed under the word; these are filed under an API.
      const noPartitions = port.run(["create-topic", "widgets", "0", "1"]);
      assert.equal(noPartitions.result, "refused");
      assert.equal(noPartitions.errorCode, DATA_ERROR_CODES.INVALID_PARTITIONS);
      assert.match(noPartitions.reason ?? "", /^INVALID_PARTITIONS/);
      assert.ok(noPartitions.apiKey >= 0);

      const noReplicas = port.run(["create-topic", "widgets", "1", "0"]);
      assert.equal(noReplicas.errorCode, DATA_ERROR_CODES.INVALID_REPLICATION_FACTOR);

      const badName = port.run(["create-topic", "bad name!", "1", "1"]);
      assert.equal(badName.errorCode, DATA_ERROR_CODES.INVALID_TOPIC_EXCEPTION);

      const absent = port.run(["produce", "nothing-here", "0", "k", "v"]);
      assert.equal(absent.errorCode, DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
      assert.equal(absent.result, "refused");

      const already = port.run(["create-topic", "widgets", "0", "1"]);
      assert.equal(already.errorCode, DATA_ERROR_CODES.INVALID_PARTITIONS);
      port.run(["create-topic", "held", "1", "1"]);
      assert.equal(port.run(["create-topic", "held", "1", "1"]).errorCode, DATA_ERROR_CODES.TOPIC_ALREADY_EXISTS);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------------------------

describe("the snapshot", () => {
  it("says the same thing twice, and reading it does not move what it read", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "1", "1"]);
      port.run(["produce", "widgets", "0", "k", "v"]);
      port.run(["commit", "cart-group", "widgets", "0", "1"]);

      const first = port.snapshot();
      const second = port.snapshot();
      // A substitute whose *observation* edited what it observed could not be read twice, and M1
      // compares exactly these documents - this is the defect `sim-k8s`'s cluster port paid for.
      assert.deepEqual(second, first);
      assert.deepEqual(port.snapshot(), first);
      assert.equal(at(at(port.snapshot().topics, 0).partitions, 0).highWatermark, 1);
    });
  });

  it("orders topics and groups by name rather than by when they were mentioned", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "zeta", "1", "1"]);
      port.run(["create-topic", "alpha", "1", "1"]);
      port.run(["commit", "b-group", "zeta", "0", "1"]);
      port.run(["commit", "a-group", "zeta", "0", "1"]);

      const state = port.snapshot();
      assert.deepEqual(
        state.topics.map((topic) => topic.name),
        ["alpha", "zeta"],
      );
      assert.deepEqual(
        state.groups.map((group) => group.groupId),
        ["a-group", "b-group"],
      );
    });
  });

  it("records the declared address in the identity and the bound one in the snapshot", async () => {
    await withBroker(async ({ port, endpoint, address }) => {
      // Two readers of one field, and they answer two different questions: `identity()` is what the
      // environment document declared, and the snapshot is what this machine gave the world.
      assert.equal(port.identity().port, 0);
      assert.equal(port.identity().host, HOST);
      assert.equal(port.snapshot().node.port, endpoint);
      assert.notEqual(endpoint, 0);
      assert.equal(port.snapshot().node.id, 1);
      assert.equal(port.snapshot().node.host, HOST);
      assert.match(address, /^tcp:\/\//);
    });
  });

  it("reports the surfaces it stands in for from the reading vocabulary, not from a copy", async () => {
    await withBroker(async ({ port }) => {
      // A re-export and a restatement are two different claims: this asserts it is the same object,
      // so a second list beside the first cannot drift away from it in silence.
      assert.equal(DATA_SIMULATED_SURFACES, DECLARED_SURFACES);
      assert.equal(port.snapshot().cluster, "cart");
    });
  });

  it("includes only itself in a partition's in-sync set, however many replicas were recorded", async () => {
    await withBroker(async ({ port }) => {
      const created = port.run(["create-topic", "threefold", "1", "3"]);
      assert.equal(created.result, "ok");
      const partition = at(at(port.snapshot().topics, 0).partitions, 0);
      assert.deepEqual(partition.replicas, [1]);
      assert.deepEqual(partition.isr, [1]);
      assert.equal(partition.leaderId, 1);
      assert.equal(partition.lowWatermark, 0);
      // The world was asked for three replicas and holds one, and the difference is recorded
      // rather than hidden: a world that quietly answered would let a criteria about replication
      // read PASS on a cluster with no followers.
      assert.match(created.reason ?? "", /isr is \[1\]/);
    });
  });

  it("derives a group's state from its members rather than storing it", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(11, 0, 60, "cart-web", joinGroupBody("cart-group", "", 30000)));
        assert.equal(await client.answerTo(0), 60);

        const group = at(port.snapshot().groups, 0);
        assert.equal(group.groupId, "cart-group");
        assert.equal(group.generationId, 1);
        assert.equal(group.protocolType, "consumer");
        assert.equal(group.members.length, 1);
        // No assignment was handed back, so the group is still completing its join. A stored state
        // field could disagree with the members beside it; this one cannot.
        assert.equal(group.state, "CompletingJoin");
      } finally {
        client.close();
      }
    });
  });

  it("refuses a second join that names a different type for a group it already holds", async () => {
    await withBroker(async ({ port, endpoint }) => {
      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(11, 0, 61, "cart-web", joinGroupBody("cart-group", "", 30000)));
        assert.equal(await client.answerTo(0), 61);
        client.write(requestFrame(11, 0, 62, "cart-web", joinGroupBody("cart-group", "", 30000, "generic")));
        assert.equal(await client.answerTo(1), 62);

        const joins = port.requests().filter((record) => record.apiKey === 11);
        assert.equal(joins.length, 2);
        assert.equal(at(joins, 0).result, "ok");
        // A protocol's name is the assignment strategy it would run; a group's type is a different
        // fact, and one request carries both. A world that recorded the name as the type answered a
        // question about the group with a fact about the assignment the member was offered.
        assert.equal(at(joins, 1).result, "refused");
        assert.equal(at(joins, 1).errorCode, DATA_ERROR_CODES.INCONSISTENT_GROUP_PROTOCOL);
        assert.match(String(at(joins, 1).reason), /which is held as 'consumer'/);
        const group = at(port.snapshot().groups, 0);
        assert.equal(group.protocolType, "consumer", "the held type does not move");
        assert.equal(group.members.length, 1, "and the refused member was not admitted");
      } finally {
        client.close();
      }
    });
  });

  it("reads a committed offset out of the group that holds it", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "2", "1"]);
      port.run(["commit", "cart-group", "widgets", "1", "7"]);
      const group = at(port.snapshot().groups, 0);
      assert.deepEqual(
        group.committed.map((entry) => [entry.topic, entry.partition, entry.offset]),
        [["widgets", 1, 7]],
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The meter
// ---------------------------------------------------------------------------------------------

describe("the meter", () => {
  it("counts the requests, the bytes and the records the world has handled", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "1", "1"]);
      port.run(["produce", "widgets", "0", "k", "v"]);
      port.run(["produce", "widgets", "0", "k2", "v2"]);
      port.run(["fetch", "widgets", "0"]);

      const meter = port.meters();
      assert.equal(meter.requests, 4);
      assert.equal(meter.recordsProduced, 2);
      assert.equal(meter.recordsFetched, 2);
      assert.equal(meter.bytesIn, 0, "no command crosses a socket");
      assert.ok(meter.bytesOut > 0);
      const summed = port.requests().reduce((total, record) => total + record.bytesOut, 0);
      assert.equal(meter.bytesOut, summed);
    });
  });

  it("restarts the meter at zero when the world is cleared, keeping the record of what happened", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "1", "1"]);
      port.run(["produce", "widgets", "0", "k", "v"]);
      const before = port.meters();
      assert.ok(before.requests > 0);

      port.clear();
      const after = port.meters();
      assert.deepEqual(after, { requests: 0, bytesIn: 0, bytesOut: 0, recordsProduced: 0, recordsFetched: 0 });
      assert.deepEqual(port.snapshot().topics, []);
      assert.deepEqual(port.snapshot().groups, []);
      // The record of what happened is deliberately kept: the meter describes the world's current
      // life, and the history is what a reader audits the life against.
      assert.equal(port.requests().length, before.requests);
      assert.equal(port.requests().filter((record) => record.source === "criterion").length, before.requests);
    });
  });

  it("counts only what happened after the last clear", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "1", "1"]);
      port.clear();
      port.run(["create-topic", "widgets", "1", "1"]);
      port.run(["produce", "widgets", "0", "k", "v"]);

      const meter = port.meters();
      assert.equal(meter.requests, 2);
      assert.equal(meter.recordsProduced, 1);
      assert.equal(port.requests().length, 3);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The state document
// ---------------------------------------------------------------------------------------------

describe("the state document", () => {
  it("round-trips a world through a dump and a load", async () => {
    await withBroker(async ({ port }) => {
      port.run(["create-topic", "widgets", "2", "1"]);
      port.run(["produce", "widgets", "0", "k", "v"]);
      port.run(["commit", "cart-group", "widgets", "1", "3"]);
      const before = port.snapshot();
      const state = port.dump();

      port.clear();
      assert.deepEqual(port.snapshot().topics, []);

      port.load(state);
      assert.deepEqual(port.snapshot(), before);
      // The bytes survive as bytes: a key that was written as hexadecimal comes back as the same
      // buffer rather than as the spelling of one.
      assert.equal(at(at(at(port.snapshot().topics, 0).partitions, 0).records, 0)?.key, "k");
    });
  });

  it("refuses a document that is not JSON, and one that is not this world's format", async () => {
    await withBroker(async ({ port }) => {
      assert.throws(() => port.load("{ not json"), /the snapshot is not a data-broker state document:/);
      assert.throws(
        () => port.load(JSON.stringify({ format: "something.else/1", topics: [], groups: [] })),
        /it is not veridian\.sim-data\/1/,
      );
      // Neither refusal is a claim about the world's contents, so neither may name a state field.
      let raised: unknown = null;
      try {
        port.load("[]");
      } catch (error) {
        raised = error;
      }
      assert.ok(raised instanceof Error);
      assert.match(String(raised), /it is not veridian\.sim-data\/1/);
    });
  });

  it("loads a document built by hand, so the reader is not held only by the writer", async () => {
    await withBroker(async ({ port }) => {
      const state = JSON.stringify({
        format: "veridian.sim-data/1",
        cluster: "cart",
        nodeId: 1,
        topics: [
          {
            name: "widgets",
            replicationFactor: 1,
            configs: [],
            partitions: [
              {
                leaderId: 1,
                replicas: [1],
                records: [
                  { offset: 0, timestamp: 5, keyHex: "6b", valueHex: null, headers: [{ name: "h", valueHex: "76" }] },
                ],
              },
            ],
          },
        ],
        groups: [
          {
            groupId: "cart-group",
            generationId: 4,
            protocolType: "consumer",
            members: [],
            committed: [{ topic: "widgets", partition: 0, offset: 9, metadata: null }],
          },
        ],
      });
      port.load(state);

      const topic = at(port.snapshot().topics, 0);
      const record = at(at(topic.partitions, 0).records, 0);
      assert.equal(topic.name, "widgets");
      assert.equal(record.key, "k");
      assert.equal(record.value, null, "a null value and an empty one are two different records");
      assert.equal(record.keyHex, "6b");
      assert.equal(at(record.headers, 0).value, "v");
      assert.equal(topic.partitions[0]?.highWatermark, 1);
      const group = at(port.snapshot().groups, 0);
      assert.equal(group.generationId, 4);
      assert.equal(group.state, "Empty", "a group with no members is empty however it was written");
      assert.equal(at(group.committed, 0).offset, 9);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The front door
// ---------------------------------------------------------------------------------------------

describe("tcpData", () => {
  it("refuses a blank cluster or host, naming every value it did not receive", () => {
    assert.throws(
      () => tcpData({ cluster: "  ", nodeId: 1, host: HOST, port: 0 }),
      /received none for cluster/,
    );
    assert.throws(
      () => tcpData({ cluster: "cart", nodeId: 1, host: "", port: 0 }),
      /received none for host/,
    );
    assert.throws(
      () => tcpData({ cluster: "", nodeId: 1, host: "", port: 0 }),
      /received none for cluster, host/,
    );
  });

  it("refuses a node id or a port that is not a whole number in range", () => {
    for (const nodeId of [-1, 1.5, Number.NaN]) {
      assert.throws(
        () => tcpData({ cluster: "cart", nodeId, host: HOST, port: 0 }),
        /node id must be a whole number that is not negative/,
      );
    }
    for (const port of [-1, 65536, 1.5]) {
      assert.throws(
        () => tcpData({ cluster: "cart", nodeId: 1, host: HOST, port }),
        /port must be a whole number between 0 and 65535/,
      );
    }
    // The three acceptances beside the refusals: zero is a port, zero is a node id, and a blank
    // check that also refused a legal value would be a refusal nothing could satisfy.
    assert.equal(typeof tcpData({ cluster: "cart", nodeId: 0, host: HOST, port: 0 }).run, "function");
    assert.equal(typeof tcpData({ cluster: " cart ", nodeId: 1, host: ` ${HOST} `, port: 65535 }).identity().host, "string");
  });

  it("offers the register it implements, which is the register the protocol declares", async () => {
    await withBroker(async ({ port }) => {
      assert.deepEqual(port.apis(), DATA_APIS);
      assert.ok(port.apis().length > DATA_COMMAND_WORDS.length);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The example client's own version choice
// ---------------------------------------------------------------------------------------------

/**
 * The example application asks this world for a version this world does not hold, if nobody checks.
 *
 * ## What went wrong, and why nothing in this file noticed
 *
 * `examples/sim-data/app/provision.mjs` asked `Fetch` at **version 1**. `DATA_APIS` declares `Fetch`
 * as `versions: [0, 2]`, so `#answer` took its `unsupported` branch and wrote
 * `encodeRefusalResponse` - an eight-byte body, an error code and a null message - which the client's
 * `decodeFetch` then consumed as a topic count. The client reported
 * `the broker's answer ended early: 4 byte(s) wanted at 8, 8 present`, and a reader following that
 * message would have gone to look at the answer's *length* rather than at the version that chose the
 * encoder. Both halves were correct in isolation: `encodeFetchResponse` writes its throttle field only
 * `if (apiVersion >= 1)`, and `#fetch` calls it with `#versionOf(1)`, which is 0. The disagreement was
 * that the client named a version the register never offered.
 *
 * **Counted, not recalled:** all 44 tests above passed with that defect in place and were green on
 * both sides of the repair. Every `Fetch` in this file is issued through `port.run`, the criterion's
 * own door, and `run` dispatches at `this.#versionOf(parsed.apiKey)` - so the very mechanism that made
 * the client's mistake invisible is the one the suite uses. Nothing in this file ever put a `Fetch`
 * on a socket at a version the *example* chose, because the version was a fact about a file this
 * suite does not read.
 *
 * ## What is asserted, and what would make each assertion fail
 *
 * The version is read out of the example's own source rather than restated here, so this test's
 * subject is the *agreement* between two files rather than one recalled number - the rule this
 * repository has paid for often enough that the shape is named: two files that must agree need a test
 * that reads both, or the agreement is an opinion. Then:
 *
 *   1. `DATA_APIS` must declare key 1, and must declare the version the example names. Delete `0`
 *      from `Fetch`'s versions and this fails naming the register.
 *   2. A `Fetch` on a real socket at that version, whose body is composed the way the example composes
 *      its own, must answer `ok` rather than `unsupported-version` - and the record's `apiVersion` must
 *      be the version that was asked for, so a world that silently downgraded the request would fail
 *      rather than look healthy.
 *   3. The answer's bytes must be readable to the end of the frame by the decoder's own order, which
 *      is the property the client actually depends on and the one a refusal body violates. The count
 *      is obtained the way `decodeFetch` obtains it - no throttle field, because version 0 has none -
 *      and the read is asserted to consume every byte, so an answer carrying one field more or less
 *      than the version's shape declares fails here rather than in a demo.
 */
describe("the version the example client names", () => {
  /** The example's own text, so the version below is read rather than recalled. */
  function readExample(): string {
    return readFileSync(
      fileURLToPath(new URL("../../examples/sim-data/app/provision.mjs", import.meta.url)),
      "utf8",
    );
  }

  /**
   * The API key and version the example's `send` call names, for one named request helper.
   *
   * Read out of the call site - `await send(1, 0, fetchBody(entry), decodeFetch)` - rather than out of
   * a constant, because the defect was in the call site: the example has no `FETCH_VERSION` to look
   * up, and adding one here would be asserting on a value this file had just invented.
   */
  function versionNamedFor(source: string, key: number): number {
    const pattern = new RegExp(`send\\(${String(key)},\\s*(\\d+),`, "u");
    const found = pattern.exec(source);
    assert.ok(found !== null, `the example issues no request at API key ${String(key)}`);
    return Number(found[1]);
  }

  it("reads a Fetch out of the example's source, so the number below is the example's and not this file's", () => {
    const source = readExample();
    const named = versionNamedFor(source, 1);
    assert.equal(typeof named, "number");
    assert.ok(Number.isInteger(named));
    // The positive control: if this ever reads something other than a version, the extraction above
    // has stopped working and every assertion below would be about a number nothing chose.
    assert.match(source, new RegExp(`send\\(1,\\s*${String(named)},\\s*fetchBody\\(`, "u"));
  });

  it("names a version the register declares for Fetch", () => {
    const named = versionNamedFor(readExample(), 1);
    const row = DATA_APIS.find((api) => api.key === 1);
    assert.ok(row !== undefined, "the register declares no API at key 1");
    assert.equal(row.name, "Fetch");
    assert.ok(
      row.versions.includes(named),
      `the example asks Fetch at version ${String(named)}, and the register declares ${row.versions.join(", ")}`,
    );
  });

  it("answers that version with a body rather than a refusal", async () => {
    const named = versionNamedFor(readExample(), 1);
    await withBroker(async ({ port, endpoint }) => {
      const created = port.run(["create-topic", "cart-events", "3", "1"]);
      assert.equal(created.result, "ok");
      const produced = port.run(["produce", "cart-events", "0", "ord-1001", '{"order":"ord-1001"}']);
      assert.equal(produced.result, "ok");

      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(1, named, 17, null, fetchBody("cart-events", 0, 0, 65536)));
        assert.equal(await client.answerTo(0), 17);

        // The record is the world's own account of what it did, so an `unsupported-version` result
        // is the defect stated in the world's words rather than inferred from a byte count.
        const record = at(port.requests().filter((entry) => entry.apiKey === 1), 0);
        assert.equal(record.apiVersion, named, "the world answered a version other than the one asked for");
        assert.equal(
          record.result,
          "ok",
          `the world refused Fetch v${String(named)}: ${String(record.reason ?? "no reason given")}`,
        );
        assert.equal(record.errorCode, DATA_ERROR_CODES.NONE);
      } finally {
        client.close();
      }
    });
  });

  it("writes an answer the decoder's own reading order consumes exactly, throttle included iff the version has one", async () => {
    const named = versionNamedFor(readExample(), 1);
    await withBroker(async ({ port, endpoint }) => {
      port.run(["create-topic", "cart-events", "3", "1"]);
      port.run(["produce", "cart-events", "0", "ord-1001", '{"order":"ord-1001"}']);

      const client = new BrokerClient(endpoint);
      try {
        client.write(requestFrame(1, named, 18, null, fetchBody("cart-events", 0, 0, 65536)));
        const reader = responseBody(await client.frameAt(0));
        assert.equal(reader.readInt32(), 18);

        // The order is the client's order, written out here: a version that declares a throttle has
        // one and a version that does not must not, because the client reads the next field as a
        // topic count and a throttle in that slot makes every following field one slot early.
        if (named >= 1) reader.readInt32();
        const topics = reader.readInt32();
        assert.equal(topics, 1);
        assert.equal(reader.readString(), "cart-events");
        const partitions = reader.readInt32();
        assert.equal(partitions, 1);
        assert.equal(reader.readInt32(), 0);
        assert.equal(reader.readInt16(), DATA_ERROR_CODES.NONE);
        const highWatermark = reader.readInt64();
        assert.equal(highWatermark, 1);
        const batch = reader.readNullableBytes();
        assert.ok(batch !== null && batch.length > 0, "a partition holding one record must hand back a batch");
        assert.equal(
          reader.remaining,
          0,
          "the answer carried more bytes than the client's reading order consumes, so one field is " +
            "present that this version does not declare - or one is missing and the read above " +
            "consumed something else",
        );
      } finally {
        client.close();
      }
    });
  });
});
