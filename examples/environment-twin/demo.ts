#!/usr/bin/env node
/**
 * The environment-twin demo, run end to end.
 *
 *   node examples/environment-twin/demo.ts                   the whole thing
 *   node examples/environment-twin/demo.ts --keep-defects    leave the probe broken afterwards
 *   node examples/environment-twin/demo.ts --restore-only    put the probe back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the three defects from `defects.ts` into the *correct* probe,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any
 *      other client would run, with no privileged channel between this script and the loop,
 *   3. puts the probe back the way it was, whatever happened.
 *
 * ## Why this demo exists
 *
 * Every other demo in this repository judges something the run *deployed*: a page, a row, a file, a
 * record held by a substitute. This one judges the **ground the run stands on** - and it exists
 * because that question had no answer here beyond a README. *How does Veridian know the reality of
 * the environment?* asked of any other world produces a shrug and a version table. Asked of this one
 * it produces a document, because the answer is a measurement.
 *
 * The principle was already in the tree for exactly one capability. `core/environment/isolation.ts`
 * measures the container substrate rather than declaring it, on the grounds that *"a constant saying
 * 'a container runtime is installed' would be a claim beside the code, free to disagree with the
 * machine the code is running on"*. This goal is that discipline applied to the whole surface and
 * expressed as a contract, so that a reader can run it and a criterion can judge it.
 *
 * ## What this demo is actually showing, and it is not the numbers
 *
 * The numbers are mundane - eight capabilities, most of them available. What the demo shows is that
 * **an instrument can be wrong and pass everything**, which is a failure mode no application demo in
 * this repository can reach. All three defects here are defects in the probe rather than in an
 * application, and the first is the one to watch: D1 empties a single evidence field, the report
 * still names all eight capabilities, still exits zero, and is still not evidence of anything. A
 * reader who trusted the report would have been told eight facts about a machine, one of which was
 * asserted rather than measured.
 *
 * That is the whole argument for the third status. A capability report with `available` and `absent`
 * and nothing else cannot be trusted, because **absence is the one answer every broken instrument
 * returns** - and a probe that only attempts the refused half cannot tell "the boundary holds" from
 * "every write fails". So the contract requires a control that must be live, evidence on every
 * capability, and both halves of every two-stage probe - and D1, D2 and D3 are each an attack on one
 * of those three defences.
 *
 * ## Two readings from the machine this was written on
 *
 * The demo prints the twin's facts, so a reader sees the real values rather than a recited list. Two
 * of them are worth naming, and the second comes with a warning.
 *
 *   `runtime.allow-net`  absent, quoting `bad option: --allow-net=127.0.0.1` at exit 9 - which
 *                        independently reproduces `docs/ISOLATION-AND-MCP-PLAN.md` section 3.1
 *   `container.runtime`  available, quoting `podman version 5.7.1`
 *
 * The second was written up here as a *correction* - the claim that the isolation document recorded
 * the substrate as absent because `docker` was not on `PATH`, generalising one command's absence into
 * a claim about the machine. **That write-up was false, and the document refuted it.** Its section 3.1
 * already carries the corrected note - *"docker is indeed absent; podman 5.7.1 is installed ... podman
 * machine start succeeded and a real container ran"* - and the reason the original sentence was wrong,
 * which was that it measured `docker` and never measured `podman`. So this demo reproduces that
 * record rather than repairing it, from a different direction with a different instrument.
 *
 * The near-miss belongs in the file that made it: **a plausible-looking defect in a document has to be
 * checked against the document before it is written up.** A correction carries more authority than the
 * claim it replaces and will not be re-checked by the next reader, so the cost of a wrong one is
 * higher than the cost of the original error.
 *
 * ## The browser is refused by the document, not by this script
 *
 * No `--browser` flag is passed, and that is not the mechanism. This environment document has no
 * `url`, so a browser is never inferred. The loader refuses the other combination by name.
 *
 * Step 3 matters more than it looks. The probe is checked in correct; a demo that stopped between
 * inject and repair would leave a broken probe behind, and the next reader would have no way to tell
 * a deliberately broken fixture from a mistake. The restore therefore has exactly one owner -
 * `restoreUnlessKept`, called from a `finally` - so it happens even when the run is interrupted.
 *
 * Nothing else is restored, and nothing else needs to be. The sandbox the world writes into is removed
 * and recreated by the adapter on `create()` and again on every reset, so the tree is rebuilt from
 * source rather than patched, and the probe holds no state between iterations.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const programPath = fileURLToPath(new URL("./app/capability-probe.mjs", import.meta.url));
const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/**
 * Put the correct probe back, if any defect is still injected. Idempotent.
 *
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the
 * edit is free to disagree with the one the repair script uses, and in this repository it did: a local
 * copy of the replacement matched nothing because the block had been authored with `\n` and the
 * checkout held the file in CRLF, and the function still reported success. A restore that reports
 * success it did not achieve is the exact failure this project exists to refuse, so the claim is
 * checked before it is made.
 */
async function restore(): Promise<void> {
  const body = await readFile(programPath, "utf8");
  let text = body;
  for (let done = 0; done < DEFECTS.length; done += 1) {
    const { text: next, repaired } = repairOne(text);
    if (repaired === null) break;
    text = next;
  }
  if (text === body) return;
  await writeFile(programPath, text, "utf8");

  const stranded = status(text).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    // Loud on purpose, and thrown rather than reported: an unrestored fixture is a broken repo, and a
    // message that a later exit code could paper over is not a fix for that.
    throw new Error(
      `could not restore ${stranded.map((entry) => `${entry.defect.id} (${entry.state})`).join(", ")}: ` +
        "app/capability-probe.mjs is not the file this demo was written against, so put it back from git before continuing",
    );
  }
  say("restored the correct probe");
}

/** The single owner of "put the app back", so an interrupted run cannot leave it broken. */
async function restoreUnlessKept(): Promise<void> {
  if (argv.includes("--keep-defects") || argv.includes("--restore-only")) return;
  await restore();
}

/**
 * Run the CLI and wait for it.
 *
 * `stdio: "inherit"` rather than a captured pipe on purpose: the loop's own log lines are part of what
 * the demo is showing, and re-printing them afterwards would be this script narrating a run rather
 * than the run narrating itself.
 */
function runCli(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args], { cwd: repoRoot, stdio: "inherit" });
    child.on("close", (code, signal) => {
      if (signal !== null) say(`the run was stopped by ${signal}`);
      resolve(code ?? 1);
    });
    child.on("error", (error: Error) => {
      say(`could not start the CLI: ${error.message}`);
      resolve(1);
    });
  });
}

async function main(): Promise<number> {
  if (argv.includes("--restore-only")) {
    await restore();
    return 0;
  }

  const before = await readFile(programPath, "utf8");
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: the probe already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { text, injected } = inject(before);
  await writeFile(programPath, text, "utf8");
  say(`injected ${String(injected.length)} defect(s): ${injected.join(", ") || "(none - already present)"}`);
  say("expected: the first pass fails four of nine criteria; five pass and the world is valid");
  say("every defect here is a defect in the INSTRUMENT, not in an application - and an instrument");
  say("that is wrong passes every other check there is, which is the failure mode this goal exists for");
  say("D1 empties one capability's evidence: the report still names eight capabilities and still answers, so AC-008 fails -");
  say("   and because survey derives its exit code from its own audit, AC-002 fails beside it. One edit, two readings");
  say("D2 stops measuring one capability: the count falls to seven, so AC-003 alone fails");
  say("D3 drops the refused half of the permission probe, so the enforcement verdict is unearned: AC-009 alone fails");
  say("descending failures: 4 -> 2 -> 1 -> 0 over four iterations and three repairs");
  say("the reach table is read off a run, not reasoned from each defect's name - the first draft claimed 3 -> 2 -> 1 -> 0");
  say("no substitute is involved: every reading is an exit code from a process this kernel reaped");
  say("no browser is involved: the document carries no url, so a browser is never inferred");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: capability-probe.mjs is left carrying its defects; run again with --restore-only");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
