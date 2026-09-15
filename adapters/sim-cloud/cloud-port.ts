/**
 * A substitute cloud control plane, reached over HTTP by the application it is judging.
 *
 * The shape is the one `adapters/sim-k8s/cluster-port.ts` established and `adapters/sim-os/os-port.ts`
 * scaled out, attacking a third axis: the subject is not a cluster or a machine but a *provider
 * account*. A real application process really authenticates, really provisions, really reads back, and
 * really reaches for a URL this file is listening on. What it reaches holds buckets, objects, queues,
 * secrets, principals and a meter - in memory, with no object store, no key-management service, no
 * identity provider and no billing system anywhere in the loop.
 *
 * The three conditions that make a simulated world honest are the project's, not this file's, and they
 * are met here in the same way:
 *
 * 1. **The application executes for real.** It is a real process, it opens a real socket, and it fails
 *    for real when it sends a request this world refuses.
 * 2. **The interfaces are real.** The transport is HTTP over a real bound port, the routes are the ones
 *    a provider client builds, the statuses are HTTP's, and the payloads are JSON.
 * 3. **The substitution is declared.** {@link CLOUD_SIMULATED_SURFACES} names the substituted surfaces,
 *    `GET /v1/version` serves that list, every reading carries it, and `environment.json` records it.
 *    Nothing here claims to be a cloud.
 *
 * Deliberately **not** substituted, because they happened: the application's own execution, the
 * transport, the digest of the bytes that arrived, and the authority of a criterion to pass or fail.
 *
 * ## Two records, and the difference is the point
 *
 * **The action record** ({@link CloudPort.calls}) is every request this world was asked to serve, in
 * request order, including the ones it refused. **The state record** ({@link CloudPort.snapshot}) is
 * what the account holds now. A contract that only ever checked state could pass on a run whose
 * provisioner never ran at all, because an empty account and a correctly provisioned empty account look
 * exactly alike - which is why the metering is computed from the request record rather than from the
 * state, and why `cloud.call` exists.
 *
 * The two are kept structurally apart: `dump()` writes the *stored* state and deliberately excludes
 * both records, and `clear()` empties the account while leaving both untouched. *A reset restores the
 * world; it does not restore the record* - an iteration that provisioned something outside the boundary
 * and was then reset would otherwise report `PASS` with the evidence of the violation deleted by the
 * very act of repairing it. That is the shape of false pass this product exists to refuse.
 *
 * **The meter is a reading rather than a record, so it is the one thing a reset does start over.**
 * `meters()` is derived from the action record, and derived is the whole difference: the record is what
 * the run did and it is kept, while the meter answers "what did this attempt cost" and is scoped to the
 * account's current life. Both halves are needed and they pull in opposite directions, so the rule is
 * written at {@link CloudPort.clear} where the choice is made. A meter that survived a reset made every
 * criterion built on it a function of the iteration number - measured, not argued: the demo's own
 * `cloud.meter equals: 1` read `1, 2, 3, 4, 5` across five iterations of one correct program.
 *
 * ## Determinism
 *
 * Nothing in this file reads the clock or a random source. Listings are sorted, version identifiers are
 * counters, a receipt handle is a digest of what it stands for, and {@link CloudCallRecord.durationMs}
 * is always `0`. Two readings of one unchanged account are therefore byte-identical, which is what
 * makes a repeat-run consistency check meaningful - a real elapsed time would have made that check
 * report a difference the application did not cause.
 *
 * ## The one thing this world refuses to record
 *
 * A secret's *value* is served, because an application that cannot read its own secret is not being
 * tested, and it is stored, because a `getSecretValue` has to have something to return. It is never in
 * a *reading*: {@link CloudSecretReading} carries the length, the digest and whether the value is one of
 * {@link CLOUD_PLACEHOLDER_VALUES}, and nothing else. An evidence bundle is written to disk, committed
 * by operators, attached to CI runs and read by whatever model is repairing the code, and a bundle that
 * carried the secret would hand it to all four. The value lives in `#secrets`, which never leaves this
 * module, and only the `getSecretValue` route ever returns it.
 *
 * ## The honest edges
 *
 * An access decision here is *this world's own evaluator*, not an identity provider's: a `deny` that
 * covers a request beats an `allow` that also covers it, a resource pattern ending in `/*` covers by
 * prefix, and an unmatched request is denied by default. A criterion may assert the decision and the
 * statement that decided it, and that is all it should claim. Placeholder detection is a closed list of
 * nine boring strings rather than an entropy measurement, and the header of
 * `core/environment/cloud-observation.ts` says so where a reader of a bundle will find it.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CLOUD_ACTION_NAMES,
  CLOUD_ENCRYPTION_ALGORITHMS,
  CLOUD_PLACEHOLDER_VALUES,
  CLOUD_POLICY_EFFECTS,
  CLOUD_SIMULATED_SURFACES,
  CLOUD_VERSIONING_STATES,
  principalProblem,
  resolveCloudRef,
  statementSpelling,
  type CloudAction,
  type CloudBucketReading,
  type CloudCallRecord,
  type CloudCallResult,
  type CloudCallSource,
  type CloudDecisionReading,
  type CloudEncryptionAlgorithm,
  type CloudMeterReading,
  type CloudObjectReading,
  type CloudPolicyStatement,
  type CloudPrincipalReading,
  type CloudQueueReading,
  type CloudSecretReading,
  type CloudVersioningState,
} from "../../core/environment/cloud-observation.ts";

/** What this world holds, as readings. State only - the records are separate, on purpose. */
export interface CloudSnapshot {
  readonly buckets: readonly CloudBucketReading[];
  readonly objects: readonly CloudObjectReading[];
  readonly queues: readonly CloudQueueReading[];
  readonly secrets: readonly CloudSecretReading[];
  readonly principals: readonly CloudPrincipalReading[];
}

/**
 * One request to the world.
 *
 * `path` may carry a query string, and a query parameter names a *sub-resource* - see the route table.
 * `headers` is optional because a criterion's `call` step has no headers to set: the in-process path
 * passes none and the HTTP path fills them from the real request. The two headers this world reads are
 * named in {@link HEADER_ENCRYPTION} and {@link HEADER_PRINCIPAL}.
 */
export interface CloudRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: string | null;
  /** The caller, when the caller is not the identity the environment document declared. */
  readonly principal?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** What the world answered, whether it served the request or refused it. */
export interface CloudCallOutcome {
  /** The provider-neutral action name, or `""` when the world could not name one. */
  readonly action: string;
  readonly resource: string | null;
  readonly result: CloudCallResult;
  /** The HTTP status, or `null` when nothing was served. */
  readonly status: number | null;
  readonly reason: string | null;
  /** The JSON text the world answered with. `""` when it answered with no body. */
  readonly body: string;
}

/** The identity this account was created with. Not a secret: it is in every reading. */
export interface CloudIdentity {
  readonly provider: string;
  readonly region: string;
  readonly account: string;
  readonly principal: string;
}

export interface CloudPort {
  /** Bind the declared address and return the URL actually bound. Throws on `EADDRINUSE`. */
  listen(address: { readonly host: string; readonly port: number }): Promise<string>;
  close(): Promise<void>;
  /** Put one request to the world from inside this process. The adapter's `call` step uses this. */
  call(request: CloudRequest, source: CloudCallSource): CloudCallOutcome;
  /** Every request put to this account, in request order, refusals included. */
  calls(): readonly CloudCallRecord[];
  /** Every access decision this world reached, in the order it reached them. */
  decisions(): readonly CloudDecisionReading[];
  /** Read the account. Sorted, so two readings of one state are byte-identical. */
  snapshot(): CloudSnapshot;
  /** The meter, computed from the request record and this world's declared price table. */
  /** The meter for the account's current life. Computed from the request record, never stored. */
  meters(): CloudMeterReading;
  /** Empty the account and start its meter over. Leaves both records untouched. */
  clear(): void;
  dump(): string;
  load(state: string): void;
  identity(): CloudIdentity;
}

/** `x-veridian-encryption` names the encryption a `putObject` asked for. */
export const HEADER_ENCRYPTION = "x-veridian-encryption";
/** `x-veridian-principal` names the caller, when it is not the declared identity. */
export const HEADER_PRINCIPAL = "x-veridian-principal";

/** The declared price table behind `meters.costUnits`. Exposed so the number is auditable. */
export const COST_UNITS = Object.freeze({
  /** Every request costs one unit, because every request is a request. */
  perRequest: 1,
  perObject: 4,
  /** One unit per kilobyte written, rounded up, so a zero-byte object still costs nothing extra. */
  bytesPerUnit: 1024,
});

/** The formula, as a string, so a reading carries it rather than asserting its result. */
export const COST_MODEL =
  "costUnits = requests * 1 + objects * 4 + ceil(bytes / 1024), over the whole request record";

// ---------------------------------------------------------------------------------------------
// Vocabulary helpers. Each one is the single implementation of a rule this world holds.
// ---------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (record: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * Whether a resource pattern covers a reference.
 *
 * Two spellings and no others: `*` covers everything, a trailing `/*` covers a container's members by
 * prefix, and anything else is an exact match. The `/` is kept when the tail is stripped, so
 * `object/cart-assets/*` covers `object/cart-assets/logo.png` and does **not** cover
 * `object/cart-assets-private/logo.png` - a prefix test on the bare stem would cover both, and a
 * containment contract that let a neighbouring key through is the defect such a contract exists to
 * catch.
 */
export const covers = (pattern: string, value: string): boolean => {
  if (pattern === "*") return true;
  if (!pattern.endsWith("/*")) return pattern === value;
  return value.startsWith(pattern.slice(0, -1));
};

/**
 * Whether an action pattern covers an action.
 *
 * Actions are a closed vocabulary, so their wildcard is the *service*: a pattern of `s3` followed by a
 * dot and a wildcard covers every object operation and nothing else. Reusing {@link covers} here would
 * have made that pattern match nothing, because `s3.putObject` does not begin with the pattern's own
 * text followed by a separator - the two grammars carry two different wildcards and cannot share one
 * implementation.
 */
export const coversAction = (pattern: string, action: string): boolean => {
  if (pattern === "*" || pattern === action) return true;
  return pattern.endsWith(".*") && action.startsWith(pattern.slice(0, -1));
};

/** The services this world serves, derived from the action vocabulary rather than listed again. */
const ACTION_SERVICES: readonly string[] = [
  ...new Set(CLOUD_ACTION_NAMES.map((name) => name.split(".")[0] ?? "")),
].sort((a, b) => a.localeCompare(b));

const isAction = (value: string): value is CloudAction =>
  (CLOUD_ACTION_NAMES as readonly string[]).includes(value);

/** Why a policy statement's action is not a pattern this world can evaluate, or `null`. */
const actionProblem = (pattern: string): string | null => {
  if (pattern === "*" || isAction(pattern)) return null;
  if (pattern.endsWith(".*")) {
    const service = pattern.slice(0, -2);
    if (ACTION_SERVICES.includes(service)) return null;
    return (
      `${JSON.stringify(pattern)} names a service this world does not serve. The services are ` +
      `${ACTION_SERVICES.join(", ")}, and a statement's action is one of those, an action name, or "*"`
    );
  }
  return (
    `${JSON.stringify(pattern)} is not an action this world serves. A statement's action is one of ` +
    `${CLOUD_ACTION_NAMES.join(", ")}, a service with a trailing ".*", or "*" - and a spelling this ` +
    "world does not serve would be reported as an application that never made the request, which is " +
    "the shape of a real defect rather than the shape of a contract that cannot be read"
  );
};

/** Why the name of a bucket, queue, secret or principal is not expressible, or `null`. */
const nameProblem = (kind: string, name: string): string | null => {
  const outcome = resolveCloudRef(`${kind}/${name}`);
  return outcome.kind === "refused" ? outcome.reason : null;
};

/**
 * Why a policy statement's resource is not a pattern this world can match, or `null`.
 *
 * Only an object reference has members, so the only pattern ending in `/*` is
 * `object/<bucket>[/<key prefix>]/*`. A `bucket/x/*` would have to name a bucket's members, and a
 * `queue/x/*` would have to name something a queue does not have - refusing both by name is what stops
 * a contract from being written that could never match anything.
 */
const resourceProblem = (pattern: string): string | null => {
  if (pattern === "*") return null;
  if (!pattern.endsWith("/*")) {
    const outcome = resolveCloudRef(pattern);
    return outcome.kind === "refused" ? outcome.reason : null;
  }
  const head = pattern.slice(0, -2);
  const parts = head.split("/");
  const kind = parts[0] ?? "";
  if (kind !== "object") {
    return (
      "only an object reference has members, so the only pattern ending in a wildcard member is " +
      `${JSON.stringify("object/<bucket>/<key prefix>/*")} - ${JSON.stringify(pattern)} names a ` +
      `"${kind}" reference, which has none`
    );
  }
  const bucket = parts[1];
  if (bucket === undefined || bucket === "") {
    return (
      `a pattern naming a bucket's members names the bucket, and ${JSON.stringify(pattern)} names none: ` +
      `write ${JSON.stringify("object/<bucket>/*")}`
    );
  }
  return nameProblem("bucket", bucket);
};

/** Fold a value for placeholder comparison. Case and surrounding space are not part of a value. */
const fold = (value: string): string => value.trim().toLowerCase();

/** The digest of the bytes that really arrived. The world's evidence, not a claim. */
const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A short digest, for a handle that has to be stable and readable rather than unguessable. */
const shortDigest = (text: string): string => digest(text).slice(0, 12);

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => a.localeCompare(b));

// ---------------------------------------------------------------------------------------------
// Refusals, and the handler result.
// ---------------------------------------------------------------------------------------------

/**
 * A refusal, carrying both the vocabulary member a criterion judges and the HTTP status a client sees.
 *
 * They are named together in one value on purpose: a world that answered `405` and recorded `missing`,
 * or answered `404` and recorded `unsupported`, would give a criterion and a reader two different
 * accounts of one request.
 */
interface Refusal {
  readonly result: CloudCallResult;
  readonly code: number;
  readonly reason: string;
  readonly message: string;
}

type HandlerResult =
  | {
      readonly outcome: "answered";
      readonly status: number;
      readonly body: unknown;
      readonly resource: string | null;
    }
  | { readonly outcome: "refused"; readonly refusal: Refusal; readonly resource: string | null };

const answered = (resource: string | null, status: number, body: unknown): HandlerResult => ({
  outcome: "answered",
  status,
  body,
  resource,
});

const refusedWith = (
  resource: string | null,
  result: CloudCallResult,
  code: number,
  reason: string,
  message: string,
): HandlerResult => ({ outcome: "refused", refusal: { result, code, reason, message }, resource });

/** 404. The resource is not here. This is a different observation from a refused request. */
const absent = (resource: string | null, message: string, reason = "NotFound"): HandlerResult =>
  refusedWith(resource, "missing", 404, reason, message);

/** 400 for a body that is not JSON, 422 for a body that is JSON and says something wrong. */
const invalid = (
  resource: string | null,
  message: string,
  code = 422,
  reason = "Invalid",
): HandlerResult => refusedWith(resource, "invalid", code, reason, message);

/** 409. The account already holds something the request would collide with. */
const conflicting = (resource: string | null, message: string): HandlerResult =>
  refusedWith(resource, "conflict", 409, "Conflict", message);

/** 500. Something inside this world failed, which is not the application's fault and is named as such. */
const crashed = (message: string): HandlerResult =>
  refusedWith(null, "error", 500, "InternalError", message);

/**
 * The body a refusal on the request path sends: the same reason and message the call record carries.
 *
 * Every refusal raised before dispatch builds one, and the reason is that a *client* has no other way to
 * find out why. The branch that refused an unserved route used to record its explanation and send
 * **nothing** - `#handle` writes an empty body whenever `#record` was given no body, so the one party
 * that could not read the call record was the one party that asked. It was found by the provisioning
 * program in `examples/sim-cloud/app/`, whose `PUT .../versioning` came back as a bare `404` with an empty
 * message while the world's own sentence - "this world serves no route ... its sub-resources are named by
 * a query parameter" - had been assembled two statements earlier and thrown away.
 *
 * This is the mirror of the defect `core/memory` paid for: a client that reads only the status and then
 * names a cause it never observed is blind by its own hand, and a server that knows the cause and sends
 * none leaves the caller in exactly the same position. Both are the same rule - an error message may only
 * name a cause the reporter observed, and the reporter is the one holding it.
 */
const refusalBody = (reason: string, status: number, message: string): Record<string, unknown> => ({
  kind: "Error",
  reason,
  status,
  message,
});

// ---------------------------------------------------------------------------------------------
// The stored account.
// ---------------------------------------------------------------------------------------------

interface StoredVersion {
  readonly versionId: string;
  /** The bytes. Never in a reading for a secret; the whole object for an object. */
  readonly text: string;
  readonly contentType: string;
  /** The *effective* label at the time of the write. */
  readonly encryption: CloudEncryptionAlgorithm;
}

interface StoredObject {
  /** How many writes this key has seen, which is what the next version identifier counts from. */
  writes: number;
  /** Newest first. One entry unless the bucket's versioning was `enabled` at the second write. */
  readonly versions: StoredVersion[];
  tags: Record<string, string>;
}

interface StoredBucket {
  readonly name: string;
  readonly region: string;
  versioning: CloudVersioningState;
  encryption: CloudEncryptionAlgorithm;
  publicAccessBlocked: boolean | null;
  policy: CloudPolicyStatement[];
  tags: Record<string, string>;
  readonly objects: Map<string, StoredObject>;
}

interface StoredQueue {
  readonly name: string;
  readonly messages: string[];
  readonly inFlight: Map<string, string>;
  deadLetterQueue: string | null;
  encryption: CloudEncryptionAlgorithm;
  visibilityTimeoutSeconds: number;
  attributes: Record<string, string>;
  tags: Record<string, string>;
}

interface StoredSecret {
  readonly name: string;
  /** Newest first. One entry per `putSecretValue`, and the text never leaves this module. */
  readonly versions: StoredVersion[];
  rotationEnabled: boolean;
  encrypted: boolean;
  tags: Record<string, string>;
}

interface StoredPolicy {
  readonly name: string;
  readonly statements: CloudPolicyStatement[];
}

interface StoredPrincipal {
  readonly name: string;
  readonly policies: StoredPolicy[];
  tags: Record<string, string>;
}

interface RouteSpec {
  readonly pattern: readonly string[];
  readonly methods: Readonly<Record<string, CloudAction>>;
  /**
   * Sub-resources, keyed by the **query parameter** that names one.
   *
   * A query parameter rather than a path segment for one concrete reason: an object key may contain a
   * `/`, so an object route's trailing segments are the key and there is no room left for a path
   * segment that is not part of it. `?tagging` is unambiguous where `/tagging` would have been
   * indistinguishable from a key named `tagging`, and one rule for every route is one rule to state.
   */
  readonly parts?: Readonly<Record<string, Readonly<Record<string, CloudAction>>>>;
}

interface Match {
  readonly spec: RouteSpec;
  readonly captured: Readonly<Record<string, string>>;
}

/**
 * Every route this world serves, one row per address.
 *
 * Written as data rather than as branches in a handler for one reason: a route that exists is a route
 * the 404 and 405 messages can name, and {@link servedActions} derives the action list from this table
 * so a test can hold it against {@link CLOUD_ACTION_NAMES}. An action in the vocabulary with no route
 * behind it would be a criterion that can never be satisfied by any request - which is the defect a
 * closed vocabulary exists to make visible rather than to hide.
 */
const ROUTES: readonly RouteSpec[] = [
  { pattern: ["v1", "version"], methods: { GET: "provider.describe" } },
  { pattern: ["v1", "identity"], methods: { GET: "sts.getCallerIdentity" } },
  { pattern: ["v1", "identity", "authorize"], methods: { POST: "iam.authorize" } },
  {
    pattern: ["v1", "identity", "principals"],
    methods: { GET: "iam.getPrincipal", POST: "iam.createPrincipal" },
  },
  {
    pattern: ["v1", "identity", "principals", ":principal"],
    methods: { GET: "iam.getPrincipal", DELETE: "iam.deletePrincipal" },
    parts: { policy: { PUT: "iam.putPrincipalPolicy", DELETE: "iam.deletePrincipalPolicy" } },
  },
  { pattern: ["v1", "storage", "buckets"], methods: { GET: "s3.listObjects" } },
  {
    pattern: ["v1", "storage", "buckets", ":bucket"],
    methods: { GET: "s3.headBucket", PUT: "s3.createBucket", DELETE: "s3.deleteBucket" },
    parts: {
      versioning: { GET: "s3.getBucketVersioning", PUT: "s3.putBucketVersioning" },
      encryption: { GET: "s3.getBucketEncryption", PUT: "s3.putBucketEncryption" },
      publicAccessBlock: { GET: "s3.getPublicAccessBlock", PUT: "s3.putPublicAccessBlock" },
      policy: { GET: "s3.getBucketPolicy", PUT: "s3.putBucketPolicy" },
      tagging: { GET: "s3.getBucketTagging", PUT: "s3.putBucketTagging" },
    },
  },
  {
    pattern: ["v1", "storage", "buckets", ":bucket", "objects"],
    methods: { GET: "s3.listObjects" },
  },
  {
    pattern: ["v1", "storage", "buckets", ":bucket", "objects", "*"],
    methods: {
      GET: "s3.getObject",
      PUT: "s3.putObject",
      DELETE: "s3.deleteObject",
      HEAD: "s3.headObject",
    },
    parts: { tagging: { GET: "s3.getObjectTagging", PUT: "s3.putObjectTagging" } },
  },
  { pattern: ["v1", "queues"], methods: { POST: "sqs.createQueue" } },
  {
    pattern: ["v1", "queues", ":queue"],
    methods: { GET: "sqs.getQueueAttributes", DELETE: "sqs.deleteQueue" },
  },
  {
    pattern: ["v1", "queues", ":queue", "messages"],
    methods: { POST: "sqs.sendMessage", GET: "sqs.receiveMessage" },
  },
  { pattern: ["v1", "queues", ":queue", "messages", ":receipt"], methods: { DELETE: "sqs.deleteMessage" } },
  {
    pattern: ["v1", "secrets"],
    methods: { GET: "secretsmanager.listSecrets", POST: "secretsmanager.createSecret" },
  },
  {
    pattern: ["v1", "secrets", ":secret"],
    methods: {
      GET: "secretsmanager.describeSecret",
      PUT: "secretsmanager.putSecretValue",
      DELETE: "secretsmanager.deleteSecret",
    },
    parts: {
      value: { GET: "secretsmanager.getSecretValue" },
      encryption: { PUT: "secretsmanager.putSecretEncryption" },
      rotation: { PUT: "secretsmanager.putSecretRotation" },
    },
  },
  { pattern: ["v1", "metering"], methods: { GET: "ce.getMetering" } },
];

/** Every action some route serves, derived from the table so the two are one list. */
export function servedActions(): readonly string[] {
  const names = new Set<string>();
  for (const spec of ROUTES) {
    for (const action of Object.values(spec.methods)) names.add(action);
    if (spec.parts === undefined) continue;
    for (const table of Object.values(spec.parts)) {
      for (const action of Object.values(table)) names.add(action);
    }
  }
  return sorted(names);
}

/**
 * Why this request target is not one this world serves, or `null` when it is.
 *
 * This is the *one* implementation of "is this address mine", and it has two callers on purpose.
 * {@link HttpCloud} refuses a request that fails it, and the adapter asks it before a `call` step so
 * that the same target is also recorded as a boundary crossing - because a criterion aiming at
 * another host is the one network reach this world can genuinely refuse, and a refusal the boundary
 * report never saw is a refusal the loop cannot use to withhold a `PASS`.
 *
 * Two conditions, and both are about the *target* rather than about reachability:
 *
 *  - A scheme or a leading `//` names a host. `new URL("http://elsewhere.example/v1/metering",
 *    base)` resolves to `/v1/metering`, so before this existed the world answered a request
 *    addressed to somebody else as its own - and recorded it under the path alone, so a reader could
 *    not tell that the criterion had asked elsewhere.
 *  - An unrooted path has no base. `v1/metering` is relative to something this world was never told,
 *    and inventing the base is how a request ends up somewhere nobody named.
 *
 * The HTTP path can never reach either branch: `#handle` builds its path from a `URL` whose base is
 * this world, so a `//`-leading request line arrives already rooted.
 */
export function targetProblem(path: string): string | null {
  const namesAHost = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.startsWith("//");
  if (namesAHost) {
    return (
      `the request path ${JSON.stringify(path)} names a host, and this world serves its own ` +
      "address - a request addressed elsewhere answered here would be a request no client made"
    );
  }
  if (!path.startsWith("/")) {
    return (
      `the request path ${JSON.stringify(path)} is not rooted, and a request target begins with ` +
      "`/` - this world will not invent the address a relative path was relative to"
    );
  }
  return null;
}

/** The address family a refusal can name, derived from the table so the two cannot drift. */
const SERVE_HEADLINES: readonly string[] = [
  "GET /v1/version and GET /v1/identity - what this account is",
  "POST /v1/identity/authorize and /v1/identity/principals - who may do what",
  "/v1/storage/buckets - objects, versioning, encryption, public access, policy and tagging",
  "/v1/queues - messages, attributes and dead-letter configuration",
  "/v1/secrets - versions, encryption and rotation, never a value",
  "GET /v1/metering - requests, objects, bytes and this world's own cost units",
  "a sub-resource is named by a query parameter on the resource it belongs to, so the address for a " +
    'bucket\'s versioning is `/v1/storage/buckets/<bucket>?versioning` and not `.../<bucket>/versioning`',
];

/**
 * A route's pattern as a caller would write it.
 *
 * One function rather than a copy per message, because every refusal that quotes an address has to quote
 * **the same** address - two renderings of one route is two different answers about one world.
 */
const routeAddress = (spec: RouteSpec): string =>
  `/${spec.pattern.map((part) => (part.startsWith(":") ? `<${part.slice(1)}>` : part)).join("/")}`;

const readHeader = (request: CloudRequest, name: string): string | null => {
  const headers = request.headers;
  if (headers === undefined) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
};

/** The body as a JSON object, `{}` when the body is empty, and `null` when it is neither. */
const readJsonObject = (text: string | null | undefined): Record<string, unknown> | null => {
  if (text === null || text === undefined || text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readString = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  return typeof value === "string" ? value : null;
};

const readTags = (value: unknown): Record<string, string> | null => {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const tags: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    tags[key] = entry;
  }
  return tags;
};

/**
 * Read a policy document out of a request body.
 *
 * Every spelling is checked here rather than at evaluation time, so a policy that could never decide
 * anything is refused with a message naming the field - and not accepted into the account, where it
 * would make a later access criterion fail for a reason that looks like an application defect.
 */
const readStatements = (value: unknown): CloudPolicyStatement[] | null => {
  if (!Array.isArray(value)) return null;
  const statements: CloudPolicyStatement[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const effect = entry["effect"];
    const principal = entry["principal"];
    const action = entry["action"];
    const resource = entry["resource"];
    if (typeof effect !== "string" || !(CLOUD_POLICY_EFFECTS as readonly string[]).includes(effect)) {
      return null;
    }
    if (typeof principal !== "string" || typeof action !== "string" || typeof resource !== "string") {
      return null;
    }
    if (actionProblem(action) !== null) return null;
    if (resourceProblem(resource) !== null) return null;
    if (principal !== "*" && nameProblem("principal", principal) !== null) return null;
    statements.push({
      effect: effect as CloudPolicyStatement["effect"],
      principal,
      action,
      resource,
    });
  }
  return statements;
};

// ---------------------------------------------------------------------------------------------
// The substitute.
// ---------------------------------------------------------------------------------------------

class HttpCloud implements CloudPort {
  readonly #identity: CloudIdentity;
  readonly #buckets = new Map<string, StoredBucket>();
  readonly #queues = new Map<string, StoredQueue>();
  readonly #secrets = new Map<string, StoredSecret>();
  readonly #principals = new Map<string, StoredPrincipal>();
  readonly #calls: CloudCallRecord[] = [];
  readonly #decisions: CloudDecisionReading[] = [];
  /** Bytes written by served `putObject` requests. Kept beside the record, never in place of it. */
  #writtenBytes = 0;
  /**
   * Where the account's current life begins in both of those.
   *
   * The meter is a **reading**, and the record is the **record**, and `clear()` has to treat them
   * differently or a criterion built on the meter stops being about the application. Nothing is
   * dropped: the record keeps every request, and these two numbers say which of them the account's
   * current life is answerable for.
   */
  #meterFrom = 0;
  #meterBytesFrom = 0;
  readonly #server: Server;
  #bound: string | null = null;

  constructor(identity: CloudIdentity) {
    const problem = principalProblem(identity.principal);
    if (problem !== null) throw new Error(problem);
    this.#identity = identity;
    this.#principals.set(identity.principal, { name: identity.principal, policies: [], tags: {} });
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.#json(response, 500, { kind: "Error", reason: "InternalError", message }, false);
      });
    });
  }

  identity(): CloudIdentity {
    return this.#identity;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle.
  // -------------------------------------------------------------------------------------------

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
      throw new Error("the substitute API server bound to an address it cannot describe");
    }
    this.#bound = `http://${address.host}:${String(bound.port)}`;
    return this.#bound;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      this.#server.closeAllConnections();
    });
    this.#bound = null;
  }

  // -------------------------------------------------------------------------------------------
  // The records.
  // -------------------------------------------------------------------------------------------

  calls(): readonly CloudCallRecord[] {
    return [...this.#calls];
  }

  decisions(): readonly CloudDecisionReading[] {
    return [...this.#decisions];
  }

  /**
   * The meter.
   *
   * `requests` counts the whole request record and `objects` counts the `putObject` requests that were
   * *served*, so a refused write costs a request and stores nothing - which is what a provider bills
   * and what a criterion asking "did the application write more than it was asked to" needs. `bytes`
   * sums the lengths this world received, accumulated as the requests arrived rather than read off the
   * current state, because a `deleteObject` would have destroyed the state a later read would need.
   *
   * **A request that only asks the meter is not counted.** The meter is read off the request record,
   * and reading it appends to that record, so counting the read gave a reading that changed every time
   * it was taken: the first `GET /v1/metering` answered `requests: 2`, the second `3`, and a criterion
   * asking about the meter was therefore judged differently depending on how many times it had been
   * asked. `requests` is now the record's length less the metering reads in it, which makes the
   * reading a function of what the workload did to the account rather than of how often it was
   * inspected - the same property `#decide` had to be given (a read must not change what it reads).
   * The subtraction is on this side of the derivation only: the *record* still holds every request,
   * because a bundle a reader audits must not be short of the one request that asked.
   *
   * **The meter is scoped to the account's current life, and the record it is read from is not.**
   * `clear()` moves the baseline rather than the record, so an iteration's meter answers what *that*
   * attempt cost. Measured before this: the canonical `sim-cloud` demo's fourth criterion reported
   * `objects` as `1, 2, 3, 4, 5` across five iterations of the *same* correct provisioning program, so
   * a contract saying "this application writes one object" could pass on iteration one and never again
   * - a verdict decided by how many attempts came before rather than by what the software did, which is
   * the one thing a criterion must never be. The general rule is in the file header: a reset restores
   * the world and not the record, and the meter is the world's.
   */
  meters(): CloudMeterReading {
    let objects = 0;
    let inspections = 0;
    for (const call of this.#calls.slice(this.#meterFrom)) {
      if (call.action === "s3.putObject" && call.result === "ok") objects += 1;
      if (call.action === "ce.getMetering") inspections += 1;
    }
    const requests = this.#calls.length - this.#meterFrom - inspections;
    const bytes = this.#writtenBytes - this.#meterBytesFrom;
    const costUnits =
      requests * COST_UNITS.perRequest +
      objects * COST_UNITS.perObject +
      Math.ceil(bytes / COST_UNITS.bytesPerUnit);
    return { requests, objects, bytes, costUnits };
  }

  // -------------------------------------------------------------------------------------------
  // The state record.
  // -------------------------------------------------------------------------------------------

  snapshot(): CloudSnapshot {
    const buckets: CloudBucketReading[] = [];
    const objects: CloudObjectReading[] = [];
    for (const name of sorted(this.#buckets.keys())) {
      const bucket = this.#buckets.get(name);
      if (bucket === undefined) continue;
      buckets.push(this.#bucketReading(bucket));
      for (const key of sorted(bucket.objects.keys())) {
        const object = bucket.objects.get(key);
        if (object === undefined) continue;
        objects.push(this.#objectReading(key, object, bucket.name));
      }
    }
    const queues = sorted(this.#queues.keys()).flatMap((name) => {
      const queue = this.#queues.get(name);
      return queue === undefined ? [] : [this.#queueReading(queue)];
    });
    const secrets = sorted(this.#secrets.keys()).flatMap((name) => {
      const secret = this.#secrets.get(name);
      return secret === undefined ? [] : [this.#secretReading(secret)];
    });
    const principals = sorted(this.#principals.keys()).flatMap((name) => {
      const principal = this.#principals.get(name);
      return principal === undefined ? [] : [this.#principalReading(principal)];
    });
    return { buckets, objects, queues, secrets, principals };
  }

  /**
   * Empty the account, and start its meter over.
   *
   * The declared identity survives, because it is what the account *is* rather than something the run
   * provisioned - an account with no identity could not answer the next request at all. Both records
   * survive, on purpose and for the reason in the file header.
   *
   * The meter does **not** survive, and that is the one place the record and the reading have to
   * disagree: a validator must never inherit contaminated state from a previous iteration, and a
   * meter that kept counting would make every criterion built on it a function of the iteration
   * number. The baseline moves and nothing is removed, so `calls()` still holds every request and
   * `meters()` describes the account this iteration is about.
   */
  clear(): void {
    this.#buckets.clear();
    this.#queues.clear();
    this.#secrets.clear();
    this.#principals.clear();
    this.#principals.set(this.#identity.principal, {
      name: this.#identity.principal,
      policies: [],
      tags: {},
    });
    this.#meterFrom = this.#calls.length;
    this.#meterBytesFrom = this.#writtenBytes;
  }

  /**
   * The stored state, as a document.
   *
   * The stored shape rather than the derived readings, and that distinction is the reason an account
   * can be restored at all: a reading has already collapsed the write counter, the effective encryption
   * and the version list into fields a reader wants, and a restore from a reading would lose the
   * counter that makes the next version identifier what it should be. Both records are deliberately
   * excluded - a snapshot restores the world, it does not restore the record of what the run did to it.
   */
  dump(): string {
    const buckets = [...this.#buckets.values()].map((bucket) => ({
      name: bucket.name,
      region: bucket.region,
      versioning: bucket.versioning,
      encryption: bucket.encryption,
      publicAccessBlocked: bucket.publicAccessBlocked,
      policy: bucket.policy,
      tags: bucket.tags,
      objects: [...bucket.objects.entries()].map(([key, object]) => ({
        key,
        writes: object.writes,
        versions: object.versions,
        tags: object.tags,
      })),
    }));
    const queues = [...this.#queues.values()].map((queue) => ({
      name: queue.name,
      messages: queue.messages,
      inFlight: [...queue.inFlight.entries()].map(([receipt, body]) => ({ receipt, body })),
      deadLetterQueue: queue.deadLetterQueue,
      encryption: queue.encryption,
      visibilityTimeoutSeconds: queue.visibilityTimeoutSeconds,
      attributes: queue.attributes,
      tags: queue.tags,
    }));
    const secrets = [...this.#secrets.values()].map((secret) => ({
      name: secret.name,
      versions: secret.versions,
      rotationEnabled: secret.rotationEnabled,
      encrypted: secret.encrypted,
      tags: secret.tags,
    }));
    const principals = [...this.#principals.values()].map((principal) => ({
      name: principal.name,
      policies: principal.policies,
      tags: principal.tags,
    }));
    return JSON.stringify(
      { kind: "CloudState", version: 1, buckets, queues, secrets, principals },
      null,
      2,
    );
  }

  load(state: string): void {
    const parsed: unknown = JSON.parse(state);
    if (!isRecord(parsed) || parsed["kind"] !== "CloudState") {
      throw new Error("the snapshot is not a cloud state document");
    }
    const buckets = parsed["buckets"];
    const queues = parsed["queues"];
    const secrets = parsed["secrets"];
    const principals = parsed["principals"];
    if (
      !Array.isArray(buckets) ||
      !Array.isArray(queues) ||
      !Array.isArray(secrets) ||
      !Array.isArray(principals)
    ) {
      throw new Error("the snapshot is a cloud state document without the four collections it must hold");
    }
    const identity = this.#identity;
    this.clear();
    for (const entry of buckets) {
      if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
      const objects = new Map<string, StoredObject>();
      const rawObjects = entry["objects"];
      if (Array.isArray(rawObjects)) {
        for (const raw of rawObjects) {
          if (!isRecord(raw) || typeof raw["key"] !== "string") continue;
          const versions = readStoredVersions(raw["versions"]);
          objects.set(raw["key"], {
            writes: typeof raw["writes"] === "number" ? raw["writes"] : versions.length,
            versions,
            tags: readTags(raw["tags"]) ?? {},
          });
        }
      }
      this.#buckets.set(entry["name"], {
        name: entry["name"],
        region: typeof entry["region"] === "string" ? entry["region"] : identity.region,
        versioning: readVersioning(entry["versioning"]),
        encryption: readAlgorithm(entry["encryption"]),
        publicAccessBlocked:
          typeof entry["publicAccessBlocked"] === "boolean" ? entry["publicAccessBlocked"] : null,
        policy: readStatements(entry["policy"]) ?? [],
        tags: readTags(entry["tags"]) ?? {},
        objects,
      });
    }
    for (const entry of queues) {
      if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
      const inFlight = new Map<string, string>();
      const rawInFlight = entry["inFlight"];
      if (Array.isArray(rawInFlight)) {
        for (const raw of rawInFlight) {
          if (!isRecord(raw) || typeof raw["receipt"] !== "string" || typeof raw["body"] !== "string") {
            continue;
          }
          inFlight.set(raw["receipt"], raw["body"]);
        }
      }
      const messages = entry["messages"];
      this.#queues.set(entry["name"], {
        name: entry["name"],
        messages: Array.isArray(messages)
          ? messages.filter((message): message is string => typeof message === "string")
          : [],
        inFlight,
        deadLetterQueue: typeof entry["deadLetterQueue"] === "string" ? entry["deadLetterQueue"] : null,
        encryption: readAlgorithm(entry["encryption"]),
        visibilityTimeoutSeconds:
          typeof entry["visibilityTimeoutSeconds"] === "number" ? entry["visibilityTimeoutSeconds"] : 30,
        attributes: readTags(entry["attributes"]) ?? {},
        tags: readTags(entry["tags"]) ?? {},
      });
    }
    for (const entry of secrets) {
      if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
      this.#secrets.set(entry["name"], {
        name: entry["name"],
        versions: readStoredVersions(entry["versions"]),
        rotationEnabled: entry["rotationEnabled"] === true,
        encrypted: entry["encrypted"] === true,
        tags: readTags(entry["tags"]) ?? {},
      });
    }
    for (const entry of principals) {
      if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
      const policies: StoredPolicy[] = [];
      const rawPolicies = entry["policies"];
      if (Array.isArray(rawPolicies)) {
        for (const raw of rawPolicies) {
          if (!isRecord(raw) || typeof raw["name"] !== "string") continue;
          const statements = readStatements(raw["statements"]);
          if (statements === null) continue;
          policies.push({ name: raw["name"], statements });
        }
      }
      this.#principals.set(entry["name"], {
        name: entry["name"],
        policies,
        tags: readTags(entry["tags"]) ?? {},
      });
    }
    if (!this.#principals.has(identity.principal)) {
      this.#principals.set(identity.principal, { name: identity.principal, policies: [], tags: {} });
    }
  }

  // -------------------------------------------------------------------------------------------
  // The in-process entry point.
  // -------------------------------------------------------------------------------------------

  /**
   * Put one request to the world without opening a socket.
   *
   * This is how a criterion's `call` step reaches the account. It runs the *same* path the HTTP handler
   * runs, so a refusal a criterion observes is a refusal the application would have received - two
   * implementations of one rule disagree the first time a world arrives that only one of them was
   * written for, and a criterion judged against a request path the application never uses is a
   * criterion judging a world that does not exist.
   */
  call(request: CloudRequest, source: CloudCallSource): CloudCallOutcome {
    return this.#invoke(request, source);
  }

  // -------------------------------------------------------------------------------------------
  // HTTP.
  // -------------------------------------------------------------------------------------------

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    const url = new URL(request.url ?? "/", "http://cloud.invalid");
    const body = method === "GET" || method === "HEAD" ? null : await this.#readBody(request);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
    const sender = readHeader({ method, path: url.pathname, headers }, HEADER_PRINCIPAL);
    const forwarded: CloudRequest = {
      method,
      path: `${url.pathname}${url.search}`,
      body,
      headers,
      ...(sender === null ? {} : { principal: sender }),
    };
    const outcome = this.#invoke(forwarded, "application");
    if (outcome.body === "") {
      response.writeHead(outcome.status ?? 500, { "content-length": 0 });
      response.end();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.body);
    } catch {
      parsed = outcome.body;
    }
    this.#json(response, outcome.status ?? 500, parsed, method === "HEAD");
  }

  #json(response: ServerResponse, code: number, body: unknown, head: boolean): void {
    const payload = JSON.stringify(body);
    // A HEAD's answer is the object's reading *without its contents*, so the body a GET at the same
    // address would send is a different message - and a `content-length` on a HEAD is defined to
    // describe exactly that GET body, not the one this answer built. Reporting this answer's own
    // envelope length said `231` for an object whose GET answers `2241`, which is a header a real
    // client sizes a read from. This world states no length for a body it did not send.
    if (head) {
      response.writeHead(code, { "content-type": "application/json" });
      response.end();
      return;
    }
    response.writeHead(code, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }

  #readBody(request: IncomingMessage): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text === "" ? null : text);
      });
      request.on("error", () => resolve(null));
    });
  }

  // -------------------------------------------------------------------------------------------
  // The one request path, shared by HTTP and by the in-process entry point.
  // -------------------------------------------------------------------------------------------

  /**
   * Answer one request, and record it.
   *
   * Every path through this method records, including every refusal - a criterion's whole point may be
   * that the application's own provisioner is supposed to notice a refusal, and a world that swallowed
   * one would let that criterion pass on a request it never accepted.
   */
  #invoke(request: CloudRequest, source: CloudCallSource): CloudCallOutcome {
    const method = request.method.toUpperCase();
    const caller = request.principal ?? this.#identity.principal;
    // A GET and a HEAD carry no body. HTTP says so, `#handle` never reads one for them, and a client
    // cannot send one at all - `fetch` and `undici` refuse outright. So an in-process `call` carrying
    // one is a request **no client could have made**, which is the same class as a request addressed
    // to another host, and it is refused rather than quietly stripped. Stripping it would judge the
    // criterion on a request it did not write, record a request it did not write either, and leave
    // the body it named nowhere in the evidence - and the entry point it arrives through is the one a
    // criterion's `call` step uses, so a divergence here is a criterion judging a world that does not
    // exist. The HTTP path can never reach this branch.
    if ((method === "GET" || method === "HEAD") && (request.body ?? "") !== "") {
      const why =
        `the request carries a body on ${method}, and a ${method} carries none - a request no ` +
        "client could have made is refused rather than answered with the body it named dropped";
      return this.#record(
        source,
        method,
        request.path,
        caller,
        "",
        null,
        { result: "invalid", status: 400, reason: why },
        refusalBody("BadRequest", 400, why),
      );
    }
    // A request's path is a *request target*, and this world serves its own address. Parsed with a
    // base, `http://elsewhere.example/v1/metering` was accepted and answered as this world's own
    // `/v1/metering` - a request addressed to a different host, answered by this one, and recorded
    // under the path alone so a reader could not see that the criterion had asked someone else. An
    // absolute URL or an authority-relative reference is a question about a world this one is not, so
    // it is refused by name. The HTTP path can never reach this branch: `#handle` builds it from a
    // `URL` whose host is this world, so a `//`-leading request line arrives here already rooted.
    //
    // The rule is one function rather than two conditions, because the *adapter* needs the same
    // answer: a `call` step naming a foreign host is the one network reach this world can genuinely
    // refuse, and it is recorded as a boundary crossing. Two copies of this test would disagree the
    // first time one of them was extended, and the copy in the adapter would then be enforcing a
    // boundary the port did not hold - which is the defect the project has paid for twice already.
    const problem = targetProblem(request.path);
    if (problem !== null) {
      return this.#record(
        source,
        method,
        request.path,
        caller,
        "",
        null,
        { result: "invalid", status: 400, reason: problem },
        refusalBody("BadRequest", 400, problem),
      );
    }
    let url: URL;
    try {
      url = new URL(request.path, "http://cloud.invalid");
    } catch {
      const why = "the request path cannot be read as a URL";
      return this.#record(
        source,
        method,
        request.path,
        caller,
        "",
        null,
        { result: "invalid", status: 400, reason: why },
        refusalBody("BadRequest", 400, why),
      );
    }
    const path = url.pathname;
    const segments: string[] = [];
    for (const raw of path.split("/")) {
      if (raw === "") continue;
      try {
        segments.push(decodeURIComponent(raw));
      } catch {
        const why = `the path segment ${JSON.stringify(raw)} is not valid percent-encoding`;
        return this.#record(
          source,
          method,
          path,
          caller,
          "",
          null,
          { result: "invalid", status: 400, reason: why },
          refusalBody("BadRequest", 400, why),
        );
      }
    }
    const parts = [...url.searchParams.keys()];
    const match = this.#match(segments);
    if (match === null) {
      const misplaced = this.#misplacedSubResource(segments);
      const why =
        misplaced === null
          ? `this world serves no route ${JSON.stringify(path)}. It serves: ${SERVE_HEADLINES.join("; ")}` +
            " - a route it does not serve is reported as unsupported rather than as a missing resource, " +
            "because a reader sent looking for a resource that was never the question would be sent to " +
            "the wrong file"
          : `${misplaced.address} has no path segment named ` +
            `${JSON.stringify(misplaced.segment)}: its sub-resources (${misplaced.held.join(", ")}) are ` +
            `named by a query parameter, so the address for ${JSON.stringify(misplaced.segment)} is ` +
            `${misplaced.address}?${misplaced.segment}. A sub-resource addressed as a path segment ` +
            "matches no route at all, and reporting that as a route this world does not serve would " +
            "name a cause narrower than the one observed";
      return this.#record(
        source,
        method,
        path,
        caller,
        "",
        null,
        { result: "unsupported", status: 404, reason: why },
        refusalBody("NoSuchRoute", 404, why),
      );
    }
    const resource = this.#resourceFor(match);
    const named = this.#actionFor(match, method, parts);
    if (typeof named !== "string") {
      return this.#record(
        source,
        method,
        path,
        caller,
        "",
        resource,
        { result: named.result, status: named.code, reason: `${named.reason}: ${named.message}` },
        { kind: "Error", reason: named.reason, status: named.code, message: named.message },
      );
    }
    const action = named;
    if (!this.#principals.has(caller)) {
      return this.#record(source, method, path, caller, action, resource, {
        result: "invalid",
        status: 400,
        reason:
          `the request named ${JSON.stringify(caller)} as the caller, and this account holds no such ` +
          "principal - a request from an identity the account does not hold is refused rather than " +
          "answered as the declared identity, because a world that answered it would report a " +
          "permission the caller does not have",
      });
    }
    if (caller !== this.#identity.principal && !GATE_EXEMPT.has(action)) {
      const decision = this.#decide(caller, action, resource ?? "*");
      if (!decision.allowed) {
        return this.#record(source, method, path, caller, action, resource, {
          result: "refused",
          status: 403,
          reason:
            `this account refused ${action} on ${resource ?? "*"} for ${caller}: no statement covers ` +
            `it, and the deciding entry is ${JSON.stringify(decision.entry)}`,
        });
      }
    }
    let outcome: HandlerResult;
    try {
      outcome = this.#dispatch(action, match, request, url);
    } catch (error) {
      outcome = crashed(error instanceof Error ? error.message : String(error));
    }
    const resolved = outcome.resource ?? resource;
    if (outcome.outcome === "refused") {
      const refusal = outcome.refusal;
      return this.#record(
        source,
        method,
        path,
        caller,
        action,
        resolved,
        { result: refusal.result, status: refusal.code, reason: `${refusal.reason}: ${refusal.message}` },
        { kind: "Error", reason: refusal.reason, status: refusal.code, message: refusal.message },
      );
    }
    if (action === "s3.putObject") {
      this.#writtenBytes += bytesOf(request.body ?? "");
    }
    return this.#record(
      source,
      method,
      path,
      caller,
      action,
      resolved,
      { result: "ok", status: outcome.status, reason: null },
      outcome.body,
    );
  }

  #record(
    source: CloudCallSource,
    method: string,
    path: string,
    principal: string,
    action: string,
    resource: string | null,
    outcome: { readonly result: CloudCallResult; readonly status: number; readonly reason: string | null },
    body?: unknown,
  ): CloudCallOutcome {
    this.#calls.push({
      source,
      action,
      method,
      path,
      principal,
      resource,
      result: outcome.result,
      status: outcome.status,
      reason: outcome.reason,
      durationMs: 0,
    });
    return {
      action,
      resource,
      result: outcome.result,
      status: outcome.status,
      reason: outcome.reason,
      body: body === undefined ? "" : JSON.stringify(body),
    };
  }

  #match(segments: readonly string[]): Match | null {
    for (const spec of ROUTES) {
      const captured: Record<string, string> = {};
      let index = 0;
      let ok = true;
      for (const part of spec.pattern) {
        if (part === "*") {
          const rest = segments.slice(index);
          if (rest.length === 0) {
            ok = false;
            break;
          }
          captured["*"] = rest.join("/");
          index = segments.length;
          break;
        }
        const value = segments[index];
        if (value === undefined) {
          ok = false;
          break;
        }
        if (part.startsWith(":")) captured[part.slice(1)] = value;
        else if (part !== value) {
          ok = false;
          break;
        }
        index += 1;
      }
      if (ok && index === segments.length) return { spec, captured };
    }
    return null;
  }

  /**
   * Which action a request names, or a refusal naming what the route does serve.
   *
   * The three cases are deliberately distinct, and each has its own status. A path matching no route at
   * all is a **404** naming what this world serves. A path matching a route whose sub-resource name is
   * not one it holds is a **501** - the resource is right there and it is the question that cannot be
   * asked. A route and a sub-resource that both exist, reached with a method neither serves, is a
   * **405**. Collapsing any two of them answers with a message naming a cause the server had not
   * observed, which is the defect the cluster substitute paid for: a request for an object the cluster
   * did not hold came back as `GET is not supported`, sending the reader to inspect their method.
   */
  #actionFor(match: Match, method: string, parts: readonly string[]): CloudAction | Refusal {
    const spec = match.spec;
    const address = routeAddress(spec);
    const part = parts.length === 0 ? null : (parts[0] ?? null);
    if (parts.length > 1) {
      return {
        result: "unsupported",
        code: 501,
        reason: "NotImplemented",
        message:
          `${address} names one sub-resource and received ${String(parts.length)} (${parts.join(", ")}). ` +
          "A request naming two is answered as an unserved question rather than by silently reading the " +
          "first, because a criterion built on the second would be judged against a resource it never " +
          "asked for",
      };
    }
    if (part !== null) {
      const table = spec.parts === undefined ? undefined : spec.parts[part];
      if (table === undefined) {
        const known = spec.parts === undefined ? [] : sorted(Object.keys(spec.parts));
        const serves =
          known.length === 0
            ? "it holds no sub-resource at all"
            : `it holds ${known.join(", ")}`;
        return {
          result: "unsupported",
          code: 501,
          reason: "NotImplemented",
          message:
            `${address} does not hold a sub-resource named ${JSON.stringify(part)} - ${serves}. This is ` +
            "reported as an unsupported question rather than as a missing resource, because the resource " +
            "is right there and it is the question that cannot be asked",
        };
      }
      const found = table[method];
      if (found === undefined) {
        return {
          result: "unsupported",
          code: 405,
          reason: "MethodNotAllowed",
          message:
            `${method} is not supported for ${address}?${part}; that sub-resource serves ` +
            `${sorted(Object.keys(table)).join(", ")}`,
        };
      }
      return found;
    }
    const found = spec.methods[method];
    if (found === undefined) {
      const extra =
        spec.parts === undefined
          ? ""
          : `, and its sub-resources (${sorted(Object.keys(spec.parts)).join(", ")}) are named by a ` +
            "query parameter";
      return {
        result: "unsupported",
        code: 405,
        reason: "MethodNotAllowed",
        message:
          `${method} is not supported for ${address}; this resource serves ` +
          `${sorted(Object.keys(spec.methods)).join(", ")}${extra}`,
      };
    }
    return found;
  }

  /**
   * The sub-resource a caller addressed as a *path segment* instead of as a query parameter, if that is
   * what they did.
   *
   * Every route's sub-resources are reached as `?name` on the resource they belong to, and the reason is
   * recorded on `RouteSpec.parts`. A bare `404` cannot convey that, though, and this world is a
   * substitute whose **client is a program being judged** - so the one wrong spelling it can identify is
   * identified rather than left as "this world serves no route".
   *
   * It was found by the provisioning program in `examples/sim-cloud/app/`, which addressed five
   * sub-resources as path segments. The first one answered `404` with an empty body and the world's own
   * explanation - naming neither the route to use nor the spelling - went nowhere; the run ended
   * `INCONCLUSIVE` at zero iterations, which is what a diagnosis that names nothing buys.
   *
   * Only a **trailing** segment is considered. `PUT /objects/<key>/tagging` is not treated as a
   * misplaced sub-resource even though it looks like one, because the object route's `*` legitimately
   * swallows the whole remainder as the key - see the `parts` comment on {@link RouteSpec} - so the
   * request is a write to the key `<key>/tagging` and a world that guessed otherwise would be inventing
   * a route. Everything else is answered with the generic unserved-route message.
   */
  #misplacedSubResource(
    segments: readonly string[],
  ): { readonly segment: string; readonly address: string; readonly held: readonly string[] } | null {
    if (segments.length < 2) return null;
    const trailing = segments[segments.length - 1];
    if (trailing === undefined) return null;
    const shorter = this.#match(segments.slice(0, -1));
    if (shorter === null) return null;
    const parts = shorter.spec.parts;
    if (parts === undefined || !Object.hasOwn(parts, trailing)) return null;
    return { segment: trailing, address: routeAddress(shorter.spec), held: sorted(Object.keys(parts)) };
  }

  #resourceFor(match: Match): string | null {
    const captured = match.captured;
    const bucket = captured["bucket"];
    const key = captured["*"];
    if (bucket !== undefined && key !== undefined) return `object/${bucket}/${key}`;
    if (bucket !== undefined) return `bucket/${bucket}`;
    const principal = captured["principal"];
    if (principal !== undefined) return `principal/${principal}`;
    const queue = captured["queue"];
    if (queue !== undefined) return `queue/${queue}`;
    const secret = captured["secret"];
    if (secret !== undefined) return `secret/${secret}`;
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // The dispatcher.
  // -------------------------------------------------------------------------------------------

  #dispatch(action: CloudAction, match: Match, request: CloudRequest, url: URL): HandlerResult {
    const captured = match.captured;
    const bucketName = captured["bucket"];
    const key = captured["*"];
    const principalName = captured["principal"];
    const queueName = captured["queue"];
    const secretName = captured["secret"];
    const receipt = captured["receipt"];
    switch (action) {
      case "provider.describe":
      case "sts.getCallerIdentity":
        return answered(null, 200, {
          provider: this.#identity.provider,
          region: this.#identity.region,
          account: this.#identity.account,
          principal: this.#identity.principal,
          simulated: CLOUD_SIMULATED_SURFACES,
          costModel: COST_MODEL,
        });
      case "ce.getMetering":
        return answered(null, 200, this.meters());
      case "iam.authorize":
        return this.#authorize(request);
      case "iam.getPrincipal":
        return principalName === undefined
          ? answered(null, 200, { principals: sorted(this.#principals.keys()) })
          : this.#readPrincipal(principalName);
      case "iam.createPrincipal":
        return this.#createPrincipal(request);
      case "iam.deletePrincipal":
        return principalName === undefined
          ? impossible(action)
          : this.#deletePrincipal(principalName);
      case "iam.putPrincipalPolicy":
        return principalName === undefined
          ? impossible(action)
          : this.#putPrincipalPolicy(principalName, request);
      case "iam.deletePrincipalPolicy":
        return principalName === undefined
          ? impossible(action)
          : this.#deletePrincipalPolicy(principalName, url);
      case "s3.listObjects":
        return bucketName === undefined
          ? answered(null, 200, { buckets: sorted(this.#buckets.keys()) })
          : this.#listObjects(bucketName);
      case "s3.headBucket":
        return bucketName === undefined ? impossible(action) : this.#headBucket(bucketName);
      case "s3.createBucket":
        return this.#createBucket(request);
      case "s3.deleteBucket":
        return bucketName === undefined ? impossible(action) : this.#deleteBucket(bucketName);
      case "s3.getBucketVersioning":
        return bucketName === undefined ? impossible(action) : this.#readVersioning(bucketName);
      case "s3.putBucketVersioning":
        return bucketName === undefined ? impossible(action) : this.#putVersioning(bucketName, request);
      case "s3.getBucketEncryption":
        return bucketName === undefined ? impossible(action) : this.#readBucketEncryption(bucketName);
      case "s3.putBucketEncryption":
        return bucketName === undefined
          ? impossible(action)
          : this.#putBucketEncryption(bucketName, request);
      case "s3.getPublicAccessBlock":
        return bucketName === undefined ? impossible(action) : this.#readPublicAccess(bucketName);
      case "s3.putPublicAccessBlock":
        return bucketName === undefined ? impossible(action) : this.#putPublicAccess(bucketName, request);
      case "s3.getBucketPolicy":
        return bucketName === undefined ? impossible(action) : this.#readBucketPolicy(bucketName);
      case "s3.putBucketPolicy":
        return bucketName === undefined ? impossible(action) : this.#putBucketPolicy(bucketName, request);
      case "s3.getBucketTagging":
        return bucketName === undefined ? impossible(action) : this.#readBucketTags(bucketName);
      case "s3.putBucketTagging":
        return bucketName === undefined ? impossible(action) : this.#putBucketTags(bucketName, request);
      case "s3.putObject":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#putObject(bucketName, key, request);
      case "s3.getObject":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#getObject(bucketName, key);
      case "s3.headObject":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#headObject(bucketName, key);
      case "s3.deleteObject":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#deleteObject(bucketName, key);
      case "s3.getObjectTagging":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#readObjectTags(bucketName, key);
      case "s3.putObjectTagging":
        return bucketName === undefined || key === undefined
          ? impossible(action)
          : this.#putObjectTags(bucketName, key, request);
      case "sqs.createQueue":
        return this.#createQueue(request);
      case "sqs.getQueueAttributes":
        return queueName === undefined ? impossible(action) : this.#readQueue(queueName);
      case "sqs.deleteQueue":
        return queueName === undefined ? impossible(action) : this.#deleteQueue(queueName);
      case "sqs.sendMessage":
        return queueName === undefined ? impossible(action) : this.#sendMessage(queueName, request);
      case "sqs.receiveMessage":
        return queueName === undefined ? impossible(action) : this.#receiveMessage(queueName);
      case "sqs.deleteMessage":
        return queueName === undefined || receipt === undefined
          ? impossible(action)
          : this.#deleteMessage(queueName, receipt);
      case "secretsmanager.listSecrets":
        return answered(null, 200, { secrets: sorted(this.#secrets.keys()) });
      case "secretsmanager.createSecret":
        return this.#createSecret(request);
      case "secretsmanager.describeSecret":
        return secretName === undefined ? impossible(action) : this.#readSecret(secretName);
      case "secretsmanager.deleteSecret":
        return secretName === undefined ? impossible(action) : this.#deleteSecret(secretName);
      case "secretsmanager.putSecretValue":
        return secretName === undefined ? impossible(action) : this.#putSecretValue(secretName, request);
      case "secretsmanager.getSecretValue":
        return secretName === undefined ? impossible(action) : this.#getSecretValue(secretName);
      case "secretsmanager.putSecretEncryption":
        return secretName === undefined
          ? impossible(action)
          : this.#putSecretEncryption(secretName, request);
      case "secretsmanager.putSecretRotation":
        return secretName === undefined ? impossible(action) : this.#putSecretRotation(secretName, request);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Identity and authorisation.
  // -------------------------------------------------------------------------------------------

  /**
   * Reach one access decision, and record it.
   *
   * The evaluator's one subtlety: a `deny` that covers the request beats an `allow` that also covers it,
   * whichever came first. Everything else is denied by default, and the deciding statement is recorded
   * in the same spelling `renderPolicy` prints, so a criterion can assert both halves - what was decided
   * and *why* - in one comparison.
   */
  #decide(principal: string, action: string, resource: string): CloudDecisionReading {
    const candidates: CloudPolicyStatement[] = [];
    const held = this.#principals.get(principal);
    if (held !== undefined) for (const policy of held.policies) candidates.push(...policy.statements);
    for (const bucket of sorted(this.#buckets.keys())) {
      const bucketValue = this.#buckets.get(bucket);
      if (bucketValue !== undefined) candidates.push(...bucketValue.policy);
    }
    const matching = candidates.filter(
      (statement) =>
        (statement.principal === "*" || statement.principal === principal) &&
        coversAction(statement.action, action) &&
        covers(statement.resource, resource),
    );
    const deny = matching.find((statement) => statement.effect === "deny");
    const allow = matching.find((statement) => statement.effect === "allow");
    const decided = deny ?? allow;
    const decision: CloudDecisionReading = {
      principal,
      action,
      resource,
      allowed: deny === undefined && allow !== undefined,
      entry: decided === undefined ? "none" : statementSpelling(decided),
      account: this.#identity.account,
    };
    this.#decisions.push(decision);
    return decision;
  }

  /**
   * Answer a question about access, and record the decision it reached.
   *
   * `resource` may be `*`, meaning "any resource", which is how a client asks whether it holds an
   * action at all. Everything else resolves through the family's one reference grammar first, so a
   * question naming a reference this world cannot express is refused as unreadable rather than
   * answered "denied" - the two are indistinguishable in the answer, and only one of them is a fact
   * about the account.
   */
  #authorize(request: CloudRequest): HandlerResult {
    const body = readJsonObject(request.body);
    if (body === null) return invalid(null, "the request body is not a JSON object", 400, "BadRequest");
    const principal = readString(body, "principal");
    const action = readString(body, "action");
    const resource = readString(body, "resource");
    if (principal === null || action === null || resource === null) {
      return invalid(
        null,
        "an authorisation question names three things - principal, action and resource - and the body " +
          `this world received (${JSON.stringify(request.body ?? "")}) does not name all three`,
      );
    }
    if (!this.#principals.has(principal)) {
      return absent(
        `principal/${principal}`,
        `this account holds no principal named ${JSON.stringify(principal)}`,
      );
    }
    if (!isAction(action)) {
      return invalid(
        null,
        `${JSON.stringify(action)} is not an action this world serves; a decision is recorded for one of ` +
          `${CLOUD_ACTION_NAMES.join(", ")}, and a question naming something else would be answered ` +
          '"denied" - which is the same answer a correctly written deny gives, and is therefore the shape ' +
          "of a contract that cannot be read rather than the shape of a refusal",
      );
    }
    if (resource !== "*") {
      const resolved = resolveCloudRef(resource);
      if (resolved.kind === "refused") return invalid(null, resolved.reason);
    }
    const decision = this.#decide(principal, action, resource);
    return answered(`principal/${principal}`, 200, decision);
  }

  #readPrincipal(name: string): HandlerResult {
    const principal = this.#principals.get(name);
    if (principal === undefined) {
      return absent(`principal/${name}`, `this account holds no principal named ${JSON.stringify(name)}`);
    }
    return answered(`principal/${name}`, 200, this.#principalReading(principal));
  }

  #createPrincipal(request: CloudRequest): HandlerResult {
    const body = readJsonObject(request.body);
    if (body === null) return invalid(null, "the request body is not a JSON object", 400, "BadRequest");
    const name = readString(body, "name");
    if (name === null || name.trim() === "") {
      return invalid(null, "creating a principal names one, and the request named none");
    }
    const problem = nameProblem("principal", name);
    if (problem !== null) return invalid(`principal/${name}`, problem);
    const privileged = principalProblem(name);
    if (privileged !== null) return invalid(`principal/${name}`, privileged);
    if (this.#principals.has(name)) {
      return conflicting(
        `principal/${name}`,
        `this account already holds a principal named ${JSON.stringify(name)}`,
      );
    }
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(`principal/${name}`, "tags must be a map of strings to strings");
    this.#principals.set(name, { name, policies: [], tags });
    return answered(`principal/${name}`, 201, { name, created: true });
  }

  #deletePrincipal(name: string): HandlerResult {
    if (name === this.#identity.principal) {
      return conflicting(
        `principal/${name}`,
        "the principal the application authenticated as cannot be deleted from this account; a world " +
          "whose own caller can be removed is a world whose next request arrives without an identity",
      );
    }
    if (!this.#principals.delete(name)) {
      return absent(`principal/${name}`, `this account holds no principal named ${JSON.stringify(name)}`);
    }
    return answered(`principal/${name}`, 200, { name, deleted: true });
  }

  #putPrincipalPolicy(name: string, request: CloudRequest): HandlerResult {
    const principal = this.#principals.get(name);
    if (principal === undefined) {
      return absent(`principal/${name}`, `this account holds no principal named ${JSON.stringify(name)}`);
    }
    const body = readJsonObject(request.body);
    if (body === null) {
      return invalid(`principal/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    }
    const policyName = readString(body, "name");
    if (policyName === null || policyName.trim() === "") {
      return invalid(`principal/${name}`, "an attached policy has a name, and the request named none");
    }
    const statements = readStatements(body["statements"]);
    if (statements === null) {
      return invalid(
        `principal/${name}`,
        "statements must be an array of {effect, principal, action, resource}, where effect is " +
          `${CLOUD_POLICY_EFFECTS.join(" or ")}, the principal is a name this world can express or "*", ` +
          "the action is one this world serves or a service with a trailing .* and the resource is a " +
          "reference this world can express or a reference with a trailing /*",
      );
    }
    const existing = principal.policies.findIndex((policy) => policy.name === policyName);
    if (existing === -1) principal.policies.push({ name: policyName, statements });
    else principal.policies[existing] = { name: policyName, statements };
    return answered(`principal/${name}`, 200, { name, policy: policyName, statements: statements.length });
  }

  #deletePrincipalPolicy(name: string, url: URL): HandlerResult {
    const principal = this.#principals.get(name);
    if (principal === undefined) {
      return absent(`principal/${name}`, `this account holds no principal named ${JSON.stringify(name)}`);
    }
    const policyName = url.searchParams.get("policy");
    if (policyName === null || policyName === "") {
      return invalid(
        `principal/${name}`,
        "detaching a policy names it (?policy=<name>), and the request named none - a detach that named " +
          "nothing would have to mean every policy, and there is no way to tell the two apart in the " +
          "record afterwards",
      );
    }
    const index = principal.policies.findIndex((policy) => policy.name === policyName);
    if (index === -1) {
      return absent(
        `principal/${name}`,
        `no policy named ${JSON.stringify(policyName)} is attached to ${JSON.stringify(name)}`,
      );
    }
    principal.policies.splice(index, 1);
    return answered(`principal/${name}`, 200, { name, detached: policyName });
  }

  // -------------------------------------------------------------------------------------------
  // Object storage.
  // -------------------------------------------------------------------------------------------

  #listObjects(bucketName: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    return answered(`bucket/${bucketName}`, 200, {
      bucket: bucketName,
      keys: sorted(held.objects.keys()),
    });
  }

  #headBucket(bucketName: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    return answered(`bucket/${bucketName}`, 200, this.#bucketReading(held));
  }

  #createBucket(request: CloudRequest): HandlerResult {
    const body = readJsonObject(request.body);
    if (body === null) return invalid(null, "the request body is not a JSON object", 400, "BadRequest");
    const name = readString(body, "name");
    if (name === null || name.trim() === "") {
      return invalid(null, "creating a bucket names one, and the request named none");
    }
    const problem = nameProblem("bucket", name);
    if (problem !== null) return invalid(`bucket/${name}`, problem);
    if (this.#buckets.has(name)) {
      return conflicting(
        `bucket/${name}`,
        `this account already holds a bucket named ${JSON.stringify(name)}`,
      );
    }
    const region = readString(body, "region") ?? this.#identity.region;
    if (region !== this.#identity.region) {
      return invalid(
        `bucket/${name}`,
        `this account holds one region, ${JSON.stringify(this.#identity.region)}, and the request named ` +
          `${JSON.stringify(region)}; a bucket in a region the account does not hold is refused rather ` +
          "than silently placed elsewhere, because a criterion asking where the bucket is would then be " +
          "judged against a region the application never asked for",
      );
    }
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(`bucket/${name}`, "tags must be a map of strings to strings");
    const blocked = body["publicAccessBlocked"];
    if (blocked !== undefined && blocked !== null && typeof blocked !== "boolean") {
      return invalid(`bucket/${name}`, "publicAccessBlocked is true, false, or absent");
    }
    this.#buckets.set(name, {
      name,
      region,
      versioning: "never",
      encryption: "none",
      publicAccessBlocked: typeof blocked === "boolean" ? blocked : null,
      policy: [],
      tags,
      objects: new Map<string, StoredObject>(),
    });
    return answered(`bucket/${name}`, 201, { name, region, created: true });
  }

  #deleteBucket(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    if (held.objects.size > 0) {
      return conflicting(
        `bucket/${name}`,
        `bucket ${JSON.stringify(name)} holds ${String(held.objects.size)} object(s); a bucket a reader ` +
          "cannot enter is a bucket whose contents nobody can inspect, so this world refuses the delete " +
          "rather than emptying it on the caller's behalf",
      );
    }
    this.#buckets.delete(name);
    return answered(`bucket/${name}`, 200, { name, deleted: true });
  }

  #readVersioning(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    return answered(`bucket/${name}`, 200, { state: held.versioning });
  }

  #putVersioning(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`bucket/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const state = readString(body, "state");
    if (state === null || !(CLOUD_VERSIONING_STATES as readonly string[]).includes(state)) {
      return invalid(
        `bucket/${name}`,
        `versioning is one of ${CLOUD_VERSIONING_STATES.join(", ")}; this world distinguishes "never" - ` +
          'nothing was ever said - from "suspended", which is a decision, because the two repair ' +
          "differently",
      );
    }
    held.versioning = state as CloudVersioningState;
    return answered(`bucket/${name}`, 200, { state: held.versioning });
  }

  #readBucketEncryption(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    return answered(`bucket/${name}`, 200, { algorithm: held.encryption });
  }

  #putBucketEncryption(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`bucket/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const algorithm = readString(body, "algorithm");
    if (algorithm === null || !(CLOUD_ENCRYPTION_ALGORITHMS as readonly string[]).includes(algorithm)) {
      return invalid(
        `bucket/${name}`,
        `encryption is one of ${CLOUD_ENCRYPTION_ALGORITHMS.join(", ")}; "none" is a decision this world ` +
          "records rather than the absence of a reading",
      );
    }
    held.encryption = algorithm as CloudEncryptionAlgorithm;
    return answered(`bucket/${name}`, 200, { algorithm: held.encryption });
  }

  #readPublicAccess(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    return answered(`bucket/${name}`, 200, { blocked: held.publicAccessBlocked });
  }

  #putPublicAccess(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`bucket/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const blocked = body["blocked"];
    if (blocked !== undefined && typeof blocked !== "boolean") {
      return invalid(`bucket/${name}`, "blocked is true or false, and defaults to true when absent");
    }
    held.publicAccessBlocked = blocked === undefined ? true : blocked;
    return answered(`bucket/${name}`, 200, { blocked: held.publicAccessBlocked });
  }

  #readBucketPolicy(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    if (held.policy.length === 0) {
      return absent(
        `bucket/${name}`,
        `no policy was ever put on bucket ${JSON.stringify(name)}; an absence is a different fact from a ` +
          "policy that allows nothing, and a criterion asking whether the bucket is public needs to be " +
          "able to tell them apart",
        "NoSuchBucketPolicy",
      );
    }
    return answered(`bucket/${name}`, 200, { statements: held.policy });
  }

  #putBucketPolicy(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`bucket/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const statements = readStatements(body["statements"]);
    if (statements === null) {
      return invalid(
        `bucket/${name}`,
        "statements must be an array of {effect, principal, action, resource}, where effect is " +
          `${CLOUD_POLICY_EFFECTS.join(" or ")}, the principal is a name this world can express or "*", ` +
          "the action is one this world serves or a service with a trailing .* and the resource is a " +
          "reference this world can express or a reference with a trailing /*",
      );
    }
    held.policy = statements;
    return answered(`bucket/${name}`, 200, { statements: statements.length });
  }

  #readBucketTags(name: string): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    return answered(`bucket/${name}`, 200, { tags: held.tags });
  }

  #putBucketTags(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(name);
    if (!isBucket(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`bucket/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(`bucket/${name}`, "tags must be a map of strings to strings");
    held.tags = tags;
    return answered(`bucket/${name}`, 200, { tags: held.tags });
  }

  #putObject(bucketName: string, key: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    const requested = readHeader(request, HEADER_ENCRYPTION);
    if (requested !== null && !(CLOUD_ENCRYPTION_ALGORITHMS as readonly string[]).includes(requested)) {
      return invalid(
        resource,
        `${HEADER_ENCRYPTION} is one of ${CLOUD_ENCRYPTION_ALGORITHMS.join(", ")} and received ` +
          `${JSON.stringify(requested)}`,
      );
    }
    const text = request.body ?? "";
    const existing = held.objects.get(key);
    const writes = existing === undefined ? 1 : existing.writes + 1;
    const version: StoredVersion = {
      versionId: `v${String(writes)}`,
      text,
      contentType: "application/octet-stream",
      encryption: requested === null ? held.encryption : (requested as CloudEncryptionAlgorithm),
    };
    const versions =
      held.versioning === "enabled" && existing !== undefined ? [version, ...existing.versions] : [version];
    held.objects.set(key, {
      writes,
      versions,
      tags: existing === undefined ? {} : existing.tags,
    });
    const object = held.objects.get(key);
    if (object === undefined) throw new Error("the object store lost an object it had just written");
    return answered(resource, 200, this.#objectReading(key, object, bucketName));
  }

  #getObject(bucketName: string, key: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    const object = held.objects.get(key);
    if (object === undefined) {
      return absent(
        resource,
        `bucket ${JSON.stringify(bucketName)} holds no object under key ${JSON.stringify(key)}`,
      );
    }
    const newest = object.versions[0];
    if (newest === undefined) {
      return absent(resource, `the object under key ${JSON.stringify(key)} holds no version at all`);
    }
    return answered(resource, 200, { ...this.#objectReading(key, object, bucketName), body: newest.text });
  }

  #headObject(bucketName: string, key: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    const object = held.objects.get(key);
    if (object === undefined) {
      return absent(
        resource,
        `bucket ${JSON.stringify(bucketName)} holds no object under key ${JSON.stringify(key)}`,
      );
    }
    return answered(resource, 200, this.#objectReading(key, object, bucketName));
  }

  #deleteObject(bucketName: string, key: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    if (!held.objects.delete(key)) {
      return absent(
        resource,
        `bucket ${JSON.stringify(bucketName)} holds no object under key ${JSON.stringify(key)}`,
      );
    }
    return answered(resource, 200, { bucket: bucketName, key, deleted: true });
  }

  #readObjectTags(bucketName: string, key: string): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    const object = held.objects.get(key);
    if (object === undefined) {
      return absent(
        resource,
        `bucket ${JSON.stringify(bucketName)} holds no object under key ${JSON.stringify(key)}`,
      );
    }
    return answered(resource, 200, { tags: object.tags });
  }

  #putObjectTags(bucketName: string, key: string, request: CloudRequest): HandlerResult {
    const held = this.#requireBucket(bucketName);
    if (!isBucket(held)) return held;
    const resource = `object/${bucketName}/${key}`;
    const object = held.objects.get(key);
    if (object === undefined) {
      return absent(
        resource,
        `bucket ${JSON.stringify(bucketName)} holds no object under key ${JSON.stringify(key)}`,
      );
    }
    const body = readJsonObject(request.body);
    if (body === null) return invalid(resource, "the request body is not a JSON object", 400, "BadRequest");
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(resource, "tags must be a map of strings to strings");
    object.tags = tags;
    return answered(resource, 200, { tags: object.tags });
  }

  // -------------------------------------------------------------------------------------------
  // Queues.
  // -------------------------------------------------------------------------------------------

  #createQueue(request: CloudRequest): HandlerResult {
    const body = readJsonObject(request.body);
    if (body === null) return invalid(null, "the request body is not a JSON object", 400, "BadRequest");
    const name = readString(body, "name");
    if (name === null || name.trim() === "") {
      return invalid(null, "creating a queue names one, and the request named none");
    }
    const problem = nameProblem("queue", name);
    if (problem !== null) return invalid(`queue/${name}`, problem);
    if (this.#queues.has(name)) {
      return conflicting(`queue/${name}`, `this account already holds a queue named ${JSON.stringify(name)}`);
    }
    const dead = body["deadLetterQueue"];
    if (dead !== undefined && dead !== null && typeof dead !== "string") {
      return invalid(`queue/${name}`, "deadLetterQueue is a queue name, or absent");
    }
    if (typeof dead === "string") {
      const deadProblem = nameProblem("queue", dead);
      if (deadProblem !== null) return invalid(`queue/${name}`, deadProblem);
    }
    const encryption = readString(body, "encryption") ?? "none";
    if (!(CLOUD_ENCRYPTION_ALGORITHMS as readonly string[]).includes(encryption)) {
      return invalid(
        `queue/${name}`,
        `encryption is one of ${CLOUD_ENCRYPTION_ALGORITHMS.join(", ")} and received ` +
          `${JSON.stringify(encryption)}`,
      );
    }
    const visibility = body["visibilityTimeoutSeconds"];
    if (visibility !== undefined && (typeof visibility !== "number" || visibility < 0)) {
      return invalid(`queue/${name}`, "visibilityTimeoutSeconds is a count of seconds and is never negative");
    }
    const attributes = readTags(body["attributes"]);
    if (attributes === null) return invalid(`queue/${name}`, "attributes must be a map of strings to strings");
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(`queue/${name}`, "tags must be a map of strings to strings");
    this.#queues.set(name, {
      name,
      messages: [],
      inFlight: new Map<string, string>(),
      deadLetterQueue: typeof dead === "string" ? dead : null,
      encryption: encryption as CloudEncryptionAlgorithm,
      visibilityTimeoutSeconds: typeof visibility === "number" ? visibility : 30,
      attributes,
      tags,
    });
    return answered(`queue/${name}`, 201, { name, created: true });
  }

  #readQueue(name: string): HandlerResult {
    const held = this.#requireQueue(name);
    if (!isQueue(held)) return held;
    return answered(`queue/${name}`, 200, this.#queueReading(held));
  }

  #deleteQueue(name: string): HandlerResult {
    if (!this.#queues.delete(name)) {
      return absent(`queue/${name}`, `this account holds no queue named ${JSON.stringify(name)}`);
    }
    return answered(`queue/${name}`, 200, { name, deleted: true });
  }

  #sendMessage(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireQueue(name);
    if (!isQueue(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`queue/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const text = readString(body, "body");
    if (text === null) {
      return invalid(`queue/${name}`, "a message carries a body, and the request carried none");
    }
    held.messages.push(text);
    const messageId = shortDigest(`${name}:${String(held.messages.length)}:${text}`);
    return answered(`queue/${name}`, 200, { messageId, messages: held.messages.length });
  }

  #receiveMessage(name: string): HandlerResult {
    const held = this.#requireQueue(name);
    if (!isQueue(held)) return held;
    const next = held.messages.shift();
    if (next === undefined) {
      return answered(`queue/${name}`, 200, { message: null, receipt: null });
    }
    const receipt = `rcpt-${shortDigest(`${name}:${String(held.inFlight.size)}:${next}`)}`;
    held.inFlight.set(receipt, next);
    return answered(`queue/${name}`, 200, { message: next, receipt });
  }

  /**
   * Delete a received message by its receipt handle.
   *
   * A receipt this world did not issue is a **missing** resource rather than a refused request, and the
   * difference is the one a reader needs: it sends them after a message that was never received instead
   * of after a permission.
   */
  #deleteMessage(name: string, receipt: string): HandlerResult {
    const held = this.#requireQueue(name);
    if (!isQueue(held)) return held;
    if (!held.inFlight.has(receipt)) {
      return absent(
        `queue/${name}`,
        `queue ${JSON.stringify(name)} holds no received message with receipt ${JSON.stringify(receipt)}; a ` +
          "receipt is issued when a message is received and is spent when the message is deleted",
      );
    }
    held.inFlight.delete(receipt);
    return answered(`queue/${name}`, 200, { receipt, deleted: true });
  }

  // -------------------------------------------------------------------------------------------
  // Secrets.
  // -------------------------------------------------------------------------------------------

  #createSecret(request: CloudRequest): HandlerResult {
    const body = readJsonObject(request.body);
    if (body === null) return invalid(null, "the request body is not a JSON object", 400, "BadRequest");
    const name = readString(body, "name");
    if (name === null || name.trim() === "") {
      return invalid(null, "creating a secret names one, and the request named none");
    }
    const problem = nameProblem("secret", name);
    if (problem !== null) return invalid(`secret/${name}`, problem);
    if (this.#secrets.has(name)) {
      return conflicting(`secret/${name}`, `this account already holds a secret named ${JSON.stringify(name)}`);
    }
    const tags = readTags(body["tags"]);
    if (tags === null) return invalid(`secret/${name}`, "tags must be a map of strings to strings");
    const value = body["value"];
    if (value !== undefined && typeof value !== "string") {
      return invalid(`secret/${name}`, "a secret's value is a string, or absent");
    }
    this.#secrets.set(name, {
      name,
      versions:
        typeof value === "string"
          ? [{ versionId: "v1", text: value, contentType: "text/plain", encryption: "AES256" }]
          : [],
      rotationEnabled: false,
      encrypted: true,
      tags,
    });
    return answered(`secret/${name}`, 201, {
      name,
      created: true,
      versions: typeof value === "string" ? 1 : 0,
    });
  }

  #readSecret(name: string): HandlerResult {
    const held = this.#requireSecret(name);
    if (!isSecret(held)) return held;
    return answered(`secret/${name}`, 200, this.#secretReading(held));
  }

  #deleteSecret(name: string): HandlerResult {
    if (!this.#secrets.delete(name)) {
      return absent(`secret/${name}`, `this account holds no secret named ${JSON.stringify(name)}`);
    }
    return answered(`secret/${name}`, 200, { name, deleted: true });
  }

  #putSecretValue(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireSecret(name);
    if (!isSecret(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`secret/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const value = readString(body, "value");
    if (value === null) {
      return invalid(`secret/${name}`, "a secret value is a string, and the request named none");
    }
    const versionId = `v${String(held.versions.length + 1)}`;
    held.versions.unshift({ versionId, text: value, contentType: "text/plain", encryption: "AES256" });
    return answered(`secret/${name}`, 200, { name, version: versionId });
  }

  /**
   * Serve the value, and only the value.
   *
   * This is the one route that returns something no reading is allowed to carry - see the file header.
   * A secret that exists and holds nothing is a **conflict** rather than a missing resource: the secret
   * is right there, and the question is about a version there is no version of. That is a state this
   * world records rather than an error it invents, and it is the state a criterion asking "was a value
   * ever written" needs to be able to see.
   */
  #getSecretValue(name: string): HandlerResult {
    const held = this.#requireSecret(name);
    if (!isSecret(held)) return held;
    const newest = held.versions[0];
    if (newest === undefined) {
      return conflicting(
        `secret/${name}`,
        `secret ${JSON.stringify(name)} exists and holds no value; a read is a question about a version, ` +
          "and this secret has none",
      );
    }
    return answered(`secret/${name}`, 200, { name, version: newest.versionId, value: newest.text });
  }

  #putSecretEncryption(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireSecret(name);
    if (!isSecret(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`secret/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const encrypted = body["encrypted"];
    if (typeof encrypted !== "boolean") {
      return invalid(`secret/${name}`, "encrypted is true or false");
    }
    held.encrypted = encrypted;
    return answered(`secret/${name}`, 200, { encrypted });
  }

  #putSecretRotation(name: string, request: CloudRequest): HandlerResult {
    const held = this.#requireSecret(name);
    if (!isSecret(held)) return held;
    const body = readJsonObject(request.body);
    if (body === null) return invalid(`secret/${name}`, "the request body is not a JSON object", 400, "BadRequest");
    const enabled = body["enabled"];
    if (typeof enabled !== "boolean") {
      return invalid(`secret/${name}`, "enabled is true or false");
    }
    held.rotationEnabled = enabled;
    return answered(`secret/${name}`, 200, { enabled });
  }

  // -------------------------------------------------------------------------------------------
  // Derivations. None of these writes.
  // -------------------------------------------------------------------------------------------

  /**
   * Read a stored bucket as a reading.
   *
   * Every method in this section is a **pure derivation**: it reads stored state and builds a new
   * object. An earlier shape of the cluster substitute recorded a pod's events on the way out of its
   * derivation, which made a read mutate the record it read - the first `snapshot()` in a run wrote one
   * count and the second wrote another, so two readings of one unchanged world disagreed and a
   * repeat-run consistency check would have called one account two different accounts. A real provider
   * records what it did when it did it, not when somebody looked.
   */
  #bucketReading(bucket: StoredBucket): CloudBucketReading {
    return {
      name: bucket.name,
      region: bucket.region,
      versioning: bucket.versioning,
      encryption: bucket.encryption,
      publicAccessBlocked: bucket.publicAccessBlocked,
      policy: [...bucket.policy],
      objects: bucket.objects.size,
      tags: { ...bucket.tags },
    };
  }

  #objectReading(key: string, object: StoredObject, bucketName: string): CloudObjectReading {
    const newest = object.versions[0];
    return {
      bucket: bucketName,
      key,
      bytes: newest === undefined ? 0 : bytesOf(newest.text),
      sha256: newest === undefined ? "" : digest(newest.text),
      contentType: newest === undefined ? "application/octet-stream" : newest.contentType,
      encryption: newest === undefined ? "none" : newest.encryption,
      versionId: newest === undefined ? "" : newest.versionId,
      versions: object.versions.length,
      tags: { ...object.tags },
    };
  }

  #queueReading(queue: StoredQueue): CloudQueueReading {
    return {
      name: queue.name,
      messages: queue.messages.length,
      inFlight: queue.inFlight.size,
      deadLetterQueue: queue.deadLetterQueue,
      encryption: queue.encryption,
      visibilityTimeoutSeconds: queue.visibilityTimeoutSeconds,
      attributes: { ...queue.attributes },
      tags: { ...queue.tags },
    };
  }

  #secretReading(secret: StoredSecret): CloudSecretReading {
    const newest = secret.versions[0];
    return {
      name: secret.name,
      currentVersion: newest === undefined ? "" : newest.versionId,
      versions: secret.versions.map((version) => ({
        version: version.versionId,
        bytes: bytesOf(version.text),
        sha256: digest(version.text),
      })),
      rotationEnabled: secret.rotationEnabled,
      encrypted: secret.encrypted,
      matchesKnownPlaceholder:
        newest === undefined
          ? false
          : (CLOUD_PLACEHOLDER_VALUES as readonly string[]).includes(fold(newest.text)),
      tags: { ...secret.tags },
    };
  }

  /**
   * A principal's attached policies, flattened in attachment order.
   *
   * Attachment order rather than sorted, because the order is what decides which statement the
   * evaluator meets first and `renderPolicy` prints a policy in declaration order for the same reason:
   * a policy is a document a reader reads top to bottom, and sorting it would hide the one thing about
   * its order that has a consequence.
   */
  #principalReading(principal: StoredPrincipal): CloudPrincipalReading {
    const statements: CloudPolicyStatement[] = [];
    for (const policy of principal.policies) statements.push(...policy.statements);
    return {
      name: principal.name,
      attachedPolicies: principal.policies.map((policy) => policy.name),
      statements,
      tags: { ...principal.tags },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Storage accessors, returning either the record or the refusal to return instead.
  // -------------------------------------------------------------------------------------------

  #requireBucket(name: string): StoredBucket | HandlerResult {
    const bucket = this.#buckets.get(name);
    if (bucket === undefined) {
      return absent(
        `bucket/${name}`,
        `this account holds no bucket named ${JSON.stringify(name)}`,
      );
    }
    return bucket;
  }

  #requireQueue(name: string): StoredQueue | HandlerResult {
    const queue = this.#queues.get(name);
    if (queue === undefined) {
      return absent(`queue/${name}`, `this account holds no queue named ${JSON.stringify(name)}`);
    }
    return queue;
  }

  #requireSecret(name: string): StoredSecret | HandlerResult {
    const secret = this.#secrets.get(name);
    if (secret === undefined) {
      return absent(`secret/${name}`, `this account holds no secret named ${JSON.stringify(name)}`);
    }
    return secret;
  }
}

/**
 * A route table and a dispatcher are two lists of the same thing, and no reader of this file can see
 * whether they agree. The matcher only produces a captured part a pattern declared, so this branch is
 * unreachable - and it is written as a named failure rather than a non-null assertion, so that a table
 * and a dispatcher which drift are a message naming the drift instead of a crash.
 */
const impossible = (action: string): HandlerResult =>
  crashed(`the route for ${action} captures no such part, and the dispatcher asked for one`);

/** Narrowing helpers: a `require` returns either the stored thing or the refusal to return instead. */
const isBucket = (value: StoredBucket | HandlerResult): value is StoredBucket =>
  hasOwn(value as unknown as Record<string, unknown>, "objects");
const isQueue = (value: StoredQueue | HandlerResult): value is StoredQueue =>
  hasOwn(value as unknown as Record<string, unknown>, "messages");
const isSecret = (value: StoredSecret | HandlerResult): value is StoredSecret =>
  hasOwn(value as unknown as Record<string, unknown>, "versions");

const readAlgorithm = (value: unknown): CloudEncryptionAlgorithm =>
  typeof value === "string" && (CLOUD_ENCRYPTION_ALGORITHMS as readonly string[]).includes(value)
    ? (value as CloudEncryptionAlgorithm)
    : "none";

const readVersioning = (value: unknown): CloudVersioningState =>
  typeof value === "string" && (CLOUD_VERSIONING_STATES as readonly string[]).includes(value)
    ? (value as CloudVersioningState)
    : "never";

const readStoredVersions = (value: unknown): StoredVersion[] => {
  if (!Array.isArray(value)) return [];
  const versions: StoredVersion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry["versionId"] !== "string" || typeof entry["text"] !== "string") continue;
    versions.push({
      versionId: entry["versionId"],
      text: entry["text"],
      contentType: typeof entry["contentType"] === "string" ? entry["contentType"] : "text/plain",
      encryption: readAlgorithm(entry["encryption"]),
    });
  }
  return versions;
};

/**
 * Actions a caller other than the declared identity may reach without a policy covering them.
 *
 * The declared identity is the account's own caller and is never gated, so an ordinary run is not a
 * permission puzzle. A *different* caller is gated for everything except asking who it is and asking
 * whether it may do something - the two questions a client asks before it holds a policy at all, and
 * gating either would make the account unusable in a way that reads as a defect in the application
 * rather than as a state of the account.
 */
const GATE_EXEMPT = new Set<string>([
  "provider.describe",
  "sts.getCallerIdentity",
  "iam.authorize",
]);

/**
 * Build a substitute provider account.
 *
 * The identity is a parameter rather than a set of defaults, because every reading carries it and a
 * reading naming a provider nobody declared would be a record of a world the run never used. A blank
 * field is refused here rather than stored, for the same reason: `""` is a reading nothing can be
 * asserted against, and it would fail much later as a criterion that mysteriously never passes.
 */
export function httpCloud(identity: CloudIdentity): CloudPort {
  const trimmed: CloudIdentity = {
    provider: identity.provider.trim(),
    region: identity.region.trim(),
    account: identity.account.trim(),
    principal: identity.principal.trim(),
  };
  const missing = (Object.keys(trimmed) as (keyof CloudIdentity)[]).filter(
    (key) => trimmed[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `a substitute cloud account needs a value for every one of ${Object.keys(trimmed).join(", ")}, ` +
        `and received none for ${missing.join(", ")}`,
    );
  }
  return new HttpCloud(trimmed);
}

export { CLOUD_SIMULATED_SURFACES, CLOUD_ACTION_NAMES };
