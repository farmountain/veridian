#!/usr/bin/env node
/**
 * The canonical demo, run end to end.
 *
 *   node examples/shopping-cart/demo.ts                     the whole thing, browser decided automatically
 *   node examples/shopping-cart/demo.ts --browser none      the refusal: no browser can observe nothing,
 *                                                           so every criterion is INCONCLUSIVE
 *   node examples/shopping-cart/demo.ts --keep-defects      leave the app broken afterwards
 *   node examples/shopping-cart/demo.ts --restore-only      put the app back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the three defects from `defects.ts` into the *correct* app,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any
 *      other client would run, with no privileged channel between this script and the loop,
 *   3. puts the app back the way it was, whatever happened.
 *
 * Step 3 matters more than it looks. The app is checked in correct; a demo that stopped between
 * inject and repair would leave a broken `cart.js` behind, and the next reader would have no way to
 * tell a deliberately broken fixture from a mistake. The restore therefore has exactly one owner -
 * `restoreUnlessKept`, called from a `finally` - so it happens even when the run is interrupted, and
 * `tests/shopping-cart-demo.test.ts` fails loudly if it ever does not.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const cartPath = fileURLToPath(new URL("./app/cart.js", import.meta.url));
const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

function flagValue(name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

/**
 * Put the correct app back, if any defect is still injected. Idempotent.
 *
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the
 * edit is free to disagree with the one the repair script uses, and it did: the multi-line defect is
 * authored with `\n` while a Windows checkout holds the file in CRLF, so a local copy of the
 * replacement matched nothing, left D3 injected, and still produced the cheerful line below. A
 * restore that reports success it did not achieve is the exact failure this whole project exists to
 * refuse, so the claim is checked before it is made.
 */
async function restore(): Promise<void> {
  const body = await readFile(cartPath, "utf8");
  let text = body;
  for (let done = 0; done < DEFECTS.length; done += 1) {
    const { text: next, repaired } = repairOne(text);
    if (repaired === null) break;
    text = next;
  }
  if (text === body) return;
  await writeFile(cartPath, text, "utf8");

  const stranded = status(text).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    // Loud on purpose, and thrown rather than reported: an unrestored fixture is a broken repo, and
    // a message that a later exit code could paper over is not a fix for that.
    throw new Error(
      `could not restore ${stranded.map((entry) => `${entry.defect.id} (${entry.state})`).join(", ")}: ` +
        "app/cart.js is not the file this demo was written against, so put it back from git before continuing",
    );
  }
  say("restored the correct app");
}

/**
 * The single owner of "put the app back".
 *
 * `finally` rather than a line at the end of `main`, because the interesting failure is the one
 * where the demo does *not* get to the end: a crash, a Ctrl-C or a killed browser would otherwise
 * leave a deliberately broken `cart.js` behind, and the next reader would have no way to tell it
 * from a real mistake.
 *
 * Deliberately not called when the caller asked to keep the defects: `--keep-defects` exists so a
 * reader can look at the broken app, and `--restore-only` exists to undo that.
 */
async function restoreUnlessKept(): Promise<void> {
  if (argv.includes("--keep-defects") || argv.includes("--restore-only")) return;
  await restore();
}

/**
 * Run the CLI and wait for it.
 *
 * `stdio: "inherit"` rather than a captured pipe on purpose: the loop's own log lines are part of
 * what the demo is showing, and re-printing them afterwards would be this script narrating a run
 * rather than the run narrating itself.
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

  const before = await readFile(cartPath, "utf8");
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: the app already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { text, injected } = inject(before);
  await writeFile(cartPath, text, "utf8");
  say(`injected ${String(injected.length)} defect(s): ${injected.join(", ") || "(none - already present)"}`);

  // The expectation is stated after the browser mode is known, because the two modes can show
  // different things and only one of them can show *this*. Every criterion in the contract is a
  // browser observation, so with no browser there is nothing to read and the run cannot be decisive
  // - which is the loop refusing to call an unobserved run a failure, and refusing harder to call it
  // a pass. Announcing the FAIL -> repair -> PASS progression under `--browser none` was the demo
  // promising something it had already made impossible.
  const browser = flagValue("--browser", "auto");
  if (browser === "none") {
    say("no browser: none of the four criteria can be observed, so this run must end INCONCLUSIVE (exit 2).");
    say("that is the refusal working, not the aha. Drop --browser none, or run `npm run e2e`, to see it.");
  } else {
    say("expected: the first pass fails AC-001..AC-003 and passes AC-004; each repair removes one failure");
  }

  say(`running: veridian validate --goal <demo>/goal.yaml --browser ${browser} --repair node <demo>/repair.ts`);
  const code = await runCli([
    cliPath,
    "validate",
    "--goal",
    goalPath,
    "--browser",
    browser,
    "--repair",
    "node",
    repairPath,
  ]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: the app is left carrying its defects; run again with --restore-only to undo");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
