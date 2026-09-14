import type { Clock, Logger } from "../../core/clarification/index.ts";

/**
 * A clock that advances on every read.
 *
 * Chosen over a fixed clock because "did the timestamps move forward?" is a property worth being
 * able to assert, and over `Date.now()` because a test that passes only when two calls land in
 * different milliseconds is a flaky test.
 */
export function steppingClock(stepMs = 1000, start = Date.UTC(2026, 0, 1)): Clock {
  let current = start;
  const tick = (): number => {
    const value = current;
    current += stepMs;
    return value;
  };
  return { now: tick, iso: () => new Date(tick()).toISOString() };
}

export function fixedClock(iso = "2026-01-01T00:00:00.000Z"): Clock {
  const at = Date.parse(iso);
  return { now: () => at, iso: () => new Date(at).toISOString() };
}

export interface RecordingLogger extends Logger {
  readonly entries: readonly { readonly level: string; readonly message: string }[];
}

export function recordingLogger(): RecordingLogger {
  const entries: { level: string; message: string }[] = [];
  const push =
    (level: string) =>
    (message: string): void => {
      entries.push({ level, message });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn") };
}

/** A logger that discards everything, for tests that do not assert on logging. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};
