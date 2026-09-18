#!/usr/bin/env node
/**
 * `cart-handset` - the application this world is asked to judge.
 *
 * It is a real Node program, started as a real child process with this operator's own privileges, and
 * the only thing standing in for anything is the device it provisions. There is no emulator, no
 * instruction translator, no guest kernel, no display, no input pipeline, no keychain service, no
 * store and no push service anywhere in this file's life.
 *
 * Four rules it follows, each of which is a rule this repository has already paid for:
 *
 *   1. **stdout carries command vectors and nothing else.** The substitute skips a line it cannot read
 *      as a JSON array, with a warning - so a stray `console.log` would be *silently dropped* rather
 *      than failing, and the run would look healthy while a command was missing. Every human-readable
 *      line goes to stderr through `say()`.
 *   2. **Every path a command names is the device's own spelling.** The substitute resolves a path
 *      against the application's own tree or against the sandbox and refuses anything else *by
 *      recording the attempt*, so an absolute path from this machine would be a boundary crossing
 *      rather than a resource.
 *   3. **A command expected to be refused is still issued.** A substitute that answered every command
 *      would report a factory reset it never performed, and no criterion could notice.
 *   4. **The figures it announces are counted, not declared.** The completeness line reads the lengths
 *      of the arrays this program really sent, so no test may look for that sentence in this source -
 *      it is not a literal anywhere in this file, and a test that asserted it was would be asserting a
 *      property of a string that does not exist.
 *
 * It never reads stdin: the runtime spawns it with stdin ignored, so a prompt would reach EOF rather
 * than wait, and a criterion waiting for the prompt would wait forever.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The four names this world declares, read out of the environment rather than restated.
 *
 * `VERIDIAN_MOBILE_SANDBOX` is a path *this machine* can open - it is how the application learns where
 * its tree lives - while every path a command names is the device's spelling. The world declares both
 * because they are two different facts, and the machine family already paid for conflating them.
 */
const MOBILE_ENV = Object.freeze({
  sandbox: "VERIDIAN_MOBILE_SANDBOX",
  workspace: "VERIDIAN_MOBILE_WORKSPACE",
  device: "VERIDIAN_MOBILE_DEVICE",
  platform: "VERIDIAN_MOBILE_PLATFORM",
});

/** The one platform this application is written for. Anything else is refused by name. */
const PLATFORM = "android";

/**
 * The device's spelling of the directory a command may name. Never this machine's.
 *
 * It matches `MOBILE_WORKSPACE` in the substitute, and the check in `main()` is why: an application
 * a real device runs was built against one directory, so the world declaring a different one is a
 * mismatch worth refusing rather than adapting to. The value is read off the world's own declaration
 * (`adapters/sim-mobile/sim-mobile-environment.ts`) rather than guessed - the first draft said
 * `/workspace` and the run refused it by name, which is the check working.
 */
const WORKSPACE = "/data/local/tmp/workspace";

const DEVICE_MODEL = "Veridian Pixel 8";
const DEVICE_MANUFACTURER = "Veridian";
const OS_NAME = "Android";
const OS_VERSION = "14";
const API_LEVEL = 34;
const WIDTH = 1080;
const HEIGHT = 2400;
const DENSITY = 420;
const SCALE = "2.625";
const LOCALE = "en-US";
const ORIENTATION = "landscape";

const APPLICATION = "com.veridian.cart";
const NAME = "Cart";
const RELEASE = "1.4.0";
const VERSION_CODE = 14;
const ENTRY = "main.mjs";
const SOURCE = "./context/cart";
const CAMERA = "android.permission.CAMERA";
const CAMERA_KEY = "camera";

const CHANNEL = "cart-updates";
const DEEP_LINK = "veridian://cart";
const DEEP_LINK_PROFILE = "veridian://cart/profile";
const DEEP_LINK_ROUTE = "veridian://cart/item";
const SESSION_KEY = "session-token";
const SESSION_VALUE = "cart-session-2f9c04";
const ACCESSIBLE = "when-unlocked";

// ---------------------------------------------------------------------------------------------
// The bundle's own files
//
// Each is authored as an array of lines joined with "\n" rather than as one block, so a defect can
// name a single line of one file without dragging its neighbours into the edit. The entry point is a
// real program: the substitute launches it as a real child process with this runtime, which is why the
// two output streams a criterion reads are the streams a process really wrote.
// ---------------------------------------------------------------------------------------------

const MAIN_SOURCE = [
  'import { readFileSync } from "node:fs";',
  'import { dirname, join } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  "",
  'const here = dirname(fileURLToPath(import.meta.url));',
  'const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));',
  'const say = (line) => { process.stderr.write(line + "\\n"); };',
  "",
  'process.stdout.write(manifest.name + " " + manifest.version + " ready\\n");',
  'say("cart-handset: offline cache is read-only");',
  'say("cart-handset: " + String(manifest.files.length) + " file(s) installed");',
  'if (process.argv.length > 2) {',
  '  say("cart-handset: handed " + process.argv.slice(2).join(" "));',
  '}',
].join("\n") + "\n";

const CART_SOURCE = [
  "// The cart itself. Plain functions over plain objects, so the bundle has no dependency to install",
  "// and the digest the device computes is a digest over files this program wrote.",
  "export function total(lines) {",
  "  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);",
  "}",
  "",
  "export function add(lines, line) {",
  "  return [...lines, line];",
  "}",
  "",
  "export function remove(lines, sku) {",
  "  return lines.filter((line) => line.sku !== sku);",
  "}",
].join("\n") + "\n";

const CHECKOUT_SOURCE = [
  'import { total } from "./cart.js";',
  "",
  "export function format(cents) {",
  '  return (cents / 100).toFixed(2);',
  "}",
  "",
  "export function summary(lines) {",
  '  return String(lines.length) + " item(s), " + format(total(lines));',
  "}",
].join("\n") + "\n";

const README_SOURCE = [
  "# Cart",
  "",
  "Installed by `provision.mjs` into a substitute device. Nothing here is a claim about a handset",
  "that exists; it is a claim about the tree the device was asked to hold.",
  "",
].join("\n") + "\n";

const SOURCES = [
  { path: "main.mjs", text: MAIN_SOURCE },
  { path: "cart.js", text: CART_SOURCE },
  { path: "checkout.js", text: CHECKOUT_SOURCE },
  { path: "README.md", text: README_SOURCE },
];

/**
 * The files the device will end up holding, counted from the list rather than declared beside it.
 *
 * `manifest.json` is written by this program too, so it belongs in the count and in the manifest's own
 * `files` array. A world that read a declared number would report a bundle of whatever size the
 * application claimed rather than the size it installed.
 */
const BUNDLE_FILES = [...SOURCES.map((entry) => entry.path), "manifest.json"].sort();

const MANIFEST_SOURCE = [
  "{",
  '  "id": "' + APPLICATION + '",',
  '  "name": "' + NAME + '",',
  '  "version": "' + RELEASE + '",',
  '  "versionCode": ' + String(VERSION_CODE) + ",",
  '  "entry": "' + ENTRY + '",',
  '  "permissions": ["' + CAMERA + '"],',
  '  "files": [',
  ...BUNDLE_FILES.map((name, index) => '    "' + name + '"' + (index === BUNDLE_FILES.length - 1 ? "" : ",")),
  "  ]",
  "}",
].join("\n") + "\n";

// ---------------------------------------------------------------------------------------------
// The commands
//
// Every vector is `[noun, verb, ...flags, ...subject, ...tail]`. The substitute reads the first word
// that is not a flag as the command's subject, so a value flag must never be written where a subject
// belongs - and the subject is the *first* operand, never the second. `permission.grant` and
// `deepLink.register` both take the bundle id as their subject, with the permission key and the URI
// after it. Getting that order backwards names a bundle that does not exist, so the world refuses the
// call and nothing is granted - which is a failure `mobile.permission` reads and `mobile.call` does not.
//
// The first vector names no action at all, on purpose: this world answers a closed register written as
// two words, and a command outside it is refused rather than ignored. That refusal is a *result* in the
// reading rather than an exception, which is why the commands after it still run.
// ---------------------------------------------------------------------------------------------

const COMMANDS = [
  // A command this world does not serve.
  ["device", "factoryReset"],

  // The handset comes up. Every flag is a value the readings are computed from.
  [
    "device", "boot",
    "--model", DEVICE_MODEL,
    "--manufacturer", DEVICE_MANUFACTURER,
    "--os", OS_NAME,
    "--api-level", String(API_LEVEL),
    "--locale", LOCALE,
    "--width", String(WIDTH),
    "--height", String(HEIGHT),
    "--density", String(DENSITY),
    "--scale", SCALE,
  ],

  ["device", "rotate", "--orientation", ORIENTATION],

  // The bundle, installed from the tree this program just wrote into its own directory.
  [
    "bundle", "install", SOURCE,
    "--id", APPLICATION,
    "--name", NAME,
    "--version", RELEASE,
    "--version-code", String(VERSION_CODE),
    "--entry", ENTRY,
    "--permission", CAMERA,
  ],

  ["bundle", "launch", APPLICATION],

  ["permission", "grant", APPLICATION, CAMERA_KEY],

  ["deepLink", "register", APPLICATION, DEEP_LINK],
  ["deepLink", "register", APPLICATION, DEEP_LINK_PROFILE],
  ["deepLink", "open", DEEP_LINK_ROUTE],

  [
    "notification", "post", APPLICATION,
    "--channel", CHANNEL,
    "--title", "Order ready",
    "--body", "Order 4471 is ready on " + NAME + " " + RELEASE,
    "--priority", "normal",
  ],

  [
    "keychain", "set", SESSION_KEY, APPLICATION,
    "--value", SESSION_VALUE,
    "--accessible", ACCESSIBLE,
  ],

  ["logs", "read", APPLICATION],
];

/** Every human-readable line, on stderr, where a reader looks and a parser does not. */
const say = (line) => {
  process.stderr.write(line + "\n");
};

const required = (name) => {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
};

/** The directory this program writes its bundle sources into: its own tree, never the sandbox. */
const contextDir = join(dirname(fileURLToPath(import.meta.url)), "context");

async function main() {
  const sandbox = required(MOBILE_ENV.sandbox);
  const workspace = required(MOBILE_ENV.workspace);
  const device = required(MOBILE_ENV.device);
  const platform = required(MOBILE_ENV.platform);

  const missing = [];
  if (sandbox === null) missing.push(MOBILE_ENV.sandbox);
  if (workspace === null) missing.push(MOBILE_ENV.workspace);
  if (device === null) missing.push(MOBILE_ENV.device);
  if (platform === null) missing.push(MOBILE_ENV.platform);

  if (missing.length > 0) {
    say("cart-handset: this program is the device's provisioner, and the world that stands the device in is what runs it.");
    say("cart-handset: it reads " + Object.values(MOBILE_ENV).join(", ") + ".");
    say("cart-handset: missing " + missing.join(", "));
    return 2;
  }

  if (platform !== PLATFORM) {
    say("cart-handset: this application is written for " + PLATFORM + ", and it refuses any other platform by name rather than adapting to it, because the path grammar a device answers with is part of what that device is.");
    say("cart-handset: the world declared " + JSON.stringify(platform));
    return 3;
  }

  if (workspace !== WORKSPACE) {
    say("cart-handset: it is built against the workspace " + JSON.stringify(WORKSPACE) + " and the world declared " + JSON.stringify(workspace));
    return 3;
  }

  say("cart-handset: device " + JSON.stringify(device) + ", platform " + platform + ", model " + JSON.stringify(DEVICE_MODEL));
  say("cart-handset: sandbox " + JSON.stringify(sandbox) + " - this machine can open that path, and no command below names it");
  say("cart-handset: every path a command names is the device's spelling, and " + JSON.stringify(SOURCE) + " resolves against this program's own tree");

  rmSync(contextDir, { recursive: true, force: true });
  mkdirSync(join(contextDir, "cart"), { recursive: true });
  for (const entry of SOURCES) {
    writeFileSync(join(contextDir, "cart", entry.path), entry.text, "utf8");
  }
  writeFileSync(join(contextDir, "cart", "manifest.json"), MANIFEST_SOURCE, "utf8");

  say("cart-handset: wrote " + String(BUNDLE_FILES.length) + " file(s) into " + JSON.stringify(SOURCE) + ": " + BUNDLE_FILES.join(", "));

  for (const argv of COMMANDS) {
    process.stdout.write(JSON.stringify(argv) + "\n");
  }

  say(APPLICATION + " provisioned: " + String(BUNDLE_FILES.length) + " files, " + String(COMMANDS.length) + " commands");
  return 0;
}

process.exitCode = await main();
