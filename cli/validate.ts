/**
 * One run, composed once.
 *
 * This is the composition `cli/veridian.ts` used to hold inline, extracted because there is now a
 * **second** front door onto the same lifecycle. The MCP surface (`mcp/`) reaches the *same* capability
 * through the *same* steps rather than re-implementing them, which is the whole content of the rule
 * this project states as *"an MCP tool may not be the first implementation of anything"* - a tool whose
 * capability did not already exist would be the surface inventing a Core feature, and a second
 * composition of one run would be two implementations of one rule that disagree the first time a world
 * arrives that only one of them was written for.
 *
 * What is here is the wiring only. Every decision - which rungs the ladder tries, what a PASS requires,
 * when an iteration may continue - is still in `core/`, and this file decides nothing about them.
 *
 * What is deliberately **not** here is printing. A refusal is returned as data (`ValidationRefusal`)
 * so that the command line can render it as prose a human reads and the MCP surface can render it as
 * `isError: true` with the same reason attached. A module that wrote to stdout would be a module only
 * one of its two consumers could use.
 */

import { playwrightBrowser } from "../adapters/local-web/index.ts";
import type { BrowserPort } from "../adapters/local-web/index.ts";
import type { Logger } from "../core/clarification/index.ts";
import type { DefinitionOutcome, ResolvedDefinition, IncompleteDefinition } from "../core/definition.ts";
import { EnvironmentManager } from "../core/environment/index.ts";
import type { EnvironmentPlan } from "../core/environment/index.ts";
import { RunBundle, bundleLayout, captureReproducibility } from "../core/evidence/index.ts";
import { runValidationLoop } from "../core/execution/index.ts";
import type { LoopResult } from "../core/execution/index.ts";
import { dirOf } from "../core/goal/index.ts";
import type { Goal } from "../core/goal/index.ts";
import type { IoPort } from "../core/io.ts";
import { nodeProcessRunner } from "../core/process.ts";
import type { ProcessRunner } from "../core/process.ts";
import { createRunHandle, createRunId } from "../core/run/index.ts";
import type { ValidationPlan } from "../core/acceptance/index.ts";

import { applyBrowserChoice } from "./arguments.ts";
import type { CliArguments } from "./arguments.ts";
import { define, runtimeDetectorContext } from "./session.ts";
import type { Session } from "./session.ts";
import { selectRepairGate, systemClock } from "./support.ts";
import { describeWorlds, findWorld } from "./worlds.ts";

/**
 * The three values `--browser` accepts, taken from the parse that already validates them.
 *
 * Named here rather than exported from `cli/arguments.ts` because it is an alias of a property type,
 * not a declaration - and a second declaration of a three-member union is a second place to add a
 * fourth member. `cli/arguments.ts` owns the spelling; this names it.
 */
export type BrowserChoice = CliArguments["browser"];

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

/** A disclosure the run decided to make. The caller prints it; this module never does. */
export interface ValidationNotice {
  readonly level: "warn";
  readonly topic: string;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Why a definition cannot be run, in two parts.
 *
 * Split rather than one blob because two consumers read it differently: a terminal prints both lines
 * in order, and an MCP caller wants the title as the failure's `reason` and the body as what to do
 * about it. One string would force the second consumer to parse the first's line breaks.
 */
export interface ValidationRefusal {
  /** What cannot be done, as one statement. */
  readonly title: string;
  /** The alternatives this build does hold, or the reason, ready to print underneath. */
  readonly body: string;
}

/** The world a definition resolved to, built and ready but not yet prepared. */
export interface BuiltWorld {
  readonly manager: EnvironmentManager;
  readonly plan: ValidationPlan;
  readonly environment: EnvironmentPlan;
  readonly goal: Goal;
  readonly browser: BrowserPort | null;
  /** `chromium`, `chromium (headed)` or `none` - the fact the run's transcript states. */
  readonly browserLabel: string;
}

export type EnvironmentOutcome =
  | { readonly kind: "incomplete"; readonly definition: IncompleteDefinition }
  | {
      readonly kind: "unusable";
      readonly definition: ResolvedDefinition;
      readonly refusal: ValidationRefusal;
    }
  | { readonly kind: "built"; readonly definition: ResolvedDefinition; readonly world: BuiltWorld };

export type ValidationOutcome =
  | { readonly kind: "incomplete"; readonly definition: IncompleteDefinition }
  | {
      readonly kind: "unusable";
      readonly definition: ResolvedDefinition;
      readonly refusal: ValidationRefusal;
    }
  | {
      readonly kind: "ran";
      readonly definition: ResolvedDefinition;
      readonly result: LoopResult;
      readonly runId: string;
    };

export interface EnvironmentRequest {
  readonly session: Session;
  readonly logger: Logger;
  readonly goalPath: string;
  /**
   * The directory a sandbox may live under, and where a bundle lands.
   *
   * Required rather than defaulted here. `cli/arguments.ts` owns the `.veridian` default and applies
   * it while parsing, so a request that reached this far without one is a caller that skipped that
   * step - and a world built against an invented directory would place its sandbox somewhere nobody
   * asked for, which is worse than a compile error.
   */
  readonly stateDir: string;
  readonly browser: BrowserChoice;
  readonly headed: boolean;
  /** Called the moment the definition settles, before a world is built or a bundle is opened. */
  readonly onDefinition?: (outcome: DefinitionOutcome) => void;
}

/** A run is a world plus the repair configuration plus the channel a disclosure travels back on. */
export interface RunRequest extends EnvironmentRequest {
  /** The repair command and its arguments, when the caller named one. */
  readonly repair: readonly string[] | null;
  /**
   * Observe the application exactly once, attempting no iteration.
   *
   * Required rather than defaulted, and deliberately so. `null` repair with `noRepair: false` selects
   * the *manual* gate, which is a real choice with a real consequence - a run with no terminal attached
   * stops after one iteration - so a caller that meant "I have no repair command" and a caller that
   * meant "wait for me" must not be spelled the same way. `selectRepairGate` states which it chose in
   * the reason it returns, and the loop records that reason.
   */
  readonly noRepair: boolean;
  readonly onNotice?: (notice: ValidationNotice) => void;
}

// ---------------------------------------------------------------------------------------------
// Building a world
// ---------------------------------------------------------------------------------------------

/**
 * DEFINE, then build the world the definition names - or say why it cannot be built.
 *
 * Exported separately from `runValidation` because the lifecycle this project ships has more than one
 * entry point onto the same world: a run observes it, while `create_environment`, `reset_environment`
 * and `snapshot_environment` act on it without observing anything. Both reach the adapter through this
 * function, so there is one place that decides which world a contract means.
 */
export async function buildEnvironment(request: EnvironmentRequest): Promise<EnvironmentOutcome> {
  const definition = await define(request.session, request.goalPath);
  request.onDefinition?.(definition);
  if (definition.kind === "incomplete") return { kind: "incomplete", definition };

  const { plan, environment, goal } = definition;
  const registration = findWorld(environment.adapter);
  if (registration === null) {
    // A lookup against the same table the clarification ladder read, so this refusal is the second
    // half of one answer rather than a second opinion: a document naming an unregistered adapter has
    // already been reported as an unsettled blocking gap, and reaching here means the gap was
    // answered with a name that still does not exist. The list is printed from the table, so it
    // cannot drift from the worlds that do.
    return {
      kind: "unusable",
      definition,
      refusal: {
        title: `This build cannot run the "${environment.adapter}" adapter. Registered worlds:`,
        body: describeWorlds(),
      },
    };
  }

  // The flag is applied to the plan before anything is built from it, so the adapter, the loop and
  // the environment record all describe one world: the one that ran.
  //
  // A world with no address has no page, so `--browser playwright` cannot mean anything for it. It
  // was accepted anyway, and the record then named a browser the run never launched - `chromium` in
  // `reproducibility.browser` for a run whose only interaction was a SQL query. That is the same
  // defect as the old `--browser none`, one layer out: a flag applied to an object built from the
  // plan, describing a world the plan did not have. Refused here so the operator learns it now
  // rather than from a bundle later. `--browser none` and `auto` remain meaningful and still work.
  if (request.browser === "playwright" && environment.url === null) {
    return {
      kind: "unusable",
      definition,
      refusal: {
        title:
          `The "${environment.adapter}" world has no address, so there is no page for a browser ` +
          "to observe.",
        body: "Drop --browser playwright: nothing in this contract is a browser observation.",
      },
    };
  }

  const runtimeEnvironment = applyBrowserChoice(environment, request.browser);
  const wantsBrowser = runtimeEnvironment.browser.enabled;
  const browser = wantsBrowser ? playwrightBrowser({ headless: !request.headed }) : null;

  const adapter = registration.build({
    environment: runtimeEnvironment,
    io: request.session.io,
    logger: request.logger,
    processes: nodeProcessRunner,
    stateDir: request.stateDir,
    browser,
  });
  const manager = new EnvironmentManager({ adapter, clock: systemClock, logger: request.logger });

  return {
    kind: "built",
    definition,
    world: {
      manager,
      plan,
      environment: runtimeEnvironment,
      goal,
      browser,
      browserLabel: wantsBrowser ? (request.headed ? "chromium (headed)" : "chromium") : "none",
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------------------------

export async function runValidation(request: RunRequest): Promise<ValidationOutcome> {
  const built = await buildEnvironment(request);
  if (built.kind !== "built") return built;

  const { definition, world } = built;
  const { plan, environment, goal } = definition;
  const session = request.session;

  // ---- the run's identity -------------------------------------------------------------------
  const runId = createRunId(systemClock);
  const layout = bundleLayout(request.stateDir, runId);
  const bundle = new RunBundle({
    io: session.io,
    layout,
    clock: systemClock,
    schemas: session.schemas,
  });
  await bundle.init();
  // The definition is copied in before anything else runs, so a bundle is never a result whose
  // inputs were edited afterwards.
  await bundle.writeDefinition(definition.goalSource.text, definition.acceptanceSource.text);

  const run = createRunHandle({
    clock: systemClock,
    runId,
    goalId: goal.id,
    maxIterations: goal.limits.maxIterations,
  });

  const repair = selectRepairGate({
    command: request.repair ?? null,
    noRepair: request.noRepair,
    user: session.user,
    runner: nodeProcessRunner,
    cwd: session.io.cwd,
    logger: request.logger,
  });

  // ---- what made this run reproducible -----------------------------------------------------
  const git = await observeGit(nodeProcessRunner, session.io.cwd);
  const reproducibility = await captureReproducibility({
    clock: systemClock,
    veridianVersion: await readVersion(session.io, "package.json"),
    gitCommit: git.commit,
    gitDirty: git.dirty,
    playwright:
      world.browser === null
        ? null
        : await firstVersion(session.io, [
            "node_modules/playwright/package.json",
            "node_modules/playwright-core/package.json",
          ]),
    // The adapter launches Chromium and nothing else, so the engine is observed rather than guessed.
    browser: world.browser === null ? null : "chromium",
    networkPolicy: goal.limits.networkPolicy,
  });

  request.logger.info("running", {
    run: runId,
    criteria: String(plan.criteria.length),
    repair: repair.reason,
    browser: world.browserLabel,
    selfPrompt: session.selfPromptLabel,
    memory: session.memoryLabel,
  });

  // A declared boundary is not an enforced one, and here the operator is who chose the world that
  // cannot hold it: `--browser none` removes the only component able to refuse a request, so a goal
  // that says `deny` is measured in a world where `deny` is a word in a file. Said out loud because
  // the alternative is a fact found only by whoever reads `environment.json` afterwards, which is not
  // the person who made the choice.
  //
  // Deliberately narrow. Only the network half is disclosed here, and only for the case the caller
  // observed: it built this world, so it knows whether a guard exists in it. The adapter's standing
  // capabilities - `filesystemWrite` among them - are the adapter's claim about itself, and the full
  // policy-by-enforcement pairing is written to the bundle by the layer that owns both halves.
  // Repeating a capability here would be a second opinion that goes stale the moment an adapter grows
  // one, and warning about `filesystemWrite` on every run would make the signal deafening on the
  // default goal.
  //
  // The condition is "a browser was *removed*", not "there is no browser". It used to be the second,
  // and the difference is a sentence that names a cause the caller did not observe: `network !==
  // "allow"` with no browser is also the ordinary state of every world that never had one - a database
  // file, a cluster, a simulated provider account - and there `npm run demo:db --browser none` printed
  // *"the run was planned without a browser, so nothing can refuse a request on its behalf"* about a
  // world whose document has no `url` for a browser to open, where the operator planned no such thing
  // and the reason given describes a component that could never have existed. A component can only be
  // removed from a world that was going to have it, so the document's own `browser.enabled` is what
  // decides - and a world whose adapter refuses crossings itself, without a browser, is then left to
  // report its own enforcement through `boundaries()`, which is where that fact lives.
  if (
    environment.browser.enabled &&
    world.browser === null &&
    world.environment.boundary.network !== "allow"
  ) {
    request.onNotice?.({
      level: "warn",
      topic: "boundary",
      fields: {
        declared: `networkPolicy: ${world.environment.boundary.network}`,
        enforcement: "unsupported",
        reason: "the run was planned without a browser, so nothing can refuse a request on its behalf",
      },
    });
  }

  // ---- the loop ----------------------------------------------------------------------------
  // Everything above is preparation. From here on the run is governed by `core/execution/loop.ts`,
  // which owns the state machine, the bounded exits and the verdict. The detector context is rebuilt
  // through the same constructor `resolveDefinition` used, against the environment path - because the
  // runtime questions are about *that* application, and `appDir` is what lets the detectors see it.
  const result = await runValidationLoop({
    io: session.io,
    schemas: session.schemas,
    clock: systemClock,
    logger: request.logger,
    world: world.manager,
    registry: session.registry,
    plan,
    environment: world.environment,
    limits: goal.limits,
    clarifier: session.clarifier,
    detectorContext: runtimeDetectorContext(
      session,
      definition.environmentPath,
      dirOf(definition.environmentPath),
    ),
    repairGate: repair.gate,
    bundle,
    run,
    reproducibility,
    definitionReports: [
      definition.reports.goal,
      definition.reports.acceptance,
      definition.reports.environment,
    ],
    memory: session.memory,
  });

  return { kind: "ran", definition, result, runId };
}

// ---------------------------------------------------------------------------------------------
// Reproducibility facts
// ---------------------------------------------------------------------------------------------

/**
 * Where the code was when the run started.
 *
 * Best effort on purpose: a tree with no `git` is a reproducible run with an unknown commit, which is
 * a fact worth recording, not a reason to refuse one. The pair is reported together because a commit
 * alone is ambiguous - the same hash with a dirty tree is a different program.
 */
async function observeGit(
  runner: ProcessRunner,
  cwd: string,
): Promise<{ commit: string | null; dirty: boolean | null }> {
  const commit = await runGit(runner, cwd, ["rev-parse", "HEAD"]);
  if (commit === null) return { commit: null, dirty: null };
  const status = await runGit(runner, cwd, ["status", "--porcelain"]);
  return { commit, dirty: status === null ? null : status.trim().length > 0 };
}

async function runGit(
  runner: ProcessRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const handle = runner.run({ command: "git", args: [...args], cwd });
    const result = await handle.exited;
    if (result.code !== 0) return null;
    const text = result.stdout.trim();
    return text.length === 0 ? null : text;
  } catch {
    return null;
  }
}

async function readVersion(io: IoPort, path: string): Promise<string> {
  const version = await firstVersion(io, [path]);
  return version ?? "unknown";
}

async function firstVersion(io: IoPort, paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    const text = await io.readTextFile(path).catch(() => null);
    if (text === null) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null) {
        const version = (parsed as { version?: unknown }).version;
        if (typeof version === "string") return version;
      }
    } catch {
      // A malformed manifest is a fact about the checkout, not a reason to fail a run. The next
      // candidate is tried, and an unreadable version becomes `"unknown"` in `readVersion` above.
    }
  }
  return null;
}