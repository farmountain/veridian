#!/usr/bin/env node
/**
 * The application: a provisioning program.
 *
 * It is handed an account address and an identity in its environment, it opens real HTTP connections
 * to them, and it writes the resources the cart web front end needs. There is no SDK and there is no
 * cloud: the provider is a substitute, and this program is written the way it would be written against
 * a real one - a provider-neutral surface, plain `fetch`, and no knowledge of who is standing behind
 * it. That is what the five environment variables are for. A program with a hard-coded endpoint would
 * not be a client of the world it was handed.
 *
 * ## What it provisions, and why each thing is a request of its own
 *
 *   - Two buckets. `cart-assets` holds the built front end; `cart-receipts` holds what must not be
 *     deleted. The second bucket is not decoration: a presence question asked of one bucket is a
 *     question this program could answer by accident.
 *   - One object, with tags. The tags are a request of their own because the substitute - like the real
 *     service - does not take them with the object.
 *   - Two queues, and one message. `cart-events` parks what it cannot process on `cart-events-dead`,
 *     which is the configuration a retry contract is actually about.
 *   - One secret, rotated once. The value is written and then replaced, so the account holds two
 *     versions and a rotation flag. This program never reads the value back: a provisioner that read it
 *     would have no way to tell a written secret from an absent one, and the reading it worked from
 *     would be the reading that leaked.
 *   - One principal, and three policies - one of which is a `deny`.
 *   - Two authorization questions, asked of the account rather than answered from the policy text this
 *     program just wrote. "We sent an allow" and "the account decides allow" are different claims, and
 *     only the second one is a fact about the world.
 *
 * ## What it deliberately does not do
 *
 * It does not print what it wrote and call that provisioning. Every step is a request whose answer is
 * checked, and a non-2xx answer stops the program with the account's own reason - so a world that
 * refused something says so, instead of leaving a criterion to report an absent resource and a reader
 * to guess whether the application had tried.
 *
 * It does not read the meter to decide anything. It reads it to report it.
 *
 * ## What it says out loud
 *
 * The world declares which of its surfaces are substituted, and this program reads that declaration
 * and prints it. A substitute that hid its own substitution would be the one failure this world can
 * suffer, and the first reader who could catch it is the application.
 */

const API = process.env["VERIDIAN_CLOUD_API"] ?? "";
const PROVIDER = process.env["VERIDIAN_CLOUD_PROVIDER"] ?? "";
const REGION = process.env["VERIDIAN_CLOUD_REGION"] ?? "";
const ACCOUNT = process.env["VERIDIAN_CLOUD_ACCOUNT"] ?? "";
const PRINCIPAL = process.env["VERIDIAN_CLOUD_PRINCIPAL"] ?? "";

const missing = [
  ["VERIDIAN_CLOUD_API", API],
  ["VERIDIAN_CLOUD_PROVIDER", PROVIDER],
  ["VERIDIAN_CLOUD_REGION", REGION],
  ["VERIDIAN_CLOUD_ACCOUNT", ACCOUNT],
  ["VERIDIAN_CLOUD_PRINCIPAL", PRINCIPAL],
]
  .filter((entry) => entry[1] === "")
  .map((entry) => entry[0]);

if (missing.length > 0) {
  process.stderr.write(
    "provision: this program is handed an account rather than a provider, and the environment is " +
      `missing ${missing.join(", ")}\n`,
  );
  process.exit(2);
}

/** The reader this program creates for the front end: it may read the assets and nothing else. */
export const READER = "svc-reader";

export const BUCKET = "cart-assets";
export const RECEIPTS_BUCKET = "cart-receipts";
export const OBJECT_KEY = "assets/cart-web.js";
export const QUEUE = "cart-events";
export const DEAD_LETTER_QUEUE = "cart-events-dead";
export const SECRET = "cart-api-key";

export const BUCKET_TAGS = { owner: "cart-team", tier: "assets" };
export const RECEIPTS_TAGS = { owner: "cart-team", tier: "records" };
export const OBJECT_TAGS = { cacheControl: "max-age=3600" };
export const QUEUE_TAGS = { owner: "cart-team", retention: "30d" };
export const DEAD_LETTER_TAGS = { owner: "cart-team", retention: "14d" };
export const QUEUE_ATTRIBUTES = { maxReceiveCount: "5", messageRetentionSeconds: "1209600" };
export const SECRET_TAGS = { owner: "cart-team", rotation: "90d" };
export const READER_TAGS = { owner: "cart-team", role: "reader" };

export const VISIBILITY_TIMEOUT_SECONDS = 30;

/** The artifact itself. An object's bytes are not a JSON string, and they are uploaded as they are. */
export const OBJECT_BODY =
  "export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);\n";

/**
 * One value, then another, because rotation is the operation a provisioning step usually forgets.
 *
 * Neither is a member of the vocabulary the world treats as a placeholder, and that is a fact a
 * criterion asks about rather than a property this comment claims: a scaffold's `changeme` written
 * into a secret is a secret that is not one, so the world reports it as such.
 */
export const SECRET_V1 = "b7f1c4a9-2e63-4d18-9c07-5a8e3b6f2d41";
export const SECRET_V2 = "4d18b7f1-a9c4-4b6f-8e07-2d419c6e5a83";

export const READER_STATEMENTS = [
  { effect: "allow", principal: READER, action: "s3.getObject", resource: `object/${BUCKET}/*` },
];

export const PROVISION_STATEMENTS = [
  { effect: "allow", principal: PRINCIPAL, action: "s3.putObject", resource: `object/${BUCKET}/*` },
  { effect: "deny", principal: PRINCIPAL, action: "s3.deleteBucket", resource: `bucket/${BUCKET}` },
];

export const RECEIPTS_STATEMENTS = [
  { effect: "deny", principal: "*", action: "s3.deleteBucket", resource: `bucket/${RECEIPTS_BUCKET}` },
];

/** One request, and the account's own answer to it. */
async function ask(method, path, init) {
  const response = await fetch(`${API}${path}`, { method, ...init });
  const text = await response.text();
  let parsed = null;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const reason =
      parsed !== null && typeof parsed === "object" && "message" in parsed ? parsed.message : text;
    throw new Error(`${method} ${path} answered ${response.status}: ${reason}`);
  }
  return parsed;
}

/** A request whose body is JSON. `undefined` sends no body at all, which a `GET` requires. */
const send = (method, path, body) =>
  ask(method, path, {
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A request whose body is the artifact itself. */
const upload = (path, text) =>
  ask("PUT", path, {
    headers: { "content-type": "application/octet-stream" },
    body: text,
  });

let provisioned = 0;

/** Every step is a request whose answer is checked, and every step is counted and announced. */
async function step(label, request) {
  const answer = await request;
  provisioned += 1;
  process.stdout.write(`provision: ${label}\n`);
  return answer;
}

/** Ask the account what its own policy decides, rather than asserting what was written. */
async function authorize(principal, action, resource) {
  const decision = await send("POST", "/v1/identity/authorize", { principal, action, resource });
  process.stdout.write(
    `provision: ${principal} ${action} on ${resource} -> ` +
      `${decision.allowed === true ? "allowed" : "denied"} by ${decision.entry}\n`,
  );
  return decision;
}

const BUCKET_PATH = `/v1/storage/buckets/${BUCKET}`;
const OBJECT_PATH = `${BUCKET_PATH}/objects/${OBJECT_KEY}`;
const RECEIPTS_PATH = `/v1/storage/buckets/${RECEIPTS_BUCKET}`;

const version = await send("GET", "/v1/version");
process.stdout.write(
  `provision: account ${ACCOUNT} in ${REGION} (${PROVIDER} surface), ` +
    `${String(version.simulated.length)} declared substitutions\n`,
);

await step("bucket cart-assets created", send("PUT", BUCKET_PATH, {
  name: BUCKET,
  region: REGION,
  tags: BUCKET_TAGS,
}));
await step("bucket cart-assets versioned", send("PUT", `${BUCKET_PATH}?versioning`, { state: "enabled" }));
await step("bucket cart-assets encrypted", send("PUT", `${BUCKET_PATH}?encryption`, { algorithm: "AES256" }));
await step("bucket cart-assets closed to the public", send("PUT", `${BUCKET_PATH}?publicAccessBlock`, { blocked: true }));
await step("bucket cart-assets tagged", send("PUT", `${BUCKET_PATH}?tagging`, { tags: BUCKET_TAGS }));

await step("object assets/cart-web.js written", upload(OBJECT_PATH, OBJECT_BODY));
await step("object assets/cart-web.js tagged", send("PUT", `${OBJECT_PATH}?tagging`, { tags: OBJECT_TAGS }));

await step("bucket cart-receipts created", send("PUT", RECEIPTS_PATH, {
  name: RECEIPTS_BUCKET,
  region: REGION,
  tags: RECEIPTS_TAGS,
}));
await step("bucket cart-receipts undeletable", send("PUT", `${RECEIPTS_PATH}?policy`, {
  statements: RECEIPTS_STATEMENTS,
}));

await step("queue cart-events created", send("POST", "/v1/queues", {
  name: QUEUE,
  encryption: "AES256",
  visibilityTimeoutSeconds: VISIBILITY_TIMEOUT_SECONDS,
  deadLetterQueue: DEAD_LETTER_QUEUE,
  attributes: QUEUE_ATTRIBUTES,
  tags: QUEUE_TAGS,
}));
await step("queue cart-events-dead created", send("POST", "/v1/queues", {
  name: DEAD_LETTER_QUEUE,
  encryption: "AES256",
  tags: DEAD_LETTER_TAGS,
}));
await step("queue cart-events announced", send("POST", `/v1/queues/${QUEUE}/messages`, {
  body: "cart-web provisioned",
}));

await step("secret cart-api-key declared", send("POST", "/v1/secrets", {
  name: SECRET,
  tags: SECRET_TAGS,
}));
await step("secret cart-api-key value written", send("PUT", `/v1/secrets/${SECRET}`, { value: SECRET_V1 }));
await step("secret cart-api-key rotated", send("PUT", `/v1/secrets/${SECRET}`, { value: SECRET_V2 }));
await step("secret cart-api-key rotation enabled", send("PUT", `/v1/secrets/${SECRET}?rotation`, { enabled: true }));
await step("secret cart-api-key encrypted", send("PUT", `/v1/secrets/${SECRET}?encryption`, { encrypted: true }));

await step("principal svc-reader created", send("POST", "/v1/identity/principals", {
  name: READER,
  tags: READER_TAGS,
}));
await step("principal svc-reader granted read", send("PUT", `/v1/identity/principals/${READER}?policy`, {
  name: "cart-read-only",
  statements: READER_STATEMENTS,
}));
await step("principal svc-cart granted provision", send("PUT", `/v1/identity/principals/${PRINCIPAL}?policy`, {
  name: "cart-web-provision",
  statements: PROVISION_STATEMENTS,
}));

await authorize(READER, "s3.getObject", `object/${BUCKET}/${OBJECT_KEY}`);
await authorize(PRINCIPAL, "s3.deleteBucket", `bucket/${BUCKET}`);

const meter = await send("GET", "/v1/metering");
process.stdout.write(
  `cart-cloud meter: ${String(meter.requests)} requests, ${String(meter.objects)} objects, ` +
    `${String(meter.bytes)} bytes, ${String(meter.costUnits)} cost units\n`,
);

process.stdout.write(`cart-cloud provisioned: ${String(provisioned)} resources to ${ACCOUNT}\n`);
