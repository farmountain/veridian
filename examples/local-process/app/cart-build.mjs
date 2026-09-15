#!/usr/bin/env node
/**
 * cart-build - the application the `local-process` world starts, provisions and judges.
 *
 * ## Why a build tool
 *
 * A build is the one kind of program whose result an operator reads as an *exit code*. That matters
 * more than it sounds: an exit code is the classic thing a stand-in lies about, because a substitute
 * can always print "done" and return zero. Here the code comes from `process.exitCode` on a real
 * child process that a real kernel reaped, so a criterion written as "this command exits zero" is a
 * statement about the operating system rather than about a narration. Nothing about this file is
 * simulated, which is why its world carries no `simulated` field at all.
 *
 * ## Two ways to act on the world, and they are different
 *
 *   `run` steps   the criterion itself issues an argument vector; this program is the program that
 *                 vector names, run in a fresh process whose only memory is the files on disk
 *   `start`       the world spawns `daemon` once and keeps it alive, so a reading can ask whether a
 *                 program is *still running* - a question no `run` step can answer, because a `run`
 *                 step is over by the time anything is observed
 *
 * ## What this program may not do
 *
 * It may not read stdin. The adapter spawns every child with `stdio: ["ignore", "pipe", "pipe"]`, so
 * a program that prompted would receive an immediate EOF rather than a person - and a criterion that
 * waited for the prompt would wait for the run's whole deadline. Every argument therefore arrives in
 * `argv` and every answer leaves through an exit code.
 *
 * ## Paths
 *
 * Every path resolves against `VERIDIAN_PROCESS_ROOT`, which is the sandbox the world created. A
 * program that wrote beside its own source would be writing into the repository, and the world would
 * have no idea - the whole point of the directory is that removing it removes everything this program
 * ever did.
 *
 * ## The exit code is a contract, and it carries more than success
 *
 *   0   did what was asked
 *   2   the command line was unusable, or `dist/` was never built
 *   4   `verify` found the tree and the manifest disagreeing
 *
 * `4` rather than `1` on purpose. `1` is what an uncaught exception produces, and a criterion that
 * could not tell "the tree is inconsistent" from "the program fell over" would report the second as
 * the first - it would accuse the application of a defect the runtime caused. The two codes are
 * different facts and they are given different numbers.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = process.env["VERIDIAN_PROCESS_ROOT"] ?? ".";
const DIST = join(ROOT, "dist");
const CHANNEL = process.env["CART_BUILD_CHANNEL"] ?? "dev";
const RELEASE_VERSION = "1.4.0";
const MANIFEST = "manifest.json";

/**
 * The three assets a release is made of. Written as literals rather than read from a directory,
 * because a build's output has to be a function of its inputs and this program has exactly one input
 * it does not read from the tree: itself.
 */
const ASSETS = [
  {
    name: "cart.js",
    body: "export const total = (items) => items.reduce((sum, item) => sum + item.cents * item.qty, 0);\n",
  },
  {
    name: "cart.css",
    body: ".cart { display: grid; gap: 8px; }\n.cart__row { font-variant-numeric: tabular-nums; }\n",
  },
  {
    name: "index.html",
    body: '<!doctype html>\n<title>Cart</title>\n<script type="module" src="cart.js"></script>\n',
  },
];

/**
 * The one place this program writes.
 *
 * Named rather than called inline at each site for a reason a reader of the bundle can check: a
 * defect injected into a *stream* is a defect whose target is a criterion, and two call sites written
 * the same way would make the injected text ambiguous between them.
 */
function say(stream, line) {
  const out = stream === "err" ? process.stderr : process.stdout;
  out.write(`${line}\n`);
}

async function sizeOf(path) {
  try {
    const body = await readFile(path);
    return body.byteLength;
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Produce the release.
 *
 * `dist` is removed before it is created rather than merged into. A build that layered its output on
 * top of whatever was there would let a file from a previous release survive into one claiming to
 * contain only what it wrote - which is the property `verify` exists to check, and a build that could
 * not satisfy it could only be verified by a build that did not.
 */
async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const asset of ASSETS) {
    await writeFile(join(DIST, asset.name), asset.body, "utf8");
  }

  const manifest = {
    name: "cart-web",
    channel: CHANNEL,
    version: RELEASE_VERSION,
    files: ASSETS.map((asset) => ({ name: asset.name, bytes: Buffer.byteLength(asset.body, "utf8") })),
  };
  await writeFile(join(DIST, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Read off the arrays that were actually written rather than stated as a literal. A completeness
  // line that counts something other than what it did is a claim, and this one is a measurement.
  const written = ASSETS.length + 1;
  say("out", `cart-build: wrote ${written} files into dist at version ${RELEASE_VERSION}`);
  return 0;
}

/**
 * Check the tree against the manifest the build wrote.
 *
 * This is the half of the program that is worth judging, because it holds two independent facts and
 * reports the one that is false:
 *
 *   the tree    which names are present, compared with the manifest's own list - a name that is
 *               missing and a name that is extra are two different faults
 *   the bytes   for each name in the manifest, the length on disk measured against the length the
 *               manifest declares
 *
 * A verifier that only re-printed the manifest would have verified nothing, so neither half may be
 * inferred from the other: the sizes are read from the filesystem, and the name list is read from
 * the directory.
 */
async function verify() {
  let present;
  try {
    present = (await readdir(DIST)).sort();
  } catch (error) {
    say("err", `verify: dist could not be read: ${error.message}`);
    return 2;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(DIST, MANIFEST), "utf8"));
  } catch (error) {
    say("err", `verify: the manifest could not be read: ${error.message}`);
    return 4;
  }

  const expected = [...ASSETS.map((asset) => asset.name), MANIFEST].sort();
  const problems = [];

  const missing = expected.filter((name) => !present.includes(name));
  const stray = present.filter((name) => !expected.includes(name));
  if (missing.length > 0) problems.push(`missing files: ${missing.join(", ")}`);
  if (stray.length > 0) problems.push(`unexpected files: ${stray.join(", ")}`);

  for (const entry of manifest.files ?? []) {
    const actual = await sizeOf(join(DIST, entry.name));
    if (actual === null) {
      problems.push(`${entry.name} is named by the manifest and is not in the tree`);
      continue;
    }
    if (actual !== entry.bytes) {
      problems.push(`the manifest says ${entry.name} is ${entry.bytes} bytes and it is ${actual}`);
    }
  }

  if (problems.length > 0) {
    say("err", `verify: ${problems.join("; ")}`);
    return 4;
  }

  // The version is quoted from the manifest rather than from this file's own constant, because the
  // question "does the release state the version it was built at" is only answerable by reading the
  // release. A line built from the constant would agree with itself and prove nothing.
  say("out", `verify: ${expected.length} files consistent with the manifest at version ${manifest.version}`);
  return 0;
}

/** Write one extra file into the world, so a criterion can make a tree disagree with its manifest. */
async function add(relative) {
  if (relative === undefined || relative === "") {
    say("err", "cart-build: add needs a path");
    return 2;
  }
  const path = join(ROOT, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `written by cart-build add: ${relative}\n`, "utf8");
  say("out", `cart-build: added ${relative}`);
  return 0;
}

/**
 * Stay alive and say so once.
 *
 * The banner is the readiness signal the environment document names, and it is printed *before* the
 * loop is held open, so a criterion that reads it is reading something that was true when the world
 * declared itself ready rather than something that will be true later.
 *
 * There is no socket. A world that bound a port would be claiming a surface it does not have, and a
 * sibling adapter in this repository already paid for the opposite mistake - a published port that
 * was never reachable. This program is a process, and the only thing it publishes is that it is one.
 */
async function daemon() {
  say("out", `cart-build audit daemon ready (channel ${CHANNEL}, root ${ROOT}, version ${RELEASE_VERSION})`);
  process.on("SIGTERM", () => {
    process.exitCode = 0;
    process.exit(0);
  });
  process.on("SIGINT", () => {
    process.exitCode = 0;
    process.exit(0);
  });
  setInterval(() => {}, 60_000);
  // `null` and not `0`: a zero here would mean "this command finished", and a command that finished
  // is not a command that is running. The world reads the difference and a criterion can ask for it.
  return null;
}

const [command = "", ...rest] = process.argv.slice(2);

let code = null;
if (command === "daemon") {
  code = await daemon();
} else if (command === "build") {
  code = await build();
} else if (command === "verify") {
  code = await verify();
} else if (command === "add") {
  code = await add(rest[0]);
} else {
  say("err", `cart-build: unknown command ${command === "" ? "(none)" : command}`);
  code = 2;
}

if (code !== null) process.exitCode = code;
