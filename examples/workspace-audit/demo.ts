#!/usr/bin/env node
/**
 * The workspace-audit demo, run end to end.
 *
 *   node examples/workspace-audit/demo.ts                   the whole thing
 *   node examples/workspace-audit/demo.ts --keep-defects    leave the probe broken afterwards
 *   node examples/workspace-audit/demo.ts --restore-only    put the probe back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the three defects from `defects.ts` into the *correct* probe,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any other
 *      client would run, with no privileged channel between this script and the loop,
 *   3. puts the probe back the way it was, whatever happened.
 *
 * ## Why this demo exists
 *
 * It answers the operator's own question rather than the repository's: *what is the reality of the tree
 * I am actually working in?* `environment-twin`, beside it, measures the **machine** - is a container
 * runtime installed, does this runtime accept a network allowance - and it measures all of that inside
 * a sandbox, so its subject is the ground the run stands on. This one's subject is the checkout: which
 * branch `HEAD` points at, what the manifest declares, what is really at the top level.
 *
 * It needed a seam the world did not have. `local-process`'s read surface was a fixed pair - the
 * application directory and the sandbox - and its own documentation said why: a path leaving the root is
 * refused rather than resolved, because opening the developer's own filesystem while calling it the
 * sandbox's is the one thing that world must not do. Pointing `root` at the workspace is not the answer,
 * because `root` is emptied on every reset and a world rooted at the checkout would delete the code
 * under test on its first iteration. So `process.observe` was added: a **declared** read surface, where
 * the operator writes down what may be looked at and the confinement enforces exactly that list.
 *
 * ## The thing to actually watch, and it is not the report
 *
 * The report is ordinary - a branch name, a version, a file count. What this demo shows is that the
 * **read-only guarantee is held by the runtime rather than by a promise in a comment**. The probe reads
 * the tree, then tries to write into it, and the interpreter refuses with `ERR_ACCESS_DENIED` while the
 * process stays alive and its exit code stays its own. The contract judges that refusal - and it judges
 * it *beside* a successful write into the sandbox, because **"I could not write" is the answer every
 * broken instrument returns**, and a probe that could not write anywhere would report the safest-
 * looking line in the report while having measured nothing at all.
 *
 * That pairing is the discipline this repository has already paid for twice, and the third defect is the
 * same rule applied to a document rather than to a capability: a verify that cannot find the report it
 * should compare against must refuse, because a verify that measures the tree anyway and agrees with
 * itself is a **PASS over an absent document**.
 *
 * ## What is deliberately not asserted about this workspace
 *
 * No criterion pins the branch this checkout is on, its version, or its file count. Asserting those
 * would make the contract a claim about the tree it was written in, and it would fail on a fork for a
 * reason that is not about the code. What is asserted is the *shape of the measurement* - the declared
 * surface is the surface audited, the refusal arrived with its control beside it, a reading that was not
 * there is reported absent rather than inferred, and two readings agree. So this demo produces a
 * different report on a different checkout, and the same verdict.
 *
 * ## The browser is refused by the document, not by this script
 *
 * No `--browser` flag is passed, and that is not the mechanism. This environment document has no `url`,
 * so a browser is never inferred.
 *
 * Step 3 matters more than it looks. The probe is checked in correct; a demo that stopped between inject
 * and repair would leave a broken probe behind, and the next reader would have no way to tell a
 * deliberately broken fixture from a mistake. The restore therefore has exactly one owner -
 * `restoreUnlessKept`, called from a `finally` - so it happens even when the run is interrupted.
 *
 * **Nothing outside the sandbox is written, and that is enforced rather than intended.** The audit's
 * only write is into the world's own root; the one deliberate attempt outside it is refused by the
 * runtime and its residue is stat'd and reported. So a demo that is killed halfway leaves the checkout
 * exactly as it found it - and the probe's own report says so, because it checks rather than assumes.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const programPath = fileURLToPath(new URL("./app/audit-probe.mjs", import.meta.url));
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
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the edit
 * is free to disagree with the one the repair script uses, and in this repository it did: a local copy
 * of the replacement matched nothing because the block had been authored with `\n` and the checkout
 * held the file in CRLF, and the function still reported success. A restore that reports success it did
 * not achieve is the exact failure this project exists to refuse, so the claim is checked before it is
 * made.
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
        "app/audit-probe.mjs is not the file this demo was written against, so put it back from git before continuing",
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
 * the demo is showing, and re-printing them afterwards would be this script narrating a run rather than
 * the run narrating itself.
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
  say("the world now reads a REAL tree - this checkout - through process.observe, and the report says");
  say("   which branch HEAD names, what the manifest declares and what is at the top level. None of those");
  say("   values is asserted by a criterion: they belong to this checkout and would fail on a fork");
  say("D1 skips the write probe, so the report states a read-only guarantee it never measured - and because the");
  say("   program derives refusal-earned from that outcome, AC-004 fails beside AC-003. One edit, two criteria");
  say("D2 takes no census, so the audit describes a tree it did not look at: AC-002 alone fails");
  say("D3 lets a verify with no report measure the tree and call that the baseline - a PASS over an absent");
  say("   document - so AC-008 alone fails");
  say("descending failures: 4 -> 2 -> 1 -> 0 over four iterations and three repairs");
  say("the reach table is stated in defects.ts before the run, so the run can contradict it");
  say("the read-only boundary is enforced by the runtime: the audit really attempts a write into this");
  say("   checkout, the interpreter refuses it, and the residue is stat'd rather than assumed");
  say("no substitute is involved: every reading is an exit code from a process this kernel reaped");
  say("no browser is involved: the document carries no url, so a browser is never inferred");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: audit-probe.mjs is left carrying its defects; run again with --restore-only");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
