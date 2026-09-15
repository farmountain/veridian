/**
 * The `sim-vscode` demo: the same loop, in a world whose subject is an extension host.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane, `examples/sim-posix` against a simulated
 * POSIX system, `examples/sim-os` against a simulated machine, `examples/sim-cloud` against a
 * substitute provider account and `examples/sim-container` against a substitute container runtime. This
 * one runs it against a **substitute VS Code host**, and what it carries that the others do not is an
 * extension lifecycle: a manifest with an engine floor and contributions, a module resolver that stands
 * in for the editor's own, activation events, a command registry, window surfaces an extension writes
 * to, a configuration an operator overrides, a workspace, and a store that survives the process that
 * wrote it - because here *every* action is a process, and there is no editor keeping an extension
 * resident in.
 *
 * ## What is simulated, and what is not
 *
 * There is no VS Code, no Electron, no extension host process, no marketplace, no user profile and no
 * renderer anywhere in this run. The world is a directory on this machine, a generated module that
 * answers `require("vscode")`, and a real Node process per action.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/extension/extension.js` is an ordinary CommonJS
 *      extension, loaded by `require` in a real child process, and `app/provision.mjs` is a real
 *      program run as a child process that installs it and drives it.
 *   2. The interfaces are real. `require("vscode")` resolves to a module this world generates, built
 *      from a register of handlers that really answer - a command registration really returns a
 *      disposable, an output channel really accumulates the lines an extension appends, a settings key
 *      really resolves through the override the operator configured, and the durable store is read and
 *      written by the same process boundary a real host has.
 *   3. The substitution is declared. Every reading carries `simulated`, naming the seven surfaces stood
 *      in for - the extension host, module resolution, activation events, the command registry, the
 *      window, configuration and the workspace - so a result says what was substituted instead of
 *      leaving a reader to infer it. `environment.yaml`'s own header says the same thing, and so does
 *      the goal's context block.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken for
 * a real editor. A `PASS` here means "this world holds what the contract says, as judged by this
 * world's own extension host" - not "an extension was loaded by VS Code and worked".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-vscode/demo.ts                 # inject, run, repair, restore
 * node examples/sim-vscode/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-vscode/demo.ts --restore-only  # put the source back and do nothing else
 * ```
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFECTS, EXTENSION_FILE, inject, status } from "./defects.ts";
import { readExtension, restoreAll, writeChanged } from "./source.ts";

const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

function restore(): void {
  const repaired = restoreAll();
  say(
    repaired.length === 0
      ? `${EXTENSION_FILE} was already correct, so there was nothing to restore`
      : `restored the correct extension: ${repaired.join(", ")}`,
  );
}

function restoreUnlessKept(): void {
  if (argv.includes("--keep-defects") || argv.includes("--restore-only")) return;
  restore();
}

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
    restore();
    return 0;
  }

  const before = readExtension();
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: ${EXTENSION_FILE} already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const outcome = inject(before);
  const written = writeChanged(before, outcome.text);
  say(
    `injected ${String(outcome.injected.length)} defect(s) into ${written.join(", ")}: ` +
      `${DEFECTS.map((entry) => entry.id).join(", ")}`,
  );
  // Derived from the table rather than written down beside it, so the line cannot claim a criterion the
  // defects are not filed against. Consequences are named by the run itself, which is the only side
  // that has observed them.
  say(
    "filed against: " +
      DEFECTS.map((entry) => `${entry.id} -> ${entry.criterionId}`).join(", ") +
      "; a first pass fails those and every criterion reading their consequence",
  );
  say(
    "the world is a substitute extension host: a real extension, a real process per action, and a " +
      "module resolution that stands in for the editor's own",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is an extension-host " +
      "reading, and two of them act in the world with a run step - one of which expects the world to " +
      "refuse it",
  );
  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");

  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);
  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say(`--keep-defects: ${EXTENSION_FILE} is left carrying its defects; run again with --restore-only to undo`);
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
