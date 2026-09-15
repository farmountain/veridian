import { join } from "node:path";

/**
 * Where `npm run package` writes, resolved once and shared by everything that reads it.
 *
 * `AGENTS.md`: *"two implementations of one rule disagree the first time a world arrives that only
 * one of them was written for."* Three scripts now need the produced archive's path - the smoke
 * test that reads it back, and the two publish routes - and a copy of the name in each would agree
 * on the day it was written and be free to disagree afterwards. The symptom would be a publisher
 * uploading an archive nobody produces while the real one went unexamined, which is the one thing a
 * publish route must not get wrong, because nothing downstream would notice.
 *
 * `package` is `vsce package --no-dependencies` and names no `--out`, so `vsce` writes
 * `<name>-<version>.vsix`, taking both out of the manifest it is packaging - which means the version
 * in the filename is the version of the extension inside it, and the two cannot disagree. The
 * `--out` branch is not decoration: naming one later has to move every reader at once rather than
 * leaving two of them pointed at a file that stops being written.
 */
export function archiveNameOf(packageScript, manifest) {
  const named = /--out\s+(\S+)/u.exec(packageScript ?? "");
  if (named?.[1] !== undefined) return named[1];
  return `${String(manifest.name)}-${String(manifest.version)}.vsix`;
}

/**
 * The archive's name and its absolute path, from the manifest that describes it.
 *
 * `packageRoot` is the extension root - the directory holding `package.json` and the archive - and
 * is passed in rather than derived here so this module stays a pure rule with no opinion about where
 * it is called from.
 */
export function resolveArchive(packageRoot, manifest) {
  const name = archiveNameOf(manifest.scripts?.package, manifest);
  return { name, path: join(packageRoot, name) };
}
