/**
 * What a substrate will actually isolate, and the argument vector that does it.
 *
 * ## Why this file exists
 *
 * `confinement.ts` holds the first half of the boundary: `node --permission` confines a child's
 * `node:fs` calls, and it works. What it cannot do is the network. Measured with a positive control,
 * `--permission` is accepted (exit 0) while `--allow-net=127.0.0.1` is answered `bad option` (exit 9),
 * and `node --help` lists every other allowance beside it and nothing for the network. So
 * `local-process` reported `network: "unenforceable"` - the word that means *a mechanism should exist
 * and demonstrably does not* - and nine worlds reported `unsupported` for it.
 *
 * This file is the substrate that supplies it, and it is deliberately a **second mechanism behind the
 * same seam** rather than a second confinement rule. `core/process.ts` is still the one place a child
 * is started; it now has two ways to start one, chooses between them from the request, and reports
 * which ran.
 *
 * ## The three rules this file inherits from its sibling
 *
 * **The capability is measured, not declared.** A constant saying "a container runtime is installed"
 * would be a claim beside the code, free to disagree with the machine the code is running on. The
 * probe starts a **real container** and reads what happened, including the case that matters most - a
 * runtime that accepts the invocation and does not enforce the boundary.
 *
 * **The probe has two halves, and the permitted one is read first.** A probe that only attempts the
 * refused write cannot tell "the substrate works" from "every write fails", and a substrate that
 * refuses everything passes it and is useless. So the probe writes inside the mounted allowance and
 * expects success, then writes outside it and expects refusal - and `available` requires both.
 *
 * **A request that cannot be isolated is not isolated silently.** `isolateProcess()` returns the
 * argument vector unchanged with `applied: false` and a stated reason. A helper that quietly returned
 * the host vector would make every caller report an isolation it does not have.
 *
 * ## The line between the two mechanisms, stated once
 *
 * They are not alternatives and neither subsumes the other. `--permission` runs the child **on this
 * host**, under this host's interpreter, with this host's filesystem visible but allowlisted - fast,
 * and enough for a world whose subject is a program's own behaviour. The substrate runs the child
 * **inside a container**, so the host's filesystem is not merely allowlisted but absent, and the
 * network can be severed. A world asks for the one whose absence it needs to make its verdict mean
 * something, and the reason it did not get the other is always written down.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

/**
 * The container path each allowance is mounted at.
 *
 * A fixed scheme rather than a translation of the host path, because a host path is not a container
 * path and pretending otherwise is how a mount silently points at the wrong directory. `ro0` is the
 * first read root and `rw0` the first write root; {@link isolateProcess} returns the scheme in its
 * `mounts` field so a caller never has to recompute it.
 */
export const CONTAINER_ROOT = "/veridian";

export interface IsolationMount {
  /** The absolute host path that was mounted. */
  readonly hostPath: string;
  /** Where it appears inside the container. */
  readonly containerPath: string;
  readonly mode: "ro" | "rw";
}

/** What a measurement of this machine produced. Every field is a reading, not an intention. */
export interface IsolationCapability {
  /** True only when a real container really wrote inside its mount and really refused to write outside it. */
  readonly available: boolean;
  /** Why not, when it is not - quoting what the runtime said, never a guess about it. */
  readonly reason: string;
  /** The runtime's own name for itself, e.g. `podman`. Empty when none answered. */
  readonly substrate: string;
  /** The runtime's reported server version, quoted as it gave it. */
  readonly version: string;
  /** The image the probe really ran. */
  readonly image: string;
  /** The flags actually measured to work, in the order they are applied. */
  readonly mechanism: readonly string[];
}

/** What a caller knows about the process it is about to isolate. */
export interface IsolationRequest {
  /** The command as the world declared it. A command that is not in the image gets `applied: false`. */
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory **on the host**. Translated into the container, never passed through. */
  readonly cwd: string;
  /** Host paths the child may read. Mounted read-only. */
  readonly readRoots: readonly string[];
  /** Host paths the child may write. Mounted read-write, and the only writable places there are. */
  readonly writeRoots: readonly string[];
  /**
   * Sever the network.
   *
   * This is the dimension the permission model cannot hold and the reason this file exists. `true`
   * passes `--network=none`, so the child has a loopback interface and nothing to route to; `false`
   * leaves the runtime's default. It is an explicit field rather than a default because a substrate
   * that quietly severed the network for a world that needed it would be a world failing for a
   * reason its own evidence did not name.
   */
  readonly denyNetwork?: boolean;
  /**
   * The environment the child is to be given, in **host** spelling.
   *
   * Stated here, and separate from the environment the runtime process itself is started with, because
   * a container does **not** inherit the environment of the process that started it: `podman run`
   * passes through only what `--env` names. A caller that set the variable on the spawn and stopped
   * there would hand the container nothing, and the program would read `undefined` for the one value
   * it is told where its sandbox is - measured here, by a child that failed with
   * `ERR_INVALID_ARG_TYPE: The "path" argument must be of type string ... Received undefined`.
   *
   * Values are carried as **names** to the runtime (`--env=NAME`), never as `NAME=value` on the command
   * line, so a value that is a credential cannot be read out of the process table on any machine.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/** The vector to start, and whether it is isolated. `reason` is stated either way. */
export interface IsolationResult {
  readonly applied: boolean;
  readonly command: string;
  readonly args: readonly string[];
  /** Why it was not applied, or what was applied. Never empty, so no caller has to guess. */
  readonly reason: string;
  /** Which substrate held it, or `null` when none did. The field the bundle records. */
  readonly substrate: string | null;
  /**
   * Whether the network was really severed, as opposed to merely declared.
   *
   * A reading rather than a copy of the request: it is `true` only when the flag was passed to a
   * substrate that applied. A world that reported `network: enforced` on the strength of its own
   * document would be doing exactly what this file exists to prevent - reading a declaration as an
   * enforcement - and the two differ the moment a document sets `denyNetwork: false` or the machine
   * has no substrate to pass it to.
   */
  readonly denyNetwork: boolean;
  /**
   * The environment the container was told to give the child, already translated to container paths.
   *
   * Returned rather than left to the caller to recompute, because the mounts are decided in here and a
   * caller wanting the same translation would have to derive them a second time and could disagree.
   * The runtime reads each value from **its own** environment, so a caller applies this map to the
   * spawned process rather than adding it to the vector.
   */
  readonly env: Readonly<Record<string, string>>;
  /** What was mounted where. Empty when nothing was applied. */
  readonly mounts: readonly IsolationMount[];
}

/** The runtimes that can hold this boundary, in the order they are tried. */
const RUNTIMES = ["podman", "docker"] as const;

/**
 * The image the child runs in.
 *
 * Overridable because a world whose application needs a dependency outside the Node standard library
 * must be able to name an image that has it, and because a machine that has already pulled a
 * different Node tag should not be forced to pull this one to answer a question about flags.
 */
const DEFAULT_IMAGE = process.env["VERIDIAN_ISOLATION_IMAGE"] ?? "docker.io/library/node:22-alpine";

/**
 * The probe program, run **inside** the container.
 *
 * It writes twice on purpose, and the order is load-bearing: the permitted half is read first, because
 * a probe whose permitted half fails measures nothing about the refused half. Composed with
 * `JSON.stringify` so a path containing a quote cannot break out of the string literal and turn a
 * measurement into a crash.
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

let capability: IsolationCapability | null = null;

/**
 * Measure this machine once, and remember the reading.
 *
 * Memoised because the answer is a property of the host rather than of a run, and because it is
 * expensive: the probe starts a container. A reading that was re-taken per world would turn a
 * five-second demo into a five-minute one and teach a reader to skip the measurement.
 */
export function isolationCapability(): IsolationCapability {
  if (capability !== null) return capability;
  capability = measure();
  return capability;
}

/** Drop the memoised reading. For a test that has to observe the probe rather than its answer. */
export function resetIsolationCapability(): void {
  capability = null;
}

function unavailable(reason: string, substrate = "", version = ""): IsolationCapability {
  return { available: false, reason, substrate, version, image: DEFAULT_IMAGE, mechanism: [] };
}

/**
 * Find a runtime that answers, and read its own name and version back.
 *
 * `--format` asks the runtime for its **server** version rather than its client's. That is the half
 * that matters and the half the first version of this probe got wrong: podman's client is installed
 * and answers `podman version` on a machine whose machine is stopped, so a probe that read the client
 * would report a substrate available and then fail to start anything. A server version only comes
 * back from a runtime that can actually run a container.
 */
function findRuntime(): { readonly name: string; readonly version: string } | { readonly reason: string } {
  const failures: string[] = [];
  for (const candidate of RUNTIMES) {
    const probe = spawnSync(candidate, ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    const said = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
    if (probe.status === 0 && (probe.stdout ?? "").trim() !== "") {
      return { name: candidate, version: (probe.stdout ?? "").trim() };
    }
    // One line, because a runtime that cannot reach its machine prints a paragraph and the paragraph
    // is the same sentence eleven times. The first line names the cause.
    const first = said.split(/\r?\n/).map((row) => row.trim()).filter((row) => row !== "")[0] ?? "no reading";
    failures.push(`${candidate}: ${first}`);
  }
  return { reason: failures.join("; ") };
}

/**
 * The runtime's own executable, so that starting it never needs a shell.
 *
 * ## Why this is not a convenience
 *
 * `core/process.ts` hands a **bare** command name to `cmd.exe` on Windows, because that is the only
 * way `npm` and every other `.cmd` shim resolves - and it refuses to do so for an absolute path, on a
 * rule that was paid for once already. The substrate's command is the runtime's name, which is bare,
 * so without this the entire container vector would be joined into one string by `cmd.exe` **without
 * quoting** and then re-split by it. Two of those arguments cannot survive that:
 *
 * - `--volume=<host path>:<container path>:ro` when the host path contains a space, which on this
 *   machine it does - `C:\Users\...\AppData\Local\Temp\...` is fine and `C:\Program Files\...` is not;
 * - `-e <payload>`, whose parentheses are `cmd.exe` metacharacters, and which is exactly how a
 *   program file is handed to the image's interpreter.
 *
 * Neither was observed, because the probe measures the runtime through `spawnSync` and never through
 * the runner - so this is a hazard rather than a defect found in the wild, and stating it as the
 * former is the point. A path that `CreateProcess` can start directly is returned (`.exe`/`.com` on
 * Windows, the plain name elsewhere); a shim that only a shell can resolve is **not** returned,
 * because the bare name already works and a shell is not something this vector can be run under.
 */
function locate(candidate: string): string {
  const direct = process.platform === "win32" ? [".exe", ".com"] : [""];
  const dirs = (process.env["PATH"] ?? "").split(delimiter);
  for (const dir of dirs) {
    if (dir === "") continue;
    for (const ext of direct) {
      const full = join(dir, `${candidate}${ext}`);
      try {
        if (existsSync(full)) return full;
      } catch {
        // An unreadable `PATH` entry is not a finding about the runtime; the next one is tried.
      }
    }
  }
  return candidate;
}

function measure(): IsolationCapability {
  const found = findRuntime();
  if ("reason" in found) {
    return unavailable(
      `no container runtime answered a server version, so nothing here can hold a network or ` +
        `filesystem boundary a child would not otherwise have (${found.reason})`,
    );
  }

  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), "veridian-isolation-"));
  } catch (error) {
    return unavailable(
      `the probe could not create a temporary directory (${describe(error)}), so whether a ` +
        "substrate is available could not be measured either way",
      found.name,
      found.version,
    );
  }

  const mounted = join(root, "mounted");
  const inside = `${CONTAINER_ROOT}/rw0/inside.txt`;
  const outside = "/veridian-escape.txt";
  try {
    try {
      writeFileSync(mounted, "", "utf8");
    } catch {
      // A directory would make the mount file-vs-directory shape this probe is not about, so a plain
      // file is created and a failure to create it surfaces below as the run's own stderr.
    }
    const run = spawnSync(
      found.name,
      [
        "run",
        "--rm",
        // The rootfs is read-only, which is what makes the refused half a refusal rather than an
        // observation that the container happened to have a writable `/`.
        "--read-only",
        "--network=none",
        `--volume=${root}:${CONTAINER_ROOT}/rw0:rw`,
        `--workdir=${CONTAINER_ROOT}/rw0`,
        DEFAULT_IMAGE,
        "node",
        "-e",
        probeProgram(inside, outside),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 180_000 },
    );

    const reading = readProbe(run.stdout ?? "");
    const hostEscape = existsSync(join(root, "..", "veridian-escape.txt"));

    if (reading.inside !== "written") {
      const said = `${run.stderr ?? ""}`.trim().split(/\r?\n/).filter((row) => row !== "").slice(-1)[0] ?? "";
      return unavailable(
        `a container was started but nothing could write inside its own mount ` +
          `(${reading.inside === "" ? "no reading" : reading.inside})` +
          (said === "" ? "" : `: ${said}`) +
          ", so nothing it refused afterwards would say anything about the boundary",
        found.name,
        found.version,
      );
    }
    if (reading.outside === "written" || hostEscape) {
      return unavailable(
        `the container ran but a child wrote outside its mount anyway, so the runtime is present ` +
          "here and the boundary is not",
        found.name,
        found.version,
      );
    }
    return {
      available: true,
      reason: "measured",
      substrate: found.name,
      version: found.version,
      image: DEFAULT_IMAGE,
      mechanism: ["run", "--read-only", "--network", "--volume", "--workdir"],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assign every allowance a container path, and report the mapping.
 *
 * Read roots come first and write roots after, each numbered from zero in the order the caller gave
 * them, so the scheme is a function of the request rather than of the host's layout. Duplicates are
 * dropped rather than mounted twice - a runtime that is handed the same path as both `ro` and `rw`
 * answers with whichever it processes last, which is a boundary decided by argument order.
 */
export function planMounts(request: IsolationRequest): readonly IsolationMount[] {
  const mounts: IsolationMount[] = [];
  const seen = new Set<string>();
  const add = (hostPath: string, mode: "ro" | "rw", index: number): void => {
    const absolute = resolve(hostPath);
    const key = `${mode}:${absolute}`;
    if (seen.has(key)) return;
    seen.add(key);
    mounts.push({ hostPath: absolute, containerPath: `${CONTAINER_ROOT}/${mode}${String(index)}`, mode });
  };
  request.readRoots.forEach((root, index) => {
    add(root, "ro", index);
  });
  request.writeRoots.forEach((root, index) => {
    // A write root that is also a read root stays writable, because the writable half is the weaker
    // claim and the caller asked for it explicitly. The read-only mount is dropped instead.
    const absolute = resolve(root);
    for (let at = mounts.length - 1; at >= 0; at -= 1) {
      const mount = mounts[at];
      if (mount !== undefined && mount.hostPath === absolute && mount.mode === "ro") mounts.splice(at, 1);
    }
    add(root, "rw", index);
  });
  return mounts;
}

/**
 * Translate a **host** path into the container path it is mounted at.
 *
 * Longest matching prefix wins, and the match is on whole path segments, because a naive `startsWith`
 * maps `D:\sandbox-other` into the mount for `D:\sandbox` - which would hand the child a path that
 * looks inside its allowance and is not. A path under no mount is returned unchanged and the caller
 * is expected to have checked {@link mountFor} first: this function answers *where*, and whether
 * there is anywhere is a different question.
 */
export function containerPathOf(mounts: readonly IsolationMount[], hostPath: string): string | null {
  const absolute = resolve(hostPath);
  let best: IsolationMount | null = null;
  for (const mount of mounts) {
    const candidate = resolve(mount.hostPath);
    if (absolute !== candidate && !absolute.startsWith(candidate.endsWith(sep) ? candidate : `${candidate}${sep}`)) {
      continue;
    }
    if (best === null || candidate.length > resolve(best.hostPath).length) best = mount;
  }
  if (best === null) return null;
  const rest = absolute.slice(resolve(best.hostPath).length).replace(/^[\\/]+/u, "");
  return rest === "" ? best.containerPath : `${best.containerPath}/${rest.split(/[\\/]+/u).join("/")}`;
}

/**
 * Rewrite the environment a containerised child is given, so its path-valued entries name the mounts.
 *
 * ## Why this belongs here rather than in each world
 *
 * A world tells its application where its own files are through the environment - `local-process`
 * passes the sandbox root and the application directory that way, and every criterion's `run` step
 * carries them. Those values are host paths, and a host path inside a container names a directory the
 * container does not have. So a world that adopted the substrate without this would hand its program
 * `C:\...\sandbox` and watch it write into nowhere, and it would report that the application failed to
 * produce its output - an environment failure wearing the application's clothes.
 *
 * The world *could* have done this translation itself, since it knows which of its own names carry
 * paths. It should not: the mounts are the substrate's business, and a world that had to re-derive
 * them to describe itself would be a world that has to know how it is being held. The runner knows,
 * so the runner rewrites.
 *
 * ## What decides a rewrite
 *
 * A value is rewritten when it is **absolute** and lies **under a mount** - the same two questions
 * {@link containerPathOf} answers, asked before it is called. Both halves are load-bearing:
 *
 * - *absolute* is what keeps a flag from being rewritten. `production`, `1`, `utf8` are values, not
 *   paths, and a `containerPathOf` call on one would resolve it against the current directory and
 *   could land inside a mount by accident - rewriting a mode into a directory name;
 * - *under a mount* is what leaves everything else alone. A `PATH` on Windows is absolute by
 *   `path.isAbsolute` and is a list, and it is not under any mount, so it survives intact. Nothing
 *   here claims this is a general solution for path lists: it claims that a single path-valued
 *   variable naming a directory the container can see must name the container's spelling of it, and
 *   that is exactly the class of value this rewrites.
 */
export function containerEnv(
  mounts: readonly IsolationMount[],
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const translated = isAbsolute(value) ? containerPathOf(mounts, value) : null;
    rewritten[name] = translated ?? value;
  }
  return rewritten;
}

/** The basename of a command, without a trailing `.exe`, lowercased - so `NODE.EXE` is `node`. */
function interpreterOf(command: string): string {
  const base = command.replace(/\\/g, "/").split("/").pop() ?? command;
  return base.replace(/\.exe$/iu, "").toLowerCase();
}

/**
 * The argument vector to start, isolated when it can be, and a stated reason either way.
 *
 * A request that cannot be isolated is not an error and is not a silent fallback: it is a world that
 * asked for a boundary this machine cannot hold, and it is told exactly that so its own report can
 * say `unsupported` with a reason rather than with a shrug.
 *
 * ## The command is resolved **inside** the container, and that is not a detail
 *
 * The first version of this function required the command to sit under an allowance, and the reading
 * it produced on the machine it was written for was a refusal naming `C:\Program Files\nodejs\node.exe`.
 * That refusal was the function being wrong rather than the machine: a host interpreter path is
 * meaningless inside a container, and no allowance can contain it, because the interpreter *is* the
 * thing doing the containing. {@link ./confinement.ts}'s `confineChild()` replaces the command with
 * the host interpreter for the same reason in the other direction; here the container's own `node`
 * is the interpreter and the host's path is dropped. A command that is not an interpreter is a
 * program file, and that **is** translated through the mounts, because it has to come from somewhere.
 *
 * Arguments are translated by the same rule and only when they are absolute host paths under a mount.
 * A flag or a literal is passed through untouched, because the translation is a prefix substitution
 * and a relative argument has no prefix to substitute - which is what keeps `-e` payloads intact.
 */
export function isolateProcess(request: IsolationRequest): IsolationResult {
  const plain: IsolationResult = {
    applied: false,
    command: request.command,
    args: request.args,
    reason: "not isolated",
    substrate: null,
    denyNetwork: false,
    env: { ...(request.env ?? {}) },
    mounts: [],
  };
  const now = isolationCapability();
  if (!now.available) return { ...plain, reason: now.reason };

  if (request.readRoots.length === 0 && request.writeRoots.length === 0) {
    return {
      ...plain,
      reason:
        "no allowance was given, and an isolated child with nothing mounted cannot open the " +
        "program it was asked to run",
    };
  }

  const mounts = planMounts(request);
  const workdir = containerPathOf(mounts, request.cwd);
  if (workdir === null) {
    return {
      ...plain,
      reason:
        `the working directory ${request.cwd} is not under any allowance, so the child would start ` +
        "somewhere its own mounts do not reach",
    };
  }

  // The interpreter, or a program file translated through the mounts. `null` from the translation
  // means the caller named a command the container cannot reach, and widening the mounts to include
  // it would be the overclaim this file exists to remove.
  const isInterpreter = interpreterOf(request.command) === "node";
  const program = isInterpreter ? "node" : containerPathOf(mounts, request.command);
  if (program === null) {
    return {
      ...plain,
      reason:
        `\`${request.command}\` is neither a Node interpreter the image supplies nor a path under any ` +
        "allowance, so the container has nothing to start",
    };
  }

  const translated = request.args.map((arg) =>
    isAbsolute(arg) ? containerPathOf(mounts, arg) ?? arg : arg,
  );

  const args: string[] = ["run", "--rm", "--read-only", "--workdir", workdir];
  // Severed, never merely declared. A substrate that left the default bridge in place while the
  // world reported an enforced network boundary would be the overclaim this file exists to remove.
  if (request.denyNetwork === true) args.push("--network=none");
  for (const mount of mounts) args.push(`--volume=${mount.hostPath}:${mount.containerPath}:${mount.mode}`);
  // The names only. `--env=NAME` takes the value from the runtime's own environment, so a secret stays
  // out of the process table - and a container inherits nothing by default, which is the defect this
  // loop repairs rather than an optimisation.
  const environment = containerEnv(mounts, request.env ?? {});
  for (const name of Object.keys(environment)) args.push(`--env=${name}`);
  args.push(now.image, program, ...translated);

  return {
    applied: true,
    command: locate(now.substrate),
    args,
    reason:
      `isolated by ${now.substrate} ${now.version} in ${now.image} with ` +
      `${String(mounts.filter((mount) => mount.mode === "ro").length)} read mount(s), ` +
      `${String(mounts.filter((mount) => mount.mode === "rw").length)} write mount(s)` +
      (request.denyNetwork === true ? " and the network severed" : " and the network left as the runtime defaults it") +
      (isInterpreter ? "; the interpreter is the image's own" : ""),
    substrate: now.substrate,
    denyNetwork: request.denyNetwork === true,
    env: environment,
    mounts,
  };
}

/** An error as a one-line reading, for a message that has to stay a message. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
