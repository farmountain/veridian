/**
 * The substitute for a container runtime: a real image store, real container records, and the part
 * that is *not* substituted - the operating-system processes those containers really are.
 *
 * ## What is real, and what is substituted
 *
 * Real, and each one is a thing this world could have faked and does not:
 *
 * - **`image build` really reads the build context.** Every file under the context directory is walked
 *   with `readdir` and its bytes are hashed, so `digest` is a digest of files that exist and
 *   `sizeBytes` is a sum of real lengths. Two builds of the same files agree; two builds of different
 *   files do not. The context is then really *copied* into the image store, so an image is a directory
 *   this machine holds rather than a row in a table.
 * - **A container's process is a real child process.** `container start` spawns
 *   `start.command`'s command as an ordinary child through the same `ProcessRunner` the rest of
 *   Veridian uses, with the exit code, the signal and the stdout and stderr bytes the operating system
 *   reported. `ContainerInstanceReading.alive` and `ContainerLogReading.stdout` are observations of
 *   that process, not records of an intention.
 * - **A bind mount's source is really tested.** `stat` decides `sourceExists`, and a start whose source
 *   is missing is refused for that reason - which is what a real engine does, and is the difference
 *   between a mount being a name and a mount being a mount.
 *
 * Substituted, from {@link CONTAINER_SIMULATED_SURFACES}: namespaces, cgroups, image layers, the
 * registry, published ports, volumes and user switching. The container is an ordinary child of this
 * process with the operator's own privileges, so it can open whatever socket and write wherever the
 * operator can.
 *
 * ## The one settled by the design rather than by the absence
 *
 * **Published ports.** A real engine binds a host port and a client can then connect. This world binds
 * nothing, so `ContainerPortReading` carries no `reachable` field at all - see the vocabulary file for
 * why refusing to offer the field is stronger than offering it with a `false`. What a container's
 * process does with its own listening socket is the process's business and is not reported here.
 *
 * ## Two filesystems, and which one a path belongs to
 *
 * A container's paths are its own (`/app`, `/data`) and are spelled by the *container* platform's
 * grammar; a build context and a bind mount's source are paths on *this machine*. Exactly three
 * arguments name a host path - `image build`'s context, and a `-v` source that is not a named volume -
 * and everything else is a container path. The rule is enforced rather than assumed: a host path must
 * resolve inside the application's own directory or inside the sandbox, and one that does not is
 * refused **by name**. Without that check the world would either accept a path it cannot honour or
 * resolve a container path to a host directory, which is the defect the machine family paid for when
 * one world ended up with two answers for one question.
 *
 * ## Why a container path resolves the way it does
 *
 * An image is a real directory, and so is a volume, and a bind mount is a real directory somewhere
 * else. Resolving a container path is therefore a genuine overlay with a real implementation: the
 * longest mount destination that prefixes the path wins, and everything else resolves inside the
 * image's rootfs. A write performed through `container exec` lands in the tree the mount named - so a
 * criterion can observe a container having written to a bind mount by reading the host directory it
 * maps, which is a fact about a filesystem rather than a fact about a table.
 *
 * ## The register, and what a refusal means
 *
 * `image`, `container`, `volume` and `runtime` are answered **in process** by the register below. The
 * alternative - a real engine - would make the world's identity the operator's machine rather than the
 * document's declaration, and there is no engine on the machine this runs on. Each entry really
 * performs its operation; a container's process is the only thing here that is spawned rather than
 * performed, and that is deliberate because it is the only thing that must be real.
 *
 * A command line naming an action the register does not hold is refused, and the refusal is *filed* -
 * with `action: null`, which is the field that says this world was asked for something it does not
 * implement. Dropping it would leave a contract unable to observe that refusal, and a contract about a
 * substitute is exactly a contract about what the substitute does and does not answer.
 *
 * ## A read must not mutate
 *
 * `read()` is a pure function of the world's records and of the processes' already-observed state. It
 * writes nothing, advances no counter, walks no tree and starts nothing. `alive` is maintained by an
 * exit listener rather than computed by reading, because a reading that settled a process's fate would
 * be an observation that edits what it observes - and M1 compares exactly these documents across runs.
 */

import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

import { CONTAINER_SIMULATED_SURFACES, isContainerAction } from "../../core/environment/container-observation.ts";
import type {
  ContainerAction,
  ContainerActionResult,
  ContainerCallRecord,
  ContainerClient,
  ContainerHealthReading,
  ContainerHealthState,
  ContainerImageReading,
  ContainerInstanceReading,
  ContainerLogReading,
  ContainerMountKind,
  ContainerMountReading,
  ContainerObservationData,
  ContainerPortProtocol,
  ContainerPortReading,
  ContainerResourceReading,
  ContainerState,
} from "../../core/environment/container-observation.ts";
import type { ProcessHandle, ProcessRunner } from "../../core/process.ts";

/** The runtime identity this substitute answers as, when a document declares no other. */
export const SIM_RUNTIME_NAME = "veridian-container-sim";

/**
 * The engine version and wire version the readings name.
 *
 * Declared, and shaped like nothing in particular on purpose: a reading that claimed a real engine's
 * version number would be the substitution borrowing an identity it does not have, and the first
 * reader to compare it against `docker version` would be misled by a string this world chose.
 */
export const SIM_RUNTIME_VERSION = "sim-1.0.0";
export const SIM_RUNTIME_API_VERSION = "v1";

/** How many bytes of a container's output are carried in the reading before the world stops keeping. */
const LOG_BOUND = 64 * 1024;

/**
 * The Dockerfile instructions this world really reads.
 *
 * A closed set, and the refusal for anything outside it names the set - because a build that silently
 * ignored the instruction that mattered would produce an image whose `cmd` is empty for a reason no
 * reader could find. `COPY` is refused rather than supported: this world copies the *whole* context
 * into the image, so supporting `COPY` would be claiming to have implemented a selection that the
 * substitution performs anyway.
 */
const DOCKERFILE_INSTRUCTIONS = [
  "FROM",
  "WORKDIR",
  "ENV",
  "EXPOSE",
  "LABEL",
  "USER",
  "CMD",
  "ENTRYPOINT",
] as const;

/** The flags of `container create`, and whether each takes a value. Anything else is refused. */
const CREATE_VALUE_FLAGS = [
  "-name",
  "--name",
  "-e",
  "--env",
  "-v",
  "--volume",
  "-p",
  "--publish",
  "-u",
  "--user",
  "-w",
  "--workdir",
  "--memory",
  "-m",
  "--memory-reservation",
  "--cpus",
  "--pids-limit",
  "--restart",
  "--health-cmd",
  "--health-interval",
  "-l",
  "--label",
] as const;

const BUILD_VALUE_FLAGS = ["-t", "--tag", "-f", "--file"] as const;

interface Outcome {
  readonly result: ContainerActionResult;
  readonly status: number;
  readonly reason?: string | null;
  readonly resource?: string | null;
}

const answered = (resource: string | null = null): Outcome => ({ result: "answered", status: 0, resource });
const absent = (reason: string, resource: string | null = null): Outcome => ({
  result: "absent",
  status: 1,
  reason,
  resource,
});
const refused = (reason: string, resource: string | null = null): Outcome => ({
  result: "refused",
  status: 1,
  reason,
  resource,
});
const failed = (status: number, reason: string, resource: string | null = null): Outcome => ({
  result: "failed",
  status,
  reason,
  resource,
});

export interface ContainerExecRequest {
  /** The command line, as the application or a criterion spelled it. Joins the record verbatim. */
  readonly argv: readonly string[];
  readonly client: ContainerClient;
}

export interface ContainerPortOptions {
  /**
   * Host path of the sandbox. The world's store, its image root filesystems and its volumes live here.
   */
  readonly root: string;
  /**
   * The directory the application's own process runs in, as this machine spells it.
   *
   * A host path in a command - a build context, a bind mount's source - resolves against this, because
   * that is the directory a real engine's client would have resolved it against. It is not the io
   * root: the application is a separate process spawned with this as its `cwd`, and the two differ
   * whenever the document's paths are relative, which is the defect `POSIX_ENV.HOST` was written for.
   */
  readonly contextRoot: string;
  /** The runtime identity the environment document declared. */
  readonly runtime: string;
  /** The platform the containers stand in for, from {@link CONTAINER_PLATFORMS}. */
  readonly platform: string;
  /** How the world starts a process. Real children, through the same runner the rest of Veridian uses. */
  readonly processes: ProcessRunner;
  /** How long a `container wait` or a stop may take before the caller is told it did not finish. */
  readonly defaultWaitMs?: number;
}

export interface ContainerPort {
  /** Build the store: the sandbox tree, an empty image store and an empty volume store. */
  prepare(): Promise<void>;
  /**
   * Begin a new world.
   *
   * Every child process is stopped, the sandbox is removed and rebuilt, and the images, containers,
   * volumes and logs are gone - because a reset restores the world.
   *
   * The **call record survives**, and that is not an oversight. `calls` is the transcript of what the
   * run asked for; clearing it would destroy the evidence of a violation with the very act of repairing
   * the world it happened in, and a run whose early iteration reached outside its boundary would then
   * report a clean list. `sim-posix` records the same decision at its `execs` field, and it is the same
   * reason.
   */
  reset(): Promise<void>;
  /** Perform one command line. Always answers with the record it filed. */
  exec(request: ContainerExecRequest): Promise<ContainerCallRecord>;
  /** The reading. Pure: writes nothing, advances nothing, starts nothing. */
  read(): Promise<ContainerObservationData>;
  /**
   * Every command this world refused because it named a place outside it, with who named it.
   *
   * Recorded by the one predicate that decides the question, rather than re-derived by a caller: an
   * adapter that asked "does this argument vector escape" would be a second implementation of this
   * world's boundary rule, and two implementations of one rule disagree the first time a world arrives
   * that only one of them was written for.
   *
   * The *client* is carried because the two clients are not the same party. An escape by the
   * application is a safety event the run fails on; an escape by a criterion is a reading - the
   * operator owns that document and already holds those privileges - and a run whose contract probes
   * this guard has to be able to pass.
   *
   * Deliberately **not** cleared by `reset()`, for the reason the call record is not: a reset restores
   * the world, and erasing this would destroy the evidence of a violation by repairing it.
   */
  escapes(): readonly ContainerEscape[];
  /** Stop every child this world started. Never removes the sandbox, so a bundle's paths still resolve. */
  stop(): Promise<void>;
}

/** One command this world refused because it named a place outside it. */
export interface ContainerEscape {
  readonly client: ContainerClient;
  /** The argument as the command spelled it - the only spelling a reader can compare with the command. */
  readonly spelled: string;
}

interface ImageRecord {
  id: string;
  tags: string[];
  digest: string;
  sizeBytes: number;
  /** Host path of the copied build context. This is what an image *is* in this world. */
  rootfs: string;
  entrypoint: string[];
  cmd: string[];
  workingDir: string;
  user: string;
  env: Record<string, string>;
  exposedPorts: number[];
  labels: Record<string, string>;
}

interface MountRecord {
  kind: ContainerMountKind;
  source: string;
  destination: string;
  readOnly: boolean;
  /** Host path resolved once, at create time. The overlay is real, so this is the real directory. */
  hostPath: string;
  sourceExists: boolean;
}

interface PortRecord {
  containerPort: number;
  protocol: ContainerPortProtocol;
  hostPort: number | null;
  hostIp: string;
  exposed: boolean;
  published: boolean;
}

interface InstanceRecord {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  alive: boolean;
  exitCode: number | null;
  command: string[];
  workingDir: string;
  user: string;
  env: Record<string, string>;
  mounts: MountRecord[];
  ports: PortRecord[];
  resources: ContainerResourceReading;
  health: ContainerHealthReading | null;
  restartPolicy: string;
  labels: Record<string, string>;
  runs: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
  handle: ProcessHandle | null;
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** A hash in the `sha256:<12 hex>` spelling the reading documents. */
const shortHash = (...parts: readonly string[]): string => `sha256:${sha256(parts.join("\n")).slice(0, 12)}`;

/** The tail of a text, because that is where a failure states its cause. */
const tail = (text: string, limit = 300): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Parsed {
  readonly flags: ReadonlyMap<string, readonly string[]>;
  /** The first non-flag token: an image reference, a container name, a volume name. */
  readonly subject: string | null;
  /** Everything after the subject. For `create` this is the command; for `exec` it is the argv. */
  readonly rest: readonly string[];
}

type ParseResult = { readonly ok: true; readonly value: Parsed } | { readonly ok: false; readonly reason: string };

/**
 * One grammar for every command in the register, which is the register's own rule rather than a
 * convenience: a second parser would be a second grammar, and two grammars for one world's commands
 * disagree the first time a command arrives that only one of them was written for.
 *
 * Flags are accepted before the subject, `--flag=value` and `--flag value` both work, a repeated flag
 * accumulates, and anything after the subject is `rest`. An unknown flag is a refusal naming it rather
 * than an operand, because the alternative is a world that silently treats `--publish 8080:80` as a
 * container command.
 */
function parse(argv: readonly string[], valueFlags: readonly string[]): ParseResult {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  let subject: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (subject !== null) {
      rest.push(token);
      i += 1;
      continue;
    }
    if (token === "--") {
      // Everything after this is operands and a command, never flags. That is the whole meaning of the
      // separator, and honouring it is what lets `container exec cart-web -- node server.js` reach the
      // container's own argv rather than this world's flag parser.
      const after = argv.slice(i + 1);
      if (subject === null) return { ok: true, value: { flags, subject: after[0] ?? null, rest: after.slice(1) } };
      rest.push(...after);
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const equals = token.indexOf("=");
      const name = equals === -1 ? token : token.slice(0, equals);
      const inline = equals === -1 ? null : token.slice(equals + 1);
      if (!valueFlags.includes(name)) {
        return {
          ok: false,
          reason:
            `\`${name}\` is not a flag this world's register answers; it answers ` +
            `${valueFlags.join(", ")}, and every one of them takes a value`,
        };
      }
      const value = inline ?? argv[i + 1];
      if (value === undefined) {
        return { ok: false, reason: `\`${name}\` takes a value, and the command gave it none` };
      }
      const held = flags.get(name);
      if (held === undefined) flags.set(name, [value]);
      else held.push(value);
      i += inline === null ? 2 : 1;
      continue;
    }
    subject = token;
    i += 1;
  }
  return { ok: true, value: { flags, subject, rest } };
}

/** `128m` → bytes. A bare number is bytes, as a real engine's `--memory` is. */
function parseSize(text: string): number | null {
  const match = /^([0-9]+)([kmg])?$/i.exec(text.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "").toLowerCase();
  const scale = unit === "k" ? 1024 : unit === "m" ? 1024 * 1024 : unit === "g" ? 1024 * 1024 * 1024 : 1;
  return value * scale;
}

/** Every file under `directory`, as sorted relative POSIX paths. The digest's subject, and it is real. */
async function walk(directory: string, prefix = ""): Promise<readonly string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await walk(join(directory, entry.name), relative)));
    } else {
      found.push(relative);
    }
  }
  return found;
}

/**
 * The digest of a build context, and the size of what it holds.
 *
 * Both facts come from reading the files. The digest includes each file's *path* beside its bytes, so
 * renaming a file changes the image - which is the property that makes "this tag points at the code
 * we just built" checkable rather than decorative.
 */
async function contextFacts(context: string): Promise<{ digest: string; sizeBytes: number }> {
  const files = await walk(context);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for (const relative of files) {
    const bytes = await readFile(join(context, ...relative.split("/")));
    sizeBytes += bytes.byteLength;
    hash.update(`${relative}\n${sha256(bytes)}\n`);
  }
  return { digest: hash.digest("hex"), sizeBytes };
}

/**
 * The subset of a Dockerfile this world reads, and the refusal for everything else.
 *
 * It really parses: `ENV K=V` really sets an environment entry, `EXPOSE 8080` really becomes an
 * exposed port, `USER` really becomes the account the image names. What is *not* real is the layer
 * machinery behind `FROM`, which is why `FROM` is accepted and recorded nowhere - a world that
 * pretended to have pulled a base image would be claiming a registry it does not have.
 */
async function readDockerfile(
  path: string,
  platform: string,
): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly entrypoint: string[];
        readonly cmd: string[];
        readonly workingDir: string;
        readonly user: string;
        readonly env: Record<string, string>;
        readonly exposedPorts: number[];
        readonly labels: Record<string, string>;
      };
    }
  | { readonly ok: false; readonly reason: string }
> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: `there is no Dockerfile at ${path}, so this world has no build instructions to read` };
  }

  const entrypoint: string[] = [];
  const cmd: string[] = [];
  const env: Record<string, string> = {};
  const exposedPorts: number[] = [];
  const labels: Record<string, string> = {};
  let workingDir = "/";
  let user = "root";

  const argvOf = (rest: string): readonly string[] | null => {
    const trimmed = rest.trim();
    if (!trimmed.startsWith("[")) return trimmed.split(/\s+/).filter((token) => token !== "");
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const split = /^([A-Za-z]+)\s*(.*)$/.exec(line);
    if (split === null) {
      return { ok: false, reason: `line ${String(index + 1)} of the Dockerfile is not an instruction` };
    }
    const instruction = (split[1] ?? "").toUpperCase();
    const rest = split[2] ?? "";
    if (!(DOCKERFILE_INSTRUCTIONS as readonly string[]).includes(instruction)) {
      return {
        ok: false,
        reason:
          `this world reads ${DOCKERFILE_INSTRUCTIONS.join(", ")} from a Dockerfile and line ` +
          `${String(index + 1)} is \`${instruction}\`. The build context is copied into the image whole, ` +
          "so a selection instruction is not one this substitution performs",
      };
    }
    switch (instruction) {
      case "FROM":
        // Recorded nowhere on purpose: this world has no registry and no layers, so the base image is
        // a declaration the build ignores rather than one it pretends to have fetched.
        break;
      case "WORKDIR":
        workingDir = rest.trim() === "" ? "/" : rest.trim();
        break;
      case "USER":
        user = rest.trim() === "" ? "root" : rest.trim();
        break;
      case "EXPOSE": {
        for (const token of rest.split(/\s+/).filter((entry) => entry !== "")) {
          const port = Number.parseInt(token.split("/")[0] ?? "", 10);
          if (Number.isNaN(port)) {
            return { ok: false, reason: `\`EXPOSE ${token}\` does not name a port number` };
          }
          exposedPorts.push(port);
        }
        break;
      }
      case "ENV": {
        const equals = rest.indexOf("=");
        if (equals === -1) {
          return { ok: false, reason: `\`ENV ${rest}\` is not \`NAME=value\`, which is the only form this world reads` };
        }
        env[rest.slice(0, equals).trim()] = rest.slice(equals + 1).trim();
        break;
      }
      case "LABEL": {
        const equals = rest.indexOf("=");
        if (equals === -1) {
          return { ok: false, reason: `\`LABEL ${rest}\` is not \`key=value\`` };
        }
        labels[rest.slice(0, equals).trim()] = rest.slice(equals + 1).trim();
        break;
      }
      case "CMD": {
        const argv = argvOf(rest);
        if (argv === null) return { ok: false, reason: `\`CMD ${rest}\` is neither a JSON array nor a word list` };
        cmd.length = 0;
        cmd.push(...argv);
        break;
      }
      case "ENTRYPOINT": {
        const argv = argvOf(rest);
        if (argv === null) return { ok: false, reason: `\`ENTRYPOINT ${rest}\` is neither a JSON array nor a word list` };
        entrypoint.length = 0;
        entrypoint.push(...argv);
        break;
      }
      default:
        break;
    }
  }
  if (workingDir.includes("\\")) {
    return {
      ok: false,
      reason:
        `\`WORKDIR ${workingDir}\` separates with a backslash, and this world stands in for ` +
        `${platform} containers, whose paths separate with a slash`,
    };
  }
  return { ok: true, value: { entrypoint, cmd, workingDir, user, env, exposedPorts, labels } };
}

export function containerPort(options: ContainerPortOptions): ContainerPort {
  const { root, contextRoot, runtime, platform, processes } = options;
  const waitMs = options.defaultWaitMs ?? 30_000;

  const images = new Map<string, ImageRecord>();
  const instances = new Map<string, InstanceRecord>();
  const volumes = new Set<string>();
  const calls: ContainerCallRecord[] = [];
  const escapes: ContainerEscape[] = [];

  /**
   * Who is making the call being handled.
   *
   * One writer, one reader: `exec()` sets it before dispatching and restores it afterwards, and the
   * boundary predicate reads it when it refuses a path. It exists because a refusal is a fact about a
   * *party* - the application's escape is a safety event and a criterion's is a reading - and the
   * predicate that decides the boundary is many call frames below the one that knows the client.
   */
  let currentClient: ContainerClient = "criterion";

  const imagesDir = join(root, "store", "images");
  const volumesDir = join(root, "store", "volumes");
  const hostOf = (directory: string, ...segments: readonly string[]): string => join(directory, ...segments);

  /**
   * Resolve a host path named by a command.
   *
   * The containment rule is this world's boundary, and it is checked rather than assumed. `sim-posix`
   * refuses an argument vector containing `..`; a container command cannot use that test, because a
   * build context is legitimately `../shared` and a bind mount's source is legitimately a directory
   * beside the application. So the rule is stated positively: the resolved path must be inside the
   * application's own directory or inside the sandbox.
   *
   * A refusal is recorded here, in the one place that decides it, so that the adapter can report the
   * application's escapes as the safety events they are without holding a second copy of this rule.
   */
  const resolveHostPath = (
    spelled: string,
  ): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string } => {
    const absolute = isAbsolute(spelled) ? spelled : resolvePath(contextRoot, spelled);
    const inside = (base: string): boolean => {
      const prefix = base.endsWith(sep) ? base : base + sep;
      return absolute === base || absolute.startsWith(prefix);
    };
    if (!inside(resolvePath(contextRoot)) && !inside(resolvePath(root))) {
      escapes.push({ client: currentClient, spelled });
      return {
        ok: false,
        reason:
          `\`${spelled}\` resolves to ${absolute}, which is outside the application directory ` +
          `(${resolvePath(contextRoot)}) and outside this world's sandbox (${resolvePath(root)}). A host ` +
          "path in a command may name either of those and nothing else",
      };
    }
    return { ok: true, path: absolute };
  };

  /**
   * The host path a container path names, through the real overlay.
   *
   * The longest mount destination that prefixes the path wins; if nothing does, the path is inside the
   * image's copied context. A destination is matched on whole segments, so `/data` does not capture
   * `/database` - a prefix test on the string alone would, and the container would silently write into
   * a directory its mount never named.
   */
  const hostFor = (instance: InstanceRecord, containerPath: string): string => {
    const segments = containerPath.split("/").filter((segment) => segment !== "");
    let best: MountRecord | null = null;
    let bestDepth = -1;
    for (const mount of instance.mounts) {
      const destination = mount.destination.split("/").filter((segment) => segment !== "");
      if (destination.length > segments.length) continue;
      const matches = destination.every((segment, index) => segments[index] === segment);
      if (matches && destination.length > bestDepth) {
        best = mount;
        bestDepth = destination.length;
      }
    }
    if (best !== null) return hostOf(best.hostPath, ...segments.slice(bestDepth));
    const image = imageOfTag(instance.image);
    return hostOf(image === null ? root : image.rootfs, ...segments);
  };

  const imageOfTag = (tag: string): ImageRecord | null => {
    for (const image of images.values()) {
      if (image.tags.includes(tag)) return image;
    }
    const direct = images.get(tag);
    return direct ?? null;
  };

  const containerOf = (name: string): InstanceRecord | null => {
    const direct = instances.get(name);
    if (direct !== undefined) return direct;
    for (const instance of instances.values()) {
      if (instance.id === name) return instance;
    }
    return null;
  };

  /**
   * Keep the real bytes a real child wrote, bounded, keeping the **tail**.
   *
   * The bound is on characters rather than on lines because a bound by lines is not a bound: a program
   * that prints one 4000-character line would put all 4000 characters in the reading. The tail is what
   * is kept for the same reason `tail()` keeps one - that is where a failure states its cause - and
   * `truncated` is set so a reader is told something was dropped rather than left to guess.
   */
  const appendLog = (instance: InstanceRecord, channel: "stdout" | "stderr", chunk: string): void => {
    if (channel === "stdout") {
      instance.stdoutBytes += Buffer.byteLength(chunk, "utf8");
      instance.stdout += chunk;
      if (instance.stdout.length > LOG_BOUND) {
        instance.stdout = instance.stdout.slice(-LOG_BOUND);
        instance.truncated = true;
      }
      return;
    }
    instance.stderrBytes += Buffer.byteLength(chunk, "utf8");
    instance.stderr += chunk;
    if (instance.stderr.length > LOG_BOUND) {
      instance.stderr = instance.stderr.slice(-LOG_BOUND);
      instance.truncated = true;
    }
  };

  /**
   * Run one command *inside* a container: a real child, in the container's working directory, with the
   * container's environment.
   *
   * This is the same implementation the container's own start uses, because a `container exec` and a
   * container's main process are the same operation on a real runtime: one command run as the
   * container. A second implementation would be a second set of rules for quoting, environment and
   * working directory, and the two would disagree the first time one of them was asked to do something
   * the other had never been tried on.
   */
  const runInside = async (
    instance: InstanceRecord,
    argv: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => {
    const cwd = hostFor(instance, instance.workingDir);
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((settle) => {
      const handle = processes.run({
        command: argv[0] ?? "",
        args: argv.slice(1),
        cwd,
        env: instance.env,
        onStdout: (chunk) => appendLog(instance, "stdout", chunk),
        onStderr: (chunk) => appendLog(instance, "stderr", chunk),
      });
      void handle.exited.then((outcome) => {
        settle({ code: outcome.code ?? 1, stdout: outcome.stdout, stderr: outcome.stderr });
      });
    });
    return result;
  };

  /** The health command, really run, once - because a record of a schedule this world does not keep. */
  const checkHealth = async (instance: InstanceRecord): Promise<void> => {
    const health = instance.health;
    if (health === null) return;
    const result = await runInside(instance, health.command);
    instance.health = {
      command: health.command,
      state: result.code === 0 ? "healthy" : "unhealthy",
      exitCode: result.code,
      attempts: health.attempts + 1,
      intervalSeconds: health.intervalSeconds,
    };
  };

  // ---- the register ---------------------------------------------------------------------------

  const buildImage = async (parsed: Parsed): Promise<Outcome> => {
    const tag = parsed.flags.get("-t")?.[0] ?? parsed.flags.get("--tag")?.[0];
    if (tag === undefined || tag === "") {
      return refused("`image build` needs `-t <tag>`; this world will not put an image in its store under no name");
    }
    const context = parsed.subject;
    if (context === null) {
      return refused("`image build` needs a build context directory to read");
    }
    const resolved = resolveHostPath(context);
    if (!resolved.ok) return refused(resolved.reason, tag);

    let facts: { digest: string; sizeBytes: number };
    try {
      facts = await contextFacts(resolved.path);
    } catch (error) {
      return refused(
        `the build context ${resolved.path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        tag,
      );
    }

    const file = parsed.flags.get("-f")?.[0] ?? parsed.flags.get("--file")?.[0] ?? "Dockerfile";
    const dockerfile = await readDockerfile(join(resolved.path, ...file.split("/")), platform);
    if (!dockerfile.ok) return refused(dockerfile.reason, tag);

    const id = shortHash(tag, facts.digest);
    const rootfs = hostOf(imagesDir, id.replace(":", "-"), "rootfs");
    await rm(hostOf(imagesDir, id.replace(":", "-")), { recursive: true, force: true });
    await mkdir(hostOf(imagesDir, id.replace(":", "-")), { recursive: true });
    await cp(resolved.path, rootfs, { recursive: true });
    // `WORKDIR` *creates* the directory, which is what a real engine does and what makes `/srv` a
    // working directory in an image whose context never held one. Recording the working directory and
    // nothing else was a defect this world's own suite found: every container built from an ordinary
    // Dockerfile was refused at start, for a directory the image was supposed to have made.
    await mkdir(hostOf(rootfs, ...dockerfile.value.workingDir.split("/").filter((segment) => segment !== "")), {
      recursive: true,
    });

    const existing = images.get(id);
    if (existing === undefined) {
      images.set(id, {
        id,
        tags: [tag],
        digest: facts.digest,
        sizeBytes: facts.sizeBytes,
        rootfs,
        entrypoint: dockerfile.value.entrypoint,
        cmd: dockerfile.value.cmd,
        workingDir: dockerfile.value.workingDir,
        user: dockerfile.value.user,
        env: dockerfile.value.env,
        exposedPorts: dockerfile.value.exposedPorts,
        labels: dockerfile.value.labels,
      });
    } else if (!existing.tags.includes(tag)) {
      existing.tags.push(tag);
    }
    return answered(tag);
  };

  const tagImage = (parsed: Parsed): Outcome => {
    const source = parsed.subject;
    const target = parsed.rest[0];
    if (source === null || target === undefined) {
      return refused("`image tag` needs a source reference and a target tag");
    }
    const image = imageOfTag(source);
    if (image === null) return absent(`this world's image store holds no image tagged \`${source}\``, source);
    if (!image.tags.includes(target)) image.tags.push(target);
    return answered(target);
  };

  const removeImage = (parsed: Parsed): Outcome => {
    const ref = parsed.subject;
    if (ref === null) return refused("`image rm` needs a reference to remove");
    const image = imageOfTag(ref);
    if (image === null) return absent(`this world's image store holds no image tagged \`${ref}\``, ref);
    const holder = [...instances.values()].find((instance) => image.tags.includes(instance.image));
    if (holder !== undefined) {
      return refused(
        `\`${holder.name}\` was created from \`${holder.image}\` and still exists; a real engine refuses to ` +
          "remove an image a container needs, and so does this one",
        ref,
      );
    }
    images.delete(image.id);
    void rm(hostOf(imagesDir, image.id.replace(":", "-")), { recursive: true, force: true });
    return answered(ref);
  };

  const inspectImage = (parsed: Parsed): Outcome => {
    const ref = parsed.subject;
    if (ref === null) return refused("`image inspect` needs a reference");
    return imageOfTag(ref) === null
      ? absent(`this world's image store holds no image tagged \`${ref}\``, ref)
      : answered(ref);
  };

  const pullImage = (parsed: Parsed): Outcome =>
    refused(
      `this world has no registry and no outbound network, so it cannot pull ` +
        `\`${parsed.subject ?? "anything"}\`; an image gets into this store by being built from a context ` +
        "this machine holds",
      parsed.subject,
    );

  const createContainer = async (parsed: Parsed): Promise<Outcome> => {
    const imageRef = parsed.subject;
    if (imageRef === null) return refused("`container create` needs an image reference as its subject");
    const image = imageOfTag(imageRef);
    if (image === null) {
      return absent(
        `this world's image store holds no image tagged \`${imageRef}\`; build it first, or pull - which ` +
          "this world refuses, because it has no registry",
        imageRef,
      );
    }
    const name = parsed.flags.get("--name")?.[0] ?? parsed.flags.get("-name")?.[0];
    if (name === undefined || name === "") {
      return refused("`container create` needs `--name <name>`; a container this world cannot name is one no criterion can find");
    }
    if (containerOf(name) !== null) {
      return refused(`a container named \`${name}\` already exists in this world`, name);
    }

    // Mounts. A source with a separator or a leading dot is a bind mount - which is the rule a real
    // engine uses to tell a path from a named volume, and it needs to be written down because it is the
    // one place this world decides which of its two filesystems a string belongs to.
    const mounts: MountRecord[] = [];
    for (const spelling of parsed.flags.get("-v") ?? parsed.flags.get("--volume") ?? []) {
      // Split from the *right*, because a bind source is a host path and this machine's host paths
      // contain the separator: `C:\app\html:/data` has three colons and only two of them are this
      // world's. Splitting on every colon read the drive letter as the source, the path as the
      // destination and the real destination as a *mode*, so the create was refused with a reason
      // naming a mode the operator never wrote - and, worse, it was refused before the source was ever
      // resolved, so `resolveHostPath` never saw it and a mount pointing outside the world went
      // unrecorded. A container's paths always begin with "/", so the destination and the optional mode
      // are the last two colon-separated segments and everything before them is the source.
      const segments = spelling.split(":");
      if (segments.length < 2) {
        return refused(
          `\`-v ${spelling}\` does not name a container path: the destination has to start with "/", ` +
            "because a container's paths are its own and this world will not guess",
          name,
        );
      }
      const last = segments[segments.length - 1] ?? "";
      const mode = last === "ro" || last === "rw" ? last : "";
      const destinationIndex = mode === "" ? segments.length - 1 : segments.length - 2;
      const destination = segments[destinationIndex] ?? "";
      const source = segments.slice(0, destinationIndex).join(":");
      if (mode === "" && segments.length > 2 && !/^[A-Za-z]$/.test(segments[0] ?? "")) {
        return refused(
          `\`-v ${spelling}\` carries a mode this world does not read; it reads \`ro\` and \`rw\`, and ` +
            "nothing else",
          name,
        );
      }
      if (destination === "" || !destination.startsWith("/")) {
        return refused(
          `\`-v ${spelling}\` does not name a container path: the destination has to start with "/", ` +
            "because a container's paths are its own and this world will not guess",
          name,
        );
      }
      if (source === "") {
        return refused(`\`-v ${spelling}\` names no source; a mount has to say what it mounts`, name);
      }
      // A source that *names a host place* is a bind mount; a bare name is a volume. The test is
      // `isAbsolute` and both separators rather than a slash alone, because the source is a host path
      // and this machine spells those its own way: a Windows spelling contains no slash at all, so a
      // slash-only rule read `C:\app\html` as a *volume* named after the path, created a directory by
      // that name in the volume store, and reported `sourceExists: true` for a mount that was never a
      // bind at all. The boundary predicate then never saw it, so an escape through a bind mount went
      // unrecorded - which is the one thing this world's record exists to catch.
      const bind = isAbsolute(source) || source.includes("/") || source.includes("\\") || source.startsWith(".");
      if (!bind) {
        const volumeHost = hostOf(volumesDir, source);
        const exists = await stat(volumeHost).then(
          (info) => info.isDirectory(),
          () => false,
        );
        if (!exists) await mkdir(volumeHost, { recursive: true });
        volumes.add(source);
        mounts.push({ kind: "volume", source, destination, readOnly: mode === "ro", hostPath: volumeHost, sourceExists: true });
        continue;
      }
      const resolved = resolveHostPath(source);
      if (!resolved.ok) return refused(resolved.reason, name);
      const exists = await stat(resolved.path).then(
        (info) => info.isDirectory(),
        () => false,
      );
      mounts.push({
        kind: "bind",
        source,
        destination,
        readOnly: mode === "ro",
        hostPath: resolved.path,
        sourceExists: exists,
      });
    }

    // Ports. Namespace is deliberately absent from `mounts`; every port is a mapping and no mapping
    // claims reachability - the reading has no field for it.
    const ports: PortRecord[] = [];
    for (const spelling of parsed.flags.get("-p") ?? parsed.flags.get("--publish") ?? []) {
      const [pair, protocolSpelling] = spelling.split("/") as [string, string | undefined];
      const protocol: ContainerPortProtocol = protocolSpelling === "udp" ? "udp" : "tcp";
      if (protocolSpelling !== undefined && protocolSpelling !== "udp" && protocolSpelling !== "tcp") {
        return refused(`\`-p ${spelling}\` names the protocol \`${protocolSpelling}\`; this world reads tcp and udp`, name);
      }
      const halves = (pair ?? "").split(":");
      const containerPort = Number.parseInt(halves[halves.length - 1] ?? "", 10);
      if (Number.isNaN(containerPort)) {
        return refused(`\`-p ${spelling}\` does not name a container port`, name);
      }
      const hostSpelling = halves.length > 1 ? (halves[halves.length - 2] ?? "") : "";
      const hostPort = hostSpelling === "" ? null : Number.parseInt(hostSpelling, 10);
      if (hostSpelling !== "" && Number.isNaN(hostPort ?? NaN)) {
        return refused(`\`-p ${spelling}\` does not name a host port`, name);
      }
      ports.push({
        containerPort,
        protocol,
        hostPort: hostPort ?? null,
        hostIp: "0.0.0.0",
        exposed: image.exposedPorts.includes(containerPort),
        published: halves.length > 1,
      });
    }
    for (const exposedPort of image.exposedPorts) {
      if (ports.some((port) => port.containerPort === exposedPort)) continue;
      ports.push({
        containerPort: exposedPort,
        protocol: "tcp",
        hostPort: null,
        hostIp: "0.0.0.0",
        exposed: true,
        published: false,
      });
    }

    const env: Record<string, string> = { ...image.env };
    for (const spelling of parsed.flags.get("-e") ?? parsed.flags.get("--env") ?? []) {
      const equals = spelling.indexOf("=");
      if (equals === -1) {
        return refused(`\`-e ${spelling}\` is not \`NAME=value\``, name);
      }
      env[spelling.slice(0, equals)] = spelling.slice(equals + 1);
    }

    const labels: Record<string, string> = { ...image.labels };
    for (const spelling of parsed.flags.get("-l") ?? parsed.flags.get("--label") ?? []) {
      const equals = spelling.indexOf("=");
      if (equals === -1) return refused(`\`-l ${spelling}\` is not \`key=value\``, name);
      labels[spelling.slice(0, equals)] = spelling.slice(equals + 1);
    }

    const memorySpelling = parsed.flags.get("--memory")?.[0] ?? parsed.flags.get("-m")?.[0];
    const memoryBytes = memorySpelling === undefined ? null : parseSize(memorySpelling);
    if (memorySpelling !== undefined && memoryBytes === null) {
      return refused(`\`--memory ${memorySpelling}\` is not a size; this world reads bytes or a \`k\`, \`m\` or \`g\` suffix`, name);
    }
    const reservationSpelling = parsed.flags.get("--memory-reservation")?.[0];
    const memoryReservationBytes = reservationSpelling === undefined ? null : parseSize(reservationSpelling);
    if (reservationSpelling !== undefined && memoryReservationBytes === null) {
      return refused(`\`--memory-reservation ${reservationSpelling}\` is not a size`, name);
    }
    const cpusSpelling = parsed.flags.get("--cpus")?.[0];
    const cpus = cpusSpelling === undefined ? null : Number.parseFloat(cpusSpelling);
    if (cpusSpelling !== undefined && Number.isNaN(cpus)) {
      return refused(`\`--cpus ${cpusSpelling}\` is not a number`, name);
    }
    const pidsSpelling = parsed.flags.get("--pids-limit")?.[0];
    const pidsLimit = pidsSpelling === undefined ? null : Number.parseInt(pidsSpelling, 10);
    if (pidsSpelling !== undefined && Number.isNaN(pidsLimit)) {
      return refused(`\`--pids-limit ${pidsSpelling}\` is not a number`, name);
    }

    const restartPolicy = parsed.flags.get("--restart")?.[0] ?? "no";
    if (!["no", "always", "on-failure"].includes(restartPolicy)) {
      return refused(`\`--restart ${restartPolicy}\` is not a policy this world reads; it reads no, always and on-failure`, name);
    }

    let health: ContainerHealthReading | null = null;
    const healthCommand = parsed.flags.get("--health-cmd")?.[0];
    if (healthCommand !== undefined) {
      let parsedArgv: unknown;
      try {
        parsedArgv = JSON.parse(healthCommand);
      } catch {
        return refused(
          `\`--health-cmd ${healthCommand}\` is not a JSON argument vector. This world has no shell, so a ` +
            "health command is an array of words rather than a command line",
          name,
        );
      }
      if (!Array.isArray(parsedArgv) || parsedArgv.length === 0 || !parsedArgv.every((entry) => typeof entry === "string")) {
        return refused(`\`--health-cmd ${healthCommand}\` is not a non-empty array of strings`, name);
      }
      const intervalSpelling = parsed.flags.get("--health-interval")?.[0] ?? "30";
      const intervalSeconds = Number.parseInt(intervalSpelling, 10);
      if (Number.isNaN(intervalSeconds)) {
        return refused(`\`--health-interval ${intervalSpelling}\` is not a number of seconds`, name);
      }
      health = {
        command: parsedArgv as string[],
        state: "starting" as ContainerHealthState,
        exitCode: null,
        attempts: 0,
        intervalSeconds,
      };
    }

    // The command is the create-time override when one was given, otherwise the image's own CMD with
    // its ENTRYPOINT in front of it - which is exactly what a real engine does, and the reason both
    // fields are read from the Dockerfile rather than only one.
    const tailArgs = parsed.rest;
    const command =
      tailArgs.length > 0 ? [...tailArgs] : [...image.entrypoint, ...image.cmd];

    const workingDir =
      parsed.flags.get("-w")?.[0] ?? parsed.flags.get("--workdir")?.[0] ?? image.workingDir;
    if (!workingDir.startsWith("/")) {
      return refused(`the working directory \`${workingDir}\` is not a container path; it has to start with "/"`, name);
    }

    const id = shortHash(name, image.tags[0] ?? imageRef);
    instances.set(name, {
      id,
      name,
      image: image.tags[0] ?? imageRef,
      state: "created",
      alive: false,
      exitCode: null,
      command,
      workingDir,
      user: parsed.flags.get("-u")?.[0] ?? parsed.flags.get("--user")?.[0] ?? image.user,
      env,
      mounts,
      ports,
      // Computed, never asserted: this world has no cgroup, so it reports `false` for every container
      // and a substitution that really installed one would compute `true` without the reader changing.
      resources: { memoryBytes, memoryReservationBytes, cpus, pidsLimit, enforced: false },
      health,
      restartPolicy,
      labels,
      runs: 0,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      truncated: false,
      handle: null,
    });
    return answered(name);
  };

  const startContainer = async (parsed: Parsed): Promise<Outcome> => {
    const name = parsed.subject;
    if (name === null) return refused("`container start` needs a container name");
    const instance = containerOf(name);
    if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
    if (instance.state === "running") return refused(`\`${name}\` is already running`, name);
    if (instance.command.length === 0) {
      return refused(
        `\`${name}\` has no command: the image declares no CMD and no ENTRYPOINT, and \`container create\` ` +
          "was given none after its flags",
        name,
      );
    }
    const missing = instance.mounts.find((mount) => mount.kind === "bind" && !mount.sourceExists);
    if (missing !== undefined) {
      return refused(
        `\`${name}\` binds ${missing.source}, and this machine holds no directory there - which is the ` +
          "refusal a real engine gives a start whose source is missing",
        name,
      );
    }
    const cwd = hostFor(instance, instance.workingDir);
    const cwdExists = await stat(cwd).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!cwdExists) {
      return refused(
        `\`${name}\`'s working directory ${instance.workingDir} is not a directory in its filesystem ` +
          `(${cwd}); this world will not start a process in a directory that does not exist`,
        name,
      );
    }

    instance.state = "running";
    instance.exitCode = null;
    instance.runs += 1;

    const handle = processes.run({
      command: instance.command[0] ?? "",
      args: instance.command.slice(1),
      cwd,
      env: instance.env,
      onStdout: (chunk) => appendLog(instance, "stdout", chunk),
      onStderr: (chunk) => appendLog(instance, "stderr", chunk),
    });
    instance.handle = handle;
    // `alive` is settled by the exit listener rather than computed while reading, because a reading
    // that settled a process's fate would be an observation that edits what it observes.
    void handle.exited.then((result) => {
      instance.alive = false;
      if (instance.state === "running") {
        instance.state = "exited";
        instance.exitCode = result.code;
      }
    });
    instance.alive = handle.pid !== null;

    await checkHealth(instance);
    return answered(name);
  };

  const stopContainer = async (parsed: Parsed): Promise<Outcome> => {
    const name = parsed.subject;
    if (name === null) return refused("`container stop` needs a container name");
    const instance = containerOf(name);
    if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
    if (instance.state !== "running") return refused(`\`${name}\` is not running`, name);
    await instance.handle?.stop();
    return answered(name);
  };

  const removeContainer = (parsed: Parsed): Outcome => {
    const name = parsed.subject;
    if (name === null) return refused("`container rm` needs a container name");
    const instance = containerOf(name);
    if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
    const key = [...instances.entries()].find(([, value]) => value === instance)?.[0] ?? name;
    if (instance.state === "running") {
      return refused(`\`${name}\` is running; a real engine refuses to remove it without a force, and so does this one`, name);
    }
    instances.delete(key);
    return answered(name);
  };

  const waitContainer = async (parsed: Parsed): Promise<Outcome> => {
    const name = parsed.subject;
    if (name === null) return refused("`container wait` needs a container name");
    const instance = containerOf(name);
    if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
    if (instance.state === "running" && instance.handle !== null) {
      const settled = await Promise.race([
        instance.handle.exited.then(() => true),
        new Promise<boolean>((settle) => setTimeout(() => settle(false), waitMs)),
      ]);
      if (!settled) {
        return failed(
          124,
          `\`${name}\` had not exited after ${String(waitMs)}ms; this world stops waiting rather than holding ` +
            "a run open forever",
          name,
        );
      }
    }
    return answered(name);
  };

  const execInContainer = async (parsed: Parsed): Promise<Outcome> => {
    const name = parsed.subject;
    if (name === null) return refused("`container exec` needs a container name and a command after `--`");
    const instance = containerOf(name);
    if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
    if (instance.state !== "running") {
      return refused(
        `\`${name}\` is ${instance.state}; a real engine refuses to exec into a container that is not ` +
          "running, and so does this one",
        name,
      );
    }
    if (parsed.rest.length === 0) return refused("`container exec` was given nothing to run", name);
    const result = await runInside(instance, parsed.rest);
    // The *client's* status is 0 and the exit code belongs to the command: a command that ran and
    // answered non-zero is a reading a criterion may judge, not a command this world failed to perform.
    return result.code === 0
      ? answered(name)
      : {
          result: "answered",
          status: 0,
          reason: `the command exited with code ${String(result.code)}: ${tail(result.stderr)}`,
          resource: name,
        };
  };

  const createVolume = async (parsed: Parsed): Promise<Outcome> => {
    const name = parsed.subject;
    if (name === null) return refused("`volume create` needs a volume name");
    await mkdir(hostOf(volumesDir, name), { recursive: true });
    volumes.add(name);
    return answered(name);
  };

  const reportRuntime = (): Outcome => answered(runtime);

  const HANDLERS: Readonly<Record<string, (parsed: Parsed) => Promise<Outcome>>> = {
    "image.build": buildImage,
    "image.pull": async (parsed) => pullImage(parsed),
    "image.tag": async (parsed) => tagImage(parsed),
    "image.inspect": async (parsed) => inspectImage(parsed),
    "image.list": async () => answered(),
    "image.remove": async (parsed) => removeImage(parsed),
    "container.create": createContainer,
    "container.start": startContainer,
    "container.stop": stopContainer,
    "container.restart": async (parsed) => {
      const name = parsed.subject;
      if (name === null) return refused("`container restart` needs a container name");
      const instance = containerOf(name);
      if (instance === null) return absent(`this world holds no container named \`${name}\``, name);
      if (instance.state === "running") await instance.handle?.stop();
      return startContainer(parsed);
    },
    "container.remove": async (parsed) => removeContainer(parsed),
    "container.inspect": async (parsed) => {
      const name = parsed.subject;
      if (name === null) return refused("`container inspect` needs a container name");
      return containerOf(name) === null
        ? absent(`this world holds no container named \`${name}\``, name)
        : answered(name);
    },
    "container.list": async () => answered(),
    "container.logs": async (parsed) => {
      const name = parsed.subject;
      if (name === null) return refused("`container logs` needs a container name");
      return containerOf(name) === null
        ? absent(`this world holds no container named \`${name}\``, name)
        : answered(name);
    },
    "container.exec": execInContainer,
    "container.wait": waitContainer,
    "volume.create": createVolume,
    "runtime.info": async () => reportRuntime(),
    "runtime.ping": async () => reportRuntime(),
  };

  const actionOf = (argv: readonly string[]): ContainerAction | null => {
    const verb = argv[0] ?? "";
    const noun = argv[1] ?? "";
    if (verb === "" || noun === "") return null;
    const candidate = `${verb}.${noun}`;
    return isContainerAction(candidate) ? candidate : null;
  };

  /**
   * The flags one action's grammar accepts.
   *
   * Only two actions take flags at all: everything else in the register names its subject and nothing
   * else, so an unknown flag there is refused by the same code that refuses one here. The list is
   * closed per action rather than global, because `image build -t` and `container create --name` are
   * different grammars that happen to share a parser.
   */
  const valueFlagsFor = (action: ContainerAction): readonly string[] => {
    if (action === "container.create") return CREATE_VALUE_FLAGS;
    if (action === "image.build") return BUILD_VALUE_FLAGS;
    return [];
  };

  const rebuild = async (): Promise<void> => {
    for (const instance of instances.values()) {
      if (instance.handle !== null) await instance.handle.stop();
    }
    await rm(root, { recursive: true, force: true });
    await mkdir(imagesDir, { recursive: true });
    await mkdir(volumesDir, { recursive: true });
    images.clear();
    instances.clear();
    volumes.clear();
  };

  const readingOf = (instance: InstanceRecord): ContainerInstanceReading => ({
    id: instance.id,
    name: instance.name,
    image: instance.image,
    state: instance.state,
    alive: instance.alive,
    exitCode: instance.exitCode,
    command: instance.command,
    workingDir: instance.workingDir,
    user: instance.user,
    env: instance.env,
    mounts: instance.mounts.map(
      (mount): ContainerMountReading => ({
        kind: mount.kind,
        source: mount.source,
        destination: mount.destination,
        readOnly: mount.readOnly,
        sourceExists: mount.sourceExists,
      }),
    ),
    ports: instance.ports.map(
      (port): ContainerPortReading => ({
        containerPort: port.containerPort,
        protocol: port.protocol,
        hostPort: port.hostPort,
        hostIp: port.hostIp,
        exposed: port.exposed,
        published: port.published,
      }),
    ),
    resources: instance.resources,
    health: instance.health,
    restartPolicy: instance.restartPolicy,
    labels: instance.labels,
  });

  const imageReadingOf = (image: ImageRecord): ContainerImageReading => ({
    id: image.id,
    tags: [...image.tags],
    digest: image.digest,
    sizeBytes: image.sizeBytes,
    layers: 1,
    os: platform,
    architecture: process.arch,
    entrypoint: image.entrypoint,
    cmd: image.cmd,
    workingDir: image.workingDir,
    user: image.user,
    env: image.env,
    exposedPorts: image.exposedPorts,
    labels: image.labels,
  });

  /**
   * There is deliberately no runtime-counts reading here.
   *
   * One was written, and removed: `ContainerRuntimeReading` is a vocabulary `read()` never carries -
   * the shape of the reading is `ContainerObservationData`, which holds the images and the containers
   * themselves - so a function that built one described a document no caller could ever receive. A
   * dead constructor for a claim is worse than a missing one, because it reads as a capability: the
   * counts a reader wants are `images.length` and `containers.filter(...)` on the reading itself, and
   * those are derived from what the world really holds rather than from a second bookkeeper beside it.
   */

  const logsOfInstances = (): readonly ContainerLogReading[] =>
    [...instances.values()]
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(
        (instance): ContainerLogReading => ({
          container: instance.name,
          runs: instance.runs,
          stdout: instance.stdout,
          stderr: instance.stderr,
          stdoutBytes: instance.stdoutBytes,
          stderrBytes: instance.stderrBytes,
          truncated: instance.truncated,
        }),
      );

  return {
    async prepare(): Promise<void> {
      // `prepare()` and `reset()` share one implementation on purpose. `sim-posix` paid for two: its
      // `prepare()` made directories without clearing, so the *next* run's first iteration read a file
      // the previous run had left behind and two criteria reported `PASS` on someone else's artifact.
      // A world a run inherits is not a world that run built.
      await rebuild();
    },

    async reset(): Promise<void> {
      await rebuild();
    },

    async exec(request: ContainerExecRequest): Promise<ContainerCallRecord> {
      const argv = request.argv;
      const action = actionOf(argv);
      const command = argv.join(" ");
      const subject = argv[1] ?? null;

      let outcome: Outcome;
      // The client is published before any handler runs, because the boundary predicate is several
      // frames below this one and has to be able to say *whose* path it refused. Restored in `finally`
      // so a throw cannot leave the next call attributed to the wrong party.
      const previousClient = currentClient;
      currentClient = request.client;
      try {
        if (action === null) {
          outcome = refused(
            `\`${command}\` normalises to no action this world's register holds. It answers ` +
              `${Object.keys(HANDLERS).sort().join(", ")}`,
            subject,
          );
        } else {
          const handler = HANDLERS[action];
          if (handler === undefined) {
            outcome = refused(`\`${action}\` is an action this world's register names but does not implement`, subject);
          } else {
            const parsed = parse(argv.slice(2), valueFlagsFor(action));
            outcome = parsed.ok ? await handler(parsed.value) : refused(parsed.reason, subject);
          }
        }
      } finally {
        currentClient = previousClient;
      }

      const record: ContainerCallRecord = {
        // `null` when the register does not hold the action, which is the field that says this world
        // was asked for something it does not implement - see `ContainerCallRecord.action`.
        action,
        client: request.client,
        command,
        resource: outcome.resource ?? null,
        result: outcome.result,
        status: outcome.status,
        reason: outcome.reason ?? null,
      };
      calls.push(record);
      return record;
    },

    async read(): Promise<ContainerObservationData> {
      return {
        runtime,
        version: SIM_RUNTIME_VERSION,
        sandbox: resolvePath(root),
        os: platform,
        architecture: process.arch,
        simulated: CONTAINER_SIMULATED_SURFACES,
        calls: [...calls],
        images: [...images.values()]
          .slice()
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map(imageReadingOf),
        containers: [...instances.values()]
          .slice()
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map(readingOf),
        logs: logsOfInstances(),
      };
    },

    escapes(): readonly ContainerEscape[] {
      return [...escapes];
    },

    async stop(): Promise<void> {
      for (const instance of instances.values()) {
        if (instance.handle !== null) await instance.handle.stop();
      }
    },
  };
}

/** The flag sets, exported so a test can hold the register's grammar to the adapter's documentation. */
export const CONTAINER_VALUE_FLAGS = { build: BUILD_VALUE_FLAGS, create: CREATE_VALUE_FLAGS } as const;
