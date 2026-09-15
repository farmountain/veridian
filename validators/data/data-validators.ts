/**
 * The broker validator family: the questions a criterion may ask about a log a substitute broker holds.
 *
 * ## What a validator is allowed to know
 *
 * One observation, of kind {@link DATA_OBSERVATION_KIND}, in the shape declared by
 * `core/environment/data-observation.ts`. Nothing else. This file may not import
 * `adapters/sim-data/*` - the layering rule forbids it, and the rule is the reason the family can
 * judge a *real* broker later without changing a single verb: the questions are about a log, and a
 * log is a log whether the endpoint answering is a substitute in this process or a server in another
 * container. Every reader and every rendering this family compares lives in the reading vocabulary,
 * so there is exactly one definition of what `renderTopic` prints.
 *
 * The names are therefore `data.*` and not `sim-data.*`. The criterion is about the log, not about
 * what stood in for it, and the substitution **is** recorded - in the reading's own `simulated`
 * field - because a verdict reached against a substitute has to say so where the verdict is, not in
 * the name of the vocabulary that reached it.
 *
 * ## The two doors, and why `call` and `probe` are two validators
 *
 * A request reaches this world one of two ways, and the reading says which: `source: "application"`
 * for a request that arrived on the socket, `source: "criterion"` for one the port performed in
 * process on a `run` step's behalf. Those are two different questions asked of two different
 * subjects, so they are two validators - `data.call` reads the application's traffic, `data.probe`
 * reads the criterion's own commands. One validator taking a flag would be a criterion that could
 * satisfy its own question, which is the false `PASS` this product exists to make impossible.
 *
 * ## The payload's two spellings, and the one it does not have
 *
 * `DataRecordReading` carries a key and a value twice: as decoded text and as hex. The text spelling
 * is what {@link DATA_VALIDATOR_NAMES.key} and {@link DATA_VALIDATOR_NAMES.value} compare, and the
 * limitations that follow are stated rather than hidden. A payload that is not UTF-8 decodes with
 * replacement characters, so a criterion comparing such a payload is comparing a rendering and will
 * read the replacement characters in its own failure report. A key or a value that is absent reads as
 * the empty string, which no text comparison can tell from a payload that *is* the empty string. Both
 * facts are in the reading - the bytes in `keyHex`/`valueHex`, the absence in the `null` that
 * `renderRecord` prints in the subject line of every one of these validators - and neither is
 * something a comparison over text can carry. The bytes belong to the run's artifact, which is where
 * a reader who needs them should look: a *comparison* over hex would look like a text comparison to
 * whoever wrote the contract and would pass for the wrong reason.
 *
 * ## Status discipline
 *
 * `PASS` and `FAIL` are reserved for facts about the world: the world answered, and the answer did or
 * did not match. `INCONCLUSIVE` means nobody looked - the resource is absent, the request was never
 * made, or the target names something this family cannot read - and it is never collapsed into
 * success. `ERROR` means the criterion itself cannot be evaluated (a missing target, an unusable
 * comparison, a meter this world does not keep) and is always `VALIDATOR_ERROR` rather than
 * `TEST_FAILURE`, because the application has not been accused of anything.
 *
 * ## The guards this world needs beyond the families next door
 *
 * Three. A meter key outside {@link DATA_METER_KEYS} is reported unusable rather than as zero, since
 * zero is a count of something that did not happen. A target naming a resource the world does not
 * hold is reported with what the world *does* hold near it, so a failure report sends a reader to the
 * name they got wrong rather than to the application. And the union `resolveDataRef` answers with is
 * turned back into one reading by a field only that member carries, because a cast would be a claim
 * about the world that the compiler cannot check.
 *
 * ## What this family deliberately does not judge
 *
 * - **The substitution.** `data.simulated` does not exist. The reading records which surfaces were
 *   stood in for so a *verdict* can say so; a criterion comparing that list would be a contract about
 *   the substitute rather than about the software.
 * - **A refusal, as its own fact.** There is no `data.refusal`, and that is a fact about the reading
 *   rather than a gap: every refusal this world produces is a `DataRequestRecord` carrying a result
 *   word and a `reason`, so a criterion pins one through `data.call` or `data.probe`. A validator for
 *   a field the adapter never writes would be a guard no code path can trip.
 * - **Latency, throughput and size.** This world has no clock. A criterion about how fast a request
 *   was answered would be a criterion about this machine's scheduler, and it would make two runs of
 *   one unchanged program differ.
 * - **The replication it recorded.** `data.layout` compares what the *world* recorded and holds -
 *   the factor and the in-sync set as it stands - and it is deliberately not a claim that the
 *   replication happened. The header of `data-observation.ts` states the limit; the criterion's own
 *   description is where it belongs.
 */
import {
  DATA_METER_KEYS,
  DATA_OBSERVATION_KIND,
  DATA_REQUEST_RESULTS,
  isDataObservationData,
  dataMeterValue,
  parseDataRef,
  renderCommitted,
  renderGroup,
  renderMember,
  renderNodeIdentity,
  renderPartition,
  renderRecord,
  renderTopic,
  renderMeter,
  renderRequest,
  resolveDataRef,
} from "../../core/environment/data-observation.ts";
import type {
  DataCommittedOffsetReading,
  DataGroupMemberReading,
  DataGroupReading,
  DataObservationData,
  DataPartitionReading,
  DataRecordReading,
  DataRef,
  DataRefNoun,
  DataRequestRecord,
  DataTopicReading,
} from "../../core/environment/data-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  compareWord,
  judge,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * A roster guard reads this object; `cli/validators.ts` registers from it; a README prints it. One
 * definition, whatever number of readers, which is the only arrangement in which a name cannot be
 * registered under a spelling no document mentions.
 */
export const DATA_VALIDATOR_NAMES = {
  node: "data.node",
  topic: "data.topic",
  layout: "data.layout",
  partition: "data.partition",
  record: "data.record",
  key: "data.key",
  value: "data.value",
  group: "data.group",
  member: "data.member",
  commit: "data.commit",
  call: "data.call",
  probe: "data.probe",
  meter: "data.meter",
} as const;

// ---- shared plumbing ------------------------------------------------------------------------------

/**
 * Membership in the status vocabulary, rather than a duck-typed `"status" in value`.
 *
 * A `readDocument` guard that accepted any object with a `status` would happily accept a
 * `CriterionResult` and read its fields as a broker reading.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  (CRITERION_STATUSES as readonly unknown[]).includes((value as { status?: unknown }).status);

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): DataObservationData | AssertionResult {
  if (isDataObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a broker document, so ` +
      "there is nothing to read. The adapter produced the reading, so this is a defect in the " +
      "environment rather than a log the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * One target, parsed for the noun this validator reads, or the assertion explaining why not.
 *
 * The message names the grammar the noun has and the three ways {@link parseDataRef} refuses a
 * spelling, because that is everything a reader needs to fix the criterion - and because the
 * alternative, a sentence saying the target is "invalid", sends them to the world to look for a
 * resource whose spelling was never readable in the first place.
 */
function refOf(
  validator: string,
  noun: DataRefNoun,
  target: string | null,
  what: string,
  grammar: string,
): DataRef | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const ref = parseDataRef(noun, target);
  if (ref !== null) return ref;
  return unusable(
    validator,
    target,
    `${quote(target)} is not ${what}. This family reads ${grammar}, split on \`/\`; an empty ` +
      "segment refuses the whole spelling, the segment count is fixed for the noun, and every " +
      "segment that carries a number must be a whole number at or above zero.",
  );
}

// ---- resolved unions, narrowed by a field only one member carries ----------------------------------

type Resolved = ReturnType<typeof resolveDataRef>;

/*
 * `resolveDataRef` answers with the union of all five nouns because its job is to travel one path for
 * every validator that asks. A validator needs the one member its noun names, and each member carries
 * at least one field no other member has, so the five predicates below are facts about the shapes
 * declared in `data-observation.ts` rather than guesses. A cast would be shorter and would assert
 * something about the world that nothing checks - the family's own failure mode.
 */

const isTopicReading = (found: Resolved): found is DataTopicReading =>
  found !== null && "replicationFactor" in found;

const isPartitionReading = (found: Resolved): found is DataPartitionReading =>
  found !== null && "highWatermark" in found;

const isRecordReading = (found: Resolved): found is DataRecordReading =>
  found !== null && "headers" in found;

const isGroupReading = (found: Resolved): found is DataGroupReading => found !== null && "members" in found;

const isMemberReading = (found: Resolved): found is DataGroupMemberReading =>
  found !== null && "assignmentBytes" in found;

const isCommitReading = (found: Resolved): found is DataCommittedOffsetReading =>
  found !== null && "metadata" in found;

// ---- absence, and what the world holds instead -----------------------------------------------------

const held = (names: readonly string[]): string =>
  names.length === 0 ? "nothing by that name" : names.map(quote).join(", ");

/**
 * What the world holds near a target it does not hold.
 *
 * A report that says only "absent" sends a reader to the application; a report that names the topics
 * the world *does* hold sends them to the spelling. The nearest container is named where there is
 * one - a missing record is reported against the partition it should have been in, and a partition
 * against its topic - so the sentence answers the question the criterion was actually asking.
 */
function heldNearby(document: DataObservationData, ref: DataRef): string {
  if (ref.noun === "topic") return `it holds ${held(document.topics.map((topic) => topic.name))}`;
  if (ref.noun === "group") return `it holds ${held(document.groups.map((group) => group.groupId))}`;
  if (ref.noun === "commit") {
    const group = document.groups.find((candidate) => candidate.groupId === ref.parts[0]);
    if (group === undefined) return `it holds no group named ${quote(ref.parts[0] ?? "")}`;
    return (
      `group ${quote(group.groupId)} holds ` +
      held(group.committed.map((entry) => `${entry.topic}/${entry.partition}`)) +
      " as committed offsets"
    );
  }
  if (ref.noun === "member") {
    const group = document.groups.find((candidate) => candidate.groupId === ref.parts[0]);
    if (group === undefined) return `it holds no group named ${quote(ref.parts[0] ?? "")}`;
    return (
      `group ${quote(group.groupId)} holds ` +
      held(group.members.map((entry) => entry.memberId)) +
      " as members"
    );
  }
  const topic = document.topics.find((candidate) => candidate.name === ref.parts[0]);
  if (topic === undefined) return `it holds no topic named ${quote(ref.parts[0] ?? "")}`;
  if (ref.noun === "partition") {
    return (
      `topic ${quote(topic.name)} holds ` +
      held(topic.partitions.map((partition) => `${topic.name}/${partition.index}`))
    );
  }
  const partition = topic.partitions.find((candidate) => candidate.index === Number(ref.parts[1]));
  if (partition === undefined) {
    return (
      `topic ${quote(topic.name)} holds no partition ${ref.parts[1] ?? ""}; it holds ` +
      held(topic.partitions.map((candidate) => `${topic.name}/${candidate.index}`))
    );
  }
  return (
    `partition ${quote(ref.parts[0] + "/" + ref.parts[1])} holds ` +
    held(partition.records.map((record) => String(record.offset))) +
    " as offsets"
  );
}

/**
 * The world did not hold the target.
 *
 * `INCONCLUSIVE` rather than `FAIL`: an absent resource and a mismatching one are different facts
 * with different repairs, and the sentence says which - the world never held this, so there was
 * nothing to compare.
 */
function absent(
  validator: string,
  ref: DataRef,
  document: DataObservationData,
  what: string,
): AssertionResult {
  return unanswered(
    validator,
    ref.spelling,
    `The world holds no ${what} named ${quote(ref.spelling)}, so there is nothing to judge. This is ` +
      `an absent resource rather than a resource that disagreed with the criterion: ${heldNearby(document, ref)}.`,
  );
}

// ---- a request, chosen by which door it came through -----------------------------------------------

/**
 * Does a recorded request carry this target?
 *
 * A record's `api` is the register's own spelling - `Produce(0) v0, v2` - so a criterion may write
 * either that whole string or the bare register name it starts with, which is what an author who has
 * read `protocol.ts` will reach for. Nothing looser: a prefix test on the whole string would let
 * `Produce` match a hypothetical `Producer`, and the register's names are fixed and distinct.
 */
const apiMatches = (record: DataRequestRecord, target: string): boolean =>
  record.api === target || record.api.startsWith(`${target}(`);

/**
 * The newest request of one kind, or the assertion explaining why there is none to judge.
 *
 * Three absences, three sentences: nothing of that name at all; something of that name but not from
 * this door (the criterion answering its own question); and something of that name from the right
 * door, in which case the request is returned. Container's `callBy` is the same shape, and the
 * second sentence is why - a criterion's own command is not evidence about the application.
 */
function requestBy(
  validator: string,
  target: string,
  document: DataObservationData,
  source: DataRequestRecord["source"],
  other: readonly [name: string, description: string],
): DataRequestRecord | AssertionResult {
  const matching = document.requests.filter((record) => apiMatches(record, target));
  if (matching.length === 0) {
    const known = [...new Set(document.requests.map((record) => record.api))];
    return unanswered(
      validator,
      target,
      `The world recorded no request for ${quote(target)} at all, so there is nothing to judge. ` +
        "This is the absence of a record rather than a request that failed: a request the broker " +
        "refused is judged here, and so is a frame the transport could not read. The world answered " +
        `${known.length === 0 ? "no requests in this run" : known.map(quote).join(", ")}.`,
    );
  }
  const mine = matching.filter((record) => record.source === source);
  const newest = mine[mine.length - 1];
  if (newest === undefined) {
    const doors = [...new Set(matching.map((record) => record.source))].join(", ");
    return unanswered(
      validator,
      target,
      `Every recorded request for ${quote(target)} came through ${doors}, and this validator reads ` +
        `only the requests recorded as ${source}. Those are different questions with different ` +
        `validators - ${quote(other[0])} is the one that reads ${other[1]} - and a criterion's own ` +
        "command is not evidence about the application.",
    );
  }
  return newest;
}

/** `equals` against the result vocabulary the reading owns, so a misspelling is unusable, not false. */
const compareRequestResult = compareWord(DATA_REQUEST_RESULTS, "the result of a request");

// ---- the validators --------------------------------------------------------------------------------

/**
 * The world's own identity: which cluster, and which endpoint answered.
 *
 * Targetless, because the question is about the world rather than about anything in it. The compared
 * value is the cluster and {@link renderNodeIdentity}, and *not* `renderNode` - which prints how many
 * topics the world holds, so a criterion comparing it would move whenever the application created
 * one. That is a flake rather than an assertion, and the whole point of a targetless reading is that
 * it holds still.
 */
const node: Validator = {
  name: DATA_VALIDATOR_NAMES.node,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, node.name, null);
    if (isAssertion(document)) return document;
    const identity = `${document.cluster} (${renderNodeIdentity(document.node)})`;
    return judge(
      node.name,
      null,
      `the broker the run reached (${quote(identity)})`,
      identity,
      raw,
      compareText,
    );
  },
};

/** Whether the world holds a topic at all. */
const topic: Validator = {
  name: DATA_VALIDATOR_NAMES.topic,
  needsTarget: true,
  targetNoun: "topic name (`cart-events`)",
  comparisons: ["equals"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, topic.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(topic.name, "topic", target, "a topic name (`cart-events`)", "`<topic>`");
    if (isAssertion(ref)) return ref;
    const found = document.topics.some((candidate) => candidate.name === ref.spelling);
    return judge(
      topic.name,
      ref.spelling,
      `whether the world holds a topic named ${quote(ref.spelling)}`,
      found,
      raw,
      comparePresence,
    );
  },
};

/**
 * How a topic is laid out, as the world recorded it.
 *
 * The compared string is {@link renderTopic}, which prints the partition count, the factor the topic
 * *recorded* and the in-sync membership that could honour it - `replication 3 recorded, isr [1]` -
 * because those three facts are one sentence about one thing, and a criterion that pins the sentence
 * pins all of them. The two halves are the honest statement of this world's limit: the factor is a
 * declaration and the in-sync set is what actually stands behind it, and printing them together is
 * what stops a `PASS` on `replication 3` being read as three copies.
 */
const layout: Validator = {
  name: DATA_VALIDATOR_NAMES.layout,
  needsTarget: true,
  targetNoun: "topic name (`cart-events`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, layout.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(layout.name, "topic", target, "a topic name (`cart-events`)", "`<topic>`");
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isTopicReading(found)) return absent(layout.name, ref, document, "topic");
    return judge(
      layout.name,
      ref.spelling,
      `how the world recorded the layout of ${quote(ref.spelling)}`,
      renderTopic(found),
      raw,
      compareText,
    );
  },
};

/** One partition: the offsets it holds, its high watermark and the members that are in sync. */
const partition: Validator = {
  name: DATA_VALIDATOR_NAMES.partition,
  needsTarget: true,
  targetNoun: "partition reference (`cart-events/0`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, partition.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      partition.name,
      "partition",
      target,
      "a partition reference (`<topic>/<index>`)",
      "`<topic>/<index>`",
    );
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isPartitionReading(found)) return absent(partition.name, ref, document, "partition");
    return judge(
      partition.name,
      ref.spelling,
      `the log ${quote(ref.spelling)} holds`,
      renderPartition(found),
      raw,
      compareText,
    );
  },
};

/** Whether a record is there at all, at the offset its target names. */
const record: Validator = {
  name: DATA_VALIDATOR_NAMES.record,
  needsTarget: true,
  targetNoun: "record reference (`cart-events/0/2`)",
  comparisons: ["equals"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, record.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      record.name,
      "record",
      target,
      "a record reference (`<topic>/<index>/<offset>`)",
      "`<topic>/<index>/<offset>`",
    );
    if (isAssertion(ref)) return ref;
    const found = isRecordReading(resolveDataRef(document, ref));
    return judge(
      record.name,
      ref.spelling,
      `whether the world holds a record at ${quote(ref.spelling)}`,
      found,
      raw,
      comparePresence,
    );
  },
};

/**
 * A record's key, as text.
 *
 * The subject line quotes {@link renderRecord} rather than just the key, because a failure report is
 * read by someone deciding whether the *key* is wrong or the wrong *record* was named - and the
 * offset, the value and the header count are what tell them apart.
 */
const key: Validator = {
  name: DATA_VALIDATOR_NAMES.key,
  needsTarget: true,
  targetNoun: "record reference (`cart-events/0/2`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, key.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      key.name,
      "record",
      target,
      "a record reference (`<topic>/<index>/<offset>`)",
      "`<topic>/<index>/<offset>`",
    );
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isRecordReading(found)) return absent(key.name, ref, document, "record");
    return judge(
      key.name,
      ref.spelling,
      `the key of the record at ${quote(ref.spelling)} (${renderRecord(found)})`,
      found.key ?? "",
      raw,
      compareText,
    );
  },
};

/**
 * A record's value, as text.
 *
 * A record produced with no value at all - a tombstone, which is how a log marks a deletion -
 * compares as the empty string, and this comparison cannot tell it from an empty payload. The
 * distinction is real, it is in the reading, and the subject line quotes {@link renderRecord}, which
 * prints `null` for the tombstone and `''` for the empty payload - so a reader of the failure report
 * can see which they are looking at, while the comparison itself sees one string. A comparison over
 * text cannot carry the difference, and inventing a second spelling for it (comparing `"null"`) would
 * make a JSON payload whose text is `null` indistinguishable from an absent value.
 */
const value: Validator = {
  name: DATA_VALIDATOR_NAMES.value,
  needsTarget: true,
  targetNoun: "record reference (`cart-events/0/2`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, value.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      value.name,
      "record",
      target,
      "a record reference (`<topic>/<index>/<offset>`)",
      "`<topic>/<index>/<offset>`",
    );
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isRecordReading(found)) return absent(value.name, ref, document, "record");
    return judge(
      value.name,
      ref.spelling,
      `the value of the record at ${quote(ref.spelling)} (${renderRecord(found)})`,
      found.value ?? "",
      raw,
      compareText,
    );
  },
};

/** One consumer group: its generation, its state, its members and how much it has committed. */
const group: Validator = {
  name: DATA_VALIDATOR_NAMES.group,
  needsTarget: true,
  targetNoun: "consumer group id (`cart-indexer`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, group.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(group.name, "group", target, "a consumer group id (`cart-indexer`)", "`<group>`");
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isGroupReading(found)) return absent(group.name, ref, document, "group");
    return judge(
      group.name,
      ref.spelling,
      `the coordinator's view of group ${quote(ref.spelling)}`,
      renderGroup(found),
      raw,
      compareText,
    );
  },
};

/**
 * One member of a consumer group, as the coordinator recorded it.
 *
 * The compared string is {@link renderMember}: the member id, the protocol it joined with and the size
 * of the assignment it was handed. The three facts are one sentence because they are one fact about
 * one member - the id without the size says a member joined, the size without the id says the group
 * split its partitions - and printing the count alone would make a member that left and another that
 * arrived read as no change at all.
 *
 * `clientId` is in the reading and deliberately not in the sentence, so a criterion about which
 * *client* a member is cannot be asked here; the honest place to say that is beside the rendering it
 * compares rather than in a criterion that quietly passes on the protocol instead.
 */
const member: Validator = {
  name: DATA_VALIDATOR_NAMES.member,
  needsTarget: true,
  targetNoun: "member reference (`cart-indexer/cart-indexer-1`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, member.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      member.name,
      "member",
      target,
      "a member reference (`<group>/<memberId>`)",
      "`<group>/<memberId>`",
    );
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isMemberReading(found)) return absent(member.name, ref, document, "member");
    return judge(
      member.name,
      ref.spelling,
      `the member ${quote(ref.spelling)} as the coordinator recorded it`,
      renderMember(found),
      raw,
      compareText,
    );
  },
};

/** How far a named group has read one partition. */
const commit: Validator = {
  name: DATA_VALIDATOR_NAMES.commit,
  needsTarget: true,
  targetNoun: "committed-offset reference (`cart-indexer/cart-events/0`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, commit.name, target);
    if (isAssertion(document)) return document;
    const ref = refOf(
      commit.name,
      "commit",
      target,
      "a committed-offset reference (`<group>/<topic>/<index>`)",
      "`<group>/<topic>/<index>`",
    );
    if (isAssertion(ref)) return ref;
    const found = resolveDataRef(document, ref);
    if (!isCommitReading(found)) return absent(commit.name, ref, document, "committed offset");
    return judge(
      commit.name,
      ref.spelling,
      `where ${quote(ref.spelling)} is committed to`,
      renderCommitted(found),
      raw,
      compareText,
    );
  },
};

/**
 * The newest request the *application* made for one API.
 *
 * The compared value is the result word, and the subject line quotes {@link renderRequest}, which
 * prints the door, the correlation id and the world's own reason. A criterion about a record the
 * broker *refused* is a criterion about the reason, so the reason has to be in the sentence the
 * reader gets.
 */
const call: Validator = {
  name: DATA_VALIDATOR_NAMES.call,
  needsTarget: true,
  targetNoun: "API name as the register spells it (`Produce`, `CreateTopics`)",
  comparisons: ["equals"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, call.name, target);
    if (isAssertion(document)) return document;
    if (target === null) {
      return noTarget(call.name, "an API name as the register spells it (`Produce`, `CreateTopics`)");
    }
    const request = requestBy(call.name, target, document, "application", [
      DATA_VALIDATOR_NAMES.probe,
      "the criterion's own commands",
    ]);
    if (isAssertion(request)) return request;
    return judge(
      call.name,
      target,
      `the newest request the application made for ${quote(target)} (${renderRequest(request)})`,
      request.result,
      raw,
      compareRequestResult,
    );
  },
};

/**
 * The newest request the *criterion* made for one API or command word.
 *
 * The mirror of `data.call`, and separate from it on purpose: a criterion may act in this world
 * through a `run` step, and a contract that could be satisfied by the criterion's own command would
 * be a criterion earning its own pass.
 */
const probe: Validator = {
  name: DATA_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "API name as the register spells it, or the command word the world refused",
  comparisons: ["equals"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, probe.name, target);
    if (isAssertion(document)) return document;
    if (target === null) {
      return noTarget(
        probe.name,
        "an API name as the register spells it, or the whole `api` spelling of a command the world refused",
      );
    }
    const request = requestBy(probe.name, target, document, "criterion", [
      DATA_VALIDATOR_NAMES.call,
      "the application's requests",
    ]);
    if (isAssertion(request)) return request;
    return judge(
      probe.name,
      target,
      `the newest request the criterion made for ${quote(target)} (${renderRequest(request)})`,
      request.result,
      raw,
      compareRequestResult,
    );
  },
};

/**
 * One counter the world keeps.
 *
 * Unusable - never zero - for a key outside {@link DATA_METER_KEYS}, because zero is a count of
 * something that did not happen and an unknown key is not a count at all. The five counters are the
 * whole of what this world measures: how many requests crossed the transport, the bytes in and out of
 * its sockets, and the records that went into and came out of the log. There is deliberately no rate
 * and no latency, because this world has no clock.
 */
const meter: Validator = {
  name: DATA_VALIDATOR_NAMES.meter,
  needsTarget: true,
  targetNoun: `meter name (${DATA_METER_KEYS.map((name) => `\`${name}\``).join(", ")})`,
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: DATA_OBSERVATION_KIND,
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, meter.name, target);
    if (isAssertion(document)) return document;
    if (target === null) {
      return noTarget(
        meter.name,
        `a meter name (${DATA_METER_KEYS.map((name) => quote(name)).join(", ")})`,
      );
    }
    const counted: number | null = dataMeterValue(document.meter, target);
    if (counted === null) {
      return unusable(
        meter.name,
        target,
        `${quote(target)} is not a meter this world keeps; it records ` +
          `${DATA_METER_KEYS.map((name) => quote(name)).join(", ")}, and every one of them is a ` +
          "non-negative count of something the world actually did.",
      );
    }
    return judge(
      meter.name,
      target,
      `the broker's ${quote(target)} meter (${renderMeter(document.meter)})`,
      counted,
      raw,
      compareCounts,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const DATA_VALIDATORS: readonly Validator[] = Object.freeze([
  node,
  topic,
  layout,
  partition,
  record,
  key,
  value,
  group,
  member,
  commit,
  call,
  probe,
  meter,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function dataValidators(): Validator[] {
  return [...DATA_VALIDATORS];
}
