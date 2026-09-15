#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArchive } from "./vsix-archive.mjs";

/**
 * Publish the archive `npm run package` produced, to one of the two extension marketplaces.
 *
 * ## Why this is a script rather than a line a maintainer remembers
 *
 * `extension/vscode/README.md` named `vsce publish` and `ovsx publish` as the third distribution
 * route, and `ovsx` was installed nowhere and declared nowhere - so the route the document described
 * was prose a maintainer had to reproduce from memory, which is the defect this repository records
 * repeatedly: *a route named in a document that nothing in the tree can execute.* This is that
 * route made executable. Both publishers now have a declared command.
 *
 * ## What it publishes, and what it does not
 *
 * It uploads the archive that is already on disk, and never packages. `--packagePath` is the flag
 * that makes that possible in both tools, and it is not cosmetic: plain `vsce publish` and plain
 * `ovsx publish` each package the directory themselves, so the maintainer would be uploading a
 * second build rather than the one `npm run package` produced and `npm run smoke:vsix` read back.
 * The archive is the distribution, so the archive is what travels - the same reason `smoke:dist`
 * and `smoke:out` exist one runtime in from here.
 *
 * The flip side of naming the archive explicitly is that this route cannot silently bump the
 * version. `vsce publish <version>` runs `npm version` for you, which would edit `package.json`
 * without touching the three other files that carry the same number.
 *
 * ## What it needs, and why it is not a gate
 *
 * A token: `vsce` reads `VSCE_PAT` and `ovsx` reads `OVSX_PAT`. Neither is pre-checked here, for the
 * reason measured rather than assumed - running the `ovsx` route with no token set did not refuse:
 * it **asked for one on the terminal**, printing `? Personal Access Token for namespace
 * 'farmountain':`. So an absent variable is not evidence the publish cannot proceed, and refusing on
 * it would break a route a maintainer can complete by typing. The consequence to carry instead is
 * the inverse, and it is a fact rather than a guess: a non-interactive caller must set the variable,
 * because there is no terminal to answer that question and the upload never starts without it.
 *
 * It is therefore not part of `gate` - not because it is unimportant, but because the source tree's
 * gate must not require a credential or a third party to be reachable. `prepublishOnly` is the
 * related guard one layer in: the *package* cannot leave the machine with red tests.
 *
 * Run with `npm run publish:vsce` or `npm run publish:ovsx`. Exits with the publisher's own code.
 */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);

/**
 * The two registries, and each one's CLI entry point *inside its own package*.
 *
 * The entries are read out of the packages rather than guessed, and they are not the same shape:
 * `@vscode/vsce` declares `"bin": { "vsce": "vsce" }` - a file at the package root - while `ovsx`
 * declares `"bin": "bin/ovsx"`. Both files carry a `#!/usr/bin/env node` shebang, which is what lets
 * this script spawn them with `process.execPath` and no shell at all: on Windows the `.bin` shims
 * are `.cmd` files that Node refuses to execute without `shell: true`, and going through a shell
 * would put this machine's quoting rules between the maintainer and the archive path.
 */
const PUBLISHERS = {
  vsce: {
    packageName: "@vscode/vsce",
    entry: "vsce",
    marketplace: "the Visual Studio Marketplace",
    token: "VSCE_PAT",
  },
  ovsx: {
    packageName: "ovsx",
    entry: "bin/ovsx",
    marketplace: "Open VSX",
    token: "OVSX_PAT",
    // Measured, not assumed: with `OVSX_PAT` unset the tool asks for a token on the terminal rather
    // than failing, so the message below states that instead of naming a refusal that never happens.
    // `ovsx publish --help` also offers `--trusted-publishing`, which exchanges a CI system's OIDC
    // ID token for a short-lived publishing token - a second reason not to pre-check the variable.
    promptsWhenUnset: true,
  },
};

const USAGE = `usage: node scripts/publish-vsix.mjs <${Object.keys(PUBLISHERS).join("|")}>

Publishes the archive \`npm run package\` produced. It does not package, and it cannot bump the
version: run \`npm run package\` first, and \`npm run smoke:vsix\` to read that archive back before
uploading it.

It authenticates with VSCE_PAT for the Visual Studio Marketplace and OVSX_PAT for Open VSX. The
ovsx route asks for a token on the terminal when OVSX_PAT is unset, so in CI that variable has to
be set - there is no terminal to answer the question.`;

const requested = process.argv[2];
const spec = requested === undefined ? undefined : PUBLISHERS[requested];

if (spec === undefined) {
  const named = requested === undefined ? "no registry was named" : `"${requested}" is not one of them`;
  console.log(`${named}.\n\n${USAGE}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));
const archive = resolveArchive(PACKAGE_ROOT, manifest);

// A publisher handed no archive, or the wrong one, is the failure this check exists to prevent -
// and the message names the command that produces it rather than the path that is missing, because
// `npm run package` is the thing the reader can act on.
if (!existsSync(archive.path)) {
  console.log(
    `the archive ${archive.name} is not there, so there is nothing to publish.\n\n` +
      `run \`npm run package\` first - it is what writes that archive, and its name carries the\n` +
      `version in the manifest on purpose, so a publish cannot upload a build from another version.`,
  );
  process.exit(1);
}

const entryPoint = join(PACKAGE_ROOT, "node_modules", spec.packageName, spec.entry);
if (!existsSync(entryPoint)) {
  console.log(
    `the ${requested} CLI is not installed, so there is nothing to publish with.\n\n` +
      `run \`npm ci\` first - it installs ${spec.packageName}, which is a devDependency of this\n` +
      `package and therefore not something this repository vendors.`,
  );
  process.exit(1);
}

console.log(`publishing ${archive.name} to ${spec.marketplace}`);
if (spec.promptsWhenUnset === true) {
  console.log(`  it signs in with ${spec.token}, and asks for one here when that is unset.`);
}

const result = spawnSync(
  process.execPath,
  [entryPoint, "publish", "--packagePath", archive.path],
  { stdio: "inherit" },
);

if (result.error !== undefined) {
  console.log(`the publisher could not be started: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
