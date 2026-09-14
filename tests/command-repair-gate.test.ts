import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProcessRequest, ProcessResult, ProcessRunner } from "../core/process.ts";
import { CommandRepairGate, NoRepairGate, ScriptedRepairGate } from "../core/execution/repair.ts";
import type { RepairRequest } from "../core/execution/types.ts";

/**
 * The command repair gate: the one place an external actor is handed control of a failing run.
 *
 * It gets its own suite because it is a *gate*, not a utility. Its answer is what makes iteration two
 * reachable, and `RepairOutcome` is the only evidence a reader has of what the actor did in between -
 * so both halves of that answer (the decision and the transcript) are asserted here rather than being
 * exercised incidentally by one demo.
 */

const request = (iteration = 1): RepairRequest => ({
  runId: "run-1",
  iteration,
  maxIterations: 10,
  verdict: "FAIL",
  failure: null,
  failed: [],
  resultPath: ".veridian/runs/run-1/result.json",
  failureReportPath: ".veridian/runs/run-1/failure.md",
  reasons: ["AC-001 failed"],
});

interface Recorded {
  readonly requests: ProcessRequest[];
}

/** A command that exits immediately with the result the test hands it. */
function exiting(result: Omit<ProcessResult, "signal">): { runner: ProcessRunner; seen: Recorded } {
  const seen: Recorded = { requests: [] };
  const runner: ProcessRunner = {
    run: (incoming) => {
      seen.requests.push(incoming);
      return {
        pid: 4242,
        exited: Promise.resolve({ ...result, signal: null }),
        output: () => result.stdout,
        error: () => result.stderr,
        waitForPattern: async () => false,
        stop: async () => {},
      };
    },
  };
  return { runner, seen };
}

/**
 * A command that never finishes until it is stopped, which is how a repair script that hangs looks.
 *
 * The holder object is deliberate: a `let` captured by the promise executor is narrowed to `never` by
 * the compiler after the assignment it can see, and the call that matters happens in a callback the
 * compiler cannot order.
 */
function hanging(partial: { readonly stdout: string; readonly stderr: string }): ProcessRunner {
  const state: { finish: (() => void) | null } = { finish: null };
  return {
    run: () => {
      const exited = new Promise<ProcessResult>((resolve) => {
        state.finish = () =>
          resolve({ code: null, signal: "SIGTERM", stdout: partial.stdout, stderr: partial.stderr, timedOut: false });
      });
      return {
        pid: 4243,
        exited,
        output: () => partial.stdout,
        error: () => partial.stderr,
        waitForPattern: async () => false,
        stop: async () => {
          state.finish?.();
        },
      };
    },
  };
}

/** The header lines, up to the first stream marker. Every one of them is written by Veridian. */
function header(transcript: string): string {
  return transcript.split("--- stdout ---")[0] ?? "";
}

/**
 * Run a body while the event loop is kept alive.
 *
 * `runToCompletion` unrefs its deadline timer on purpose: a run always has a world in flight, so a
 * deadline able to hold the process open by itself would be one that outlives the run it bounds. In a
 * test there is nothing else in flight, so the loop drains before the deadline fires and the failure
 * reads as `Promise resolution is still pending but the event loop has already resolved` - a message
 * about the harness, not the gate. This holds the loop open the way a real run does.
 *
 * It is not a wait: nothing is asserted about *when* anything happens, and the deadline under test is
 * still the gate's own. The keep-alive is cleared either way, so it cannot mask a hang.
 */
async function withLiveLoop<T>(body: () => Promise<T>): Promise<T> {
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    return await body();
  } finally {
    clearTimeout(keepAlive);
  }
}

const gateWith = (runner: ProcessRunner, args: readonly string[] = ["repair.ts"]): CommandRepairGate =>
  new CommandRepairGate({ runner, command: "node", args, cwd: "examples/sim-posix" });

describe("the command repair gate reads the exit code as the whole protocol", () => {
  it("treats exit 0 as a repair, without inspecting what the command did", async () => {
    // The gate deliberately does not read the diff: a repair is believed only after the criteria are
    // re-observed from a clean world. Anything else would let a command *assert* its own success.
    const { runner } = exiting({ code: 0, stdout: "patched provision.mjs\n", stderr: "", timedOut: false });
    const outcome = await gateWith(runner).repair(request());

    assert.equal(outcome.decision, "repaired");
    assert.match(outcome.note, /exited 0/);
  });

  it("stops on a non-zero exit and quotes the command's own reason", async () => {
    const { runner } = exiting({ code: 3, stdout: "", stderr: "cannot find provision.mjs\n", timedOut: false });
    const outcome = await gateWith(runner).repair(request());

    assert.equal(outcome.decision, "stop");
    assert.match(outcome.note, /exited 3/);
    assert.match(outcome.note, /cannot find provision\.mjs/);
  });

  it("stops on a timeout and names the budget it enforced", async () => {
    const gate = new CommandRepairGate({
      runner: hanging({ stdout: "half a thought", stderr: "" }),
      command: "node",
      args: ["repair.ts"],
      cwd: ".",
      timeoutMs: 10,
    });

    const outcome = await withLiveLoop(() => gate.repair(request()));

    assert.equal(outcome.decision, "stop");
    assert.match(outcome.note, /did not finish within 10ms/);
  });

  it("hands the actor the paths to the report it is being asked to act on", async () => {
    // These three variables *are* the interface: a repair command learns why it was invoked without
    // Veridian having to explain itself through an argument list.
    const { runner, seen } = exiting({ code: 0, stdout: "", stderr: "", timedOut: false });
    await gateWith(runner).repair(request(4));

    const env = seen.requests[0]?.env ?? {};
    assert.equal(env["VERIDIAN_RESULT"], ".veridian/runs/run-1/result.json");
    assert.equal(env["VERIDIAN_FAILURE_REPORT"], ".veridian/runs/run-1/failure.md");
    assert.equal(env["VERIDIAN_ITERATION"], "4");
  });
});

describe("the transcript is the actor's evidence, and it survives every answer", () => {
  it("quotes the command line, the exit code and both streams", async () => {
    const { runner } = exiting({
      code: 0,
      stdout: "read goal.yaml\n",
      stderr: "warn: no lockfile\n",
      timedOut: false,
    });

    const transcript = (await gateWith(runner).repair(request())).transcript ?? "";

    assert.match(transcript, /repair command: node repair\.ts/);
    assert.match(transcript, /working directory: examples\/sim-posix/);
    assert.match(transcript, /exit code: 0/);
    assert.match(transcript, /timed out: no/);
    assert.match(transcript, /read goal\.yaml/);
    assert.match(transcript, /warn: no lockfile/);
  });

  it("keeps the two streams apart, because they are not written in the order they arrive", async () => {
    // A transcript that interleaved them would assert an ordering nobody observed. stdout is reported
    // in full before stderr, and the marker between them is what makes that claim readable.
    const { runner } = exiting({ code: 1, stdout: "STEP one\n", stderr: "ERROR bad\n", timedOut: false });
    const transcript = (await gateWith(runner).repair(request())).transcript ?? "";

    const stdoutAt = transcript.indexOf("STEP one");
    const markerAt = transcript.indexOf("--- stderr ---");
    const stderrAt = transcript.indexOf("ERROR bad");

    assert.ok(stdoutAt >= 0 && markerAt > stdoutAt && stderrAt > markerAt, transcript);
  });

  it("keeps the whole of stderr even though the note only quotes its tail", async () => {
    // The note is one line and is bounded; the transcript is the record. This is the difference that
    // made the field exist: a reader diagnosing a failed repair needs what the note truncated.
    const long = `${"x".repeat(4000)}\nthe actual reason\n`;
    const { runner } = exiting({ code: 2, stdout: "", stderr: long, timedOut: false });
    const outcome = await gateWith(runner).repair(request());

    assert.ok(outcome.note.length < 4000, "the note stays a note");
    assert.match(outcome.transcript ?? "", /the actual reason/);
  });

  it("keeps the partial output of a command that had to be stopped", async () => {
    // The timeout is exactly the case where the transcript is the only explanation available, so it
    // is built before the branches rather than on the happy path only.
    const gate = new CommandRepairGate({
      runner: hanging({ stdout: "trying to write /etc/veridian/policy.cfg", stderr: "" }),
      command: "node",
      args: ["repair.ts"],
      cwd: ".",
      timeoutMs: 10,
    });

    const transcript = (await withLiveLoop(() => gate.repair(request()))).transcript ?? "";

    assert.match(transcript, /timed out: yes/);
    assert.match(transcript, /trying to write \/etc\/veridian\/policy\.cfg/);
  });

  it("writes ASCII in every line it adds, because a transcript is displayed", async () => {
    // The command's own output is quoted as it arrived - that is the point of a transcript. The rule
    // is about the text Veridian writes, since a non-UTF-8 code page renders a typographic character
    // as noise, which is the one thing the transcript exists to avoid.
    const { runner } = exiting({ code: 0, stdout: "ok\n", stderr: "", timedOut: false });
    const head = header((await gateWith(runner).repair(request())).transcript ?? "");

    assert.ok(head.length > 0, "the header is present");
    assert.ok(!/[^\x00-\x7F]/.test(head), head);
  });

  it("normalises CRLF so a transcript read on another platform has one line ending", async () => {
    const { runner } = exiting({ code: 0, stdout: "a\r\nb\r\n", stderr: "c\r\n", timedOut: false });
    const transcript = (await gateWith(runner).repair(request())).transcript ?? "";

    assert.ok(!transcript.includes("\r\n"), "no carriage returns survive into the bundle");
    assert.match(transcript, /a\nb\n/);
  });
});

describe("a gate that ran nothing reports nothing", () => {
  it("omits the transcript rather than writing an empty one", async () => {
    // An empty artifact is a claim: `artifacts/repair-1.log` at zero bytes says "the actor was silent",
    // which is a different fact from "there was no actor". The loop writes a file only when this field
    // is present, so its absence is what keeps the bundle honest.
    const noRepair = await new NoRepairGate().repair(request());
    assert.equal(noRepair.transcript, undefined);

    const scripted = await new ScriptedRepairGate([{ decision: "repaired", note: "the agent changed it" }]).repair(
      request(),
    );
    assert.equal(scripted.transcript, undefined);
  });
});
