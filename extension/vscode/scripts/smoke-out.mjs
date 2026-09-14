/**
 * Smoke test for the *compiled* extension: `out/`, loaded and activated without an editor.
 *
 * ## What gap this closes
 *
 * `src/*.test.ts` covers the extension's decisions, but `node --test` discovers `*.test.ts` and Node
 * runs TypeScript - it does not run `out/`. So the six `.js` files that are actually loaded by the
 * extension host are covered by nothing, and two defects this repository has already paid for are
 * exactly of that shape: the npm package's asset root (`dist/` resolution) and type stripping under
 * `node_modules`. Both were invisible to a suite that only ever ran the source.
 *
 * This script is to the extension what `npm run smoke:dist` is to the CLI: it runs the artifact.
 *
 * ## What it proves, and what it does not
 *
 * It proves the manifest's `main` resolves to a file, that file loads with its whole import graph
 * (rewritten `.ts` specifiers and all), it exports `activate` and `deactivate`, and calling
 * `activate` registers the commands the manifest declares.
 *
 * It does not prove that VS Code integrates the extension - the command palette, keybindings,
 * workspace trust and the status bar's rendering are the editor's, and `scripts/vscode-stub.mjs` is
 * a recording double rather than a simulation. A green run here is a *required* condition, not a
 * sufficient one.
 *
 * Run with `npm run smoke:out`. Exits 0 on success, 1 on the first failed assertion.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);

const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
  } else {
    console.log(`FAIL ${message}`);
    failures.push(message);
  }
}

/** Every compiled file under a directory, so the specifier scan cannot miss a subdirectory. */
async function compiledFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await compiledFiles(path)));
    } else if (entry.name.endsWith(".js")) {
      found.push(path);
    }
  }
  return found.sort();
}

const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));

// Resolve `main` the way the extension host will, rather than assuming a path. If the manifest and
// the build disagree, the import below fails and this script reports the manifest as the cause.
const mainPath = join(PACKAGE_ROOT, manifest.main);
check(
  typeof manifest.main === "string" && existsSync(mainPath),
  `the manifest's main points at a file that exists (${manifest.main})`,
);

// Nothing below can run, so the assertion above is the whole report. Without this the driver would
// print its finding and then a module-resolution stack trace over the top of it, which buries the one
// line that says what is wrong.
if (failures.length > 0) {
  console.log("\nthe manifest and the build disagree about where the extension starts.");
  process.exit(1);
}

// Alias `vscode` to the recording double. Registered before the import, because a static import
// would be hoisted above this line and resolved before the hook could see it.
const stubUrl = new URL("./vscode-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "vscode") {
      return { url: stubUrl, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const stub = await import(stubUrl);
const extension = await import(pathToFileURL(mainPath).href);

check(typeof extension.activate === "function", "the compiled entry point exports activate");
check(typeof extension.deactivate === "function", "the compiled entry point exports deactivate");

const declared = (manifest.contributes?.commands ?? []).map((command) => command.command).sort();

/** Activate once against a given window shape. */
async function activateWith(root) {
  stub.reset();
  stub.environment.root = root;
  const subscriptions = [];
  extension.activate({ subscriptions });
  // `activate` deliberately does not await `refresh`; one turn of the loop is enough for a synchronous
  // dashboard read to have landed.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return subscriptions;
}

const withFolder = await activateWith(PACKAGE_ROOT);

check(
  JSON.stringify([...stub.state.commands.keys()].sort()) === JSON.stringify(declared),
  `activation registers exactly the ${declared.length} commands the manifest declares`,
);
check(
  withFolder.length === declared.length + 2,
  "every command registration, the output channel and the status bar item reach context.subscriptions",
);
check(stub.state.outputChannels.length === 1, "one output channel is created");
check(stub.state.statusBarItems.length === 1, "one status bar item is created");
check(
  stub.state.statusBarItems[0]?.text === "Veridian: no run yet",
  "with a folder open and no run on disk the dashboard reports that there is no run yet",
);
check(stub.state.errors.length === 0, "activation reports no error");

const withoutFolder = await activateWith(null);

check(withoutFolder.length === declared.length + 2, "activation also completes in a window with no folder");
check(
  JSON.stringify([...stub.state.commands.keys()].sort()) === JSON.stringify(declared),
  "the same commands are registered with no folder open",
);
check(stub.state.errors.length === 0, "and still reports no error");

// The build rewrites `.ts` specifiers to `.js`; a missed one is a module the host cannot resolve.
const files = await compiledFiles(join(PACKAGE_ROOT, "out"));
check(files.length > 0, "out/ contains compiled files to inspect");
const stragglers = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (/(?:from|import)\s*\(?\s*"[^"]*\.ts"/.test(text)) {
    stragglers.push(file);
  }
}
check(stragglers.length === 0, `no compiled file imports a .ts specifier (${files.length} files inspected)`);
for (const file of stragglers) {
  console.log(`     ${file}`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} of the compiled extension's checks failed.`);
  process.exit(1);
}

console.log(`\nthe compiled extension loads and activates (${files.length} files inspected).`);
