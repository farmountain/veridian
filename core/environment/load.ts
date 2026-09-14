import { DefinitionError, loadDocument, resolveSibling } from "../goal/load.ts";
import type { GoalDocument, GoalLimits, SourceRef } from "../goal/types.ts";
import type { ReadonlyIoPort } from "../io.ts";
import { SCHEMA_URIS, type SchemaSet } from "../schema/index.ts";
import { OS_FAMILIES, PRIVILEGED_OS_ACCOUNTS } from "./os-observation.ts";
import {
  RESET_STRATEGIES,
  type BoundaryPolicy,
  type BrowserPolicy,
  type ClusterPlan,
  type EnvironmentPlan,
  type HealthPolicy,
  type OsPlan,
  type PosixPlan,
  type ResetStrategy,
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
    cluster: readCluster(raw["cluster"], appPath),
    posix: readPosix(raw["posix"], appPath),
    os: readOs(raw["os"], appPath),
    health: readHealth(raw["health"], url !== "", readyPattern),
    reset: { strategy: strategy as ResetStrategy, command: resetCommand },
    browser: readBrowser(raw["browser"], url !== ""),
    boundary: readBoundary(limits),
  };
}
