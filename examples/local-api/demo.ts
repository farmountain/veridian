#!/usr/bin/env node
/**
 * The API demo, run end to end.
 *
 *   node examples/local-api/demo.ts                   the whole thing
 *   node examples/local-api/demo.ts --keep-defects    leave the service broken afterwards
 *   node examples/local-api/demo.ts --restore-only    put the service back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the four defects from `defects.ts` into the *correct* service,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any
 *      other client would run, with no privileged channel between this script and the loop,
 *   3. puts the service back the way it was, whatever happened.
 *
 * ## Why this demo exists next to the eight that came before it
 *
 * The cart demo judges an application through a page; the database demo through a file it wrote; the
 * six simulated worlds through substitutes that stand in for a cluster, a system, a machine, an
 * account, a runtime and an editor. All nine have the same lifecycle, verdict rules, evidence bundle
 * and repair protocol - and none of them judged an application through the application's *own*
 * interface until this one.
 *
 * That is the gap this world closes, and it is a real one rather than a completeness exercise. A page
 * is a rendering: what a browser criterion observes is what the application chose to display, and an
 * API's contract - a status code, a header, a JSON pointer into a body - is not displayed anywhere.
 * Here the criterion puts its own request and reads the answer. Nothing is rendered and nothing is
 * substituted, which is why this world ships beside `local-web` and `local-db` rather than beside the
 * six `sim-*` worlds.
 *
 * ## The browser is refused by the document, not by this script
 *
 * No `--browser` flag is passed, and that is not the mechanism. This environment document *has* a
 * `url`, so a browser would be inferred from it - which is precisely why `environment.yaml` states
 * `browser.enabled: false`. A world that owned a `url` and said nothing about a browser would start
 * Playwright to render a page no criterion in this contract reads. The refusal is a fact about the
 * plan, which is the only thing the adapter ever sees.
 *
 * Step 3 matters more than it looks. The service is checked in correct; a demo that stopped between
 * inject and repair would leave a broken `server.mjs` behind, and the next reader would have no way to
 * tell a deliberately broken fixture from a mistake. The restore therefore has exactly one owner -
 * `restoreUnlessKept`, called from a `finally` - so it happens even when the run is interrupted, and
 * `tests/local-api-demo.test.ts` fails loudly if it ever does not.
 *
 * Nothing else is restored, and nothing else needs to be: the service holds its items in memory and
 * `reset.strategy: restart` re-seeds them from the frozen catalog, so the world is rebuilt from source
 * rather than patched. See `app/server.mjs`.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFECTS, inject, repairOne, status } from "./defects.ts";

const servicePath = fileURLToPath(new URL("./app/server.mjs", import.meta.url));
const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/**
 * Put the correct service back, if any defect is still injected. Idempotent.
 *
 * Undoing a defect is `repairOne`, never this function's own string surgery. A second copy of the
 * edit is free to disagree with the one the repair script uses, and in this repository it did: a
 * local copy of the replacement matched nothing because the block had been authored with `\n` and the
 * checkout held the file in CRLF, and the function still reported success. A restore that reports
 * success it did not achieve is the exact failure this project exists to refuse, so the claim is
 * checked before it is made.
 */
async function restore(): Promise<void> {
  const body = await readFile(servicePath, "utf8");
  let text = body;
  for (let done = 0; done < DEFECTS.length; done += 1) {
    const { text: next, repaired } = repairOne(text);
    if (repaired === null) break;
    text = next;
  }
  if (text === body) return;
  await writeFile(servicePath, text, "utf8");

  const stranded = status(text).filter((entry) => entry.state !== "intact");
  if (stranded.length > 0) {
    // Loud on purpose, and thrown rather than reported: an unrestored fixture is a broken repo, and a
    // message that a later exit code could paper over is not a fix for that.
    throw new Error(
      `could not restore ${stranded.map((entry) => `${entry.defect.id} (${entry.state})`).join(", ")}: ` +
        "app/server.mjs is not the file this demo was written against, so put it back from git before continuing",
    );
  }
  say("restored the correct service");
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

  const before = await readFile(servicePath, "utf8");
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: the service already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { text, injected } = inject(before);
  await writeFile(servicePath, text, "utf8");
  say(`injected ${String(injected.length)} defect(s): ${injected.join(", ") || "(none - already present)"}`);
  say("expected: the first pass fails six of eight criteria and passes AC-001 and AC-008");
  say("the two money defects are in D1, so AC-002 and AC-003 fail together and recover together");
  say("the two header readings are in D4, so AC-006 and AC-007 fail together and recover together");
  say("D2 and D3 are the controls: each is read by exactly one criterion");
  say("descending failures: 6 -> 4 -> 3 -> 2 -> 0");
  say("the document states browser.enabled false, so no page is rendered: every step is a call");

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
    say("--keep-defects: server.mjs is left carrying its defects; run again with --restore-only to undo");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
