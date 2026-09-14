/**
 * The substitute for a Linux host: a real filesystem, real accounts, real listening sockets, and the
 * distro machinery that is declared rather than present.
 *
 * ## What is real and what is substituted
 *
 * Real: the sandbox root is a real directory tree on this machine's disk; every file's bytes, size
 * and hash are read from those real bytes; a service that starts really binds a real TCP socket on
 * loopback and `posix.port` really connects to it; `nmap` really opens connections. `read()` walks the
 * real tree, so a file the *application* wrote appears in the reading without the world having been
 * told about it - which is the property that separates this from a stub. A stub returns an empty
 * observation; this one would still report the file if every line of the world's own bookkeeping were
 * deleted, because the file is really there.
 *
 * Substituted, and listed in {@link POSIX_SIMULATED_SURFACES}: the kernel (no isolation - the child is
 * an ordinary process on this host), the distribution identity, the package manager and its index,
 * the permission decision, and egress.
 *
 * ## Why the programs are a register rather than a directory of scripts
 *
 * `apt-get`, `systemctl`, `adduser`, `chmod`, `chown`, `cat`, `id`, `test`, `curl` and `nmap` are
 * answered **in process** by this world, not spawned. The alternative - writing real executables into
 * the sandbox's `bin/` - needs an interpreter, and the interpreter would be a second substitution with
 * its own quoting rules to get wrong; a `.mjs` child would also need a channel back to this process to
 * mutate the world, which is a socket that does not exist on a real host and would therefore be a
 * *less* faithful interface, not a more faithful one.
 *
 * What makes the substitution honest instead is that each entry **really performs its operation**: the
 * file is really written, the account is really added to a table that is really written to
 * `/etc/passwd`, the port is really bound. The declared surface is the distro machinery, and nothing
 * else. A program that is neither in the register nor on the host's real `PATH` is *refused*, not
 * faked - and the refusal names the register, so a contract that needs `grep` learns that in a
 * sentence rather than in a mysterious `FAIL` against the application.
 *
 * `sh` is refused on purpose and the refusal is written out: a command line would need a shell, and a
 * shell is a substitution with its own parsing to get wrong - while the interesting question ("can
 * this account read that file?") is asked perfectly well by naming a program and its arguments.
 *
 * ## The permission decision
 *
 * The host may be Windows, where `chmod` cannot express `0600` at all, so a world that asked the
 * filesystem for a mode would report the developer's platform rather than the world. Instead modes
 * and owners are recorded here, and `cat`/`test -r` decide against that record exactly as a POSIX
 * kernel decides `open(2)` against an inode's mode: same owner → owner bits; same group → group bits;
 * otherwise other bits. The decision is the kernel's; the enforcement is the world's; and
 * `permissions` is on the simulated list so no reading can be mistaken for the host's own answer.
 *
 * ## A read must not mutate
 *
 * `read()` is a pure function of the world's state and the real tree. It writes nothing, advances no
 * counter and starts no listener - because M1 compares exactly these documents across runs, and an
 * observation that edits what it observes cannot be repeated. The `cluster-port` event counter is the
 * precedent this rule was paid for.
 */

import { createHash } from "node:crypto";
import { createConnection, createServer, type Server } from "node:net";
import { lstat, mkdir, readdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import { POSIX_SIMULATED_SURFACES } from "../../core/environment/posix-observation.ts";
import type {
  PosixExecRecord,
  PosixExecResult,
  PosixExecSource,
  PosixFileKind,
  PosixFileReading,
  PosixObservationData,
  PosixPackageReading,
  PosixPortReading,
  PosixServiceReading,
  PosixUserReading,
} from "../../core/environment/posix-observation.ts";

/** One entry of the world's package index. A manifest, not a remote repository. */
interface IndexEntry {
  readonly name: string;
  readonly version: string;
  readonly depends: readonly string[];
}

/**
 * The available set.
 *
 * A world with an empty index would make `apt-get install` fail for every package, and the failure
 * would be indistinguishable from an application that asked for something absurd. Naming a handful of
 * packages makes the interesting failure reachable: a package that is *absent from the index* is a
 * refusal the application caused, and it says so.
 */
const PACKAGE_INDEX: readonly IndexEntry[] = [
  { name: "openssl", version: "3.0.13-1", depends: [] },
  { name: "libpcre3", version: "2:8.39-15", depends: [] },
  { name: "nginx", version: "1.24.0-1", depends: ["libpcre3"] },
  { name: "ufw", version: "0.36.2-1", depends: [] },
  { name: "fail2ban", version: "1.0.2-3", depends: [] },
];

/** The accounts every host has. The run's own account is added on top, from the declaration. */
const BASE_USERS: readonly PosixUserReading[] = [
  { name: "root", uid: 0, gid: 0, shell: "/bin/sh", home: "/root", groups: ["root"] },
  { name: "daemon", uid: 1, gid: 1, shell: "/usr/sbin/nologin", home: "/", groups: ["daemon"] },
];

const DEFAULT_MODE = "0644";
const DIRECTORY_MODE = "0755";
/** Contents beyond this are not carried in the reading; the hash still is. */
const TEXT_BOUND = 64 * 1024;

interface Inode {
  mode: string;
  owner: string;
  group: string;
}

interface Outcome {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly result?: PosixExecResult;
  readonly reason?: string;
}

export interface ExecRequest {
  readonly argv: readonly string[];
  readonly source: PosixExecSource;
}

export interface PosixPortOptions {
  /** Host path of the sandbox root. The world's `/` is this directory. */
  readonly root: string;
  /** The distribution identity the environment document declared. */
  readonly distribution: string;
  /** The account the application runs as, and therefore the account a `run` step acts as. */
  readonly user: string;
}

export interface PosixPort {
  /** Build the sandbox: the real tree, the base accounts, the seeded packages. */
  prepare(): Promise<void>;
  /** Rebuild the sandbox from nothing. Keeps the exec record; see {@link PosixPort.record}. */
  reset(): Promise<void>;
  /** Execute one program. In-process for a substituted program; refused when nothing answers. */
  exec(request: ExecRequest): Promise<PosixExecRecord>;
  /** File a command the *adapter* ran as a real child, so the record holds it too. */
  record(record: PosixExecRecord): void;
  /**
   * Photograph the world into a directory of its own: the tree copied, the bookkeeping beside it.
   *
   * The tree alone is not a snapshot of this world. `0600`, an owner, an installed package and a
   * running service are facts the reading reports and the *kernel* holds; copying the files would
   * restore contents while losing the modes and the accounts that decide whether those contents may
   * be read at all - so a restore would hand back a world in which every hardening criterion fails
   * for a reason the application never caused.
   */
  snapshot(destination: string): Promise<void>;
  /** Put a snapshot back: the tree, the bookkeeping, and the sockets the snapshot had bound. */
  restoreFrom(source: string): Promise<void>;
  /** The reading. Pure: writes nothing and advances nothing. */
  read(): Promise<PosixObservationData>;
  /** Release listeners. Never removes the root, so a bundle's paths still resolve after a run. */
  stop(): Promise<void>;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const modeValue = (mode: string): number => Number.parseInt(mode, 8);

/** Same owner → owner bits, same group → group bits, otherwise other bits. `open(2)`, in miniature. */
function mayRead(mode: string, owner: string, group: string, user: string, userGroup: string): boolean {
  if (user === "root") return true;
  const bits = modeValue(mode);
  const shift = user === owner ? 6 : userGroup === group ? 3 : 0;
  return ((bits >> shift) & 0b100) !== 0;
}

export function posixPort(options: PosixPortOptions): PosixPort {
  const { root, distribution, user } = options;
  const inodes = new Map<string, Inode>();
  const users = new Map<string, PosixUserReading>();
  const packages = new Map<string, PosixPackageReading>();
  const services = new Map<string, { running: boolean; pid: number | null; command: string }>();
  const listeners = new Map<number, Server>();
  const execs: PosixExecRecord[] = [];
  /**
   * The account numbering this world hands out. `let` rather than `const` because a restore puts the
   * counters back with the accounts: a snapshot taken after two accounts were added and a restore that
   * reset the counter would hand the *next* account the uid of one that already exists, so
   * `/etc/passwd` would name two different people the same number.
   */
  let uid = 1000;
  let gid = 1000;

  /** Host path of a sandbox path. The only place the two spellings meet. */
  const host = (sandboxPath: string): string => join(root, ...sandboxPath.split("/").filter(Boolean));

  const note = (path: string, mode: string, owner = user, group = user): void => {
    inodes.set(path, { mode, owner, group });
  };

  const write = async (
    path: string,
    contents: string,
    mode = DEFAULT_MODE,
    owner = user,
    group = owner,
  ): Promise<void> => {
    await mkdir(dirname(host(path)), { recursive: true });
    await writeFile(host(path), contents, "utf8");
    note(path, mode, owner, group);
  };

  /**
   * The inode for a sandbox path: the record when the world made the file, the real file otherwise.
   *
   * The fallback is what makes the application's *own* writes visible to the substituted programs.
   * Without it `cat` would answer "No such file or directory" for a file really sitting on disk,
   * because the world only learns about a file by walking the tree - and a reading that can see a
   * file no program can read is a contradiction a contract would report as a defect in the
   * application. A file the application wrote belongs to the account it ran as, at `0644`, unless the
   * application itself said otherwise through `chmod`.
   */
  const inodeAt = async (path: string): Promise<Inode | null> => {
    const recorded = inodes.get(path);
    if (recorded !== undefined) return recorded;
    const stats = await lstat(host(path)).catch(() => null);
    if (stats === null) return null;
    return stats.isDirectory()
      ? { mode: DIRECTORY_MODE, owner: "root", group: "root" }
      : { mode: DEFAULT_MODE, owner: user, group: user };
  };

  const passwdText = (): string =>
    [...users.values()]
      .sort((left, right) => left.uid - right.uid)
      .map((entry) => `${entry.name}:x:${entry.uid}:${entry.gid}:${entry.name}:${entry.home}:${entry.shell}`)
      .join("\n")
      .concat("\n");

  const groupText = (): string =>
    [...new Set([...users.values()].flatMap((entry) => entry.groups))]
      .sort()
      .map((name) => `${name}:x:${name === user ? gid : name === "root" ? 0 : 1}:`)
      .join("\n")
      .concat("\n");

  const flushAccounts = async (): Promise<void> => {
    await write("/etc/passwd", passwdText(), "0644", "root");
    await write("/etc/group", groupText(), "0644", "root");
  };

  // ---- the substitute register -----------------------------------------------------------------

  /** Parse a real unit file. `ExecStart=` gives the command, `Port=` gives the listening port. */
  const unitOf = async (name: string): Promise<{ command: string; port: number | null } | null> => {
    const text = await readFile(host(`/etc/systemd/system/${name}.service`), "utf8").catch(() => null);
    if (text === null) return null;
    const command = /^ExecStart=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
    const raw = /^Port=(\d+)$/m.exec(text)?.[1];
    return { command, port: raw === undefined ? null : Number(raw) };
  };

  const startService = async (name: string): Promise<Outcome> => {
    const unit = await unitOf(name);
    if (unit === null) {
      return {
        exitCode: 5,
        stderr: `Failed to start ${name}.service: Unit ${name}.service not found.`,
      };
    }
    const boundPort = unit.port;
    if (boundPort !== null && !listeners.has(boundPort)) {
      const server = createServer();
      await new Promise<void>((settle, refuse) => {
        server.once("error", refuse);
        server.listen(boundPort, "127.0.0.1", () => settle());
      });
      listeners.set(boundPort, server);
    }
    services.set(name, { running: true, pid: 1000 + services.size, command: unit.command });
    return { exitCode: 0, stdout: "" };
  };

  const aptGet = async (argv: readonly string[]): Promise<Outcome> => {
    const verb = argv[0];
    if (verb === "update") return { exitCode: 0, stdout: "Reading package lists... Done\n" };
    if (verb !== "install" && verb !== "remove") {
      return { exitCode: 2, stderr: "E: Invalid operation\n" };
    }
    const names = argv.slice(1).filter((entry) => !entry.startsWith("-"));
    if (names.length === 0) return { exitCode: 1, stderr: "E: no package named\n" };
    if (verb === "remove") {
      const missing = names.filter((name) => packages.get(name)?.status !== "installed");
      if (missing.length > 0) {
        return { exitCode: 100, stderr: `E: Package '${missing[0]}' is not installed, so not removed\n` };
      }
      for (const name of names) {
        const held = packages.get(name);
        if (held) packages.set(name, { ...held, status: "removed" });
      }
      return { exitCode: 0, stdout: "Removing... Done\n" };
    }
    // Resolve dependencies from the index, transitively. A real manager does; a table lookup does not,
    // and the difference is the whole reason a contract can ask whether a dependency was installed.
    const wanted: string[] = [];
    const queue = [...names];
    while (queue.length > 0) {
      const name = queue.shift();
      if (name === undefined || wanted.includes(name)) continue;
      const entry = PACKAGE_INDEX.find((candidate) => candidate.name === name);
      if (entry === undefined) {
        return { exitCode: 100, stderr: `E: Unable to locate package ${name}\n` };
      }
      wanted.push(name);
      queue.push(...entry.depends);
    }
    for (const name of wanted) {
      const entry = PACKAGE_INDEX.find((candidate) => candidate.name === name);
      if (entry === undefined) continue;
      packages.set(name, {
        name,
        version: entry.version,
        status: "installed",
        installedBy: execs.at(-1)?.source ?? "world",
      });
    }
    return { exitCode: 0, stdout: `Setting up ${wanted.join(" ")} ...\n` };
  };

  /**
   * Parse `adduser`'s arguments the way the real one does: a flag that takes a value consumes the
   * word after it, so that word is the flag's value and never an operand.
   *
   * This was a defect and not a detail. The old parse was "flags are the words that start with `-`,
   * operands are the rest", so `adduser --system --home /var/lib/cart-web cart` produced operands
   * `["/var/lib/cart-web", "cart"]` - the *home directory* became the account and the account name
   * became a group to join. `adduser` still reported exit 0, `/etc/passwd` gained an account named
   * after a directory, and a criterion asking whether `cart` exists read a world in which no such
   * account ever existed. *A flag's value is not an operand*, and a substitute that cannot tell the
   * two apart reports success for a command it did not perform.
   */
  const parseAddUser = (
    argv: readonly string[],
  ): { name: string | null; home: string | null; groups: readonly string[]; system: boolean } => {
    const operands: string[] = [];
    let home: string | null = null;
    let system = false;
    for (let index = 0; index < argv.length; index += 1) {
      const word = argv[index];
      if (word === undefined) continue;
      if (word === "--system" || word === "-r") {
        system = true;
        continue;
      }
      if (word === "--home" || word === "-d") {
        home = argv[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (word.startsWith("--home=")) {
        home = word.slice("--home=".length);
        continue;
      }
      if (word.startsWith("-")) continue; // A flag this substitute does not act on.
      operands.push(word);
    }
    return { name: operands[0] ?? null, home, groups: operands.slice(1), system };
  };

  const addUser = async (argv: readonly string[]): Promise<Outcome> => {
    const { name, home, groups, system } = parseAddUser(argv);
    if (name === null) return { exitCode: 1, stderr: "adduser: missing username\n" };
    if (users.has(name)) return { exitCode: 1, stderr: `adduser: The user \`${name}' already exists.\n` };
    // `adduser <name> [group]` - any further bare word is a group to join, which is how a provisioner
    // creates the service account and then puts it in a group.
    const nextUid = system ? 100 + users.size : Math.max(uid, ...[...users.values()].map((e) => e.uid + 1));
    users.set(name, {
      name,
      uid: nextUid,
      gid: nextUid,
      shell: system ? "/usr/sbin/nologin" : "/bin/sh",
      home: home ?? `/${name}`,
      groups: [name, ...groups],
    });
    await flushAccounts();
    return { exitCode: 0, stdout: `Adding user \`${name}' ...\n` };
  };

  const chmod = async (argv: readonly string[]): Promise<Outcome> => {
    const [mode, ...paths] = argv;
    if (mode === undefined || paths.length === 0) {
      return { exitCode: 1, stderr: "chmod: missing operand\n" };
    }
    if (!/^[0-7]{3,4}$/.test(mode)) {
      return { exitCode: 1, stderr: `chmod: invalid mode: \`${mode}'\n` };
    }
    const canonical = mode.padStart(4, "0");
    for (const path of paths) {
      const held = await inodeAt(path);
      if (held === null) {
        return { exitCode: 1, stderr: `chmod: cannot access '${path}': No such file or directory\n` };
      }
      inodes.set(path, { ...held, mode: canonical });
    }
    return { exitCode: 0 };
  };

  const chown = async (argv: readonly string[]): Promise<Outcome> => {
    const [spec, ...paths] = argv;
    if (spec === undefined || paths.length === 0) {
      return { exitCode: 1, stderr: "chown: missing operand\n" };
    }
    const [owner, group] = spec.split(":");
    for (const path of paths) {
      const held = await inodeAt(path);
      if (held === null) {
        return { exitCode: 1, stderr: `chown: cannot access '${path}': No such file or directory\n` };
      }
      inodes.set(path, {
        ...held,
        owner: owner === undefined || owner === "" ? held.owner : owner,
        group: group === undefined || group === "" ? held.group : group,
      });
    }
    return { exitCode: 0 };
  };

  const kindOf = async (path: string): Promise<PosixFileKind | null> => {
    const recorded = inodes.get(path);
    if (recorded !== undefined) return recorded.mode === DIRECTORY_MODE ? "directory" : "file";
    const stats = await lstat(host(path)).catch(() => null);
    if (stats === null) return null;
    if (stats.isSymbolicLink()) return "symlink";
    return stats.isDirectory() ? "directory" : "file";
  };

  const readFileAsUser = async (path: string): Promise<Outcome> => {
    const held = await inodeAt(path);
    if (held === null) {
      return { exitCode: 1, stderr: `cat: ${path}: No such file or directory\n` };
    }
    if (!mayRead(held.mode, held.owner, held.group, user, user)) {
      return { exitCode: 1, stderr: `cat: ${path}: Permission denied\n` };
    }
    if (held.mode === DIRECTORY_MODE) return { exitCode: 1, stderr: `cat: ${path}: Is a directory\n` };
    const text = await readFile(host(path), "utf8").catch(() => null);
    if (text === null) return { exitCode: 1, stderr: `cat: ${path}: Is a directory\n` };
    return { exitCode: 0, stdout: text };
  };

  const test = async (argv: readonly string[]): Promise<Outcome> => {
    const flag = argv[0];
    const path = argv[1];
    if (flag === undefined || path === undefined) return { exitCode: 2, stderr: "test: missing operand\n" };
    const held = await inodeAt(path);
    const kind = await kindOf(path);
    const holds =
      flag === "-e"
        ? held !== null
        : flag === "-f"
          ? kind === "file"
          : flag === "-d"
            ? kind === "directory"
            : flag === "-r" && held !== null
              ? mayRead(held.mode, held.owner, held.group, user, user)
              : false;
    return { exitCode: holds ? 0 : 1 };
  };

  /**
   * A real connect to a real loopback port.
   *
   * `nmap` is the one program here that *observes* rather than mutates, and it is genuinely real: the
   * sockets it reaches were bound by this world in response to the application's own `systemctl start`
   * and by nothing else. A contract that asks whether a port is exposed therefore reads an answer the
   * world earned.
   */
  const nmap = async (argv: readonly string[]): Promise<Outcome> => {
    const target = argv.find((entry) => /^\d+$/.test(entry) || /:\d+$/.test(entry));
    if (target === undefined) {
      return { exitCode: 1, stderr: "nmap: no target\n" };
    }
    const digits = /\d+$/.exec(target)?.[0];
    const port = digits === undefined ? null : Number(digits);
    const open =
      port !== null && (await connects(port))
        ? `PORT     STATE SERVICE\n${port}/tcp open  unknown\n`
        : `PORT     STATE SERVICE\n${port ?? "?"}/tcp closed unknown\n`;
    return { exitCode: 0, stdout: open };
  };

  const connects = async (port: number): Promise<boolean> =>
    new Promise<boolean>((settle) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      const done = (value: boolean): void => {
        socket.destroy();
        settle(value);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });

  const REGISTER: ReadonlyMap<string, (argv: readonly string[]) => Promise<Outcome>> = new Map([
    ["apt-get", aptGet],
    ["apt", aptGet],
    ["adduser", addUser],
    ["useradd", addUser],
    ["chmod", chmod],
    ["chown", chown],
    [
      "systemctl",
      async (argv) => {
        const verb = argv[0];
        const name = (argv[1] ?? "").replace(/\.service$/, "");
        const held = services.get(name);
        if (verb === "start") return startService(name);
        if (verb === "stop") {
          const unit = await unitOf(name);
          if (unit?.port !== null && unit?.port !== undefined) {
            listeners.get(unit.port)?.close();
            listeners.delete(unit.port);
          }
          services.set(name, { running: false, pid: null, command: held?.command ?? "" });
          return { exitCode: 0 };
        }
        if (verb === "enable" || verb === "disable") return { exitCode: 0 };
        if (verb === "is-active") {
          return { exitCode: held?.running === true ? 0 : 3, stdout: `${held?.running === true ? "active" : "inactive"}\n` };
        }
        if (verb === "status") {
          return held?.running === true
            ? { exitCode: 0, stdout: `* ${name}.service - ${held.command}\n   Active: active (running)\n` }
            : { exitCode: 3, stderr: `* ${name}.service\n   Active: inactive (dead)\n` };
        }
        return { exitCode: 1, stderr: "systemctl: unknown verb\n" };
      },
    ],
    ["cat", async (argv) => readFileAsUser(argv[0] ?? "")],
    [
      "id",
      async () => {
        const held = users.get(user);
        const groups = held?.groups.join(",") ?? user;
        return { exitCode: 0, stdout: `uid=${held?.uid ?? uid}(${user}) gid=${held?.gid ?? gid}(${user}) groups=${groups}\n` };
      },
    ],
    ["test", test],
    [
      "curl",
      // `egress` is a declared substitute: there is no network beyond loopback, so this is refused
      // rather than answered. A contract that asks whether the application reached out reads this
      // through `posix.ran`, and the answer is a fact about an attempt rather than about a page.
      async (argv) => ({
        exitCode: 6,
        stderr: `curl: (6) Could not resolve host: ${argv.at(-1) ?? ""}\n`,
        result: "refused",
        reason: "this world has no egress; nothing outside 127.0.0.1 can be reached from the sandbox",
      }),
    ],
    ["nmap", nmap],
  ]);

  // ---- filesystem reading ----------------------------------------------------------------------

  /**
   * Walk the real tree.
   *
   * Real bytes, real sizes, real hashes - so a file the application wrote is in the reading whether
   * or not the world was told about it. Modes and owners come from the inode record when the world
   * made the file and from the run's own account when the application did, because the host may not
   * be able to express a mode at all.
   */
  const walk = async (dir: string, found: PosixFileReading[]): Promise<void> => {
    const entries = await readdir(host(dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = posix.join(dir, entry.name);
      const hostPath = host(path);
      const stats = await lstat(hostPath).catch(() => null);
      if (stats === null) continue;
      const record = inodes.get(path);
      const mode = record?.mode ?? (entry.isDirectory() ? DIRECTORY_MODE : DEFAULT_MODE);
      const owner = record?.owner ?? (mode === DIRECTORY_MODE ? "root" : user);
      const group = record?.group ?? (mode === DIRECTORY_MODE ? "root" : user);
      if (entry.isDirectory()) {
        found.push({
          path,
          kind: "directory",
          bytes: 0,
          mode,
          owner,
          group,
          sha256: null,
          text: null,
          textWithheld: "a directory has no contents",
        });
        await walk(path, found);
        continue;
      }
      if (entry.isSymbolicLink()) {
        found.push({
          path,
          kind: "symlink",
          bytes: 0,
          mode,
          owner,
          group,
          sha256: null,
          text: null,
          textWithheld: "a symbolic link is not followed; the link is the reading",
        });
        continue;
      }
      const data = await readFile(hostPath).catch(() => null);
      if (data === null) continue;
      const isText = !data.includes(0) && data.length <= TEXT_BOUND;
      found.push({
        path,
        kind: "file",
        bytes: data.length,
        mode,
        owner,
        group,
        sha256: sha256(data),
        text: isText ? data.toString("utf8") : null,
        textWithheld: isText
          ? null
          : data.length > TEXT_BOUND
            ? `contents exceed ${TEXT_BOUND} bytes; the hash is the reading`
            : "contents are not text",
      });
    }
  };

  const serviceReadings = async (): Promise<readonly PosixServiceReading[]> => {
    const names = new Set([...services.keys(), ...(await unitsOnDisk())]);
    return [...names].sort().map((name) => {
      const held = services.get(name);
      return {
        name,
        status: held?.running === true ? ("running" as const) : ("stopped" as const),
        enabled: held?.running === true,
        command: held?.command ?? "",
        pid: held?.running === true ? (held.pid ?? null) : null,
      };
    });
  };

  const unitsOnDisk = async (): Promise<readonly string[]> => {
    const entries = await readdir(host("/etc/systemd/system")).catch(() => []);
    return entries.filter((name) => name.endsWith(".service")).map((name) => name.replace(/\.service$/, ""));
  };

  /** `true` only when a socket was really reached. A table entry alone is not an observation. */
  const portReadings = async (): Promise<readonly PosixPortReading[]> => {
    const ports = [...new Set([...listeners.keys(), ...(await unitPorts())])].sort((a, b) => a - b);
    const readings: PosixPortReading[] = [];
    for (const port of ports) {
      const listening = await connects(port);
      readings.push({
        port,
        protocol: "tcp",
        address: "127.0.0.1",
        state: listening ? "listening" : "closed",
        service: services.get(serviceForPort(port) ?? "")?.running === true ? serviceForPort(port) : null,
        verified: listening,
      });
    }
    return readings;
  };

  const serviceForPort = (port: number): string | null => {
    for (const [name, held] of services) {
      if (held.running) {
        const unit = unitOfCache.get(name);
        if (unit === port) return name;
      }
    }
    return null;
  };

  /** Cached by `prepare()`/`reset()`, so `read()` stays free of disk work it does not need. */
  const unitOfCache = new Map<string, number>();

  const unitPorts = async (): Promise<readonly number[]> => {
    unitOfCache.clear();
    const ports: number[] = [];
    for (const name of await unitsOnDisk()) {
      const unit = await unitOf(name);
      if (unit?.port !== null && unit?.port !== undefined) {
        unitOfCache.set(name, unit.port);
        ports.push(unit.port);
      }
    }
    return ports;
  };

  // ---- lifecycle -------------------------------------------------------------------------------

  const seed = async (): Promise<void> => {
    for (const dir of ["/etc/systemd/system", "/var/log", "/var/www", "/run", "/home", "/tmp"]) {
      await mkdir(host(dir), { recursive: true });
      note(dir, DIRECTORY_MODE, "root", "root");
    }
    users.clear();
    for (const entry of BASE_USERS) users.set(entry.name, entry);
    users.set(user, { name: user, uid, gid, shell: "/bin/sh", home: `/home/${user}`, groups: [user] });
    packages.clear();
    packages.set("openssl", {
      name: "openssl",
      version: PACKAGE_INDEX.find((entry) => entry.name === "openssl")?.version ?? "3.0.13-1",
      status: "installed",
      installedBy: "world",
    });
    services.clear();
    unitOfCache.clear();
    await write("/etc/os-release", `ID=${distribution}\nPRETTY_NAME="${distribution}"\n`, "0644", "root");
    await write("/etc/hostname", "veridian-sim-posix\n", "0644", "root");
    await write("/etc/motd", "authorised use only\n", "0644", "root");
    await flushAccounts();
  };

  const closeListeners = (): void => {
    for (const server of listeners.values()) server.close();
    listeners.clear();
  };

  /**
   * The bookkeeping, as a document.
   *
   * A map is not JSON and a `Map` round-trip that silently became `{}` would restore a world whose
   * files have owners no account holds - which is exactly the failure a snapshot is taken to prevent.
   * So both directions are written out here, in one place, keyed by path like the readings are.
   */
  const dumpWorld = (): string =>
    JSON.stringify(
      {
        inodes: [...inodes.entries()],
        users: [...users.values()],
        packages: [...packages.values()],
        services: [...services.entries()],
        uid,
        gid,
      },
      null,
      2,
    );

  const loadWorld = (text: string): void => {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("this world's snapshot does not hold a readable state document");
    }
    const state = parsed as {
      inodes?: [string, Inode][];
      users?: PosixUserReading[];
      packages?: PosixPackageReading[];
      services?: [string, { running: boolean; pid: number | null; command: string }][];
      uid?: number;
      gid?: number;
    };
    inodes.clear();
    for (const [path, inode] of state.inodes ?? []) inodes.set(path, inode);
    users.clear();
    for (const entry of state.users ?? []) users.set(entry.name, entry);
    packages.clear();
    for (const entry of state.packages ?? []) packages.set(entry.name, entry);
    services.clear();
    for (const [name, held] of state.services ?? []) services.set(name, held);
    uid = state.uid ?? uid;
    gid = state.gid ?? gid;
  };

  const snapshotTree = async (destination: string): Promise<void> => {
    await rm(destination, { recursive: true, force: true });
    await cp(root, join(destination, "host"), { recursive: true });
    await writeFile(join(destination, "world.json"), dumpWorld(), "utf8");
  };

  const restoreTree = async (source: string): Promise<void> => {
    const state = await readFile(join(source, "world.json"), "utf8").catch(() => null);
    if (state === null) {
      throw new Error(`there is no state document at ${join(source, "world.json")} to restore`);
    }
    closeListeners();
    await rm(root, { recursive: true, force: true });
    await cp(join(source, "host"), root, { recursive: true });
    loadWorld(state);
    unitOfCache.clear();
    // A service the snapshot had running is running again, and the only way that can be true is for
    // a socket to be bound again. Recording `running: true` without binding would make `verified`
    // report a fact nobody observed - the one thing this world may never do.
    for (const [name, held] of services) {
      if (held.running) await startService(name);
    }
  };

  const run = async (request: ExecRequest): Promise<PosixExecRecord> => {
    const started = Date.now();
    const program = request.argv[0] ?? "";
    const escaping = request.argv.slice(1).find((token) => token.split("/").includes(".."));
    if (escaping !== undefined) {
      // A real escape, not a hypothetical one. `join(root, "..", "..")` walks out of the sandbox and
      // lands in the host's tree, so `cat /../../etc/passwd` would read the *developer's* file while
      // the reading described it as the sandbox's - a verdict about a file the world does not hold.
      // Refused as an observation rather than a violation: a contract is allowed to assert that this
      // world is contained, and refusing the command is how it holds.
      const refused: PosixExecRecord = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: "refused",
        exitCode: null,
        stdout: "",
        stderr: "",
        reason:
          `\`${escaping}\` climbs out of the sandbox: ${root} is the whole filesystem this world ` +
          "has, and resolving the path would reach the host's tree instead",
        durationMs: 0,
      };
      execs.push(refused);
      return refused;
    }
    const outcome = REGISTER.get(program);
    let result: PosixExecRecord;
    if (outcome === undefined) {
      result = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: "refused",
        exitCode: null,
        stdout: "",
        stderr: "",
        reason:
          `this world answers ${[...REGISTER.keys()].sort().join(", ")} and nothing else. ` +
          `\`${program}\` is not among them, so the command was not run - and a shell would be a ` +
          "second substitution, so there is none to wrap it in either",
        durationMs: 0,
      };
    } else {
      const answered = await outcome(request.argv.slice(1));
      result = {
        source: request.source,
        argv: [...request.argv],
        program,
        result: answered.result ?? (answered.exitCode === 0 ? "completed" : "nonzero"),
        exitCode: answered.exitCode,
        stdout: answered.stdout ?? "",
        stderr: answered.stderr ?? "",
        reason: answered.reason ?? null,
        durationMs: Date.now() - started,
      };
    }
    execs.push(result);
    return result;
  };

  /**
   * Build the system from nothing.
   *
   * `prepare()` and `reset()` are the same act at two boundaries - the start of a run and the start of
   * an iteration - and they are one implementation because two implementations of one rule disagree
   * the first time a world arrives that only one of them was written for.
   *
   * The `rm` is the part that was missing, and it was a false `PASS` rather than a tidiness gap. A tree
   * the previous run left behind survives `stop()` on purpose, because a bundle quotes paths inside it,
   * so a `prepare()` that only made directories inherited that tree: the second run's *first* iteration
   * read a `/etc/veridian/policy.conf` this run never installed - its own application had written
   * `policy.cfg`, which is the defect under test - and AC-006 and AC-007 both reported `PASS` on a file
   * from someone else's run. The next iteration's `reset()` wiped it, so the symptom was a progression
   * one iteration out of step instead of an error. *A world a run inherits is not a world that run
   * built*, and a criterion may never pass on an artifact the run did not produce.
   */
  const rebuild = async (): Promise<void> => {
    closeListeners();
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await seed();
  };

  return {
    prepare: rebuild,
    async reset() {
      await rebuild();
      // The exec record is deliberately kept: a reset restores the world, it does not restore the
      // record. An iteration that reached outside the boundary must not be followed by a clean one
      // that reports PASS with the evidence destroyed by the very act of repairing it.
    },
    exec: run,
    record(record) {
      execs.push(record);
    },
    snapshot: snapshotTree,
    restoreFrom: restoreTree,
    async read() {
      const files: PosixFileReading[] = [];
      await walk("/", files);
      files.sort((left, right) => left.path.localeCompare(right.path));
      return {
        host: "veridian-sim-posix",
        distribution,
        root,
        user,
        simulated: POSIX_SIMULATED_SURFACES,
        execs: [...execs],
        files,
        users: [...users.values()].sort((left, right) => left.uid - right.uid),
        packages: [...packages.values()].sort((left, right) => left.name.localeCompare(right.name)),
        services: await serviceReadings(),
        ports: await portReadings(),
      };
    },
    async stop() {
      closeListeners();
    },
  };
}
