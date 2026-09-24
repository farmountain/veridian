import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { DEFECTS, status } from "../examples/environment-twin/defects.ts";

/**
 * The rules the `environment-twin` goal stands on, held against the program that produces them.
 *
 * ## Why this file is about the *instrument* rather than about the answer
 *
 * Every other demo test in this repository can assert a value: the page says this, the row is absent,
 * the container holds that limit. This one cannot, and refusing to is the point. Whether a machine
 * reports `tool.git` available is a fact about the machine, and a test that pinned it would fail on a
 * colleague's laptop for a reason unrelated to the code - which is the same defect the `local-process`
 * contract records, where a criterion passed or failed on how an operator typed a path.
 *
 * So what is held here is the **shape of the measurement**: a closed status vocabulary, evidence on
 * every capability, both halves of every two-stage probe, a control that must be live, determinism,
 * and a refusal that names what it could not read. Those hold on a machine with everything installed
 * and on one with nothing, and they are exactly the properties whose absence would make the twin
 * worthless while leaving every value in it plausible.
 *
 * ## The two defects this pass made, both now held
 *
 * The first version of `capability-probe.mjs` spread a helper's return into a record whose field was
 * named `status` while the helper answered a boolean called `ok`, so a capability rendered as
 * `status=undefined` - the one value a reader cannot tell from a bug in the renderer. And the first
 * version of AC-007 ran `verify` with no prior step, assuming nothing had surveyed yet; a criterion
 * *earlier in the same file* already had, so the criterion failed against a **correct** program. Both
 * were found by running the thing rather than by reading it, and the second is why `clear` exists and
 * why the test below drives the refusal path itself rather than trusting the contract's ordering.
 */

const probePath = fileURLToPath(new URL("../examples/environment-twin/app/capability-probe.mjs", import.meta.url));
const twinDir = fileURLToPath(new URL("../examples/environment-twin/", import.meta.url));

/** The closed vocabulary. A fourth member would be a status no criterion could reason about. */
const STATUSES = ["available", "absent", "instrument-broken"];

interface Capability {
  readonly name: string;
  readonly status: string;
  readonly evidence: string;
}

interface Twin {
  readonly schema: string;
  readonly goal: string;
  readonly control: { readonly status: string; readonly evidence: string };
  readonly facts: Readonly<Record<string, unknown>>;
  readonly capabilities: readonly Capability[];
}

/** Run the probe against a fresh sandbox and hand back everything it produced. */
function runProbe(
  command: string,
  root: string,
): { readonly code: number; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [probePath, command], {
    encoding: "utf8",
    env: { ...process.env, VERIDIAN_PROCESS_ROOT: root },
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A sandbox per call, removed afterwards - the same discipline the world's `restart` reset applies. */
function withSandbox<T>(body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "veridian-etwin-"));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function twinFrom(root: string): Twin {
  return JSON.parse(readFileSync(join(root, "twin", "capabilities.json"), "utf8")) as Twin;
}

/** The contract's criteria, read from the document rather than restated here. */
function criteriaIds(): readonly string[] {
  const document = parse(readFileSync(join(twinDir, "acceptance.yaml"), "utf8")) as {
    criteria: readonly { id: string }[];
  };
  return document.criteria.map((criterion) => criterion.id);
}

describe("the capability probe measures, and writes what it measured", () => {
  it("writes a twin naming the schema and the goal, from a sandbox it was given", () => {
    withSandbox((root) => {
      const run = runProbe("survey", root);
      assert.equal(run.code, 0, `the survey refused: ${run.stderr}`);

      const twin = twinFrom(root);
      assert.equal(twin.schema, "veridian.capability-twin/1");
      assert.equal(twin.goal, "environment-twin");

      // The facts are readings off `node:os` and the running interpreter, so they are compared with
      // what *this* process sees rather than with literals - the same machine, read twice.
      assert.equal(twin.facts["platform"], process.platform);
      assert.equal(twin.facts["architecture"], process.arch);
      assert.equal(twin.facts["runtime"], process.version);
    });
  });

  it("gives every capability a status from the closed vocabulary and evidence that is not empty", () => {
    withSandbox((root) => {
      runProbe("survey", root);
      const twin = twinFrom(root);

      assert.ok(twin.capabilities.length > 0, "the twin measured nothing at all");
      for (const capability of twin.capabilities) {
        assert.ok(
          STATUSES.includes(capability.status),
          `${capability.name} carries status ${JSON.stringify(capability.status)}, which is not one of ${STATUSES.join(", ")}`,
        );
        assert.notEqual(
          capability.evidence.trim(),
          "",
          `${capability.name} reports ${capability.status} with no evidence behind it`,
        );
      }
    });
  });

  it("records both halves of the enforcement probe, so its verdict was earned rather than assumed", () => {
    withSandbox((root) => {
      runProbe("survey", root);
      const permission = twinFrom(root).capabilities.find((entry) => entry.name === "runtime.permission");

      assert.ok(permission !== undefined, "the filesystem permission model was not measured at all");
      // The rule `core/environment/isolation.ts` states: a probe that only attempts the refused half
      // cannot tell "the boundary holds" from "every write fails", so both halves must be recorded.
      assert.match(
        permission.evidence,
        /permitted half/,
        "no permitted half was recorded, so no enforcement verdict can be concluded",
      );
      assert.match(permission.evidence, /refused half/, "the boundary was never put to the test");
    });
  });

  it("produces byte-identical twins from two independent surveys of an unchanged machine", () => {
    withSandbox((root) => {
      runProbe("survey", root);
      const first = readFileSync(join(root, "twin", "capabilities.json"), "utf8");
      runProbe("survey", root);
      const second = readFileSync(join(root, "twin", "capabilities.json"), "utf8");

      // This is only assertable because the twin carries no timestamp. A clock reading would make
      // every pair of surveys differ for a reason that is not about the environment.
      assert.equal(second, first, "two surveys of the same machine produced different documents");
      assert.equal(runProbe("compare", root).code, 0);
    });
  });

  it("agrees with the twin it re-reads from disk", () => {
    withSandbox((root) => {
      runProbe("survey", root);
      const run = runProbe("verify", root);
      assert.equal(run.code, 0, `verify refused a twin it had just been handed: ${run.stderr}`);
      assert.match(run.stdout, /capability-twin agrees yes/);
      assert.equal(run.stderr, "", "verify reported something on the error stream while agreeing");
    });
  });

  it("refuses to verify a twin that is not there, naming the document it could not read", () => {
    withSandbox((root) => {
      // `clear` is what makes this criterion independent of where it sits in the list. Without it the
      // refusal path was only reachable while nothing had surveyed yet - which is an ordering
      // dependency that reads as a fact about the program.
      assert.equal(runProbe("clear", root).code, 0);

      const run = runProbe("verify", root);
      assert.equal(run.code, 2, "verify did not refuse when there was no twin to read");
      assert.equal(run.stdout, "", "verify wrote to stdout while refusing");
      assert.match(run.stderr, /the twin could not be read from/);
    });
  });

  it("refuses an unusable command line with 2, and never reports a crash as a reading", () => {
    withSandbox((root) => {
      const run = runProbe("not-a-command", root);
      assert.equal(run.code, 2);
      assert.match(run.stderr, /unknown command not-a-command/);
      assert.equal(run.stdout, "");
    });
  });
});

describe("the defect table is the one this contract was written against", () => {
  it("ships the correct probe, so every defect reads as intact rather than unknown", () => {
    const body = readFileSync(join(twinDir, "app", "capability-probe.mjs"), "utf8");
    const states = status(body);
    assert.equal(states.length, DEFECTS.length);
    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} reports ${entry.state} against the shipped probe, so this table is not the table that program was written for`,
      );
    }
  });

  it("files each defect against a criterion this contract actually declares", () => {
    const declared = criteriaIds();
    const filed = new Set<string>();
    for (const defect of DEFECTS) {
      assert.ok(
        declared.includes(defect.criterionId),
        `${defect.id} is filed against ${defect.criterionId}, which this contract does not declare`,
      );
      filed.add(defect.criterionId);
    }
    // Two defects against one criterion would mean a repair moved two readings at once, and the demo
    // would no longer be able to show a criterion being judged on its own.
    assert.equal(filed.size, DEFECTS.length, "two defects are filed against the same criterion");
  });

  it("never aims a defect at the line the world's readiness check waits for", () => {
    const environment = parse(readFileSync(join(twinDir, "environment.yaml"), "utf8")) as {
      start: { readyPattern: string };
    };
    const readiness = environment.start.readyPattern;

    // A defect block is literal text and so is the pattern, so this comparison is valid on this side.
    // `local-process` paid for the rule: a defect that misspelt the readiness word took the *world*
    // down, so the run ended before any criterion was observed and before the repair gate was reached
    // - and a defect that takes down the world cannot be repaired by a loop that only runs once the
    // world is up.
    for (const defect of DEFECTS) {
      assert.ok(
        !defect.defective.includes(readiness),
        `${defect.id} edits the line the readiness check waits for, so the world would not come up`,
      );
    }

    // The pattern is matched against what the program **prints**, never against its source. The daemon
    // line is built by interpolation - `say(\`${GOAL} daemon ready (root ...)\`)` - so a substring
    // search over the file compares a pattern against the expression that will render it and can never
    // match. That is the trap `tests/sim-data-demo.test.ts` records, and the first version of this
    // assertion walked straight into it: it searched the source, found nothing, and reported a correct
    // contract as wrong. The fix is the prescribed one - read the rendered line.
    withSandbox((root) => {
      const result = spawnSync(process.execPath, [probePath, "daemon"], {
        encoding: "utf8",
        timeout: 4000,
        env: { ...process.env, VERIDIAN_PROCESS_ROOT: root },
      });
      const printed = result.stdout ?? "";
      assert.ok(
        printed.includes(readiness),
        `the probe no longer prints the readiness line the world waits for; it printed ${JSON.stringify(printed)}`,
      );
    });
  });

  it("states a reach table that the descent the demo narrates also states", () => {
    const demo = readFileSync(join(twinDir, "demo.ts"), "utf8");
    const defects = readFileSync(join(twinDir, "defects.ts"), "utf8");

    // Measured, not reasoned: the run descends 4 -> 2 -> 1 -> 0, because D1 empties an evidence field
    // and `survey` derives its own exit code from the audit, so AC-002 fails beside AC-008. The first
    // draft of both files claimed 3 -> 2 -> 1 -> 0 and had to be corrected against the run.
    assert.match(demo, /descending failures: 4 -> 2 -> 1 -> 0/);
    assert.match(defects, /4 -> 2 -> 1 -> 0/);

    // D1 must name both criteria it reaches, or the table would understate its own reach.
    const d1 = DEFECTS.find((defect) => defect.id === "D1");
    assert.ok(d1 !== undefined);
    assert.match(defects, /D1 -> AC-002, AC-008/);
  });
});
