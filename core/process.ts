/**
 * The process boundary.
 *
 * A port plus a single Node implementation, in the same shape as {@link ./io.ts}: two very different
 * callers need this for opposite reasons. `local-web` needs a *long-lived* child it can watch for a
 * readiness signal and must eventually kill, because an orphaned application holds a port and makes
 * the next run's environment failure look like this run's fault. The command repair gate needs a
 * *finite* child whose exit code is a decision.
 *
 * Those two cannot share one `run()` signature without one of them lying about what it wants, so the
 * port exposes the process rather than the outcome, and `runToCompletion` is written on top for the
 * finite case.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory. The application under test must not be started from Veridian's own cwd. */
  readonly cwd: string;
  /** Merged over `process.env`. An empty map means "inherit", not "no environment". */
  readonly env?: Readonly<Record<string, string>>;
  /** Called for each stdout chunk as it arrives, for readiness patterns. */
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface ProcessResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the process was still running at the deadline and had to be stopped. */
  readonly timedOut: boolean;
}

export interface ProcessHandle {
  readonly pid: number | null;
  /** Settles when the process exits. Never rejects: a failure to spawn is a result, not a throw. */
  readonly exited: Promise<ProcessResult>;
  /** Everything written to stdout so far, concatenated. */
  output(): string;
  /** Everything written to stderr so far. */
  error(): string;
  /**
   * Resolve `true` once `pattern` (a regular expression source) appears on stdout, `false` if the
   * process exits first. Resolving `false` on a timeout is deliberately *not* this method's job:
   * the caller owns the deadline, because only the caller knows whether the process is expected to
   * keep running afterwards.
   */
  waitForPattern(pattern: string, timeoutMs: number): Promise<boolean>;
  /** Terminate, escalating if needed. Never rejects. */
  stop(graceMs?: number): Promise<void>;
}

export interface ProcessRunner {
  run(request: ProcessRequest): ProcessHandle;
}

const decode = (chunk: Buffer): string => chunk.toString("utf8");

/**
 * Whether a command has to be handed to the platform's shell.
 *
 * On Windows a *bare* name has to be, because `npm` and every other shim is a `.cmd` that only the
 * shell will resolve. An **absolute path must not be**, and that half was measured the hard way: with
 * `shell: true`, Node joins the file and its arguments into one string for `cmd.exe` *without quoting
 * the file*, so `C:\Program Files\nodejs\node.exe` - the interpreter Veridian's own tests run under -
 * arrives as `'C:\Program' is not recognized as an internal or external command`. A command that is a
 * path needs no resolution, so asking the shell for one can only lose the command.
 */
const wantsShell = (command: string): boolean =>
  process.platform === "win32" && !isAbsolute(command);

/**
 * A spawn failure is reported as an exit with code `null`, so that every caller has one shape to
 * handle. ENOENT for a missing command is the common case and must read as "the environment could
 * not be started", never as "the application is broken".
 */
function failedToSpawn(error: unknown, stdout: string, stderr: string): ProcessResult {
  const message = error instanceof Error ? error.message : String(error);
  return { code: null, signal: null, stdout, stderr: stderr || message, timedOut: false };
}

export const nodeProcessRunner: ProcessRunner = {
  run(request: ProcessRequest): ProcessHandle {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const waiters = new Set<() => void>();
    let settled = false;
    let child: ChildProcess | null = null;
    let result: ProcessResult | null = null;
    let resolveExited!: (value: ProcessResult) => void;

    const exited = new Promise<ProcessResult>((resolve) => {
      resolveExited = resolve;
    });

    const notify = (): void => {
      for (const waiter of [...waiters]) waiter();
    };

    const finish = (value: ProcessResult): void => {
      if (settled) return;
      settled = true;
      result = value;
      resolveExited(value);
      notify();
    };

    try {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: { ...process.env, ...(request.env ?? {}) },
        // Windows resolves `npm` and other `.cmd` shims only through a shell. Veridian is a Windows
        // -first tool, so this is not optional for a bare name; it costs nothing on POSIX. An absolute
        // path is deliberately excluded - see `wantsShell`.
        shell: wantsShell(request.command),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish(failedToSpawn(error, "", ""));
      return {
        pid: null,
        exited,
        output: () => stdoutChunks.join(""),
        error: () => stderrChunks.join(""),
        waitForPattern: async () => false,
        stop: async () => undefined,
      };
    }

    const spawned = child;
    spawned.stdout?.on("data", (chunk: Buffer) => {
      const text = decode(chunk);
      stdoutChunks.push(text);
      request.onStdout?.(text);
      notify();
    });
    spawned.stderr?.on("data", (chunk: Buffer) => {
      const text = decode(chunk);
      stderrChunks.push(text);
      request.onStderr?.(text);
    });
    spawned.on("error", (error: Error) => {
      finish(failedToSpawn(error, stdoutChunks.join(""), stderrChunks.join("")));
    });
    spawned.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish({
        code,
        signal: signal ?? null,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        timedOut: false,
      });
    });

    const handle: ProcessHandle = {
      pid: spawned.pid ?? null,
      exited,
      output: () => stdoutChunks.join(""),
      error: () => stderrChunks.join(""),
      async waitForPattern(pattern: string, timeoutMs: number): Promise<boolean> {
        const expression = new RegExp(pattern);
        const deadline = Date.now() + timeoutMs;

        for (;;) {
          if (expression.test(handle.output())) return true;
          if (result !== null) return false;

          const remaining = deadline - Date.now();
          if (remaining <= 0) return false;

          // Waking on output *or* on a short poll keeps this correct when a readiness pattern spans
          // two chunks, which a purely event-driven wait would miss.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              waiters.delete(wake);
              resolve();
            }, Math.min(remaining, 50));
            const wake = (): void => {
              clearTimeout(timer);
              waiters.delete(wake);
              resolve();
            };
            waiters.add(wake);
          });
        }
      },
      async stop(graceMs = 2_000): Promise<void> {
        if (settled) return;
        const pid = spawned.pid;
        if (pid === undefined) return;

        if (process.platform === "win32") {
          // A child started through a shell is a *tree*: killing the shell leaves the server holding
          // the port, and the next run then fails its health check for a reason that is not the
          // application's fault. `taskkill /T` is the only reliable way to end the tree on Windows.
          await new Promise<void>((resolve) => {
            const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            });
            killer.on("close", () => resolve());
            killer.on("error", () => resolve());
          });
          return;
        }

        spawned.kill("SIGTERM");
        const escalate = setTimeout(() => {
          if (!settled) spawned.kill("SIGKILL");
        }, graceMs);
        escalate.unref?.();
        await exited;
      },
    };

    return handle;
  },
};

/**
 * Wait for a handle to exit, stopping it at the deadline.
 *
 * Split out of {@link runToCompletion} because a caller can need the deadline rule *and* the handle.
 * `sim-vscode` starts a real extension host and must be able to kill it if the run is abandoned, which
 * means it cannot let `runToCompletion` keep the handle to itself. Two implementations of one deadline
 * is the defect this repository has paid for more than once - the second one is always the one that
 * forgets to stop a process - so there is one, and `runToCompletion` is written on top of it.
 */
export async function withDeadline(
  handle: ProcessHandle,
  timeoutMs: number,
): Promise<ProcessResult> {
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    void handle.stop();
  }, timeoutMs);
  timer.unref?.();

  try {
    const result = await handle.exited;
    return { ...result, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a process to completion, stopping it at the deadline.
 *
 * `timedOut` is returned rather than thrown because a timeout is a *result* here: the command repair
 * gate reports it as a failed repair attempt, and `local-web` reports it as an environment that never
 * became ready. Neither is an exception in the sense of a programming error.
 */
export async function runToCompletion(
  runner: ProcessRunner,
  request: ProcessRequest,
  timeoutMs: number,
): Promise<ProcessResult> {
  return withDeadline(runner.run(request), timeoutMs);
}
