#!/usr/bin/env node
/**
 * audit-probe - the application the `workspace-audit` contract starts and judges.
 *
 * ## The question this answers, and why it took a change to the world to ask it
 *
 * *What is the reality of the tree I am actually working in?* Every world before this one judged
 * something the run **deployed**: a page, a row, a container's records. None of them could be pointed
 * at the operator's own checkout, and the reason was structural rather than missing code. The
 * `local-process` world's read allowance was a fixed pair - the application directory and the sandbox
 * - so a real workspace was unreachable by construction, and pointing `root` at it instead is no
 * answer because `root` is emptied on every reset. A world rooted at the workspace would delete the
 * code under test on its first iteration.
 *
 * So the world gained `process.observe`: a **declared** read surface. This program reads it, and the
 * two halves it measures are the whole point:
 *
 *   permitted half  the declared tree can be READ, so the audit has something to report on
 *   refused half    the declared tree can not be WRITTEN, so an audit cannot modify what it measures
 *
 * The second half is what makes this safe rather than merely convenient, and it is not a promise in a
 * comment - the runtime enforces it. A world that wrote into the tree it was auditing would change the
 * thing it was asked to observe, and every criterion afterwards would be judging a tree the run itself
 * had altered. That is the one failure mode worse than not looking.
 *
 * ## The breach is reported rather than assumed away
 *
 * If the write *does* succeed, this program deletes what it wrote and reports `breached` - because a
 * run that quietly repaired its own boundary failure would be reporting a boundary it does not have.
 * The check is therefore a real measurement with a real negative answer available, not a formality.
 *
 * ## What it audits, and the bound on it
 *
 * Each declared root gets: existence, a top-level census (bounded, so a checkout with a vendored
 * `node_modules` does not become a walk of a hundred thousand files), the manifest's declared name and
 * version when there is one, and the repository's own `HEAD` when it is a repository. Nothing is
 * inferred: a manifest that is not there is reported `absent`, never guessed at from a directory name.
 *
 * ## What this program may not do
 *
 * It may not read stdin - the adapter spawns every child with `stdio: ["ignore", "pipe", "pipe"]`, so a
 * prompt receives immediate EOF rather than a person. Every argument arrives in `argv` and every answer
 * leaves through an exit code.
 *
 * ## Exit codes
 *
 *   0   did what was asked
 *   2   the command line was unusable, or no observation surface was declared to audit
 *   4   the audit found the boundary breached, or a second audit disagreed with the first
 *
 * `4` rather than `1` on purpose: `1` is what an uncaught exception produces, and a criterion that
 * could not tell "the boundary was breached" from "the program fell over" would report the second as
 * the first.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

const ROOT = process.env["VERIDIAN_PROCESS_ROOT"] ?? ".";
const REPORT_DIR = join(ROOT, "audit");
const REPORT_FILE = join(REPORT_DIR, "workspace.json");
const SCHEMA = "veridian.workspace-audit/1";
const GOAL = "workspace-audit";

/** The declared read surface. Empty when the document observed nothing, which is refused below. */
const OBSERVED = (process.env["VERIDIAN_PROCESS_OBSERVE"] ?? "")
  .split(delimiter)
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");

/**
 * The bound on the census, and it is a product decision rather than a performance one.
 *
 * A checkout with a vendored dependency tree has six figures of files. Walking it would make the audit
 * a function of how much a project has installed rather than of what it declared, and the reading would
 * change when somebody ran an install - which is the definition of a measurement that is not about the
 * thing it claims to measure. So the census is the top level, bounded, and the bound is reported.
 */
const MAX_ENTRIES = 200;
const MAX_NAME_CHARS = 40;

/** One line on stdout, and one on stderr - kept apart because a criterion judges which stream it was on. */
function say(line) {
  process.stdout.write(`${line}\n`);
}

function warn(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Read one directory's top level, bounded, and never throw for an ordinary reason.
 *
 * `ENOENT` is a reading about the tree rather than a crash of the program: a declared root that is not
 * there is exactly the sort of thing an audit exists to report. So absence comes back as a value.
 */
async function census(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const kept = entries.slice(0, MAX_ENTRIES);
    return {
      status: "present",
      entries: kept.length,
      total: entries.length,
      truncated: entries.length > kept.length,
      names: kept.map((entry) => ({
        name: entry.name.slice(0, MAX_NAME_CHARS),
        kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      })),
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "unknown";
    return { status: "absent", entries: 0, total: 0, truncated: false, names: [], reason: `readdir: ${String(code)}` };
  }
}

/** Whether the path is a directory at all - the difference between "empty" and "not a directory". */
async function kindOf(path) {
  try {
    const info = await stat(path);
    return info.isDirectory() ? "dir" : info.isFile() ? "file" : "other";
  } catch {
    return "absent";
  }
}

/**
 * The repository's own `HEAD`, read from the file rather than from `git`.
 *
 * Deliberately not a subprocess. `git` is not guaranteed to be on the machine a contract runs on, and a
 * reading that is `absent` because a tool was missing is a reading about the tool rather than about the
 * tree - the exact confusion `environment-twin` exists to keep apart. The file says what it says: a ref
 * name when the checkout is on a branch, or a commit id when it is detached.
 */
async function headOf(root) {
  try {
    const raw = (await readFile(join(root, ".git", "HEAD"), "utf8")).trim();
    return raw.startsWith("ref: ") ? { kind: "ref", value: raw.slice(5) } : { kind: "commit", value: raw };
  } catch {
    return null;
  }
}

/** The manifest's own name and version, when a manifest is there to read. */
async function manifestOf(root) {
  try {
    const parsed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    return {
      present: true,
      name: typeof parsed?.name === "string" ? parsed.name : null,
      version: typeof parsed?.version === "string" ? parsed.version : null,
      scripts: parsed?.scripts !== null && typeof parsed?.scripts === "object" ? Object.keys(parsed.scripts).length : 0,
    };
  } catch {
    return { present: false, name: null, version: null, scripts: 0 };
  }
}

/**
 * Put the boundary to the test: write into the observed tree, and say what happened.
 *
 * Two answers are possible and both are real readings. `refused` is the boundary holding, which is the
 * designed outcome. `breached` is the boundary failing - and the file is removed immediately, because
 * leaving it behind would mean an audit that damaged the tree it was asked to observe, which is worse
 * than the breach itself.
 *
 * The residue is **looked for rather than deduced**. A refusal implies the file is not there, and
 * reporting that implication as though it were a reading would be this program repeating the runtime's
 * claim instead of checking it. So the target is stat'd after the attempt either way, and
 * `left-behind` - a runtime that refused the write and created the file anyway - is treated as a breach,
 * because an audit that leaves artefacts in the tree it is auditing has failed at the one thing it
 * exists for.
 */
async function probeWrite(root) {
  const target = join(root, ".veridian-audit-write-probe");
  let outcome;
  let code = null;

  try {
    await writeFile(target, "an audit must never be able to write this\n", "utf8");
    outcome = "breached";
  } catch (error) {
    outcome = "refused";
    code = String(error instanceof Error && "code" in error ? error.code : "unknown");
  }

  // The measurement, taken the same way whichever branch was taken above.
  let residue = (await kindOf(target)) === "absent" ? "none" : "left-behind";
  if (residue === "left-behind") {
    try {
      await rm(target, { force: true });
      residue = "left-behind-removed";
    } catch {
      residue = "left-behind";
    }
  }

  return { outcome, code, target, residue };
}

/** The sandbox's own half, which is the control that makes the refusal above mean something. */
async function probeSandboxWritable() {
  const target = join(ROOT, "audit-write-proof.txt");
  try {
    await writeFile(target, "the sandbox is the one place this world may write\n", "utf8");
    const back = await readFile(target, "utf8");
    return { outcome: "writable", bytes: Buffer.byteLength(back, "utf8") };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : "unknown";
    return { outcome: "unwritable", code: String(code) };
  }
}

/**
 * Audit every declared root.
 *
 * The write probe runs against the **first** declared root only. It is the reading that matters - *can
 * this run modify the tree it is observing* - and running it against each would multiply the number of
 * files an unfortunate breach could leave behind by the number of roots declared, for no additional
 * information.
 *
 * The reading carries **no timestamp**, on the same reasoning `environment-twin` states: two audits of
 * an unchanged tree should be byte-identical, and a clock reading would make every pair differ for a
 * reason that is not about the workspace. Determinism is a property this contract asserts, so it is the
 * shape in which that assertion can hold.
 */
async function survey() {
  const roots = [];
  for (const observed of OBSERVED) {
    roots.push({
      path: observed,
      kind: await kindOf(observed),
      census: await census(observed),
      head: await headOf(observed),
      manifest: await manifestOf(observed),
    });
  }

  const first = OBSERVED[0];
  const boundary = first === undefined ? null : { root: first, write: await probeWrite(first) };
  return {
    schema: SCHEMA,
    goal: GOAL,
    declared: OBSERVED,
    bound: { maxEntries: MAX_ENTRIES, maxNameChars: MAX_NAME_CHARS },
    roots,
    sandbox: { path: ROOT, kind: await kindOf(ROOT), write: await probeSandboxWritable() },
    boundary,
  };
}

function auditOf(audit) {
  const everyRootDescribed = audit.roots.every((entry) => entry.path !== "" && entry.census.status !== "");
  const write = audit.boundary === null ? null : audit.boundary.write;
  // An audit may not leave a file in the tree it audited, whether the runtime refused the write or not.
  const residueClean = write === null || write.residue === "none";
  const refused = write !== null && write.outcome === "refused";
  const controlHeld = audit.sandbox.write.outcome === "writable";
  const breached = write !== null && (write.outcome === "breached" || !residueClean);

  return {
    everyRootDescribed,
    residueClean,
    controlHeld,
    breached,
    // A refusal only means something if the same program could write somewhere - otherwise "I could not
    // write" and "nothing works" are the same output, which is the defect `environment-twin` was built
    // to keep apart and this contract inherits.
    refusalEarned: refused && controlHeld && residueClean,
  };
}

function render(audit, verdict) {
  say(`${GOAL} ready`);
  say(`surface:declared ${String(audit.declared.length)}`);
  for (const entry of audit.roots) {
    say(`surface:root ${entry.path}`);
    say(`surface:kind ${entry.kind}`);
    say(`surface:entries ${String(entry.census.entries)} of ${String(entry.census.total)}`);
  }
  say(`surface:sandbox kind=${audit.sandbox.kind} write=${audit.sandbox.write.outcome}`);
  say(`boundary:write ${audit.boundary === null ? "not-put-to-the-test" : audit.boundary.write.outcome}`);
  say(`boundary:residue ${audit.boundary === null ? "n/a" : audit.boundary.write.residue}`);
  if (audit.boundary !== null && audit.boundary.write.outcome === "refused") {
    say(`boundary:refusal ${audit.boundary.write.code}`);
  }
  say(`audit:control-held ${verdict.controlHeld ? "yes" : "no"}`);
  say(`audit:refusal-earned ${verdict.refusalEarned ? "yes" : "no"}`);
  say(`audit:every-root-described ${verdict.everyRootDescribed ? "yes" : "no"}`);
  for (const entry of audit.roots) {
    say(`audit:head ${entry.head === null ? "absent" : `${entry.head.kind} ${entry.head.value}`}`);
    say(`audit:manifest ${entry.manifest.present ? `${String(entry.manifest.name)} ${String(entry.manifest.version)} ${String(entry.manifest.scripts)} script(s)` : "absent"}`);
  }
  say(`audit:report written`);
  say(`audit:report-path ${REPORT_FILE.split(/[\\/]/).slice(-3).join("/")}`);
}

async function auditCommand() {
  if (OBSERVED.length === 0) {
    warn(
      `${GOAL}: no observation surface was declared. This contract audits a tree on this machine, and ` +
        "`process.observe` is where the operator names which one - auditing the application directory " +
        "instead would report on the probe rather than on the workspace.",
    );
    return 2;
  }

  const audit = await survey();
  const verdict = auditOf(audit);

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_FILE, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  render(audit, verdict);

  // A breach is a refusal by this program even though the *audit* succeeded, because the run must not
  // report a boundary it did not hold. The report is still written, so a reader can see the evidence.
  return verdict.breached || !verdict.everyRootDescribed ? 4 : 0;
}

/** Audit twice and compare - two independent readings rather than a re-render of one. */
async function compareCommand() {
  if (OBSERVED.length === 0) {
    warn(`${GOAL}: no observation surface was declared, so there is nothing to compare.`);
    return 2;
  }
  const first = await survey();
  const second = await survey();
  const stable = JSON.stringify(first) === JSON.stringify(second);
  say(`${GOAL} ready`);
  say(`audit:stable ${stable ? "yes" : "no"}`);
  return stable ? 0 : 4;
}

/** Read the report back off the disk and check it against a fresh audit of the same tree. */
async function verifyCommand() {
  let onDisk;
  try {
    onDisk = JSON.parse(await readFile(REPORT_FILE, "utf8"));
  } catch (error) {
    warn(
      `verify: the report could not be read from ${REPORT_FILE}: ` +
        `${error instanceof Error ? error.message : "an unknown value"}`,
    );
    return 2;
  }

  const fresh = await survey();
  const recorded = onDisk?.declared;
  if (!Array.isArray(recorded)) {
    warn("verify: the report on disk does not name the surface it audited");
    return 2;
  }
  if (recorded.join(delimiter) !== fresh.declared.join(delimiter)) {
    warn(`verify: the report audited ${recorded.join(", ")} and this run declares ${fresh.declared.join(", ")}`);
    return 4;
  }

  say(`${GOAL} ready`);
  say(`audit:agrees yes (${String(recorded.length)} root(s) re-read from disk)`);
  return 0;
}

/** Withdraw the report, so a verifier can be put to the test against a world that holds nothing. */
async function clearCommand() {
  await rm(REPORT_DIR, { recursive: true, force: true });
  say("audit:report withdrawn");
  return 0;
}

async function daemon() {
  say(`${GOAL} daemon ready (root ${process.env["VERIDIAN_PROCESS_ROOT"] ?? "."})`);
  // Hold the process open without polling or sleeping: an interval keeps the event loop alive so a
  // reading can ask whether this program is *still running*, which no `run` step can answer.
  setInterval(() => {}, 1 << 30);
}

const command = process.argv[2] ?? "";

if (command === "audit") {
  process.exitCode = await auditCommand();
} else if (command === "compare") {
  process.exitCode = await compareCommand();
} else if (command === "verify") {
  process.exitCode = await verifyCommand();
} else if (command === "clear") {
  process.exitCode = await clearCommand();
} else if (command === "daemon") {
  await daemon();
} else {
  warn(`audit-probe: ${command === "" ? "no command was given" : `unknown command ${command}`}`);
  warn("usage: audit-probe <audit|compare|verify|clear|daemon>");
  process.exitCode = 2;
}
