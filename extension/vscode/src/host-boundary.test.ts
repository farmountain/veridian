/**
 * The line between the Cockpit and the editor, held by a test rather than by a comment.
 *
 * `port.ts` exists so that the Cockpit is not written against VS Code - *"do not make VS Code the
 * architecture"* - and the test suite in this directory is written against the same boundary. Two
 * claims that until now lived only in comments are asserted here instead:
 *
 * 1. `host/vscode-port.ts` and `host/activate.ts` are the only files that import `vscode`, so the
 *    boundary is one seam with one implementation rather than a habit.
 * 2. No test imports `host/`, which is what lets `node --test` in the repository root discover and
 *    run this suite: the extension host's `vscode` module does not exist outside an editor.
 *
 * The second claim is the load-bearing one, and it was true by accident before it was true here.
 * Root discovery is a property of the *filename* - every `*.test.ts` below the repository root is
 * picked up - so the day someone adds a test for `vscode-port.ts`, the root run breaks with
 * `Cannot find module 'vscode'`. That error names the wrong cause: nothing would be wrong with the
 * extension, and the reason would be a test-runner discovery rule two directories away. This test
 * says so at the moment the mistake is made, in the place the mistake is made.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = fileURLToPath(new URL(".", import.meta.url));

/** Every `.ts` file under a directory, as paths relative to it, sorted for stable assertions. */
function sourceFiles(directory: string, prefix = ""): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...sourceFiles(join(directory, entry.name), prefix + entry.name + "/"));
    } else if (entry.name.endsWith(".ts")) {
      found.push(prefix + entry.name);
    }
  }
  return found.sort();
}

const FILES = sourceFiles(SOURCE_ROOT);

test("the source tree has files to inspect, so neither assertion below is vacuous", () => {
  // A guard on the guard. `sourceFiles` returning nothing would make the next two tests pass while
  // checking nothing - and a test that passes whether or not the rule holds is not a test.
  assert.ok(FILES.includes("port.ts"), `expected port.ts among ${FILES.join(", ")}`);
  assert.ok(FILES.includes("host/activate.ts"), "expected host/activate.ts");
  assert.ok(FILES.some((file) => file.endsWith(".test.ts")), "expected at least one test file");
});

test("only the host binding imports vscode", () => {
  const importers = FILES.filter((file) =>
    /from\s+"vscode"/.test(readFileSync(join(SOURCE_ROOT, file), "utf8")),
  );
  assert.deepEqual(importers, ["host/activate.ts", "host/vscode-port.ts"]);
});

test("no test imports the host binding, so the suite runs without an editor", () => {
  const tests = FILES.filter((file) => file.endsWith(".test.ts"));
  for (const file of tests) {
    const text = readFileSync(join(SOURCE_ROOT, file), "utf8");
    const importsHost = /from\s+"(\.\.?\/)+host\//.test(text);
    assert.ok(
      !importsHost,
      `${file} imports the host binding. A test that needs an editor belongs in a VS Code test ` +
        "host, not here: `node --test` from the repository root discovers every *.test.ts below it, " +
        "and that runner has no `vscode` module to give this file.",
    );
  }
});
