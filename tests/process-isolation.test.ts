/**
 * The runner's second boundary mechanism, measured through the one place a child is started.
 *
 * ## Why this suite exists separately from `isolation.test.ts`
 *
 * That suite holds the port's arithmetic - what a mount plan is, what a path translates to - and it
 * can run anywhere because none of it starts anything. This one holds the **wiring**: that
 * `core/process.ts` prefers a substrate over the interpreter when a substrate applied, falls back to
 * the interpreter when it did not, hands the container a rewritten environment, and starts the runtime
 * in a way that survives the arguments it is given.
 *
 * The last of those is the reason this file is not optional. `wantsShell` hands a **bare** command name
 * to `cmd.exe` on Windows, and `cmd.exe` joins a vector into one string without quoting it - so a
 * runtime named `podman` would receive `--volume=C:\a path\...` as two arguments and an `-e` payload
 * containing parentheses as a syntax error. Nothing in the tree observed that, because the probe
 * measures the runtime through `spawnSync` and never through the runner: the hazard was **unexecuted**
 * rather than absent, and an unexecuted check is a defect that has not been observed yet.
 *
 * ## The half that skips, and why the skip is stated rather than silent
 *
 * The substrate is a property of the machine. Where there is none, the checks that need one are
 * skipped **with the capability's own reason in the skip message**, so a green run on a machine with no
 * runtime is visibly a run that measured less - which is the difference between a boundary proved and
 * a boundary believed.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { isolationCapability } from "../core/environment/isolation.ts";
import { nodeProcessRunner, runToCompletion } from "../core/process.ts";

const capability = isolationCapability();

/** A sandbox whose name contains a space, which is the input the shell would have split. */
let sandbox = "";

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "veridian iso runner "));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** One line of a program's output, so an assertion names a value rather than a paragraph. */
const firstLine = (text: string): string => text.split(/\r?\n/)[0] ?? "";

describe("the runner prefers a substrate over the interpreter", () => {
  it(
    "starts the container runtime and reports no confinement when the substrate applied",
    { skip: capability.available ? false : `no substrate on this machine: ${capability.reason}` },
    async () => {
      const result = await runToCompletion(
        nodeProcessRunner,
        {
          command: "node",
          args: ["-e", "process.stdout.write('ran')"],
          cwd: sandbox,
          isolation: { readRoots: [sandbox], writeRoots: [sandbox], denyNetwork: true },
          // An allowance is offered *as well*, so the test measures the precedence rather than the
          // absence of the alternative. A runner that applied both would report both readings, and a
          // child inside a container cannot be confined by an interpreter that is not on its machine.
          confinement: { readRoots: [sandbox], writeRoots: [sandbox] },
        },
        120_000,
      );
      assert.equal(result.code, 0, `the isolated child should have exited 0. stderr: ${result.stderr}`);
      assert.equal(
        result.isolation?.applied,
        true,
        "the substrate reported itself available, so an `isolation` request that did not apply is a " +
          "disagreement between two readings of one machine rather than a machine that cannot",
      );
      assert.equal(
        result.confinement,
        null,
        "the container is the boundary when it holds. Reporting an interpreter allowance beside it " +
          "would name a mechanism that did not run, in the field a reader consults to find out which " +
          "one did - and there is no host child left for `--permission` to have confined",
      );
    },
  );

  it(
    "hands the container a vector the shell would have destroyed",
    { skip: capability.available ? false : `no substrate on this machine: ${capability.reason}` },
    async () => {
      // Three hazards in one vector, each of which `cmd.exe` breaks and each of which is ordinary:
      // a host path containing a space (the sandbox), a payload containing parentheses (every `-e`),
      // and a payload containing a `&` (which `cmd.exe` reads as a command separator).
      const payload = "process.stdout.write(['a(b)', 'c&d'].join('|'))";
      const result = await runToCompletion(
        nodeProcessRunner,
        {
          command: "node",
          args: ["-e", payload],
          cwd: sandbox,
          isolation: { readRoots: [sandbox], writeRoots: [sandbox], denyNetwork: true },
        },
        120_000,
      );
      assert.equal(result.code, 0, `a mangled vector fails here. stderr: ${result.stderr}`);
      assert.equal(
        firstLine(result.stdout),
        "a(b)|c&d",
        "the payload has to arrive byte for byte. It is the runtime's own name that decides whether " +
          "there is a shell in the way, which is why the port resolves the runtime to an executable " +
          "rather than passing a bare name to `wantsShell`",
      );
    },
  );

  it(
    "rewrites the environment so a path-valued variable names the mount",
    { skip: capability.available ? false : `no substrate on this machine: ${capability.reason}` },
    async () => {
      const result = await runToCompletion(
        nodeProcessRunner,
        {
          command: "node",
          args: ["-e", "process.stdout.write(process.env.VERIDIAN_PROBE ?? '')"],
          cwd: sandbox,
          // The variable is *inside* the mount and is therefore reachable, which is what makes this a
          // measurement of the rewrite rather than of the container's reach.
          env: { VERIDIAN_PROBE: sandbox },
          isolation: { readRoots: [sandbox], writeRoots: [sandbox], denyNetwork: true },
        },
        120_000,
      );
      assert.equal(result.code, 0, `stderr: ${result.stderr}`);
      assert.equal(
        firstLine(result.stdout).startsWith("/veridian/"),
        true,
        "a host path handed to a container names a directory the container does not have, expected a " +
          "container path under the mounted root instead",
      );
      assert.notEqual(
        firstLine(result.stdout),
        sandbox,
        "the value must not have been passed through unchanged: the container has no `" + sandbox + "`",
      );
    },
  );

  it(
    "keeps the interpreter allowance when the substrate cannot hold the request",
    async () => {
      // Deliberately the request no substrate can honour - the working directory is outside every
      // allowance - so this assertion holds on a machine with no runtime as well as one with it, and
      // measures the fallback rather than the substrate. `elsewhere` is created rather than borrowed
      // so the refusal is about the request on any platform: a borrowed root would be `/` somewhere.
      const elsewhere = mkdtempSync(join(tmpdir(), "veridian-outside-"));
      try {
        const result = await runToCompletion(
          nodeProcessRunner,
          {
            command: "node",
            args: ["-e", "process.stdout.write('fallback')"],
            cwd: sandbox,
            isolation: { readRoots: [elsewhere], writeRoots: [] },
            confinement: { readRoots: [sandbox], writeRoots: [sandbox] },
          },
          120_000,
        );
        assert.equal(result.code, 0, `stderr: ${result.stderr}`);
        assert.equal(
          result.isolation?.applied,
          false,
          "a request the substrate refused has to say so rather than report nothing, because " +
            "`applied: false` beside a stated reason is a reading and `undefined` is a silence",
        );
        assert.ok(
          (result.isolation?.reason.length ?? 0) > 0,
          "a refused substrate states its reason, so the world can report `unsupported` with a cause " +
            "rather than with a shrug",
        );
        assert.equal(
          firstLine(result.stdout),
          "fallback",
          "the child still runs, because a boundary this machine cannot hold is not a reason to refuse " +
            "to run the program the contract asked about",
        );
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    },
  );

  it(
    "writes through a containerised child back to the host, so a mounted sandbox is a two-way claim",
    { skip: capability.available ? false : `no substrate on this machine: ${capability.reason}` },
    async () => {
      const written = join(sandbox, "from-the-container.txt");
      const result = await runToCompletion(
        nodeProcessRunner,
        {
          command: "node",
          args: [
            "-e",
            `require('node:fs').writeFileSync(process.env.VERIDIAN_TARGET, 'written')`,
          ],
          cwd: sandbox,
          env: { VERIDIAN_TARGET: written },
          isolation: { readRoots: [sandbox], writeRoots: [sandbox], denyNetwork: true },
        },
        120_000,
      );
      assert.equal(result.code, 0, `stderr: ${result.stderr}`);
      assert.equal(
        readFileSync(written, "utf8"),
        "written",
        "the world judges files on *this* machine, so a substrate that held the write somewhere the " +
          "host cannot see it would turn every criterion about an output file into a failure for a " +
          "reason the application was not responsible for",
      );
    },
  );
});
