/**
 * The reading a container world produces, and the vocabulary that keeps it honest.
 *
 * This is the seventh family and the fourth simulated world, and the fact that it needed no change to
 * `core/validation` is the same claim Phase C made four times over. What is new here is not the shape
 * of the seam - it is the *subject*. The four families before this one judged a page, a database, a
 * cluster, a filesystem and an account. This one judges a **runtime**: an image store, a set of
 * container records, and - the part that is not substituted - the operating-system processes those
 * containers really are.
 *
 * ## The three conditions every simulated world here has to satisfy
 *
 * 1. **The application executes for real.** It is a real program, started by the adapter, printing the
 *    command vectors it wants the runtime to perform. Nothing about its execution is a rehearsal.
 * 2. **The interface is real.** The commands are a container CLI's own commands. The world parses them
 *    the way a CLI parses them, and a command it does not implement is refused by name rather than
 *    quietly ignored.
 * 3. **The substitution is declared.** {@link CONTAINER_SIMULATED_SURFACES} names every surface that is
 *    stood in for, and it travels in the reading. A bundle from this world says `simulated` and means
 *    it, so a verdict reached here can never be read as a verdict about a real engine.
 *
 * ## What is real, and what is not
 *
 * The distinction is sharper in this world than in any of the four before it, because a container is
 * *made of* two things with very different natures - a process, and the isolation around it - and only
 * one of them can be substituted without making the whole thing a fiction nobody should trust.
 *
 * **Real.** The container's command is really started, as an ordinary child process of the world, with
 * the working directory, the environment and the account the plan and the command named. Its exit code
 * is the exit code the operating system reported. Its stdout and stderr are the bytes it really wrote.
 * The image's build context is really read from disk, so its digest is a digest of files that exist. A
 * bind mount's source path is really tested for existence. These are facts this machine produced, and
 * they are the reason a criterion here can be believed.
 *
 * **Substituted.** No kernel namespace is created, so the process shares the world's PID, IPC and UTS
 * namespaces. No cgroup exists, so a declared memory or CPU limit is a record that is never applied -
 * {@link ContainerResourceReading.enforced} is the field that says so, out loud, in every reading. No
 * layer cache exists, so a build produces one layer. There is no registry, so a pull is answered from
 * the local store or refused. No bridge network exists, so a published port is a mapping in a record
 * and **not** a socket - see {@link ContainerPortReading}. And the account a container declares is
 * recorded and reported but never *switched to*, because switching accounts on the host the world runs
 * on is the one thing a substitute must not do to the machine that is judging.
 *
 * ## Two things this reading deliberately does not contain
 *
 * **No pid, and no timestamps, and no durations.** A pid, a wall-clock creation time and an elapsed
 * duration are all facts about *this machine at this moment* rather than facts about the application.
 * M1 asks whether the same code produced the same result twice, by comparing the readings two runs
 * wrote - so a reading carrying any of the three would make two runs of one unchanged program differ,
 * and the metric would report a difference the application never caused. A real `docker inspect`
 * answers all three; this world answers none, and says so here rather than leaving a reader to wonder
 * whether the field was forgotten.
 *
 * **No container id chosen by the world.** A real engine assigns a random identifier, and a random
 * identifier is the same defect as a pid. An id here is derived from the container's name and the image
 * it ran, so the same command line produces the same id on every run - and a criterion may name either
 * the name or the id, which is the property a real CLI has.
 *
 * ## What a validator may quote
 *
 * Every rendering below is a *spelling* of a reading, not a second record of it. `renderContainer`
 * prints the account, the state, the exit code and the mounts in one line so a failure report can quote
 * the container it was about without a reader having to hold a JSON document in their head.
 */

/**
 * The observation kind this family writes into `Observation.kind`.
 *
 * `container.runtime` rather than `container`, for the reason the kind is a string at all: a reader of
 * a bundle sees one word telling them which family judged the run, and the family here is a runtime.
 */
export const CONTAINER_OBSERVATION_KIND = "container.runtime";

/**
 * The surfaces this world stands in for, from a closed vocabulary.
 *
 * The list is the substitution's own *declaration*, and it is deliberately not "everything a container
 * engine does". Each member names something a reader would otherwise assume was real: a cgroup that
 * enforced a limit, a namespace that isolated a process, a registry that answered a pull, a network
 * that carried a packet. A reading that carried no such list could still be believed - and would be
 * believed about the wrong thing.
 */
export const CONTAINER_SIMULATED_SURFACES = [
  "namespaces",
  "cgroups",
  "image-layers",
  "registry",
  "published-ports",
  "volumes",
  "user-switching",
] as const;

export type ContainerSimulatedSurface = (typeof CONTAINER_SIMULATED_SURFACES)[number];

/**
 * How a command vector ended.
 *
 * Four answers, and the split is the one the cluster substitute paid for: a resource that is **absent**
 * and a request that was **refused** are two different observations, and a client that cannot tell them
 * apart reports a missing image as a rejected one. `failed` is the fourth because it is neither - the
 * runtime performed the action and the thing the action ran exited non-zero, which is a fact about the
 * application rather than about the request.
 */
export const CONTAINER_ACTION_RESULTS = ["answered", "absent", "refused", "failed"] as const;

export type ContainerActionResult = (typeof CONTAINER_ACTION_RESULTS)[number];

/**
 * Who issued the command vector.
 *
 * `provisioner` is the application under test, acting through the world's runtime. `criterion` is a
 * `run` step in an acceptance contract, which acts in the world itself. Keeping them apart is what
 * makes "the application never published this port" a thing a criterion can say: the record shows
 * which of the two asked.
 */
export const CONTAINER_CLIENTS = ["provisioner", "criterion"] as const;

export type ContainerClient = (typeof CONTAINER_CLIENTS)[number];

/** A container's lifecycle state, from the world's own record. */
export const CONTAINER_STATES = ["created", "running", "exited", "removed"] as const;

export type ContainerState = (typeof CONTAINER_STATES)[number];

/**
 * How a container sees a directory.
 *
 * `bind` is a path the application named, and its existence is really tested. `volume` is a named
 * directory the *world* owns and creates on demand. The distinction matters because neither is a kernel
 * mount: what differs is who chose the path.
 */
export const CONTAINER_MOUNT_KINDS = ["bind", "volume"] as const;

export type ContainerMountKind = (typeof CONTAINER_MOUNT_KINDS)[number];

/** The protocols a port mapping may name. Two, because a third would be a protocol no criterion reads. */
export const CONTAINER_PORT_PROTOCOLS = ["tcp", "udp"] as const;

export type ContainerPortProtocol = (typeof CONTAINER_PORT_PROTOCOLS)[number];

/**
 * A healthcheck's answer.
 *
 * `none` is the absence of a healthcheck and is not the same fact as `unhealthy`: a container nobody
 * asked to be checked has not failed a check, and a report that merged the two would send an agent to
 * repair an application that was never asked to answer.
 */
export const CONTAINER_HEALTH_STATES = ["none", "starting", "healthy", "unhealthy"] as const;

export type ContainerHealthState = (typeof CONTAINER_HEALTH_STATES)[number];

/**
 * The platforms this world stands in for.
 *
 * A list with **one** member, and the list is the point rather than a formality. The platform decides
 * how a path is spelled inside a container, so a document naming a platform this world does not
 * implement would be a document whose every criterion resolved paths by the wrong grammar - which is
 * the disagreement `OsPlan.family` exists to make expressible, one family over. A constant would be a
 * fact with nowhere to grow; a list is where a second platform is *declared*, and until one is, a
 * document naming one is refused by a sentence that names the list.
 *
 * The platform is a property of the *container's* filesystem and not of this machine's. A container's
 * paths are POSIX even when the engine that runs it is not, so the app under test may be a Windows
 * program while everything inside the world it is building is spelled `/app`.
 */
export const CONTAINER_PLATFORMS = ["linux"] as const;

export type ContainerPlatform = (typeof CONTAINER_PLATFORMS)[number];

/**
 * The action vocabulary, in the spelling a criterion and a call record both use.
 *
 * `image.build` and `container.start` rather than `docker build` and `docker start`, because a record
 * that stored the command line as the action would be storing the *client's* spelling, and a second
 * client naming the same action differently would then be a second action. The command line is kept
 * beside it in {@link ContainerCallRecord.command}, as it arrived.
 *
 * The list is closed. A command vector naming something outside it is refused by name, which is the
 * `call` step's rule one family over: a vocabulary that grows must grow its refusals with it.
 */
export const CONTAINER_ACTIONS = [
  "image.build",
  "image.pull",
  "image.tag",
  "image.inspect",
  "image.list",
  "image.remove",
  "container.create",
  "container.start",
  "container.stop",
  "container.restart",
  "container.remove",
  "container.inspect",
  "container.list",
  "container.logs",
  "container.exec",
  "container.wait",
  "volume.create",
  "runtime.info",
  "runtime.ping",
] as const;

export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

/**
 * Whether a string is one of {@link CONTAINER_ACTIONS}.
 *
 * A predicate rather than a second list beside the tuple. The cloud family needed
 * `CLOUD_ACTION_NAMES` because its action table carried a method and a route alongside each name; this
 * family's table is the names, so the tuple *is* the membership test and a second copy of it would be
 * free to drift.
 */
export function isContainerAction(value: string): value is ContainerAction {
  return (CONTAINER_ACTIONS as readonly string[]).includes(value);
}

/** One command vector the world was asked to perform, and what it did. */
export interface ContainerCallRecord {
  /**
   * The action the command named, or `null` when this world does not implement it.
   *
   * The `null` is the design, and it is here because the alternative was a refusal nobody could read.
   * The other six families record a command the world does not answer as a *program* that is not in
   * their register, and their records carry the program's own name, so the refusal is legible. This
   * family's vocabulary is closed: {@link CONTAINER_ACTIONS} is a set of nineteen normalised action
   * names, and `container prune` normalises to one that is not a member. Recording it under the action
   * it most nearly resembles would be a record asserting a call that was never made, and dropping it
   * would leave a contract unable to observe the refusal at all - which is worse, because a refusal is
   * the observation a contract about a *substitute* most needs to be able to make.
   *
   * So the field carries the absence. A record whose `action` is `null` says this world was asked for
   * something it does not implement, the `command` says what it was asked, and the `reason` says so in
   * a sentence.
   */
  readonly action: ContainerAction | null;
  readonly client: ContainerClient;
  /**
   * The command line as it arrived, joined with single spaces.
   *
   * Recorded because the action is a normalised name and the operator's failure report quotes what the
   * application actually said. Every other field here is derived from this one; keeping it is what
   * makes the record auditable rather than asserted.
   */
  readonly command: string;
  /** The thing the command named, in this family's reference spelling, or `null` when it named none. */
  readonly resource: string | null;
  readonly result: ContainerActionResult;
  /**
   * The status the command line itself reported. `0` for a command that was performed and whose
   * container exited non-zero, because those are two different facts: `failed` is the container's exit
   * code, and this is the client's.
   */
  readonly status: number;
  /** Why the world refused, when it did. `null` otherwise. */
  readonly reason: string | null;
}

/** One directory a container was given, and whether the world could really see it. */
export interface ContainerMountReading {
  readonly kind: ContainerMountKind;
  /** As the command spelled it. For a bind mount, a path; for a volume, a name. */
  readonly source: string;
  readonly destination: string;
  readonly readOnly: boolean;
  /**
   * Whether the bind source really exists on this machine.
   *
   * `true` for a volume, because the world creates it. This is the field that makes a bind mount more
   * than a name: a real engine fails a start whose source is missing, and this world does too - so a
   * criterion that reads `sourceExists: false` is reading a start that was refused for the real reason.
   */
  readonly sourceExists: boolean;
}

/**
 * One published port.
 *
 * The field that matters is the one that is *not* here. A real engine, on `-p 8080:80`, makes the
 * container's port reachable at `127.0.0.1:8080`, and a criterion can then open a socket and be told
 * something true. This world binds nothing - there is no network stack in the substitution - so a
 * reading that carried a `reachable: true` field would be claiming a measurement nobody took. What it
 * carries instead is what the mapping *is*: a declaration, recorded, with the container's own
 * `EXPOSE` line recorded beside it, and `"published-ports"` named in the reading's `simulated` list.
 * A criterion can judge the mapping. A criterion cannot judge reachability, and this family's refusal
 * to offer the field is what stops one being written.
 */
export interface ContainerPortReading {
  readonly containerPort: number;
  readonly protocol: ContainerPortProtocol;
  /** The host port the command asked for, or `null` when the command left it to the engine. */
  readonly hostPort: number | null;
  readonly hostIp: string;
  /** Whether the image declared this port with `EXPOSE`. Independent of whether anything published it. */
  readonly exposed: boolean;
  /** Whether this mapping came from a `-p` on a command rather than from the image's own declaration. */
  readonly published: boolean;
}

/**
 * The resource limits a container declared, and whether anything applied them.
 *
 * `enforced` is computed by the world rather than written as a constant, and the difference is the
 * defect `safetyViolation: null` already cost this project: a field written as a literal by the writer
 * is a claim pretending to be a record, because even a limit that *was* applied could not have been
 * reported. This world computes it from whether it has an enforcement mechanism at all - it has none,
 * so it reports `false` - and a future substitution that really installed a cgroup would compute `true`
 * without this file changing.
 */
export interface ContainerResourceReading {
  /** The memory limit in bytes, or `null` when the command declared none. */
  readonly memoryBytes: number | null;
  /** The soft memory limit in bytes, or `null`. */
  readonly memoryReservationBytes: number | null;
  /** CPUs as a fraction of one core, e.g. `1.5`, or `null`. */
  readonly cpus: number | null;
  /** The process limit, or `null`. */
  readonly pidsLimit: number | null;
  /** Whether the world applied any of the above. Always computed; never asserted. */
  readonly enforced: boolean;
}

/** A healthcheck the world really ran, and what it answered. */
export interface ContainerHealthReading {
  readonly command: readonly string[];
  readonly state: ContainerHealthState;
  /** The exit code of the last attempt, or `null` when no attempt was made. */
  readonly exitCode: number | null;
  readonly attempts: number;
  /** The interval the command declared, in seconds. A record of the declaration, not a schedule. */
  readonly intervalSeconds: number;
}

/**
 * One image in the store.
 *
 * `digest` is a digest of the build context the world really read, so two builds of the same files
 * agree and two builds of different files do not - which is what makes "this tag points at the code we
 * just built" a thing a criterion can check. `layers` is always `1` here, and it is recorded rather
 * than omitted so the substitution is visible in the reading instead of being inferable only from
 * `simulated`.
 *
 * There is no creation timestamp. The header says why.
 */
export interface ContainerImageReading {
  /** `sha256:<12 hex>`, derived from the tags and the context digest. Deterministic by construction. */
  readonly id: string;
  readonly tags: readonly string[];
  /** The digest of the build context, as the world computed it. */
  readonly digest: string;
  readonly sizeBytes: number;
  readonly layers: number;
  readonly os: string;
  readonly architecture: string;
  readonly entrypoint: readonly string[];
  readonly cmd: readonly string[];
  readonly workingDir: string;
  /** The account the image declares its process runs as. Recorded, never switched to. */
  readonly user: string;
  readonly env: Readonly<Record<string, string>>;
  readonly exposedPorts: readonly number[];
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * Everything one container is, apart from the bytes it wrote.
 *
 * The logs are a separate list, on the same rule the cloud family used to keep its action record apart
 * from its state record: an instance reading is about *what the container is*, and a log reading is
 * about *what it said*, and merging them would make one record answer two questions with two different
 * repair paths.
 *
 * `alive` is observed when the reading is taken, from the real child process. It exists beside `state`
 * because they can disagree in a way worth seeing: a container whose state is `running` and whose
 * process has already exited is the shape of a program that returned while its supervisor was not
 * looking.
 */
export interface ContainerInstanceReading {
  readonly id: string;
  readonly name: string;
  /** The tag the container was created from, as the command spelled it. */
  readonly image: string;
  readonly state: ContainerState;
  readonly alive: boolean;
  /** The exit code the operating system reported, or `null` while the process has not finished. */
  readonly exitCode: number | null;
  readonly command: readonly string[];
  readonly workingDir: string;
  readonly user: string;
  readonly env: Readonly<Record<string, string>>;
  readonly mounts: readonly ContainerMountReading[];
  readonly ports: readonly ContainerPortReading[];
  readonly resources: ContainerResourceReading;
  readonly health: ContainerHealthReading | null;
  readonly restartPolicy: string;
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * The bytes one container really wrote.
 *
 * A container may be started more than once, so `runs` is a count rather than a flag and the output is
 * the concatenation of every run - a real engine keeps one stream per container and so does this one.
 * `truncated` says when the world stopped keeping bytes, so a criterion reading a log is never reading
 * a prefix it believes is the whole story.
 */
export interface ContainerLogReading {
  readonly container: string;
  readonly runs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly truncated: boolean;
}

/** What the world says about itself. The first thing a reader wants and the first thing a bundle names. */
export interface ContainerRuntimeReading {
  /** The runtime identity the readings name, e.g. `veridian-container-sim`. Declared, never inferred. */
  readonly name: string;
  /** The engine version the readings claim. A record, not an installed engine. */
  readonly version: string;
  readonly apiVersion: string;
  readonly os: string;
  readonly architecture: string;
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly images: number;
  readonly containers: number;
  readonly running: number;
}

export interface ContainerObservationData {
  /** The runtime identity the environment document declared. */
  readonly runtime: string;
  readonly version: string;
  /**
   * The world's own state directory, as this machine spells it.
   *
   * Absolute, and resolved by the adapter rather than by a reader: a bundle that named the document's
   * relative spelling would be quoting a path that is not the path the world really wrote to, which is
   * the defect the machine family paid for when it logged a resolved root and a declared one side by
   * side and a reader trusted the wrong one.
   */
  readonly sandbox: string;
  /** The platform the runtime stands in for. A record, not a kernel. */
  readonly os: string;
  readonly architecture: string;
  /** The substituted surfaces, from the closed vocabulary above. */
  readonly simulated: readonly ContainerSimulatedSurface[];
  readonly calls: readonly ContainerCallRecord[];
  readonly images: readonly ContainerImageReading[];
  readonly containers: readonly ContainerInstanceReading[];
  readonly logs: readonly ContainerLogReading[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isMount = (value: unknown): value is ContainerMountReading =>
  isRecord(value) &&
  typeof value["kind"] === "string" &&
  typeof value["source"] === "string" &&
  typeof value["destination"] === "string" &&
  typeof value["readOnly"] === "boolean" &&
  typeof value["sourceExists"] === "boolean";

const isPort = (value: unknown): value is ContainerPortReading =>
  isRecord(value) &&
  typeof value["containerPort"] === "number" &&
  typeof value["protocol"] === "string" &&
  (value["hostPort"] === null || typeof value["hostPort"] === "number") &&
  typeof value["hostIp"] === "string" &&
  typeof value["exposed"] === "boolean" &&
  typeof value["published"] === "boolean";

const isResources = (value: unknown): value is ContainerResourceReading =>
  isRecord(value) &&
  (value["memoryBytes"] === null || typeof value["memoryBytes"] === "number") &&
  (value["memoryReservationBytes"] === null || typeof value["memoryReservationBytes"] === "number") &&
  (value["cpus"] === null || typeof value["cpus"] === "number") &&
  (value["pidsLimit"] === null || typeof value["pidsLimit"] === "number") &&
  typeof value["enforced"] === "boolean";

const isHealth = (value: unknown): value is ContainerHealthReading =>
  isRecord(value) &&
  isStringArray(value["command"]) &&
  typeof value["state"] === "string" &&
  (value["exitCode"] === null || typeof value["exitCode"] === "number") &&
  typeof value["attempts"] === "number" &&
  typeof value["intervalSeconds"] === "number";

const isCall = (value: unknown): value is ContainerCallRecord =>
  isRecord(value) &&
  (value["action"] === null || typeof value["action"] === "string") &&
  typeof value["client"] === "string" &&
  typeof value["command"] === "string" &&
  (value["resource"] === null || typeof value["resource"] === "string") &&
  typeof value["result"] === "string" &&
  typeof value["status"] === "number" &&
  (value["reason"] === null || typeof value["reason"] === "string");

const isImage = (value: unknown): value is ContainerImageReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  isStringArray(value["tags"]) &&
  typeof value["digest"] === "string" &&
  typeof value["sizeBytes"] === "number" &&
  typeof value["layers"] === "number" &&
  typeof value["os"] === "string" &&
  typeof value["architecture"] === "string" &&
  isStringArray(value["entrypoint"]) &&
  isStringArray(value["cmd"]) &&
  typeof value["workingDir"] === "string" &&
  typeof value["user"] === "string" &&
  isStringMap(value["env"]) &&
  Array.isArray(value["exposedPorts"]) &&
  value["exposedPorts"].every((entry) => typeof entry === "number") &&
  isStringMap(value["labels"]);

const isInstance = (value: unknown): value is ContainerInstanceReading =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["image"] === "string" &&
  typeof value["state"] === "string" &&
  typeof value["alive"] === "boolean" &&
  (value["exitCode"] === null || typeof value["exitCode"] === "number") &&
  isStringArray(value["command"]) &&
  typeof value["workingDir"] === "string" &&
  typeof value["user"] === "string" &&
  isStringMap(value["env"]) &&
  Array.isArray(value["mounts"]) &&
  value["mounts"].every(isMount) &&
  Array.isArray(value["ports"]) &&
  value["ports"].every(isPort) &&
  isResources(value["resources"]) &&
  (value["health"] === null || isHealth(value["health"])) &&
  typeof value["restartPolicy"] === "string" &&
  isStringMap(value["labels"]);

const isLog = (value: unknown): value is ContainerLogReading =>
  isRecord(value) &&
  typeof value["container"] === "string" &&
  typeof value["runs"] === "number" &&
  typeof value["stdout"] === "string" &&
  typeof value["stderr"] === "string" &&
  typeof value["stdoutBytes"] === "number" &&
  typeof value["stderrBytes"] === "number" &&
  typeof value["truncated"] === "boolean";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a runtime document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs: the first sends an agent to the application, the second to the
 * environment.
 */
export function isContainerObservationData(value: unknown): value is ContainerObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["runtime"] !== "string") return false;
  if (typeof value["version"] !== "string") return false;
  if (typeof value["sandbox"] !== "string") return false;
  if (typeof value["os"] !== "string") return false;
  if (typeof value["architecture"] !== "string") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!Array.isArray(value["calls"]) || !value["calls"].every(isCall)) return false;
  if (!Array.isArray(value["images"]) || !value["images"].every(isImage)) return false;
  if (!Array.isArray(value["containers"]) || !value["containers"].every(isInstance)) return false;
  if (!Array.isArray(value["logs"]) || !value["logs"].every(isLog)) return false;
  return true;
}

// ---- resolving a target, in the family's own spelling --------------------------------------------

/**
 * The result of turning a criterion's target into a value this world can look up.
 *
 * A discriminated result rather than `string | null`, for the reason the two system families before
 * this one record: a target that did not resolve and came back as `null` forces the validator to write
 * one message covering every reason it might not have, which is the shape of an error message naming a
 * cause its reporter never observed. Here the *resolver* knows why, so the reason travels with the
 * refusal and the validator quotes it.
 */
export type ContainerTargetResult<T> =
  | { readonly kind: "target"; readonly value: T }
  | { readonly kind: "refused"; readonly reason: string };

const refused = <T>(reason: string): ContainerTargetResult<T> => ({ kind: "refused", reason });
const resolved = <T>(value: T): ContainerTargetResult<T> => ({ kind: "target", value });

/**
 * The two things a criterion may name.
 *
 * Two kinds rather than one, because an image and a container are different objects with different
 * fields: an image has a digest and a build context, a container has an exit code and a process. A
 * criterion that named the wrong noun would otherwise be answered with a reading that happens to share
 * a field name, which is how a check for "the image is tagged" becomes a check on a running container.
 */
export type ContainerRef =
  | { readonly kind: "image"; readonly name: string }
  | { readonly kind: "container"; readonly name: string };

/** The two kinds of thing a target may name. Named once, and read by the refusal that lists them. */
export const CONTAINER_REF_KINDS = ["image", "container"] as const;

/**
 * What a name in this family may contain.
 *
 * The colon is the point. An image tag is `name:tag`, and `:` is a character this family's names
 * legitimately carry - unlike the provider family next door, which reserves `:` as the separator
 * inside an access reference and therefore refuses a name containing one. *The separator one grammar
 * reserves is a character another grammar's terms contain*, and copying the neighbour's pattern
 * would have refused every image a criterion names.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

const nameProblem = (kind: string, name: string): string | null => {
  if (name === "") return `a ${kind} name is required, and the reference names an empty one`;
  if (name.includes("/")) {
    return (
      `a reference separates its kind from its name with "/", so a ${kind} name carrying one cannot ` +
      `be written in this family's spelling. Name the ${kind} without its registry prefix; this one ` +
      `is ${JSON.stringify(name)}`
    );
  }
  if (!NAME_PATTERN.test(name)) {
    return (
      `a ${kind} name is lower case and starts with a letter or a digit; ${kind} names may carry ` +
      `letters, digits, ".", "_", "-" and ":", and this one is ${JSON.stringify(name)}`
    );
  }
  return null;
};

/**
 * The reference a target names, or the resolver's own reason for refusing it.
 *
 * Targets are written as this family spells them - `image/cart-api:1.0.0`, `container/cart-api` -
 * rather than as a command line, because that is the spelling that survives the world being served by
 * a different implementation. Targets are trimmed and then *checked* for it rather than silently
 * trimmed, on the same rule the provider family follows: a target with a stray space is a typo the
 * operator wants named, and quietly repairing it teaches them it was fine.
 */
export function resolveContainerRef(target: string): ContainerTargetResult<ContainerRef> {
  const trimmed = target.trim();
  if (trimmed !== target) {
    return refused(
      `a reference is written without surrounding whitespace; this one is ${JSON.stringify(target)}`,
    );
  }
  const parts = target.split("/");
  const kind = parts[0];
  if (kind === undefined || kind === "") {
    return refused(
      `a reference names a kind first - one of ${CONTAINER_REF_KINDS.join(", ")} - and this one is ` +
        `${JSON.stringify(target)}`,
    );
  }
  if (!(CONTAINER_REF_KINDS as readonly string[]).includes(kind)) {
    return refused(
      `this family names ${CONTAINER_REF_KINDS.join(" and ")}, and the reference names ` +
        `${JSON.stringify(kind)}. There is no third kind, because an image and a container are the ` +
        `two things this world holds`,
    );
  }
  const name = parts.slice(1).join("/");
  const problem = nameProblem(kind, name);
  if (problem !== null) return refused(problem);
  return kind === "image"
    ? resolved({ kind: "image", name })
    : resolved({ kind: "container", name });
}

/** The reference a reading or a call record stores, built from a resolved one. */
export function containerRefSpelling(ref: ContainerRef): string {
  return `${ref.kind}/${ref.name}`;
}

/** The image with this tag, or `null` when the store does not hold one. */
export function imageTagged(
  data: ContainerObservationData,
  tag: string,
): ContainerImageReading | null {
  return data.images.find((image) => image.tags.includes(tag)) ?? null;
}

/**
 * The container this name identifies.
 *
 * A name or an id, both accepted, because a real CLI accepts both and an operator who ran
 * `docker ps -a --no-trunc` has an id in their hand. A name is matched first, so a world holding a
 * container whose *name* happens to look like another container's id still answers the name - and the
 * derivation that makes an id deterministic is what makes the collision possible in principle.
 */
export function containerNamed(
  data: ContainerObservationData,
  name: string,
): ContainerInstanceReading | null {
  return (
    data.containers.find((container) => container.name === name) ??
    data.containers.find((container) => container.id === name) ??
    null
  );
}

/** The log record for a container, or `null` when it never wrote anything. */
export function logsOf(
  data: ContainerObservationData,
  container: string,
): ContainerLogReading | null {
  return data.logs.find((log) => log.container === container) ?? null;
}

/** Every call the given client issued, in the order they arrived. */
export function containerCallsOf(
  data: ContainerObservationData,
  client: ContainerClient,
): readonly ContainerCallRecord[] {
  return data.calls.filter((call) => call.client === client);
}

/** Which image a container's declared user came from, or `null` when the image is gone. */
export function imageOf(
  data: ContainerObservationData,
  container: ContainerInstanceReading,
): ContainerImageReading | null {
  return imageTagged(data, container.image);
}

// ---- renderings, so a failure report can quote what it judged ------------------------------------

/** One line an operator reads: what the image is, what it runs, and how big it is. */
export function renderImage(image: ContainerImageReading): string {
  const tags = image.tags.length === 0 ? "(untagged)" : image.tags.join(", ");
  const entry = [...image.entrypoint, ...image.cmd].join(" ");
  return (
    `${tags} [${image.id}] ${image.os}/${image.architecture} ${image.sizeBytes} bytes ` +
    `${String(image.layers)} layer(s), runs as ${JSON.stringify(image.user)}, entry ` +
    `${entry === "" ? "(none)" : JSON.stringify(entry)}`
  );
}

/** One line an operator reads: what the container is, whether its process is alive, and why it stopped. */
export function renderContainer(container: ContainerInstanceReading): string {
  const state =
    container.exitCode === null
      ? container.state
      : `${container.state} (exit ${String(container.exitCode)})`;
  const extra: string[] = [];
  if (container.mounts.length > 0) {
    extra.push(
      `mounts ${container.mounts
        .map((mount) => `${mount.source}:${mount.destination}${mount.readOnly ? ":ro" : ""}`)
        .join(", ")}`,
    );
  }
  if (container.ports.length > 0) {
    extra.push(`ports ${container.ports.map(renderPort).join(", ")}`);
  }
  if (container.health !== null) extra.push(`health ${container.health.state}`);
  const tail = extra.length === 0 ? "" : `, ${extra.join(", ")}`;
  return (
    `${container.name} [${container.id}] ${container.image} ${state}` +
    `, process ${container.alive ? "alive" : "not running"}` +
    `, runs as ${JSON.stringify(container.user)}${tail}`
  );
}

/** `8080:80/tcp (exposed)` - a mapping, and whether the image declared the port as well as published it. */
export function renderPort(port: ContainerPortReading): string {
  const host = port.hostPort === null ? "*" : String(port.hostPort);
  const flags: string[] = [];
  if (port.exposed) flags.push("exposed");
  if (!port.published) flags.push("from the image");
  return `${host}:${String(port.containerPort)}/${port.protocol}${flags.length === 0 ? "" : ` (${flags.join(", ")})`}`;
}

/** `run as svc-cart (recorded, not applied)` - the account, and the substitution that stops mattering. */
export function renderUser(container: ContainerInstanceReading): string {
  return `${container.user} (recorded, not applied - the process runs as the account this world runs as)`;
}

/** `source:/data -> /data:ro (source exists)` - a mount, and whether the world could really see it. */
export function renderMount(mount: ContainerMountReading): string {
  return (
    `${mount.source}:${mount.destination}${mount.readOnly ? ":ro" : ""} ` +
    `(${mount.kind}${mount.sourceExists ? "" : ", source absent"})`
  );
}

/** The limits a container declared, with the substitution stated in the line rather than implied. */
export function renderLimit(resources: ContainerResourceReading): string {
  const parts: string[] = [];
  if (resources.memoryBytes !== null) parts.push(`memory ${String(resources.memoryBytes)} bytes`);
  if (resources.memoryReservationBytes !== null) {
    parts.push(`reservation ${String(resources.memoryReservationBytes)} bytes`);
  }
  if (resources.cpus !== null) parts.push(`cpus ${String(resources.cpus)}`);
  if (resources.pidsLimit !== null) parts.push(`pids ${String(resources.pidsLimit)}`);
  if (parts.length === 0) return "no limits declared";
  return `${parts.join(", ")}${resources.enforced ? "" : " (declared, not enforced)"}`;
}

/** The healthcheck a container declares, and its last answer. */
export function renderHealth(health: ContainerHealthReading): string {
  const exit = health.exitCode === null ? "no exit code" : `exit ${String(health.exitCode)}`;
  return (
    `${health.state}: ${JSON.stringify(health.command.join(" "))} ` +
    `after ${String(health.attempts)} attempt(s), ${exit}, every ${String(health.intervalSeconds)}s`
  );
}

/** One line an operator reads: the action, who asked, and how it ended. */
export function renderCall(call: ContainerCallRecord): string {
  const who = call.client === "criterion" ? "criterion" : "provisioner";
  const reason = call.reason === null ? "" : ` - ${call.reason}`;
  return `${call.action} (${who}) -> ${call.result}${reason}: ${call.command}`;
}
