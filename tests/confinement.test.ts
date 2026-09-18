import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, it } from "node:test";

import { confineChild, confinementCapability, dependencyReadRoots } from "../core/environment/confinement.ts";
import type { ConfinementResult } from "../core/environment/confinement.ts";

/**
 * `core/environment/confinement.ts`, the module every confined world's vector passes through.
 *
 * It existed for one release with no suite of its own. The `local-process` suite exercises it twice,
 * from the outside, over a fake runner - which holds that the *adapter* installs a confinement, and
 * holds nothing about the confinement itself. Every decision in the module is a decision about a
 * string: which flag, in which order, with what allowance, and what is said when a request is
 * refused. Those are exactly the decisions a fake cannot falsify, which is why this suite exists.
 *
 * ## Why the capability is asserted rather than assumed
 *
 * The module's first branch is the measurement, and on a runtime that refuses `--permission` *every*
 * request is refused for that one reason - so a suite that asserted only the specific refusal
 * sentences would fail on a runtime where the module is behaving exactly as designed. The refusal
 * tests therefore assert the vector is untouched unconditionally, and the reason conditionally:
 * the module's own reason when there is no capability, the specific sentence when there is.
 *
 * ## Why one of these tests really spawns a child
 *
 * A reading that a permitted write *still succeeds* is the whole argument for a boundary being
 * precise rather than blanket, and no fake can produce it. The last test starts one real confined
 * child, once, and reads both halves of its answer.
 */

/** The capability, asserted present - for the tests that can only be asked where it exists. */
function requireCapability(): void {
  const capability = confinementCapability();
  assert.equal(
    capability.available,
    true,
    `this suite can only assert confinement where the runtime can provide it: ${capability.reason}`,
  );
}

/**
 * Assert that a request was refused, and what was said about it.
 *
 * `command` and `args` are the values the request carried, and a refusal must leave both exactly as
 * they were: a refusal that quietly edited the vector would give a world a command it never declared.
 */
function assertRefused(
  result: ConfinementResult,
  command: string,
  args: readonly string[],
  pattern: RegExp,
): void {
  assert.equal(result.applied, false, `expected a refusal, got: ${result.reason}`);
  assert.equal(result.command, command, "a refused request leaves the command alone");
  assert.deepEqual([...result.args], [...args], "and leaves the argument vector alone");

  const capability = confinementCapability();
  if (capability.available) {
    assert.match(result.reason, pattern);
    return;
  }
  assert.equal(
    result.reason,
    capability.reason,
    "with no capability, that one reason is what every refusal carries - no later rule is reached",
  );
}

describe("confinement: the capability is a property of the interpreter, measured once", () => {
  it("answers with the same reading twice, so a second question starts no second probe", () => {
    const first = confinementCapability();
    const second = confinementCapability();

    assert.ok(
      Object.is(first, second),
      "the reading is memoised rather than remeasured - the first caller is inside a world's spawn path, where a probe is a child",
    );
    assert.equal(typeof first.available, "boolean");
    assert.equal(first.interpreter, process.execPath, "the interpreter whose flags these are");
    assert.ok(first.reason.length > 0, "a reading that says nothing about itself is not a reading");
  });

  it("names the mechanism it measured when it can confine, and names none when it cannot", () => {
    const capability = confinementCapability();

    if (capability.available) {
      assert.equal(capability.reason, "measured", "available is a reading, so it says it was read");
      assert.deepEqual(
        [...capability.mechanism],
        ["--permission", "--allow-fs-read", "--allow-fs-write", "--allow-child-process"],
        "the flags the probe really exercised, in the order they are applied",
      );
      return;
    }

    assert.deepEqual([...capability.mechanism], [], "a capability that is not available offers no flags");
    assert.notEqual(capability.reason, "measured", "and does not claim to have been measured");
  });
});

describe("confinement: the vector it replaces, and the vector it leaves alone", () => {
  const APPLICATION_ARGS = ["provision.mjs", "--flag", "a value with spaces"];

  it("replaces the command with the interpreter, keeping the application's own arguments at the tail", () => {
    requireCapability();

    const result = confineChild({
      command: "node",
      args: APPLICATION_ARGS,
      readRoots: ["/allow/read"],
      writeRoots: ["/allow/write"],
    });

    assert.equal(result.applied, true, result.reason);
    assert.equal(
      result.command,
      process.execPath,
      "an absolute interpreter path, so no shell can mangle an allowance that contains a space",
    );
    assert.deepEqual(
      result.args.slice(0, 3),
      ["--permission", "--allow-fs-read=/allow/read", "--allow-fs-write=/allow/write"],
      "the flag, then the allowances in the order they were asked for",
    );
    assert.deepEqual(result.args.slice(3), APPLICATION_ARGS, "the application's own vector is preserved, in order");
    assert.match(
      result.reason,
      /^confined by --permission with 1 read allowance\(s\) and 1 write allowance\(s\)$/u,
      "and the reason counts what was really applied",
    );
  });

  it("names every read root it was given, and counts them", () => {
    requireCapability();

    const result = confineChild({ command: "node", args: ["x.mjs"], readRoots: ["/one", "/two"], writeRoots: [] });

    assert.deepEqual(result.args.slice(0, 3), ["--permission", "--allow-fs-read=/one", "--allow-fs-read=/two"]);
    assert.deepEqual(result.args.slice(3), ["x.mjs"]);
    assert.match(
      result.reason,
      /with 2 read allowance\(s\) and 0 write allowance\(s\)$/u,
      "the count is a numeral: the empty-allowed case returned two statements earlier, so the reason's own 'no read allowance(s)' arm is unreachable",
    );
  });

  it("adds the child-process allowance only when it was asked for", () => {
    requireCapability();

    const asked = confineChild({
      command: "node",
      args: ["x.mjs"],
      readRoots: ["/read"],
      writeRoots: [],
      allowChildProcess: true,
    });
    const notAsked = confineChild({ command: "node", args: ["x.mjs"], readRoots: ["/read"], writeRoots: [] });

    assert.ok(asked.args.includes("--allow-child-process"), "the allowance that was asked for is applied");
    assert.ok(
      !notAsked.args.includes("--allow-child-process"),
      "and a child is not handed the right to start children nobody asked it to allow",
    );
  });

  it("reads the command as an interpreter's own name, in every spelling one interpreter arrives under", () => {
    requireCapability();

    for (const spelling of ["node", "NODE", "Node.exe", process.execPath, "C:\\Program Files\\nodejs\\node.exe"]) {
      const result = confineChild({ command: spelling, args: [], readRoots: ["/read"], writeRoots: [] });
      assert.equal(result.applied, true, `\`${spelling}\` names a Node interpreter, so it must be confined: ${result.reason}`);
    }
  });

  it("refuses a command the permission model does not reach, and names the command it refused", () => {
    assertRefused(
      confineChild({ command: "npm", args: ["run", "build"], readRoots: ["/read"], writeRoots: ["/write"] }),
      "npm",
      ["run", "build"],
      /`npm` is not a Node interpreter/u,
    );
  });

  it("refuses a child it was given no read allowance for, because it could not open the program", () => {
    assertRefused(
      confineChild({ command: "node", args: ["x.mjs"], readRoots: [], writeRoots: ["/write"] }),
      "node",
      ["x.mjs"],
      /no read allowance was given/u,
    );
  });
});

describe("confinement: the permitted half still works, which is what makes the refusal mean something", () => {
  it("runs a confined child that writes inside its allowance and refuses its write outside", () => {
    requireCapability();

    const root = mkdtempSync(join(tmpdir(), "veridian-confinement-test-"));
    const inside = join(root, "inside.txt");
    const outside = join(root, "..", `veridian-confinement-escape-${String(process.pid)}.txt`);
    // One child, asked both questions: the write it was allowed and the write it was not. A probe
    // that attempted only the refused half could not tell "the flag works" from "every write fails".
    const program = [
      "const fs = require('node:fs');",
      "const [inside, outside] = process.argv.slice(1);",
      "let permitted;",
      "try { fs.writeFileSync(inside, 'inside'); permitted = 'inside:written'; } catch (error) { permitted = 'inside:' + error.code; }",
      "let escaped;",
      "try { fs.writeFileSync(outside, 'outside'); escaped = 'outside:written'; } catch (error) { escaped = 'outside:' + error.code; }",
      "process.stdout.write(permitted + ' ' + escaped);",
    ].join(" ");

    let printed = "";
    let stderr = "";
    // Read *before* the cleanup below, deliberately: the cleanup deletes the escape file, so an
    // `existsSync` taken afterwards could answer `false` for a child that had written it.
    let escapeSurvived = true;

    try {
      const vector = confineChild({
        command: "node",
        args: ["-e", program, inside, outside],
        readRoots: [root],
        writeRoots: [root],
      });
      assert.equal(vector.applied, true, vector.reason);

      const confined = spawnSync(vector.command, [...vector.args], { encoding: "utf8", windowsHide: true });
      printed = confined.stdout ?? "";
      stderr = confined.stderr ?? "";
      escapeSurvived = existsSync(outside);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }

    assert.ok(
      printed.includes("inside:written"),
      `the permitted write must still succeed, or the refusal measures nothing about the boundary: ${printed} ${stderr}`,
    );
    assert.ok(
      printed.includes("outside:ERR_ACCESS_DENIED"),
      `the escape must be refused by the runtime rather than by luck: ${printed} ${stderr}`,
    );
    assert.equal(escapeSurvived, false, "the refusal is real: the file outside the allowance was never created");
  });
});

// ---- a program is not its dependencies --------------------------------------------------------------

describe("confinement: a program is not its dependencies, so the allowance has to name both", () => {
  /**
   * A real tree, because the derivation asks exactly one question - does this directory exist - and a
   * double answering *that* question would be asserting the answer the test was written to check.
   *
   * The shape is the one the live defect had: an application directory, a dependency of its own
   * inside it, a second dependency one level above it, a third above that, and one *below* the start
   * directory that belongs to whatever is imported from there rather than to the application.
   */
  function tree(): { readonly root: string; readonly app: string } {
    const root = mkdtempSync(join(tmpdir(), "veridian-dependency-roots-"));
    const app = join(root, "repo", "apps", "cart");
    mkdirSync(join(root, "node_modules", "outer"), { recursive: true });
    mkdirSync(join(root, "repo", "node_modules", "inner"), { recursive: true });
    mkdirSync(join(app, "node_modules", "own"), { recursive: true });
    mkdirSync(join(app, "vendor", "node_modules", "deep"), { recursive: true });
    return { root, app };
  }

  it("names the dependency beside the application, which is the root the interpreter refused to read", () => {
    const { root, app } = tree();
    try {
      const roots = dependencyReadRoots(app);
      assert.ok(
        roots.includes(join(root, "repo", "node_modules")),
        `a package the application imports lives beside its tree rather than inside it, and a confined child that cannot read the package it imports is refused before its first statement runs: ${roots.join(", ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("searches the start directory itself, the way module resolution does", () => {
    const { root, app } = tree();
    try {
      assert.ok(
        dependencyReadRoots(app).includes(join(app, "node_modules")),
        "the importing file's own tree is searched first, so a program whose dependencies sit inside it is not refused its own package",
      );
      assert.ok(
        dependencyReadRoots(join(root, "repo")).includes(join(root, "repo", "node_modules")),
        "and the same holds when the start directory is the project root rather than a nested one",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walks up rather than down, so a package below the start directory is not the application's dependency", () => {
    const { root, app } = tree();
    try {
      const roots = dependencyReadRoots(app);
      assert.ok(
        !roots.includes(join(app, "vendor", "node_modules")),
        `a nested node_modules belongs to whatever is imported from there, and naming it would hand the child a directory the application never reads: ${roots.join(", ")}`,
      );
      assert.ok(
        roots.includes(join(root, "node_modules")),
        `the walk reaches the filesystem root rather than stopping at the nearest parent: ${roots.join(", ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the nearest dependency before the furthest, which is the order resolution tries them in", () => {
    const { root } = tree();
    try {
      const roots = dependencyReadRoots(join(root, "repo"));
      const nearest = roots.indexOf(join(root, "repo", "node_modules"));
      const furthest = roots.indexOf(join(root, "node_modules"));
      assert.ok(nearest !== -1 && furthest !== -1, `both dependencies must be named: ${roots.join(", ")}`);
      assert.ok(
        nearest < furthest,
        `the walk reports them in the order the interpreter searches them: ${roots.join(", ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("answers with existing absolute directories only, so an allowance cannot name a place that is not there", () => {
    const { root, app } = tree();
    try {
      for (const answer of [dependencyReadRoots(app), dependencyReadRoots(root), dependencyReadRoots(tmpdir())]) {
        for (const entry of answer) {
          assert.ok(isAbsolute(entry), `every root is a path this machine can open, because a relative one resolves against the child: ${entry}`);
          assert.ok(statSync(entry).isDirectory(), `a named root is a directory rather than a file that happens to carry the name: ${entry}`);
        }
        assert.equal(
          new Set(answer).size,
          answer.length,
          `a duplicated root is an allowance that reads as wider than the one that was measured: ${answer.join(", ")}`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
