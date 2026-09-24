import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { DEFECTS, status } from "../examples/workspace-audit/defects.ts";

/**
 * The rules the `workspace-audit` goal stands on, held against the program that produces them.
 *
 * ## Why this file builds its own tree instead of auditing the repository
 *
 * The demo's subject is *this checkout*, which is exactly what makes it useful and exactly what makes
 * it untestable as an assertion: a test that pinned this repository's branch or version would fail on a
 * fork for a reason unrelated to the code - the defect `local-process` records, where a criterion
 * passed or failed on how an operator typed a path.
 *
 * So every test below stands a **small tree of its own** in a temporary directory, declares *that* as
 * the observation surface, and asserts on facts it put there itself. The reading is then a known
 * quantity, which is what lets the interesting property be checked: not "the audit found the right
 * branch" but "the audit found what was put in front of it, reported an absence as an absence, and
 * could not write into it".
 *
 * ## The two halves this file exists to hold apart
 *
 * The program's central claim is that it **cannot** write into the tree it audits. That claim is only
 * worth something if the same program *can* write somewhere, so the tests drive both:
 *
 *   - unconfined, its write probe reports `breached` - which is the proof that `refused` is a reading
 *     rather than a constant the program prints
 *   - confined exactly as the world confines it, the same program reports `refused`
 *
 * One flag is the only difference between those two runs. A program that hardcoded either answer would
 * pass one of them and fail the other, and that is the whole design of the pair.
 */

const probePath = fileURLToPath(new URL("../examples/workspace-audit/app/audit-probe.mjs", import.meta.url));
const appDir = fileURLToPath(new URL("../examples/workspace-audit/app/", import.meta.url));
const auditDir = fileURLToPath(new URL("../examples/workspace-audit/", import.meta.url));

/** The closed vocabulary of the write probe's outcome. A fourth member would be a status no criterion could reason about. */
const WRITE_OUTCOMES = ["refused", "breached", "not-put-to-the-test"];

interface AuditReport {
  readonly schema: string;
  readonly goal: string;
  readonly declared: readonly string[];
  readonly roots: readonly {
    readonly path: string;
    readonly kind: string;
    readonly census: { readonly status: string; readonly entries: number; readonly total: number };
    readonly head: { readonly kind: string; readonly value: string } | null;
    readonly manifest: { readonly present: boolean; readonly name: string | null; readonly version: string | null };
  }[];
  readonly sandbox: { readonly write: { readonly outcome: string } };
  readonly boundary: { readonly root: string; readonly write: { readonly outcome: string; readonly residue: string } } | null;
}

/**
 * A tree worth auditing, built in the caller's temporary directory.
 *
 * `.git/HEAD` is written as a **branch ref** and `package.json` as a manifest with a known name and
 * version, so both readings have something to find and neither has to be inferred from a directory
 * name - which is the program's own rule and therefore the one a test has to be able to check.
 */
function buildTree(root: string): string {
  const observed = join(root, "observed");
  mkdirSync(join(observed, ".git"), { recursive: true });
  writeFileSync(join(observed, ".git", "HEAD"), "ref: refs/heads/a-test-branch\n", "utf8");
  writeFileSync(
    join(observed, "package.json"),
    JSON.stringify({ name: "a-test-tree", version: "9.9.9", scripts: { one: "true" } }),
    "utf8",
  );
  mkdirSync(join(observed, "src"), { recursive: true });
  writeFileSync(join(observed, "src", "index.js"), "export const one = 1;\n", "utf8");
  return observed;
}

interface RunOptions {
  readonly command: string;
  readonly sandbox: string;
  readonly observed?: string;
  /** When true, the same allowance the world composes - so the boundary is the runtime's, not the program's. */
  readonly confined?: boolean;
}

function runProbe(options: RunOptions): { readonly code: number; readonly stdout: string; readonly stderr: string } {
  const env: Record<string, string> = {
    ...process.env,
    VERIDIAN_PROCESS_ROOT: options.sandbox,
    VERIDIAN_PROCESS_APP: options.sandbox,
  };
  if (options.observed !== undefined) env["VERIDIAN_PROCESS_OBSERVE"] = options.observed;

  const args = [probePath, options.command];
  if (options.confined === true) {
    // The write allowance is the sandbox and the read allowance names the observed tree as well, which
    // is the shape the adapter composes and the one `process.observe` exists to make possible.
    args.unshift(
      "--permission",
      `--allow-fs-read=${appDir.replaceAll("\\", "/")}`,
      `--allow-fs-read=${options.sandbox.replaceAll("\\", "/")}`,
      ...(options.observed === undefined ? [] : [`--allow-fs-read=${options.observed.replaceAll("\\", "/")}`]),
      `--allow-fs-write=${options.sandbox.replaceAll("\\", "/")}`,
    );
  }

  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: appDir, env });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A sandbox and an observed tree per call, removed afterwards - the discipline the world's reset applies. */
function withTrees<T>(body: (sandbox: string, observed: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "veridian-waudit-"));
  try {
    const sandbox = join(root, "sandbox");
    mkdirSync(sandbox, { recursive: true });
    return body(sandbox, buildTree(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function reportFrom(sandbox: string): AuditReport {
  return JSON.parse(readFileSync(join(sandbox, "audit", "workspace.json"), "utf8")) as AuditReport;
}

/** The contract's criteria, read from the document rather than restated here. */
function criteriaIds(): readonly string[] {
  const document = parse(readFileSync(join(auditDir, "acceptance.yaml"), "utf8")) as {
    criteria: readonly { id: string }[];
  };
  return document.criteria.map((criterion) => criterion.id);
}

/** The observation surface the environment document declares, read from the document itself. */
function declaredObserve(): readonly string[] {
  const document = parse(readFileSync(join(auditDir, "environment.yaml"), "utf8")) as {
    process?: { observe?: readonly string[] };
  };
  return document.process?.observe ?? [];
}

describe("the workspace audit reads a real tree and can not write into it", () => {
  it("declares an observation surface, which is the whole difference from every other local-process goal", () => {
    // A contract that audits nothing would still pass every structural check, so the surface is
    // asserted to be declared rather than assumed - and asserted to be exactly one directory, because
    // a list that grew without this failing is a list nobody re-read.
    assert.deepEqual(declaredObserve(), ["../../../"], "the example no longer declares the repository root");
  });

  it("describes the tree it was pointed at, without inferring anything it did not read", () => {
    withTrees((sandbox, observed) => {
      // Confined, because an *unconfined* audit of this tree legitimately exits 4: it detects its own
      // breach and refuses. That is asserted on its own below, and it is the reason a test that wanted
      // a zero exit here had to say which of the two runs it meant.
      const run = runProbe({ command: "audit", sandbox, observed, confined: true });
      assert.equal(run.code, 0, `the audit refused: ${run.stderr}`);

      const report = reportFrom(sandbox);
      assert.equal(report.schema, "veridian.workspace-audit/1");
      assert.equal(report.goal, "workspace-audit");
      assert.deepEqual(report.declared, [observed], "the report names a surface other than the one it was given");

      const [root] = report.roots;
      assert.notEqual(root, undefined, "the audit described no root at all");
      assert.equal(root?.kind, "dir");
      assert.equal(root?.census.status, "present");
      // Three entries were put there: `.git`, `package.json` and `src`.
      assert.equal(root?.census.entries, 3, "the census is not the top level of the tree this test built");
      assert.equal(root?.head?.kind, "ref");
      assert.equal(root?.head?.value, "refs/heads/a-test-branch");
      assert.equal(root?.manifest.present, true);
      assert.equal(root?.manifest.name, "a-test-tree");
      assert.equal(root?.manifest.version, "9.9.9");
    });
  });

  it("reports an absence as an absence, rather than guessing from a directory name", () => {
    const root = mkdtempSync(join(tmpdir(), "veridian-waudit-"));
    try {
      const sandbox = join(root, "sandbox");
      const bare = join(root, "bare");
      mkdirSync(sandbox, { recursive: true });
      mkdirSync(bare, { recursive: true });

      const run = runProbe({ command: "audit", sandbox, observed: bare, confined: true });
      assert.equal(run.code, 0, `the audit refused: ${run.stderr}`);

      const report = reportFrom(sandbox);
      const [entry] = report.roots;
      // The directory is named `bare`, and neither reading may be derived from that name. Both answer
      // `null` and `present: false`, which is the reading rather than an absence of one.
      assert.equal(entry?.head, null, "a HEAD was reported for a tree that has no repository in it");
      assert.equal(entry?.manifest.present, false, "a manifest was reported for a tree that has none");
      assert.equal(entry?.census.status, "present", "the tree itself was not read");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the write probe as BREACHED when nothing confines it, so `refused` is a reading and not a constant", () => {
    // This is the negative control on the probe itself, and the reason it is a test rather than a
    // comment: run outside the runtime, this program really can write into the tree it is auditing. If
    // it reported `refused` here, its `refused` under confinement would mean nothing at all.
    withTrees((sandbox, observed) => {
      const run = runProbe({ command: "audit", sandbox, observed });
      const report = reportFrom(sandbox);
      assert.equal(
        report.boundary?.write.outcome,
        "breached",
        "an unconfined probe claimed the boundary held, so the outcome is not measured",
      );
      assert.equal(run.code, 4, "a breach was not reported as one");
    });
  });

  it("refuses to write into the observed tree once the world's allowance is applied", () => {
    withTrees((sandbox, observed) => {
      const run = runProbe({ command: "audit", sandbox, observed, confined: true });
      assert.equal(run.code, 0, `the confined audit refused: ${run.stderr}`);

      const report = reportFrom(sandbox);
      assert.equal(
        report.boundary?.write.outcome,
        "refused",
        "the runtime permitted a write into the tree the audit was reading",
      );
      assert.equal(report.boundary?.write.residue, "none", "the write probe left a file behind");
      assert.equal(report.sandbox.write.outcome, "writable", "the control did not hold, so the refusal means nothing");
    });
  });

  it("leaves no trace in the tree it audited, confined or not", () => {
    withTrees((sandbox, observed) => {
      runProbe({ command: "audit", sandbox, observed });
      runProbe({ command: "audit", sandbox, observed, confined: true });
      // Read from the filesystem rather than from the report: a program that removed its own file and
      // reported it wrongly would satisfy the report and fail here.
      assert.throws(
        () => readFileSync(join(observed, ".veridian-audit-write-probe"), "utf8"),
        "the audit left its write probe in the tree it was auditing",
      );
    });
  });

  it("reports a write probe outcome from the closed vocabulary, whatever the machine does", () => {
    withTrees((sandbox, observed) => {
      runProbe({ command: "audit", sandbox, observed, confined: true });
      const report = reportFrom(sandbox);
      assert.ok(
        WRITE_OUTCOMES.includes(report.boundary?.write.outcome ?? ""),
        `the outcome ${String(report.boundary?.write.outcome)} is not one a criterion can reason about`,
      );
      // The sandbox half has its own vocabulary, and it is a different one on purpose: "the boundary
      // held" and "the sandbox worked" are different readings and a program that spelled them with one
      // word could not report both being true at once.
      assert.ok(
        ["writable", "unwritable"].includes(report.sandbox.write.outcome),
        `the sandbox half reports ${report.sandbox.write.outcome}, which is outside its own vocabulary`,
      );
    });
  });

  it("produces byte-identical reports from two audits of an unchanged tree", () => {
    // The reading carries no clock, and this is the assertion that would catch one arriving. A report
    // that differed between two readings of the same tree would be a description of a moment, which is
    // exactly what an audit of a workspace must not be if two of them are ever to be compared.
    withTrees((sandbox, observed) => {
      runProbe({ command: "audit", sandbox, observed });
      const first = readFileSync(join(sandbox, "audit", "workspace.json"), "utf8");
      runProbe({ command: "audit", sandbox, observed });
      const second = readFileSync(join(sandbox, "audit", "workspace.json"), "utf8");
      assert.equal(first, second, "two audits of one tree produced different documents");
    });
  });

  it("refuses a verify with nothing to verify, and writes nothing to stdout while refusing", () => {
    withTrees((sandbox, observed) => {
      const run = runProbe({ command: "verify", sandbox, observed });
      assert.equal(run.code, 2, "a verify with no report did not refuse");
      assert.equal(run.stdout, "", "the verify wrote to stdout while refusing");
      // The refusal has to name the document, or a reader is handed a status with no subject - the same
      // rule `environment-twin` holds for its own verify.
      assert.match(run.stderr, /the report could not be read from/u);
    });
  });

  it("agrees with the report it wrote once there is one to read", () => {
    withTrees((sandbox, observed) => {
      assert.equal(runProbe({ command: "audit", sandbox, observed, confined: true }).code, 0);
      // `verify` reads only, so it needs no allowance - and that it works without one is itself a
      // reading: a verifier that required the write allowance to re-read a report would be a verifier
      // that could not check an audit it was not allowed to run.
      const run = runProbe({ command: "verify", sandbox, observed });
      assert.equal(run.code, 0, `the verify refused: ${run.stderr}`);
      assert.match(run.stdout, /audit:agrees yes/u);
    });
  });

  it("refuses an unusable command line with its own exit code, so a typo is not a defect", () => {
    withTrees((sandbox, observed) => {
      const run = runProbe({ command: "audti", sandbox, observed });
      assert.equal(run.code, 2, "a typo in the command was not distinguished from a failure of the program");
      assert.equal(run.stdout, "", "the program wrote to stdout while refusing an unusable command line");
      assert.match(run.stderr, /unknown command audti/u);
    });
  });

  it("refuses to audit when no observation surface was declared", () => {
    // The ordinary case for every other `local-process` goal, and the one this program must not answer
    // by auditing its own application directory: that would report on the probe rather than on a
    // workspace, and would do it in the same words.
    withTrees((sandbox) => {
      const run = runProbe({ command: "audit", sandbox });
      assert.equal(run.code, 2, "the audit ran without a surface to audit");
      assert.match(run.stderr, /no observation surface was declared/u);
      assert.equal(run.stdout, "", "the audit wrote to stdout while refusing");
    });
  });

  it("keeps the vocabulary the contract names, so a criterion can not read a status nothing produces", () => {
    // Both halves of the boundary are spelled here, and both are the program's: an outcome the contract
    // asserts and the program cannot print would be a criterion that is always false, which reads as an
    // application defect and sends a repair loop after working code.
    assert.deepEqual(WRITE_OUTCOMES, ["refused", "breached", "not-put-to-the-test"]);
    const text = readFileSync(probePath, "utf8");
    for (const outcome of WRITE_OUTCOMES) {
      assert.ok(text.includes(`"${outcome}"`), `the vocabulary names ${outcome} and the program never prints it`);
    }
  });
});

describe("the deliberate defects, and the criteria they are filed against", () => {
  it("files every defect against a criterion the contract actually declares", () => {
    const declared = new Set(criteriaIds());
    assert.ok(DEFECTS.length > 0, "the demo has no defects, so it shows nothing descending");
    for (const defect of DEFECTS) {
      assert.ok(
        declared.has(defect.criterionId),
        `${defect.id} is filed against ${defect.criterionId}, which the contract does not declare`,
      );
    }
  });

  it("reaches every defect's criterion exactly as the table claims, one edit at a time", () => {
    // The reach table is a claim about the *contract*, so it is checked against the contract's own
    // documents rather than against the narration: each defect names one criterion, the criteria are
    // distinct, and the count is what the demo's descent is built from.
    const reached = DEFECTS.map((defect) => defect.criterionId);
    assert.deepEqual(reached, ["AC-003", "AC-002", "AC-008"]);
    assert.equal(new Set(reached).size, reached.length, "two defects claim one criterion, so the descent double-counts");
  });

  it("finds every defect intact in the correct program and injectable into it", () => {
    const body = readFileSync(probePath, "utf8");
    const states = status(body);
    assert.equal(states.length, DEFECTS.length);
    for (const entry of states) {
      assert.equal(
        entry.state,
        "intact",
        `${entry.defect.id} is ${entry.state} in the checked-in program, so the demo is not starting from a correct probe`,
      );
    }
  });

  it("lets no defect touch the readiness line, because that would take the world down", () => {
    // `local-process` paid for this rule: a defect that misspells the readiness word ends the run before
    // any criterion is observed *and* before the repair gate is reached, so a loop that only starts once
    // the world is up can never repair it. The line is checked against the environment document's own
    // pattern rather than a copy of the string.
    const environment = parse(readFileSync(join(auditDir, "environment.yaml"), "utf8")) as {
      start?: { readyPattern?: string };
    };
    const readyPattern = environment.start?.readyPattern ?? "";
    assert.equal(readyPattern, "workspace-audit daemon ready");

    const body = readFileSync(probePath, "utf8");
    assert.ok(body.includes("`${GOAL} daemon ready`") || body.includes("daemon ready"), "the program no longer prints the readiness line");
    for (const defect of DEFECTS) {
      const touched = defect.correct.split("\n").some((line) => line.includes("daemon ready"));
      assert.equal(touched, false, `${defect.id} edits the readiness line`);
    }
  });

  it("states the descent the demo prints, so the narration and the table can not drift", () => {
    const demo = readFileSync(join(auditDir, "demo.ts"), "utf8");
    assert.ok(
      demo.includes("4 -> 2 -> 1 -> 0"),
      "the demo no longer prints the descent the defect table predicts",
    );
    // Four failures on the first pass, and the table predicts it: AC-003 and AC-004 from one edit, plus
    // AC-002 and AC-008 from the other two.
    const counted = DEFECTS.reduce((total, defect) => total + (defect.id === "D1" ? 2 : 1), 0);
    assert.equal(counted, 4, "the reach table no longer adds up to the first-pass failure count");
  });

  it("keeps the observation surface out of the defect table, because destroying it takes the contract down", () => {
    // The surface is declared in the **environment document** and received by the program through the
    // environment, never hardcoded in the program - so a defect editing the program cannot remove the
    // declaration, and a defect that broke the program's reading of it would fail the *contract*
    // rather than a criterion. That is the readiness-line failure in a new place, which
    // `local-process` already paid for once.
    //
    // The needle is `process.observe` and the world's own environment name rather than the word
    // "observe": the program's local variable is called `observed`, and a check on the bare word
    // matched it - which is the substring-needle trap this repository has already recorded.
    const environment = readFileSync(join(auditDir, "environment.yaml"), "utf8");
    assert.ok(environment.includes("observe:"), "the environment document no longer declares a surface");

    for (const defect of DEFECTS) {
      const text = `${defect.correct}\n${defect.defective}`;
      for (const needle of ["process.observe", "VERIDIAN_PROCESS_OBSERVE", "environment.yaml"]) {
        assert.equal(text.includes(needle), false, `${defect.id} edits the observation surface (${needle})`);
      }
    }
  });
});

describe("the environment document and the contract agree about the surface", () => {
  it("judges the refusal and its control in separate criteria, so neither can substitute for the other", () => {
    const document = parse(readFileSync(join(auditDir, "acceptance.yaml"), "utf8")) as {
      criteria: readonly { id: string; expect: readonly { validator: string; contains?: unknown; equals?: unknown }[] }[];
    };
    const text = JSON.stringify(document);
    // The refusal and the permitted half are each asserted, and each in its own criterion - because a
    // contract that only asserted the refusal could be satisfied by an instrument that cannot write.
    assert.ok(text.includes("boundary:write refused"), "no criterion asserts the refusal");
    assert.ok(text.includes("write=writable"), "no criterion asserts the control");
    assert.ok(text.includes("audit:control-held yes"), "the derived control line is not asserted");
    assert.ok(text.includes("audit:refusal-earned yes"), "the derived verdict is not asserted");
  });

  it("asserts no value belonging to the tree it runs against", () => {
    // The discipline that keeps this contract meaningful on a fork. Every one of these would make the
    // contract a claim about the checkout it was written in.
    const text = readFileSync(join(auditDir, "acceptance.yaml"), "utf8");
    for (const forbidden of ["refs/heads/", "veridian 0.6", "surface:root D:", "surface:entries 3"]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `the contract pins ${forbidden}, which is a fact about this checkout rather than about the program`,
      );
    }
  });

  it("names the observation surface in the environment document, and nowhere else", () => {
    // `process.observe` is the product seam rather than an example's trick, so the example declares it
    // once, as a directory, and never widens it. A second declaration would be a second policy.
    const environment = readFileSync(join(auditDir, "environment.yaml"), "utf8");
    assert.equal(
      environment.split("observe:").length - 1,
      1,
      "the environment document declares the observation surface more than once",
    );
  });
});
