import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_FRAME_BYTES,
  WIRE_COMPRESSION_CODECS,
  WireError,
  WireReader,
  WireWriter,
  crc32c,
  decodeRecordBatch,
  encodeRecordBatch,
} from "./wire.ts";
import type { WireRecord } from "./wire.ts";

/**
 * The byte grammar, held by test rather than by hope.
 *
 * This file exists because the two halves of this module are the only two implementations of one
 * grammar in the tree, and an encoder and a decoder that are each read on their own will agree with
 * themselves and disagree with each other. Four defects were found that way while this module was
 * being written - a `batchLength` off by three, a record body that declared its own length twice, the
 * same doubling on the batch tail, and a client-produced batch whose `lastOffsetDelta` contradicted
 * its record count - and every one of them looked correct in the half it was written in.
 *
 * The strongest test here is therefore not a round trip of this module against itself. It is
 * `a batch assembled by hand`, which composes a frame out of `WireWriter` primitives that are tested
 * independently below, so that a field written in the wrong place by `encodeRecordBatch` cannot hide
 * behind a decoder that agrees with it.
 */

/** Where a one-batch frame's records begin: every fixed header field that precedes them. */
const RECORDS_AT = 61;

/** The key and value the layout test uses, and the offsets their bytes sit at. */
const KEY_AT = 65;
const VALUE_AT = 68;
/** Where that record's header count sits, one byte past its value. */
const HEADER_COUNT_AT = 74;

function refusal(action: () => unknown, pattern: RegExp): WireError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof WireError, `expected a WireError, and got ${String(error)}`);
    assert.match(error.message, pattern);
    return error;
  }
  assert.fail(`expected a refusal matching ${String(pattern)}`);
}

function record(offset: number, key: string | null, value: string | null): WireRecord {
  return {
    offset,
    timestamp: 1700000000000 + offset,
    key: key === null ? null : Buffer.from(key, "utf8"),
    value: value === null ? null : Buffer.from(value, "utf8"),
    headers: [],
  };
}

function batch(records: readonly WireRecord[], baseOffset = 0) {
  return encodeRecordBatch({
    baseOffset,
    records,
    firstTimestamp: 1700000000000,
    maxTimestamp: 1700000000000 + records.length,
  });
}

/**
 * A record body, assembled from the writer primitives directly.
 *
 * `headerCount` overrides how many headers the body *declares*, which is how the refusal below is
 * reached; everything else is written the way the grammar says.
 */
function handRecordBody(input: {
  readonly key?: string | null;
  readonly value?: string | null;
  readonly headers?: readonly { readonly key: string; readonly value: string | null }[];
  readonly headerCount?: number;
  readonly attributes?: number;
  readonly timestampDelta?: number;
  readonly offsetDelta?: number;
}): Buffer {
  const payload = new WireWriter();
  payload.writeInt8(input.attributes ?? 0);
  payload.writeVarlong(input.timestampDelta ?? 0);
  payload.writeVarint(input.offsetDelta ?? 0);
  const key = input.key ?? null;
  if (key === null) {
    payload.writeVarint(-1);
  } else {
    const bytes = Buffer.from(key, "utf8");
    payload.writeVarint(bytes.length);
    payload.writeRaw(bytes);
  }
  const value = input.value ?? null;
  if (value === null) {
    payload.writeVarint(-1);
  } else {
    const bytes = Buffer.from(value, "utf8");
    payload.writeVarint(bytes.length);
    payload.writeRaw(bytes);
  }
  const headers = input.headers ?? [];
  payload.writeVarint(input.headerCount ?? headers.length);
  for (const header of headers) {
    const name = Buffer.from(header.key, "utf8");
    payload.writeVarint(name.length);
    payload.writeRaw(name);
    if (header.value === null) {
      payload.writeVarint(-1);
    } else {
      const bytes = Buffer.from(header.value, "utf8");
      payload.writeVarint(bytes.length);
      payload.writeRaw(bytes);
    }
  }
  const body = payload.toBuffer();
  const out = new WireWriter();
  out.writeVarint(body.length);
  out.writeRaw(body);
  return out.toBuffer();
}

/** A one-batch frame, assembled from the writer primitives directly. */
function handBatch(
  bodies: readonly Buffer[],
  count: number,
  lastOffsetDelta: number,
  attributes = 0,
): Buffer {
  const tail = new WireWriter();
  tail.writeInt16(attributes);
  tail.writeInt32(lastOffsetDelta);
  tail.writeInt64(0);
  tail.writeInt64(0);
  tail.writeInt64(-1);
  tail.writeInt16(-1);
  tail.writeInt32(-1);
  tail.writeInt32(count);
  for (const body of bodies) {
    tail.writeRaw(body);
  }
  const bytes = tail.toBuffer();

  const head = new WireWriter();
  head.writeInt64(0);
  head.writeInt32(9 + bytes.length);
  head.writeInt32(-1);
  head.writeInt8(2);
  head.writeUint32(crc32c(bytes));
  head.writeRaw(bytes);
  return head.toBuffer();
}

describe("the CRC-32C a record batch carries", () => {
  it("matches the published check value for the Castagnoli polynomial", () => {
    assert.equal(crc32c(Buffer.from("123456789", "utf8")), 0xe3069283);
    assert.equal(crc32c(Buffer.alloc(0)), 0);
  });

  it("is not the CRC-32 zlib computes, which is the other polynomial", () => {
    assert.notEqual(crc32c(Buffer.from("123456789", "utf8")), 0xcbf43926);
  });

  it("changes when a byte inside the covered range changes, and does not when none does", () => {
    const before = Buffer.from("hello", "utf8");
    const after = Buffer.from("hellp", "utf8");
    assert.notEqual(crc32c(before), crc32c(after));
    assert.equal(crc32c(Buffer.from("hello", "utf8")), crc32c(before));
  });
});

describe("the byte reader and writer", () => {
  it("refuses to read past the end, and names the offset it stopped at", () => {
    const error = refusal(
      () => new WireReader(Buffer.from([1, 2, 3])).readInt32(),
      /ends before 4 byte\(s\) could be read; 3 remained/,
    );
    assert.equal(error.offset, 0);
    assert.equal(error.name, "WireError");
  });

  it("tells a null string from an empty one", () => {
    const writer = new WireWriter();
    writer.writeNullableString(null);
    writer.writeNullableString("");
    writer.writeNullableString("cart-items");
    const reader = new WireReader(writer.toBuffer());
    assert.equal(reader.readNullableString(), null);
    assert.equal(reader.readNullableString(), "");
    assert.equal(reader.readNullableString(), "cart-items");
  });

  it("tells a null array from an empty one, and refuses a count no frame could hold", () => {
    const writer = new WireWriter();
    writer.writeArrayLength(-1);
    writer.writeArrayLength(0);
    const reader = new WireReader(writer.toBuffer());
    assert.equal(reader.readArrayLength(), -1);
    assert.equal(reader.readArrayLength(), 0);
    const hostile = new WireWriter();
    hostile.writeArrayLength(64);
    assert.ok(hostile.toBuffer().length < 64);
    refusal(() => new WireReader(hostile.toBuffer()).readArrayLength(), /element/);
  });

  it("measures a string in bytes rather than in characters", () => {
    const writer = new WireWriter();
    writer.writeString("\u00e9\u00e9");
    const bytes = writer.toBuffer();
    assert.equal(bytes.length, 2 + 4);
    assert.equal(new WireReader(bytes).readString(), "\u00e9\u00e9");
  });

  it("refuses a string longer than the grammar's length field can address", () => {
    refusal(
      () => new WireWriter().writeString("a".repeat(40000)),
      /a string of 40000 bytes cannot be written as a STRING/,
    );
  });

  it("refuses a boolean that is neither zero nor one", () => {
    refusal(() => new WireReader(Buffer.from([7])).readBoolean(), /boolean/);
  });

  it("refuses a 64-bit field past the exact range of a number", () => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigInt64BE(2n ** 60n, 0);
    refusal(() => new WireReader(bytes).readInt64(), /past the exact range of a number/);
  });

  it("round-trips every value a record's varints carry", () => {
    const values = [0, 1, -1, 63, -64, 64, 8191, -8192, 2147483647, -2147483648];
    const writer = new WireWriter();
    for (const value of values) {
      writer.writeVarint(value);
    }
    const reader = new WireReader(writer.toBuffer());
    for (const value of values) {
      assert.equal(reader.readVarint(), value);
    }
    assert.equal(reader.remaining, 0);
  });

  it("writes one byte for a value a record can carry, and more for one it cannot", () => {
    const small = new WireWriter();
    small.writeVarint(0);
    const large = new WireWriter();
    large.writeVarint(64);
    assert.equal(small.toBuffer().length, 1);
    assert.equal(large.toBuffer().length, 2);
  });

  it("refuses a frame larger than the bound this world reads", () => {
    refusal(
      () => new WireWriter().writeRaw(Buffer.alloc(MAX_FRAME_BYTES + 1)),
      /a frame grew past the 8388608 byte ceiling/,
    );
  });
});

describe("the record batch", () => {
  it("round-trips records with keys, values and headers, and their offsets", () => {
    const records: WireRecord[] = [
      { ...record(10, "cart-1", "added"), headers: [{ key: "trace", value: Buffer.from("t1", "utf8") }] },
      record(11, "cart-2", "removed"),
      record(12, null, null),
    ];
    const batch = {
      baseOffset: 10,
      records,
      firstTimestamp: 1700000000000,
      maxTimestamp: 1700000000012,
    };
    const decoded = decodeRecordBatch(encodeRecordBatch(batch));

    assert.equal(decoded.baseOffset, 10);
    assert.equal(decoded.magic, 2);
    assert.equal(decoded.attributes, 0);
    assert.equal(decoded.compression, null);
    assert.equal(decoded.firstTimestamp, 1700000000000);
    assert.equal(decoded.maxTimestamp, 1700000000012);
    assert.equal(decoded.records.length, 3);

    assert.equal(decoded.records[0]?.offset, 10);
    assert.equal(decoded.records[1]?.offset, 11);
    assert.equal(decoded.records[2]?.offset, 12);
    assert.deepEqual(decoded.records[0]?.key, Buffer.from("cart-1", "utf8"));
    assert.deepEqual(decoded.records[1]?.value, Buffer.from("removed", "utf8"));
    assert.deepEqual(decoded.records[0]?.headers, [
      { key: "trace", value: Buffer.from("t1", "utf8") },
    ]);
    assert.equal(decoded.records[2]?.key, null);
    assert.equal(decoded.records[2]?.value, null);
  });

  it("accepts a client-produced batch, whose records carry no offset of their own", () => {
    const produced: WireRecord[] = [
      { offset: null, timestamp: 1700000000000, key: null, value: Buffer.from("a", "utf8"), headers: [] },
      { offset: null, timestamp: 1700000000001, key: null, value: Buffer.from("b", "utf8"), headers: [] },
      { offset: null, timestamp: 1700000000002, key: null, value: Buffer.from("c", "utf8"), headers: [] },
    ];
    const decoded = decodeRecordBatch(
      encodeRecordBatch({
        baseOffset: 0,
        records: produced,
        firstTimestamp: 1700000000000,
        maxTimestamp: 1700000000002,
      }),
    );
    assert.deepEqual(
      decoded.records.map((entry) => entry.offset),
      [0, 1, 2],
    );
  });

  it("keeps an empty value distinct from a null one", () => {
    const decoded = decodeRecordBatch(
      batch([
        { ...record(0, null, null) },
        { ...record(1, null, ""), key: Buffer.alloc(0) },
      ]),
    );
    assert.equal(decoded.records[0]?.value, null);
    assert.deepEqual(decoded.records[1]?.value, Buffer.alloc(0));
    assert.equal(decoded.records[0]?.key, null);
    assert.deepEqual(decoded.records[1]?.key, Buffer.alloc(0));
  });

  it("lay the frame out with a sixty-one byte header and a thirteen byte record body", () => {
    const frame = batch([record(0, "k1", "hello")]);
    assert.equal(frame.length, RECORDS_AT + 1 + 13);
    // Every byte before the records, pinned by the field it belongs to, so a field inserted,
    // removed or reordered cannot pass by leaving the total length unchanged.
    assert.equal(frame.readInt32BE(8), 9 + 54);
    assert.equal(frame.readInt32BE(12), -1);
    assert.equal(frame.readInt8(16), 2);
    assert.equal(frame.readInt16BE(21), 0);
    assert.equal(frame.readInt32BE(23), 0);
    assert.equal(frame.readBigInt64BE(27), 1700000000000n);
    assert.equal(frame.readBigInt64BE(35), 1700000000001n);
    assert.equal(frame.readBigInt64BE(43), -1n);
    assert.equal(frame.readInt16BE(51), -1);
    assert.equal(frame.readInt32BE(53), -1);
    assert.equal(frame.readInt32BE(57), 1);
    assert.equal(frame.readUInt32BE(17), crc32c(frame.subarray(21)));
    // And the record's own body: declared length, then the fields. The length fields below carry
    // their *zig-zag* form, not the raw length, which is why 2 bytes of key read as 4 and 5 bytes
    // of value read as 10 - the same reason the body's own 13 bytes are declared as 26.
    assert.equal(frame.readUInt8(RECORDS_AT), 26);
    assert.equal(frame.readUInt8(RECORDS_AT + 1), 0);
    assert.equal(frame.readUInt8(KEY_AT), 4);
    assert.equal(frame.subarray(KEY_AT + 1, VALUE_AT).toString("utf8"), "k1");
    assert.equal(frame.readUInt8(VALUE_AT), 10);
    assert.equal(frame.subarray(VALUE_AT + 1, HEADER_COUNT_AT).toString("utf8"), "hello");
    assert.equal(frame.readUInt8(HEADER_COUNT_AT), 0);
    assert.equal(HEADER_COUNT_AT + 1, frame.length);
  });

  it("decodes a batch assembled by hand, so the encoder is checked against the grammar", () => {
    const frame = handBatch(
      [
        handRecordBody({ key: "cart-1", value: "added", headers: [{ key: "trace", value: "t1" }] }),
        handRecordBody({ key: "cart-2", value: null }),
      ],
      2,
      1,
    );
    const decoded = decodeRecordBatch(frame);
    assert.equal(decoded.records.length, 2);
    assert.deepEqual(decoded.records[0]?.key, Buffer.from("cart-1", "utf8"));
    assert.deepEqual(decoded.records[0]?.value, Buffer.from("added", "utf8"));
    assert.deepEqual(decoded.records[0]?.headers, [
      { key: "trace", value: Buffer.from("t1", "utf8") },
    ]);
    assert.equal(decoded.records[1]?.value, null);
  });

  it("refuses a record whose declared length disagrees with the fields it holds", () => {
    const frame = batch([record(0, "k1", "hello")]);
    const tampered = Buffer.from(frame);
    tampered.writeUInt8(28, RECORDS_AT);
    refusal(() => decodeRecordBatch(tampered), /declared 14 byte\(s\) but its fields occupy 13/);
  });

  it("refuses a batch whose crc does not match its own bytes", () => {
    const frame = batch([record(0, "k1", "hello")]);
    const tampered = Buffer.from(frame);
    tampered.writeUInt8("H".charCodeAt(0), VALUE_AT + 1);
    const error = refusal(() => decodeRecordBatch(tampered), /crc is .* but its bytes compute to/);
    assert.equal(error.offset, 17);
  });

  it("refuses a magic other than two, naming the one it found", () => {
    const frame = batch([record(0, "k1", "hello")]);
    const tampered = Buffer.from(frame);
    tampered.writeUInt8(1, 16);
    refusal(() => decodeRecordBatch(tampered), /magic 1; this world speaks magic 2 only/);
  });

  it("refuses a compressed batch by naming the codec it would have needed", () => {
    for (let bits = 1; bits < WIRE_COMPRESSION_CODECS.length + 1; bits += 1) {
      const attributes = bits & 0x07;
      const frame = handBatch([handRecordBody({ value: "hello" })], 1, 0, attributes);
      const codec = WIRE_COMPRESSION_CODECS[attributes] ?? `codec ${attributes}`;
      refusal(() => decodeRecordBatch(frame), new RegExp(`${codec} compressed`));
    }
  });

  it("refuses a batch stamped in log-append time", () => {
    const frame = handBatch([handRecordBody({ value: "hello" })], 1, 0, 0x08);
    refusal(() => decodeRecordBatch(frame), /log-append time/);
  });

  it("refuses a record whose own attributes are not zero", () => {
    const frame = handBatch([handRecordBody({ value: "hello", attributes: 1 })], 1, 0);
    refusal(() => decodeRecordBatch(frame), /record 0 carried attributes 1/);
  });

  it("refuses a record that declares more headers than it holds", () => {
    const frame = handBatch([handRecordBody({ value: "hello", headerCount: -1 })], 1, 0);
    refusal(() => decodeRecordBatch(frame), /record 0 declared -1 header\(s\)/);
  });

  it("refuses a batch whose record count disagrees with its last offset delta", () => {
    const frame = batch([record(0, "a", "1"), record(1, "b", "2")]);
    const tampered = Buffer.from(frame);
    tampered.writeInt32BE(5, 23);
    refusal(() => decodeRecordBatch(tampered), /holds 2 record\(s\) but declares a last offset delta of 5/);
  });

  it("refuses a batch that declares a length its own frame does not have", () => {
    const frame = batch([record(0, "k1", "hello")]);
    const longer = Buffer.concat([frame, Buffer.from([0])]);
    refusal(() => decodeRecordBatch(longer), /declared 63 byte\(s\) after its length field/);
    const shorter = frame.subarray(0, frame.length - 1);
    refusal(() => decodeRecordBatch(shorter), /declared 63 byte\(s\) after its length field/);
  });

  it("refuses a batch with bytes left over after the records it declared", () => {
    const body = handRecordBody({ value: "hello" });
    // `handRecordBody` returns the body *with* the varint that declares its length, so one entry of
    // `bodies` is one record's whole contribution to the frame. Derived from the body rather than
    // recalled as a number, so a body whose shape changes moves this figure with it instead of
    // silently leaving the assertion wrong.
    const frame = handBatch([body, body], 1, 0);
    assert.equal(frame.length, RECORDS_AT + body.length * 2);
    refusal(() => decodeRecordBatch(frame), new RegExp(`left ${body.length} unread byte\\(s\\)`));
  });

  it("refuses a batch that declares a negative number of records", () => {
    const frame = handBatch([], -1, 0);
    refusal(() => decodeRecordBatch(frame), /declared -1 record\(s\)/);
  });

  it("round-trips a batch holding no records at all", () => {
    const decoded = decodeRecordBatch(batch([]));
    assert.deepEqual(decoded.records, []);
    assert.equal(decoded.baseOffset, 0);
  });
});
