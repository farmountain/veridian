/**
 * The vocabulary a stream-store adapter and a stream-store validator share.
 *
 * It lives here, beside `web-observation.ts`, `cloud-observation.ts` and the rest, for exactly the
 * reason those files give: `validators/*` may not import `adapters/*`, so the document a validator
 * reads has to be declared in a layer neither of them owns.
 *
 * ## Why this is not `api-observation.ts` with different nouns
 *
 * An API reading describes *an exchange with a service*: a method, a status, a body. A stream-store
 * reading describes *a log and the parties that read it*: topics with partitions, the records sitting
 * at offsets in each partition, where each partition's high watermark stands, which consumer groups
 * exist and how far each of them has committed. Both of those are read at the same time and neither
 * is derivable from the other, which is why one document carrying `exchanges` cannot carry this.
 *
 * There is a second reason, and it is the one that decided the shape. The interesting failures of a
 * data pipeline are not "the request failed" - they are *a record that landed in the wrong place*,
 * *an offset committed for the wrong generation*, *a replication factor the cluster cannot honour*,
 * *a batch whose checksum did not match*. Every one of those is a statement about state that outlives
 * the request that made it, so the reading has to be a *snapshot of the log* and not a list of
 * responses.
 *
 * ## The world is simulated in one layer and real in the next, and the reading says which
 *
 * The application opens a real TCP socket to a real address on loopback and writes real bytes in a
 * broker's own binary layout. What is stood in for is the *broker process*: there is no cluster, no
 * replica follower, no on-disk log, no group coordinator and no rebalancer here. {@link
 * DATA_SIMULATED_SURFACES} names each of those, because a reading that did not carry the list would
 * be indistinguishable from one taken against a real cluster - which is the claim this project
 * refuses to make.
 *
 * `sockets`, `bytes` and `the record the client sent` are deliberately **not** on that list. They are
 * real. A list that named everything would be as uninformative as one that named nothing.
 *
 * ## Where a limit is stated, it is stated in the value a criterion compares
 *
 * `replication 3 recorded, isr [1]` is one string, and both halves are load-bearing. Drop the second
 * and the rendering claims a replication factor holds; drop the first and it claims a cluster that
 * was never asked. The `sim-container` family learned this about `(declared, not enforced)` and
 * `(exposed)`; the same rule holds here, which is why {@link renderTopic} prints a recorded factor
 * beside the membership that could honour it.
 */

/**
 * Adapter-defined observation kind. Validators declare the kind they understand.
 *
 * `data.broker` rather than `data.cluster`: what is observed is one endpoint that answers, and
 * "cluster" would name the thing this world does not have.
 */
export const DATA_OBSERVATION_KIND = "data.broker";

/**
 * Every surface a real cluster has and this world stands in for.
 *
 * Seven members, and each one is a subsystem whose absence changes what a criterion can conclude.
 * They are printed verbatim in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5, where a document guard
 * reads this constant and the row together.
 */
export const DATA_SIMULATED_SURFACES = [
  /** There is no broker process: the endpoint is this world's own socket, in the run's process. */
  "broker",
  /** There are no follower replicas: a replication factor is recorded and never honoured. */
  "replication",
  /** There is no group coordinator and no rebalance protocol: a generation is a counter. */
  "group-coordination",
  /** There is no on-disk commit log: records live in this process's memory and in a snapshot file. */
  "log-storage",
  /** There is no retention or compaction: a record is never deleted by age, size or a merge. */
  "retention",
  /** There are no transactions and no idempotent producer: sequence numbers are recorded, not checked. */
  "transactions",
  /** There is no partitioner: a record lands in the partition the producer named. */
  "partitioning",
] as const;

export type DataSimulatedSurface = (typeof DATA_SIMULATED_SURFACES)[number];

/**
 * How the world answered one request.
 *
 * Seven results rather than a boolean, because each is a different repair. `ok` is the pass.
 * `unknown-api` sends the reader to the client's version negotiation. `unsupported-version` sends
 * them to the version. `unreadable` sends them to the framing. `invalid-request` sends them to the
 * fields. `corrupt-message` sends them to the bytes inside the batch. `refused` is the world saying
 * no on purpose, and the reason says why. Collapsing any two of these produces a report naming a
 * cause the reporter did not observe.
 */
export const DATA_REQUEST_RESULTS = [
  "ok",
  "unknown-api",
  "unsupported-version",
  "unreadable",
  "invalid-request",
  "corrupt-message",
  "refused",
] as const;

export type DataRequestResult = (typeof DATA_REQUEST_RESULTS)[number];

/**
 * Every counter this world keeps, and the whole list of them.
 *
 * A closed vocabulary for the same reason {@link DATA_REQUEST_RESULTS} is one: `data.meter` compares a
 * criterion's target against it and answers `ERROR` for a key that is not a member, so a criterion
 * naming a counter nothing computes is refused rather than judged against a number the world never
 * measured. Five members, and each is a count of something the world actually did: the transport's
 * requests, the bytes in and out of its sockets, and the records that went into and came out of the
 * log. There is deliberately no rate, no latency and no size - this world has no clock, and a reading
 * carrying one would make two runs of one unchanged program differ.
 */
export const DATA_METER_KEYS = [
  "requests",
  "bytesIn",
  "bytesOut",
  "recordsProduced",
  "recordsFetched",
] as const;

export type DataMeterKey = (typeof DATA_METER_KEYS)[number];

/** One header a record carried. `value` is `null` when the header had no payload. */
export interface DataHeaderReading {
  readonly name: string;
  readonly value: string | null;
}

/**
 * One record sitting in a partition, at its offset.
 *
 * The key and the value are rendered rather than kept as bytes, because a failure report quotes them
 * and a criterion compares them. `keyHex` and `valueHex` carry the bytes when they are not text, so a
 * binary payload is recorded rather than dropped - a reading that silently omitted a non-UTF-8 value
 * would report a record as empty.
 */
export interface DataRecordReading {
  readonly offset: number;
  readonly timestamp: number;
  readonly key: string | null;
  readonly value: string | null;
  readonly keyHex: string | null;
  readonly valueHex: string | null;
  readonly headers: readonly DataHeaderReading[];
}

/**
 * One partition, as the log holds it.
 *
 * `highWatermark` is the next offset to be written, so a partition holding offsets 0..2 reads `3`.
 * That is the broker's own convention and the one a client compares against, and getting it wrong by
 * one is the defect a criterion about "how far the log got" is written to catch.
 */
export interface DataPartitionReading {
  readonly index: number;
  readonly leaderId: number;
  /** The factor the topic was created with, repeated per partition so one partition is readable alone. */
  readonly replicas: readonly number[];
  /** Who is actually in sync. This world's single node, whatever {@link replicas} says. */
  readonly isr: readonly number[];
  readonly lowWatermark: number;
  readonly highWatermark: number;
  readonly records: readonly DataRecordReading[];
}

/** One topic, with the configuration it was created with. */
export interface DataTopicReading {
  readonly name: string;
  readonly partitions: readonly DataPartitionReading[];
  readonly replicationFactor: number;
  readonly configs: readonly DataHeaderReading[];
}

/** One committed offset: how far a named group has read one partition. */
export interface DataCommittedOffsetReading {
  readonly topic: string;
  readonly partition: number;
  readonly offset: number;
  readonly metadata: string | null;
}

/** One member of a consumer group, with the assignment it was given. */
export interface DataGroupMemberReading {
  readonly memberId: string;
  readonly clientId: string | null;
  readonly protocol: string;
  /**
   * How many bytes of assignment the world handed back to this member.
   *
   * A member's assignment is the *client's* encoding, and a broker does not read it - so the honest
   * thing this world can report is its length. A list of topics and partitions here would be a claim
   * about a blob nothing decoded, which is this family's own failure mode: a reading that means
   * something the world never observed. What a criterion wants about a group's work is in
   * `DataGroupReading.committed` below, and every one of those entries *is* something the world read.
   */
  readonly assignmentBytes: number;
}

/** One consumer group, as the coordinator holds it. */
export interface DataGroupReading {
  readonly groupId: string;
  readonly generationId: number;
  readonly protocolType: string;
  /** `empty` or `stable`, which is the whole of the group state this world has. */
  readonly state: string;
  readonly members: readonly DataGroupMemberReading[];
  readonly committed: readonly DataCommittedOffsetReading[];
}

/**
 * One request the world answered.
 *
 * `bytesIn` and `bytesOut` are real byte counts off the real socket, which is what makes this record
 * usable as a meter rather than as a log. `correlationId` is recorded because a response without one
 * cannot be matched to its request, and a reading that omitted it would make two concurrent requests
 * indistinguishable.
 */
export interface DataRequestRecord {
  /**
   * The API as the register spells it, so the record names the same thing the client asked for.
   *
   * Read from the decoded frame's own `api`, which is the register's entry rather than the key the
   * bytes carried - a reader who saw `Produce(0) v0, v2` in a report can look that up, and a bare `0`
   * would send them to the register to find out what it was.
   */
  readonly api: string;
  readonly apiKey: number;
  readonly apiVersion: number;
  readonly correlationId: number | null;
  readonly clientId: string | null;
  /**
   * Who put the request, and the reason this field has to exist.
   *
   * A criterion may act in this world through a `run` step, and that action produces a request of its
   * own. Without this field the criterion's request and the application's would sit in one list, and
   * a contract that asked "did the application produce with `acks=1`" could be satisfied by the
   * criterion's own probe - a criterion earning its own pass, which is the false `PASS` this product
   * exists to make impossible. `application` means the request arrived on the socket, which is the
   * only door a process other than this world can use; `criterion` means the port performed it in
   * process on a step's behalf. The name and the two values are `CloudRequestRecord`'s, so a reader
   * who has learned one record has learned both.
   */
  readonly source: "application" | "criterion";
  readonly result: DataRequestResult;
  readonly errorCode: number;
  readonly reason: string | null;
  readonly bytesIn: number;
  readonly bytesOut: number;
}

/**
 * What the world has served, counted.
 *
 * A meter is a function of the run's own history, so it is state: a reset begins a new life for it,
 * for the reason `sim-cloud` records - a bill that carried a previous world's writes into a fresh one
 * would describe two worlds with one number. The *requests* record above is not reset, because it is
 * the record of what the run did rather than a property of the world.
 */
export interface DataMeterReading {
  readonly requests: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly recordsProduced: number;
  readonly recordsFetched: number;
}

/** The endpoint the application is told to reach. */
export interface DataNodeReading {
  readonly id: number;
  readonly host: string;
  readonly port: number;
}

/**
 * The whole reading: what the world holds and what it has served.
 *
 * `topics` and `groups` are sorted by name, so two readings of one world are byte-identical and M1 can
 * compare them. A snapshot that followed insertion order would make two runs of the same application
 * differ in their evidence, which is the one thing a repeat-run consistency measurement cannot
 * tolerate.
 */
export interface DataObservationData {
  readonly cluster: string;
  readonly node: DataNodeReading;
  readonly simulated: readonly DataSimulatedSurface[];
  readonly topics: readonly DataTopicReading[];
  readonly groups: readonly DataGroupReading[];
  readonly requests: readonly DataRequestRecord[];
  readonly meter: DataMeterReading;
}

/**
 * There is deliberately no refusal record here, and the absence is a decision rather than an omission.
 *
 * A version of this file declared one - `api`, `apiKey`, `apiVersion`, `reason`, `errorCode` - and it
 * was a second spelling of a subset of {@link DataRequestRecord}, produced by no code path and
 * re-exported by `core/environment/index.ts` so it looked part of the vocabulary. Both facts are
 * defects this repository has paid for: **a field that is a literal is a claim pretending to be a
 * record**, and an identifier declared in two places drifts when the places are edited apart. A
 * refusal in this world *is* a request that was answered with a result word and a reason, and the
 * family's own header states that a criterion pins one through `data.call` or `data.probe`.
 */

// ---------------------------------------------------------------------------------------------
// The reference grammar
// ---------------------------------------------------------------------------------------------

/**
 * What a target in this family may name.
 *
 * Six nouns, and each is addressed differently because each is a different kind of thing: a topic by
 * its name, a partition by `<topic>/<index>`, a record by `<topic>/<index>/<offset>`, a group by its
 * id, a member by `<group>/<memberId>`, and a committed offset by `<group>/<topic>/<index>`.
 *
 * `member` is the noun that exists because a *count* is not a membership. `renderGroup` says how many
 * members a group has, which is enough to notice that one left and not enough to say who is there - 
 * and the reading already carries each member's id, protocol and assignment size, so a family that
 * could only count them would be withholding what it holds.
 *
 * **The validator supplies the noun and the target names the object**, which is why no spelling below
 * carries a prefix: {@link parseDataRef} is told which noun it is reading for, so `cart-events` is a
 * topic to `data.topic` and cannot be mistaken for a group of the same name by a validator that
 * happened to be handed it. The families next door spell a kind inside the target (`bucket/x`,
 * `image/x:1.0.0`) because one validator there serves several kinds; here each noun has its own
 * validator, so a prefix would be a second way to write one thing and a chance to write it wrong.
 *
 * The record grammar is deliberately the only four-segment one: an offset is meaningless without the
 * partition it counts within, and a partition is meaningless without its topic, so a two-segment
 * spelling for a record would have to guess which topic the author meant. *A target that cannot name
 * one object is a target that will name the wrong one.*
 */
export const DATA_REF_NOUNS = ["topic", "partition", "record", "group", "member", "commit"] as const;
export type DataRefNoun = (typeof DATA_REF_NOUNS)[number];

/** One parsed target. `parts` is the split spelling, kept for a report to quote verbatim. */
export interface DataRef {
  readonly noun: DataRefNoun;
  readonly parts: readonly string[];
  /** The spelling the criterion wrote, so a failure report quotes the author rather than the parser. */
  readonly spelling: string;
}

/**
 * Read one target, or answer `null` when the spelling cannot name the noun asked for.
 *
 * A refusal rather than a throw: a malformed target is an observation about the *contract*, and this
 * family reports it as `INCONCLUSIVE` with the spelling quoted, exactly as the process family does.
 */
export function parseDataRef(noun: DataRefNoun, target: string): DataRef | null {
  const spelling = target.trim();
  const parts = spelling.split("/");
  if (parts.some((part) => part.trim() === "")) return null;
  /*
   * How many segments each noun needs, and which segment carries its number. Both are per-noun
   * because both are facts about the grammar: a topic is one name, a partition is a topic plus an
   * index, a record is those plus an offset, a group is one id, a member is a group plus an id, and a
   * commit is a group plus a topic plus an index - which is the one row where the number sits before
   * the name it belongs to.
   *
   * This table is a `Record<DataRefNoun, ...>`, so a noun added to {@link DATA_REF_NOUNS} without a
   * row here does not compile. That is deliberate: the alternative is a noun that parses as
   * `undefined` and reports every target as malformed.
   */
  const segments: Record<DataRefNoun, { readonly count: number; readonly numbers: readonly number[] }> = {
    topic: { count: 1, numbers: [] },
    partition: { count: 2, numbers: [1] },
    record: { count: 3, numbers: [1, 2] },
    group: { count: 1, numbers: [] },
    member: { count: 2, numbers: [] },
    commit: { count: 3, numbers: [2] },
  };
  const shape = segments[noun];
  if (parts.length !== shape.count) return null;
  for (const position of shape.numbers) {
    const value = Number(parts[position]);
    if (!Number.isInteger(value) || value < 0) return null;
  }
  return { noun, parts, spelling };
}

// ---------------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------------

export function dataTopicNamed(data: DataObservationData, name: string): DataTopicReading | null {
  return data.topics.find((topic) => topic.name === name) ?? null;
}

export function dataPartitionAt(topic: DataTopicReading, index: number): DataPartitionReading | null {
  return topic.partitions.find((partition) => partition.index === index) ?? null;
}

export function dataRecordAt(partition: DataPartitionReading, offset: number): DataRecordReading | null {
  return partition.records.find((record) => record.offset === offset) ?? null;
}

export function dataGroupNamed(data: DataObservationData, groupId: string): DataGroupReading | null {
  return data.groups.find((group) => group.groupId === groupId) ?? null;
}

export function dataMemberNamed(
  group: DataGroupReading,
  memberId: string,
): DataGroupMemberReading | null {
  return group.members.find((member) => member.memberId === memberId) ?? null;
}

export function dataCommittedAt(
  group: DataGroupReading,
  topic: string,
  partition: number,
): DataCommittedOffsetReading | null {
  return (
    group.committed.find((entry) => entry.topic === topic && entry.partition === partition) ?? null
  );
}

/**
 * One counter, or `null` for a key this world does not keep.
 *
 * `null` means exactly one thing - the key is not a member of {@link DATA_METER_KEYS} - and the
 * validator that calls this reports it as `ERROR` rather than as zero, because zero is a count of
 * something that did not happen and an unknown key is not a count at all.
 */
export function dataMeterValue(meter: DataMeterReading, key: string): number | null {
  if (!(DATA_METER_KEYS as readonly string[]).includes(key)) return null;
  return meter[key as DataMeterKey];
}

/**
 * Resolve a parsed target against the reading, answering `null` when the world does not hold it.
 *
 * One function rather than one per verb, so a criterion naming a topic the pipeline never created is
 * reported the same way whichever validator asked - and so the *absence* travels as `null` rather
 * than as a thrown error. A resource that is absent and a request that was refused are two different
 * observations, and HTTP has a word for each; this family keeps them apart in the same spirit.
 */
export function resolveDataRef(
  data: DataObservationData,
  ref: DataRef,
):
  | DataTopicReading
  | DataPartitionReading
  | DataRecordReading
  | DataGroupReading
  | DataGroupMemberReading
  | DataCommittedOffsetReading
  | null {
  if (ref.noun === "topic") return dataTopicNamed(data, ref.parts[0] ?? "");
  if (ref.noun === "group") return dataGroupNamed(data, ref.parts[0] ?? "");
  if (ref.noun === "partition") {
    const topic = dataTopicNamed(data, ref.parts[0] ?? "");
    return topic === null ? null : dataPartitionAt(topic, Number(ref.parts[1]));
  }
  if (ref.noun === "record") {
    const topic = dataTopicNamed(data, ref.parts[0] ?? "");
    if (topic === null) return null;
    const partition = dataPartitionAt(topic, Number(ref.parts[1]));
    return partition === null ? null : dataRecordAt(partition, Number(ref.parts[2]));
  }
  const group = dataGroupNamed(data, ref.parts[0] ?? "");
  if (ref.noun === "member") {
    return group === null ? null : dataMemberNamed(group, ref.parts[1] ?? "");
  }
  return group === null ? null : dataCommittedAt(group, ref.parts[1] ?? "", Number(ref.parts[2]));
}

// ---------------------------------------------------------------------------------------------
// Renderings
// ---------------------------------------------------------------------------------------------

/** How a record reads: its offset, its key, its value and how many headers it carried. */
export function renderRecord(record: DataRecordReading): string {
  const key = record.key === null ? "null" : `'${record.key}'`;
  const value = record.value === null ? "null" : `'${record.value}'`;
  return `offset ${record.offset} key ${key} value ${value} (${record.headers.length} header(s))`;
}

/**
 * How a partition reads, and every number in it is load-bearing.
 *
 * `offsets 0..2` is the range the log actually holds, `hw 3` is the high watermark standing beside
 * it, and `isr [1]` is the membership that is in sync. The range is printed as the records held
 * rather than as the watermark, because the two are different facts and the one a reader can check
 * against the record list is the first. Printing the watermark twice would make a partition whose
 * records had moved but whose watermark had not read as unchanged.
 */
export function renderPartition(partition: DataPartitionReading): string {
  const first = partition.records[0]?.offset ?? null;
  const last = partition.records[partition.records.length - 1]?.offset ?? null;
  const range = first === null || last === null ? "empty" : `offsets ${first}..${last}`;
  return `partition ${partition.index}: ${partition.records.length} record(s), ${range}, hw ${partition.highWatermark}, isr [${partition.isr.join(", ")}]`;
}

/**
 * How a topic reads: its partition count, the factor it *recorded*, and the membership that could
 * honour it.
 *
 * The two halves of `replication 3 recorded, isr [1]` are the honest statement of this world's
 * limit - see the header - and they are printed as one string so a criterion comparing a topic pins
 * both at once.
 */
export function renderTopic(topic: DataTopicReading): string {
  const isr = topic.partitions[0]?.isr ?? [];
  const cleanup = topic.configs.find((config) => config.name === "cleanup.policy")?.value ?? "delete";
  return `topic '${topic.name}' (${topic.partitions.length} partition(s), replication ${topic.replicationFactor} recorded, isr [${isr.join(", ")}], cleanup ${cleanup})`;
}

/** How a committed offset reads. `metadata` is quoted when present, because it is not state. */
export function renderCommitted(entry: DataCommittedOffsetReading): string {
  const metadata = entry.metadata === null ? "no metadata" : `metadata '${entry.metadata}'`;
  return `${entry.topic}/${entry.partition} committed ${entry.offset} (${metadata})`;
}

/** How a member reads: who it is, how it joined, and how many assignment bytes it was handed. */
export function renderMember(member: DataGroupMemberReading): string {
  const bytes = member.assignmentBytes === 0 ? "no bytes" : `${member.assignmentBytes} byte(s)`;
  return `${member.memberId} (${member.protocol}) handed ${bytes}`;
}

/** How a group reads: its generation, its state, its members and how far it has committed. */
export function renderGroup(group: DataGroupReading): string {
  return `group '${group.groupId}' generation ${group.generationId}, ${group.state}, ${group.members.length} member(s), ${group.committed.length} committed offset(s)`;
}

/**
 * How one request reads. The result word is the whole point of the record, so it comes last.
 *
 * The origin comes first because it is the field that decides whether the rest of the line is evidence
 * about the application or about the criterion. A reader comparing two runs needs to know that before
 * they read the API name.
 */
export function renderRequest(record: DataRequestRecord): string {
  const correlation = record.correlationId === null ? "no correlation id" : `corr ${record.correlationId}`;
  const detail = record.reason === null ? "" : `: ${record.reason}`;
  return `${record.source} ${record.api} ${correlation} -> ${record.result}${detail}`;
}

/** How the meter reads. Bytes are counted, never estimated. */
export function renderMeter(meter: DataMeterReading): string {
  return `${meter.requests} request(s), ${meter.bytesIn} byte(s) in, ${meter.bytesOut} byte(s) out, ${meter.recordsProduced} produced, ${meter.recordsFetched} fetched`;
}

/**
 * The endpoint's own identity: which node, on which address.
 *
 * Separate from {@link renderNode}, which describes the whole world, because the two answer different
 * questions and a criterion may legitimately pin this one: a broker's `host` and `port` are what the
 * application was handed through the environment, so `contains: "node 1 at 127.0.0.1"` states that the
 * run reached a loopback endpoint of *this* world without pinning the port the operating system chose.
 */
export function renderNodeIdentity(node: DataNodeReading): string {
  return `node ${node.id} at ${node.host}:${node.port}`;
}

/**
 * How the world itself reads - the targetless question.
 *
 * Narration and a reader of a bundle use this: the cluster, the endpoint, how much of the world was
 * stood in for and how much it holds at the moment the reading was taken.
 *
 * The *count* of simulated surfaces is printed rather than the names, and the names travel through
 * {@link renderSimulatedSurfaces}. Neither is offered to a criterion as a comparison - a contract that
 * asserted which surfaces were simulated would be a contract about the substitute rather than about
 * the software, and the reading carries `simulated` so that a verdict reached against a substitute
 * says so where the verdict is.
 */
export function renderNode(data: DataObservationData): string {
  return `${data.cluster} (node ${data.node.id}) at ${data.node.host}:${data.node.port}, ${data.simulated.length} simulated surface(s), ${data.topics.length} topic(s), ${data.groups.length} group(s)`;
}

/**
 * The surface names, as a list for a criterion to compare.
 *
 * Derived from the constant rather than written out, so the rendering cannot disagree with the list
 * the reading carries.
 */
export function renderSimulatedSurfaces(data: DataObservationData): string {
  return data.simulated.join(", ");
}

// ---------------------------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------------------------
//
// A structural check, not a schema validation. It answers "can this be read as a broker document",
// and that answer is what separates a validator judging a world from a validator reporting that the
// world arrived unreadable - the two verdicts this family most needs to keep apart, because the first
// is a fact about the application and the second is a defect in the environment.
//
// It is deliberately shallow in one direction: a string field is checked for being a string and not
// for being a member of a closed vocabulary. Membership is the comparisons' job - `compareWord` is
// handed the very list the reading was written from, and it reports a value outside it as an
// unusable expectation. A guard that also enumerated every vocabulary would be a second list of the
// same names, drifting from the first.

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isText = (value: unknown): boolean => typeof value === "string";

const isTextOrNull = (value: unknown): boolean => value === null || typeof value === "string";

const isCount = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

const isCountOrNull = (value: unknown): boolean => value === null || isCount(value);

/** `noUncheckedIndexedAccess` makes an index yield a maybe, so membership is asked of the list. */
const eachIs = (value: unknown, predicate: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every((item) => predicate(item));

function isHeader(value: unknown): boolean {
  return isRecord(value) && isText(value["name"]) && isTextOrNull(value["value"]);
}

function isRecordReading(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value["offset"]) &&
    isCount(value["timestamp"]) &&
    isTextOrNull(value["key"]) &&
    isTextOrNull(value["value"]) &&
    isTextOrNull(value["keyHex"]) &&
    isTextOrNull(value["valueHex"]) &&
    eachIs(value["headers"], isHeader)
  );
}

function isPartition(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value["index"]) &&
    isCount(value["leaderId"]) &&
    eachIs(value["replicas"], isCount) &&
    eachIs(value["isr"], isCount) &&
    isCount(value["lowWatermark"]) &&
    isCount(value["highWatermark"]) &&
    eachIs(value["records"], isRecordReading)
  );
}

function isTopic(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value["name"]) &&
    eachIs(value["partitions"], isPartition) &&
    isCount(value["replicationFactor"]) &&
    eachIs(value["configs"], isHeader)
  );
}

function isCommitted(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value["topic"]) &&
    isCount(value["partition"]) &&
    isCount(value["offset"]) &&
    isTextOrNull(value["metadata"])
  );
}

function isMember(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value["memberId"]) &&
    isTextOrNull(value["clientId"]) &&
    isText(value["protocol"]) &&
    isCount(value["assignmentBytes"])
  );
}

function isGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value["groupId"]) &&
    isCount(value["generationId"]) &&
    isText(value["protocolType"]) &&
    isText(value["state"]) &&
    eachIs(value["members"], isMember) &&
    eachIs(value["committed"], isCommitted)
  );
}

function isRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value["api"]) &&
    isCount(value["apiKey"]) &&
    isCount(value["apiVersion"]) &&
    isCountOrNull(value["correlationId"]) &&
    isTextOrNull(value["clientId"]) &&
    (value["source"] === "application" || value["source"] === "criterion") &&
    isText(value["result"]) &&
    isCount(value["errorCode"]) &&
    isTextOrNull(value["reason"]) &&
    isCount(value["bytesIn"]) &&
    isCount(value["bytesOut"])
  );
}

/**
 * The meter, checked against {@link DATA_METER_KEYS} rather than against five field names written out.
 *
 * A guard that listed the counters again would be a copy of the vocabulary the validator compares
 * against, and the two would disagree the moment one of them gained a member.
 *
 * The record is bound to its own name first because TypeScript does not carry a narrowed *parameter*
 * into a callback - inside `.every` the original `value` is `unknown` again, and indexing it would be
 * a type error rather than a check.
 */
function isMeter(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const meter: Readonly<Record<string, unknown>> = value;
  return DATA_METER_KEYS.every((key) => isCount(meter[key]));
}

function isNode(value: unknown): boolean {
  return isRecord(value) && isCount(value["id"]) && isText(value["host"]) && isCount(value["port"]);
}

/**
 * Can this observation's document be read as a broker reading?
 *
 * Every member of {@link DataObservationData} is checked, including the arrays' elements - a reading
 * that carried a topic list of strings would otherwise reach a validator that calls `.find` on it and
 * throw, which turns a defect in the environment into a crashed run rather than into an `ERROR`
 * assertion naming the environment.
 */
export function isDataObservationData(value: unknown): value is DataObservationData {
  return (
    isRecord(value) &&
    isText(value["cluster"]) &&
    isNode(value["node"]) &&
    eachIs(value["simulated"], isText) &&
    eachIs(value["topics"], isTopic) &&
    eachIs(value["groups"], isGroup) &&
    eachIs(value["requests"], isRequest) &&
    isMeter(value["meter"])
  );
}
