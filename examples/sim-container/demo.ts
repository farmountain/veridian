/**
 * The `sim-container` demo: the same loop, in a world whose subject is a container runtime.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane, `examples/sim-posix` against a simulated
 * POSIX system, `examples/sim-os` against a simulated machine and `examples/sim-cloud` against a
 * substitute provider account. This one runs it against a **substitute container runtime**, and what it
 * carries that the others do not is a container *engine's* own vocabulary: an image with layers that
 * are content-addressed, tags and a digest, a manifest that declares its ports and its account
 * declaration, and two containers created from that one image - one left running, one run to completion
 * so that a criterion can ask for an exit code at all.
 *
 * ## What is simulated, and what is not
 *
 * There is no Docker daemon, no Podman, no containerd, no `runc`, no OCI image, no layer, no namespace,
 * no cgroup, no registry and no outbound socket anywhere in this run. The world is a directory on this
 * machine, a table of images, tags, containers and volumes the adapter maintains, and a real child
 * process per container.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, run as a child process
 *      with the operator's own privileges, writing real files with real bytes - a real build context, a
 *      real Dockerfile - into the sandbox.
 *   2. The interfaces are real. The image's layers are digests of the files the application really
 *      wrote; the two containers are real `node` processes spawned with the command the image declares
 *      and the environment the create arguments gave them; the exit code a criterion reads is the exit
 *      code of that process; and the healthcheck the application declared is really executed once, at
 *      container start, through the same path a criterion's own command takes.
 *   3. The substitution is declared. Every reading carries `simulated`, naming the seven surfaces stood
 *      in for - namespaces, cgroups, image layers, registry, published ports, volumes and user
 *      switching - so a result says what was substituted instead of leaving a reader to infer it.
 *      `environment.yaml`'s own header says the same thing, and so does the goal's context block.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken for
 * a real engine. A `PASS` here means "this world holds what the contract says, as judged by this world's
 * own inventory" - not "an image was built by a real engine and deployed".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-container/demo.ts                 # inject, run, repair, restore
 * node examples/sim-container/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-container/demo.ts --restore-only  # put the source back and do nothing else
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
    "the world is a substitute container runtime: a real program, a real build context, and real child " +
      "processes for both containers",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is a container " +
      "reading, and four of them run a command inside the world - one of which expects the world to " +
      "refuse it",
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
