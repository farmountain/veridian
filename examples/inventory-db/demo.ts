#!/usr/bin/env node
/**
 * The database demo, run end to end.
 *
 *   node examples/inventory-db/demo.ts                   the whole thing
 *   node examples/inventory-db/demo.ts --keep-defects    leave the app broken afterwards
 *   node examples/inventory-db/demo.ts --restore-only    put the app back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the three defects from `defects.ts` into the *correct* build script,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any
 *      other client would run, with no privileged channel between this script and the loop,
 *   3. puts the script back the way it was, whatever happened.
 *
 * ## Why this demo exists next to the cart demo
 *
 * The cart demo proves Veridian can judge an application through a browser. This one proves the
 * browser was never the architecture: the same lifecycle, the same verdict rules, the same evidence
 * bundle and the same repair protocol, against a world with no process to keep alive, no socket, no
 * page and no console. If `EnvironmentAdapter` were a web harness wearing an interface, this demo
 * could not be written - and if the core had quietly assumed HTTP anywhere, this is where it would
 * show up as an `INCONCLUSIVE` nobody could explain.
 *
 * It passes no `--browser` flag at all. That is not an omission: this environment document has no
 * `url`, so the resolved world has no browser, and a run that needed one would be a defect in the
 * environment layer rather than something this script should paper over.
 *
 * Step 3 matters more than it looks. The build script is checked in correct; a demo that stopped
 * between inject and repair would leave a broken `build.mjs` behind, and the next reader would have
 * no way to tell a deliberately broken fixture from a mistake. The restore therefore has exactly one
 * owner - `restoreUnlessKept`, called from a `finally` - so it happens even when the run is
 * interrupted, and `tests/inventory-db-demo.test.ts` fails loudly if it ever does not.
 *
 * The database file itself is *not* restored, and does not need to be: the build deletes and recreates
 * it on every start and every reset, so the world is rebuilt from source rather than patched. See
 * `app/build.mjs`.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const buildPath = fileURLToPath(new URL("./app/build.mjs", import.meta.url));
const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/**
 * Put the correct build script back, if any defect is still injected. Idempotent.
 *
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the
 * edit is free to disagree with the one the repair script uses, and in this repository it did: a
 * local copy of the replacement matched nothing because the block had been authored with `\n` and the
 * checkout held the file in CRLF, and the function still reported success. A restore that reports
 * success it did not achieve is the exact failure this project exists to refuse, so the claim is
 * checked before it is made.
 */
async function restore(): Promise<void> {
  const body = await readFile(buildPath, "utf8");
  let text = body;
  for (let done = 0; done < DEFECTS.length; done += 1) {
    const { text: next, repaired } = repairOne(text);
    if (repaired === null) break;
    text = next;
  }
  if (text === body) return;
  await writeFile(buildPath, text, "utf8");

  const stranded = status(text).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    // Loud on purpose, and thrown rather than reported: an unrestored fixture is a broken repo, and a
    // message that a later exit code could paper over is not a fix for that.
    throw new Error(
      `could not restore ${stranded.map((entry) => `${entry.defect.id} (${entry.state})`).join(", ")}: ` +
        "app/build.mjs is not the file this demo was written against, so put it back from git before continuing",
    );
  }
  say("restored the correct build script");
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

  const before = await readFile(buildPath, "utf8");
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: the build script already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { text, injected } = inject(before);
  await writeFile(buildPath, text, "utf8");
  say(`injected ${String(injected.length)} defect(s): ${injected.join(", ") || "(none - already present)"}`);
  say("expected: the first pass fails AC-001..AC-003 and passes AC-004; each repair removes one failure");
  say("the world has no url, so no browser is started: every criterion is a query against the file");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([
    cliPath,
    "validate",
    "--goal",
    goalPath,
    "--repair",
    "node",
    repairPath,
  ]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: build.mjs is left carrying its defects; run again with --restore-only to undo");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
