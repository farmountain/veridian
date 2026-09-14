/**
 * The `sim-os` demo: the same loop, in a world whose subject is an operating system.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane and `examples/sim-posix` against a
 * simulated POSIX system. This one runs it against a **simulated Windows system**, and what it carries
 * that the others do not is a *different family of the same idea*: the earlier system world names one
 * family's filesystem, one family's service manager and one family's permissions; this world names the
 * other family's, through validators that had to answer the questions a Windows hardening contract asks
 * - a machine-wide configuration store, an entry list with inheritance on it, and an account the
 * criteria act as.
 *
 * ## What is simulated, and what is not
 *
 * There is no virtual machine, no image, no `qemu`, no Hyper-V and no guest kernel anywhere in this run.
 * The world is a directory on this machine, a table of accounts, services and security records the
 * adapter maintains, and a small register of programs it answers in process.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, run as a child process
 *      with the operator's own privileges, writing real files with real bytes into the sandbox.
 *   2. The interfaces are real. Those files have real bytes and a real `sha256`; the access decisions
 *      are computed by the world's own ordered rule; `sc start` really binds a loopback socket, and the
 *      service is reported `running` only after a real connection to it succeeds.
 *   3. The substitution is declared. Every reading carries `simulated`, naming the family, the system
 *      it stands in for, the account, and which parts were replaced - the permission table, the store,
 *      the service manager, the package index and egress - so a result says what was substituted
 *      instead of leaving a reader to infer it. `environment.yaml`'s own header says the same thing, and
 *      so does the identity file the application installs into the sandbox.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken
 * for a real system. A `PASS` here means "this world holds what the policy says, as judged by this
 * world's own account table" - not "a hardened Windows machine was verified".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-os/demo.ts                 # inject, run, repair, restore
 * node examples/sim-os/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-os/demo.ts --restore-only  # put the source back and do nothing else
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
  // Derived from the table rather than written down beside it, so the line cannot claim a criterion the
  // defects are not filed against. Consequences are named by the run itself, which is the only side
  // that has observed them.
  say(
    "filed against: " +
      DEFECTS.map((entry) => `${entry.id} -> ${entry.criterionId}`).join(", ") +
      "; a first pass fails those and every criterion reading their consequence",
  );
  say(
    "the world is a simulated Windows system: a real program, real files, and a real loopback socket " +
      "bound by the world in answer to `sc start`",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is an os reading, and " +
      "two of them run a command inside the world - one of which expects the world to refuse it",
  );
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
