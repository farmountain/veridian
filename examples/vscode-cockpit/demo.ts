/**
 * The `vscode-cockpit` demo: Veridian judged by its own client, in the world that can judge it.
 *
 * ## What this demo is for
 *
 * Every other demo in this repository judges an *application*. This one judges the **Cockpit** - the
 * VS Code extension that is one of Veridian's five distribution routes - and the reason it exists is a
 * measurement rather than a feature. The Cockpit has a unit suite of 72 tests and a compiled-artifact
 * smoke test of 15 checks. Both were green on a build whose two reporter commands did nothing at all
 * when invoked here. So the contract in `acceptance.yaml` takes the reading the other two checks
 * cannot: it puts the **compiled** extension inside a substitute extension host and judges what that
 * host recorded while the extension ran.
 *
 * That run found two real defects, both in `extension/vscode/src/host/vscode-port.ts`, and this demo
 * is what keeps them found. They are recorded here rather than only in a commit message because the
 * two of them are the reason the contract has the exact criteria it has:
 *
 *   - `registerCommand` wrapped the handler and then wrote `void handler().catch(...)`. A discarded
 *     promise is not a discarded wrapper: `vscode.commands.registerCommand` answered `undefined`, so
 *     any host that awaits a command believes it finished the moment it started. Here that loses the
 *     whole rendering, because the reporter awaits a filesystem read after the host has moved on.
 *     `AC-008` is the criterion; it reads the output channel, not the invocation.
 *   - `openPath` used the answer of `workspace.openTextDocument` with `.then` and no shape check. This
 *     world's substitute refuses that API *by name*, so calling `.then` on the refusal threw, and the
 *     extension told the user about its own crash - while the invocation was still reported as
 *     answered. `AC-010` is the criterion; `AC-011` is what makes it a reading about the host's edge
 *     rather than about a silent mock.
 *
 * ## What is simulated, and what is not
 *
 * This is a plain `sim-vscode` world, so the substitution is the one that world already declares: no
 * VS Code, no Electron, no extension host process, no marketplace, no user profile and no renderer,
 * with a generated module answering `require("vscode")` and a real Node process per action. The seven
 * surfaces stood in for - the host, module resolution, activation events, the command registry, the
 * window, configuration and the workspace - are named in each reading's `simulated` field.
 *
 * What is *not* simulated is the subject. The extension this world installs is the real compiled
 * Cockpit, copied out of `extension/vscode`, activated by a real Node process, and judged on what its
 * own code did. That is the whole point: a substitute host and a mediated client are compatible, and
 * judging the artifact rather than a stand-in for it is what turns "the tests passed" into "this works".
 *
 * ## Why the extension is staged rather than committed
 *
 * `app/extension/` is **generated**, and it is generated because it has to be: the extension host is
 * not Node's loader, so the subject of this world is `out/*.js` rather than the `.ts` source beside
 * it, and `out/` is a build product this repository does not commit. `stage()` copies the manifest and
 * exactly the paths the manifest allowlists - the same list `vsce` packs from, read out of the
 * manifest rather than restated here - and `unstage()` removes the copy afterwards, so the working
 * tree is unchanged by a run.
 *
 * It is staged *inside* `app/` on purpose: this world refuses a manifest that is not under the
 * application directory or the sandbox, and records the attempt as a boundary crossing, so an
 * extension installed from anywhere else would be a refused reading rather than a judged one.
 *
 * ## Modes
 *
 * ```
 * node examples/vscode-cockpit/demo.ts                # stage, run, unstage
 * node examples/vscode-cockpit/demo.ts --keep-staged  # leave app/extension/ in place to inspect it
 * ```
 */

import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const goalPath = fileURLToPath(new URL("./goal.yaml", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/veridian.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const extensionRoot = fileURLToPath(new URL("../../extension/vscode", import.meta.url));
const stagedRoot = fileURLToPath(new URL("./app/extension", import.meta.url));
const stagedSpelling = "examples/vscode-cockpit/app/extension";
const argv = process.argv.slice(2);

function say(line: string): void {
  process.stdout.write(`demo: ${line}\n`);
}

/** `stat` as a question rather than an exception, because both answers are ordinary here. */
async function present(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The manifest's own file allowlist.
 *
 * Read out of the manifest rather than written down beside it, because this list and `files` in
 * `extension/vscode/package.json` are the same list, and a copy here would be free to disagree with
 * the one `vsce` packs from. A manifest without a usable allowlist is refused rather than treated as
 * "copy everything", since installing a partial extension would produce failures this demo is not
 * about.
 */
function allowedBy(manifest: unknown): readonly string[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const files = (manifest as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Copy the compiled Cockpit into the application directory.
 *
 * The refusal below is the one that matters, and it names the command that fixes it rather than the
 * symptom. A missing `out/` is not an environment failure and not an application failure: it is this
 * demo being run before the extension was built, and the only honest thing to report is that fact -
 * the extension host cannot load the `.ts` source, so there is nothing to stage and nothing to judge.
 */
async function stage(): Promise<readonly string[]> {
  const compiled = join(extensionRoot, "out");
  if (!(await present(compiled))) {
    throw new Error(
      `the compiled Cockpit is not present at ${compiled}, so there is nothing for an extension host ` +
        `to load: the host is not Node's loader and cannot run the .ts source. Run \`npm run build\` ` +
        `in extension/vscode, then run this demo again.`,
    );
  }

  const manifest: unknown = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
  const allowlist = allowedBy(manifest);
  if (allowlist.length === 0) {
    throw new Error(
      `the Cockpit's manifest declares no usable \`files\` allowlist, so this demo cannot tell which ` +
        `paths an installed extension is made of. Refusing rather than copying the whole directory, ` +
        `which would install files the archive route does not carry.`,
    );
  }

  await rm(stagedRoot, { recursive: true, force: true });
  await mkdir(stagedRoot, { recursive: true });

  const copied: string[] = ["package.json"];
  await cp(join(extensionRoot, "package.json"), join(stagedRoot, "package.json"));
  for (const entry of allowlist) {
    const from = join(extensionRoot, entry);
    if (!(await present(from))) {
      throw new Error(
        `the Cockpit's manifest allowlists "${entry}", which is not present at ${from}. The archive ` +
          `route would fail differently and later, so this demo refuses it here rather than installing ` +
          `an extension that is missing a path its own manifest promises.`,
      );
    }
    await cp(from, join(stagedRoot, entry), { recursive: true });
    copied.push(entry);
  }
  return copied;
}

async function unstage(): Promise<void> {
  await rm(stagedRoot, { recursive: true, force: true });
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
  say("this demo judges Veridian's own client, not a sample application");
  try {
    const copied = await stage();
    say(`staged the compiled Cockpit from extension/vscode: ${copied.join(", ")}`);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    return 1;
  }

  say(
    "the world is a substitute extension host: a real extension, a real process per action, and a " +
      "module resolution that stands in for the editor's own",
  );
  say(
    "environment.yaml declares no url, so no browser is started: every criterion is an " +
      "extension-host reading",
  );
  say("running: veridian validate --goal <demo>/goal.yaml");

  const code = await runCli([cliPath, "validate", "--goal", goalPath]);
  say(`the run exited ${String(code)}`);
  if (argv.includes("--keep-staged")) {
    say(`--keep-staged: ${stagedSpelling} is left in place; delete it or run again without the flag`);
  }
  say("evidence: .veridian/latest-result.json, .veridian/latest-failure.md, .veridian/runs/<run-id>/");
  return code;
}

process.exitCode = await main().finally(async () => {
  if (!argv.includes("--keep-staged")) await unstage();
});
