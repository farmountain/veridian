import { fileURLToPath } from "node:url";

/**
 * Where this build's own files live: `schemas/` today, and anything a later phase ships beside it.
 *
 * **Two roots, not one, and confusing them is the defect this function exists to remove.** A
 * caller's path is resolved against the process's working directory, because `--goal my-app/goal.yaml`
 * means the file the operator is standing next to. Veridian's own files are resolved against *this
 * module*, because they are not the operator's: they shipped inside the package, and they are in the
 * same place no matter where the operator happens to be standing.
 *
 * Deriving it from `import.meta.url` rather than from the cwd is what lets both be true at once. One
 * level up from `core/` is the package root from the source tree (`<root>/core/assets.ts` resolves to
 * `<root>/`) and from the build output (`<root>/dist/core/assets.js` resolves to `<root>/dist/`), so
 * a compiled distribution has to carry its assets - see `scripts/copy-assets.mjs`.
 *
 * Why this is not decoration: it was one of the two independent reasons the registry path was
 * declined at ship time (the other is `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `loadSchemaSet`
 * read `schemas/goal.schema.json` through a port rooted at `process.cwd()`, so an installed CLI
 * would have reported a missing goal schema that was sitting inside its own package - the failure
 * mode AGENTS.md calls the worst kind of wrong, because it sends the reader to inspect the one thing
 * that is not broken.
 *
 * Lives in `core/` and imports nothing but a Node builtin, so every layer may read it. `core/*` may
 * not import `cli/*`, and the CLI is not the only thing that will ever need to find these files.
 */
export function assetsRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}
