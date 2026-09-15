/**
 * The `cloud.*` validator family - the vocabulary an acceptance criterion uses to judge a provider
 * account.
 *
 * ## What a validator is allowed to know
 *
 * A validator is a pure function from an expectation and one observation to one status. It never opens
 * a socket, never calls the provider, and never reaches for the substitute: it reads one
 * `CloudObservationData`, which an adapter produced, and answers a question about it. That is why this
 * module imports `core/` only - `adapters/*` is absent by rule, and the rule is the reason a verdict
 * cannot depend on what stood in for the provider. A validator that could see the substitute could
 * report on the substitute.
 *
 * Every target is read through the family's own resolvers in `core/environment/cloud-observation.ts`,
 * and a refusal is *quoted* rather than summarized. The resolver is the thing that knows the cause; a
 * validator that wrote its own message would name whatever its author thought of, which is a defect
 * this repository has already paid for.
 *
 * ## The four readings, and the four shapes of question
 *
 * A provider account holds five kinds of thing - buckets, objects, queues, secrets and principals -
 * and the family asks four shapes of question about them:
 *
 *  1. **Is it there at all** - `cloud.bucket`, `cloud.object`, `cloud.queue`, `cloud.secret`. Presence
 *     is a question with its own repair ("create the bucket"), which is why it is one validator per
 *     kind rather than a flag on the reading validators: each declares its own `targetNoun`, so the
 *     clarification ladder asks "which bucket" rather than "which thing".
 *  2. **What does the world hold about it** - `cloud.setting` (the whole rendering) and `cloud.tag`
 *     (the tag lines of that rendering alone).
 *  3. **What was written on it about who may do what** - `cloud.policy` (the statements attached to a
 *     bucket or a principal) and `cloud.access` (the decision the world actually reached for one
 *     principal, one action and one resource, together with the entry that fired).
 *  4. **What happened, and what it cost** - `cloud.call` (the newest request the *application* made for
 *     an action), `cloud.probe` (the newest the *criterion* made - the same question from the other
 *     side), and `cloud.meter` (one of the four counters the account keeps).
 *
 * ## Status discipline
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about the world, and reached only after a
 *   reading was found: a bucket the account does not hold, a tag set that does not match, a policy that
 *   grants something it should not, a request that was refused, a meter over its ceiling.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at. An absent resource leaves every
 *   question *about* that resource unanswered rather than failed, because the only thing that is
 *   actually known is that the thing that should have answered does not exist - and that is
 *   `cloud.bucket`'s question, not this one's. Two other absences land here: no recorded request at all
 *   for an action, and no recorded decision for a triple.
 * - `ERROR` - the criterion is unusable (`unusable`), or the observation arrived unreadable. A target
 *   the family's grammar cannot spell is a document that cannot be written, never a failure of the
 *   application. **Never `TEST_FAILURE`** - a validator that reported the test as broken for an absent
 *   bucket would send an agent at its own contract.
 *
 * ## The guards this world needs beyond the other families
 *
 * - **A refusal is not a failure.** A request the world answered `refused` is a *decided* request: the
 *   application asked, the provider said no, and that is a fact about the world worth judging. It is
 *   not the same observation as `missing` (the world serves the route and holds no such resource),
 *   `unsupported` (no such route), `conflict`, `invalid` or `error`, and this family compares the
 *   result against the whole seven-word vocabulary rather than against `"ok"`, so a contract can mean
 *   what it says.
 * - **`null` is a gap and `false` is a reading, and the rendering spells them differently.**
 *   `publicAccessBlocked` is `boolean | null`: `null` means the world did not read it, and the
 *   renderings print `none` for that, so the line for an unread flag and the line for a genuinely
 *   unblocked bucket are different strings in the same document. A criterion that asked whether public
 *   access is blocked therefore cannot read the gap as "not blocked" - it is comparing text, and the
 *   text says `none`. `none` is also how a real absence is spelled (`deadLetterQueue`, an empty
 *   `entry`), which is a decision with a consequence rather than a gap; the two are the same word on
 *   purpose, because both mean "this document does not state a value here" and a reader who needs to
 *   tell them apart is reading the world's reason rather than the document's text.
 * - **A decision is read, never re-derived.** `cloud.access` judges the decision the world recorded and
 *   the entry that fired. A validator that recomputed `principalProblem`-style reasoning from the
 *   policy would be a second implementation of the provider's own authorization rule, and the first
 *   time the two disagreed it would report a verdict the world never reached. This is also why the
 *   family does not re-acquire the loader's privileged-principal guard: the loader refused such a plan
 *   before the run started, so a criterion naming `principal/root` here is asking about something the
 *   world does not hold, which `cloud.access` reports honestly.
 * - **A request is judged by who asked.** `application`, `criterion` and `world` are three sources and
 *   they answer three different questions. `cloud.call` reads the application's; `cloud.probe` reads
 *   the criterion's; a criterion's own request is not evidence about the application, and the message
 *   says so by naming the sibling validator rather than by silently accepting the wrong record.
 * - **An action name is checked against the routes this world serves.** `callsOf` answers `[]` for an
 *   action the world never heard of, which would be reported as "the application never made that
 *   request" - a sentence naming a cause the reporter did not observe. A target outside
 *   `CLOUD_ACTION_NAMES` is `ERROR` before any record is consulted.
 * - **The `durationMs` of a call is always `0`, deliberately, and is not judgeable.** A substitute
 *   that measured its own latency would be reporting the machine's schedule rather than the
 *   application's behaviour - the same defect as a test that waits a fixed number of turns.
 *
 * ## What this family deliberately does not judge
 *
 * - **A secret's value.** `CloudSecretVersion` carries `bytes` and `sha256` and never the value, and no
 *   rendering prints one. A contract may ask whether a secret rotates, whether it is encrypted, how
 *   many versions it has, and whether its digest matches a known placeholder - and it may not ask what
 *   the secret *is*, because the reading is built so that the answer cannot be given. That is a
 *   property of the world, not a limitation of this file.
 * - **A request's `path`, `method`, `status` and `reason`.** `cloud.call` and `cloud.probe` compare the
 *   *result*, which is the provider-neutral statement of what happened; the other four fields are
 *   written into the bundle for a reader and are not assertable, because a contract that pinned
 *   `path` would be a contract about one provider's URL grammar rather than about the application.
 * - **Whether a principal exists, as a `FAIL`.** The four presence validators are named for the four
 *   kinds that carry a reading of their own; a principal is held through the policies attached to it,
 *   so `cloud.policy` reads those and `cloud.setting` renders one the world does hold. A criterion that
 *   means to assert the application created a principal asks for its rendering (`contains:
 *   "name=svc-cart"`), and an absent principal then answers `INCONCLUSIVE` - which is not `PASS`, so the
 *   contract is still able to refuse a run, but it is a weaker sentence than a `FAIL` and it is
 *   recorded here rather than papered over with a twelfth name.
 * - **The world's own substitutions.** `CloudObservationData.simulated` names what stood in for a real
 *   provider. A criterion may not judge it: whether the world was simulated is a property of the
 *   environment that the *bundle* records, and a verdict that depended on it would be a verdict about
 *   the substitute.
 */

import {
  CLOUD_ACTION_NAMES,
  CLOUD_CALL_RESULTS,
  CLOUD_METER_KEYS,
  CLOUD_OBSERVATION_KIND,
  CLOUD_REF_KINDS,
  bucketNamed,
  cloudCallsOf,
  cloudRefSpelling,
  decisionFor,
  isCloudObservationData,
  meterValue,
  objectAt,
  principalNamed,
  queueNamed,
  renderDecision,
  renderPolicy,
  renderCloudRef,
  resolveCloudAccessRef,
  resolveCloudRef,
  secretNamed,
} from "../../core/environment/cloud-observation.ts";
import type {
  CloudAccessRef,
  CloudCallRecord,
  CloudCallSource,
  CloudObservationData,
  CloudRef,
} from "../../core/environment/cloud-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  brief,
  compareCounts,
  comparePresence,
  compareText,
  compareWord,
  judge,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";

export const CLOUD_VALIDATOR_NAMES = {
  bucket: "cloud.bucket",
  object: "cloud.object",
  tag: "cloud.tag",
  policy: "cloud.policy",
  access: "cloud.access",
  queue: "cloud.queue",
  secret: "cloud.secret",
  call: "cloud.call",
  setting: "cloud.setting",
  probe: "cloud.probe",
  meter: "cloud.meter",
} as const;

type RefKind = CloudRef["kind"];

// ---- the document, the target and the grammar ------------------------------------------------------

/**
 * Whether a helper returned a verdict rather than a reading.
 *
 * The test is **the engine's own status vocabulary** and not the presence of a `status` property, and
 * that difference is a defect this file had: `CloudCallRecord` carries an HTTP `status`, so the
 * structural spelling of this guard answered `true` for any call record - and `cloud.call` and
 * `cloud.probe` returned the record itself, whose `status` is `200` or `403`. A criterion would then be
 * reported with a status that is not one of the five the product has, which is a false `PASS` vector
 * rather than a cosmetic bug. A discriminant a data shape can satisfy by accident is not a
 * discriminant. `CRITERION_STATUSES` is imported so the vocabulary has one definition.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  (CRITERION_STATUSES as readonly unknown[]).includes((value as { status?: unknown }).status);

/**
 * The reading, or the `ERROR` that says the reading is not this family's.
 *
 * The adapter produced the observation, so a document of the wrong kind is a defect in the environment
 * and not an application the criterion failed against. The payload that arrived is carried as `actual`
 * rather than `null`, because a reader diagnosing an adapter needs to see what came instead.
 */
function readDocument(
  observation: Observation,
  validator: string,
  target: unknown,
): CloudObservationData | AssertionResult {
  if (isCloudObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    typeof target === "string" ? target : null,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a provider document, so ` +
      "there is nothing to read. The adapter produced the reading, so this is a defect in the " +
      "environment rather than an application the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * A reference, resolved through the family's own grammar, with its refusal quoted verbatim.
 *
 * Every kind is accepted here and the *validator* narrows, because the grammar's refusal and this
 * family's "that is a queue, not a bucket" are different sentences about different causes. Folding them
 * into one resolver would make the second one a case the first could not name.
 */
function refOf(validator: string, target: string | null, what: string): CloudRef | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const resolved = resolveCloudRef(target);
  if (resolved.kind === "refused") return unusable(validator, target, resolved.reason);
  return resolved.value;
}

function wrongKind(validator: string, ref: CloudRef, kinds: readonly RefKind[]): AssertionResult {
  return unusable(
    validator,
    cloudRefSpelling(ref),
    `This validator reads ${kinds.join(" or ")}, and ${quote(cloudRefSpelling(ref))} names a ` +
      `${ref.kind}. A reference is written as one of ${CLOUD_REF_KINDS.join(", ")}, followed by "/" ` +
      "and the name, and the kind is what decides which reading a criterion is asking about.",
  );
}

const presenceValidator = (kind: RefKind): string | null => {
  switch (kind) {
    case "bucket":
      return CLOUD_VALIDATOR_NAMES.bucket;
    case "object":
      return CLOUD_VALIDATOR_NAMES.object;
    case "queue":
      return CLOUD_VALIDATOR_NAMES.queue;
    case "secret":
      return CLOUD_VALIDATOR_NAMES.secret;
    case "principal":
      return null;
  }
};

/**
 * Why a question about a resource the reading does not hold is `INCONCLUSIVE`, and who owns the
 * question that *is* answerable.
 *
 * The two halves matter equally. "There is nothing to measure" is the honest reading of an absent
 * resource, and naming the validator that answers whether it should exist is what keeps the criterion
 * from being read as a statement about presence.
 */
function absenceMessage(ref: CloudRef, what: string): string {
  const spelling = cloudRefSpelling(ref);
  const owner = presenceValidator(ref.kind);
  const next =
    owner === null
      ? `Whether a principal exists is the one presence question this family has no validator for: a ` +
        `principal is held through the policies attached to it, so ${quote(CLOUD_VALIDATOR_NAMES.policy)} ` +
        "reads those, and this validator renders one the world does hold. A criterion that means to ask " +
        "whether the application created it is asking for that rendering, which an absent principal " +
        "does not produce."
      : `Whether it should exist is the question ${quote(owner)} answers.`;
  return `The reading holds no ${spelling}, so there is no ${what} to judge. ${next}`;
}

/**
 * The tag lines of a rendering.
 *
 * Read back out of the rendering rather than re-derived from the reading, so that a tag has exactly
 * one spelling in this world: `tag.<name>=<value>`, written by the same `tagLines` the rendering uses.
 * A second implementation here would be a second spelling, and the first time the two disagreed a
 * criterion would be judging a string the bundle does not contain.
 *
 * What this does **not** buy is an exactness the comparison cannot have. Only whole lines are taken,
 * so the resource's own fields are not in the string a tag criterion compares - and that is as far as
 * it goes: `contains` is still a substring test over the joined tag lines, where `env=prod` is
 * satisfied by a `tag.env=production`. A contract that means one tag exactly writes `matches` with both
 * ends anchored, and this is why the two are adjacent in this family's comparison list rather than one
 * standing in for the other.
 */
function tagLinesOf(rendering: string): string {
  return rendering
    .split("\n")
    .filter((line) => line.startsWith("tag."))
    .join("\n");
}

// ---- the action record, split by who asked ---------------------------------------------------------

const compareCallResult = compareWord(CLOUD_CALL_RESULTS, "the result of a request");

/**
 * The newest recorded request for `action` issued by `source`.
 *
 * Mirrors the system family's `execBy`, and for the same reason: an action record has a source, the
 * sources answer different questions, and the newest answer is the one that describes the world the
 * criterion is looking at.
 */
function callBy(
  validator: string,
  action: string,
  document: CloudObservationData,
  source: CloudCallSource,
  other: readonly [name: string, issuedBy: string],
): CloudCallRecord | AssertionResult {
  if (!(CLOUD_ACTION_NAMES as readonly string[]).includes(action)) {
    return unusable(
      validator,
      action,
      `${quote(action)} is not an action this world serves. An action is one of the routes the account ` +
        `answers, written provider-neutrally as "<service>.<verb>", and this world serves ` +
        `${brief(CLOUD_ACTION_NAMES)}. A naming mistake would otherwise be reported as a request the ` +
        "application never made, which is the shape of a real defect rather than the shape of a " +
        "contract that cannot be read.",
    );
  }
  const all = cloudCallsOf(document, action);
  if (all.length === 0) {
    return unanswered(
      validator,
      action,
      `The account recorded no request for ${quote(action)} at all, so there is nothing to judge. ` +
        "This is the absence of a record rather than a request that failed: a request the world " +
        "answered with a refusal is judged here, and so is one it could not serve or could not " +
        "resolve. What is missing is the request itself.",
    );
  }
  const mine = all.filter((record) => record.source === source);
  const newest = mine[mine.length - 1];
  if (newest === undefined) {
    const issued = [...new Set(all.map((record) => record.source))].join(", ");
    return unanswered(
      validator,
      action,
      `Every recorded request for ${quote(action)} was issued by ${issued}, and this validator reads ` +
        `only the requests issued by ${source}. Those are different questions with different ` +
        `validators - ${quote(other[0])} is the one that reads the requests issued by ${other[1]} - ` +
        "and a request this world made on its own behalf, or a criterion made about the application, " +
        "is not evidence about the application.",
    );
  }
  return newest;
}

// ---- 1. presence, one kind at a time ---------------------------------------------------------------

const bucket: Validator = {
  name: CLOUD_VALIDATOR_NAMES.bucket,
  needsTarget: true,
  targetNoun: "bucket reference (`bucket/cart-assets`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, bucket.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(bucket.name, targetOf(raw), "a bucket reference (`bucket/cart-assets`)");
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "bucket") return wrongKind(bucket.name, ref, ["bucket"]);
    const spelling = cloudRefSpelling(ref);
    const held = bucketNamed(document, ref.name) !== null;
    return judge(
      bucket.name,
      spelling,
      `a bucket named ${quote(ref.name)} in this account`,
      held,
      raw,
      comparePresence,
    );
  },
};

const object: Validator = {
  name: CLOUD_VALIDATOR_NAMES.object,
  needsTarget: true,
  targetNoun: "object reference (`object/cart-assets/index.html`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, object.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      object.name,
      targetOf(raw),
      "an object reference (`object/cart-assets/index.html`)",
    );
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "object") return wrongKind(object.name, ref, ["object"]);
    const spelling = cloudRefSpelling(ref);
    const held = objectAt(document, ref.bucket, ref.key) !== null;
    return judge(
      object.name,
      spelling,
      `an object at ${quote(`${ref.bucket}/${ref.key}`)}`,
      held,
      raw,
      comparePresence,
    );
  },
};

const queue: Validator = {
  name: CLOUD_VALIDATOR_NAMES.queue,
  needsTarget: true,
  targetNoun: "queue reference (`queue/cart-events`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, queue.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(queue.name, targetOf(raw), "a queue reference (`queue/cart-events`)");
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "queue") return wrongKind(queue.name, ref, ["queue"]);
    const spelling = cloudRefSpelling(ref);
    const held = queueNamed(document, ref.name) !== null;
    return judge(
      queue.name,
      spelling,
      `a queue named ${quote(ref.name)} in this account`,
      held,
      raw,
      comparePresence,
    );
  },
};

const secret: Validator = {
  name: CLOUD_VALIDATOR_NAMES.secret,
  needsTarget: true,
  targetNoun: "secret reference (`secret/cart-api-key`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, secret.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(secret.name, targetOf(raw), "a secret reference (`secret/cart-api-key`)");
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "secret") return wrongKind(secret.name, ref, ["secret"]);
    const spelling = cloudRefSpelling(ref);
    const held = secretNamed(document, ref.name) !== null;
    // Presence only. What the secret *is* is not in the reading at all - see this file's header - and
    // everything the world does record about it is a field of `cloud.setting`'s rendering.
    return judge(
      secret.name,
      spelling,
      `a secret named ${quote(ref.name)} in this account`,
      held,
      raw,
      comparePresence,
    );
  },
};

// ---- 2. what the world holds about it --------------------------------------------------------------

const setting: Validator = {
  name: CLOUD_VALIDATOR_NAMES.setting,
  needsTarget: true,
  targetNoun: "reference to something this account holds (`bucket/cart-assets`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, setting.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      setting.name,
      targetOf(raw),
      "a reference to something this account holds (`bucket/cart-assets`)",
    );
    if (isAssertion(ref)) return ref;
    const rendering = renderCloudRef(document, ref);
    const spelling = cloudRefSpelling(ref);
    if (rendering === null) {
      return unanswered(setting.name, spelling, absenceMessage(ref, "reading"));
    }
    return judge(
      setting.name,
      spelling,
      `the reading of ${quote(spelling)}`,
      rendering,
      raw,
      compareText,
    );
  },
};

const tag: Validator = {
  name: CLOUD_VALIDATOR_NAMES.tag,
  needsTarget: true,
  targetNoun: "reference to something this account holds (`bucket/cart-assets`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, tag.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      tag.name,
      targetOf(raw),
      "a reference to something this account holds (`bucket/cart-assets`)",
    );
    if (isAssertion(ref)) return ref;
    const rendering = renderCloudRef(document, ref);
    const spelling = cloudRefSpelling(ref);
    if (rendering === null) {
      return unanswered(tag.name, spelling, absenceMessage(ref, "tag set"));
    }
    // Restricted to the tag lines, which is what makes `equals` and `matches` here a statement about
    // the tag set alone. `cloud.setting` renders the same tags beside the resource's own fields, so a
    // `contains` may be written against either; a criterion names the one whose failure it wants to
    // read.
    const tags = tagLinesOf(rendering);
    return judge(tag.name, spelling, `the tags on ${quote(spelling)}`, tags, raw, compareText);
  },
};

// ---- 3. who may do what, and what the world decided ------------------------------------------------

const policy: Validator = {
  name: CLOUD_VALIDATOR_NAMES.policy,
  needsTarget: true,
  targetNoun: "reference to a bucket or a principal (`bucket/cart-assets`, `principal/svc-cart`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, policy.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      policy.name,
      targetOf(raw),
      "a reference to a bucket or a principal (`bucket/cart-assets`, `principal/svc-cart`)",
    );
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "bucket" && ref.kind !== "principal") {
      return wrongKind(policy.name, ref, ["bucket", "principal"]);
    }
    const statements =
      ref.kind === "bucket"
        ? (bucketNamed(document, ref.name)?.policy ?? null)
        : (principalNamed(document, ref.name)?.statements ?? null);
    const spelling = cloudRefSpelling(ref);
    if (statements === null) {
      return unanswered(policy.name, spelling, absenceMessage(ref, "policy"));
    }
    // A resource that exists with nothing attached renders as the empty string, which is a different
    // fact from a resource that does not exist. `equals: ""` is how a contract states "nothing is
    // attached"; this branch is that one, and the branch above is the other.
    return judge(
      policy.name,
      spelling,
      `the policy attached to ${quote(spelling)}`,
      renderPolicy(statements),
      raw,
      compareText,
    );
  },
};

const access: Validator = {
  name: CLOUD_VALIDATOR_NAMES.access,
  needsTarget: true,
  targetNoun:
    "access reference (`principal/svc-cart:s3.getObject:object/cart-assets/index.html`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, access.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        access.name,
        "an access reference (`principal/svc-cart:s3.getObject:object/cart-assets/index.html`)",
      );
    }
    const resolved = resolveCloudAccessRef(target);
    if (resolved.kind === "refused") return unusable(access.name, target, resolved.reason);
    const ref: CloudAccessRef = resolved.value;
    const resource = cloudRefSpelling(ref.resource);
    const spelling = `${ref.principal}:${ref.action}:${resource}`;
    // The decision the world recorded, and the entry that fired. Never re-derived from the policies:
    // a second implementation of the provider's own authorization rule would be a verdict the world
    // never reached, and the first time the two disagreed this validator would be reporting it.
    const decision = decisionFor(document, ref.principal, ref.action, resource);
    if (decision === null) {
      return unanswered(
        access.name,
        spelling,
        `The world recorded no decision for ${quote(spelling)}, so there is nothing to judge. A ` +
          `decision is recorded when something asks the account that question: ${quote(CLOUD_VALIDATOR_NAMES.call)} ` +
          `reads what the application asked, and ${quote(CLOUD_VALIDATOR_NAMES.probe)} reads what the ` +
          "criterion asked itself. Neither question was put to this world.",
      );
    }
    return judge(
      access.name,
      spelling,
      `the decision on ${quote(spelling)}`,
      renderDecision(decision),
      raw,
      compareText,
    );
  },
};

// ---- 4. what happened, and what it cost ------------------------------------------------------------

const call: Validator = {
  name: CLOUD_VALIDATOR_NAMES.call,
  needsTarget: true,
  targetNoun: "action name, as this world serves it (`s3.putObject`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, call.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const action = targetOf(raw);
    if (action === null) {
      return noTarget(call.name, "an action name, as this world serves it (`s3.putObject`)");
    }
    const record = callBy(call.name, action, document, "application", [
      CLOUD_VALIDATOR_NAMES.probe,
      "the criterion",
    ]);
    if (isAssertion(record)) return record;
    return judge(
      call.name,
      action,
      `the result of the newest request the application made for ${quote(action)}`,
      record.result,
      raw,
      compareCallResult,
    );
  },
};

const probe: Validator = {
  name: CLOUD_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "action name, as this world serves it (`s3.putObject`)",
  comparisons: ["equals"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const action = targetOf(raw);
    if (action === null) {
      return noTarget(probe.name, "an action name, as this world serves it (`s3.putObject`)");
    }
    const record = callBy(probe.name, action, document, "criterion", [
      CLOUD_VALIDATOR_NAMES.call,
      "the application",
    ]);
    if (isAssertion(record)) return record;
    return judge(
      probe.name,
      action,
      `the result of the newest request the criterion made for ${quote(action)}`,
      record.result,
      raw,
      compareCallResult,
    );
  },
};

const meter: Validator = {
  name: CLOUD_VALIDATOR_NAMES.meter,
  needsTarget: true,
  targetNoun: "meter name (`requests`, `objects`, `bytes`, `costUnits`)",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: CLOUD_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, meter.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const key = targetOf(raw);
    if (key === null) {
      return noTarget(
        meter.name,
        `a meter name (${CLOUD_METER_KEYS.map((name) => quote(name)).join(", ")})`,
      );
    }
    const value = meterValue(document, key);
    if (value === null) {
      // `meterValue` answers `null` for exactly one cause: a key this world does not keep. Reported as
      // unusable rather than as zero, because a criterion naming a counter nothing computes would
      // otherwise be judged against a number the world never measured.
      return unusable(
        meter.name,
        key,
        `${quote(key)} is not a meter this account keeps; it records ` +
          `${CLOUD_METER_KEYS.map((name) => quote(name)).join(", ")}, and every one of them is a ` +
          "non-negative count of something the world actually did.",
      );
    }
    return judge(meter.name, key, `the account's ${quote(key)} meter`, value, raw, compareCounts);
  },
};

// ---- the roster ------------------------------------------------------------------------------------

export const CLOUD_VALIDATORS: readonly Validator[] = Object.freeze([
  bucket,
  object,
  tag,
  policy,
  access,
  queue,
  secret,
  call,
  setting,
  probe,
  meter,
]);

export function cloudValidators(): Validator[] {
  return [...CLOUD_VALIDATORS];
}
