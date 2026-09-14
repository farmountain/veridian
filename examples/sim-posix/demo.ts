/**
 * The `sim-posix` demo: the same loop, in a world with no page, no database file and no cluster.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, and `examples/sim-k8s` against a substitute control plane. This one runs it against a
 * **simulated POSIX system**, and the thing it carries that the others do not is that the criteria
 * *act*: a `run` step hands the world a command line, the world executes it, and the verdict is a
 * reading of what the world did in answer. Every earlier criterion read something the application had
 * already done; this contract's `posix.probe` criteria ask the world to do something and are judged on
 * the answer.
 *
 * ## What is simulated, and what is not
 *
 * There is no container, no VM, no image and no boot anywhere in this run. The world is a directory on
 * this machine, a table of accounts, packages, units and inodes the adapter maintains, and a small
 * register of programs it answers in process.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, run as a child process
 *      with the operator's own privileges, writing real files with real bytes into the sandbox.
 *   2. The interfaces are real. Those files have real modes and a real `sha256`; `systemctl start`
 *      really binds a loopback socket, and `posix.port` decides by really connecting to it.
 *   3. The substitution is declared. Every reading carries `simulated`, naming `kernel`,
 *      `distribution`, `package-manager`, `package-index`, `permissions`, `egress` and `provisioning`,
 *      so a result says which parts of the system were replaced instead of leaving a reader to infer it.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken
 * for a real system. A `PASS` here means "this world holds what the policy says, as judged by this
 * world's own account table" - not "a hardened machine was verified".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-posix/demo.ts                 # inject, run, repair, restore
 * node examples/sim-posix/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-posix/demo.ts --restore-only  # put the source back and do nothing else
 * ```
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFECTS, PROVISION_FILE, inject, status } from "./defects.ts";
import { readProvision, restoreAll, writeChanged } from "./source.ts";

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
      ? `${PROVISION_FILE} was already correct, so there was nothing to restore`
      : `restored the correct provisioning program: ${repaired.join(", ")}`,
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

  const before = readProvision();
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: ${PROVISION_FILE} already carries ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const outcome = inject(before);
  const written = writeChanged(before, outcome.text);
  say(
    `injected ${String(outcome.injected.length)} defect(s) into ${written.join(", ")}: ` +
      `${DEFECTS.map((entry) => entry.id).join(", ")}`,
  );
  say("expected: the first pass fails AC-003, AC-006, AC-008, AC-010, AC-011 and AC-012, and cannot judge AC-007");
  say("the world is a simulated POSIX system: a real program, real files, and a real loopback socket bound by its own `systemctl start`");
  say("environment.yaml declares no url, so no browser is started: every criterion is a posix reading, and two of them run a command");
  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");

  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);
  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say(`--keep-defects: ${PROVISION_FILE} is left carrying its defects; run again with --restore-only to undo`);
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
