import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable, Writable } from "node:stream";

import type { Ambiguity } from "../core/clarification/index.ts";
import { nodeProcessRunner } from "../core/process.ts";
import {
  EXIT_CODES,
  consoleLogger,
  createCliPromptPort,
  exitCodeForVerdict,
  selectRepairGate,
  systemClock,
} from "../cli/support.ts";
import type { Clock, UserPromptPort } from "../core/clarification/index.ts";
import { silentLogger } from "./helpers/clock.ts";

/**
 * The CLI's boundary objects, proven without a terminal.
 *
 * These tests exist for one property more than any other: **nothing here can wait forever.** The
 * product is a validation environment, and a validator that hangs has produced no verdict at all —
 * worse than a FAIL, because a caller cannot distinguish it from a slow run. So the assertions below
 * are about the *refusals*: a pipe reports itself unavailable, a question that is never answered
 * settles, and the manual repair gate stops instead of prompting when there is no one to prompt.
 *
 * The rest is bookkeeping that would otherwise be checked by hand: the log level actually filters, the
 * log line survives a field it cannot serialise, and the exit code distinguishes "failed" from "could
 * not decide".
 */

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

class Collector extends Writable {
  readonly chunks: string[] = [];

  override _write(chunk: unknown, _encoding: string, callback: () => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  get text(): string {
    return this.chunks.join("");
  }
}

function question(id: string, extra: Partial<Ambiguity> = {}): Ambiguity {
  return {
    id,
    origin: "goal",
    path: `/${id}`,
    kind: "missing_value",
    question: `Which value for ${id}?`,
    blocking: true,
    ...extra,
  };
}

function unavailablePrompt(): UserPromptPort {
  return { available: false, ask: () => Promise.reject(new Error("not reached")) };
}

/**
 * Run a prompt round that is *expected to settle on its own*, and fail loudly if it does not.
 *
 * The guard timer is deliberately **not** unref'd. Readline on an ended stream leaves nothing pending
 * and `AbortSignal.timeout` does not hold the event loop open, so without a referenced timer the loop
 * would drain before the port's own bound fired and the test runner would report a hung test rather
 * than the behaviour under test. Holding the loop open is what makes the assertion about the port's
 * bound instead of about the harness's.
 */
async function withinBound(
  ms: number,
  work: Promise<ReadonlyMap<string, string>>,
): Promise<ReadonlyMap<string, string>> {
  let guard: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    guard = setTimeout(() => {
      reject(new Error(`the prompt round did not settle within ${String(ms)}ms`));
    }, ms);
  });

  try {
    return await Promise.race([work, stalled]);
  } finally {
    clearTimeout(guard);
  }
}

// ---------------------------------------------------------------------------------------------
// The prompt port
// ---------------------------------------------------------------------------------------------
//
// A note on how these rounds are constructed. Readline answers a question from the *next line that
// arrives after the question was asked*, and a line that arrives between two questions is discarded
// rather than queued. A stream that emits every line in one flush therefore answers the first question
// and drops the rest, which is a property of readline and not of this port: an operator typing at a
// terminal supplies each line while its question is on screen. Every fixture below supplies exactly
// the lines that correspond to answers actually given, which is also what makes the "stream ended"
// cases test the port's bound rather than a buffer.

describe("createCliPromptPort: availability", () => {
  it("reports itself unavailable when the flag says so", () => {
    // The load-bearing assertion of the whole file. Every anti-hang guarantee downstream reads this
    // one boolean: the clarification ladder will not ask, and the manual repair gate will not wait.
    assert.equal(createCliPromptPort({ isTty: false }).available, false);
  });

  it("reports a non-TTY stream unavailable", () => {
    // A pipe and a redirected file both reach EOF instead of an answer. Claiming availability there is
    // how a CI job hangs at 3am.
    assert.equal(createCliPromptPort({ input: Readable.from([""]) }).available, false);
    assert.equal(createCliPromptPort({ input: Readable.from([]) }).available, false);
  });

  it("reports a TTY stream available", () => {
    const input = Readable.from([]) as Readable & { isTTY?: boolean };
    input.isTTY = true;

    assert.equal(createCliPromptPort({ input }).available, true);
  });

  it("honours an explicit override regardless of the stream", () => {
    const input = Readable.from([]);

    assert.equal(createCliPromptPort({ input, isTty: true }).available, true);
    assert.equal(createCliPromptPort({ input, isTty: false }).available, false);
  });
});

describe("createCliPromptPort: asking", () => {
  it("asks nothing when there is nothing to ask, and touches no stream", async () => {
    let questioned = false;
    const input = new Readable({
      read(): void {
        questioned = true;
      },
    });

    const answers = await createCliPromptPort({ input, output: new Collector() }).ask([]);

    assert.equal(answers.size, 0);
    assert.equal(questioned, false);
  });

  it("returns the answer it received, keyed by ambiguity id", async () => {
    const port = createCliPromptPort({
      input: Readable.from(["ada\n"]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 2_000,
    });

    const answers = await withinBound(2_500, port.ask([question("which-name")]));

    assert.equal(answers.get("which-name"), "ada");
    assert.equal(answers.size, 1);
  });

  it("trims the answer but does not otherwise reinterpret it", async () => {
    // An answer is text the ladder patches into the artifact by JSON pointer. Parsing it here would put
    // a second, undocumented spelling of every value into the system.
    const port = createCliPromptPort({
      input: Readable.from(["  0.08  \n"]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 2_000,
    });

    const answers = await withinBound(2_500, port.ask([question("tax-rate")]));

    assert.equal(answers.get("tax-rate"), "0.08");
  });

  it("prints the candidates and the default so an operator can answer without the goal file", async () => {
    const output = new Collector();
    const port = createCliPromptPort({
      input: Readable.from(["\n"]),
      output,
      isTty: false,
      answerTimeoutMs: 2_000,
    });

    await withinBound(2_500, port.ask([question("tax-rate", { candidates: ["0", "0.08"], defaultValue: "0" })]));

    assert.match(output.text, /1\/1 {2}Which value for tax-rate\?/);
    assert.match(output.text, /choices: 0 \| 0\.08/);
    assert.match(output.text, /default: 0/);
  });

  it("records a blank answer as unanswered rather than as an empty value", async () => {
    // The distinction is real: the ladder treats a missing entry as unanswered and applies the
    // ambiguity's own fail-safe default. An entry of `""` would look like a human having chosen blank.
    const port = createCliPromptPort({
      input: Readable.from(["\n"]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 2_000,
    });

    const answers = await withinBound(2_500, port.ask([question("a")]));

    assert.equal(answers.size, 0);
  });

  it("records a whitespace-only answer as unanswered too", async () => {
    const port = createCliPromptPort({
      input: Readable.from(["   \n"]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 2_000,
    });

    const answers = await withinBound(2_500, port.ask([question("a")]));

    assert.equal(answers.size, 0);
  });

  it("settles when the stream ends instead of waiting forever", async () => {
    // The measured hazard: readline's `question` on a stream that has already ended *neither resolves
    // nor rejects*, and the interface it is holding open keeps the process alive. A port that trusted
    // the stream to end the round would hang the CLI, which is the one failure mode this product may
    // not have. The port's own bound is what settles it.
    const started = Date.now();
    const port = createCliPromptPort({
      input: Readable.from([]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 50,
    });

    const answers = await withinBound(4_000, port.ask([question("never")]));

    assert.equal(answers.size, 0);
    assert.ok(Date.now() - started < 4_000, "the port's own bound never fired");
  });

  it("ends the round at the first unanswered question instead of paying its timeout again", async () => {
    // Three unanswered questions with a 50ms bound must cost about 50ms, not 150ms. One timeout
    // multiplied by the number of remaining questions is how a bounded wait becomes an unbounded one.
    const started = Date.now();
    const port = createCliPromptPort({
      input: Readable.from([]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 50,
    });

    const answers = await withinBound(4_000, port.ask([question("one"), question("two"), question("three")]));

    assert.equal(answers.size, 0);
    assert.ok(
      Date.now() - started < 200,
      "the round appears to have waited once per question rather than once in total",
    );
  });

  it("keeps the answers that arrived before the round gave up", async () => {
    const port = createCliPromptPort({
      input: Readable.from(["first\n"]),
      output: new Collector(),
      isTty: false,
      answerTimeoutMs: 50,
    });

    const answers = await withinBound(4_000, port.ask([question("one"), question("two")]));

    assert.equal(answers.get("one"), "first");
    assert.equal(answers.size, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// The logger
// ---------------------------------------------------------------------------------------------

describe("consoleLogger", () => {
  it("filters below the level it was given", () => {
    const lines: string[] = [];
    const logger = consoleLogger({ level: "warn", sink: (line) => lines.push(line) });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");

    assert.deepEqual(lines, ["veridian warning: w"]);
  });

  it("emits info and above by default", () => {
    const lines: string[] = [];
    const logger = consoleLogger({ sink: (line) => lines.push(line) });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");

    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /^veridian info: i$/);
    assert.match(lines[1] ?? "", /^veridian warning: w$/);
  });

  it("renders scalar fields inline and drops undefined ones", () => {
    const lines: string[] = [];
    const logger = consoleLogger({ sink: (line) => lines.push(line) });

    logger.info("resolving", { goal: "goal.yaml", memory: undefined, iteration: 2, headed: false });

    assert.equal(lines[0], "veridian info: resolving (goal=goal.yaml iteration=2 headed=false)");
  });

  it("survives a field it cannot serialise", () => {
    // A logger that throws while reporting a failure replaces the failure with itself.
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const lines: string[] = [];
    const logger = consoleLogger({ sink: (line) => lines.push(line) });

    logger.warn("bad", { cyclic });

    assert.equal(lines[0], "veridian warning: bad (cyclic=[unserialisable])");
  });

  it("writes nothing extra when there are no fields", () => {
    const lines: string[] = [];
    const logger = consoleLogger({ sink: (line) => lines.push(line) });

    logger.info("plain");

    assert.equal(lines[0], "veridian info: plain");
  });
});

// ---------------------------------------------------------------------------------------------
// The repair gate selection
// ---------------------------------------------------------------------------------------------

describe("selectRepairGate", () => {
  const base = {
    runner: nodeProcessRunner,
    cwd: process.cwd(),
    logger: silentLogger,
  };

  it("prefers --no-repair over everything, and says so", () => {
    const selection = selectRepairGate({
      ...base,
      command: null,
      noRepair: true,
      user: unavailablePrompt(),
    });

    assert.equal(selection.gate.kind, "none");
    assert.match(selection.reason, /--no-repair/);
  });

  it("uses a command gate when a repair command was given", () => {
    const selection = selectRepairGate({
      ...base,
      command: ["node", "repair.mjs"],
      noRepair: false,
      user: unavailablePrompt(),
    });

    assert.equal(selection.gate.kind, "command");
    assert.match(selection.reason, /--repair node repair\.mjs/);
  });

  it("falls back to the manual gate, which needs no terminal check to be safe", () => {
    // The gate itself refuses when its prompt port is unavailable. This function does not duplicate
    // that check: one place owns the anti-hang rule, so there is one place to get it wrong.
    const withoutTerminal = selectRepairGate({
      ...base,
      command: null,
      noRepair: false,
      user: unavailablePrompt(),
    });
    assert.equal(withoutTerminal.gate.kind, "manual");
    assert.match(withoutTerminal.reason, /no terminal attached/);

    const port = createCliPromptPort({ isTty: true });
    const withTerminal = selectRepairGate({ ...base, command: null, noRepair: false, user: port });
    assert.equal(withTerminal.gate.kind, "manual");
    assert.match(withTerminal.reason, /a human repairs/);
  });

  it("ignores an empty command list instead of constructing a command gate", () => {
    // `--repair` with no argument is a usage error, so an empty array here can only come from a caller
    // that built one by hand. The manual gate is the safe reading of "no command".
    const selection = selectRepairGate({
      ...base,
      command: [],
      noRepair: false,
      user: unavailablePrompt(),
    });

    assert.equal(selection.gate.kind, "manual");
  });

  it("stops rather than waiting when the manual gate is asked to repair with no terminal", async () => {
    const selection = selectRepairGate({
      ...base,
      command: null,
      noRepair: false,
      user: unavailablePrompt(),
    });

    const outcome = await selection.gate.repair({
      runId: "run-1",
      iteration: 1,
      maxIterations: 10,
      verdict: "FAIL",
      failure: null,
      failed: [],
      resultPath: "result.json",
      failureReportPath: "failure.md",
      reasons: ["a criterion failed"],
    });

    assert.equal(outcome.decision, "stop");
    assert.match(outcome.note, /No interactive session/);
  });
});

// ---------------------------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------------------------

describe("exit codes", () => {
  it("gives PASS the only success code", () => {
    assert.equal(exitCodeForVerdict("PASS"), 0);
  });

  it("separates FAIL from INCONCLUSIVE", () => {
    // Collapsing these would let a caller read "we could not decide" as "the code is broken"; folding
    // either into 0 would be the false PASS the product exists to prevent.
    assert.equal(exitCodeForVerdict("FAIL"), 1);
    assert.equal(exitCodeForVerdict("INCONCLUSIVE"), 2);
    assert.notEqual(exitCodeForVerdict("FAIL"), exitCodeForVerdict("INCONCLUSIVE"));
  });

  it("never reports success for a verdict it does not recognise", () => {
    for (const verdict of ["ERROR", "ABORTED", "MAX_ITERATIONS", "", "pass"]) {
      assert.equal(exitCodeForVerdict(verdict), 2, `verdict ${verdict}`);
    }
  });

  it("assigns every code a distinct number", () => {
    const codes = Object.values(EXIT_CODES);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("keeps usage errors and definition failures away from the failure code", () => {
    assert.notEqual(EXIT_CODES.unusable, EXIT_CODES.fail);
    assert.notEqual(EXIT_CODES.unusable, EXIT_CODES.pass);
  });
});

// ---------------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------------

describe("systemClock", () => {
  it("answers both readings from the same instant", () => {
    const clock: Clock = systemClock;
    const iso = Date.parse(clock.iso());

    assert.ok(Number.isFinite(iso), "iso() did not return a parseable instant");
    assert.ok(Math.abs(clock.now() - iso) < 1_000);
    assert.ok(Math.abs(clock.now() - Date.now()) < 1_000);
  });
});
