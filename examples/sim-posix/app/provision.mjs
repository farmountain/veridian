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
 * 1. Reads the sandbox's host path, the world's own spelling of the root, the distribution and the
 *    account out of its environment. All four are required and it refuses to run without them: a
 *    provisioner that guessed where the system was would be hardening a tree nobody described, and the
 *    guess would be invisible in the run.
 * 2. Installs its own files into the sandbox - a hardening baseline, a secrets file and a service unit
 *    - by writing them through `VERIDIAN_POSIX_HOST`.
 * 3. Issues the commands that make the system hold what those files describe: the packages, the
 *    service account, the owners and modes, and the unit's own start.
 *
 * ## Why `HOST` is where it writes and why the commands never name it
 *
 * The adapter sets two variables for the same directory, and the difference is not decoration:
 *
 *   - `VERIDIAN_POSIX_HOST` is a path *this machine* can open. Writing through it is how a real file
 *     appears inside the sandbox.
 *   - `VERIDIAN_POSIX_ROOT` is how the *world* spells the same place, which is the literal `/`. A
 *     command line that named the host path would be a command about the developer's disk, and the
 *     world refuses it - so every argument this program prints is written the second way.
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
 * non-zero because one command in the list was answered `nonzero` would therefore turn "the service
 * did not come up" into "nothing could be observed", and the criteria would report an environment
 * failure instead of the provisioning defect they exist to find. This program's contract is to install
 * and to issue; whether the system ends up holding what was asked for is what the acceptance criteria
 * decide.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The names the adapter sets.
 *
 * Deliberately `VERIDIAN_POSIX_*` and not `HOME`, `PATH`, `SHELL` or `USER`. This world has no login
 * environment, and borrowing the real ecosystem's names would invite the application to behave as
 * though somebody had logged in - which is the one thing a simulated world must not do.
 */
export const POSIX_ENV = {
  host: "VERIDIAN_POSIX_HOST",
  root: "VERIDIAN_POSIX_ROOT",
  distribution: "VERIDIAN_POSIX_DISTRIBUTION",
  user: "VERIDIAN_POSIX_USER",
};

/** The unit this program installs and starts. */
export const SERVICE = "cart-web";

/**
 * The account the unit runs as.
 *
 * Written into the unit's `User=` line and created by `adduser` below, so the two cannot describe
 * different accounts - and read as state, not as text, by the criterion that asks whether the account
 * exists. A unit naming an account nobody created is a unit that will not start.
 */
export const SERVICE_ACCOUNT = "cart";

/** The port the unit asks for. The world binds exactly this, in answer to the `systemctl start`. */
export const PORT = 18080;

/** The account's own data directory, created below and named as its home. */
export const DATA_DIR = "/var/lib/cart-web";

/**
 * The hardening baseline, at the path the application's own policy states.
 *
 * A policy file and not a comment: nothing about the file's existence, mode or owner distinguishes a
 * service told to bind loopback from one told to listen on every interface, so this is the one place
 * the binding decision is written down and the one place a reading can find it.
 */
export const BASELINE_PATH = "/etc/veridian/policy.conf";

/** The secrets file. No criterion in this contract compares its contents, so the secret stays out of the bundle. */
export const SECRETS_PATH = "/etc/veridian/secrets.env";

/**
 * The mode the secrets file must carry.
 *
 * Compared as *text* by the criterion that reads it, and written here as a four-digit string because
 * that is the spelling a mode has: `0600` is a permission set rather than a quantity, so a comparison
 * that treated it as a number would make `600` and `0600` different values for one mode.
 */
export const SECRETS_MODE = "0600";

/** The packages this program installs, in the order it names them. */
export const PACKAGES = ["ufw", "fail2ban"];

/** The baseline's text. Static, so that a criterion can state what it must say. */
export const BASELINE = [
  "# cart-web hardening baseline, installed by provision.mjs",
  "CART_WEB_BIND=127.0.0.1",
  "CART_WEB_LOG_LEVEL=warn",
  "CART_WEB_TIMEOUT_SECONDS=15",
  "",
].join("\n");

/**
 * The secrets file's text.
 *
 * A simulated secret that is not a secret anywhere else. It is written so that the contract can ask
 * whether this world's own account table refuses it while never comparing it: a criterion that read
 * the contents would put the secret in the evidence bundle, and a bundle is meant to be readable.
 */
export const SECRETS = [
  "# installed by provision.mjs; this world's secret, and not a secret anywhere else",
  "CART_WEB_TOKEN=veridian-simulated-token-not-real",
  "",
].join("\n");

/**
 * The unit's text.
 *
 * Interpolated rather than literal so the unit and the `adduser` command describe one account. The
 * `Port=` line is the whole reason `systemctl start` binds a socket: the world reads it out of this
 * file, so a unit naming a different port would leave the port criterion judging a socket nobody bound.
 *
 * Joined with `\n` regardless of how this checkout stores the file. A unit file inside the sandbox is
 * a Linux file, and the world's parser reads `Port=(\d+)$` line by line - a CRLF copy would put a `\r`
 * between the digits and the end of the line, and the unit would start without binding anything.
 */
export function unitText(account) {
  return [
    "[Unit]",
    "Description=cart-web (simulated)",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/bin/cart-web --bind 127.0.0.1",
    `Port=${PORT}`,
    `User=${account}`,
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

/** Where the unit belongs in the world's own spelling. */
export const UNIT_PATH = `/etc/systemd/system/${SERVICE}.service`;

/**
 * The files this program installs, at the path the world spells and with the text it writes.
 *
 * Derived from the two constants above rather than listed twice, because a list beside the writes is a
 * list free to disagree with them - and the count printed at the end is read off this same array, so
 * the line a reader checks the run against cannot be a literal somebody forgot to update.
 */
export const INSTALLED = [
  { path: BASELINE_PATH, text: BASELINE },
  { path: SECRETS_PATH, text: SECRETS },
  { path: UNIT_PATH, text: unitText(SERVICE_ACCOUNT) },
];

/**
 * The commands this program issues, in order, each as an argument vector rather than a command line.
 *
 * An argument vector because the world resolves the program against its own register and hands the
 * words over unparsed: a shell string would need a shell, and the shell would be a second substitution
 * with its own quoting rules to get wrong.
 */
export const STEPS = [
  ["apt-get", "install", "-y", ...PACKAGES],
  ["adduser", "--system", "--home", DATA_DIR, SERVICE_ACCOUNT],
  ["chown", "root:root", BASELINE_PATH],
  ["chown", "root:root", SECRETS_PATH],
  ["chmod", SECRETS_MODE, SECRETS_PATH],
  ["systemctl", "enable", SERVICE],
  ["systemctl", "start", SERVICE],
  ["nmap", "-p", String(PORT), "127.0.0.1"],
];

/** Everything a human reads. `stdout` belongs to the world's command stream. */
const say = (line) => {
  process.stderr.write(`${line}\n`);
};

async function main() {
  const host = process.env[POSIX_ENV.host] ?? "";
  const root = process.env[POSIX_ENV.root] ?? "";
  const distribution = process.env[POSIX_ENV.distribution] ?? "";
  const account = process.env[POSIX_ENV.user] ?? "";

  if (host === "" || root === "" || distribution === "" || account === "") {
    process.stderr.write(
      `cart-web provision: this program needs ${POSIX_ENV.host}, ${POSIX_ENV.root}, ` +
        `${POSIX_ENV.distribution} and ${POSIX_ENV.user}, and the environment provided ` +
        `${JSON.stringify({ host, root, distribution, user: account })}\n`,
    );
    return 2;
  }

  say(`cart-web provision: the world's root is ${root} and this machine opens it at ${host}`);
  say(`cart-web provision: standing in for ${distribution}, acting as ${account}`);

  // The account's data directory, before the account is created: a system's own order, and the reason
  // `adduser` can be told a home that already exists.
  mkdirSync(join(host, DATA_DIR), { recursive: true });
  say(`cart-web provision: ${DATA_DIR} ready`);

  for (const file of INSTALLED) {
    const target = join(host, file.path);
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
      `${String(STEPS.length)} commands issued on ${distribution}`,
  );
  return 0;
}

process.exitCode = await main();
