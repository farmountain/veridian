import { DefinitionError, loadDocument, resolveSibling } from "../goal/load.ts";
import type { GoalDocument, GoalLimits, SourceRef } from "../goal/types.ts";
import type { ReadonlyIoPort } from "../io.ts";
import { SCHEMA_URIS, type SchemaSet } from "../schema/index.ts";
import { principalProblem } from "./cloud-observation.ts";
import { CONTAINER_PLATFORMS } from "./container-observation.ts";
import { MOBILE_PLATFORMS } from "./mobile-observation.ts";
import { OS_FAMILIES, PRIVILEGED_OS_ACCOUNTS } from "./os-observation.ts";
import {
  RESET_STRATEGIES,
  type ApiPlan,
  type BoundaryPolicy,
  type BrowserPolicy,
  type CloudPlan,
  type ClusterPlan,
  type ContainerPlan,
  type DataPlan,
  type EnvironmentPlan,
  type HealthPolicy,
  type MobilePlan,
  type OsPlan,
  type PosixPlan,
  type ProcessPlan,
  type ResetStrategy,
  type VSCodePlan,
} from "./types.ts";

/**
 * Decoding an environment definition.
 *
 * The asymmetry with `core/acceptance` is intentional: an acceptance criterion keeps its wire shape
 * because the plan decodes it later, whereas an environment definition is decoded *here* into a plan
 * with no optional fields. The reason is who consumes it. A criterion is read by exactly one module
 * that already understands steps; the environment is read by a process runner, a health poller, and
 * a browser launcher, and each of those doing its own defensive `typeof` check is three places for
 * the same fact to be misread.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function loadEnvironmentDocument(
  io: ReadonlyIoPort,
  path: string,
  schemas: SchemaSet,
): Promise<GoalDocument & { readonly schemaUri: string }> {
  return loadDocument(io, path, schemas, {
    what: "environment",
    schemaUri: SCHEMA_URIS.environment,
  });
}

function defect(path: string, message: string): DefinitionError {
  return new DefinitionError(path, [{ path, keyword: "type", message }]);
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Strip a trailing slash so `http://host:1/` + `/health` does not become `http://host:1//health`. */
const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

/**
 * A three-part version, the form a real host's own version takes.
 *
 * Written here rather than reused from a semantic-version helper, because the only thing this world
 * does with the string is compare a *floor* against it, and a comparison is the one job a permissive
 * pattern would get wrong silently: `^1.100` would parse, compare, and produce an answer that looks
 * computed and is not.
 */
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * The URL the health check will probe.
 *
 * Exported because it appears in failure artifacts, and an artifact that says "health check failed"
 * without naming the URL is a message the reader has to reconstruct the run to interpret.
 */
export function probeUrl(plan: EnvironmentPlan): string | null {
  if (plan.url === null) return null;
  const path = plan.health.path === null || plan.health.path === "" ? "" : plan.health.path;
  const suffix = path === "" || path.startsWith("/") ? path : `/${path}`;
  return `${trimTrailingSlash(plan.url)}${suffix}`;
}

function readEnv(raw: unknown): Readonly<Record<string, string>> {
  if (!isPlainObject(raw)) return {};
  const entries = Object.entries(raw).filter(([, value]) => typeof value === "string");
  return Object.fromEntries(entries) as Record<string, string>;
}

function readHealth(raw: unknown, hasUrl: boolean, stdoutPattern: string | null): HealthPolicy {
  const health = isPlainObject(raw) ? raw : {};
  // The defaults are HTTP defaults, so they are applied only to a world that is reached over HTTP.
  // A document with no `url` describes a world with no status to expect, and defaulting
  // `expectStatus` to 200 there would invent an expectation the world cannot satisfy - either it
  // never becomes ready (read strictly) or it is ready whatever happens (read loosely).
  return {
    path: hasUrl ? asString(health["path"], "/") : null,
    expectStatus: hasUrl ? asNumber(health["expectStatus"], 200) : null,
    timeoutMs: asNumber(health["timeoutMs"], 20_000),
    intervalMs: asNumber(health["intervalMs"], 100),
    // Read from `start`, and from nowhere else, because `start.readyPattern` is the only place a
    // document that validates can declare one - `health` is closed to unknown keys. This used to
    // read `health["readyPattern"]`, which no valid document could ever set, so `plan.health
    // .readyPattern` was permanently `null` and the manager's readiness gate
    // (`readyPattern === null || patternSeen !== false`) could not be false. A guard no document
    // can trip is not a guard; the operator's one declaration now reaches both the adapter, which
    // waits for it, and the manager, which requires it.
    readyPattern: stdoutPattern,
  };
}

/**
 * The browser policy, and the one contradiction that is worth refusing.
 *
 * A world with no address cannot be observed through a browser, so `enabled` defaults to `false`
 * there rather than to the schema's `true`. That default is not a preference: a plan claiming
 * `browser.enabled: true` for a world with nothing to point a page at is the same class of untruth
 * as `--browser none` recording `reproducibility.browser: chromium` for a run that launched none -
 * the bundle would describe a world the run never used.
 *
 * Stating `enabled: true` explicitly alongside no `url` is not silently overridden but refused,
 * because the operator has asserted something the world cannot honour and the repair is theirs to
 * choose: remove the browser, or give the world an address.
 */
function readBrowser(raw: unknown, hasUrl: boolean): BrowserPolicy {
  const browser = isPlainObject(raw) ? raw : {};
  const viewport = isPlainObject(browser["viewport"]) ? browser["viewport"] : null;
  const stated = browser["enabled"];
  if (!hasUrl && stated === true) {
    throw defect(
      "$.browser.enabled",
      "this world has no url, so a browser has nothing to open. Remove the browser, or give the " +
        "environment a url - a plan that promises a browser it cannot point is a bundle that will " +
        "describe a world the run never used.",
    );
  }
  return {
    enabled: hasUrl && stated !== false,
    viewport:
      viewport === null
        ? null
        : {
            width: asNumber(viewport["width"], 1280),
            height: asNumber(viewport["height"], 720),
          },
    locale: typeof browser["locale"] === "string" ? browser["locale"] : null,
    timezoneId: typeof browser["timezoneId"] === "string" ? browser["timezoneId"] : null,
  };
}

/**
 * The boundary the goal declared, resolved into the shape the adapter enforces.
 *
 * The allow list is copied **only** under `allow-list`, so the plan states the boundary that was
 * actually applied rather than the one that was written down. A goal that lists origins while the
 * policy is `deny` still has that list ignored here, and that is deliberate: a boundary read two
 * ways is a boundary that will eventually be read the wrong way, and the goal document is itself
 * copied into every run bundle, so nothing is lost by not echoing it in the plan.
 */
/**
 * The HTTP service this world is, or `null` when the world is not one.
 *
 * Absent means not a service world, and present-but-incomplete is **refused** rather than defaulted,
 * on the rule `readCluster` set and every block since has followed. The refusal is not symmetry: a
 * defaulted service name would be a name the plan and every reading agree on by construction and
 * that nothing in the document ever said, so the one question this field exists to answer - *which
 * service produced this verdict* - would be answered with a value no operator chose and no reader
 * could check. A gap the ladder can ask about is strictly better than a value nobody wrote.
 */
function readApi(raw: unknown): ApiPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect("$.api", "api must be an object naming the service these readings describe");
  }
  const service = asString(raw["service"]).trim();
  if (service === "") {
    throw defect(
      "$.api.service",
      "the api declaration names no service. A reading has to say which service it is about, and " +
        "the address is not the answer - the same address serves whichever process happens to hold " +
        "it, so a verdict whose reading named only a port could not be told apart from a verdict " +
        "about whatever replaced it.",
    );
  }
  return { service };
}

/**
 * The cluster this world stands in for, or `null` when the world is not a cluster.
 *
 * Absent means not a cluster. Present-but-incomplete is refused rather than defaulted, and that
 * refusal is the whole reason this is a function rather than three `asString` calls: a cluster
 * declaration missing its namespace would otherwise resolve to the empty string, the adapter would
 * scope every object to a namespace nobody named, and the run would report a verdict about a world
 * the operator did not describe. A half-stated world is the one input that can turn "we could not
 * test it" into "it passed".
 *
 * `images` resolves against `appPath` on the rule `databasePath` already follows, and the resolved
 * path is what the plan carries - so the directory the adapter scans is the one the document named,
 * and a reader of the bundle can check it.
 */
function readCluster(raw: unknown, appPath: string): ClusterPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect("$.cluster", "cluster must be an object naming a name, a namespace and an images directory");
  }
  const name = asString(raw["name"]).trim();
  const namespace = asString(raw["namespace"]).trim();
  const images = asString(raw["images"]).trim();
  const missing = [
    name === "" ? "name" : null,
    namespace === "" ? "namespace" : null,
    images === "" ? "images" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.cluster.${missing[0] ?? "name"}`,
      `the cluster declaration is missing ${missing.join(", ")}. A cluster world is scoped to a ` +
        "namespace and reads its substitute image registry from a directory; defaulting either one " +
        "would judge the run in a world the operator never described.",
    );
  }
  return { name, namespace, imagesPath: resolveSibling({ dir: appPath, path: "", text: "" }, images) };
}

/**
 * The POSIX-like system this world stands in for, or `null` when the world is not one.
 *
 * The same rule as {@link readCluster}, one kind of world further out: absent means not this world,
 * and present-but-incomplete is **refused** rather than defaulted. The refusal is not symmetry for
 * its own sake. `distribution` and `user` are the two facts that decide what a reading *means* - a
 * file's permissions are judged against an account, and a distribution is what a criterion about
 * "this is the image we hardened" is a claim about - so defaulting either one would produce a
 * verdict about a system nobody described. `root` is resolved against `appPath` because the schema
 * says a path in this document is relative to `app`, and because a sandbox root that drifted from the
 * directory the adapter wrote to would make every reading about a different tree than the one the
 * criteria acted on.
 */
function readPosix(raw: unknown, appPath: string): PosixPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect("$.posix", "posix must be an object naming a distribution, a user and a sandbox root");
  }
  const distribution = asString(raw["distribution"]).trim();
  const user = asString(raw["user"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [
    distribution === "" ? "distribution" : null,
    user === "" ? "user" : null,
    root === "" ? "root" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.posix.${missing[0] ?? "distribution"}`,
      `the posix declaration is missing ${missing.join(", ")}. A POSIX-like world judges file ` +
        "permissions against a named account and reports which system it stood in for; defaulting " +
        "either one would produce a verdict about a system nobody described.",
    );
  }
  if (user === "root") {
    throw defect(
      "$.posix.user",
      "the criteria would act as root, and root reads every file - so a hardening contract judged " +
        "as root would report a pass for a system no ordinary user can log into",
    );
  }
  return { distribution, user, root: resolveSibling({ dir: appPath, path: "", text: "" }, root) };
}

/**
 * The operating system declaration, resolved.
 *
 * The same rule as {@link readCluster} and {@link readPosix}, one kind of world further out: absent
 * means not this world, and present-but-incomplete is **refused** rather than defaulted. It is the
 * third time this rule is written out, and the third time is the one where a reader is entitled to
 * ask why it is not factored into one helper. It is not, because the four facts each world refuses to
 * default are *different facts* with different sentences, and a helper taking the list as an argument
 * would move the sentence that explains the refusal - the part an operator actually reads - away from
 * the field it is about.
 *
 * The reference to `OS_FAMILIES` rather than a literal pair here is the one place this loader imports
 * from the reading vocabulary, and it is worth the edge: the family decides how a path is spelled in
 * every subsequent reading, so a plan naming a family the vocabulary does not know would be a plan
 * whose criteria all resolve to refusals. One list, read in both places.
 */
function readOs(raw: unknown, appPath: string): OsPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.os",
      "os must be an object naming a family, a system release, a user and a sandbox root",
    );
  }
  const family = asString(raw["family"]).trim();
  const system = asString(raw["system"]).trim();
  const user = asString(raw["user"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [
    family === "" ? "family" : null,
    system === "" ? "system" : null,
    user === "" ? "user" : null,
    root === "" ? "root" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.os.${missing[0] ?? "family"}`,
      `the os declaration is missing ${missing.join(", ")}. The family decides how a path is spelled ` +
        "and how the configuration store is addressed, the release is what every reading names, and " +
        "the account is what every access question is decided as - defaulting any of them would " +
        "produce a verdict about a system nobody described.",
    );
  }
  if (!(OS_FAMILIES as readonly string[]).includes(family)) {
    throw defect(
      "$.os.family",
      `os.family must be one of ${OS_FAMILIES.join(", ")}; it received ${JSON.stringify(family)}. ` +
        "There is no third answer, because a family is not a label on the readings - it is what " +
        "decides whether a path separates with a backslash and whether the store is a hive.",
    );
  }
  const privileged = PRIVILEGED_OS_ACCOUNTS[family as keyof typeof PRIVILEGED_OS_ACCOUNTS];
  if (privileged.includes(user.toLowerCase())) {
    throw defect(
      "$.os.user",
      `the criteria would act as ${JSON.stringify(user)}, which holds every permission on this ` +
        "system - so a hardening contract judged as that account would report a pass for a machine " +
        "no ordinary account can log into. Name the unprivileged account the criteria should act as.",
    );
  }
  return {
    family: family as OsPlan["family"],
    system,
    user,
    root: resolveSibling({ dir: appPath, path: "", text: "" }, root),
  };
}

/**
 * The cloud account declaration, resolved.
 *
 * The fourth time the rule of {@link readCluster}, {@link readPosix} and {@link readOs} is written
 * out, and the difference from all three is worth naming: there is no path here. Nothing in this
 * block resolves against `appPath`, because a provider holds objects rather than directories and an
 * application that provisions one never writes into the world it is provisioning. A `root` field
 * would have been the sixth block imitating the first five rather than describing the sixth world.
 *
 * `principal` is refused by {@link principalProblem} *here*, at load, rather than by the adapter at
 * `create()`. Both would stop the run, and only this one stops it before a world exists: a contract
 * judged as an account root is vacuously green - every policy in an account yields to a root - so the
 * sentence explaining why belongs where the operator's document is read, with the rest of the
 * refusals about that document.
 */
function readCloud(raw: unknown): CloudPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.cloud",
      "cloud must be an object naming a provider, a region, an account and a principal",
    );
  }
  const provider = asString(raw["provider"]).trim();
  const region = asString(raw["region"]).trim();
  const account = asString(raw["account"]).trim();
  const principal = asString(raw["principal"]).trim();
  const missing = [
    provider === "" ? "provider" : null,
    region === "" ? "region" : null,
    account === "" ? "account" : null,
    principal === "" ? "principal" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.cloud.${missing[0] ?? "provider"}`,
      `the cloud declaration is missing ${missing.join(", ")}. The provider and region are what every ` +
        "reading names, the account is what holds every resource the readings report, and the " +
        "principal is the identity every access question is decided as - defaulting any of them " +
        "would produce a verdict about an account nobody described.",
    );
  }
  const problem = principalProblem(principal);
  if (problem !== null) throw defect("$.cloud.principal", problem);
  return { provider, region, account, principal };
}

/**
 * The container runtime declaration, resolved.
 *
 * The fifth time the rule of {@link readCluster}, {@link readPosix}, {@link readOs} and
 * {@link readCloud} is written out, and the fact that it is written out again rather than factored
 * into one helper is the decision {@link readOs} already recorded: the three facts each world refuses
 * to default are *different* facts with different sentences, and a helper taking a list as an
 * argument would move the sentence that explains a refusal - the part an operator actually reads -
 * away from the field it is about.
 *
 * Two things here have no counterpart in the four before it, and both come from the same property of
 * this world: it has two filesystems. `root` is a path **on this machine**, resolved against
 * `appPath`, and it is the only thing that lets the adapter tell a bind mount's host source from its
 * in-container destination. `platform` is validated against {@link CONTAINER_PLATFORMS} rather than
 * accepted as written, because it decides how a path is spelled inside every container the world
 * holds - so a document naming a platform the substitution does not implement would be a document
 * whose criteria all resolved paths by the wrong grammar. Refusing it here stops the run before a
 * world exists, which is the only place a refusal can name the reason with the operator's own
 * document in hand.
 */
function readContainer(raw: unknown, appPath: string): ContainerPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.container",
      "container must be an object naming a runtime, a platform and the sandbox root it holds its " +
        "images and containers in",
    );
  }
  const runtime = asString(raw["runtime"]).trim();
  const platform = asString(raw["platform"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [
    runtime === "" ? "runtime" : null,
    platform === "" ? "platform" : null,
    root === "" ? "root" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.container.${missing[0] ?? "runtime"}`,
      `the container declaration is missing ${missing.join(", ")}. The runtime is what every reading ` +
        "names, the platform is what decides how a path inside a container is spelled, and the root " +
        "is the directory on this machine the world's images and containers live in - defaulting any " +
        "of them would produce a verdict about a runtime nobody described.",
    );
  }
  if (!(CONTAINER_PLATFORMS as readonly string[]).includes(platform)) {
    throw defect(
      "$.container.platform",
      `this world stands in for ${CONTAINER_PLATFORMS.join(" and ")} containers, and the document ` +
        `names ${JSON.stringify(platform)}. The platform is not a label on the readings - it is what ` +
        "decides whether a path inside a container separates with a slash - so a document naming one " +
        "this substitution does not implement is a document whose every criterion would resolve " +
        "paths by the wrong grammar.",
    );
  }
  return {
    runtime,
    platform: platform as ContainerPlan["platform"],
    root: resolveSibling({ dir: appPath, path: "", text: "" }, root),
  };
}

/**
 * The extension-host declaration, resolved.
 *
 * The sixth time the rule of {@link readCluster}, {@link readPosix}, {@link readOs}, {@link readCloud}
 * and {@link readContainer} is written out, and the second time one of these readers validates a
 * *rule* rather than accepting a label - the first being `container.platform`.
 *
 * `apiVersion` is validated because it is compared. A real extension host refuses to load an extension
 * whose `engines.vscode` range does not admit the host's own version, so this world computes the same
 * answer from the same two facts - and a version string this world cannot parse is a version string it
 * cannot do that with. Accepting it would leave the engine answer unreachable, which is the shape this
 * repository has paid for twice: a guard whose branch no document can reach is not a guard, and a
 * requirement that names a value must be read in the form the reader can read it in. Refusing it here
 * stops the run before a world exists rather than after a run whose every engine reading is a guess.
 *
 * `activationEvent` is nullable and is deliberately *not* defaulted to a sentinel. `null` means "the
 * manifest decides", which is a third answer beside "this event" and "unset" - and the reading
 * records the event that was really fired, so a criterion about activation asserts something observed.
 */
function readVSCode(raw: unknown, appPath: string): VSCodePlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.vscode",
      "vscode must be an object naming a host, the API version it answers as, and the sandbox root " +
        "it holds its workspace and its extension state in",
    );
  }
  const host = asString(raw["host"]).trim();
  const apiVersion = asString(raw["apiVersion"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [
    host === "" ? "host" : null,
    apiVersion === "" ? "apiVersion" : null,
    root === "" ? "root" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.vscode.${missing[0] ?? "host"}`,
      `the extension-host declaration is missing ${missing.join(", ")}. The host is what every ` +
        "reading names, the API version is what a manifest's `engines.vscode` floor is compared " +
        "against, and the root is the directory on this machine the world's workspace and extension " +
        "state live in - defaulting any of them would produce a verdict about a host nobody described.",
    );
  }
  if (!VERSION_PATTERN.test(apiVersion)) {
    throw defect(
      "$.vscode.apiVersion",
      `the extension-host declaration names ${JSON.stringify(apiVersion)} as its API version, and ` +
        "this world compares that version against every manifest's declared `engines.vscode` floor. " +
        "A version it cannot parse is a version it cannot compare, which would leave the engine " +
        "answer unreachable - so it is refused here, before a world exists, rather than reported as " +
        "a reading nobody can act on.",
    );
  }
  const activation = typeof raw["activationEvent"] === "string" ? raw["activationEvent"].trim() : "";
  return {
    host,
    apiVersion,
    activationEvent: activation === "" ? null : activation,
    root: resolveSibling({ dir: appPath, path: "", text: "" }, root),
    settings: readEnv(raw["settings"]),
  };
}

/**
 * The process boundary this world is, or `null` when the world is not one.
 *
 * The same rule as every block before it - absent means not this world, present-but-incomplete is
 * **refused** - and here the refusal has a shape none of the others had, because this block is the
 * only one whose declarations are all *optional in principle*. A world that ran no program and read
 * no file would be a world with nothing to observe, so the two facts that make it a world at all are
 * required and the one that does not is not.
 *
 * `root` is required for that reason: every path a criterion names is resolved inside it, so a
 * defaulted root would judge a contract against whichever directory the process happened to be
 * started in - which is how a suite passes from the wrong folder. It is resolved against `appPath`
 * because the schema says a path in this document is relative to `app`, exactly as `databasePath` is.
 *
 * `application` is the optional half, and it is optional on purpose rather than by omission: a
 * contract that provisions a tree with its own `run` steps needs no long-lived program, and requiring
 * one would make the simplest shape of this world unwritable. It is a `{ command, args }` pair rather
 * than one string so that no path containing a space has to be quoted - the field a shell-shaped
 * spelling would need, and the one that breaks first on this platform.
 */
function readProcess(raw: unknown, appPath: string): ProcessPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.process",
      "process must be an object naming a host, the directory this world's files live in, and " +
        "optionally a program to run",
    );
  }
  const host = asString(raw["host"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [host === "" ? "host" : null, root === "" ? "root" : null].filter(
    (entry): entry is string => entry !== null,
  );
  if (missing.length > 0) {
    throw defect(
      `$.process.${missing[0] ?? "host"}`,
      `the process declaration is missing ${missing.join(", ")}. The host is what every reading ` +
        "names, and the root is the directory on this machine the world's own files live in - every " +
        "path a criterion names is resolved inside it, so defaulting it would judge the contract " +
        "against a directory nobody chose.",
    );
  }
  return {
    host,
    application: readApplication(raw["application"]),
    root: resolveSibling({ dir: appPath, path: "", text: "" }, root),
    isolation: readProcessIsolation(raw["isolation"]),
  };
}

/**
 * Whether this world's application runs in a substrate, or `null` when the document asked for none.
 *
 * Absent is the ordinary case and means *no substrate was requested*, which the adapter reports as a
 * fact about the document rather than as a missing reading. Present-but-not-an-object is refused for
 * the reason every block in this file refuses it: a declaration nobody can read is a document the
 * operator believes they wrote.
 *
 * `denyNetwork` defaults to `true` when the block is present, and the default is the point of the
 * block. A world that asked for a substrate and kept the runtime's default network has bought the
 * filesystem half of the boundary while paying the full cost of a container, which is a trade no
 * document asks for by accident - so severing is what the block means unless it says otherwise.
 */
function readProcessIsolation(raw: unknown): { readonly denyNetwork: boolean } | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.process.isolation",
      "process.isolation must be an object or null. Present means this world's application runs in a " +
        "container substrate; absent or null means it runs on this machine. A declaration nobody can " +
        "read is a document the operator believes they wrote and the runner never saw.",
    );
  }
  const denyNetwork = raw["denyNetwork"];
  if (denyNetwork !== undefined && typeof denyNetwork !== "boolean") {
    throw defect(
      "$.process.isolation.denyNetwork",
      "denyNetwork must be true or false. It is not a label - it is the flag that decides whether the " +
        "substrate passes `--network=none`, so a value the loader guessed at would be a boundary the " +
        "run reported and did not hold.",
    );
  }
  return { denyNetwork: denyNetwork ?? true };
}

/**
 * The program this world starts, or `null` when it starts none.
 *
 * A declaration present without a command is refused rather than treated as absent. The two are
 * different documents: `application: null` says "this world runs no program", while an object whose
 * `command` is empty says "this world runs a program" and then does not name it - and the second is
 * the input that turns a criterion about a daemon into a criterion nobody could judge, reported
 * against a world the operator believed they had described.
 */
function readApplication(raw: unknown): { readonly command: string; readonly args: readonly string[] } | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.process.application",
      "process.application must be an object naming the command to run and its arguments, or null " +
        "when this world starts no program at all",
    );
  }
  const command = asString(raw["command"]).trim();
  if (command === "") {
    throw defect(
      "$.process.application.command",
      "the process declaration names an application but no command to run. `application: null` is " +
        "how a world says it starts no program; an application without a command says it starts one " +
        "and leaves the reader to guess which, so every criterion about it would be judged against " +
        "a process that was never started.",
    );
  }
  return { command, args: asStringArray(raw["args"]) };
}

/**
 * The broker declaration, resolved.
 *
 * The seventh time the rule of {@link readCluster}, {@link readPosix}, {@link readOs},
 * {@link readCloud}, {@link readContainer} and {@link readVSCode} is written out - absent means not
 * this world, present-but-incomplete is **refused** - and the first time the rule meets a block that
 * carries an address.
 *
 * `cluster` and `nodeId` are refused when blank for the reason every identity before them is: a
 * defaulted cluster name would be a name the plan and every reading agree on by construction and that
 * nothing in the document ever said, so the one question these fields exist to answer - *which log is
 * this verdict about* - would be answered with a value nobody chose and no reader could check.
 *
 * `host` and `port` are the interesting half. They default, and each default is a *statement* rather
 * than a convenience: `127.0.0.1` is the only host that keeps a substitute off the network, and `0`
 * is the declaration that the operating system picks the port. A host that is not loopback is
 * therefore refused by name rather than honoured - a broker listening on a routable address is a real
 * listener, and the one thing this world must not become is a claim to be simulated while holding a
 * port the rest of the machine can reach.
 *
 * The port is validated for the same class of reason `container.platform` and `vscode.apiVersion`
 * are: it is not a label, it is a value the world acts on. A fractional or out-of-range port would
 * reach `listen()` and come back as a host-level socket error naming neither the document nor the
 * field, which sends the reader to inspect the machine rather than their file.
 */
const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"] as const;

function readData(raw: unknown): DataPlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.data",
      "data must be an object naming the cluster this world stands in for, the broker id it answers " +
        "as, and optionally the address it listens on",
    );
  }
  const cluster = asString(raw["cluster"]).trim();
  if (cluster === "") {
    throw defect(
      "$.data.cluster",
      "the data declaration names no cluster. Every reading this world produces says which log it is " +
        "about, and a cluster name is the only thing that answers it - the address cannot, because " +
        "the same address serves whichever process happens to hold the port.",
    );
  }
  const nodeId = raw["nodeId"];
  if (typeof nodeId !== "number" || !Number.isInteger(nodeId) || nodeId < 0) {
    throw defect(
      "$.data.nodeId",
      "the data declaration does not name a broker id. A reading reports the node that answered " +
        "beside the cluster it belongs to, and a node id that is missing, fractional or negative is " +
        "one this world cannot answer as - so it is refused here, before a world exists, rather than " +
        "reported as an identity nobody can act on.",
    );
  }
  const host = asString(raw["host"], "127.0.0.1").trim();
  if (host === "") {
    throw defect(
      "$.data.host",
      "the data declaration names an empty host. `host` defaults to 127.0.0.1, which is the only " +
        "spelling that keeps this substitute off the network; an explicit empty string would be " +
        "refused by the socket layer with a message naming neither this document nor this field.",
    );
  }
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) {
    throw defect(
      "$.data.host",
      `this world binds a substitute broker on ${LOOPBACK_HOSTS.join(", ")}, and the document names ` +
        `${JSON.stringify(host)}. A broker on a routable address is a real listener rather than a ` +
        "simulated one, and this world's entire claim is that it stands in for a cluster without " +
        "becoming one - so the host is refused here, where the operator's own document is in hand, " +
        "rather than bound and reported as a substitute.",
    );
  }
  const port = raw["port"] === undefined || raw["port"] === null ? 0 : raw["port"];
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw defect(
      "$.data.port",
      "the data declaration names a port outside 0..65535. `0` means the operating system chooses " +
        "one and the reading records the port really bound; any other value is the port this world " +
        "will try to hold, and a value the socket layer cannot accept would surface as a host error " +
        "naming neither this document nor this field.",
    );
  }
  return { cluster, nodeId, host, port };
}

/**
 * The device declaration, resolved.
 *
 * The eighth time the rule of {@link readCluster}, {@link readPosix}, {@link readOs}, {@link readCloud},
 * {@link readContainer}, {@link readVSCode} and {@link readData} is written out - absent means not this
 * world, present-but-incomplete is **refused** - and the second time one of these readers validates a
 * *rule* rather than accepting a label, after `container.platform`.
 *
 * `device` and `root` are refused when blank for the reason every identity and every sandbox before
 * them is. A defaulted device name would be a name the plan and every reading agree on by construction
 * and that nothing in the document ever said, so the first question a result answers - *which device
 * produced this* - would be answered with a value nobody chose; and a defaulted root would judge a
 * contract against whichever directory the process happened to be started in.
 *
 * `platform` is a rule rather than a label: it decides how a path inside the device's own storage is
 * spelled. The schema also constrains it, so from a *validated* document this check cannot be reached - 
 * the `enum` refuses an unimplemented platform first, and the reader below is left with the blank case
 * only. It is kept for the reason `readContainer` and `readOs` keep theirs: the loader is also reached
 * through the partial path the clarification ladder uses, where the schema is relaxed and a value the
 * enumeration would have refused arrives here instead. A reader that trusted the schema would leave that
 * path judging a document by a path grammar its own document never named.
 */
function readMobile(raw: unknown, appPath: string): MobilePlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect(
      "$.mobile",
      "mobile must be an object naming the device this world stands in for, the platform it answers " +
        "as, and the sandbox root it holds its bundles and device state in",
    );
  }
  const device = asString(raw["device"]).trim();
  const platform = asString(raw["platform"]).trim();
  const root = asString(raw["root"]).trim();
  const missing = [
    device === "" ? "device" : null,
    platform === "" ? "platform" : null,
    root === "" ? "root" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw defect(
      `$.mobile.${missing[0] ?? "device"}`,
      `the device declaration is missing ${missing.join(", ")}. The device is what every reading ` +
        "names, the platform is what decides how a path inside the device is spelled, and the root is " +
        "the directory on this machine the world's bundles and device state live in - defaulting any " +
        "of them would produce a verdict about a device nobody described.",
    );
  }
  if (!(MOBILE_PLATFORMS as readonly string[]).includes(platform)) {
    throw defect(
      "$.mobile.platform",
      `this world stands in for ${MOBILE_PLATFORMS.join(" and ")} devices, and the document names ` +
        `${JSON.stringify(platform)}. The platform is not a label on the readings - it is what decides ` +
        "how a path inside the device's own storage is spelled - so a document naming one this " +
        "substitution does not implement is a document whose every criterion would resolve paths by " +
        "the wrong grammar.",
    );
  }
  return {
    device,
    platform: platform as MobilePlan["platform"],
    root: resolveSibling({ dir: appPath, path: "", text: "" }, root),
  };
}

function readBoundary(limits: GoalLimits): BoundaryPolicy {
  return {
    network: limits.networkPolicy,
    allow: limits.networkPolicy === "allow-list" ? limits.networkAllowList : [],
    filesystemWrite: limits.filesystemWrite,
  };
}
/**
 * Turn a resolved environment document into a plan.
 *
 * Called after the ambiguity protocol, so a throw here means a blocking gap survived resolution or a
 * defect the partial loader could not see. Both must abort: an environment that is half-decided is
 * the one input that can turn "we could not test it" into "it passed".
 */
export function finalizeEnvironment(
  raw: Readonly<Record<string, unknown>>,
  schemas: SchemaSet,
  source: SourceRef,
  limits: GoalLimits,
): EnvironmentPlan {
  schemas.get(SCHEMA_URIS.environment).assert(raw);

  const app = asString(raw["app"]).replace(/\\/g, "/").replace(/\/+$/, "");
  const start = isPlainObject(raw["start"]) ? raw["start"] : {};
  const command = asString(start["command"]);
  if (!command) {
    throw defect("$.start.command", "an environment with no start command describes a world nobody can enter");
  }

  const rawReset = isPlainObject(raw["reset"]) ? raw["reset"] : {};
  const strategy = asString(rawReset["strategy"], "restart");
  if (!(RESET_STRATEGIES as readonly string[]).includes(strategy)) {
    throw defect("$.reset.strategy", `reset.strategy must be one of ${RESET_STRATEGIES.join(", ")}`);
  }
  const resetCommand = typeof rawReset["command"] === "string" ? rawReset["command"] : null;

  // A cross-field rule the schema cannot state, and one that cannot be defaulted. "custom" without a
  // command is an environment that silently never resets — and a validator inheriting state from a
  // previous iteration is exactly the contamination that reset exists to prevent.
  if (strategy === "custom" && (resetCommand === null || resetCommand.trim() === "")) {
    throw defect(
      "$.reset.command",
      'reset.strategy is "custom" but no command was given. A reset that does not happen is worse ' +
        "than no reset at all, because the run reports a verdict that another run's state produced.",
    );
  }

  const url = trimTrailingSlash(asString(raw["url"]));
  const readyPattern = typeof start["readyPattern"] === "string" ? start["readyPattern"] : null;
  // The database file, resolved the way `app` is: relative to the environment file, because that is
  // the only directory the schema says a relative path is relative to. Resolved here rather than by
  // the adapter so that every reader of the plan - the adapter, the bundle, a failure report - names
  // the same absolute file, and so that `""` is the one spelling of "this world is not a database".
  const database = asString(raw["databasePath"]).trim();
  // Resolved once, because two readers need it: `appPath` itself, and the cluster declaration's
  // image directory, which the schema says is relative to `app`.
  const appPath = resolveSibling(source, app === "" ? "." : app);

  return {
    adapter: asString(raw["adapter"]),
    app,
    // Resolved against the environment file, which is the only directory the schema says `app` is
    // relative to. A process runner handed a bare "." would spawn in whatever the current working
    // directory happened to be, which is how a test suite ends up passing from the wrong folder.
    appPath,
    env: readEnv(raw["env"]),
    dependencyInstall:
      typeof raw["dependencyInstall"] === "string" && raw["dependencyInstall"].trim() !== ""
        ? raw["dependencyInstall"]
        : null,
    start: {
      command,
      args: asStringArray(start["args"]),
      readyPattern,
    },
    url: url === "" ? null : url,
    databasePath: database === "" ? null : resolveSibling(source, database),
    api: readApi(raw["api"]),
    cluster: readCluster(raw["cluster"], appPath),
    posix: readPosix(raw["posix"], appPath),
    os: readOs(raw["os"], appPath),
    cloud: readCloud(raw["cloud"]),
    container: readContainer(raw["container"], appPath),
    vscode: readVSCode(raw["vscode"], appPath),
    process: readProcess(raw["process"], appPath),
    data: readData(raw["data"]),
    mobile: readMobile(raw["mobile"], appPath),
    health: readHealth(raw["health"], url !== "", readyPattern),
    reset: { strategy: strategy as ResetStrategy, command: resetCommand },
    browser: readBrowser(raw["browser"], url !== ""),
    boundary: readBoundary(limits),
  };
}
