/**
 * The `sim-mobile` demo: the same loop, in a world whose subject is a handset.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane, `examples/sim-posix` against a simulated
 * POSIX system, `examples/sim-os` against a simulated machine, `examples/sim-cloud` against a substitute
 * provider account, `examples/sim-container` against a substitute container runtime,
 * `examples/sim-vscode` against a substitute extension host, `examples/local-api` against a real HTTP
 * service, `examples/local-process` against a real child process and `examples/sim-data` against a real
 * broker protocol written into a real socket. This one runs it against a **substitute device**, and what
 * it carries that the others do not is a platform's own vocabulary: a booted device with an OS, a screen
 * and an orientation; a bundle with a manifest, an entry point, a digest and a launch count; a runtime
 * permission model with grants that are neither asked for nor given; deep links a bundle registers; a
 * notification queue; a keychain whose digests travel and whose values never do.
 *
 * ## What is simulated, and what is not
 *
 * There is no emulator, no AVD, no Android runtime, no touch stack, no display server, no input device,
 * no app store, no push service and no keychain service anywhere in this run. The world is a directory
 * on this machine, a table of device and bundle records the adapter maintains, and a **real child
 * process** per launch.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, run as a child process
 *      with the operator's own privileges, writing real files with real bytes - a real build context,
 *      a real manifest - into the sandbox. The bundle it installs has a real entry point, and the
 *      substitute launches **that** file as a real child process with this runtime: the stdout and
 *      stderr a criterion reads byte counts of are streams a real process really wrote.
 *   2. The interfaces are real. The digest a criterion matches the shape of is a digest of the files the
 *      application really wrote; the permission state the device holds is the state the application's
 *      own `permission grant` request produced; the deep link a criterion reads is one the application
 *      registered, resolved against the route it opened; the keychain entry is a digest of a value the
 *      program supplied.
 *   3. The substitution is declared. Every reading carries `simulated`, naming the nine surfaces stood
 *      in for - the device, the emulator, the touch OS, the display, the input stack, the sandbox, the
 *      keychain service, the app store and the push service - so a result says what was substituted
 *      instead of leaving a reader to infer it. `environment.yaml`'s own header says the same thing, and
 *      so does the goal's context block.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken for
 * a handset. A `PASS` here means "this device holds what the contract says, as judged by this world's own
 * inventory" - not "an application was installed on a phone".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-mobile/demo.ts                 # inject, run, repair, restore
 * node examples/sim-mobile/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-mobile/demo.ts --restore-only  # put the source back and do nothing else
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
    "the world is a substitute device: a real program, a real build context, and a real child process " +
      "for the launch the bundle was given",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is a mobile reading, " +
      "and three of them act in the world with a run step - one of which expects the world to refuse it",
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
