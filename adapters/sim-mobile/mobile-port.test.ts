/**
 * The substitute's own tests.
 *
 * This file holds the properties the mobile world's port must have, and the first two are the ones
 * this repository has already paid for once each:
 *
 * - **A read must not mutate the record it reads.** A substitute control plane once recorded an event
 *   *inside* the derivation of its snapshot, so reading a namespace twice produced two documents and
 *   M1 - which compares exactly these readings - would have called one world two. `read()` is therefore
 *   asserted `deepEqual` against a second `read()`.
 * - **A reset restores the world, not the record.** `reset()` clears the store and keeps the call log
 *   and the escape tally, because an iteration that reached outside the boundary followed by a clean
 *   one must not report a `PASS` with an empty crossings list.
 *
 * The third is this world's own, and it is the reason the file exists rather than the demo alone: the
 * `bundle.launch` flags are the *client's* request and are recorded in the call record's `command`,
 * while the bundle reading's `command` is the vector the **install** declared. A first draft of the
 * port rewrote the second from the first, which is a reading of the run's own history wearing the
 * bundle's name.
 *
 * The double is a recording `ProcessRunner` rather than a real child, so the suite runs in
 * milliseconds and the *shape* of the request the world makes is inspectable - which process, with
 * which argv, in which directory. What a real child would add is covered by the demo, where
 * `bundle.launch` really starts the bundle's entry point.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { describe, it } from "node:test";

import {
  isMobileExecRequest,
  mobilePort,
  MOBILE_VALUE_FLAGS,
  SIM_DEVICE_NAME,
  SIM_DEVICE_VERSION,
} from "./mobile-port.ts";
import type { MobilePort } from "./mobile-port.ts";
import {
  isMobileAction,
  MOBILE_SIMULATED_SURFACES,
  permissionKey,
} from "../../core/environment/mobile-observation.ts";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../../core/process.ts";

// ---------------------------------------------------------------------------------------------
// The double
// ---------------------------------------------------------------------------------------------

/**
 * What the stand-in child does. `exits` defaults to `true`; a case that sets it `false` gets a process
 * that is still up when the launch deadline passes, which is what makes a *running* bundle a fact
 * rather than a race against a resolved promise.
 */
interface Answer {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exits?: boolean;
}

interface Recorder {
  readonly runner: ProcessRunner;
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
      const settled: ProcessResult = {
        code: outcome.code ?? 0,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
      };
      let release: () => void = () => undefined;
      const exited = new Promise<ProcessResult>((resolve) => {
        release = () => resolve(settled);
      });
      // A real child is an *active handle*: while one is up, this machine's event loop cannot drain.
      // The stand-in has to reproduce that, because the deadline it is raced against is deliberately
      // unref'd - a pending launch deadline must never be the thing holding a run open - so a double
      // whose `exited` promise has nothing behind it lets the loop resolve while the world is still
      // waiting, and Node then reports the launch as a promise that never settled and cancels every
      // test after it in the file. Which is how this file learned the rule: *a double that does not
      // reproduce the property the code under it depends on makes that path untestable.*
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      if (outcome.exits === false) {
        keepAlive = setInterval(() => undefined, 5);
      } else {
        release();
      }
      return {
        pid: 7331,
        exited,
        output: () => stdout,
        error: () => stderr,
        write: () => undefined,
        waitForPattern: async () => true,
        // No `confinement` member at all. The handle's is optional, and a stand-in that answered it
        // would be reporting a file allowance this world never measured - so the property is omitted
        // rather than filled with an `undefined` that had to be cast into place to compile.
        stop: async () => {
          if (keepAlive !== undefined) clearInterval(keepAlive);
          keepAlive = undefined;
          release();
        },
      };
    },
  };
  return { runner, seen };
}

/**
 * The entry at an index, asserted present.
 *
 * `noUncheckedIndexedAccess` makes every index a `T | undefined`, and the honest reading of that is
 * that the test should say which entry it meant rather than that the compiler should be silenced.
 */
function at<T>(items: readonly T[], index = 0): T {
  const found = items[index];
  assert.ok(found !== undefined, `expected an entry at index ${String(index)}`);
  return found;
}

/** The one entry, asserted to be the only one - which is the stronger claim where it holds. */
function theOnly<T>(items: readonly T[]): T {
  assert.equal(items.length, 1, `expected exactly one entry, found ${String(items.length)}`);
  return at(items);
}

interface World {
  readonly port: MobilePort;
  readonly root: string;
  readonly context: string;
  readonly recorder: Recorder;
}

interface Setup {
  readonly answer?: (request: ProcessRequest) => Answer;
  readonly launchMs?: number;
  readonly device?: string;
}

async function withWorld(body: (world: World) => Promise<void>, setup: Setup = {}): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "veridian-mobile-"));
  const root = join(base, "sandbox");
  const context = join(base, "app");
  await mkdir(context, { recursive: true });
  const made = recorder(setup.answer);
  const port = mobilePort({
    root,
    contextRoot: context,
    device: setup.device ?? "sim-cart-device",
    platform: "android",
    processes: made.runner,
    defaultLaunchMs: setup.launchMs,
  });
  try {
    await body({ port, root, context, recorder: made });
  } finally {
    await port.stop();
    await rm(base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** A bundle's source tree, written where a provisioner's own files would be. */
async function plantBundle(
  context: string,
  name: string,
  files: Readonly<Record<string, string>> = { "main.mjs": "// entry\n" },
): Promise<string> {
  const dir = join(context, name);
  await mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await writeFile(join(dir, file), body, "utf8");
  }
  return dir;
}

/**
 * A spelling that names a place outside *both* trees on either platform.
 *
 * It is derived from the application's own tree rather than written literally, and that is the whole
 * reason the helper exists. `D:/elsewhere/cart` is absolute on win32 and **relative** on POSIX, so on
 * ubuntu the port resolved it against the application's tree, found it inside, and answered it - a
 * correct reading of a spelling that means something else on that platform. The property under test is
 * "a path outside both directories is refused and recorded", and a spelling that leaves the world on
 * one platform only cannot test it. Measured, one line each way: `isAbsolute("D:/elsewhere/cart")` is
 * `true` under win32 semantics and `false` under posix semantics, and posix then resolves it to
 * `<appTree>/D:/elsewhere/cart`, which is inside the tree the world is allowed to open.
 *
 * This is the same defect class as a test asserting a file's line ending: *the property is not the
 * spelling, it is what the spelling means here*.
 */
const outsideBothTrees = (world: World): string => resolvePath(world.context, "..", "..", "elsewhere", "cart");

const boot = (port: MobilePort) => port.exec({ argv: ["device", "boot"], client: "provisioner" });

const install = (port: MobilePort, id: string, source: string, extra: readonly string[] = []) =>
  port.exec({ argv: ["bundle", "install", "--id", id, source, ...extra], client: "provisioner" });

const launch = (port: MobilePort, id: string, extra: readonly string[] = []) =>
  port.exec({ argv: ["bundle", "launch", id, ...extra], client: "criterion" });

const bundlesOf = async (port: MobilePort) => (await port.read()).bundles;

/** A booted device holding one installed bundle, which is the preamble most cases need. */
async function withCart(
  world: World,
  files?: Readonly<Record<string, string>>,
  extra: readonly string[] = [],
): Promise<void> {
  await world.port.prepare();
  await boot(world.port);
  const source = await plantBundle(world.context, "cart", files);
  const call = await install(world.port, "cart", source, extra);
  assert.equal(call.result, "answered", `the fixture bundle was not installed: ${String(call.reason)}`);
}

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

describe("the action register", () => {
  it("holds only actions the vocabulary names", () => {
    for (const action of Object.keys(MOBILE_VALUE_FLAGS)) {
      assert.ok(
        isMobileAction(action),
        `${action} is in the flag register and not in the action vocabulary`,
      );
    }
  });

  it("covers exactly the six actions that take a value, so a seventh has to be declared here", () => {
    assert.deepEqual(Object.keys(MOBILE_VALUE_FLAGS).sort(), [
      "bundle.install",
      "bundle.launch",
      "device.boot",
      "device.rotate",
      "keychain.set",
      "notification.post",
    ]);
  });

  it("accepts a well-formed request and rejects one that only looks like it", () => {
    assert.ok(isMobileExecRequest({ argv: ["device", "boot"], client: "criterion" }));
    assert.ok(!isMobileExecRequest({ argv: ["device", "boot"], client: 7 }));
    assert.ok(!isMobileExecRequest({ argv: "device boot", client: "criterion" }));
    assert.ok(!isMobileExecRequest({ client: "criterion" }));
    assert.ok(!isMobileExecRequest(null));
    assert.ok(!isMobileExecRequest("device.boot"));
  });
});

// ---------------------------------------------------------------------------------------------
// A request the world will not answer
// ---------------------------------------------------------------------------------------------

describe("a request the world does not answer", () => {
  it("refuses a vector naming no action, and the record names none rather than guessing one", async () => {
    await withWorld(async (world) => {
      const call = await world.port.exec({ argv: ["install", "cart"], client: "provisioner" });
      assert.equal(call.result, "refused");
      assert.equal(call.action, null);
      assert.equal(call.command, "install cart");
      assert.equal(call.resource, null);
      // The reason has to be readable, or a refusal is an observation nobody can act on.
      assert.ok((call.reason ?? "").length > 0);
    });
  });

  it("names the whole register in the refusal, so the reader learns the spelling that was wanted", async () => {
    await withWorld(async (world) => {
      const call = await world.port.exec({ argv: ["install", "cart"], client: "provisioner" });
      const reason = call.reason ?? "";
      for (const spelled of ["device.boot", "bundle.install", "keychain.list"]) {
        assert.ok(reason.includes(spelled), `the refusal does not name ${spelled}: ${reason}`);
      }
    });
  });

  it("refuses a vector with no words at all rather than throwing out of `exec`", async () => {
    await withWorld(async (world) => {
      const call = await world.port.exec({ argv: [], client: "provisioner" });
      assert.equal(call.result, "refused");
      assert.equal(call.action, null);
    });
  });

  it("records the client that asked, so `call` and `probe` are two different readings", async () => {
    await withWorld(async (world) => {
      await world.port.exec({ argv: ["device", "info"], client: "criterion" });
      await world.port.exec({ argv: ["device", "info"], client: "provisioner" });
      const reading = await world.port.read();
      assert.equal(at(reading.calls, 0).client, "criterion");
      assert.equal(at(reading.calls, 1).client, "provisioner");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Absent and refused are two different observations
// ---------------------------------------------------------------------------------------------

describe("a resource the world does not hold is absent, not refused", () => {
  it("answers absent for a bundle the device does not hold, and says so", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      await boot(world.port);
      const call = await launch(world.port, "ghost");
      assert.equal(call.result, "absent");
      assert.equal(call.status, 1);
      assert.ok((call.reason ?? "").length > 0);
    });
  });

  it("answers the same words once the bundle is really held", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await launch(world.port, "cart");
      assert.equal(call.result, "answered");
      assert.equal(call.status, 0);
      assert.equal(call.reason, null);
    });
  });

  it("answers absent for a link nothing registered, rather than refusing it", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await world.port.exec({
        argv: ["deepLink", "open", "veridian://cart/item"],
        client: "criterion",
      });
      assert.equal(call.result, "absent");
      assert.equal(call.status, 1);
      // A bundle is on the device and holds no links - so the resource is missing, not the request.
      assert.equal(theOnly(await bundlesOf(world.port)).deepLinks.length, 0);
    });
  });

  it("answers absent for a permission decision on a bundle the world does not hold", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const call = await world.port.exec({
        argv: ["permission", "grant", "ghost", "camera"],
        client: "provisioner",
      });
      assert.equal(call.result, "absent");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

describe("reading", () => {
  it("produces two identical documents and adds no record of its own", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await world.port.exec({ argv: ["notification", "post", "cart", "--title", "Ready"], client: "provisioner" });
      const first = await world.port.read();
      const second = await world.port.read();
      assert.deepEqual(second, first);
      // The count is the second of the two claims: a derivation that recorded an event would keep the
      // documents equal only until something compared a count inside them.
      assert.equal(second.world.notifications, 1);
      assert.equal(second.calls.length, first.calls.length);
    });
  });

  it("reports a sandbox this machine can open", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const reading = await world.port.read();
      assert.ok(isAbsolute(reading.sandbox), `the sandbox is not absolute: ${reading.sandbox}`);
      assert.equal((await stat(reading.sandbox)).isDirectory(), true);
      assert.equal(reading.sandbox, resolvePath(world.root));
    });
  });

  it("carries the substitution in the reading rather than in a note beside it", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const reading = await world.port.read();
      assert.deepEqual(reading.simulated, MOBILE_SIMULATED_SURFACES);
      assert.equal(reading.world.name, SIM_DEVICE_NAME);
      assert.equal(reading.world.version, SIM_DEVICE_VERSION);
      assert.equal(reading.world.bundles, 0);
      assert.equal(reading.world.launched, 0);
      assert.equal(reading.device, "sim-cart-device");
      assert.equal(reading.state.state, "off");
      assert.equal(reading.state.boots, 0);
      assert.equal(reading.state.platform, "android");
      assert.equal(reading.state.screen.drawn, false);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The device
// ---------------------------------------------------------------------------------------------

describe("the device", () => {
  it("counts a boot each time it is asked, and reads booted", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      assert.equal((await boot(world.port)).result, "answered");
      assert.equal((await boot(world.port)).result, "answered");
      const reading = await world.port.read();
      assert.equal(reading.state.state, "booted");
      assert.equal(reading.state.boots, 2);
    });
  });

  it("reads back the flags the boot was given, and defaults where none was", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const call = await world.port.exec({
        argv: [
          "device",
          "boot",
          "--model",
          "Cart Pixel",
          "--height",
          "1200",
          "--density",
          "380",
          "--api-level",
          "31",
          "--locale",
          "fr-FR",
        ],
        client: "provisioner",
      });
      assert.equal(call.result, "answered");
      const reading = await world.port.read();
      assert.equal(reading.state.model, "Cart Pixel");
      assert.equal(reading.state.screen.height, 1200);
      assert.equal(reading.state.screen.densityDpi, 380);
      assert.equal(reading.world.apiLevel, 31);
      assert.equal(reading.state.locale, "fr-FR");
      assert.equal(reading.state.manufacturer, "Veridian");
      assert.equal(reading.state.screen.drawn, false);
    });
  });

  it("answers an install on a device that is off, and refuses a launch", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const source = await plantBundle(world.context, "cart");
      // Deliberately not booted. A device can be written to while it is down - the substitute's own
      // `requireDevice` guards the launch path and nothing else, and this is the assertion that holds
      // the refusal's wording to that fact rather than to a nicer-sounding rule nobody implemented.
      const installed = await install(world.port, "cart", source);
      assert.equal(installed.result, "answered");
      assert.equal((await world.port.read()).state.state, "off");

      const launched = await launch(world.port, "cart");
      assert.equal(launched.result, "refused");
      assert.ok(
        (launched.reason ?? "").includes("not booted"),
        `the refusal does not say the device is down: ${String(launched.reason)}`,
      );
      // Nothing was started for either request above, which is the one reading that says the refusal
      // happened before the process rather than after it.
      assert.equal(world.recorder.seen.length, 0);
    });
  });

  it("refuses an orientation this world does not have, and moves nothing", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      await boot(world.port);
      const before = (await world.port.read()).state.orientation;
      const call = await world.port.exec({
        argv: ["device", "rotate", "--orientation", "sideways"],
        client: "criterion",
      });
      assert.equal(call.result, "refused");
      assert.ok((call.reason ?? "").includes("landscape"));
      assert.deepEqual((await world.port.read()).state.orientation, before);
    });
  });

  it("rotates and locks when asked for an orientation it has", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      await boot(world.port);
      const call = await world.port.exec({
        argv: ["device", "rotate", "--orientation", "landscape", "--lock", "true"],
        client: "criterion",
      });
      assert.equal(call.result, "answered");
      const held = (await world.port.read()).state.orientation;
      assert.equal(held.orientation, "landscape");
      assert.equal(held.locked, true);
    });
  });

  it("derives the same device id from the same declared name and a different one from another", async () => {
    let first = "";
    let second = "";
    await withWorld(async (world) => {
      await world.port.prepare();
      first = (await world.port.read()).state.id;
    });
    await withWorld(async (world) => {
      await world.port.prepare();
      second = (await world.port.read()).state.id;
    });
    assert.equal(second, first);
    await withWorld(
      async (world) => {
        await world.port.prepare();
        const other = (await world.port.read()).state.id;
        assert.notEqual(other, first);
      },
      { device: "sim-other-device" },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------------------------

describe("launching", () => {
  it("really starts the bundle's entry point as a child of this machine", async () => {
    await withWorld(async (world) => {
      // The flags below are the *launch's* own. They are not part of the install vector, and a
      // fixture that handed them to `bundle install` would be refused for naming a flag that action
      // does not take - which is the reading that says the two vectors are two grammars and not one.
      await withCart(world, { "main.mjs": "console.log('cart up');\n" });
      const call = await launch(world.port, "cart", ["--arg", "--serve"]);
      assert.equal(call.result, "answered");
      assert.equal(world.recorder.seen.length, 1);
      const request = at(world.recorder.seen);
      assert.equal(request.command, process.execPath);
      assert.deepEqual(request.args, [
        join(world.root, "store", "bundles", "cart", "main.mjs"),
        "--serve",
      ]);
      assert.equal(request.cwd, join(world.root, "store", "bundles", "cart"));
      const bundle = theOnly(await bundlesOf(world.port));
      assert.equal(bundle.state, "stopped");
      assert.equal(bundle.launches, 1);
      assert.equal(bundle.running, false);
      assert.equal((await world.port.read()).world.launched, 1);
    });
  });

  it("keeps what the bundle printed, and counts its bytes", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await launch(world.port, "cart");
      // The record's `stdout` is empty because a real child's output arrives through the callbacks;
      // the reading is where a log belongs, and it is what a criterion reads.
      const logs = theOnly((await world.port.read()).logs);
      assert.equal(logs.bundle, "cart");
      assert.equal(logs.runs, 1);
      assert.equal(logs.truncated, false);
    });
  });

  it("reports the code the program really left with, and still answers the launch", async () => {
    await withWorld(
      async (world) => {
        await withCart(world);
        const call = await launch(world.port, "cart");
        // A bundle exiting non-zero is not a refusal: the world was asked to launch it and it did.
        // The code is a reading of what happened, and a criterion is what compares it.
        assert.equal(call.result, "answered");
        assert.equal(theOnly(await bundlesOf(world.port)).exitCode, 3);
      },
      { answer: () => ({ code: 3, stderr: "cart: no stock\n" }) },
    );
  });

  it("answers absent when the declared entry point is not a file, and starts nothing", async () => {
    await withWorld(async (world) => {
      await withCart(world, { "other.mjs": "// not the entry point\n" }, ["--entry", "main.mjs"]);
      const call = await launch(world.port, "cart");
      assert.equal(call.result, "absent");
      assert.ok((call.reason ?? "").includes("main.mjs"));
      assert.equal(world.recorder.seen.length, 0);
      assert.equal(theOnly(await bundlesOf(world.port)).launches, 0);
    });
  });

  it("records a launch's own flags in the call and never in the bundle's declared vector", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const declared = theOnly(await bundlesOf(world.port)).command;
      const request = await launch(world.port, "cart", ["--arg", "--verbose", "--arg", "--wait=2"]);
      assert.equal(request.result, "answered");
      // The request is recorded where a request belongs.
      assert.equal(request.command, "bundle launch cart --arg --verbose --arg --wait=2");
      assert.deepEqual(at(world.recorder.seen).args.slice(1), ["--verbose", "--wait=2"]);
      // And the bundle's reading is unchanged by it, which is the property the first draft of this
      // port broke: a reading that moved with the last launch would be a reading of the run's own
      // history wearing the bundle's name.
      assert.deepEqual(theOnly(await bundlesOf(world.port)).command, declared);
    });
  });

  it("stops a bundle still up when the deadline passes, and reports it failed", async () => {
    await withWorld(
      async (world) => {
        await withCart(world);
        const call = await launch(world.port, "cart");
        assert.equal(call.result, "failed");
        assert.equal(call.status, 1);
        assert.ok((call.reason ?? "").length > 0);
        const bundle = theOnly(await bundlesOf(world.port));
        assert.equal(bundle.state, "stopped");
        assert.equal(bundle.running, false);
      },
      { answer: () => ({ exits: false }), launchMs: 25 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------------------------

describe("the boundary", () => {
  it("refuses a path outside both trees a command may open, and records the attempt", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const outside = outsideBothTrees(world);
      // Absolute *here*, asserted before anything is judged, so this test cannot pass on a spelling
      // that never left the world - which is exactly what a drive letter is on ubuntu. A literal here
      // made this criterion read `answered` on that platform, and nothing else in the file said so.
      assert.equal(
        isAbsolute(outside),
        true,
        `the spelling this test calls "outside" is not absolute here: ${outside}`,
      );
      const call = await install(world.port, "cart", outside);
      assert.equal(call.result, "refused");
      const reason = call.reason ?? "";
      assert.ok(reason.includes("outside both directories a command may open"), reason);
      assert.ok(reason.includes(resolvePath(world.context)), reason);
      assert.ok(reason.includes(resolvePath(world.root)), reason);
      const crossing = theOnly(world.port.escapes());
      assert.equal(crossing.spelled, outside);
      assert.equal(crossing.client, "provisioner");
      // A refusal is a record and not a resource: nothing was copied.
      assert.equal((await world.port.read()).bundles.length, 0);
    });
  });

  it("records which client made the crossing", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const outside = outsideBothTrees(world);
      await install(world.port, "cart", outside);
      await world.port.exec({
        argv: ["bundle", "install", "--id", "cart", outside],
        client: "criterion",
      });
      assert.deepEqual(
        world.port.escapes().map((crossing) => crossing.client),
        ["provisioner", "criterion"],
      );
    });
  });

  it("resolves a relative path against the application's own tree", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      await plantBundle(world.context, "relative-cart", { "main.mjs": "// entry\n" });
      // A relative spelling is what a provisioner writes when it names its own source, and the tree it
      // names is the application's - never this world's sandbox.
      const call = await install(world.port, "relative-cart", "relative-cart");
      assert.equal(call.result, "answered");
      assert.ok(theOnly(await bundlesOf(world.port)).files > 0);
      assert.equal(world.port.escapes().length, 0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Prepare and reset
// ---------------------------------------------------------------------------------------------

describe("prepare", () => {
  it("clears what a previous run left, which is asserted reachable first", async () => {
    await withWorld(async (world) => {
      const stray = join(world.root, "stray.txt");
      await mkdir(dirname(stray), { recursive: true });
      await writeFile(stray, "left by a run that is over\n", "utf8");
      // Readable first, so this test cannot pass on a world that never held the file - the defect
      // that let two criteria report `PASS` on an artefact from someone else's run.
      assert.equal((await stat(stray)).isFile(), true);
      await world.port.prepare();
      await assert.rejects(() => stat(stray));
    });
  });
});

describe("resetting", () => {
  it("empties the store and puts the device away", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await world.port.exec({ argv: ["keychain", "set", "cart", "token", "--value", "s3cret"], client: "provisioner" });
      await world.port.exec({ argv: ["notification", "post", "cart", "--title", "Ready"], client: "provisioner" });
      await world.port.exec({ argv: ["permission", "grant", "cart", "camera"], client: "criterion" });

      await world.port.reset();
      const reading = await world.port.read();
      assert.equal(reading.bundles.length, 0);
      assert.equal(reading.notifications.length, 0);
      assert.equal(reading.keychain.length, 0);
      assert.equal(reading.logs.length, 0);
      assert.equal(reading.world.bundles, 0);
      assert.equal(reading.world.launched, 0);
      assert.equal(reading.world.notifications, 0);
      assert.equal(reading.state.state, "off");
      assert.equal(reading.state.boots, 0);
    });
  });

  it("keeps the call record and the escape tally, because those are the run's own history", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await install(world.port, "cart", outsideBothTrees(world));
      const before = (await world.port.read()).calls.length;
      assert.ok(before >= 3, `the fixture did not record enough calls to be worth comparing: ${String(before)}`);

      await world.port.reset();
      // A reset restores the world, not the record: an iteration that reached outside the boundary
      // followed by a clean one must not report a `PASS` with an empty crossings list.
      assert.equal((await world.port.read()).calls.length, before);
      assert.equal(world.port.escapes().length, 1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------------------------

describe("permissions", () => {
  it("reads a declared permission as not determined, and says nobody was asked", async () => {
    await withWorld(async (world) => {
      await withCart(world, undefined, ["--permission", "camera"]);
      const held = theOnly(theOnly(await bundlesOf(world.port)).permissions);
      assert.equal(held.name, "camera");
      assert.equal(held.key, permissionKey("camera"));
      assert.equal(held.declared, true);
      assert.equal(held.state, "not-determined");
      assert.equal(held.prompted, false);
    });
  });

  it("moves one recorded decision through grant, deny and reset", async () => {
    await withWorld(async (world) => {
      await withCart(world, undefined, ["--permission", "camera"]);
      const decide = async (verb: string) => {
        const call = await world.port.exec({
          argv: ["permission", verb, "cart", "camera"],
          client: "criterion",
        });
        assert.equal(call.result, "answered", `${verb} was not answered: ${String(call.reason)}`);
        return theOnly(theOnly(await bundlesOf(world.port)).permissions).state;
      };
      assert.equal(await decide("grant"), "granted");
      assert.equal(await decide("deny"), "denied");
      assert.equal(await decide("reset"), "not-determined");
    });
  });

  it("refuses a decision that names no permission", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await world.port.exec({ argv: ["permission", "grant", "cart"], client: "criterion" });
      assert.equal(call.result, "refused");
      assert.ok((call.reason ?? "").includes("names none"), String(call.reason));
    });
  });

  it("still names a permission the bundle never declared, and reads it as undeclared", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      // A criterion may grant anything, which is a real device's behaviour too - so the decision is
      // answerable and it is the `declared` field, not the absence of a record, that distinguishes it.
      const call = await world.port.exec({
        argv: ["permission", "grant", "cart", "microphone"],
        client: "criterion",
      });
      assert.equal(call.result, "answered");
      const key = permissionKey("microphone");
      const held = theOnly(
        theOnly(await bundlesOf(world.port)).permissions.filter((entry) => entry.key === key),
      );
      assert.equal(held.declared, false);
      assert.equal(held.state, "granted");
      assert.equal(held.name, `android.permission.${key.toUpperCase()}`);
    });
  });

  it("forgets every decision when the bundle is uninstalled", async () => {
    await withWorld(async (world) => {
      await withCart(world, undefined, ["--permission", "camera"]);
      await world.port.exec({ argv: ["permission", "grant", "cart", "camera"], client: "criterion" });
      await world.port.exec({ argv: ["bundle", "uninstall", "cart"], client: "provisioner" });
      const bundle = theOnly(await bundlesOf(world.port));
      assert.equal(bundle.state, "removed");
      // The *decision* goes with the application; the *declaration* stays, because it is a fact about
      // the manifest the record still holds and a criterion may still ask what was removed. So the
      // property is not that the list empties - it is that the grant is no longer in force, which is
      // why this asserts the state rather than the length.
      const held = theOnly(bundle.permissions);
      assert.equal(held.key, permissionKey("camera"));
      assert.equal(held.declared, true);
      assert.equal(held.state, "not-determined");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------------------------

describe("deep links", () => {
  const register = (port: MobilePort, id: string, uri: string) =>
    port.exec({ argv: ["deepLink", "register", id, uri], client: "provisioner" });

  const open = (port: MobilePort, uri: string) =>
    port.exec({ argv: ["deepLink", "open", uri], client: "criterion" });

  it("resolves a registered link and starts no bundle", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      assert.equal((await register(world.port, "cart", "veridian://cart")).result, "answered");
      const call = await open(world.port, "veridian://cart/item/7");
      assert.equal(call.result, "answered");
      const link = theOnly(theOnly(await bundlesOf(world.port)).deepLinks);
      assert.equal(link.scheme, "veridian");
      assert.equal(link.host, "cart");
      assert.equal(link.path, "");
      assert.equal(link.bundle, "cart");
      assert.equal(link.opened, 1);
      // `resolved, no bundle launched`: a resolution recorded a match and nothing else.
      assert.equal(world.recorder.seen.length, 0);
    });
  });

  it("matches the host exactly and the path by prefix", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await register(world.port, "cart", "veridian://cart/item");
      // A longer path under the registered one resolves, and that is the behaviour of every real
      // deep-link router - which is why this family does not compare two URIs for equality.
      assert.equal((await open(world.port, "veridian://cart/item/7")).result, "answered");
      // A host that merely starts with the registered one does not, because a host is matched exactly.
      assert.equal((await open(world.port, "veridian://cartwheel")).result, "absent");
      // Nor does a path that is not under it.
      assert.equal((await open(world.port, "veridian://cart/basket")).result, "absent");
      assert.equal(theOnly(theOnly(await bundlesOf(world.port)).deepLinks).opened, 1);
    });
  });

  it("records one link when the identical link is registered twice", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      assert.equal((await register(world.port, "cart", "veridian://cart")).result, "answered");
      assert.equal((await register(world.port, "cart", "veridian://cart")).result, "answered");
      assert.equal(theOnly(await bundlesOf(world.port)).deepLinks.length, 1);
    });
  });

  it("refuses a target that is not a deep link, naming what one is", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await open(world.port, "cart/item");
      assert.equal(call.result, "refused");
      assert.ok((call.reason ?? "").includes("://"), String(call.reason));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

describe("notifications", () => {
  it("queues a posted notification and never delivers it", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await world.port.exec({
        argv: ["notification", "post", "cart", "--title", "Order", "--body", "Ready", "--channel", "orders"],
        client: "provisioner",
      });
      assert.equal(call.result, "answered");
      const posted = theOnly((await world.port.read()).notifications);
      assert.equal(posted.bundle, "cart");
      assert.equal(posted.channel, "orders");
      assert.equal(posted.title, "Order");
      assert.equal(posted.body, "Ready");
      assert.equal(posted.priority, "normal");
      assert.equal(posted.delivered, false);
      assert.ok(posted.id.length > 0);
    });
  });

  it("refuses a priority this world does not have, naming the list", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await world.port.exec({
        argv: ["notification", "post", "cart", "--priority", "urgent"],
        client: "provisioner",
      });
      assert.equal(call.result, "refused");
      const reason = call.reason ?? "";
      assert.ok(reason.includes("low") && reason.includes("high"), reason);
      assert.equal((await world.port.read()).notifications.length, 0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The keychain
// ---------------------------------------------------------------------------------------------

describe("the keychain", () => {
  it("carries a digest and a length and never the value", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const secret = "cart-session-secret";
      const call = await world.port.exec({
        argv: ["keychain", "set", "cart", "api-token", "--value", secret],
        client: "provisioner",
      });
      assert.equal(call.result, "answered");
      const held = theOnly((await world.port.read()).keychain);
      assert.equal(held.key, "api-token");
      assert.equal(held.bytes, Buffer.byteLength(secret, "utf8"));
      assert.ok(held.digest.startsWith("sha256:"));
      assert.equal(held.accessible, "when-unlocked");
      // The call record carries the command vector and the reading carries the call records, so the
      // redaction has to hold there too - and the flag it was handed to is deliberately still printed,
      // because what a criterion reads a call for is the shape of the request.
      assert.equal(call.command, "keychain set cart api-token --value <redacted>");
      // The whole reading, not the record: a plaintext secret in a reading is a plaintext secret in
      // `result.json`, in `latest-failure.md` and in an uploaded CI artefact.
      assert.ok(!JSON.stringify(await world.port.read()).includes(secret));
    });
  });

  it("replaces the entry when the same key is written twice", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const write = (value: string) =>
        world.port.exec({ argv: ["keychain", "set", "cart", "api-token", "--value", value], client: "provisioner" });
      assert.equal((await write("first")).result, "answered");
      assert.equal((await write("second")).result, "answered");
      const held = theOnly((await world.port.read()).keychain);
      assert.equal(held.bytes, Buffer.byteLength("second", "utf8"));
    });
  });

  it("refuses a write that names no value", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const call = await world.port.exec({ argv: ["keychain", "set", "cart", "api-token"], client: "provisioner" });
      assert.equal(call.result, "refused");
      assert.ok((call.reason ?? "").includes("--value"), String(call.reason));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The actions that read the world itself
// ---------------------------------------------------------------------------------------------

describe("the actions that ask about the world", () => {
  it("answers device.info, the bundle list, the notification list and the keychain list", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      const device = await world.port.exec({ argv: ["device", "info"], client: "criterion" });
      assert.equal(device.result, "answered");
      assert.equal(device.resource, (await world.port.read()).state.id);

      for (const argv of [
        ["bundle", "list"],
        ["notification", "list"],
        ["keychain", "list"],
      ]) {
        const call = await world.port.exec({ argv, client: "criterion" });
        assert.equal(call.result, "answered", `${argv.join(" ")} was not answered: ${String(call.reason)}`);
        assert.equal(call.resource, null);
      }
    });
  });

  it("answers a ping with the device it is holding", async () => {
    await withWorld(async (world) => {
      await world.port.prepare();
      const call = await world.port.exec({ argv: ["device", "ping"], client: "criterion" });
      assert.equal(call.result, "answered");
      assert.equal(call.resource, (await world.port.read()).state.id);
    });
  });

  it("reads a bundle's own summary and its log", async () => {
    await withWorld(async (world) => {
      await withCart(world);
      await launch(world.port, "cart");
      assert.equal((await world.port.exec({ argv: ["bundle", "inspect", "cart"], client: "criterion" })).result, "answered");
      assert.equal((await world.port.exec({ argv: ["logs", "read", "cart"], client: "criterion" })).result, "answered");
      // And all three of those are absent for a bundle the world does not hold, rather than answered
      // with nothing.
      for (const argv of [
        ["bundle", "inspect", "ghost"],
        ["logs", "read", "ghost"],
        ["bundle", "terminate", "ghost"],
      ]) {
        assert.equal(
          (await world.port.exec({ argv, client: "criterion" })).result,
          "absent",
          `${argv.join(" ")} was not absent`,
        );
      }
    });
  });
});
