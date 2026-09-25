/**
 * The environment policy, measured against the real runtime rather than a double.
 *
 * This file exists because the claim it makes cannot be tested with a fake. The process port's
 * in-memory double answers questions about *requests* - what a world asked the runner for - and the
 * question here is what the operating system actually handed a real child. A double that returned the
 * request's own `env` would agree with any implementation, including one that never passed it to
 * `spawn`; the defect being guarded against is precisely a gap between the two.
 *
 * So every test below starts a **real** process, and the reading is what that process printed about
 * its own environment.
 *
 * ## The finding this reproduces
 *
 * Before `process.environment`, every world started its application as `{ ...process.env, ...declared }`
 * and nothing recorded the result. Measured through the CLI on this machine: a name planted in the
 * invoking shell reached an application inside a confined world, and that application could see five
 * credential-shaped names with all five populated. A confined child could not write outside its roots,
 * could not read outside its declared surface, and could read every credential the operator's shell
 * held.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { nodeProcessRunner, runToCompletion } from "../core/process.ts";
import type { ProcessConfinement } from "../core/process.ts";
import { PLATFORM_BASELINE } from "../core/environment/env-crawl.ts";

/** A name no environment on earth sets, so its presence can only come from this test. */
const MARKER = "VERIDIAN_CONFINEMENT_TEST_MARKER";
const MARKER_VALUE = "planted-by-the-test";

/**
 * A program that reports its own environment and nothing else.
 *
 * Written to a file rather than handed to `-e`, and that is not tidiness: `core/process.ts` resolves a
 * bare command through `cmd.exe` on Windows, which joins the argument vector into one string, and a
 * `-e` payload with quotes in it arrives mangled. The same defect was measured on this machine while
 * this seam was being built, in a probe that reported "the shell is broken" for every case including
 * the control.
 */
const PROBE = "probe.mjs";

let directory = "";

after(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

async function prepare(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "veridian-env-"));
  await writeFile(
    join(directory, PROBE),
    [
      'const names = Object.keys(process.env).sort();',
      'process.stdout.write("names=" + names.length + "\\n");',
      'process.stdout.write("list=" + names.join(",") + "\\n");',
      'process.stdout.write("marker=" + (process.env["' + MARKER + '"] === "' + MARKER_VALUE + '" ? "seen" : "absent") + "\\n");',
      'process.stdout.write("credential-shaped=" + names.filter((name) => /KEY|TOKEN|SECRET/.test(name)).length + "\\n");',
    ].join("\n"),
    "utf8",
  );
  return directory;
}

/** The allowance every case here carries, so the only variable between cases is the environment mode. */
const allowance = (mode: "inherit" | "declared"): ProcessConfinement => ({
  readRoots: [directory],
  writeRoots: [directory],
  environment: mode,
});

async function observe(mode: "inherit" | "declared") {
  process.env[MARKER] = MARKER_VALUE;
  process.env["VERIDIAN_TEST_SECRET_TOKEN"] = "planted-credential-0123456789abcdef";
  const result = await runToCompletion(
    nodeProcessRunner,
    {
      command: process.execPath,
      args: [PROBE],
      cwd: directory,
      env: { DECLARED_BY_THE_WORLD: "yes" },
      confinement: allowance(mode),
    },
    30_000,
  );
  return result;
}

const lineFor = (text: string, prefix: string): string =>
  text
    .split("\n")
    .find((line) => line.startsWith(prefix)) ?? "";

describe("a world's application inherits the shell unless the document says otherwise", () => {
  it("sees a name planted in the invoking shell, which is the default and the hole", async () => {
    await prepare();
    const result = await observe("inherit");

    assert.equal(result.code, 0, `the probe did not run: ${result.stderr}`);
    assert.equal(
      lineFor(result.stdout, "marker="),
      "marker=seen",
      "under `inherit` the child must see the operator's environment - this is the behaviour the " +
        "default preserves, and asserting it is what makes the `declared` case beside it a difference",
    );
    assert.equal(result.environment?.mode, "inherit");
    assert.ok(
      (result.environment?.inheritedCredentials.length ?? 0) > 0,
      "the crawl must name the planted credential, or the reading would be blind to the hole it exists for",
    );
  });

  it("does not see it when the document declares the environment, and still starts", async () => {
    await prepare();
    const result = await observe("declared");

    assert.equal(result.code, 0, `the probe did not run at all: ${result.stderr}`);
    assert.equal(
      lineFor(result.stdout, "marker="),
      "marker=absent",
      "under `declared` the child must not see the operator's environment",
    );
    assert.equal(
      lineFor(result.stdout, "credential-shaped="),
      "credential-shaped=0",
      "a credential-shaped name reached the child of a world that declared its environment",
    );
    assert.equal(result.environment?.mode, "declared");
    assert.deepEqual(result.environment?.inheritedCredentials, []);
  });

  it("hands the child what the world declared, so `declared` is narrower rather than empty", async () => {
    // The floor matters: measured on Windows, a child started with an empty map still sees eleven names
    // the operating system supplies. So a world choosing `declared` is choosing a smaller environment,
    // and a reading of zero names would mean the mechanism had replaced a real environment with a
    // fictitious one.
    await prepare();
    const result = await observe("declared");

    assert.ok(
      result.environment?.entries.some((entry) => entry.name === "DECLARED_BY_THE_WORLD") === true,
      "the world's own declared name did not reach the child, which is a world that broke its promise",
    );
    assert.ok(
      (result.environment?.entries.length ?? 0) > 0,
      "the child saw an empty environment, which on this platform means the spawn did not happen",
    );
    assert.ok(
      (result.environment?.entries.length ?? 0) < 77,
      `the declared environment is not smaller than this machine's: ${String(result.environment?.entries.length)} entries`,
    );
  });
});

describe("the reading is the child's view, name for name", () => {
  it("reports every name the child actually received, including the platform's own", async () => {
    // This is the assertion the seam turns on, and it was written after the defect it catches was
    // measured rather than before. A crawl of the map a world *hands over* is not a crawl of what the
    // child *sees*: `spawn` with six names gives a Windows child seventeen, so the first version of
    // this reading reported `inherited: 0` for a child that had inherited `USERNAME`, `USERDOMAIN` and
    // `LOGONSERVER` from the operating system - the same shape as `env: plan.env`, one level down, and
    // discovered because the example's two instruments disagreed (`visible 6` against a census of 17)
    // rather than by anyone reading the code.
    await prepare();
    const result = await observe("declared");

    const reported = result.environment?.entries.map((entry) => entry.name) ?? [];
    const seen = (lineFor(result.stdout, "list=").slice("list=".length).split(",") ?? []).filter(
      (name) => name !== "",
    );

    assert.deepEqual(
      [...reported].sort(),
      [...seen].sort(),
      "the crawl and the child disagree about which names are in reach. A reading of the map handed " +
        "over is not a reading of the environment, and the difference is exactly the case a false " +
        "clean hides in.",
    );
    assert.deepEqual(result.environment?.inheritedCredentials, []);
    assert.ok(
      (reported.length ?? 0) > Object.keys({ DECLARED_BY_THE_WORLD: "yes" }).length,
      "the crawl reported only what the world declared, so it did not see the platform's own names",
    );
  });

  it("covers the platform's baseline with a named list, so a change is a failure rather than a shorter reading", async () => {
    // The control for `PLATFORM_BASELINE`, which is a curated measurement and therefore a liability. It
    // is exercised the only way that can falsify it: a real child on an **empty** map, which is what
    // the platform's own contribution looks like in isolation. A platform that began supplying a
    // twelfth name would fail here by name instead of quietly shortening every `declared` reading.
    await prepare();
    const result = await runToCompletion(
      nodeProcessRunner,
      {
        command: process.execPath,
        args: [PROBE],
        cwd: directory,
        env: {},
        confinement: { readRoots: [directory], writeRoots: [directory], environment: "declared" },
      },
      30_000,
    );

    const seen = lineFor(result.stdout, "list=").slice("list=".length).split(",").filter((n) => n !== "");
    const uncovered = seen.filter((name) => !(PLATFORM_BASELINE as readonly string[]).includes(name));
    assert.deepEqual(
      uncovered,
      [],
      "the platform supplied names PLATFORM_BASELINE does not cover, so every `declared` crawl on " +
        "this platform is short by that many names and its `inherited` count is wrong",
    );
  });
});

describe("the reading travels on the result and on the handle", () => {
  it("carries the crawl on the handle, so a long-lived application can be described while running", async () => {
    await prepare();
    const handle = nodeProcessRunner.run({
      command: process.execPath,
      args: [PROBE],
      cwd: directory,
      env: {},
      confinement: allowance("declared"),
    });

    assert.notEqual(handle.environment, undefined, "the handle carries no environment reading");
    assert.equal(handle.environment?.mode, "declared");
    await handle.exited;
  });

  it("reports the crawl even when the child failed to start", async () => {
    // A spawn failure is still a reading about the vector that was going to run - the same rule the
    // confinement reading follows, and the reason both are stamped in one place rather than passed as
    // arguments to three result shapes.
    await prepare();
    const result = await runToCompletion(
      nodeProcessRunner,
      {
        command: join(directory, "does-not-exist.exe"),
        args: [],
        cwd: directory,
        env: { DECLARED_BY_THE_WORLD: "yes" },
        confinement: allowance("declared"),
      },
      30_000,
    );

    assert.equal(result.code, null, "a missing command must read as a failure to start, not as an exit code");
    assert.equal(result.environment?.mode, "declared");
  });

  it("carries no value anywhere on the result", async () => {
    await prepare();
    const result = await observe("inherit");
    const serialised = JSON.stringify(result.environment);

    assert.equal(
      serialised.includes(MARKER_VALUE),
      false,
      "a value reached the crawl attached to a real spawn, which is the one thing this reading must never do",
    );
    assert.equal(
      serialised.includes("planted-credential-0123456789abcdef"),
      false,
      "the planted credential's value reached the crawl",
    );
    assert.ok(
      serialised.includes("VERIDIAN_TEST_SECRET_TOKEN"),
      "the planted credential's NAME should be there - names are the reading and values are not",
    );
  });
});
