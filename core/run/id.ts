import { randomUUID } from "node:crypto";

import type { Clock } from "../clarification/index.ts";

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * `run-YYYYMMDD-HHMMSS-xxxxxx`.
 *
 * Sortable, human-readable, and unique. The random suffix matters more than it looks: two runs in
 * the same second must not collide, because run directories are how evidence is found again.
 *
 * `entropy` is documented as "at least 6 alphanumeric characters". Anything shorter is padded
 * rather than truncated, because an id that silently violates the schema is worse than an id with
 * fewer random bits — the schema is what the reader trusts.
 */
export function createRunId(clock: Clock, entropy: () => string = () => randomUUID()): string {
  const now = new Date(clock.now());
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const suffix = entropy().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 6).padEnd(6, "0");
  return `run-${stamp}-${suffix}`;
}

/** Regex the schemas use, kept here so the generator and the contract cannot drift apart. */
export const RUN_ID_PATTERN = /^run-[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$/;
