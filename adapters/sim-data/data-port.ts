/**
 * The substitute broker the eleventh world speaks to, over a real TCP socket.
 *
 * ## What this is judged by, and why it is not `sim-cloud` with a different transport
 *
 * `adapters/sim-cloud/cloud-port.ts` stands in for a provider's HTTP API and a criterion there is a
 * question about a *request the world decided*. This file stands in for a broker, and a broker is
 * judged by **the state that outlives the request that made it**: a log with offsets and watermarks,
 * a partition's replica membership, a group's generation and the offsets it committed. That is why
 * `snapshot()` is the reading and `requests()` sits *beside* it rather than being it - a pipeline
 * that wrote a record to the wrong partition, or committed an offset for a generation that had
 * already moved on, has left no trace in the exchange that caused it and has left one in the log.
 *
 * ## The transport and the grammar are real. The broker is not.
 *
 * The application opens a real TCP socket on loopback and writes real bytes in a broker's own
 * pre-flexible binary layout: `./wire.ts` is the record-batch grammar and `./protocol.ts` is the
 * frame grammar around it, and both are exercised by their own falsified suites. **The broker is
 * stood in** - there is no cluster, no follower replica, no on-disk log, no group coordinator and no
 * rebalancer - and `DATA_SIMULATED_SURFACES` in `core/environment/data-observation.ts` names all
 * seven of the surfaces that are not there. That list is what a reader checks before believing a
 * `PASS`, and this file is where a reader checks whether it was telling the truth.
 *
 * ## The two refusals this layer adds to the grammar's own
 *
 * `./protocol.ts` already refuses a flexible version by name and a compressed batch by name. Two
 * more belong *here*, because they are properties of a server rather than of a decoder:
 *
 * 1. **A frame whose own header cannot be read is not answered.** A reply needs a correlation id,
 *    and a frame that failed inside its header has none - so writing one would be answering a
 *    request nobody made. The connection is closed and the reason is recorded, which is the only
 *    place that reason can survive; `DataRequestResult` already carries the word `unreadable` for
 *    exactly this, and `correlationId` is `null` in the record rather than guessed.
 * 2. **A frame that declares more bytes than the ceiling allows is refused without being buffered.**
 *    The ceiling exists to stop this process allocating what a client asked it to allocate, so a
 *    check that first waited for the bytes would be the ceiling written as a comment.
 *
 * ## There is no clock and no randomness anywhere in this file
 *
 * A record's timestamp is the producer's own, an offset is the record's position in its partition,
 * a partition's replicas are the ones a `CreateTopics` asked for, a member id is a counter, and
 * every listing is sorted. Nothing here consults `Date`, nothing generates an id from entropy, and
 * no response carries a duration - so two runs of one application over one contract produce
 * byte-identical snapshots, which is the property M1 compares.
 *
 * The one number that is not fixed by the run is the **port**, and it is honest that it is not: a
 * `0` in the identity means the operating system picks a free one, because an ephemeral port can
 * never collide with whatever else the machine is running. The snapshot records the port that was
 * actually bound, so a contract should compare the cluster and the node's id and not the port.
 *
 * ## What a reset destroys, and the alternative that was rejected
 *
 * `clear()` destroys the **whole cluster** - topics, partitions, records, members, generations and
 * every committed offset - and starts the meter over. The request record is left untouched, for the
 * reason `sim-cloud` records: it is evidence, and evidence of a violation is not destroyed by
 * repairing the violation.
 *
 * A committed offset is the one entry worth arguing about, because it is the *consumer's* record of
 * how far it has read rather than a property of the cluster, and a group holding offsets and no
 * members is a real state (`Empty`) rather than an invented one. **Keeping it across a reset was
 * rejected**, and the reason is the defect `sim-posix` already paid for: a world a run inherits is
 * not a world that run built. An iteration that left `cart-events/0 committed 3` behind would let a
 * criterion read `PASS` on evidence the iteration before it produced, which is the false-`PASS`
 * class this product exists to refuse. A criterion about resuming from a committed offset is still
 * expressible - the application commits, then re-reads, inside *one* iteration - and the cost of the
 * rejection is that an application which relies on offsets surviving a broker restart is not
 * testable here. That cost is stated rather than hidden.
 *
 * ## Why `logAppendTime` is `-1`
 *
 * A real broker whose topic is stamped in `CreateTime` - the default - returns `-1` there, because
 * the time on a record is the producer's. This world has no clock to stamp with, so `-1` is both the
 * protocol's own answer and the only honest one. The record's timestamp is the producer's own and is
 * what the snapshot reports.
 */

import { createServer, type Server, type Socket } from "node:net";

import {
  DATA_APIS,
  DATA_ERROR_CODES,
  DATA_MAX_REQUEST_BYTES,
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
  type DataApi,
  type DataFetchedOffset,
  type DataFetchResult,
  type DataListOffsetsResult,
  type DataMetadataPartition,
  type DataMetadataTopic,
  type DataProduceResult,
  type DataRequestBody,
} from "./protocol.ts";
import { decodeRecordBatch, encodeRecordBatch, type WireRecord } from "./wire.ts";

import {
  DATA_SIMULATED_SURFACES,
  type DataCommittedOffsetReading,
  type DataGroupMemberReading,
  type DataGroupReading,
  type DataMeterReading,
  type DataRecordReading,
  type DataRequestRecord,
  type DataRequestResult,
  type DataTopicReading,
} from "../../core/environment/data-observation.ts";

// ---------------------------------------------------------------------------------------------
// What a caller has to supply, and what a caller can ask for
// ---------------------------------------------------------------------------------------------

/** Who the substitute is: the cluster it answers for, and the endpoint it should try to bind. */
export interface DataIdentity {
  readonly cluster: string;
  readonly nodeId: number;
  /** The interface to bind. `127.0.0.1` is the honest default: nothing here is reachable from off. */
  readonly host: string;
  /** The port to ask for. `0` means the operating system picks a free one. */
  readonly port: number;
}

/**
 * The world as a reading sees it.
 *
 * Deliberately *not* carrying the request record or the meter. A snapshot is what the world holds,
 * and a request record is what the run did to it; a caller that needs both asks for both, and an
 * interface that mixed them would make it impossible to say which of two readings of a `PASS` was
 * the state and which was the history.
 */
export interface DataSnapshot {
  readonly cluster: string;
  readonly node: { readonly id: number; readonly host: string; readonly port: number };
  readonly topics: readonly DataTopicReading[];
  readonly groups: readonly DataGroupReading[];
}

/**
 * The two record counts a request did not carry, accumulated for the meter's current life.
 *
 * Deliberately mutable, and deliberately *not* `readonly produced` inside a `readonly #counts`: a
 * counter that is only ever read is a counter that is never incremented, and the compiler said so.
 */
interface DataCounts {
  produced: number;
  fetched: number;
}

/** What the world decided about one request, and the bytes it decided to write. */
interface DataAnswer {
  /** The response body, or `null` when the world writes nothing - which `Produce` with `acks=0` is. */
  readonly body: Buffer | null;
  readonly result: DataRequestResult;
  readonly errorCode: number;
  readonly reason: string | null;
}

/**
 * The substitute broker.
 *
 * The method list is deliberately the same shape as `CloudPort`'s and `K8sClusterPort`'s, because a
 * reader who has learned one of these has learned all of them: `listen`/`close` for the transport,
 * `identity`/`apis` for what the world is, `snapshot`/`requests`/`meters` for what it holds, and
 * `clear`/`dump`/`load` for the reset and the bundle.
 */
export interface DataPort {
  listen(address: { readonly host: string; readonly port: number }): Promise<string>;
  close(): Promise<void>;
  identity(): DataIdentity;
  /** The register, so the adapter can log what this world promised to answer. */
  apis(): readonly DataApi[];
  /**
   * Perform one command **in process**, on a criterion's behalf, and report what the world did.
   *
   * This is the second door into the same world. The first is the socket, which is the only door a
   * process other than this world can use, and it is why a record's `source` is `application` for
   * everything that arrives there. This one exists so a criterion can act in the world - make a
   * topic, write a record, read the log back, commit an offset - without shipping a Kafka client,
   * and it is the same idiom `sim-vscode`'s `invoke`/`activate` verbs and `sim-cloud`'s `call` step
   * use. Every record it produces is filed `source: "criterion"`, which is what stops a criterion's
   * own command from satisfying a criterion about the application.
   *
   * It returns the record rather than a body, because the question a caller has after commanding a
   * world is "what did it do about it" - and the record is that answer, with the result word, the
   * error code and the world's own reason all on it.
   */
  run(argv: readonly string[]): DataRequestRecord;
  requests(): readonly DataRequestRecord[];
  snapshot(): DataSnapshot;
  meters(): DataMeterReading;
  clear(): void;
  dump(): string;
  load(state: string): void;
}

/**
 * The words a criterion may command this world with, in the spelling a contract uses.
 *
 * Five words against a register of twelve APIs, which is the honest ratio rather than a gap to be
 * closed: a criterion needs to establish a fact and read it back, and the seven APIs this register
 * leaves out are not those. `JoinGroup`, `SyncGroup`, `Heartbeat`, `FindCoordinator`, `OffsetFetch`
 * and `ListOffsets` are the group protocol and the log inspection a *client* uses to stay alive and
 * to find its own place - a criterion that joined a group would be taking part in this world's
 * coordination rather than judging the application's part in it, and a criterion's committed offset
 * is read from the group, not fetched through the protocol. `ApiVersions` is left out for a
 * different reason: what this broker supports is the *world's* own register, and a criterion asking
 * about the world reads it through a validator over the reading rather than by performing a request
 * whose answer it would then have to compare with itself.
 *
 * The words are lower case and hyphenated so they read as what they do, and they are **not**
 * validator names: nothing here may be compared against `schemas/`, because a command is a step and
 * a validator is a comparison.
 */
export const DATA_COMMAND_WORDS = Object.freeze([
  "create-topic",
  "produce",
  "fetch",
  "metadata",
  "commit",
] as const);

/** One word from the register, as the register spells it. */
export type DataCommandWord = (typeof DATA_COMMAND_WORDS)[number];

// ---------------------------------------------------------------------------------------------
// What the world holds
// ---------------------------------------------------------------------------------------------

/** One record as the world holds it. The offset is the world's, never the producer's. */
interface StoredRecord {
  readonly offset: number;
  readonly timestamp: number;
  /** `null` and an empty buffer are different things: an empty key hashes to one partition. */
  readonly key: Buffer | null;
  readonly value: Buffer | null;
  readonly headers: readonly { readonly key: string; readonly value: Buffer | null }[];
}

/**
 * One partition as the world holds it.
 *
 * `replicas` is what was *asked for* and `leaderId` is where the partition actually is, which are
 * two different facts whenever a `CreateTopics` names more than one broker: the request is recorded
 * as it was made and the membership that could honour it is derived on every read. Keeping them
 * apart is what lets `replication 3 recorded, isr [1]` be one honest string rather than a claim this
 * world cannot support.
 */
interface StoredPartition {
  readonly leaderId: number;
  readonly replicas: readonly number[];
  readonly records: StoredRecord[];
}

interface StoredTopic {
  readonly name: string;
  /** What the request asked for. Honoured nowhere - see `DATA_SIMULATED_SURFACES.replication`. */
  readonly replicationFactor: number;
  readonly configs: readonly { readonly name: string; readonly value: string | null }[];
  readonly partitions: StoredPartition[];
}

interface StoredMember {
  readonly memberId: string;
  readonly clientId: string | null;
  readonly protocol: string;
  /** The subscription the member sent. Opaque to the world, and carried only to hand back. */
  readonly metadata: Buffer;
  /** The bytes the world last handed this member. Opaque, and reported by length only. */
  assignment: Buffer;
}

interface StoredGroup {
  readonly groupId: string;
  generationId: number;
  readonly protocolType: string;
  readonly members: StoredMember[];
  /**
   * Keyed `topic/partition`, in the same spelling `parseDataRef`'s `commit` noun resolves.
   *
   * A topic name may not hold a `/` - `#topicProblem` refuses one - so the key cannot be ambiguous,
   * and that refusal is the reason this key is safe rather than a convention this file hopes holds.
   */
  readonly committed: Map<string, { readonly offset: number; readonly metadata: string | null }>;
}

/** What a state document looks like when it is written down. */
interface StoredStateDocument {
  readonly format: "veridian.sim-data/1";
  readonly cluster: string;
  readonly nodeId: number;
  readonly topics: readonly {
    readonly name: string;
    readonly replicationFactor: number;
    readonly configs: readonly { readonly name: string; readonly value: string | null }[];
    readonly partitions: readonly {
      readonly leaderId: number;
      readonly replicas: readonly number[];
      readonly records: readonly {
        readonly offset: number;
        readonly timestamp: number;
        readonly keyHex: string | null;
        readonly valueHex: string | null;
        readonly headers: readonly { readonly name: string; readonly valueHex: string | null }[];
      }[];
    }[];
  }[];
  readonly groups: readonly {
    readonly groupId: string;
    readonly generationId: number;
    readonly protocolType: string;
    readonly members: readonly {
      readonly memberId: string;
      readonly clientId: string | null;
      readonly protocol: string;
      readonly metadataHex: string;
      readonly assignmentHex: string;
    }[];
    readonly committed: readonly {
      readonly topic: string;
      readonly partition: number;
      readonly offset: number;
      readonly metadata: string | null;
    }[];
  }[];
}

const STATE_FORMAT = "veridian.sim-data/1";

/**
 * A topic name, in the characters a broker's own naming rule allows.
 *
 * Enforced rather than assumed, because one of the keys this file uses is `topic/partition` and a
 * name holding a `/` would make that key ambiguous - a criterion could then read a committed offset
 * for one partition and be shown another. The refusal a `CreateTopics` gets is the world telling the
 * truth about its own rule rather than a parser quietly splitting on the wrong slash.
 */
const TOPIC_PATTERN = /^[a-zA-Z0-9._-]+$/;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// The substitute
// ---------------------------------------------------------------------------------------------

class TcpData implements DataPort {
  readonly #identity: DataIdentity;
  readonly #topics = new Map<string, StoredTopic>();
  readonly #groups = new Map<string, StoredGroup>();
  readonly #requests: DataRequestRecord[] = [];
  readonly #counts: DataCounts = { produced: 0, fetched: 0 };
  /** Where the current life's requests begin. `meters()` counts from here. */
  #lifeFrom = 0;
  readonly #server: Server;
  /**
   * Every live connection, so `close()` can end them.
   *
   * A `node:net` server has no `closeAllConnections` - that method belongs to `node:http`'s server,
   * whose connections it owns - so a substitute that waited for its clients to hang up would keep
   * the run's process alive past `stop()`. This set is what makes `close()` mean close.
   */
  readonly #sockets = new Set<Socket>();
  #address: { readonly host: string; readonly port: number };

  constructor(identity: DataIdentity) {
    this.#identity = identity;
    this.#address = { host: identity.host, port: identity.port };
    this.#server = createServer((socket) => {
      this.#accept(socket);
    });
  }

  identity(): DataIdentity {
    return this.#identity;
  }

  apis(): readonly DataApi[] {
    return DATA_APIS;
  }

  run(argv: readonly string[]): DataRequestRecord {
    const word = (argv[0] ?? "").trim();
    const parsed = parseDataCommand(argv);
    if (!parsed.ok) {
      // A command this world cannot read is filed under the word the caller used rather than under
      // an API name, because naming an API would say the request reached one. The key and version
      // are `-1` for the same reason: nothing about a request that was never formed can be filled
      // in, and a `0` would read as `Produce`'s own key.
      return this.#recordCommand({
        api: word === "" ? "no command" : `refused command '${word}'`,
        apiKey: -1,
        apiVersion: -1,
        result: "invalid-request",
        errorCode: DATA_ERROR_CODES.INVALID_REQUEST,
        reason: parsed.reason,
        bytesOut: 0,
      });
    }
    const api = this.#apiOf(parsed.apiKey);
    const apiVersion = this.#versionOf(parsed.apiKey);
    const answer = this.#serve(api, apiVersion, null, parsed.body);
    return this.#recordCommand({
      api: dataApiSpelling(api),
      apiKey: api.key,
      apiVersion,
      result: answer.result,
      errorCode: answer.errorCode,
      reason: answer.reason,
      bytesOut: answer.body === null ? 0 : answer.body.length,
    });
  }

  /**
   * File one in-process request and hand it back.
   *
   * `bytesIn` is zero and that is the fact rather than an omission: a command crosses no socket, so
   * there are no bytes in. `bytesOut` is the length of the response body this world really
   * produced, which is a real quantity even though nothing wrote it to a wire - and it is the field
   * that lets a reader compare a criterion's command with the application's traffic, since the
   * pair says which of the two carried bytes over the socket.
   */
  #recordCommand(fields: {
    readonly api: string;
    readonly apiKey: number;
    readonly apiVersion: number;
    readonly result: DataRequestResult;
    readonly errorCode: number;
    readonly reason: string | null;
    readonly bytesOut: number;
  }): DataRequestRecord {
    const record: DataRequestRecord = {
      api: fields.api,
      apiKey: fields.apiKey,
      apiVersion: fields.apiVersion,
      correlationId: null,
      clientId: null,
      source: "criterion",
      result: fields.result,
      errorCode: fields.errorCode,
      reason: fields.reason,
      bytesIn: 0,
      bytesOut: fields.bytesOut,
    };
    this.#record(record);
    return record;
  }

  async listen(address: { readonly host: string; readonly port: number }): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once("error", onError);
      this.#server.listen(address.port, address.host, () => {
        this.#server.off("error", onError);
        resolve();
      });
    });
    const bound = this.#server.address();
    if (bound === null || typeof bound === "string") {
      throw new Error("the substitute broker bound to an address it cannot describe");
    }
    this.#address = { host: address.host, port: bound.port };
    return `tcp://${address.host}:${String(bound.port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      for (const socket of this.#sockets) socket.destroy();
      this.#sockets.clear();
    });
  }

  requests(): readonly DataRequestRecord[] {
    return [...this.#requests];
  }

  snapshot(): DataSnapshot {
    return {
      cluster: this.#identity.cluster,
      node: { id: this.#identity.nodeId, host: this.#address.host, port: this.#address.port },
      topics: [...this.#topics.values()]
        .sort((left, right) => compareNames(left.name, right.name))
        .map((topic) => this.#readTopic(topic)),
      groups: [...this.#groups.values()]
        .sort((left, right) => compareNames(left.groupId, right.groupId))
        .map((group) => this.#readGroup(group)),
    };
  }

  meters(): DataMeterReading {
    const life = this.#requests.slice(this.#lifeFrom);
    let bytesIn = 0;
    let bytesOut = 0;
    for (const record of life) {
      bytesIn += record.bytesIn;
      bytesOut += record.bytesOut;
    }
    return {
      requests: life.length,
      bytesIn,
      bytesOut,
      recordsProduced: this.#counts.produced,
      recordsFetched: this.#counts.fetched,
    };
  }

  clear(): void {
    this.#topics.clear();
    this.#groups.clear();
    this.#counts.produced = 0;
    this.#counts.fetched = 0;
    this.#lifeFrom = this.#requests.length;
  }

  dump(): string {
    const document: StoredStateDocument = {
      format: STATE_FORMAT,
      cluster: this.#identity.cluster,
      nodeId: this.#identity.nodeId,
      topics: [...this.#topics.values()]
        .sort((left, right) => compareNames(left.name, right.name))
        .map((topic) => ({
          name: topic.name,
          replicationFactor: topic.replicationFactor,
          configs: topic.configs.map((config) => ({ name: config.name, value: config.value })),
          partitions: topic.partitions.map((partition) => ({
            leaderId: partition.leaderId,
            replicas: [...partition.replicas],
            records: partition.records.map((record) => ({
              offset: record.offset,
              timestamp: record.timestamp,
              keyHex: record.key === null ? null : record.key.toString("hex"),
              valueHex: record.value === null ? null : record.value.toString("hex"),
              headers: record.headers.map((header) => ({
                name: header.key,
                valueHex: header.value === null ? null : header.value.toString("hex"),
              })),
            })),
          })),
        })),
      groups: [...this.#groups.values()]
        .sort((left, right) => compareNames(left.groupId, right.groupId))
        .map((group) => ({
          groupId: group.groupId,
          generationId: group.generationId,
          protocolType: group.protocolType,
          members: group.members.map((member) => ({
            memberId: member.memberId,
            clientId: member.clientId,
            protocol: member.protocol,
            metadataHex: member.metadata.toString("hex"),
            assignmentHex: member.assignment.toString("hex"),
          })),
          committed: [...group.committed.entries()]
            .map(([key, value]) => {
              const [topic, partition] = key.split("/");
              return {
                topic: topic ?? "",
                partition: Number(partition ?? "0"),
                offset: value.offset,
                metadata: value.metadata,
              };
            })
            .sort((left, right) => compareNames(left.topic, right.topic) || left.partition - right.partition),
        })),
    };
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  load(state: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state);
    } catch (error) {
      throw new Error(`the snapshot is not a data-broker state document: ${reasonOf(error)}`);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { readonly format?: unknown }).format !== STATE_FORMAT
    ) {
      throw new Error(`the snapshot is not a data-broker state document: it is not ${STATE_FORMAT}`);
    }
    const document = parsed as StoredStateDocument;
    this.#topics.clear();
    this.#groups.clear();
    for (const topic of document.topics) {
      this.#topics.set(topic.name, {
        name: topic.name,
        replicationFactor: topic.replicationFactor,
        configs: topic.configs.map((config) => ({ name: config.name, value: config.value })),
        partitions: topic.partitions.map((partition) => ({
          leaderId: partition.leaderId,
          replicas: [...partition.replicas],
          records: partition.records.map((record) => ({
            offset: record.offset,
            timestamp: record.timestamp,
            key: record.keyHex === null ? null : Buffer.from(record.keyHex, "hex"),
            value: record.valueHex === null ? null : Buffer.from(record.valueHex, "hex"),
            headers: record.headers.map((header) => ({
              key: header.name,
              value: header.valueHex === null ? null : Buffer.from(header.valueHex, "hex"),
            })),
          })),
        })),
      });
    }
    for (const group of document.groups) {
      const committed = new Map<string, { readonly offset: number; readonly metadata: string | null }>();
      for (const entry of group.committed) {
        committed.set(`${entry.topic}/${String(entry.partition)}`, {
          offset: entry.offset,
          metadata: entry.metadata,
        });
      }
      this.#groups.set(group.groupId, {
        groupId: group.groupId,
        generationId: group.generationId,
        protocolType: group.protocolType,
        members: group.members.map((member) => ({
          memberId: member.memberId,
          clientId: member.clientId,
          protocol: member.protocol,
          metadata: Buffer.from(member.metadataHex, "hex"),
          assignment: Buffer.from(member.assignmentHex, "hex"),
        })),
        committed,
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // The transport
  // -------------------------------------------------------------------------------------------

  /**
   * Reads frames off one connection, reassembling them across however many segments arrive.
   *
   * A TCP read is a chunk of a stream and not a frame, so a socket that receives two requests in one
   * segment, or half of one request, is the ordinary case rather than an edge case. The leftover
   * bytes are kept and prepended to the next chunk, which is the only way a frame longer than one
   * segment is ever read.
   */
  #accept(socket: Socket): void {
    // Declared `Buffer` rather than let to be inferred: `Buffer.alloc` produces a
    // `Buffer<ArrayBuffer>` and `Buffer#subarray` produces a `Buffer<ArrayBufferLike>`, so the
    // inferred type would refuse the reassignment three lines down that makes reassembly work.
    let pending: Buffer = Buffer.alloc(0);
    this.#sockets.add(socket);
    socket.on("close", () => {
      this.#sockets.delete(socket);
    });
    socket.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readInt32BE(0);
        if (length < 0 || length > DATA_MAX_REQUEST_BYTES) {
          const reason =
            length < 0
              ? `a request frame declared ${length} byte(s)`
              : `a request frame declared ${length} byte(s), past the ${DATA_MAX_REQUEST_BYTES} byte ceiling`;
          this.#record({
            api: "unreadable frame",
            apiKey: -1,
            apiVersion: -1,
            correlationId: null,
            clientId: null,
            source: "application",
            result: "unreadable",
            errorCode: DATA_ERROR_CODES.INVALID_REQUEST,
            reason,
            bytesIn: 4,
            bytesOut: 0,
          });
          socket.destroy();
          return;
        }
        if (pending.length - 4 < length) return;
        const frame = pending.subarray(0, length + 4);
        pending = pending.subarray(length + 4);
        if (!this.#answer(socket, frame)) return;
      }
    });
    // A client that goes away mid-request is the client's business, not this world's failure: there
    // is no one left to tell, and recording it as a world error would put a defect in the bundle
    // that the application did not cause.
    socket.on("error", () => undefined);
  }

  /** Answers one frame. Returns `false` when the connection has been closed and nothing more can be. */
  #answer(socket: Socket, frame: Buffer): boolean {
    const bytesIn = frame.length;
    const decoded = decodeRequestFrame(frame);
    if (decoded.kind === "unreadable") {
      this.#record({
        api: "unreadable frame",
        apiKey: -1,
        apiVersion: -1,
        correlationId: null,
        clientId: null,
        source: "application",
        result: "unreadable",
        errorCode: DATA_ERROR_CODES.INVALID_REQUEST,
        reason: decoded.reason,
        bytesIn,
        bytesOut: 0,
      });
      socket.destroy();
      return false;
    }
    if (decoded.kind === "unsupported") {
      const body = encodeRefusalResponse(decoded.api, decoded.code);
      const response = encodeResponseFrame(decoded.correlationId, body);
      socket.write(response);
      this.#record({
        api: decoded.api === null ? `API key ${decoded.apiKey}` : dataApiSpelling(decoded.api),
        apiKey: decoded.apiKey,
        apiVersion: decoded.apiVersion,
        correlationId: decoded.correlationId,
        clientId: decoded.clientId,
        source: "application",
        result: decoded.api === null ? "unknown-api" : this.#resultOf(decoded.code),
        errorCode: decoded.code,
        reason: decoded.reason,
        bytesIn,
        bytesOut: response.length,
      });
      return true;
    }

    const answer = this.#serve(decoded.api, decoded.apiVersion, decoded.clientId, decoded.body);
    const headers = {
      api: dataApiSpelling(decoded.api),
      apiKey: decoded.api.key,
      apiVersion: decoded.apiVersion,
      correlationId: decoded.correlationId,
      clientId: decoded.clientId,
      source: "application" as const,
      result: answer.result,
      errorCode: answer.errorCode,
      reason: answer.reason,
      bytesIn,
    };
    if (answer.body === null) {
      this.#record({ ...headers, bytesOut: 0 });
      return true;
    }
    const response = encodeResponseFrame(decoded.correlationId, answer.body);
    socket.write(response);
    this.#record({ ...headers, bytesOut: response.length });
    return true;
  }

  #record(record: DataRequestRecord): void {
    this.#requests.push(record);
  }

  // -------------------------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------------------------

  #serve(
    api: DataApi,
    apiVersion: number,
    clientId: string | null,
    body: DataRequestBody,
  ): DataAnswer {
    switch (body.kind) {
      case "api-versions":
        return this.#settle(encodeApiVersionsResponse(DATA_ERROR_CODES.NONE), [], []);
      case "metadata":
        return this.#metadata(body);
      case "create-topics":
        return this.#createTopics(body);
      case "produce":
        return this.#produceSettled(body);
      case "fetch":
        return this.#fetch(body);
      case "list-offsets":
        return this.#listOffsets(body, apiVersion);
      case "find-coordinator":
        return this.#findCoordinator(body);
      case "join-group":
        return this.#joinGroup(body, clientId);
      case "sync-group":
        return this.#syncGroup(body);
      case "heartbeat":
        return this.#heartbeat(body);
      case "offset-commit":
        return this.#offsetCommit(body);
      case "offset-fetch":
        return this.#offsetFetch(body);
      default: {
        // Unreachable: the union is exhaustive and every branch above is one of its kinds. Written
        // as a refusal rather than as a throw so that a kind added to the grammar and forgotten
        // here is refused *in the world* - and recorded - rather than crashing a socket, which
        // would turn a missing decoder into an unreadable connection.
        const kind = (body as unknown as { readonly kind: string }).kind;
        const why = `${api.name} v${apiVersion} carries a body kind this world does not dispatch: '${kind}'`;
        return {
          body: encodeRefusalResponse(api, DATA_ERROR_CODES.INVALID_REQUEST),
          result: "invalid-request",
          errorCode: DATA_ERROR_CODES.INVALID_REQUEST,
          reason: why,
        };
      }
    }
  }

  /**
   * Turns a response body and the codes inside it into one answer.
   *
   * The rule is single and uniform across every API: **a response carrying any non-zero code is
   * recorded as a refusal**, and the reason names the first one, because a record that said `ok`
   * about a response whose own body holds an error would make the record the one thing in the bundle
   * that disagrees with the world. `notes` carries what the world has to say when there is nothing
   * wrong - a stated limitation, a request that named something the world ignored - so that a
   * criterion can read the substitute being honest about itself.
   */
  #settle(body: Buffer, codes: readonly number[], notes: readonly string[]): DataAnswer {
    const first = codes.find((code) => code !== 0);
    const note = notes[0] ?? null;
    if (first === undefined) {
      return { body, result: "ok", errorCode: 0, reason: note };
    }
    const name = dataErrorName(first) ?? `code ${first}`;
    return {
      body,
      result: this.#resultOf(first),
      errorCode: first,
      reason: note === null ? name : `${name}: ${note}`,
    };
  }

  #resultOf(code: number): DataRequestResult {
    if (code === DATA_ERROR_CODES.UNSUPPORTED_VERSION) return "unsupported-version";
    if (code === DATA_ERROR_CODES.CORRUPT_MESSAGE) return "corrupt-message";
    if (code === DATA_ERROR_CODES.INVALID_REQUEST) return "invalid-request";
    return "refused";
  }

  /** The single refusal body a handler produces when it cannot even name a shape to fill. */
  #empty(api: DataApi, code: number, why: string): DataAnswer {
    return {
      body: encodeRefusalResponse(api, code),
      result: this.#resultOf(code),
      errorCode: code,
      reason: why,
    };
  }

  #apiOf(key: number): DataApi {
    const api = dataApiOf(key);
    if (api === null) throw new Error(`the register holds no API with key ${key}`);
    return api;
  }

  // -------------------------------------------------------------------------------------------
  // The metadata the world can answer
  // -------------------------------------------------------------------------------------------

  #metadata(body: DataRequestBody & { readonly kind: "metadata" }): DataAnswer {
    // A `null` topic list and an empty one are two different requests - "tell me about everything"
    // and "tell me about nothing" - and the grammar keeps them apart for exactly this reason.
    const names = body.topics === null ? [...this.#topics.keys()].sort(compareNames) : body.topics;
    const codes: number[] = [];
    const notes: string[] = [];
    const topics: DataMetadataTopic[] = names.map((name) => {
      const topic = this.#topics.get(name);
      if (topic === undefined) {
        codes.push(DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
        return { errorCode: DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION, name, partitions: [] };
      }
      const partitions: DataMetadataPartition[] = topic.partitions.map((partition, index) => ({
        errorCode: DATA_ERROR_CODES.NONE,
        partitionIndex: index,
        leaderId: partition.leaderId,
        replicas: [...partition.replicas],
        isr: this.#inSync(partition.replicas),
      }));
      return { errorCode: DATA_ERROR_CODES.NONE, name, partitions };
    });
    if (codes.length > 0) notes.push(`${codes.length} of ${names.length} named topic(s) are not held`);
    return this.#settle(
      encodeMetadataResponse(
        [{ nodeId: this.#identity.nodeId, host: this.#address.host, port: this.#address.port }],
        topics,
      ),
      codes,
      notes,
    );
  }

  /**
   * The membership that could honour a partition's replica list, which is this node and nothing else.
   *
   * Derived on every read rather than stored, for two reasons: it is a fact about what *exists* on
   * this machine rather than about the request that asked for three brokers, and deriving it here is
   * what stops a stale `isr` from surviving a partition whose recorded replica list changed. This one
   * function is the whole of `DATA_SIMULATED_SURFACES.replication` made visible.
   */
  #inSync(replicas: readonly number[]): readonly number[] {
    return replicas.includes(this.#identity.nodeId) ? [this.#identity.nodeId] : [];
  }

  #createTopics(body: DataRequestBody & { readonly kind: "create-topics" }): DataAnswer {
    const results: { readonly name: string; readonly errorCode: number }[] = [];
    const codes: number[] = [];
    const notes: string[] = [];
    for (const topic of body.topics) {
      const problem = this.#topicProblem(topic);
      if (problem !== null) {
        codes.push(problem.code);
        notes.push(`'${topic.name}': ${problem.why}`);
        results.push({ name: topic.name, errorCode: problem.code });
        continue;
      }
      const partitions: StoredPartition[] =
        topic.assignments.length > 0
          ? topic.assignments.map((assignment) => ({
              leaderId: assignment.brokerIds[0] ?? this.#identity.nodeId,
              replicas: [...assignment.brokerIds],
              records: [],
            }))
          : Array.from({ length: topic.numPartitions }, () => ({
              leaderId: this.#identity.nodeId,
              replicas: [this.#identity.nodeId],
              records: [],
            }));
      this.#topics.set(topic.name, {
        name: topic.name,
        replicationFactor: topic.replicationFactor,
        configs: topic.configs.map((config) => ({ name: config.name, value: config.value })),
        partitions,
      });
      if (topic.replicationFactor > 1 && topic.assignments.length === 0) {
        notes.push(
          `'${topic.name}' recorded replication ${topic.replicationFactor} on one node, so isr is [${this.#identity.nodeId}]`,
        );
      }
      results.push({ name: topic.name, errorCode: DATA_ERROR_CODES.NONE });
    }
    return this.#settle(encodeCreateTopicsResponse(results), codes, notes);
  }

  /** Why a topic cannot be created, or `null`. The one place either naming rule is decided. */
  #topicProblem(topic: {
    readonly name: string;
    readonly numPartitions: number;
    readonly replicationFactor: number;
    readonly assignments: readonly { readonly partitionIndex: number; readonly brokerIds: readonly number[] }[];
    readonly configs: readonly { readonly name: string }[];
  }): { readonly code: number; readonly why: string } | null {
    if (!TOPIC_PATTERN.test(topic.name)) {
      return {
        code: DATA_ERROR_CODES.INVALID_TOPIC_EXCEPTION,
        why: "a topic name holds letters, digits, '.', '_' and '-' only",
      };
    }
    if (this.#topics.has(topic.name)) {
      return { code: DATA_ERROR_CODES.TOPIC_ALREADY_EXISTS, why: "this world already holds that name" };
    }
    if (topic.assignments.length === 0) {
      if (topic.numPartitions <= 0) {
        return {
          code: DATA_ERROR_CODES.INVALID_PARTITIONS,
          why: `a topic asked for ${topic.numPartitions} partition(s)`,
        };
      }
      if (topic.replicationFactor <= 0) {
        return {
          code: DATA_ERROR_CODES.INVALID_REPLICATION_FACTOR,
          why: `a topic asked for replication factor ${topic.replicationFactor}`,
        };
      }
    }
    const reused = topic.assignments.find(
      (assignment) => assignment.brokerIds.includes(this.#identity.nodeId) === false,
    );
    if (topic.assignments.length > 0 && reused !== undefined) {
      return {
        code: DATA_ERROR_CODES.NOT_ENOUGH_REPLICAS,
        why: `partition ${reused.partitionIndex} was assigned brokers [${reused.brokerIds.join(", ")}], and this world is node ${this.#identity.nodeId}`,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Produce and fetch
  // -------------------------------------------------------------------------------------------

  #produceSettled(body: DataRequestBody & { readonly kind: "produce" }): DataAnswer {
    const answer = this.#produce(body, true);
    if (body.acks !== 0) return answer;
    return {
      ...answer,
      body: null,
      reason:
        answer.reason === null
          ? "acks=0: the client asked for no response, so the world wrote none"
          : `${answer.reason}; acks=0, so the world wrote no response`,
    };
  }

  #produce(body: DataRequestBody & { readonly kind: "produce" }, write: boolean): DataAnswer {
    const api = this.#apiOf(0);
    if (body.acks !== -1 && body.acks !== 0 && body.acks !== 1) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.INVALID_REQUIRED_ACKS,
        `a Produce named acks=${body.acks}; this world honours -1, 0 and 1`,
      );
    }
    const codes: number[] = [];
    const notes: string[] = [];
    const topics: { readonly name: string; readonly partitions: readonly DataProduceResult[] }[] =
      body.topics.map((topic) => {
        const held = this.#topics.get(topic.name);
        const partitions = topic.partitions.map((partition): DataProduceResult => {
          const target = held?.partitions[partition.index];
          if (target === undefined) {
            codes.push(DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
            notes.push(`${topic.name}/${partition.index} is not a partition this world holds`);
            return {
              index: partition.index,
              errorCode: DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION,
              baseOffset: -1,
              logAppendTime: -1,
            };
          }
          if (partition.records === null) {
            codes.push(DATA_ERROR_CODES.CORRUPT_MESSAGE);
            notes.push(`${topic.name}/${partition.index} carried no record batch at all`);
            return {
              index: partition.index,
              errorCode: DATA_ERROR_CODES.CORRUPT_MESSAGE,
              baseOffset: -1,
              logAppendTime: -1,
            };
          }
          let batch;
          try {
            batch = decodeRecordBatch(partition.records);
          } catch (error) {
            // The world's own checksum is what refuses a corrupted batch, and the message it refuses
            // with is recorded verbatim: a criterion about a batch that did not survive the wire
            // needs the world's words, because "corrupt" is a verdict and the reason is the evidence.
            codes.push(DATA_ERROR_CODES.CORRUPT_MESSAGE);
            notes.push(`${topic.name}/${partition.index}: ${reasonOf(error)}`);
            return {
              index: partition.index,
              errorCode: DATA_ERROR_CODES.CORRUPT_MESSAGE,
              baseOffset: -1,
              logAppendTime: -1,
            };
          }
          const baseOffset = target.records.length;
          for (const record of batch.records) {
            target.records.push({
              offset: target.records.length,
              timestamp: record.timestamp ?? batch.maxTimestamp,
              key: record.key,
              value: record.value,
              headers: record.headers,
            });
          }
          this.#counts.produced += batch.records.length;
          return {
            index: partition.index,
            errorCode: DATA_ERROR_CODES.NONE,
            baseOffset,
            logAppendTime: -1,
          };
        });
        return { name: topic.name, partitions };
      });
    if (!write) {
      const first = codes.find((code) => code !== 0);
      return {
        body: null,
        result: first === undefined ? "ok" : this.#resultOf(first),
        errorCode: first ?? 0,
        reason: notes[0] ?? null,
      };
    }
    return this.#settle(encodeProduceResponse(this.#versionOf(0), topics), codes, notes);
  }

  #fetch(body: DataRequestBody & { readonly kind: "fetch" }): DataAnswer {
    const codes: number[] = [];
    const notes: string[] = [];
    if (body.replicaId >= 0) {
      // A follower fetch is the one request the `replication` substitution makes unanswerable in
      // the sense it was asked. It is answered from the only log there is and the difference is
      // *recorded*, because a world that quietly answered it would let a criterion about replication
      // lag read `PASS` on a cluster that has no followers.
      notes.push(
        `a follower fetch from replica ${body.replicaId} is answered from this world's only log; there are no followers to catch up`,
      );
    }
    const topics: { readonly name: string; readonly partitions: readonly DataFetchResult[] }[] =
      body.topics.map((topic) => {
        const held = this.#topics.get(topic.name);
        const partitions = topic.partitions.map((partition): DataFetchResult => {
          const target = held?.partitions[partition.partition];
          if (target === undefined) {
            codes.push(DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
            notes.push(`${topic.name}/${partition.partition} is not a partition this world holds`);
            return {
              partitionIndex: partition.partition,
              errorCode: DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION,
              highWatermark: -1,
              records: Buffer.alloc(0),
            };
          }
          const high = target.records.length;
          if (partition.fetchOffset < 0 || partition.fetchOffset > high) {
            codes.push(DATA_ERROR_CODES.OFFSET_OUT_OF_RANGE);
            notes.push(
              `a Fetch asked for offset ${partition.fetchOffset} of ${topic.name}/${partition.partition}, whose log holds 0..${high}`,
            );
            return {
              partitionIndex: partition.partition,
              errorCode: DATA_ERROR_CODES.OFFSET_OUT_OF_RANGE,
              highWatermark: high,
              records: Buffer.alloc(0),
            };
          }
          // A non-positive `partitionMaxBytes` means the partition's own limit, which is what a real
          // broker reads `0` as. A negative value is read the same way rather than refused, because
          // this world has no per-partition limit for it to contradict.
          const limit = partition.partitionMaxBytes <= 0 ? Number.MAX_SAFE_INTEGER : partition.partitionMaxBytes;
          const taken: StoredRecord[] = [];
          for (let index = partition.fetchOffset; index < target.records.length; index += 1) {
            const record = target.records[index];
            if (record === undefined) break;
            const candidate = [...taken, record];
            // The bound is measured against the bytes the encoder actually produces rather than
            // against a size model, because a model would be a second implementation of the batch
            // layout and the two would disagree the first time the layout changed.
            if (batchOf(candidate).length > limit) break;
            taken.push(record);
          }
          this.#counts.fetched += taken.length;
          return {
            partitionIndex: partition.partition,
            errorCode: DATA_ERROR_CODES.NONE,
            highWatermark: high,
            records: batchOf(taken, partition.fetchOffset),
          };
        });
        return { name: topic.name, partitions };
      });
    return this.#settle(encodeFetchResponse(this.#versionOf(1), topics), codes, notes);
  }

  #listOffsets(
    body: DataRequestBody & { readonly kind: "list-offsets" },
    apiVersion: number,
  ): DataAnswer {
    const codes: number[] = [];
    const notes: string[] = [];
    const topics: { readonly name: string; readonly partitions: readonly DataListOffsetsResult[] }[] =
      body.topics.map((topic) => {
        const held = this.#topics.get(topic.name);
        const partitions = topic.partitions.map((partition): DataListOffsetsResult => {
          const target = held?.partitions[partition.partitionIndex];
          if (target === undefined) {
            codes.push(DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
            notes.push(`${topic.name}/${partition.partitionIndex} is not a partition this world holds`);
            return {
              partitionIndex: partition.partitionIndex,
              errorCode: DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION,
              offsets: [],
              timestamp: -1,
              offset: -1,
            };
          }
          const offset = this.#offsetFor(target, partition.timestamp, notes, topic.name, partition.partitionIndex);
          return {
            partitionIndex: partition.partitionIndex,
            errorCode: DATA_ERROR_CODES.NONE,
            // v1 reads -1 as "no such offset" through a pair of its own, and v0 has nowhere to put
            // that but an empty list - which is why the two shapes are supplied to one encoder.
            offsets: offset === null ? [] : [offset],
            timestamp: offset === null ? -1 : target.records[0]?.timestamp ?? -1,
            offset: offset ?? -1,
          };
        });
        return { name: topic.name, partitions };
      });
    return this.#settle(encodeListOffsetsResponse(apiVersion, topics), codes, notes);
  }

  /**
   * The offset a `ListOffsets` timestamp resolves to, or `null` for "no such offset".
   *
   * `-1` is the log's end and `-2` its start, which are the two magic timestamps the protocol
   * defines. Any other value is compared against the records' **own** timestamps and nothing else,
   * because this world has no clock: a broker would refuse a timestamp in its own future with
   * `INVALID_TIMESTAMP`, and this one cannot tell what its future is, so a future timestamp resolves
   * to "no such offset" - a statement it can support - rather than to a refusal it would be guessing
   * at.
   */
  #offsetFor(
    partition: StoredPartition,
    timestamp: number,
    notes: string[],
    topic: string,
    index: number,
  ): number | null {
    if (timestamp === -1) return partition.records.length;
    if (timestamp === -2) return 0;
    const found = partition.records.find((record) => record.timestamp >= timestamp);
    if (found === undefined) {
      notes.push(
        `${topic}/${index} holds no offset whose timestamp is at or after ${timestamp}, and this world has no clock to refuse it against`,
      );
      return null;
    }
    return found.offset;
  }

  // -------------------------------------------------------------------------------------------
  // Consumer groups
  // -------------------------------------------------------------------------------------------

  #findCoordinator(body: DataRequestBody & { readonly kind: "find-coordinator" }): DataAnswer {
    // Every key's coordinator is this node, because there is one node and no coordinator to route
    // to - which is `DATA_SIMULATED_SURFACES["group-coordination"]` stated as a response.
    return this.#settle(
      encodeFindCoordinatorResponse(
        DATA_ERROR_CODES.NONE,
        this.#identity.nodeId,
        this.#address.host,
        this.#address.port,
      ),
      [],
      [`every key's coordinator is node ${this.#identity.nodeId}; this world holds one node and routes nothing`],
    );
  }

  /**
   * The client id is passed in rather than read off the body, because a JoinGroup body has no such
   * field - the client id lives in every request's *header* - and a member recorded with a client id
   * the request never carried would be a fact the world invented.
   */
  #joinGroup(
    body: DataRequestBody & { readonly kind: "join-group" },
    clientId: string | null,
  ): DataAnswer {
    const api = this.#apiOf(11);
    if (body.groupId.trim() === "") {
      return this.#empty(api, DATA_ERROR_CODES.INVALID_GROUP_ID, "a JoinGroup named an empty group id");
    }
    if (body.sessionTimeoutMs <= 0) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.INVALID_SESSION_TIMEOUT,
        `a JoinGroup named a session timeout of ${body.sessionTimeoutMs}ms`,
      );
    }
    if (body.protocols.length === 0) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.INCONSISTENT_GROUP_PROTOCOL,
        "a JoinGroup offered no protocol this world could record",
      );
    }
    const group = this.#groupFor(body.groupId, body.protocolType);
    // A group's type is the type its first request declared, and it cannot change while the group
    // is held. The field the reading prints belongs to the group and not to the offered protocol -
    // a protocol's *name* is the assignment strategy it would run, which is a different fact - so
    // a request naming another type is refused by name rather than absorbed into the recorded one.
    if (group.protocolType !== body.protocolType) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.INCONSISTENT_GROUP_PROTOCOL,
        `a JoinGroup named protocol type '${body.protocolType}' for group '${body.groupId}', which is held as '${group.protocolType}'`,
      );
    }
    const existing = group.members.find((member) => member.memberId === body.memberId);
    const minted = body.memberId.trim() === "";
    if (minted) {
      group.members.push({
        memberId: `member-${String(group.members.length + 1)}`,
        clientId: clientId ?? "",
        protocol: body.protocols[0]?.name ?? "",
        metadata: body.protocols[0]?.metadata ?? Buffer.alloc(0),
        assignment: Buffer.alloc(0),
      });
      // The generation advances once per new member, because a generation is what a member's
      // assignment is valid for and this world has no rebalance protocol to run one through. A
      // member that joins again with the id it was given does not move it.
      group.generationId += 1;
    } else if (existing === undefined) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.UNKNOWN_MEMBER_ID,
        `a JoinGroup named member '${body.memberId}', which group '${body.groupId}' does not hold`,
      );
    }
    const member = group.members[group.members.length - 1];
    if (member === undefined) {
      return this.#empty(api, DATA_ERROR_CODES.UNKNOWN_MEMBER_ID, "a JoinGroup added no member");
    }
    const joining = minted ? member : (existing ?? member);
    return this.#settle(
      encodeJoinGroupResponse({
        errorCode: DATA_ERROR_CODES.NONE,
        generationId: group.generationId,
        groupProtocol: joining.protocol,
        // Every member is the leader, because there is no coordinator to elect one - the same
        // substitution, one field further along.
        leaderId: joining.memberId,
        memberId: joining.memberId,
        members: group.members.map((held) => ({ memberId: held.memberId, metadata: held.metadata })),
      }),
      [],
      [
        `member '${joining.memberId}' leads a group of ${group.members.length}; this world elects no leader and runs no rebalance`,
      ],
    );
  }

  #syncGroup(body: DataRequestBody & { readonly kind: "sync-group" }): DataAnswer {
    const api = this.#apiOf(14);
    const group = this.#groups.get(body.groupId);
    if (group === undefined) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.UNKNOWN_MEMBER_ID,
        `a SyncGroup named group '${body.groupId}', which this world does not hold`,
      );
    }
    if (group.generationId !== body.generationId) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.ILLEGAL_GENERATION,
        `a SyncGroup named generation ${body.generationId}; group '${body.groupId}' is at ${group.generationId}`,
      );
    }
    const mine = group.members.find((member) => member.memberId === body.memberId);
    if (mine === undefined) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.UNKNOWN_MEMBER_ID,
        `a SyncGroup named member '${body.memberId}', which group '${body.groupId}' does not hold`,
      );
    }
    const notes: string[] = [];
    // A non-empty assignment list is the leader speaking for the whole group; an empty one is a
    // follower asking for its own. The world stores the bytes verbatim and reads none of them, which
    // is what a broker does - the assignment is the client's encoding.
    for (const entry of body.assignments) {
      const held = group.members.find((member) => member.memberId === entry.memberId);
      if (held === undefined) {
        notes.push(
          `a SyncGroup assigned member '${entry.memberId}', which group '${body.groupId}' does not hold`,
        );
        continue;
      }
      held.assignment = entry.assignment;
    }
    return this.#settle(encodeSyncGroupResponse(DATA_ERROR_CODES.NONE, mine.assignment), [], notes);
  }

  #heartbeat(body: DataRequestBody & { readonly kind: "heartbeat" }): DataAnswer {
    const api = this.#apiOf(12);
    const group = this.#groups.get(body.groupId);
    if (group === undefined || group.members.every((member) => member.memberId !== body.memberId)) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.UNKNOWN_MEMBER_ID,
        `a Heartbeat named member '${body.memberId}' of group '${body.groupId}', which this world does not hold`,
      );
    }
    if (group.generationId !== body.generationId) {
      return this.#empty(
        api,
        DATA_ERROR_CODES.ILLEGAL_GENERATION,
        `a Heartbeat named generation ${body.generationId}; group '${body.groupId}' is at ${group.generationId}`,
      );
    }
    return this.#settle(encodeHeartbeatResponse(DATA_ERROR_CODES.NONE), [], []);
  }

  #offsetCommit(body: DataRequestBody & { readonly kind: "offset-commit" }): DataAnswer {
    const api = this.#apiOf(8);
    // An OffsetCommit carries no protocol type - the group's is settled by whichever JoinGroup
    // named it - so a group this request creates is created with none. `#groupFor` returns a group
    // that already exists without touching this argument, so this is the *first mention* case only.
    const group = this.#groupFor(body.groupId, "");
    // An empty member id is the *simple consumer* case: a client that reads without joining has no
    // member and no generation to be checked against, and refusing it would make this world unable
    // to serve the one consumer shape that needs no group protocol at all.
    if (body.memberId.trim() !== "") {
      if (group.generationId !== body.generationId) {
        return this.#empty(
          api,
          DATA_ERROR_CODES.ILLEGAL_GENERATION,
          `an OffsetCommit named generation ${body.generationId}; group '${body.groupId}' is at ${group.generationId}`,
        );
      }
      if (group.members.every((member) => member.memberId !== body.memberId)) {
        return this.#empty(
          api,
          DATA_ERROR_CODES.UNKNOWN_MEMBER_ID,
          `an OffsetCommit named member '${body.memberId}', which group '${body.groupId}' does not hold`,
        );
      }
    }
    const codes: number[] = [];
    const notes: string[] = [];
    const topics = body.topics.map((topic) => {
      const held = this.#topics.get(topic.name);
      const partitions = topic.partitions.map((partition) => {
        if (held?.partitions[partition.partitionIndex] === undefined) {
          codes.push(DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION);
          notes.push(`${topic.name}/${partition.partitionIndex} is not a partition this world holds`);
          return { partitionIndex: partition.partitionIndex, errorCode: DATA_ERROR_CODES.UNKNOWN_TOPIC_OR_PARTITION };
        }
        group.committed.set(`${topic.name}/${String(partition.partitionIndex)}`, {
          offset: partition.offset,
          metadata: partition.metadata,
        });
        return { partitionIndex: partition.partitionIndex, errorCode: DATA_ERROR_CODES.NONE };
      });
      return { name: topic.name, partitions };
    });
    return this.#settle(encodeOffsetCommitResponse(topics), codes, notes);
  }

  #offsetFetch(body: DataRequestBody & { readonly kind: "offset-fetch" }): DataAnswer {
    const group = this.#groups.get(body.groupId);
    const notes: string[] = [];
    if (group === undefined) {
      notes.push(
        `group '${body.groupId}' is not held, so every partition it asked about answers -1 and no error - which is the protocol's own way of saying "nothing was ever committed here"`,
      );
    }
    const topics = body.topics.map((topic) => {
      const partitions: DataFetchedOffset[] = topic.partitionIndexes.map((partition: number) => {
        const held = group?.committed.get(`${topic.name}/${String(partition)}`);
        return {
          partitionIndex: partition,
          offset: held?.offset ?? -1,
          metadata: held?.metadata ?? null,
          errorCode: DATA_ERROR_CODES.NONE,
        };
      });
      return { name: topic.name, partitions };
    });
    return this.#settle(encodeOffsetFetchResponse(topics), [], notes);
  }

  /** The group a request names, created on first mention as a broker creates a coordinator's group. */
  #groupFor(groupId: string, protocolType: string): StoredGroup {
    const held = this.#groups.get(groupId);
    if (held !== undefined) return held;
    const created: StoredGroup = {
      groupId,
      generationId: 0,
      protocolType,
      members: [],
      committed: new Map(),
    };
    this.#groups.set(groupId, created);
    return created;
  }

  // -------------------------------------------------------------------------------------------
  // Readings
  // -------------------------------------------------------------------------------------------

  /**
   * The topic as a criterion reads it.
   *
   * Every object here is built fresh on every read, and that is a rule rather than a style: an
   * observation that edited what it observed could not be taken twice, and M1 compares exactly these
   * documents - the defect `sim-k8s` paid for when its port recorded a pod's events inside the
   * derivation of its own snapshot, so the first read of a namespace wrote `count: 1` and the second
   * wrote `count: 2`.
   */
  #readTopic(topic: StoredTopic): DataTopicReading {
    return {
      name: topic.name,
      replicationFactor: topic.replicationFactor,
      configs: topic.configs.map((config) => ({ name: config.name, value: config.value })),
      partitions: topic.partitions.map((partition, index) => ({
        index,
        leaderId: partition.leaderId,
        replicas: [...partition.replicas],
        isr: this.#inSync(partition.replicas),
        lowWatermark: 0,
        highWatermark: partition.records.length,
        records: partition.records.map((record): DataRecordReading => this.#readRecord(record)),
      })),
    };
  }

  #readRecord(record: StoredRecord): DataRecordReading {
    return {
      offset: record.offset,
      timestamp: record.timestamp,
      key: record.key === null ? null : record.key.toString("utf8"),
      value: record.value === null ? null : record.value.toString("utf8"),
      keyHex: record.key === null ? null : record.key.toString("hex"),
      valueHex: record.value === null ? null : record.value.toString("hex"),
      headers: record.headers.map((header) => ({
        name: header.key,
        value: header.value === null ? null : header.value.toString("utf8"),
      })),
    };
  }

  /**
   * The group as a criterion reads it, with its state *derived* rather than stored.
   *
   * The three states are the protocol's own words and each one is a fact about what the world holds:
   * `Empty` is a group with no members, `CompletingJoin` one whose members have not been handed an
   * assignment yet, and `Stable` one that has. Storing a state field would let it disagree with the
   * members beside it, and the readers of this reading are exactly the criteria that would be fooled.
   */
  #readGroup(group: StoredGroup): DataGroupReading {
    const members: DataGroupMemberReading[] = group.members.map((member) => ({
      memberId: member.memberId,
      clientId: member.clientId,
      protocol: member.protocol,
      assignmentBytes: member.assignment.length,
    }));
    const committed: DataCommittedOffsetReading[] = [...group.committed.entries()]
      .map(([key, value]) => {
        const [topic, partition] = key.split("/");
        return {
          topic: topic ?? "",
          partition: Number(partition ?? "0"),
          offset: value.offset,
          metadata: value.metadata,
        };
      })
      .sort((left, right) => compareNames(left.topic, right.topic) || left.partition - right.partition);
    const state =
      group.members.length === 0
        ? "Empty"
        : group.members.some((member) => member.assignment.length > 0)
          ? "Stable"
          : "CompletingJoin";
    return { groupId: group.groupId, generationId: group.generationId, protocolType: group.protocolType, state, members, committed };
  }

  /** The version this world speaks for an API, which is the first one it implements. */
  #versionOf(key: number): number {
    return this.#apiOf(key).versions[0] ?? 0;
  }
}

// ---------------------------------------------------------------------------------------------
// The command register
// ---------------------------------------------------------------------------------------------

/**
 * What each word takes, in the spelling a refusal prints.
 *
 * Exported because two readers need it and both would otherwise write it out again: the adapter,
 * which prints the roster when a contract's step names a word this world does not hold, and the
 * example's own documentation. A usage line restated in three places is the vocabulary-printed-
 * twice defect this repository has already paid for, so there is one table and it is read.
 */
const COMMAND_USAGE: Readonly<Record<DataCommandWord, string>> = Object.freeze({
  "create-topic": "create-topic <name> <partitions> <replication-factor>",
  produce: "produce <topic> <partition> <key> <value>",
  fetch: "fetch <topic> <partition>",
  metadata: "metadata [<topic> ...]",
  commit: "commit <group> <topic> <partition> <offset>",
});

/** Every word this world performs, each with the arguments it takes, in register order. */
export function dataCommandUsage(): readonly string[] {
  return DATA_COMMAND_WORDS.map((word) => COMMAND_USAGE[word]);
}

/** A command the world read, or the reason it could not. */
type ParsedCommand =
  | { readonly ok: true; readonly apiKey: number; readonly body: DataRequestBody }
  | { readonly ok: false; readonly reason: string };

/**
 * One argument, for a position the caller has already counted.
 *
 * `noUncheckedIndexedAccess` makes every index `string | undefined`, and the length check that
 * admits a command has already established these positions exist. The fallback is the empty string
 * rather than a throw because the only way to reach it is a length check this function's caller
 * just performed - and a value that reaches a decoder unvalidated is refused there anyway, by name.
 */
function argAt(argv: readonly string[], index: number): string {
  return argv[index] ?? "";
}

/**
 * A whole number, or `null` when the spelling is not one.
 *
 * `Number()` alone would accept `""` as zero, `"1.5"` as a fraction, `"0x10"` as sixteen and
 * `"1e3"` as a thousand - and a world that read `2.5` partitions as two would be answering a
 * question the operator did not ask, which is the class of error this whole product refuses. Only
 * digits with an optional sign are read, so every other spelling is refused by the same rule that
 * refuses a fraction, and there is one reason to print rather than four.
 */
function wholeNumber(text: string): number | null {
  if (!/^-?[0-9]+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Read one command against the register.
 *
 * Every branch answers with the same two things - the API key whose body is being formed, or the
 * reason it could not be - so the caller has one decision rather than five. The arguments are
 * positional and there are no flags on purpose: a flag's value is not an operand, which this
 * repository learned the hard way when a substitute read `--home /var/lib/cart-web` as an account
 * name, and a command grammar with no flags cannot make that mistake.
 *
 * A returned value that the world does not hold - an absent topic, a partition past the end of a
 * log - is **not** a parse failure: it is a request this world can read and will refuse with its
 * own error code, which is what makes the refusal an observation rather than a crash.
 */
function parseDataCommand(argv: readonly string[]): ParsedCommand {
  const word = (argv[0] ?? "").trim();
  const rest = argv.slice(1);
  const usage = (): string =>
    `this world performs ${DATA_COMMAND_WORDS.join(", ")}, and each takes: ${dataCommandUsage().join("; ")}`;
  switch (word) {
    case "create-topic": {
      if (rest.length !== 3) {
        return { ok: false, reason: `create-topic takes three arguments - ${COMMAND_USAGE["create-topic"]} - and received ${String(rest.length)}. ${usage()}` };
      }
      const name = argAt(rest, 0);
      const numPartitions = wholeNumber(argAt(rest, 1));
      if (numPartitions === null) {
        return { ok: false, reason: `the partition count '${argAt(rest, 1)}' is not a whole number, and ${COMMAND_USAGE["create-topic"]} takes one` };
      }
      const replicationFactor = wholeNumber(argAt(rest, 2));
      if (replicationFactor === null) {
        return { ok: false, reason: `the replication factor '${argAt(rest, 2)}' is not a whole number, and ${COMMAND_USAGE["create-topic"]} takes one` };
      }
      // No replica assignment is sent, deliberately: an assignment is a client telling a cluster
      // where to put a partition, and a criterion naming brokers would be describing a cluster this
      // world does not have. The world derives a single-broker membership instead, which is what
      // `DATA_SIMULATED_SURFACES.replication` says it does.
      return {
        ok: true,
        apiKey: 19,
        body: {
          kind: "create-topics",
          topics: [{ name, numPartitions, replicationFactor, assignments: [], configs: [] }],
          timeoutMs: 1000,
        },
      };
    }
    case "produce": {
      if (rest.length !== 4) {
        return { ok: false, reason: `produce takes four arguments - ${COMMAND_USAGE.produce} - and received ${String(rest.length)}. ${usage()}` };
      }
      const partition = wholeNumber(argAt(rest, 1));
      if (partition === null) {
        return { ok: false, reason: `the partition '${argAt(rest, 1)}' is not a whole number, and ${COMMAND_USAGE.produce} takes one` };
      }
      // `acks: 1` because a criterion that produced a record and did not wait for the broker's
      // answer would be judging a write it never saw acknowledged. The key and the value are UTF-8
      // text and there is no escape convention: a key spelled `-` is the one-character key `-`, and
      // a reader is never left guessing which of two rules a token fell under.
      const key = argAt(rest, 2);
      const value = argAt(rest, 3);
      const batch = encodeRecordBatch({
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
      return {
        ok: true,
        apiKey: 0,
        body: {
          kind: "produce",
          acks: 1,
          timeoutMs: 1000,
          topics: [{ name: argAt(rest, 0), partitions: [{ index: partition, records: batch }] }],
        },
      };
    }
    case "fetch": {
      if (rest.length !== 2) {
        return { ok: false, reason: `fetch takes two arguments - ${COMMAND_USAGE.fetch} - and received ${String(rest.length)}. ${usage()}` };
      }
      const partition = wholeNumber(argAt(rest, 1));
      if (partition === null) {
        return { ok: false, reason: `the partition '${argAt(rest, 1)}' is not a whole number, and ${COMMAND_USAGE.fetch} takes one` };
      }
      // `replicaId: -1` is the consumer case, which is a fact about the request rather than a
      // default: a criterion reading a log is not a follower catching up, and this world says so in
      // the reading rather than inferring it. `partitionMaxBytes: 0` means unbounded, so a criterion
      // reads the whole log and compares records rather than bytes.
      return {
        ok: true,
        apiKey: 1,
        body: {
          kind: "fetch",
          replicaId: -1,
          maxWaitMs: 0,
          minBytes: 1,
          topics: [{ name: argAt(rest, 0), partitions: [{ partition, fetchOffset: 0, partitionMaxBytes: 0 }] }],
        },
      };
    }
    case "metadata": {
      // No topics is not the same request as no names: an empty list asks about nothing and a null
      // list asks about everything. A command with no arguments means the second, because "tell me
      // what this world holds" is the question a criterion with no argument is asking.
      return { ok: true, apiKey: 3, body: { kind: "metadata", topics: rest.length === 0 ? null : [...rest] } };
    }
    case "commit": {
      if (rest.length !== 4) {
        return { ok: false, reason: `commit takes four arguments - ${COMMAND_USAGE.commit} - and received ${String(rest.length)}. ${usage()}` };
      }
      const partition = wholeNumber(argAt(rest, 2));
      if (partition === null) {
        return { ok: false, reason: `the partition '${argAt(rest, 2)}' is not a whole number, and ${COMMAND_USAGE.commit} takes one` };
      }
      const offset = wholeNumber(argAt(rest, 3));
      if (offset === null) {
        return { ok: false, reason: `the offset '${argAt(rest, 3)}' is not a whole number, and ${COMMAND_USAGE.commit} takes one` };
      }
      // An empty member id is the simple-consumer case, which `#offsetCommit` deliberately does not
      // check against a generation - a criterion committing an offset is not a member of a group and
      // saying it were would invent a membership this world never granted.
      return {
        ok: true,
        apiKey: 8,
        body: {
          kind: "offset-commit",
          groupId: argAt(rest, 0),
          generationId: -1,
          memberId: "",
          retentionTimeMs: -1,
          topics: [{ name: argAt(rest, 1), partitions: [{ partitionIndex: partition, offset, metadata: null }] }],
        },
      };
    }
    default:
      return { ok: false, reason: `'${word}' is not a command this world performs. ${usage()}` };
  }
}

/**
 * The bytes one record set is carried in.
 *
 * A single function rather than two, because the fetch path bounds a partition by *these* bytes and
 * then writes *these* bytes: a bound measured against a different encoding than the one written
 * would be a limit that held in the check and not in the answer.
 */
function batchOf(records: readonly StoredRecord[], fallbackBaseOffset = 0): Buffer {
  if (records.length === 0) {
    return encodeRecordBatch({
      baseOffset: fallbackBaseOffset,
      records: [],
      firstTimestamp: 0,
      maxTimestamp: 0,
    });
  }
  const first = records[0] as WireRecord;
  return encodeRecordBatch({
    baseOffset: first.offset ?? fallbackBaseOffset,
    records,
    firstTimestamp: Math.min(...records.map((record) => record.timestamp)),
    maxTimestamp: Math.max(...records.map((record) => record.timestamp)),
  });
}

/**
 * A substitute broker, refusing an identity it cannot answer for.
 *
 * The blanks are collected and named rather than checked one at a time, because an operator who
 * supplied neither a cluster nor a host should be told both rather than told the first one twice.
 */
export function tcpData(identity: DataIdentity): DataPort {
  const trimmed = { cluster: identity.cluster.trim(), host: identity.host.trim() };
  const missing = Object.entries(trimmed)
    .filter(([, value]) => value === "")
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `a substitute broker needs a value for every one of cluster, host, and received none for ${missing.join(", ")}`,
    );
  }
  if (!Number.isInteger(identity.nodeId) || identity.nodeId < 0) {
    throw new Error(
      `a substitute broker's node id must be a whole number that is not negative, and received ${identity.nodeId}`,
    );
  }
  if (!Number.isInteger(identity.port) || identity.port < 0 || identity.port > 65535) {
    throw new Error(
      `a substitute broker's port must be a whole number between 0 and 65535, and received ${identity.port}`,
    );
  }
  return new TcpData({ ...identity, cluster: trimmed.cluster, host: trimmed.host });
}

export { DATA_SIMULATED_SURFACES };
