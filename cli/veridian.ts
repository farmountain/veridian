#!/usr/bin/env node
/**
 * Veridian — the command line.
 *
 * This file is wiring, and nothing else. Every decision it appears to make has already been made in
 * `core/`: which rungs the clarification ladder tries, what a PASS requires, when an iteration may
 * continue, when a run stops. What is left here is the handful of things only a process can answer —
 * where stdin points, whether `git` is on the PATH, whether Playwright was ever installed — plus the
 * order in which those answers are assembled.
 *
 * Three shapes are worth reading before the code:
 *
 * 1. **`validate` cannot run an unresolved definition.** A gap the ladder could not close is not
 *    smoothed over here; `resolveDefinition` returns `incomplete` and this exits with code 2. The
 *    alternative — running anyway and reporting `INCONCLUSIVE` — would spend real time starting an
 *    application in order to produce a result that was already known before it started.
 * 2. **Refusal is reported, never swallowed.** A definition that cannot run prints *why*, one line
 *    per gap, so an operator reads the same fact the bundle would have recorded.
 * 3. **The exit code is a total function of the verdict.** `0` only for PASS. `INCONCLUSIVE` gets its
 *    own code because collapsing it into either neighbour would be a lie in one direction or the
 *    other. See `exitCodeForVerdict` in `./support.ts`.
 *
 * CLI shape and the failure taxonomy live side by side on purpose: the taxonomy exists so a failure
 * can be *classified*, and the exit code exists so a caller can *branch* on the classification without
 * parsing prose.
 */

import type {
  ClarificationReport,
  Logger,
  UserPromptPort,
} from "../core/clarification/index.ts";
import {
  ClarificationEngine,
  NullSelfPromptPort,
  createDeriver,
  defaultDeriveRules,
} from "../core/clarification/index.ts";
import { detectorContextFor, resolveDefinition } from "../core/definition.ts";
import type { DefinitionOutcome } from "../core/definition.ts";
import { assetsRoot } from "../core/assets.ts";
import { EnvironmentManager } from "../core/environment/index.ts";
import {
  RunBundle,
  bundleLayout,
  captureReproducibility,
} from "../core/evidence/index.ts";
import type { LoopResult } from "../core/execution/index.ts";
import { runValidationLoop } from "../core/execution/index.ts";
import { dirOf } from "../core/goal/index.ts";
import { nodeIo } from "../core/io.ts";
import type { IoPort } from "../core/io.ts";
import { formatMetrics, measureRunHistory } from "../core/metrics/index.ts";
import { HttpMemory, MemoryInferrer, NullMemory } from "../core/memory/index.ts";
import type { MemoryPort } from "../core/memory/index.ts";
import { nodeProcessRunner } from "../core/process.ts";
import type { ProcessRunner } from "../core/process.ts";
import { createRunHandle, createRunId } from "../core/run/index.ts";
import { loadSchemaSet } from "../core/schema/index.ts";
import type { SchemaSet } from "../core/schema/registry.ts";
import { ValidatorRegistry } from "../core/validation/index.ts";
import {
  PLAYWRIGHT_MISSING,
  playwrightBrowser,
} from "../adapters/local-web/index.ts";
import { webUiValidators } from "../validators/playwright/index.ts";
import { dbValidators } from "../validators/database/index.ts";
import { k8sValidators } from "../validators/k8s/index.ts";
import { posixValidators } from "../validators/posix/index.ts";
import { osValidators } from "../validators/os/index.ts";
import { cloudValidators } from "../validators/cloud/index.ts";
import { containerValidators } from "../validators/container/index.ts";
import { vscodeValidators } from "../validators/vscode/index.ts";
import { apiValidators } from "../validators/api/index.ts";

import type { CliArguments } from "./arguments.ts";
import {
  DEFAULT_MEMORY_URL,
  USAGE,
  UsageError,
  applyBrowserChoice,
  parseArguments,
} from "./arguments.ts";
import {
  EXIT_CODES,
  consoleLogger,
  createCliPromptPort,
  createSelfPromptPort,
  exitCodeForVerdict,
  selectRepairGate,
  systemClock,
} from "./support.ts";
import {
  adapterDescriptors,
  describeWorlds,
  findWorld,
  registeredAdapters,
} from "./worlds.ts";

/**
 * Every validator this build can judge with.
 *
 * Every family, because the registry is what decides whether a criterion is *answerable* and
 * the answer must not depend on which world the run chose. A contract that names `db.value`,
 * `db.value`, `k8s.ready`, `posix.permission`, `os.access`, `cloud.object`, `container.state` or
 * `vscode.command` is judged by the
 * world that can observe it and refused with `unresolvable_entity` everywhere else - by the plan
 * decoder, at DEFINE, before anything starts. Registering a family only when a world that can answer
 * it was selected would make the *same contract* resolvable in one world and nonsensical in another,
 * and the resolvability of a criterion is a property of the criterion.
 */
function allValidators() {
  return [
    ...webUiValidators(),
    ...dbValidators(),
    ...k8sValidators(),
    ...posixValidators(),
    ...osValidators(),
    ...cloudValidators(),
    ...containerValidators(),
    ...vscodeValidators(),
    ...apiValidators(),
  ];
}

/** The actor name memory records are written under. */
const MEMORY_ACTOR = "Veridian";

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let parsed: CliArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      write(`${error.message}\n\n${USAGE}\n`);
      return EXIT_CODES.unusable;
    }
    throw error;
  }

  const logger = consoleLogger({ level: parsed.logLevel });

  if (parsed.command === "help") {
    write(`${USAGE}\n`);
    return EXIT_CODES.pass;
  }

  try {
    if (parsed.command === "init") return await runInit(parsed, logger);
    if (parsed.command === "clarify") return await runClarify(parsed, logger);
    if (parsed.command === "metrics") return await runMetrics(parsed, logger);
    return await runValidate(parsed, logger);
  } catch (error) {
    // A definition that will not load is a *caller* problem, not a verdict: a missing file, a schema
    // violation, a truncated YAML. It exits 3 rather than 1 so that it can never be mistaken for
    // "the application under test failed" — which is the one thing a caller will act on.
    write(`\nveridian: ${message(error)}\n`);
    logger.debug("command failed", { error: message(error) });
    return EXIT_CODES.unusable;
  }
}

// ---------------------------------------------------------------------------------------------
// The session: everything shared by every subcommand
// ---------------------------------------------------------------------------------------------

interface Session {
  readonly io: IoPort;
  readonly schemas: SchemaSet;
  readonly registry: ValidatorRegistry;
  readonly clarifier: ClarificationEngine;
  /** The same port the clarification ladder and the manual repair gate both ask through. */
  readonly user: UserPromptPort;
  /** How much material rung 4 can read, or the fact that the rung is unplugged. */
  readonly selfPromptLabel: string;
  readonly memory: MemoryPort;
  readonly memoryLabel: string;
}

async function openSession(parsed: CliArguments, logger: Logger): Promise<Session> {
  const io = nodeIo();

  // Two ports on purpose, because there are two roots and only one of them is the operator's.
  // `io` resolves the operator's files (`--goal my-app/goal.yaml`) against the working directory,
  // which is what those paths mean. The schemas are not the operator's files: they shipped inside
  // the package, so they are resolved against the module that ships them. Reading them through `io`
  // worked only while the CLI was run from the repository root; installed, it asked the caller's
  // directory for Veridian's own schema and reported it missing. See `core/assets.ts`.
  const schemas = await loadSchemaSet(nodeIo({ root: assetsRoot() }));
  const registry = new ValidatorRegistry(allValidators());

  // One prompt port for the whole process. Two ports would be two answers to "is a human watching",
  // and the one that agreed with the other would be the one nobody checked.
  const user = createCliPromptPort();

  // The material the run reads to answer its own gaps: the names it is already holding because it
  // registered them. Deliberately not "everything on disk" — a self-prompt may corroborate a
  // candidate the contract already offered, and a wider reading would be the run inventing one.
  //
  // `--no-self-prompt` replaces the port rather than narrowing the material, because a port holding
  // no names would report `available: false` for a reason the operator did not choose. The null port
  // is the ladder's own word for "there is no self to prompt", so the rung is *skipped* rather than
  // declined, and the two are different: a declined round is work the run did and reported, a skipped
  // rung is work it never attempted. The label is a fact about which of those happened, reported
  // beside the memory and prompt facts for the same reason they are - an operator reading a
  // transcript in which rung 4 never fired cannot otherwise tell it was unplugged.
  const material = [...registry.names(), ...registeredAdapters()];
  const selfPrompt = parsed.noSelfPrompt
    ? { port: NullSelfPromptPort, label: "disabled (--no-self-prompt)" }
    : {
        port: createSelfPromptPort({ material, logger }),
        label: `from ${String(material.length)} registered names`,
      };

  const memory = selectMemory(parsed, logger);

  const clarifier = new ClarificationEngine({
    derive: createDeriver(defaultDeriveRules(io)),
    infer: new MemoryInferrer(memory.port),
    selfPrompt: selfPrompt.port,
    user,
    clock: systemClock,
    logger,
  });

  return {
    io,
    schemas,
    registry,
    clarifier,
    user,
    selfPromptLabel: selfPrompt.label,
    memory: memory.port,
    memoryLabel: memory.label,
  };
}

/**
 * Memory is enabled by default and degrades loudly.
 *
 * `HttpMemory` never throws and never blocks a run — it flips its own `available` flag and logs once
 * — so the honest default is to *use* memory and let an absent server be a warning rather than a
 * prerequisite. Requiring a server would make an offline run impossible; silently skipping the write
 * would make the record a lie. `--no-memory` is for the third case, where an operator wants a run
 * that provably consulted nothing.
 */
function selectMemory(parsed: CliArguments, logger: Logger): { port: MemoryPort; label: string } {
  if (parsed.noMemory) {
    return { port: new NullMemory(), label: "disabled (--no-memory)" };
  }
  const url = parsed.memoryUrl ?? process.env["HIPCORTEX_URL"] ?? DEFAULT_MEMORY_URL;
  return {
    port: new HttpMemory({ baseUrl: url, actor: MEMORY_ACTOR, logger }),
    label: url,
  };
}

/** Read the goal, close every gap the protocol can close, and report what it could not. */
async function define(session: Session, parsed: CliArguments): Promise<DefinitionOutcome> {
  return resolveDefinition(
    session.io,
    session.schemas,
    {
      goalPath: parsed.goalPath,
      registry: session.registry,
      registeredAdapters: registeredAdapters(),
      adapterDescriptors: adapterDescriptors(),
    },
    session.clarifier,
  );
}

// ---------------------------------------------------------------------------------------------
// clarify
// ---------------------------------------------------------------------------------------------

/**
 * Resolve the definition and print the transcript. Nothing is started and nothing is judged.
 *
 * This exists because the interesting part of a run is usually invisible. When a goal resolves by
 * *derivation* rather than by a human answer, the run that follows looks identical to one where a
 * person confirmed every field — and an operator who cannot tell those apart has no way to audit the
 * assumptions their verdicts rest on. So the transcript is a first-class output, not a debug flag.
 */
async function runClarify(parsed: CliArguments, logger: Logger): Promise<number> {
  const session = await openSession(parsed, logger);
  logger.info("resolving the definition", {
    goal: parsed.goalPath,
    memory: session.memoryLabel,
    selfPrompt: session.selfPromptLabel,
    prompt: session.user.available ? "terminal" : "unavailable",
  });

  const outcome = await define(session, parsed);
  write(`\n${parsed.goalPath}\n`);
  printReports(namedReports(outcome));

  if (outcome.kind === "incomplete") {
    printIncomplete(outcome);
    return EXIT_CODES.inconclusive;
  }

  write(`\nresolved: ${String(outcome.plan.criteria.length)} criteria against ${outcome.environment.adapter}\n`);
  write(`  acceptance: ${outcome.acceptancePath}\n`);
  write(`  environment: ${outcome.environmentPath}\n`);
  write(`  run it with: veridian validate --goal ${parsed.goalPath}\n`);
  return EXIT_CODES.pass;
}

// ---------------------------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------------------------

async function runValidate(parsed: CliArguments, logger: Logger): Promise<number> {
  const session = await openSession(parsed, logger);
  logger.info("resolving the definition", {
    goal: parsed.goalPath,
    memory: session.memoryLabel,
    selfPrompt: session.selfPromptLabel,
    prompt: session.user.available ? "terminal" : "unavailable",
  });

  const outcome = await define(session, parsed);
  printReports(namedReports(outcome));

  if (outcome.kind === "incomplete") {
    printIncomplete(outcome);
    return EXIT_CODES.inconclusive;
  }

  const { plan, environment, goal } = outcome;
  const registration = findWorld(environment.adapter);
  if (registration === null) {
    // A lookup against the same table the clarification ladder read, so this refusal is the second
    // half of one answer rather than a second opinion: a document naming an unregistered adapter has
    // already been reported as an unsettled blocking gap, and reaching here means the gap was
    // answered with a name that still does not exist. The list is printed from the table, so it
    // cannot drift from the worlds that do.
    write(
      `\nThis build cannot run the "${environment.adapter}" adapter. Registered worlds:\n` +
        `${describeWorlds()}\n`,
    );
    return EXIT_CODES.unusable;
  }

  // ---- the run's identity -------------------------------------------------------------------
  const runId = createRunId(systemClock);
  const layout = bundleLayout(parsed.stateDir, runId);
  const bundle = new RunBundle({
    io: session.io,
    layout,
    clock: systemClock,
    schemas: session.schemas,
  });
  await bundle.init();
  // The definition is copied in before anything else runs, so a bundle is never a result whose
  // inputs were edited afterwards.
  await bundle.writeDefinition(outcome.goalSource.text, outcome.acceptanceSource.text);

  // ---- the world ---------------------------------------------------------------------------
  // The flag is applied to the plan before anything is built from it, so the adapter, the loop and
  // the environment record all describe one world: the one that ran.
  //
  // A world with no address has no page, so `--browser playwright` cannot mean anything for it. It
  // was accepted anyway, and the record then named a browser the run never launched - `chromium` in
  // `reproducibility.browser` for a run whose only interaction was a SQL query. That is the same
  // defect as the old `--browser none`, one layer out: a flag applied to an object built from the
  // plan, describing a world the plan did not have. Refused here so the operator learns it now
  // rather than from a bundle later. `--browser none` and `auto` remain meaningful and still work.
  if (parsed.browser === "playwright" && environment.url === null) {
    write(
      `\nThe "${environment.adapter}" world has no address, so there is no page for a browser to ` +
        "observe.\nDrop --browser playwright: nothing in this contract is a browser observation.\n",
    );
    return EXIT_CODES.unusable;
  }

  const runtimeEnvironment = applyBrowserChoice(environment, parsed.browser);
  const wantsBrowser = runtimeEnvironment.browser.enabled;
  const browser = wantsBrowser ? playwrightBrowser({ headless: !parsed.headed }) : null;

  const adapter = registration.build({
    environment: runtimeEnvironment,
    io: session.io,
    logger,
    processes: nodeProcessRunner,
    stateDir: parsed.stateDir,
    browser,
  });
  const world = new EnvironmentManager({ adapter, clock: systemClock, logger });

  const run = createRunHandle({
    clock: systemClock,
    runId,
    goalId: goal.id,
    maxIterations: goal.limits.maxIterations,
  });

  const repair = selectRepairGate({
    command: parsed.repair,
    noRepair: parsed.noRepair,
    user: session.user,
    runner: nodeProcessRunner,
    cwd: session.io.cwd,
    logger,
  });

  // ---- what made this run reproducible -----------------------------------------------------
  const git = await observeGit(nodeProcessRunner, session.io.cwd);
  const reproducibility = await captureReproducibility({
    clock: systemClock,
    veridianVersion: await readVersion(session.io, "package.json"),
    gitCommit: git.commit,
    gitDirty: git.dirty,
    playwright: browser === null ? null : await firstVersion(session.io, [
      "node_modules/playwright/package.json",
      "node_modules/playwright-core/package.json",
    ]),
    // The adapter launches Chromium and nothing else, so the engine is observed rather than guessed.
    browser: browser === null ? null : "chromium",
    networkPolicy: goal.limits.networkPolicy,
  });

  logger.info("running", {
    run: runId,
    criteria: String(plan.criteria.length),
    repair: repair.reason,
    browser: wantsBrowser ? (parsed.headed ? "chromium (headed)" : "chromium") : "none",
    selfPrompt: session.selfPromptLabel,
    memory: session.memoryLabel,
  });

  // A declared boundary is not an enforced one, and here the operator is who chose the world that
  // cannot hold it: `--browser none` removes the only component able to refuse a request, so a goal
  // that says `deny` is measured in a world where `deny` is a word in a file. Said out loud because
  // the alternative is a fact found only by whoever reads `environment.json` afterwards, which is not
  // the person who made the choice.
  //
  // Deliberately narrow. Only the network half is disclosed here, and only for the case the CLI
  // observed: it built this world, so it knows whether a guard exists in it. The adapter's standing
  // capabilities - `filesystemWrite` among them - are the adapter's claim about itself, and the full
  // policy-by-enforcement pairing is written to the bundle by the layer that owns both halves.
  // Repeating a capability here would be a second opinion that goes stale the moment an adapter grows
  // one, and warning about `filesystemWrite` on every run would make the signal deafening on the
  // default goal.
  //
  // The condition is "a browser was *removed*", not "there is no browser". It used to be the second,
  // and the difference is a sentence that names a cause the CLI did not observe: `network !== "allow"`
  // with no browser is also the ordinary state of every world that never had one - a database file, a
  // cluster, a simulated provider account - and there `npm run demo:db --browser none` printed *"the
  // run was planned without a browser, so nothing can refuse a request on its behalf"* about a world
  // whose document has no `url` for a browser to open, where the operator planned no such thing and
  // the reason given describes a component that could never have existed. A component can only be
  // removed from a world that was going to have it, so the document's own `browser.enabled` is what
  // decides - and a world whose adapter refuses crossings itself, without a browser, is then left to
  // report its own enforcement through `boundaries()`, which is where that fact lives.
  if (environment.browser.enabled && !wantsBrowser && runtimeEnvironment.boundary.network !== "allow") {
    logger.warn("boundary", {
      declared: `networkPolicy: ${runtimeEnvironment.boundary.network}`,
      enforcement: "unsupported",
      reason: "the run was planned without a browser, so nothing can refuse a request on its behalf",
    });
  }

  // ---- the loop ----------------------------------------------------------------------------
  // Everything above is preparation. From here on the run is governed by `core/execution/loop.ts`,
  // which owns the state machine, the bounded exits and the verdict. The detector context is rebuilt
  // through the same constructor `resolveDefinition` used, against the environment path — because the
  // runtime questions are about *that* application, and `appDir` is what lets the detectors see it.
  const result = await runValidationLoop({
    io: session.io,
    schemas: session.schemas,
    clock: systemClock,
    logger,
    world,
    registry: session.registry,
    plan,
    environment: runtimeEnvironment,
    limits: goal.limits,
    clarifier: session.clarifier,
    detectorContext: detectorContextFor(
      {
        registry: session.registry,
        registeredAdapters: registeredAdapters(),
        adapterDescriptors: adapterDescriptors(),
      },
      outcome.environmentPath,
      dirOf(outcome.environmentPath),
    ),
    repairGate: repair.gate,
    bundle,
    run,
    reproducibility,
    definitionReports: [
      outcome.reports.goal,
      outcome.reports.acceptance,
      outcome.reports.environment,
    ],
    memory: session.memory,
  });

  printResult(result);
  return exitCodeForVerdict(result.verdict);
}

// ---------------------------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------------------------

const STARTER_CONFIG = `# Veridian state directory.
#
# Everything Veridian writes lives under here: run bundles, environment records, snapshots. The
# layout is documented in AGENTS.md; this file only says where to look and who to talk to.

version: 1

# Where run bundles are written, relative to this file.
stateDir: .

# Durable memory. Optional: a run works without it, but then nothing survives the process that
# produced it. HTTP failures are reported once and never block a run.
memory:
  url: ${DEFAULT_MEMORY_URL}
  actor: ${MEMORY_ACTOR}

# Defaults for the browser the web sandbox drives. A goal's environment document may override these;
# none of them can be overridden at run time, because a run that changed its world between
# iterations would not be reproducible.
browser:
  headless: true
`;

/**
 * Create the state directory and a starter configuration.
 *
 * An existing configuration is left alone unless `--force`, because this command's only destructive
 * act is overwriting the file that says where every other file goes.
 */
async function runInit(parsed: CliArguments, logger: Logger): Promise<number> {
  const io = nodeIo();
  const configPath = io.resolve(parsed.stateDir, "config.yaml");

  if ((await io.exists(configPath)) && !parsed.force) {
    write(`${configPath} already exists; nothing was changed. Pass --force to overwrite.\n`);
    return EXIT_CODES.unusable;
  }

  const directories = ["environments", "goals", "runs", "snapshots"];
  for (const name of directories) {
    await io.mkdirp(io.resolve(parsed.stateDir, name));
  }
  await io.writeTextFile(configPath, STARTER_CONFIG);
  logger.info("state directory ready", { path: configPath });

  write(`Created ${parsed.stateDir}/ with ${directories.join(", ")} and config.yaml.\n\n`);
  write("Next: write a goal document, then run it.\n");
  write("  veridian clarify  --goal goal.yaml     (see which gaps exist before running)\n");
  write("  veridian validate --goal goal.yaml     (start it, observe it, judge it)\n");
  return EXIT_CODES.pass;
}

/**
 * Report the MVP's success metrics over the runs already on disk.
 *
 * Nothing is started, nothing is observed: the input is the bundle history, because M1..M5 are
 * measurements *over* runs. See `core/metrics/metrics.ts` for why they are not acceptance criteria.
 *
 * The exit code follows the product's own rule rather than the command's convenience. An empty
 * history is `2`, because there is nothing to measure and "nothing to measure" is not success; `0`
 * means the history was measured and no metric was violated; `1` means at least one was. `M2` is
 * deliberately not part of that decision on its own: without `--defects` it is unmeasurable, and an
 * unmeasurable metric must not be allowed to fail or pass a command - it is reported as
 * INCONCLUSIVE, which is the same distinction the rest of Veridian refuses to collapse.
 */
async function runMetrics(parsed: CliArguments, logger: Logger): Promise<number> {
  const io = nodeIo();
  const { history, metrics } = await measureRunHistory(io, parsed.stateDir, {
    expectedDefects: parsed.defects,
  });

  for (const line of formatMetrics(metrics)) write(`${line}\n`);
  logger.debug("metrics measured", { runs: metrics.runs, unreadable: metrics.unreadable.length });

  if (history.snapshots.length === 0) {
    write(`\nmetrics: INCONCLUSIVE - no run bundle to measure under ${parsed.stateDir}/runs.\n`);
    write("Run a goal first: veridian validate --goal goal.yaml\n");
    return EXIT_CODES.inconclusive;
  }

  // M1 with a single run reports `consistent: false` on purpose - nothing was compared - so it is
  // counted as a violation only when there were two runs that actually disagreed.
  const violated =
    (metrics.runs > 1 && !metrics.consistency.consistent) ||
    metrics.falsePasses.length > 0 ||
    !metrics.reset.reproducible ||
    metrics.evidence.violations.length > 0;

  if (violated) {
    write("\nmetrics: at least one metric was violated. See the lines above.\n");
    return EXIT_CODES.fail;
  }
  write("\nmetrics: the history is clean. Nothing was violated.\n");
  return EXIT_CODES.pass;
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

interface NamedReport {
  readonly name: string;
  readonly report: ClarificationReport;
}

function namedReports(outcome: DefinitionOutcome): readonly NamedReport[] {
  return [
    { name: "goal", report: outcome.reports.goal },
    { name: "acceptance", report: outcome.reports.acceptance },
    { name: "environment", report: outcome.reports.environment },
  ];
}

/**
 * Print the transcript, gap by gap.
 *
 * The rung is printed for every entry including the ones that needed no decision, because the number
 * that matters to a reader is not "were there questions" but "was this value derived, defaulted, or
 * answered by a person". A derivation and a human answer look identical in the resulting run.
 */
function printReports(reports: readonly NamedReport[]): void {
  for (const { name, report } of reports) {
    const { records } = report;
    if (records.length === 0) {
      write(`  ${name}: no gaps found\n`);
      continue;
    }

    const parts = [
      `${String(report.byVia.derived)} derived`,
      `${String(report.byVia.inferred)} inferred`,
      `${String(report.byVia.defaulted)} defaulted`,
      `${String(report.byVia.self_prompted)} self-prompted`,
      `${String(report.byVia.answered)} answered`,
      `${String(report.byVia.deferred)} deferred`,
    ];
    write(
      `  ${name}: ${String(records.length)} gap(s) - ${parts.join(", ")}` +
        `${report.budgetExhausted ? ", question budget exhausted" : ""}` +
        `${report.selfPromptRounds > 0 ? `, ${String(report.selfPromptRounds)} self-prompt round(s)` : ""}\n`,
    );

    for (const record of records) {
      const { ambiguity: gap, resolution } = record;
      const flag = gap.blocking ? "blocking" : "recorded";
      write(`    [${resolution.via}/${flag}] ${gap.origin} ${gap.path}\n`);
      write(`      ${gap.question}\n`);
      write(`      ${describeResolution(resolution)}\n`);
    }
  }
}

function describeResolution(resolution: ClarificationReport["records"][number]["resolution"]): string {
  switch (resolution.via) {
    case "derived":
      return `= ${short(resolution.value)}   (derived from ${resolution.evidence})`;
    case "inferred":
      return (
        `= ${short(resolution.value)}   (inferred at confidence ` +
        `${resolution.confidence.toFixed(2)} from ${resolution.source})`
      );
    case "defaulted":
      return `= ${short(resolution.value)}   (default: ${resolution.assumption})`;
    case "self_prompted":
      return (
        `= ${short(resolution.value)}   (self-prompted at confidence ` +
        `${resolution.confidence.toFixed(2)} over ${String(resolution.rounds)} round(s): ` +
        `${resolution.grounds})`
      );
    case "answered":
      return `= ${short(resolution.value)}   (answered "${resolution.answer}")`;
    case "deferred":
      return `! unresolved: ${resolution.reason}`;
  }
}

function printIncomplete(outcome: DefinitionOutcome & { kind: "incomplete" }): void {
  write(`\nThis definition cannot be run: ${outcome.reason}\n`);
  for (const gap of outcome.unresolved) {
    write(`  ${gap.path}: ${gap.question}\n`);
  }
  if (outcome.unresolved.length === 0) {
    write(
      "  The gaps above were recorded as deferred rather than resolved, so no verdict can be " +
        "earned from them.\n",
    );
  }
  write("\nAdd the missing values, or run `veridian clarify` for the full transcript.\n");
}

function printResult(result: LoopResult): void {
  write(`\n${result.verdict}  (${result.state}, ${String(result.iterations.length)} iteration(s))\n`);
  write(`  run        ${result.resultPath}\n`);
  write(`  environment ${result.environmentValid ? "valid" : "INVALID - no criterion is a measurement"}\n`);

  for (const criterion of result.criteria) {
    const mandatory = criterion.mandatory ? "" : " (optional)";
    write(`  ${criterion.status.padEnd(12)} ${criterion.criterionId}${mandatory}\n`);
    if (criterion.message !== null && criterion.message.length > 0) {
      write(`               ${criterion.message}\n`);
    }
    if (criterion.missingEvidence.length > 0) {
      write(`               missing evidence: ${criterion.missingEvidence.join(", ")}\n`);
    }
  }

  for (const reason of result.reasons) {
    write(`  reason     ${reason}\n`);
  }

  if (result.verdict !== "PASS") {
    write(`  report     ${result.failureReportPath}\n`);
  }

  if (mentionsPlaywrightMissing(result)) {
    // The one failure an operator can fix in a single command, so it is stated as that command rather
    // than left to be found among the reasons above.
    write(`\n${PLAYWRIGHT_MISSING}\n`);
  }
}

function mentionsPlaywrightMissing(result: LoopResult): boolean {
  const haystack = [result.failure?.message ?? "", ...result.reasons].join("\n");
  return haystack.includes(PLAYWRIGHT_MISSING);
}

// ---------------------------------------------------------------------------------------------
// Observations about the local machine
// ---------------------------------------------------------------------------------------------

/**
 * Ask git what it can see. Every answer may be absent.
 *
 * The reproducibility record's whole purpose is to distinguish "this did not run at that commit" from
 * "nobody knows what this ran on". A repository that is not initialised, a `git` that is not
 * installed, and a detached head are three different facts and all three end up as `null` here — a
 * value the record already reads as *unobserved*. Guessing a commit would destroy the distinction the
 * field exists for.
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
    const handle = runner.run({ command: "git", args, cwd });
    const result = await handle.exited;
    if (result.code !== 0) return null;
    const text = result.stdout.trim();
    return text.length === 0 ? null : text;
  } catch {
    return null;
  }
}

/** The `version` field of a JSON file, or `"unknown"` when it cannot be read. */
async function readVersion(io: IoPort, path: string): Promise<string> {
  const version = await firstVersion(io, [path]);
  return version ?? "unknown";
}

/** The first readable `version` field among `paths`, or `null`. */
async function firstVersion(io: IoPort, paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    const text = await io.readTextFile(path).catch(() => null);
    if (text === null) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version.length > 0) return version;
    } catch {
      // Not JSON, or not a manifest. Keep looking rather than reporting a version that was never read.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------

function write(line: string): void {
  process.stdout.write(line);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A pointer value, short enough to print on one line. */
function short(value: unknown): string {
  const text = typeof value === "string" ? `"${value}"` : safeJson(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------------------------
// Bin
// ---------------------------------------------------------------------------------------------

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`veridian: ${message(error)}\n`);
    if (error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = EXIT_CODES.unusable;
  });
