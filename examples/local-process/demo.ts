#!/usr/bin/env node
/**
 * The process demo, run end to end.
 *
 *   node examples/local-process/demo.ts                   the whole thing
 *   node examples/local-process/demo.ts --keep-defects    leave the program broken afterwards
 *   node examples/local-process/demo.ts --restore-only    put the program back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the four defects from `defects.ts` into the *correct* program,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any
 *      other client would run, with no privileged channel between this script and the loop,
 *   3. puts the program back the way it was, whatever happened.
 *
 * ## Why this demo exists next to the nine that came before it
 *
 * The cart demo judges an application through a page, the database demo through a file it wrote, the
 * API demo through the service's own HTTP interface, and the six simulated worlds through substitutes
 * that stand in for a cluster, a system, a machine, an account, a container runtime and an editor.
 * All ten have the same lifecycle, verdict rules, evidence bundle and repair protocol.
 *
 * What none of them judged until this one is a *process*: the exit code a program returns, the stream
 * a line arrived on, and the byte count of a file it wrote. That gap is worth closing on its own terms
 * rather than as a completeness exercise, because an exit code is the single reading a substitute is
 * most tempted to lie about - a fake runtime can always print "done" and return zero, and a
 * criterion reading that number would be reading the substitute's opinion rather than the program's
 * behaviour. Here the number came from `process.exitCode` on a process this kernel reaped, and the
 * bytes came off the disk. That is the class the six `sim-*` worlds deliberately cannot cover, and it
 * is why this world ships beside `local-web`, `local-db` and `local-api` rather than beside them.
 *
 * ## The browser is refused by the document, not by this script
 *
 * No `--browser` flag is passed, and that is not the mechanism. This environment document has no
 * `url`, so a browser is never inferred, and `environment.yaml` states `browser.enabled: false`
 * anyway - a fact about the plan, which is the only thing the adapter ever sees. The loader refuses
 * the other combination by name, so a world that declared a browser and had nothing to render would
 * fail at definition time rather than after a run.
 *
 * Step 3 matters more than it looks. The program is checked in correct; a demo that stopped between
 * inject and repair would leave a broken `cart-build.mjs` behind, and the next reader would have no
 * way to tell a deliberately broken fixture from a mistake. The restore therefore has exactly one
 * owner - `restoreUnlessKept`, called from a `finally` - so it happens even when the run is
 * interrupted, and `tests/local-process-demo.test.ts` fails loudly if it ever does not.
 *
 * Nothing else is restored, and nothing else needs to be. The sandbox the world writes into is removed
 * and recreated by the adapter on `create()` and again on every reset, so the tree is rebuilt from
 * source rather than patched, and the program holds no state between iterations. See
 * `app/cart-build.mjs`.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const programPath = fileURLToPath(new URL("./app/cart-build.mjs", import.meta.url));
const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/**
 * Put the correct program back, if any defect is still injected. Idempotent.
 *
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the
 * edit is free to disagree with the one the repair script uses, and in this repository it did: a
 * local copy of the replacement matched nothing because the block had been authored with `\n` and the
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
        "app/cart-build.mjs is not the file this demo was written against, so put it back from git before continuing",
    );
  }
  say("restored the correct program");
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
 * than the run narrating itself. It also means the CLI's stderr - where `cli/support.ts` sends every
 * log line on purpose - reaches the reader as it happens.
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
    say(`note: the program already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { text, injected } = inject(before);
  await writeFile(programPath, text, "utf8");
  say(`injected ${String(injected.length)} defect(s): ${injected.join(", ") || "(none - already present)"}`);
  say("expected: the first pass fails six of nine criteria; AC-002, AC-007 and AC-009 pass");
  say("D1 is the release version: one constant the build prints, the verifier quotes and the manifest records, so it reaches AC-003, AC-004 and AC-008");
  say("D1 is repaired first, so the failing count falls by three at once - 6 -> 3 - because those three criteria share the surface it edits");
  say("D2 empties the verifier's stray list, so AC-005 alone fails: one edit, one reading");
  say("D3 is a control: one misspelt word in the daemon banner, read by AC-001 alone");
  say("D4 is a control of a different kind: one success line moved to the error stream, so AC-006 alone fails while the exit code stays 0 and the file is still written");
  say("descending failures: 6 -> 3 -> 2 -> 1 -> 0 over five iterations and four repairs");
  say("no substitute is involved: the exit codes come from processes this kernel reaped");
  say("no browser is involved: the document states browser.enabled false and carries no url");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: cart-build.mjs is left carrying its defects; run again with --restore-only");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
