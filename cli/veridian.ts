#!/usr/bin/env node
/**
 * Veridian — the command line.
 *
 * This file is the command line, and nothing else. Every decision it appears to make has already been
 * made in `core/`: which rungs the clarification ladder tries, what a PASS requires, when an iteration
 * may continue, when a run stops. What is left here is what only a process can do — read a command
 * line, print prose a terminal shows, and set an exit code — because the composition a run is made of
 * now lives in `./validate.ts` and `./session.ts`. There are two front doors onto the same lifecycle,
 * and a bin whose bottom line calls `main()` can never be imported by the second one.
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

import type { ClarificationReport, Logger } from "../core/clarification/index.ts";
import type { DefinitionOutcome } from "../core/definition.ts";
import type { LoopResult } from "../core/execution/index.ts";
import { nodeIo } from "../core/io.ts";
import { formatMetrics, measureRunHistory } from "../core/metrics/index.ts";
import { PLAYWRIGHT_MISSING } from "../adapters/local-web/index.ts";

import type { CliArguments } from "./arguments.ts";
import { DEFAULT_MEMORY_URL, USAGE, UsageError, parseArguments } from "./arguments.ts";
// `MEMORY_ACTOR` is read here rather than in `./session.ts` because the only thing it appears in is
// the starter `config.yaml` below - a document this command writes, not a session it opens.
import { MEMORY_ACTOR, define, openSession, sessionOptions } from "./session.ts";
import { EXIT_CODES, consoleLogger, exitCodeForVerdict } from "./support.ts";
import { runValidation } from "./validate.ts";

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
  const session = await openSession(sessionOptions(parsed), logger);
  logger.info("resolving the definition", {
    goal: parsed.goalPath,
    memory: session.memoryLabel,
    selfPrompt: session.selfPromptLabel,
    prompt: session.user.available ? "terminal" : "unavailable",
  });

  const outcome = await define(session, parsed.goalPath);
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

/**
 * Run the lifecycle and report it.
 *
 * The composition is `./validate.ts`'s, not this function's. What is left here is the pair of things
 * only a command line can do: turn an outcome into prose a terminal shows, and turn a verdict into
 * an exit code. Both go through `write`, which is precisely why the composition had to move out of
 * this module - a bin whose bottom line calls `main()` cannot be imported by the MCP surface, and a
 * second copy of the wiring would be a second answer to what a run is.
 */
async function runValidate(parsed: CliArguments, logger: Logger): Promise<number> {
  const session = await openSession(sessionOptions(parsed), logger);

  // Reported *before* the definition settles, and the ordering is the point rather than the position
  // of the statement: a caller whose goal document is missing sees the failed definition on stdout
  // and the fact that resolution was attempted on the log stream, so a failure has a context on the
  // terminal rather than appearing from nowhere.
  //
  // This line is asserted by `acceptance/acceptance.yaml` AC-006, which is run by `npm run
  // acceptance` and by a CI job and *not* by `node --test` - so the refactor that moved the
  // composition into `./validate.ts` kept the sibling line in `runClarify`, dropped this one, and
  // left the whole suite green. The contract found it on its first execution on a runner. A log line
  // an operator watches is a behaviour, and it needs an assertion somewhere that runs.
  logger.info("resolving the definition", {
    goal: parsed.goalPath,
    memory: session.memoryLabel,
    selfPrompt: session.selfPromptLabel,
    prompt: session.user.available ? "terminal" : "unavailable",
  });

  const outcome = await runValidation({
    session,
    logger,
    goalPath: parsed.goalPath,
    stateDir: parsed.stateDir,
    browser: parsed.browser,
    headed: parsed.headed,
    repair: parsed.repair,
    noRepair: parsed.noRepair,
    // Printed the moment the definition settles, which is before a world is built or a bundle is
    // opened. A report printed after the run would be a transcript of a decision the reader has
    // already watched being acted on.
    onDefinition: (settled) => {
      printReports(namedReports(settled));
    },
    // One notice, two renderings. The command line shows it as a line; the MCP surface shows it as a
    // field. Whether there is one at all is `validate.ts`'s decision, and it is a decision about the
    // plan - the only thing any of the three layers knows.
    onNotice: (notice) => {
      logger.warn(notice.topic, notice.fields);
    },
  });

  if (outcome.kind === "incomplete") {
    printIncomplete(outcome.definition);
    return EXIT_CODES.inconclusive;
  }

  if (outcome.kind === "unusable") {
    write(`\n${outcome.refusal.title}\n${outcome.refusal.body}\n`);
    return EXIT_CODES.unusable;
  }

  printResult(outcome.result);
  return exitCodeForVerdict(outcome.result.verdict);
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

  // M1 reports `measured: false` when it had nothing to compare - one run, or a history spanning two
  // subjects - and it says `consistent: false` in both cases *because* nothing was compared. Only an
  // answered `no` is a violation. Reading this as `runs > 1 && !consistent`, which is what it was,
  // worked for the single run by accident and accused a mixed history of a disagreement it had
  // refused to look for.
  const violated =
    (metrics.consistency.measured && !metrics.consistency.consistent) ||
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
