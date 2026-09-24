// Bisect the one reading this pass did not explain: the container reported `inside: written` while the
// host did not see the file. Everything else in the port is measured and green, so this is a single
// unexplained number and it gets a single-purpose probe rather than a paragraph of reasoning.
//
// The three candidate causes, each knocked down or confirmed by a reading rather than by an argument:
//   A. the argv the port builds is not the argv that was run
//   B. the path handed to the container is not the path the mount is at
//   C. a `\` survived from `node:path.join` into a Linux path, so the file was written somewhere else
//
// Written as a file rather than inlined because `AGENTS.md` records that quoting a multi-line command
// through PowerShell loses inner quotes, and a probe whose payload was mangled measures the mangling.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { containerPathOf, isolateProcess, planMounts } from "../core/environment/isolation.ts";

const root = mkdtempSync(join(tmpdir(), "veridian-iso-bisect-"));
const write = join(root, "inside.txt");
console.log(`host root: ${root}`);
console.log(`host file to expect: ${write}`);

const mounts = planMounts({ command: "", args: [], cwd: root, readRoots: [], writeRoots: [root] });
console.log(`mount: ${mounts[0]?.hostPath} -> ${mounts[0]?.containerPath} (${mounts[0]?.mode})`);
console.log(`containerPathOf(root/inside.txt): ${String(containerPathOf(mounts, write))}`);

// B/C. What does the port actually hand over when the arg IS a path? No `-e`, no string substitution -
// just the function this pass wrote, doing the job it was written for.
const isolated = isolateProcess({
  command: process.execPath,
  args: ["-e", "0"],
  cwd: root,
  readRoots: [],
  writeRoots: [root],
  denyNetwork: true,
});
console.log(`\nport args: ${isolated.args.join(" | ")}`);

// A. Run the literal argv the port built, with a payload that reports where it thinks it is.
const inspect = [
  'const fs = require("node:fs"), path = require("node:path");',
  'process.stdout.write("cwd:" + process.cwd() + "\\n");',
  'process.stdout.write("ls:" + JSON.stringify(fs.readdirSync(".")) + "\\n");',
  `try { fs.writeFileSync(${JSON.stringify("/veridian/rw0/inside.txt")}, "x"); process.stdout.write("posix-slashes:written\\n"); }`,
  ' catch (error) { process.stdout.write("posix-slashes:" + String(error.code) + "\\n"); }',
].join("");
const run = spawnSync(isolated.command, [...isolated.args.slice(0, -1), inspect], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 180_000,
});
console.log(`\n--- container stdout ---\n${(run.stdout ?? "").trim()}`);
console.log(`--- container stderr (last line) ---\n${(run.stderr ?? "").trim().split(/\r?\n/).slice(-1)[0] ?? ""}`);
console.log(`\nhost sees the file: ${String(existsSync(write))}`);
console.log(`host directory listing: ${JSON.stringify(readdirSync(root))}`);

rmSync(root, { recursive: true, force: true });
