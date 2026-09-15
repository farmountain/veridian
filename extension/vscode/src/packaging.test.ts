/**
 * The claims the packaged extension makes about itself, held against the files that make them true.
 *
 * ## The defect this file was written for
 *
 * `engines.vscode` is a promise about the *editor* an extension will be loaded by, and nothing in
 * this repository read it. It said `^1.94.0` while `package.json` also said `"type": "module"` - and
 * because this package is an ES module, `tsc` emits ES modules (see `moduleFormatOf` below, which
 * reads the setting rather than assuming it). So the entry point the manifest names is one only a
 * host that loads ESM can load, and the Node.js extension host gained that ability in VS Code
 * **1.100**:
 *
 * > **ESM support for extensions** - The NodeJS extension host now supports extensions that use
 * > JavaScript-modules (ESM). All it needs is the `"type": "module"` entry in your extension's
 * > `package.json` file.
 * > - VS Code 1.100 release notes, "Extension Authoring"
 *
 * 1.100 is six minor releases after the floor the manifest declared, so on every editor between the
 * two this extension would have installed cleanly and then failed to activate. That is the same
 * *class* as `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, which `AGENTS.md` records: a claim about
 * the world a file ships into, true of this repository and false in that world.
 *
 * ## What is asserted
 *
 * Four claims, each of which can fail for its own reason:
 *
 * 1. the host floor admits the module format the build emits, and the build config agrees;
 * 2. `@types/vscode` is never *ahead* of the host floor - you may not compile against an API newer
 *    than the editor you promise to run on (`vsce` refuses to package that pairing for this reason);
 * 3. the manifest's `files` allowlist contains the entry point `main` names, because an archive
 *    holding the code but not the file that starts it installs and cannot activate;
 * 4. the extension's `LICENSE` is the repository's `LICENSE`, byte for byte. BSD-2-Clause requires
 *    the notice to travel with a redistribution, and a `.vsix` is one - so the copy is an
 *    obligation rather than tidiness, and a copy that can drift needs a test that reads both.
 *
 * ## Why the parser throws instead of returning a default
 *
 * `floorOf` rejects any range it does not model, naming the string. A version parser that quietly
 * answered `0.0.0` for `*` or for `^1.100.0 || ^2` would turn the assertions below into checks that
 * pass on a manifest nobody understands - the shape this repository has already recorded twice, as
 * a guard no code path can trip, and as an assertion against a literal that cannot fail.
 *
 * Nothing here is covered by `npm run smoke:vsix`, and nothing there is covered here: this file asks
 * whether the *source* manifest is self-consistent, that script asks whether the *archive* agrees
 * with the source. One rule, one implementation - the archive inherits this one by agreement rather
 * than restating it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface Manifest {
  readonly icon?: string;
  readonly main?: string;
  readonly type?: string;
  readonly files?: readonly string[];
  readonly engines?: { readonly vscode?: string };
  readonly devDependencies?: Readonly<Record<string, string>>;
}

interface TypeScriptConfig {
  readonly compilerOptions?: { readonly module?: string };
}

/** A path relative to this file, resolved the way the compiler resolves a specifier: `../` is up one. */
const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const manifest = JSON.parse(readFileSync(here("../package.json"), "utf8")) as Manifest;
const base = JSON.parse(readFileSync(here("../tsconfig.json"), "utf8")) as TypeScriptConfig;
const build = JSON.parse(readFileSync(here("../tsconfig.build.json"), "utf8")) as TypeScriptConfig;

/**
 * The first VS Code release whose Node.js extension host loads an extension that *is* an ES module.
 *
 * Recorded from the 1.100 release notes (quoted in this file's header) rather than recalled, because
 * a floor is a claim about the world the file ships into: getting it wrong is not a compile error, it
 * is an extension that installs and then fails to activate, which is the failure this file exists to
 * make impossible.
 */
const ESM_CAPABLE_HOST: Version = { major: 1, minor: 100, patch: 0 };

/** `^1.100.0`, `~1.94.0`, `>=1.100.0` and `1.100.0`, and nothing else. */
const FLOOR = /^(?:[\^~]|>=)?\s*(\d+)\.(\d+)\.(\d+)$/u;

/** The floor out of a version range, or a failure naming the string this file does not model. */
function floorOf(range: string | undefined, where: string): Version {
  if (range === undefined) {
    throw new Error(`${where} is not declared, so there is no floor to hold`);
  }
  const match = FLOOR.exec(range.trim());
  if (match === null) {
    throw new Error(`${where} is "${range}", a range this check does not model - widen the check rather than trusting it`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Whether `a` names an earlier version than `b`. */
function before(a: Version, b: Version): boolean {
  if (a.major !== b.major) return a.major < b.major;
  if (a.minor !== b.minor) return a.minor < b.minor;
  return a.patch < b.patch;
}

/** Settings that emit `require`, whatever the package's `type` says. */
const COMMONJS_MODULE_SETTINGS = new Set(["commonjs", "amd", "umd", "system", "none"]);

/** Settings that emit `import`/`export`, whatever the package's `type` says. */
const ESM_MODULE_SETTINGS = new Set([
  "es2015",
  "es2016",
  "es2017",
  "es2020",
  "es2022",
  "es2023",
  "es2024",
  "esnext",
  "preserve",
]);

/** Settings whose output format follows the nearest `package.json`'s `type`. */
const TYPE_DRIVEN_MODULE_SETTINGS = new Set(["node16", "node18", "node20", "nodenext"]);

/**
 * The module format the compiler emits, read from the two settings that decide it rather than
 * assumed from either one. `module: "nodenext"` with `"type": "module"` is ESM; the same setting
 * with no `type` is CommonJS; `module: "commonjs"` is CommonJS even under a `"type": "module"`
 * package, which is precisely the mismatch worth being able to see.
 */
function moduleFormatOf(moduleSetting: string | undefined, packageType: string | undefined): "esm" | "commonjs" {
  if (moduleSetting === undefined) {
    throw new Error("the compiler options declare no `module`, so the emitted format is not knowable here");
  }
  if (COMMONJS_MODULE_SETTINGS.has(moduleSetting)) return "commonjs";
  if (ESM_MODULE_SETTINGS.has(moduleSetting)) return "esm";
  if (TYPE_DRIVEN_MODULE_SETTINGS.has(moduleSetting)) {
    return packageType === "module" ? "esm" : "commonjs";
  }
  throw new Error(`module: "${moduleSetting}" is a setting this check does not model - widen the check rather than trusting it`);
}

test("the editor floor admits the module format the build emits", () => {
  const format = moduleFormatOf(base.compilerOptions?.module, manifest.type);

  // The build may override `module`; if it does, the format it produces is the one the floor has to
  // admit. Asserting the inherited value instead would break on a legitimate override for a reason
  // that has nothing to do with the floor.
  const shipped = moduleFormatOf(build.compilerOptions?.module ?? base.compilerOptions?.module, manifest.type);
  assert.equal(shipped, format, "the build config must emit the module format the floor was chosen for");

  const floor = floorOf(manifest.engines?.vscode, "engines.vscode");
  if (format === "esm") {
    assert.ok(
      !before(floor, ESM_CAPABLE_HOST),
      `the entry point is an ES module, so the floor must be at least ${String(ESM_CAPABLE_HOST.major)}.${String(ESM_CAPABLE_HOST.minor)} - the first host that loads one - and it is ${String(floor.major)}.${String(floor.minor)}`,
    );
  }
});

test("the type definitions are never ahead of the editor floor", () => {
  // `vsce` refuses this pairing, and it is worth refusing here so the reason is written down: an
  // extension compiled against types newer than its declared editor can call a member the floor's
  // editor does not have, and nothing else in this tree would notice.
  const host = floorOf(manifest.engines?.vscode, "engines.vscode");
  const types = floorOf(manifest.devDependencies?.["@types/vscode"], 'devDependencies["@types/vscode"]');
  assert.ok(
    !before(host, types),
    `@types/vscode ${String(types.major)}.${String(types.minor)} is ahead of the declared floor ${String(host.major)}.${String(host.minor)}`,
  );
});

test("the packaged file list contains the entry point the manifest names", () => {
  assert.ok(typeof manifest.main === "string" && manifest.main.length > 0, "the manifest must name a `main`");

  // `vsce` packs `files` and always adds `package.json`, the README and the licence; everything else
  // in the archive has to be listed. So an entry point outside the allowlist is an extension that
  // installs and cannot activate - and the archive is the only place that shows it.
  const entry = manifest.main.replace(/^\.\//u, "");
  const allowlist = (manifest.files ?? []).map((listed) => listed.replace(/^\.\//u, "").replace(/\/\*\*?$/u, ""));
  const covered = allowlist.some((listed) => entry === listed || entry.startsWith(`${listed}/`));
  assert.ok(
    covered,
    `main is "${manifest.main}", so the archive must include it, and \`files\` is ${JSON.stringify(manifest.files ?? [])}`,
  );
});

test("the manifest names and allowlists the extension icon", () => {
  assert.equal(manifest.icon, "icon.png", "the extension manifest must use icon.png as its icon");
  assert.ok(
    (manifest.files ?? []).includes("icon.png"),
    "icon.png must be in the package allowlist or the installed extension will have no icon",
  );
});

test("the extension icon is the project logo", () => {
  const projectLogo = readFileSync(here("../../../veridian-logo.png"));
  const extensionIcon = readFileSync(here("../icon.png"));
  assert.deepEqual(
    extensionIcon,
    projectLogo,
    "extension/vscode/icon.png and the project logo have diverged - recopy the supplied image",
  );
});

test("the extension ships the repository's own licence, byte for byte", () => {
  // The copy exists because a `.vsix` is a redistribution and BSD-2-Clause requires the notice to
  // travel with it; the assertion exists because a copy is a claim that will disagree with its
  // original the first time one of the two is edited - which is the drift this repository has
  // already paid for with `package.json` and its lockfile.
  const original = readFileSync(here("../../../LICENSE"));
  const copy = readFileSync(here("../LICENSE"));
  assert.deepEqual(
    copy,
    original,
    "extension/vscode/LICENSE and the repository's LICENSE have diverged - re-copy the file rather than editing the copy",
  );
});
