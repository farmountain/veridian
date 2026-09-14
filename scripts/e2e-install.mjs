#!/usr/bin/env node
/**
 * Install the browser sandbox, on demand.
 *
 *   node scripts/e2e-install.mjs            install if needed (about 150 MB)
 *   node scripts/e2e-install.mjs --check    report whether it is usable, install nothing
 *   node scripts/e2e-install.mjs --force    reinstall the npm package even if it is present
 *
 * Playwright is deliberately *not* a declared dependency of this repository, and the reason is not
 * bundle size. Veridian's Core, its contracts, its validators and its CLI all run and are all tested
 * without a browser; the browser is an adapter's optional capability, reached through a non-literal
 * module specifier so that a missing Playwright is a classified `ENVIRONMENT_FAILURE` naming a
 * remedy, not a crash on import. Making it a hard dependency would move a remote 150 MB download
 * into the critical path of every gate run, and the first thing a slow download would break is the
 * discipline of running the gate.
 *
 * Written as a script rather than a `package.json` one-liner because it has to branch - resolve,
 * decide, install, download - and because POSIX-only shell in an npm script fails on this project's
 * primary platform (see AGENTS.md).
 */

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function say(line) {
  process.stdout.write(`e2e-install: ${line}\n`);
}

/** Is `playwright` importable from here? Returns the module, or `null` with the reason. */
async function resolvePlaywright() {
  try {
    return { module: await import("playwright"), reason: null };
  } catch (error) {
    return { module: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      say(`could not run ${command}: ${error.message}`);
      resolve(1);
    });
  });
}

async function main() {
  const found = await resolvePlaywright();

  if (argv.includes("--check")) {
    if (found.module === null) {
      say(`Playwright is not installed here (${found.reason ?? "unresolved"})`);
      say("run `npm run e2e:install` to download it. `npm run demo:no-browser` runs without it and");
      say("shows the loop refusing to judge what it could not observe - not the passing demo.");
      return 1;
    }
    say("Playwright is installed; the browser sandbox is available");
    return 0;
  }

  if (found.module !== null && !argv.includes("--force")) {
    say("the playwright package is already installed");
  } else {
    say("installing the playwright package (not saved to package.json, by design)");
    const code = await run(npm, ["install", "--no-save", "--no-package-lock", "playwright"]);
    if (code !== 0) {
      say("the package install failed; nothing was changed in the repository");
      return code;
    }
  }

  say("downloading the chromium build the adapter drives (about 150 MB, once)");
  const browserCode = await run(npm, ["exec", "--", "playwright", "install", "chromium"]);
  if (browserCode !== 0) {
    say("the browser download failed; rerun this script when the network allows it");
    return browserCode;
  }

  say("done - `npm run e2e` and the canonical demo can now drive a browser");
  return 0;
}

process.exitCode = await main();
