import { copyFile as fsCopyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";

import type { SchemaLoader } from "./schema/validate.ts";

/**
 * The filesystem boundary.
 *
 * Everything Veridian persists goes through this port, for two reasons. Tests can substitute an
 * in-memory implementation, so the whole loop can be proven without touching a disk; and the
 * eventual stronger isolation of a real sandbox has exactly one place to be enforced.
 *
 * This is a superset of the read-only port the clarification layer's derive rules need, so a
 * `nodeIo()` satisfies those structurally with no adapter.
 */
export interface ReadonlyIoPort {
  /** `null` rather than a throw: "absent" is an ordinary answer for a probe. */
  readTextFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  readonly cwd: string;
}

export interface IoPort extends ReadonlyIoPort {
  writeTextFile(path: string, contents: string): Promise<void>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
  mkdirp(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  copyFile(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Join path segments against the port's root using forward slashes. */
  resolve(...parts: string[]): string;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface NodeIoOptions {
  /** Base directory every relative path is resolved against. Defaults to the process cwd. */
  readonly root?: string;
}

export function nodeIo(options: NodeIoOptions = {}): IoPort {
  const root = options.root ? resolvePath(options.root) : process.cwd();

  /**
   * Resolve a caller's path against the root - unless it is already absolute, in which case it is
   * used as written.
   *
   * `join` alone would not do: `join("D:/repo", "D:/repo/examples/goal.yaml")` is
   * `"D:/repo/D:/repo/examples/goal.yaml"`, so an absolute path - which is what a spawned CLI or an
   * extension has to hand over, and the honest thing for them to pass - would be looked for in a
   * directory that cannot exist. The failure that produced ("the goal file does not exist") names a
   * file sitting right there, which is the worst kind of wrong: it sends the reader to inspect the
   * thing that is not broken. `memoryIo` has always read paths this way, so this is also what makes
   * the real filesystem behave like the one the tests are written against.
   */
  const at = (path: string): string => (isAbsolute(path) ? path : join(root, path));

  return {
    cwd: root,
    resolve(...parts) {
      if (parts.length === 0) return root.split("\\").join("/");
      const [first, ...rest] = parts;
      const base = first !== undefined && isAbsolute(first) ? join(first, ...rest) : join(root, ...parts);
      return base.split("\\").join("/");
    },
    async readTextFile(path) {
      try {
        return await readFile(at(path), "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw new Error(`readTextFile(${path}) failed: ${describe(error)}`);
      }
    },
    async writeTextFile(path, contents) {
      const target = at(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    },
    async writeBinaryFile(path, data) {
      const target = at(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async exists(path) {
      try {
        await readFile(at(path));
        return true;
      } catch {
        try {
          await readdir(at(path));
          return true;
        } catch {
          return false;
        }
      }
    },
    async mkdirp(path) {
      await mkdir(at(path), { recursive: true });
    },
    async readDir(path) {
      try {
        return await readdir(at(path));
      } catch {
        return [];
      }
    },
    async copyFile(from, to) {
      const target = at(to);
      await mkdir(dirname(target), { recursive: true });
      await fsCopyFile(from, target);
    },
    async remove(path) {
      await rm(at(path), { recursive: true, force: true });
    },
  };
}

export interface MemoryIo extends IoPort {
  readonly files: Map<string, string>;
  readonly binaries: Map<string, Uint8Array>;
  /** Paths passed to {@link IoPort.copyFile}, recorded instead of copied. */
  readonly copies: { from: string; to: string }[];
}

/**
 * In-memory filesystem for tests. Normalises `\` to `/` and collapses `../` so that a path written
 * one way is always found the same way — a test should never fail because of a separator.
 */
export function memoryIo(seed: Record<string, string> = {}, root = "/virtual"): MemoryIo {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  const copies: { from: string; to: string }[] = [];

  const normalise = (path: string): string => {
    const absolute = path.startsWith("/") ? path : `${root}/${path}`;
    const parts: string[] = [];
    for (const part of absolute.split(/[\\/]+/)) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  };

  for (const [key, value] of Object.entries(seed)) files.set(normalise(key), value);

  return {
    files,
    binaries,
    copies,
    cwd: root,
    resolve: (...parts) => normalise(parts.join("/")),
    async readTextFile(path) {
      return files.get(normalise(path)) ?? null;
    },
    async writeTextFile(path, contents) {
      files.set(normalise(path), contents);
    },
    async writeBinaryFile(path, data) {
      binaries.set(normalise(path), data);
    },
    async exists(path) {
      const key = normalise(path);
      if (files.has(key) || binaries.has(key)) return true;
      const prefix = `${key}/`;
      return [...files.keys()].some((candidate) => candidate.startsWith(prefix));
    },
    async mkdirp() {
      // Directories are implied by the files inside them; nothing to do.
    },
    async readDir(path) {
      const prefix = `${normalise(path)}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const head = rest.split("/")[0];
        if (head !== undefined && head !== "") names.add(head);
      }
      return [...names].sort();
    },
    async copyFile(from, to) {
      copies.push({ from, to });
      const contents = files.get(normalise(from));
      if (contents === undefined) throw new Error(`copyFile: ${from} does not exist`);
      files.set(normalise(to), contents);
    },
    async remove(path) {
      const key = normalise(path);
      files.delete(key);
      binaries.delete(key);
      for (const candidate of [...files.keys()]) {
        if (candidate.startsWith(`${key}/`)) files.delete(candidate);
      }
    },
  };
}

/**
 * Load schema documents up front.
 *
 * The validator is synchronous by design — it runs inside pure validation paths where an await
 * would be noise — so cross-file references are read eagerly here instead of lazily mid-check.
 */
export async function preloadSchemas(
  io: ReadonlyIoPort,
  uris: readonly string[],
): Promise<SchemaLoader & { readonly loaded: readonly string[] }> {
  const documents = new Map<string, unknown>();
  for (const uri of uris) {
    const text = await io.readTextFile(uri);
    if (text === null) throw new Error(`schema "${uri}" could not be read`);
    documents.set(uri, JSON.parse(text));
  }
  return {
    loaded: [...documents.keys()],
    load(uri) {
      if (!documents.has(uri)) {
        throw new Error(`schema "${uri}" was not preloaded; add it to the preload list`);
      }
      return documents.get(uri);
    },
  };
}
