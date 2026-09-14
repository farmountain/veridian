#!/usr/bin/env node
/**
 * Copy the assets that are not code into the build output.
 *
 * `tsc` compiles TypeScript and nothing else, so a build that emits only `dist/**.js` produces a
 * package whose own schemas are missing. That is not a cosmetic omission: `SCHEMA_URIS` are
 * package-relative and a run cannot start without them, so the artifact would install cleanly and
 * then fail at the first command.
 *
 * `schemas/` is copied rather than pointed at because `core/assets.ts` resolves one level up from
 * `dist/core/`, and moving the schemas instead would put the source tree and its own build output
 * in different places - which is how the two drift.
 *
 * Written as a script rather than a `package.json` one-liner for the same reason as
 * `scripts/e2e-install.mjs`: it has to check that the source actually has the asset before claiming
 * to have copied it, and POSIX-only shell in an npm script fails on this project's primary platform.
 */

import { cpSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One level up from `scripts/`, which is the package root from either a source tree or `dist/`. */
const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "dist");

const ASSETS = ["schemas"];

let failed = false;

for (const name of ASSETS) {
  const from = join(root, name);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    process.stderr.write(`copy-assets: ${name}/ is not a directory in the source tree\n`);
    failed = true;
    continue;
  }
  cpSync(from, join(out, name), { recursive: true });
  process.stdout.write(`copy-assets: ${name}/ -> dist/${name}/\n`);
}

if (failed) process.exit(1);
