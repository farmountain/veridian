#!/usr/bin/env node
/**
 * capability-probe - the application the `environment-twin` contract starts and judges.
 *
 * ## The question this program exists to answer
 *
 * *How does Veridian know the reality of the environment?* Not by reading a manifest, not by
 * consulting a version table, and not by trusting a constant that says a tool is installed. It knows
 * by **doing the thing and reading what happened**, on the machine the run is actually executing on,
 * with the same instruments the rest of this repository uses: an exit code from a process this kernel
 * reaped, bytes on this disk, and a rendering a criterion compares.
 *
 * That principle is not new here. `core/environment/isolation.ts` states it for one capability -
 * *"a constant saying 'a container runtime is installed' would be a claim beside the code, free to
 * disagree with the machine the code is running on"* - and then measures the container substrate with
 * a two-stage probe. This program is that same discipline applied to the **whole** capability surface
 * of the environment rather than to its isolation substrate alone.
 *
 * ## The three statuses, and why two would be a lie
 *
 * A capability report with two statuses - present or absent - cannot be trusted, because **absence is
 * the one answer every broken instrument returns.** A probe that only attempts the refused half cannot
 * tell "the substrate works" from "every write fails". So every capability here carries one of three
 * readings, and the third is the one that makes the other two mean something:
 *
 *   available          the capability was exercised and succeeded
 *   absent             the capability was exercised, the instrument was proven live first, and it
 *                      did not succeed
 *   instrument-broken  the permitted half failed, so **nothing can be concluded** from the rest - an
 *                      absence verdict is void rather than reported
 *
 * `instrument-broken` is deliberately not a failure of the machine. It is a failure of *this program
 * to observe* the machine, and reporting it as `absent` would accuse the environment of a defect the
 * probe caused. That is the same distinction `local-process` draws between exit 2 ("I could not carry
 * this out") and exit 4 ("I read it and it is wrong").
 *
 * ## The known-present control
 *
 * Every absence verdict is read against a control that must be `available` in the same run: this
 * process knows its own runtime version. If the control is itself absent, the whole report is void and
 * the audit line says so - because a run in which *everything* looks unavailable has almost certainly
 * measured its own instrument rather than the machine.
 *
 * ## What this program may not do
 *
 * It may not read stdin - the adapter spawns every child with `stdio: ["ignore", "pipe", "pipe"]`, so
 * a prompt receives immediate EOF rather than a person. Every argument arrives in `argv` and every
 * answer leaves through an exit code.
 *
 * ## Paths
 *
 * Every path resolves against `VERIDIAN_PROCESS_ROOT`, the sandbox the world created and deletes. The
 * twin is written *inside* it, so the file a criterion reads is one this world can withdraw - which is
 * what makes "the twin exists" a claim about the run rather than about the developer's disk.
 *
 * ## Exit codes
 *
 *   0   the command did what was asked
 *   2   the command line was unusable, or there was no twin to read
 *   4   the twin on disk disagrees with a fresh survey of the same machine
 *
 * `4` rather than `1` on purpose: `1` is what an uncaught exception produces, and a criterion that
 * could not tell "the twin is stale" from "the program fell over" would report the second as the
 * first.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";

const ROOT = process.env["VERIDIAN_PROCESS_ROOT"] ?? ".";
const TWIN_DIR = join(ROOT, "twin");
const TWIN_FILE = join(TWIN_DIR, "capabilities.json");
const SCHEMA = "veridian.capability-twin/1";
const GOAL = "environment-twin";

/** The closed status vocabulary. Two members would be the defect this file opens by refusing. */
const AVAILABLE = "available";
const ABSENT = "absent";
const BROKEN = "instrument-broken";

function say(line) {
  process.stdout.write(`${line}\n`);
}

function warn(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Start a child and read what actually happened, with the failure modes kept apart.
 *
 * `r.error` is the case where no process was created at all (most often `ENOENT`), and it is a
 * *different fact* from a process that ran and exited non-zero. Folding them into one "not available"
 * would make "the tool is not installed" indistinguishable from "the tool is installed and refused",
 * so both are recorded verbatim and the evidence says which one happened.
 */
function runChild(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });

  if (result.error !== undefined && result.error !== null) {
    const code = typeof result.error.code === "string" ? result.error.code : "unknown";
    return { ok: false, evidence: `no process was created (${code})` };
  }

  const stream = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  const first = stream.split(/\r?\n/)[0] ?? "";
  const tail = first === "" ? "" : `; first line: ${first}`;

  return result.status === 0
    ? { ok: true, evidence: `exit 0${tail}` }
    : { ok: false, evidence: `exit ${String(result.status)}${tail}` };
}

/**
 * The known-present control, read first and read always.
 *
 * If this fails, every other reading in the report is uninterpretable and the program must not
 * pretend otherwise - so it is measured before anything else and the audit line is derived from it.
 */
function control() {
  const version = process.version;
  const shapeOfVersion = /^v\d+\.\d+\.\d+/;
  return typeof version === "string" && shapeOfVersion.test(version)
    ? { status: AVAILABLE, evidence: `process.version = ${version}` }
    : { status: ABSENT, evidence: `process.version was ${JSON.stringify(version)}` };
}

/**
 * A capability whose measurement is a permitted half and a refused half.
 *
 * The permitted half is read **first** and gates the refused half. That ordering is the whole point:
 * a probe that went straight to the refusal could not distinguish "the boundary holds" from "nothing
 * works at all", and a substrate that refuses everything would pass it while being useless.
 */
function twoStage({ permitted, refused }) {
  const first = permitted();
  if (!first.ok) {
    return {
      status: BROKEN,
      evidence: `the permitted half did not succeed, so nothing can be concluded from the refused half - ${first.evidence}`,
    };
  }

  const second = refused();
  return second.refused
    ? { status: AVAILABLE, evidence: `permitted half ${first.evidence}; refused half ${second.evidence}` }
    : { status: ABSENT, evidence: `permitted half ${first.evidence}; refused half ${second.evidence}` };
}

/** Whether a runtime accepts an argument vector at all. Used as the control for the pair below. */
function acceptsRuntimeArgs(args) {
  return runChild(process.execPath, args);
}

/**
 * Measure every capability. Nothing here reads a version table, a manifest or an environment
 * variable to decide what the machine can do - each entry is the result of attempting it.
 */
async function survey() {
  const facts = {
    platform: platform(),
    architecture: arch(),
    release: release(),
    cores: cpus().length,
    runtime: process.version,
  };

  const capabilities = [];

  // The runtime can start a child process at all. Everything downstream of this depends on it, which
  // is why it is the first measurement rather than an assumption made by the ones after it.
  //
  // The status is spelled out rather than spread from `runChild`'s return. That function answers a
  // *boolean* question and so carries `ok`, not `status` - and spreading it produced a capability
  // whose status rendered as `undefined`, which is the one value a reader cannot tell from a bug in
  // the renderer. Found by running the probe, not by reading it.
  const exec = runChild(process.execPath, ["-e", "process.exit(0)"]);
  capabilities.push({
    name: "process.exec",
    status: exec.ok ? AVAILABLE : ABSENT,
    evidence: exec.evidence,
    control: control().status,
  });

  // The runtime can capture what a child printed - a strictly stronger claim than starting one.
  const capture = runChild(process.execPath, ["-e", "process.stdout.write('capability-probe')"]);
  capabilities.push({
    name: "process.capture",
    status: capture.ok ? AVAILABLE : ABSENT,
    evidence: capture.evidence,
    control: control().status,
  });

  // The sandbox can be written to and read back, and the two halves are compared rather than assumed
  // to agree - a write that silently landed elsewhere would pass a write-only probe.
  const written = join(ROOT, "capability-probe-proof.txt");
  const proof = `capability-probe wrote this at ${String(facts.cores)} core(s)`;
  let writeStatus = ABSENT;
  let writeEvidence = "the write was not attempted";
  let readStatus = ABSENT;
  let readEvidence = "nothing was written to read";
  try {
    await writeFile(written, proof, "utf8");
    writeStatus = AVAILABLE;
    writeEvidence = `wrote ${String(Buffer.byteLength(proof, "utf8"))} byte(s) into the sandbox`;
    const back = await readFile(written, "utf8");
    if (back === proof) {
      readStatus = AVAILABLE;
      readEvidence = `read back ${String(Buffer.byteLength(back, "utf8"))} byte(s), identical to what was written`;
    } else {
      readEvidence = `read back ${String(back.length)} character(s), which differ from what was written`;
    }
  } catch (error) {
    writeEvidence = `the write threw: ${error instanceof Error ? error.message : "an unknown value"}`;
  }
  capabilities.push({
    name: "fs.write",
    status: writeStatus,
    evidence: writeEvidence,
    control: control().status,
  });
  capabilities.push({ name: "fs.read", status: readStatus, evidence: readEvidence, control: control().status });

  // Does this runtime confine a child's filesystem calls, and does it enforce it? The permitted half
  // writes where it is allowed and must succeed; the refused half writes outside the allowance and
  // must be refused. Either half giving the wrong answer means the mechanism is not there.
  const allowedWrite = `require('node:fs').writeFileSync(${JSON.stringify(written)}, 'allowed')`;
  const refusedWrite = `require('node:fs').writeFileSync(${JSON.stringify(join(ROOT, "..", "escaped.txt"))}, 'refused')`;
  const allowance = [`--allow-fs-read=${ROOT}`, `--allow-fs-write=${ROOT}`];
  capabilities.push({
    name: "runtime.permission",
    ...twoStage({
      permitted: () => acceptsRuntimeArgs(["--permission", ...allowance, "-e", allowedWrite]),
      refused: () => {
        const attempt = acceptsRuntimeArgs(["--permission", ...allowance, "-e", refusedWrite]);
        return {
          refused: !attempt.ok,
          evidence: attempt.evidence,
        };
      },
    }),
    control: control().status,
  });

  // Does the runtime accept a network allowance at all? The control is that the same runtime accepts
  // `--permission` without it - so a rejection is a fact about the argument rather than about the
  // binary being unable to run with a permission model.
  const permissionAccepted = acceptsRuntimeArgs(["--permission", "-e", "process.exit(0)"]);
  const netAccepted = acceptsRuntimeArgs(["--permission", "--allow-net=127.0.0.1", "-e", "process.exit(0)"]);
  capabilities.push({
    name: "runtime.allow-net",
    status: permissionAccepted.ok ? (netAccepted.ok ? AVAILABLE : ABSENT) : BROKEN,
    evidence: permissionAccepted.ok
      ? `--permission without the allowance ${permissionAccepted.evidence}; with --allow-net=127.0.0.1 ${netAccepted.evidence}`
      : `--permission itself did not run, so the network allowance cannot be judged - ${permissionAccepted.evidence}`,
    control: control().status,
  });

  // The two tools a run of this repository reaches for. Absent here is a fact about the machine and
  // is recorded with the code that said so, never inferred from a directory listing.
  const git = runChild("git", ["--version"]);
  capabilities.push({
    name: "tool.git",
    status: git.ok ? AVAILABLE : ABSENT,
    evidence: git.evidence,
    control: control().status,
  });

  const docker = runChild("docker", ["--version"]);
  const podman = docker.ok ? { ok: false, evidence: "docker answered, so podman was not asked" } : runChild("podman", ["--version"]);
  const container = docker.ok ? docker : podman;
  capabilities.push({
    name: "container.runtime",
    status: container.ok ? AVAILABLE : ABSENT,
    evidence: container.evidence,
    control: control().status,
  });

  return { facts, capabilities, control: control() };
}

/**
 * The twin document. Deliberately **free of any timestamp**: two surveys of an unchanged machine
 * should produce byte-identical output, and a clock reading in the document would make every pair of
 * surveys differ for a reason that is not about the environment. Determinism is a property the
 * contract asserts, so the document is written in the only shape in which that assertion can hold.
 */
function twinOf(reading) {
  return {
    schema: SCHEMA,
    goal: GOAL,
    control: reading.control,
    facts: reading.facts,
    capabilities: reading.capabilities,
  };
}

function auditOf(reading) {
  const everyCapabilityHasEvidence = reading.capabilities.every(
    (capability) => typeof capability.evidence === "string" && capability.evidence.trim() !== "",
  );

  // The rule this whole file exists for: an absence is only a reading about the machine if the
  // instrument was shown to be live in the same run. If the control is down, or any capability is
  // missing its evidence, absence is not distinguishable from a broken probe.
  const absenceIsDistinguishable = reading.control.status === AVAILABLE && everyCapabilityHasEvidence;

  return {
    everyCapabilityHasEvidence,
    absenceIsDistinguishable,
    control: reading.control.status,
  };
}

function render(reading, audit) {
  say(`# control status=${audit.control}`);
  for (const capability of reading.capabilities) {
    say(`capability:${capability.name} status=${capability.status}`);
  }
  say(`capability:count ${String(reading.capabilities.length)}`);
  say(`audit every-capability-has-evidence ${audit.everyCapabilityHasEvidence ? "yes" : "no"}`);
  say(`audit absence-is-distinguishable ${audit.absenceIsDistinguishable ? "yes" : "no"}`);
  say(`audit control-available ${audit.control === AVAILABLE ? "yes" : "no"}`);
}

async function surveyCommand() {
  const reading = await survey();
  const audit = auditOf(reading);
  const twin = twinOf(reading);

  await mkdir(TWIN_DIR, { recursive: true });
  await writeFile(TWIN_FILE, `${JSON.stringify(twin, null, 2)}\n`, "utf8");

  say(`${GOAL} ready`);
  render(reading, audit);
  say("capability-twin written");
  say(`facts platform=${reading.facts.platform} arch=${reading.facts.architecture} runtime=${reading.facts.runtime}`);

  return audit.absenceIsDistinguishable ? 0 : 4;
}

/**
 * Survey twice and compare. This is the determinism reading, and it is two independent measurements
 * of the same machine rather than a re-render of one - a second reading that came from the first
 * would agree with it by construction and measure nothing.
 */
async function compareCommand() {
  const first = twinOf(await survey());
  const second = twinOf(await survey());
  const stable = JSON.stringify(first) === JSON.stringify(second);
  say(`${GOAL} ready`);
  say(`capability-twin stable ${stable ? "yes" : "no"}`);
  return stable ? 0 : 4;
}

/**
 * Read the twin off the disk and check it against a fresh survey of this machine.
 *
 * The twin is read from the **file**, not from memory, because the claim being checked is that the
 * document a reader would open still describes the machine - and a verifier that compared its own
 * in-memory copy would agree with itself while the file on disk said something else.
 */
async function verifyCommand() {
  let onDisk;
  try {
    onDisk = JSON.parse(await readFile(TWIN_FILE, "utf8"));
  } catch (error) {
    warn(`verify: the twin could not be read from ${TWIN_FILE}: ${error instanceof Error ? error.message : "an unknown value"}`);
    return 2;
  }

  const fresh = twinOf(await survey());
  const recorded = onDisk?.capabilities;

  if (!Array.isArray(recorded)) {
    warn("verify: the twin on disk carries no capability list");
    return 2;
  }

  const recordedNames = recorded.map((entry) => entry.name).join(",");
  const freshNames = fresh.capabilities.map((entry) => entry.name).join(",");

  if (recordedNames !== freshNames) {
    warn(`verify: the twin names ${recordedNames} and this machine now reports ${freshNames}`);
    return 4;
  }

  // The statuses of the two tool probes and the two runtime probes are machine facts and may move
  // between runs for honest reasons; the control and the four sandbox capabilities may not. So the
  // disagreement check is scoped to the members that are stable by construction, and the scoping is
  // stated here rather than left for a reader to infer from a green tick.
  const stable = ["process.exec", "process.capture", "fs.write", "fs.read"];
  for (const name of stable) {
    const before = recorded.find((entry) => entry.name === name)?.status;
    const after = fresh.capabilities.find((entry) => entry.name === name)?.status;
    if (before !== after) {
      warn(`verify: ${name} was recorded ${String(before)} and now reads ${String(after)}`);
      return 4;
    }
  }

  say(`capability-twin agrees yes (${String(recorded.length)} capability(s) re-read from ${TWIN_FILE})`);
  return 0;
}

/**
 * Withdraw the twin, so a verifier can be put to the test against a world that holds nothing.
 *
 * This command exists because of a defect the first run of this contract found, and the defect is
 * worth stating where the repair lives. `verify` with no twin is the interesting case for a verifier -
 * it is the one where a program is most tempted to pretend - and the criterion for it was written
 * assuming it would run before anything had surveyed the machine. It did not: a criterion earlier in
 * the same contract had already run `survey`, so the twin was on disk, `verify` correctly exited 0,
 * and the criterion failed against a **correct** program.
 *
 * The `local-process` contract has the same shape and does not suffer from it, but only by accident:
 * its first criterion runs no commands at all, so nothing has built a release by the time its
 * "verify with no release" criterion runs. That is an ordering dependency that reads as a fact about
 * the program, and **a criterion whose meaning depends on where it sits in a list is a criterion that
 * changes meaning when the list is reordered.** Giving the probe a way to withdraw its own twin makes
 * the criterion self-sufficient: it establishes the state it judges rather than inheriting it.
 */
async function clearCommand() {
  await rm(TWIN_DIR, { recursive: true, force: true });
  say("capability-twin cleared");
  return 0;
}

async function daemon() {
  say(`${GOAL} daemon ready (root ${process.env["VERIDIAN_PROCESS_ROOT"] ?? "."})`);
  // Hold the process open without polling or sleeping: an interval keeps the event loop alive so a
  // reading can ask whether this program is *still running*, which no `run` step can answer.
  setInterval(() => {}, 1 << 30);
}

const command = process.argv[2] ?? "";

if (command === "survey") {
  process.exitCode = await surveyCommand();
} else if (command === "compare") {
  process.exitCode = await compareCommand();
} else if (command === "verify") {
  process.exitCode = await verifyCommand();
} else if (command === "clear") {
  process.exitCode = await clearCommand();
} else if (command === "daemon") {
  await daemon();
} else {
  warn(`capability-probe: ${command === "" ? "no command was given" : `unknown command ${command}`}`);
  warn("usage: capability-probe <survey|compare|verify|clear|daemon>");
  process.exitCode = 2;
}
