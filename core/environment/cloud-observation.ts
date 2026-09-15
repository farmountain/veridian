/**
 * The reading a cloud world produces, and the vocabulary that keeps it honest.
 *
 * This file is the whole of what `validators/cloud/*` is allowed to know. It holds no class, opens no
 * socket and reads no file: it is the *shape of an observation*, and it lives in `core/environment/`
 * because `validators/*` may not import `adapters/*`. The same rule produced `web-observation.ts`,
 * `db-observation.ts`, `k8s-observation.ts`, `posix-observation.ts` and `os-observation.ts` - and the
 * fact that a sixth world needed no change to `core/validation` is the same claim Phase C made, made
 * again for a world whose subject is neither a machine nor a cluster but a *service account*.
 *
 * The names are `cloud.*` and not `sim-cloud.*`, for the reason the other five families give: a
 * criterion is about the provider, not about which implementation answered. The substitution *is*
 * recorded, in this document, because a verdict reached against a substitute has to say so where the
 * verdict is rather than in the name of the thing being judged.
 *
 * ## What "simulated" means here, and what it deliberately does not cover
 *
 * A simulated world is not a stub. Three conditions have to hold, and each of them is a thing this
 * file can be read against:
 *
 * 1. **The application executes for real.** The provisioning program is an ordinary child process,
 *    started by `ProcessRunner`, whose exit code, stdout and stderr are the child's own. It uses no
 *    SDK: it speaks HTTP to the address the world injects.
 * 2. **The interfaces are real.** The transport is a real TCP socket, the routes are a real HTTP
 *    surface, the bodies are the caller's own bytes, and a malformed request gets a real `422`. The
 *    digest recorded for an object is computed from the bytes that really arrived.
 * 3. **The substitution is declared.** {@link CLOUD_SIMULATED_SURFACES} names every service a real
 *    provider would supply that this world does not, and the reading carries the list, so a `PASS`
 *    reached here is traceable to a named substitute rather than to unexamined reality.
 *
 * What is *not* simulated is the part that makes a verdict worth having: the application's execution,
 * the observation of it, the evidence recorded, the criterion's authority to pass or fail, the reset,
 * and the fact that the reset happened.
 *
 * ## The two records, and why they are separate
 *
 * Every reading keeps the **action record** apart from the **state record**:
 *
 * - {@link CloudCallRecord} is what was asked of the provider - the method, the route, who issued it,
 *   what came back, and which of the world's actions the route answered.
 * - {@link CloudBucketReading}, {@link CloudObjectReading}, {@link CloudQueueReading},
 *   {@link CloudSecretReading} and {@link CloudPrincipalReading} are what the account now holds.
 *
 * Collapsing the first into the second is the common shortcut and it is a false pass with a longer
 * name: "the bucket is versioned" is a claim about a *bucket*, and "the provisioner never asked for
 * versioning" is a claim about an *attempt*. A contract that only ever checked state could pass on a
 * run whose provisioner never ran at all, because an empty account and a correctly provisioned empty
 * account look exactly alike. `cloud.call` reads the first record; `cloud.setting` reads the second.
 *
 * ## The honest edge: policy evaluation and placeholder detection
 *
 * Two of this world's facts are conclusions the substitute reaches itself rather than facts it
 * observed, and both are on the simulated list rather than hidden in a comment:
 *
 * - **Access decisions.** There is no IAM engine here. {@link CloudDecisionReading} records the
 *   decision *this world* reached and the statement that fired it, and `cloud.access` judges that
 *   record. It never re-derives a decision from the policy, because a criterion that re-evaluated the
 *   policy would be judging its own arithmetic and calling the answer the provider's - the same
 *   mistake `os.access` exists to refuse, one family out. A real provider's evaluation order
 *   (identity policy, resource policy, boundaries, session policy) is not reproduced, and a contract
 *   about *which* of those granted access cannot be written here.
 * - **Weak secret values.** {@link CLOUD_PLACEHOLDER_VALUES} is a closed list of well-known
 *   placeholder values, and `matchesKnownPlaceholder` is this world comparing against it. A value
 *   that is weak in some other way - short, repeated, derived from the account name - is not
 *   detected, and a criterion may not claim otherwise. The list is a vocabulary, not an entropy
 *   measurement, and saying which one it is, is the whole of the honesty here.
 *
 * ## Why the value of a secret is never in the reading
 *
 * `putSecretValue` really receives the value, stores it, and serves it back to a `GET` - and the
 * reading records its length and digest and never the bytes. That is not squeamishness: an evidence
 * bundle is written to disk, committed by operators, attached to CI runs, and read by whatever model
 * is repairing the code. A world that recorded the secret would make every bundle it produced a
 * disclosure, and the fact a criterion actually needs ("this is not the placeholder", "this is at
 * least 16 bytes") is expressible without it.
 */

/** The observation kind. A validator refuses any other, so a cluster cannot be judged as a provider. */
export const CLOUD_OBSERVATION_KIND = "cloud.provider";

/**
 * Every surface a real provider would supply that this world does not.
 *
 * Membership is a claim about *this world*, not a disclaimer: each entry names something the code can
 * be inspected against, and each one is a reason a reading from here must carry the list rather than
 * being indistinguishable from a reading taken against a real account.
 *
 * The HTTP transport, the application process and the digest of a stored byte are deliberately
 * **not** on the list, because they are real. A list that named everything would be as uninformative
 * as one that named nothing.
 */
export const CLOUD_SIMULATED_SURFACES = [
  /** There are no regions: the name is recorded and nothing is placed anywhere. */
  "regions",
  /** There is no durable object store; objects live in this process's memory and in a snapshot file. */
  "object-store",
  /** There is no broker and no consumer group; a queue is a list with a visibility counter. */
  "queue",
  /** There is no key management service; encryption is a label the world records on the object. */
  "key-management",
  /** There are no secret rotation workers; rotation is a flag and nothing rotates it. */
  "secret-rotation",
  /** There is no IAM engine; decisions are reached by this world's own evaluator - see the header. */
  "identity",
  /** There is no billing system; money is a number this world computes from its own price table. */
  "metering",
] as const;

export type CloudSimulatedSurface = (typeof CLOUD_SIMULATED_SURFACES)[number];

/**
 * How the world answered one request.
 *
 * Seven results, and the seven are different repairs - which is the whole reason this is a vocabulary
 * rather than a boolean. `ok` is the pass. `refused` is a policy saying no (the caller was identified
 * and not permitted). `missing` is a resource that is not there. `unsupported` is a route this world
 * does not serve, which is a different observation from a missing resource and a different repair
 * again - a substitute that merged the last two makes the verdict unearned, and this repository has
 * already paid for that once, in the cluster substitute that answered `405` for an absent configmap.
 * `conflict` is a resource that already exists in a state that forbids the request. `invalid` is a
 * body this world could not read. `error` is this world failing, which is a defect in the environment
 * and never a finding about the application.
 */
export const CLOUD_CALL_RESULTS = [
  "ok",
  "refused",
  "missing",
  "unsupported",
  "conflict",
  "invalid",
  "error",
] as const;
export type CloudCallResult = (typeof CLOUD_CALL_RESULTS)[number];

/** Who issued a request. A criterion's own probe is not evidence about the application. */
export const CLOUD_CALL_SOURCES = ["application", "criterion", "world"] as const;
export type CloudCallSource = (typeof CLOUD_CALL_SOURCES)[number];

/** Whether an object's bytes are versioned. `never` is a bucket that has not been asked, not a `false`. */
export const CLOUD_VERSIONING_STATES = ["enabled", "suspended", "never"] as const;
export type CloudVersioningState = (typeof CLOUD_VERSIONING_STATES)[number];

/**
 * The encryption label recorded on a bucket or an object.
 *
 * `none` is a decision the world made and recorded; it is not the absence of a reading. The
 * distinction is the same one `os-observation.ts` draws between `"none"` and `null` for registry
 * values: one is an answer and the other is a gap, and a validator that conflated them would report a
 * gap as an application defect.
 */
export const CLOUD_ENCRYPTION_ALGORITHMS = ["AES256", "aws:kms", "none"] as const;
export type CloudEncryptionAlgorithm = (typeof CLOUD_ENCRYPTION_ALGORITHMS)[number];

/** What a policy statement says. `deny` beats any `allow`, which is the evaluator's only subtlety. */
export const CLOUD_POLICY_EFFECTS = ["allow", "deny"] as const;
export type CloudPolicyEffect = (typeof CLOUD_POLICY_EFFECTS)[number];

/**
 * The meters this world keeps.
 *
 * The keys are the vocabulary `cloud.meter` judges against, so a criterion asking for `spend` is
 * reported as a contract that cannot be read rather than as a comparison that is always false - which
 * is the dangerous shape, because it is indistinguishable from an application defect.
 */
export const CLOUD_METER_KEYS = ["requests", "objects", "bytes", "costUnits"] as const;
export type CloudMeterKey = (typeof CLOUD_METER_KEYS)[number];

/**
 * Values this world treats as a placeholder, folded to lower case.
 *
 * A closed vocabulary, and the honesty is in saying so (see the header). It is deliberately short and
 * deliberately boring: these are the strings an example or a scaffold ships with, and a provisioning
 * program that wrote one of them has written a secret that is not one.
 */
export const CLOUD_PLACEHOLDER_VALUES = [
  "changeme",
  "change-me",
  "password",
  "secret",
  "todo",
  "placeholder",
  "replace-me",
  "example",
  "admin",
] as const;

/**
 * Every action this world serves, named once.
 *
 * A closed vocabulary for the same reason {@link CLOUD_METER_KEYS} is one: `cloud.call` and
 * `cloud.probe` take an action as their target, and a criterion naming a spelling this world does not
 * serve would be reported as an application that never made the request - which is indistinguishable
 * from a real defect, and is therefore the dangerous shape rather than the safe one. A validator that
 * can quote this list can report the contract as unreadable instead.
 *
 * The spelling is `<service>.<verb>`. The separator is a dot and never a colon, and that is not
 * cosmetic: {@link resolveCloudAccessRef} separates its three parts on `:`, so an action carrying one
 * could not be written in an access reference at all - a criterion that cannot be written is the same
 * defect as a criterion that cannot be satisfied.
 *
 * These are *request* names. A policy statement's `action` may be a member, a service with a trailing
 * `.*` (`s3.*`), or `*`; a request's action is always exactly one member.
 */
export const CLOUD_ACTIONS = Object.freeze({
  // the world itself
  describe: "provider.describe",
  // identity and authorisation
  callerIdentity: "sts.getCallerIdentity",
  authorize: "iam.authorize",
  createPrincipal: "iam.createPrincipal",
  getPrincipal: "iam.getPrincipal",
  deletePrincipal: "iam.deletePrincipal",
  putPrincipalPolicy: "iam.putPrincipalPolicy",
  deletePrincipalPolicy: "iam.deletePrincipalPolicy",
  // object storage
  createBucket: "s3.createBucket",
  headBucket: "s3.headBucket",
  listObjects: "s3.listObjects",
  deleteBucket: "s3.deleteBucket",
  putBucketVersioning: "s3.putBucketVersioning",
  getBucketVersioning: "s3.getBucketVersioning",
  putBucketEncryption: "s3.putBucketEncryption",
  getBucketEncryption: "s3.getBucketEncryption",
  putPublicAccessBlock: "s3.putPublicAccessBlock",
  getPublicAccessBlock: "s3.getPublicAccessBlock",
  putBucketPolicy: "s3.putBucketPolicy",
  getBucketPolicy: "s3.getBucketPolicy",
  putBucketTagging: "s3.putBucketTagging",
  getBucketTagging: "s3.getBucketTagging",
  putObject: "s3.putObject",
  getObject: "s3.getObject",
  headObject: "s3.headObject",
  deleteObject: "s3.deleteObject",
  putObjectTagging: "s3.putObjectTagging",
  getObjectTagging: "s3.getObjectTagging",
  // queues
  createQueue: "sqs.createQueue",
  getQueueAttributes: "sqs.getQueueAttributes",
  deleteQueue: "sqs.deleteQueue",
  sendMessage: "sqs.sendMessage",
  receiveMessage: "sqs.receiveMessage",
  deleteMessage: "sqs.deleteMessage",
  // secrets
  listSecrets: "secretsmanager.listSecrets",
  createSecret: "secretsmanager.createSecret",
  describeSecret: "secretsmanager.describeSecret",
  putSecretValue: "secretsmanager.putSecretValue",
  getSecretValue: "secretsmanager.getSecretValue",
  putSecretEncryption: "secretsmanager.putSecretEncryption",
  putSecretRotation: "secretsmanager.putSecretRotation",
  deleteSecret: "secretsmanager.deleteSecret",
  // metering
  metering: "ce.getMetering",
} as const);

export type CloudAction = (typeof CLOUD_ACTIONS)[keyof typeof CLOUD_ACTIONS];

/** The actions as a list, for a validator that has to say whether a contract can be read at all. */
export const CLOUD_ACTION_NAMES: readonly CloudAction[] = Object.values(CLOUD_ACTIONS);

/**
 * One statement of a policy document, anywhere this world holds one.
 *
 * A structural statement rather than a document: this world does not implement a policy language, and
 * pretending otherwise would invite a criterion to be written against a grammar that is not there.
 * The three fields are the three that decide a request, and `resource` is written in this family's own
 * reference spelling (`object/cart-assets/*`), so the same string resolves the same way in a policy
 * and in a criterion's target.
 */
export interface CloudPolicyStatement {
  readonly effect: CloudPolicyEffect;
  /** A principal name, or `*` for every principal this world holds. */
  readonly principal: string;
  /**
   * An action name (`s3.putObject`), a service with a trailing `.*` (`s3.*`), or `*`.
   *
   * Never a pattern with a wildcard inside a word, and never a `:` - see {@link CLOUD_ACTIONS} for
   * why the separator is a dot.
   */
  readonly action: string;
  /** A resource reference, a reference with a trailing `/*`, or `*`. */
  readonly resource: string;
}

/**
 * One request, as the world answered it.
 *
 * `action` is the provider-neutral name the *route* stands for, and it is what a criterion targets -
 * not the method and not the path. A contract asking whether the application put an object should not
 * break when a route is spelled differently, and a contract that targeted a path would be a claim
 * about this substitute's URL layout rather than about the application's behaviour.
 *
 * `resource` is the reference the request named, in this family's spelling, or `null` for a route that
 * names no resource (a version probe, a metering read). `null` is a gap and is different from the
 * string `"none"`, which this world never records.
 */
export interface CloudCallRecord {
  readonly source: CloudCallSource;
  /** The provider-neutral action the route stands for. What a criterion targets. */
  readonly action: string;
  readonly method: string;
  /** The route as it was received, without the query string. Recorded so a reader can check the map. */
  readonly path: string;
  readonly principal: string;
  /** The reference the request named, or `null` when it named none. */
  readonly resource: string | null;
  readonly result: CloudCallResult;
  /** `null` when nothing was served, because a refusal the world never answered has no status. */
  readonly status: number | null;
  /** Why the world refused, when it did. `null` otherwise. */
  readonly reason: string | null;
  /**
   * How long the world took to answer, in milliseconds.
   *
   * Always `0`, and that is a property rather than a gap in the record: this world answers from memory
   * and performs no I/O, so there is no elapsed time to report - and a real reading would make two
   * observations of one unchanged world differ, which is exactly the determinism every sorted
   * rendering here exists to preserve. A metric that compares two runs of the same code would then
   * report a difference the application did not cause.
   */
  readonly durationMs: number;
}

interface CloudTagged {
  /** Tags, recorded exactly as they arrived. A tag key is the caller's spelling and is not folded. */
  readonly tags: Readonly<Record<string, string>>;
}

export interface CloudBucketReading extends CloudTagged {
  readonly name: string;
  readonly region: string;
  readonly versioning: CloudVersioningState;
  /** The bucket's *default* encryption. `none` when it declares none. */
  readonly encryption: CloudEncryptionAlgorithm;
  /**
   * Whether public access is blocked.
   *
   * `null` is a gap: the bucket was created and nothing was ever said about public access, which is
   * exactly the state a hardening contract is looking for, and is *not* the same fact as `false` -
   * a caller that asked for public access and got it has made a decision, and both facts repair
   * differently.
   */
  readonly publicAccessBlocked: boolean | null;
  readonly policy: readonly CloudPolicyStatement[];
  readonly objects: number;
}

/**
 * One object, as the world holds it.
 *
 * `encryption` is the *effective* label: what the request asked for, or the bucket's default when the
 * request asked for nothing. That is the field the common hardening defect turns on, and recording
 * the requested label instead would report a bucket whose default encryption was turned on as having
 * stored plaintext - a false failure, which is the mirror image of the false pass this product
 * refuses.
 */
export interface CloudObjectReading extends CloudTagged {
  readonly bucket: string;
  readonly key: string;
  readonly bytes: number;
  /** The digest of the bytes that really arrived. This is the world's evidence, not a claim. */
  readonly sha256: string;
  readonly contentType: string;
  readonly encryption: CloudEncryptionAlgorithm;
  /** The newest version identifier. `v1` for the first write, counted per key. */
  readonly versionId: string;
  /** How many versions this key holds. `1` for a key that has never been overwritten. */
  readonly versions: number;
}

export interface CloudQueueReading extends CloudTagged {
  readonly name: string;
  /** Messages waiting to be received. */
  readonly messages: number;
  /** Messages received and not yet deleted, which is the state a redelivery comes from. */
  readonly inFlight: number;
  /**
   * The dead-letter queue this one sends to, or `null`.
   *
   * `null` means no dead-letter queue was configured, which is a decision with a consequence - a
   * message that cannot be processed is redelivered forever - and is not a missing reading.
   */
  readonly deadLetterQueue: string | null;
  readonly encryption: CloudEncryptionAlgorithm;
  readonly visibilityTimeoutSeconds: number;
  /** Provider attributes, recorded as they were set. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** One version of one secret. The value is never here; the length and digest are. */
export interface CloudSecretVersion {
  readonly version: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CloudSecretReading extends CloudTagged {
  readonly name: string;
  /** The newest version. Empty means the secret exists and holds no value, which is a real state. */
  readonly currentVersion: string;
  readonly versions: readonly CloudSecretVersion[];
  readonly rotationEnabled: boolean;
  readonly encrypted: boolean;
  /** Whether the newest value is one of {@link CLOUD_PLACEHOLDER_VALUES}. The header says why. */
  readonly matchesKnownPlaceholder: boolean;
}

export interface CloudPrincipalReading extends CloudTagged {
  readonly name: string;
  /** The policies attached to this principal, by name. */
  readonly attachedPolicies: readonly string[];
  /** The statements those policies hold, flattened, in the order they were attached. */
  readonly statements: readonly CloudPolicyStatement[];
}

/**
 * One access decision this world reached.
 *
 * `entry` is the statement that decided it, rendered in the policy rendering's own spelling, or
 * `"none"` when no statement matched and the world's default decided instead. The distinction is the
 * one `os-acl` draws between an explicit entry and an inherited one: a decision nobody wrote down
 * repairs differently from a decision somebody wrote down wrongly, and a criterion that could not
 * tell them apart would send an agent to the wrong file.
 */
export interface CloudDecisionReading {
  readonly principal: string;
  readonly action: string;
  /** The resource asked about, in this family's reference spelling. */
  readonly resource: string;
  readonly allowed: boolean;
  readonly entry: string;
  /** The account the decision was reached in. Recorded because an access grant is account-scoped. */
  readonly account: string;
}

export interface CloudMeterReading {
  readonly requests: number;
  readonly objects: number;
  readonly bytes: number;
  /** Units this world computes from its own price table, whose formula is in {@link costModel}. */
  readonly costUnits: number;
}

export interface CloudObservationData {
  /** The address the substitute API is really bound to. A reader's first question is *which* one. */
  readonly api: string;
  /** The provider identity the environment document declared. */
  readonly provider: string;
  readonly region: string;
  readonly account: string;
  /** The identity the application authenticated as. */
  readonly principal: string;
  /** The substituted services, from the closed vocabulary above. */
  readonly simulated: readonly CloudSimulatedSurface[];
  /** The formula behind `meters.costUnits`, so the number is auditable rather than asserted. */
  readonly costModel: string;
  readonly calls: readonly CloudCallRecord[];
  readonly buckets: readonly CloudBucketReading[];
  readonly objects: readonly CloudObjectReading[];
  readonly queues: readonly CloudQueueReading[];
  readonly secrets: readonly CloudSecretReading[];
  readonly principals: readonly CloudPrincipalReading[];
  readonly decisions: readonly CloudDecisionReading[];
  readonly meters: CloudMeterReading;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isStatement = (value: unknown): value is CloudPolicyStatement =>
  isRecord(value) &&
  typeof value["effect"] === "string" &&
  typeof value["principal"] === "string" &&
  typeof value["action"] === "string" &&
  typeof value["resource"] === "string";

const isCall = (value: unknown): value is CloudCallRecord =>
  isRecord(value) &&
  typeof value["source"] === "string" &&
  typeof value["action"] === "string" &&
  typeof value["method"] === "string" &&
  typeof value["path"] === "string" &&
  typeof value["principal"] === "string" &&
  isNullableString(value["resource"]) &&
  typeof value["result"] === "string" &&
  (value["status"] === null || typeof value["status"] === "number") &&
  isNullableString(value["reason"]) &&
  typeof value["durationMs"] === "number";

const isBucket = (value: unknown): value is CloudBucketReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["region"] === "string" &&
  typeof value["versioning"] === "string" &&
  typeof value["encryption"] === "string" &&
  (value["publicAccessBlocked"] === null || typeof value["publicAccessBlocked"] === "boolean") &&
  Array.isArray(value["policy"]) &&
  value["policy"].every(isStatement) &&
  typeof value["objects"] === "number" &&
  isStringMap(value["tags"]);

const isObject = (value: unknown): value is CloudObjectReading =>
  isRecord(value) &&
  typeof value["bucket"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["sha256"] === "string" &&
  typeof value["contentType"] === "string" &&
  typeof value["encryption"] === "string" &&
  typeof value["versionId"] === "string" &&
  typeof value["versions"] === "number" &&
  isStringMap(value["tags"]);

const isQueue = (value: unknown): value is CloudQueueReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["messages"] === "number" &&
  typeof value["inFlight"] === "number" &&
  isNullableString(value["deadLetterQueue"]) &&
  typeof value["encryption"] === "string" &&
  typeof value["visibilityTimeoutSeconds"] === "number" &&
  isStringMap(value["attributes"]) &&
  isStringMap(value["tags"]);

const isSecretVersion = (value: unknown): value is CloudSecretVersion =>
  isRecord(value) &&
  typeof value["version"] === "string" &&
  typeof value["bytes"] === "number" &&
  typeof value["sha256"] === "string";

const isSecret = (value: unknown): value is CloudSecretReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["currentVersion"] === "string" &&
  Array.isArray(value["versions"]) &&
  value["versions"].every(isSecretVersion) &&
  typeof value["rotationEnabled"] === "boolean" &&
  typeof value["encrypted"] === "boolean" &&
  typeof value["matchesKnownPlaceholder"] === "boolean" &&
  isStringMap(value["tags"]);

const isPrincipal = (value: unknown): value is CloudPrincipalReading =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  isStringArray(value["attachedPolicies"]) &&
  Array.isArray(value["statements"]) &&
  value["statements"].every(isStatement) &&
  isStringMap(value["tags"]);

const isDecision = (value: unknown): value is CloudDecisionReading =>
  isRecord(value) &&
  typeof value["principal"] === "string" &&
  typeof value["action"] === "string" &&
  typeof value["resource"] === "string" &&
  typeof value["allowed"] === "boolean" &&
  typeof value["entry"] === "string" &&
  typeof value["account"] === "string";

const isMeters = (value: unknown): value is CloudMeterReading =>
  isRecord(value) &&
  typeof value["requests"] === "number" &&
  typeof value["objects"] === "number" &&
  typeof value["bytes"] === "number" &&
  typeof value["costUnits"] === "number";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a provider document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs: the first sends an agent to the application, the second to the
 * environment.
 */
export function isCloudObservationData(value: unknown): value is CloudObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["api"] !== "string") return false;
  if (typeof value["provider"] !== "string") return false;
  if (typeof value["region"] !== "string") return false;
  if (typeof value["account"] !== "string") return false;
  if (typeof value["principal"] !== "string") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (typeof value["costModel"] !== "string") return false;
  if (!Array.isArray(value["calls"]) || !value["calls"].every(isCall)) return false;
  if (!Array.isArray(value["buckets"]) || !value["buckets"].every(isBucket)) return false;
  if (!Array.isArray(value["objects"]) || !value["objects"].every(isObject)) return false;
  if (!Array.isArray(value["queues"]) || !value["queues"].every(isQueue)) return false;
  if (!Array.isArray(value["secrets"]) || !value["secrets"].every(isSecret)) return false;
  if (!Array.isArray(value["principals"]) || !value["principals"].every(isPrincipal)) return false;
  if (!Array.isArray(value["decisions"]) || !value["decisions"].every(isDecision)) return false;
  return isMeters(value["meters"]);
}

// ---- resolving a target, in the family's own spelling --------------------------------------------

/**
 * The result of turning a criterion's target into a value this world can look up.
 *
 * A discriminated result rather than `string | null`, for the reason `os-observation.ts` records: a
 * target that did not resolve came back as `null` in the first system family and the validator had to
 * write one message covering every reason it might not have - which is the shape of an error message
 * naming a cause its reporter did not observe. Here the *resolver* knows why, so the reason travels
 * with the refusal and the validator quotes it.
 */
export type CloudTargetResult<T> =
  | { readonly kind: "target"; readonly value: T }
  | { readonly kind: "refused"; readonly reason: string };

const refused = <T>(reason: string): CloudTargetResult<T> => ({ kind: "refused", reason });
const resolved = <T>(value: T): CloudTargetResult<T> => ({ kind: "target", value });

/**
 * Everything a criterion may name, as one union.
 *
 * One grammar rather than five near-identical resolvers, because a resource in a *policy statement*
 * and a resource in a *criterion's target* have to be the same string to mean the same thing - and
 * two resolvers is how they stop being the same string. The spelling is `<kind>/<name...>`:
 *
 * ```
 * bucket/cart-assets
 * object/cart-assets/index.html
 * queue/cart-events-dead-letter
 * secret/cart-api-key
 * principal/svc-cart
 * ```
 *
 * An object's key may contain `/`, because a key is a path - so the split takes the first segment as
 * the kind, the second as the bucket, and everything after it as the key. A key containing `:` is
 * refused rather than repaired, because `:` is how an access reference separates its three parts and
 * a key that carried one could not be written in one.
 */
export type CloudRef =
  | { readonly kind: "bucket"; readonly name: string }
  | { readonly kind: "object"; readonly bucket: string; readonly key: string }
  | { readonly kind: "queue"; readonly name: string }
  | { readonly kind: "secret"; readonly name: string }
  | { readonly kind: "principal"; readonly name: string };

/** The five kinds of thing a target may name. Named once, and read by the refusal that lists them. */
export const CLOUD_REF_KINDS = ["bucket", "object", "queue", "secret", "principal"] as const;

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const nameProblem = (kind: string, name: string): string | null => {
  if (name === "") return `a ${kind} name is required, and the reference names an empty one`;
  if (!NAME_PATTERN.test(name)) {
    return (
      `a ${kind} name is lower case and starts with a letter or a digit; ${kind} names may carry ` +
      `letters, digits, ".", "_" and "-", and this one is ${JSON.stringify(name)}`
    );
  }
  return null;
};

/**
 * The reference a target names, or the resolver's own reason for refusing it.
 *
 * Targets are written as this family spells them rather than as this substitute maps them onto a
 * route, because that is the only spelling that survives the world being served on a different port,
 * by a different implementation, or on a different machine.
 */
export function resolveCloudRef(target: string): CloudTargetResult<CloudRef> {
  const trimmed = target.trim();
  if (trimmed !== target) {
    return refused(
      `a reference is written without surrounding whitespace; this one is ${JSON.stringify(target)}`,
    );
  }
  const parts = target.split("/");
  const kind = parts[0];
  if (kind === undefined || kind === "") {
    return refused(
      `a reference names what it refers to, as \`${CLOUD_REF_KINDS.join("/")}\`; ` +
        `${JSON.stringify(target)} names no kind`,
    );
  }
  if (!(CLOUD_REF_KINDS as readonly string[]).includes(kind)) {
    return refused(
      `${JSON.stringify(kind)} is not a kind of thing this world holds; a reference is written as ` +
        `one of ${CLOUD_REF_KINDS.join(", ")}, followed by "/" and the name - and ` +
        `${JSON.stringify(target)} does not name one. Note that an object's key may itself contain ` +
        `"/", so \`object/cart-assets/\` is not an object and \`object/cart-assets/index.html\` is`,
    );
  }

  if (kind === "object") {
    const bucket = parts[1] ?? "";
    const key = parts.slice(2).join("/");
    const bucketProblem = nameProblem("bucket", bucket);
    if (bucketProblem !== null) return refused(`${bucketProblem} (in ${JSON.stringify(target)})`);
    if (key === "") {
      return refused(
        `an object reference names a key after the bucket, as ` +
          `\`object/cart-assets/index.html\`; ${JSON.stringify(target)} names a bucket and no key`,
      );
    }
    if (key.includes(":")) {
      return refused(
        `an object key may not contain ":", because ":" is what separates the three parts of an ` +
          `access reference; ${JSON.stringify(key)} carries one and cannot be written in both places`,
      );
    }
    return resolved({ kind: "object", bucket, key });
  }

  const name = parts.slice(1).join("/");
  if (name.includes("/")) {
    return refused(
      `a ${kind} name does not contain "/"; only an object's key is a path. ` +
        `${JSON.stringify(target)} has one in its name`,
    );
  }
  const problem = nameProblem(kind, name);
  if (problem !== null) return refused(`${problem} (in ${JSON.stringify(target)})`);
  if (kind === "bucket") return resolved({ kind: "bucket", name });
  if (kind === "queue") return resolved({ kind: "queue", name });
  if (kind === "secret") return resolved({ kind: "secret", name });
  return resolved({ kind: "principal", name });
}

/** A reference written back out, so a rendering and a target are the same string. */
export function cloudRefSpelling(ref: CloudRef): string {
  if (ref.kind === "object") return `object/${ref.bucket}/${ref.key}`;
  return `${ref.kind}/${ref.name}`;
}

/** One part of an access reference, which is what a decision is keyed by. */
export interface CloudAccessRef {
  readonly principal: string;
  readonly action: string;
  readonly resource: CloudRef;
}

/**
 * The `principal/<name>:<action>:<resource>` reference `cloud.access` targets, or the reason it was
 * refused.
 *
 * Three parts in one string rather than three fields, because a decision is *about* the triple and a
 * criterion that could name only one of them could not ask its question. The resource is resolved by
 * {@link resolveCloudRef}, so a grant in a policy document and the question a criterion asks are the
 * same string meaning the same thing.
 */
export function resolveCloudAccessRef(target: string): CloudTargetResult<CloudAccessRef> {
  const parts = target.split(":");
  if (parts.length !== 3) {
    return refused(
      `an access reference is \`principal/<name>:<action>:<resource>\`, as in ` +
        `\`principal/svc-cart:s3.getObject:object/cart-assets/index.html\` - ${JSON.stringify(target)} ` +
        `splits into ${String(parts.length)} part${parts.length === 1 ? "" : "s"} on ":" and needs 3`,
    );
  }
  const principalRef = resolveCloudRef(parts[0] ?? "");
  if (principalRef.kind === "refused") return refused(principalRef.reason);
  if (principalRef.value.kind !== "principal") {
    return refused(
      `the first part of an access reference names a principal, and ` +
        `${JSON.stringify(parts[0] ?? "")} names a ${principalRef.value.kind}`,
    );
  }
  const action = parts[1] ?? "";
  if (action === "") {
    return refused(`the second part of an access reference is the action, and this one is empty`);
  }
  if (!(CLOUD_ACTION_NAMES as readonly string[]).includes(action)) {
    return refused(
      `${JSON.stringify(action)} is not an action this world serves; a decision is recorded for one ` +
        `of ${CLOUD_ACTION_NAMES.join(", ")}, and a criterion naming something else would be ` +
        "reported as an application that never made the request - which is the shape of a real " +
        'defect rather than the shape of a contract that cannot be read. The separator is a "." ' +
        'rather than a ":" for exactly this reason: ":" is what separates the three parts of an ' +
        "access reference, so an action carrying one could not be written in one",
    );
  }
  const resource = resolveCloudRef(parts[2] ?? "");
  if (resource.kind === "refused") return refused(resource.reason);
  return resolved({ principal: principalRef.value.name, action, resource: resource.value });
}

/** Whether a name is a place this world is not allowed to work in, and why. Read by the loader too. */
export function principalProblem(name: string): string | null {
  const privileged = ["root", "account-root", "owner", "administrator", "admin"];
  if (privileged.includes(name)) {
    return (
      `the principal is \`${name}\`, and every policy in an account yields to an account root - so a ` +
      "hardening contract judged as one would report a pass for permissions no ordinary workload " +
      "gets. Name the service account the application actually runs as"
    );
  }
  return null;
}

// ---- the questions a family asks of the document -------------------------------------------------

export function bucketNamed(data: CloudObservationData, name: string): CloudBucketReading | null {
  return data.buckets.find((bucket) => bucket.name === name) ?? null;
}

export function objectAt(
  data: CloudObservationData,
  bucket: string,
  key: string,
): CloudObjectReading | null {
  return data.objects.find((entry) => entry.bucket === bucket && entry.key === key) ?? null;
}

export function queueNamed(data: CloudObservationData, name: string): CloudQueueReading | null {
  return data.queues.find((queue) => queue.name === name) ?? null;
}

export function secretNamed(data: CloudObservationData, name: string): CloudSecretReading | null {
  return data.secrets.find((secret) => secret.name === name) ?? null;
}

export function principalNamed(
  data: CloudObservationData,
  name: string,
): CloudPrincipalReading | null {
  return data.principals.find((principal) => principal.name === name) ?? null;
}

/** The reading of the thing a reference names, as its document, or `null`. */
export function renderRef(data: CloudObservationData, ref: CloudRef): string | null {
  switch (ref.kind) {
    case "bucket": {
      const bucket = bucketNamed(data, ref.name);
      return bucket === null ? null : renderBucket(bucket);
    }
    case "object": {
      const object = objectAt(data, ref.bucket, ref.key);
      return object === null ? null : renderObject(object);
    }
    case "queue": {
      const queue = queueNamed(data, ref.name);
      return queue === null ? null : renderQueue(queue);
    }
    case "secret": {
      const secret = secretNamed(data, ref.name);
      return secret === null ? null : renderSecret(secret);
    }
    case "principal": {
      const principal = principalNamed(data, ref.name);
      return principal === null ? null : renderPrincipal(principal);
    }
  }
}

/**
 * Every recorded request that answered `action`.
 *
 * The whole list rather than the newest, because the two validators that read it differ in which one
 * they take - and because a caller that wants to know how many times something was attempted is
 * asking a question the reading can answer.
 */
export function callsOf(data: CloudObservationData, action: string): readonly CloudCallRecord[] {
  return data.calls.filter((call) => call.action === action);
}

/** The decision this world reached for a triple, or `null`. The newest, if the triple was asked twice. */
export function decisionFor(
  data: CloudObservationData,
  principal: string,
  action: string,
  resource: string,
): CloudDecisionReading | null {
  const matches = data.decisions.filter(
    (decision) =>
      decision.principal === principal && decision.action === action && decision.resource === resource,
  );
  return matches[matches.length - 1] ?? null;
}

/** One meter, or `null` for a key this world does not keep. Read by the validator against the list. */
export function meterValue(data: CloudObservationData, key: string): number | null {
  if (!(CLOUD_METER_KEYS as readonly string[]).includes(key)) return null;
  return data.meters[key as CloudMeterKey];
}

// ---- renderings ----------------------------------------------------------------------------------
//
// A rendering is a document a criterion targets with `contains`, and it exists because the
// interesting questions about a resource are about the resource *as a whole* - "is versioning on",
// "does anything here grant `*`", "is every entry inherited" - and a criterion that could only ask
// about one field at a time could ask none of them. This is the same choice `os.setting` and
// `os.acl` record, and it is the reason `cloud.setting` needs no `name` field beside `target`.
//
// Every rendering is `<key>=<value>` lines, sorted by key, so a criterion's `contains` is a stable
// sentence across runs; tags are rendered with a `tag.` prefix and attributes with `attribute.`, so a
// tag and a setting with the same name cannot be confused for one another.

const sortedLines = (pairs: Readonly<Record<string, string | number | boolean | null>>): string =>
  Object.entries(pairs)
    .map(([key, value]) => `${key}=${value === null ? "none" : String(value)}` as const)
    .sort((left, right) => left.localeCompare(right))
    .join("\n");

const tagLines = (tags: Readonly<Record<string, string>>): Record<string, string> => {
  const lines: Record<string, string> = {};
  for (const [name, value] of Object.entries(tags)) lines[`tag.${name}`] = value;
  return lines;
};

export function renderBucket(bucket: CloudBucketReading): string {
  return sortedLines({
    name: bucket.name,
    region: bucket.region,
    versioning: bucket.versioning,
    encryption: bucket.encryption,
    publicAccessBlocked: bucket.publicAccessBlocked,
    objects: bucket.objects,
    ...tagLines(bucket.tags),
  });
}

export function renderObject(object: CloudObjectReading): string {
  return sortedLines({
    bucket: object.bucket,
    key: object.key,
    bytes: object.bytes,
    sha256: object.sha256,
    contentType: object.contentType,
    encryption: object.encryption,
    versionId: object.versionId,
    versions: object.versions,
    ...tagLines(object.tags),
  });
}

export function renderQueue(queue: CloudQueueReading): string {
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(queue.attributes)) attributes[`attribute.${name}`] = value;
  return sortedLines({
    name: queue.name,
    messages: queue.messages,
    inFlight: queue.inFlight,
    deadLetterQueue: queue.deadLetterQueue,
    encryption: queue.encryption,
    visibilityTimeoutSeconds: queue.visibilityTimeoutSeconds,
    ...attributes,
    ...tagLines(queue.tags),
  });
}

export function renderSecret(secret: CloudSecretReading): string {
  const newest = secret.versions[secret.versions.length - 1];
  return sortedLines({
    name: secret.name,
    currentVersion: secret.currentVersion,
    versions: secret.versions.length,
    rotationEnabled: secret.rotationEnabled,
    encrypted: secret.encrypted,
    matchesKnownPlaceholder: secret.matchesKnownPlaceholder,
    bytes: newest === undefined ? 0 : newest.bytes,
    sha256: newest === undefined ? "" : newest.sha256,
    ...tagLines(secret.tags),
  });
}

export function renderPrincipal(principal: CloudPrincipalReading): string {
  const lines: Record<string, string | number | boolean> = {
    name: principal.name,
    created: true,
    attachedPolicies: principal.attachedPolicies.join(","),
    ...tagLines(principal.tags),
  };
  principal.statements.forEach((statement, index) => {
    lines[`statement.${String(index)}`] = statementSpelling(statement);
  });
  return sortedLines(lines);
}

/**
 * One policy statement, rendered.
 *
 * `effect action resource`, which is readable and targetable at once: `contains: "deny s3.deleteBucket
 * bucket/cart-assets"` is the sentence "this says nothing may delete that bucket", and a contract
 * asking for least privilege is a sentence about a *set* of statements rather than about one line.
 *
 * **The principal is deliberately absent, and the first version of this comment named it anyway.** A
 * reading of `principal/svc-cart` renders that principal's own policy, so the subject is already the
 * header of the document and repeating it on every line would be the same word twice - but the
 * comment said `effect principal action resource` while the body below renders three fields, and a
 * comment that describes a rendering the code does not perform sends a contract author to write a
 * `contains` that can never match. Measured rather than reasoned: `tests/cloud-observation.test.ts`
 * pins this function's output, so the next reader does not have to choose between the comment and the
 * code.
 */
export function statementSpelling(statement: CloudPolicyStatement): string {
  return `${statement.effect} ${statement.action} ${statement.resource}`;
}

/**
 * A policy document, one statement per line, in the order it was written.
 *
 * Declaration order rather than sorted order, unlike every other rendering here, because a policy is
 * a document a reader reads top to bottom - and because sorting it would make two different policies
 * with the same statements render identically, which is a distinction this world's evaluator does not
 * make but a reader of the bundle might reasonably want. The order is stable across runs because it is
 * the order the statements arrived in.
 */
export function renderPolicy(statements: readonly CloudPolicyStatement[]): string {
  if (statements.length === 0) return "";
  return statements.map(statementSpelling).join("\n");
}

/**
 * One access decision, rendered.
 *
 * `entry` is the statement that decided it, or `none` for the world's own default. A criterion can
 * therefore assert both halves of the answer - what was decided, and *why* - in one `contains`, which
 * is the difference between "this was denied" and "this was denied because nothing granted it".
 */
export function renderDecision(decision: CloudDecisionReading): string {
  return sortedLines({
    principal: decision.principal,
    action: decision.action,
    resource: decision.resource,
    allowed: decision.allowed,
    entry: decision.entry,
  });
}

/** The name a reference carries, for a message that has to name what it looked for. */
export function refName(ref: CloudRef): string {
  return ref.kind === "object" ? `${ref.bucket}/${ref.key}` : ref.name;
}
