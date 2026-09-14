#!/usr/bin/env node
/**
 * The provisioning program: the application's own client for the system it was handed.
 *
 * This is `start.command` in `environment.yaml`, so it is the program the world runs to bring the
 * application up - and it is a real program writing real files, which is the first of the three
 * obligations a simulated world has to meet.
 *
 * ## What it does, in order
 *
 * 1. Reads the sandbox's host path, the world's own spelling of the root, the family, the release and
 *    the account out of its environment. All five are required and it refuses to run without them: a
 *    provisioner that guessed which system it was on would be hardening a machine nobody described, and
 *    the guess would be invisible in the run.
 * 2. Installs its own files into the sandbox - a hardening baseline, a secrets file and the service's
 *    own image - by writing them through `VERIDIAN_OS_HOST`.
 * 3. Issues the commands that make the *system* hold what those files describe: the service account,
 *    the access control entries on the two data files, the configuration store values and the service
 *    definition, followed by the start that makes the world bind a real socket.
 *
 * ## Why `HOST` is where it writes and why the commands never name it
 *
 * The adapter sets two variables for the same directory, and the difference is not decoration:
 *
 *   - `VERIDIAN_OS_HOST` is a path *this machine* can open. Writing through it is how a real file
 *     appears inside the sandbox.
 *   - `VERIDIAN_OS_ROOT` is how the *world* spells the same place - the literal `C:\`. A command line
 *     that named the host path would be a command about the developer's disk, and the world refuses it
 *     - so every argument this program prints is written the second way.
 *
 * ## Why `SEP` is a character code rather than a backslash
 *
 * Every path and every store key in this program is built by joining segments with the separator this
 * family uses, and the separator is obtained from `String.fromCharCode(92)` rather than written as a
 * literal. The reason is the demo, not the application: `defects.ts` injects defects by replacing exact
 * text blocks, and a block carrying `\\\\` inside a JavaScript string literal is a block where one
 * wrong escape is invisible to a reader and produces a table that matches nothing. A file with no
 * escaped backslash in it is a file whose blocks can be quoted verbatim.
 *
 * ## Why stdout carries nothing but command lines
 *
 * `stdout` is the stream the world executes: one JSON argument vector per line, in order. The world
 * parses every line, runs the ones it can and reports each one it could not, so a stray sentence here
 * would arrive as a command the world could not run. Everything a human reads - and the readiness line
 * `start.readyPattern` waits for - goes to `stderr`.
 *
 * ## Why a refusal is reported and not thrown
 *
 * The adapter classifies a non-zero exit from `start.command` as the world failing to start. Exiting
 * non-zero because one command in the list was answered `nonzero` would therefore turn "the service did
 * not come up" into "nothing could be observed", and the criteria would report an environment failure
 * instead of the provisioning defect they exist to find. This program's contract is to install and to
 * issue; whether the system ends up holding what was asked for is what the acceptance criteria decide.
 *
 * ## One thing this program does not do, stated rather than discovered
 *
 * It removes the *provisioning* account's own access control entries from the secrets file - the
 * hardening posture that says the account which installed a secret does not keep it - and it does so by
 * naming the account the world told it the criteria act as. That name is duplicated between this file
 * and `environment.yaml`, and the duplication is load bearing rather than careless: if the two ever
 * disagree, the removal takes nothing and the criterion that asks whether the auditing account can read
 * the file reports `FAIL`, which is exactly the outcome a wrong name deserves. A value that cannot go
 * wrong silently is not the same as a value that is written twice for no reason.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The names the adapter sets.
 *
 * Deliberately `VERIDIAN_OS_*` and not `USERNAME`, `USERDOMAIN`, `SystemRoot`, `USERPROFILE` or `HOME`.
 * This world has no login session and no profile directory, and borrowing the real ecosystem's names
 * would invite the application to behave as though somebody had logged in - which is the one thing a
 * simulated world must not do.
 */
export const OS_ENV = {
  host: "VERIDIAN_OS_HOST",
  root: "VERIDIAN_OS_ROOT",
  family: "VERIDIAN_OS_FAMILY",
  system: "VERIDIAN_OS_SYSTEM",
  user: "VERIDIAN_OS_USER",
};

/** The family's own separator, without a backslash literal anywhere in this file. See the header. */
const SEP = String.fromCharCode(92);

/** The service this program defines and starts. */
export const SERVICE = "cart-web";

/**
 * The account the service runs as.
 *
 * Written into the service definition's `obj=` and created by `net user` below, so the two cannot
 * describe different accounts - and read as state, not as text, by the criterion that asks whether the
 * account exists. A service naming an account nobody created is a service that will not start.
 */
export const SERVICE_ACCOUNT = "svc-cart";

/** The port the service asks for. The world binds exactly this, in answer to the start command. */
export const PORT = 18443;

/**
 * The two directories this program installs into, both of which the world's own seed already holds.
 *
 * The drive letter is written literally rather than taken from `VERIDIAN_OS_ROOT`, which is checked
 * below for exactly this reason: the drive is a *fact about this application* - a Windows provisioner
 * installs under `C:` - and a program that composed its install paths out of whatever root it was
 * handed would be a program that quietly installs somewhere else when handed a different one. `root`
 * is read, agreed with, and then not used to spell a path.
 */
export const DATA_DIR = ["C:", "ProgramData", "Veridian"].join(SEP);
export const PROGRAM_DIR = ["C:", "Program Files", "Veridian"].join(SEP);

/**
 * The hardening baseline, at the path the application's own policy states.
 *
 * A policy file and not a comment: nothing about the file's existence or its access control entries
 * distinguishes a service told to bind loopback from one told to listen on every interface, so this is
 * the one place the binding decision is written down and the one place a reading can find it.
 */
export const POLICY_PATH = [DATA_DIR, "policy.conf"].join(SEP);

/** The secrets file. No criterion in this contract compares its contents, so the secret stays out of the bundle. */
export const SECRETS_PATH = [DATA_DIR, "secrets.env"].join(SEP);

/** The file the service manager is told to run. It is an artifact of this program, not a real executable. */
export const SERVICE_IMAGE = [PROGRAM_DIR, SERVICE + ".cmd"].join(SEP);

/**
 * The service's command line, and the one place the port is declared.
 *
 * The world reads `--port <n>` out of this string when the service is defined, and binds that port for
 * real when the service is started, so a service whose command named a different port would leave the
 * start command binding something no criterion asks about.
 */
export const SERVICE_COMMAND = SERVICE_IMAGE + " --port " + String(PORT);

/**
 * The configuration store key this program writes.
 *
 * Addressed from the hive, because that is how the store is addressed on this family and because the
 * world holds the machine-wide store alone - a per-user key would be a key under an account that does
 * not exist here.
 */
export const POLICY_KEY = ["HKLM", "SOFTWARE", "Veridian", "Policy"].join(SEP);

/** The two values the store holds, and what they say. */
export const BIND_VALUE = "CartWebBind";
export const BIND_ADDRESS = "127.0.0.1";
export const LOG_VALUE = "CartWebLogLevel";
export const LOG_LEVEL = "warn";

/**
 * The account the criteria act as, read from the world rather than guessed.
 *
 * Empty only if the adapter did not set the variable, which {@link main} refuses before anything uses
 * it. Read at module scope so the step list below - and the defect table that quotes it - can name it.
 */
export const AUDIT_ACCOUNT = process.env[OS_ENV.user] ?? "";

/** The baseline's text. Static, so that a criterion can state what it must say. */
export const BASELINE = [
  "# cart-web hardening baseline, installed by provision.mjs",
  "CartWebBind=127.0.0.1",
  "CartWebLogLevel=warn",
  "CartWebListen=loopback-only",
  "",
].join("\n");

/**
 * The secrets file's text.
 *
 * A simulated secret that is not a secret anywhere else. It is written so that the contract can ask
 * whether this world's own account table refuses it while never comparing it: a criterion that read the
 * contents would put the secret in the evidence bundle, and a bundle is meant to be readable.
 */
export const SECRETS = [
  "# installed by provision.mjs; this world's secret, and not a secret anywhere else",
  "CART_WEB_TOKEN=veridian-simulated-token-not-real",
  "",
].join("\n");

/**
 * The service's own image, whose `--port` line is what ties the declaration to the socket.
 *
 * Joined with `\n` regardless of how this checkout stores the file. This is a file inside the sandbox,
 * and the world reads the port out of the *service command* rather than out of this file - but a CRLF
 * copy would still put a `\r` inside the text a criterion compares, and the comparison would fail for a
 * reason that is about the developer's git configuration rather than about the application.
 */
export const SERVICE_IMAGE_TEXT = [
  "@echo off",
  "rem cart-web (simulated): started by the service manager, never by a shell",
  "node cart-web.mjs --port " + String(PORT),
  "",
].join("\n");

/**
 * The files this program installs, at the path the world spells and with the text it writes.
 *
 * Derived from the constants above rather than listed twice, because a list beside the writes is a list
 * free to disagree with them - and the count printed at the end is read off this same array, so the line
 * a reader checks the run against cannot be a literal somebody forgot to update.
 */
export const INSTALLED = [
  { path: POLICY_PATH, text: BASELINE },
  { path: SECRETS_PATH, text: SECRETS },
  { path: SERVICE_IMAGE, text: SERVICE_IMAGE_TEXT },
];

/**
 * The commands this program issues, in order, each as an argument vector rather than a command line.
 *
 * An argument vector because the world resolves the program against its own register and hands the
 * words over unparsed: a shell string would need a shell, and the shell would be a second substitution
 * with its own quoting rules to get wrong.
 *
 * Every one of them is written the way the *system* spells it, and every one is a verb this world
 * answers:
 *
 *   - `net user <name> /add` - creates the service account.
 *   - `icacls <path> /inheritance:r /remove <account>:(R) /grant <account>:(R)` - hardens a file. The
 *     `/remove` and `/grant` arguments are written `<account>:(PERMS)` because that is the form this
 *     world parses; a bare account name is refused by name rather than silently ignored, which is what
 *     stops a hardening step that removed nothing from looking like one that worked.
 *   - `reg add <key> /v <name> /t REG_SZ /d <data>` - writes a store value.
 *   - `sc create <name> binPath= <command> obj= <account>` - defines the service. The `key= value`
 *     pairs are two tokens each, and this world's parser knows that: a parser that treated every word
 *     as an operand would read `binPath= "C:..." obj= svc-cart` as a service whose command is `obj=` and
 *     whose account is nothing at all.
 *   - `sc start <name>` - makes the world bind the declared port for real.
 *   - `netstat -an` - observes the loopback ports this world holds.
 */
export const STEPS = [
  ["net", "user", SERVICE_ACCOUNT, "/add"],
  [
    "icacls", POLICY_PATH,
    "/inheritance:r", "/remove", "Everyone:(R)", "/grant", SERVICE_ACCOUNT + ":(R)",
  ],
  [
    "icacls", SECRETS_PATH,
    "/inheritance:r",
    "/remove", "Everyone:(R)",
    // The account that installed the secret does not keep it. Both permissions are removed, and
    // removing only one is the defect this demo injects: an entry list that no longer names the
    // auditing account *for write* still lets it read, and a criterion that asked only whether the
    // list had been touched would call that hardened.
    "/remove", AUDIT_ACCOUNT + ":(R)",
    "/remove", AUDIT_ACCOUNT + ":(W)",
    "/grant",
    SERVICE_ACCOUNT + ":(R)",
  ],
  ["reg", "add", POLICY_KEY, "/v", BIND_VALUE, "/t", "REG_SZ", "/d", BIND_ADDRESS],
  ["reg", "add", POLICY_KEY, "/v", LOG_VALUE, "/t", "REG_SZ", "/d", LOG_LEVEL],
  ["sc", "create", SERVICE, "binPath=", SERVICE_COMMAND, "obj=", SERVICE_ACCOUNT],
  ["sc", "start", SERVICE],
  ["netstat", "-an"],
];

/** Everything a human reads. `stdout` belongs to the world's command stream. */
const say = (line) => {
  process.stderr.write(`${line}\n`);
};

/** The host path of a sandbox path: the drive is the world's, the rest is this machine's. */
const hostOf = (sandboxPath) => join(process.env[OS_ENV.host] ?? "", ...sandboxPath.split(SEP).slice(1));

async function main() {
  const host = process.env[OS_ENV.host] ?? "";
  const root = process.env[OS_ENV.root] ?? "";
  const family = process.env[OS_ENV.family] ?? "";
  const system = process.env[OS_ENV.system] ?? "";
  const account = process.env[OS_ENV.user] ?? "";

  if (host === "" || root === "" || family === "" || system === "" || account === "") {
    process.stderr.write(
      `cart-web provision: this program needs ${OS_ENV.host}, ${OS_ENV.root}, ${OS_ENV.family}, ` +
        `${OS_ENV.system} and ${OS_ENV.user}, and the environment provided ` +
        `${JSON.stringify({ host, root, family, system, user: account })}\n`,
    );
    return 2;
  }

  // Refused rather than adapted. This program provisions a Windows machine - it installs under `C:`, it
  // writes the machine-wide configuration store and it creates its service with `sc` - so a world that
  // announced itself as a different family is a world this program cannot provision, and saying so here
  // is what keeps a wrong plan from being reported as a provisioning defect. Adapting instead would need
  // a second path table and a second store, which is a second application wearing this one's name.
  if (family !== "windows") {
    process.stderr.write(
      `cart-web provision: this program provisions a windows machine and the world announced ` +
        `${JSON.stringify(family)}\n`,
    );
    return 2;
  }

  say(`cart-web provision: the world's root is ${root} and this machine opens it at ${host}`);
  say(`cart-web provision: standing in for ${family} ${system}, acting as ${account}`);

  for (const file of INSTALLED) {
    const target = hostOf(file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.text, "utf8");
    say(`cart-web provision: ${file.path} written, ${String(file.text.length)} bytes`);
  }

  for (const argv of STEPS) {
    // One JSON array per line, on `stdout`, because that is the stream the world executes. The word
    // after the program name is a command, not an instruction to this program.
    process.stdout.write(`${JSON.stringify(argv)}\n`);
  }

  say(
    `cart-web provisioned: ${String(INSTALLED.length)} files installed, ` +
      `${String(STEPS.length)} commands issued on ${system}`,
  );
  return 0;
}

process.exitCode = await main();
