/**
 * RFC 6901 JSON pointers.
 *
 * Resolution is generic because of these two functions: a detector names a `path`, and the engine
 * patches the artifact at that path. Nothing else needs to know the artifact's shape.
 */

/** Escape a single reference token per RFC 6901: `~` → `~0`, `/` → `~1`. */
const escapeToken = (token: string): string => token.replace(/~/g, "~0").replace(/\//g, "~1");

const unescapeToken = (token: string): string => token.replace(/~1/g, "/").replace(/~0/g, "~");

const parsePointer = (pointer: string): string[] => {
  if (pointer === "" || pointer === "/") return [];
  const body = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return body.split("/").map(unescapeToken);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read the value at `pointer`, or `undefined` when the path does not exist. */
export function getPointer(root: unknown, pointer: string): unknown {
  let cursor: unknown = root;
  for (const token of parsePointer(pointer)) {
    if (cursor === undefined || cursor === null) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (isRecord(cursor)) {
      cursor = cursor[token];
      continue;
    }
    return undefined;
  }
  return cursor;
}

/** True when a value exists at `pointer` (as opposed to the path being absent). */
export function hasPointer(root: unknown, pointer: string): boolean {
  if (pointer === "" || pointer === "/") return root !== undefined;
  const parentPointer = parentOf(pointer);
  const parent = getPointer(root, parentPointer);
  const token = parsePointer(pointer).at(-1);
  if (token === undefined) return false;
  if (Array.isArray(parent)) return Number(token) >= 0 && Number(token) < parent.length;
  if (isRecord(parent)) return Object.hasOwn(parent, token);
  return false;
}

/** The pointer to the container holding the final token. `"/a/b"` → `"/a"`. */
export function parentOf(pointer: string): string {
  const tokens = parsePointer(pointer);
  if (tokens.length <= 1) return "";
  return `/${tokens.slice(0, -1).map(escapeToken).join("/")}`;
}

/**
 * Return a copy of `root` with `value` written at `pointer`.
 *
 * Structural sharing keeps this cheap and — more importantly — makes it impossible for a
 * resolution to mutate an artifact some other stage is still holding.
 */
export function setPointer<T>(root: T, pointer: string, value: unknown): T {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value as T;

  const write = (node: unknown, depth: number): unknown => {
    const token = tokens[depth];
    if (token === undefined) return value;

    if (Array.isArray(node)) {
      const index = Number(token);
      const copy = node.slice();
      if (!Number.isInteger(index) || index < 0) return copy;
      // Grow deterministically; a hole would be indistinguishable from a resolution.
      while (copy.length < index) copy.push(undefined);
      copy[index] = write(copy[index], depth + 1);
      return copy;
    }

    const copy: Record<string, unknown> = isRecord(node) ? { ...node } : {};
    copy[token] = write(copy[token], depth + 1);
    return copy;
  };

  return write(root, 0) as T;
}

/** Build a pointer from raw tokens, escaping as required. */
export function joinPointer(...tokens: (string | number)[]): string {
  if (tokens.length === 0) return "";
  return `/${tokens.map((t) => escapeToken(String(t))).join("/")}`;
}
