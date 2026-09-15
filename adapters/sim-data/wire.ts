/**
 * The byte grammar the eleventh world's substitute really speaks.
 *
 * ## Why this file exists at all
 *
 * Every other simulated world in this tree answers the application in a form the application could
 * not have mistaken for the real thing: `sim-k8s` and `sim-cloud` answer HTTP, which is a grammar
 * anything can speak, and `sim-posix`, `sim-os` and `sim-container` answer *command vectors printed
 * on the application's stdout*, which is a grammar this repository invented. A data platform is the
 * first subject whose real interface is neither: a Kafka broker is reached over a TCP socket in a
 * **binary** grammar, and the interesting failures of a data pipeline are exactly the ones a
 * text-shaped substitute cannot reproduce - a record batch whose CRC does not match, a partition
 * whose high watermark moved, an offset committed for the wrong generation.
 *
 * So the substitution happens one layer lower than in any world before it. What is stood in is the
 * *broker* - the log, the partitions, the offset store - and what is **not** stood in is the
 * transport or the grammar: these are real bytes, big-endian, in Kafka's own layout, framed by real
 * length prefixes and checked against a real CRC-32C. An application that speaks this grammar is
 * genuinely talking to a broker; it is talking to one that keeps its log in a `Map` instead of on
 * disk.
 *
 * ## What is deliberately NOT here
 *
 * Two things, and both are refusals rather than omissions.
 *
 * **Flexible versions are not implemented.** Kafka grows a "flexible" encoding per API version that
 * adds tagged fields and compact arrays throughout. This module implements the pre-flexible grammar
 * only, and `protocol.ts` advertises exactly the non-flexible versions it implements, so a client
 * that asks for a flexible one is *told* the version is unsupported rather than being handed bytes
 * it would misparse. That is the same discipline `sim-container` follows: a world that states its
 * own limits is a world a reader can trust, and a world that quietly accepted a version it does not
 * implement would produce a decode error in the client that nothing in this repository could
 * explain.
 *
 * **No compression codec is implemented.** Kafka's record batch carries an attributes bitfield that
 * selects gzip, snappy, lz4 or zstd. This module records the bitfield, refuses an unknown one, and
 * treats the four *known* ones as "compressed, not attempted" rather than decompressing them - see
 * `WireBatch.compression`. The alternative would be to link a codec, and a substitution that needs a
 * dependency to be a substitution has stopped being one.
 *
 * ## The layout, so a reader can check it without running anything
 *
 * Kafka's record batch (magic 2, the `RecordBatch` format current since 0.11) is:
 *
 * ```
 * baseOffset            INT64
 * batchLength           INT32   bytes after this field
 * partitionLeaderEpoch  INT32
 * magic                 INT8    2
 * crc                   UINT32  CRC-32C of every byte after this field
 * attributes            INT16
 * lastOffsetDelta       INT32
 * firstTimestamp        INT64
 * maxTimestamp          INT64
 * producerId            INT64   -1 when unset
 * producerEpoch         INT16   -1 when unset
 * baseSequence          INT32   -1 when unset
 * recordsCount          INT32
 * records               [Record]
 * ```
 *
 * and one `Record`, whose `length` covers everything after it:
 *
 * ```
 * length        VARINT  bytes after this field
 * attributes    INT8
 * timestampDelta VARLONG
 * offsetDelta   VARINT
 * keyLength     VARINT  -1 for a null key
 * key           BYTES
 * valueLength   VARINT  -1 for a null value
 * value         BYTES
 * headersCount  VARINT
 * headers       [{ keyLength VARINT, key BYTES, valueLength VARINT, value BYTES }]
 * ```
 *
 * `VARINT` is Kafka's zig-zag varint, which this module implements as `writeVarlong`/`readVarlong`
 * because the two differ only in width and a record's fields are all small enough that the narrow
 * form and the wide form produce identical bytes for every value a `produce` will carry.
 *
 * The `length` prefix of a record is the reason this file can be *checked* rather than only
 * believed: every field of a record is sized by the prefix, so a record whose declared length does
 * not equal the bytes its own fields occupy is a layout error this module refuses, and a record
 * whose fields were written in the wrong order will fail that equality the first time it is read
 * back. `WireError` names the byte offset and what disagreed.
 */

/** A byte count that cannot be exceeded by a frame this module will assemble. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** The reflected Castagnoli polynomial, which is the one Kafka's `crc` field is computed with. */
const CRC32C_POLYNOMIAL = 0x82f63b78;

const CRC32C_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ CRC32C_POLYNOMIAL : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * CRC-32C, the checksum a Kafka record batch carries.
 *
 * Deliberately not `zlib.crc32`: that is the *other* CRC-32 - the zlib/PNG polynomial - and the two
 * disagree on every input. A substitute that validated a batch with the wrong polynomial would
 * accept a corrupted batch and reject a correct one, and neither failure would name its cause. The
 * test beside this file pins the published check value for `"123456789"`, which is
 * `0xE3069283` for this polynomial and `0xCBF43926` for the other one, so the two cannot be
 * confused silently.
 */
export function crc32c(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32C_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A byte stream that refused to be read. The message always names the offset and the disagreement. */
export class WireError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset})`);
    this.name = "WireError";
    this.offset = offset;
  }
}

/**
 * A reader over one frame's worth of bytes.
 *
 * Every method is bounds-checked and every failure is a `WireError` naming the offset, because the
 * alternative - reading past the end and producing `undefined` arithmetic - is how a truncated frame
 * becomes a criterion that passes for the wrong reason.
 */
export class WireReader {
  readonly #bytes: Buffer;
  #position = 0;

  constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  /** Bytes consumed so far. A failure message quotes it, so a reader can find the field. */
  get position(): number {
    return this.#position;
  }

  /** Bytes left. A frame decoder uses it to prove it consumed the whole frame. */
  get remaining(): number {
    return this.#bytes.length - this.#position;
  }

  /** The bytes not yet consumed, without consuming them. */
  get rest(): Buffer {
    return this.#bytes.subarray(this.#position);
  }

  #need(count: number): number {
    if (count < 0) {
      throw new WireError(`a negative length was asked for (${count})`, this.#position);
    }
    if (this.#position + count > this.#bytes.length) {
      throw new WireError(
        `the frame ends before ${count} byte(s) could be read; ${this.remaining} remained`,
        this.#position,
      );
    }
    const at = this.#position;
    this.#position += count;
    return at;
  }

  readInt8(): number {
    return this.#bytes.readInt8(this.#need(1));
  }

  readBoolean(): boolean {
    const value = this.readInt8();
    if (value !== 0 && value !== 1) {
      throw new WireError(`a boolean field held ${value}, which is neither 0 nor 1`, this.position - 1);
    }
    return value === 1;
  }

  readInt16(): number {
    return this.#bytes.readInt16BE(this.#need(2));
  }

  readInt32(): number {
    return this.#bytes.readInt32BE(this.#need(4));
  }

  readUint32(): number {
    return this.#bytes.readUInt32BE(this.#need(4));
  }

  /**
   * A 64-bit field, read as a JavaScript number.
   *
   * Kafka's offsets and timestamps are `INT64`. Refusing a value beyond `Number.MAX_SAFE_INTEGER`
   * rather than rounding it is the honest choice for a substitute: a log this world holds never
   * reaches 2^53 records, so a value that large can only mean the bytes were not a Kafka frame - and
   * silently rounding it would turn "this is not the grammar you think it is" into a criterion that
   * fails for an unexplainable reason.
   */
  readInt64(): number {
    const at = this.#need(8);
    const value = this.#bytes.readBigInt64BE(at);
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new WireError(`a 64-bit field held ${value}, which is past the exact range of a number`, at);
    }
    return Number(value);
  }

  /** `STRING`: an `INT16` byte length then UTF-8 bytes. */
  readString(): string {
    const length = this.readInt16();
    if (length < 0) {
      throw new WireError(`a non-nullable string declared ${length} bytes`, this.position - 2);
    }
    return this.readBytes(length).toString("utf8");
  }

  /** `NULLABLE_STRING`: `-1` is null, which is a value rather than an error. */
  readNullableString(): string | null {
    const length = this.readInt16();
    if (length === -1) return null;
    if (length < 0) {
      throw new WireError(`a nullable string declared ${length} bytes`, this.position - 2);
    }
    return this.readBytes(length).toString("utf8");
  }

  /** `BYTES`: an `INT32` byte length then the bytes. `-1` is null. */
  readBytes(length: number): Buffer {
    if (length < 0) {
      throw new WireError(`a byte field declared ${length} bytes`, this.position);
    }
    const at = this.#need(length);
    return this.#bytes.subarray(at, at + length);
  }

  readNullableBytes(): Buffer | null {
    const length = this.readInt32();
    if (length === -1) return null;
    if (length < 0) {
      throw new WireError(`a nullable byte field declared ${length} bytes`, this.position - 4);
    }
    return this.readBytes(length);
  }

  /**
   * An `ARRAY`'s element count. `-1` is a null array and `0` is an empty one, and the two are
   * different answers - a `null` topic list means "every topic" to a `Metadata` request and an empty
   * one means "no topics at all", so collapsing them would give one request two meanings.
   */
  readArrayLength(): number {
    const count = this.readInt32();
    if (count < -1) {
      throw new WireError(`an array declared ${count} elements`, this.position - 4);
    }
    if (count > this.remaining) {
      throw new WireError(
        `an array declared ${count} elements with only ${this.remaining} byte(s) left`,
        this.position - 4,
      );
    }
    return count;
  }

  /** Kafka's zig-zag varint. */
  readVarint(): number {
    return this.readVarlong();
  }

  /** Kafka's zig-zag varlong. A value past the exact range of a number is refused, as `INT64` is. */
  readVarlong(): number {
    let shift = 0;
    let encoded = 0n;
    for (;;) {
      const at = this.#need(1);
      const byte = this.#bytes.readUInt8(at);
      encoded |= BigInt(byte & 0x7f) << BigInt(shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 63) {
        throw new WireError("a varint ran past 64 bits without terminating", at);
      }
    }
    const magnitude = (encoded >> 1n) ^ -(encoded & 1n);
    if (magnitude > BigInt(Number.MAX_SAFE_INTEGER) || magnitude < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new WireError(`a varint held ${magnitude}, which is past the exact range of a number`, this.position);
    }
    return Number(magnitude);
  }
}

/** A builder for one frame's worth of bytes, in the same grammar. */
export class WireWriter {
  readonly #parts: Buffer[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  #push(bytes: Buffer): void {
    if (this.#length + bytes.length > MAX_FRAME_BYTES) {
      throw new WireError(`a frame grew past the ${MAX_FRAME_BYTES} byte ceiling`, this.#length);
    }
    this.#parts.push(bytes);
    this.#length += bytes.length;
  }

  writeInt8(value: number): void {
    const one = Buffer.allocUnsafe(1);
    one.writeInt8(value, 0);
    this.#push(one);
  }

  /**
   * A byte, not an `INT8` field.
   *
   * These are two different things and the difference is 128. Kafka's `INT8` is signed, and a
   * varint's continuation byte has its high bit set - so routing a varint byte through `writeInt8`
   * throws `ERR_OUT_OF_RANGE` for every value whose zig-zag form needs more than one byte, which is
   * every length, every offset delta and every header count a real record carries. This module
   * shipped that defect until a round-trip test wrote a varint larger than 63 and the writer refused
   * it.
   */
  writeUint8(value: number): void {
    const one = Buffer.allocUnsafe(1);
    one.writeUInt8(value & 0xff, 0);
    this.#push(one);
  }

  writeBoolean(value: boolean): void {
    this.writeInt8(value ? 1 : 0);
  }

  writeInt16(value: number): void {
    const two = Buffer.allocUnsafe(2);
    two.writeInt16BE(value, 0);
    this.#push(two);
  }

  writeInt32(value: number): void {
    const four = Buffer.allocUnsafe(4);
    four.writeInt32BE(value, 0);
    this.#push(four);
  }

  writeUint32(value: number): void {
    const four = Buffer.allocUnsafe(4);
    four.writeUInt32BE(value >>> 0, 0);
    this.#push(four);
  }

  writeInt64(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new WireError(`a 64-bit field was asked to hold ${value}, which a number cannot express`, this.#length);
    }
    const eight = Buffer.allocUnsafe(8);
    eight.writeBigInt64BE(BigInt(value), 0);
    this.#push(eight);
  }

  writeString(value: string): void {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > 0x7fff) {
      throw new WireError(`a string of ${bytes.length} bytes cannot be written as a STRING`, this.#length);
    }
    this.writeInt16(bytes.length);
    this.#push(bytes);
  }

  writeNullableString(value: string | null): void {
    if (value === null) {
      this.writeInt16(-1);
      return;
    }
    this.writeString(value);
  }

  writeBytes(value: Buffer | null): void {
    if (value === null) {
      this.writeInt32(-1);
      return;
    }
    this.writeInt32(value.length);
    this.#push(value);
  }

  /**
   * Bytes with no length prefix of their own.
   *
   * Needed because a record and a record batch are the two places Kafka writes a length and then the
   * bytes, rather than a length-prefixed `BYTES` field - so a call to `writeBytes` there would write
   * *two* lengths and shift every following field by four bytes, producing a frame the sender
   * believes in and no reader can parse. `writeBytes` is the `BYTES` field of the message grammar;
   * this is the raw body those two length prefixes introduce.
   */
  writeRaw(value: Buffer): void {
    this.#push(value);
  }

  writeArrayLength(count: number): void {
    this.writeInt32(count);
  }

  writeVarint(value: number): void {
    this.writeVarlong(value);
  }

  writeVarlong(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new WireError(`a varint was asked to hold ${value}, which a number cannot express`, this.#length);
    }
    let encoded = BigInt.asUintN(64, (BigInt(value) << 1n) ^ (BigInt(value) >> 63n));
    for (;;) {
      const byte = Number(encoded & 0x7fn);
      encoded >>= 7n;
      if (encoded === 0n) {
        this.writeUint8(byte);
        return;
      }
      this.writeUint8(byte | 0x80);
    }
  }

  /** The frame as one buffer. The parts are copied so the result cannot alias the writer's memory. */
  toBuffer(): Buffer {
    return Buffer.concat(this.#parts, this.#length);
  }
}

/** One record as the wire carries it: a key, a value, a timestamp and any headers. */
export interface WireRecord {
  /** The record's offset inside its partition, or `null` for a record being produced. */
  readonly offset: number | null;
  /** Milliseconds, or `null` for a record being produced without one. */
  readonly timestamp: number | null;
  /** `null` and an empty buffer are different things: an empty key hashes to one partition. */
  readonly key: Buffer | null;
  readonly value: Buffer | null;
  readonly headers: readonly { readonly key: string; readonly value: Buffer | null }[];
}

/** A decoded record batch: the records plus the header facts a reading reports. */
export interface WireBatch {
  readonly baseOffset: number;
  readonly magic: number;
  readonly attributes: number;
  readonly firstTimestamp: number;
  readonly maxTimestamp: number;
  readonly producerId: number;
  readonly producerEpoch: number;
  readonly baseSequence: number;
  /**
   * `null` for an uncompressed batch; otherwise the codec the attributes selected.
   *
   * A compressed batch is **refused**, not decompressed - see the file header. The field exists so
   * the refusal can name which codec it found, which turns "this substitute cannot read your batch"
   * into a sentence a reader can act on.
   */
  readonly compression: string | null;
  readonly records: readonly WireRecord[];
}

/** The compression codecs Kafka's attributes bitfield can select, in bit order. */
export const WIRE_COMPRESSION_CODECS = Object.freeze([
  "gzip",
  "snappy",
  "lz4",
  "zstd",
] as const);

/** The `attributes` bits this module understands. Anything else is refused by name. */
const TIMESTAMP_TYPE_MASK = 0x08;

/**
 * Encode a record batch.
 *
 * `baseOffset` is what the *broker* decides, so a client producing records writes `0` and the world
 * rewrites the header on ingest; this function takes it as an argument rather than assuming it,
 * because `Fetch` hands the batch back and the offsets it carries are the world's own.
 */
export function encodeRecordBatch(input: {
  readonly baseOffset: number;
  readonly records: readonly WireRecord[];
  readonly firstTimestamp: number;
  readonly maxTimestamp: number;
}): Buffer {
  /**
   * The delta each record carries.
   *
   * A producer writes records with no offset of their own - the broker assigns them - so the delta
   * is the record's *position in the batch*, which is what a real client writes and what the
   * batch's `lastOffsetDelta` is checked against on the way back in. Writing `0` for every
   * client-produced record would encode a batch this module's own decoder refuses, which is the kind
   * of self-inconsistency a round-trip test catches and nothing else does.
   */
  const deltas = input.records.map((record, index) =>
    record.offset === null ? index : record.offset - input.baseOffset,
  );

  const body = new WireWriter();
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index] as WireRecord;
    const payload = new WireWriter();
    payload.writeInt8(0);
    payload.writeVarlong((record.timestamp ?? 0) - input.firstTimestamp);
    payload.writeVarint(deltas[index] ?? index);
    if (record.key === null) {
      payload.writeVarint(-1);
    } else {
      payload.writeVarint(record.key.length);
      payload.writeRaw(record.key);
    }
    if (record.value === null) {
      payload.writeVarint(-1);
    } else {
      payload.writeVarint(record.value.length);
      payload.writeRaw(record.value);
    }
    payload.writeVarint(record.headers.length);
    for (const header of record.headers) {
      const key = Buffer.from(header.key, "utf8");
      payload.writeVarint(key.length);
      payload.writeRaw(key);
      if (header.value === null) {
        payload.writeVarint(-1);
      } else {
        payload.writeVarint(header.value.length);
        payload.writeRaw(header.value);
      }
    }
    const bytes = payload.toBuffer();
    body.writeVarint(bytes.length);
    body.writeRaw(bytes);
  }

  const records = body.toBuffer();
  const afterCrc = new WireWriter();
  afterCrc.writeInt16(0);
  afterCrc.writeInt32(deltas.length === 0 ? 0 : Math.max(...deltas));
  afterCrc.writeInt64(input.firstTimestamp);
  afterCrc.writeInt64(input.maxTimestamp);
  afterCrc.writeInt64(-1);
  afterCrc.writeInt16(-1);
  afterCrc.writeInt32(-1);
  afterCrc.writeInt32(input.records.length);
  afterCrc.writeRaw(records);
  const tail = afterCrc.toBuffer();

  const head = new WireWriter();
  head.writeInt64(input.baseOffset);
  head.writeInt32(9 + tail.length);
  head.writeInt32(-1);
  head.writeInt8(2);
  head.writeUint32(crc32c(tail));
  head.writeRaw(tail);
  return head.toBuffer();
}

/**
 * Decode a record batch, refusing anything this module cannot read *by name*.
 *
 * Three refusals are deliberate and each one exists because the alternative is a reading that
 * quietly means something else: a magic other than `2` (an older log format, which this world does
 * not implement), a compression attribute (this world decompresses nothing), and a record whose
 * declared length disagrees with the bytes its own fields occupy (the layout check the file header
 * describes).
 */
export function decodeRecordBatch(bytes: Buffer): WireBatch {
  const reader = new WireReader(bytes);
  const baseOffset = reader.readInt64();
  const batchLength = reader.readInt32();
  if (batchLength !== reader.remaining) {
    throw new WireError(
      `a batch declared ${batchLength} byte(s) after its length field, and ${reader.remaining} byte(s) follow it`,
      reader.position - 4,
    );
  }
  const partitionLeaderEpoch = reader.readInt32();
  const magic = reader.readInt8();
  if (magic !== 2) {
    throw new WireError(`a record batch declared magic ${magic}; this world speaks magic 2 only`, reader.position - 1);
  }
  const crc = reader.readUint32();
  const crcStart = reader.position;
  const attributes = reader.readInt16();
  const lastOffsetDelta = reader.readInt32();
  const firstTimestamp = reader.readInt64();
  const maxTimestamp = reader.readInt64();
  const producerId = reader.readInt64();
  const producerEpoch = reader.readInt16();
  const baseSequence = reader.readInt32();
  const count = reader.readInt32();
  if (count < 0) {
    throw new WireError(`a batch declared ${count} record(s)`, reader.position - 4);
  }

  const compressionBits = attributes & 0x07;
  const codec = WIRE_COMPRESSION_CODECS[compressionBits] ?? null;
  if (compressionBits !== 0) {
    throw new WireError(
      `the batch is ${codec ?? `codec ${compressionBits}`} compressed, and this world decompresses nothing`,
      crcStart,
    );
  }
  if ((attributes & TIMESTAMP_TYPE_MASK) !== 0) {
    throw new WireError("the batch stamps records in log-append time, which this world does not implement", crcStart);
  }

  const records: WireRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const declared = reader.readVarint();
    if (declared < 0) {
      throw new WireError(`record ${index} declared a length of ${declared}`, reader.position);
    }
    const bodyStart = reader.position;
    const recordAttributes = reader.readInt8();
    if (recordAttributes !== 0) {
      throw new WireError(`record ${index} carried attributes ${recordAttributes}, which this world does not read`, bodyStart);
    }
    const timestampDelta = reader.readVarlong();
    const offsetDelta = reader.readVarint();
    const keyLength = reader.readVarint();
    const key = keyLength === -1 ? null : Buffer.from(reader.readBytes(keyLength));
    const valueLength = reader.readVarint();
    const value = valueLength === -1 ? null : Buffer.from(reader.readBytes(valueLength));
    const headerCount = reader.readVarint();
    if (headerCount < 0) {
      throw new WireError(`record ${index} declared ${headerCount} header(s)`, reader.position);
    }
    const headers: { key: string; value: Buffer | null }[] = [];
    for (let header = 0; header < headerCount; header += 1) {
      const nameLength = reader.readVarint();
      if (nameLength < 0) {
        throw new WireError(`header ${header} of record ${index} declared a key of ${nameLength} byte(s)`, reader.position);
      }
      const name = reader.readBytes(nameLength).toString("utf8");
      const headerLength = reader.readVarint();
      const headerValue = headerLength === -1 ? null : Buffer.from(reader.readBytes(headerLength));
      headers.push({ key: name, value: headerValue });
    }
    const consumed = reader.position - bodyStart;
    if (consumed !== declared) {
      throw new WireError(
        `record ${index} declared ${declared} byte(s) but its fields occupy ${consumed}`,
        bodyStart,
      );
    }
    records.push({
      offset: baseOffset + offsetDelta,
      timestamp: firstTimestamp + timestampDelta,
      key,
      value,
      headers,
    });
  }

  if (records.length > 0) {
    const last = records.length - 1;
    if (last !== lastOffsetDelta) {
      throw new WireError(
        `the batch holds ${records.length} record(s) but declares a last offset delta of ${lastOffsetDelta}`,
        crcStart,
      );
    }
  }

  /**
   * The leftover check runs before the crc check, and the order is the point.
   *
   * `batchLength` was already pinned to the frame's exact length, so bytes still unread after the
   * records the batch declared mean the *count* is wrong - the frame is sound and its contents are
   * not what its header says. Reporting a crc mismatch there would name a corruption that does not
   * exist and send the reader looking for one, which is the same defect as a substitute that merges
   * `404` into `405`.
   */
  if (reader.remaining !== 0) {
    throw new WireError(`the batch left ${reader.remaining} unread byte(s)`, reader.position);
  }

  const crcEnd = reader.position;
  const computed = crc32c(bytes.subarray(crcStart, crcEnd));
  if (computed !== crc) {
    throw new WireError(
      `the batch's crc is ${crc.toString(16)} but its bytes compute to ${computed.toString(16)}`,
      crcStart - 4,
    );
  }

  return {
    baseOffset,
    magic,
    attributes,
    firstTimestamp,
    maxTimestamp,
    producerId,
    producerEpoch,
    baseSequence,
    compression: null,
    records,
  };
}
