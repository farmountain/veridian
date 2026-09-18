/**
 * What this runtime will actually confine, and the argument vector that does it.
 *
 * ## Why this file exists
 *
 * Every world in this repository starts a real application as a real child process. Until this file,
 * nothing confined that child, and every adapter said so in as many words - correctly. The sentence
 * they all carried was true and is now false: the child runs with the operator's own privileges, so
 * it can write wherever the operator can and open whatever socket the operator can.
 *
 * `node --permission` closes the first half of that. It is not a container, not a virtual machine and
 * not a second process boundary; it is a set of allowlists the interpreter enforces against its own
 * `node:fs` calls. It is worth having anyway, because a world that can refuse a write outside the
 * sandbox is a world whose `PASS` means something the unconfined one could not, and because the
 * refusal arrives as a catchable `ERR_ACCESS_DENIED` rather than as a crash.
 *
 * ## The two rules this file exists to hold
 *
 * **The capability is measured, not declared.** A constant saying "this runtime confines children"
 * would be a claim beside the code, free to disagree with the runtime the code is running on - the
 * defect this repository records as *"a capability report must be derived from what the code did, not
 * from a literal list beside it."* `confinementCapability()` starts a real child and reports what
 * happened, including the case that matters most: a runtime that **accepts** the flags and does not
 * enforce them. That case is why the probe writes twice rather than once.
 *
 * **A request that cannot be confined is not confined silently.** `confineChild()` returns the
 * argument vector unchanged with `applied: false` and a stated reason, and the caller decides what
 * that means for its own report. A helper that quietly returned the unconfined vector would make
 * every caller report `enforced` for a world where nothing was enforced - which is the exact
 * overclaim the boundary path exists to remove.
 *
 * ## The half it cannot do
 *
 * There is no `--allow-net`. Measured, with a positive control: `--permission` is accepted (exit 0)
 * while `--allow-net=127.0.0.1` is answered `bad option` (exit 9), and `node --help` lists
 * `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process` and `--allow-wasi` beside it and
 * nothing for the network. So **network egress from a host child is not confinable by this
 * mechanism**, and that is a permanent property of the runtime rather than a gap in any world. Hence
 * {@link ./types.ts}'s third enforcement state: `unsupported` means "not built", and this means
 * "cannot be built here".
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** What a measurement of this runtime produced. Every field is a reading, not an intention. */
export interface ConfinementCapability {
  /** True only when a real child really wrote inside its allowance and really refused to write outside it. */
  readonly available: boolean;
  /** Why not, when it is not - quoting what the runtime said, never a guess about it. */
  readonly reason: string;
  /** The interpreter that supports the flags. `process.execPath`, so a confined child never needs a shell. */
  readonly interpreter: string;
  /** The flags actually measured to work, in the order they are applied. */
  readonly mechanism: readonly string[];
}

/** What a caller knows about the child it is about to start. */
export interface ConfinementRequest {
  /** The command as the environment document declared it. Anything but Node gets `applied: false`. */
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Paths the child may read. The application directory belongs here as well as the sandbox: the
   * program file itself is opened through `node:fs`, so a read allowance that named only the sandbox
   * would refuse to load the program it was asked to confine.
   */
  readonly readRoots: readonly string[];
  /** Paths the child may write. The sandbox, and normally nothing else. */
  readonly writeRoots: readonly string[];
  /** Whether the child may start children of its own. Off unless a world needs it. */
  readonly allowChildProcess?: boolean;
}

/** The vector to start, and whether it is confined. `reason` is stated either way. */
export interface ConfinementResult {
  readonly applied: boolean;
  readonly command: string;
  readonly args: readonly string[];
  /** Why it was not applied, or what was applied. Never empty, so no caller has to guess. */
  readonly reason: string;
}

const PERMISSION_FLAG = "--permission";

/**
 * The probe program. Written as one line because it is handed to `-e`, and composed with
 * `JSON.stringify` rather than interpolation so a path containing a quote cannot break out of the
 * string literal and turn a measurement into a crash.
 *
 * It writes **twice on purpose**. A probe that only attempts the refused write cannot tell "the flag
 * works" from "every write fails", and a probe that only attempts the permitted write cannot tell "the
 * flag works" from "the flag is accepted and ignored". Both halves are read, and `available` requires
 * the permitted half to succeed and the refused half to be refused.
 */
function probeProgram(inside: string, outside: string): string {
  return (
    'const fs = require("node:fs");' +
    `const inside = ${JSON.stringify(inside)};` +
    `const outside = ${JSON.stringify(outside)};` +
    'try { fs.writeFileSync(inside, "x"); process.stdout.write("inside:written\\n"); }' +
    ' catch (error) { process.stdout.write("inside:" + String(error.code) + "\\n"); }' +
    'try { fs.writeFileSync(outside, "x"); process.stdout.write("outside:written\\n"); }' +
    ' catch (error) { process.stdout.write("outside:" + String(error.code) + "\\n"); }' +
    "process.exit(0);"
  );
}

/** What one probe run said about each half. */
interface ProbeReading {
  readonly inside: string;
  readonly outside: string;
}

function readProbe(stdout: string): ProbeReading {
  const line = (prefix: string): string => {
    const found = stdout.split(/\r?\n/).find((row) => row.startsWith(`${prefix}:`));
    return found === undefined ? "" : found.slice(prefix.length + 1);
  };
  return { inside: line("inside"), outside: line("outside") };
}

let capability: ConfinementCapability | null = null;

/**
 * Measure this runtime once, and remember the reading.
 *
 * Memoised because the answer is a property of the interpreter rather than of a run, and because the
 * first question is asked from inside `#spawn`, where a second probe would be a second child started
 * to ask whether children can be confined.
 *
 * The probe cleans up after itself in a `finally`, so a run that ends early does not leave a directory
 * in the system temp for the next reader to find and wonder about.
 */
export function confinementCapability(): ConfinementCapability {
  if (capability !== null) return capability;
  capability = measure();
  return capability;
}

function unavailable(reason: string): ConfinementCapability {
  return { available: false, reason, interpreter: process.execPath, mechanism: [] };
}

function measure(): ConfinementCapability {
  // Stage one: does this interpreter accept the flag at all? A runtime without `--permission` answers
  // `bad option` and exits non-zero, and there is nothing after that worth asking.
  const accepted = spawnSync(process.execPath, [PERMISSION_FLAG, "-e", "process.exit(0)"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (accepted.status !== 0) {
    const said = (accepted.stderr ?? "").trim().split(/\r?\n/)[0] ?? "";
    return unavailable(
      `${PERMISSION_FLAG} is not accepted by ${process.execPath}` +
        (said === "" ? "" : `: ${said}`) +
        ", so a child it starts cannot be confined by the permission model",
    );
  }

  // Stage two: does it *enforce*? This is the half that separates a flag from a mechanism.
  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), "veridian-confinement-"));
  } catch (error) {
    return unavailable(
      `the probe could not create a temporary directory (${describe(error)}), so whether this ` +
        "runtime enforces the permission model could not be measured either way",
    );
  }
  const inside = join(root, "inside.txt");
  const outside = join(root, "..", "veridian-confinement-escape.txt");
  try {
    const probe = spawnSync(
      process.execPath,
      [
        PERMISSION_FLAG,
        `--allow-fs-read=${root}`,
        `--allow-fs-write=${root}`,
        "-e",
        probeProgram(inside, outside),
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const reading = readProbe(probe.stdout ?? "");
    const outsideSurvived = existsSync(outside);
    if (outsideSurvived) rmSync(outside, { force: true });

    // The permitted half first, because a probe whose permitted half fails measures nothing about the
    // refused half - the refused half would look identical if the runtime simply refused everything.
    if (reading.inside !== "written") {
      return unavailable(
        `a confined child could not write inside its own allowance (${reading.inside === "" ? "no reading" : reading.inside})` +
          ", so nothing it refused afterwards would say anything about the boundary",
      );
    }
    if (reading.outside === "written" || outsideSurvived) {
      return unavailable(
        `${PERMISSION_FLAG} was accepted but a child wrote outside its allowance anyway, so the ` +
          "flag is present here and the boundary is not",
      );
    }
    return {
      available: true,
      reason: "measured",
      interpreter: process.execPath,
      mechanism: [PERMISSION_FLAG, "--allow-fs-read", "--allow-fs-write", "--allow-child-process"],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The basename of a command, without a trailing `.exe`, lowercased - so `NODE.EXE` is `node`. */
function interpreterOf(command: string): string {
  const base = command.replace(/\\/g, "/").split("/").pop() ?? command;
  return base.replace(/\.exe$/i, "").toLowerCase();
}

/**
 * The directories a confined child must be able to **read** in order to import what it declares.
 *
 * **A program's own source and its dependencies are two different directories, and the permission
 * model does not know the difference.** It enforces its allowlists against the *interpreter's* own
 * module resolution, so a dependency outside the allowance is refused before the program's first
 * statement runs - and the child exits 1 having printed a stack trace that names a file the world
 * never asked for. The world then reports the exit code as the application's failure, which is a
 * verdict about a program that was never given the chance to be wrong.
 *
 * Derived by walking **up** from the directory the child runs in, because that is what Node does: a
 * bare specifier is resolved against the nearest `node_modules` at or above the importing file, so the
 * set of places a dependency can be found is exactly the set of those directories that exist. Only
 * existing directories are named, so an allowance never cites a place that is not there - and a world
 * whose application imports nothing builtin-only contributes nothing, because its upward walk finds
 * `node_modules` only if one is genuinely on the path.
 *
 * **Read only, and that is the whole point of it being a separate function.** A dependency is read and
 * never written, so these roots belong in `readRoots` and must never reach `writeRoots`: the write
 * allowance stays the caller's own, which is the dimension `filesystemWrite` is measured in. A helper
 * that answered both would widen the boundary it was written to keep, and `enforced` would stop
 * meaning what the report says it means.
 */
export function dependencyReadRoots(startDir: string): readonly string[] {
  const roots: string[] = [];
  let current = resolve(startDir);
  for (;;) {
    const modules = join(current, "node_modules");
    if (existsSync(modules)) roots.push(modules);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

/**
 * The argument vector to start, confined when it can be, and a stated reason either way.
 *
 * The command is replaced with {@link ConfinementCapability.interpreter} rather than kept, and that
 * replacement is not cosmetic: `core/process.ts` hands a **bare** command name to `cmd.exe` on
 * Windows, which joins the file and its arguments into one string, and `--allow-fs-read=D:\a path`
 * would arrive damaged. An absolute interpreter path is not resolved through a shell, so the
 * allowance cannot be mangled by one.
 *
 * A non-Node command is not an error and is not a silent fallback: it is a world that starts
 * something the permission model does not reach, and it is told exactly that.
 */
export function confineChild(request: ConfinementRequest): ConfinementResult {
  const plain: ConfinementResult = {
    applied: false,
    command: request.command,
    args: request.args,
    reason: "not confined",
  };
  const capabilityNow = confinementCapability();
  if (!capabilityNow.available) {
    return { ...plain, reason: capabilityNow.reason };
  }
  if (interpreterOf(request.command) !== "node") {
    return {
      ...plain,
      reason:
        `\`${request.command}\` is not a Node interpreter, and the permission model is enforced by ` +
        "the interpreter rather than by the operating system - so this child is an ordinary process " +
        "with the operator's own privileges",
    };
  }
  if (request.readRoots.length === 0) {
    return {
      ...plain,
      reason:
        "no read allowance was given, and a confined child with an empty allowance cannot open the " +
        "program it was asked to run",
    };
  }

  const allowances: string[] = [];
  for (const root of request.readRoots) allowances.push(`--allow-fs-read=${root}`);
  for (const root of request.writeRoots) allowances.push(`--allow-fs-write=${root}`);
  if (request.allowChildProcess === true) allowances.push("--allow-child-process");

  return {
    applied: true,
    command: capabilityNow.interpreter,
    args: [PERMISSION_FLAG, ...allowances, ...request.args],
    reason:
      `confined by ${PERMISSION_FLAG} with ` +
      `${request.readRoots.length === 0 ? "no" : String(request.readRoots.length)} read allowance(s) and ` +
      `${String(request.writeRoots.length)} write allowance(s)`,
  };
}

/** An error as a one-line reading, for a message that has to stay a message. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
