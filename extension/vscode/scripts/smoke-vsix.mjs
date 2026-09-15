/**
 * Smoke test for the *packaged* extension: the `.vsix`, opened and read without VS Code.
 *
 * ## What gap this closes
 *
 * `npm run smoke:out` loads the compiled `out/` against a recording double, so the files that run
 * are covered. But a `.vsix` is not `out/`: it is a zip built by a third-party tool from an allowlist
 * in the manifest, and everything it decides - which files travel, which are dropped, whether the
 * entry point the manifest names is among them - is decided by that tool and by nothing in this tree.
 * This repository has already paid twice for the same shape, and both times the uncovered thing was
 * the artifact a consumer receives: `dist/` (which `npm run smoke:dist` now drives) and `out/`
 * (which `npm run smoke:out` now loads). The `.vsix` is the third.
 *
 * ## What it proves
 *
 * That the archive exists, that the entry point the manifest names is inside it, that the manifest
 * *inside* the archive is the manifest on disk field for field, that no source file, test file or
 * installed dependency travelled with it, that the licence and the readme did, and that every
 * compiled file it carries is byte-identical to the one the build produced - which is what makes a
 * stale archive a failure rather than a silent second copy of an older extension.
 *
 * ## What it does not prove
 *
 * That VS Code accepts it. There is no VS Code test host in this repository, so the archive is
 * opened as a zip and read, not installed and activated: `extension/vscode/README.md` names that gap
 * and the list of things only a real host could exercise. A green run here is a *required*
 * condition, not a sufficient one.
 *
 * Run with `npm run smoke:vsix`. Exits 0 on success, 1 on the first failed assertion.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);

const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
  } else {
    console.log(`FAIL ${message}`);
    failures.push(message);
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Where the end-of-central-directory record is.
 *
 * Found by scanning backwards from the end rather than read from a fixed offset, because the record
 * is followed by an optional comment whose length moves it - and a VSIX may carry one.
 */
function endOfCentralDirectory(bytes) {
  const lowest = Math.max(0, bytes.length - (22 + 0xffff));
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new Error("no end-of-central-directory record - this file is not a zip archive");
}

/** One entry's data out of the two storage methods a VSIX uses. */
function unpack(method, raw, name) {
  if (method === 0) return raw;
  if (method === 8) return inflateRawSync(raw);
  throw new Error(`${name} uses compression method ${String(method)}, which this check does not unpack`);
}

/** Every entry in a zip, decompressed, keyed by the path it names. */
function entriesOf(bytes) {
  const eocd = endOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`central directory record ${String(index)} is not a record - this zip is malformed`);
    }
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);

    if (bytes.readUInt32LE(localAt) !== LOCAL_SIGNATURE) {
      throw new Error(`the local header for ${name} is not a header - this zip is malformed`);
    }
    const dataAt = localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
    entries.set(name, unpack(method, bytes.subarray(dataAt, dataAt + compressedSize), name));

    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * The archive the `package` script writes, derived rather than repeated here.
 *
 * `AGENTS.md`: *"a requirement that names a place must be resolved as a pointer, not read as a
 * literal key."* A copy of the name would agree with the script on the day it was written and be
 * free to disagree afterwards, and the symptom would be this check reading an archive nobody
 * produces while the real one went unexamined.
 *
 * When the script names no `--out`, `vsce` writes `<name>-<version>.vsix`, taking both out of the
 * manifest it is packaging - so the version in the filename is the version of the extension inside
 * it, and the two cannot disagree. The fallback is not a convenience: it is what puts the version
 * in the name at all.
 */
function archiveNameOf(packageScript, manifest) {
  const named = /--out\s+(\S+)/u.exec(packageScript ?? "");
  if (named?.[1] !== undefined) return named[1];
  return `${String(manifest.name)}-${String(manifest.version)}.vsix`;
}

const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));
const archiveName = archiveNameOf(manifest.scripts?.package, manifest);
const archivePath = join(PACKAGE_ROOT, archiveName);

check(existsSync(archivePath), `the archive exists (${archiveName})`);
if (failures.length > 0) {
  // Nothing below can run, and a stack trace over the top of this would bury the one line that says
  // what to do. `npm run package` is the command, because the check's subject is its output.
  console.log("\nrun `npm run package` before this check - it reads an archive, and there is none.");
  process.exit(1);
}

const archive = await readFile(archivePath);

let entries;
try {
  entries = entriesOf(archive);
} catch (error) {
  console.log(`FAIL the archive could not be read: ${error.message}`);
  process.exit(1);
}

check(entries.size > 0, `the archive holds entries (${String(entries.size)})`);

/**
 * Look an entry up by its lower-cased name.
 *
 * The case of a path inside the archive is not a property this check has an opinion about - `vsce`
 * lower-cases the readme and the licence and leaves `out/` alone - so the lookups below are
 * case-insensitive and the *presence* of the file is what is asserted.
 */
const byLowerName = new Map([...entries].map(([name, data]) => [name.toLowerCase(), { name, data }]));

function find(name) {
  return byLowerName.get(name.toLowerCase()) ?? null;
}

/** The path the extension host will be asked for, expressed as it appears inside the archive. */
const entryName = posix.join("extension", String(manifest.main).replace(/^\.\//u, ""));
const entry = find(entryName);
check(entry !== null, `the archive holds the entry point the manifest names (${entryName})`);
if (entry === null) {
  console.log(`\nthe archive is missing the file its manifest's \`main\` points at.`);
  process.exit(1);
}

// -------------------------------------------------------------------------------------------
// The manifest inside the archive is the manifest on disk
// -------------------------------------------------------------------------------------------
//
// This is the assertion that makes the archive a *distribution of this extension* rather than of
// some other one: `vsce` decides what travels by reading the manifest, so a field that changed
// between the two - the engine floor, `main`, `type`, the command roster - is a difference between
// what the source promises and what a consumer installs. Compared field by field rather than as
// text, because `vsce` is free to re-serialise the file while leaving every value alone.

const archivedName = find("extension/package.json")?.name ?? null;
check(archivedName !== null, "the archive holds a manifest (extension/package.json)");

if (archivedName !== null) {
  const archived = JSON.parse(entries.get(archivedName).toString("utf8"));
  const inSource = Object.keys(manifest).sort();
  const inArchive = Object.keys(archived).sort();
  check(
    JSON.stringify(inArchive) === JSON.stringify(inSource),
    `the archived manifest declares the same fields as the source manifest (${String(inSource.length)})`,
  );
  for (const field of inSource) {
    if (!inArchive.includes(field)) continue;
    check(
      JSON.stringify(archived[field]) === JSON.stringify(manifest[field]),
      `the archived manifest agrees with the source on "${field}"`,
    );
  }
}

// -------------------------------------------------------------------------------------------
// Nothing travelled that should not have
// -------------------------------------------------------------------------------------------

const names = [...entries.keys()];
const inArchiveDir = (prefix) => names.filter((name) => name.toLowerCase().startsWith(prefix));
const source = inArchiveDir("extension/src/");
check(source.length === 0, "no source file travelled with the archive");
for (const name of source) console.log(`     ${name}`);

const tests = names.filter((name) => /\.test\.(?:ts|js|mjs)$/u.test(name));
check(tests.length === 0, "no test file travelled with the archive");
for (const name of tests) console.log(`     ${name}`);

const installed = names.filter((name) => name.toLowerCase().includes("node_modules/"));
check(installed.length === 0, "no installed dependency travelled with the archive");
for (const name of installed) console.log(`     ${name}`);

check(find("extension/readme.md") !== null, "the archive ships a readme");

const icon = find("extension/icon.png");
check(icon !== null, "the archive ships the extension icon");
if (icon !== null) {
  const projectLogo = await readFile(join(PACKAGE_ROOT, "..", "..", "veridian-logo.png"));
  check(icon.data.equals(projectLogo), "the archive icon is byte-identical to the project logo");
}

// The licence is looked up the way `vsce` looks for it - `/^extension\/licen[cs]e(\.(md|txt))?$/i` -
// rather than by the name the source file has, because `vsce` *renames* it: a licence file with no
// extension is written into the archive as `LICENSE.txt` so the VSIX manifest's content type
// resolves. That rename was read out of `vsce`'s own `LicenseProcessor`, not guessed at.
const licenceName = names.find((name) => /^extension\/licen[cs]e(\.(?:md|txt))?$/iu.test(name)) ?? null;
check(licenceName !== null, "the archive ships the licence it is redistributed under");

if (licenceName !== null) {
  const shipped = Buffer.from(entries.get(licenceName));
  const repository = await readFile(join(PACKAGE_ROOT, "..", "..", "LICENSE"));
  check(
    shipped.equals(repository),
    `the licence in the archive is the repository's, byte for byte (${String(shipped.length)} bytes)`,
  );
}

// -------------------------------------------------------------------------------------------
// The compiled tree in the archive is the one the build produced
// -------------------------------------------------------------------------------------------
//
// A stale archive is the quiet failure of this route: `npm run gate` rebuilds `out/`, packaging
// happens separately, and an archive built before the last edit installs an extension nobody has
// compiled. Comparing bytes is the only thing that can tell the two apart - the file count and the
// manifest would both be right.

const builtAt = PACKAGE_ROOT;
const compiled = names.filter((name) => name.toLowerCase().startsWith("extension/out/"));
check(compiled.length > 0, `the archive carries compiled files (${String(compiled.length)})`);

const stale = [];
const absent = [];
for (const name of compiled) {
  const onDisk = name.replace(/^extension\//u, "");
  const path = join(builtAt, onDisk);
  if (!existsSync(path)) {
    absent.push(name);
    continue;
  }
  if (!Buffer.from(entries.get(name)).equals(await readFile(path))) {
    stale.push(name);
  }
}
check(
  absent.length === 0,
  `every compiled file in the archive exists in the build (${String(compiled.length)} compared)`,
);
for (const name of absent) console.log(`     ${name}`);
check(stale.length === 0, "every compiled file in the archive is byte-identical to the one on disk");
for (const name of stale) console.log(`     ${name}`);

if (failures.length > 0) {
  console.log(`\n${String(failures.length)} of the packaged extension's checks failed.`);
  process.exit(1);
}

console.log(`\nthe packaged extension holds what its manifest promises (${String(entries.size)} entries).`);
