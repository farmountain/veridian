/**
 * The substitute's own tests.
 *
 * `sim-container`'s whole subject is a world nobody can inspect by looking at it: images, containers,
 * mounts, ports, resources and logs are held in memory behind a register of nineteen actions, and every
 * verdict a demo reaches goes through this file's subject. Before this suite existed, the four
 * functions that decide *whether a container exists*, *which filesystem a path belongs to*, *what a
 * command did* and *what a reset clears* were exercised only end to end, by one demo, through one
 * contract - a verdict path reachable only through one happy path is a path whose failure modes are
 * untested.
 *
 * Two rules shaped the cases below, and both are this repository's, not this file's:
 *
 * - **A read must not mutate the record it reads.** A substitute control plane once recorded an event
 *   *inside* the derivation of its snapshot, so reading twice produced two different worlds and M1 -
 *   which compares exactly these documents - would have called one world two. `read()` is asserted to be
 *   `deepEqual` against itself here for that reason.
 * - **A reset restores the world; it does not restore the record.** `reset()` is asserted to clear the
 *   resources and to keep the call and escape records, because erasing a crossing would destroy the
 *   evidence of a safety violation with the very act of repairing the world it happened in.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { containerPort, CONTAINER_VALUE_FLAGS, SIM_RUNTIME_VERSION } from "./container-port.ts";
import type { ContainerPort } from "./container-port.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../../core/process.ts";

// ---- harness ----------------------------------------------------------------------------------

interface Answer {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  /**
   * Whether the child exits on its own.
   *
   * `true` by default, because a command this world runs *inside* a container is awaited to completion
   * and a container's own start is not: a web server runs until it is stopped. Setting `false` for the
   * container's own process is what makes `state: "running"` and `alive: true` mean something in the
   * cases below rather than being a race against a resolved promise.
   */
  readonly exits?: boolean;
}

interface Recorder {
  readonly runner: ProcessRunner;
  /** Every request in order, so a case can assert *what* this world ran, not only that it ran it. */
  readonly seen: ProcessRequest[];
}

function recorder(answer: (request: ProcessRequest) => Answer = () => ({})): Recorder {
  const seen: ProcessRequest[] = [];
  const runner: ProcessRunner = {
    run(request: ProcessRequest) {
      seen.push(request);
      const outcome = answer(request);
      const stdout = outcome.stdout ?? "";
      const stderr = outcome.stderr ?? "";
      if (stdout !== "") request.onStdout?.(stdout);
      if (stderr !== "") request.onStderr?.(stderr);
      const settled: ProcessResult = { code: outcome.code ?? 0, signal: null, stdout, stderr, timedOut: false };
      // A child that exits settles its own promise; one that does not is settled by `stop()`. Both are
      // real shapes - a server and a one-shot command - and the difference is what a case chooses.
      let release: () => void = () => undefined;
      const exited = new Promise<ProcessResult>((settle) => {
        release = () => settle(settled);
      });
      if (outcome.exits !== false) release();
      return {
        pid: 4242,
        exited,
        output: () => stdout,
        error: () => stderr,
        write: () => undefined,
        waitForPattern: async () => true,
        stop: async () => release(),
      };
    },
  };
  return { runner, seen };
}

/** The world's own record of what happened, spelled once so every case joins it the same way. */
async function withWorld(
  body: (world: {
    readonly port: ContainerPort;
    readonly root: string;
    readonly context: string;
    readonly recorder: Recorder;
  }) => Promise<void>,
  answer?: (request: ProcessRequest) => Answer,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "veridian-container-"));
  const root = join(base, "sandbox");
  const context = join(base, "app");
  await mkdir(context, { recursive: true });
  const made = recorder(answer);
  const port = containerPort({
    root,
    contextRoot: context,
    runtime: "docker",
    platform: "linux",
    processes: made.runner,
  });
  try {
    await body({ port, root, context, recorder: made });
  } finally {
    await port.stop();
    await rm(base, { recursive: true, force: true });
  }
}

const DOCKERFILE = [
  "FROM node:22",
  "WORKDIR /srv",
  "ENV CART_PORT=8080",
  "EXPOSE 8080",
  "LABEL org.example.role=web",
  "USER node",
  'CMD ["node", "server.mjs"]',
  "",
].join("\n");

/** A build context the world can really walk, hash and copy. Returns its name, relative to the app dir. */
async function buildContext(
  context: string,
  options: { readonly dockerfile?: string; readonly files?: readonly string[] } = {},
): Promise<string> {
  const name = "image";
  await mkdir(join(context, name), { recursive: true });
  await writeFile(join(context, name, "Dockerfile"), options.dockerfile ?? DOCKERFILE, "utf8");
  await writeFile(join(context, name, "index.html"), "<h1>cart</h1>\n", "utf8");
  for (const file of options.files ?? []) {
    await mkdir(join(context, name, ...file.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(context, name, ...file.split("/")), `// ${file}\n`, "utf8");
  }
  return name;
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

/** One turn of the event loop, so an exit listener registered on an already-settled promise has run. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

// ---- the register -----------------------------------------------------------------------------

describe("sim-container: the register and its refusals", () => {
  it("records an action the register does not hold as null rather than under the nearest name", async () => {
    await withWorld(async ({ port }) => {
      // `container prune` is a real engine's command and is not one of this world's nineteen. The
      // vocabulary is closed, so recording it under `container.remove` would assert a call this world
      // was never asked to make - and dropping it would leave a contract unable to observe the
      // refusal, which is the observation a contract about a substitute most needs to make.
      const record = await port.exec({ argv: ["container", "prune", "-f"], client: "provisioner" });
      assert.equal(record.action, null);
      assert.equal(record.result, "refused");
      assert.match(String(record.reason), /normalises to no action/);
      // The refusal names the register, so a reader learns what this world *does* answer.
      assert.match(String(record.reason), /container\.create/);
      assert.match(String(record.reason), /runtime\.info/);
    });
  });

  it("refuses an unknown flag naming the flags it does answer", async () => {
    await withWorld(async ({ port }) => {
      const record = await port.exec({
        argv: ["container", "create", "--privileged", "cart"],
        client: "provisioner",
      });
      assert.equal(record.result, "refused");
      assert.match(String(record.reason), /--privileged/);
      assert.match(String(record.reason), /--name/);
    });
  });

  it("holds the register's flag grammar to what the adapter exports", async () => {
    // The exported sets are the register's own grammar, so this is a measurement of the code rather
    // than of a document beside it. A flag added to one list and not the other is a command the world
    // refuses for a reason nobody wrote down.
    assert.deepEqual(CONTAINER_VALUE_FLAGS.build, ["-t", "--tag", "-f", "--file"]);
    assert.ok(CONTAINER_VALUE_FLAGS.create.includes("--name"));
    assert.ok(CONTAINER_VALUE_FLAGS.create.includes("--health-cmd"));
    // Every flag takes a value, which is what makes the parser's refusal message true.
    for (const flag of CONTAINER_VALUE_FLAGS.create) assert.match(flag, /^-/);
  });

  it("answers the runtime's own identity and refuses every pull", async () => {
    await withWorld(async ({ port }) => {
      const info = await port.exec({ argv: ["runtime", "info"], client: "criterion" });
      assert.equal(info.result, "answered");

      // A world with no registry and no outbound socket cannot pull, and saying so is the observation a
      // criterion about "this image came from elsewhere" needs. Refusing is not a shortcoming here: it
      // is the substitution being honest about which half of an engine it stands in for.
      const pull = await port.exec({ argv: ["image", "pull", "node:22"], client: "provisioner" });
      assert.equal(pull.result, "refused");
      assert.match(String(pull.reason), /no registry/);
      assert.match(String(pull.reason), /node:22/);
    });
  });
});

// ---- the store --------------------------------------------------------------------------------

describe("sim-container: images are built from a context this machine holds", () => {
  it("reads the Dockerfile and records what the image really declares", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      const record = await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      assert.equal(record.result, "answered", String(record.reason));

      const reading = await port.read();
      assert.equal(reading.images.length, 1);
      const image = reading.images[0];
      assert.ok(image !== undefined);
      assert.deepEqual(image.tags, ["cart-web:1"]);
      assert.deepEqual(image.cmd, ["node", "server.mjs"]);
      assert.equal(image.workingDir, "/srv");
      assert.equal(image.user, "node");
      assert.equal(image.env["CART_PORT"], "8080");
      assert.deepEqual(image.exposedPorts, [8080]);
      assert.equal(image.labels["org.example.role"], "web");
      // The image's own platform is the world's, because this world stands in for one platform's
      // containers and an image that claimed another would be a claim the substitution cannot support.
      assert.equal(image.os, "linux");
    });
  });

  it("copies the context into the image's root filesystem for real", async () => {
    await withWorld(async ({ port, context, root }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });

      const reading = await port.read();
      const id = reading.images[0]?.id ?? "";
      const copied = join(root, "store", "images", id.replace(":", "-"), "rootfs", "index.html");
      assert.equal(await readFile(copied, "utf8"), "<h1>cart</h1>\n");
    });
  });

  it("digests the context's paths beside its bytes", async () => {
    await withWorld(async ({ port, context, root }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const first = (await port.read()).images[0]?.digest ?? "";
      assert.match(first, /^[0-9a-f]{64}$/);

      // Renaming a file changes the digest, which is the property that makes "this tag points at the
      // code we just built" checkable rather than decorative. Without the path in the hash, a renamed
      // file would produce the same image - and a criterion about which file was shipped would pass.
      const rootfs = join(root, "store", "images", "unused");
      assert.equal(await exists(rootfs), false);
      await writeFile(join(context, built, "extra.mjs"), "// extra\n", "utf8");
      await port.exec({ argv: ["image", "build", "-t", "cart-web:2", built], client: "provisioner" });
      const second = (await port.read()).images.find((image) => image.tags.includes("cart-web:2"))?.digest ?? "";
      assert.notEqual(second, first);
    });
  });

  it("refuses a build with no tag and a context outside this world", async () => {
    await withWorld(async ({ port, context }) => {
      const untagged = await port.exec({ argv: ["image", "build", "image"], client: "provisioner" });
      assert.equal(untagged.result, "refused");
      assert.match(String(untagged.reason), /-t <tag>/);

      await buildContext(context);
      const outside = await port.exec({
        argv: ["image", "build", "-t", "x:1", join(context, "..", "..", "elsewhere")],
        client: "provisioner",
      });
      assert.equal(outside.result, "refused");
      // The refusal names *both* places a host path may be, because that is the rule it applied.
      assert.match(String(outside.reason), /outside the application directory/);
      assert.match(String(outside.reason), /outside this world's sandbox/);
    });
  });

  it("refuses the instructions it does not perform, naming them", async () => {
    await withWorld(async ({ port, context }) => {
      const withCopy = await buildContext(context, {
        dockerfile: "FROM node:22\nCOPY . /srv\nCMD [\"node\", \"server.mjs\"]\n",
      });
      const refused = await port.exec({ argv: ["image", "build", "-t", "x:1", withCopy], client: "provisioner" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /COPY/);
      assert.match(String(refused.reason), /context is copied into the image whole/);
    });
  });

  it("refuses a Dockerfile that spells a container path the host's way", async () => {
    await withWorld(async ({ port, context }) => {
      const windowsPath = await buildContext(context, {
        dockerfile: "FROM node:22\nWORKDIR C:\\srv\nCMD [\"node\", \"server.mjs\"]\n",
      });
      const refused = await port.exec({ argv: ["image", "build", "-t", "x:1", windowsPath], client: "provisioner" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /backslash/);
      assert.match(String(refused.reason), /separate with a slash/);
    });
  });

  it("refuses to remove an image a container was created from", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });

      const refused = await port.exec({ argv: ["image", "remove", "cart-web:1"], client: "provisioner" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /created from/);
      // And the image is still there, so the refusal is a refusal rather than a half-done removal.
      assert.equal((await port.read()).images.length, 1);
    });
  });
});

// ---- the two filesystems ----------------------------------------------------------------------

describe("sim-container: a host path and a container path are not the same path", () => {
  it("tells a bind mount from a named volume by the rule a real engine uses", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await mkdir(join(context, "html"), { recursive: true });
      await port.exec({
        argv: [
          "container", "create", "--name", "cart",
          "-v", "./html:/workspace",
          "-v", "cart-data:/var/lib/cart",
          "cart-web:1",
        ],
        client: "provisioner",
      });

      const instance = (await port.read()).containers[0];
      assert.ok(instance !== undefined);
      assert.deepEqual(
        instance.mounts.map((mount) => [mount.kind, mount.source, mount.destination, mount.sourceExists]),
        [
          ["bind", "./html", "/workspace", true],
          ["volume", "cart-data", "/var/lib/cart", true],
        ],
      );
    });
  });

  it("reports a bind source that does not exist rather than creating it", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      // The misspelling is the defect this is here for: a real engine does *create* a missing bind
      // source in some configurations, and a world that did would make the defect invisible by
      // supplying the directory the application meant to ship.
      await port.exec({
        argv: ["container", "create", "--name", "cart", "-v", "./hmtl:/workspace", "cart-web:1"],
        client: "provisioner",
      });
      const instance = (await port.read()).containers[0];
      assert.equal(instance?.mounts[0]?.sourceExists, false);
    });
  });

  it("refuses a mount destination that is not a container path", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const refused = await port.exec({
        argv: ["container", "create", "--name", "cart", "-v", "./html:html", "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /destination has to start with/);
    });
  });

  it("refuses a mount mode it does not read", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const refused = await port.exec({
        argv: ["container", "create", "--name", "cart", "-v", "./html:/workspace:cached", "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /reads `ro` and `rw`/);
    });
  });

  it("resolves a container path through the longest mount, on whole segments", async () => {
    await withWorld(async ({ port, context, root }) => {
      // The image's own root filesystem holds `index.html` and no `database`. `html/database` is made
      // here, in the build context, and the mount points at `./html`. A rule that matched the mount's
      // destination as a *prefix* would therefore resolve `/database` through the mount at `/data` and
      // find a directory; a rule that matches on whole segments resolves it on the image and does not.
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await mkdir(join(context, "html", "database"), { recursive: true });

      // `/data/database` is captured by the mount at `/data`.
      const mounted = await port.exec({
        argv: [
          "container", "create", "--name", "in", "-v", "./html:/data",
          "-w", "/data/database", "cart-web:1",
        ],
        client: "provisioner",
      });
      assert.equal(mounted.result, "answered", String(mounted.reason));
      const started = await port.exec({ argv: ["container", "start", "in"], client: "provisioner" });
      assert.equal(started.result, "answered", String(started.reason));

      // `/database` must **not** be captured by the mount at `/data`. A prefix test on the string alone
      // would capture it, and the container would silently read a directory its mount never named -
      // which is the defect a whole-segment match exists to make impossible.
      const wrong = await port.exec({
        argv: [
          "container", "create", "--name", "out", "-v", "./html:/data",
          "-w", "/database", "cart-web:1",
        ],
        client: "provisioner",
      });
      assert.equal(wrong.result, "answered", String(wrong.reason));
      const refused = await port.exec({ argv: ["container", "start", "out"], client: "provisioner" });
      assert.equal(refused.result, "refused");
      // The refusal names the path it looked in, and that path is inside the image - not the mount.
      const rootfs = join(root, "store", "images");
      assert.ok(String(refused.reason).startsWith(`\`out\`'s working directory /database is not a directory`));
      assert.ok(String(refused.reason).includes(rootfs), String(refused.reason));
      assert.ok(!String(refused.reason).includes(join(context, "html")), String(refused.reason));
    });
  });

  it("refuses a bind mount outside this world and records who named it", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const outside = join(context, "..", "..", "secrets");

      const byApplication = await port.exec({
        argv: ["container", "create", "--name", "cart", "-v", `${outside}:/secrets`, "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(byApplication.result, "refused");
      // The *cause* is asserted, not only the status. The first version of this world refused this
      // exact command for a reason that had nothing to do with the boundary - it read the colon in the
      // drive path as the flag's own separator and complained about a mount mode nobody wrote - so a
      // status-only assertion passed while the guard it exists to exercise was never reached.
      assert.match(String(byApplication.reason), /outside this world's sandbox/);
      const byCriterion = await port.exec({
        argv: ["image", "build", "-t", "x:1", outside],
        client: "criterion",
      });
      assert.equal(byCriterion.result, "refused");

      // The two parties are reported distinctly, and that is the whole reason the client is carried on
      // the record: the application's escape is a safety event the run fails on, and a criterion's is a
      // reading - an operator owns that document and already holds those privileges, so a run whose
      // contract probes this guard has to be able to pass.
      assert.deepEqual(
        port.escapes().map((escape) => escape.client),
        ["provisioner", "criterion"],
      );
      assert.equal(port.escapes()[0]?.spelled, outside);
    });
  });
});

// ---- ports and resources ----------------------------------------------------------------------

describe("sim-container: what a published port does and does not claim", () => {
  it("separates an exposed port from a published one, and never claims reachability", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
      await port.exec({
        argv: ["container", "create", "--name", "shop", "-p", "9090:8080", "cart-web:1"],
        client: "provisioner",
      });

      const reading = await port.read();
      const cart = reading.containers.find((entry) => entry.name === "cart");
      const shop = reading.containers.find((entry) => entry.name === "shop");

      // The image EXPOSEs 8080, so the port is in the map whether or not anyone published it.
      assert.deepEqual(cart?.ports, [
        { containerPort: 8080, protocol: "tcp", hostPort: null, hostIp: "0.0.0.0", exposed: true, published: false },
      ]);
      assert.deepEqual(shop?.ports, [
        { containerPort: 8080, protocol: "tcp", hostPort: 9090, hostIp: "0.0.0.0", exposed: true, published: true },
      ]);
      // The field that must not exist. `reachable` would be an arithmetic this world performed on
      // behalf of a network it does not have, and a criterion judging it would be judging nothing.
      assert.ok(!Object.hasOwn(shop?.ports[0] ?? {}, "reachable"));
    });
  });

  it("refuses a protocol and a port it cannot read", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const protocol = await port.exec({
        argv: ["container", "create", "--name", "a", "-p", "80:80/sctp", "cart-web:1"],
        client: "provisioner",
      });
      assert.match(String(protocol.reason), /reads tcp and udp/);

      const port_ = await port.exec({
        argv: ["container", "create", "--name", "b", "-p", "eight", "cart-web:1"],
        client: "provisioner",
      });
      assert.match(String(port_.reason), /does not name a container port/);
    });
  });

  it("records a resource limit as read, and always reports it unenforced", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({
        argv: [
          "container", "create", "--name", "cart",
          "--memory", "128m", "--memory-reservation", "64m",
          "--cpus", "0.5", "--pids-limit", "64",
          "cart-web:1",
        ],
        client: "provisioner",
      });
      const instance = (await port.read()).containers[0];
      assert.deepEqual(instance?.resources, {
        memoryBytes: 128 * 1024 * 1024,
        memoryReservationBytes: 64 * 1024 * 1024,
        cpus: 0.5,
        pidsLimit: 64,
        // Declared and *not* enforced, which is the honest reading: this world has no cgroup, so it
        // reports the limits it was given and says plainly that nothing is holding them.
        enforced: false,
      });
    });
  });

  it("refuses a size and a count it cannot parse", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const memory = await port.exec({
        argv: ["container", "create", "--name", "a", "--memory", "lots", "cart-web:1"],
        client: "provisioner",
      });
      assert.match(String(memory.reason), /is not a size/);

      const pids = await port.exec({
        argv: ["container", "create", "--name", "b", "--pids-limit", "many", "cart-web:1"],
        client: "provisioner",
      });
      assert.match(String(pids.reason), /is not a number/);
    });
  });

  it("refuses a restart policy it does not read", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const refused = await port.exec({
        argv: ["container", "create", "--name", "cart", "--restart", "unless-stopped", "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /it reads no, always and on-failure/);
    });
  });
});

// ---- running ----------------------------------------------------------------------------------

describe("sim-container: a container really runs", () => {
  it("runs the image's command as a real child, in the container's working directory", async () => {
    await withWorld(
      async ({ port, context, root, recorder }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        const id = (await port.read()).images[0]?.id ?? "";
        await port.exec({
          argv: ["container", "create", "--name", "cart", "-e", "CART_MODE=serve", "cart-web:1"],
          client: "provisioner",
        });
        const started = await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });
        assert.equal(started.result, "answered", String(started.reason));

        const instance = (await port.read()).containers[0];
        assert.equal(instance?.state, "running");
        assert.equal(instance?.alive, true);
        assert.equal(instance?.env["CART_MODE"], "serve");
        // The image's ENV survived the create-time override rather than being replaced by it.
        assert.equal(instance?.env["CART_PORT"], "8080");

        // What this world really ran, and where. A container's process is the image's CMD in a
        // directory resolved through the overlay onto the image's own root filesystem - which is the
        // *copy* the build made inside the sandbox, not the build context the image came from. A
        // substitute that ran a container out of the operator's source tree would be reading the one
        // directory it is not allowed to touch.
        const spawned = recorder.seen[recorder.seen.length - 1];
        assert.deepEqual(spawned?.args, ["server.mjs"]);
        assert.equal(spawned?.cwd, join(root, "store", "images", id.replace(":", "-"), "rootfs", "srv"));
        assert.ok(!String(spawned?.cwd).startsWith(context), String(spawned?.cwd));
      },
      (request) => (request.args[0] === "server.mjs" ? { stdout: "listening on 8080\n", exits: false } : {}),
    );
  });

  it("keeps the real bytes a container wrote, bounded by characters rather than by lines", async () => {
    // A bound by lines is not a bound: a program that prints one enormous line would put all of it in
    // the reading. The bound is on characters, and `truncated` says something was dropped so a reader
    // is told rather than left to guess.
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

        const log = (await port.read()).logs[0];
        assert.equal(log?.truncated, true);
        assert.ok((log?.stdout.length ?? 0) <= 64 * 1024);
        // The *tail* is what survives, because that is where a failure states its cause.
        assert.ok((log?.stdout ?? "").endsWith("END-OF-LINE"));
        // And the byte count is what was really written, not what was kept.
        assert.ok((log?.stdoutBytes ?? 0) > (log?.stdout.length ?? 0));
      },
      () => ({ stdout: `x${"y".repeat(100_000)}END-OF-LINE`, exits: false }),
    );
  });

  it("runs a command inside a running container and reports the command's own exit code", async () => {
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

        const ok = await port.exec({
          argv: ["container", "exec", "cart", "--", "node", "-v"],
          client: "criterion",
        });
        assert.equal(ok.result, "answered");
        assert.equal(ok.status, 0);

        // A command that ran and answered non-zero is a *reading* a criterion may judge, not a command
        // this world failed to perform - so the result stays `answered` and the exit code is in the
        // reason. Collapsing the two would turn an application defect into an infrastructure one.
        const bad = await port.exec({
          argv: ["container", "exec", "cart", "--", "node", "missing.mjs"],
          client: "criterion",
        });
        assert.equal(bad.result, "answered");
        assert.match(String(bad.reason), /exited with code 7/);
      },
      (request) => {
        // The container's own process is a server: it stays up, or `exec` would be refused for a
        // container that had already exited and the case would be testing the wrong refusal.
        if (request.args[0] === "server.mjs") return { exits: false };
        return request.args.includes("missing.mjs") ? { code: 7, stderr: "MODULE_NOT_FOUND\n" } : {};
      },
    );
  });

  it("refuses to exec into a container that is not running", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
      const refused = await port.exec({ argv: ["container", "exec", "cart", "--", "node", "-v"], client: "criterion" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /is created; a real engine refuses to exec/);
    });
  });

  it("refuses a start whose working directory is not in the container's filesystem", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const created = await port.exec({
        argv: ["container", "create", "--name", "cart", "-w", "/nowhere", "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(created.result, "answered", String(created.reason));
      const refused = await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /will not start a process in a directory that does not exist/);
    });
  });

  it("refuses a start whose bind source is missing, as a real engine does", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({
        argv: ["container", "create", "--name", "cart", "-v", "./hmtl:/workspace", "cart-web:1"],
        client: "provisioner",
      });
      const refused = await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /this machine holds no directory there/);
    });
  });

  it("runs a health command for real once, and remembers what it answered", async () => {
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({
          argv: [
            "container", "create", "--name", "cart",
            "--health-cmd", '["node","health.mjs"]', "--health-interval", "5",
            "cart-web:1",
          ],
          client: "provisioner",
        });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

        const health = (await port.read()).containers[0]?.health;
        assert.deepEqual(health, {
          command: ["node", "health.mjs"],
          state: "healthy",
          exitCode: 0,
          attempts: 1,
          intervalSeconds: 5,
        });
      },
      (request) => (request.args.includes("health.mjs") ? { code: 0 } : { stdout: "", exits: false }),
    );
  });

  it("refuses a health command that is not an argument vector, naming the missing shell", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      const refused = await port.exec({
        argv: ["container", "create", "--name", "cart", "--health-cmd", "node health.mjs", "cart-web:1"],
        client: "provisioner",
      });
      assert.equal(refused.result, "refused");
      assert.match(String(refused.reason), /has no shell/);
    });
  });

  it("refuses to stop what is not running and to remove what is", async () => {
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });

        const stop = await port.exec({ argv: ["container", "stop", "cart"], client: "provisioner" });
        assert.equal(stop.result, "refused");
        assert.match(String(stop.reason), /is not running/);

        const remove = await port.exec({ argv: ["container", "remove", "cart"], client: "provisioner" });
        assert.equal(remove.result, "answered", String(remove.reason));
        assert.equal((await port.read()).containers.length, 0);
      },
      () => ({ exits: false }),
    );
  });

  it("refuses to remove a container that is running", async () => {
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

        const refused = await port.exec({ argv: ["container", "remove", "cart"], client: "provisioner" });
        assert.equal(refused.result, "refused");
        assert.match(String(refused.reason), /refuses to remove it without a force/);
      },
      () => ({ exits: false }),
    );
  });

  it("settles a stopped container's fate from its exit, not from the reading", async () => {
    await withWorld(
      async ({ port, context }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });
        assert.equal((await port.read()).containers[0]?.state, "running");

        await port.exec({ argv: ["container", "stop", "cart"], client: "provisioner" });
        await settle();
        const stopped = (await port.read()).containers[0];
        assert.equal(stopped?.state, "exited");
        assert.equal(stopped?.alive, false);
      },
      () => ({ code: 3, exits: false }),
    );
  });

  it("reports a wait that never settled as a failure rather than holding the run open", async () => {
    // Ten milliseconds, so the case is a boundary rather than a wait. This is the branch that keeps a
    // run from being unable to answer at all - a world that simply awaited the exit would hold the run
    // open forever behind a container that never stops, and `MAX_ITERATIONS` would report it as a
    // repair that never worked.
    const base = await mkdtemp(join(tmpdir(), "veridian-container-"));
    const context = join(base, "app");
    await mkdir(context, { recursive: true });
    const made = recorder(() => ({ exits: false }));
    const port = containerPort({
      root: join(base, "sandbox"),
      contextRoot: context,
      runtime: "docker",
      platform: "linux",
      processes: made.runner,
      defaultWaitMs: 10,
    });
    try {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
      await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

      const record = await port.exec({ argv: ["container", "wait", "cart"], client: "criterion" });
      assert.equal(record.result, "failed");
      assert.equal(record.status, 124);
      assert.match(String(record.reason), /had not exited after 10ms/);
      assert.match(String(record.reason), /stops waiting rather than holding/);
      // And the container is still there, because a bound on waiting is not a bound on the world.
      assert.equal((await port.read()).containers[0]?.state, "running");
    } finally {
      await port.stop();
      await rm(base, { recursive: true, force: true });
    }
  });

  it("answers a wait on a container that has already exited", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
      await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });
      await settle();
      const record = await port.exec({ argv: ["container", "wait", "cart"], client: "criterion" });
      assert.equal(record.result, "answered");
      assert.equal((await port.read()).containers[0]?.exitCode, 0);
    });
  });
});

// ---- lifecycle --------------------------------------------------------------------------------

describe("sim-container: reset restores the world and not the record", () => {
  it("reads the same document twice", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });

      // A read that recorded a call, advanced a counter or ran a health check would make these two
      // documents differ - and M1, which compares exactly these documents, would call one world two.
      const first = await port.read();
      const second = await port.read();
      assert.deepEqual(second, first);
      assert.equal(second.calls.length, 2);
    });
  });

  it("prepares a world a run built rather than one it inherited", async () => {
    await withWorld(async ({ port, root }) => {
      // `prepare()` and `reset()` share one implementation because `sim-posix` paid for two: its
      // `prepare()` made directories without clearing, so the next run's first iteration read a file
      // the previous run had left behind and two criteria reported `PASS` on someone else's artifact.
      await mkdir(join(root, "store", "images", "left", "rootfs"), { recursive: true });
      await writeFile(join(root, "leftover.txt"), "from an earlier run\n", "utf8");
      await port.prepare();

      assert.equal(await exists(join(root, "leftover.txt")), false);
      assert.equal(await exists(join(root, "store", "images", "left")), false);
      assert.equal(await exists(join(root, "store", "images")), true);
    });
  });

  it("clears the resources on reset and keeps the record of what was asked", async () => {
    await withWorld(async ({ port, context }) => {
      const built = await buildContext(context);
      await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
      await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
      await port.exec({ argv: ["volume", "create", "cart-data"], client: "provisioner" });
      const escape = await port.exec({
        argv: ["image", "build", "-t", "x:1", join(context, "..", "..", "out")],
        client: "provisioner",
      });
      assert.equal(escape.result, "refused");

      await port.reset();
      const after = await port.read();

      assert.equal(after.images.length, 0);
      assert.equal(after.containers.length, 0);
      assert.equal(after.logs.length, 0);
      // And the record survives, which is the half that would otherwise be a false pass: an iteration
      // that reached outside the boundary would be followed by a clean one, and the run would report
      // `PASS` with the evidence of the violation destroyed by the very act of repairing it.
      assert.equal(after.calls.length, 4);
      assert.equal(port.escapes().length, 1);
      assert.equal(port.escapes()[0]?.spelled, join(context, "..", "..", "out"));
    });
  });

  it("stops every child and leaves the sandbox in place", async () => {
    await withWorld(
      async ({ port, context, root }) => {
        const built = await buildContext(context);
        await port.exec({ argv: ["image", "build", "-t", "cart-web:1", built], client: "provisioner" });
        await port.exec({ argv: ["container", "create", "--name", "cart", "cart-web:1"], client: "provisioner" });
        await port.exec({ argv: ["container", "start", "cart"], client: "provisioner" });

        await port.stop();
        await settle();
        // The sandbox stays, because every artifact a bundle names lives under it and deleting it on
        // stop would leave a bundle describing a world that cannot be inspected afterwards.
        assert.equal(await exists(join(root, "store", "images")), true);
        const after = await port.read();
        assert.equal(after.containers[0]?.alive, false);
        assert.equal(after.images.length, 1);
      },
      () => ({ exits: false }),
    );
  });

  it("carries the runtime identity, this machine's shape, and every substituted surface", async () => {
    await withWorld(async ({ port, root }) => {
      const reading = await port.read();
      assert.equal(reading.runtime, "docker");
      assert.equal(reading.version, SIM_RUNTIME_VERSION);
      assert.equal(reading.os, "linux");
      assert.equal(reading.architecture, process.arch);
      assert.equal(reading.sandbox, root);
      // The declaration that this is not a real engine. Every surface a real runtime would provide and
      // this one stands in for is named here, so a reader can tell which parts of a reading are real
      // and which are the substitution - which is the one thing a simulated world is never allowed to
      // leave a reader to infer.
      assert.deepEqual([...reading.simulated].sort(), [
        "cgroups",
        "image-layers",
        "namespaces",
        "published-ports",
        "registry",
        "user-switching",
        "volumes",
      ]);
      // No container has run, so the world is empty rather than the counts absent. They are read off
      // the arrays the reading carries, because a second bookkeeper beside them is free to disagree
      // with the resources it is supposed to be counting.
      assert.deepEqual([reading.images.length, reading.containers.length], [0, 0]);
      assert.deepEqual([reading.logs.length, reading.calls.length], [0, 0]);
    });
  });

  it("names the volume it created and holds it in the store", async () => {
    await withWorld(async ({ port, root }) => {
      const created = await port.exec({ argv: ["volume", "create", "cart-data"], client: "provisioner" });
      assert.equal(created.result, "answered");
      assert.equal(created.resource, "cart-data");
      assert.equal(await exists(join(root, "store", "volumes", "cart-data")), true);
    });
  });
});
