/**
 * The command line's boundary objects.
 *
 * Every export here is an *implementation of a port Core already declares*, and nothing here decides
 * anything about a run. That separation is the reason this file can be dull: the interesting decisions
 * live in `core/`, where they are testable without a terminal, and this file only answers the
 * questions a terminal uniquely knows the answer to — is anyone watching, and is there a human at the
 * other end of stdin.
 *
 * The one rule that shapes all of it: **a port that cannot do its job says so instead of waiting.**
 * `available: false` travels up through the clarification ladder as `no_user_available` and through
 * the manual repair gate as `stop`, so a headless run finishes with the verdict it has. There is no
 * code path in this file that can block forever on a prompt.
 */

import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";

import type { Clock, Logger, SelfPromptPort, UserPromptPort } from "../core/clarification/index.ts";
import type { RepairGate } from "../core/execution/index.ts";
import { CommandRepairGate, ManualRepairGate, NoRepairGate } from "../core/execution/index.ts";
import type { ProcessRunner } from "../core/process.ts";

// ---------------------------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------------------------

/**
 * The real clock.
 *
 * A named constant rather than an inline object at the call site, because a run's reproducibility
 * record and its iteration bounds must be measured by the *same* clock. Two `Date.now` readers in two
 * places is how a `maxRuntimeMs` bound and an `elapsedMs` report end up disagreeing.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

// ---------------------------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30 };

export interface ConsoleLoggerOptions {
  readonly level?: LogLevel;
  /** Destination for log lines. Stderr by default, so `--json`-style stdout stays parseable. */
  readonly sink?: (line: string) => void;
}

/**
 * A logger that writes to stderr.
 *
 * Everything goes to stderr and nothing to stdout, deliberately: the run's *result* is a file
 * (`.veridian/runs/<id>/result.json`) and the CLI's stdout is the summary a caller reads, so mixing
 * progress chatter into it would make the one machine-readable stream on the command line
 * machine-unreadable.
 */
export function consoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const sink =
    options.sink ??
    ((line: string): void => {
      processStderr(line);
    });

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const label = level === "warn" ? "warning" : level;
    sink(`veridian ${label}: ${message}${describe(fields)}`);
  };

  return {
    debug: (message, fields) => {
      emit("debug", message, fields);
    },
    info: (message, fields) => {
      emit("info", message, fields);
    },
    warn: (message, fields) => {
      emit("warn", message, fields);
    },
  };
}

function processStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Scalar fields inline; anything structured as compact JSON. Never throws on a cyclic value. */
function describe(fields?: Record<string, unknown>): string {
  if (fields === undefined) return "";
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  const parts = entries.map(([key, value]) => `${key}=${render(value)}`);
  return ` (${parts.join(" ")})`;
}

function render(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserialisable]";
  }
}

// ---------------------------------------------------------------------------------------------
// UserPromptPort
// ---------------------------------------------------------------------------------------------

export interface CliPromptPortOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  /**
   * Overridable so a test can assert the headless path without a terminal. Defaults to the real
   * stdin's `isTTY`, which is the only honest source: an operator who pipes a file into the CLI has
   * no way to answer a question, and pretending otherwise is how a CI job hangs at 3am.
   */
  readonly isTty?: boolean;
  /**
   * How long a single question waits for an answer. Default 120_000.
   *
   * This bound is not a nicety. Readline's `question` on a stream that has ended *never settles* —
   * measured, not assumed: it neither resolves nor rejects, and the interface it left open keeps the
   * process alive. So a port that relied on the stream to end the round would hang the CLI, which is
   * the one failure mode this product may not have. An `AbortSignal` is what actually settles it, and
   * this is how long it gets first. A human who leaves the keyboard is a human who left.
   */
  readonly answerTimeoutMs?: number;
}

const DEFAULT_ANSWER_TIMEOUT_MS = 120_000;

/**
 * The terminal, as a `UserPromptPort`.
 *
 * `available` is `false` whenever stdin is not an interactive terminal, and that single boolean is the
 * anti-hang guarantee for the entire product: the clarification ladder never asks, and the manual
 * repair gate refuses rather than waiting. It is not a heuristic about whether a human *might* answer
 * — it is the only reliable statement Node can make about whether one *can*. Readline reports
 * `isTTY === undefined` on a pipe and on a redirected file, both of which reach EOF instead of an
 * answer.
 *
 * The timeout above covers the case the flag cannot: a terminal that *is* interactive and nobody is
 * sitting at it.
 */
export function createCliPromptPort(options: CliPromptPortOptions = {}): UserPromptPort {
  const input = options.input ?? processStdin;
  const output = options.output ?? processStdout;
  const available = options.isTty ?? isTty(input);
  const answerTimeoutMs = options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;

  return {
    available,
    async ask(questions) {
      const answers = new Map<string, string>();
      if (questions.length === 0) return answers;

      const rl = createInterface({ input, output, terminal: available });
      try {
        let index = 0;
        for (const question of questions) {
          index += 1;
          output.write(`\n${String(index)}/${String(questions.length)}  ${question.question}\n`);
          if (question.candidates !== undefined && question.candidates.length > 0) {
            output.write(`    choices: ${question.candidates.map((c) => String(c)).join(" | ")}\n`);
          }
          if (question.defaultValue !== undefined) {
            output.write(`    default: ${String(question.defaultValue)}\n`);
          }

          let raw: string;
          try {
            raw = await rl.question("    > ", { signal: AbortSignal.timeout(answerTimeoutMs) });
          } catch {
            // Ends the round rather than moving on. A stream that failed to answer this question will
            // not answer the next one, and continuing would multiply one timeout by however many
            // questions remain — which is how a bounded wait turns back into an unbounded one.
            break;
          }

          // An empty answer is *not* recorded. The ladder treats a missing entry as unanswered and
          // falls back on the ambiguity's own default, which is a conservative value its author
          // argued for. Writing `""` in would look like an answer that happened to be blank.
          const answer = raw.trim();
          if (answer.length > 0) answers.set(question.id, answer);
        }
      } finally {
        rl.close();
      }

      return answers;
    },
  };
}

function isTty(input: NodeJS.ReadableStream): boolean {
  return (input as { isTTY?: boolean }).isTTY === true;
}

// ---------------------------------------------------------------------------------------------
// SelfPromptPort
// ---------------------------------------------------------------------------------------------

export interface SelfPromptPortOptions {
  /**
   * The names the process already holds when a gap reaches this rung: the registered validators, the
   * registered adapters, the schema ids. This is the *material* the run reads to answer itself, and
   * it is why the port is a port rather than a fixed rule — what is in hand is the caller's business,
   * and the caller is the only one that knows.
   */
  readonly material: readonly string[];
  readonly logger?: Logger;
}

/**
 * The run, answering its own gap from material already in hand.
 *
 * The ladder's rungs before this one read the *document* (`derive` re-reads the file the gap was
 * found in) and the *memory substrate* (`infer` asks what earlier runs were taught). This rung reads
 * neither: it reads what this process is already holding, and answers only when exactly one of the
 * gap's own candidates is corroborated by it. That is the whole rule, and its narrowness is the
 * safety argument — it can eliminate candidates, but it cannot invent one, so it can never resolve a
 * gap to a value the contract did not already offer.
 *
 * The two attempts are two widths of one reading, not two guesses. Attempt 1 accepts a candidate
 * that is *present* in the material (`db.count` is a registered name). Attempt 2 accepts a candidate
 * that is *named by* it (a spelled-out sentence that quotes the candidate). Widening once is what
 * makes `rounds` a measurement rather than decoration, and it is also where the widening stops: the
 * engine's `maxSelfPromptRoundsPerAmbiguity` is what bounds it, and this port reports `null` past
 * that rather than coming up with a third width.
 *
 * `available` is `false` when there is no material, because a rule that reads nothing can answer
 * nothing — and an `available: true` port that always declines would make the run's `selfPromptRounds`
 * look like work that happened.
 */
export function createSelfPromptPort(options: SelfPromptPortOptions): SelfPromptPort {
  return {
    available: options.material.length > 0,
    prompt(ambiguity, attempt) {
      const candidates = (ambiguity.candidates ?? []).filter(
        (candidate) => String(candidate).length > 0,
      );
      // Declining silently here would be an observation nobody can read. This rung spends a round
      // whether it answers or not, and a gap with nothing to choose between is a *different* refusal
      // from a gap with two corroborated candidates - both return `null`, and only the log tells an
      // operator which one happened. Every runtime gap the loop raises is this branch: the runtime
      // detectors ask for a reason in prose, and this rung may not invent prose.
      if (candidates.length === 0) {
        options.logger?.debug("self-prompt declined", {
          path: ambiguity.path,
          attempt,
          reason: "no-candidate-offered",
        });
        return Promise.resolve(null);
      }

      const inHand = [...options.material, ...flattenValues(ambiguity.context)];
      const confirms = (candidate: unknown): string | null => {
        const spelled = String(candidate);
        for (const entry of inHand) {
          if (entry === spelled) return entry;
          if (attempt > 1 && entry.includes(spelled)) return entry;
        }
        return null;
      };

      const confirmed = candidates
        .map((candidate) => ({ candidate, by: confirms(candidate) }))
        .filter((row): row is { candidate: unknown; by: string } => row.by !== null);

      // Exactly one. Two corroborated candidates is the ambiguity this rung exists to *refuse*, and
      // picking between them would be the run grading its own homework to the pass it preferred.
      const winner = confirmed[0];
      if (confirmed.length !== 1 || winner === undefined) {
        options.logger?.debug("self-prompt declined", {
          path: ambiguity.path,
          attempt,
          confirmed: confirmed.length,
        });
        return Promise.resolve(null);
      }

      return Promise.resolve({
        value: winner.candidate,
        confidence: attempt > 1 ? 0.85 : 0.95,
        grounds:
          `"${String(winner.candidate)}" is already in hand ` +
          `(${attempt > 1 ? "named by" : "found in"} "${winner.by}")`,
      });
    },
  };
}

/**
 * Every string a JSON-ish value carries, so "in hand" means the same thing for a list of names and
 * for a nested document. Keys are included because a candidate is as likely to be a key as a value.
 */
function flattenValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...flattenValues(entry)]);
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// RepairGate
// ---------------------------------------------------------------------------------------------

export interface RepairGateRequest {
  /** The command and its arguments, when `--repair <command> [args...]` was given. */
  readonly command: readonly string[] | null;
  readonly noRepair: boolean;
  readonly user: UserPromptPort;
  readonly runner: ProcessRunner;
  readonly cwd: string;
  readonly logger: Logger;
}

export interface RepairGateSelection {
  readonly gate: RepairGate;
  /** Why this gate, printed with the run so a reader knows whether iteration was even possible. */
  readonly reason: string;
}

/**
 * Choose how — or whether — a failing iteration may be repaired.
 *
 * Three states, and the ordering is the design. `--no-repair` is honoured first because it is an
 * explicit instruction. `--repair` next, because a command is a repair path that works with nobody
 * watching. Otherwise the manual gate — which does *not* need a TTY check here, because it already
 * refuses when its prompt port is unavailable and reports the same `"stop"` a `NoRepairGate` would.
 * Skipping the check is the point: one place owns the anti-hang rule, so there is one place to get it
 * wrong.
 */
export function selectRepairGate(request: RepairGateRequest): RepairGateSelection {
  if (request.noRepair) {
    return { gate: new NoRepairGate(), reason: "--no-repair: the run observes the application once" };
  }

  const [command, ...args] = request.command ?? [];
  if (command !== undefined) {
    return {
      gate: new CommandRepairGate({
        runner: request.runner,
        command,
        args,
        cwd: request.cwd,
        logger: request.logger,
      }),
      reason: `--repair ${[command, ...args].join(" ")}`,
    };
  }

  return {
    gate: new ManualRepairGate({ user: request.user, logger: request.logger }),
    reason: request.user.available
      ? "manual: a human repairs the application between iterations"
      : "manual gate with no terminal attached: the run stops after one iteration",
  };
}

// ---------------------------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------------------------

/**
 * Exit codes, as a total function of what happened.
 *
 * `INCONCLUSIVE` deliberately gets its own code. Collapsing it into the failure code would let a
 * caller treat "we could not decide" as "the code is broken", and collapsing it into `0` would be the
 * false PASS the whole product exists to prevent. A caller that only cares whether the code works can
 * test `code === 0`; one that wants to know *why not* can distinguish the other two.
 */
export const EXIT_CODES = {
  pass: 0,
  fail: 1,
  inconclusive: 2,
  unusable: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** A verdict the loop can produce, as an exit code. */
export function exitCodeForVerdict(verdict: string): ExitCode {
  if (verdict === "PASS") return EXIT_CODES.pass;
  if (verdict === "FAIL") return EXIT_CODES.fail;
  return EXIT_CODES.inconclusive;
}
