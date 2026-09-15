/**
 * The `sim-cloud` demo: the same loop, in a world whose subject is a remote provider account.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane, `examples/sim-posix` against a simulated
 * POSIX system and `examples/sim-os` against a simulated Windows system. This one runs it against a
 * **simulated cloud provider account**, and what it carries that the others do not is a world where
 * almost nothing interesting is a file on this disk. The other four all judge state that lives in a
 * directory; this one judges a set of resources an application created over an API, and the questions a
 * contract asks about it - is this bucket closed, may this principal do this, what did the account
 * charge for - are questions about a *provider's* records rather than a machine's.
 *
 * ## What is simulated, and what is not
 *
 * There is no cloud account, no `aws`/`az`/`gcloud` session and no outbound socket anywhere in this run.
 * The world is a real HTTP server bound to a loopback port, a table of buckets, objects, queues, secrets
 * and principals it holds in memory, and a policy evaluator that decides every permission question.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, run as a child process
 *      with the operator's own privileges, making real HTTP requests over a real TCP socket to the
 *      account's own address.
 *   2. The interfaces are real. The routes are a provider's own paths, the resources are its resources,
 *      the policy grammar is a real policy grammar with deny-beats-allow, and a request the account
 *      refuses gets a real status with a real reason.
 *   3. The substitution is declared. Every reading carries `simulated`, naming each surface that is not
 *      real - the control plane, the object store, the queue service, the secret store, the identity and
 *      policy evaluator, the billing meter and egress - so a result says what was substituted instead of
 *      leaving a reader to infer it. `environment.yaml`'s own header says the same thing.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken for
 * a real provider. A `PASS` here means "this account holds what the contract says, as judged by this
 * account's own evaluator" - not "a cloud account was audited".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-cloud/demo.ts                 # inject, run, repair, restore
 * node examples/sim-cloud/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-cloud/demo.ts --restore-only  # put the source back and do nothing else
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
  // defects are not filed against. The filed criterion is the one that reads the state the defect edited;
  // each defect is visible through more criteria than that, and a second literal list of them here would
  // be a list nothing reconciles - the run's own failure report is what names every criterion that moved,
  // one iteration at a time, and it is the only side that has observed them.
  say(
    "filed against: " +
      DEFECTS.map((entry) => `${entry.id} -> ${entry.criterionId}`).join(", ") +
      "; the filed criterion is the one that reads the defect itself, and the report names every " +
      "further criterion that moves with it",
  );
  say(
    "the world is a simulated cloud account: a real program making real HTTP requests over loopback to " +
      "an account the world holds in memory and decides permissions for itself",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is a cloud reading, " +
      "and one of them makes a request of its own through a `call` step",
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
