#!/usr/bin/env node
/**
 * The cluster demo, run end to end.
 *
 *   node examples/sim-k8s/demo.ts                   the whole thing
 *   node examples/sim-k8s/demo.ts --keep-defects    leave the app broken afterwards
 *   node examples/sim-k8s/demo.ts --restore-only    put the app back and exit
 *
 * It does three things, and deliberately nothing else:
 *
 *   1. injects the two defects from `defects.ts` into the application's own manifests,
 *   2. hands the goal to the CLI as an ordinary child process - the same `veridian validate` any other
 *      client would run, with no privileged channel between this script and the loop,
 *   3. puts the manifests back the way they were, whatever happened.
 *
 * ## Why this demo exists next to the cart and database demos
 *
 * The cart demo proves Veridian can judge an application through a browser; the database demo proves
 * the browser was never the architecture. This one carries a different claim: that a world Veridian
 * gets *no real infrastructure* for - there is no cluster on this machine, and by design there will not
 * be - can still produce a verdict worth trusting.
 *
 * The three conditions it has to meet are stated in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` section 5
 * and asserted here rather than assumed:
 *
 *   1. The application executes for real. `start.command` is the application's own `deploy.mjs`, run
 *      as a child process, and it really opens a TCP socket and really submits objects over HTTP.
 *   2. The interfaces are real. The routes, the status codes and the `Status` bodies are the
 *      Kubernetes API's own.
 *   3. The substitution is declared. Every reading carries `simulated`, so a result says which parts
 *      of the cluster were substituted rather than leaving a reader to infer it.
 *
 * What is never substituted: whether the application's code ran, what it submitted, how the API server
 * answered, what the cluster then held, and the fact that the world was reset between iterations.
 *
 * ## What the run should look like
 *
 * Ten criteria, all mandatory. The first iteration injects both defects, and they fail *differently*:
 *
 *   - the Deployment's image tag fails AC-003 (the spec), AC-004 (ready replicas), AC-005 (pods) and
 *     AC-008 (the failed-pull event) - one defect, four readings, and the readings that count replicas
 *     cannot say why;
 *   - the Service's renamed object leaves AC-007 `FAIL` - the cluster really holds no such Service -
 *     and AC-006 `INCONCLUSIVE`, because the deploy step never ran and `k8s.applied` refuses to report
 *     a step it has no record of.
 *
 * Then two repairs, one per iteration: the image tag, then the Service name. Ten passes, exit 0.
 *
 * ## Why nothing here is a stub
 *
 * The image the deploy program builds is a record the world's registry really reads; the manifests are
 * the application's own files and the criteria submit them through the application's own paths; the
 * API server is a real HTTP server on loopback. A demo that faked any of those would be a demo of the
 * fake. If the world were doing less than it claims, the defect would be in the world, and this script
 * would be narrating it.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFECTS, MANIFEST_FILES, inject, status } from "./defects.ts";
import { readManifests, restoreAll, writeChanged } from "./manifests.ts";

const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const repairPath = fileURLToPath(new URL("./repair.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/**
 * Put the correct manifests back. Idempotent, and it refuses to claim a restore it did not achieve.
 *
 * Undoing a defect is `repairOne` (through `restoreAll`), never this script's own string surgery. This
 * project has already paid for that lesson twice - once in `examples/shopping-cart`, where a local copy
 * of the replacement matched nothing because the block was authored with `\n` and the checkout held
 * CRLF, and the function still printed that it had restored the correct app. A restore that reports
 * success it did not achieve is the exact failure Veridian exists to refuse, so the claim is checked
 * before it is made, and `restoreAll` throws rather than returning when anything is stranded.
 */
function restore(): void {
  const repaired = restoreAll();
  say(
    repaired.length === 0
      ? "nothing was injected, so there was nothing to restore"
      : `restored the correct manifests: ${repaired.join(", ")}`,
  );
}

/** The single owner of "put the app back", so an interrupted run cannot leave it broken. */
function restoreUnlessKept(): void {
  if (argv.includes("--keep-defects") || argv.includes("--restore-only")) return;
  restore();
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
    restore();
    return 0;
  }

  const before = readManifests();
  const alreadyInjected = status(before).filter((entry) => entry.state === "injected");
  if (alreadyInjected.length > 0) {
    say(`note: the manifests already carry ${String(alreadyInjected.length)} defect(s) from an earlier run`);
  }

  const { files, injected } = inject(before);
  const written = writeChanged(before, files);
  say(
    `injected ${String(injected.length)} defect(s) into ${written.length} of ${String(MANIFEST_FILES.length)} manifests: ` +
      `${DEFECTS.map((entry) => entry.defect.id).join(", ")}`,
  );
  say("expected: the first pass fails AC-003..AC-005, AC-007 and AC-008, and cannot judge AC-006");
  say("the world is a substitute cluster: a real HTTP API server on loopback, and a real deploy program that talks to it");
  say("environment.yaml declares no url, so no browser is started: every criterion is a k8s reading");

  say("running: veridian validate --goal <demo>/goal.yaml --repair node <demo>/repair.ts");
  const code = await runCli([cliPath, "validate", "--goal", goalPath, "--repair", "node", repairPath]);

  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-defects")) {
    say("--keep-defects: the manifests are left carrying their defects; run again with --restore-only to undo");
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(restoreUnlessKept);
