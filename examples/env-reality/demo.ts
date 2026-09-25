#!/usr/bin/env node
/**
 * The env-reality demo, run end to end.
 *
 *   node examples/env-reality/demo.ts                   the whole thing
 *   node examples/env-reality/demo.ts --keep-defects    leave the probe broken afterwards
 *   node examples/env-reality/demo.ts --restore-only    put the probe back and exit
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
 * It answers a question about the *bundle* rather than about the program: **when a run's evidence says
 * `env`, what did the application it judged actually have?**
 *
 * Every world before this one answered a narrower question and read as though it had answered this one.
 * `environment.json` carries `env`, which is the world's **declaration** - here, two names - and a reader
 * who finds two names concludes the application could reach two. Measured through this repository's own
 * CLI, before the seam, an application under a two-name declaration could reach **84 names, 5 of them
 * credential-shaped, all 5 populated**, and one planted in the invoking shell whose reachability the
 * contract's own criterion confirmed.
 *
 * ## The thing to actually watch, and it is not the exit code
 *
 * The world now crawls the exact map it hands the child, and reports it. The program crawls its own
 * environment and prints the result. A document the program wrote is read back by the world's file
 * reader. **Three instruments, one fact, and the contract refuses any of them alone** - because the
 * defect this seam is most prone to is a crawl built from a map that never reached `spawn`, which passes
 * every world-side criterion and fails exactly the program-side ones.
 *
 * And the criterion that carries the example is a **zero**. `inherited-credential equals "0"` where the
 * same measurement read `5` before. What stops that zero from being free is the criterion beside it:
 * `visible` matching `^[1-9][0-9]*$`. A crawl that examined nothing reports zero credentials and zero undeclared
 * credentials - a perfect score, produced by nobody having looked - and the property that separates that
 * from a real measurement is that a child which started at all sees the operating system's floor. **An
 * absent measurement must not read as a clean one**, and this demo is the cheapest place in the
 * repository to see how far that one rule reaches.
 *
 * ## What is deliberately not asserted about this machine
 *
 * No criterion pins how many names the child saw, because a `declared` environment still carries the
 * operating system's floor and that count is a property of the platform and the login rather than of the
 * code. No criterion names a credential the operator's shell holds, and no artifact the run writes
 * contains a value - the whole point of the seam is that those names never leave. What is asserted is
 * the **shape of the boundary**: the mode the document declared, the names it declared, that nothing it
 * did not declare is credential-shaped and in reach, and that two further instruments agree. Those hold
 * on this checkout, on a fork of it, and on a machine with nothing installed but Node.
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
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const programPath = fileURLToPath(new URL("./app/env-probe.mjs", import.meta.url));
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
        "app/env-probe.mjs is not the file this demo was written against, so put it back from git before continuing",
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
  say("expected: the first pass fails three of seven criteria; four pass and the world is valid");
  say("this world declares `process.environment: declared`, so the child gets two names and the");
  say("   operating system's floor rather than the shell this demo was launched from");
  say("AC-002..AC-004 judge the WORLD's crawl of the map it handed over. No defect here can reach them:");
  say("   that map was built before the program existed, which is what makes them a property of the world");
  say("AC-004 is the example's claim - zero undeclared credential-shaped names, where the same reading was 5");
  say("AC-002's `visible` pattern is what stops that zero being free: a census of nothing reports zero too");
  say("D1 stops reading the environment, so the census describes an empty world - a PERFECT one, by count:");
  say("   no credential, no undeclared credential, no contradiction. AC-005 and AC-007 fail");
  say("D2 states the declared channel's presence instead of looking it up: AC-006 fails, and AC-007 beside it");
  say("   because the document it reads back is the census");
  say("D3 writes the reading before taking it, so the document describes a world nobody measured: stdout is");
  say("   untouched, so AC-007 alone fails. Single reach, and the table's control");
  say("note on how D3 was arrived at: the first draft omitted the write, which produced INCONCLUSIVE rather");
  say("   than FAIL - and the loop refuses to repair INCONCLUSIVE, correctly, because an absent artifact is a");
  say("   statement about the world rather than about the application. See defects.ts");
  say("descending failures: 3 -> 2 -> 1 -> 0 over four iterations and three repairs");
  say("the reach table is stated in defects.ts before the run, so the run can contradict it");
  say("no value is ever read or written: the crawl records names and counts, and its type has nowhere to");
  say("   put a value - asserted by a control that plants a secret and fails if it appears anywhere");
  say("no substitute is involved: every reading is a real child's real environment");
  say("no browser is involved: the document carries no url, so a browser is never inferred");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: env-probe.mjs is left carrying its defects; run again with --restore-only");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
