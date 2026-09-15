// cart-web, provisioned into a substitute container runtime.
//
// A real application process, really started by whoever runs this file, that really deploys itself -
// and the runtime it deploys into is a substitute. `sim-container` is the seventh world this repository
// ships and the fifth simulated one, and this file is the half of it that is *not* simulated: the
// process, its files, its commands and its output are all real, and only the engine on the other end of
// the commands is stood in for.
//
// ## What this file does, in order
//
//   1. Reads the four variables the world declares, and refuses to run at all if one is missing.
//   2. Refuses a platform that is not linux, by name, before it writes or sends anything.
//   3. Clears and rebuilds its own build context - `context/` - so a run that follows another run does
//      not inherit the files that one left behind.
//   4. Prints its command vectors on stdout, one JSON array per line, in the order they must run.
//   5. Announces completeness on stderr, so the world can read that provisioning finished rather than
//      infer it from the absence of an error.
//
// ## Why every path in a command is the world's spelling, not this machine's
//
// The build context is named `./context` and the mount destination `/workspace`. Neither is a path this
// machine can open, and that is the point. The world resolves a relative bind source against the
// application's own directory, so a relative spelling is *more* honest than an absolute one: it says
// "this directory, beside me" and lets the world decide where that is. A container path belongs to the
// container, so a program that passed this machine's spelling of its own directory would be asking the
// world to mount the wrong thing and would be refused for it.
//
// `VERIDIAN_CONTAINER_SANDBOX` is read and reported, and is deliberately never used as a path in a
// command: it is where the world keeps its own files on *this* machine, which is the world's business
// and not the application's.
//
// ## Why no path here is absolute
//
// The three programs this file installs are started by the world with their working directory set to
// the container's `/workspace` - which the world resolves to this very `context/` directory on the
// host. They therefore read and write **relative** paths (`runtime/ready`), and none of them ever
// spells `/var/lib/cart`. An absolute path inside a program would be resolved by the *host* filesystem
// rather than by the world, so a program that used one would be reading a directory that has nothing
// to do with the container it believes it is in.
//
// ## Why stdout carries nothing but command lines
//
// The world's adapter reads this process's stdout, parses every non-blank line as a JSON array of
// words, and hands the array to the runtime. A line that is not a JSON array is skipped with a
// warning - so a stray `console.log` would not fail the run, it would be quietly dropped, which is
// worse than failing. Every human-readable line therefore goes to **stderr** through `say()`, and
// stdout is a command channel with exactly one shape on it.
//
// ## Why a refusal is reported and not thrown
//
// The world answers `refused` for a command it does not serve - a registry pull, a Dockerfile
// instruction that selects files out of the context. That answer is a *result*, not an exception: the
// vector was sent, the world answered, and the answer travels back in the reading as a `container.call`
// record. Throwing here would end provisioning before the remaining vectors ran and would turn an
// observation into a crash, so a refusal is printed and the next vector is sent.
//
// ## The one thing this file does not do
//
// It does not look inside the volume it declares. `cart-state` is created by the world, mounted at
// `/var/lib/cart`, and nothing here can read it: the world's `run` step executes inside the
// application's own directory, and a volume's contents belong to the world. The contract can judge
// that the volume exists and where it is mounted; nothing here pretends to judge what is in it.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The four names the world declares. Listed once, so the interface is visible in one place. */
const CONTAINER_ENV = Object.freeze({
  sandbox: "VERIDIAN_CONTAINER_SANDBOX",
  workspace: "VERIDIAN_CONTAINER_WORKSPACE",
  runtime: "VERIDIAN_CONTAINER_RUNTIME",
  platform: "VERIDIAN_CONTAINER_PLATFORM",
});

// ---- what the application builds and runs ---------------------------------------------------------

const APPLICATION = "cart-web";
const IMAGE = "cart-web:1.0.0";
const IMAGE_LATEST = "cart-web:latest";
const STATE_VOLUME = "cart-state";
const STATE_PATH = "/var/lib/cart";
const WORKSPACE = "/workspace";
const BUILD_CONTEXT = "./context";
const HOST_PORT = 18080;
const PORT = 8080;
const PUBLISH = String(HOST_PORT) + ":" + String(PORT);
const SERVICE_ACCOUNT = "svc-cart";
const HEALTH_TOKEN = "veridian-container-health";
const HEALTH_INTERVAL = 30;
const MEMORY = "256m";
const CPUS = "1";
const PIDS = "64";
const SERVICE_PROGRAM = "srv/cart/service.mjs";
const HEALTH_PROGRAM = "srv/cart/health.mjs";
const CHECK_PROGRAM = "srv/cart/check.mjs";
const AUDIT_PROGRAM = "srv/cart/audit.mjs";

// ---- the three programs the image carries ---------------------------------------------------------
//
// Each is written as an array of lines joined with "\n" rather than as one template literal, so that
// nothing in this file has to escape a brace or a backtick and so that a defect overlay can name a
// single line of a generated program without matching the file it is generated from.

/**
 * The service. Writes two lines to stdout, records that it is listening, and holds the process open.
 *
 * The role line is a *declaration the program makes about itself*, which is why it is what `D3` moves:
 * nothing in this world reads it, and a program whose stdout says `read-write` where its contract says
 * `read-only` is a program that has not been hardened, however healthy it looks.
 */
const SERVICE_SOURCE = [
  "// cart-web (simulated): the application's own service, started by the world as the container's",
  "// command. Two lines to stdout, one record on disk, and then it stays alive - a long-running",
  "// service does not exit, and a container whose command returned would be read as an exited one.",
  'import { mkdirSync, writeFileSync } from "node:fs";',
  "",
  "// The startup line goes to stderr, the same convention this repository uses everywhere else: a",
  "// human-readable note is not a result, and stdout is the stream a caller reads.",
  'process.stderr.write("cart-web: service starting\\n");',
  "",
  'const port = process.env.CART_WEB_PORT;',
  'if (port === undefined || port === "") {',
  '  process.stderr.write("cart-web: the container was given no CART_WEB_PORT\\n");',
  '  process.exit(2);',
  "}",
  "",
  'process.stdout.write("cart-web listening on " + String(port) + "\\n");',
  'process.stdout.write("catalog: read-only for svc-cart" + "\\n");',
  "",
  "// The healthcheck reads this file. It is relative on purpose: the working directory is the",
  "// container's /workspace, which the world resolves to this directory on the host.",
  'mkdirSync("runtime", { recursive: true });',
  'writeFileSync("runtime/ready", "listening on " + String(port) + "\\n");',
  "",
  "// A tick that does nothing, which is what keeps this process from exiting. There is no signal",
  "// handler: on Windows the world stops a container with taskkill, which is not a signal a process",
  "// can intercept, so a handler here would be code nothing could ever run.",
  "setInterval(() => {}, 60000);",
].join("\n");

/** The healthcheck. Read by the world, run once, at container start. Never a network probe. */
const HEALTH_SOURCE = [
  "// cart-web health: run by the world as the container healthcheck, once, when the container starts.",
  "//",
  "// It reads the line the service wrote and compares it with the port the container was given.",
  "// Nothing here opens a socket: this world publishes ports as mappings and binds none, so a",
  "// healthcheck that claimed to have connected to one would be claiming a measurement nobody took.",
  "//",
  "// It waits for the answer rather than reading once. The world runs this command exactly once, at",
  "// container start, and the service it asks about is a process the world has only just spawned -",
  "// so a single immediate read would be judging how quickly this machine starts two Node",
  "// processes, not whether the service came up. Waiting is what a healthcheck is for, and the",
  "// bound is what stops it waiting forever for a service that will never write the line.",
  'import { readFileSync } from "node:fs";',
  "",
  "const port = process.env.CART_WEB_PORT;",
  'const wanted = "listening on " + String(port);',
  "const deadline = Date.now() + 8000;",
  "const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
  "",
  'let seen = "(no file)";',
  "for (;;) {",
  "  try {",
  '    seen = readFileSync("runtime/ready", "utf8").trim();',
  "  } catch {",
  '    seen = "(no file)";',
  "  }",
  "  if (seen === wanted) process.exit(0);",
  "  if (Date.now() >= deadline) {",
  '    process.stderr.write("healthcheck: after 8s the service reports " + seen + "\\n");',
  "    process.exit(1);",
  "  }",
  "  sleep(50);",
  "}",
].join("\n");

/**
 * The second container's program. It reports the port it was given and exits, so the world has a
 * container with a real *exit code* rather than one that is still running.
 */
const CHECK_SOURCE = [
  "// cart-check: a second container from the same image, whose command returns.",
  "//",
  "// It exists so that the contract can ask for an exit code at all: a container whose process is",
  "// still alive has no exit code, and the family reports that question as inconclusive rather than",
  "// fabricating a zero.",
  'const port = process.env.CART_WEB_PORT ?? "unset";',
  'process.stdout.write("cart-check: port " + String(port) + "\\n");',
  "process.exit(0);",
].join("\n");

/**
 * The program the criterion's own command runs inside the running container.
 *
 * A criterion that issues a command is asking what the *world* did, so this program is deliberately
 * unremarkable: it prints one line the criterion can find in the container's stdout and exits 0.
 */
const AUDIT_SOURCE = [
  "// cart-audit: run inside the running container by a criterion's own command, not by the service.",
  'process.stdout.write("cart-audit: ok\\n");',
  "process.exit(0);",
].join("\n");

/**
 * The build instructions.
 *
 * The world copies the whole build context into the image, so a selection instruction (`COPY`, `ADD`)
 * and a build-time command (`RUN`) are refused by name rather than ignored. What is left is exactly
 * what a substitution of this shape can honour: where the program runs, what it is told, which ports
 * it declares, what it is labelled, which account it declares, and what it runs.
 */
const DOCKERFILE = [
  "FROM node:22-alpine",
  "WORKDIR " + WORKSPACE,
  "ENV NODE_ENV=production",
  "ENV CART_WEB_PORT=" + String(PORT),
  "ENV CART_WEB_HEALTH_TOKEN=" + HEALTH_TOKEN,
  "EXPOSE " + String(PORT),
  "LABEL org.opencontainers.image.title=" + APPLICATION,
  "LABEL org.opencontainers.image.version=1.0.0",
  "USER " + SERVICE_ACCOUNT,
  'CMD ["node",' + JSON.stringify(SERVICE_PROGRAM) + "]",
].join("\n");

// ---- what the application sends, in order ---------------------------------------------------------
//
// Every vector is the world's own command grammar: a verb, a noun, the flags that take a value, then
// the subject. Flags come before the subject, because that is where the world reads them, and for
// `container create` everything after the image reference is the command the container runs.

const COMMANDS = [
  // The one vector this world refuses. A provisioning program that shipped its own base image would
  // still ask for it first, and this runtime has no registry - so the refusal is part of the
  // application's own story rather than something only a criterion can provoke, and a criterion can
  // read it as a `container.call` record because the vector really was sent.
  ["image", "pull", "node:22-alpine"],
  ["image", "build", "-t", IMAGE, BUILD_CONTEXT],
  ["image", "tag", IMAGE, IMAGE_LATEST],
  ["image", "inspect", IMAGE_LATEST],
  ["volume", "create", STATE_VOLUME],
  [
    "container", "create",
    "--name", APPLICATION,
    "-v", BUILD_CONTEXT + ":" + WORKSPACE,
    "-v", STATE_VOLUME + ":" + STATE_PATH,
    "-p", PUBLISH,
    "-e", "CART_WEB_PORT=" + String(PORT),
    "--health-cmd", JSON.stringify(["node", HEALTH_PROGRAM]),
    "--health-interval", String(HEALTH_INTERVAL),
    "--memory", MEMORY,
    "--cpus", CPUS,
    "--pids-limit", PIDS,
    "-l", "app=" + APPLICATION,
    IMAGE,
  ],
  ["container", "start", APPLICATION],
  ["container", "inspect", APPLICATION],
  ["container", "logs", APPLICATION],
  [
    "container", "create",
    "--name", "cart-check",
    "-v", BUILD_CONTEXT + ":" + WORKSPACE,
    "--memory", "128m",
    IMAGE,
    "node", CHECK_PROGRAM,
  ],
  ["container", "start", "cart-check"],
  ["container", "wait", "cart-check"],
  ["container", "inspect", "cart-check"],
];

/** How many files this file installs into the build context. Counted from the list, not declared. */
const INSTALLED = [SERVICE_PROGRAM, HEALTH_PROGRAM, CHECK_PROGRAM, AUDIT_PROGRAM];

// ---- the program ----------------------------------------------------------------------------------

/** Everything a human reads goes here. stdout is a command channel and holds nothing else. */
const say = (line) => {
  process.stderr.write(line + "\n");
};

/** Where this file installs the build context: the directory beside it, resolved from the module. */
const contextDir = join(dirname(fileURLToPath(import.meta.url)), "context");

/**
 * The required variable, or the reason it is missing.
 *
 * All four are required rather than defaulted, because a program that invented a workspace path would
 * be describing a container it was not told about - and the world declares all four before it starts
 * anything, so a missing one is an interface that moved rather than an optional convenience.
 */
const required = (name) => {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
};

async function main() {
  const sandbox = required(CONTAINER_ENV.sandbox);
  const workspace = required(CONTAINER_ENV.workspace);
  const runtime = required(CONTAINER_ENV.runtime);
  const platform = required(CONTAINER_ENV.platform);
  const missing = [
    [CONTAINER_ENV.sandbox, sandbox],
    [CONTAINER_ENV.workspace, workspace],
    [CONTAINER_ENV.runtime, runtime],
    [CONTAINER_ENV.platform, platform],
  ]
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (missing.length > 0) {
    say(APPLICATION + ": this program is not being run by a container world. It needs " + missing.join(", ") + ".");
    return 2;
  }

  // The refusal is *by name* and before anything is written, which is the same shape `sim-os` uses for
  // a Windows world: a program that adapted to the wrong family instead of refusing it would provision
  // a system nobody asked for and would report success for it.
  if (platform !== "linux") {
    say(APPLICATION + ": this program provisions a linux container, and the world declares " + JSON.stringify(platform) + ".");
    say("It refuses that platform rather than adapting to it: a contract about /workspace and `srv/cart` is a");
    say("contract about a linux container, and provisioning a different family would satisfy none of it.");
    return 2;
  }
  if (workspace !== WORKSPACE) {
    say(APPLICATION + ": this program writes a layout rooted at " + WORKSPACE + ", and the world declares " + JSON.stringify(workspace) + ".");
    return 2;
  }

  say(APPLICATION + ": provisioning " + runtime + " on " + platform + ", judged as " + SERVICE_ACCOUNT + ".");
  say(APPLICATION + ": the world keeps its own files at " + sandbox + " - reported, never used as a container path.");

  // Cleared first. The world rebuilds its sandbox on every reset and removes its own directory tree,
  // but this context lives beside this file rather than inside the sandbox, so it is this program's
  // job to make the directory a run of this program built rather than one it inherited.
  rmSync(contextDir, { recursive: true, force: true });
  mkdirSync(join(contextDir, "srv", "cart"), { recursive: true });

  writeFileSync(join(contextDir, "Dockerfile"), DOCKERFILE + "\n");
  writeFileSync(join(contextDir, ...SERVICE_PROGRAM.split("/")), SERVICE_SOURCE + "\n");
  writeFileSync(join(contextDir, ...HEALTH_PROGRAM.split("/")), HEALTH_SOURCE + "\n");
  writeFileSync(join(contextDir, ...CHECK_PROGRAM.split("/")), CHECK_SOURCE + "\n");
  writeFileSync(join(contextDir, ...AUDIT_PROGRAM.split("/")), AUDIT_SOURCE + "\n");

  for (const argv of COMMANDS) {
    process.stdout.write(JSON.stringify(argv) + "\n");
  }

  // The completeness line. It names both counts, and both are read off the arrays above rather than
  // restated: a count in prose drifts, and a readiness line that announced a number nothing derived
  // would be the first place a reader stopped trusting this file.
  say(APPLICATION + " provisioned: " + String(INSTALLED.length) + " files, " + String(COMMANDS.length) + " commands");
  return 0;
}

process.exitCode = await main();
