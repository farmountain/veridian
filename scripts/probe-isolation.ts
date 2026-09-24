// The phase's own falsification probe, run rather than argued.
//
// The claim to falsify: *a run inside the substrate refuses an action the host would have allowed, and
// the bundle can name which substrate held it.* Three readings are taken of **one program**:
//
//   1. on this host, unisolated      -> both writes succeed. This is the positive control, and it is
//                                       the reason the substrate's refusal is a *change* rather than
//                                       a broken program.
//   2. inside the substrate          -> the write inside the mount succeeds **and the host sees it**,
//                                       while the write outside is refused. Both halves, or the
//                                       reading says nothing.
//   3. with the substrate unavailable -> the vector is the host's own and the reason is stated. This
//                                       is the branch a real world hits, and a probe that only ever
//                                       saw `applied: true` would never have read it - which is the
//                                       branch that decides whether a world may claim `enforced`.
//
// **The program is a file, and that is the correction this probe needed.** Its first version passed the
// payload to `-e` as a string and substituted container paths into it by splitting on the host root.
// That left a Windows `\` before the filename, so the container wrote a file whose *name* contained a
// backslash, the host never saw it, and the probe reported the port as having failed to write through a
// mount it had mounted correctly. The bisect that found it is `scripts/probe-isolation-bisect.ts`, and
// the reading that settled it was `containerPathOf(mounts, root/inside.txt) -> /veridian/rw0/inside.txt`
// against a host listing of `["inside.txt"]`. Handing over a *file* removes the substitution entirely,
// because the port translates the argument itself - which is also what a real caller does, so the probe
// now exercises the translation rather than working around it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { containerPathOf, isolateProcess, isolationCapability, planMounts } from "../core/environment/isolation.ts";

const root = mkdtempSync(join(tmpdir(), "veridian-isolation-run-"));
const escaped = join(root, "..", "veridian-isolation-run-escape.txt");
const program = join(root, "program.mjs");
rmSync(escaped, { force: true });

/**
 * The program both runs execute, written **inside the mounted root** so the port can translate its
 * path. It reports each half on its own line, whatever happens, and it names the directory it used -
 * so a reading that disagrees with the expectation says which path disagreed rather than only that one
 * did.
 */
writeFileSync(
  program,
  [
    'import { writeFileSync } from "node:fs";',
    'import { fileURLToPath } from "node:url";',
    'import { dirname, join } from "node:path";',
    "const here = dirname(fileURLToPath(import.meta.url));",
    'try { writeFileSync(join(here, "inside.txt"), "x"); process.stdout.write("inside:written " + here + "\\n"); }',
    ' catch (error) { process.stdout.write("inside:" + String(error.code) + "\\n"); }',
    'try { writeFileSync(join(here, "..", "escape.txt"), "x"); process.stdout.write("outside:written\\n"); }',
    ' catch (error) { process.stdout.write("outside:" + String(error.code) + "\\n"); }',
  ].join("\n"),
  "utf8",
);

function reading(stdout: string): { readonly inside: string; readonly outside: string } {
  const line = (prefix: string): string => {
    const found = stdout.split(/\r?\n/).find((row) => row.startsWith(`${prefix}:`));
    return found === undefined ? "no reading" : found.slice(prefix.length + 1);
  };
  return { inside: line("inside"), outside: line("outside") };
}

const capability = isolationCapability();
console.log(`substrate available: ${String(capability.available)} (${capability.substrate} ${capability.version})`);

console.log("\n--- 1. on this host, unisolated (the positive control) ---");
const host = spawnSync(process.execPath, [program], { encoding: "utf8", windowsHide: true });
const hostReading = reading(host.stdout ?? "");
console.log(`  inside:  ${hostReading.inside}`);
console.log(`  outside: ${hostReading.outside}`);
rmSync(join(root, "inside.txt"), { force: true });
rmSync(join(root, "..", "escape.txt"), { force: true });

console.log("\n--- 2. inside the substrate ---");
const isolated = isolateProcess({
  command: process.execPath,
  args: [program],
  cwd: root,
  readRoots: [],
  writeRoots: [root],
  denyNetwork: true,
});
const mounts = planMounts({ command: "", args: [], cwd: root, readRoots: [], writeRoots: [root] });
console.log(`  applied:   ${String(isolated.applied)}`);
console.log(`  substrate: ${String(isolated.substrate)}`);
console.log(`  reason:    ${isolated.reason}`);
console.log(`  the program, translated: ${String(containerPathOf(mounts, program))}`);
const run = spawnSync(isolated.command, isolated.args, {
  encoding: "utf8",
  windowsHide: true,
  timeout: 180_000,
});
const insideReading = reading(run.stdout ?? "");
console.log(`  inside:  ${insideReading.inside}`);
console.log(`  outside: ${insideReading.outside}`);
console.log(`  escape file on the host:           ${String(existsSync(escaped))}`);
console.log(`  the host sees the permitted write: ${String(existsSync(join(root, "inside.txt")))}`);
console.log(`  host directory listing:            ${JSON.stringify(readdirSync(root))}`);
if (existsSync(join(root, "inside.txt"))) {
  console.log(`  contents: ${readFileSync(join(root, "inside.txt"), "utf8")}`);
}

console.log("\n--- 3. a request the substrate cannot hold ---");
const refused = isolateProcess({
  command: process.execPath,
  args: [program],
  cwd: tmpdir(),
  readRoots: [],
  writeRoots: [root],
});
console.log(`  applied: ${String(refused.applied)}`);
console.log(`  reason:  ${refused.reason}`);

console.log("\n--- the verdict ---");
const changed = hostReading.outside === "written" && insideReading.outside !== "written";
const permitted = insideReading.inside.startsWith("written") && existsSync(join(root, "inside.txt"));
console.log(`  the host allowed the escape and the substrate refused it: ${String(changed)}`);
console.log(`  the permitted half worked AND the host saw it:            ${String(permitted)}`);
console.log(`  both halves read, which is what makes either one mean something: ${String(changed && permitted)}`);

rmSync(root, { recursive: true, force: true });
rmSync(escaped, { force: true });

/**
 * The exit code, and the reason this script has one.
 *
 * A probe that printed its reading and exited 0 either way would be a check CI could not use: the
 * job would go green on a machine with no runtime, on a runtime that had stopped, and on a boundary
 * that was reported but not held - which is precisely the class of defect this whole seam exists to
 * remove. So the verdict is the exit status, and both halves have to be read: a substrate that
 * refused the escape *and* broke the permitted work is a broken world rather than a boundary, and
 * `changed` alone would call it a success.
 */
if (!changed || !permitted) {
  console.error(
    "\nthe boundary was not observed: either nothing held it, or holding it broke the write it was " +
      "supposed to permit. Both halves have to be true, and the readings above say which failed.",
  );
  process.exitCode = 1;
}
