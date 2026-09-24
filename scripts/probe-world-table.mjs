// Phase 11's probes over the world table and the declared surfaces, run and restored in one pass.
//
// Written as a file rather than a multi-line PowerShell command because `AGENTS.md` records that a
// multi-line here-string pasted into the integrated terminal can leave the shell stuck, and because a
// probe is only worth anything if the change marker is printed - so every replacement reports whether
// it changed the text before the guard is run.
//
// Six probes in two directions. Probes 1-4 aim at the document's *rows*: a row is a statement about one
// world, and the rows are where the guard's arithmetic lives. Probes 5-6 aim at one *surface* from each
// side of the same claim - out of the document's row, and out of the constant that declares it - because
// a guard that reads one direction cannot see a world the other side names and this one does not.
//
// Two traps were paid for here and are avoided by construction. `git checkout --` is not used to
// restore: `writeFileSync` with the bytes read at the top is, and the restore is *asserted* by
// re-reading the file rather than inferred from the suite going green, because a suite that is green
// after a restore and a suite that was green all along are the same output.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DOC = "docs/DISTRIBUTION-AND-ENVIRONMENTS.md";
const CONSTANT = "core/environment/k8s-observation.ts";
const GUARD = "tests/simulated-surfaces.test.ts";

const originals = new Map([
  [DOC, readFileSync(DOC, "utf8")],
  [CONSTANT, readFileSync(CONSTANT, "utf8")],
]);

/**
 * The newline the target file actually uses.
 *
 * A needle spanning two lines has to be built from the file's own convention or it matches nothing,
 * and a probe that matches nothing is a probe that changed the file to what it already said - it
 * reports a working guard over a change that never happened. `core/environment/k8s-observation.ts`
 * is CRLF and `docs/` here is CRLF, but a probe is a measurement and a measurement that assumes a
 * line ending is measuring the assumption.
 */
function newlineOf(file) {
  return originals.get(file).includes("\r\n") ? "\r\n" : "\n";
}

const probes = [
  {
    label: "a two-world row",
    file: DOC,
    from: "| `sim-k8s` | real app process against a real HTTP control plane |",
    to: "| `sim-k8s` / `sim-mobile` | real app process against a real HTTP control plane |",
  },
  {
    label: "a row for a world the registry does not register",
    file: DOC,
    from: "| `local-web` | real child process",
    to: "| `local-nope` | real child process",
  },
  {
    label: "a registered world with no row",
    file: DOC,
    from: "| `sim-mobile` | real app process provisioning a substitute device over a real command surface |",
    to: "| `sim-zigbee` | real app process provisioning a substitute device over a real command surface |",
  },
  {
    label: "one world named twice",
    file: DOC,
    from: "| `sim-os` (windows, macos) |",
    to: "| `sim-posix` (windows, macos) |",
  },
  {
    // Direction one of the surface claim: the row stops printing a surface the constant declares.
    label: "a surface dropped from a document row",
    file: DOC,
    from:
      "| `sim-k8s` | real app process against a real HTTP control plane | " +
      "`scheduler`, `kubelet`, `cri`, `etcd`, `cni`, `admission`, `ingress` |",
    to:
      "| `sim-k8s` | real app process against a real HTTP control plane | " +
      "`scheduler`, `kubelet`, `cri`, `etcd`, `cni`, `ingress` |",
  },
  {
    // Direction two: the constant stops declaring a surface the row still prints.
    label: "a surface dropped from the constant",
    file: CONSTANT,
    from: `  "etcd",${newlineOf(CONSTANT)}  "cni",${newlineOf(CONSTANT)}`,
    to: `  "etcd",${newlineOf(CONSTANT)}`,
  },
];

function run(label) {
  let output = "";
  try {
    output = execFileSync("node", ["--test", GUARD], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const summary = (output.match(/^# (pass|fail) \d+$/gm) ?? []).join(" | ");
  const named = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1]).join(" ; ");
  console.log(`${label}: ${summary}`);
  if (named.length > 0) console.log(`    failing subtest(s): ${named}`);
  // The message matters as much as the failure. A guard that fails without naming the row it refused
  // sends its reader to the whole table; the assertion's own words are the finding. `^\s*` rather than
  // `^` because a subtest's diagnostic line is indented under its suite's, and matching at column zero
  // prints the suite name instead of the reason.
  const reason = [...output.matchAll(/^\s+(.{0,200})$/gm)]
    .map((match) => (match[1] ?? "").trim())
    .filter((line) =>
      /world table|naming \d|twice|no row for|registers|surface|declares|prints/.test(line),
    );
  for (const line of reason.slice(0, 3)) console.log(`    reason: ${line}`);
}

let allChanged = true;
for (const probe of probes) {
  const original = originals.get(probe.file);
  const probed = original.split(probe.from).join(probe.to);
  const changed = probed !== original;
  allChanged &&= changed;
  console.log(`\nprobe: ${probe.label} (${probe.file}) -- text changed: ${changed}`);
  if (!changed) {
    console.log("    NOTHING CHANGED, so this probe measures nothing. Re-aim it.");
    continue;
  }
  writeFileSync(probe.file, probed);
  run("    result");
  writeFileSync(probe.file, original);
}

console.log(`\nevery probe changed the file it aimed at: ${allChanged}`);
for (const [file, original] of originals) {
  console.log(`restored byte for byte (${file}): ${readFileSync(file, "utf8") === original}`);
}
console.log("\n--- guard on the restored tree ---");
run("restored");
