/**
 * The isolation port's pure half: the mount plan, and the host-to-container path translation.
 *
 * ## Why only the pure half is here
 *
 * The capability probe starts a real container, and a suite that started one per test would be a suite
 * nobody runs - so the probe is measured by `scripts/probe-isolation.ts`, which prints its reading, and
 * the *decision* the probe feeds is measured here. That split is deliberate and it is the same one
 * `confinement.ts` makes: `confinementCapability()` is memoised and probed once, and the vector it
 * produces is what a test can assert without starting anything.
 *
 * The half that is here is the half with the arithmetic in it. Every assertion below is about a
 * **mapping**, and a mapping is exactly the kind of code where a plausible implementation is wrong in a
 * direction that looks right - which is what {@link containerPathOf}'s whole-segment rule exists for.
 */

import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { describe, it } from "node:test";

import {
  CONTAINER_ROOT,
  containerEnv,
  containerPathOf,
  isolateProcess,
  isolationCapability,
  planMounts,
  type IsolationMount,
} from "../core/environment/isolation.ts";

/** A mount plan as the port builds one, named explicitly so a test reads rather than recomputes. */
function mountsOf(readRoots: readonly string[], writeRoots: readonly string[]): readonly IsolationMount[] {
  return planMounts({ command: "", args: [], cwd: ".", readRoots, writeRoots });
}

describe("the isolation port's mount plan", () => {
  it("gives every allowance a container path under one root, numbered in the caller's order", () => {
    const mounts = mountsOf(["/host/a", "/host/b"], ["/host/c"]);
    assert.deepEqual(
      mounts.map((mount) => mount.containerPath),
      [`${CONTAINER_ROOT}/ro0`, `${CONTAINER_ROOT}/ro1`, `${CONTAINER_ROOT}/rw0`],
      "a container path is a function of the request rather than of the host's layout, so the numbering " +
        "has to follow the caller's order - an index derived from the host path would move when the " +
        "host's paths moved, and every vector built from it would move with them",
    );
    assert.deepEqual(
      mounts.map((mount) => mount.mode),
      ["ro", "ro", "rw"],
      "the mode is the caller's declaration and it is carried on the mount rather than recomputed at " +
        "the point the vector is assembled, because those two places could disagree",
    );
  });

  it("keeps a path that is both read and written writable, and drops the read-only twin", () => {
    const mounts = mountsOf(["/host/a"], ["/host/a"]);
    assert.deepEqual(
      mounts.map((mount) => `${mount.mode}:${mount.containerPath}`),
      [`rw:${CONTAINER_ROOT}/rw0`],
      "a runtime handed the same host path as both `ro` and `rw` answers with whichever it processes " +
        "last, so the boundary would be decided by argument order. The writable mount is the weaker " +
        "claim and the caller asked for it explicitly, so it is the one that stays",
    );
  });

  it("mounts a duplicate once rather than twice", () => {
    const mounts = mountsOf(["/host/a", "/host/a"], []);
    assert.equal(
      mounts.length,
      1,
      "two identical read mounts produce a vector whose meaning depends on the runtime's dedup rule, " +
        "which is a property of the runtime rather than of this request",
    );
  });

  it("resolves a relative allowance against the process, so a mount is never spelled relatively", () => {
    const mounts = mountsOf(["."], []);
    assert.ok(
      mounts[0]?.hostPath.startsWith("/") === true || /^[A-Za-z]:[\\/]/u.test(mounts[0]?.hostPath ?? ""),
      `a container runtime resolves no relative path on the host, so an allowance that stayed relative ` +
        `would be mounted from wherever the runtime happened to be - measured: ${String(mounts[0]?.hostPath)}`,
    );
  });
});

describe("the isolation port's path translation", () => {
  const mounts = mountsOf([], ["/host/sandbox"]);

  it("translates a path under a mount, and the mount's own root to the mount point", () => {
    assert.equal(containerPathOf(mounts, "/host/sandbox"), `${CONTAINER_ROOT}/rw0`);
    assert.equal(containerPathOf(mounts, "/host/sandbox/a/b.txt"), `${CONTAINER_ROOT}/rw0/a/b.txt`);
  });

  it("converts the separators the host that composed the request would have used, and only those", () => {
    // The defect this holds was measured on Windows: a probe that substituted a container root into a
    // program by splitting on the host root left the trailing `\` in place, so the child wrote a file
    // whose **name** contained a backslash and the host never saw the write. Everything read `written`
    // while the boundary appeared to have eaten it.
    //
    // **On a POSIX host the same input is a different request**, and this test asserted only the
    // Windows answer until the isolation CI job ran it on `ubuntu-latest` and went red - which is the
    // job's first execution finding its first defect, exactly as the phase predicted. On POSIX, `\` is
    // an ordinary filename character, so `/host/sandbox\a\b.txt` is a file *beside* the mount rather
    // than under it, and the answer is `null`: the path is under no allowance. Both answers are
    // correct, and the rule is one sentence - **the translation converts what the composing host would
    // have used as a separator, because that is what the two sides disagree about**.
    const input = "/host/sandbox\\a\\b.txt";
    const translated = containerPathOf(mounts, input);
    if (process.platform === "win32") {
      assert.equal(
        translated,
        `${CONTAINER_ROOT}/rw0/a/b.txt`,
        "a backslash is a path separator on the host that composed the request and an ordinary " +
          "filename character in the container that runs it, so the translation has to convert it - or " +
          "the two sides disagree about which file was meant while both report success",
      );
      assert.ok(
        !String(translated).includes("\\"),
        "no backslash may survive into a container path",
      );
    } else {
      assert.equal(
        translated,
        null,
        "on this host a backslash is not a separator, so the string names a file beside the mount " +
          "rather than inside it - and reporting a container path for it would tell the child about a " +
          "file the mount does not carry",
      );
    }
  });

  it("refuses to translate a path that is under no mount", () => {
    assert.equal(
      containerPathOf(mounts, "/host/sandbox-other/a.txt"),
      null,
      "a prefix match that does not respect whole segments maps `/host/sandbox-other` into the mount " +
        "for `/host/sandbox` - handing the child a path that reads as inside its allowance and is not. " +
        "`null` is the answer that makes the caller state a reason instead of widening the boundary",
    );
  });

  it("picks the longest matching mount when allowances nest", () => {
    const nested = mountsOf(["/host/wide", "/host/wide/narrow"], []);
    assert.equal(
      containerPathOf(nested, "/host/wide/narrow/a.txt"),
      `${CONTAINER_ROOT}/ro1/a.txt`,
      "with two allowances that both cover a path, the narrower one is the caller's more specific " +
        "statement and the one a reader would expect the child to be held to",
    );
  });
});

describe("the isolation port against this machine", () => {
  it("answers the capability question with a reason, whichever way it answers", () => {
    const capability = isolationCapability();
    assert.equal(typeof capability.available, "boolean");
    assert.ok(
      capability.reason.length > 0,
      "a capability report whose reason is empty leaves a caller unable to say why it did not isolate, " +
        "and `unsupported` with no reason is the shrug this vocabulary exists to remove",
    );
    if (capability.available) {
      assert.equal(capability.reason, "measured");
      assert.ok(
        capability.substrate.length > 0,
        "an available reading has to name the runtime that held the boundary, because the bundle " +
          "records that name and a world held by an unnamed substrate is one no run history explains",
      );
      assert.ok(
        capability.mechanism.length > 0 && capability.image.length > 0,
        "an available reading has to name the image it ran and the flags it proved, or nothing " +
          "downstream can report what held the world",
      );
    }

    /*
     * These two replace one assertion this test carried, which `gate (windows-latest)` falsified on run
     * `35958249177`: it required `substrate` to be `""` whenever `available` was false, with the
     * reasoning that naming a runtime there would be a claim the probe had not earned. That reads
     * `substrate` as *the substrate that held it*, and that field is `IsolationResult.substrate`. This
     * one is the runtime's own name for itself, and every path in `measure()` that got as far as
     * finding one passes it on - which is the point, because a reader has to be able to tell "nothing
     * answered" from "docker answered and the boundary did not hold". The machine here has no runtime,
     * so the old assertion passed here for a reason it was not written for, and reached the branch it
     * tests only on a runner: `ubuntu-latest` has none either and passed, while `windows-latest` has
     * Docker in Windows-container mode - which answers a server version, cannot run a Linux image, and
     * produced `'docker' !== ''`.
     */
    assert.equal(
      capability.substrate === "",
      capability.version === "",
      "a runtime is named together with the version it gave back: a name with no version, or a " +
        "version with no name, would be half a reading of one runtime presented as a whole one",
    );
    assert.equal(
      capability.available,
      capability.mechanism.length > 0,
      "the flags this port applies are named only once a probe watched them hold a boundary, because " +
        "a mechanism list beside `available: false` would be a claim about the machine standing " +
        "beside the answer that it was not measured",
    );
  });

  it("states a reason and applies nothing when the working directory is outside every allowance", () => {
    const result = isolateProcess({
      command: process.execPath,
      args: ["-e", "0"],
      cwd: process.env["SystemRoot"] ?? "/",
      readRoots: [],
      writeRoots: ["."],
    });
    // This assertion is deliberately independent of whether a runtime is installed: the refusal is
    // about the request, and it is reached by the requests that can never be honoured. A probe that
    // could only be run on a machine with a container runtime would be a probe nobody runs.
    assert.equal(result.applied, false);
    assert.equal(result.substrate, null);
    assert.ok(result.reason.length > 0);
    assert.deepEqual(result.mounts, [], "a refusal mounts nothing, so nothing downstream can read a mount " +
      "plan out of a run that never happened");
  });
});

describe("the environment a containerised child is given", () => {
  const mounts = mountsOf(["/host/app"], ["/host/sandbox"]);

  it("rewrites the value that names a mounted directory, so the child can open what it was told about", () => {
    const env = containerEnv(mounts, {
      VERIDIAN_PROCESS_ROOT: "/host/sandbox",
      VERIDIAN_PROCESS_APP: "/host/app",
    });
    assert.deepEqual(
      env,
      { VERIDIAN_PROCESS_ROOT: `${CONTAINER_ROOT}/rw0`, VERIDIAN_PROCESS_APP: `${CONTAINER_ROOT}/ro0` },
      "a host path inside a container names a directory the container does not have, so a world that " +
        "passed this one through would watch its program write into nowhere and report that the " +
        "application produced no output - an environment failure wearing the application's clothes",
    );
  });

  it("leaves a value that is not a path alone, because a flag is not a directory", () => {
    const env = containerEnv(mounts, { NODE_ENV: "production", MODE: "1", CODEC: "utf8" });
    assert.deepEqual(
      env,
      { NODE_ENV: "production", MODE: "1", CODEC: "utf8" },
      "`containerPathOf` resolves a relative value against the current directory, so calling it on " +
        "every value would let a mode be rewritten into a directory name whenever the process " +
        "happened to be started inside a mount",
    );
  });

  it("leaves a path under no mount alone, rather than inventing a container path for it", () => {
    const env = containerEnv(mounts, { HOME: "/somewhere/else" });
    assert.deepEqual(
      env,
      { HOME: "/somewhere/else" },
      "the child cannot reach that directory either way, and rewriting it to a path the container " +
        "does not mount would be a value this port made up",
    );
  });

  it("does not rewrite a path list, because a list is not under a mount", () => {
    const listed = `${mounts[0]?.hostPath ?? ""}${delimiter}${mounts[1]?.hostPath ?? ""}`;
    const env = containerEnv(mounts, { PATH: listed });
    assert.equal(
      env["PATH"],
      listed,
      "both entries name mounted directories and neither is *under* a mount, because the whole-segment " +
        "rule separates on the path separator and not on the list separator - so the one variable whose " +
        "corruption would be total is the one that survives. **This is a boundary of the rule rather " +
        "than a feature**: a value that is exactly a mounted directory is rewritten, and a list of such " +
        "directories is not, and a world that needed its lists translated would have to say so",
    );
  });
});
