import type { Ambiguity, Logger, UserPromptPort } from "../clarification/types.ts";
import { ambiguity } from "../clarification/types.ts";
import { runToCompletion, type ProcessResult, type ProcessRunner } from "../process.ts";
import type { RepairGate, RepairOutcome, RepairRequest } from "./types.ts";

/**
 * The four ways repair can be reachable. Each one answers the same two questions — *may the run take
 * another step* and *did the application actually change* — and they differ only in who answers.
 */

/**
 * No repair. The run makes exactly one pass.
 *
 * This is the gate for CI and for any headless caller, and it is the reason "no infinite agent loop"
 * is not a promise but a property: iteration two is only reachable through a gate that said
 * `repaired`, and this one never does. Note that the loop does not special-case it — the boundedness
 * comes from `stop` being the answer, not from a counter being checked.
 */
export class NoRepairGate implements RepairGate {
  readonly kind = "none";

  async repair(_request: RepairRequest): Promise<RepairOutcome> {
    return {
      decision: "stop",
      note:
        "No repair path is installed, so the run reports what it observed. Veridian does not " +
        "modify the application; re-running unchanged code against an unchanged world would only " +
        "produce the same verdict with more evidence of nothing.",
    };
  }
}

/** One scripted answer per iteration. The gate that makes the ReAct loop provable offline. */
export class ScriptedRepairGate implements RepairGate {
  readonly kind = "scripted";
  readonly requests: RepairRequest[] = [];
  readonly #outcomes: readonly RepairOutcome[];

  constructor(outcomes: readonly RepairOutcome[]) {
    this.#outcomes = outcomes;
  }

  async repair(request: RepairRequest): Promise<RepairOutcome> {
    this.requests.push(request);
    const outcome = this.#outcomes[this.requests.length - 1];
    return (
      outcome ?? {
        decision: "stop",
        // Running out of scripted answers is a *stop*, never a silent continuation. A script that
        // ended early is a test-authoring mistake, and the honest response to it is to end the run
        // rather than to invent an extra iteration.
        note: `the scripted repair gate has no answer for iteration ${request.iteration}; stopping`,
      }
    );
  }
}

export interface CommandRepairGateOptions {
  readonly runner: ProcessRunner;
  readonly command: string;
  readonly args?: readonly string[];
  /** Working directory for the repair command, absolute or relative to the io root. */
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly logger?: Logger;
}

/**
 * A shell command that repairs the application.
 *
 * The exit code is the whole protocol: zero means "I changed something, look again", non-zero means
 * "I did not". The gate deliberately does not inspect what the command did. Veridian cannot verify a
 * repair by reading a diff — a repair is believed only after the criteria are re-observed from a
 * clean world, which is the loop's job, not the gate's.
 *
 * The failure report path is handed over in the environment so a command can read *why* it was
 * invoked without Veridian having to explain itself through an argument list.
 */
export class CommandRepairGate implements RepairGate {
  readonly kind = "command";
  readonly #options: CommandRepairGateOptions;

  constructor(options: CommandRepairGateOptions) {
    this.#options = options;
  }

  async repair(request: RepairRequest): Promise<RepairOutcome> {
    const result = await runToCompletion(
      this.#options.runner,
      {
        command: this.#options.command,
        args: [...(this.#options.args ?? [])],
        cwd: this.#options.cwd,
        env: {
          ...(this.#options.env ?? {}),
          VERIDIAN_RESULT: request.resultPath,
          VERIDIAN_FAILURE_REPORT: request.failureReportPath,
          VERIDIAN_ITERATION: String(request.iteration),
        },
      },
      this.#options.timeoutMs ?? 600_000,
    );

    this.#options.logger?.info("repair command finished", {
      iteration: request.iteration,
      code: result.code,
      timedOut: result.timedOut,
    });

    // Built once, before any branch, so *every* answer carries it - including the timeout, where the
    // partial output is precisely the evidence that explains why the command never finished.
    const transcript = transcriptOf(this.#options, result);

    if (result.timedOut) {
      return {
        decision: "stop",
        note: `the repair command did not finish within ${String(this.#options.timeoutMs ?? 600_000)}ms and was stopped`,
        transcript,
      };
    }
    if (result.code === 0) {
      return {
        decision: "repaired",
        note: `the repair command exited 0, so the run will observe the application again from a clean world`,
        transcript,
      };
    }
    return {
      decision: "stop",
      note: `the repair command exited ${String(result.code)}${tail(result.stderr) === "" ? "" : `: ${tail(result.stderr)}`}`,
      transcript,
    };
  }
}

/**
 * The repair command's own output, headed by the facts a reader needs to interpret it.
 *
 * The transcript is read on its own, out of the bundle, by someone who was not present when it was
 * captured - so it states the command line and the exit code rather than assuming them, and it
 * separates the two streams rather than interleaving them, because a program's progress report and
 * its error report arrive in a different order than they were written.
 *
 * ASCII only: this text is displayed. Rendered as a console on a machine whose code page is not UTF-8,
 * a typographic character arrives as noise, which is the one thing a transcript exists to avoid.
 */
function transcriptOf(options: CommandRepairGateOptions, result: ProcessResult): string {
  const args = options.args ?? [];
  const commandLine = [options.command, ...args].join(" ");
  const lines = [
    `repair command: ${commandLine}`,
    `working directory: ${options.cwd}`,
    `exit code: ${result.code === null ? "none (the command did not start)" : String(result.code)}`,
    result.timedOut ? "timed out: yes (the output below is everything it produced before it was stopped)" : "timed out: no",
    "",
    "--- stdout ---",
    result.stdout.replace(/\r\n/g, "\n"),
    "--- stderr ---",
    result.stderr.replace(/\r\n/g, "\n"),
  ];
  return `${lines.join("\n")}\n`;
}

export interface ManualRepairGateOptions {
  readonly user: UserPromptPort;
  readonly logger?: Logger;
}

/**
 * A human repairs the application, then says so.
 *
 * This reuses the same `UserPromptPort` the clarification protocol uses, and inherits its one
 * important property: `available: false` means the gate refuses rather than blocking. A headless run
 * with a manual gate therefore stops on iteration one — the same behaviour as `NoRepairGate`,
 * reached through a different route. That is the anti-hang guarantee doing double duty, and it is
 * why this gate needs no timeout of its own.
 */
export class ManualRepairGate implements RepairGate {
  readonly kind = "manual";
  readonly #options: ManualRepairGateOptions;

  constructor(options: ManualRepairGateOptions) {
    this.#options = options;
  }

  async repair(request: RepairRequest): Promise<RepairOutcome> {
    if (!this.#options.user.available) {
      return {
        decision: "stop",
        note:
          "No interactive session is attached, so the run cannot wait for a human to repair the " +
          "application. It stops with the verdict it has instead of blocking.",
      };
    }

    // The question is raised through the *same* port the clarification protocol uses, so it lands in
    // the run's question budget and in the transcript an operator already knows how to read. A
    // bespoke prompt here would be a second human boundary, and a second boundary is a second place
    // for a run to hang.
    const question: Ambiguity = ambiguity({
      origin: "iteration",
      path: "/decision",
      kind: "missing_value",
      question:
        `Iteration ${request.iteration} of ${request.maxIterations} failed. Repair the application, ` +
        `then answer "yes" to observe it again - or "no" to stop.`,
      blocking: true,
      candidates: ["yes", "no"],
      context: {
        verdict: request.verdict,
        failureReport: request.failureReportPath,
        reasons: request.reasons,
      },
    });

    let answer = "";
    try {
      const answers = await this.#options.user.ask([question]);
      answer = (answers.get(question.id) ?? "").trim().toLowerCase();
    } catch (error) {
      this.#options.logger?.warn("manual repair prompt failed; stopping", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { decision: "stop", note: "the repair prompt failed, so the run stopped rather than guessing" };
    }

    if (answer === "yes" || answer === "y" || answer === "true") {
      return {
        decision: "repaired",
        note: "a human reported repairing the application; the world will be reset and observed again",
      };
    }
    return { decision: "stop", note: "the repair was not confirmed, so the run stopped with the verdict it has" };
  }
}

/**
 * One line, bounded, for a note that quotes an external actor's output.
 *
 * The note lands in `result.json`, in `latest-failure.md` and in `execution.log`, all of which a
 * reader scans rather than reads - so it summarises the actor's output instead of copying it. Bounding
 * by *lines* alone was not a bound: a command that printed one 4000-character line put all 4000
 * characters into every one of those files. The character cap is the same one `core/memory`'s port
 * applies to a refused write, for the same reason: the error message is a summary, and the record is
 * somewhere else. The last characters are kept because they are where a failure states its cause, and
 * the leading `...` says that something was dropped rather than leaving the reader to guess.
 */
function tail(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  return flat.length <= NOTE_CHARS ? flat : `...${flat.slice(-NOTE_CHARS)}`;
}

/** How much of an actor's output a one-line note may carry. */
const NOTE_CHARS = 300;
