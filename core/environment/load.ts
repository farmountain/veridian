import { DefinitionError, loadDocument, resolveSibling } from "../goal/load.ts";
import type { GoalDocument, SourceRef } from "../goal/types.ts";
import type { ReadonlyIoPort } from "../io.ts";
import { SCHEMA_URIS, type SchemaSet } from "../schema/index.ts";
import {
  RESET_STRATEGIES,
  type BrowserPolicy,
  type EnvironmentPlan,
  type HealthPolicy,
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
export function probeUrl(plan: EnvironmentPlan): string {
  const path = plan.health.path.startsWith("/") ? plan.health.path : `/${plan.health.path}`;
  return `${trimTrailingSlash(plan.url)}${path}`;
}

function readEnv(raw: unknown): Readonly<Record<string, string>> {
  if (!isPlainObject(raw)) return {};
  const entries = Object.entries(raw).filter(([, value]) => typeof value === "string");
  return Object.fromEntries(entries) as Record<string, string>;
}

function readHealth(raw: unknown): HealthPolicy {
  const health = isPlainObject(raw) ? raw : {};
  return {
    path: asString(health["path"], "/"),
    expectStatus: asNumber(health["expectStatus"], 200),
    timeoutMs: asNumber(health["timeoutMs"], 20_000),
    intervalMs: asNumber(health["intervalMs"], 100),
    readyPattern: typeof health["readyPattern"] === "string" ? health["readyPattern"] : null,
  };
}

function readBrowser(raw: unknown): BrowserPolicy {
  const browser = isPlainObject(raw) ? raw : {};
  const viewport = isPlainObject(browser["viewport"]) ? browser["viewport"] : null;
  return {
    enabled: browser["enabled"] !== false,
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
  if (!url) throw defect("$.url", "an environment with no URL has no address to health check");

  return {
    adapter: asString(raw["adapter"]),
    app,
    // Resolved against the environment file, which is the only directory the schema says `app` is
    // relative to. A process runner handed a bare "." would spawn in whatever the current working
    // directory happened to be, which is how a test suite ends up passing from the wrong folder.
    appPath: resolveSibling(source, app === "" ? "." : app),
    env: readEnv(raw["env"]),
    dependencyInstall:
      typeof raw["dependencyInstall"] === "string" && raw["dependencyInstall"].trim() !== ""
        ? raw["dependencyInstall"]
        : null,
    start: {
      command,
      args: asStringArray(start["args"]),
      readyPattern: typeof start["readyPattern"] === "string" ? start["readyPattern"] : null,
    },
    url,
    health: readHealth(raw["health"]),
    reset: { strategy: strategy as ResetStrategy, command: resetCommand },
    browser: readBrowser(raw["browser"]),
  };
}
