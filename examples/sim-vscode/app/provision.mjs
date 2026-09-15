/**
 * The application under test: a provisioning program that installs an extension into a host.
 *
 * On a machine with no editor on it, this is the only way a program can install an extension: it hands
 * the host a command and reads the host's answer. So this program never touches a generated copy of the
 * extension. It *names* the directory the extension source lives in - a directory that is committed
 * source, the same way `cart.js` is committed source in the browser demo - and the world installs it.
 *
 * ## The two streams, and why they are two
 *
 * `stdout` is a **command-vector stream** and nothing else: one JSON array of strings per line, each one
 * a command this application is asking the world to perform. The world parses every stdout line as a
 * vector, so a stray human sentence here would be a line the world reports as unreadable rather than a
 * line it silently ignores.
 *
 * `stderr` is everything a person reads. That includes the readiness line, which this program prints
 * **last**, because it is a claim about the work having been done rather than an instruction.
 *
 * ## What this program does not do
 *
 * It does not read its own stdin (a child process here gets an immediate EOF rather than a prompt, so a
 * program that waited for input would hang rather than fail). It does not decide whether it succeeded:
 * the world's own inventory and the contract decide that, from what the world holds afterwards.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The names this world passes in. Declared once, and read out of this file by the adapter's test. */
export const VSCODE_ENV = {
  sandbox: "VERIDIAN_VSCODE_SANDBOX",
  workspace: "VERIDIAN_VSCODE_WORKSPACE",
  host: "VERIDIAN_VSCODE_HOST",
  apiVersion: "VERIDIAN_VSCODE_API_VERSION",
};

export const APPLICATION = "cart-web";
export const EXTENSION_DIR = "extension";
export const REPORT_FILE = "report.json";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * The commands this application asks the world to perform, in the order it asks for them.
 *
 * `install` and the two `invoke`s are the work. `configure` is the setting the extension reads at the
 * moment it is invoked rather than at the moment it is installed - the same fact an operator changes in
 * `settings.json` on a real machine, and the reason a criterion can tell a setting that reached the
 * extension from one that only reached the manifest.
 *
 * `uninstall` is deliberate and is the last thing asked for: this program removes any earlier
 * installation of itself before installing, and **this world does not serve a removal route**. The
 * refusal is recorded rather than thrown away, which is what makes "the application asked for something
 * this world does not implement" an observation a criterion can read.
 */
export const STEPS = [
  ["install", EXTENSION_DIR + "/package.json"],
  ["configure", "cart-web.limit", "12"],
  ["activate"],
  ["invoke", "cart.add", "widget"],
  ["invoke", "cart.add", "gizmo"],
  ["uninstall", APPLICATION],
];

const say = (line) => {
  process.stderr.write(`${line}\n`);
};

function main() {
  const sandbox = process.env[VSCODE_ENV.sandbox] ?? "";
  const workspace = process.env[VSCODE_ENV.workspace] ?? "";
  const host = process.env[VSCODE_ENV.host] ?? "";
  const apiVersion = process.env[VSCODE_ENV.apiVersion] ?? "";

  const missing = [
    [VSCODE_ENV.sandbox, sandbox],
    [VSCODE_ENV.workspace, workspace],
    [VSCODE_ENV.host, host],
    [VSCODE_ENV.apiVersion, apiVersion],
  ]
    .filter((entry) => entry[1] === "")
    .map((entry) => entry[0]);
  if (missing.length > 0) {
    say(
      `${APPLICATION} provisions an extension host, and these names were not set: ${missing.join(", ")}. ` +
        "This program has no way to find the world it was handed without them.",
    );
    return 3;
  }

  const manifestPath = join(HERE, EXTENSION_DIR, "package.json");
  const entryPath = join(HERE, EXTENSION_DIR, "extension.js");
  if (!existsSync(manifestPath) || !existsSync(entryPath)) {
    say(
      `${APPLICATION} was asked to install ${manifestPath}, and ${existsSync(manifestPath) ? entryPath : manifestPath} is not there. ` +
        "The extension is the input this program installs, so a missing one is a fact about this checkout rather than about the world.",
    );
    return 3;
  }

  say(`${APPLICATION} is installing ${EXTENSION_DIR}/package.json into ${host} answering API ${apiVersion}`);
  say(`this application has no editor of its own, so its sandbox is ${sandbox} and its workspace is ${workspace}`);

  // The report the extension's own test suite would produce, written where a criterion can measure it.
  // One file, a stable spelling, and no state derived from it: the world reads the file, not this
  // program's opinion about the file.
  const report = `${JSON.stringify(
    { application: APPLICATION, commands: STEPS.length, host: host, apiVersion: apiVersion },
    null,
    2,
  )}\n`;
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, REPORT_FILE), report, "utf8");
  say(`${REPORT_FILE} written into the workspace: ${String(Buffer.byteLength(report, "utf8"))} bytes`);

  const limit = STEPS[1][2];
  say(`the manifest declares a cart limit of its own, and this run configures ${limit} over it`);

  for (const argv of STEPS) {
    process.stdout.write(`${JSON.stringify(argv)}\n`);
  }

  say(`${APPLICATION} provisioned: ${String(STEPS.length)} commands on ${host}`);
  return 0;
}

process.exitCode = main();
