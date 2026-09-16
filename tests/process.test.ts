// `nodeProcessRunner`'s stop contract, measured against a real child process.
//
// This file exists because nothing covered it. Every other suite in `tests/` injects a *fake*
// `ProcessRunner` through the adapter seam - which is the right way to test a world, and which meant
// that the one function every real world calls to end a child was held by nothing at all. The defect
// it now holds was intermittent, platform-specific and reported as an application that never became
// ready: `stop()`'s Windows branch awaited `taskkill` and then returned, without waiting for the child
// to actually close, while the POSIX branch awaited `exited`. So on Windows `stop()` could resolve
// while the old child was still closing, and a caller that stopped and immediately re-spawned could
// publish the dead child's result into the new child's slot.
//
// The assertions below never sleep. A wait on a clock measures the machine's schedule; the question
// here is whether a promise had *already* settled when a call returned, and that is answerable
// exactly - see `settledAlready`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeProcessRunner } from "../core/process.ts";

/** A child that announces itself, then stays up until it is killed. */
const LINGER = "process.stdout.write('READY\\n'); setInterval(() => undefined, 1_000);";

function lingering(): ReturnType<typeof nodeProcessRunner.run> {
  return nodeProcessRunner.run({
    command: process.execPath,
    args: ["-e", LINGER],
    cwd: process.cwd(),
  });
}

/**
 * Fail loudly instead of hanging.
 *
 * A `stop()` that never resolves is the shape this file is about, so leaving the suite to wait for it
 * would turn a regression into a stuck job whose cause is invisible. `unref` keeps the bound itself
 * from holding the process open.
 */
async function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not settle within ${String(ms)}ms`));
    }, ms);
    timer.unref?.();
  });

  try {
    return await Promise.race([work, bound]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Whether a promise had already settled when this was called, read without a clock.
 *
 * Attaching a latching reaction to a promise that is *already* settled queues that reaction as a
 * microtask immediately - and a single `await` queues this function's own continuation *behind* it,
 * so the latch has run by the next line. For a pending promise nothing is queued and the latch is
 * still `false`. The order is fixed by the microtask queue, so this measures nothing about speed.
 *
 * The obvious first draft - `Promise.race([promise.then(mark), Promise.resolve("pending")])` - is
 * **always** false, because the sentinel resolves the race in one hop while a fulfilled `promise`
 * needs two. It was written, run, and found to fail both assertions that expected `true`, which is
 * why `"discriminates between a settled promise and a pending one"` below is a test rather than a
 * claim: a reading that cannot say `true` is not a reading.
 */
async function settledAlready(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  return settled;
}

describe("the settledness reading this file rests on", () => {
  it("discriminates between a settled promise and a pending one", async () => {
    assert.equal(await settledAlready(Promise.resolve("done")), true, "a settled promise read as pending");
    assert.equal(
      await settledAlready(new Promise(() => undefined)),
      false,
      "a pending promise read as settled",
    );
  });
});

describe("nodeProcessRunner's stop contract", () => {
  it("resolves only once the process is really gone, not once it has been told to go", async () => {
    const handle = lingering();
    assert.equal(await handle.waitForPattern("READY", 15_000), true, "the child never announced itself");

    await within(15_000, handle.stop(), "stop()");

    // The assertion the fix is: by the time `stop()` has returned, `exited` has already settled.
    // Before the fix this was `false` on Windows - `taskkill`'s own exit says the tree was *told* to
    // die, and the old code treated that as the tree being dead.
    assert.equal(
      await settledAlready(handle.exited),
      true,
      "stop() returned while the child was still closing, so a caller cannot tell a stopped world from a running one",
    );
  });

  it("leaves the child's real result behind, rather than a hang or a deadline", async () => {
    const handle = lingering();
    assert.equal(await handle.waitForPattern("READY", 15_000), true, "the child never announced itself");

    await within(15_000, handle.stop(), "stop()");
    const result = await within(15_000, handle.exited, "exited");

    // Killed rather than exited cleanly, so exactly one of these carries the fact - and which one it
    // is depends on the platform's kill semantics, which is why both are admitted and neither is
    // asserted. What is asserted is that a stop is never reported as a timeout: `timedOut` is
    // `runToCompletion`'s word, and a run that was stopped did not exceed a deadline.
    assert.ok(result.code !== 0 || result.signal !== null, "a stopped child reported as a clean exit");
    assert.equal(result.timedOut, false, "a stop was reported as a deadline");
  });

  it("keeps a child's own result when that child had already exited", async () => {
    const handle = nodeProcessRunner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('DONE\\n');"],
      cwd: process.cwd(),
    });
    const natural = await within(15_000, handle.exited, "exited");
    assert.equal(natural.code, 0, "the child did not exit cleanly on its own");

    await within(15_000, handle.stop(), "stop()");

    // Stopping something that has already stopped must not rewrite how it ended. This is the same
    // rule as "a reset restores the world; it does not restore the record", one layer down: the
    // reading belongs to the child, and a caller tidying up afterwards is not a new fact about it.
    const after = await within(15_000, handle.exited, "exited after stop");
    assert.equal(after.code, 0, "stop() rewrote a natural exit as a kill");
    assert.equal(after.stdout, natural.stdout, "stop() changed what the child was recorded as saying");
  });

  it("is safe to call twice, and does not stall a second caller behind the first", async () => {
    const handle = lingering();
    assert.equal(await handle.waitForPattern("READY", 15_000), true, "the child never announced itself");

    // Two callers racing to end one world is the ordinary shape of a teardown that has a deadline and
    // an abandonment path: `runToCompletion` stops at its deadline while the caller may also stop.
    await within(15_000, Promise.all([handle.stop(), handle.stop()]), "both stop() calls");

    assert.equal(await settledAlready(handle.exited), true, "a second stop() left the child's state unread");
  });
});
