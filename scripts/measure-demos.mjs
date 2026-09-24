// Phase 11: run every demo and record the exit code it actually produced.
//
// `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` says of each of its fourteen headings either nothing or a
// claim; phase 11's acceptance criterion is that a heading calling itself *built* "carries a command
// that was actually run". So the commands are run, and what is written into the document is this
// output rather than the document's own promise about what it would print.
//
// `cli/support.ts` writes every log line to stderr on purpose, so both streams are captured and only
// the exit code and the last line of each stream are reported - the verdict is the exit code, and this
// repository has already paid for reading a narrative instead of a code.

import { spawnSync } from "node:child_process";

const DEMOS = [
  ["demo", "local-web"],
  ["demo:no-browser", "local-web (refusal)"],
  ["demo:db", "local-db"],
  ["demo:k8s", "sim-k8s"],
  ["demo:posix", "sim-posix"],
  ["demo:os", "sim-os"],
  ["demo:cloud", "sim-cloud"],
  ["demo:container", "sim-container"],
  ["demo:vscode", "sim-vscode"],
  ["demo:api", "local-api"],
  ["demo:local-process", "local-process"],
  ["demo:data", "sim-data"],
  ["demo:mobile", "sim-mobile"],
  ["demo:cockpit", "veridian-cockpit"],
];

const results = [];
for (const [script, world] of DEMOS) {
  const started = Date.now();
  const run = spawnSync("npm", ["run", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const stdout = (run.stdout ?? "").trim().split("\n").filter(Boolean);
  const stderr = (run.stderr ?? "").trim().split("\n").filter(Boolean);
  // The CLI's own summary is the last stdout line; anything on stderr is progress chatter.
  const summary = stdout[stdout.length - 1] ?? "";
  const lastError = stderr[stderr.length - 1] ?? "";
  results.push({ script, world, code: run.status, seconds, summary, lastError });
  console.log(`\n== npm run ${script}  (${world})`);
  console.log(`   exit ${String(run.status)}  ${seconds}s`);
  if (summary.length > 0) console.log(`   stdout: ${summary.slice(0, 200)}`);
  if (lastError.length > 0 && summary.length === 0) console.log(`   stderr: ${lastError.slice(0, 200)}`);
}

console.log("\n\n=== MEASURED ===");
for (const row of results) {
  console.log(`${row.script.padEnd(20)} exit=${String(row.code).padStart(2)}  ${row.seconds.padStart(6)}s  ${row.world}`);
}

const bad = results.filter((row) => row.code !== 0);
console.log(`\nnon-zero exits: ${bad.length === 0 ? "none" : bad.map((row) => `${row.script}=${String(row.code)}`).join(", ")}`);
