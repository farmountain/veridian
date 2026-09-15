/**
 * The `sim-data` demo: the same loop, in a world whose subject is a message broker.
 *
 * ## What this demo is for
 *
 * `examples/shopping-cart` proves the loop against a browser, `examples/inventory-db` against a SQLite
 * file, `examples/sim-k8s` against a substitute control plane, `examples/sim-posix` against a simulated
 * POSIX system, `examples/sim-os` against a simulated machine, `examples/sim-cloud` against a substitute
 * provider account and `examples/sim-container` against a substitute container runtime. This one runs it
 * against a **substitute message broker**, and what it carries that the others do not is a *log*: a
 * world whose state is a set of append-only records with positions, where the position a consumer group
 * commits is a fact the world holds and the records themselves cannot tell you.
 *
 * That distinction is the demo's argument. A pipeline that delivers three orders and commits `2` has
 * written every record correctly; the log is complete, every key and every payload reads exactly as it
 * should, and the only thing wrong is where the group will resume - which nothing in the data says. `D4`
 * is that off-by-one, and it is the reason this world keeps a committed position at all. A criterion
 * that read `latest-result.json` would have to trust the application's own arithmetic; a criterion that
 * asks the broker what position the group committed is asking a party that only records what it was
 * told.
 *
 * ## What is simulated, and what is not
 *
 * There is no Apache Kafka, no KRaft or ZooKeeper controller, no broker process, no segment file, no
 * partition directory, no ISR protocol, no consumer-group coordinator, no rebalance, no offset index and
 * no outbound socket anywhere in this run. The world is a TCP listener on loopback, a wire encoder and
 * decoder, and tables the adapter maintains: topics with their partition counts and policies, partitions
 * with their record lists and offsets, groups with their generations and members, and committed
 * positions.
 *
 * The three obligations a simulated world has to meet, and where this run meets them:
 *
 *   1. The application executes for real. `app/provision.mjs` is a real program, started as a child
 *      process with the operator's own privileges, and it is a real client: it opens a socket to the
 *      broker the adapter started, writes length-prefixed request frames and reads length-prefixed
 *      response frames back. Nothing about its traffic is faked for it.
 *   2. The interfaces are real. The request and response bodies are encoded and decoded by this tree's
 *      own wire format, an API version is negotiated through `ApiVersions` and every subsequent request
 *      is answered at a version the register declares, and an error code the broker returns is mapped
 *      to a fixed set of reading words rather than to a message this world invented. The inventory pass
 *      the criterion's own `run` steps issue goes through the same parser the protocol's own client path
 *      uses.
 *   3. The substitution is declared. Every reading carries `simulated`, naming the seven surfaces stood
 *      in for - broker, replication, group-coordination, log-storage, retention, transactions and
 *      partitioning - so a result says what was substituted instead of leaving a reader to infer it.
 *      `environment.yaml`'s own header says the same thing, and so does the goal's context block.
 *
 * ## The limits this world states rather than hides
 *
 * Three, and they are in `environment.yaml` rather than only here, because they are properties of the
 * world and not of the demo:
 *
 *   - **one node.** Replication is recorded and never performed: a topic created with replication 1 has
 *     an in-sync set of one member, and there is no second broker for it to be in sync with. A
 *     replication factor above one is refused rather than accepted and ignored.
 *   - **no rebalance.** A group is joined once and its assignment is the one the members negotiated at
 *     that join. There is no coordinator watching for a member to leave, so a criterion cannot observe
 *     a rebalance because there is none to observe.
 *   - **no retention.** This is the limit that makes `D1` and `D2` interesting. Every record ever
 *     produced is still there, whatever policy a topic was created with, because this world never
 *     deletes anything. A cleanup policy here is a value the broker **records and never applies**, and
 *     the criterion that reads it is reading a declaration rather than a consequence.
 *
 * The banners below say so out loud, because the one failure this world can suffer is being mistaken
 * for a real broker. A `PASS` here means "this world holds what the contract says, as judged by this
 * world's own inventory" - not "a message was published to Kafka and consumed".
 *
 * ## Modes
 *
 * ```
 * node examples/sim-data/demo.ts                 # inject, run, repair, restore
 * node examples/sim-data/demo.ts --keep-defects  # leave the four defects in place
 * node examples/sim-data/demo.ts --restore-only  # put the source back and do nothing else
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
  // The count and the list are both read out of what was actually injected, so the line cannot claim to
  // have broken a program it left alone. A run interrupted between injecting and repairing is the case
  // that makes the difference visible, and it is the case a line assembled from the table would get
  // wrong.
  say(
    outcome.injected.length === 0
      ? `nothing to inject: ${PROVISION_FILE} already carries every defect`
      : `injected ${String(outcome.injected.length)} defect(s) into ${written.join(", ")}: ` +
        `${outcome.injected.join(", ")}`,
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
    "the world is a substitute message broker: a real program, a real TCP listener, and real " +
      "length-prefixed protocol frames crossing it",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is a broker reading, " +
      "and three of them run a command in the world - one of which expects the world to refuse it",
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
